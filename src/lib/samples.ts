import {
  demoBooks,
  demoPosters,
  demoPosts,
  demoReaders,
  demoReadingRecords,
  demoShops,
  readingNow as demoReadingNow,
} from "./data";
import { isDatabaseId } from "./record-kind";
import type { TownState } from "./types";

/**
 * 見本: the demo's shops, readers, posts and posters, shown beside the real ones so the
 * town is never empty, even before many people have opened a shop. They are
 * marked as demo on screen and never saved; a real record wins if ids meet.
 */
export function withSamples(state: TownState): TownState {
  const add = <T extends { id: string }>(real: T[], samples: T[]): T[] => {
    const ids = new Set(real.map((entry) => entry.id));
    return [
      ...real,
      ...structuredClone(samples.filter((entry) => !ids.has(entry.id))),
    ];
  };
  const readers = add(state.readers, demoReaders);
  const reading = new Set(state.readingNow.map((entry) => entry.readerId));
  return {
    ...state,
    books: add(state.books, demoBooks),
    readers,
    shops: add(state.shops, demoShops),
    posts: add(state.posts, demoPosts).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    ),
    readingNow: [
      ...state.readingNow,
      ...demoReadingNow.filter((entry) => !reading.has(entry.readerId)),
    ],
    readingRecords: add(state.readingRecords, demoReadingRecords).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    ),
    posters: add(state.posters, demoPosters),
  };
}

const sampleBookIds = new Set(demoBooks.map((book) => book.id));

/** Whether the book is one of the 見本's. */
export const isSampleBook = (bookId: string): boolean =>
  sampleBookIds.has(bookId);

/**
 * A 見本's book is a real book, so a reader can want it, read it and write
 * about it. In the database it is kept under an id made from its name, the same
 * for everyone; its catalog row is written the first time a reader keeps it.
 */
export function sampleBookRowId(bookId: string): string {
  // cyrb128: four 32-bit hashes of the name, written as a uuid.
  const text = "booktown-sample-book:" + bookId;
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

const sampleBookByRowId = new Map(
  demoBooks.map((book) => [sampleBookRowId(book.id), book.id]),
);

/** The 見本's book a database id stands for, if it is one. */
export const sampleBookOfRow = (rowId: string): string | undefined =>
  sampleBookByRowId.get(rowId);

/**
 * Whose a book is, read from its id: the 見本's (by its own id, or by the id
 * the database keeps it under), one in the database, or one typed in this
 * browser. Like `recordKind` (src/lib/record-kind.ts) for the rest: a 見本's
 * book in the database is still the 見本's, never taken for a reader's own.
 */
export function bookKind(bookId: string): "sample" | "database" | "local" {
  if (isSampleBook(bookId) || sampleBookOfRow(bookId)) return "sample";
  return isDatabaseId(bookId) ? "database" : "local";
}
