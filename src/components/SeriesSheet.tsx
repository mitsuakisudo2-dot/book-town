"use client";

import { useState, type CSSProperties } from "react";
import type { Notify, TownActions, TownState } from "../lib/types";
import type { ReadingStatus } from "../lib/library";
import { OWNED_MARKS, STATUS_MARKS } from "../lib/library-changes";
import { sortChanges, type ScanSort } from "../lib/library-journal";
import { useMoreRead, useTownMore } from "../lib/store";
import { bookAuthor, bookById, bookTitle, quote } from "../lib/book-name";
import {
  libraryByIsbn,
  lineOf,
  registerVolumes,
  type SeriesLine,
  type SeriesVolume,
} from "../lib/series";
import { MY_BOOK, SERIES } from "../lib/words";
import { Icon, Modal } from "./ui";
import "./series.css";

// シリーズのまとめ登録 (管理表 13, 資料 6章, Figma v4's 04): the volumes of
// the series a book is in, on a shelf of their own. The reader's are their
// books' colours; those not yet in are empty places with their number. A
// volume picked rises into its place, and once registered it stays there,
// coloured. The list under the shelf says the same, with titles: a volume
// already in has no box to tick (資料「登録済み（選択不可）」), so the count
// to register never counts it. Nothing is registered until the reader says
// so, and the 読書の状態 starts unset (a series is not all read, or all 積読):
// the scanner's 連続設定 is not carried over.

/** Volumes on one 段 of the sheet's shelf. */
const SHELF_ROW = 10;

/** The 読書の状態 to pick, as on a book's page; or none. */
const STATUSES = STATUS_MARKS.map((mark) => ({
  status: mark.key as ReadingStatus,
  label: mark.label,
}));
const OWNED = OWNED_MARKS.map((mark) => ({
  owned: mark.key === "owned" ? ("yes" as const) : ("no" as const),
  label: mark.label,
}));

const lineName = (line: SeriesLine, at: number, lines: number) =>
  line.name ??
  line.label ??
  (lines > 1 ? SERIES.line(at + 1) : SERIES.mainLine);

export function SeriesSheet({
  isbn,
  state,
  actions,
  notify,
  onClose,
  onRegistered,
}: {
  /** The book the sheet was opened from: its line is shown first. */
  isbn: string;
  state: TownState;
  actions: TownActions;
  notify: Notify;
  onClose: () => void;
  /** Volumes went in: how many (the scanner sounds it). */
  onRegistered?: (count: number) => void;
}) {
  const ask = { series: isbn };
  const { read: found } = useMoreRead(ask);
  // The volumes' books, for their titles and authors.
  const { state: read } = useTownMore(state, ask);
  const series = found?.series?.[0];
  const [lineId, setLineId] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<ReadingStatus | null>(null);
  const [owned, setOwned] = useState<ScanSort["owned"]>("yes");
  /** The volumes just registered here, which settle into place. */
  const [landed, setLanded] = useState<ReadonlySet<string>>(() => new Set());

  if (!series) return null;
  const line =
    series.lines.find((entry) => entry.id === lineId) ?? lineOf(series, isbn);
  const mine = libraryByIsbn(state);
  const free = line.volumes.filter((volume) => !mine.has(volume.isbn));
  const chosen = free.filter((volume) => picked.has(volume.isbn));
  const own = line.volumes.length - free.length;
  const label = (volume: SeriesVolume) => SERIES.volume(volume.shown);
  const titleOf = (volume: SeriesVolume) => {
    const book = bookById(read.books, volume.bookId);
    return book ? bookTitle(book) : volume.catalogTitle;
  };
  const toggle = (volume: SeriesVolume) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(volume.isbn)) next.delete(volume.isbn);
      else next.add(volume.isbn);
      return next;
    });
  const register = () => {
    if (!chosen.length) return;
    const done = registerVolumes(
      actions,
      chosen.map((volume) => {
        const book = bookById(read.books, volume.bookId);
        return { volume, author: book ? bookAuthor(book) : "" };
      }),
      sortChanges({ status, owned, shelves: [] }),
    );
    const went = done.added.length + done.already;
    if (went) {
      setLanded(new Set(chosen.map((volume) => volume.isbn)));
      setPicked(new Set());
      onRegistered?.(done.added.length);
    }
    notify(done.notSaved ? SERIES.notSaved : SERIES.done(went));
  };

  const rows: SeriesVolume[][] = [];
  for (let i = 0; i < line.volumes.length; i += SHELF_ROW)
    rows.push(line.volumes.slice(i, i + SHELF_ROW));

  return (
    <Modal title={quote(series.name)} onClose={onClose} fromBottom>
      <div className="series-sheet">
        <p className="series-count">
          <span>{SERIES.known(line.volumes.length, series.finished)}</span>
          <strong>{SERIES.mine(own, line.volumes.length)}</strong>
        </p>
        {series.lines.length > 1 && (
          <div
            className="chips series-lines"
            role="radiogroup"
            aria-label={SERIES.lines}
          >
            {series.lines.map((entry, at) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                className="chip"
                aria-checked={entry.id === line.id}
                onClick={() => {
                  setLineId(entry.id);
                  setPicked(new Set());
                }}
              >
                {lineName(entry, at, series.lines.length)}
              </button>
            ))}
          </div>
        )}
        <div className="series-shelf" aria-hidden="true">
          {rows.map((row) => (
            <div className="series-shelf-row" key={row[0].isbn}>
              {row.map((volume) => {
                const book = mine.get(volume.isbn);
                const on = picked.has(volume.isbn) && !book;
                return (
                  <button
                    key={volume.isbn}
                    type="button"
                    tabIndex={-1}
                    className={
                      "series-spine" +
                      (book ? " is-mine" : on ? " is-picked" : "") +
                      (landed.has(volume.isbn) && book ? " is-landed" : "")
                    }
                    style={
                      book
                        ? ({ "--spine": book.color } as CSSProperties)
                        : undefined
                    }
                    disabled={Boolean(book)}
                    onClick={() => toggle(volume)}
                  >
                    <span>{volume.shown}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {free.length > 0 ? (
          <div className="series-list-head">
            <p>{SERIES.lead}</p>
            <button
              type="button"
              className="text-btn"
              onClick={() =>
                setPicked(
                  chosen.length === free.length
                    ? new Set()
                    : new Set(free.map((volume) => volume.isbn)),
                )
              }
            >
              {chosen.length === free.length ? SERIES.pickNone : SERIES.pickAll}
            </button>
          </div>
        ) : (
          <p className="series-all-in">
            <Icon name="check" size={18} />
            {SERIES.allIn}
          </p>
        )}
        <ul className="series-list">
          {line.volumes.map((volume) => {
            const book = mine.get(volume.isbn);
            return (
              <li key={volume.isbn} className={book ? "is-mine" : undefined}>
                {book ? (
                  <div className="series-row">
                    <span className="series-number">{label(volume)}</span>
                    <span className="series-title">{titleOf(volume)}</span>
                    <span className="series-state">
                      <Icon name="check" size={16} />
                      {SERIES.registered}
                    </span>
                  </div>
                ) : (
                  <label className="series-row">
                    <input
                      type="checkbox"
                      checked={picked.has(volume.isbn)}
                      onChange={() => toggle(volume)}
                    />
                    <span className="series-number">{label(volume)}</span>
                    <span className="series-title">{titleOf(volume)}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        {free.length > 0 && (
          <div className="series-given">
            <p>{SERIES.given}</p>
            <div
              className="chips"
              role="radiogroup"
              aria-label={MY_BOOK.status}
            >
              {[...STATUSES, { status: null, label: SERIES.later }].map(
                (choice) => (
                  <button
                    key={choice.status ?? "later"}
                    type="button"
                    role="radio"
                    className="chip"
                    aria-checked={status === choice.status}
                    onClick={() => {
                      setStatus(choice.status);
                      // 積読 is a book the reader has (けにーさん 10-18).
                      if (choice.status === "tsundoku") setOwned("yes");
                    }}
                  >
                    {choice.label}
                  </button>
                ),
              )}
            </div>
            <div className="chips" role="radiogroup" aria-label={MY_BOOK.owned}>
              {OWNED.map((choice) => (
                <button
                  key={choice.owned}
                  type="button"
                  role="radio"
                  className="chip"
                  aria-checked={owned === choice.owned}
                  onClick={() => setOwned(choice.owned)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {free.length > 0 && (
          <div className="series-foot">
            <button
              type="button"
              className="btn fill series-go"
              disabled={!chosen.length}
              onClick={register}
            >
              {chosen.length ? SERIES.go(chosen.length) : SERIES.goNone}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
