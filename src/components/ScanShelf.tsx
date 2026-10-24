"use client";

import type { CSSProperties } from "react";
import { counted } from "../lib/words";

// この回の棚 (114 本を登録する瞬間, けにーさん 2026-10-23「一番上に来るって
// 考えたらめっちゃいい」): this time's books as spines on a small shelf,
// under the scanner's 「N冊 登録済み」, one more with each book read. A book
// on its way is faint until its saving is confirmed; one that waits for the
// reader is not on it. Ten fill a 段: the 段 before it fold into 「1段」,
// 「2段」, and lie under it as thin bands of their books' colours, so the
// shelf keeps growing past ten (通し確認 2026-10-24). 完了 shows the same
// books larger, every 段 stacked. A picture only: the words beside it say
// the count.

/** Books on one 段 of the shelf. */
export const SHELF_ROW = 10;

/** 完了 shows at most these 段, the newest. */
const LARGE_ROWS = 5;

/** The scanner draws at most these folded 段 as bands, the newest. */
const BANDS = 3;

export type Spine = {
  id: string;
  /** The book's own colour, height and thickness (as on a shop's shelf). */
  color: string;
  height: number;
  thickness: number;
  /** Still on its way: drawn faint. */
  faint: boolean;
};

/** The 段 already full before the one in sight (that one may be full too). */
export const foldedRows = (books: number): number =>
  books === 0 ? 0 : Math.floor((books - 1) / SHELF_ROW);

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

/** A folded 段 as a thin band: its books' colours, side by side. */
function Band({ books }: { books: readonly Spine[] }) {
  return (
    <span className="scan-shelf-band">
      {books.map((book) => (
        <span
          key={book.id}
          style={{ "--spine": book.color } as CSSProperties}
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
  const folded = foldedRows(books.length);
  // The newest folded 段 right under the one in sight.
  const bands: Spine[][] = [];
  for (let row = folded - 1; row >= Math.max(0, folded - BANDS); row--)
    bands.push(books.slice(row * SHELF_ROW, (row + 1) * SHELF_ROW));
  return (
    <div className="scan-shelf" aria-hidden="true">
      {folded > 0 && (
        <span className="scan-shelf-folded">{counted(folded, "段")}</span>
      )}
      <span className="scan-shelf-case">
        <Row books={books.slice(folded * SHELF_ROW)} />
        {bands.length > 0 && (
          <span className="scan-shelf-bands">
            {bands.map((band) => (
              <Band key={band[0].id} books={band} />
            ))}
          </span>
        )}
      </span>
    </div>
  );
}
