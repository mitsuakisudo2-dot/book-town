"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ME_ID,
  POST_MAX_LENGTH,
  type Book,
  type Post,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  bookReviews,
  findReader,
  formatPostTime,
  isSpoilerFor,
  likeCount,
  readerPosts,
  repliesOf,
  timelinePosts,
  wantCount,
  wantSources,
} from "../lib/social";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import "./social.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export function TimelineView(props: Shared) {
  const posts = timelinePosts(props.state);
  return (
    <div className="social-page">
      <span className="eyebrow">READERS, IN THEIR OWN WORDS</span>
      <h1 className="page-title">タイムライン</h1>
      <p className="page-subtitle">
        本のことも、そうでないことも。気になった人の好きな本へ。
      </p>
      <PostComposer {...props} />
      <div className="post-feed" aria-label="タイムラインの投稿">
        {posts.map((post) => (
          <PostCard key={post.id} {...props} post={post} showBook />
        ))}
        {!posts.length && (
          <div className="empty-state">
            <h2>まだ、誰の声もありません。</h2>
            <p>最初のひとことを書いてみませんか。</p>
          </div>
        )}
      </div>
      <p className="social-note">
        ネタバレありの投稿は、タイムラインには流れません。作品ページの扉の向こうで読めます。
      </p>
    </div>
  );
}

export function BookReviews({ book, ...props }: Shared & { book: Book }) {
  const { open, spoilers } = bookReviews(props.state, book.id);
  const [doorOpen, setDoorOpen] = useState(false);
  const sources = wantSources(props.state, book.id);
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
      <PostComposer {...props} fixedBook={book} />
      <div className="post-feed">
        {open.map((post) => (
          <PostCard key={post.id} {...props} post={post} />
        ))}
        {!open.length && (
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

function PostComposer({
  state,
  actions,
  notify,
  fixedBook,
  parent,
  onDone,
}: Shared & { fixedBook?: Book; parent?: Post; onDone?: () => void }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [bookId, setBookId] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const attached = fixedBook?.id ?? (bookId || null);
  const isReply = Boolean(parent);
  // A top-level spoiler needs a book to sit behind; replies already belong to one.
  const canSpoil = isReply || attached !== null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = actions.createPost({
      body,
      bookId: attached,
      spoiler: canSpoil && spoiler,
      parentId: parent?.id ?? null,
    });
    if (!created) return;
    setBody("");
    setBookId("");
    setSpoiler(false);
    notify(
      isReply
        ? "返信しました"
        : spoiler
          ? "作品ページの扉の向こうに置きました"
          : attached
            ? "タイムラインと作品ページに投稿しました"
            : "タイムラインに投稿しました",
    );
    onDone?.();
  }
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
          id={id + "-body"}
          className="field composer-text"
          rows={isReply ? 2 : 3}
          maxLength={POST_MAX_LENGTH}
          placeholder={
            isReply
              ? "返信を書く"
              : fixedBook
                ? "この本の感想を書く（ネタバレは下の印を付けて）"
                : "本のことでも、そうでないことでも"
          }
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="composer-tools">
          {!fixedBook && (
            <label className="composer-book">
              <Icon name="book" size={15} />
              <span className="sr-only">
                {isReply ? "おすすめの本を添える" : "本を添える"}
              </span>
              <select
                value={bookId}
                onChange={(event) => {
                  setBookId(event.target.value);
                  if (!event.target.value && !isReply) setSpoiler(false);
                }}
              >
                <option value="">
                  {isReply ? "おすすめの本を添える" : "本を添える"}
                </option>
                {state.books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}（{book.author}）
                  </option>
                ))}
              </select>
            </label>
          )}
          <label
            className={"composer-spoiler" + (canSpoil ? "" : " is-disabled")}
          >
            <input
              type="checkbox"
              checked={canSpoil && spoiler}
              disabled={!canSpoil}
              onChange={(event) => setSpoiler(event.target.checked)}
            />
            ネタバレあり
          </label>
          <span className="composer-count" aria-hidden="true">
            {body.length}/{POST_MAX_LENGTH}
          </span>
          <button className="button" type="submit" disabled={!body.trim()}>
            {isReply ? "返信する" : "投稿する"}
          </button>
        </div>
        {!isReply && spoiler && canSpoil && (
          <p className="composer-hint">
            タイムラインには流さず、作品ページの「ネタバレあり」の扉の向こうにだけ置きます。
          </p>
        )}
      </div>
    </form>
  );
}

function PostCard({
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
  const mine = post.authorId === ME_ID;
  const reported = state.spoilerReports.includes(post.id);
  const hidden = isSpoilerFor(state, post) && !revealed && !shown;
  const liked = state.likedPosts.includes(post.id);
  const wanted = state.wantedPosts.includes(post.id);
  const likes = likeCount(state, post);
  const wants = wantCount(state, post);
  if (!author) return null;
  const profile = "/profiles/" + author.id + "/";
  return (
    <article
      className={"post-card" + (isReply ? " is-reply" : "")}
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
          {!mine && <small className="demo-tag">デモの読書家</small>}
          <time dateTime={post.createdAt}>
            {formatPostTime(post.createdAt)}
          </time>
        </header>
        {(post.spoiler || reported) && (
          <span className="spoiler-tag">
            {post.spoiler ? "ネタバレあり" : "ネタバレの可能性を報告済み"}
          </span>
        )}
        {hidden ? (
          <button
            type="button"
            className="spoiler-cover"
            onClick={() => setShown(true)}
          >
            <Icon name="eye" size={15} />
            ネタバレを含みます。読み終えていれば、表示する
          </button>
        ) : (
          <p className="post-text">{post.body}</p>
        )}
        {book && (showBook || isReply) && (
          <Link href={"/books/" + book.id + "/"} className="post-book">
            <BookJacket book={book} className="post-book-jacket" />
            <span>
              <b>{book.title}</b>
              <small>{book.author}</small>
            </span>
            <Icon name="arrow" size={15} />
          </Link>
        )}
        <div className="post-actions">
          <button
            type="button"
            className={liked ? "is-active" : ""}
            aria-pressed={liked}
            onClick={() => actions.toggleLike(post.id)}
          >
            <Icon name="heart" size={16} />
            いいね<span>{likes || ""}</span>
          </button>
          {!isReply && (
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
              読みたくなった<span>{wants || ""}</span>
            </button>
          )}
          {!mine && !post.spoiler && (book || post.parentId) && (
            <button
              type="button"
              className="report-button"
              aria-pressed={reported}
              onClick={() => {
                actions.toggleSpoilerReport(post.id);
                notify(
                  reported
                    ? "ネタバレの報告を取り消しました"
                    : "ネタバレの可能性を報告しました。あなたの画面では隠します",
                );
              }}
            >
              {reported ? "報告を取り消す" : "ネタバレでは？"}
            </button>
          )}
          {mine && (
            <button
              type="button"
              className="report-button"
              onClick={() => {
                if (!window.confirm("この投稿を削除しますか？返信も消えます。"))
                  return;
                actions.deletePost(post.id);
                notify("投稿を削除しました");
              }}
            >
              削除
            </button>
          )}
        </div>
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
