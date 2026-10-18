// Dates are Japan's: the day, week and month a moment falls in, and how a
// date is written, never depend on the browser's time zone (so the static
// render and every browser agree). Written without React so the server can
// use it too.

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Japan has no summer time: JST is always UTC+9. */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** A moment moved so its UTC fields read as Japan's clock. */
const inJapan = (at: string | number): Date =>
  new Date((typeof at === "number" ? at : Date.parse(at)) + JST_OFFSET_MS);

/** The day in Japan that `now` falls on, counted from 1970-01-01. */
export const jstDay = (now: number): number =>
  Math.floor((now + JST_OFFSET_MS) / DAY_MS);

/** The month (Japan time) a moment falls in, as YYYY-MM. */
export const japanMonth = (at: string): string =>
  inJapan(at).toISOString().slice(0, 7);

/** The Monday (Japan time) of the week a moment falls in, as YYYY-MM-DD. */
export function weekOf(at: string): string {
  const japan = inJapan(at);
  japan.setUTCDate(japan.getUTCDate() - ((japan.getUTCDay() + 6) % 7));
  return japan.toISOString().slice(0, 10);
}

/** A formatter for Japanese dates in Japan time. */
export const japanFormat = (
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...options });

/** The year (Japan time) it is now. */
export const japanYear = (now: number = Date.now()): number =>
  inJapan(now).getUTCFullYear();

const wholeDate = japanFormat({});

/** A date as 2026/10/18, in Japan time; "" for a moment that is not a date. */
export function shortDate(at: string | number | Date): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : wholeDate.format(date);
}
