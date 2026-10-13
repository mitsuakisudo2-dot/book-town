"use client";

import { useId, useState } from "react";
import type { Book } from "../lib/types";
import { enterPressed, useBookSearch } from "../lib/search/use-book-search";
import { BookJacket, Icon } from "./ui";

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
  // The reader's own books come first among equals.
  const results = useBookSearch(books, query, { own: suggestions, limit: 6 });
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
  const searching = query.trim() !== "";
  const shown = searching
    ? results.found.map((match) => match.book)
    : suggested;
  const choice = (book: Book) => (
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
  );
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
            if (!enterPressed(event)) return;
            // Enter in the search never sends the form around it (a post).
            event.preventDefault();
            // It takes the first book only when it is surely the one meant: a
            // title that begins so, or the one book found.
            const sure = results.sure();
            if (sure) {
              onChange(sure.id);
              setQuery("");
            }
          }}
        />
      </label>
      {!searching && suggested.length > 0 && (
        <p className="picker-caption">{suggestionLabel}</p>
      )}
      {shown.length > 0 && (
        <ul className="picker-results" aria-label={label + "の候補"}>
          {shown.map(choice)}
        </ul>
      )}
      {searching && results.settled && !results.found.length && (
        <p className="picker-caption">
          {results.near.length
            ? "ぴったり合う本はありませんでした。"
            : `「${query.trim()}」に合う本は見つかりませんでした。プロフィールの「本を登録」から追加できます。`}
        </p>
      )}
      {searching && results.near.length > 0 && (
        <>
          <p className="search-near" id={id + "-near"}>
            {results.nearHeading}
          </p>
          <ul className="picker-results" aria-labelledby={id + "-near"}>
            {results.near.map(({ book }) => choice(book))}
          </ul>
        </>
      )}
    </div>
  );
}
