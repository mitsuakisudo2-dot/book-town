"use client";

import {
  createKeptDraftStore,
  keptIds,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { FEELINGS, RECORD_NOTE_MAX_LENGTH, type Feeling } from "./types";

// How a finished book felt, kept while it is chosen and written: a tap outside
// the sheet, Escape, 戻る or あとで leave it for the next time the sheet opens.
// Cleared when the record is kept, deleted, or the reader throws it away.

export const RECORD_DRAFT_KEY = "book-town-record-drafts-v1";

export type RecordWork = {
  feelings: Feeling[];
  note: string;
  spoiler: boolean;
  isPublic: boolean;
};

/**
 * Only what the reader changed is kept, laid over the record each time the
 * sheet opens: a part left alone (who may see it, say) follows the record,
 * even when it is changed elsewhere in the meantime.
 */
export type RecordChanges = Partial<RecordWork>;

/**
 * A new record of a book, or one of the reader's records being changed, for
 * one reader (see draftOwner): a book has the same id for everyone.
 */
export const recordWorkKey = (options: {
  owner: string;
  recordId?: string;
  bookId: string;
}) =>
  options.owner +
  (options.recordId
    ? ":record:" + options.recordId
    : ":record-new:" + options.bookId);

const sameFeelings = (a: Feeling[], b: Feeling[]) =>
  a.length === b.length && a.every((feeling) => b.includes(feeling));

/**
 * The parts of `next` that differ from the record as it is (the order of
 * feelings aside); null when nothing does.
 */
export function recordChanges(
  next: RecordWork,
  base: RecordWork,
): RecordChanges | null {
  const changes: RecordChanges = {};
  if (!sameFeelings(next.feelings, base.feelings))
    changes.feelings = next.feelings;
  if (next.note !== base.note) changes.note = next.note;
  if (next.spoiler !== base.spoiler) changes.spoiler = next.spoiler;
  if (next.isPublic !== base.isPublic) changes.isPublic = next.isPublic;
  return Object.keys(changes).length ? changes : null;
}

/** Changes read back from storage, if each is one the sheet could make. */
export function readRecordChanges(value: unknown): RecordChanges | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const work = value as Record<string, unknown>;
  const changes: RecordChanges = {};
  for (const [name, entry] of Object.entries(work)) {
    if (name === "feelings") {
      if (
        !keptIds(entry, FEELINGS.length) ||
        !entry.every((feeling) =>
          (FEELINGS as readonly string[]).includes(feeling),
        )
      )
        return null;
      changes.feelings = [...new Set(entry)] as Feeling[];
    } else if (name === "note") {
      if (!keptText(entry, RECORD_NOTE_MAX_LENGTH)) return null;
      changes.note = entry;
    } else if (name === "spoiler" || name === "isPublic") {
      if (typeof entry !== "boolean") return null;
      changes[name] = entry;
    } else return null;
  }
  return Object.keys(changes).length ? changes : null;
}

export const RECORD_DRAFT_OPTIONS: KeptDraftOptions<RecordChanges> = {
  storageKey: RECORD_DRAFT_KEY,
  keyPattern: /^[^:]+:(record-new|record):.+$/,
  read: readRecordChanges,
  isEmpty: (changes) => !Object.keys(changes).length,
};

export const recordDrafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS);
