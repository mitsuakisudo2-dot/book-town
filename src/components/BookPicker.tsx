"use client";

import { useId, useState } from "react";
import type { Book } from "../lib/types";
import { BookJacket, Icon } from "./ui";

export function matchBooks(books: Book[], query: string): Book[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return books.filter((book) =>
    `${book.title} ${book.author} ${book.genre} ${book.isbn ?? ""}`
      .toLocaleLowerCase()
      .includes(term),
  );
}

/** Search the catalog by title, author, genre or ISBN, and pick one book. */
export function BookPicker({
  books,
  value,
  onChange,
  label,
  suggestions = [],
  suggestionLabel = "最近の本",
}: {
  books: Book[];
  value: string | null;
  onChange: (bookId: string | null) => void;
  label: string;
  /** Shown before the reader types, e.g. the book being read or the wishlist. */
  suggestions?: string[];
  suggestionLabel?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
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
  const results = matchBooks(books, query).slice(0, 6);
  const suggested = suggestions
    .map((bookId) => books.find((book) => book.id === bookId))
    .filter((book): book is Book => Boolean(book))
    .slice(0, 6);
  const shown = query.trim() ? results : suggested;
  return (
    <div className="book-picker">
      <label className="picker-search" htmlFor={id}>
        <Icon name="search" size={15} />
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="search"
          value={query}
          placeholder={label + "（タイトル・著者・ISBN）"}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              onChange(results[0].id);
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
      {query.trim() && !results.length && (
        <p className="picker-caption">
          「{query.trim()}
          」に合う本は見つかりませんでした。プロフィールの「本を登録」から追加できます。
        </p>
      )}
    </div>
  );
}
