// The words the screens say again and again, in one place: how a number is
// counted ("3冊", "2ページ目"), and how a notice says something did not work.
// Screens build these with the functions here instead of writing "${n}冊" or
// "もう一度お試しください" themselves, so that a way of saying it changes
// here once. tests/words.test.ts keeps counts and failure words from being
// written by hand again. (The names of things, 書店 and 便り, are to join
// them here: 管理表 90.)

// ── Counts ──────────────────────────────────────────────────────────────

/** What is counted, and the one word it is counted in. */
export type CountUnit =
  | "冊"
  | "人"
  | "件"
  | "軒"
  | "回"
  | "枚"
  | "個"
  | "ページ"
  | "段"
  | "字"
  | "文字"
  | "分"
  | "時間";

/**
 * "3冊". For a count that is the reader's own record (shown as it is, 0 too:
 * けにーさん 2026-10-16「数字に嘘をついてはいけない」), a limit, or a number
 * that is never 0 where it is said. A count of other people, or of what
 * others did, is never shown at 0: say it with {@link someCount} or
 * {@link whenSome} (a count of people can only be said that way).
 */
export function counted(n: number, unit: Exclude<CountUnit, "人">): string {
  return `${n}${unit}`;
}

/** "3ページ目", "2段目": the place of one in a row, counted from 1. */
export function nth(n: number, unit: CountUnit): string {
  return `${n}${unit}目`;
}

/** "3 / 9 冊": how many of the most there can be. */
export function outOf(
  n: number,
  most: number,
  unit: Exclude<CountUnit, "人">,
): string {
  return `${n} / ${most} ${unit}`;
}

/**
 * "3人", or null when there are none: a 0 is never shown, so that a quiet
 * town does not show how quiet it is (CLAUDE.md「画面に0を出さない」).
 * Leave the line out, or show a way in instead, where this is null.
 */
export function someCount(n: number, unit: CountUnit): string | null {
  return Number.isFinite(n) && n > 0 ? `${n}${unit}` : null;
}

/** The words around a count ("3人がフォロー"), or null when there are none. */
export function whenSome<T>(
  n: number,
  unit: CountUnit,
  say: (counted: string) => T,
): T | null {
  const counted = someCount(n, unit);
  return counted === null ? null : say(counted);
}

// ── The tabs ────────────────────────────────────────────────────────────

/**
 * The names of the tabs at the bottom (and down the side on a wide screen),
 * in their order (管理表 48: the row for the β, which its readers' voices
 * may change). A tab's name changes here once, and the page it opens says
 * the same name over it: ライブラリ is both the tab and the library's
 * heading (けにー 10-18 03:33Z「なら一旦ライブラリで」). What a book is put
 * in is still called 本棚 ({@link REGISTER}) until 管理表 90 asks.
 */
export const TABS = {
  home: "ホーム",
  search: "検索",
  walk: "書店めぐり",
  library: "ライブラリ",
  reading: "記録",
  /** 記録, while a book is being read. */
  readingNow: "読書中",
  profile: "わたし",
} as const;

// ── Registering a book ──────────────────────────────────────────────────

/**
 * How a book is put in the reader's library (本棚), said the same on every
 * screen that offers it: a found book's one tap, the ways in when a search
 * finds nothing, and what is said once it is in (管理表 12).
 */
export const REGISTER = {
  /** The one tap beside a found book, short. */
  tap: "登録",
  /** The same, where there is room: a book's page. */
  button: "本棚に登録",
  /** A book already in, short and where there is room. */
  doneTap: "登録済み",
  done: "本棚に登録済み",
  /** The doors when a search finds nothing. */
  byBarcode: "バーコードで登録",
  byTitle: "この書名で登録",
  byIsbn: "このISBNで登録",
  /** First of はじめの3つ, and the scanner's own name. */
  start: "本を登録",
  /** What is said once a book, named in 『』, is in or was in already. */
  added: (quoted: string) => `${quoted}を登録しました`,
  already: (quoted: string) => `${quoted}はもうライブラリにあります`,
  undone: (quoted: string) => `${quoted}の登録を取り消しました`,
  /** Asked before a book is taken out (けにー 10-18), and again when it has a trace. */
  removeAsk: "本当に本棚から外しますか？",
  remove: "本棚から外す",
  keep: "外さない",
  traces: "この本には記録やメモが含まれています",
  finished: "読了した本です",
  reading: "読書中です",
  traceStays: "外しても、記録とメモは消えません",
  removeAskAgain: "本当に外しますか？",
} as const;

// ── Placing a book in the reader's shop ─────────────────────────────────

/**
 * How a book of the library is put on a shelf of the reader's own shop,
 * said the same on the book's page, the shop's book picker and the opening
 * of a shop (管理表 103).
 */
export const PLACE = {
  /** The book's page: opens the shop with this book chosen. */
  toShop: "自分の書店へ",
  /** The picker's two groups before anything is typed: the reader's first. */
  yours: "あなたの本棚",
  town: "街の本",
  /** The book chosen on its page, first in the picker. */
  chosen: "本のページから選んだ本",
  /** Asked when the shop has more than one shelf. */
  whichShelf: "どの棚に並べますか？",
  /** Opening a shop: the books picked for the kind of shop chosen. */
  suggested: "おすすめ",
  /** Shows the next books of a long shelf. */
  more: "もっと見る",
} as const;

// ── Failure notices ─────────────────────────────────────────────────────

/**
 * What a notice says when something did not work, in this order: what
 * happened, what is still kept (the work written so far, nothing lost), and
 * what to do next. Each part is one sentence, without its 「。」.
 */
export type Failure = {
  /** What happened: "保存できませんでした". */
  what?: string;
  /** What is still there, or that it is not: {@link KEPT}. */
  kept?: string;
  /** What to do next: {@link AGAIN}, or the step itself. */
  next?: string;
};

/** The title over a page that could not be read in. */
export const NOT_CONNECTED = "つながりませんでした";

/** While offline: the change waits in this browser until the town is back. */
export const WHILE_OFFLINE = {
  what: "つながらないため、まだ保存できていません",
  kept: "つながりしだい保存します",
} as const satisfies Failure;

/**
 * While offline, for a change with a name of its own (投稿, 返信, 記録): it
 * waits on this device and goes once the town is back (outbox.ts).
 */
export const offlineFor = (change: string) =>
  ({
    what: `つながらないため、まだ${change}できていません`,
    kept: `つながりしだい${change}します`,
  }) satisfies Failure;

/** What is still kept when something did not work. */
export const KEPT = {
  /** The reader's work, kept in this browser (src/lib/kept-draft.ts). */
  draft: "書きかけは残しています",
  /** Nothing was taken away. */
  nothing: "何も消えていません",
} as const;

/**
 * How a notice asks to try again. A wait is always said one way, 少し時間を
 * おいて (けにーさん 2026-10-17); how is said only when it differs.
 */
export const AGAIN = {
  now: "もう一度お試しください",
  later: "少し時間をおいて、もう一度お試しください",
  connection: "通信の状態を確かめて、もう一度お試しください",
  /** For a button: pressed again once the town is in. */
  pressWhenLoaded: "読み込みが終わってから、もう一度押してください",
  pressLater: "少し時間をおいて、もう一度押してください",
} as const;

/**
 * The notice, its sentences in order: "保存できませんでした。書きかけは残して
 * います。少し時間をおいて、もう一度お試しください。" `end` is what closes it:
 * 「。」, or nothing for the notices that are written without it today.
 */
export function failure(
  { what, kept, next }: Failure,
  end: "。" | "" = "。",
): string {
  return [what, kept, next].filter(Boolean).join("。") + end;
}
