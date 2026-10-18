// The continuous scanner's timing mode (ScanSession.tsx): how long each part
// of a read takes on the reader's own phone, to compare the scanner with
// other apps before it is built again (けにーさん 10-18「測ってから」). It
// shows only for an address with ?scan-timing, and this tab remembers it
// until ?scan-timing=off. Nothing is sent anywhere: the record is copied by
// hand. Two settings can be tried from it: the pause between camera frames,
// and the size of the picture asked of the camera.

import { counted, nth } from "./words";

export const TIMING_PARAM = "scan-timing";
const TIMING_KEY = "book-town-scan-timing";

export interface TimingSettings {
  /** The pause after reading one camera frame, before the next (ms). */
  gap: number;
  /** The width of the picture asked of the camera, for ZXing. */
  size: number;
}

/** What the scanner does without the timing mode. */
export const USUAL: TimingSettings = { gap: 200, size: 1920 };
export const GAPS = [200, 100, 0] as const;
export const SIZES = [1920, 1280] as const;

const isGap = (value: number) => (GAPS as readonly number[]).includes(value);
const isSize = (value: number) => (SIZES as readonly number[]).includes(value);

/**
 * The tab's timing settings: null when the mode is off. The address turns it
 * on (?scan-timing) or off (?scan-timing=off); otherwise the tab's kept
 * settings stand. Settings that are not one of the choices read as usual.
 */
export function readTiming(
  search: string,
  kept: string | null,
): TimingSettings | null {
  const asked = new URLSearchParams(search).get(TIMING_PARAM);
  if (asked === "off") return null;
  let saved: Partial<TimingSettings> | null = null;
  try {
    saved = kept ? (JSON.parse(kept) as Partial<TimingSettings>) : null;
  } catch {
    saved = null;
  }
  if (asked === null && !saved) return null;
  const gap = Number(saved?.gap);
  const size = Number(saved?.size);
  return {
    gap: isGap(gap) ? gap : USUAL.gap,
    size: isSize(size) ? size : USUAL.size,
  };
}

/** This tab's timing settings, as the address and the tab say. */
export function tabTiming(): TimingSettings | null {
  let kept: string | null = null;
  try {
    kept = sessionStorage.getItem(TIMING_KEY);
  } catch {
    // No storage: the address alone decides.
  }
  const settings = readTiming(location.search, kept);
  keepTiming(settings);
  return settings;
}

/** Remembers the settings for this tab, or forgets the mode. */
export function keepTiming(settings: TimingSettings | null) {
  try {
    if (settings) sessionStorage.setItem(TIMING_KEY, JSON.stringify(settings));
    else sessionStorage.removeItem(TIMING_KEY);
  } catch {
    // Kept for this scanner only.
  }
}

/** The next choice after `now`, round again after the last. */
export const nextOf = <T>(choices: readonly T[], now: T): T =>
  choices[(choices.indexOf(now) + 1) % choices.length];

/** One book read in the session. */
export interface TimedRead {
  /** The card's id. */
  id: string;
  /** When it was read (ms, performance.now). */
  at: number;
  /** A new book; false for one read again, waiting, or in the library. */
  fresh: boolean;
  /** When its title was known. */
  titleAt?: number;
  /** When it was saved (left the device's journal). */
  savedAt?: number;
}

export interface Timing {
  /** When the camera started reading. */
  started: number | null;
  /** The time each camera frame took to read, in order (ms), the last 200. */
  frames: number[];
  /** When each of the last frames began, to count frames a second. */
  frameStarts: number[];
  reads: TimedRead[];
}

export const NO_TIMING: Timing = {
  started: null,
  frames: [],
  frameStarts: [],
  reads: [],
};

const KEEP_FRAMES = 200;
const RATE_FRAMES = 20;

export function noteFrame(timing: Timing, at: number, ms: number): Timing {
  return {
    ...timing,
    started: timing.started ?? at,
    frames: [...timing.frames, ms].slice(-KEEP_FRAMES),
    frameStarts: [...timing.frameStarts, at].slice(-RATE_FRAMES),
  };
}

export function noteReadAt(
  timing: Timing,
  id: string,
  at: number,
  fresh: boolean,
): Timing {
  return { ...timing, reads: [...timing.reads, { id, at, fresh }] };
}

/** The first time a read's title, or its save, is known. */
export function noteDone(
  timing: Timing,
  id: string,
  what: "titleAt" | "savedAt",
  at: number,
): Timing {
  const index = timing.reads.findIndex((read) => read.id === id);
  if (index < 0 || timing.reads[index][what] !== undefined) return timing;
  const reads = [...timing.reads];
  reads[index] = { ...reads[index], [what]: at };
  return { ...timing, reads };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface TimingSummary {
  /** A frame's read, the middle one and the slowest (ms). */
  frameMs: number | null;
  slowestMs: number | null;
  /** Frames read a second, over the last few. */
  perSecond: number | null;
  /** From the first book read to the last (ms); null under two books. */
  firstToLast: number | null;
  books: number;
}

export function summarize(timing: Timing): TimingSummary {
  const starts = timing.frameStarts;
  const span = starts.length > 1 ? starts.at(-1)! - starts[0] : 0;
  const reads = timing.reads;
  return {
    frameMs: median(timing.frames),
    slowestMs: timing.frames.length ? Math.max(...timing.frames) : null,
    perSecond: span > 0 ? ((starts.length - 1) * 1000) / span : null,
    firstToLast: reads.length > 1 ? reads.at(-1)!.at - reads[0].at : null,
    books: reads.length,
  };
}

/** Seconds with one decimal, from ms. */
export const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** One line for a read: since the book before, to its title, to its save. */
export function readLine(timing: Timing, index: number): string {
  const read = timing.reads[index];
  const before = timing.reads[index - 1];
  const parts = [
    before ? `前の本から ${seconds(read.at - before.at)}秒` : "1冊目",
  ];
  if (!read.fresh) parts.push(TIMING_COPY.again);
  else {
    if (read.titleAt !== undefined)
      parts.push(`書名 ${seconds(read.titleAt - read.at)}秒`);
    if (read.savedAt !== undefined)
      parts.push(`保存 ${seconds(read.savedAt - read.at)}秒`);
  }
  return parts.join("・");
}

export interface TimingPlace {
  /** native (the browser's own reader) or wasm (ZXing). */
  reader: string;
  /** The camera's picture as it came (videoWidth × videoHeight). */
  picture: string;
  settings: TimingSettings;
  userAgent: string;
  /** When the record was made, as the reader reads it. */
  when: string;
}

/** The record to copy, one book a line, tab-separated. */
export function timingReport(timing: Timing, place: TimingPlace): string {
  const sum = summarize(timing);
  const ms = (value: number | null) =>
    value === null ? "-" : String(Math.round(value));
  const lines = [
    `BookTown スキャン計測 ${place.when}`,
    `読み取り ${place.reader}・映像 ${place.picture}・頼んだ幅 ${place.settings.size}・コマの間 ${place.settings.gap}ms`,
    `1コマ 中央 ${ms(sum.frameMs)}ms・最も遅い ${ms(sum.slowestMs)}ms・毎秒 ${sum.perSecond === null ? "-" : sum.perSecond.toFixed(1)}コマ`,
    sum.firstToLast === null
      ? `${counted(sum.books, "冊")}`
      : `1冊目から${nth(sum.books, "冊")}まで ${seconds(sum.firstToLast)}秒`,
    ["冊", "前の本から(秒)", "書名まで(秒)", "保存まで(秒)", "新しい本"].join(
      "\t",
    ),
    ...timing.reads.map((read, index) => {
      const before = timing.reads[index - 1];
      const after = (at?: number) =>
        at === undefined ? "-" : seconds(at - read.at);
      return [
        String(index + 1),
        before ? seconds(read.at - before.at) : "-",
        after(read.titleAt),
        after(read.savedAt),
        read.fresh ? "はい" : "いいえ",
      ].join("\t");
    }),
    place.userAgent,
  ];
  return lines.join("\n");
}

/** The timing mode's words. */
export const TIMING_COPY = {
  name: "計測",
  waiting: "読み取りを待っています",
  frame: (ms: number | null, perSecond: number | null) =>
    `1コマ ${ms === null ? "-" : Math.round(ms)}ms・毎秒 ${perSecond === null ? "-" : perSecond.toFixed(1)}コマ`,
  total: (books: number, ms: number) =>
    `1冊目から${nth(books, "冊")}まで ${seconds(ms)}秒`,
  again: "もう入っている本",
  gap: (ms: number) => (ms === 0 ? "コマの間 なし" : `コマの間 ${ms}ms`),
  size: (width: number) => `映像の幅 ${width}`,
  copy: "記録を写す",
  copied: "記録を写しました",
  copyHere: "下の記録を長押しして写してください",
} as const;
