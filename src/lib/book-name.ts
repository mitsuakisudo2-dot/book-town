import type { Book } from "./types";

// How a book is named on screen, in one place. Every screen reads a book's
// title and author through these, and finds a book by its ID or ISBN with
// bookById / bookByIsbn, so that when the name comes from somewhere else
// (the edition's bibliographic record, a volume number, more than one
// author), only this file changes. tests/book-name.test.ts keeps screens
// from reading `.title` / `.author` or quoting 『』 by hand again.
//
// Data that is saved or searched (registering, editing, the search index,
// the database rows) works on the book's own fields, not on these.

/** What a name is made from: a book, or the bits of one a draft carries. */
export type Named = Pick<Book, "title" | "author">;

/** The book's title as a reader sees it. */
export const bookTitle = (book: Pick<Book, "title">): string => book.title;

/** The title in 『』, as it sits inside a sentence. */
export const quotedTitle = (book: Pick<Book, "title">): string =>
  quote(bookTitle(book));

/** A title already worded, in 『』 (for a title kept as text, not a book). */
export const quote = (title: string): string => `『${title}』`;

/** The book's author as a reader sees it. */
export const bookAuthor = (book: Pick<Book, "author">): string => book.author;

/** The book with this ID, if the town has it. */
export function bookById<T extends Pick<Book, "id">>(
  books: readonly T[],
  id: string | null | undefined,
): T | undefined {
  if (!id) return undefined;
  return books.find((book) => book.id === id);
}

/** The books with these IDs, in order, leaving out any the town lacks. */
export const booksById = <T extends Pick<Book, "id">>(
  books: readonly T[],
  ids: readonly (string | null | undefined)[],
): T[] =>
  ids
    .map((id) => bookById(books, id))
    .filter((book): book is T => Boolean(book));

/** A book with this ISBN, if the town has one. */
export function bookByIsbn<T extends Pick<Book, "isbn">>(
  books: readonly T[],
  isbn: string | null | undefined,
): T | undefined {
  if (!isbn) return undefined;
  return books.find((book) => book.isbn === isbn);
}

/** The title of the book with this ID, if the town has it. */
export const titleById = (
  books: readonly Book[],
  id: string | null | undefined,
): string | undefined => {
  const book = bookById(books, id);
  return book && bookTitle(book);
};
