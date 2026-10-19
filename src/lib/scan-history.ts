import { japanFormat } from "./japan-time";
import type { TownState } from "./types";

// スキャンした回 (資料 §2 J): each time of scanning, as the library rows it
// brought in remember it (batch_id), so that it is the same on every device
// and lasts as long as its books stay in the library. Not a second list of
// books: the library's own, narrowed to one time.

export interface ScanTime {
  /** The session's id, as its books' library rows keep it. */
  session: string;
  /** When its first book came in. */
  at: number;
  /** Its books in the library now, in the order they came in. */
  books: string[];
}

/** The times of scanning whose books are in the library, the latest first. */
export function scanTimes(
  town: Pick<TownState, "library" | "libraryEntries">,
): ScanTime[] {
  const library = new Set(town.library);
  const times = new Map<string, { at: number; book: string }[]>();
  for (const entry of Object.values(town.libraryEntries)) {
    if (!entry.batchId || !library.has(entry.bookId)) continue;
    const at = Date.parse(entry.addedAt);
    if (Number.isNaN(at)) continue;
    const books = times.get(entry.batchId) ?? [];
    books.push({ at, book: entry.bookId });
    times.set(entry.batchId, books);
  }
  return [...times]
    .map(([session, books]) => {
      books.sort((a, b) => a.at - b.at);
      return { session, at: books[0].at, books: books.map(({ book }) => book) };
    })
    .sort((a, b) => b.at - a.at);
}

const whenFormat = japanFormat({
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** When a time of scanning began: 10月18日(日) 1:45. */
export const scanTimeWords = (at: number): string => whenFormat.format(at);
