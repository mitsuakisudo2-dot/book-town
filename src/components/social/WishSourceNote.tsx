"use client";

import Link from "next/link";
import { routes } from "../../lib/routes";
import { useTownStore } from "../../lib/store";
import { findPost, isReview } from "../../lib/social/selectors";
import { useSocialStore } from "../../lib/social/store";
import { Icon } from "../ui";
import { readerOf } from "./SocialContext";
import "./social.css";

/** Private: shown only in the viewer's own wishlist. Says where, not why. */
export function WishSourceNote({ bookId }: { bookId: string }) {
  const { state: town } = useTownStore();
  const { social } = useSocialStore();
  const source = town.wishSources[bookId];
  if (!source || !town.wishlist.includes(bookId)) return null;
  const post = findPost(social, source.postId);
  if (!post)
    return (
      <span className="sns-wish-source">
        <Icon name="chat" size={13} />
        きっかけの投稿は削除されました
      </span>
    );
  const author = readerOf(town, post.authorId);
  const kind = post.reply ? "返信" : isReview(post) ? "感想" : "投稿";
  return (
    <Link className="sns-wish-source" href={routes.post(post.id)}>
      <Icon name="chat" size={13} />
      {author?.name ?? "読書家"}さんの{kind}から
    </Link>
  );
}
