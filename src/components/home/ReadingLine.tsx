"use client";

import Link from "next/link";
import type { TownState } from "../../lib/types";
import { activeSession, currentBookId } from "../../lib/reading";
import { bookPath } from "../../lib/books";
import { bookById, bookTitle, quotedTitle } from "../../lib/book-name";
import { BookJacket } from "../ui";

/**
 * The book being read, one line under the doors (決定 H:103-105): its jacket
 * (to its page, where its cover is credited), whether it is being read now
 * or was left open, its title, and 記録する. No page number until DB-1.
 */
export function ReadingLine({ state }: { state: TownState }) {
  const running = activeSession(state);
  const bookId = running?.bookId ?? currentBookId(state);
  const book = bookById(state.books, bookId);
  if (!book) return null;
  // Two links side by side, never one inside the other.
  return (
    <div className="home-reading">
      <Link
        href={bookPath(book.id)}
        className="home-reading-book"
        aria-label={`${quotedTitle(book)}の作品ページへ`}
      >
        <BookJacket book={book} sizes="34px" />
      </Link>
      <p className="home-reading-text">
        <small>{running ? "読書中" : "読みかけ"}</small>
        <b>{bookTitle(book)}</b>
      </p>
      <Link
        href="/reading/"
        className="home-reading-go"
        aria-label={`${quotedTitle(book)}の読書を記録する`}
      >
        記録する
      </Link>
    </div>
  );
}
