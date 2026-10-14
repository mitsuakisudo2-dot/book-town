import { isDatabaseId } from "./paths";
import { posterBookIds, type Poster } from "./posters";
import type { ShopLayout } from "./shop-layout";
import {
  ME_ID,
  type Book,
  type PopReaction,
  type Post,
  type Reader,
  type ReadingRecord,
  type ReadingSession,
  type Shop,
} from "./types";
import { workOf } from "./works";

// The reader's library (ライブラリ): every edition they have met in the town,
// by scanning or typing it in, wanting it, liking it, keeping it as a
// favorite, placing it in their shop, or using it in a post, a poster or
// their 人生の9冊. A row says how they read it, whether they want it, own it
// or like it, and how it first came in. Sorting a book never takes it out:
// only the reader does, or taking back what alone brought it in (a like
// pressed by mistake, a 読みたい, a ☆).
// Encounters (この本との出会い) are each like, 私も好き！ and 読みたい the
// reader pressed on a post, a POP or a book's page, with their own memo of
// why. A memo keeps its book in the library.
// The default shelves are worked out from the rows and are provisional, so
// they live here only (DEFAULT_SHELVES); the shelves the reader names hold
// books from the library. All of it is the reader's alone.
//
// These are the rules as pure functions over plain data (review doc 5-2), so
// the store, the demo's storage and the database's trigger (followMarks is
// its twin) are checked against the same cases, tests/fixtures/
// library-cases.json. Nothing in the app calls them yet.

// ---------------------------------------------------------------- rows

export const READING_STATUSES = ["tsundoku", "reading", "finished"] as const;
/** 積読・読書中・読了; null is 未設定. */
export type ReadingStatus = (typeof READING_STATUSES)[number];
/** 持っている・持ってない; null is 未設定, and only the reader ever sets it. */
export type Owned = "yes" | "no";

/** How a book first came in: the same list as library_entries.source's check. */
export const ENTRY_SOURCES = [
  "scan",
  "isbn",
  "manual",
  "search",
  "want",
  "reading",
  "record",
  "shop",
  "legacy",
  "like",
  "pop",
  "favorite",
  "post",
  "poster",
  "nine",
] as const;
/**
 * scan, isbn, manual: registered by the scanner, an ISBN or by hand.
 * search: from a search, or put on a theme shelf from one. want: 読みたい on
 * a book's page or a post. reading, record: a reading started, a book
 * recorded as finished. shop: placed in the reader's own shop (N19). legacy:
 * what the reader had before the library, or what an app without it wrote.
 * like: a post's いいね. pop: a POP's いいね, 私も好き！ or 読みたくなった.
 * favorite: ☆. post, poster, nine: used in the reader's own post, poster or
 * 人生の9冊 (N20).
 */
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** One edition in the reader's library (library_entries). */
export interface LibraryEntry {
  /** books.id: the edition. Works are gathered only when counting (workOf). */
  bookId: string;
  status: ReadingStatus | null;
  /** When the status was set: a time of sorting, not the day it was read. */
  statusAt: string | null;
  /** null: not wanted. The 読みたい本 shelf goes by it. */
  wantedAt: string | null;
  /**
   * Set while a like or 私も好き！ of the book stands (a live encounter of
   * kind like or love), from the first of them; the いいねした本 shelf is
   * ordered by it.
   */
  likedAt: string | null;
  owned: Owned | null;
  /** How it first came in; never changed afterwards. */
  source: EntrySource;
  /** The scanning session that first brought it in (今回追加). */
  batchId: string | null;
  /** The device's time; books chosen together are a millisecond apart, in the order chosen. */
  addedAt: string;
  /** Taken out of the library: kept, with its status and shelves, so it can come back. */
  removedAt: string | null;
  /**
   * Brought back by a like and given nothing since, so taking the like back
   * takes it out again (4-10's way of writing likes, settled 2026-10-14).
   * Taking 読みたい, ☆, a theme shelf, a status or 所有 back gives it
   * nothing (putsOn), nor does an old app's wish, ☆ or library mark taken
   * off (followMarks).
   */
  likeRestored: boolean;
  /**
   * Placed in the reader's own shop, or used in their own post, poster or
   * 人生の9冊, at least once, taken out or not; never cleared (the database
   * keeps it if an update says otherwise). Taking back a like, a 読みたい or
   * a ☆ then leaves the book in, though the shop or the post holds it no
   * more (N19, N20), unless the reader took it out and only a like brought
   * it back since (likeRestored): that counts nothing from before the like,
   * a use made while the book was out among it (whether, not when).
   */
  everUsed: boolean;
}

/** A shelf the reader named (テーマ棚, library_shelves). */
export interface LibraryShelf {
  /** Made by the device, so sending it again writes the same row. */
  id: string;
  name: string;
  note: string;
  /** A fractional key, compared code unit by code unit as the database does (collate "C"). */
  position: string;
  /** Whether the reader's own view of it shows the books only wanted. */
  showWanted: boolean;
  createdAt: string;
  /** Put away: kept, with its books, so it can come back. */
  deletedAt: string | null;
}

/** A book on a theme shelf (library_shelf_books). */
export interface ShelfBook {
  shelfId: string;
  bookId: string;
  addedAt: string;
  /** Only for a book moved by hand; the others go by addedAt. */
  position: string | null;
}

// ---------------------------------------------------------------- encounters

export const ENCOUNTER_KINDS = ["like", "love", "want"] as const;
/** いいね, 私も好き！ (a POP's love) and 読みたい. */
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];
export const ENCOUNTER_VIAS = ["post", "pop", "book"] as const;
/** Pressed on a post, on a POP, or on the book's own page (読みたい only). */
export type EncounterVia = (typeof ENCOUNTER_VIAS)[number];
/** The same limits as book_encounters. */
export const ENCOUNTER_MEMO_MAX_LENGTH = 255;
export const PLACEMENT_KEY_MAX_LENGTH = 300;

/**
 * One time the reader met a book (book_encounters). The reader's alone: the
 * post's writer and the shop's owner see the reaction itself, as before,
 * never this. Nothing of the post or the POP is copied; who wrote it is read
 * from them each time.
 */
export interface Encounter {
  /** Made by the device, so sending it again writes the same row. */
  id: string;
  bookId: string;
  kind: EncounterKind;
  via: EncounterVia;
  /** The post; null once its writer deletes it, and the memo stays. */
  postId: string | null;
  /** The POP's shop; null once the shop is gone. */
  shopId: string | null;
  /**
   * Where the POP stood, to find it again. Never what makes two the same: a
   * shop's page and the walk name one POP two ways.
   */
  placementKey: string | null;
  /**
   * Whose post or shop it was. The database fills it from the post or shop
   * and never takes the device's; it is null once that reader's account is
   * gone. The device keeps its own copy only to show a name until a reload.
   */
  otherReaderId: string | null;
  memo: string | null;
  memoAt: string | null;
  /** Taken back, and kept for its memo: one taken back without a memo is deleted. */
  undoneAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- context

/**
 * What else the reader has done with a book, read from the rest of their
 * records: the rules need it, the entry does not hold it. It describes the
 * state an op starts from, except that a reaction's encounter is met or
 * taken back first (applyReaction), so `liked` and `wantMet` on taking a
 * reaction back say what else of the book still stands.
 */
export interface EntryContext {
  /** ☆: in favorites (book_marks' favorite). */
  favorite: boolean;
  /** The reader's theme shelves, not put away, that hold it. */
  liveThemeCount: number;
  /** Placed in the reader's own shop (shopBookIds). */
  inShop: boolean;
  /** reader_settings.likes_in_library. */
  likesInLibrary: boolean;
  /** Registered on purpose: in state.library (book_marks' library). */
  registered: boolean;
  /** In the reader's own reading record, post, poster or 人生の9冊 (N20). */
  usedElsewhere: boolean;
  /** A like or 私も好き！ of it stands: an encounter of kind like or love not taken back. */
  liked: boolean;
  /** A 読みたい of it stands: 読みたくなった on a post or a POP, or 読みたい on its page, not taken back. */
  wantMet: boolean;
  /** An encounter of it holds a memo, taken back or not. */
  memo: boolean;
}

/**
 * A default shelf. The owner's list (2026-10-14) is provisional in their own
 * words, so only this list changes when a shelf is added, dropped, renamed or
 * moved. The database holds no list of shelves: library_hidden keeps keys,
 * and keys nobody knows are passed over.
 */
export interface DefaultShelf {
  key: string;
  label: string;
  has: (e: LibraryEntry, x: EntryContext) => boolean;
  order: "added" | "status" | "wanted" | "liked" | "favorite";
}

const isStatus =
  (status: ReadingStatus) => (e: LibraryEntry, x: EntryContext) =>
    inLibrary(e, x) && e.status === status;

export const DEFAULT_SHELVES: readonly DefaultShelf[] = [
  { key: "all", label: "ライブラリ", has: inLibrary, order: "added" },
  {
    key: "finished",
    label: "読了",
    has: isStatus("finished"),
    order: "status",
  },
  {
    key: "tsundoku",
    label: "積読",
    has: isStatus("tsundoku"),
    order: "status",
  },
  {
    key: "reading",
    label: "読書中",
    has: isStatus("reading"),
    order: "status",
  },
  {
    key: "want",
    label: "読みたい本",
    has: (e, x) => inLibrary(e, x) && e.wantedAt !== null,
    order: "wanted",
  },
  {
    // The books with a like or 私も好き！ standing, whether or not the
    // reader lets likes into the library (likes_in_library).
    key: "liked",
    label: "いいねした本",
    has: (e, x) => e.removedAt === null && x.liked,
    order: "liked",
  },
  {
    key: "favorite",
    label: "お気に入り",
    has: (e, x) => e.removedAt === null && x.favorite,
    order: "favorite",
  },
];

// ---------------------------------------------------------------- ops

/**
 * A change to some books. Absent fields change nothing. `batchId` acts only
 * on a row the op makes.
 */
export type LibrarySet = Partial<{
  status: ReadingStatus | null;
  want: boolean;
  owned: Owned | null;
  /** A like or 私も好き！, and taking it back (4-10). */
  liked: boolean;
  /** ☆ on and off: the mark lives in favorites; the row is made, brought back, or taken out. */
  favorite: boolean;
  /** false: registered on purpose (scan, ISBN, by hand, ［＋登録］). */
  removed: boolean;
  addShelf: string;
  removeShelf: string;
  /** The scanning session a new row came in by. */
  batchId: string;
  /**
   * Used in the reader's shop, post, poster or nine: a row is made if there
   * is none, and the row is marked as used (everUsed), even one taken out,
   * which stays out; nothing else (N19, N20).
   */
  meet: true;
}>;

/**
 * The unit of undo and of the device's journal. `opId` is a uuid made by the
 * device; `before` holds each book as the op found it (opBefore), so undoing
 * writes it back as it was (10-6), but for everUsed (OpBefore.entry).
 */
export interface LibraryOp {
  opId: string;
  at: string;
  label: string;
  books: string[];
  set: LibrarySet;
  before: Record<string, OpBefore>;
  state: "pending" | "refused";
}

/** One book as an op found it: everything of it the op can change. */
export interface OpBefore {
  /**
   * The row whole; null: there was none. Undoing keeps everUsed as it then
   * is: a use the reader made since is not taken back with the op.
   */
  entry: LibraryEntry | null;
  /**
   * Its places on theme shelves, whole: one taken off goes back with the
   * added_at and position it had, so the shelf keeps its order (5-6, 10-6).
   */
  shelves: ShelfBook[];
  /**
   * ☆. It comes back as a new mark, last among ☆, as the database orders
   * book_marks by when they were written.
   */
  favorite: boolean;
  /**
   * Registered on purpose (state.library, book_marks' library). 外す takes
   * it away, so undoing gives it back; without it, a like taken back later
   * would take the book out.
   */
  registered: boolean;
}

/** What an op on these books finds (LibraryOp.before), once each. */
export function opBefore(
  state: LibraryState,
  books: string[],
): Record<string, OpBefore> {
  const before: Record<string, OpBefore> = {};
  for (const bookId of books)
    before[bookId] ??= {
      entry: state.libraryEntries[bookId] ?? null,
      shelves: state.libraryShelfBooks.filter((book) => book.bookId === bookId),
      favorite: state.favorites.includes(bookId),
      registered: state.library.includes(bookId),
    };
  return before;
}

/** Where a book stands in the reader's own shop draft (P1, L7a): a shape only for now. */
export type DisplaysOf = (
  layout: ShopLayout | null,
  bookId: string,
) => { shelfId: string; placementId: string }[];

/** The reader's settings for the library: reader_settings' columns. */
export interface LibrarySettings {
  /** Default shelves left out of the library's shelf row, by key. */
  libraryHidden: string[];
  /** Whether books only liked show in the library (いいねした本 shows them anyway). */
  likesInLibrary: boolean;
  /** 「読み始めたら『読みたい』から外す」: off unless chosen. */
  wantedClearsOnStatus: boolean;
  /** 「メモの案内を出す」: the small toast offering a memo after a like or 読みたい. */
  memoHint: boolean;
}
/** The database's defaults for the same columns. */
export const LIBRARY_SETTINGS: LibrarySettings = {
  libraryHidden: [],
  likesInLibrary: true,
  wantedClearsOnStatus: false,
  memoHint: true,
};

/** What of the town the library reads and changes; the town keeps the rest. */
export interface LibraryState {
  books: Book[];
  me: Pick<Reader, "lifeNine">;
  /** ☆, oldest first. */
  favorites: string[];
  /** Registered on purpose (book_marks' library), oldest first. */
  library: string[];
  readingRecords: ReadingRecord[];
  posts: Post[];
  posters: Poster[];
  libraryEntries: Record<string, LibraryEntry>;
  libraryShelves: LibraryShelf[];
  libraryShelfBooks: ShelfBook[];
  encounters: Encounter[];
  settings: LibrarySettings;
}

// ---------------------------------------------------------------- the row's rules

const LIKE_SOURCES: readonly EntrySource[] = ["like", "pop"];
/** Registering reads a book; it never says the reader owns it (問い2). */
const READ_VIAS: readonly EntrySource[] = ["scan", "isbn", "manual"];

const blankEntry = (
  bookId: string,
  source: EntrySource,
  addedAt: string,
  batchId: string | null = null,
): LibraryEntry => ({
  bookId,
  status: null,
  statusAt: null,
  wantedAt: null,
  likedAt: null,
  owned: null,
  source,
  batchId,
  addedAt,
  removedAt: null,
  likeRestored: false,
  everUsed: false,
});

const ENTRY_FIELDS = [
  "status",
  "statusAt",
  "wantedAt",
  "likedAt",
  "owned",
  "source",
  "batchId",
  "addedAt",
  "removedAt",
  "likeRestored",
  "everUsed",
] as const;
const sameEntry = (a: LibraryEntry, b: LibraryEntry) =>
  ENTRY_FIELDS.every((field) => a[field] === b[field]);

/**
 * The reader comes to the book again: a row is made, and one taken out comes
 * back (4-2's 戻す規則, settled 2026-10-14).
 */
const meetsAgain = (s: LibrarySet) =>
  s.removed === false ||
  s.want === true ||
  s.favorite === true ||
  s.liked === true ||
  s.addShelf !== undefined;

/** A like or its taking back, and nothing else. */
const likeOnlyOp = (s: LibrarySet) =>
  Object.keys(s).every((key) => key === "liked");

/**
 * Puts something on the row: a status, 読みたい, 所有, ☆, registering, a
 * theme shelf or a use. Taking one back (読みたい or ☆ off, off a theme
 * shelf, a status or 所有 back to 未設定) puts nothing on, nor does a like.
 */
const putsOn = (s: LibrarySet) =>
  (s.status ?? null) !== null ||
  s.want === true ||
  (s.owned ?? null) !== null ||
  s.favorite === true ||
  s.removed === false ||
  s.addShelf !== undefined ||
  s.meet === true;

/**
 * 4-10's conditions 1 and 3 to 5, and the rest of condition 2 (no other
 * encounter stands, the memo review's 2章): nothing but a like keeps the row.
 * A row a like brought back counts nothing it held before the like: what it
 * kept when it was taken out, nor a status, 所有 or use it was given while
 * out, which never brought it back. The shop and the reader's own uses keep
 * it while they stand, and once the shop, a post, a poster or the nine has
 * held it (everUsed), after that too: a book liked and then put in the shop
 * stays when it is taken off and the like taken back, as one put in the
 * shop first does (N19's お店から下ろしても残る, and N20, settled
 * 2026-10-14).
 */
function heldByLikeAlone(e: LibraryEntry, x: EntryContext): boolean {
  return (
    (LIKE_SOURCES.includes(e.source) || e.likeRestored) &&
    (e.likeRestored ||
      (e.status === null &&
        e.wantedAt === null &&
        e.owned === null &&
        !e.everUsed &&
        !x.favorite &&
        x.liveThemeCount === 0 &&
        !x.wantMet)) &&
    !x.inShop &&
    !x.registered &&
    !x.usedElsewhere &&
    !x.memo
  );
}

/** In the library only by a like that stands: hidden while likes_in_library is off (4-10). */
export const likeOnly = (e: LibraryEntry, x: EntryContext): boolean =>
  x.liked && heldByLikeAlone(e, x);

/** Shown in ライブラリ（全部）. */
export function inLibrary(e: LibraryEntry, x: EntryContext): boolean {
  return e.removedAt === null && !(!x.likesInLibrary && likeOnly(e, x));
}

/**
 * 「まだ振り分けていない」(4-1's L; the name is a proposal): in the
 * library, and sorted nowhere: no status, not wanted, no ☆, on no theme
 * shelf, not in the shop. Likes and owning are no sorting.
 */
export const isUnsorted = (e: LibraryEntry, x: EntryContext): boolean =>
  inLibrary(e, x) &&
  e.status === null &&
  e.wantedAt === null &&
  !x.favorite &&
  x.liveThemeCount === 0 &&
  !x.inShop;

/** A status button: pressing the one lit puts it back to 未設定. */
export const pressStatus = (
  current: ReadingStatus | null,
  pressed: ReadingStatus,
): ReadingStatus | null => (pressed === current ? null : pressed);

/**
 * What an op does to one book's row (4-2, 4-10), or null when there is no
 * row and the op makes none. The row itself comes back when nothing changes.
 * A status never touches 読みたい unless the reader chose so (問い3), and
 * registering never touches 所有 (問い2). A row leaves the library only when
 * the reader takes it out, or when taking back a like, a 読みたい or a ☆
 * leaves nothing that keeps it; sorting never takes a book out.
 */
export function applySet(
  bookId: string,
  e: LibraryEntry | null,
  s: LibrarySet,
  at: string,
  via: EntrySource,
  rules: { wantedClearsOnStatus: boolean },
  x: EntryContext,
): LibraryEntry | null {
  const meets = meetsAgain(s);
  // A status or 所有 set on a book not in the library brings it in too
  // (startReading, recordReading, the book page's 所有); neither brings back
  // a row taken out.
  const makes =
    meets ||
    s.meet === true ||
    (s.status ?? null) !== null ||
    (s.owned ?? null) !== null;
  if (!e && !makes) return null;
  const next: LibraryEntry = e
    ? { ...e }
    : blankEntry(bookId, via, at, s.batchId ?? null);

  if (next.removedAt !== null && meets) {
    // Status, 読みたい and shelves were kept with the row, so they come back.
    next.removedAt = null;
    next.likeRestored = likeOnlyOp(s);
  } else if (putsOn(s)) {
    // The reader gave a row a like brought back something of their own.
    // Taking something back leaves it as the like brought it back, as an
    // old app's wish or favorite mark taken off does (followMarks), so the
    // order the reader takes a like, a 読みたい and a ☆ back in does not
    // matter.
    next.likeRestored = false;
  }

  if (s.status !== undefined && s.status !== next.status) {
    next.status = s.status;
    next.statusAt = s.status === null ? null : at;
    if (
      rules.wantedClearsOnStatus &&
      (s.status === "reading" || s.status === "finished")
    )
      next.wantedAt = null;
  }
  if (s.want === true) next.wantedAt = next.wantedAt ?? at;
  if (s.want === false) next.wantedAt = null;
  if (s.owned !== undefined && !(e && READ_VIAS.includes(via)))
    next.owned = s.owned;
  // A use marks a row taken out too, without bringing it back (N19).
  if (s.meet === true) next.everUsed = true;
  if (s.liked === true) next.likedAt = next.likedAt ?? at;
  if (s.liked === false && !x.liked) next.likedAt = null;

  if (next.removedAt === null) {
    // A like taken back: the row goes when nothing but the like kept it.
    const likeGone =
      s.liked === false && e?.likedAt != null && next.likedAt === null;
    // A 読みたい or ☆ taken back (4-2's last row, settled 2026-10-14): the
    // row goes when nothing at all is left, however it came in. A use once
    // made is left (everUsed), as for a like, so the order the reader takes a
    // like and a 読みたい back in does not matter (N19).
    const favorite = s.favorite === false ? false : x.favorite;
    const markGone =
      (s.want === false && e?.wantedAt != null) ||
      (s.favorite === false && x.favorite);
    if (
      (likeGone && !x.liked && heldByLikeAlone(next, x)) ||
      (markGone &&
        next.status === null &&
        next.wantedAt === null &&
        next.likedAt === null &&
        next.owned === null &&
        !next.everUsed &&
        !x.liked &&
        !x.wantMet &&
        !favorite &&
        x.liveThemeCount === 0 &&
        !x.inShop &&
        !x.registered &&
        !x.usedElsewhere &&
        !x.memo)
    ) {
      next.removedAt = at;
      next.likeRestored = false;
    }
  }
  if (s.removed === true && next.removedAt === null) {
    next.removedAt = at;
    next.likeRestored = false;
  }
  return e && sameEntry(e, next) ? e : next;
}

// ---------------------------------------------------------------- context from the town

/** Encounters of kind like or love not taken back. */
const standingLike = (c: Encounter) =>
  c.undoneAt === null && (c.kind === "like" || c.kind === "love");

/** Every book's context at once, for a library of a thousand books. */
export function contextsOf(
  state: LibraryState,
  shopBooks: ReadonlySet<string>,
): (bookId: string) => EntryContext {
  const favorites = new Set(state.favorites);
  const registered = new Set(state.library);
  const live = new Set(
    state.libraryShelves
      .filter((shelf) => shelf.deletedAt === null)
      .map((shelf) => shelf.id),
  );
  const themes = new Map<string, number>();
  for (const book of state.libraryShelfBooks)
    if (live.has(book.shelfId))
      themes.set(book.bookId, (themes.get(book.bookId) ?? 0) + 1);
  const used = new Set<string | null>([
    ...state.readingRecords
      .filter((record) => record.readerId === ME_ID)
      .map((record) => record.bookId),
    ...state.posts
      .filter((post) => post.authorId === ME_ID)
      .map((post) => post.bookId),
    ...state.posters
      .filter((poster) => poster.authorId === ME_ID)
      .flatMap(posterBookIds),
    ...state.me.lifeNine,
  ]);
  const liked = new Set(
    state.encounters.filter(standingLike).map((c) => c.bookId),
  );
  const wantMet = new Set(
    state.encounters
      .filter((c) => c.undoneAt === null && c.kind === "want")
      .map((c) => c.bookId),
  );
  const memo = new Set(
    state.encounters.filter((c) => c.memo !== null).map((c) => c.bookId),
  );
  const likesInLibrary = state.settings.likesInLibrary;
  return (bookId) => ({
    favorite: favorites.has(bookId),
    liveThemeCount: themes.get(bookId) ?? 0,
    inShop: shopBooks.has(bookId),
    likesInLibrary,
    registered: registered.has(bookId),
    usedElsewhere: used.has(bookId),
    liked: liked.has(bookId),
    wantMet: wantMet.has(bookId),
    memo: memo.has(bookId),
  });
}

export const entryContext = (
  state: LibraryState,
  bookId: string,
  shopBooks: ReadonlySet<string>,
): EntryContext => contextsOf(state, shopBooks)(bookId);

/**
 * The books in the reader's own shop (4-1's お店の棚 and N19, settled
 * 2026-10-14): every shelf of the shop's page, private ones too, and its
 * store scene (the account's sceneBookIds; the demo keeps its scene in the
 * walk's storage). After the shop's drafts arrive (wave-1 PR5), the draft's
 * books too.
 */
export function shopBookIds(
  shop: Shop | null,
  more: { demoSceneBookIds?: string[]; draftBooks?: string[] } = {},
): Set<string> {
  return new Set([
    ...(shop?.shelves ?? []).flatMap((shelf) =>
      shelf.items.map((item) => item.bookId),
    ),
    ...(shop?.sceneBookIds ?? []),
    ...(more.demoSceneBookIds ?? []),
    ...(more.draftBooks ?? []),
  ]);
}

/** The keys of the default shelves a book is on, in their order. */
export const shelvesOf = (
  e: LibraryEntry,
  x: EntryContext,
  shelves: readonly DefaultShelf[] = DEFAULT_SHELVES,
): string[] =>
  shelves.filter((shelf) => shelf.has(e, x)).map((shelf) => shelf.key);

/** The default shelves shown: all but those hidden. Unknown keys change nothing, and ライブラリ is always there. */
export const shownShelves = (
  shelves: readonly DefaultShelf[],
  hidden: readonly string[],
): DefaultShelf[] =>
  shelves.filter((shelf) => shelf.key === "all" || !hidden.includes(shelf.key));

const HIDDEN_KEY = /^[a-z_]{1,32}$/;
/** library_hidden as the database takes it: well-formed keys, once each, at most 20. */
export function libraryHiddenOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter(
    (key): key is string => typeof key === "string" && HIDDEN_KEY.test(key),
  );
  return [...new Set(keys)].slice(0, 20);
}

// ---------------------------------------------------------------- ops on the town

const without = <K extends keyof LibrarySet>(s: LibrarySet, key: K) => {
  const rest = { ...s };
  delete rest[key];
  return rest;
};

/**
 * One op on some books, in the order chosen: the i-th book's times are `at`
 * plus i milliseconds, so the library keeps that order (5-6). Only the
 * library's own lists change: its rows, ☆, the books registered on purpose
 * and the books on theme shelves. Readings, records, posts, posters and the
 * shop are never touched, so 整理モードの「読書中」 starts no reading
 * anyone could see. The state itself comes back when nothing changes.
 */
export function applyOp<S extends LibraryState>(
  state: S,
  books: string[],
  s: LibrarySet,
  at: string,
  via: EntrySource,
  shopBooks: ReadonlySet<string>,
): S {
  const contextOf = contextsOf(state, shopBooks);
  // A shelf put away (or unknown) takes no books, and makes no row for them.
  const shelfLive =
    s.addShelf === undefined ||
    state.libraryShelves.some(
      (shelf) => shelf.id === s.addShelf && shelf.deletedAt === null,
    );
  const set = shelfLive ? s : without(s, "addShelf");
  const start = Date.parse(at);
  let entries = state.libraryEntries;
  let favorites = state.favorites;
  let library = state.library;
  let shelfBooks = state.libraryShelfBooks;
  for (const [i, bookId] of [...new Set(books)].entries()) {
    const t = new Date(start + i).toISOString();
    const before = state.libraryEntries[bookId] ?? null;
    const after = applySet(
      bookId,
      before,
      set,
      t,
      via,
      state.settings,
      contextOf(bookId),
    );
    if (after && after !== before) {
      if (entries === state.libraryEntries) entries = { ...entries };
      entries[bookId] = after;
    }
    if (set.favorite === true && !favorites.includes(bookId))
      favorites = [...favorites, bookId];
    if (set.favorite === false && favorites.includes(bookId))
      favorites = favorites.filter((id) => id !== bookId);
    if (set.removed === false && !library.includes(bookId))
      library = [...library, bookId];
    if (set.removed === true && library.includes(bookId))
      library = library.filter((id) => id !== bookId);
    const on = (shelfId: string) =>
      shelfBooks.some(
        (book) => book.shelfId === shelfId && book.bookId === bookId,
      );
    if (set.addShelf !== undefined && !on(set.addShelf))
      shelfBooks = [
        ...shelfBooks,
        { shelfId: set.addShelf, bookId, addedAt: t, position: null },
      ];
    if (set.removeShelf !== undefined && on(set.removeShelf))
      shelfBooks = shelfBooks.filter(
        (book) => !(book.shelfId === set.removeShelf && book.bookId === bookId),
      );
  }
  if (
    entries === state.libraryEntries &&
    favorites === state.favorites &&
    library === state.library &&
    shelfBooks === state.libraryShelfBooks
  )
    return state;
  return {
    ...state,
    libraryEntries: entries,
    favorites,
    library,
    libraryShelfBooks: shelfBooks,
  };
}

// ---------------------------------------------------------------- encounters

/** What makes two encounters the same, as book_encounters' three unique indexes do. */
export function encounterKey(
  c: Pick<Encounter, "id" | "kind" | "via" | "postId" | "shopId" | "bookId">,
): string {
  // A post or shop gone leaves its encounters standing alone.
  if (c.via === "post")
    return JSON.stringify(
      c.postId === null ? ["row", c.id] : ["post", c.kind, c.postId],
    );
  if (c.via === "pop")
    return JSON.stringify(
      c.shopId === null ? ["row", c.id] : ["pop", c.kind, c.shopId, c.bookId],
    );
  return JSON.stringify(["book", c.kind, c.bookId]);
}

/** What the reader pressed, and where. */
export type EncounterInput =
  | {
      via: "post";
      kind: EncounterKind;
      post: Pick<Post, "id" | "authorId" | "bookId">;
    }
  | {
      via: "pop";
      kind: EncounterKind;
      shop: Pick<Shop, "id" | "ownerId">;
      bookId: string;
      placementKey: string;
    }
  | { via: "book"; kind: EncounterKind; bookId: string };

const codePoints = (text: string) => [...text].length;

/**
 * The encounter a press makes, or null when it makes none: a post without a
 * book, the reader's own post or shop, a pairing the table refuses (a post's
 * 私も好き！, a like on a book's page), or, with an account, a 見本's post or
 * shop (nobody is there, and the database has no row to point to). A reply
 * is met by its own book, never its parent's.
 */
export function encounterOf(
  input: EncounterInput,
  id: string,
  at: string,
  account: boolean,
): Encounter | null {
  const base = {
    id,
    kind: input.kind,
    via: input.via,
    postId: null,
    shopId: null,
    placementKey: null,
    otherReaderId: null,
    memo: null,
    memoAt: null,
    undoneAt: null,
    createdAt: at,
  };
  if (input.via === "post") {
    const { post } = input;
    if (
      input.kind === "love" ||
      post.bookId === null ||
      post.authorId === ME_ID ||
      (account && !isDatabaseId(post.id))
    )
      return null;
    return {
      ...base,
      bookId: post.bookId,
      postId: post.id,
      otherReaderId: post.authorId,
    };
  }
  if (input.via === "pop") {
    const { shop } = input;
    const length = codePoints(input.placementKey);
    if (
      shop.ownerId === ME_ID ||
      (account && !isDatabaseId(shop.id)) ||
      length < 1 ||
      length > PLACEMENT_KEY_MAX_LENGTH
    )
      return null;
    return {
      ...base,
      bookId: input.bookId,
      shopId: shop.id,
      placementKey: input.placementKey,
      otherReaderId: shop.ownerId,
    };
  }
  return input.kind === "want" ? { ...base, bookId: input.bookId } : null;
}

/**
 * Meets a book again: a new encounter is added; one taken back for its memo
 * comes back as it was, the same row; one standing changes nothing (a second
 * tap). `met` says whether anything changed.
 */
export function meetEncounter(
  list: Encounter[],
  c: Encounter,
): { encounters: Encounter[]; encounter: Encounter; met: boolean } {
  const key = encounterKey(c);
  const old = list.find((other) => encounterKey(other) === key);
  if (!old) return { encounters: [...list, c], encounter: c, met: true };
  if (old.undoneAt === null)
    return { encounters: list, encounter: old, met: false };
  const back = { ...old, undoneAt: null };
  return {
    encounters: list.map((other) => (other === old ? back : other)),
    encounter: back,
    met: true,
  };
}

/** Takes an encounter back: one with a memo is kept, marked; one without is deleted (decision 1). */
export function undoEncounter(
  list: Encounter[],
  c: Pick<Encounter, "id" | "kind" | "via" | "postId" | "shopId" | "bookId">,
  at: string,
): Encounter[] {
  const key = encounterKey(c);
  const old = list.find(
    (other) => other.undoneAt === null && encounterKey(other) === key,
  );
  if (!old) return list;
  return old.memo !== null
    ? list.map((other) => (other === old ? { ...old, undoneAt: at } : other))
    : list.filter((other) => other !== old);
}

/**
 * Writes, changes or (with null or blank words) erases an encounter's memo.
 * Erasing the memo of one taken back deletes it: it was kept for the memo
 * alone. Words over ENCOUNTER_MEMO_MAX_LENGTH change nothing, as the
 * database would refuse them.
 */
export function writeMemo(
  list: Encounter[],
  id: string,
  memo: string | null,
  at: string,
): Encounter[] {
  const old = list.find((c) => c.id === id);
  const text = memo?.trim() || null;
  if (
    !old ||
    text === old.memo ||
    (text !== null && codePoints(text) > ENCOUNTER_MEMO_MAX_LENGTH)
  )
    return list;
  if (text === null && old.undoneAt !== null)
    return list.filter((c) => c !== old);
  const next = { ...old, memo: text, memoAt: text === null ? null : at };
  return list.map((c) => (c === old ? next : c));
}

/** A POP's reaction as an encounter: 読みたくなった is 読みたい. */
export const popEncounterKind = (reaction: PopReaction): EncounterKind =>
  reaction === "read" ? "want" : reaction;

/** How a reaction brings a book in (4-3): a post's like and 読みたい, any POP, a book's page. */
export const encounterSource = (
  kind: EncounterKind,
  via: EncounterVia,
): EntrySource =>
  via === "pop" ? "pop" : via === "post" && kind !== "want" ? "like" : "want";

/**
 * What a reaction pressed or taken back does to the row (4-10). A like and
 * 私も好き！ are the いいね; 読みたくなった on a post or a POP adds 読みたい
 * and taking it back leaves it, while the book page's 読みたい goes both
 * ways. Null: the row is left as it is.
 */
export function reactionSet(
  kind: EncounterKind,
  via: EncounterVia,
  on: boolean,
): LibrarySet | null {
  if (kind !== "want") return { liked: on };
  if (via === "book") return { want: on };
  return on ? { want: true } : null;
}

/**
 * A reaction pressed (on) or taken back: its encounter first, then the row,
 * whose context then knows whether another like still stands and whether a
 * memo keeps the book. A press that makes no encounter changes nothing, and
 * neither does a second press of a reaction that stands (4-10's 連打), even
 * on a row taken out since: only the book page's 読みたい, which goes by the
 * row, sets 読みたい again. The state itself comes back when nothing changes.
 */
export function applyReaction<S extends LibraryState>(
  state: S,
  input: EncounterInput,
  on: boolean,
  at: string,
  shopBooks: ReadonlySet<string>,
  options: { id: string; account: boolean },
): S {
  const c = encounterOf(input, options.id, at, options.account);
  if (!c) return state;
  const met = on ? meetEncounter(state.encounters, c) : null;
  if (met && !met.met && c.via !== "book") return state;
  const encounters = met
    ? met.encounters
    : undoEncounter(state.encounters, c, at);
  // Taking back what does not stand does nothing, except the book page's
  // 読みたい: it takes 読みたい away whichever press brought it.
  if (!on && encounters === state.encounters && c.via !== "book") return state;
  const next =
    encounters === state.encounters ? state : { ...state, encounters };
  const set = reactionSet(c.kind, c.via, on);
  return set
    ? applyOp(
        next,
        [c.bookId],
        set,
        at,
        encounterSource(c.kind, c.via),
        shopBooks,
      )
    : next;
}

// ---------------------------------------------------------------- filters

/**
 * The library's filter (4-5): every field given narrows it further (and);
 * a field left out, or a list left empty, does not, as the address has no
 * empty list. It goes to and from the address (filterParams).
 */
export interface LibraryFilter {
  /** A default shelf's key or a theme shelf's id; absent is ライブラリ（全部）. */
  shelf?: string;
  /** On every one of these theme shelves. */
  with?: string[];
  /** Any of these statuses; none is 未設定. */
  status?: (ReadingStatus | "none")[];
  /** Read (finished, or the reader's own record of it), or not. */
  read?: boolean;
  /** 「まだ振り分けていない」, or sorted somewhere. */
  unsorted?: boolean;
  /** Came in by any of these. */
  met?: EntrySource[];
  /** Months as YYYY-MM, Japan time, both ends included, of the date dateOf names. */
  since?: string;
  until?: string;
  /** Which date since and until look at: added (the default), status or liked. */
  dateOf?: "added" | "status" | "liked";
  owned?: Owned | "unset";
  author?: string;
  batchId?: string;
  /** false: books only wanted (wanted, no status) are hidden, as a theme shelf's view may choose. */
  showWanted: boolean;
}

/** The month (Japan time) a moment falls in, as YYYY-MM. */
const monthOf = (at: string) =>
  new Date(Date.parse(at) + 9 * 3_600_000).toISOString().slice(0, 7);
const timeOf = (at: string | null) =>
  at === null ? Number.NEGATIVE_INFINITY : Date.parse(at);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Newer first; no time last. */
const newer = (a: string | null, b: string | null) => {
  const x = timeOf(a);
  const y = timeOf(b);
  return x === y ? 0 : x > y ? -1 : 1;
};
const older = (a: string | null, b: string | null) => -newer(a, b);
/** Code unit by code unit, as collate "C"; no key last. */
const byPosition = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
const wantedOnly = (e: LibraryEntry) =>
  e.wantedAt !== null && e.status === null;

/** The live theme shelves and their books by shelf. */
function themeShelves(state: LibraryState) {
  const live = new Map(
    state.libraryShelves
      .filter((shelf) => shelf.deletedAt === null)
      .map((shelf) => [shelf.id, shelf]),
  );
  const books = new Map<string, Map<string, ShelfBook>>();
  for (const book of state.libraryShelfBooks)
    if (live.has(book.shelfId)) {
      const on = books.get(book.shelfId) ?? new Map<string, ShelfBook>();
      on.set(book.bookId, book);
      books.set(book.shelfId, on);
    }
  return { live, books };
}

/**
 * The books a filter shows, in the order of its shelf: ライブラリ by when
 * they came in, newest first; status, 読みたい and いいね by those times,
 * newest first; ☆ in the order kept; a theme shelf by its keys, then the
 * books never moved by hand in the order they were put on. Only books the
 * town knows are listed.
 */
export function filterLibrary(
  state: LibraryState,
  f: LibraryFilter,
  shopBooks: ReadonlySet<string>,
  shelves: readonly DefaultShelf[] = DEFAULT_SHELVES,
): string[] {
  const books = new Map(state.books.map((book) => [book.id, book]));
  const contextOf = contextsOf(state, shopBooks);
  const themes = themeShelves(state);
  const preset =
    f.shelf === undefined
      ? undefined
      : shelves.find((shelf) => shelf.key === f.shelf);
  const theme =
    f.shelf === undefined || preset ? undefined : themes.books.get(f.shelf);
  if (f.shelf !== undefined && !preset && !themes.live.has(f.shelf)) return [];
  const has =
    preset?.has ??
    ((e: LibraryEntry, x: EntryContext) =>
      inLibrary(e, x) && (f.shelf === undefined || !!theme?.has(e.bookId)));
  const read = new Set(
    state.readingRecords
      .filter((record) => record.readerId === ME_ID)
      .map((record) => record.bookId),
  );
  const dateOf = (e: LibraryEntry) =>
    f.dateOf === "status"
      ? e.statusAt
      : f.dateOf === "liked"
        ? e.likedAt
        : e.addedAt;

  const rows = Object.values(state.libraryEntries).filter((e) => {
    const book = books.get(e.bookId);
    if (!book) return false;
    const x = contextOf(e.bookId);
    if (!has(e, x)) return false;
    if (f.with && !f.with.every((id) => themes.books.get(id)?.has(e.bookId)))
      return false;
    if (f.status?.length && !f.status.includes(e.status ?? "none"))
      return false;
    if (
      f.read !== undefined &&
      f.read !== (e.status === "finished" || read.has(e.bookId))
    )
      return false;
    if (f.unsorted !== undefined && f.unsorted !== isUnsorted(e, x))
      return false;
    if (f.met?.length && !f.met.includes(e.source)) return false;
    if (f.since !== undefined || f.until !== undefined) {
      const date = dateOf(e);
      if (date === null) return false;
      const month = monthOf(date);
      if (f.since !== undefined && month < f.since) return false;
      if (f.until !== undefined && month > f.until) return false;
    }
    if (f.owned && (e.owned ?? "unset") !== f.owned) return false;
    if (f.author !== undefined && book.author.trim() !== f.author.trim())
      return false;
    if (f.batchId !== undefined && e.batchId !== f.batchId) return false;
    if (!f.showWanted && wantedOnly(e)) return false;
    return true;
  });

  const favorites = new Map(state.favorites.map((id, i) => [id, i]));
  const order = preset
    ? preset.order
    : f.shelf === undefined
      ? "added"
      : "position";
  const compare = (a: LibraryEntry, b: LibraryEntry): number => {
    switch (order) {
      case "status":
        return newer(a.statusAt, b.statusAt);
      case "wanted":
        return newer(a.wantedAt, b.wantedAt);
      case "liked":
        return newer(a.likedAt, b.likedAt);
      case "favorite":
        return (
          (favorites.get(a.bookId) ?? Infinity) -
            (favorites.get(b.bookId) ?? Infinity) || 0
        );
      case "position": {
        const p = theme?.get(a.bookId);
        const q = theme?.get(b.bookId);
        return (
          byPosition(p?.position ?? null, q?.position ?? null) ||
          older(p?.addedAt ?? null, q?.addedAt ?? null)
        );
      }
      default:
        return newer(a.addedAt, b.addedAt);
    }
  };
  return rows
    .sort((a, b) => compare(a, b) || byId(a.bookId, b.bookId))
    .map((e) => e.bookId);
}

const ADDRESS_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const AUTHOR_MAX_LENGTH = 200;

/** A filter for the address (replaceAddress in url-state.ts): every key, null when not set. */
export function filterParams(f: LibraryFilter): Record<string, string | null> {
  const list = (values?: readonly string[]) =>
    values?.length ? values.join(",") : null;
  const flag = (value?: boolean) =>
    value === undefined ? null : value ? "1" : "0";
  return {
    shelf: f.shelf ?? null,
    with: list(f.with),
    status: list(f.status),
    read: flag(f.read),
    unsorted: flag(f.unsorted),
    met: list(f.met),
    since: f.since ?? null,
    until: f.until ?? null,
    // When the books came in is the default, left out of the address.
    by: f.dateOf && f.dateOf !== "added" ? f.dateOf : null,
    owned: f.owned ?? null,
    author: f.author ?? null,
    batch: f.batchId ?? null,
  };
}

/**
 * A filter read back from the address, leaving out what it could not be (an
 * old link, a hand-typed one). The address of a filter read here is the
 * address it came from, less what was left out.
 */
export function filterFromParams(
  read: (key: string) => string | null,
  showWanted: boolean,
): LibraryFilter {
  const f: LibraryFilter = { showWanted };
  const list = <T extends string>(
    key: string,
    ok: (value: string) => boolean,
  ) => {
    const values = [...new Set((read(key) ?? "").split(",").filter(ok))];
    return values.length ? (values as T[]) : undefined;
  };
  const flag = (key: string) => {
    const value = read(key);
    return value === "1" ? true : value === "0" ? false : undefined;
  };
  const shelf = read("shelf");
  if (shelf && ADDRESS_ID.test(shelf)) f.shelf = shelf;
  const withShelves = list<string>("with", (id) => ADDRESS_ID.test(id));
  if (withShelves) f.with = withShelves;
  const status = list<ReadingStatus | "none">(
    "status",
    (value) =>
      value === "none" || READING_STATUSES.includes(value as ReadingStatus),
  );
  if (status) f.status = status;
  const readFlag = flag("read");
  if (readFlag !== undefined) f.read = readFlag;
  const unsorted = flag("unsorted");
  if (unsorted !== undefined) f.unsorted = unsorted;
  const met = list<EntrySource>("met", (value) =>
    ENTRY_SOURCES.includes(value as EntrySource),
  );
  if (met) f.met = met;
  const since = read("since");
  if (since && MONTH.test(since)) f.since = since;
  const until = read("until");
  if (until && MONTH.test(until)) f.until = until;
  const by = read("by");
  if (by === "status" || by === "liked") f.dateOf = by;
  const owned = read("owned");
  if (owned === "yes" || owned === "no" || owned === "unset") f.owned = owned;
  const author = read("author")?.trim();
  if (author && codePoints(author) <= AUTHOR_MAX_LENGTH) f.author = author;
  const batch = read("batch");
  if (batch && ADDRESS_ID.test(batch)) f.batchId = batch;
  return f;
}

// ---------------------------------------------------------------- counts

/** The numbers the library shows (4-7). The screen leaves out any that is 0. */
export interface LibraryCounts {
  /** Works in ライブラリ（全部）: editions of one work, and the reader's rows of one ISBN, count once. */
  works: number;
  /** Editions: rows, the reader's rows of one ISBN as one. */
  editions: number;
  owned: number;
  notOwned: number;
  /** Works 「まだ振り分けていない」. */
  unsorted: number;
  /** Works on each default shelf; a shelf with none is left out. */
  shelves: Record<string, number>;
  /**
   * Works on each theme shelf not put away, and, while its view hides the
   * books only wanted, how many of them it hides; a shelf or a number that
   * would be 0 is left out.
   */
  themes: Record<string, { works: number; hiddenWanted?: number }>;
}

/** Works among rows: rows join when their books share a work or an ISBN. */
function workCount(rows: LibraryEntry[], books: Map<string, Book>): number {
  // Union-find over keys: a key not joined yet is its own group.
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    const up = parent.get(key);
    if (up === undefined) return key;
    const top = root(up);
    parent.set(key, top);
    return top;
  };
  const works = rows.map((e) => {
    const book = books.get(e.bookId);
    const work = "work:" + (book ? workOf(book) : e.bookId);
    if (book?.isbn) {
      const [a, b] = [root(work), root("isbn:" + book.isbn)];
      if (a !== b) parent.set(a, b);
    }
    return work;
  });
  return new Set(works.map(root)).size;
}

const editionCount = (rows: LibraryEntry[], books: Map<string, Book>) =>
  new Set(
    rows.map((e) => {
      const isbn = books.get(e.bookId)?.isbn;
      return isbn ? "isbn:" + isbn : "book:" + e.bookId;
    }),
  ).size;

/**
 * The library's numbers (4-7), in works so versions never swell them. A
 * book only liked is left out of the total and 「まだ振り分けていない」
 * while likes_in_library is off, and still counts on いいねした本.
 */
export function countsOf(
  state: LibraryState,
  shopBooks: ReadonlySet<string>,
  shelves: readonly DefaultShelf[] = DEFAULT_SHELVES,
): LibraryCounts {
  const books = new Map(state.books.map((book) => [book.id, book]));
  const contextOf = contextsOf(state, shopBooks);
  const rows = Object.values(state.libraryEntries)
    .filter((e) => books.has(e.bookId))
    .map((e) => ({ e, x: contextOf(e.bookId) }));
  const works = (list: typeof rows) =>
    workCount(
      list.map((row) => row.e),
      books,
    );
  const shown = rows.filter(({ e, x }) => inLibrary(e, x));
  const counts: LibraryCounts = {
    works: works(shown),
    editions: editionCount(
      shown.map((row) => row.e),
      books,
    ),
    owned: shown.filter(({ e }) => e.owned === "yes").length,
    notOwned: shown.filter(({ e }) => e.owned === "no").length,
    unsorted: works(shown.filter(({ e, x }) => isUnsorted(e, x))),
    shelves: {},
    themes: {},
  };
  for (const shelf of shelves) {
    const n = works(rows.filter(({ e, x }) => shelf.has(e, x)));
    if (n > 0) counts.shelves[shelf.key] = n;
  }
  const themes = themeShelves(state);
  for (const [id, shelf] of themes.live) {
    const on = themes.books.get(id);
    const members = shown.filter(({ e }) => on?.has(e.bookId));
    const n = works(members);
    if (n === 0) continue;
    const hidden = shelf.showWanted
      ? 0
      : works(members.filter(({ e }) => wantedOnly(e)));
    counts.themes[id] =
      hidden > 0 ? { works: n, hiddenWanted: hidden } : { works: n };
  }
  return counts;
}

// ---------------------------------------------------------------- the old lists

/** book_marks' kinds the library follows. */
export type MarkKind = "wish" | "favorite" | "library" | "finished";
/** The town's lists the marks were made from (wishlist and finishedBooks become worked out from rows). */
export interface MarkLists {
  wishlist: string[];
  favorites: string[];
  library: string[];
  finishedBooks: string[];
}
/** A mark written or deleted by an app that does not know the library. */
export interface MarkChange {
  op: "insert" | "delete";
  kind: MarkKind;
  bookId: string;
  /** The mark's created_at. */
  at: string;
}
/** What keeps a row whose last mark went, once the change is made. */
export interface MarkKeeps {
  library: boolean;
  favorite: boolean;
  /** On a theme shelf not put away. */
  liveShelf: boolean;
  /** The reader's own reading record. */
  record: boolean;
  /** An encounter's memo, taken back or not (decisions 1 and 3). */
  memo: boolean;
}

const MARKS: readonly { kind: MarkKind; list: keyof MarkLists }[] = [
  { kind: "library", list: "library" },
  { kind: "wish", list: "wishlist" },
  { kind: "favorite", list: "favorites" },
  { kind: "finished", list: "finishedBooks" },
];

/**
 * The lists the old screens read, worked out from the rows (5-2): wanted
 * books not taken out, oldest first; finished books, taken out or not
 * (finishing stays a fact), in the order they were finished.
 */
export function legacyLists(entries: Record<string, LibraryEntry>): {
  wishlist: string[];
  finishedBooks: string[];
} {
  const rows = Object.values(entries);
  const by =
    (time: (e: LibraryEntry) => string | null) =>
    (a: LibraryEntry, b: LibraryEntry) =>
      older(time(a), time(b)) || byId(a.bookId, b.bookId);
  return {
    wishlist: rows
      .filter((e) => e.removedAt === null && e.wantedAt !== null)
      .sort(by((e) => e.wantedAt))
      .map((e) => e.bookId),
    finishedBooks: rows
      .filter((e) => e.status === "finished")
      .sort(by((e) => e.statusAt))
      .map((e) => e.bookId),
  };
}

/** What a reader had before the library. */
export interface LegacySources {
  lists: MarkLists;
  /** The mark's created_at; without it (the demo), a list's order is kept a millisecond apart before `at`. */
  markedAt?: (kind: MarkKind, bookId: string) => string | undefined;
  records: ReadingRecord[];
  sessions: ReadingSession[];
  /** The reader's own posts, posters (drafts too), 人生の9冊 and shop (N19, N20). */
  uses?: { bookId: string; at: string }[];
}

/**
 * The library a reader already has, from what they did before it (4-8), as
 * the database's backfill makes it. Nothing new is guessed: only a finished
 * mark or a reading still running gives a status, and owning is never set.
 * Steps in order; the first that makes a row sets when it came in:
 * 1. marks (library, wish, finished, ☆): when the first was made; wish gives
 *    読みたい, finished 読了;
 * 2. the reader's own records;
 * 3. the reading running: 読書中 on a new row or one with no status;
 * 4. readings ended;
 * 5. books used in the reader's own posts, posters, nine and shop: the
 *    earliest use.
 * A book so used is marked as used (everUsed), whichever step made its row.
 * Likes are not copied (book_encounters starts empty, so no like stands).
 */
export function legacyToLibrary(
  from: LegacySources,
  at: string,
): Record<string, LibraryEntry> {
  const entries: Record<string, LibraryEntry> = {};
  const earliest = (a: string | null, b: string) =>
    a === null || Date.parse(b) < Date.parse(a) ? b : a;
  const firstBy = (items: { bookId: string; at: string }[]) => {
    const first = new Map<string, string>();
    for (const item of items)
      first.set(item.bookId, earliest(first.get(item.bookId) ?? null, item.at));
    return first;
  };
  const make = (first: Map<string, string>) => {
    for (const [bookId, time] of first)
      entries[bookId] ??= blankEntry(bookId, "legacy", time);
  };

  const start = Date.parse(at);
  const marks = new Map<
    string,
    { added: string; wanted: string | null; finished: string | null }
  >();
  for (const { kind, list } of MARKS) {
    const ids = from.lists[list];
    ids.forEach((bookId, i) => {
      const time =
        from.markedAt?.(kind, bookId) ??
        new Date(start - (ids.length - i)).toISOString();
      const mark = marks.get(bookId) ?? {
        added: time,
        wanted: null,
        finished: null,
      };
      mark.added = earliest(mark.added, time);
      if (kind === "wish") mark.wanted = earliest(mark.wanted, time);
      if (kind === "finished") mark.finished = earliest(mark.finished, time);
      marks.set(bookId, mark);
    });
  }
  for (const [bookId, mark] of marks)
    entries[bookId] = {
      ...blankEntry(bookId, "legacy", mark.added),
      wantedAt: mark.wanted,
      status: mark.finished === null ? null : "finished",
      statusAt: mark.finished,
    };

  make(
    firstBy(
      from.records
        .filter((record) => record.readerId === ME_ID)
        .map((record) => ({ bookId: record.bookId, at: record.createdAt })),
    ),
  );
  for (const session of from.sessions)
    if (session.endedAt === null && session.bookId !== null) {
      const e = (entries[session.bookId] ??= blankEntry(
        session.bookId,
        "legacy",
        session.startedAt,
      ));
      if (e.status === null) {
        e.status = "reading";
        e.statusAt = session.startedAt;
      }
    }
  make(
    firstBy(
      from.sessions.flatMap((session) =>
        session.endedAt !== null && session.bookId !== null
          ? [{ bookId: session.bookId, at: session.startedAt }]
          : [],
      ),
    ),
  );
  make(firstBy(from.uses ?? []));
  for (const use of from.uses ?? []) entries[use.bookId].everUsed = true;
  return entries;
}

/**
 * What changed between two sets of lists, as marks: deleted first, then
 * written, each in the order library, wish, ☆, finished. The demo feeds it
 * the old lists against those it last wrote (6-2). Deleted first because
 * an old app saves its marks so (planWrites in src/lib/town-remote.ts), and
 * the trigger follows them one by one: a wish taken off and finished put on
 * in one save takes out a row nothing else keeps, finished (a status set on
 * a row taken out does not bring it back). The marks written to one list
 * are a millisecond apart in its order, the last at `at`, so the rows keep
 * the order the old tab added them in (legacyLists).
 */
export function markChanges(
  before: MarkLists,
  after: MarkLists,
  at: string,
): MarkChange[] {
  const changes: MarkChange[] = [];
  const end = Date.parse(at);
  for (const op of ["delete", "insert"] as const)
    for (const { kind, list } of MARKS) {
      const [from, to] =
        op === "insert"
          ? [before[list], after[list]]
          : [after[list], before[list]];
      const ids = [...new Set(to)].filter((bookId) => !from.includes(bookId));
      ids.forEach((bookId, i) =>
        changes.push({
          op,
          kind,
          bookId,
          at:
            op === "insert"
              ? new Date(end - (ids.length - 1 - i)).toISOString()
              : at,
        }),
      );
    }
  return changes;
}

/**
 * The trigger private.library_follows_marks, here: marks written by an app
 * that does not know the library, copied to its rows in the old app's
 * meaning, branch for branch as the SQL does. A mark written makes a row if
 * there is none (from legacy), brings back one taken out (library, wish,
 * ☆), and ends likeRestored. A wish taken off clears 読みたい; finished taken
 * off happens only when the old app reads a book again (startReading), so it
 * becomes 読書中 and, as in the app, ends likeRestored; no other mark taken
 * off does, as taking something back gives a row nothing (putsOn). A
 * library, wish or ☆ taken off then takes out a row nothing keeps; a row
 * once used in the shop, a post, a poster or the nine is kept (everUsed,
 * N19), though the shop and those are not looked at themselves. `keeps`
 * tells the state after the change; `now` is the database's time. The
 * entries themselves come back when nothing changes.
 */
export function followMarks(
  entries: Record<string, LibraryEntry>,
  changes: MarkChange[],
  keeps: (bookId: string) => MarkKeeps,
  now: string,
): Record<string, LibraryEntry> {
  let out = entries;
  const put = (e: LibraryEntry) => {
    if (out === entries) out = { ...entries };
    out[e.bookId] = e;
  };
  for (const change of changes) {
    const kind = change.kind;
    const brings = kind === "library" || kind === "wish" || kind === "favorite";
    let e = out[change.bookId] ?? null;
    if (change.op === "insert") {
      if (!e) put((e = blankEntry(change.bookId, "legacy", change.at)));
      if (
        (brings && e.removedAt !== null) ||
        (kind === "wish" && e.wantedAt === null) ||
        (kind === "finished" && e.status !== "finished") ||
        e.likeRestored
      )
        put({
          ...e,
          removedAt: brings ? null : e.removedAt,
          likeRestored: false,
          wantedAt: kind === "wish" ? (e.wantedAt ?? change.at) : e.wantedAt,
          status: kind === "finished" ? "finished" : e.status,
          statusAt:
            kind === "finished" && e.status !== "finished"
              ? change.at
              : e.statusAt,
        });
      continue;
    }
    if (!e) continue;
    if (
      (kind === "wish" && e.wantedAt !== null) ||
      (kind === "finished" && e.status === "finished")
    )
      put(
        (e = {
          ...e,
          wantedAt: kind === "wish" ? null : e.wantedAt,
          status: kind === "finished" ? "reading" : e.status,
          statusAt: kind === "finished" ? now : e.statusAt,
          likeRestored: e.likeRestored && kind !== "finished",
        }),
      );
    if (!brings || e.removedAt !== null) continue;
    const kept = keeps(change.bookId);
    if (
      e.status === null &&
      e.wantedAt === null &&
      e.owned === null &&
      e.likedAt === null &&
      !e.everUsed &&
      !kept.liveShelf &&
      !kept.library &&
      !kept.favorite &&
      !kept.record &&
      !kept.memo
    )
      put({ ...e, removedAt: now });
  }
  return out;
}

// ---------------------------------------------------------------- checks before sending

const isTime = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
const isTimeOrNull = (value: unknown) => value === null || isTime(value);
const isName = (value: unknown) => typeof value === "string" && value !== "";
const isNameOrNull = (value: unknown) => value === null || isName(value);

/**
 * The first field of a row the database would refuse, or null (10-0): a
 * refused write would take every unsent change with it.
 */
export function validateEntry(e: LibraryEntry): string | null {
  if (!isName(e.bookId)) return "bookId";
  if (e.status !== null && !READING_STATUSES.includes(e.status))
    return "status";
  if (!isTimeOrNull(e.statusAt)) return "statusAt";
  if (!isTimeOrNull(e.wantedAt)) return "wantedAt";
  if (!isTimeOrNull(e.likedAt)) return "likedAt";
  if (e.owned !== null && e.owned !== "yes" && e.owned !== "no") return "owned";
  if (!ENTRY_SOURCES.includes(e.source)) return "source";
  if (!isNameOrNull(e.batchId)) return "batchId";
  if (!isTime(e.addedAt)) return "addedAt";
  if (!isTimeOrNull(e.removedAt)) return "removedAt";
  if (typeof e.likeRestored !== "boolean") return "likeRestored";
  if (typeof e.everUsed !== "boolean") return "everUsed";
  return null;
}

const SHELF_POSITION = /^[0-9A-Za-z]{1,64}$/;
/** Postgres' btrim takes off only spaces; JavaScript's trim would also take a full-width one. */
const btrim = (text: string) => text.replace(/^ +| +$/g, "");

/** The first field of a theme shelf the database would refuse, or null. */
export function validateShelf(shelf: LibraryShelf): string | null {
  if (!isName(shelf.id)) return "id";
  const name =
    typeof shelf.name === "string" ? codePoints(btrim(shelf.name)) : 0;
  if (name < 1 || name > 40) return "name";
  if (typeof shelf.note !== "string" || codePoints(shelf.note) > 500)
    return "note";
  if (
    typeof shelf.position !== "string" ||
    !SHELF_POSITION.test(shelf.position)
  )
    return "position";
  if (typeof shelf.showWanted !== "boolean") return "showWanted";
  if (!isTime(shelf.createdAt)) return "createdAt";
  if (!isTimeOrNull(shelf.deletedAt)) return "deletedAt";
  return null;
}

/**
 * The first field of an encounter the table would refuse, or null. A new
 * one (`insert`) must also name its post, or its shop and the POP's place,
 * as the insert trigger wants; a row already there loses them only when
 * the post or shop goes (on delete set null).
 */
export function validateEncounter(
  c: Encounter,
  options: { insert?: boolean } = {},
): string | null {
  if (!isName(c.id)) return "id";
  if (!isName(c.bookId)) return "bookId";
  if (!ENCOUNTER_KINDS.includes(c.kind)) return "kind";
  if (!ENCOUNTER_VIAS.includes(c.via)) return "via";
  // A book's page has only 読みたい; a post has no 私も好き！.
  if (c.via === "book" && c.kind !== "want") return "kind";
  if (c.via === "post" && c.kind === "love") return "kind";
  if (!isNameOrNull(c.postId)) return "postId";
  if (options.insert && c.via === "post" && c.postId === null) return "postId";
  if (!isNameOrNull(c.shopId)) return "shopId";
  if (options.insert && c.via === "pop" && c.shopId === null) return "shopId";
  if (options.insert && c.via === "pop" && c.placementKey === null)
    return "placementKey";
  if (
    c.placementKey !== null &&
    (typeof c.placementKey !== "string" ||
      codePoints(c.placementKey) < 1 ||
      codePoints(c.placementKey) > PLACEMENT_KEY_MAX_LENGTH)
  )
    return "placementKey";
  if (!isNameOrNull(c.otherReaderId)) return "otherReaderId";
  if (
    c.memo !== null &&
    (typeof c.memo !== "string" ||
      codePoints(c.memo) < 1 ||
      codePoints(c.memo) > ENCOUNTER_MEMO_MAX_LENGTH)
  )
    return "memo";
  if (!isTimeOrNull(c.memoAt)) return "memoAt";
  if (!isTimeOrNull(c.undoneAt)) return "undoneAt";
  if (!isTime(c.createdAt)) return "createdAt";
  return null;
}
