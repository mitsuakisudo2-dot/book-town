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
import { isAudience, shownToOthers } from "./visibility";
import { bookById } from "./book-name";
import { mine } from "./own-books";
import { booksOfWork, workOf, type WorkId } from "./works";
import { hasFinished } from "./reading";

type RecordFields = Pick<
  ReadingRecord,
  "feelings" | "note" | "spoiler" | "audience"
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
    audience: isAudience(draft.audience) ? draft.audience : "private",
  };
}

/** A reader's records as the viewer may see them, newest first. */
export function recordsOf(state: TownState, readerId: string): ReadingRecord[] {
  return state.readingRecords
    .filter(
      (record) =>
        record.readerId === readerId &&
        (shownToOthers(record.audience) || record.readerId === ME_ID),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * How a record's few words reach this reader. The reader's own are open, and
 * so is a note marked as a spoiler to a reader who finished its book or chose
 * すべて表示する; otherwise it is folded (a tap reads it), or left out for a
 * reader who chose not to see spoilers. Its feelings show either way.
 */
export function recordNoteView(
  state: TownState,
  record: ReadingRecord,
): "open" | "folded" | "left_out" {
  if (record.readerId === ME_ID || !record.spoiler) return "open";
  if (hasFinished(state, record.bookId)) return "open";
  const mode = state.settings.spoilerDisplay;
  if (mode === "leave_out") return "left_out";
  return mode === "show_all" ? "open" : "folded";
}

/**
 * The viewer's latest record of a book, if they kept one: of their own book
 * for it, when another reader typed it in (own-books.ts).
 */
export function ownRecordFor(
  state: TownState,
  bookId: string,
): ReadingRecord | undefined {
  const own = mine(state, bookId);
  return recordsOf(state, ME_ID).find((record) => record.bookId === own);
}

/** The records of the book's work the viewer may see. */
function publicRecordsOf(state: TownState, bookId: string) {
  const work = booksOfWork(state.books, bookId);
  return state.readingRecords.filter(
    (record) =>
      work.has(record.bookId) &&
      (shownToOthers(record.audience) || record.readerId === ME_ID),
  );
}

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
    .filter(
      (record) => shownToOthers(record.audience) || record.readerId === ME_ID,
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/** The records' books, each work once: as the viewer's own book where they have one. */
function uniqueBooks(records: ReadingRecord[], state: TownState): string[] {
  const works = new Set<WorkId>();
  return records.flatMap((record) => {
    const book = bookById(state.books, mine(state, record.bookId));
    if (!book || works.has(workOf(book))) return [];
    works.add(workOf(book));
    return [book.id];
  });
}

/** Books finished lately in the town, newest first, each once. */
export function recentlyFinished(state: TownState, limit = 6): string[] {
  return uniqueBooks(visibleRecords(state), state).slice(0, limit);
}

/**
 * The feelings someone in the town has kept, in the order they are offered:
 * of all time, as the database told them when the town has only a window of
 * others' records (feltInTown), and of the records it has.
 */
export function feelingsInTown(state: TownState): Feeling[] {
  const kept = new Set([
    ...(state.feltInTown ?? []),
    ...visibleRecords(state).flatMap((record) => record.feelings),
  ]);
  return FEELINGS.filter((feeling) => kept.has(feeling));
}

/** Books finished with a feeling, the most recently felt first. */
export function booksFelt(state: TownState, feeling: Feeling): string[] {
  return uniqueBooks(
    visibleRecords(state).filter((record) => record.feelings.includes(feeling)),
    state,
  );
}
