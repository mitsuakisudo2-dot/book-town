"use client";

import {
  createKeptDraftStore,
  keptIds,
  keptText,
  type KeptDraftOptions,
  type KeptDraftStore,
} from "./kept-draft";
import { DRAFT_OWNER } from "./draft-owner";
import { FEELINGS, RECORD_NOTE_MAX_LENGTH, type Feeling } from "./types";
import { isAudience, type Audience } from "./visibility";

// How a finished book felt, kept while it is chosen and written: a tap outside
// the sheet, Escape, 戻る or あとで leave it for the next time the sheet opens.
// Cleared when the record is kept, deleted, or the reader throws it away.

export const RECORD_DRAFT_KEY = "book-town-record-drafts-v1";

export type RecordWork = {
  feelings: Feeling[];
  note: string;
  spoiler: boolean;
  audience: Audience;
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
  if (next.audience !== base.audience) changes.audience = next.audience;
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
    } else if (name === "spoiler") {
      if (typeof entry !== "boolean") return null;
      changes.spoiler = entry;
    } else if (name === "audience") {
      if (!isAudience(entry)) return null;
      changes.audience = entry;
    } else if (name === "isPublic") {
      // Kept before 見せる範囲, when a record was public or not.
      if (typeof entry !== "boolean") return null;
      changes.audience ??= entry ? "everyone" : "private";
    } else return null;
  }
  return Object.keys(changes).length ? changes : null;
}

export const RECORD_DRAFT_OPTIONS: KeptDraftOptions<RecordChanges> = {
  storageKey: RECORD_DRAFT_KEY,
  keyPattern: new RegExp("^" + DRAFT_OWNER + ":(record-new|record):.+$"),
  read: readRecordChanges,
  isEmpty: (changes) => !Object.keys(changes).length,
};

export const recordDrafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS);

/**
 * A visitor's new records, handed to the account they sign in to: 記録する
 * asked them to sign in, and what they wrote waits for them on the book. Work
 * the account already keeps for the same book is not replaced; the visitor's
 * then stays where it was, for the next time no one is signed in.
 */
export function adoptVisitorRecords(
  owner: string,
  store: KeptDraftStore<RecordChanges> = recordDrafts,
) {
  store.initialize();
  const visitor = "visitor:record-new:";
  for (const key of Object.keys(store.getSnapshot().drafts))
    if (key.startsWith(visitor))
      store.move(
        key,
        recordWorkKey({ owner, bookId: key.slice(visitor.length) }),
      );
}
