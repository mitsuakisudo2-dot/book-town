import { ME_ID, type Post, type Reader, type TownState } from "./types";

const time = (post: Post) => Date.parse(post.createdAt) || 0;
const newestFirst = (a: Post, b: Post) => time(b) - time(a);
const oldestFirst = (a: Post, b: Post) => time(a) - time(b);

/** Private reading notes stay on the reading screen only. */
const isPublic = (post: Post) => post.readingMode !== "solo";

/** A post the viewer marked as a possible spoiler is hidden for them like a marked one. */
export const isSpoilerFor = (state: TownState, post: Post): boolean =>
  post.spoiler || state.spoilerReports.includes(post.id);

/** The timeline carries every public top-level post; spoilers arrive covered until shown. */
export const timelinePosts = (state: TownState): Post[] =>
  state.posts
    .filter((post) => post.parentId === null && isPublic(post))
    .sort(newestFirst);

/** Following currently means following a shop; its owner's public posts come along. */
export function followedTimelinePosts(state: TownState): Post[] {
  const owners = new Set(
    state.shops
      .filter((shop) => state.following.includes(shop.id))
      .map((shop) => shop.ownerId),
  );
  return timelinePosts(state).filter(
    (post) => post.authorId === ME_ID || owners.has(post.authorId),
  );
}

/**
 * Owners to follow first: shops with a POP to read, in the town's own order.
 * Never ranked by followers or likes.
 */
export function ownersToFollow(state: TownState, limit = 3) {
  return state.shops
    .filter((shop) => !state.following.includes(shop.id))
    .flatMap((shop) => {
      const owner = findReader(state, shop.ownerId);
      const item = shop.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) => shelf.items)
        .find((entry) => entry.pop.trim());
      const book = state.books.find((entry) => entry.id === item?.bookId);
      return owner && item && book && owner.id !== ME_ID
        ? [{ shop, owner, pop: item.pop.trim(), book }]
        : [];
    })
    .slice(0, limit);
}

/** Reviews are top-level posts with this book; spoilers are kept apart, behind the door. */
export function bookReviews(state: TownState, bookId: string) {
  const reviews = state.posts
    .filter(
      (post) =>
        post.parentId === null && post.bookId === bookId && isPublic(post),
    )
    .sort(newestFirst);
  return {
    open: reviews.filter((post) => !isSpoilerFor(state, post)),
    spoilers: reviews.filter((post) => isSpoilerFor(state, post)),
  };
}

export const repliesOf = (state: TownState, postId: string): Post[] =>
  state.posts.filter((post) => post.parentId === postId).sort(oldestFirst);

export const readerPosts = (state: TownState, readerId: string): Post[] =>
  timelinePosts(state).filter((post) => post.authorId === readerId);

export const findReader = (
  state: TownState,
  readerId: string,
): Reader | undefined =>
  readerId === ME_ID
    ? state.me
    : state.readers.find((reader) => reader.id === readerId);

export const likeCount = (state: TownState, post: Post): number =>
  post.likes + (state.likedPosts.includes(post.id) ? 1 : 0);

export const wantCount = (state: TownState, post: Post): number =>
  post.wants + (state.wantedPosts.includes(post.id) ? 1 : 0);

/** Whose words made the viewer want this book, oldest first. */
export const wantSources = (state: TownState, bookId: string): Post[] =>
  state.posts
    .filter(
      (post) => post.bookId === bookId && state.wantedPosts.includes(post.id),
    )
    .sort(oldestFirst);

/** Fixed to Japan time so the static render and the browser always agree. */
const postTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatPostTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : postTime.format(date);
}
