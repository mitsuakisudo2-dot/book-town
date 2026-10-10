"use client";

import { useState } from "react";
import {
  followerIds,
  followingIds,
  isFollowing,
  postsBy,
} from "../../lib/social/selectors";
import { useSocialStore } from "../../lib/social/store";
import { ME_ID, type Reader } from "../../lib/types";
import { Icon } from "../ui";
import { PostCard } from "./PostCard";
import { useSocialUI } from "./SocialContext";
import "./social.css";

/** Following a person (their posts) is separate from following their shop (its shelves). */
export function FollowReaderButton({ reader }: { reader: Reader }) {
  const { social, actions } = useSocialStore();
  const { notify } = useSocialUI();
  if (reader.id === ME_ID) return null;
  const following = isFollowing(social, ME_ID, reader.id);
  return (
    <button
      type="button"
      className={"sns-follow" + (following ? " is-following" : "")}
      aria-pressed={following}
      aria-label={
        following
          ? `${reader.name}さんのフォローを解除`
          : `${reader.name}さんをフォロー`
      }
      onClick={() => {
        if (actions.toggleFollowReader(reader.id))
          notify(
            following
              ? `${reader.name}さんのフォローを解除しました`
              : `${reader.name}さんをフォローしました。投稿がタイムラインの「フォロー中」に流れます`,
          );
      }}
    >
      {following ? "フォロー中" : "フォロー"}
    </button>
  );
}

export function ReaderSocialSummary({ reader }: { reader: Reader }) {
  const { social } = useSocialStore();
  return (
    <p className="sns-reader-stats">
      <span>
        <b>{postsBy(social, reader.id).length}</b> 投稿
      </span>
      <span>
        <b>{followingIds(social, reader.id).length}</b> フォロー
      </span>
      <span>
        <b>{followerIds(social, reader.id).length}</b> フォロワー
      </span>
    </p>
  );
}

export function ProfilePosts({ reader }: { reader: Reader }) {
  const { social } = useSocialStore();
  const { compose } = useSocialUI();
  const [filter, setFilter] = useState<"posts" | "reviews">("posts");
  const isSelf = reader.id === ME_ID;
  const all = postsBy(social, reader.id);
  const reviews = postsBy(social, reader.id, "reviews");
  const shown = filter === "posts" ? all : reviews;
  return (
    <section
      className="sns-profile-posts"
      aria-labelledby="profile-posts-title"
    >
      <div className="profile-section-heading">
        <div>
          <p className="profile-eyebrow">WORDS AND DAYS</p>
          <h2 id="profile-posts-title">
            {isSelf ? "わたしの投稿" : `${reader.name}さんの投稿`}
          </h2>
        </div>
        {isSelf && (
          <button
            type="button"
            className="button secondary"
            onClick={() => compose()}
          >
            <Icon name="edit" size={15} /> 投稿する
          </button>
        )}
      </div>
      <div
        className="sns-tabs is-inline"
        role="tablist"
        aria-label="投稿の種類"
      >
        <button
          type="button"
          role="tab"
          aria-selected={filter === "posts"}
          onClick={() => setFilter("posts")}
        >
          投稿 <span>{all.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "reviews"}
          onClick={() => setFilter("reviews")}
        >
          感想 <span>{reviews.length}</span>
        </button>
      </div>
      <div className="sns-list">
        {shown.map((post) => (
          <PostCard key={post.id} post={post} context="feed" />
        ))}
      </div>
      {!shown.length && (
        <div className="sns-empty">
          <p>
            {filter === "reviews"
              ? "感想として公開した投稿は、まだありません。"
              : isSelf
                ? "まだ投稿はありません。本のことでも、日常のことでも。"
                : "まだ投稿はありません。"}
          </p>
        </div>
      )}
    </section>
  );
}
