import { bookAuthor, type Named } from "./book-name";
import type { Book, TownState } from "./types";

// 「この本ですか？」(101): a book typed in by hand that is named as one the
// reader already has is shown before it goes in a second time. Only the
// one-book form (BarcodeRegister) reads this, so its code and words stay out
// of what every page reads (book-name.ts, words.ts), as SERIES does.

/** What the question says. */
export const SAME_BOOK = {
  ask: "この本ですか？",
  inLibrary: "ライブラリにあります",
  same: "この本です",
  another: "別の本として登録",
} as const;

/** A title or an author as it may be typed again: width, case and spaces aside. */
const typedAgain = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・]/gu, "");

/**
 * The first of `books` with this title, and this author where both name
 * one. One another reader typed in is never it (bookByIsbn).
 */
export function bookByName<T extends Named & Pick<Book, "theirs">>(
  books: readonly T[],
  title: string,
  author: string,
): T | undefined {
  const named = typedAgain(title);
  if (!named) return undefined;
  const by = typedAgain(author);
  return books.find(
    (book) =>
      !book.theirs &&
      typedAgain(book.title) === named &&
      (!by || !book.author || typedAgain(bookAuthor(book)) === by),
  );
}

/** The reader's own registered book named so (bookByName). */
export const libraryBookByName = (
  state: TownState,
  title: string,
  author: string,
) =>
  bookByName(
    state.books.filter((book) => state.library.includes(book.id)),
    title,
    author,
  );
