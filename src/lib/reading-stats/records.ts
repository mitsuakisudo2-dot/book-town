// The reader's readings as the statistics count them (管理表 19). Each
// span of reading (a reading_sessions row and its card's book) becomes one
// ReadSpan, cut into Pieces by the hour it fell in on the clock of the zone
// it was read in; each time a book was finished becomes one Finish. The
// rules beyond the four settled ones (memo booktown-stats-calc-rules) are
// provisional, asked of けにーさん 10-28 (docs/機能/読書記録.md「統計」):
//   - one span counts up to READ_SECONDS_MAX (a clock left running for
//     months is not months of reading); the card itself is not changed
//   - a span over midnight, or an hour's turn, is shared by wall time
//   - pages read are where the span ended less where it began (the page it
//     began at, else where the book's last span ended); a book finished
//     with fewer pages written down gets the rest of its pages that day
//   - a book is finished when a card says so; one only the library calls
//     finished counts from when it was made so, unless it was made so when
//     registered (an old book put on the shelf): that one is undated, and
//     counts in ぜんぶ only

import type { LibraryEntry } from "../library";
import {
  sessionReadSeconds,
  type ReadingCardBook,
  type ReadingFormat,
} from "../reading-cards";
import type { TownState } from "../types";
import { JAPAN_ZONE, localTime, readableZone, type DayKey } from "./zone";

/** One span counts at most this long (12 hours). */
export const READ_SECONDS_MAX = 12 * 60 * 60;
/** A book made 読了 this soon after it came in was made so when registered. */
export const REGISTERED_FINISHED_MS = 60 * 1000;
/** Spans are cut at every quarter hour of UTC: every zone's hours turn on one. */
const CUT_MS = 15 * 60 * 1000;

/** What the bibliography says of a book: its pages and BookTown's genre (16), when known. */
export interface BookFacts {
  pages: number | null;
  genre: string | null;
}
export type FactsOf = (bookId: string) => BookFacts | undefined;

export interface ReadSpan {
  sessionId: string;
  /** The reading (card) it was part of; null for a span from before the cards. */
  readingId: string;
  bookId: string | null;
  start: number;
  end: number;
  /** Read, pauses left out, at most READ_SECONDS_MAX. */
  seconds: number;
  /** Read by the clock, or added later with a length: it counts for time and the hours. */
  timed: boolean;
  zone: string;
  pages: number;
  format: ReadingFormat | null;
  finished: boolean;
}

/** A span's share of one hour of one day, on its own clock. */
export interface Piece {
  span: ReadSpan;
  day: DayKey;
  hour: number;
  weekday: number;
  seconds: number;
  pages: number;
}

export interface Finish {
  bookId: string;
  /** Null for a book made 読了 when it was registered: when it was read is not known. */
  at: number | null;
  day: DayKey | null;
  /** Its pages from the bibliography, when known. */
  pages: number | null;
}

type Readings = Pick<
  TownState,
  "readingSessions" | "readingCards" | "readingCardBooks"
>;

const ms = (time: string) => Date.parse(time);

/** The reader's spans of reading by `now`, oldest first, pages counted (facts give a finished book's pages). */
export function readSpans(
  state: Readings,
  now: number,
  facts: FactsOf,
): ReadSpan[] {
  // Looked up by id once: years of readings are counted on each open.
  const books = new Map(
    state.readingCardBooks.map((book) => [book.sessionId, book]),
  );
  const cards = new Map(state.readingCards.map((card) => [card.id, card]));
  const spans = state.readingSessions
    .map((session): ReadSpan => {
      const book = books.get(session.id);
      const card = book && cards.get(book.cardId);
      const start = ms(session.startedAt);
      const end = Math.max(
        start,
        session.endedAt === null ? now : ms(session.endedAt),
      );
      // A span over is as its card counted it (sessionReadSeconds would find it again).
      const read =
        session.endedAt !== null
          ? (book?.readSeconds ?? Math.floor((end - start) / 1000))
          : sessionReadSeconds(state, session, now);
      const seconds = Math.min(READ_SECONDS_MAX, Math.max(0, read));
      return {
        sessionId: session.id,
        readingId: card?.id ?? session.id,
        bookId: session.bookId,
        start,
        end,
        seconds,
        // あとから足した読書の「わからない」は 0 秒: ページだけが残る.
        timed: !(card?.addedLater && seconds === 0),
        zone: readableZone(card?.timeZone ?? JAPAN_ZONE),
        pages: 0,
        format: book?.format ?? null,
        finished: book?.finished ?? false,
      };
    })
    .sort((a, b) => a.start - b.start);
  countPages(books, spans, facts);
  return spans;
}

/** Where each book stands now: the page its last span ended at, none once finished. */
export function bookPositions(
  state: Readings,
  spans: ReadSpan[],
): Map<string, number> {
  const books = new Map(
    state.readingCardBooks.map((book) => [book.sessionId, book]),
  );
  const positions = new Map<string, number>();
  for (const span of spans) {
    if (span.bookId === null) continue;
    const book = books.get(span.sessionId);
    if (book?.pageUnit === "page" && book.pageTo !== null)
      positions.set(span.bookId, book.pageTo);
    if (span.finished) positions.delete(span.bookId);
  }
  return positions;
}

function countPages(
  books: Map<string, ReadingCardBook>,
  spans: ReadSpan[],
  facts: FactsOf,
) {
  const at = new Map<string, number>();
  for (const span of spans) {
    if (span.bookId === null || span.format === "audio") continue;
    const book = books.get(span.sessionId);
    let position = at.get(span.bookId) ?? 0;
    if (book?.pageUnit === "page" && book.pageTo !== null) {
      span.pages += Math.max(0, book.pageTo - (book.pageFrom ?? position));
      position = book.pageTo;
    }
    if (span.finished) {
      const pages = facts(span.bookId)?.pages ?? null;
      if (pages !== null && position < pages) span.pages += pages - position;
      position = 0;
    }
    at.set(span.bookId, position);
  }
}

/** A span cut by the hours it fell in on its clock, its time and pages shared by wall time. */
export function piecesOf(span: ReadSpan): Piece[] {
  const wall = span.end - span.start;
  const pieces: Piece[] = [];
  const add = (from: number, to: number) => {
    const share = wall > 0 ? (to - from) / wall : 1;
    const local = localTime(from, span.zone);
    const last = pieces[pieces.length - 1];
    if (last && last.day === local.day && last.hour === local.hour) {
      last.seconds += span.seconds * share;
      last.pages += span.pages * share;
    } else
      pieces.push({
        span,
        ...local,
        seconds: span.seconds * share,
        pages: span.pages * share,
      });
  };
  if (wall <= 0) {
    add(span.start, span.start);
    return pieces;
  }
  let from = span.start;
  while (from < span.end) {
    const to = Math.min(span.end, (Math.floor(from / CUT_MS) + 1) * CUT_MS);
    add(from, to);
    from = to;
  }
  return pieces;
}

/**
 * Every time a book was finished, oldest first: each card that says so, then
 * a book only the library calls finished (dated when it was made so, or
 * undated when that was as it was registered).
 */
export function finishesOf(
  spans: ReadSpan[],
  library: Record<string, LibraryEntry>,
  facts: FactsOf,
  zone: string,
): Finish[] {
  const pagesOf = (bookId: string) => facts(bookId)?.pages ?? null;
  const finishes: Finish[] = spans
    .filter((span) => span.finished && span.bookId !== null)
    .map((span) => ({
      bookId: span.bookId as string,
      at: span.end,
      day: localTime(span.end, span.zone).day,
      pages: pagesOf(span.bookId as string),
    }));
  const carded = new Set(finishes.map((finish) => finish.bookId));
  for (const entry of Object.values(library)) {
    if (
      entry.status !== "finished" ||
      entry.removedAt !== null ||
      carded.has(entry.bookId)
    )
      continue;
    const at = entry.statusAt === null ? null : ms(entry.statusAt);
    const dated =
      at !== null && at - ms(entry.addedAt) > REGISTERED_FINISHED_MS;
    finishes.push({
      bookId: entry.bookId,
      at: dated ? at : null,
      day: dated ? localTime(at, readableZone(zone)).day : null,
      pages: pagesOf(entry.bookId),
    });
  }
  return finishes.sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity));
}
