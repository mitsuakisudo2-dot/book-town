"use client";

// The twelve cards of the statistics (管理表 19, 刷新版): what each says on a
// half or wide card (its question, one answer, a small drawing) and in full
// (最大, and the sheet a smaller card opens). Numbers come from
// src/lib/reading-stats; words from its words.ts.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { bookById, bookTitle } from "../../lib/book-name";
import { NAMES } from "../../lib/words";
import { walkPath } from "../../lib/paths";
import type { Book, TownState } from "../../lib/types";
import {
  addDays,
  BOOK_KINDS,
  busiest,
  clock,
  dayNumber,
  elapsedDays,
  finishedIn,
  genreSlices,
  joy,
  metBooks,
  OTHER_GENRE,
  pace,
  periodAt,
  periodDays,
  perDay,
  readDays,
  sameTimeBefore,
  shape,
  shelfStates,
  stackHeight,
  timeChart,
  timeToFinish,
  totals,
  weekdayOf,
  type DayKey,
  type GenreBy,
  type Period,
  type Speed,
  type StatCard,
  type StatsData,
  type TileSize,
} from "../../lib/reading-stats";
import {
  aboutTime,
  amount,
  amountWords,
  bandHours,
  BAND_NAMES,
  BAND_READERS,
  cardName,
  grouped,
  NOT_YET,
  periodName,
  STATS_WORDS as W,
  timeAmounts,
  timeWords,
  WEEKDAYS_FROM_MONDAY,
  WEEKDAY_NAMES,
  type Amount,
} from "../../lib/reading-stats/words";
import { BookJacket } from "../ui";
import {
  Amounts,
  Band,
  Bars,
  CardFace,
  Legend,
  Mark,
  MonthDots,
  PaceLine,
  Pile,
  Ring,
  Spines,
  TONES,
  type DayDot,
  type MarkName,
  type Part,
} from "./charts";

/** What every card reads: the records (見る本 applied), the period, the books. */
export interface StatsView {
  state: TownState;
  data: StatsData;
  period: Period;
  speed: Speed | null;
  /** The reader's device's clock, for 読んだ日's month. */
  now: number;
}

const MARK_OF: Record<StatCard, MarkName> = {
  year: "books",
  chart: "chart",
  days: "calendar",
  clock: "moon",
  genre: "pie",
  pace: "rise",
  shelf: "shelf",
  joy: "hourglass",
  met: "house",
  stack: "pile",
  album: "cards",
  shape: "leaf",
};

const bookOf = (view: StatsView, id: string): Book | undefined =>
  bookById(view.state.books, id);

const sumOf = (values: number[]) => values.reduce((a, b) => a + b, 0);

const notYet = <small>{NOT_YET}</small>;

/** The card as a half or wide card shows it. */
export function CardSmall({ card, view }: { card: StatCard; view: StatsView }) {
  const face = FACES[card](view);
  return (
    <CardFace
      name={cardName(card, view.period, view.data.today)}
      icon={<Mark name={MARK_OF[card]} />}
      big={face.big}
      says={face.says}
      drawing={face.drawing}
    />
  );
}

/** The card in full: 最大, and the sheet a smaller one opens. */
export function CardFull({ card, view }: { card: StatCard; view: StatsView }) {
  const Full = FULL[card];
  return <Full view={view} />;
}

/** The card's heading in full. */
export function CardHeading({
  card,
  view,
  as: Tag = "h2",
}: {
  card: StatCard;
  view: StatsView;
  as?: "h2" | "h3";
}) {
  return (
    <Tag className="stats-heading">
      <Mark name={MARK_OF[card]} />
      {cardName(card, view.period, view.data.today)}
    </Tag>
  );
}

export const cardTitle = (card: StatCard, view: StatsView) =>
  cardName(card, view.period, view.data.today);

interface Face {
  big: ReactNode;
  says?: ReactNode;
  drawing?: ReactNode;
}

// ── The answers each card gives ─────────────────────────────────────────────

function yearNumbers(view: StatsView) {
  return totals(view.data, view.period);
}

/** 読書時間チャート's bars: their values, labels and today's. */
function chartBars(view: StatsView) {
  const bars = timeChart(view.data, view.period);
  const today = view.data.today;
  const on = bars.findIndex((bar) => bar.from <= today && today <= bar.to);
  const kind = view.period.kind;
  const labels = bars.map((bar) => {
    if (bar.hour !== undefined)
      return bar.hour % 6 === 0 ? String(bar.hour) : null;
    const [y, m, d] = bar.from.split("-").map(Number);
    if (kind === "all") return String(y);
    if (kind === "year" || (bar.from.slice(8) === "01" && bar.to !== bar.from))
      return String(m);
    if (kind === "week") return WEEKDAY_NAMES[weekdayOf(bar.from)];
    return bars.length > 14
      ? d === 1 || d % 5 === 0
        ? String(d)
        : null
      : String(d);
  });
  return { bars, on, labels };
}

/** The hours by four (0–4 … 20–24), by time read. */
function bands(view: StatsView) {
  const times = clock(view.data, view.period, "time");
  const values = times.grid.reduce(
    (sums, row) => sums.map((value, band) => value + row[band]),
    Array<number>(6).fill(0),
  );
  return { values, top: busiest(values)[0] ?? null, sure: times.sure };
}

function genreParts(view: StatsView, by: GenreBy, most = 4): Part[] {
  const slices = genreSlices(view.data, view.period, by);
  const total = sumOf(slices.map((slice) => slice.value)) || 1;
  const rest = slices.slice(most - 1);
  const shown =
    slices.length > most
      ? [
          ...slices.slice(0, most - 1),
          {
            genre: OTHER_GENRE,
            value: sumOf(rest.map((slice) => slice.value)),
          },
        ]
      : slices;
  return shown.map((slice, at) => ({
    label: slice.genre,
    value: slice.value,
    tone: slice.genre === OTHER_GENRE ? TONES[TONES.length - 1] : TONES[at % 5],
    says: `${Math.round((slice.value / total) * 100)}%`,
  }));
}

/** By what the genres are best counted: books finished, else time, else pages. */
function genreByOf(view: StatsView): GenreBy {
  if (finishedIn(view.data, view.period).length) return "count";
  return totals(view.data, view.period).seconds > 0 ? "time" : "pages";
}

function monthDots(view: StatsView): {
  days: DayDot[];
  count: number;
  month: number;
} {
  const month = periodAt("month", view.data.today);
  const read = readDays(view.data, month);
  const most = Math.max(30 * 60, ...read.values());
  const days: DayDot[] = Array<DayDot>((weekdayOf(month.from) + 6) % 7).fill(
    "pad",
  );
  for (let day = month.from; day <= month.to; day = addDays(day, 1))
    days.push(
      day > view.data.today
        ? "later"
        : {
            read: (read.get(day) ?? 0) / most,
            today: day === view.data.today,
          },
    );
  return {
    days,
    count: [...read.values()].filter((seconds) => seconds > 0).length,
    month: Number(month.from.slice(5, 7)),
  };
}

function shelfParts(view: StatsView): Part[] {
  const states = shelfStates(view.data);
  return [
    { label: W.states.tsundoku, value: states.tsundoku.length, tone: TONES[0] },
    { label: W.states.reading, value: states.reading.length, tone: TONES[1] },
    {
      label: W.states.finished,
      value: states.finished.length,
      tone: "var(--cork)",
    },
  ].map((part) => ({ ...part, says: amountWords(amount(part.value, "冊")) }));
}

function metList(view: StatsView) {
  return metBooks(view.data, view.period).flatMap(({ finish, via }) => {
    const book = bookOf(view, finish.bookId);
    return book ? [{ book, pages: finish.pages, via, finish }] : [];
  });
}

function readingBooks(view: StatsView) {
  return shelfStates(view.data).reading.flatMap((id) => {
    const book = bookOf(view, id);
    return book ? [{ book, pages: view.data.facts(id)?.pages ?? null }] : [];
  });
}

function finishedBooks(view: StatsView) {
  return finishedIn(view.data, view.period).flatMap((finish) => {
    const book = bookOf(view, finish.bookId);
    return book ? [{ book, pages: finish.pages, finish }] : [];
  });
}

function cardsIn(view: StatsView) {
  const cards = view.state.readingCards.filter((card) => {
    const span = view.data.spans.find((one) => one.readingId === card.id);
    return (
      span &&
      view.data.pieces.some(
        (piece) =>
          piece.span === span &&
          piece.day >= view.period.from &&
          piece.day <= view.period.to,
      )
    );
  });
  return { shown: cards, all: view.state.readingCards.length };
}

/**
 * Nothing read yet, ever: the cards say what will come rather than a row of
 * 0s (an empty town shows no 0, login-journey). Once there is a record, a
 * period with none says its 0 (作るときの規格「自分の記録の数は0も出す」).
 */
const fresh = (view: StatsView) =>
  view.data.first === null && !view.data.finishes.length;

const FACES: Record<StatCard, (view: StatsView) => Face> = {
  year: (view) => {
    if (fresh(view)) return { big: notYet, says: W.yearNotYet };
    const sums = yearNumbers(view);
    const reading = readingBooks(view);
    return {
      big: <Amounts parts={[amount(sums.finished.length, "冊")]} />,
      says: W.pagesAndDays(
        amountWords(amount(sums.pages, "ページ")),
        amountWords(amount(sums.days, "日")),
      ),
      drawing: sums.finished.length ? (
        <Spines books={finishedBooks(view).slice(-8)} />
      ) : reading.length ? (
        W.readingNow(reading.length)
      ) : undefined,
    };
  },
  chart: (view) => {
    if (fresh(view)) return { big: notYet, says: W.clockNotYet };
    const sums = yearNumbers(view);
    const { bars, on, labels } = chartBars(view);
    return {
      big: <Amounts parts={shortTime(sums.seconds)} />,
      says: W.chartTotal(periodName(view.period, view.data.today)),
      drawing: (
        <Bars
          values={bars.map((bar) => bar.seconds)}
          labels={bars.length <= 14 ? labels : undefined}
          on={on}
          thin={bars.length > 14}
        />
      ),
    };
  },
  days: (view) => {
    const month = monthDots(view);
    return {
      big: fresh(view) ? (
        notYet
      ) : (
        <Amounts parts={[amount(month.count, "日")]} />
      ),
      says: W.readDaysHow(month.month),
      drawing: <MonthDots days={month.days} heads={WEEKDAYS_FROM_MONDAY} />,
    };
  },
  clock: (view) => {
    const { values, top, sure } = bands(view);
    if (top === null) return { big: notYet, says: W.clockNotYet };
    return {
      big: (
        <>
          {!sure && <small>{W.soFar} </small>}
          {BAND_NAMES[top]}
        </>
      ),
      says: sure
        ? `${bandHours(top)}・${BAND_READERS[top]}`
        : `${bandHours(top)}が多め`,
      drawing: (
        <Bars
          values={values}
          labels={values.map((_, band) => String(band * 4))}
          on={top}
        />
      ),
    };
  },
  genre: (view) => {
    const by = genreByOf(view);
    const parts = genreParts(view, by);
    if (!parts.length) return { big: notYet, says: W.genreNotYet };
    const ties = parts.filter(
      (part) => part.value === parts[0].value && part.label !== OTHER_GENRE,
    );
    return {
      big: parts[0].label,
      says:
        ties.length > 1
          ? W.sameAs(
              ties
                .slice(1)
                .map((p) => p.label)
                .join("・"),
            )
          : undefined,
      drawing: (
        <span className="stats-genre">
          <Ring parts={parts} size="small" />
          <Legend parts={parts.map((part) => ({ ...part, says: "" }))} />
        </span>
      ),
    };
  },
  pace: (view) => {
    const look = pace(view.data, view.period);
    if (look.ahead === null) {
      const sums = yearNumbers(view);
      const daily = perDay(view.data, view.period, sums.seconds);
      return sums.seconds > 0
        ? { big: <Amounts parts={timeAmounts(daily)} />, says: W.perDayRead }
        : { big: notYet, says: W.paceNotYet };
    }
    return {
      big: <Amounts parts={[amount(look.ahead, "冊", "約")]} />,
      says: W.aheadIf,
      drawing: <PaceDrawing view={view} />,
    };
  },
  shelf: (view) => {
    const parts = shelfParts(view);
    if (!view.data.library.length) return { big: notYet, says: W.shelfNotYet };
    return {
      big: <Amounts parts={[amount(sumOf(parts.map((p) => p.value)), "冊")]} />,
      says: W.shelfNow,
      drawing: <Band parts={parts} />,
    };
  },
  joy: (view) => {
    const ahead = joy(view.data, view.speed);
    const parts = shelfParts(view).slice(0, 2);
    if (!ahead)
      return {
        big: notYet,
        says: W.joyNotYet,
        drawing: <Band parts={parts} />,
      };
    return {
      big: (
        <Amounts
          parts={[aboutTime(ahead.tsundokuSeconds + ahead.readingSeconds)]}
        />
      ),
      says: W.joyHow,
      drawing: <Band parts={parts} />,
    };
  },
  met: (view) => {
    const met = metList(view);
    if (!met.length)
      return {
        big: notYet,
        says: W.metNotYet,
        drawing: <span className="stats-go">{W.metGo} ›</span>,
      };
    return {
      big: <Amounts parts={[amount(met.length, "冊")]} />,
      says: W.metHow,
      drawing: <Spines books={met.slice(-10)} />,
    };
  },
  stack: (view) => {
    const height = stackHeight(view.data, view.period);
    const finished = finishedBooks(view);
    if (!finished.length) {
      const reading = readingBooks(view);
      const mm = sumOf(reading.map((one) => (one.pages ?? 0) * 0.05));
      return reading.length && mm > 0
        ? {
            big: <Amounts parts={[centimetres(mm, "あと 約")]} />,
            says: W.stackAhead(reading.length),
            drawing: <Pile books={reading} ghost />,
          }
        : { big: notYet, says: W.stackNotYet };
    }
    return {
      big: <Amounts parts={[centimetres(height.mm, "約")]} />,
      says: W.stackHow(finished.length - height.unknown),
      drawing: <Pile books={finished.slice(-7).reverse()} />,
    };
  },
  album: (view) => {
    const cards = cardsIn(view);
    if (!cards.all) return { big: notYet, says: W.albumNotYet };
    return {
      big: <Amounts parts={[amount(cards.shown.length, "枚")]} />,
      says: W.albumAll(amountWords(amount(cards.all, "枚"))),
      drawing: (
        <span className="stats-album" aria-hidden="true">
          {cards.shown.slice(-4).map((card) => (
            <i key={card.id} />
          ))}
        </span>
      ),
    };
  },
  shape: (view) => {
    const way = shape(view.data, view.period);
    if (way.band === null && !way.genre)
      return { big: notYet, says: W.shapeNotYet };
    return {
      big: way.genre ?? BAND_NAMES[way.band ?? 0],
      says:
        way.band !== null
          ? `主に${BAND_NAMES[way.band]}（${bandHours(way.band)}）に読んでいます`
          : undefined,
    };
  },
};

/** Time read where room is short: from 10 hours on, the hours alone (cut down, rule 4): 131時間. */
function shortTime(seconds: number): Amount[] {
  const hours = Math.floor(seconds / 3600);
  return hours >= 10 ? [amount(hours, "時間")] : timeAmounts(seconds);
}

/** Millimetres stacked as the card says them: 約21cm, under 10cm to a tenth. */
function centimetres(mm: number, lead: string): Amount {
  const cm = mm / 10;
  return {
    lead,
    n: cm >= 10 ? grouped(cm) : (Math.round(cm * 10) / 10).toFixed(1),
    unit: "cm",
  };
}

function PaceDrawing({ view }: { view: StatsView }) {
  const look = pace(view.data, view.period);
  const days = periodDays(view.period);
  const share = (day: DayKey) =>
    Math.min(1, (dayNumber(day) - dayNumber(view.period.from) + 1) / days);
  return (
    <PaceLine
      points={look.line.map((point) => ({
        at: share(point.day),
        books: point.books,
      }))}
      at={share(
        view.data.today < view.period.to ? view.data.today : view.period.to,
      )}
      done={look.line.length}
      ahead={look.ahead}
    />
  );
}

// ── In full ──────────────────────────────────────────────────────────────

function Tile({
  label,
  parts,
  note,
  mark,
}: {
  label: string;
  parts: Amount[];
  note?: ReactNode;
  mark?: MarkName;
}) {
  return (
    <div className="stats-tile">
      {mark && <Mark name={mark} />}
      <b>
        <Amounts parts={parts} />
      </b>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </div>
  );
}

function YearFull({ view }: { view: StatsView }) {
  const sums = yearNumbers(view);
  const before = sameTimeBefore(view.period, view.data.today, view.data.first);
  const was = before ? finishedIn(view.data, before).length : null;
  const more = was === null ? null : sums.finished.length - was;
  const finished = finishedBooks(view);
  const reading = readingBooks(view);
  const undated =
    view.period.kind === "all"
      ? sums.finished.filter((finish) => finish.day === null).length
      : 0;
  if (fresh(view))
    return (
      <div className="stats-full">
        <p className="stats-note">{W.yearNotYet}</p>
        <BookShelf finished={[]} reading={reading.map((one) => one.book)} />
      </div>
    );
  return (
    <div className="stats-full">
      <div className="stats-tiles four">
        <Tile
          mark="books"
          label={W.finishedBooks}
          parts={[amount(sums.finished.length, "冊")]}
          note={
            more !== null && more !== 0
              ? `${beforeName(view)}より ${more > 0 ? "＋" : "−"}${amountWords(amount(Math.abs(more), "冊"))}`
              : undefined
          }
        />
        <Tile mark="pages" label={W.pagesRead} parts={[amount(sums.pages, "ページ")]} />
        <Tile mark="days" label={W.daysRead} parts={[amount(sums.days, "日")]} />
        <Tile mark="time" label={W.timeRead} parts={shortTime(sums.seconds)} />
      </div>
      <BookShelf
        finished={finished.map((one) => one.book)}
        reading={reading.map((one) => one.book)}
      />
      {undated > 0 && <p className="stats-note">{W.undated(undated)}</p>}
    </div>
  );
}

const beforeName = (view: StatsView) =>
  ({ week: "先週", month: "先月", year: "去年" })[
    view.period.kind as "week" | "month" | "year"
  ] ?? "前";

/** The books finished, oldest on the left, the newest in sight; those being read stand at the left. */
function BookShelf({
  finished,
  reading,
}: {
  finished: Book[];
  reading: Book[];
}) {
  return (
    <div className="stats-shelf">
      {reading.length > 0 && (
        <div className="stats-shelf-reading" aria-label={W.readingShelf}>
          {reading.slice(0, 4).map((book) => (
            <BookJacket
              key={book.id}
              book={book}
              className="stats-shelf-book"
              sizes="40px"
            />
          ))}
        </div>
      )}
      <div
        className="stats-shelf-row"
        ref={(row) => {
          if (row) row.scrollLeft = row.scrollWidth;
        }}
      >
        {finished.length ? (
          finished.map((book, at) => (
            <BookJacket
              key={book.id + at}
              book={book}
              className="stats-shelf-book"
              sizes="48px"
            />
          ))
        ) : (
          <p className="stats-note">{W.shelfFinishedHint}</p>
        )}
      </div>
    </div>
  );
}

function ChartFull({ view }: { view: StatsView }) {
  const sums = yearNumbers(view);
  const { bars, on, labels } = chartBars(view);
  const monthly = view.period.kind === "year" || view.period.kind === "all";
  const average = monthly
    ? (perDay(view.data, view.period, sums.seconds) * 365) / 12
    : perDay(view.data, view.period, sums.seconds);
  if (fresh(view))
    return (
      <div className="stats-full">
        <p className="stats-note">{W.clockNotYet}</p>
      </div>
    );
  return (
    <div className="stats-full">
      <p className="stats-sums">
        <span>
          {W.sumLabel} <Amounts parts={timeAmounts(sums.seconds)} />
        </span>
        <span>
          {monthly ? W.chartAverage : W.chartAverageDay}{" "}
          <Amounts parts={timeAmounts(average)} />
        </span>
      </p>
      {sums.seconds > 0 ? (
        <Bars
          values={bars.map((bar) => bar.seconds)}
          labels={labels}
          on={on}
          tall
        />
      ) : (
        <p className="stats-note">{W.clockNotYet}</p>
      )}
    </div>
  );
}

function DaysFull({ view }: { view: StatsView }) {
  const year = periodAt("year", view.data.today);
  const read = readDays(view.data, year);
  const most = Math.max(30 * 60, ...read.values());
  const months = Array.from({ length: 12 }, (_, at) =>
    periodAt("month", year.from, at),
  ).filter((month) => month.from <= view.data.today);
  const month = monthDots(view);
  return (
    <div className="stats-full">
      {fresh(view) ? (
        <p className="stats-note">{W.clockNotYet}</p>
      ) : (
        <p className="stats-sums">
          <span>
            {W.readDaysHow(month.month)}{" "}
            <Amounts parts={[amount(month.count, "日")]} />
          </span>
          <span>
            {periodName(year, view.data.today)}{" "}
            <Amounts
              parts={[
                amount([...read.values()].filter((s) => s > 0).length, "日"),
              ]}
            />
          </span>
        </p>
      )}
      <div className="stats-months">
        {months.reverse().map((one) => {
          const days: DayDot[] = Array<DayDot>(
            (weekdayOf(one.from) + 6) % 7,
          ).fill("pad");
          for (let day = one.from; day <= one.to; day = addDays(day, 1))
            days.push(
              day > view.data.today
                ? "later"
                : {
                    read: (read.get(day) ?? 0) / most,
                    today: day === view.data.today,
                  },
            );
          return (
            <div key={one.from}>
              <h3>{Number(one.from.slice(5, 7))}月</h3>
              <MonthDots days={days} heads={WEEKDAYS_FROM_MONDAY} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClockFull({ view }: { view: StatsView }) {
  const [by, setBy] = useState<"time" | "count">("time");
  const times = clock(view.data, view.period, by);
  const top = busiest(times.hours)[0] ?? null;
  const say = (value: number) =>
    by === "time" ? timeWords(value) : amountWords(amount(value, "回"));
  const rows = [1, 2, 3, 4, 5, 6, 0];
  const most = Math.max(1, ...times.grid.flat());
  return (
    <div className="stats-full">
      <Switch
        choices={(["time", "count"] as const).map((key) => ({
          key,
          label: W.timeBy[key],
        }))}
        value={by}
        onChange={setBy}
      />
      {top === null ? (
        <p className="stats-note">{W.clockNotYet}</p>
      ) : (
        <>
          <p className="stats-sums">
            <span>{W.topHour(top, say(times.hours[top]))}</span>
          </p>
          <Bars
            values={times.hours}
            labels={times.hours.map((_, hour) =>
              hour % 6 === 0 ? `${hour}時` : null,
            )}
            on={top}
            tall
          />
          <table className="stats-grid">
            <thead>
              <tr>
                <th />
                {BAND_NAMES.map((name, band) => (
                  <th key={name} scope="col">
                    {band * 4}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((weekday) => (
                <tr key={weekday}>
                  <th scope="row">{WEEKDAY_NAMES[weekday]}</th>
                  {times.grid[weekday].map((value, band) => (
                    <td
                      key={band}
                      style={{
                        background: value
                          ? `color-mix(in srgb, var(--green) ${15 + Math.round((value / most) * 85)}%, var(--sheet))`
                          : undefined,
                      }}
                      aria-label={`${WEEKDAY_NAMES[weekday]}曜 ${bandHours(band)} ${say(value)}`}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function GenreFull({ view }: { view: StatsView }) {
  const [by, setBy] = useState<GenreBy>(genreByOf(view));
  const parts = genreParts(view, by, 6);
  const kinds = BOOK_KINDS.map((entry) => entry.kind);
  void kinds;
  return (
    <div className="stats-full">
      <Switch
        choices={(["count", "pages", "time"] as const).map((key) => ({
          key,
          label: W.genreBy[key],
        }))}
        value={by}
        onChange={setBy}
      />
      {parts.length ? (
        <div className="stats-genre large">
          <Ring parts={parts} size="large" />
          <Legend parts={parts} />
        </div>
      ) : (
        <p className="stats-note">{W.genreNotYet}</p>
      )}
    </div>
  );
}

function PaceFull({ view }: { view: StatsView }) {
  const look = pace(view.data, view.period);
  const sums = yearNumbers(view);
  const daily = perDay(view.data, view.period, sums.seconds);
  if (fresh(view))
    return (
      <div className="stats-full">
        <p className="stats-note">{W.paceNotYet}</p>
      </div>
    );
  return (
    <div className="stats-full">
      <div className="stats-tiles">
        {look.ahead !== null && (
          <Tile label={W.aheadIf} parts={[amount(look.ahead, "冊", "約")]} />
        )}
        <Tile label={W.perDayRead} parts={timeAmounts(daily)} />
        {look.daysPerBook !== null && (
          <Tile
            label={W.daysPerBook}
            parts={[amount(look.daysPerBook, "日", "約")]}
          />
        )}
      </div>
      {look.ahead !== null && <PaceDrawing view={view} />}
    </div>
  );
}

function ShelfFull({ view }: { view: StatsView }) {
  const parts = shelfParts(view);
  const states = shelfStates(view.data);
  const lists: [string, string[]][] = [
    [W.states.reading, states.reading],
    [W.states.tsundoku, states.tsundoku],
    [W.states.finished, states.finished],
  ];
  return (
    <div className="stats-full">
      <Band parts={parts} />
      {lists.map(([label, ids]) =>
        ids.length ? (
          <section key={label} className="stats-list">
            <h3>{label}</h3>
            <ul>
              {ids.slice(0, 30).map((id) => {
                const book = bookOf(view, id);
                return book ? <li key={id}>{bookTitle(book)}</li> : null;
              })}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

function JoyFull({ view }: { view: StatsView }) {
  const ahead = joy(view.data, view.speed);
  const states = shelfStates(view.data);
  if (!ahead)
    return (
      <div className="stats-full">
        <p className="stats-note">{W.joyNotYet}</p>
      </div>
    );
  const rows = [...states.reading, ...states.tsundoku].flatMap((id) => {
    const book = bookOf(view, id);
    const seconds = timeToFinish(view.data, id, view.speed);
    return book ? [{ book, seconds }] : [];
  });
  return (
    <div className="stats-full">
      <div className="stats-tiles">
        <Tile
          label={W.states.tsundoku}
          parts={[aboutTime(ahead.tsundokuSeconds)]}
        />
        <Tile
          label={W.states.reading}
          parts={[aboutTime(ahead.readingSeconds)]}
        />
      </div>
      <ul className="stats-rows">
        {rows.slice(0, 30).map(({ book, seconds }) => (
          <li key={book.id}>
            <b>{bookTitle(book)}</b>
            <em>{seconds === null ? "—" : amountWords(aboutTime(seconds))}</em>
          </li>
        ))}
      </ul>
      {ahead.guessed > 0 && (
        <p className="stats-note">{W.guessed(ahead.guessed)}</p>
      )}
    </div>
  );
}

const VIA_NAMES = {
  post: NAMES.letter,
  pop: "POP",
  book: "本のページ",
  shop: `${NAMES.shop}の棚`,
} as const;

function MetFull({ view }: { view: StatsView }) {
  const met = metList(view);
  if (!met.length)
    return (
      <div className="stats-full">
        <p className="stats-note">{W.metNotYet}</p>
        <Link className="stats-go" href={walkPath()}>
          {W.metGo} ›
        </Link>
      </div>
    );
  return (
    <div className="stats-full">
      <Spines books={met} />
      <ul className="stats-rows">
        {met.map(({ book, via, finish }, at) => (
          <li key={book.id + at}>
            <b>{bookTitle(book)}</b>
            <em>{VIA_NAMES[via]}</em>
            {finish.day && <small>{shortDay(finish.day)}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const shortDay = (day: DayKey) =>
  `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

function StackFull({ view }: { view: StatsView }) {
  const height = stackHeight(view.data, view.period);
  const finished = finishedBooks(view);
  return (
    <div className="stats-full">
      <p className="stats-sums">
        <span>
          <Amounts parts={[centimetres(height.mm, "約")]} />
        </span>
      </p>
      <Pile books={finished.slice().reverse()} />
      {height.unknown > 0 && (
        <p className="stats-note">{W.unknownPages(height.unknown)}</p>
      )}
    </div>
  );
}

function AlbumFull({ view }: { view: StatsView }) {
  const cards = cardsIn(view);
  return (
    <div className="stats-full">
      <p className="stats-note">
        {cards.all
          ? W.albumAll(amountWords(amount(cards.all, "枚")))
          : W.albumNotYet}
      </p>
    </div>
  );
}

function ShapeFull({ view }: { view: StatsView }) {
  const way = shape(view.data, view.period);
  const sums = yearNumbers(view);
  const look = pace(view.data, view.period);
  const days = elapsedDays(view.period, view.data.today, view.data.first);
  const readings = sums.readings || 1;
  const hours = sums.seconds / 3600;
  if (way.band === null && !way.genre)
    return (
      <div className="stats-full">
        <p className="stats-note">{W.shapeNotYet}</p>
      </div>
    );
  const lines: ReactNode[] = [];
  if (look.daysPerBook !== null)
    lines.push(
      <>
        1冊は平均 <u>{amountWords(amount(look.daysPerBook, "日"))}</u>{" "}
        で読み終えます。
      </>,
    );
  if (sums.seconds > 0)
    lines.push(
      <>
        1日 平均 <u>{timeWords(sums.seconds / days)}</u>、
        <u>{amountWords(amount(sums.pages / days, "ページ"))}</u> 読んでいます。
      </>,
    );
  if (sums.readings > 0)
    lines.push(
      <>
        1回に 平均 <u>{timeWords(sums.seconds / readings)}</u>、
        <u>{amountWords(amount(sums.pages / readings, "ページ"))}</u> 読みます。
      </>,
    );
  if (hours >= 1 && sums.pages > 0)
    lines.push(
      <>
        1時間に 平均 <u>{amountWords(amount(sums.pages / hours, "ページ"))}</u>{" "}
        のペースです。
      </>,
    );
  if (way.averagePages !== null)
    lines.push(
      <>
        {W.averagePages}{" "}
        <u>{amountWords(amount(way.averagePages, "ページ"))}</u> です。
      </>,
    );
  if (way.weekdays.length)
    lines.push(
      <>
        {W.mostWeekday}{" "}
        <u>{way.weekdays.map((d) => WEEKDAY_NAMES[d] + "曜日").join("と")}</u>{" "}
        です。
      </>,
    );
  const met = metList(view).length;
  if (met > 0) lines.push(<>{W.metShare(amountWords(amount(met, "冊")))}</>);
  return (
    <div className="stats-full">
      <p className="stats-sentence">
        {W.shapeLead(periodName(view.period, view.data.today))}主に
        {way.band !== null && (
          <u>
            {BAND_NAMES[way.band]}（{bandHours(way.band)}）
          </u>
        )}
        に、
        {way.pagesFrom !== null && <u>{W.pagesBand(way.pagesFrom)}</u>}
        {way.pagesFrom !== null && way.genre && "の"}
        {way.genre && <u>{way.genre}</u>}
        {W.sentenceEnd(way.fromReading)}
      </p>
      <ul className="stats-lines">
        {lines.map((line, at) => (
          <li key={at}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

const FULL: Record<StatCard, (props: { view: StatsView }) => ReactNode> = {
  year: YearFull,
  chart: ChartFull,
  days: DaysFull,
  clock: ClockFull,
  genre: GenreFull,
  pace: PaceFull,
  shelf: ShelfFull,
  joy: JoyFull,
  met: MetFull,
  stack: StackFull,
  album: AlbumFull,
  shape: ShapeFull,
};

/** A row of choices inside a card (読んだ時間｜読んだ回数). */
export function Switch<T extends string>({
  choices,
  value,
  onChange,
}: {
  choices: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="stats-switch" role="group">
      {choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          aria-pressed={choice.key === value}
          onClick={() => onChange(choice.key)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export type { TileSize };
