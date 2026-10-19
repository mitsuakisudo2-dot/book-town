import {
  DEFAULT_SHELVES,
  READING_STATUSES,
  type LibraryEntry,
  type ReadingStatus,
} from "./library";
import type { LibraryChange } from "./library-town";

// What the reader can set on a book of their library, and how it is said
// after (「n冊を」「『題名』を」 comes first): the library's ［選ぶ］ and the
// book's own page (AUD-052) say it the same way.

/** The name of a default shelf of the library (読了, 持ってない, …). */
export const shelfName = (key: string): string =>
  DEFAULT_SHELVES.find((shelf) => shelf.key === key)?.label ?? key;

/** The shelf a status is, for its name. */
export const statusName = (status: ReadingStatus): string => shelfName(status);

export interface LibraryMark {
  key: string;
  label: string;
  /** Lit: every book it is asked of already has it (`on`: the reader's shelves the book is on). */
  lit: (
    e: LibraryEntry | undefined,
    favorite: boolean,
    on: ReadonlySet<string>,
  ) => boolean;
  /** The change, as it is lit or not. */
  change: (lit: boolean) => LibraryChange;
  /** What was done, after 「n冊を」. */
  done: (lit: boolean) => string;
}

/** 積読・読書中・読了: pressed again, the one lit is taken off. */
export const STATUS_MARKS: LibraryMark[] = READING_STATUSES.map((status) => ({
  key: status,
  label: statusName(status),
  lit: (e) => e?.status === status,
  change: (lit) => ({ status: lit ? null : status }),
  done: (lit) =>
    lit
      ? `${statusName(status)}から外しました`
      : `${statusName(status)}にしました`,
}));

/** 持っている・持ってない: one of the two, or neither. */
export const OWNED_MARKS: LibraryMark[] = [
  {
    key: "owned",
    label: "持っている",
    lit: (e) => e?.owned === "yes",
    change: (lit) => ({ owned: lit ? null : "yes" }),
    done: (lit) =>
      lit ? "持っている本から外しました" : "持っている本にしました",
  },
  {
    key: "not-owned",
    label: "持ってない",
    lit: (e) => e?.owned === "no",
    change: (lit) => ({ owned: lit ? null : "no" }),
    done: (lit) =>
      lit ? "持ってない本から外しました" : "持ってない本にしました",
  },
];

/** Its notice's 元に戻す, after. */
export const UNDONE = {
  label: "元に戻す",
  back: (what: string) => `${what}を元に戻しました`,
  kept: "そのあと変えた本なので、そのままにしました",
};
