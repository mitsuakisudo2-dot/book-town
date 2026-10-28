// The small drawings of the statistics' cards (管理表 19): bars, a band of
// parts, a ring, the pace's line and the month's dots. Drawn with the town's
// colours (tokens.css); a book's own colour where a book is drawn.

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Book } from "../../lib/types";
import type { Amount } from "../../lib/reading-stats/words";
import { Icon } from "../ui";

/** The statistics' own marks, as the 試作 draws them (on a 24 grid, in the town's line). */
const MARKS = {
  books: <path d="M4 20V6h4v14M9 20V4h4v16M14.5 20l2.5-14 3.5.6-2.5 14" />,
  pages: (
    <>
      <path d="M3 6.5c3-1.2 6-1 9 1 3-2 6-2.2 9-1v12c-3-1.2-6-1-9 1-3-2-6-2.2-9-1z" />
      <path d="M12 7.5v12" />
    </>
  ),
  days: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  chart: <path d="M4 20h16M7 16v-4M11 16V8M15 16v-6M19 16V5" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="9" cy="14.5" r="1" fill="currentColor" />
      <circle cx="15" cy="14.5" r="1" fill="currentColor" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />,
  pie: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5V12h8.5" />
    </>
  ),
  rise: (
    <>
      <path d="M3 18c4-1 6-5 9-7s5-2 9-6" />
      <path d="M16 5h5v5" />
    </>
  ),
  shelf: (
    <path d="M4 20h16M5 20V7h3v13M9 20V4h3v16M13 20V9h3v11M17 20V6h2.5v14" />
  ),
  hourglass: (
    <path d="M8 3h8M8 21h8M9 3c0 5 6 5 6 9s-6 4-6 9M15 3c0 5-6 5-6 9" />
  ),
  house: (
    <>
      <path d="M4 11l8-6 8 6v9H4z" />
      <path d="M9.5 20v-5h5v5" />
    </>
  ),
  pile: <path d="M4 18h16M5 14h13M6 10h12M4 6h14" />,
  cards: (
    <>
      <rect x="3" y="6" width="11" height="15" rx="1.5" />
      <path d="M7 3.5h11.5A1.5 1.5 0 0 1 20 5v13" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15" />
      <path d="M5 19l8-8" />
    </>
  ),
};
export type MarkName = keyof typeof MARKS;

/** A mark in its tinted circle, as each card and number is headed. */
export function Mark({ name, size = 14 }: { name: MarkName; size?: number }) {
  return (
    <span className="stats-mark" aria-hidden="true">
      <Icon drawn={MARKS[name]} size={size} />
    </span>
  );
}

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

export function Legend({
  parts,
  row = false,
}: {
  parts: Part[];
  row?: boolean;
}) {
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
export function Ring({
  parts,
  size,
}: {
  parts: Part[];
  size: "small" | "large";
}) {
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
        <path
          d={`M${x(at)} ${y(done)}L${width} ${y(ahead)}`}
          className="ahead"
        />
      )}
      <circle cx={x(at)} cy={y(done)} r="3" className="now" />
    </svg>
  );
}

/** A day of the month's dots: read (brighter the longer), today, days to come, before the 1st. */
export type DayDot = "pad" | "later" | { read: number; today: boolean };

export function MonthDots({
  days,
  heads,
}: {
  days: DayDot[];
  heads: string[];
}) {
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
                ? ({
                    "--glow": `${35 + Math.round(day.read * 65)}%`,
                  } as CSSProperties)
                : undefined
            }
          />
        ),
      )}
    </span>
  );
}

/** Spines on a shelf: the books met and read. */
export function Spines({
  books,
}: {
  books: { book: Book; pages: number | null }[];
}) {
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
              width: `${68 + ((seed * 13) % 30)}%`,
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

/** A round step for an axis to `most`, in about three steps: 10時間, 20分. */
function axisStep(most: number, unit: number): number {
  const rough = most / unit / 3;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  return (
    (steps.find((step) => step >= rough) ?? steps[steps.length - 1]) * unit
  );
}

/**
 * 読書時間チャート in full (刷新版 4節): bars on an axis with its lines, the
 * average dashed across, the longest bar's and today's numbers over them.
 * A bar pressed is outlined and says itself in a row of its own over the
 * chart, on the right, so the sums above are never covered.
 */
export function TimeChart({
  values,
  labels,
  names,
  on,
  average,
  unit,
  say,
  sayAxis,
  averageName,
}: {
  /** Seconds a bar. */
  values: number[];
  labels: (string | null)[];
  /** Each bar's name when pressed: 4月. */
  names: string[];
  /** Today's bar; the bars after it are still to come. */
  on: number;
  /** Seconds, the dashed line; null for none. */
  average: number | null;
  /** The bars' unit, after the last label: 月. */
  unit?: string;
  /** A bar's time, pressed: 16時間19分. */
  say: (seconds: number) => string;
  /** A tick's time, or a bar's over it, in the axis's hours or minutes: 10時間, 20. */
  sayAxis: (seconds: number, inHours: boolean, withUnit: boolean) => string;
  averageName: string;
}) {
  const [pressed, setPressed] = useState<number | null>(null);
  const most = Math.max(1, ...values, average ?? 0);
  const inHours = most >= 3600;
  const step = axisStep(most, inHours ? 3600 : 60);
  const top = Math.ceil(most / step) * step;
  const ticks = Array.from(
    { length: Math.round(top / step) + 1 },
    (_, n) => n * step,
  );
  const longest = values.indexOf(Math.max(...values));
  const height = (seconds: number) => `${(seconds / top) * 100}%`;
  return (
    <div className="stats-chart">
      <p className="stats-chart-pressed" aria-live="polite">
        {pressed !== null && (
          <span>
            <b>{names[pressed]}</b>
            <b>{say(values[pressed])}</b>
          </span>
        )}
      </p>
      <div className="stats-chart-body">
        <span className="stats-chart-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <em key={tick} style={{ bottom: height(tick) }}>
              {tick ? sayAxis(tick, inHours, true) : "0"}
            </em>
          ))}
        </span>
        <div className="stats-chart-bars">
          {ticks.slice(1).map((tick) => (
            <s
              key={tick}
              className="stats-chart-rule"
              style={{ bottom: height(tick) }}
            />
          ))}
          {values.map((value, at) => (
            <button
              key={at}
              type="button"
              className={
                (at === on ? "on" : "") +
                (at > on && on >= 0 ? " later" : "") +
                (at === pressed ? " pressed" : "")
              }
              aria-label={`${names[at]} ${say(value)}`}
              aria-pressed={at === pressed}
              disabled={at > on && on >= 0}
              onClick={() => setPressed(at === pressed ? null : at)}
            >
              <span style={{ height: height(value) }}>
                {value > 0 && (at === longest || at === on) && (
                  <em className={at === longest ? "top" : undefined}>
                    {sayAxis(value, inHours, false)}
                  </em>
                )}
              </span>
            </button>
          ))}
          {average !== null && average > 0 && (
            <i
              className="stats-chart-average"
              style={{ bottom: height(average) }}
            >
              <b>{averageName}</b>
            </i>
          )}
        </div>
        <span />
        <span className="stats-chart-labels" aria-hidden="true">
          {labels.map((label, at) => (
            <em key={at}>{label ?? ""}</em>
          ))}
        </span>
        {unit && <span />}
        {unit && <span className="stats-chart-unit">{unit}</span>}
      </div>
    </div>
  );
}
