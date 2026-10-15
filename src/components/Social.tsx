"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ME_ID,
  POST_MAX_LENGTH,
  type Book,
  type Notify,
  type Post,
  OWN_SHOP_ID,
  reviewKey,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  bookReviews,
  findReader,
  readerPosts,
  wordsFolded,
  wantSources,
} from "../lib/social";
import { currentBookId } from "../lib/reading";
import { postDraftKey, usePostDraft } from "../lib/post-draft";
import { requestSearch, splitTags } from "../lib/tags";
import { BookPicker } from "./BookPicker";
import { booksBeforeSearch } from "../lib/book-lists";
import { Icon, Modal, ReaderAvatar } from "./ui";
import "./social.css";
import "./poster-screen.css";
import { posterNewPath } from "../lib/paths";
import { leaveLayers } from "../lib/back-layer";
import { LetterCard } from "./letter/LetterCard";
import {
  KeptDraftNote,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { notePosted } from "../lib/just-posted";
import { coverSelection, splitHidden } from "../lib/hidden-words";
import { focusField } from "../lib/coarse-pointer";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

const REVIEW_PREVIEW = 3;

export function BookReviews({ book, ...props }: Shared & { book: Book }) {
  const { open, spoilers, leftOut } = bookReviews(props.state, book.id);
  const [doorOpen, setDoorOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const sources = wantSources(props.state, book.id);
  // The newest three come first; the rest wait behind one button.
  const shown = showAll ? open : open.slice(0, REVIEW_PREVIEW);
  return (
    <section className="book-reviews" aria-labelledby="book-reviews-title">
      <div className="book-path-heading">
        <span className="eyebrow">REVIEWS AND CONVERSATIONS</span>
        <h2 id="book-reviews-title">この本のレビュー</h2>
        <p>本を添えた投稿は、ここにも並びます。返信で、会話の続きを。</p>
      </div>
      {sources.length > 0 && (
        <p className="want-source">
          <Icon name="bookmark" size={15} />
          {sources
            .map((post) => findReader(props.state, post.authorId)?.name ?? "")
            .filter(Boolean)
            .join("さん、")}
          さんの感想で、読みたくなった本です。
        </p>
      )}
      <PostComposer key={book.id} {...props} fixedBook={book} />
      <div className="post-feed">
        {shown.map((post) => (
          <LetterCard key={post.id} {...props} post={post} />
        ))}
        {open.length > shown.length && (
          <button
            type="button"
            className="reviews-more"
            onClick={() => setShowAll(true)}
          >
            残りのレビューをすべて表示（{open.length - shown.length}件）
          </button>
        )}
        {!open.length && !leftOut && (
          <div className="empty-state">
            <h3>この本の、最初の感想を。</h3>
            <p>読み終えた人も、読んでいる途中の人も。</p>
          </div>
        )}
      </div>
      {spoilers.length > 0 && (
        <div className="spoiler-door">
          <button
            type="button"
            className="spoiler-door-button"
            aria-expanded={doorOpen}
            onClick={() => setDoorOpen(!doorOpen)}
          >
            <Icon name={doorOpen ? "eye" : "lock"} size={17} />
            ネタバレありのレビュー（{spoilers.length}件）
            <span>
              {doorOpen ? "扉を閉じる" : "読み終えた人は、扉を開ける"}
            </span>
          </button>
          {doorOpen && (
            <div className="post-feed">
              {spoilers.map((post) => (
                <LetterCard key={post.id} {...props} post={post} revealed />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Said once, without a count: the reader chose not to see these. */}
      {leftOut && (
        <p className="social-note reviews-left-out">
          ネタバレを含むかもしれないレビューは、設定により出していません
        </p>
      )}
    </section>
  );
}

export function ProfilePosts({
  readerId,
  ...props
}: Shared & { readerId: string }) {
  const posts = readerPosts(props.state, readerId);
  const self = readerId === ME_ID;
  return (
    <section className="profile-posts" aria-labelledby="profile-posts-title">
      <div className="book-path-heading">
        <span className="eyebrow">POSTS</span>
        <h2 id="profile-posts-title">投稿</h2>
      </div>
      <div className="post-feed">
        {posts.map((post) => (
          <LetterCard key={post.id} {...props} post={post} showBook />
        ))}
        {!posts.length && (
          <div className="empty-state">
            <p>{self ? "まだ投稿していません。" : "まだ投稿はありません。"}</p>
            {self && (
              <Link href="/timeline/" className="button secondary">
                タイムラインで書く
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function PostComposer({
  state,
  actions,
  notify,
  fixedBook,
  parent,
  onDone,
  sheet = false,
  moreTools,
}: Shared & {
  fixedBook?: Book;
  parent?: Post;
  onDone?: (postId: string) => void;
  /**
   * In a writing screen (Modal's `writing`): the buttons come last, as its
   * toolbar, which sits just above a phone's keyboard.
   */
  sheet?: boolean;
  /** More buttons for the row, after 本を添える. */
  moreTools?: ReactNode;
}) {
  const id = useId();
  const owner = useDraftOwner();
  const {
    draft: { body, bookId, spoiler },
    kept,
    saved,
    loaded,
    update,
    clear,
  } = usePostDraft(
    owner === null
      ? null
      : postDraftKey(owner, { parentId: parent?.id, bookId: fixedBook?.id }),
  );
  const continuing = useOpenedWithWork(loaded, kept);
  const notTaken = useNotTakenWords("下書き");
  const [picking, setPicking] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Where the words chosen in the text box are, in the words they were
  // chosen in: once the draft changes (typed over, covered, thrown away)
  // none are chosen until the box says so again.
  const [chosen, setChosen] = useState<{
    body: string;
    start: number;
    end: number;
  } | null>(null);
  const choosing =
    chosen !== null &&
    chosen.body === body &&
    body.slice(chosen.start, chosen.end).trim() !== "";
  // The box says so with a selectionchange, which reaches the document (some
  // browsers send it only there, with the box focused), and older ones with
  // a select. React's onSelect misses it with the document as its root.
  useEffect(() => {
    const text = field.current;
    if (!text) return;
    const note = (event: Event) => {
      if (event.target !== text && document.activeElement !== text) return;
      const { value, selectionStart: start, selectionEnd: end } = text;
      setChosen((was) =>
        was?.body === value && was.start === start && was.end === end
          ? was
          : { body: value, start, end },
      );
    };
    document.addEventListener("selectionchange", note);
    text.addEventListener("select", note);
    return () => {
      document.removeEventListener("selectionchange", note);
      text.removeEventListener("select", note);
    };
  }, []);
  const attached = fixedBook?.id ?? bookId;
  const isReply = Boolean(parent);
  // A top-level spoiler needs a book to sit behind; replies already belong to one.
  const canSpoil = isReply || attached !== null;
  const reading = currentBookId(state);
  const suggestions = [
    ...(reading ? [reading] : []),
    ...state.wishlist,
    ...state.library,
  ].filter((entry, index, list) => list.indexOf(entry) === index);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = actions.createPost({
      body,
      bookId: attached,
      spoiler: canSpoil && spoiler,
      parentId: parent?.id ?? null,
    });
    // Not taken: the words stay in the draft, and the writer is told why.
    if (!created) {
      notify(notTaken);
      return;
    }
    notePosted(created);
    clear();
    setPicking(false);
    notify(
      isReply
        ? "返信しました"
        : spoiler
          ? "ネタバレを隠して投稿しました"
          : attached
            ? "ホームと作品ページに投稿しました"
            : "ホームに投稿しました",
    );
    onDone?.(created);
  }
  const tools = (
    <div className={"composer-tools" + (sheet ? " writing-toolbar" : "")}>
      {!fixedBook && !picking && !bookId && (
        <button
          type="button"
          className="composer-book"
          // Rendered within the tap: in a writing screen the search
          // takes the focus there, and the keyboard stays up for it.
          onClick={() => flushSync(() => setPicking(true))}
        >
          <Icon name="book" size={15} />
          {isReply ? "おすすめの本を添える" : "本を添える"}
        </button>
      )}
      {moreTools}
      {canSpoil && (
        <label className="composer-spoiler">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(event) => update({ spoiler: event.target.checked })}
          />
          ネタバレあり
        </label>
      )}
      {/* Only while words are chosen: the text box keeps the focus, so on
          a phone the keyboard stays up as it comes and goes. */}
      {choosing && (
        <HideWordsButton
          field={field}
          body={body}
          onChange={(next) => update({ body: next })}
          notify={notify}
          chosen
        />
      )}
      <span className="composer-send">
        <LengthNearLimit length={body.length} max={POST_MAX_LENGTH} />
        <button className="button" type="submit" disabled={!body.trim()}>
          {isReply ? "返信する" : "投稿する"}
        </button>
      </span>
    </div>
  );
  return (
    <form
      className={"post-composer" + (isReply ? " is-reply" : "")}
      onSubmit={submit}
    >
      {!isReply && <ReaderAvatar reader={state.me} size={38} />}
      <div className="composer-body">
        <label className="sr-only" htmlFor={id + "-body"}>
          {isReply
            ? "返信"
            : fixedBook
              ? fixedBook.title + "の感想"
              : "いま、どんな本のことを考えていますか"}
        </label>
        <textarea
          ref={field}
          id={id + "-body"}
          className="field composer-text"
          rows={isReply ? 2 : 4}
          maxLength={POST_MAX_LENGTH}
          placeholder={
            isReply
              ? "返信を書く"
              : fixedBook
                ? "この本の感想を書く（ネタバレは下の印を付けて）"
                : "本のことでも、そうでないことでも"
          }
          value={body}
          onChange={(event) => update({ body: event.target.value })}
        />
        {!fixedBook && (picking || bookId) && (
          <BookPicker
            books={state.books}
            genreFinds={booksBeforeSearch(state)}
            value={bookId}
            onChange={(next) => {
              update({
                bookId: next,
                ...(!next && !isReply ? { spoiler: false } : {}),
              });
              if (!next) {
                setPicking(false);
              }
            }}
            label={isReply ? "おすすめの本を探す" : "添える本を探す"}
            suggestions={suggestions}
            suggestionLabel="読んでいる本・読みたい本・登録した本"
            autoFocus={picking}
          />
        )}
        {!sheet && tools}
        <KeptDraftNote
          continuing={continuing && kept}
          saved={saved}
          wordsLost={body.trim() !== ""}
          onDiscard={() => {
            clear();
            setPicking(false);
            focusField(field.current);
          }}
        />
        {sheet && tools}
      </div>
    </form>
  );
}

/** The round button at the lower right. Its icon is a setting on the profile. */
export function ComposeFab({
  onPosted,
  ...props
}: Shared & { onPosted?: () => void }) {
  const [open, setOpen] = useState(false);
  const owner = useDraftOwner();
  const { draft } = usePostDraft(owner === null ? null : postDraftKey(owner));
  const icon = props.state.settings.composeIcon;
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className={"compose-fab icon-" + icon}
        // The sheet opens within the tap, so a phone's keyboard rises with
        // its text box (Modal's `writing`).
        onClick={() => flushSync(() => setOpen(true))}
        aria-label="投稿する"
      >
        <Icon name={icon} size={22} />
        <span>{draft.body || draft.bookId ? "下書き" : "投稿"}</span>
      </button>
      {open && (
        <Modal title="投稿する" onClose={() => setOpen(false)} writing>
          <PostComposer
            {...props}
            sheet
            onDone={() => {
              setOpen(false);
              onPosted?.();
            }}
            moreTools={
              // Something made, not said: a poster has a page of its own to
              // be made on, so this one leaves the sheet (and the keyboard).
              <button
                type="button"
                className="composer-poster"
                aria-label="ポスターを作る"
                onClick={() => leaveLayers(() => router.push(posterNewPath()))}
              >
                <Icon name="grid" size={15} />
                ポスター
              </button>
            }
          />
        </Modal>
      )}
    </>
  );
}

/**
 * Covers the selected words of a draft, so a review can keep one spoiling line
 * out of sight without hiding all of itself. With nothing selected it leaves a
 * covered place to write in.
 */
export function HideWordsButton({
  field,
  body,
  onChange,
  notify,
  chosen = false,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  body: string;
  onChange: (body: string) => void;
  notify: (message: string) => void;
  /**
   * Shown only while words are chosen (the post composer): 「隠す」, and the
   * caret goes on after the covered words, leaving none chosen to cover twice.
   */
  chosen?: boolean;
}) {
  return (
    <button
      type="button"
      className="composer-hide"
      aria-label={chosen ? "選んだ言葉を隠す" : undefined}
      // Keep the words chosen in the text box chosen while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const text = field.current;
        const start = text?.selectionStart ?? body.length;
        const covered = coverSelection(
          body,
          start,
          text?.selectionEnd ?? body.length,
          POST_MAX_LENGTH,
        );
        if (!covered) {
          notify("文字数の上限に近いため、隠す印を付けられませんでした");
          return;
        }
        // The covered words are chosen in the text box (or, `chosen`, the
        // caret put after them), rendered first so that this happens within
        // the tap: a phone gives its keyboard back only for a focus given
        // then (a writing screen whose keyboard was put away). On a touch
        // screen only in one the reader was typing in, or in a writing
        // screen: otherwise the keyboard would rise, and the button keeps
        // the focus.
        flushSync(() => onChange(covered.body));
        if (!focusField(text, { instead: null })) return;
        // The closing marks are as long as the opening ones.
        const after = covered.end + covered.start - start;
        if (chosen) text?.setSelectionRange(after, after);
        else text?.setSelectionRange(covered.start, covered.end);
      }}
    >
      <Icon name="eye" size={15} />
      {chosen ? "隠す" : "一部を隠す"}
    </button>
  );
}

/**
 * How much is written, only near the limit (from 80%), so an empty field
 * never shows 「0/…」. The field's maxLength does the stopping.
 */
export function LengthNearLimit({
  length,
  max,
  className = "composer-count",
}: {
  length: number;
  max: number;
  className?: string;
}) {
  if (length < Math.ceil(max * 0.8)) return null;
  return (
    <span className={className} aria-hidden="true">
      {length}/{max}
    </span>
  );
}

/** Says what the marks do once a draft has some. */
export function HiddenWordsHint({ body }: { body: string }) {
  if (!splitHidden(body).some((part) => part.hidden)) return null;
  return (
    <p className="composer-hint">
      「||」で囲んだ言葉は塗りつぶして表示し、押した人だけが読めます。
    </p>
  );
}

/** Covered words in a post: closed until the reader chooses to look. */
function HiddenWords({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <mark className="hidden-words is-open">{text}</mark>;
  return (
    <button
      type="button"
      className="hidden-words"
      aria-label="隠された言葉（ネタバレ）を読む"
      onClick={() => setOpen(true)}
    >
      ネタバレ
    </button>
  );
}

/**
 * Post text with each #tag as a link to the posts that share it, and the
 * words the writer covered closed until tapped.
 */
export function PostText({ body }: { body: string }) {
  return (
    <p className="post-text">
      {splitHidden(body).map((part, index) =>
        part.hidden ? (
          <HiddenWords key={index} text={part.text} />
        ) : (
          <Fragment key={index}>
            {splitTags(part.text).map((piece, at) =>
              piece.tag ? (
                <Link
                  key={at}
                  className="post-tag"
                  href={"/search/?q=" + encodeURIComponent("#" + piece.tag)}
                  onClick={() => requestSearch("#" + piece.tag)}
                >
                  {piece.text}
                </Link>
              ) : (
                piece.text
              ),
            )}
          </Fragment>
        ),
      )}
    </p>
  );
}

/**
 * A shop's or a person's own words (an introduction, a bio). Folded by
 * reports, others see a quiet line and open it with one tap; the owner sees
 * the words and why they are folded for others. `inLink`: inside a link, so
 * no button is put there; the page it leads to opens them.
 */
export function FoldedWords({
  state,
  kind,
  id,
  inLink = false,
  children,
}: {
  state: TownState;
  kind: "shop" | "profile";
  id: string;
  inLink?: boolean;
  children: ReactNode;
}) {
  const [read, setRead] = useState(false);
  const own = id === ME_ID || id === OWN_SHOP_ID;
  if (own && state.reviewFolds[reviewKey(kind, id)]?.state === "folded")
    return (
      <>
        {children}
        <p className="words-folded-note" role="note">
          通報があったため、運営が確かめるまで、紹介文をみんなの画面ではたたんでいます
        </p>
      </>
    );
  if (read || !wordsFolded(state, kind, id)) return <>{children}</>;
  return (
    <span className="words-folded">
      <span>
        この紹介文は、通報があったため、運営が確かめるまでたたんでいます
      </span>
      {!inLink && (
        <button type="button" onClick={() => setRead(true)}>
          読む
        </button>
      )}
    </span>
  );
}
