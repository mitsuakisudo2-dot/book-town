import assert from "node:assert/strict";
import type { Encounter, LibraryEntry } from "../src/lib/library";
import type { ReadingCard, ReadingCardBook } from "../src/lib/reading-cards";
import {
  BOOK_KINDS,
  busiest,
  clock,
  elapsedDays,
  finishedIn,
  genreSlices,
  joy,
  kindOf,
  localTime,
  metBooks,
  onlyBooks,
  pace,
  pagesLeft,
  periodAt,
  readDays,
  READ_SECONDS_MAX,
  readingSpeed,
  readableZone,
  sameTimeBefore,
  shape,
  shelfStates,
  stackHeight,
  statsData,
  timeChart,
  timeToFinish,
  totals,
  type BookFacts,
} from "../src/lib/reading-stats";
import type { ReadingSession } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const at = (iso: string) => Date.parse(iso);
const HOUR = 3600;

// A small reader's town to count: a reading is a session, a card and the card's book.
function reader() {
  const town = {
    readingSessions: [] as ReadingSession[],
    readingCards: [] as ReadingCard[],
    readingCardBooks: [] as ReadingCardBook[],
    libraryEntries: {} as Record<string, LibraryEntry>,
    encounters: [] as Encounter[],
  };
  let n = 0;
  const read = (
    bookId: string | null,
    start: string,
    end: string | null,
    book: Partial<ReadingCardBook> = {},
    card: Partial<ReadingCard> = {},
  ) => {
    n += 1;
    const id = `s${n}`;
    town.readingSessions.push({
      id,
      bookId,
      mode: "solo",
      startedAt: start,
      endedAt: end,
    });
    town.readingCards.push({
      id: `c${n}`,
      timeZone: "Asia/Tokyo",
      addedLater: false,
      pausedAt: null,
      pausedSeconds: 0,
      timer: "none",
      timerMinutes: null,
      restMinutes: null,
      timerAt: null,
      room: null,
      light: null,
      look: null,
      createdAt: start,
      ...card,
    });
    town.readingCardBooks.push({
      sessionId: id,
      cardId: `c${n}`,
      readSeconds: null,
      pageFrom: null,
      pageTo: null,
      pageUnit: "page",
      format: null,
      finished: false,
      createdAt: start,
      ...book,
    });
  };
  const shelve = (bookId: string, entry: Partial<LibraryEntry> = {}) => {
    town.libraryEntries[bookId] = {
      bookId,
      status: null,
      statusAt: null,
      wantedAt: null,
      likedAt: null,
      owned: null,
      source: "scan",
      batchId: null,
      addedAt: "2026-01-01T00:00:00Z",
      removedAt: null,
      likeRestored: false,
      everUsed: false,
      ...entry,
    };
  };
  return { town, read, shelve };
}

const FACTS: Record<string, BookFacts> = {
  a: { pages: 300, genre: "日本の小説" },
  b: { pages: 200, genre: "海外の小説" },
  c: { pages: null, genre: null },
  d: { pages: 100, genre: "マンガ" },
};
const facts = (bookId: string) => FACTS[bookId];
const NOW = at("2026-10-28T12:00:00+09:00");

check("a card's zone is read as it was kept; one not known, as Japan", () => {
  const midnight = at("2026-10-27T15:30:00Z");
  assert.deepEqual(localTime(midnight, "Asia/Tokyo"), {
    day: "2026-10-28",
    hour: 0,
    weekday: 3,
  });
  // +09:00 is east of UTC, as ISO writes it (SQL's at time zone reads it the other way).
  assert.deepEqual(
    localTime(midnight, "+09:00"),
    localTime(midnight, "Asia/Tokyo"),
  );
  assert.equal(localTime(midnight, "-05:00").day, "2026-10-27");
  assert.equal(localTime(midnight, "America/New_York").hour, 11);
  assert.equal(readableZone("Etc/Unknown"), "Asia/Tokyo");
  assert.equal(readableZone("+99:99"), "Asia/Tokyo");
  assert.equal(localTime(midnight, "Etc/Unknown").day, "2026-10-28");
});

check(
  "periods: a week begins on Monday, a month and a year end on their last day",
  () => {
    assert.deepEqual(periodAt("week", "2026-10-28"), {
      kind: "week",
      from: "2026-10-26",
      to: "2026-11-01",
    });
    assert.deepEqual(periodAt("month", "2026-02-10", 0), {
      kind: "month",
      from: "2026-02-01",
      to: "2026-02-28",
    });
    assert.deepEqual(periodAt("month", "2026-01-10", -1).from, "2025-12-01");
    assert.deepEqual(periodAt("year", "2026-10-28", -1), {
      kind: "year",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    assert.deepEqual(
      periodAt("all", "2026-10-28", 0, "2024-05-01").from,
      "2024-05-01",
    );
  },
);

check(
  "rule 1: an average is over the days from the later of the period's start and the first record, to today",
  () => {
    const year = periodAt("year", "2026-10-28");
    assert.equal(elapsedDays(year, "2026-10-28", "2025-01-01"), 301);
    assert.equal(elapsedDays(year, "2026-10-28", "2026-10-01"), 28);
    // A period over counts to its end.
    assert.equal(
      elapsedDays(periodAt("year", "2025-03-01"), "2026-10-28", "2025-01-01"),
      365,
    );
  },
);

check(
  "the same time before: to the day as far in, and none before the records began",
  () => {
    const year = periodAt("year", "2026-10-28");
    assert.deepEqual(sameTimeBefore(year, "2026-10-28", "2025-01-01"), {
      kind: "year",
      from: "2025-01-01",
      to: "2025-10-28",
    });
    assert.equal(
      sameTimeBefore(year, "2026-10-28", "2025-06-01")?.from,
      "2025-01-01",
    );
    assert.equal(sameTimeBefore(year, "2026-10-28", "2026-02-01"), null);
    assert.deepEqual(
      sameTimeBefore(
        periodAt("month", "2026-03-31"),
        "2026-03-31",
        "2025-01-01",
      ),
      { kind: "month", from: "2026-02-01", to: "2026-02-28" },
    );
    assert.equal(
      sameTimeBefore(periodAt("day", "2026-10-28"), "2026-10-28", "2025-01-01"),
      null,
    );
  },
);

check(
  "time read leaves pauses out (as the card counted it) and stops at 12 hours",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-27T20:00:00+09:00", "2026-10-27T21:00:00+09:00", {
      readSeconds: 50 * 60,
    });
    // A clock left running for a month.
    read("b", "2026-09-01T20:00:00+09:00", "2026-10-01T20:00:00+09:00");
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    assert.equal(data.spans[1].seconds, 50 * 60);
    assert.equal(data.spans[0].seconds, READ_SECONDS_MAX);
    const year = totals(data, periodAt("year", data.today));
    assert.equal(year.seconds, 50 * 60 + READ_SECONDS_MAX);
    assert.equal(year.readings, 2);
  },
);

check(
  "a clock left running is laid from its start: the days after are not days read",
  () => {
    const { town, read } = reader();
    read("a", "2026-08-01T20:00:00+09:00", "2026-10-27T20:00:00+09:00");
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const days = readDays(data, periodAt("year", data.today));
    assert.deepEqual([...days.keys()], ["2026-08-01", "2026-08-02"]);
    assert.equal(days.get("2026-08-01"), 4 * HOUR);
    assert.equal(totals(data, periodAt("month", data.today)).days, 0);
    // The finish, had it been one, is still when it ended.
    assert.equal(data.spans[0].end, at("2026-10-27T20:00:00+09:00"));
  },
);

check(
  "the rest of a book finished without its last page is in the pages read, not in the pace",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
      pageTo: 60,
    });
    read("a", "2026-10-02T20:00:00+09:00", "2026-10-02T20:10:00+09:00", {
      finished: true,
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    assert.equal(totals(data, periodAt("month", data.today)).pages, 300);
    assert.deepEqual(readingSpeed(data, periodAt("month", data.today)), {
      pagesPerSecond: 60 / HOUR,
      of: "period",
    });
  },
);

check(
  "a reading over midnight is shared between the two days by the clock",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-26T23:30:00+09:00", "2026-10-27T00:30:00+09:00", {
      pageFrom: 10,
      pageTo: 50,
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const days = readDays(data, periodAt("week", data.today));
    assert.equal(days.get("2026-10-26"), 30 * 60);
    assert.equal(days.get("2026-10-27"), 30 * 60);
    const today = totals(data, periodAt("day", "2026-10-27"));
    assert.equal(today.pages, 20);
    assert.equal(today.days, 1);
  },
);

check(
  "the hours are the card's own: a reading abroad falls in its own evening",
  () => {
    const { town, read } = reader();
    read(
      "a",
      "2026-10-28T00:00:00Z",
      "2026-10-28T01:00:00Z",
      {},
      { timeZone: "America/New_York" },
    );
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const hours = clock(data, periodAt("year", data.today), "time").hours;
    assert.equal(hours[20], HOUR);
    assert.equal(data.pieces[0].day, "2026-10-27");
  },
);

check(
  "pages: where a reading ended less where it began, else where the book's last reading ended",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
      pageTo: 40,
    });
    read("a", "2026-10-02T20:00:00+09:00", "2026-10-02T21:00:00+09:00", {
      pageTo: 90,
    });
    read("a", "2026-10-03T20:00:00+09:00", "2026-10-03T21:00:00+09:00", {
      pageFrom: 100,
      pageTo: 120,
    });
    // Percent and audio are not pages.
    read("b", "2026-10-04T20:00:00+09:00", "2026-10-04T21:00:00+09:00", {
      pageTo: 50,
      pageUnit: "percent",
    });
    read("d", "2026-10-05T20:00:00+09:00", "2026-10-05T21:00:00+09:00", {
      pageTo: 30,
      format: "audio",
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    assert.deepEqual(
      data.spans.map((span) => span.pages),
      [40, 50, 20, 0, 0],
    );
    assert.equal(data.positions.get("a"), 120);
    assert.equal(pagesLeft(data, "a"), 180);
    assert.equal(pagesLeft(data, "c"), null);
  },
);

check(
  "a book finished without its last page written down gets the rest of its pages that day",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
      pageTo: 100,
    });
    read("a", "2026-10-02T20:00:00+09:00", "2026-10-02T21:00:00+09:00", {
      finished: true,
    });
    // Read again: from the start.
    read("a", "2026-10-10T20:00:00+09:00", "2026-10-10T21:00:00+09:00", {
      pageTo: 30,
    });
    // Pages not known: nothing to add.
    read("c", "2026-10-11T20:00:00+09:00", "2026-10-11T21:00:00+09:00", {
      finished: true,
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    assert.deepEqual(
      data.spans.map((span) => span.pages),
      [100, 200, 30, 0],
    );
    assert.equal(data.positions.get("a"), 30);
    assert.equal(data.positions.has("c"), false);
  },
);

check(
  "finished: each card that says so (a book read again counts again); the library's only when no card does",
  () => {
    const { town, read, shelve } = reader();
    read("a", "2026-03-01T20:00:00+09:00", "2026-03-01T21:00:00+09:00", {
      finished: true,
    });
    read("a", "2026-09-01T20:00:00+09:00", "2026-09-01T21:00:00+09:00", {
      finished: true,
    });
    shelve("a", { status: "finished", statusAt: "2026-09-01T12:00:00Z" });
    // Made 読了 a week after it was registered: dated.
    shelve("b", {
      status: "finished",
      addedAt: "2026-05-01T00:00:00Z",
      statusAt: "2026-05-08T00:00:00Z",
    });
    // Registered as 読了: when it was read is not known.
    shelve("d", {
      status: "finished",
      addedAt: "2026-10-20T00:00:00Z",
      statusAt: "2026-10-20T00:00:00.500Z",
    });
    // Taken out of the library: not counted.
    shelve("c", {
      status: "finished",
      statusAt: "2026-06-01T00:00:00Z",
      removedAt: "2026-06-02T00:00:00Z",
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const year = periodAt("year", data.today);
    assert.deepEqual(
      finishedIn(data, year).map((finish) => finish.bookId),
      ["a", "b", "a"],
    );
    const all = periodAt("all", data.today, 0, data.first ?? data.today);
    assert.deepEqual(
      finishedIn(data, all)
        .map((finish) => finish.bookId)
        .sort(),
      ["a", "a", "b", "d"],
    );
    assert.equal(finishedIn(data, periodAt("day", "2026-10-20")).length, 0);
  },
);

check(
  "an added-later reading with no length is a day read and its pages, but no time and no hour",
  () => {
    const { town, read } = reader();
    read(
      "a",
      "2026-10-20T09:00:00+09:00",
      "2026-10-20T09:00:00+09:00",
      { readSeconds: 0, pageTo: 60 },
      { addedLater: true },
    );
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const week = periodAt("month", data.today);
    const sums = totals(data, week);
    assert.equal(sums.days, 1);
    assert.equal(sums.pages, 60);
    assert.equal(sums.seconds, 0);
    assert.equal(sums.readings, 0);
    assert.equal(clock(data, week, "count").hours[9], 0);
  },
);

check("the reading running now counts up to now", () => {
  const { town, read } = reader();
  read("a", "2026-10-28T11:00:00+09:00", null);
  const data = statsData(town, NOW, "Asia/Tokyo", facts);
  assert.equal(totals(data, periodAt("day", data.today)).seconds, HOUR);
});

check(
  "the time chart: a year by months, a month by days, a day by hours, ぜんぶ by years",
  () => {
    const { town, read } = reader();
    read("a", "2025-12-31T20:00:00+09:00", "2025-12-31T21:00:00+09:00");
    read("a", "2026-10-27T20:00:00+09:00", "2026-10-27T22:00:00+09:00");
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const year = timeChart(data, periodAt("year", data.today));
    assert.equal(year.length, 12);
    assert.equal(year[9].seconds, 2 * HOUR);
    assert.deepEqual([year[9].from, year[9].to], ["2026-10-01", "2026-10-31"]);
    const month = timeChart(data, periodAt("month", data.today));
    assert.equal(month.length, 31);
    assert.equal(month[26].seconds, 2 * HOUR);
    const day = timeChart(data, periodAt("day", "2026-10-27"));
    assert.equal(day.length, 24);
    assert.equal(day[20].seconds + day[21].seconds, 2 * HOUR);
    const all = timeChart(data, periodAt("all", data.today, 0, data.first!));
    assert.deepEqual(
      all.map((bar) => [bar.from, bar.seconds]),
      [
        ["2025-12-31", HOUR],
        ["2026-01-01", 2 * HOUR],
      ],
    );
    const custom = timeChart(data, {
      kind: "custom",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    assert.equal(custom.length, 6);
  },
);

check(
  "the clock is said outright only after 10 timed readings; counts are readings begun",
  () => {
    const { town, read } = reader();
    for (let day = 1; day <= 9; day++)
      read(
        "a",
        `2026-10-0${day}T21:00:00+09:00`,
        `2026-10-0${day}T22:00:00+09:00`,
      );
    let data = statsData(town, NOW, "Asia/Tokyo", facts);
    const year = periodAt("year", data.today);
    assert.equal(clock(data, year, "time").sure, false);
    assert.equal(clock(data, year, "count").hours[21], 9);
    read("a", "2026-10-10T21:00:00+09:00", "2026-10-10T22:00:00+09:00");
    data = statsData(town, NOW, "Asia/Tokyo", facts);
    const times = clock(data, year, "time");
    assert.equal(times.sure, true);
    assert.equal(times.grid[6][5], 2 * HOUR); // 土曜 20–24: 10/3 and 10/10
    assert.deepEqual(busiest(times.hours), [21]);
    assert.deepEqual(busiest([0, 0]), []);
    assert.deepEqual(busiest([95, 0, 0, 0, 0, 0, 100], 0.1), [6, 0]);
  },
);

check(
  "genres: finished books by count or pages, time read; the unknown and past five in そのほか",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
      finished: true,
    });
    read("b", "2026-10-02T20:00:00+09:00", "2026-10-02T23:00:00+09:00", {
      finished: true,
    });
    read("c", "2026-10-03T20:00:00+09:00", "2026-10-03T21:00:00+09:00", {
      finished: true,
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const year = periodAt("year", data.today);
    assert.deepEqual(genreSlices(data, year, "pages"), [
      { genre: "日本の小説", value: 300 },
      { genre: "海外の小説", value: 200 },
    ]);
    assert.deepEqual(genreSlices(data, year, "time")[0], {
      genre: "海外の小説",
      value: 3 * HOUR,
    });
    assert.equal(
      genreSlices(data, year, "count").find(
        (slice) => slice.genre === "そのほか",
      )?.value,
      1,
    );
    const many: Record<string, BookFacts> = {};
    const { town: wide, read: readWide } = reader();
    for (let i = 0; i < 8; i++) {
      many[`g${i}`] = { pages: 100, genre: `ジャンル${i}` };
      for (let j = 0; j <= i; j++)
        readWide(
          `g${i}`,
          `2026-10-0${j + 1}T0${i}:00:00+09:00`,
          `2026-10-0${j + 1}T0${i}:30:00+09:00`,
          { finished: true },
        );
    }
    const slices = genreSlices(
      statsData(wide, NOW, "Asia/Tokyo", (id) => many[id]),
      year,
      "count",
    );
    assert.equal(slices.length, 6);
    assert.deepEqual(slices.at(-1), { genre: "そのほか", value: 1 + 2 + 3 });
  },
);

check(
  "the pace looks ahead for a year or month with a book finished and 2 weeks of records",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-20T20:00:00+09:00", "2026-10-20T21:00:00+09:00", {
      pageTo: 100,
    });
    read("a", "2026-10-25T20:00:00+09:00", "2026-10-25T21:00:00+09:00", {
      finished: true,
    });
    let data = statsData(town, NOW, "Asia/Tokyo", facts);
    const year = periodAt("year", data.today);
    assert.equal(pace(data, year).ahead, null); // 9 days of records
    read("b", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00");
    data = statsData(town, NOW, "Asia/Tokyo", facts);
    const ahead = pace(data, year);
    // 1 book in 28 days (10/1–10/28), over the 365 of the year.
    assert.ok(Math.abs((ahead.ahead ?? 0) - 365 / 28) < 1e-9);
    assert.deepEqual(ahead.line, [{ day: "2026-10-25", books: 1 }]);
    assert.equal(ahead.daysPerBook, 6); // 10/20 to 10/25
    assert.equal(pace(data, periodAt("week", data.today)).ahead, null);
    assert.equal(pace(data, periodAt("year", "2025-06-01")).ahead, null);
  },
);

check(
  "speed: of the period, else the last year, else all; only readings with time and pages",
  () => {
    const { town, read } = reader();
    read("a", "2025-01-10T20:00:00+09:00", "2025-01-10T21:00:00+09:00", {
      pageTo: 60,
    });
    read("b", "2026-10-27T20:00:00+09:00", "2026-10-27T21:00:00+09:00"); // no pages
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    const speed = readingSpeed(data, periodAt("week", data.today));
    assert.deepEqual(speed, { pagesPerSecond: 60 / HOUR, of: "ever" });
    // Rule 3: a book of its own pace finishes at it; another at the speed given.
    assert.equal(timeToFinish(data, "a", speed), (240 / 60) * HOUR);
    assert.equal(timeToFinish(data, "b", speed), (200 / 60) * HOUR);
    assert.equal(timeToFinish(data, "c", speed), null);
  },
);

check(
  "the shelf by status, and the joy of the books waiting (unknown pages taken as the usual)",
  () => {
    const { town, read, shelve } = reader();
    read("a", "2026-10-27T20:00:00+09:00", "2026-10-27T21:00:00+09:00", {
      pageTo: 100,
    });
    shelve("a", { status: "reading" });
    shelve("b", { status: "tsundoku" });
    shelve("c", { status: "tsundoku", wantedAt: "2026-10-01T00:00:00Z" });
    shelve("d", { status: "finished" });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    assert.deepEqual(shelfStates(data), {
      tsundoku: ["b", "c"],
      reading: ["a"],
      finished: ["d"],
      wanted: ["c"],
    });
    const speed = readingSpeed(data, periodAt("year", data.today));
    // 100 pages an hour; c is as thick as the library's average, 200.
    assert.deepEqual(joy(data, speed), {
      tsundokuSeconds: 4 * HOUR,
      readingSeconds: 2 * HOUR,
      guessed: 1,
    });
    assert.equal(joy(data, null), null);
  },
);

check("met in the town: finished books met before they were finished", () => {
  const { town, read } = reader();
  read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
    finished: true,
  });
  read("b", "2026-10-02T20:00:00+09:00", "2026-10-02T21:00:00+09:00", {
    finished: true,
  });
  const met = (
    bookId: string,
    createdAt: string,
    via: Encounter["via"],
  ): Encounter => ({
    id: `e-${bookId}`,
    bookId,
    kind: "want",
    via,
    postId: null,
    shopId: null,
    placementKey: null,
    otherReaderId: null,
    memo: null,
    memoAt: null,
    undoneAt: null,
    createdAt,
  });
  town.encounters = [
    met("a", "2026-09-01T00:00:00Z", "pop"),
    met("b", "2026-10-05T00:00:00Z", "post"),
  ];
  const data = statsData(town, NOW, "Asia/Tokyo", facts);
  assert.deepEqual(
    metBooks(data, periodAt("year", data.today)).map((m) => [
      m.finish.bookId,
      m.via,
    ]),
    [["a", "pop"]],
  );
});

check(
  "the stack: finished books' pages as thickness, the unknown counted aside",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
      finished: true,
    });
    read("c", "2026-10-02T20:00:00+09:00", "2026-10-02T21:00:00+09:00", {
      finished: true,
    });
    const data = statsData(town, NOW, "Asia/Tokyo", facts);
    assert.deepEqual(stackHeight(data, periodAt("year", data.today)), {
      mm: 15,
      unknown: 1,
    });
  },
);

check(
  "the shape of reading, from finished books, or from reading under 3",
  () => {
    const { town, read } = reader();
    read("a", "2026-10-04T21:00:00+09:00", "2026-10-04T22:00:00+09:00", {
      finished: true,
    }); // 日曜
    read("b", "2026-10-05T07:00:00+09:00", "2026-10-05T07:30:00+09:00", {
      finished: true,
    });
    let data = statsData(town, NOW, "Asia/Tokyo", facts);
    const year = periodAt("year", data.today);
    let way = shape(data, year);
    assert.equal(way.fromReading, true);
    assert.equal(way.band, 5);
    assert.equal(way.genre, "日本の小説");
    assert.deepEqual(way.weekdays, [0]);
    read("d", "2026-10-06T21:00:00+09:00", "2026-10-06T22:00:00+09:00", {
      finished: true,
    });
    data = statsData(town, NOW, "Asia/Tokyo", facts);
    way = shape(data, year);
    assert.equal(way.fromReading, false);
    assert.equal(way.averagePages, 200);
    assert.equal(way.pagesFrom, 100); // 300, 200, 100: one each, the thinnest first
  },
);

check(
  "見る本: the kinds take every one of the 16 genres once, and narrow every count",
  () => {
    const genres = BOOK_KINDS.flatMap((entry) => [...entry.genres]);
    assert.equal(genres.length, 16);
    assert.equal(new Set(genres).size, 16);
    assert.equal(kindOf("マンガ"), "マンガ");
    assert.equal(kindOf(null), "そのほか");
    const { town, read } = reader();
    read("a", "2026-10-01T20:00:00+09:00", "2026-10-01T21:00:00+09:00", {
      finished: true,
    });
    read("d", "2026-10-02T20:00:00+09:00", "2026-10-02T21:00:00+09:00", {
      finished: true,
    });
    const data = onlyBooks(
      statsData(town, NOW, "Asia/Tokyo", facts),
      (id) => kindOf(facts(id)?.genre ?? null) === "小説",
    );
    const year = totals(data, periodAt("year", data.today));
    assert.equal(year.finished.length, 1);
    assert.equal(year.seconds, HOUR);
  },
);

console.log(`reading-stats: ${passed} passed`);
