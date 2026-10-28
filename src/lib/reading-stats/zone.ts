// A moment read on the clock of the zone a reading was in (reading_cards.
// time_zone): its day, hour and weekday. A card keeps an Intl name or an
// offset like +09:00 (east of UTC is +, as ISO writes it); anything else, a
// name this browser does not know among it, is read as Japan, as the card's
// day is (docs/機能/読書記録.md「時刻の地域を SQL で読むとき」).

export const JAPAN_ZONE = "Asia/Tokyo";
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/** A day as YYYY-MM-DD, compared as text. */
export type DayKey = string;

export interface LocalTime {
  day: DayKey;
  /** 0–23. */
  hour: number;
  /** 0 Sunday … 6 Saturday, as Date's. */
  weekday: number;
}

const formats = new Map<string, Intl.DateTimeFormat | null>();

function formatOf(zone: string): Intl.DateTimeFormat | null {
  if (!formats.has(zone)) {
    let format: Intl.DateTimeFormat | null = null;
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
      });
    } catch {
      format = null;
    }
    formats.set(zone, format);
  }
  return formats.get(zone) ?? null;
}

/** Minutes east of UTC for an offset zone, or null when it is not one (or not a real one). */
function offsetMinutes(zone: string): number | null {
  const match = OFFSET.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A UTC date's fields as a day key, its hour and weekday. */
function fromShifted(shifted: Date): LocalTime {
  return {
    day: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
  };
}

/** The zone a card's times are read in: its own when this browser can read it, else Japan's. */
export function readableZone(zone: string): string {
  if (offsetMinutes(zone) !== null) return zone;
  return formatOf(zone) ? zone : JAPAN_ZONE;
}

/** The day, hour and weekday `at` falls on in `zone`. */
export function localTime(at: number, zone: string): LocalTime {
  const offset = offsetMinutes(zone);
  if (offset !== null) return fromShifted(new Date(at + offset * 60_000));
  const format = formatOf(zone) ?? formatOf(JAPAN_ZONE);
  const parts: Record<string, number> = {};
  for (const part of format!.formatToParts(at))
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  return fromShifted(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour)),
  );
}

/** A day key's days since 1970-01-01, to count and step days without a zone. */
export const dayNumber = (day: DayKey): number =>
  Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** The day key `count` days after (before, when negative) `day`. */
export const addDays = (day: DayKey, count: number): DayKey =>
  new Date((dayNumber(day) + count) * 86_400_000).toISOString().slice(0, 10);

/** The weekday of a day key: 0 Sunday … 6 Saturday. */
export const weekdayOf = (day: DayKey): number =>
  new Date(dayNumber(day) * 86_400_000).getUTCDay();
