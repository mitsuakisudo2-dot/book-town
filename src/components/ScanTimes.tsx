"use client";

import { bookTitle } from "../lib/book-name";
import { SCAN_COPY } from "../lib/scan";
import { scanTimeWords, type ScanTime } from "../lib/scan-history";
import type { Book } from "../lib/types";
import { counted } from "../lib/words";
import { Modal } from "./ui";

// スキャンした回 (資料 §2 J): the times of scanning whose books are in the
// library, the latest first; one picked narrows the library to its books.

const COPY = SCAN_COPY.history;
const SHOWN_TITLES = 3;

export function ScanTimes({
  times,
  books,
  onPick,
  onClose,
}: {
  times: readonly ScanTime[];
  books: ReadonlyMap<string, Book>;
  onPick: (session: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={COPY.name} onClose={onClose}>
      <ul className="scan-times">
        {times.map((time) => {
          const titles = time.books.slice(0, SHOWN_TITLES).flatMap((id) => {
            const book = books.get(id);
            return book ? [bookTitle(book)] : [];
          });
          return (
            <li key={time.session}>
              <button
                type="button"
                className="scan-time"
                onClick={() => onPick(time.session)}
              >
                <span className="scan-time-when">{scanTimeWords(time.at)}</span>
                <span className="scan-time-count">
                  {counted(time.books.length, "冊")}
                </span>
                <span className="scan-time-books">
                  {COPY.books(titles, time.books.length - titles.length)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
