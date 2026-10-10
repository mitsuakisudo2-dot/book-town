import { ME_ID, type Post, type Reader, type TownState } from "./types";

const time = (post: Post) => Date.parse(post.createdAt) || 0;
const newestFirst = (a: Post, b: Post) => time(b) - time(a);
const oldestFirst = (a: Post, b: Post) => time(a) - time(b);

/** Private reading notes stay on the reading screen only. */
const isPublic = (post: Post) => post.readingMode !== "solo";

/** A post the viewer marked as a possible spoiler is hidden for them like a marked one. */
export const isSpoilerFor = (state: TownState, post: Post): boolean =>
  post.spoiler || state.spoilerReports.includes(post.id);

/** The timeline carries every top-level post except spoilers. */
export const timelinePosts = (state: TownState): Post[] =>
  state.posts
    .filter(
      (post) =>
        post.parentId === null && isPublic(post) && !isSpoilerFor(state, post),
    )
    .sort(newestFirst);

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
