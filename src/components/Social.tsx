"use client";

import {
  Fragment,
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
  LIKE_TAPS_MAX,
  ME_ID,
  POST_MAX_LENGTH,
  type Book,
  type Notify,
  type Post,
  OWN_SHOP_ID,
  reviewKey,
  type SpoilerDisplay,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  bookReviews,
  findReader,
  followedTimelinePosts,
  formatPostTime,
  ownersToFollow,
  likesReceived,
  readerPosts,
  repliesOf,
  hasReplies,
  reviewCoverOf,
  reviewCoverWords,
  reviewNoteOf,
  reviewNoteWords,
  spoilerViewOf,
  tapsOf,
  wordsFolded,
  timelinePosts,
  wantCount,
  wantSources,
} from "../lib/social";
import { currentBookId } from "../lib/reading";
import { bookPath } from "../lib/books";
import { postDraftKey, usePostDraft } from "../lib/post-draft";
import {
  extractTags,
  requestSearch,
  splitTags,
  suggestTags,
} from "../lib/tags";
import { BookPicker } from "./BookPicker";
import { booksBeforeSearch } from "../lib/book-lists";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import "./social.css";
import "./poster-screen.css";
import { isDatabaseId, posterNewPath, profilePath } from "../lib/paths";
import { timelinePosters, type Poster } from "../lib/posters";
import { leaveLayers } from "../lib/back-layer";
import { PosterCard } from "./PosterView";
import { ReportButton } from "./Report";
import {
  KeptDraftNote,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { useTownBackend } from "../lib/store";
import { notePosted, postedJustNow } from "../lib/just-posted";
import { coverSelection, splitHidden } from "../lib/hidden-words";
import { focusField } from "../lib/coarse-pointer";
import { useUrlParam } from "../lib/url-state";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/**
 * What the timeline says of spoilers, by the reader's 「ネタバレの表示」.
 * Posters carry only their maker's mark (no 「ネタバレでは？」), and follow it.
 */
const SPOILER_NOTES: Record<SpoilerDisplay, string> = {
  show_all:
    "ネタバレの印が付いた投稿とポスターは、たたんでいます。「表示する」を押すと読めます。",
  fold_possible:
    "ネタバレの印が付いた投稿とポスター、3人以上が「ネタバレでは？」と言った投稿は、たたんでいます。「表示する」を押すと読めます。",
  leave_out:
    "ネタバレの印が付いた投稿とポスター、その可能性がある投稿は、設定により出していません。",
};

type FeedEntry =
  | { kind: "post"; post: Post; at: number }
  | { kind: "poster"; poster: Poster; at: number };

export function TimelineView(props: Shared) {
  const [show, setShow] = useUrlParam("show");
  const followingOnly = show === "following";
  const setFollowingOnly = (only: boolean) =>
    setShow(only ? "following" : null);
  const posts = followingOnly
    ? followedTimelinePosts(props.state)
    : timelinePosts(props.state);
  // Words and posters in one stream, newest first: neither is ranked above the other.
  const feed: FeedEntry[] = [
    ...posts.map((post) => ({
      kind: "post" as const,
      post,
      at: Date.parse(post.createdAt) || 0,
    })),
    ...timelinePosters(props.state, followingOnly).map((poster) => ({
      kind: "poster" as const,
      poster,
      at: Date.parse(poster.createdAt) || 0,
    })),
  ].sort((a, b) => b.at - a.at);
  return (
    <div className="social-page">
      <span className="eyebrow">READERS, IN THEIR OWN WORDS</span>
      <h1 className="page-title">タイムライン</h1>
      <p className="page-subtitle">
        本のことも、そうでないことも。気になった人の好きな本へ。
      </p>
      <div className="timeline-filter-row">
        <div
          className="timeline-filters"
          role="group"
          aria-label="投稿の表示範囲"
        >
          <button
            type="button"
            aria-pressed={!followingOnly}
            onClick={() => setFollowingOnly(false)}
          >
            すべて
          </button>
          <button
            type="button"
            aria-pressed={followingOnly}
            onClick={() => setFollowingOnly(true)}
          >
            フォロー中
          </button>
        </div>
        <Link href={posterNewPath()} className="timeline-make-poster">
          <Icon name="grid" size={16} />
          ポスターを作る
        </Link>
      </div>
      {followingOnly && (
        <p className="timeline-filter-note">
          フォローしている書店の店主と、あなたの投稿。
        </p>
      )}
      {followingOnly && !props.state.following.length && (
        <FollowSuggestions {...props} />
      )}
      {feed.some((entry) => {
        const author =
          entry.kind === "post" ? entry.post.authorId : entry.poster.authorId;
        return author !== ME_ID && !isDatabaseId(author);
      }) && (
        <p className="timeline-demo-note">
          「見本」と付いた読書家と言葉は、街の雰囲気を伝えるための見本です。
        </p>
      )}
      <div className="post-feed" aria-label="タイムラインの投稿">
        {feed.map((entry) =>
          entry.kind === "post" ? (
            <PostCard
              key={entry.post.id}
              {...props}
              post={entry.post}
              showBook
            />
          ) : (
            <PosterCard
              key={"poster:" + entry.poster.id}
              poster={entry.poster}
              state={props.state}
            />
          ),
        )}
        {!feed.length && (
          <div className="empty-state">
            <h2>
              {followingOnly
                ? "気になる人の言葉を、ここに。"
                : "まだ、誰の声もありません。"}
            </h2>
            <p>
              {followingOnly
                ? "書店をフォローすると、店主の投稿をまとめて読めます。"
                : "右下の「投稿」から、最初のひとことを。"}
            </p>
            {followingOnly && (
              <Link href="/" className="button secondary">
                書店を探す
                <Icon name="arrow" size={16} />
              </Link>
            )}
          </div>
        )}
      </div>
      <p className="social-note">
        {SPOILER_NOTES[props.state.settings.spoilerDisplay]}
      </p>
    </div>
  );
}

/** Following nobody yet: a few owners, each with words of their own to read. */
function FollowSuggestions({ state, actions, notify }: Shared) {
  // With an account, only owners who can receive a follow are suggested.
  const savedIn = useTownBackend();
  const owners = ownersToFollow(state).filter(
    ({ shop }) => savedIn !== "account" || isDatabaseId(shop.id),
  );
  if (!owners.length) return null;
  return (
    <section className="follow-suggestions" aria-labelledby="follow-first">
      <h2 id="follow-first">フォローすると、その店主の投稿がここに届きます</h2>
      <ul>
        {owners.map(({ shop, owner, pop, book }) => (
          <li key={shop.id}>
            <Link href={profilePath(owner.id)} className="follow-owner">
              <ReaderAvatar reader={owner} size={36} />
              <span>
                <b>{shop.name}</b>
                <small>
                  {owner.name}
                  {!isDatabaseId(owner.id) && " · 見本"}
                </small>
              </span>
            </Link>
            <p className="follow-pop">
              『{book.title}』に添えたPOP：{pop}
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                actions.toggleFollow(shop.id);
                notify(shop.name + "をフォローしました");
              }}
            >
              フォロー
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
          <PostCard key={post.id} {...props} post={post} />
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
                <PostCard key={post.id} {...props} post={post} revealed />
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
          <PostCard key={post.id} {...props} post={post} showBook />
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
  beforeTools,
}: Shared & {
  fixedBook?: Book;
  parent?: Post;
  onDone?: (postId: string) => void;
  /**
   * In a writing screen (Modal's `writing`): the buttons come last, as its
   * toolbar, which sits just above a phone's keyboard.
   */
  sheet?: boolean;
  /** Shown just before the buttons. */
  beforeTools?: ReactNode;
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
  const tags = extractTags(body);
  const tagSuggestions = suggestTags(state, tags);
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
            ? "タイムラインと作品ページに投稿しました"
            : "タイムラインに投稿しました",
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
      <label className={"composer-spoiler" + (canSpoil ? "" : " is-disabled")}>
        <input
          type="checkbox"
          checked={canSpoil && spoiler}
          disabled={!canSpoil}
          onChange={(event) => update({ spoiler: event.target.checked })}
        />
        ネタバレあり
      </label>
      <HideWordsButton
        field={field}
        body={body}
        onChange={(next) => update({ body: next })}
        notify={notify}
      />
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
        {!isReply && (
          <div className="composer-tags">
            <span className="composer-tag-label">タグ</span>
            {tags.map((tag) => (
              <span key={tag} className="tag-chip is-set">
                #{tag}
              </span>
            ))}
            {tagSuggestions.map((tag) => (
              <button
                type="button"
                key={tag}
                className="tag-chip"
                aria-label={`タグ「${tag}」を付ける`}
                onClick={() =>
                  update({
                    body: (body.trimEnd() + " #" + tag + " ")
                      .trimStart()
                      .slice(0, POST_MAX_LENGTH),
                  })
                }
              >
                ＋#{tag}
              </button>
            ))}
            {!tags.length && (
              <small className="composer-tag-hint">
                本文に「#ことば」と書くとタグになります
              </small>
            )}
          </div>
        )}
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
        {!saved || (continuing && kept) ? (
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
        ) : (
          kept &&
          (body.trim() || bookId) && (
            <p className="draft-status">
              下書きはこのブラウザに保存しています。
            </p>
          )
        )}
        {!isReply && spoiler && canSpoil && (
          <p className="composer-hint">
            タイムラインでは隠して表示し、「表示する」を押した人だけが読めます。作品ページでは「ネタバレあり」の扉の向こうに置きます。
          </p>
        )}
        <HiddenWordsHint body={body} />
        {beforeTools}
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
            beforeTools={
              // Something made, not said: a poster has a page of its own to be made on.
              <p className="compose-poster-way">
                表紙を並べて伝えたいときは、
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    leaveLayers(() => router.push(posterNewPath()))
                  }
                >
                  ポスターを作る
                  <Icon name="arrow" size={14} />
                </button>
              </p>
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
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  body: string;
  onChange: (body: string) => void;
  notify: (message: string) => void;
}) {
  return (
    <button
      type="button"
      className="composer-hide"
      // Keep the words chosen in the text box chosen while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const text = field.current;
        const covered = coverSelection(
          body,
          text?.selectionStart ?? body.length,
          text?.selectionEnd ?? body.length,
          POST_MAX_LENGTH,
        );
        if (!covered) {
          notify("文字数の上限に近いため、隠す印を付けられませんでした");
          return;
        }
        // The covered words are chosen in the text box, rendered first so
        // that this happens within the tap: a phone gives its keyboard back
        // only for a focus given then (a writing screen whose keyboard was
        // put away). On a touch screen only in one the reader was typing
        // in, or in a writing screen: otherwise the keyboard would rise, and
        // the button keeps the focus.
        flushSync(() => onChange(covered.body));
        if (focusField(text, { instead: null }))
          text?.setSelectionRange(covered.start, covered.end);
      }}
    >
      <Icon name="eye" size={15} />
      一部を隠す
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

export function PostCard({
  state,
  actions,
  notify,
  post,
  showBook = false,
  revealed = false,
  isReply = false,
}: Shared & {
  post: Post;
  /** The book page already shows its book, so cards there skip the attachment. */
  showBook?: boolean;
  /** Behind the spoiler door the reader has already chosen to look. */
  revealed?: boolean;
  isReply?: boolean;
}) {
  const author = findReader(state, post.authorId);
  const book = post.bookId
    ? state.books.find((entry) => entry.id === post.bookId)
    : undefined;
  const replies = isReply ? [] : repliesOf(state, post.id);
  const [threadOpen, setThreadOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [reportRead, setReportRead] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mine = post.authorId === ME_ID;
  const reported = state.spoilerReports.includes(post.id);
  const view = spoilerViewOf(state, post);
  const hidden = view === "folded" && !revealed && !shown;
  // Folded by reports: one tap opens it, then any spoiler cover applies.
  const cover = reviewCoverOf(state, "post", post.id, post.authorId);
  // Until it is opened, nothing of it shows: not its words, nor its book.
  const covered = cover !== null && !reportRead;
  const note = reviewNoteOf(state, "post", post.id, post.authorId);
  const taps = tapsOf(state, post.id);
  const [pops, setPops] = useState(0);
  const received = likesReceived(post);
  const wanted = state.wantedPosts.includes(post.id);
  const wants = wantCount(state, post);
  const [moreOpen, setMoreOpen] = useState(false);
  const [arriving] = useState(() => postedJustNow(post.id));
  const savedIn = useTownBackend();
  const spoilerable = !mine && !post.spoiler && Boolean(book || post.parentId);
  const reportable =
    !mine &&
    isDatabaseId(post.id) &&
    (savedIn === "account" || savedIn === "visitor");
  // A reader who chose not to see spoilers is not shown this one at all.
  if (!author || view === "left_out") return null;
  const profile = profilePath(author.id);
  return (
    <article
      className={
        "post-card" +
        (isReply ? " is-reply" : "") +
        (arriving ? " is-arriving" : "")
      }
      aria-label={author.name + "の" + (isReply ? "返信" : "投稿")}
    >
      <Link
        href={profile}
        className="post-avatar"
        tabIndex={-1}
        aria-hidden="true"
      >
        <ReaderAvatar reader={author} size={isReply ? 30 : 40} />
      </Link>
      <div className="post-main">
        <header className="post-head">
          <Link href={profile} className="post-author">
            {author.name}
          </Link>
          <span className="post-handle">
            @{author.handle}
            {!mine && !isDatabaseId(author.id) && " · 見本"}
          </span>
          <time dateTime={post.createdAt}>
            {formatPostTime(post.createdAt)}
          </time>
        </header>
        {post.readingMode === "solo" && (
          <span className="reading-tag is-private">
            <Icon name="lock" size={12} />
            自分だけのメモ
          </span>
        )}
        {post.readingMode === "together" && (
          <span className="reading-tag">
            <Icon name="reading" size={12} />
            読書中のつぶやき
          </span>
        )}
        {(post.spoiler || post.folded || reported) && (
          <span className="spoiler-tag">
            {post.spoiler
              ? "ネタバレあり"
              : reported
                ? "ネタバレの可能性を報告済み"
                : "ネタバレかもしれません"}
          </span>
        )}
        {covered ? (
          <div className="spoiler-cover report-cover">
            <span>
              <Icon name="lock" size={15} />
              {reviewCoverWords("post", cover)}
            </span>
            <button type="button" onClick={() => setReportRead(true)}>
              <Icon name="eye" size={15} />
              読む
            </button>
          </div>
        ) : hidden ? (
          <div className="spoiler-cover">
            <span>
              <Icon name="lock" size={15} />
              ネタバレを含むため、隠しています
              {book && <small>『{book.title}』</small>}
            </span>
            <button type="button" onClick={() => setShown(true)}>
              <Icon name="eye" size={15} />
              表示する
            </button>
          </div>
        ) : (
          <PostText body={post.body} />
        )}
        {note && (
          <div className="spoiler-folded-note report-folded-note" role="note">
            <p>{reviewNoteWords("post", note)}</p>
          </div>
        )}
        {mine && post.folded && !post.spoiler && (
          <div className="spoiler-folded-note" role="note">
            <p>
              読んだ人から「ネタバレでは？」という声があったので、みんなの画面ではたたんで表示しています。投稿は消えていません。
            </p>
            {(book || post.parentId) && (
              <button
                type="button"
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
        {book && (showBook || isReply) && !covered && (
          <Link href={bookPath(book.id)} className="post-book">
            <BookJacket book={book} className="post-book-jacket" />
            <span>
              <b>{book.title}</b>
              <small>{book.author}</small>
            </span>
            <Icon name="arrow" size={15} />
          </Link>
        )}
        <div className="post-actions">
          {/* Pressed again, a like adds up (to LIKE_TAPS_MAX); taking it back is under …. */}
          <button
            type="button"
            className={"like-button" + (taps ? " is-active" : "")}
            aria-pressed={taps > 0}
            onClick={() => {
              if (actions.tapLike(post.id) === taps && taps)
                notify(`いいねは${LIKE_TAPS_MAX}回まで重ねられます`);
              else setPops(pops + 1);
            }}
          >
            <span
              key={pops}
              className={"like-heart" + (pops ? " is-popping" : "")}
            >
              <Icon name="heart" size={16} />
            </span>
            いいね
            {/* How many is the writer's to know, not a ranking for others. */}
            <span>
              {mine
                ? received.people
                  ? received.taps > received.people
                    ? `${received.people}人から${received.taps}回`
                    : `${received.people}人`
                  : ""
                : taps > 1
                  ? `${taps}回`
                  : ""}
            </span>
          </button>
          {!isReply && post.readingMode !== "solo" && (
            <button
              type="button"
              aria-expanded={threadOpen}
              onClick={() => setThreadOpen(!threadOpen)}
            >
              <Icon name="chat" size={16} />
              {replies.length ? "返信 " + replies.length + "件" : "返信する"}
            </button>
          )}
          {book && !mine && !isReply && (
            <button
              type="button"
              className={"want-button" + (wanted ? " is-active" : "")}
              aria-pressed={wanted}
              onClick={() => {
                actions.toggleWant(post.id);
                notify(
                  wanted
                    ? "「読みたくなった」を取り消しました。読みたいリストはそのままです"
                    : author.name +
                        "さんの感想がきっかけで、読みたいリストに加えました",
                );
              }}
            >
              <Icon name={wanted ? "check" : "bookmark"} size={16} />
              読みたくなった
            </button>
          )}
          {spoilerable && reported && (
            <button
              type="button"
              className="report-button"
              aria-pressed
              onClick={() => {
                actions.toggleSpoilerReport(post.id);
                notify("ネタバレの報告を取り消しました");
              }}
            >
              報告を取り消す
            </button>
          )}
          {/* Reporting stays one tap away, out of sight of whoever is writing. */}
          {(taps > 0 || (spoilerable && !reported) || reportable) && (
            <button
              type="button"
              className="report-button post-more-toggle"
              aria-label="その他の操作"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <Icon name="more" size={16} />
            </button>
          )}
          {mine && !confirmingDelete && (
            <button
              type="button"
              className="report-button"
              onClick={() => setConfirmingDelete(true)}
            >
              削除
            </button>
          )}
        </div>
        {moreOpen && (
          <div className="post-more" role="group" aria-label="その他の操作">
            {taps > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  actions.toggleLike(post.id);
                  notify("いいねを取り消しました");
                }}
              >
                いいねを取り消す
              </button>
            )}
            {spoilerable && !reported && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  actions.toggleSpoilerReport(post.id);
                  notify(
                    "ネタバレの可能性を報告しました。あなたの画面では隠します",
                  );
                }}
              >
                ネタバレでは？
              </button>
            )}
            {!mine && (
              <ReportButton
                className=""
                onOpen={() => setMoreOpen(false)}
                target={{
                  kind: "post",
                  id: post.id,
                  name: author.name + "さんの投稿",
                }}
              >
                この投稿を通報
              </ReportButton>
            )}
          </div>
        )}
        {mine && confirmingDelete && (
          <div className="delete-confirm" role="group" aria-label="投稿の削除">
            <span>
              {hasReplies(state, post.id)
                ? "この投稿と返信を削除しますか？"
                : "この投稿を削除しますか？"}
            </span>
            <button
              type="button"
              className="button"
              onClick={() => {
                actions.deletePost(post.id);
                notify("投稿を削除しました");
              }}
            >
              削除する
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              やめる
            </button>
          </div>
        )}
        {mine && wants > 0 && (
          <p className="want-thanks">
            あなたの感想で、{wants}人が読みたくなりました。
          </p>
        )}
        {threadOpen && (
          <div className="post-thread">
            {replies.map((reply) => (
              <PostCard
                key={reply.id}
                state={state}
                actions={actions}
                notify={notify}
                post={reply}
                revealed={revealed}
                isReply
              />
            ))}
            <PostComposer
              state={state}
              actions={actions}
              notify={notify}
              parent={post}
            />
          </div>
        )}
      </div>
    </article>
  );
}
