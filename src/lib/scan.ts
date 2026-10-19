// What one read of the continuous scanner comes to (ScanSession.tsx): which
// codes in a camera frame are new, the 3-second rule for the same book, the
// reaction to an ISBN, the hints for barcodes that are not a book's ISBN,
// and the notice when the scanner closes. Nothing here keeps or sends
// anything; library-journal.ts does that.

import { normalizeIsbn } from "./books";
import type { ScanItem } from "./library-journal";
import type { Book } from "./types";
import { counted, failure, AGAIN } from "./words";
import { SLOT_COUNT } from "./scan-slots";

/** The same book read again within this long of last being in view is one read. */
export const SAME_BOOK_MS = 3000;
/**
 * A code stays in view until it has been missed for longer than this. A
 * camera held over a book misses frames (a blur, the focus moving), and a
 * book held still must not be read again for that, however many frames a
 * second the camera is read (three frames at 200ms before 10-18).
 */
export const LEAVE_MS = 600;
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

/** The codes in view, each with when it was last in a frame. */
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
  now: number,
): { inView: InView; fresh: Barcode[]; staying: string[] } {
  const seen = (key: string) => key in inView && now - inView[key] <= LEAVE_MS;
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
    next[key] = now;
    if (!seen(key)) fresh.push(barcode);
    else if (barcode.kind === "isbn") staying.push(key);
  }
  for (const [key, at] of Object.entries(inView))
    if (!(key in next) && seen(key)) next[key] = at;
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

/** 元に戻す of a card taken back: the ISBN is this session's again, unread now. */
export function noteBack(
  reads: SessionReads,
  isbn: string,
  taken: Taken,
): SessionReads {
  return { ...reads, taken: { ...reads.taken, [isbn]: taken } };
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
      `${counted(added, "冊")}を登録しました` +
      (waiting > 0 ? `・書名待ち ${counted(waiting, "冊")}` : "") +
      (later > 0 ? `・${counted(later, "冊")}は控えに置きました` : "")
    );
  const kept = waiting + later;
  if (kept > 0)
    return (
      `${counted(kept, "冊")}を控えました` +
      (waiting > 0 ? `（書名待ち ${counted(waiting, "冊")}）` : "")
    );
  return null;
}

/** How long a remark about a read (もうライブラリにあります …) stays over the camera. */
export const NOTICE_MS = 3600;

/**
 * The count at the scanner's top (資料 8章): the books whose saving is
 * confirmed, the books on their way (a title being looked up, saving, the
 * town loading) and the books that wait for the reader. A part with none is
 * left out, so nothing says 0; with nothing at all it is empty.
 */
export function scanCount(counts: {
  saved: number;
  checking: number;
  attention: number;
}): string {
  const { saved, checking, attention } = counts;
  return [
    saved > 0 ? `${counted(saved, "冊")} 登録済み` : "",
    checking > 0 ? `${counted(checking, "冊")}確認中` : "",
    attention > 0 ? `${counted(attention, "冊")}要確認` : "",
  ]
    .filter(Boolean)
    .join("・");
}

/** The scanner's words. */
export const SCAN_COPY = {
  name: "本を続けて登録",
  preparing: "準備しています…",
  cameraStarting: "カメラを起動しています…",
  guide: "ISBNバーコードをかざす",
  firstCamera: "読むと、その場で登録します",
  /** The list of this time's books, newest first. */
  list: "この回に読んだ本",
  finish: "完了",
  typeIsbn: "ISBNを打つ",
  useCamera: "カメラで読む",
  byHand: "手で入力",
  sound: "音",
  light: "ライト",
  larger: "カメラを大きくする",
  smaller: "カメラを小さくする",
  more: (name: string) => `${name}のほかの操作`,
  undo: "登録を取り消す",
  undoName: (name: string) => `${name}の登録を取り消す`,
  /** A card swiped from right to left (資料 4章): the same as 登録を取り消す. */
  remove: "削除",
  restore: "元に戻す",
  restoreName: (name: string) => `${name}を元に戻す`,
  statuses: (name: string) => `${name}の読書状況`,
  /** The card's second row (資料 4章の自由3枠): 未所持・お気に入り・＋本棚. */
  marks: (name: string) => `${name}の所有とお気に入りと本棚`,
  notOwned: "未所持",
  shelf: "本棚",
  shelvesOf: (name: string) => `${name}を入れる本棚`,
  noShelves: "本棚はライブラリでつくれます",
  /** 連続設定 (資料 3章): the bar under the camera, and its sheet. */
  sort: {
    name: "連続設定",
    on: "連続設定中",
    change: "変更",
    off: "解除",
    next: "次から",
    lead: "これから読み取る本に、自動で設定します",
    status: "読書状況",
    none: "未指定",
    owned: "持っている",
    ownedOff: "OFFで「未所持」に登録します",
    shelves: "追加する本棚",
    several: "複数選択できます",
    go: "この設定でスキャン",
    anytime: "設定はいつでも変更・解除できます",
  },
  /** 一括整理 (Figma v4's 05): this time's books, several at once. */
  tidy: {
    name: "一括整理",
    back: "連続登録に戻る",
    picked: (n: number) => `${counted(n, "冊")}選択中`,
    all: "すべて選択",
    unsorted: "未設定のみ",
    list: "この回の本",
    none: "未設定",
    allSet: "どの本にも読書状況があります",
    to: (n: number) => `選択中の${counted(n, "冊")}に適用`,
    toNone: "選んだ本に適用",
    shelvesTo: "選んだ本を入れる本棚",
    owned: "所有状況",
    done: "整理を終える",
  },
  /** 完了 (Figma v4's 08). */
  done: {
    name: "登録完了",
    counted: "冊の登録が完了しました",
    allSaved: "すべての本が保存されています",
    checking: (n: number) => `${counted(n, "冊")}を確認しています…`,
    attention: (n: number) => `${counted(n, "冊")}は要確認です`,
    sortEnded: "連続設定も終了しました",
    library: "ライブラリを見る",
    time: "この回の本を見る",
    close: "閉じる",
  },
  compact: "コンパクト表示",
  /** 自由3枠 (資料 4章): the buttons of a card's second row, picked. */
  slots: {
    open: "下の段のボタンを選ぶ",
    name: "下の段のボタン",
    lead: "本ごとの下の段に、左から並びます",
    row: "並び",
    can: "並べられるもの",
    full: `${SLOT_COUNT}つまで並びます`,
    empty: "何も並べないと、下の段は出ません",
    left: (name: string) => `${name}を左へ`,
    right: (name: string) => `${name}を右へ`,
    remove: (name: string) => `${name}を外す`,
    toLeft: "左へ",
    toRight: "右へ",
    off: "外す",
    done: "閉じる",
  },
  /** 続きから再開 (Figma v4's 09). */
  resume: {
    name: "前回の登録を続けますか？",
    kept: "保存済みの本は、そのまま残っています",
    go: "続きから再開",
    notNow: "今はしない",
    /** The 連続設定 of that time, given back only when pressed. */
    sort: "前回の連続設定",
    sortBack: "連続設定も戻す",
  },
  /** スキャンした回 (資料 §2 J), in the library. */
  history: {
    name: "スキャンした回",
    of: (when: string) => `${when}の回`,
    note: (when: string) => `${when}に読み取って、いまライブラリにある本です。`,
    books: (titles: string[], more: number) =>
      titles.join("、") + (more > 0 ? ` ほか${counted(more, "冊")}` : ""),
  },
  /** 重複の知らせ (Figma v4's 06) and 書誌の取得失敗 (07). */
  showBook: "登録済みの本を表示する",
  retry: "再試行",
  byTitle: "書名で検索・修正",
  fixOf: (isbn: string) => `ISBN ${isbn} の本を調べ直す`,
  paused: "一時停止しています",
  banner: {
    offline:
      "オフラインです。読んだ本は端末に控えています。つながったら登録します",
    loading:
      "読み込んでいます。読んだ本は端末に控えて、読み込みが終わったら登録します",
    unavailable: failure(
      {
        what: "アカウントを読み込めませんでした",
        kept: "読んだ本は端末に控えています",
        next: "ページを読み込み直すと登録します",
      },
      "",
    ),
    notKept: failure(
      {
        what: "この端末に控えを置けません",
        kept: "ページを閉じると、まだ登録していない本は失われます",
      },
      "",
    ),
  },
  typing: {
    help: "13桁そろうと登録します",
    badIsbn: failure(
      {
        what: "ISBNとして読めませんでした",
        next: "978か979で始まる13桁を確かめてください",
      },
      "",
    ),
    price: "上の段のバーコード（978…）の数字を打ってください",
    magazine: "雑誌は［手で入力］から書名で登録できます",
  },
  /** Why ISBNs are typed, under 13桁そろうと登録します: the cause only. */
  note: {
    "no-reader": "このブラウザはバーコードを読み取れません",
    "reader-failed": failure(
      {
        what: "読み取りの準備ができませんでした",
        next: "電波のよい所で［カメラで読む］をもう一度",
      },
      "",
    ),
    denied: "カメラが使えません",
    "no-camera": "カメラが見つかりません",
    busy: "カメラをほかのアプリが使っているようです",
    settings: "カメラは端末の設定で許可できます",
  },
  hint: {
    price: "上の段のバーコード（978…）を読んでください",
    magazine: "雑誌は右上のキーボードから書名で登録できます",
    other: "本のバーコード（978・979で始まる段）を読んでください",
  } satisfies Record<OtherKind, string>,
  card: {
    looking: "書名を調べています…",
    /** In the library, and the save not confirmed yet. */
    saving: "保存しています…",
    /** In the library, and saved. */
    added: "登録しました",
    untitledTitle: "書名がわからない本",
    /** openBD did not know it (Figma v4's 07). */
    noBib: failure({ what: "書籍情報を取得できませんでした" }, ""),
    untitled: "読み取り済み・再入力不要",
    offline: "つながったら書名を調べます",
    waiting: "読み込みが終わったら登録します",
    unavailable: "端末に控えました。ページを読み込み直すと登録します",
    refused: failure({ what: "保存できませんでした" }, ""),
    same: "同じ本です",
    againIn: "この回でもう入れました",
    already: "もうライブラリにあります",
    held: "もう控えにあります",
    undone: "取り消しました",
    notYet: failure({ what: "まだ取り消せません", next: AGAIN.pressLater }, ""),
  },
} as const;
