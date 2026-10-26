import { bookAuthor, type Named } from "./book-name";
import type { Book, NewBook, TownState } from "./types";

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

/** The scanner's ［手で入力］: the book found first, the form behind it. */
export const FIND_BOOK = {
  label: "登録する本を探す",
  placeholder: "書名・著者・ISBN",
  found: "見つかった本",
  notFound: "見つからないときは",
  /** Under the box while nothing is typed: the form at once. */
  byHand: "書名やISBNを入れて登録",
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

/**
 * A found book as the reader's own registers it: by what was found, its
 * ISBN deciding the edition, never pointing at another's book.
 */
export const foundAsNew = (book: Book): NewBook => ({
  title: book.title,
  author: book.author,
  ...(book.isbn ? { isbn: book.isbn } : {}),
});
