import { activeSession, readersNow } from "./reading";
import { findReader, isSpoilerFor } from "./social";
import { ME_ID, type TownState } from "./types";

export interface Notice {
  id: string;
  readerId: string;
  createdAt: string;
  text: string;
  href: string;
}

const quote = (body: string) =>
  "「" + (body.length > 40 ? body.slice(0, 40) + "…" : body) + "」";

/**
 * Notices are derived from what is actually in this browser's town: replies and reactions
 * to the viewer's posts, posts by followed readers, reviews of books on the wishlist,
 * and readers reading the same book together. Nothing is invented to fill the list.
 */
export function notificationsFor(state: TownState, openedAt = 0): Notice[] {
  const notices: Notice[] = [];
  const name = (id: string) => findReader(state, id)?.name ?? "";
  const title = (id: string | null) =>
    state.books.find((book) => book.id === id)?.title ?? "";
  const mine = new Map(
    state.posts
      .filter((post) => post.authorId === ME_ID && post.parentId === null)
      .map((post) => [post.id, post]),
  );
  for (const post of state.posts) {
    const parent = post.parentId ? mine.get(post.parentId) : undefined;
    if (parent && post.authorId !== ME_ID)
      notices.push({
        id: "reply:" + post.id,
        readerId: post.authorId,
        createdAt: post.createdAt,
        text: `${name(post.authorId)}さんがあなたの投稿に返信しました ${quote(post.body)}`,
        href: parent.bookId ? `/books/${parent.bookId}/` : "/profiles/me/",
      });
  }
  for (const post of mine.values())
    if (post.wants > 0)
      notices.push({
        id: `wants:${post.id}:${post.wants}`,
        readerId: ME_ID,
        createdAt: post.createdAt,
        text: `あなたの感想で、${post.wants}人が『${title(post.bookId)}』を読みたくなりました`,
        href: `/books/${post.bookId}/`,
      });
  const followed = new Set(
    state.shops
      .filter((shop) => state.following.includes(shop.id))
      .map((shop) => shop.ownerId),
  );
  for (const post of state.posts) {
    if (
      post.authorId === ME_ID ||
      post.parentId !== null ||
      post.readingMode === "solo" ||
      isSpoilerFor(state, post)
    )
      continue;
    if (followed.has(post.authorId))
      notices.push({
        id: "follow:" + post.id,
        readerId: post.authorId,
        createdAt: post.createdAt,
        text: `フォロー中の${name(post.authorId)}さんが投稿しました ${quote(post.body)}`,
        href: `/profiles/${post.authorId}/`,
      });
    else if (post.bookId && state.wishlist.includes(post.bookId))
      notices.push({
        id: "wish:" + post.id,
        readerId: post.authorId,
        createdAt: post.createdAt,
        text: `読みたい本『${title(post.bookId)}』に、${name(post.authorId)}さんの感想が届いています`,
        href: `/books/${post.bookId}/`,
      });
  }
  const active = activeSession(state);
  if (active?.mode === "together")
    for (const entry of readersNow(state, openedAt))
      if (entry.readerId !== ME_ID && entry.bookId === active.bookId)
        notices.push({
          id: `reading:${active.id}:${entry.readerId}`,
          readerId: entry.readerId,
          createdAt: active.startedAt,
          text: `${name(entry.readerId)}さんも今『${title(entry.bookId)}』を読んでいます`,
          href: "/reading/",
        });
  return notices
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 40);
}

export const unreadCount = (state: TownState): number =>
  notificationsFor(state).filter(
    (notice) => !state.seenNotifications.includes(notice.id),
  ).length;
