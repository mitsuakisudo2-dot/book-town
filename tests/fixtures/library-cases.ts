import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EncounterKind,
  EncounterVia,
  EntryContext,
  EntrySource,
  LibraryEntry,
  LibrarySet,
  MarkKind,
} from "../../src/lib/library";

// The library's shared cases (library-cases.json), typed. test:library runs
// them against src/lib/library.ts; test:db replays the follow and save cases
// against the trigger private.library_follows_marks, the backfill cases
// against private.library_backfill, and the apply cases and sequences as
// the writes the app sends, so both say the same thing.
//
// A row is written only by what differs from a row scanned at the start of
// 2026 with nothing set (ENTRY_DEFAULTS), and a context only by what differs
// from a book nothing else holds (CONTEXT_DEFAULTS).

/** A row by what differs from ENTRY_DEFAULTS. */
export type EntryPart = Partial<Omit<LibraryEntry, "bookId">>;

/** A mark written or deleted by an app that does not know the library, and the row after. */
export interface FollowCase {
  name: string;
  /** The book's row before; null: none. */
  entry: EntryPart | null;
  /** The book's marks before the change. */
  marks: MarkKind[];
  /** A theme shelf holding the book: none, one not put away, or one put away. */
  shelf: "none" | "live" | "deleted";
  /** The reader's own reading record of it. */
  record: boolean;
  /** An encounter of it holds a memo (taken back or not). */
  memo?: boolean;
  change: { op: "insert" | "delete"; kind: MarkKind; at: string };
  /**
   * The row after: "same" (unchanged), null (no row), or a row whose
   * removedAt or statusAt may be "@now", the database's time.
   */
  expect: EntryPart | null | "same";
}

/**
 * One save of an app that does not know the library, changing one book's
 * marks: every mark taken off is deleted first, then every mark put on is
 * written (planWrites in src/lib/town-remote.ts), each written mark dated by
 * the database. The row after, as in FollowCase.
 */
export interface SaveCase {
  name: string;
  entry: EntryPart | null;
  /** The book's marks before the save, and after it. */
  marks: MarkKind[];
  after: MarkKind[];
  expect: EntryPart | null | "same";
}

/** What a reader had before the library, for one book, and the row the backfill makes. */
export interface BackfillCase {
  name: string;
  marks: { kind: MarkKind; at: string }[];
  /** When each of the reader's own records was written. */
  records: string[];
  sessions: { startedAt: string; endedAt: string | null }[];
  /**
   * The reader's own uses of the book, by when (N19, N20): a post, a poster
   * (put up or a draft), the nine (the profile's date stands in), a shelf of
   * their shop (public or private; the shop's date stands in) or its store
   * scene.
   */
  uses?: {
    kind: "post" | "poster" | "nine" | "shelf" | "scene";
    draft?: boolean;
    private?: boolean;
    at: string;
  }[];
  /** null: no row. */
  expect: EntryPart | null;
}

/** A press, and whether it makes an encounter the table takes. */
export interface EncounterCase {
  name: string;
  via: EncounterVia;
  kind: EncounterKind;
  /** Whose post or shop: the reader's own, or another reader's. */
  owner?: "me" | "other";
  /** A 見本's post or shop (an id the database does not have). */
  sample?: boolean;
  /** A post without a book. */
  noBook?: boolean;
  /** A reply whose book differs from its parent's. */
  reply?: boolean;
  /** The POP's place, in characters (code points); 12 if not given. */
  placementKeyLength?: number;
  /** A memo written on it afterwards, in characters (code points). */
  memoLength?: number;
  accept: boolean;
}

/**
 * Ops on one book's row one after another (applySet), each from the row the
 * step before left, and the row after each.
 */
export interface SequenceCase {
  name: string;
  /** The row before the first step; null: none. */
  entry: EntryPart | null;
  steps: {
    /** What the reader did, in words; the shop and posts change outside the row. */
    does: string;
    context?: Partial<EntryContext>;
    set: LibrarySet;
    via: EntrySource;
    at: string;
    /** "same": the row itself comes back; null: no row. */
    expect: EntryPart | null | "same";
  }[];
}

/** One op on one book's row (applySet), and the row after. */
export interface ApplyCase {
  name: string;
  /** The row before; null: none. */
  entry: EntryPart | null;
  context?: Partial<EntryContext>;
  set: LibrarySet;
  via: EntrySource;
  rules?: { wantedClearsOnStatus: boolean };
  at: string;
  /** "same": the row itself comes back; null: no row. */
  expect: EntryPart | null | "same";
}

export interface LibraryCases {
  follow: FollowCase[];
  save: SaveCase[];
  backfill: BackfillCase[];
  encounter: EncounterCase[];
  apply: ApplyCase[];
  sequence: SequenceCase[];
}

export const LIBRARY_CASES: LibraryCases = JSON.parse(
  readFileSync(join(__dirname, "library-cases.json"), "utf8"),
);

export const ENTRY_DEFAULTS: Omit<LibraryEntry, "bookId"> = {
  status: null,
  statusAt: null,
  wantedAt: null,
  likedAt: null,
  owned: null,
  source: "scan",
  batchId: null,
  addedAt: "2026-01-01T00:00:00.000Z",
  removedAt: null,
  likeRestored: false,
  everUsed: false,
};

export const CONTEXT_DEFAULTS: EntryContext = {
  favorite: false,
  liveThemeCount: 0,
  inShop: false,
  likesInLibrary: true,
  registered: false,
  usedElsewhere: false,
  liked: false,
  wantMet: false,
  memo: false,
};

/** A whole row from a case's part; "@now" becomes `now` (the database's time). */
export function entryOf(
  bookId: string,
  part: EntryPart,
  now?: string,
): LibraryEntry {
  const entry: LibraryEntry = { ...ENTRY_DEFAULTS, ...part, bookId };
  for (const field of ["removedAt", "statusAt"] as const)
    if (entry[field] === "@now") {
      if (now === undefined) throw new Error(`${field} needs a time`);
      entry[field] = now;
    }
  return entry;
}

export const contextOf = (part: Partial<EntryContext> = {}): EntryContext => ({
  ...CONTEXT_DEFAULTS,
  ...part,
});
