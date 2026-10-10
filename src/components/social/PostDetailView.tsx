"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { routes } from "../../lib/routes";
import { useTownStore } from "../../lib/store";
import {
  ancestorsOf,
  conversationBelow,
  findPost,
  isReview,
} from "../../lib/social/selectors";
import { useSocialPersistence, useSocialStore } from "../../lib/social/store";
import { Icon, ReaderAvatar } from "../ui";
import { PostCard } from "./PostCard";
import { readerOf, useSocialUI } from "./SocialContext";
import "./social.css";

/** Reads `?id=`; must render inside a Suspense boundary for static export. */
export function PostDetailRoute() {
  const id = useSearchParams().get("id") ?? "";
  return <PostDetailView key={id} postId={id} />;
}

export function PostDetailView({ postId }: { postId: string }) {
  const { state: town } = useTownStore();
  const { social } = useSocialStore();
  const persistence = useSocialPersistence();
  const { compose } = useSocialUI();
  // One decision per conversation: opening a spoiler opens the replies that discuss it.
  const [revealed, setRevealed] = useState(false);
  const post = findPost(social, postId);

  if (!post) {
    // Posts written in this browser exist only after storage has been read.
    if (persistence === "loading")
      return <p className="sns-loading">読み込んでいます…</p>;
    return (
      <div className="sns-post-page">
        <div className="sns-empty">
          <Icon name="chat" size={30} />
          <h1>この投稿は見つかりませんでした。</h1>
          <p>削除されたか、このブラウザにはない投稿です。</p>
          <Link className="button secondary" href={routes.feed()}>
            タイムラインへ
          </Link>
        </div>
      </div>
    );
  }

  const author = readerOf(town, post.authorId);
  const ancestors = ancestorsOf(social, post);
  const replies = conversationBelow(social, post);
  const kind = post.reply ? "返信" : isReview(post) ? "感想" : "投稿";

  return (
    <div className="sns-post-page">
      <Link href={routes.feed()} className="back-link">
        <Icon name="back" size={16} />
        タイムラインへ
      </Link>
      <h1 className="sns-page-title">
        {author?.name ?? "読書家"}さんの{kind}
      </h1>

      <div className="sns-thread">
        {ancestors.map((entry) =>
          "missing" in entry ? (
            <p className="sns-tombstone" key={entry.id}>
              この投稿は削除されました。
            </p>
          ) : (
            <PostCard
              key={entry.id}
              post={entry}
              context="thread"
              ancestor
              revealed={revealed}
              onReveal={setRevealed}
            />
          ),
        )}
        <PostCard
          post={post}
          context="thread"
          focused
          revealed={revealed}
          onReveal={setRevealed}
        />
      </div>

      <button
        type="button"
        className="sns-compose-prompt is-reply"
        onClick={() => compose({ replyTo: post.id })}
      >
        <ReaderAvatar reader={town.me} size={36} />
        <span className="sns-compose-field">
          {author?.name ?? "読書家"}さんに返信する
        </span>
        <Icon name="reply" size={18} />
      </button>

      <section aria-labelledby="sns-replies-title">
        <h2 className="sns-section-title" id="sns-replies-title">
          返信 {replies.length}件
        </h2>
        <div className="sns-list">
          {replies.map((reply) => (
            <PostCard
              key={reply.id}
              post={reply}
              context="thread"
              showReplyTo={reply.reply?.parentId !== post.id}
              revealed={revealed}
              onReveal={setRevealed}
            />
          ))}
        </div>
        {!replies.length && (
          <p className="sns-empty">まだ返信はありません。最初のひとことを。</p>
        )}
      </section>
    </div>
  );
}
