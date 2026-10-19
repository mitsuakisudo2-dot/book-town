"use client";

import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "../lib/back-layer";
import type { LibrarySet, LibraryShelf, ReadingStatus } from "../lib/library";
import { SCAN_COPY } from "../lib/scan";
import type { Book } from "../lib/types";
import { BookJacket, Icon } from "./ui";

// 一括整理 (資料, Figma v4's 05): this time's books on one page, the camera
// off, to give several of them a reading status or a shelf at once. 戻る,
// Escape and 整理を終える go back to the scanner.

const COPY = SCAN_COPY.tidy;

export interface TidyBook {
  id: string;
  name: string;
  byline: string;
  book?: Book;
  status: ReadingStatus | null;
  shelves: ReadonlySet<string>;
}

export function ScanTidy({
  books,
  count,
  statuses,
  shelves,
  onChange,
  onClose,
}: {
  /** This time's books in the library, newest first. */
  books: TidyBook[];
  /** The scanner's count (N冊 登録済み …). */
  count: string;
  statuses: { status: ReadingStatus; label: string }[];
  /** The shelves the reader fills by hand. */
  shelves: LibraryShelf[];
  onChange: (ids: string[], set: LibrarySet) => void;
  onClose: () => void;
}) {
  useBackLayer(onClose);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [unsorted, setUnsorted] = useState(false);
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    back.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const listed = unsorted ? books.filter((book) => !book.status) : books;
  const chosen = books.filter((book) => picked.has(book.id));
  const ids = chosen.map((book) => book.id);
  const all = listed.length > 0 && listed.every((book) => picked.has(book.id));
  const every = (has: (book: TidyBook) => boolean) =>
    chosen.length > 0 && chosen.every(has);
  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="scan-tidy" role="region" aria-label={COPY.name}>
      <div className="scan-tidy-top">
        <button
          ref={back}
          type="button"
          className="icon-btn"
          aria-label={COPY.back}
          onClick={onClose}
        >
          <Icon name="back" />
        </button>
        <h2>{COPY.name}</h2>
      </div>
      <p className="scan-tidy-count" aria-live="polite">
        {[count, chosen.length ? COPY.picked(chosen.length) : ""]
          .filter(Boolean)
          .join("・")}
      </p>
      <div className="scan-tidy-tools">
        <label className="scan-tidy-all">
          <input
            type="checkbox"
            checked={all}
            disabled={!listed.length}
            onChange={(event) =>
              setPicked((was) => {
                const next = new Set(was);
                for (const book of listed)
                  if (event.target.checked) next.add(book.id);
                  else next.delete(book.id);
                return next;
              })
            }
          />
          {COPY.all}
        </label>
        <button
          type="button"
          className="chip"
          aria-pressed={unsorted}
          onClick={() => setUnsorted((was) => !was)}
        >
          {COPY.unsorted}
        </button>
      </div>
      <ul className="scan-tidy-list" aria-label={COPY.list}>
        {listed.map((book) => (
          <li key={book.id}>
            <label
              className={
                "scan-tidy-book" + (picked.has(book.id) ? " is-picked" : "")
              }
            >
              <input
                type="checkbox"
                checked={picked.has(book.id)}
                onChange={() => toggle(book.id)}
              />
              <span className="scan-tidy-cover" aria-hidden="true">
                {book.book ? (
                  <BookJacket book={book.book} />
                ) : (
                  <span className="scan-item-tile">
                    <Icon name="barcode" size={18} />
                  </span>
                )}
              </span>
              <span className="scan-tidy-text">
                <span className="scan-item-title">{book.name}</span>
                <span className="scan-item-author">
                  {[
                    book.byline,
                    statuses.find((s) => s.status === book.status)?.label ??
                      COPY.none,
                  ]
                    .filter(Boolean)
                    .join(" ・ ")}
                </span>
              </span>
            </label>
          </li>
        ))}
        {!listed.length && <li className="scan-list-empty">{COPY.allSet}</li>}
      </ul>
      <div className="scan-tidy-foot">
        <p className="scan-tidy-to">
          {chosen.length ? COPY.to(chosen.length) : COPY.toNone}
        </p>
        <div className="scan-tidy-actions">
          {statuses.map((choice) => {
            const lit = every((book) => book.status === choice.status);
            return (
              <button
                key={choice.status}
                type="button"
                className="chip"
                aria-pressed={lit}
                disabled={!chosen.length}
                onClick={() =>
                  onChange(ids, { status: lit ? null : choice.status })
                }
              >
                {choice.label}
              </button>
            );
          })}
          <button
            type="button"
            className="chip"
            aria-expanded={shelvesOpen}
            disabled={!chosen.length}
            onClick={() => setShelvesOpen((was) => !was)}
          >
            <Icon name="plus" size={16} />
            {SCAN_COPY.shelf}
          </button>
        </div>
        {shelvesOpen && chosen.length > 0 && (
          <div
            className="scan-item-shelves"
            role="group"
            aria-label={COPY.shelvesTo}
          >
            {shelves.length ? (
              shelves.map((shelf) => {
                const on = every((book) => book.shelves.has(shelf.id));
                return (
                  <button
                    key={shelf.id}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() =>
                      onChange(
                        ids,
                        on ? { removeShelf: shelf.id } : { addShelf: shelf.id },
                      )
                    }
                  >
                    {shelf.name}
                  </button>
                );
              })
            ) : (
              <p className="scan-item-none">{SCAN_COPY.noShelves}</p>
            )}
          </div>
        )}
        <button type="button" className="btn fill" onClick={onClose}>
          {COPY.done}
        </button>
      </div>
    </div>
  );
}
