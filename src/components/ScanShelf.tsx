"use client";

import type { CSSProperties } from "react";
import { counted } from "../lib/words";

// この回の棚 (114 本を登録する瞬間, けにーさん 2026-10-23「一番上に来るって
// 考えたらめっちゃいい」): this time's books as spines on a small shelf,
// under the scanner's 「N冊 登録済み」, one more with each book read. A book
// on its way is faint until its saving is confirmed; one that waits for the
// reader is not on it. It is one long shelf, never folded (けにーさん
// 2026-10-25「10冊で畳まない方が好きかも、横に長い方が良かった」): it widens
// with each book, and once it is as wide as the top of the scanner, the
// oldest books slide off its left end. 完了 shows the same books larger,
// ten to a 段, every 段 stacked. A picture only: the words beside it say
// the count.

/** Books on one 段 of 完了's shelf; each 10th read sounds as one more. */
export const SHELF_ROW = 10;

/** The scanner's shelf draws at most these, the newest; more never fit. */
const LONG_MOST = 60;

/** From this many on, the shelf may be wider than it has room for. */
const LONG_FADE = 28;

/** 完了 shows at most these 段, the newest. */
const LARGE_ROWS = 5;

export type Spine = {
  id: string;
  /** The book's own colour, height and thickness (as on a shop's shelf). */
  color: string;
  height: number;
  thickness: number;
  /** Still on its way: drawn faint. */
  faint: boolean;
};

/** Whether the `books`th book fills a 段. */
export const fillsRow = (books: number): boolean =>
  books > 0 && books % SHELF_ROW === 0;

// Books are about 170–210 mm tall and 27–42 thick (books.ts, data.ts):
// each is a fraction of the shelf's height and of a spine's widest.
const tall = (height: number) =>
  Math.min(1, Math.max(0.6, 0.6 + (height - 170) / 100));
const wide = (thickness: number) =>
  Math.min(1, Math.max(0.6, 0.6 + (thickness - 27) / 37.5));

function Row({ books }: { books: readonly Spine[] }) {
  return (
    <span className="scan-shelf-row">
      {books.map((book) => (
        <span
          key={book.id}
          className={"scan-spine" + (book.faint ? " is-faint" : "")}
          style={
            {
              "--spine": book.color,
              "--spine-tall": tall(book.height),
              "--spine-wide": wide(book.thickness),
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** Oldest first. Nothing at all while the shelf is empty. */
export function ScanShelf({
  books,
  large = false,
}: {
  books: readonly Spine[];
  large?: boolean;
}) {
  if (books.length === 0) return null;
  if (large) {
    const rows: Spine[][] = [];
    for (let i = 0; i < books.length; i += SHELF_ROW)
      rows.push(books.slice(i, i + SHELF_ROW));
    const hidden = Math.max(0, rows.length - LARGE_ROWS);
    return (
      <div className="scan-shelf is-large" aria-hidden="true">
        {hidden > 0 && (
          <span className="scan-shelf-folded">{counted(hidden, "段")}</span>
        )}
        {rows.slice(hidden).map((row) => (
          <Row key={row[0].id} books={row} />
        ))}
      </div>
    );
  }
  return (
    <div
      className={"scan-shelf" + (books.length >= LONG_FADE ? " is-long" : "")}
      aria-hidden="true"
    >
      <Row books={books.slice(-LONG_MOST)} />
    </div>
  );
}
