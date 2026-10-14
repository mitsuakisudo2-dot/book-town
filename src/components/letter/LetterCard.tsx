"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  letterFeelings,
  letterPageOf,
  postPageOf,
  spoilerBars,
} from "../../lib/letter";
import { postedJustNow } from "../../lib/just-posted";
import { isDatabaseId, postPath, profilePath } from "../../lib/paths";
import {
  findReader,
  formatPostTime,
  reviewCoverOf,
  reviewCoverWords,
  reviewNoteOf,
  reviewNoteWords,
  spoilerBookOf,
  spoilerViewOf,
  tapsOf,
} from "../../lib/social";
import { useTownBackend } from "../../lib/store";
import {
  ME_ID,
  type Notify,
  type Post,
  type TownActions,
  type TownState,
} from "../../lib/types";
import { CoverCredit, ReaderAvatar } from "../ui";
import { BookRow, WantButton } from "./BookRow";
import { LetterIcon } from "./icons";
import { LetterMenu, hasMenuRows, type LetterMenuRows } from "./LetterMenu";
import { LetterText, useLineFold } from "./LetterText";
import { LikeButton, LikeUndo } from "./LikeButton";
import { forgetOpened, noteOpened, openPost, wasOpened } from "./post-layer";
import { SpoilerCover } from "./SpoilerCover";
import "./letter.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/** What the covered box says, by why it is covered (仮, §4.2 #8). */
function spoilerWords(post: Post, askedByMe: boolean): string {
  if (post.spoiler) return "結末に触れています・押すと表示";
  if (askedByMe) return "ネタバレの可能性を報告済み・押すと表示";
  return "ネタバレかもしれません・押すと表示";
}

/** The small tag beside a spoiler, open or covered. */
function spoilerTag(post: Post, askedByMe: boolean): string {
  if (post.spoiler) return "ネタバレあり";
  if (askedByMe) return "ネタバレの可能性を報告済み";
  return "ネタバレかもしれません";
}

// A tap on these does their own thing, never the card's.
const OWN_TAPS =
  "a,button,input,textarea,select,label,summary,[role=dialog],.modal-backdrop,.letter-book";

/**
 * A 便り (a post) on every screen that shows posts: the v37 card. The face
 * beside, the name and when; the words, folded when long and covered when
 * they spoil; the book in a thin frame with 読みたい; then reply, いいね
 * and 「…」 along the bottom. A tap on the card opens its page
 * (`place="list"`); on that page (`place="page"`) the post and its replies
 * are shown whole.
 */
export function LetterCard({
  state,
  actions,
  notify,
  post,
  showBook = false,
  revealed = false,
  place = "list",
  isReply = false,
  opAuthorId,
}: Shared & {
  post: Post;
  /** The book page already shows its book, so cards there leave the row out. */
  showBook?: boolean;
  /** Behind the book page's spoiler door the reader has already chosen to look. */
  revealed?: boolean;
  place?: "list" | "page";
  /** A reply on its post's page. */
  isReply?: boolean;
  /** On a post's page: who wrote the post, to mark their replies. */
  opAuthorId?: string;
}) {
  const author = findReader(state, post.authorId);
  const book = post.bookId
    ? state.books.find((entry) => entry.id === post.bookId)
    : undefined;
  const onPage = place === "page";
  const [shown, setShown] = useState(
    () => onPage && wasOpened("spoiler:" + post.id),
  );
  const [reportRead, setReportRead] = useState(
    () => onPage && wasOpened("report:" + post.id),
  );
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [askingUnlike, setAskingUnlike] = useState(false);
  const [arriving] = useState(() => postedJustNow(post.id));
  const textRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLAnchorElement>(null);
  const downOnCard = useRef(false);
  const textId = useId();
  const savedIn = useTownBackend();
  const mine = post.authorId === ME_ID;
  const askedByMe = state.spoilerReports.includes(post.id);
  const view = spoilerViewOf(state, post);
  const hidden = view === "folded" && !revealed && !shown;
  // Folded by reports: one tap opens it, then any spoiler cover applies.
  const cover = reviewCoverOf(state, "post", post.id, post.authorId);
  // Until it is opened, nothing of it shows: not its words, nor its book.
  const covered = cover !== null && !reportRead;
  const note = reviewNoteOf(state, "post", post.id, post.authorId);
  const long = useLineFold(textRef, !onPage && !covered && !hidden);
  // Opened from a cover just now: the words take the focus the cover had.
  const [focusText, setFocusText] = useState(false);
  useEffect(() => {
    if (!focusText) return;
    textRef.current?.focus({ preventScroll: true });
    setFocusText(false);
  }, [focusText]);

  // A reader who chose not to see spoilers is not shown this one at all.
  if (!author || view === "left_out") return null;

  const reply = post.parentId !== null;
  const solo = post.readingMode === "solo";
  const spoilerBook = state.books.find(
    (entry) => entry.id === spoilerBookOf(state, post),
  );
  const shop =
    post.authorId === ME_ID
      ? state.ownShop
      : state.shops.find((entry) => entry.ownerId === post.authorId);
  const sample = !mine && !isDatabaseId(author.id);
  const profile = profilePath(author.id);
  const pageId = postPageOf(post);
  const pagePath = postPath(pageId);
  // A card leads to its page only when the page would open: a reply in a
  // tag's list whose post is left out, or gone, has none to open.
  const leads = !onPage && letterPageOf(state, pageId) !== null;
  const bookRow = Boolean(book && (showBook || onPage) && !covered);
  // 読みたい on others' posts that have a book, replies with the book they
  // recommend too; where the book row is not drawn (the book's own page), it
  // sits under the words instead (仮, §4.2 #38).
  const wantable = Boolean(book && !mine && !covered);
  const want =
    wantable && book ? (
      <WantButton
        state={state}
        actions={actions}
        notify={notify}
        post={post}
        book={book}
        author={author}
      />
    ) : null;
  const taps = tapsOf(state, post.id);
  const rows: LetterMenuRows = {
    unlike: taps > 0,
    spoiler: !mine && !post.spoiler && Boolean(book || post.parentId),
    report:
      !mine &&
      isDatabaseId(post.id) &&
      (savedIn === "account" || savedIn === "visitor"),
    remove: mine,
  };
  // Threads are one level: a reply is answered on its post's page. A note
  // kept to oneself takes no replies.
  const replyable = !reply && !solo && leads;

  function openPage() {
    // Opened from behind the book page's spoiler door: the page shows it,
    // and its replies, as the door did (and does again on the way back).
    // Opened anywhere else, it is covered as that screen covers it.
    if (revealed) noteOpened("door:" + pageId);
    else forgetOpened("door:" + pageId);
    openPost(pageId, timeRef.current);
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    const target = event.target as Element;
    downOnCard.current =
      event.currentTarget.contains(target) &&
      !target.closest("[role=dialog],.modal-backdrop");
  }
  function tap(event: MouseEvent<HTMLElement>) {
    const began = downOnCard.current;
    downOnCard.current = false;
    if (onPage || !began) return;
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest(OWN_TAPS))
      return;
    // The tap that ends a selection of the words is the selection's.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim())
      return;
    if (long && !open) {
      setOpen(true);
      return;
    }
    if (leads) openPage();
  }

  const tags = !covered && (
    <>
      {post.readingMode === "solo" && (
        <span className="letter-tag">自分だけのメモ</span>
      )}
      {post.readingMode === "together" && (
        <span className="letter-tag">読書中のつぶやき</span>
      )}
      {(post.spoiler || post.folded || askedByMe) && (
        <span className="letter-tag is-spoiler">
          {spoilerTag(post, askedByMe)}
        </span>
      )}
    </>
  );
  const hasTags =
    !covered &&
    (post.readingMode !== null || post.spoiler || post.folded || askedByMe);

  return (
    <>
      <article
        className={
          "post-card letter" +
          (onPage ? " is-page" : leads ? "" : " is-still") +
          (onPage && !isReply ? " is-main" : "") +
          (isReply ? " is-reply" : "") +
          (arriving ? " is-arriving" : "")
        }
        aria-label={author.name + "の" + (isReply ? "返信" : "投稿")}
        data-post-id={post.id}
        onPointerDown={pointerDown}
        onClick={tap}
      >
        <Link
          href={profile}
          className="post-avatar"
          tabIndex={-1}
          aria-hidden="true"
        >
          <ReaderAvatar reader={author} size={40} />
        </Link>
        <header className="post-head">
          <p className="letter-who">
            <Link href={profile} className="post-author">
              {author.name}
            </Link>
            {sample && <span className="letter-tag">見本</span>}
            {isReply && opAuthorId === post.authorId && (
              <span className="letter-tag">投稿した人</span>
            )}
          </p>
          <p className="letter-meta">
            <span className="post-handle">@{author.handle}</span>
            {shop && <span className="letter-shop">{shop.name}の店主</span>}
            {!leads ? (
              <time className="letter-when" dateTime={post.createdAt}>
                {formatPostTime(post.createdAt)}
              </time>
            ) : (
              <a
                ref={timeRef}
                className="letter-time"
                href={pagePath}
                onClick={(event) => {
                  // A new tab or window opens the page at its own address.
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  openPage();
                }}
              >
                <time dateTime={post.createdAt}>
                  {formatPostTime(post.createdAt)}
                </time>
              </a>
            )}
          </p>
        </header>
        <div className="letter-body">
          {hasTags && <p className="letter-tags">{tags}</p>}
          {covered ? (
            <div className="letter-covered">
              <p>{reviewCoverWords("post", cover)}</p>
              <button
                type="button"
                onClick={() => {
                  setReportRead(true);
                  noteOpened("report:" + post.id);
                  setFocusText(true);
                }}
              >
                読む
              </button>
            </div>
          ) : hidden ? (
            <SpoilerCover
              words={spoilerWords(post, askedByMe)}
              title={spoilerBook?.title}
              bars={spoilerBars(post.body)}
              onOpen={() => {
                setShown(true);
                noteOpened("spoiler:" + post.id);
                setFocusText(true);
              }}
            />
          ) : (
            <LetterText
              id={textId}
              body={post.body}
              textRef={textRef}
              long={long}
              open={open}
              onToggle={() => setOpen(!open)}
            />
          )}
          {note && (
            <div className="letter-note report-folded-note" role="note">
              <p>{reviewNoteWords("post", note)}</p>
            </div>
          )}
          {/* Only the writer sees why their post was folded, and how to mark it. */}
          {mine && post.folded && !post.spoiler && (
            <div className="letter-note" role="note">
              <p>
                読んだ人から「ネタバレでは？」という声があったので、みんなの画面ではたたんで表示しています。投稿は消えていません。
              </p>
              {(book || post.parentId) && (
                <button
                  type="button"
                  className="letter-text-button"
                  onClick={() => {
                    actions.markSpoiler(post.id);
                    notify("ネタバレの印を付けました");
                  }}
                >
                  ネタバレの印を付ける
                </button>
              )}
            </div>
          )}
          {!bookRow && want && <div className="letter-want-row">{want}</div>}
          {bookRow && book && (
            <BookRow
              book={book}
              feelings={letterFeelings(state, post)}
              want={want}
            />
          )}
          {bookRow && book && onPage && !isReply && (
            <p className="letter-credit">
              <CoverCredit book={book} />
            </p>
          )}
        </div>
        <div className="letter-actions">
          {replyable ? (
            <button
              type="button"
              className="letter-act letter-reply"
              onClick={openPage}
            >
              <LetterIcon name="reply" />
              <span className="sr-only">返信</span>
            </button>
          ) : (
            <span />
          )}
          <LikeButton
            state={state}
            actions={actions}
            postId={post.id}
            onAsk={() => setAskingUnlike(true)}
          />
          <span className="letter-menu-slot">
            {hasMenuRows(rows) && (
              <button
                type="button"
                className="letter-act letter-menu-button"
                aria-label="その他の操作"
                aria-haspopup="dialog"
                onClick={() => setMenuOpen(true)}
              >
                <LetterIcon name="more" />
              </button>
            )}
          </span>
        </div>
      </article>
      {menuOpen && (
        <LetterMenu
          state={state}
          actions={actions}
          notify={notify}
          post={post}
          authorName={author.name}
          rows={rows}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {askingUnlike && (
        <LikeUndo
          actions={actions}
          notify={notify}
          postId={post.id}
          onClose={() => setAskingUnlike(false)}
        />
      )}
    </>
  );
}
