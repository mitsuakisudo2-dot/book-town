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

/** A new record of a book, or one of the reader's records being changed. */
export const recordWorkKey = (options: {
  recordId?: string;
  bookId: string;
}) =>
  options.recordId
    ? "record:" + options.recordId
    : "record-new:" + options.bookId;

/** Work read back from storage, if it is still the shape the sheet makes. */
export function readRecordWork(value: unknown): RecordWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<RecordWork>;
  if (
    !keptIds(work.feelings, FEELINGS.length) ||
    !work.feelings.every((feeling) =>
      (FEELINGS as readonly string[]).includes(feeling),
    ) ||
    !keptText(work.note, RECORD_NOTE_MAX_LENGTH) ||
    typeof work.spoiler !== "boolean" ||
    typeof work.isPublic !== "boolean"
  )
    return null;
  return {
    feelings: [...new Set(work.feelings)] as Feeling[],
    note: work.note,
    spoiler: work.spoiler,
    isPublic: work.isPublic,
  };
}

/** Whether two versions of a record say the same (the order of feelings aside). */
export const sameRecordWork = (a: RecordWork, b: RecordWork) =>
  a.note === b.note &&
  a.spoiler === b.spoiler &&
  a.isPublic === b.isPublic &&
  a.feelings.length === b.feelings.length &&
  a.feelings.every((feeling) => b.feelings.includes(feeling));

export const RECORD_DRAFT_OPTIONS: KeptDraftOptions<RecordWork> = {
  storageKey: RECORD_DRAFT_KEY,
  keyPattern: /^(record-new|record):.+$/,
  read: readRecordWork,
};

export const recordDrafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS);
