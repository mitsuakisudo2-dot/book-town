import type { Book } from "./types";

// A book row is one edition; a work gathers the editions of the same text.
// Reviews and posts will meet at the work, while a shelf shows the edition the
// owner holds. Until the operators join two editions, each book is its own
// work, so workOf falls back to the book's own ID.
// Not the search's "work key" (a guess from title and author): that one only
// groups results and is never written here.

export type WorkId = string & { readonly __brand: "WorkId" };

export const workOf = (book: Pick<Book, "id" | "workId">): WorkId =>
  (book.workId ?? book.id) as WorkId;

export const sameWork = (
  a: Pick<Book, "id" | "workId">,
  b: Pick<Book, "id" | "workId">,
) => workOf(a) === workOf(b);
