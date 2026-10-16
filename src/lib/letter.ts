import { findReader, spoilerViewOf } from "./social";
import {
  FEELING_WORDS,
  LIKE_TAPS_MAX,
  type Post,
  type Reader,
  type TownState,
} from "./types";
import { shownToOthers } from "./visibility";

// The rules of a 便り's card that need no screen: what a tap on いいね does,
// when a long post folds, how tall a covered spoiler looks, and which of the
// writer's feelings stand beside the book.

/**
 * What a tap on いいね does: up to LIKE_TAPS_MAX it adds one more; past that
 * it asks whether to take the いいね back.
 */
export const likeTapOutcome = (taps: number): "tap" | "confirm" =>
  taps >= LIKE_TAPS_MAX ? "confirm" : "tap";

/** A post longer than this many lines folds… */
export const FOLD_OVER = 8;
/** …to this many, with 「続きを読む」. */
export const FOLD_TO = 6;

/** Whether a post of `lines` lines folds on a card. */
export const foldsAt = (lines: number): boolean => lines > FOLD_OVER;

/** Lines measured: a height over the line height, rounded (half a line is a line). */
export const linesOf = (height: number, lineHeight: number): number =>
  lineHeight > 0 ? Math.round(height / lineHeight) : 0;

/**
 * How many bars a covered spoiler shows: about one per line its words would
 * take on a phone, at least one and at most four. The words themselves are
 * not on the page until it is opened.
 */
export function spoilerBars(body: string, perLine = 20): number {
  const length = [...body.trim()].length;
  return Math.min(4, Math.max(1, Math.ceil(length / perLine)));
}

/**
 * Up to two of the writer's own feelings for the book, from their public
 * record of it (the newest). None without one.
 */
export function letterFeelings(
  state: Pick<TownState, "readingRecords">,
  post: Pick<Post, "authorId" | "bookId">,
): string[] {
  if (!post.bookId) return [];
  const record = state.readingRecords
    .filter(
      (entry) =>
        entry.readerId === post.authorId &&
        entry.bookId === post.bookId &&
        shownToOthers(entry.audience),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return (record?.feelings ?? [])
    .slice(0, 2)
    .map((feeling) => FEELING_WORDS[feeling]);
}

/** The post whose page shows this one: a reply lives on its post's page. */
export const postPageOf = (post: Pick<Post, "id" | "parentId">): string =>
  post.parentId ?? post.id;

/**
 * What the page of the post `id` shows (a reply's page is its post's): the
 * post and its writer. Nothing when that post is not in the town, its writer
 * is not known, or the reader chose not to see it (出さない); then nothing
 * leads to that page, as it would only close again.
 */
export function letterPageOf(
  state: TownState,
  id: string,
): { post: Post; author: Reader } | null {
  const found = state.posts.find((entry) => entry.id === id);
  const post = found?.parentId
    ? state.posts.find((entry) => entry.id === found.parentId)
    : found;
  const author = post ? findReader(state, post.authorId) : undefined;
  if (!post || !author || spoilerViewOf(state, post) === "left_out")
    return null;
  return { post, author };
}
