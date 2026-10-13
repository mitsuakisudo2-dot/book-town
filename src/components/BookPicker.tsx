"use client";

import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import type { Book } from "../lib/types";
import { prepareSearch, searchBooks, strongMatch } from "../lib/search";
import { BookJacket, Icon } from "./ui";

/** Books for a query, best first. Kept for pickers not yet moved to searchBooks. */
export const matchBooks = (books: Book[], query: string): Book[] =>
  searchBooks(books, query).map((match) => match.book);

/** Search the catalog by title, author, genre or ISBN, and pick one book. */
export function BookPicker({
  books,
  value,
  onChange,
  label,
  suggestions = [],
  suggestionLabel = "最近の本",
  autoFocus = false,
}: {
  books: Book[];
  value: string | null;
  onChange: (bookId: string | null) => void;
  label: string;
  /** Shown before the reader types, e.g. the book being read or the wishlist. */
  suggestions?: string[];
  suggestionLabel?: string;
  /** For a picker opened by a button: the reader is about to type a title. */
  autoFocus?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  // Typing stays quick while a long list is searched.
  useEffect(() => prepareSearch(books), [books]);
  const typed = useDeferredValue(query);
  // The reader's own books come first among equals.
  const ownKey = suggestions.join(" ");
  const own = useMemo(() => new Set(ownKey.split(" ")), [ownKey]);
  const results = useMemo(
    () => searchBooks(books, typed, { own, limit: 6 }),
    [books, typed, own],
  );
  const selected = value ? books.find((book) => book.id === value) : undefined;
  if (selected)
    return (
      <div className="picker-chosen">
        <BookJacket book={selected} className="picker-jacket" />
        <span>
          <b>{selected.title}</b>
          <small>{selected.author}</small>
        </span>
        <button
          type="button"
          className="picker-clear"
          onClick={() => onChange(null)}
          aria-label={selected.title + "を外す"}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    );
  const suggested = suggestions
    .map((bookId) => books.find((book) => book.id === bookId))
    .filter((book): book is Book => Boolean(book))
    .slice(0, 6);
  const shown = query.trim() ? results.map((match) => match.book) : suggested;
  return (
    <div className="book-picker">
      <label className="picker-search" htmlFor={id}>
        <Icon name="search" size={15} />
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="search"
          value={query}
          placeholder="題名・著者・ISBNで探す"
          autoComplete="off"
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter that confirms a kana conversion is the keyboard's own.
            if (
              event.key !== "Enter" ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            // Enter in the search never sends the form around it (a post).
            event.preventDefault();
            // It takes the first book only when it is surely the one meant: a
            // title that begins so, or the one book found.
            const now = searchBooks(books, query, { own, limit: 2 });
            const sure =
              now[0] &&
              (strongMatch(now[0]) || (now.length === 1 && !now[0].near));
            if (sure) {
              onChange(now[0].book.id);
              setQuery("");
            }
          }}
        />
      </label>
      {!query.trim() && suggested.length > 0 && (
        <p className="picker-caption">{suggestionLabel}</p>
      )}
      {shown.length > 0 && (
        <ul className="picker-results" aria-label={label + "の候補"}>
          {shown.map((book) => (
            <li key={book.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(book.id);
                  setQuery("");
                }}
              >
                <BookJacket book={book} className="picker-jacket" />
                <span>
                  <b>{book.title}</b>
                  <small>
                    {book.author}・{book.genre}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && typed === query && !results.length && (
        <p className="picker-caption">
          「{query.trim()}
          」に合う本は見つかりませんでした。プロフィールの「本を登録」から追加できます。
        </p>
      )}
    </div>
  );
}
