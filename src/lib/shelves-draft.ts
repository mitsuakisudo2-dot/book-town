"use client";

import { DRAFT_OWNER } from "./draft-owner";
import { createKeptDraftStore, type KeptDraftOptions } from "./kept-draft";
import { cleanShelves } from "./town-remote";
import type { Shelf } from "./types";

// The shop's shelves as arranged on this device, when the database did not
// take them because they had been changed on another device first (AUD-003).
// They are kept in this browser for the reader, who can put them back in
// place of the shelves saved since, or throw them away.

export const SHELVES_DRAFT_KEY = "book-town-shelves-drafts-v1";

export type KeptShelves = {
  /** The shelves as they were arranged here, in their order. */
  shelves: Shelf[];
  /** When they were not sent. */
  at: string;
};

/** The books a value names, so a shelf read back keeps them all. */
const namedBooks = (value: unknown): Set<string> =>
  new Set(
    (Array.isArray(value) ? value : []).flatMap((shelf) =>
      Array.isArray(shelf?.items)
        ? shelf.items.flatMap((item: { bookId?: unknown }) =>
            typeof item?.bookId === "string" ? [item.bookId] : [],
          )
        : [],
    ),
  );

/**
 * Shelves read back from storage, if they are still shelves the shop holds.
 * Their books are checked against the town when they are put back: the town
 * may still be loading here.
 */
export function readKeptShelves(value: unknown): KeptShelves | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<KeptShelves>;
  if (typeof work.at !== "string" || !Array.isArray(work.shelves)) return null;
  const shelves = cleanShelves(work.shelves, namedBooks(work.shelves));
  return shelves.length ? { shelves, at: work.at } : null;
}

/** Keyed by owner (draftOwner): a reader has one shop. */
export const shelvesDraftOptions: KeptDraftOptions<KeptShelves> = {
  storageKey: SHELVES_DRAFT_KEY,
  keyPattern: new RegExp("^" + DRAFT_OWNER + "$"),
  read: readKeptShelves,
  limit: 4,
};
export const shelvesDraftStore = createKeptDraftStore(shelvesDraftOptions);

/**
 * Keeps for `owner` the shelves of the writes not sent because the shelves
 * had changed on another device. Whether any were kept.
 */
export function keepShelvesNotSent(
  owner: string,
  writes: { kind: string; shelves?: Shelf[] }[],
  store = shelvesDraftStore,
): boolean {
  const last = [...writes].reverse().find((write) => write.kind === "shelves");
  if (!last?.shelves?.length) return false;
  store.set(owner, {
    shelves: structuredClone(last.shelves),
    at: new Date().toISOString(),
  });
  return store.getSnapshot().saved && store.get(owner) !== null;
}

/**
 * Words the kept shelves hold that the shelves saved now do not (a shelf's
 * name, a POP): throwing them away loses words written.
 */
export function shelvesLoseWords(kept: Shelf[], saved: Shelf[]): boolean {
  const words = new Set(
    saved.flatMap((shelf) => [
      shelf.name,
      ...shelf.items.map((item) => item.pop),
    ]),
  );
  return kept.some(
    (shelf) =>
      !words.has(shelf.name) ||
      shelf.items.some((item) => item.pop.trim() && !words.has(item.pop)),
  );
}
