"use client";

import { DRAFT_OWNER } from "./draft-owner";
import { createKeptDraftStore, type KeptDraftOptions } from "./kept-draft";
import { canonical } from "./canonical";
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
  /**
   * Shelves not sent before these, still waiting for the reader's choice:
   * a later arrangement never takes the place of an earlier one.
   */
  earlier?: KeptShelves;
};

/** How many arrangements wait at most; the oldest goes beyond that. */
export const KEPT_SHELVES_MAX = 4;

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

/** The arrangements kept, newest first. */
export function keptArrangements(
  kept: KeptShelves | null | undefined,
): { shelves: Shelf[]; at: string }[] {
  const all: { shelves: Shelf[]; at: string }[] = [];
  for (
    let entry = kept;
    entry && all.length < KEPT_SHELVES_MAX;
    entry = entry.earlier
  )
    all.push({ shelves: entry.shelves, at: entry.at });
  return all;
}

/** The arrangements as one kept value, newest first; null for none. */
export function keptShelvesOf(
  all: { shelves: Shelf[]; at: string }[],
): KeptShelves | null {
  return all.slice(0, KEPT_SHELVES_MAX).reduceRight<KeptShelves | null>(
    (earlier, entry) => ({
      shelves: entry.shelves,
      at: entry.at,
      ...(earlier ? { earlier } : {}),
    }),
    null,
  );
}

/**
 * Shelves read back from storage, if they are still shelves the shop holds.
 * Their books are checked against the town when they are put back: the town
 * may still be loading here.
 */
export function readKeptShelves(value: unknown): KeptShelves | null {
  const all: { shelves: Shelf[]; at: string }[] = [];
  for (
    let entry = value as Partial<KeptShelves> | null | undefined;
    entry && typeof entry === "object" && all.length < KEPT_SHELVES_MAX;
    entry = entry.earlier as Partial<KeptShelves> | undefined
  ) {
    if (typeof entry.at !== "string" || !Array.isArray(entry.shelves)) break;
    const shelves = cleanShelves(entry.shelves, namedBooks(entry.shelves));
    if (shelves.length) all.push({ shelves, at: entry.at });
  }
  return keptShelvesOf(all);
}

/** Keyed by owner (draftOwner): a reader has one shop. */
export const shelvesDraftOptions: KeptDraftOptions<KeptShelves> = {
  storageKey: SHELVES_DRAFT_KEY,
  keyPattern: new RegExp("^" + DRAFT_OWNER + "$"),
  read: readKeptShelves,
  limit: 4,
};
export const shelvesDraftStore = createKeptDraftStore(shelvesDraftOptions);

/** The last shelves among some writes, if any. */
const lastShelves = (writes: { kind: string; shelves?: Shelf[] }[]) =>
  [...writes].reverse().find((write) => write.kind === "shelves")?.shelves;

/**
 * Keeps for `owner` the shelves of the writes not sent because the shelves
 * had changed on another device, before any kept already. Whether any were
 * kept.
 */
export function keepShelvesNotSent(
  owner: string,
  writes: { kind: string; shelves?: Shelf[] }[],
  store = shelvesDraftStore,
): boolean {
  const shelves = lastShelves(writes);
  if (!shelves?.length) return false;
  const mark = canonical(shelves);
  const earlier = keptArrangements(store.get(owner)).filter(
    (entry) => canonical(entry.shelves) !== mark,
  );
  store.set(
    owner,
    keptShelvesOf([
      { shelves: structuredClone(shelves), at: new Date().toISOString() },
      ...earlier,
    ]),
  );
  return store.getSnapshot().saved && store.get(owner) !== null;
}

/**
 * Whether the shelves of writes the account turned away are kept for
 * `owner` (shelves put back from those kept, not saved yet).
 */
export function shelvesStillKept(
  owner: string,
  writes: { kind: string; shelves?: Shelf[] }[],
  store = shelvesDraftStore,
): boolean {
  const shelves = lastShelves(writes);
  if (!shelves) return false;
  const mark = canonical(shelves);
  return keptArrangements(store.get(owner)).some(
    (entry) => canonical(entry.shelves) === mark,
  );
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
