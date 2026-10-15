import { readingFeed } from "./reading";
import { findReader, reviewCoverOf, spoilerViewOf } from "./social";
import { ME_ID, type Book, type Post, type TownState } from "./types";
import { workOf, type WorkId } from "./works";

// 読みながらのひとこと, Live (PR 2b; 決定 H:114-119): what other readers
// wrote while reading together, in a box of its own on ホーム. Its lines are
// chosen once with the rest of the pane; new ones come only from polling
// (arrivals.ts) and go in at the box's top while it is on the screen. The
// box keeps its height, so nothing around it moves.

const DAY = 24 * 60 * 60 * 1000;

/** How far back Live looks. */
export const LIVE_DAYS = 7;
/** The most lines it holds: the box opened by 「前のひとことも見る」. */
export const LIVE_MAX = 6;
/** The fewest it is drawn with; below it, there is no band at all. */
export const LIVE_MIN = 3;
/** The lines the box shows closed. */
export const LIVE_SHOWN = 3;
/** One line's height in the box, in px. */
export const LIVE_ROW = 104;

const time = (post: Post) => Date.parse(post.createdAt) || 0;

/**
 * Whether a post is a line of Live for this reader at `now`: another
 * reader's memo written while reading together, top-level, about a book the
 * town knows, by a writer it knows, from the last LIVE_DAYS days, reaching
 * this reader (not left out by their 「ネタバレの表示」) and with no report
 * cover. A spoiler stays a line: it is shown in the spoiler box. What is not
 * a line stays where it was, a card among the 便り.
 */
export const isLiveLine = (
  state: TownState,
  post: Post,
  now: number,
): boolean =>
  post.parentId === null &&
  post.readingMode === "together" &&
  post.authorId !== ME_ID &&
  post.bookId !== null &&
  time(post) >= now - LIVE_DAYS * DAY &&
  state.books.some((book) => book.id === post.bookId) &&
  findReader(state, post.authorId) !== undefined &&
  spoilerViewOf(state, post) !== "left_out" &&
  reviewCoverOf(state, "post", post.id, post.authorId) === null;

/**
 * The lines of Live at `now`: the newest LIVE_MAX, newest first. Null below
 * LIVE_MIN: no band, no empty frame and no number.
 */
export function liveLines(state: TownState, now: number): Post[] | null {
  const lines = readingFeed(state)
    .filter((post) => isLiveLine(state, post, now))
    .slice(0, LIVE_MAX);
  return lines.length >= LIVE_MIN ? lines : null;
}

/** The ids Live holds at `now`: ホーム's 便り leave these out. */
export const liveIds = (state: TownState, now: number): Set<string> =>
  new Set(liveLines(state, now)?.map((post) => post.id) ?? []);

/**
 * Every memo written while reading together that the town has: what Live
 * knew when it was drawn. A line not among them came since (polling).
 */
export const togetherIds = (state: TownState): Set<string> =>
  new Set(
    state.posts
      .filter((post) => post.readingMode === "together")
      .map((post) => post.id),
  );

/** The works of these editions, as far as the town knows them. */
function worksOf(books: readonly Book[], ids: Iterable<string>): Set<WorkId> {
  const byId = new Map(books.map((book) => [book.id, book]));
  const works = new Set<WorkId>();
  for (const id of ids) works.add(workOf(byId.get(id) ?? { id }));
  return works;
}

type GuardState = Pick<
  TownState,
  "books" | "readingSessions" | "finishedBooks" | "wishlist" | "library"
>;

/**
 * The works whose lines wait behind the stand-in (けにー 2026-10-15): those
 * on the reader's shelves and not finished, being read (a reading session),
 * wanted (読みたい) or registered (ライブラリ). Until DB-1 knows the page the
 * reader is on, the whole book waits (仮); then only the lines past it.
 * 積読 comes in with the library's shelves. Any edition finished frees the
 * work, and any edition shelved holds it.
 */
export function guardedWorks(state: GuardState): Set<WorkId> {
  const shelved = worksOf(state.books, [
    ...state.wishlist,
    ...state.library,
    ...state.readingSessions.flatMap((session) =>
      session.bookId === null ? [] : [session.bookId],
    ),
  ]);
  for (const work of worksOf(state.books, state.finishedBooks))
    shelved.delete(work);
  return shelved;
}

/** Whether a line waits behind the stand-in. */
export function isGuarded(
  state: GuardState,
  post: Pick<Post, "bookId">,
): boolean {
  if (post.bookId === null) return false;
  const [work] = worksOf(state.books, [post.bookId]);
  return guardedWorks(state).has(work);
}

/**
 * The lines of the box as they are now: those that came in at its top
 * (`entered`, newest first), then those it was drawn with (`held`), each
 * read again from `town` and put through the same test, at most LIVE_MAX.
 * A line that fails it now (deleted, reported, left out) is dropped.
 */
export function liveRows(
  town: TownState,
  held: string[],
  entered: string[],
  at: number,
): Post[] {
  const rows: Post[] = [];
  for (const id of new Set([...entered, ...held])) {
    const post = town.posts.find((entry) => entry.id === id);
    if (post && isLiveLine(town, post, at)) rows.push(post);
    if (rows.length === LIVE_MAX) break;
  }
  return rows;
}

/**
 * The lines that came since the box was drawn and are not in it yet,
 * newest first: memos that were not in the town then (`known`), in `town`
 * now (the town with what polling brought), and not read back by the
 * reader's asking (an older page, one by its id). They go in at the top,
 * all at once (liveRows keeps the newest six), so the newest stay on top.
 */
export function newLines(
  town: TownState,
  known: ReadonlySet<string>,
  inBox: ReadonlySet<string>,
  at: number,
): Post[] {
  return town.posts
    .filter(
      (post) =>
        !known.has(post.id) &&
        !inBox.has(post.id) &&
        !town.readAfter?.[post.id] &&
        isLiveLine(town, post, at),
    )
    .sort((a, b) => time(b) - time(a));
}
