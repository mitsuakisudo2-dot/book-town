import {
  ME_ID,
  OWN_SHOP_ID,
  reviewKey,
  type Post,
  type Reader,
  type ReviewKind,
  type TownState,
} from "./types";
import { REPORT_KIND_WORDS } from "./supabase/reports";
import { hasFinished } from "./reading";
import { bookById } from "./book-name";

const time = (post: Post) => Date.parse(post.createdAt) || 0;
const newestFirst = (a: Post, b: Post) => time(b) - time(a);
const oldestFirst = (a: Post, b: Post) => time(a) - time(b);

/** Private reading notes stay on the reading screen only. */
const isPublic = (post: Post) => post.readingMode !== "solo";

/**
 * How a post reaches this reader. open: as it is. folded: covered, opened with
 * a tap (behind the door on a book page). left_out: not shown at all.
 */
export type SpoilerView = "open" | "folded" | "left_out";

/**
 * The book a post's spoilers are about: its own; for a reply, always the
 * book of the post it answers (a book it recommends is not what it spoils).
 */
export function spoilerBookOf(
  state: Pick<TownState, "posts">,
  post: Post,
): string | null {
  if (!post.parentId) return post.bookId;
  return (
    state.posts.find((entry) => entry.id === post.parentId)?.bookId ?? null
  );
}

/**
 * Decides spoilers, by the writer's mark, the readers' 「ネタバレでは？」 and
 * the reader's 「ネタバレの表示」. A reader who finished the book reads what
 * is said of it as it is: the writer's mark and three readers' folds open
 * for them, whatever they chose (their own 「ネタバレでは？」 still folds it).
 * For everyone else, a post its writer marked is folded from the start,
 * always; one three readers asked about (folded) is folded unless the reader
 * shows everything; one the reader asked about is folded for them. A reader
 * who chose 出さない gets none of these, except their own posts.
 */
export function spoilerViewOf(state: TownState, post: Post): SpoilerView {
  const marked = post.spoiler;
  const askedByMe = state.spoilerReports.includes(post.id);
  const possible = post.folded === true || askedByMe;
  if (!marked && !possible) return "open";
  if (!askedByMe && hasFinished(state, spoilerBookOf(state, post)))
    return "open";
  const mode = state.settings.spoilerDisplay;
  if (mode === "leave_out" && post.authorId !== ME_ID) return "left_out";
  if (marked || askedByMe) return "folded";
  return mode === "show_all" ? "open" : "folded";
}

/** Whether a post reaches this reader at all. */
export const notLeftOut = (state: TownState, post: Post): boolean =>
  spoilerViewOf(state, post) !== "left_out";

/**
 * Whether something is folded by reports for this reader: folded for
 * everyone, held (only ever the reader's own), or reported by the reader
 * themselves, which keeps it folded on their own screen whatever came of it.
 */
export function reviewFoldOf(
  state: TownState,
  kind: ReviewKind,
  id: string,
): "folded" | "held" | "reported" | null {
  if (
    state.myReports.some(
      (entry) => entry.kind === kind && entry.targetId === id,
    )
  )
    return "reported";
  return state.reviewFolds[reviewKey(kind, id)]?.state ?? null;
}

/** What stands before a post or a poster folded by reports. */
export type ReviewCover = "folded" | "reported";

/**
 * What reports put before a post or a poster, for a reader who did not make
 * it: a cover to open first, saying why ("reported": the reader reported it
 * themselves). Its writer never gets one; they read reviewNoteOf instead.
 */
export function reviewCoverOf(
  state: TownState,
  kind: "post" | "poster",
  id: string,
  authorId: string,
): ReviewCover | null {
  if (authorId === ME_ID) return null;
  const fold = reviewFoldOf(state, kind, id);
  return fold === null ? null : fold === "reported" ? "reported" : "folded";
}

/** What the writer reads under their own post or poster folded or held by reports. */
export function reviewNoteOf(
  state: TownState,
  kind: "post" | "poster",
  id: string,
  authorId: string,
): "folded" | "held" | null {
  if (authorId !== ME_ID) return null;
  const fold = reviewFoldOf(state, kind, id);
  return fold === "folded" || fold === "held" ? fold : null;
}

/** The words on the cover, before anything of the post or the poster. */
export const reviewCoverWords = (
  kind: "post" | "poster",
  cover: ReviewCover,
): string =>
  cover === "reported"
    ? `あなたが通報した${REPORT_KIND_WORDS[kind]}です`
    : "通報があったため、運営が確かめるまで、たたんでいます";

/** The words of the writer's note: folded for others and not gone, or held until checked. */
export const reviewNoteWords = (
  kind: "post" | "poster",
  note: "folded" | "held",
): string =>
  note === "held"
    ? "運営が確かめるまで、ほかの人からは見えないようにしています。問題がなければ、元に戻ります。"
    : `通報があったため、運営が確かめるまで、みんなの画面ではたたんで表示しています。${REPORT_KIND_WORDS[kind]}は消えていません。`;

/**
 * Whether a shop's or a person's own words (an introduction, a bio) are
 * folded by reports, for everyone but their owner. Names, shelves, POPs and
 * posts stay as they are; each has its own report button.
 */
export const wordsFolded = (
  state: Pick<TownState, "reviewFolds">,
  kind: "shop" | "profile",
  id: string,
): boolean =>
  id !== ME_ID &&
  id !== OWN_SHOP_ID &&
  state.reviewFolds[reviewKey(kind, id)]?.state === "folded";

/** The timeline carries every public top-level post; spoilers arrive covered until shown. */
export const timelinePosts = (state: TownState): Post[] =>
  state.posts
    .filter(
      (post) =>
        post.parentId === null && isPublic(post) && notLeftOut(state, post),
    )
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
      const book = bookById(state.books, item?.bookId);
      return owner && item && book && owner.id !== ME_ID
        ? [{ shop, owner, pop: item.pop.trim(), book }]
        : [];
    })
    .slice(0, limit);
}

/**
 * Reviews are top-level posts with this book; spoilers are kept apart, behind
 * the door. A review folded by reports stays in its place, folded there.
 * `leftOut`: the reader's setting kept some out, which the page says once.
 */
export function bookReviews(state: TownState, bookId: string) {
  const reviews = state.posts
    .filter(
      (post) =>
        post.parentId === null && post.bookId === bookId && isPublic(post),
    )
    .sort(newestFirst);
  const view = (post: Post) => spoilerViewOf(state, post);
  return {
    open: reviews.filter((post) => view(post) === "open"),
    spoilers: reviews.filter((post) => view(post) === "folded"),
    leftOut: reviews.some((post) => view(post) === "left_out"),
  };
}

export const repliesOf = (state: TownState, postId: string): Post[] =>
  state.posts
    .filter((post) => post.parentId === postId && notLeftOut(state, post))
    .sort(oldestFirst);

/**
 * Whether a post has any reply at all, shown or left out by the reader's
 * settings: deleting the post deletes every one of them, for everyone.
 */
export const hasReplies = (state: TownState, postId: string): boolean =>
  state.posts.some((post) => post.parentId === postId);

export const readerPosts = (state: TownState, readerId: string): Post[] =>
  timelinePosts(state).filter((post) => post.authorId === readerId);

export const findReader = (
  state: TownState,
  readerId: string,
): Reader | undefined =>
  readerId === ME_ID
    ? state.me
    : state.readers.find((reader) => reader.id === readerId);

/** How many times the viewer pressed いいね on a post; 0 when not liked. */
export const tapsOf = (state: TownState, postId: string): number =>
  state.likedPosts.includes(postId) ? (state.likeTaps[postId] ?? 1) : 0;

/**
 * On the writer's own post: how many others liked it, and how many times they
 * pressed in all. Only the writer is ever shown these.
 */
export function likesReceived(post: Post): { people: number; taps: number } {
  if (!post.likers) return { people: post.likes, taps: post.likes };
  return {
    people: post.likers.length,
    taps: post.likers.reduce((sum, liker) => sum + liker.taps, 0),
  };
}

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
