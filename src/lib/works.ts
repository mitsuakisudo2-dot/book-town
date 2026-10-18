import { bookById } from "./book-name";
import type { Book } from "./types";

// A book row is one edition; a work gathers the editions of the same text.
// Reviews and posts will meet at the work, while a shelf shows the edition the
// owner holds. The database places each book in its edition's work (books of
// one ISBN share it, and the operators join editions), and the app reads it as
// workId. A book without one (the demo's, the 見本) is its own work, so workOf
// falls back to the book's own ID.
// Not the search's "work key" (a guess from title and author): that one only
// groups results and is never written here.

export type WorkId = string & { readonly __brand: "WorkId" };

export const workOf = (book: Pick<Book, "id" | "workId">): WorkId =>
  (book.workId ?? book.id) as WorkId;

export const sameWork = (
  a: Pick<Book, "id" | "workId">,
  b: Pick<Book, "id" | "workId">,
) => workOf(a) === workOf(b);

type Placed = Pick<Book, "id" | "workId">;

/** The work of the book with this id among `books`; a book not there is its own. */
export const workOfId = (books: readonly Placed[], id: string): WorkId =>
  workOf(bookById(books, id) ?? { id });
const worksOf = new WeakMap<readonly Placed[], Map<WorkId, Set<string>>>();

/**
 * The books of `bookId`'s work among `books`: the book itself, the other
 * editions of its text, and every reader's registration of any of them (a
 * reader's copy of another's book is in its edition), as the database placed
 * them. What readers say of a book meets there (感想・投稿・POP・ポスター),
 * while a reader's own lists stay with their own book (own-books.ts).
 */
export function booksOfWork(
  books: readonly Placed[],
  bookId: string,
): ReadonlySet<string> {
  let works = worksOf.get(books);
  if (!works) {
    works = new Map();
    for (const book of books) {
      const work = workOf(book);
      const ids = works.get(work);
      if (ids) ids.add(book.id);
      else works.set(work, new Set([book.id]));
    }
    worksOf.set(books, works);
  }
  const book = bookById(books, bookId);
  return (book && works.get(workOf(book))) ?? new Set([bookId]);
}
