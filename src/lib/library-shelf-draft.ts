"use client";

import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import {
  ownerKeyPattern,
  readOverSaved,
  sameField,
  unchanged,
  type OverSaved,
} from "./shop-draft";
import { readRule, type SmartRule } from "./library";
import {
  LIBRARY_SHELF_NAME_MAX_LENGTH,
  LIBRARY_SHELF_NOTE_MAX_LENGTH,
} from "./types";

// A shelf of the reader's own being made or renamed in the library (its
// name, its note and, for a smart shelf, its conditions), kept in this
// browser until the town has it saved or the reader throws it away. Keyed
// by owner and shelf ("demo/new" for one being made, "demo/<shelf id>" for
// one being changed).

export const LIBRARY_SHELF_DRAFT_KEY = "book-town-library-shelf-drafts-v1";

export type LibraryShelfWork = {
  name: string;
  note: string;
  /**
   * A smart shelf's conditions as they are being chosen (none chosen yet is
   * {}); null for a shelf filled by hand.
   */
  rule: SmartRule | null;
};

/** A shelf being made starts from nothing. */
export const NEW_SHELF: LibraryShelfWork = { name: "", note: "", rule: null };
/** The key part of a shelf being made. */
export const NEW_SHELF_KEY = "new";

export const sameShelfWork = (a: LibraryShelfWork, b: LibraryShelfWork) =>
  a.name === b.name && a.note === b.note && sameField(a.rule, b.rule);

/** Whether letting the work go would lose words the reader wrote. */
export const shelfLosesWords = (
  work: LibraryShelfWork,
  saved: LibraryShelfWork,
) =>
  (["name", "note"] as const).some(
    (field) => work[field].trim() !== "" && work[field] !== saved[field],
  ) ||
  (!!work.rule?.author && work.rule.author !== saved.rule?.author);

/** The shelf's words read back from storage, if they still fit the form. */
export function readLibraryShelfWork(value: unknown): LibraryShelfWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<LibraryShelfWork>;
  if (
    !keptText(work.name, LIBRARY_SHELF_NAME_MAX_LENGTH) ||
    !keptText(work.note, LIBRARY_SHELF_NOTE_MAX_LENGTH)
  )
    return null;
  // Kept before smart shelves: filled by hand. Conditions this app no
  // longer reads are let go; the words stay.
  const rule = work.rule == null ? null : (readRule(work.rule) ?? {});
  return { name: work.name, note: work.note, rule };
}

export const libraryShelfDraftOptions: KeptDraftOptions<
  OverSaved<LibraryShelfWork>
> = {
  storageKey: LIBRARY_SHELF_DRAFT_KEY,
  keyPattern: ownerKeyPattern(1),
  read: (value) => readOverSaved(value, readLibraryShelfWork),
  isEmpty: unchanged,
  limit: 8,
};
export const libraryShelfDraftStore = createKeptDraftStore(
  libraryShelfDraftOptions,
);
