// What one read of the continuous scanner comes to (ScanSession.tsx): which
// codes in a camera frame are new, the 3-second rule for the same book, the
// reaction to an ISBN, the hints for barcodes that are not a book's ISBN,
// and the notice when the scanner closes. Nothing here keeps or sends
// anything; library-journal.ts does that.

import { normalizeIsbn } from "./books";
import type { ScanItem } from "./library-journal";
import type { Book } from "./types";

/** The same book read again within this long of last being in view is one read. */
export const SAME_BOOK_MS = 3000;
/**
 * A code stays in view until this many frames in a row have missed it. A
 * camera held over a book misses single frames (a blur, the focus moving),
 * and a book held still must not be read again for that.
 */
export const MISSES_TO_LEAVE = 3;
/** A hint comes at this read of a barcode that is not a book's ISBN. */
export const HINT_AT = 2;

export type OtherKind = "price" | "magazine" | "other";
export type Barcode =
  { kind: "isbn"; isbn: string } | { kind: OtherKind; code: string };

/**
 * What a barcode is: a book's ISBN, the price code printed under it on
 * Japanese books (192…), a magazine (491…), or something else.
 */
export function readBarcode(raw: string): Barcode {
  const code = raw.replace(/[\s-]/g, "");
  const isbn = normalizeIsbn(code);
  if (isbn) return { kind: "isbn", isbn };
  if (/^192\d{10}$/.test(code)) return { kind: "price", code };
  if (/^491\d{10}$/.test(code)) return { kind: "magazine", code };
  return { kind: "other", code };
}

const keyOf = (barcode: Barcode) =>
  barcode.kind === "isbn" ? barcode.isbn : barcode.code;

/** The codes in view, each with how many frames in a row have missed it. */
export type InView = Readonly<Record<string, number>>;

/**
 * One camera frame. `fresh`: the codes that came into view with it, each
 * one read. `staying`: the ISBNs that were in view already and still are.
 * A frame holding an ISBN gives only its ISBNs: the price code sits right
 * under every Japanese book's ISBN.
 */
export function nextFrame(
  inView: InView,
  frame: readonly string[],
): { inView: InView; fresh: Barcode[]; staying: string[] } {
  const all = frame.map(readBarcode);
  const codes = all.some((barcode) => barcode.kind === "isbn")
    ? all.filter((barcode) => barcode.kind === "isbn")
    : all;
  const next: Record<string, number> = {};
  const fresh: Barcode[] = [];
  const staying: string[] = [];
  for (const barcode of codes) {
    const key = keyOf(barcode);
    if (key in next) continue;
    next[key] = 0;
    if (!(key in inView)) fresh.push(barcode);
    else if (barcode.kind === "isbn") staying.push(key);
  }
  for (const [key, misses] of Object.entries(inView))
    if (!(key in next) && misses + 1 < MISSES_TO_LEAVE) next[key] = misses + 1;
  return { inView: next, fresh, staying };
}

/** What each ISBN read in one session came to. */
export type Taken =
  /** Registered in this session. */
  | "in"
  /** In the library already. */
  | "already"
  /** Kept on the device only, so far. */
  | "held";

export interface SessionReads {
  /** The ISBN read last, and when it was last in view (or typed). */
  last: { isbn: string; seenAt: number } | null;
  taken: Readonly<Record<string, Taken>>;
  /** Reads of codes that are not ISBNs, by kind. */
  others: Readonly<Record<OtherKind, number>>;
  /** The hints already given in this session. */
  hinted: readonly OtherKind[];
}

export const NO_READS: SessionReads = {
  last: null,
  taken: {},
  others: { price: 0, magazine: 0, other: 0 },
  hinted: [],
};

/** While the last ISBN stays in view, its time in view keeps moving. */
export function stillInView(
  reads: SessionReads,
  staying: readonly string[],
  now: number,
): SessionReads {
  return reads.last && staying.includes(reads.last.isbn)
    ? { ...reads, last: { isbn: reads.last.isbn, seenAt: now } }
    : reads;
}

/** What the town knows of an ISBN, for the reaction to it. */
export interface ScanTown {
  inLibrary(isbn: string): Book | undefined;
  known(isbn: string): Book | undefined;
}

export type ScanReaction =
  /** The book read last, still or again within 3 seconds: nothing is written. */
  | { kind: "same" }
  /** Read before in this session. */
  | { kind: "again"; was: Taken }
  | { kind: "already"; book: Book }
  /** Kept on the device from an earlier session, still waiting. */
  | { kind: "held"; item: ScanItem }
  /** A new book; `known` when the town has it, so its title is at hand. */
  | { kind: "new"; known?: Book };

/**
 * The reaction to one ISBN read. `town` is null while the town is not read
 * yet; `held` finds a waiting journal item with the ISBN.
 */
export function scanReaction(
  reads: SessionReads,
  isbn: string,
  now: number,
  town: ScanTown | null,
  held: (isbn: string) => ScanItem | undefined,
): ScanReaction {
  if (reads.last?.isbn === isbn && now - reads.last.seenAt < SAME_BOOK_MS)
    return { kind: "same" };
  const was = reads.taken[isbn];
  if (was) return { kind: "again", was };
  const book = town?.inLibrary(isbn);
  if (book) return { kind: "already", book };
  const item = held(isbn);
  if (item) return { kind: "held", item };
  const known = town?.known(isbn);
  return known ? { kind: "new", known } : { kind: "new" };
}

/** Notes an ISBN read now; `taken` is null for a read that changes nothing. */
export function noteRead(
  reads: SessionReads,
  isbn: string,
  now: number,
  taken: Taken | null,
): SessionReads {
  return {
    ...reads,
    last: { isbn, seenAt: now },
    taken: taken ? { ...reads.taken, [isbn]: taken } : reads.taken,
  };
}

/**
 * What a read came to once it was sent, unless it was taken back since. A
 * book put in during this session stays so: the library having it is that.
 */
export function noteTaken(
  reads: SessionReads,
  isbn: string,
  taken: Taken,
): SessionReads {
  const was = reads.taken[isbn];
  return was !== undefined &&
    was !== taken &&
    !(was === "in" && taken === "already")
    ? { ...reads, taken: { ...reads.taken, [isbn]: taken } }
    : reads;
}

/** ［取り消す］: the ISBN reads as new again. */
export function forgetRead(reads: SessionReads, isbn: string): SessionReads {
  const taken = { ...reads.taken };
  delete taken[isbn];
  return {
    ...reads,
    taken,
    last: reads.last?.isbn === isbn ? null : reads.last,
  };
}

/**
 * A camera read of a code that is not an ISBN. The hint for its kind comes
 * at the second read, once in a session.
 */
export function noteOther(
  reads: SessionReads,
  kind: OtherKind,
): { reads: SessionReads; hint: string | null } {
  const count = reads.others[kind] + 1;
  const others = { ...reads.others, [kind]: count };
  if (count < HINT_AT || reads.hinted.includes(kind))
    return { reads: { ...reads, others }, hint: null };
  return {
    reads: { ...reads, others, hinted: [...reads.hinted, kind] },
    hint: SCAN_COPY.hint[kind],
  };
}

/**
 * The notice when the scanner closes, or null when nothing was read in.
 * `added`: registered; `waiting`: titles not known (書名待ち); `later`: kept
 * on the device for another reason (the town loading, no account, a title
 * still being looked up).
 */
export function closingNotice(counts: {
  added: number;
  waiting: number;
  later: number;
}): string | null {
  const { added, waiting, later } = counts;
  if (added > 0)
    return (
      `${added}冊を登録しました` +
      (waiting > 0 ? `・書名待ち ${waiting}冊` : "") +
      (later > 0 ? `・${later}冊は控えに置きました` : "")
    );
  const kept = waiting + later;
  if (kept > 0)
    return (
      `${kept}冊を控えました` + (waiting > 0 ? `（書名待ち ${waiting}冊）` : "")
    );
  return null;
}

/** The scanner's words. */
export const SCAN_COPY = {
  name: "本を続けて登録",
  preparing: "準備しています…",
  cameraStarting: "カメラを起動しています…",
  guide: "上の段（978…）を枠に",
  firstCamera: "読むと、その場で登録します",
  firstTyping: "ISBNを打つと、その場で登録します",
  paused: "一時停止しています",
  banner: {
    offline:
      "オフラインです。読んだ本は端末に控えています。つながったら登録します",
    loading:
      "読み込んでいます。読んだ本は端末に控えて、読み込みが終わったら登録します",
    unavailable:
      "アカウントを読み込めませんでした。読んだ本は端末に控えています。ページを読み込み直すと登録します",
    notKept:
      "この端末に控えを置けません。ページを閉じると、まだ登録していない本は失われます",
  },
  typing: {
    help: "13桁そろうと登録します",
    badIsbn:
      "ISBNとして読めませんでした。978か979で始まる13桁を確かめてください",
    price: "上の段のバーコード（978…）の数字を打ってください",
    magazine: "雑誌は［手で入力］から書名で登録できます",
  },
  note: {
    "no-reader":
      "このブラウザはバーコードを読み取れません。ISBNを続けて打って登録できます",
    "reader-failed":
      "読み取りの準備ができませんでした。電波のよい所で［カメラで読む］をもう一度",
    denied: "カメラが使えません。ISBNを続けて打てます",
    "no-camera": "カメラが見つかりません。ISBNを続けて打てます",
    busy: "カメラをほかのアプリが使っているようです。ISBNを続けて打てます",
    settings: "カメラは端末の設定で許可できます",
  },
  hint: {
    price: "上の段のバーコード（978…）を読んでください",
    magazine: "雑誌は［手で入力］から書名で登録できます",
    other: "本のバーコード（978・979で始まる段）を読んでください",
  } satisfies Record<OtherKind, string>,
  card: {
    looking: "書名を調べています…",
    added: "登録しました",
    untitledTitle: "書名がわからない本",
    untitled: "控えに置きました",
    offline: "つながったら書名を調べます",
    waiting: "読み込みが終わったら登録します",
    unavailable: "端末に控えました。ページを読み込み直すと登録します",
    refused: "保存できませんでした",
    same: "同じ本です",
    againIn: "この回でもう入れました",
    already: "もうライブラリにあります",
    held: "もう控えにあります",
    undone: "取り消しました",
    notYet: "まだ取り消せません。少し待ってから、もう一度押してください",
  },
} as const;
