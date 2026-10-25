// The cards of the continuous scanner's list (ScanSession.tsx): what each
// book read came to, what the card shows while its save is not confirmed,
// and how many there are of each for the count at the top (scanCount) and
// the notice on closing (closingNotice), both in scan.ts. Apart from scan.ts,
// whose words the book's page and the library use too: only the scanner
// reads this.

import type { ScanSort, Sent } from "./library-journal";
import type { TownBackend } from "./town-backend";

/** What a book read in this session came to, as its card shows it. */
export type Shows =
  | "looking"
  | "added"
  | "already"
  | "untitled"
  | "offline"
  | "waiting"
  | "unavailable"
  | "refused"
  | "undone";
export interface Card {
  /** The journal item's id (or a book entered by hand). */
  id: string;
  isbn?: string;
  bookId?: string;
  title?: string;
  author?: string;
  shows: Shows;
  /** The 連続設定 as it was when it was read, for its 元に戻す. */
  sort?: ScanSort;
}
/**
 * What a card shows now: as it came to, but "saving" for a book in the
 * library whose save is not confirmed yet, and "refused" once the database
 * turned it away after all.
 */
export type ShownNow = Shows | "saving";

/** A book not in the library yet: its card keeps its full form, never compact. */
export const KEPT: Shows[] = [
  "looking",
  "untitled",
  "offline",
  "waiting",
  "unavailable",
];
/**
 * この回の棚 (114): the books on it are those of the count's 登録済み and
 * 確認中, so the shelf and the words agree. 確認中 ones are drawn faint.
 */
export const ON_SHELF: ShownNow[] = [
  "added",
  "saving",
  "looking",
  "waiting",
  "offline",
];

/**
 * The books of this time still taken back: forgotten once it ends
 * (forget-books.ts), when ［元に戻す］ can no longer bring them back.
 */
export const takenBack = (cards: readonly Card[]): string[] =>
  cards.flatMap((card) =>
    card.shows === "undone" && card.bookId ? [card.bookId] : [],
  );

/** A card that can be taken back (登録を取り消す), as can one still saving. */
export const UNDOABLE: Shows[] = ["added", ...KEPT];

/** 元に戻す for a card taken back, unless the book was read again since. */
export const restorable = (card: Card, cards: readonly Card[]) =>
  card.shows === "undone" &&
  Boolean(card.isbn) &&
  !cards.some(
    (other) =>
      other.id !== card.id &&
      other.isbn === card.isbn &&
      other.shows !== "undone",
  );

/** What a card shows once its read was sent. */
export function showsOf(
  result: Sent["result"],
  savedIn: TownBackend["kind"],
): Shows {
  switch (result) {
    case "added":
    case "already":
    case "untitled":
      return result;
    case "lookup":
      // openBD did not answer in time: as untitled until it does (10-9).
      return navigator.onLine === false ? "offline" : "untitled";
    case "waiting":
      return savedIn === "unavailable" ? "unavailable" : "waiting";
    default:
      return "unavailable";
  }
}

/**
 * The session's books by what they came to. For the count at the top:
 * saved, on their way (a title asked for, saving, the town loading, no
 * network), and waiting for the reader (書名待ち, the account unreadable, a
 * save refused). For the notice on closing: registered (saved or saving),
 * waiting for a title, and kept on the device for another reason.
 */
export function tally(cards: Card[], shown: (card: Card) => ShownNow) {
  const count = (...kinds: ShownNow[]) =>
    cards.filter((card) => kinds.includes(shown(card))).length;
  return {
    saved: count("added"),
    checking: count("looking", "saving", "waiting", "offline"),
    attention: count("untitled", "unavailable", "refused"),
    closing: {
      added: count("added", "saving"),
      waiting: count("untitled", "offline"),
      later: count("looking", "waiting", "unavailable"),
    },
  };
}
