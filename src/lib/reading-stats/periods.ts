// The period the whole statistics screen looks at (期間の帯: 日・週・月・年・
// ぜんぶ, and えらぶ for any days), as days on the reader's own clock. A
// week begins on Monday, as the town's do (japan-time.ts weekOf).

import { addDays, dayNumber, weekdayOf, type DayKey } from "./zone";

export const PERIOD_KINDS = [
  "day",
  "week",
  "month",
  "year",
  "all",
  "custom",
] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface Period {
  kind: PeriodKind;
  /** The first day and the last, both in the period. */
  from: DayKey;
  to: DayKey;
}

const monthDays = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number) => String(value).padStart(2, "0");
const parts = (day: DayKey) =>
  day.split("-").map(Number) as [number, number, number];

/** The period of `kind` that holds `day`, moved `step` periods back (−1) or on (+1). ぜんぶ runs from `first`. */
export function periodAt(
  kind: Exclude<PeriodKind, "custom">,
  day: DayKey,
  step = 0,
  first: DayKey = day,
): Period {
  const [year, month] = parts(day);
  switch (kind) {
    case "day": {
      const at = addDays(day, step);
      return { kind, from: at, to: at };
    }
    case "week": {
      const monday = addDays(day, -((weekdayOf(day) + 6) % 7) + step * 7);
      return { kind, from: monday, to: addDays(monday, 6) };
    }
    case "month": {
      const index = year * 12 + (month - 1) + step;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      return {
        kind,
        from: `${y}-${pad(m)}-01`,
        to: `${y}-${pad(m)}-${pad(monthDays(y, m))}`,
      };
    }
    case "year":
      return { kind, from: `${year + step}-01-01`, to: `${year + step}-12-31` };
    case "all":
      return { kind, from: first < day ? first : day, to: day };
  }
}

/** Days the period holds, end to end. */
export const periodDays = (period: Period): number =>
  dayNumber(period.to) - dayNumber(period.from) + 1;

/**
 * The days an average is taken over (rule 1): from the period's first day,
 * or the first day of the records when that is later, to today, or to the
 * period's end when it is over. Never below one.
 */
export function elapsedDays(
  period: Period,
  today: DayKey,
  first: DayKey | null,
): number {
  const from = first && first > period.from ? first : period.from;
  const to = today < period.to ? today : period.to;
  return Math.max(1, dayNumber(to) - dayNumber(from) + 1);
}

/**
 * The same stretch of the period before, to compare with (去年の今ごろ,
 * 先月の同じ日まで): from its first day to the day as far in as today is.
 * None for a day or chosen days, and none when the records began on or after the
 * period began (nothing to compare with yet), as the 試作 does (sameTimePrev).
 */
export function sameTimeBefore(
  period: Period,
  today: DayKey,
  first: DayKey | null,
): Period | null {
  if (
    period.kind !== "week" &&
    period.kind !== "month" &&
    period.kind !== "year"
  )
    return null;
  const before = periodAt(period.kind, period.from, -1);
  if (first === null || first >= period.from) return null;
  if (today > period.to) return before;
  if (period.kind === "week")
    return {
      ...before,
      to: addDays(before.from, dayNumber(today) - dayNumber(period.from)),
    };
  const [, month, date] = parts(today);
  const [y, m] = parts(before.from);
  const last = monthDays(y, period.kind === "year" ? month : m);
  const day = pad(Math.min(date, last));
  return {
    ...before,
    to:
      period.kind === "year"
        ? `${y}-${pad(month)}-${day}`
        : `${y}-${pad(m)}-${day}`,
  };
}

/** Whether a day is in the period. */
export const inPeriod = (period: Period, day: DayKey | null): boolean =>
  day !== null && day >= period.from && day <= period.to;
