"use client";

import { useId, useRef, useState } from "react";
import type { Book } from "../lib/types";
import { useCoarsePointer, useFocusFieldOnShow } from "../lib/coarse-pointer";
import { enterPressed } from "../lib/keys";
import { useBookSearch } from "../lib/search/use-book-search";
import { BookJacket, Icon, useInWritingSheet } from "./ui";
import { bookAuthor, bookById, booksById, bookTitle } from "../lib/book-name";

/** Search the catalog by title, author, genre or ISBN, and pick one book. */
export function BookPicker({
  books,
  genreFinds,
  value,
  onChange,
  label,
  suggestions = [],
  suggestionLabel = "最近の本",
  autoFocus = false,
}: {
  books: Book[];
  /**
   * The books a genre alone finds (booksBeforeSearch): never one another
   * reader only typed in, which waits for its title, author or ISBN.
   */
  genreFinds?: Book[];
  value: string | null;
  onChange: (bookId: string | null) => void;
  label: string;
  /** Shown before the reader types, e.g. the book being read or the wishlist. */
  suggestions?: string[];
  suggestionLabel?: string;
  /**
   * For a picker opened by a button: the reader is about to type a title.
   * With a mouse the search takes the focus, as it does in a writing screen;
   * elsewhere on a touch screen it waits for a tap, and the focus goes to
   * the picker itself (focusField).
   */
  autoFocus?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const picker = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useFocusFieldOnShow(search, { instead: picker, when: autoFocus });
  // Only a picker holding the focus for its search is a named group; any
  // other is named by its search alone.
  const finger = useCoarsePointer();
  const writing = useInWritingSheet();
  const standsIn = finger && autoFocus && !writing;
  // The reader's own books come first among equals.
  const results = useBookSearch(books, query, {
    own: suggestions,
    limit: 6,
    genreFinds,
  });
  const selected = value ? bookById(books, value) : undefined;
  if (selected)
    return (
      <div className="picker-chosen">
        <BookJacket book={selected} className="picker-jacket" />
        <span>
          <b>{bookTitle(selected)}</b>
          <small>{bookAuthor(selected)}</small>
        </span>
        <button
          type="button"
          className="icon-btn picker-clear"
          onClick={() => onChange(null)}
          aria-label={bookTitle(selected) + "を外す"}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    );
  const suggested = booksById(books, suggestions).slice(0, 6);
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
          <b>{bookTitle(book)}</b>
          <small>
            {bookAuthor(book)}・{book.genre}
          </small>
        </span>
      </button>
    </li>
  );
  return (
    <div
      className="book-picker"
      ref={picker}
      role={standsIn ? "group" : undefined}
      aria-label={standsIn ? label : undefined}
      tabIndex={standsIn ? -1 : undefined}
    >
      <label className="picker-search" htmlFor={id}>
        <Icon name="search" size={15} />
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="search"
          value={query}
          placeholder="題名・著者・ISBN"
          autoComplete="off"
          ref={search}
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
