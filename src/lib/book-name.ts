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
export const bookAuthor = (book: Pick<Book, "author">): string =>
  authorWords(book.author);

/** A life's years at the end of a catalogue heading: ",1947-", ",1894-1961". */
const YEARS = /\s*,?\s*[0-9]{3,4}\??\s*-\s*([0-9]{3,4}\??)?\s*$/;
/** A catalogue heading: family name, given name, and maybe the years. */
const HEADING = /^([^,\s]+),([^,\s]+)(,[0-9]{3,4}\??-([0-9]{3,4}\??)?)?$/;

/**
 * An author written the way a library catalogue heads it ("King,Stephen,1947-
 * 小尾,芙佐,1932-"), in the shape the bibliographic master names people
 * (docs/09「著者の形」, private.bib_person): no years, a romaji name given
 * name first ("Stephen King", "James P. Hogan"), a Japanese one joined ("小尾芙佐"), people
 * one after another with "、". Anything else is the author as written.
 */
export function authorWords(author: string): string {
  const people = author.trim().split(/\s+/);
  if (!people.every((person) => HEADING.test(person))) return author;
  return people
    .map((person) => {
      const [family, given] = person.replace(YEARS, "").split(",");
      // The catalogue runs a given name and its initial together
      // ("JamesP."); the initial gets its space back.
      return /[A-Za-z]/.test(family + given)
        ? `${given.replace(/([a-z])([A-Z]\.?)$/, "$1 $2")} ${family}`
        : family + given;
    })
    .join("、");
}

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
