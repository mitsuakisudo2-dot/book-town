// The small drawings of the statistics' cards (管理表 19): bars, a band of
// parts, a ring, the pace's line and the month's dots. Drawn with the town's
// colours (tokens.css); a book's own colour where a book is drawn.

import type { CSSProperties, ReactNode } from "react";
import type { Book } from "../../lib/types";
import type { Amount } from "../../lib/reading-stats/words";

/** The tones a part of a band or ring is drawn in, in order; the last is そのほか's. */
export const TONES = [
  "var(--lamp-glow)",
  "var(--forest)",
  "var(--palette-brick)",
  "var(--palette-ai)",
  "var(--palette-fuji)",
  "var(--line-2)",
];

/** 4,763ページ: the number large, its unit small. */
export function Amounts({ parts }: { parts: Amount[] }) {
  return (
    <>
      {parts.map((part, at) => (
        <span key={at} className="stats-amount">
          {part.lead && <small>{part.lead}</small>}
          {part.n}
          <small>{part.unit}</small>
        </span>
      ))}
    </>
  );
}

/** Upright bars, the one of `on` marked; a label under each when given. */
export function Bars({
  values,
  labels,
  on = -1,
  thin = false,
  tall = false,
}: {
  values: number[];
  labels?: (string | null)[];
  on?: number;
  thin?: boolean;
  tall?: boolean;
}) {
  const most = Math.max(1, ...values);
  return (
    <span
      className={`stats-bars${thin ? " thin" : ""}${tall ? " tall" : ""}`}
      aria-hidden="true"
    >
      {values.map((value, at) => (
        <i key={at} className={at === on ? "on" : undefined}>
          <s
            style={{
              height: `${value > 0 ? Math.max(4, Math.round((value / most) * 100)) : 0}%`,
            }}
          />
          {labels && <em>{labels[at] ?? ""}</em>}
        </i>
      ))}
    </span>
  );
}

export interface Part {
  label: string;
  value: number;
  tone: string;
  /** What the legend says of it: 14冊. */
  says: string;
}

/** A band of parts side by side, and its legend. */
export function Band({ parts }: { parts: Part[] }) {
  const shown = parts.filter((part) => part.value > 0);
  if (!shown.length) return null;
  return (
    <>
      <span className="stats-band" aria-hidden="true">
        {shown.map((part) => (
          <i
            key={part.label}
            style={{ flex: part.value, background: part.tone }}
          />
        ))}
      </span>
      <Legend parts={shown} row />
    </>
  );
}

export function Legend({ parts, row = false }: { parts: Part[]; row?: boolean }) {
  return (
    <span className={`stats-legend${row ? " row" : ""}`}>
      {parts.map((part) => (
        <span key={part.label}>
          <i style={{ background: part.tone }} />
          <b>{part.label}</b>
          <em>{part.says}</em>
        </span>
      ))}
    </span>
  );
}

/** A ring of parts, largest first. */
export function Ring({ parts, size }: { parts: Part[]; size: "small" | "large" }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const ends = parts.map(
    (_, at) =>
      (parts.slice(0, at + 1).reduce((sum, part) => sum + part.value, 0) /
        total) *
      360,
  );
  const stops = parts.map(
    (part, at) =>
      `${part.tone} ${(ends[at - 1] ?? 0).toFixed(1)}deg ${ends[at].toFixed(1)}deg`,
  );
  return (
    <span
      className={`stats-ring ${size}`}
      aria-hidden="true"
      style={{ background: `conic-gradient(${stops.join(",")})` }}
    />
  );
}

/**
 * The books finished so far in the period (a line), and on at this pace to
 * its end (dotted). `at` and `ahead` are where today is (0–1) and the books
 * by the end.
 */
export function PaceLine({
  points,
  at,
  done,
  ahead,
}: {
  points: { at: number; books: number }[];
  at: number;
  done: number;
  ahead: number | null;
}) {
  const width = 150;
  const height = 40;
  const top = Math.max(1, ahead ?? done);
  const x = (share: number) => (share * width).toFixed(1);
  const y = (books: number) =>
    (height - 2 - (books / top) * (height - 6)).toFixed(1);
  const line = [{ at: 0, books: 0 }, ...points, { at, books: done }]
    .map((point, n) => `${n ? "L" : "M"}${x(point.at)} ${y(point.books)}`)
    .join("");
  return (
    <svg
      className="stats-line"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={`M0 ${height - 2}H${width}`} className="base" />
      <path d={line} className="done" />
      {ahead !== null && (
        <path d={`M${x(at)} ${y(done)}L${width} ${y(ahead)}`} className="ahead" />
      )}
      <circle cx={x(at)} cy={y(done)} r="3" className="now" />
    </svg>
  );
}

/** A day of the month's dots: read (brighter the longer), today, days to come, before the 1st. */
export type DayDot = "pad" | "later" | { read: number; today: boolean };

export function MonthDots({ days, heads }: { days: DayDot[]; heads: string[] }) {
  return (
    <span className="stats-month" aria-hidden="true">
      {heads.map((head) => (
        <b key={head}>{head}</b>
      ))}
      {days.map((day, at) =>
        day === "pad" ? (
          <i key={at} className="pad" />
        ) : day === "later" ? (
          <i key={at} className="later" />
        ) : (
          <i
            key={at}
            className={`${day.read ? "on" : ""}${day.today ? " today" : ""}`}
            style={
              day.read
                ? ({ "--glow": `${35 + Math.round(day.read * 65)}%` } as CSSProperties)
                : undefined
            }
          />
        ),
      )}
    </span>
  );
}

/** Spines on a shelf: the books met and read. */
export function Spines({ books }: { books: { book: Book; pages: number | null }[] }) {
  return (
    <span className="stats-spines" aria-hidden="true">
      {books.map(({ book, pages }, at) => (
        <i
          key={book.id + at}
          style={{
            background: book.color,
            height: `${Math.min(100, 55 + Math.round((pages ?? 240) / 12))}%`,
          }}
        />
      ))}
    </span>
  );
}

/** Books lying one on another, newest on top; `ghost` for books not yet finished. */
export function Pile({
  books,
  ghost = false,
}: {
  books: { book: Book; pages: number | null }[];
  ghost?: boolean;
}) {
  return (
    <span className={`stats-pile${ghost ? " ghost" : ""}`} aria-hidden="true">
      {books.map(({ book, pages }, at) => {
        const seed = [...book.id].reduce((sum, c) => sum + c.charCodeAt(0), at);
        return (
          <i
            key={book.id + at}
            style={{
              background: book.color,
              height: `${Math.max(5, Math.round((pages ?? 240) / 38))}px`,
              width: `${68 + (seed * 13) % 30}%`,
              marginLeft: `${(seed * 7) % 14}%`,
            }}
          />
        );
      })}
    </span>
  );
}

/** A card's words and drawing, as the half and wide cards lay them out. */
export function CardFace({
  name,
  icon,
  big,
  says,
  drawing,
}: {
  name: string;
  icon: ReactNode;
  big: ReactNode;
  says?: ReactNode;
  drawing?: ReactNode;
}) {
  return (
    <>
      <span className="stats-card-name">
        {icon}
        <span>{name}</span>
        <i aria-hidden="true">›</i>
      </span>
      <b className="stats-card-big">{big}</b>
      {says && <span className="stats-card-says">{says}</span>}
      {drawing && <span className="stats-card-drawing">{drawing}</span>}
    </>
  );
}
