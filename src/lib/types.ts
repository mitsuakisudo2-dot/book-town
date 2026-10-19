import type { LibraryEntry, LibraryShelf, ShelfBook } from "./library";
import type { LibraryChange, LibraryUndo } from "./library-town";
import type { Poster, PosterDraft } from "./posters";
import type { FiledReport } from "./supabase/reports";
import type {
  Audience,
  Choice,
  ShelfAudiences,
  Visibilities,
  VisibilityKind,
} from "./visibility";

export type { FiledReport };

export const ME_ID = "me";
export const OWN_SHOP_ID = "mine";
export const DEFAULT_SHELF_CAPACITY = 20;

export const POP_REACTIONS = ["like", "read", "love"] as const;
export type PopReaction = (typeof POP_REACTIONS)[number];
export const popReactionKey = (
  shopId: string,
  shelfId: string,
  itemId: string,
) => JSON.stringify([shopId, shelfId, itemId]);

export type BookDisplay = "spine" | "face";
export type ShopTheme = "sage" | "ink" | "ochre" | "rose";

/**
 * Where a reading came from. `sample`: checked by hand for the 見本's books,
 * kept only in the code and never saved.
 */
export type ReadingSource = "openbd" | "ndl" | "typed" | "estimate" | "sample";
/** How a title or an author is read, in katakana as the source wrote it (spaces and 「家, 名」 kept). */
export interface BookReading {
  text: string;
  source: ReadingSource;
}

export interface Book {
  id: string;
  /** Optional licensed cover or local preview URL; spines remain generated. */
  coverUrl?: string;
  title: string;
  author: string;
  genre: string;
  summary: string;
  color: string;
  ink: string;
  height: number;
  thickness: number;
  pattern: number;
  /** Books the viewer registered (by barcode or by hand) carry their ISBN when known. */
  isbn?: string;
  /** List price in yen, tax included. Demo prices are placeholders, labeled as such. */
  price?: number;
  /** The work this edition belongs to (books.work_id, read with the book). The demo's books and the 見本 have none: each is its own work. */
  workId?: string;
  /**
   * Typed in by another reader: shown as theirs, on their shelf, post or
   * page, and named by none of this reader's rows, which name their own copy
   * of it instead (own-books.ts).
   */
  theirs?: true;
  /** The book of another reader's this is the reader's own copy of (own-books.ts). */
  copyOf?: string;
  subtitle?: string;
  /** Lets a title written in kanji be found by its kana or romaji. */
  titleReading?: BookReading;
  authorReading?: BookReading;
}

export interface Reader {
  id: string;
  /** The reader's public ID, shown as @handle. Lowercase letters, digits and _. */
  handle: string;
  name: string;
  bio: string;
  color: string;
  lifeNine: string[];
  nineNotes: Record<string, string>;
  /** Web pages the reader shares on their profile (note, YouTube, an official site…). */
  links?: string[];
}

export interface ShelfItem {
  id: string;
  bookId: string;
  display: BookDisplay;
  pop: string;
}

export type ShelfDoodle =
  "travel" | "daily" | "forest" | "stars" | "garden" | "city" | "lamp";
export interface Shelf {
  id: string;
  name: string;
  capacity: number;
  items: ShelfItem[];
  isPublic: boolean;
  /** Demo chalkboard copy for the immersive store; optional. */
  board?: { title: string; doodle?: ShelfDoodle };
}

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  theme: ShopTheme;
  tagline: string;
  followers: number;
  /**
   * How many readers stopped by last week, the week (Monday to Sunday, Japan
   * time) that ended at `at`. Only the owner's own shop has it, with an
   * account, and only when someone came.
   */
  weekVisitors?: { count: number; at: string };
  shelves: Shelf[];
  /**
   * The books standing in the shop's store scene, read with an account (only
   * the public ones of another reader's shop): lists count them as used.
   */
  sceneBookIds?: string[];
  demo: boolean;
}

export const POST_MAX_LENGTH = 1000;
/** The longest email address the sign-in takes (as the auth server does). */
export const EMAIL_MAX_LENGTH = 254;
/** The same limits as the database (supabase/migrations), so a save is never refused for length. */
export const SHOP_NAME_MAX_LENGTH = 80;
export const SHOP_TAGLINE_MAX_LENGTH = 500;
/** Shops opened before 2026-10-13 got the service's slogan as their tagline. */
const LEGACY_DEFAULT_TAGLINE = "あなたの愛した一冊が、誰かの愛する一冊になる。";
/** The owner's own tagline; the old default slogan was never their words. */
export const ownTagline = (shop: Pick<Shop, "tagline">) =>
  shop.tagline === LEGACY_DEFAULT_TAGLINE ? "" : shop.tagline;
export const SHOP_DESCRIPTION_MAX_LENGTH = 2000;
export const SHELF_NAME_MAX_LENGTH = 80;
export const POP_MAX_LENGTH = 1000;
/** A shelf of the reader's own in the library (library_shelves). */
export const LIBRARY_SHELF_NAME_MAX_LENGTH = 40;
export const LIBRARY_SHELF_NOTE_MAX_LENGTH = 500;
export const READER_NAME_MAX_LENGTH = 80;
export const BIO_MAX_LENGTH = 2000;
export const NINE_NOTE_MAX_LENGTH = 500;
export const SHOP_MESSAGE_MAX_LENGTH = 2000;
/** Limits of the store scene's own text (kept in the scene, not a database column). */
export const SCENE_ROW_TEXT_MAX_LENGTH = 80;
export const SCENE_TEXT_MAX_LENGTH = 500;
export const SCENE_BOARD_TITLE_MAX_LENGTH = 12;
export const SCENE_POP_MAX_LENGTH = 10000;

/** A like can be pressed again, up to this many times per person and post. */
export const LIKE_TAPS_MAX = 10;

export interface Liker {
  readerId: string;
  taps: number;
  /** When they first liked it. */
  at: string;
}

/** One kind of post. A top-level post with a book is also a review on that book's page. */
export interface Post {
  id: string;
  authorId: string;
  body: string;
  bookId: string | null;
  /** Spoiler posts never reach the timeline; they wait behind the book page's door. */
  spoiler: boolean;
  /**
   * Three readers asked 「ネタバレでは？」, so it is folded for everyone like a
   * marked spoiler. Only the database folds; demo posts never are.
   */
  folded?: boolean;
  /** Replies point to a top-level post. Threads are one level deep. */
  parentId: string | null;
  createdAt: string;
  /** Reactions from other readers in the demo data. The viewer's own are stored separately. */
  likes: number;
  wants: number;
  /** On the viewer's own posts: who else liked it, and how many times each pressed. */
  likers?: Liker[];
  /**
   * On the viewer's own posts: how many readers liked it anonymously, counted
   * once each, and when the newest of them did. Never who (管理表80).
   */
  anonymousLikes?: { people: number; at: string };
  /**
   * Written while reading. "together" memos are ordinary public posts with a reading badge;
   * "solo" memos are private notes only the writer sees.
   */
  readingMode: ReadingMode | null;
}

export interface PostDraft {
  body: string;
  bookId?: string | null;
  spoiler?: boolean;
  parentId?: string | null;
  /** Attach the post to the active reading session, which decides its book and visibility. */
  fromReading?: boolean;
}

export const READING_MODES = ["solo", "together"] as const;
export type ReadingMode = (typeof READING_MODES)[number];

export interface ReadingSession {
  id: string;
  /** Null when the reader started without choosing a book. */
  bookId: string | null;
  mode: ReadingMode;
  startedAt: string;
  /** Null while the session is running. Only one session runs at a time. */
  endedAt: string | null;
}

/** A demo reader who is reading together right now; minutes are counted back from the page load. */
export interface ReadingNow {
  readerId: string;
  bookId: string;
  minutesAgo: number;
}

export const COMPOSE_ICONS = ["pen", "typewriter", "quill"] as const;
export type ComposeIcon = (typeof COMPOSE_ICONS)[number];

/**
 * 「ネタバレの表示」, the reader's own: show_all すべて表示する,
 * fold_possible (the default) たたむ what three readers asked 「ネタバレでは？」
 * about, leave_out 出さない what is marked or possibly a spoiler. A post its
 * writer marked is folded from the start whichever is chosen.
 */
export const SPOILER_DISPLAYS = [
  "show_all",
  "fold_possible",
  "leave_out",
] as const;
export type SpoilerDisplay = (typeof SPOILER_DISPLAYS)[number];

export interface Settings {
  composeIcon: ComposeIcon;
  /**
   * 見せる範囲: each kind's starting choice (src/lib/visibility.ts). Records
   * start 自分だけ, chosen again when signing up.
   */
  visibility: Visibilities;
  /**
   * Who may see each of the shelves every library has, by its key
   * (DEFAULT_SHELVES); one not named follows visibility.shelves.
   */
  shelfAudiences: ShelfAudiences;
  /** 「ネタバレの表示」: the reader's own. */
  spoilerDisplay: SpoilerDisplay;
}

/** What can be folded by reports. */
export type ReviewKind = "post" | "shop" | "profile" | "poster";
/** A thing folded by reports: everyone sees it folded, or (only its owner knows) held. */
export interface ReviewFold {
  state: "folded" | "held";
  since: string;
}
/** reviewFolds is keyed by kind and id. */
export const reviewKey = (kind: ReviewKind, id: string) => kind + ":" + id;

/**
 * 読後の気持ち, chosen instead of stars: any number, none is fine too. The
 * words can be chosen again later; the ids are what is saved.
 */
export const FEELINGS = [
  "cried",
  "quiet",
  "sleepless",
  "warm",
  "laughed",
  "scared",
  "shaken",
  "again",
  "recommend",
  "talk",
  "lingering",
  "not_now",
] as const;
export type Feeling = (typeof FEELINGS)[number];
export const FEELING_WORDS: Record<Feeling, string> = {
  cried: "泣いた",
  quiet: "静かになった",
  sleepless: "眠れなくなった",
  warm: "あたたかくなった",
  laughed: "笑った",
  scared: "こわかった",
  shaken: "価値観が揺れた",
  again: "もう一度読みたい",
  recommend: "誰かに薦めたい",
  talk: "誰かと話したい",
  lingering: "よく分からない、でも残る",
  not_now: "今の自分には合わなかった",
};
/** The same limit as reading_entries.body. */
export const RECORD_NOTE_MAX_LENGTH = 255;

/** A reader's record of finishing a book: how it felt, and a few words. */
export interface ReadingRecord {
  id: string;
  readerId: string;
  bookId: string;
  feelings: Feeling[];
  note: string;
  /** The note gives the story away; others open it on purpose. */
  spoiler: boolean;
  /** Who may read it besides the reader (見せる範囲). */
  audience: Audience;
  createdAt: string;
}

export type RecordDraft = Pick<
  ReadingRecord,
  "bookId" | "feelings" | "note" | "spoiler" | "audience"
>;

export interface NewBook {
  title: string;
  author: string;
  isbn?: string;
  price?: number;
}

/**
 * How a reader's fix of a book they registered went: fixed, nothing to fix,
 * no title, an ISBN that does not check out, an ISBN another book of their
 * library has (`already`), or not kept (the town is not in yet).
 */
export type BookFixResult =
  "fixed" | "unchanged" | "no-title" | "bad-isbn" | "already" | "not-saved";

/** How a book came to be registered: read by the camera, its ISBN typed, or by hand. */
export type RegisterVia = "scan" | "isbn" | "manual";

/**
 * What registering a book did.
 * - added: it is in the reader's library now.
 * - already: it was in the library already; nothing changed.
 * - restored: a book taken out of the library came back with what it had.
 *   The library keeps nothing for a book taken out yet (no status, no
 *   shelves), so for now such a book simply comes back as added.
 * - not-saved: the town is still loading, or the account could not be
 *   read, so nothing could be kept. The screen must not say the book was
 *   registered.
 */
export type RegisterResult = "added" | "already" | "restored" | "not-saved";
export type Registration =
  | {
      result: Exclude<RegisterResult, "not-saved">;
      bookId: string;
      /** The title as kept: cut to 200 characters, or the town's own. */
      title: string;
    }
  | { result: "not-saved" };

export interface TownState {
  books: Book[];
  readers: Reader[];
  shops: Shop[];
  me: Reader;
  ownShop: Shop | null;
  following: string[];
  /**
   * Readers the viewer blocked (by their ids), oldest first. Only an account
   * blocks: the database keeps each from the other both ways (blocks).
   */
  blocked: string[];
  wishlist: string[];
  favorites: string[];
  popReactions: Record<string, PopReaction[]>;
  posts: Post[];
  likedPosts: string[];
  /**
   * How many times the viewer pressed いいね on a liked post, when more than
   * once (up to LIKE_TAPS_MAX). A liked post missing here was pressed once.
   */
  likeTaps: Record<string, number>;
  /** Posts that made the viewer want to read their book; the post records who inspired it. */
  wantedPosts: string[];
  spoilerReports: string[];
  readingNow: ReadingNow[];
  readingSessions: ReadingSession[];
  finishedBooks: string[];
  /**
   * Books the viewer registered on purpose (scanned, typed in, added from a
   * search), newest last. Registering says nothing about owning a copy.
   */
  library: string[];
  /**
   * The viewer's own reading records, and others' public ones, oldest first:
   * with an account, a window of others' (town-more.ts reads the rest on the
   * page that shows them).
   */
  readingRecords: ReadingRecord[];
  /**
   * The feelings someone in the town kept, of all time, read when the
   * search opens (town-more.ts), since the town has only a window of others'
   * records. Without it, the records tell.
   */
  feltInTown?: Feeling[];
  /**
   * The rows of the viewer's library (library_entries) as they are kept, by
   * book. A book with none yet is worked out from the rest of the town each
   * time (entriesOf in library-town.ts); a row is kept once the reader
   * changes something of it.
   */
  libraryEntries: Record<string, LibraryEntry>;
  /** The shelves the reader made in the library (library_shelves), put away ones too, in no order. */
  libraryShelves: LibraryShelf[];
  /** Which books are on them (library_shelf_books). */
  libraryShelfBooks: ShelfBook[];
  settings: Settings;
  seenNotifications: string[];
  /** Words other readers left at the viewer's shop. Only an account receives them. */
  shopMessages: ShopMessage[];
  /**
   * Things folded by reports (reviewKey → fold). A held one is only ever
   * the viewer's own: the database shows held things to their owner alone.
   */
  reviewFolds: Record<string, ReviewFold>;
  /** The viewer's own reports, newest first. Only an account files them. */
  myReports: FiledReport[];
  /** The viewer's own posters, drafts too, and others' put up. */
  posters: Poster[];
  /**
   * Posts read after the town by the reader's asking (PR 2), never saved
   * and gone with the next reading: an older page of 便りだけ ("older"),
   * or one opened alone by its id ("alone"). They are old: no notice is
   * made of them, and one alone may stand far from the rest.
   */
  readAfter?: Record<string, "older" | "alone">;
  /** How far 便りだけ has read back, and for whose 便り (PR 2). */
  olderRead?: OlderRead;
}

/** 便りだけ's older pages read so far, for these writers. */
export interface OlderRead {
  /** The writers the pages were read for: the reader (ME_ID) and others. */
  authors: string[];
  /** The next page is from before this time. */
  before: string;
  /** The last page was short: there is nothing older. */
  done: boolean;
}

/** A toast's way back: a text button that undoes what the toast says was done. */
export interface ToastUndo {
  label: string;
  run: () => void;
}
export type Notify = (message: string, undo?: ToastUndo) => void;

export interface ShopMessage {
  readerId: string;
  text: string;
  /** When the reader last wrote it. */
  at: string;
}

export interface TownActions {
  createShop(name: string, description: string, theme: ShopTheme): void;
  updateShop(
    patch: Pick<Shop, "name" | "description" | "theme" | "tagline">,
  ): void;
  addShelf(name: string, capacity?: number): void;
  updateShelf(
    shelfId: string,
    patch: { name?: string; isPublic?: boolean },
  ): void;
  removeShelf(shelfId: string): void;
  /**
   * Puts the shop's shelves as they were arranged on this device (kept when
   * another device's change came first) in place of the shelves now.
   */
  restoreShelves(shelves: Shelf[]): void;
  addShelfBook(
    shelfId: string,
    bookId: string,
    display: BookDisplay,
    /** Places the book with a POP at a given place: putting back a book just taken off, or a new shop's first book. */
    restore?: { pop: string; index: number },
  ): boolean;
  removeShelfBook(shelfId: string, itemId: string): void;
  moveShelfBook(shelfId: string, itemId: string, toIndex: number): void;
  changeDisplay(shelfId: string, itemId: string, display: BookDisplay): boolean;
  updatePop(shelfId: string, itemId: string, pop: string): void;
  toggleFollow(shopId: string): void;
  /**
   * Blocks a reader: their 便り, shop, records and posters leave the town at
   * once, and following ends both ways. Only a reader in the database.
   * False when nothing was blocked (refused, or the town is still loading).
   */
  blockReader(readerId: string): boolean;
  /** Lifts a block. What it kept away comes back with the next reading. */
  unblockReader(readerId: string): void;
  toggleWish(bookId: string): void;
  toggleFavorite(bookId: string): void;
  togglePopReaction(
    shopId: string,
    shelfId: string,
    itemId: string,
    reaction: PopReaction,
  ): void;
  updateProfile(
    name: string,
    bio: string,
    links?: string[],
    handle?: string,
  ): boolean;
  updateNine(ids: string[], notes: Record<string, string>): void;
  createPost(draft: PostDraft): string | null;
  deletePost(postId: string): void;
  toggleLike(postId: string): void;
  /** Presses いいね once more, up to LIKE_TAPS_MAX. Returns how many times now. */
  tapLike(postId: string): number;
  toggleWant(postId: string): void;
  toggleSpoilerReport(postId: string): void;
  /** The writer puts the spoiler mark on their own post afterwards. */
  markSpoiler(postId: string): void;
  startReading(bookId: string | null, mode: ReadingMode): string | null;
  endReading(finished: boolean): void;
  /**
   * The one way a book enters the reader's library. A title or author over
   * 200 characters is cut to end in …. Null when there is no title, when the
   * ISBN does not check out, or for a visitor (asked to sign in instead).
   *
   * `bookId`: the id decided when a scanned book was read (library-journal.ts).
   * A new book takes it, so the same read sent twice is one book. Ignored when
   * another book already has that id, or when it is not an id the town could
   * have given.
   */
  registerBook(
    book: NewBook,
    via: RegisterVia,
    bookId?: string,
    /** The scan session it came in by: a new library row keeps it. */
    batchId?: string,
  ): Registration | null;
  /** registerBook, answering with the book's id (null when not registered). */
  addBook(book: NewBook): string | null;
  /**
   * Fixes the title, author and ISBN of a book the reader registered (one
   * held back, docs/09「食い違いの判定と保留」). An empty ISBN takes it away.
   * The database takes it only for a book the reader typed in.
   */
  fixBook(bookId: string, fix: Required<Omit<NewBook, "price">>): BookFixResult;
  toggleLibrary(bookId: string): void;
  /**
   * The book the reader's rows name for `bookId`: the book itself, or, for
   * one another reader typed in, the reader's own copy of it, made now when
   * they have none (own-books.ts). Null when the town lacks the book or
   * cannot take the copy yet. For what is changed outside the town, as the
   * store scene is.
   */
  ownBook(bookId: string): string | null;
  /**
   * Sorts books in the library: 積読・読書中・読了 (null for 未設定),
   * 読みたい, 所有 (null for 未設定), ☆, or taking them out (removed) and
   * back. Nothing is posted or shown to anyone. Answers what undoes it, or
   * null when nothing changed (or the town is still loading).
   */
  changeLibrary(bookIds: string[], change: LibraryChange): LibraryUndo | null;
  /** Undoes a change but for books changed again since; how many went back. */
  undoLibrary(undo: LibraryUndo): number;
  /**
   * Makes a shelf of the reader's own in the library, last among them.
   * Answers its id, or null when the name is empty or too long (or the town
   * is still loading, or for a visitor, asked to sign in instead).
   */
  makeLibraryShelf(
    name: string,
    note: string,
    more?: Pick<LibraryShelfChange, "audience" | "rule">,
  ): string | null;
  /**
   * Changes a shelf's name, note, whether it shows the books only wanted,
   * who may see it or a smart shelf's rule (a shelf filled by hand stays
   * one, and a smart shelf smart). False when nothing changed.
   */
  editLibraryShelf(shelfId: string, change: LibraryShelfChange): boolean;
  /** Who may see one of the shelves every library has (読了, 積読, …), by its key. False when nothing changed. */
  setDefaultShelfAudience(key: string, audience: Audience): boolean;
  /** Puts a shelf away (true) or brings it back (false), with its books. */
  putAwayLibraryShelf(shelfId: string, away: boolean): boolean;
  setComposeIcon(icon: ComposeIcon): void;
  /** Finishing a book, with how it felt. Also marks the book as finished. */
  recordReading(draft: RecordDraft): string | null;
  /** False when nothing was changed (refused, or the town is still loading). */
  updateRecord(
    recordId: string,
    patch: Partial<Omit<RecordDraft, "bookId">>,
  ): boolean;
  deleteRecord(recordId: string): void;
  /**
   * A kind's starting choice. Narrowing narrows what was kept before at
   * once; widening widens it only when `past` (「これまでの分も広げますか？」).
   */
  setVisibility(kind: VisibilityKind, choice: Choice, past?: boolean): void;
  setSpoilerDisplay(value: SpoilerDisplay): void;
  /** Remembers a report just filed (fileReport writes it; the sync does not). */
  noteReport(report: FiledReport): void;
  markNotificationsSeen(ids: string[]): void;
  /**
   * Keeps a poster: a new one, or with `posterId` the viewer's own changed.
   * A poster put up must be complete (posterProblem). Returns its id, or
   * null when nothing was kept (refused, or the town is still loading).
   */
  savePoster(draft: PosterDraft, posterId?: string): string | null;
  /** Takes down the viewer's own poster; false when nothing was taken down. */
  deletePoster(posterId: string): boolean;
}

export type AppActions = TownActions;

export const displayCost = (display: BookDisplay): number =>
  display === "face" ? 3 : 1;

export const shelfUsed = (shelf: Shelf): number =>
  shelf.items.reduce((total, item) => total + displayCost(item.display), 0);

export const normalizeCapacity = (capacity?: number): number =>
  typeof capacity === "number" && Number.isFinite(capacity)
    ? Math.min(100, Math.max(1, Math.trunc(capacity)))
    : DEFAULT_SHELF_CAPACITY;

export type PersistenceStatus =
  /** Changes are on their way to the account. */
  "loading" | "saving" | "saved" | "unavailable" | "recovered";

/** What can be changed of a shelf the reader made. */
export type LibraryShelfChange = Partial<
  Pick<LibraryShelf, "name" | "note" | "showWanted" | "audience" | "rule">
>;
