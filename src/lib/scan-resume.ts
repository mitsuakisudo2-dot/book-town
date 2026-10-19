"use client";

import { bookById } from "./book-name";
import { JOURNAL_DAYS, type ScanItem } from "./library-journal";
import type { TownState } from "./types";

// 続きから再開 (Figma v4's 09): the scan session the reader left without
// ［完了］ (✕, 戻る, the page closed), offered again the next time the
// scanner opens. One per reader on this device, let go after JOURNAL_DAYS,
// on ［完了］, or when the reader says 今はしない.

export const LAST_SCAN_KEY = "book-town-scan-last:";
const DAY_MS = 86_400_000;

export interface LastScan {
  /** The session's id, as its books' library rows keep it (batch_id). */
  session: string;
  /** When a book was last read in it. */
  at: number;
}

const storage = () =>
  typeof window === "undefined" ? null : window.localStorage;

/** The session left without ［完了］, if one is recent enough. */
export function lastScan(owner: string, now = Date.now()): LastScan | null {
  try {
    const raw = storage()?.getItem(LAST_SCAN_KEY + owner);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as LastScan).session !== "string" ||
      !(data as LastScan).session ||
      typeof (data as LastScan).at !== "number" ||
      now - (data as LastScan).at > JOURNAL_DAYS * DAY_MS
    )
      return null;
    return { session: (data as LastScan).session, at: (data as LastScan).at };
  } catch {
    return null;
  }
}

/** A book read in `session`: it is the one to offer, until ［完了］. */
export function keepLastScan(owner: string, session: string, now = Date.now()) {
  try {
    storage()?.setItem(
      LAST_SCAN_KEY + owner,
      JSON.stringify({ session, at: now } satisfies LastScan),
    );
  } catch {
    // Not kept: the next time is simply a new session.
  }
}

/** ［完了］ or 今はしない: `session` is not offered again. */
export function endLastScan(owner: string, session: string) {
  try {
    if (lastScan(owner, Number.NEGATIVE_INFINITY)?.session === session)
      storage()?.removeItem(LAST_SCAN_KEY + owner);
  } catch {
    // Storage that cannot be reached keeps nothing to let go of.
  }
}

/** A book of a session left, as its card comes back. */
export interface LeftBook {
  /** Its journal item's id, or one for a book the library has. */
  id: string;
  isbn?: string;
  bookId?: string;
  title?: string;
  author?: string;
  /** In the library; a title still to be asked; or none known. */
  shows: "added" | "looking" | "untitled";
}

/**
 * The books `session` brought in, oldest first: those in the library (by
 * their rows' batch_id) and those still kept on the device for it.
 */
export function leftBooks(
  session: string,
  items: readonly ScanItem[],
  town: TownState,
): LeftBook[] {
  const held = items.filter((item) => item.session === session);
  const heldBooks = new Set(held.map((item) => item.bookId));
  const library = new Set(town.library);
  const books: { at: number; book: LeftBook }[] = [];
  for (const entry of Object.values(town.libraryEntries))
    if (
      entry.batchId === session &&
      library.has(entry.bookId) &&
      !heldBooks.has(entry.bookId)
    ) {
      const isbn = bookById(town.books, entry.bookId)?.isbn;
      books.push({
        at: Date.parse(entry.addedAt),
        book: {
          id: `${session}-b-${entry.bookId}`,
          ...(isbn ? { isbn } : {}),
          bookId: entry.bookId,
          shows: "added",
        },
      });
    }
  for (const item of held)
    books.push({
      at: Date.parse(item.at),
      book: {
        id: item.id,
        isbn: item.isbn,
        bookId: item.bookId,
        ...(item.title ? { title: item.title } : {}),
        ...(item.author ? { author: item.author } : {}),
        shows:
          item.state === "untitled"
            ? "untitled"
            : item.state === "lookup" || item.state === "ready"
              ? "looking"
              : "added",
      },
    });
  return books.sort((a, b) => a.at - b.at).map(({ book }) => book);
}
