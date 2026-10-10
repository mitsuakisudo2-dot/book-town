"use client";

import Link from "next/link";
import { useState } from "react";
import { routes } from "../../lib/routes";
import { useTownStore } from "../../lib/store";
import {
  followingIds,
  timeline,
  type TimelineScope,
} from "../../lib/social/selectors";
import { useSocialPersistence, useSocialStore } from "../../lib/social/store";
import { ME_ID } from "../../lib/types";
import { Icon, ReaderAvatar } from "../ui";
import { PostCard } from "./PostCard";
import { FollowReaderButton } from "./ProfileSocial";
import { useSocialUI } from "./SocialContext";
import "./social.css";

const PAGE_SIZE = 20;

export function FeedView() {
  const { state: town } = useTownStore();
  const { social } = useSocialStore();
  const persistence = useSocialPersistence();
  const { compose } = useSocialUI();
  const [scope, setScope] = useState<TimelineScope>("everyone");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const posts = timeline(social, scope);
  const shown = posts.slice(0, limit);
  const followsNobody = followingIds(social, ME_ID).length === 0;

  return (
    <div className="sns-feed">
      <header className="sns-feed-head">
        <div>
          <span className="eyebrow">READERS, IN THEIR OWN WORDS</span>
          <h1>タイムライン</h1>
          <p>本の話も、日常のことも。気になった人の本棚へ。</p>
        </div>
      </header>

      <div className="sns-tabs" role="tablist" aria-label="タイムラインの表示">
        {(
          [
            ["everyone", "みんな"],
            ["following", "フォロー中"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={scope === value}
            onClick={() => {
              setScope(value);
              setLimit(PAGE_SIZE);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="sns-compose-prompt"
        onClick={() => compose()}
      >
        <ReaderAvatar reader={town.me} size={40} />
        <span className="sns-compose-field">
          いま、どんな本と過ごしていますか？
        </span>
        <Icon name="edit" size={18} />
      </button>

      <p className="sns-demo-note">
        <Icon name="leaf" size={14} />
        <span>
          デモの読書家による架空の投稿です。あなたの投稿や反応はこのブラウザにだけ保存され、ほかの人には届きません。並び順は新しい順です。
        </span>
      </p>
      {(persistence === "unavailable" || persistence === "recovered") && (
        <p className="sns-warning" role="status">
          {persistence === "unavailable"
            ? "このブラウザに投稿を保存できません。ページを閉じると、投稿や反応は失われます。"
            : "保存されていた投稿の一部を読み込めなかったため、読み込めた分だけを表示しています。"}
        </p>
      )}

      {scope === "following" && followsNobody && <ReaderSuggestions />}

      <div
        className="sns-list"
        role="feed"
        aria-busy={persistence === "loading"}
      >
        {shown.map((post) => (
          <PostCard key={post.id} post={post} context="feed" />
        ))}
      </div>

      {posts.length > shown.length ? (
        <button
          type="button"
          className="button secondary sns-load-more"
          onClick={() => setLimit(limit + PAGE_SIZE)}
        >
          さらに読み込む
        </button>
      ) : posts.length ? (
        <p className="sns-feed-end">
          <Icon name="leaf" size={16} />
          ここまでが、いまある投稿のすべてです。
          <Link href="/">本の街を歩いてみる</Link>
        </p>
      ) : (
        <div className="sns-empty">
          <p>
            {scope === "following"
              ? "フォローした読書家の投稿が、ここに流れます。"
              : "まだ投稿がありません。"}
          </p>
        </div>
      )}
    </div>
  );
}

/** Real demo readers only; the list ends when they do. */
function ReaderSuggestions() {
  const { state: town } = useTownStore();
  return (
    <section className="sns-suggest" aria-labelledby="sns-suggest-title">
      <h2 id="sns-suggest-title">読書家をフォローする</h2>
      <p>フォローすると、その人の投稿がここに流れます。</p>
      <ul>
        {town.readers.map((reader) => (
          <li key={reader.id}>
            <Link
              href={routes.profile(reader.id)}
              aria-label={`${reader.name}のプロフィール`}
            >
              <ReaderAvatar reader={reader} size={40} />
            </Link>
            <span>
              <Link href={routes.profile(reader.id)}>
                <b>{reader.name}</b>
              </Link>
              <small>{reader.bio}</small>
            </span>
            <FollowReaderButton reader={reader} />
          </li>
        ))}
      </ul>
    </section>
  );
}
