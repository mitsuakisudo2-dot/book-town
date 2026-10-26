// The words the screens say again and again, in one place: how a number is
// counted ("3冊", "2ページ目"), and how a notice says something did not work.
// Screens build these with the functions here instead of writing "${n}冊" or
// "もう一度お試しください" themselves, so that a way of saying it changes
// here once. tests/words.test.ts keeps counts and failure words from being
// written by hand again, and the names of things (書店, 便り) from being
// said another way (管理表 90).

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

// ── The names of things ─────────────────────────────────────────────────

/**
 * What the town calls its things, one word each (管理表 90). A reader's shop
 * is a 書店, never a 本屋 (けにー 10-16 23:28Z). What a book is put in is
 * the ライブラリ, a shelf the reader makes in it is a 本棚, and a shelf of a
 * 書店 is a 棚 (けにー 10-18, AUD-057). A reader's short writing is
 * a 便り, for now (10-16 23:29Z「とりあえず便りでいいかな。統一しといたら
 * 変える時も楽」): every screen says it through {@link NAMES}.letter, so that
 * it changes here once. Only the button that sends one says 投稿する.
 * tests/words.test.ts stops 本屋, つぶやき, the noun 投稿 and a 便り
 * written by hand.
 */
export const NAMES = {
  /** The service, in one spelling (AUD-064). */
  service: "BookTown",
  /** Said beside the service's name in the page's title. */
  catchphrase: "本を読みたくなるSNS",
  shop: "書店",
  /** A reader's short writing, and what a reply answers. */
  letter: "便り",
  /** The button that sends a 便り. */
  post: "投稿する",
  /** The same, short, on the round button that opens the writing. */
  postTap: "投稿",
} as const;

/** The page's title: "便りだけ | BookTown". */
export const pageTitle = (name: string) => `${name} | ${NAMES.service}`;

/** The title of the home, and of a page that has no name of its own. */
export const HOME_TITLE = `${NAMES.service} | ${NAMES.catchphrase}`;

/** The name a shop's first shelf is opened with (a shelf of a 書店 is a 棚). Shelves already made keep their names. */
export const FIRST_SHELF_NAME = "はじめの棚";

/** What the ライブラリ calls making and editing a 本棚 (AUD-057); a 書店's own shelf is a 棚. */
export const LIBRARY_SHELF = {
  make: "本棚をつくる",
  edit: "本棚を編集",
} as const;

// ── The tabs ────────────────────────────────────────────────────────────

/**
 * The names of the tabs at the bottom (and down the side on a wide screen),
 * in their order (管理表 48: the row for the β, which its readers' voices
 * may change). A tab's name changes here once, and the page it opens says
 * the same name over it: ライブラリ is both the tab and the library's
 * heading (けにー 10-18 03:33Z「なら一旦ライブラリで」), and what a book is
 * put in ({@link REGISTER}).
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
 * How a book is put in the reader's library, said the same on every
 * screen that offers it: a found book's one tap, the ways in when a search
 * finds nothing, and what is said once it is in (管理表 12).
 */
export const REGISTER = {
  /** The one tap beside a found book, short. */
  tap: "登録",
  /** The same, where there is room: a book's page. */
  button: "ライブラリに登録",
  /** A book already in, short and where there is room. */
  doneTap: "登録済み",
  done: "ライブラリに登録済み",
  /** The doors when a search finds nothing. */
  byBarcode: "バーコードで登録",
  byTitle: "この書名で登録",
  byIsbn: "このISBNで登録",
  /** First of はじめの3つ, and the scanner's own name. */
  start: "本を登録",
  /** Said under it: the two ways in (#383). */
  how: "バーコードか、書名で",
  /** What is said once a book, named in 『』, is in or was in already. */
  added: (quoted: string) => `${quoted}を登録しました`,
  already: (quoted: string) => `${quoted}はもうライブラリにあります`,
  undone: (quoted: string) => `${quoted}の登録を取り消しました`,
  /** Asked before a book is taken out (けにー 10-18), and again when it has a trace. */
  removeAsk: "本当にライブラリから外しますか？",
  remove: "ライブラリから外す",
  keep: "外さない",
  traces: "この本には記録やメモが含まれています",
  finished: "読了した本です",
  reading: "読書中です",
  traceStays: "外しても、記録とメモは消えません",
  removeAskAgain: "本当に外しますか？",
} as const;

// ── Placing a book in the reader's shop ─────────────────────────────────

/**
 * The reader's own place for a book, on its page (AUD-052): the two kinds
 * the reader sets, apart (けにーさん 10-18 06:10Z「読書の状態」と「持って
 * いる本」は異なる概念), and their shop.
 */
export const MY_BOOK = {
  status: "読書の状態",
  owned: "持っている本",
  inShop: "自分の書店に並べています",
};

/**
 * How a book of the library is put on a shelf of the reader's own shop,
 * said the same on the book's page, the shop's book picker and the opening
 * of a shop (管理表 103).
 */
export const PLACE = {
  /** The book's page: opens the shop with this book chosen. */
  toShop: "自分の書店へ",
  /** The picker's two groups before anything is typed: the reader's first. */
  yours: "あなたのライブラリ",
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

/** The door to 整える, where the reader's shop is tended (けにー 10-25). */
export const SHOP_TIDY = "店を整える";

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
