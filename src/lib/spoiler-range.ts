import { normalizeIsbn } from "./books";
import { bookById } from "./book-name";
import { hasFinished } from "./reading";
import { volumeName } from "./words";
import type { Post, SpoilerLine, TownState } from "./types";

// ネタバレの範囲 (管理表 22 ①, docs/機能/通報と安全.md「ネタバレの範囲」).
// A writer who marks a spoiler on a book in a series may say how far it
// goes: up to a volume of the line the book is in, or the whole line as it
// stands (kept as its last volume then, as a post cannot spoil what came out
// after it). A reader who finished that far in the same line reads it as it
// is. A mark with no range on a book in a series goes as far as the whole
// series known, the safe side; on a book in no series, a spoiler is about
// its own book and opens for a reader who finished it, as before.

type Lines = Pick<TownState, "books" | "spoilerLines">;

/** The ISBN a book is known by in spoilerLines; null for none. */
export function spoilerIsbnOf(
  state: Pick<TownState, "books">,
  bookId: string | null,
): string | null {
  const isbn = bookId ? bookById(state.books, bookId)?.isbn : undefined;
  return isbn ? normalizeIsbn(isbn) : null;
}

/**
 * The line of the series a book is in: null for none, undefined while it is
 * not read yet (spoiler-lines.ts reads it for the screen).
 */
export function spoilerLineOf(
  state: Lines,
  bookId: string | null,
): SpoilerLine | null | undefined {
  const isbn = spoilerIsbnOf(state, bookId);
  if (!isbn) return null;
  return state.spoilerLines?.[isbn];
}

/** The volume a book is in its line; null when it is in none. */
export function volumeOf(
  line: SpoilerLine,
  isbn: string | null,
): SpoilerLine["volumes"][number] | null {
  return line.volumes.find((volume) => volume.isbn === isbn) ?? null;
}

/**
 * The volumes a writer may say a spoiler goes up to: the book's own and those
 * after it, in order. Empty when the book is in no line, or is its last.
 */
export function rangeChoices(
  line: SpoilerLine | null | undefined,
  isbn: string | null,
): SpoilerLine["volumes"] {
  const own = line ? volumeOf(line, isbn) : null;
  if (!line || !own) return [];
  const after = line.volumes.filter((volume) => volume.number >= own.number);
  return after.length > 1 ? after : [];
}

/**
 * How far into a line the reader has finished: the highest number of a volume
 * they finished, by its ISBN or another book of its work; 0 for none.
 */
export function readThrough(
  state: Pick<TownState, "books" | "finishedBooks">,
  line: SpoilerLine,
): number {
  const finished = new Set(
    state.finishedBooks.flatMap((id) => {
      const isbn = spoilerIsbnOf(state, id);
      return isbn ? [isbn] : [];
    }),
  );
  return line.volumes.reduce(
    (far, volume) =>
      volume.number > far &&
      (finished.has(volume.isbn) || hasFinished(state, volume.bookId))
        ? volume.number
        : far,
    0,
  );
}

/**
 * The volume a writer's spoiler goes up to in its book's line: the one they
 * chose, or, with no range, the last known (the whole series). Null for a
 * book in no line, or while the line is not known.
 */
export function spoilerUntil(
  state: Lines,
  post: Pick<Post, "spoiler" | "spoilerThrough">,
  bookId: string | null,
): SpoilerLine["volumes"][number] | null {
  if (!post.spoiler) return null;
  const line = spoilerLineOf(state, bookId);
  if (!line || !line.volumes.length) return null;
  const through =
    post.spoilerThrough ?? line.volumes[line.volumes.length - 1].number;
  return (
    [...line.volumes].reverse().find((volume) => volume.number <= through) ??
    null
  );
}

/**
 * Whether the reader has read as far as a spoiler goes. The writer's mark on
 * a book in a series goes as far as they said, or with no range the whole
 * series known (a mark from before ranges, or put on afterwards): it opens
 * for one who finished that far in the line. Any other spoiler (a book in
 * no series, three readers' fold) is about its own book. Where lines are
 * read (an account) and this one is not yet, nothing opens; where they are
 * not (the demo), a mark with no range is about its own book.
 */
export function readFarEnough(
  state: Pick<TownState, "books" | "finishedBooks" | "spoilerLines">,
  post: Pick<Post, "spoiler" | "spoilerThrough">,
  bookId: string | null,
): boolean {
  if (!post.spoiler) return hasFinished(state, bookId);
  const ranged = post.spoilerThrough !== undefined;
  const line = state.spoilerLines ? spoilerLineOf(state, bookId) : undefined;
  if (line === undefined)
    return !ranged && !state.spoilerLines && hasFinished(state, bookId);
  if (line === null) return !ranged && hasFinished(state, bookId);
  const until = spoilerUntil(state, post, bookId);
  return until !== null && readThrough(state, line) >= until.number;
}

/**
 * The ISBNs of the books the town's marked spoilers are about (a reply's:
 * the book of the post it answers), each once, for their lines to be read.
 */
export function rangedIsbns(
  state: Pick<TownState, "books" | "posts">,
): string[] {
  const found = new Set<string>();
  for (const post of state.posts) {
    if (!post.spoiler) continue;
    const bookId = post.parentId
      ? (state.posts.find((entry) => entry.id === post.parentId)?.bookId ??
        null)
      : post.bookId;
    const isbn = spoilerIsbnOf(state, bookId);
    if (isbn) found.add(isbn);
  }
  return [...found].sort();
}

/** The words of a spoiler's range, on the writer's side and the reader's. */
export const SPOILER_RANGE = {
  /** Beside the writer's ネタバレあり, once it is on. */
  ask: "どこまでのネタバレ？",
  /** The last volume known: the whole series, as it stands. */
  whole: "全巻",
  /** What the writer chose, under the spines. */
  chosen: (shown: string, whole: boolean) =>
    whole
      ? `全巻（${volumeName(shown)}まで）のネタバレ`
      : `${volumeName(shown)}までのネタバレ`,
  /** A spine's name, for a screen reader. */
  spine: (shown: string) => `${volumeName(shown)}まで`,
  /** The small tag beside a ranged spoiler. */
  tag: (shown: string) => `${volumeName(shown)}までのネタバレ`,
  /** On its cover: when it opens of itself, not only that it is hidden. */
  cover: (shown: string) =>
    `${volumeName(shown)}まで読むと開きます・押すと表示`,
  /** On the cover of a spoiler with no range: its own book. */
  coverBook: "読み終えると開きます・押すと表示",
} as const;
