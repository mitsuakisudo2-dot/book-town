import {
  FEELINGS,
  ME_ID,
  RECORD_NOTE_MAX_LENGTH,
  type Feeling,
  type ReadingRecord,
  type Reader,
  type RecordDraft,
  type TownState,
} from "./types";

type RecordFields = Pick<
  ReadingRecord,
  "feelings" | "note" | "spoiler" | "isPublic"
>;

/**
 * A record's own fields as far as they are valid, in the order the feelings
 * are offered. Null when the note is too long. A spoiler needs a note.
 */
export function cleanRecord(
  draft: Partial<Omit<RecordDraft, "bookId">>,
): RecordFields | null {
  const note = typeof draft.note === "string" ? draft.note.trim() : "";
  if (note.length > RECORD_NOTE_MAX_LENGTH) return null;
  const chosen = Array.isArray(draft.feelings) ? draft.feelings : [];
  return {
    feelings: FEELINGS.filter((feeling) => chosen.includes(feeling)),
    note,
    spoiler: draft.spoiler === true && note.length > 0,
    isPublic: draft.isPublic === true,
  };
}

/** A reader's records as the viewer may see them, newest first. */
export function recordsOf(state: TownState, readerId: string): ReadingRecord[] {
  return state.readingRecords
    .filter(
      (record) =>
        record.readerId === readerId &&
        (record.isPublic || record.readerId === ME_ID),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** The viewer's latest record of a book, if they kept one. */
export function ownRecordFor(
  state: TownState,
  bookId: string,
): ReadingRecord | undefined {
  return recordsOf(state, ME_ID).find((record) => record.bookId === bookId);
}

const publicRecordsOf = (state: TownState, bookId: string) =>
  state.readingRecords.filter(
    (record) =>
      record.bookId === bookId &&
      (record.isPublic || record.readerId === ME_ID),
  );

/**
 * The feelings readers chose most for a book. Shown as words, never as
 * counts: the town is small, and a number would read as a score.
 */
export function bookFeelings(
  state: TownState,
  bookId: string,
  limit = 3,
): Feeling[] {
  const counts = new Map<Feeling, number>();
  for (const record of publicRecordsOf(state, bookId))
    for (const feeling of record.feelings)
      counts.set(feeling, (counts.get(feeling) ?? 0) + 1);
  return [...counts.entries()]
    .sort(
      ([a, countA], [b, countB]) =>
        countB - countA || FEELINGS.indexOf(a) - FEELINGS.indexOf(b),
    )
    .slice(0, limit)
    .map(([feeling]) => feeling);
}

/** Other readers who finished the book and would like to talk about it, newest first. */
export function talkersOf(state: TownState, bookId: string): Reader[] {
  const seen = new Set<string>();
  return publicRecordsOf(state, bookId)
    .filter(
      (record) => record.readerId !== ME_ID && record.feelings.includes("talk"),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .flatMap((record) => {
      if (seen.has(record.readerId)) return [];
      seen.add(record.readerId);
      const reader = state.readers.find(
        (entry) => entry.id === record.readerId,
      );
      return reader ? [reader] : [];
    });
}

/** Every record the viewer may see, newest first. */
const visibleRecords = (state: TownState) =>
  state.readingRecords
    .filter((record) => record.isPublic || record.readerId === ME_ID)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

const uniqueBooks = (records: ReadingRecord[], state: TownState) =>
  [...new Set(records.map((record) => record.bookId))].filter((bookId) =>
    state.books.some((book) => book.id === bookId),
  );

/** Books finished lately in the town, newest first, each once. */
export function recentlyFinished(state: TownState, limit = 6): string[] {
  return uniqueBooks(visibleRecords(state), state).slice(0, limit);
}

/** The feelings someone in the town has kept, in the order they are offered. */
export function feelingsInTown(state: TownState): Feeling[] {
  const kept = new Set(
    visibleRecords(state).flatMap((record) => record.feelings),
  );
  return FEELINGS.filter((feeling) => kept.has(feeling));
}

/** Books finished with a feeling, the most recently felt first. */
export function booksFelt(state: TownState, feeling: Feeling): string[] {
  return uniqueBooks(
    visibleRecords(state).filter((record) => record.feelings.includes(feeling)),
    state,
  );
}
