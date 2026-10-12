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
  followedTimelinePosts,
  formatPostTime,
  isSpoilerFor,
  likeCount,
  readerPosts,
  repliesOf,
  timelinePosts,
  wantCount,
  wantSources,
} from "../lib/social";
import { currentBookId } from "../lib/reading";
import { bookPath } from "../lib/books";
import { EMPTY_POST_DRAFT, usePostDraft } from "../lib/post-draft";
import {
  extractTags,
  popularTags,
  requestSearch,
  splitTags,
} from "../lib/tags";
import { BookPicker } from "./BookPicker";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import "./social.css";
import { isDatabaseId, profilePath } from "../lib/paths";
import { ReportButton } from "./Report";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export function TimelineView(props: Shared) {
  const [followingOnly, setFollowingOnly] = useState(false);
  const posts = followingOnly
    ? followedTimelinePosts(props.state)
    : timelinePosts(props.state);
  return (
    <div className="social-page">
      <span className="eyebrow">READERS, IN THEIR OWN WORDS</span>
      <h1 className="page-title">タイムライン</h1>
      <p className="page-subtitle">
        本のことも、そうでないことも。気になった人の好きな本へ。
      </p>
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
      {followingOnly && (
        <p className="timeline-filter-note">
          フォローしている書店の店主と、あなたの投稿。
        </p>
      )}
      <div className="post-feed" aria-label="タイムラインの投稿">
        {posts.map((post) => (
          <PostCard key={post.id} {...props} post={post} showBook />
        ))}
        {!posts.length && (
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
        ネタバレを含む投稿は隠しています。「表示する」を押すと読めます。
      </p>
    </div>
  );
}

const REVIEW_PREVIEW = 3;

export function BookReviews({ book, ...props }: Shared & { book: Book }) {
  const { open, spoilers } = bookReviews(props.state, book.id);
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
      <PostComposer {...props} fixedBook={book} />
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

export function PostComposer({
  state,
  actions,
  notify,
  fixedBook,
  parent,
  onDone,
  autoFocus = false,
}: Shared & {
  fixedBook?: Book;
  parent?: Post;
  onDone?: (postId: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const {
    draft: { body, bookId, spoiler },
    saved,
    update,
  } = usePostDraft(
    parent
      ? "reply:" + parent.id
      : fixedBook
        ? "review:" + fixedBook.id
        : "new-post",
  );
  const [picking, setPicking] = useState(false);
  const tags = extractTags(body);
  const tagSuggestions = popularTags(state, 8)
    .map((entry) => entry.tag)
    .filter((tag) => !tags.includes(tag))
    .slice(0, 4);
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
    if (!created) return;
    update(EMPTY_POST_DRAFT);
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
          rows={isReply ? 2 : 4}
          maxLength={POST_MAX_LENGTH}
          autoFocus={autoFocus}
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
          />
        )}
        <div className="composer-tools">
          {!fixedBook && !picking && !bookId && (
            <button
              type="button"
              className="composer-book"
              onClick={() => setPicking(true)}
            >
              <Icon name="book" size={15} />
              {isReply ? "おすすめの本を添える" : "本を添える"}
            </button>
          )}
          <label
            className={"composer-spoiler" + (canSpoil ? "" : " is-disabled")}
          >
            <input
              type="checkbox"
              checked={canSpoil && spoiler}
              disabled={!canSpoil}
              onChange={(event) => update({ spoiler: event.target.checked })}
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
        <p className="draft-status" role={saved ? undefined : "status"}>
          {saved
            ? "下書きはこのブラウザに保存。閉じても続きから書けます。"
            : "下書きを保存できません。ページを再読み込みすると失われます。"}
        </p>
        {!isReply && spoiler && canSpoil && (
          <p className="composer-hint">
            タイムラインでは隠して表示し、「表示する」を押した人だけが読めます。作品ページでは「ネタバレあり」の扉の向こうに置きます。
          </p>
        )}
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
  const { draft } = usePostDraft("new-post");
  const icon = props.state.settings.composeIcon;
  return (
    <>
      <button
        type="button"
        className={"compose-fab icon-" + icon}
        onClick={() => setOpen(true)}
        aria-label="投稿する"
      >
        <Icon name={icon} size={22} />
        <span>{draft.body || draft.bookId ? "下書き" : "投稿"}</span>
      </button>
      {open && (
        <Modal title="投稿する" onClose={() => setOpen(false)}>
          <PostComposer
            {...props}
            autoFocus
            onDone={() => {
              setOpen(false);
              onPosted?.();
            }}
          />
        </Modal>
      )}
    </>
  );
}

/** Post text with each #tag as a link to the posts that share it. */
export function PostText({ body }: { body: string }) {
  return (
    <p className="post-text">
      {splitTags(body).map((part, index) =>
        part.tag ? (
          <Link
            key={index}
            className="post-tag"
            href={"/search/?q=" + encodeURIComponent("#" + part.tag)}
            onClick={() => requestSearch("#" + part.tag)}
          >
            {part.text}
          </Link>
        ) : (
          part.text
        ),
      )}
    </p>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mine = post.authorId === ME_ID;
  const reported = state.spoilerReports.includes(post.id);
  const hidden = isSpoilerFor(state, post) && !revealed && !shown;
  const liked = state.likedPosts.includes(post.id);
  const wanted = state.wantedPosts.includes(post.id);
  const likes = likeCount(state, post);
  const wants = wantCount(state, post);
  if (!author) return null;
  const profile = profilePath(author.id);
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
          <span className="post-handle">@{author.handle}</span>
          {!mine && !isDatabaseId(author.id) && (
            <small className="demo-tag">見本の読書家</small>
          )}
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
        {(post.spoiler || reported) && (
          <span className="spoiler-tag">
            {post.spoiler ? "ネタバレあり" : "ネタバレの可能性を報告済み"}
          </span>
        )}
        {hidden ? (
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
        {book && (showBook || isReply) && (
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
          <button
            type="button"
            className={liked ? "is-active" : ""}
            aria-pressed={liked}
            onClick={() => actions.toggleLike(post.id)}
          >
            <Icon name="heart" size={16} />
            いいね<span>{likes || ""}</span>
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
          {!mine && (
            <ReportButton
              target={{
                kind: "post",
                id: post.id,
                name: author.name + "さんの投稿",
              }}
            />
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
        {mine && confirmingDelete && (
          <div className="delete-confirm" role="group" aria-label="投稿の削除">
            <span>
              {replies.length
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
