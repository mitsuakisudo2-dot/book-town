// The numbers each card of the statistics screen shows, worked out from the
// reader's own records (StatsData) for one period. Numbers only, kept
// whole: the screen rounds and words them (rule 4: time taken is cut down,
// an estimate rounded with 約). The settled rules are the memo
// booktown-stats-calc-rules; what each card answers is the 刷新版 summary
// (統計_工事向けのまとめ_刷新版_2026-10-28.md).

import type { Encounter, EncounterVia, LibraryEntry } from "../library";
import type { TownState } from "../types";
import {
  elapsedDays,
  inPeriod,
  periodAt,
  periodDays,
  type Period,
} from "./periods";
import {
  bookPositions,
  finishesOf,
  piecesOf,
  readSpans,
  type FactsOf,
  type Finish,
  type Piece,
  type ReadSpan,
} from "./records";
import {
  addDays,
  dayNumber,
  localTime,
  readableZone,
  type DayKey,
} from "./zone";

/** Readings timed before 「夜更けの読書家」 is said outright, not 「いまのところ夜が多め」 (v160). */
export const CLOCK_SURE_READINGS = 10;
/** Days of records before the pace looks ahead (v159: 2 weeks, and a book finished). */
export const PACE_DAYS = 14;
/** The bars of the time chart are days up to this many days chosen, months beyond. */
export const CHART_DAYS_MAX = 62;
/** A page's share of a book's thickness: a leaf of 0.1 mm holds two pages. */
export const PAGE_MM = 0.05;
/** The genre slices shown: the largest five and the rest together. */
export const GENRE_SLICES = 6;
/** The genre the rest, and the books of no known genre, are counted in. */
export const OTHER_GENRE = "そのほか";
/** Books in the reader's library, by status (積読・読書中・読了), and 読みたい. */
export interface ShelfStates {
  tsundoku: string[];
  reading: string[];
  finished: string[];
  wanted: string[];
}

export interface StatsData {
  spans: ReadSpan[];
  pieces: Piece[];
  finishes: Finish[];
  /** Where each book being read stands: the page its last span ended at. */
  positions: Map<string, number>;
  library: LibraryEntry[];
  encounters: Encounter[];
  facts: FactsOf;
  today: DayKey;
  /** The first day of the records, or null before any. */
  first: DayKey | null;
}

/** The reader's records ready to count, by `now` on the clock of `zone` (the device's). */
export function statsData(
  state: Pick<
    TownState,
    | "readingSessions"
    | "readingCards"
    | "readingCardBooks"
    | "libraryEntries"
    | "encounters"
  >,
  now: number,
  zone: string,
  facts: FactsOf,
): StatsData {
  const spans = readSpans(state, now, facts);
  const pieces = spans.flatMap(piecesOf);
  const finishes = finishesOf(spans, state.libraryEntries, facts, zone);
  const days = [
    ...pieces.map((piece) => piece.day),
    ...finishes.flatMap((finish) => (finish.day ? [finish.day] : [])),
  ].sort();
  return {
    spans,
    pieces,
    finishes,
    positions: bookPositions(state, spans),
    library: Object.values(state.libraryEntries).filter(
      (entry) => entry.removedAt === null,
    ),
    encounters: state.encounters,
    facts,
    today: localTime(now, readableZone(zone)).day,
    first: days[0] ?? null,
  };
}

/** The same records, only those of the books kept (見る本). */
export function onlyBooks(
  data: StatsData,
  keep: (bookId: string) => boolean,
): StatsData {
  const kept = (bookId: string | null) => bookId !== null && keep(bookId);
  return {
    ...data,
    spans: data.spans.filter((span) => kept(span.bookId)),
    pieces: data.pieces.filter((piece) => kept(piece.span.bookId)),
    finishes: data.finishes.filter((finish) => kept(finish.bookId)),
    library: data.library.filter((entry) => kept(entry.bookId)),
  };
}

const piecesIn = (data: StatsData, period: Period) =>
  data.pieces.filter((piece) => inPeriod(period, piece.day));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** The books finished in the period: dated ones, and in ぜんぶ the undated too. */
export const finishedIn = (data: StatsData, period: Period): Finish[] =>
  data.finishes.filter(
    (finish) =>
      inPeriod(period, finish.day) ||
      (period.kind === "all" && finish.day === null),
  );

export interface Totals {
  finished: Finish[];
  pages: number;
  seconds: number;
  /** Days anything was read on. */
  days: number;
  /** Readings (cards) timed in the period: 177回. */
  readings: number;
}

/** 今年の読書: the four numbers of the period. */
export function totals(data: StatsData, period: Period): Totals {
  const pieces = piecesIn(data, period);
  return {
    finished: finishedIn(data, period),
    pages: sum(pieces.map((piece) => piece.pages)),
    seconds: sum(pieces.map((piece) => piece.seconds)),
    days: new Set(pieces.map((piece) => piece.day)).size,
    readings: new Set(
      pieces
        .filter((piece) => piece.span.timed && piece.seconds > 0)
        .map((piece) => piece.span.readingId),
    ).size,
  };
}

export interface Bar {
  from: DayKey;
  to: DayKey;
  /** The hour, for the bars of one day. */
  hour?: number;
  seconds: number;
}

/** 読書時間チャート: a day by hours, a week or month by days, a year by months, ぜんぶ by years. */
export function timeChart(data: StatsData, period: Period): Bar[] {
  const pieces = piecesIn(data, period);
  if (period.kind === "day")
    return Array.from({ length: 24 }, (_, hour) => ({
      from: period.from,
      to: period.to,
      hour,
      seconds: sum(
        pieces.filter((piece) => piece.hour === hour).map((p) => p.seconds),
      ),
    }));
  const bars: Bar[] = [];
  const unit =
    period.kind === "all"
      ? "year"
      : period.kind === "year" ||
          (period.kind === "custom" && periodDays(period) > CHART_DAYS_MAX)
        ? "month"
        : "day";
  for (let from = period.from; from <= period.to;) {
    const step = unit === "day" ? { from, to: from } : periodAt(unit, from);
    const bar = {
      from: step.from < period.from ? period.from : step.from,
      to: step.to > period.to ? period.to : step.to,
    };
    bars.push({
      ...bar,
      seconds: sum(
        pieces
          .filter((piece) => piece.day >= bar.from && piece.day <= bar.to)
          .map((piece) => piece.seconds),
      ),
    });
    from = addDays(bar.to, 1);
  }
  return bars;
}

/** The average a day over the period (rule 1); a month is 365/12 days, a year 365. */
export const perDay = (
  data: StatsData,
  period: Period,
  amount: number,
): number => amount / elapsedDays(period, data.today, data.first);

/** 読んだ日: the seconds read on each day of the period that anything was read on. */
export function readDays(data: StatsData, period: Period): Map<DayKey, number> {
  const days = new Map<DayKey, number>();
  for (const piece of piecesIn(data, period))
    days.set(piece.day, (days.get(piece.day) ?? 0) + piece.seconds);
  return days;
}

export interface Clock {
  /** By the hour, 0–23. */
  hours: number[];
  /** By weekday, 0 Sunday … 6 Saturday. */
  weekdays: number[];
  /** Weekday by four hours (0–4, 4–8 … 20–24). */
  grid: number[][];
  /** Enough readings timed, in all, to say it outright (CLOCK_SURE_READINGS). */
  sure: boolean;
}

/** よく読む曜日と時間帯: time read, or readings begun, by hour and weekday. Only timed readings count. */
export function clock(
  data: StatsData,
  period: Period,
  by: "time" | "count",
): Clock {
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  const grid = Array.from({ length: 7 }, () => Array<number>(6).fill(0));
  const add = (piece: Piece, value: number) => {
    hours[piece.hour] += value;
    weekdays[piece.weekday] += value;
    grid[piece.weekday][Math.floor(piece.hour / 4)] += value;
  };
  const timed = (piece: Piece) => piece.span.timed && piece.seconds > 0;
  if (by === "time")
    for (const piece of piecesIn(data, period))
      if (timed(piece)) add(piece, piece.seconds);
  if (by === "count") {
    const begun = new Set<string>();
    for (const piece of piecesIn(data, period))
      if (timed(piece) && !begun.has(piece.span.readingId)) {
        begun.add(piece.span.readingId);
        add(piece, 1);
      }
  }
  const readings = new Set(
    data.pieces.filter(timed).map((piece) => piece.span.readingId),
  );
  return {
    hours,
    weekdays,
    grid,
    sure: readings.size >= CLOCK_SURE_READINGS,
  };
}

/** The places of the largest values, the first only, or two within a tenth of each other (日曜と土曜). */
export function busiest(values: number[], within = 0): number[] {
  const top = Math.max(...values);
  if (!(top > 0)) return [];
  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value >= top * (1 - within))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, within ? 2 : 1)
    .map(({ index }) => index);
}

export type GenreBy = "count" | "pages" | "time";
export interface Slice {
  genre: string;
  value: number;
}

const genreOf = (data: StatsData, bookId: string | null) =>
  (bookId && data.facts(bookId)?.genre) || OTHER_GENRE;

/**
 * どのジャンルをよく読んだ？: the books finished by count or pages, or the
 * time read, by genre, largest first; past GENRE_SLICES the rest join
 * そのほか. A book of no known genre is counted in そのほか.
 */
export function genreSlices(
  data: StatsData,
  period: Period,
  by: GenreBy,
): Slice[] {
  const values = new Map<string, number>();
  const add = (genre: string, value: number) =>
    values.set(genre, (values.get(genre) ?? 0) + value);
  if (by === "time")
    for (const piece of piecesIn(data, period))
      add(genreOf(data, piece.span.bookId), piece.seconds);
  else
    for (const finish of finishedIn(data, period))
      add(
        genreOf(data, finish.bookId),
        by === "count" ? 1 : (finish.pages ?? 0),
      );
  const slices = [...values]
    .filter(([, value]) => value > 0)
    .map(([genre, value]) => ({ genre, value }))
    .sort((a, b) => b.value - a.value || a.genre.localeCompare(b.genre));
  if (slices.length <= GENRE_SLICES) return slices;
  const kept = slices
    .filter((slice) => slice.genre !== OTHER_GENRE)
    .slice(0, GENRE_SLICES - 1);
  const rest = sum(
    slices.filter((slice) => !kept.includes(slice)).map((slice) => slice.value),
  );
  return [...kept, { genre: OTHER_GENRE, value: rest }];
}

export interface Speed {
  pagesPerSecond: number;
  /** Whose pace it is: the period's, the last year's, or all the records'. */
  of: "period" | "year" | "ever";
}

/**
 * The pace to look ahead with (rule 2): of the period chosen, else the last
 * 365 days, else all. Only spans with both time and pages count, so a
 * reading without its pages written down does not make the pace look slow.
 */
export function readingSpeed(data: StatsData, period: Period): Speed | null {
  const year: Period = {
    kind: "custom",
    from: addDays(data.today, -364),
    to: data.today,
  };
  const ever: Period = { kind: "all", from: "0000-01-01", to: "9999-12-31" };
  for (const [of, within] of [
    ["period", period],
    ["year", year],
    ["ever", ever],
  ] as const) {
    const pieces = piecesIn(data, within).filter(
      (piece) =>
        piece.span.timed &&
        piece.span.seconds > 0 &&
        piece.span.writtenPages > 0,
    );
    const seconds = sum(pieces.map((piece) => piece.seconds));
    if (seconds > 0)
      return {
        pagesPerSecond:
          sum(pieces.map((piece) => piece.writtenPages)) / seconds,
        of,
      };
  }
  return null;
}

export interface Pace {
  /** このまま読むと: books finished by the period's end at this pace, unrounded; null when not to be said. */
  ahead: number | null;
  /** The books finished so far in the period, by day, for the line. */
  line: { day: DayKey; books: number }[];
  /** 1冊にかかる日数: from a book's first day of reading to the day it was finished. */
  daysPerBook: number | null;
}

/** 今年のペース. The look ahead is for a year or a month, with a book finished and two weeks of records (v159). */
export function pace(data: StatsData, period: Period): Pace {
  const finished = finishedIn(data, period).filter((finish) => finish.day);
  let books = 0;
  const line = finished.map((finish) => ({
    day: finish.day as DayKey,
    books: ++books,
  }));
  const recorded =
    data.first === null ? 0 : dayNumber(data.today) - dayNumber(data.first) + 1;
  const looks =
    (period.kind === "year" || period.kind === "month") &&
    inPeriod(period, data.today) &&
    finished.length > 0 &&
    recorded >= PACE_DAYS;
  return {
    ahead: looks
      ? (finished.length / elapsedDays(period, data.today, data.first)) *
        periodDays(period)
      : null,
    line,
    daysPerBook: average(
      finished.flatMap((finish) => {
        const began = readingBegan(data, finish);
        return began
          ? [dayNumber(finish.day as DayKey) - dayNumber(began) + 1]
          : [];
      }),
    ),
  };
}

const average = (values: number[]) =>
  values.length ? sum(values) / values.length : null;

/** The first day of the reading a finish ended: after the book's finish before it. */
function readingBegan(data: StatsData, finish: Finish): DayKey | null {
  const before = data.finishes
    .filter(
      (other) =>
        other.bookId === finish.bookId &&
        other.at !== null &&
        other.at < (finish.at as number),
    )
    .map((other) => other.at as number);
  const after = before.length ? Math.max(...before) : -Infinity;
  const first = data.pieces.find(
    (piece) =>
      piece.span.bookId === finish.bookId &&
      piece.span.start > after &&
      piece.span.start <= (finish.at as number),
  );
  return first?.day ?? null;
}

/** The pages left of a book being read, when its pages are known. */
export function pagesLeft(data: StatsData, bookId: string): number | null {
  const pages = data.facts(bookId)?.pages ?? null;
  return pages === null
    ? null
    : Math.max(0, pages - (data.positions.get(bookId) ?? 0));
}

/** The seconds to finish a book (rule 3): at its own pace when it has one, else at `speed`. */
export function timeToFinish(
  data: StatsData,
  bookId: string,
  speed: Speed | null,
): number | null {
  const left = pagesLeft(data, bookId);
  const own = data.spans.filter(
    (span) =>
      span.bookId === bookId &&
      span.timed &&
      span.seconds > 0 &&
      span.writtenPages > 0,
  );
  const ownSeconds = sum(own.map((span) => span.seconds));
  const pagesPerSecond = ownSeconds
    ? sum(own.map((span) => span.writtenPages)) / ownSeconds
    : (speed?.pagesPerSecond ?? 0);
  return left === null || !pagesPerSecond ? null : left / pagesPerSecond;
}

/** 本棚の本: the library by status, and 読みたい. */
export function shelfStates(data: StatsData): ShelfStates {
  const of = (has: (entry: LibraryEntry) => boolean) =>
    data.library.filter(has).map((entry) => entry.bookId);
  return {
    tsundoku: of((entry) => entry.status === "tsundoku"),
    reading: of((entry) => entry.status === "reading"),
    finished: of((entry) => entry.status === "finished"),
    wanted: of((entry) => entry.wantedAt !== null),
  };
}

export interface Joy {
  /** The time to read the 積読 through, and what is left of the books being read. */
  tsundokuSeconds: number;
  readingSeconds: number;
  /** Books whose pages are not known, taken as thick as the library's books are on average. */
  guessed: number;
}

/** これからの楽しみ: how long the books waiting would take to read, at `speed`. */
export function joy(data: StatsData, speed: Speed | null): Joy | null {
  if (!speed?.pagesPerSecond) return null;
  const states = shelfStates(data);
  const known = data.library.flatMap(
    (entry) => data.facts(entry.bookId)?.pages ?? [],
  );
  const usual = average(known) ?? 0;
  let guessed = 0;
  const pagesOf = (bookId: string, left: boolean) => {
    const pages = left
      ? pagesLeft(data, bookId)
      : (data.facts(bookId)?.pages ?? null);
    if (pages !== null) return pages;
    guessed += 1;
    return Math.max(0, usual - (left ? (data.positions.get(bookId) ?? 0) : 0));
  };
  const seconds = (books: string[], left: boolean) =>
    sum(books.map((bookId) => pagesOf(bookId, left))) / speed.pagesPerSecond;
  return {
    tsundokuSeconds: seconds(states.tsundoku, false),
    readingSeconds: seconds(states.reading, true),
    guessed,
  };
}

/** BookTown で出会った本: books finished in the period that the reader met in the town first, by where. */
export function metBooks(
  data: StatsData,
  period: Period,
): { finish: Finish; via: EncounterVia }[] {
  return finishedIn(data, period).flatMap((finish) => {
    const met = data.encounters
      .filter(
        (encounter) =>
          encounter.bookId === finish.bookId &&
          (finish.at === null || Date.parse(encounter.createdAt) <= finish.at),
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    return met ? [{ finish, via: met.via }] : [];
  });
}

/** 積んだ高さ: the books finished, stacked, in millimetres; books of unknown pages are left out and counted. */
export function stackHeight(
  data: StatsData,
  period: Period,
): { mm: number; unknown: number } {
  const finished = finishedIn(data, period);
  return {
    mm: sum(finished.map((finish) => (finish.pages ?? 0) * PAGE_MM)),
    unknown: finished.filter((finish) => finish.pages === null).length,
  };
}

export interface Shape {
  /** The four hours read most in (0 for 0–4 … 5 for 20–24), by time; null without timed readings. */
  band: number | null;
  /** The hundred pages most finished books were in (200 for 200–300). */
  pagesFrom: number | null;
  genre: string | null;
  /** The pages of a finished book, on average. */
  averagePages: number | null;
  /** The weekday or two read most. */
  weekdays: number[];
  /** Fewer than 3 books finished: said from what was read (主に夜に◯◯を読みました). */
  fromReading: boolean;
}

/** Books finished before どんな読み方をしている？ is said from them. */
export const SHAPE_BOOKS = 3;

/** どんな読み方をしている？: the reader's way of reading in the period, in a sentence's parts. */
export function shape(data: StatsData, period: Period): Shape {
  const finished = finishedIn(data, period);
  const fromReading = finished.length < SHAPE_BOOKS;
  const times = clock(data, period, "time");
  const bands = times.grid.reduce(
    (sums, row) => sums.map((value, band) => value + row[band]),
    Array<number>(6).fill(0),
  );
  const weekdays = times.weekdays.some((value) => value > 0)
    ? times.weekdays
    : clock(data, period, "count").weekdays;
  const pages = finished.flatMap((finish) =>
    finish.pages === null ? [] : [finish.pages],
  );
  const hundreds = new Map<number, number>();
  for (const value of pages) {
    const from = Math.floor(value / 100) * 100;
    hundreds.set(from, (hundreds.get(from) ?? 0) + 1);
  }
  const genres = fromReading
    ? genreSlices(data, period, "time")
    : genreSlices(data, period, "count");
  return {
    band: busiest(bands)[0] ?? null,
    pagesFrom:
      [...hundreds].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null,
    genre: genres.find((slice) => slice.genre !== OTHER_GENRE)?.genre ?? null,
    averagePages: average(pages),
    weekdays: busiest(weekdays, 0.1),
    fromReading,
  };
}
