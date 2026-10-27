import { normalizeIsbn } from "./books";
import { bookById } from "./book-name";
import { hasFinished } from "./reading";
import { SERIES } from "./series";
import type { Post, SpoilerLine, TownState } from "./types";

// ネタバレの範囲 (管理表 22 ①, docs/機能/通報と安全.md「ネタバレの範囲」).
// A writer who marks a spoiler on a book in a series may say how far it
// goes: up to a volume of the line the book is in, or the whole line as it
// stands (kept as its last volume then, as a post cannot spoil what came out
// after it). A reader who finished that far in the same line reads it as it
// is. A spoiler with no range, or on a book in no series, is about its own
// book: it opens for a reader who finished that book, as before.

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
 * The volume a ranged spoiler goes up to, as its line has it: null for a
 * spoiler with no range, or while its line is not known (none, not read yet).
 */
export function spoilerUntil(
  state: Lines,
  post: Pick<Post, "spoiler" | "spoilerThrough">,
  bookId: string | null,
): SpoilerLine["volumes"][number] | null {
  if (!post.spoiler || post.spoilerThrough === undefined) return null;
  const line = spoilerLineOf(state, bookId);
  if (!line) return null;
  return (
    [...line.volumes]
      .reverse()
      .find((volume) => volume.number <= post.spoilerThrough!) ?? null
  );
}

/**
 * Whether the reader has read as far as a spoiler goes: for one with a range,
 * that far in its book's line (not while the line is not known); for any
 * other, its own book.
 */
export function readFarEnough(
  state: Pick<TownState, "books" | "finishedBooks" | "spoilerLines">,
  post: Pick<Post, "spoiler" | "spoilerThrough">,
  bookId: string | null,
): boolean {
  if (!post.spoiler || post.spoilerThrough === undefined)
    return hasFinished(state, bookId);
  const line = spoilerLineOf(state, bookId);
  if (!line) return false;
  return readThrough(state, line) >= post.spoilerThrough;
}

/**
 * The ISBNs of the books the town's ranged spoilers are about (a reply's:
 * the book of the post it answers), each once, for spoiler-lines to read.
 */
export function rangedIsbns(
  state: Pick<TownState, "books" | "posts">,
): string[] {
  const found = new Set<string>();
  for (const post of state.posts) {
    if (!post.spoiler || post.spoilerThrough === undefined) continue;
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
      ? `全巻（${SERIES.volume(shown)}まで）のネタバレ`
      : `${SERIES.volume(shown)}までのネタバレ`,
  /** A spine's name, for a screen reader. */
  spine: (shown: string) => `${SERIES.volume(shown)}まで`,
  /** The small tag beside a ranged spoiler. */
  tag: (shown: string) => `${SERIES.volume(shown)}までのネタバレ`,
  /** On its cover: when it opens of itself, not only that it is hidden. */
  cover: (shown: string) =>
    `${SERIES.volume(shown)}まで読むと開きます・押すと表示`,
  /** On the cover of a spoiler with no range: its own book. */
  coverBook: "読み終えると開きます・押すと表示",
} as const;
