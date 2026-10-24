"use client";

import { useState, type CSSProperties, type PointerEvent } from "react";
import type { Book, Notify, TownActions, TownState } from "../lib/types";
import { useMoreRead } from "../lib/store";
import { quote } from "../lib/book-name";
import { libraryByIsbn, lineOf, SERIES, type Series } from "../lib/series";
import { Icon } from "./ui";
import { SeriesSheet } from "./series-later";
import "./series.css";

// The doors to a series' sheet (管理表 13): a small shelf on a book's page,
// and シリーズ＋ on a scanned book's card. Each shows only for a book the
// catalog has in a series of volumes; for any other book, nothing.

/** The series a book of the ISBN is in, once read; undefined for none. */
export function useSeries(isbn: string | undefined): Series | undefined {
  const { read } = useMoreRead(isbn ? { series: isbn } : null);
  return read?.series?.[0];
}

/** Spines the page's small shelf shows at most. */
const STRIP_SPINES = 12;

/** On a book's page: its series as a small shelf, the reader's coloured. */
export function SeriesStrip({
  book,
  state,
  actions,
  notify,
}: {
  book: Book;
  state: TownState;
  actions: TownActions;
  notify: Notify;
}) {
  const series = useSeries(book.isbn);
  const [open, setOpen] = useState(false);
  if (!series || !book.isbn) return null;
  const line = lineOf(series, book.isbn);
  const mine = libraryByIsbn(state);
  const own = line.volumes.filter((volume) => mine.has(volume.isbn)).length;
  return (
    <>
      <button
        type="button"
        className="series-strip"
        aria-label={SERIES.openName(quote(series.name))}
        onClick={() => setOpen(true)}
      >
        <span className="series-strip-shelf" aria-hidden="true">
          {line.volumes.slice(0, STRIP_SPINES).map((volume) => {
            const held = mine.get(volume.isbn);
            return (
              <span
                key={volume.isbn}
                className={held ? "is-mine" : undefined}
                style={
                  held
                    ? ({ "--spine": held.color } as CSSProperties)
                    : undefined
                }
              />
            );
          })}
        </span>
        <span className="series-strip-text">
          <b>{SERIES.strip(quote(series.name))}</b>
          <small>{SERIES.mine(own, line.volumes.length)}</small>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <SeriesSheet
          isbn={book.isbn}
          state={state}
          actions={actions}
          notify={notify}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** シリーズ＋ on a scanned book's card, left of its ⋮ (資料 6章). */
export function SeriesOpen({
  isbn,
  onOpen,
  onPointerDown,
}: {
  isbn: string | undefined;
  onOpen: (isbn: string) => void;
  /** As the card's other buttons: keeps the ISBN box's keyboard up. */
  onPointerDown?: (event: PointerEvent) => void;
}) {
  const series = useSeries(isbn);
  if (!series || !isbn) return null;
  return (
    <button
      type="button"
      className="chip series-open"
      aria-label={SERIES.openName(quote(series.name))}
      onPointerDown={onPointerDown}
      onClick={() => onOpen(isbn)}
    >
      {SERIES.open}
    </button>
  );
}
