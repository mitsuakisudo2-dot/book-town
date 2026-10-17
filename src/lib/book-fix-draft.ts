"use client";

import { BOOK_TEXT_MAX } from "./books";
import type { Book } from "./types";
import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import {
  ownerKeyPattern,
  readOverSaved,
  unchanged,
  type OverSaved,
} from "./shop-draft";

// A book of the reader's being fixed (its title, author and ISBN: a book held
// back, docs/09「食い違いの判定と保留」), kept in this browser until the town
// has it saved or the reader throws it away. Keyed by owner and book
// ("<owner>/<book id>").

export const BOOK_FIX_DRAFT_KEY = "book-town-book-fix-drafts-v1";

/** As long as an ISBN is typed, with its hyphens and spaces. */
export const ISBN_FIELD_MAX_LENGTH = 20;

export type BookFixWork = { title: string; author: string; isbn: string };

/** The book's own fields as the form starts from them (what its reader typed). */
export const bookFixOf = (
  book: Pick<Book, "title" | "author" | "isbn">,
): BookFixWork => ({
  title: book.title,
  author: book.author,
  isbn: book.isbn ?? "",
});

export const sameBookFix = (a: BookFixWork, b: BookFixWork) =>
  a.title === b.title && a.author === b.author && a.isbn === b.isbn;

/** Whether letting the work go would lose words the reader wrote. */
export const bookFixLosesWords = (work: BookFixWork, saved: BookFixWork) =>
  (["title", "author", "isbn"] as const).some(
    (field) => work[field].trim() !== "" && work[field] !== saved[field],
  );

/** The book's words read back from storage, if they still fit the form. */
export function readBookFixWork(value: unknown): BookFixWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<BookFixWork>;
  if (
    !keptText(work.title, BOOK_TEXT_MAX) ||
    !keptText(work.author, BOOK_TEXT_MAX) ||
    !keptText(work.isbn, ISBN_FIELD_MAX_LENGTH)
  )
    return null;
  return { title: work.title, author: work.author, isbn: work.isbn };
}

export const bookFixDraftOptions: KeptDraftOptions<OverSaved<BookFixWork>> = {
  storageKey: BOOK_FIX_DRAFT_KEY,
  keyPattern: ownerKeyPattern(1),
  read: (value) => readOverSaved(value, readBookFixWork),
  isEmpty: unchanged,
  limit: 8,
};
export const bookFixDraftStore = createKeptDraftStore(bookFixDraftOptions);
