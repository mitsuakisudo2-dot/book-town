import { CATALOG_GENRE, createRegisteredBook, REGISTERED_GENRE } from "./books";
import { cleanLinks } from "./links";
import { cleanRecord } from "./records";
import {
  pageRowBookIds,
  pagesFromRows,
  pagesToRows,
  restorePoster,
  withPageRowBooks,
  type Poster,
  type PosterPageRow,
} from "./posters";
import { tapsOf } from "./social";
import {
  blankEntry,
  cleanShelfAudiences,
  readEncounter,
  readRule,
  validateEntry,
  validateShelf,
  type Encounter,
  type LibraryEntry,
  type LibraryShelf,
  type ShelfBook,
} from "./library";
import { entriesOf } from "./library-town";
import {
  keptCards,
  readCard,
  readCardBook,
  readNote,
  type ReadingCard,
  type ReadingCardBook,
  type ReadingNote,
} from "./reading-cards";
import {
  COMPOSE_ICONS,
  SPOILER_DISPLAYS,
  ME_ID,
  OWN_SHOP_ID,
  POP_REACTIONS,
  READING_MODES,
  popReactionKey,
  shelfUsed,
  type Book,
  type ComposeIcon,
  type Feeling,
  type PopReaction,
  type Post,
  type Reader,
  type ReadingMode,
  type ReadingNow,
  type ReadingRecord,
  type ReadingSession,
  type Shelf,
  type ShelfDoodle,
  type Shop,
  type ShopTheme,
  type SpoilerDisplay,
  type FiledReport,
  type ReviewFold,
  type ReviewKind,
  type TownState,
  reviewKey,
  STORED_NAME_MAX_LENGTH,
  STORED_POP_MAX_LENGTH,
} from "./types";
import type { Tables, TablesInsert } from "./supabase/database.types";
import { demoBooks } from "./data";
import { isDatabaseId } from "./record-kind";
import { withoutReaders } from "./blocks";
import { isSampleBook, sampleBookOfRow, sampleBookRowId } from "./samples";
import { filedReportFrom } from "./supabase/reports";
import type { Arrived } from "./arrived";
import {
  emptyMore,
  type CountedWork,
  type TownCount,
  type TownMore,
} from "./town-more";
import {
  cleanVisibilities,
  isAudience,
  shownToOthers,
  VISIBILITY_KINDS,
  type Audience,
  type Visibilities,
} from "./visibility";

// 見せる範囲 in the database (supabase/migrations/*_visibility.sql): each
// kind's starting choice is a column <kind>_audience of reader_settings, and
// 読書の状態 also has status_detail.
type SettingsVisibilityColumn =
  `${(typeof VISIBILITY_KINDS)[number]}_audience` | "status_detail";

/** The starting choices a settings row holds, the defaults for the rest. */
function visibilitiesFromRow(
  row: Partial<Tables<"reader_settings">> | null,
): Visibilities {
  return cleanVisibilities(
    Object.fromEntries(
      VISIBILITY_KINDS.map((kind) => [
        kind,
        {
          audience: row?.[`${kind}_audience`],
          detail: kind === "status" ? row?.status_detail : undefined,
        },
      ]),
    ),
  );
}

/** The settings columns whose starting choice changed. */
function visibilityChanges(
  base: Visibilities,
  next: Visibilities,
): Partial<Record<SettingsVisibilityColumn, string>> {
  const changed: Partial<Record<SettingsVisibilityColumn, string>> = {};
  for (const kind of VISIBILITY_KINDS) {
    if (next[kind].audience !== base[kind].audience)
      changed[`${kind}_audience`] = next[kind].audience;
    if (kind === "status" && next.status.detail !== base.status.detail)
      changed.status_detail = next.status.detail;
  }
  return changed;
}

/**
 * Who may read a record. A database a migration behind sends only
 * is_public, which meant the same as everyone.
 */
function recordAudience(
  row: Pick<Tables<"reading_entries">, "is_public"> & { audience?: string },
): Audience {
  if (isAudience(row.audience)) return row.audience;
  return row.is_public ? "everyone" : "private";
}

/**
 * The signed-in town, translated between database rows and the TownState the
 * screens use. The person's own records keep the app's aliases ("me" for their
 * profile, "mine" for their shop), so the screens work the same in the demo
 * and with an account; everyone else keeps their database ids.
 *
 * Nothing here talks to the network: town-backend.ts reads the rows and runs
 * the writes this module plans.
 */

/** The database ids behind the aliases. */
export interface RemoteIds {
  userId: string;
  /** The person's shop, or the id it will get when they open one. */
  shopId: string;
}

export type ShopRow = Pick<
  Tables<"shops">,
  | "id"
  | "owner_id"
  | "name"
  | "description"
  | "tagline"
  | "theme"
  | "is_open"
  | "public_shelves"
  | "public_scene_books"
>;

/**
 * Who typed a book in is not readable, so a book row comes without it, and
 * so is its edition (edition_id), which the app does not need. Its work
 * (work_id) comes with it: the database places every book in the work of its
 * edition (plan item 4), and the app never writes either.
 */
export type BookRow = Omit<Tables<"books">, "created_by" | "edition_id">;

export interface RemoteRows {
  profiles: Tables<"profiles">[];
  nine: Tables<"profile_nine">[];
  books: BookRow[];
  /** Open shops, and the person's own shop whether it is open or not. */
  shops: ShopRow[];
  /** Every shelf of the person's own shop, private ones included. */
  ownShelves: unknown;
  /** The books in the person's own store scene, private ones included. */
  ownSceneBooks: unknown;
  /** Words others left at the person's shop (the database hides blocked readers'). */
  shopMessages: Pick<
    Tables<"shop_reactions">,
    "user_id" | "message" | "updated_at"
  >[];
  /** Only owners can count their followers; nobody else sees the number. */
  ownShopFollowers: number;
  /**
   * Readers who stopped by the person's own shop in the week (Monday to
   * Sunday, Japan time) that ended at `at`, as the database counted it.
   */
  ownShopVisitors: { count: number; at: string } | null;
  follows: Pick<Tables<"shop_follows">, "shop_id">[];
  /** Whom the person blocked (only the blocker reads their blocks). */
  blocks: Pick<Tables<"blocks">, "blocked_id">[];
  marks: Tables<"book_marks">[];
  /**
   * The books the person typed in, their copies of others' among them
   * (copied_from), as my_books answers. None in a visitor's town, nor from a
   * database without it: then no book is told apart as another reader's.
   */
  myBooks?: { id: string; copied_from: string | null }[];
  /** The person's own library rows; none in a visitor's town. */
  libraryEntries?: Tables<"library_entries">[];
  /** The shelves the person made in their library, and their books; none in a visitor's town. */
  libraryShelves?: Tables<"library_shelves">[];
  libraryShelfBooks?: Tables<"library_shelf_books">[];
  /** Where the person met books (book_encounters); none in a visitor's town. */
  encounters?: Tables<"book_encounters">[];
  posts: Tables<"posts">[];
  /** The person's own reactions, and other people's reactions to their posts. */
  postReactions: Tables<"post_reactions">[];
  spoilerReports: Pick<Tables<"spoiler_reports">, "post_id">[];
  popReactions: Tables<"pop_reactions">[];
  /** The person's own reading, and others' reading together right now. */
  sessions: Tables<"reading_sessions">[];
  /**
   * The person's own readings (読書記録): their cards, the books of them and
   * 今日のノート. None in a visitor's town.
   */
  readingCards?: Tables<"reading_cards">[];
  readingCardBooks?: Tables<"reading_card_books">[];
  readingNotes?: Tables<"reading_notes">[];
  /**
   * The person's own reading records, and others' they may read: every one,
   * or, from town_view's window, the ones the town shows (TOWN_VIEW_ARGS).
   */
  records: Tables<"reading_entries">[];
  /** The person's own posters, drafts too, and others' put up. */
  posters: Tables<"posters">[];
  seenNotifications: string[];
  /** What reports folded for everyone, and what they hold of the person's own. */
  folds: Pick<
    Tables<"moderation_folds">,
    "target_kind" | "target_id" | "state" | "since"
  >[];
  /** The person's own reports, as far as a reporter may read them. */
  myReports: Pick<
    Tables<"reports">,
    | "id"
    | "target_kind"
    | "target_id"
    | "reason"
    | "progress"
    | "created_at"
    | "status_at"
  >[];
  /**
   * The person's own settings; none until they change one. Read whole, so a
   * database a column behind still loads the town (the defaults stand in).
   */
  readerSettings: Partial<Tables<"reader_settings">> | null;
}

const REVIEW_KINDS: ReviewKind[] = ["post", "shop", "profile", "poster"];

const THEMES: ShopTheme[] = ["sage", "ink", "ochre", "rose"];
const DOODLES: ShelfDoodle[] = [
  "travel",
  "daily",
  "forest",
  "stars",
  "garden",
  "city",
  "lamp",
];
const MARK_LISTS = {
  wish: "wishlist",
  favorite: "favorites",
  library: "library",
  finished: "finishedBooks",
} as const;
type MarkKind = keyof typeof MARK_LISTS;
const MARK_KINDS = Object.keys(MARK_LISTS) as MarkKind[];

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit;

/**
 * Books from the catalog get a drawn jacket, like the ones registered in the
 * demo. `registered`: the book is among the reader's own registered books.
 */
export function bookFromRow(row: BookRow, registered: boolean): Book {
  const book = {
    ...createRegisteredBook(row.id, {
      title: row.title,
      author: row.author,
      ...(row.isbn ? { isbn: row.isbn } : {}),
      ...(row.price ? { price: row.price } : {}),
    }),
    workId: row.work_id,
  };
  return registered
    ? book
    : {
        ...book,
        ...(row.source === "ndl"
          ? {
              genre: CATALOG_GENRE,
              summary: "図書館の目録にある本です。あらすじはありません。",
            }
          : {
              summary: "読書家が登録した本です。あらすじは登録されていません。",
            }),
      };
}

/**
 * A book typed in, as the reader's own or as another reader's (own-books.ts),
 * by the reader's own books (`mine`, from my_books): undefined tells none
 * apart.
 */
function withTypist(
  book: Book,
  row: BookRow,
  mine: ReadonlyMap<string, string | null> | undefined,
): Book {
  if (!mine || row.source !== "manual") return book;
  if (!mine.has(row.id)) return { ...book, theirs: true };
  const original = mine.get(row.id);
  return original ? { ...book, copyOf: original } : book;
}

/**
 * Shelves read from the database, kept only as far as they are well formed and
 * their books are known. Other people's shops are shown, never trusted: a bad
 * shelf or book is dropped instead of breaking the walk.
 */
export function cleanShelves(value: unknown, bookIds: Set<string>): Shelf[] {
  if (!Array.isArray(value)) return [];
  const shelves: Shelf[] = [];
  const shelfIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const candidate of value.slice(0, 100)) {
    if (
      !record(candidate) ||
      !text(candidate.id, 200) ||
      !candidate.id ||
      shelfIds.has(candidate.id) ||
      !text(candidate.name, STORED_NAME_MAX_LENGTH) ||
      !candidate.name.trim() ||
      typeof candidate.isPublic !== "boolean" ||
      typeof candidate.capacity !== "number" ||
      !Number.isInteger(candidate.capacity) ||
      candidate.capacity < 1 ||
      candidate.capacity > 100 ||
      !Array.isArray(candidate.items)
    )
      continue;
    shelfIds.add(candidate.id);
    const shelf: Shelf = {
      id: candidate.id,
      name: candidate.name,
      capacity: candidate.capacity,
      isPublic: candidate.isPublic,
      items: [],
    };
    const board = candidate.board;
    if (record(board) && text(board.title, 120))
      shelf.board = {
        title: board.title,
        ...(DOODLES.includes(board.doodle as ShelfDoodle)
          ? { doodle: board.doodle as ShelfDoodle }
          : {}),
      };
    const onShelf = new Set<string>();
    for (const item of candidate.items) {
      if (
        !record(item) ||
        !text(item.id, 200) ||
        !item.id ||
        itemIds.has(item.id) ||
        !text(item.bookId, 200) ||
        !bookIds.has(item.bookId) ||
        onShelf.has(item.bookId) ||
        (item.display !== "spine" && item.display !== "face") ||
        !text(item.pop, STORED_POP_MAX_LENGTH)
      )
        continue;
      const next = {
        id: item.id,
        bookId: item.bookId,
        display: item.display,
        pop: item.pop,
      } as const;
      if (
        shelfUsed({ ...shelf, items: [...shelf.items, next] }) > shelf.capacity
      )
        continue;
      itemIds.add(item.id);
      onShelf.add(item.bookId);
      shelf.items.push(next);
    }
    shelves.push(shelf);
  }
  return shelves;
}

/** Where a POP sits in a shop, as the database stores it next to the shop id. */
export const placementKey = (shelfId: string, itemId: string) =>
  JSON.stringify([shelfId, itemId]);

function parsePlacement(key: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) &&
      value.length === 2 &&
      value.every((part) => typeof part === "string")
      ? [value[0], value[1]]
      : null;
  } catch {
    return null;
  }
}

/**
 * Who the town is read for: the signed-in person, or nobody (userId null) for
 * a visitor who is only looking around.
 */
export interface TownViewer {
  userId: string | null;
  shopId: string;
}

/** Book ids as the town knows them: a 見本's book by its own name. */
function withSampleBookIds(rows: RemoteRows): RemoteRows {
  const id = (bookId: string) => sampleBookOfRow(bookId) ?? bookId;
  const named = <T extends { book_id: string | null }>(row: T): T =>
    row.book_id === null ? row : { ...row, book_id: id(row.book_id) };
  return {
    ...rows,
    books: rows.books.filter((row) => !sampleBookOfRow(row.id)),
    nine: rows.nine.map(named),
    marks: rows.marks.map(named),
    libraryEntries: rows.libraryEntries?.map(named),
    libraryShelfBooks: rows.libraryShelfBooks?.map(named),
    encounters: rows.encounters?.map(named),
    posts: rows.posts.map(named),
    sessions: rows.sessions.map(named),
    records: rows.records.map(named),
  };
}

/** The person's own library rows, of books the town knows, as the rules keep them. */
function entriesFromRows(
  rows: Tables<"library_entries">[],
  userId: string | null,
  bookIds: Set<string>,
): Record<string, LibraryEntry> {
  const entries: Record<string, LibraryEntry> = {};
  for (const row of rows) {
    if (row.user_id !== userId || !bookIds.has(row.book_id)) continue;
    const entry: LibraryEntry = {
      bookId: row.book_id,
      status: row.status as LibraryEntry["status"],
      statusAt: row.status_at,
      wantedAt: row.wanted_at,
      likedAt: row.liked_at,
      owned: row.owned as LibraryEntry["owned"],
      source: row.source as LibraryEntry["source"],
      batchId: row.batch_id,
      addedAt: row.added_at,
      removedAt: row.removed_at,
      likeRestored: row.like_restored,
      everUsed: row.ever_used,
    };
    // A value this app does not know (one from a later app) is left to it.
    if (validateEntry(entry) === null) entries[row.book_id] = entry;
  }
  return entries;
}

/** The person's own shelves in the library, as the rules keep them. */
function shelvesFromRows(
  rows: Tables<"library_shelves">[],
  userId: string | null,
): LibraryShelf[] {
  return rows.flatMap((row): LibraryShelf[] => {
    if (row.user_id !== userId) return [];
    const shelf: LibraryShelf = {
      id: row.id,
      name: row.name,
      note: row.note,
      position: row.position,
      showWanted: row.show_wanted,
      // A database a migration behind has neither: private, filled by hand.
      audience: isAudience(row.audience) ? row.audience : "private",
      rule: row.rule == null ? null : readRule(row.rule),
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    };
    // A rule this app cannot read (one from a later app) is left to it.
    if (row.rule != null && shelf.rule === null) return [];
    return validateShelf(shelf) === null ? [shelf] : [];
  });
}

/** The books on those shelves, of books the library keeps a row for. */
function shelfBooksFromRows(
  rows: Tables<"library_shelf_books">[],
  userId: string | null,
  shelves: LibraryShelf[],
  entries: Record<string, LibraryEntry>,
): ShelfBook[] {
  const shelfIds = new Set(shelves.map((shelf) => shelf.id));
  return rows.flatMap((row): ShelfBook[] =>
    row.user_id === userId && shelfIds.has(row.shelf_id) && entries[row.book_id]
      ? [
          {
            shelfId: row.shelf_id,
            bookId: row.book_id,
            addedAt: row.added_at,
            position: row.position,
          },
        ]
      : [],
  );
}

/** The person's own cards, their books and notes, as the town keeps them. */
function cardsFromRows(
  rows: RemoteRows,
  userId: string | null,
  sessions: ReadingSession[],
): Pick<TownState, "readingCards" | "readingCardBooks" | "readingNotes"> {
  const own = <T extends { user_id: string }>(list: T[] | undefined) =>
    (list ?? []).filter((row) => row.user_id === userId);
  return keptCards(
    sessions,
    own(rows.readingCards).flatMap(
      (row) =>
        readCard({
          id: row.id,
          timeZone: row.time_zone,
          addedLater: row.added_later,
          pausedAt: row.paused_at,
          pausedSeconds: row.paused_seconds,
          timer: row.timer,
          timerMinutes: row.timer_minutes,
          restMinutes: row.rest_minutes,
          timerAt: row.timer_at,
          room: row.room,
          light: row.light,
          look: row.look,
          createdAt: row.created_at,
        }) ?? [],
    ),
    own(rows.readingCardBooks).flatMap(
      (row) =>
        readCardBook({
          sessionId: row.session_id,
          cardId: row.card_id,
          readSeconds: row.read_seconds,
          pageFrom: row.page_from,
          pageTo: row.page_to,
          pageUnit: row.page_unit,
          format: row.format,
          finished: row.finished,
          createdAt: row.created_at,
        }) ?? [],
    ),
    own(rows.readingNotes).flatMap(
      (row) =>
        readNote({
          id: row.id,
          cardId: row.card_id,
          sessionId: row.session_id,
          kind: row.kind,
          body: row.body,
          page: row.page,
          createdAt: row.created_at,
        }) ?? [],
    ),
  );
}

/** The person's own encounters, of books the town knows, oldest first. */
function encountersFromRows(
  rows: Tables<"book_encounters">[],
  userId: string | null,
  bookIds: Set<string>,
): Encounter[] {
  return rows
    .flatMap((row): Encounter[] => {
      if (row.user_id !== userId || !bookIds.has(row.book_id)) return [];
      const c = readEncounter({
        id: row.id,
        bookId: row.book_id,
        kind: row.kind,
        via: row.via,
        postId: row.post_id,
        shopId: row.shop_id,
        placementKey: row.placement_key,
        otherReaderId: row.other_reader_id,
        memo: row.memo,
        memoAt: row.memo_at,
        undoneAt: row.undone_at,
        createdAt: row.created_at,
      });
      return c ? [c] : [];
    })
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * A post as the town keeps it. The reader's own (by "me") carries what others
 * did to it: how many liked and wanted it, and who liked it how many times.
 */
function postFromRow(
  row: Tables<"posts">,
  userId: string | null,
  reactions: Tables<"post_reactions">[],
): Post {
  const mine = row.author_id === userId;
  const others = (kind: "like" | "want") =>
    reactions.filter(
      (reaction) =>
        reaction.post_id === row.id &&
        reaction.kind === kind &&
        reaction.user_id !== userId,
    );
  return {
    id: row.id,
    authorId: mine ? ME_ID : row.author_id,
    body: row.body,
    bookId: row.book_id,
    spoiler: row.spoiler,
    ...(row.spoiler_folded && !row.spoiler ? { folded: true } : {}),
    parentId: row.parent_id,
    createdAt: row.created_at,
    likes: mine ? others("like").length : 0,
    wants: mine ? others("want").length : 0,
    ...(mine
      ? {
          likers: others("like").map((reaction) => ({
            readerId: reaction.user_id,
            taps: reaction.taps,
            at: reaction.created_at,
          })),
        }
      : {}),
    readingMode: READING_MODES.includes(row.reading_mode as ReadingMode)
      ? (row.reading_mode as ReadingMode)
      : null,
  };
}

/** Builds the town the signed-in person sees from what the database let them read. */
export function townFromRows(
  rows: RemoteRows,
  ids: TownViewer,
  now = Date.now(),
): TownState {
  const { userId } = ids;
  rows = withSampleBookIds(rows);
  const registered = new Set(
    rows.marks
      .filter((row) => row.kind === "library" && row.user_id === userId)
      .map((row) => row.book_id),
  );
  const mine =
    rows.myBooks &&
    new Map(rows.myBooks.map((row) => [row.id, row.copied_from]));
  // The 見本's books are known to everyone, whoever kept them first.
  const books = [
    ...rows.books.map((row) =>
      withTypist(bookFromRow(row, registered.has(row.id)), row, mine),
    ),
    ...structuredClone(demoBooks),
  ];
  const bookIds = new Set(books.map((book) => book.id));
  const readerId = (id: string) => (id === userId ? ME_ID : id);

  // Each reader's rows, gathered once: looked for reader by reader, the
  // whole list was gone through once a reader (AUD-006).
  const nineRows = new Map<string, Tables<"profile_nine">[]>();
  for (const row of rows.nine) {
    if (!bookIds.has(row.book_id)) continue;
    const list = nineRows.get(row.profile_id);
    if (list) list.push(row);
    else nineRows.set(row.profile_id, [row]);
  }
  const nineOf = (profileId: string) => {
    const entries = (nineRows.get(profileId) ?? [])
      .sort((a, b) => a.position - b.position)
      .slice(0, 9);
    return {
      lifeNine: entries.map((row) => row.book_id),
      nineNotes: Object.fromEntries(
        entries.filter((row) => row.note).map((row) => [row.book_id, row.note]),
      ),
    };
  };
  const readerFrom = (row: Tables<"profiles">): Reader => ({
    id: readerId(row.id),
    // Others are never given a profile without one (reading_mode).
    handle: row.handle ?? "",
    name: row.name,
    bio: row.bio,
    color: row.color,
    links: cleanLinks(row.links),
    ...nineOf(row.id),
  });
  const ownProfile =
    userId === null ? null : rows.profiles.find((row) => row.id === userId);
  if (userId !== null && !ownProfile)
    throw new Error("The signed-in person has no profile.");
  const readers = rows.profiles
    .filter((row) => row.id !== userId)
    .map(readerFrom);
  const known = new Set(readers.map((reader) => reader.id));

  // The books in a store scene, a 見本's by its own name: no field for none.
  const sceneOf = (value: unknown) => {
    const ids = Array.isArray(value)
      ? value
          .filter((id): id is string => typeof id === "string")
          .map((id) => sampleBookOfRow(id) ?? id)
          .filter((id) => bookIds.has(id))
      : [];
    return ids.length ? { sceneBookIds: [...new Set(ids)] } : {};
  };
  const shopFrom = (
    row: ShopRow,
    shelves: unknown,
    sceneBooks: unknown,
    followers: number,
  ): Shop => ({
    id: row.owner_id === userId ? OWN_SHOP_ID : row.id,
    ownerId: readerId(row.owner_id),
    name: row.name,
    description: row.description,
    tagline: row.tagline,
    theme: THEMES.includes(row.theme as ShopTheme)
      ? (row.theme as ShopTheme)
      : "sage",
    followers,
    shelves: cleanShelves(shelves, bookIds),
    ...sceneOf(sceneBooks),
    demo: false,
  });
  const ownRow = rows.shops.find((row) => row.owner_id === userId);
  const ownShop = ownRow
    ? {
        ...shopFrom(
          ownRow,
          rows.ownShelves,
          rows.ownSceneBooks,
          rows.ownShopFollowers,
        ),
        ...(rows.ownShopVisitors && rows.ownShopVisitors.count > 0
          ? { weekVisitors: rows.ownShopVisitors }
          : {}),
      }
    : null;
  const shops = rows.shops
    .filter(
      (row) =>
        row.owner_id !== userId && row.is_open && known.has(row.owner_id),
    )
    .map((row) => shopFrom(row, row.public_shelves, row.public_scene_books, 0));
  const shopIds = new Set(shops.map((shop) => shop.id));

  // What a blocked reader did to the person's posts is not shown to them.
  const blockedIds = new Set(rows.blocks.map((row) => row.blocked_id));
  const reactionsShown = rows.postReactions.filter(
    (row) => !blockedIds.has(row.user_id),
  );
  const visible = rows.posts.filter(
    (row) =>
      (row.book_id === null || bookIds.has(row.book_id)) &&
      (row.author_id === userId || known.has(row.author_id)),
  );
  const topLevel = new Set(
    visible.filter((row) => row.parent_id === null).map((row) => row.id),
  );
  const posts: Post[] = visible
    .filter((row) => row.parent_id === null || topLevel.has(row.parent_id))
    .map((row) => postFromRow(row, userId, reactionsShown))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const postIds = new Set(posts.map((post) => post.id));
  const reacted = (kind: "like" | "want") =>
    rows.postReactions
      .filter(
        (row) =>
          row.user_id === userId &&
          row.kind === kind &&
          postIds.has(row.post_id),
      )
      .map((row) => row.post_id);

  const lists = Object.fromEntries(
    MARK_KINDS.map((kind) => [
      MARK_LISTS[kind],
      [
        ...new Set(
          rows.marks
            .filter((row) => row.kind === kind && bookIds.has(row.book_id))
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
            .map((row) => row.book_id),
        ),
      ],
    ]),
  ) as Record<(typeof MARK_LISTS)[MarkKind], string[]>;

  const popReactions: Record<string, PopReaction[]> = {};
  const allShops = [...shops, ...(ownShop ? [ownShop] : [])];
  for (const row of rows.popReactions) {
    if (row.user_id !== userId) continue;
    const placement = parsePlacement(row.placement_key);
    const shopId = row.shop_id === ids.shopId ? OWN_SHOP_ID : row.shop_id;
    const shop = allShops.find((entry) => entry.id === shopId);
    if (
      !placement ||
      !POP_REACTIONS.includes(row.reaction as PopReaction) ||
      !shop?.shelves.some(
        (shelf) =>
          shelf.id === placement[0] &&
          shelf.isPublic &&
          shelf.items.some((item) => item.id === placement[1]),
      )
    )
      continue;
    const key = popReactionKey(shopId, placement[0], placement[1]);
    popReactions[key] = [
      ...new Set([...(popReactions[key] ?? []), row.reaction as PopReaction]),
    ];
  }

  const readingSessions: ReadingSession[] = rows.sessions
    .filter((row) => row.user_id === userId)
    .map((row) => ({
      id: row.id,
      bookId: row.book_id && bookIds.has(row.book_id) ? row.book_id : null,
      mode: row.mode as ReadingMode,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const cards = cardsFromRows(rows, userId, readingSessions);
  const readingNow: ReadingNow[] = rows.sessions
    .filter(
      (row) =>
        row.user_id !== userId &&
        known.has(row.user_id) &&
        row.mode === "together" &&
        row.ended_at === null &&
        row.book_id !== null &&
        bookIds.has(row.book_id),
    )
    .map((row) => ({
      readerId: row.user_id,
      bookId: row.book_id as string,
      minutesAgo: Math.max(
        0,
        Math.floor((now - Date.parse(row.started_at)) / 60_000),
      ),
    }));

  const libraryEntries = entriesFromRows(
    rows.libraryEntries ?? [],
    userId,
    bookIds,
  );
  const libraryShelves = shelvesFromRows(rows.libraryShelves ?? [], userId);
  const town: TownState = {
    books,
    readers,
    shops,
    me: ownProfile
      ? {
          ...readerFrom(ownProfile),
          ...(ownProfile.published === false ? { unpublished: true } : {}),
        }
      : visitorReader(),
    ownShop,
    following: [
      ...new Set(
        rows.follows.map((row) => row.shop_id).filter((id) => shopIds.has(id)),
      ),
    ],
    // A blocked reader's profile stays readable, so the block can be lifted.
    blocked: [
      ...new Set(
        rows.blocks
          .map((row) => row.blocked_id)
          .filter((id) => id !== userId && known.has(id)),
      ),
    ],
    ...lists,
    libraryEntries,
    libraryShelves,
    libraryShelfBooks: shelfBooksFromRows(
      rows.libraryShelfBooks ?? [],
      userId,
      libraryShelves,
      libraryEntries,
    ),
    encounters: encountersFromRows(rows.encounters ?? [], userId, bookIds),
    popReactions,
    posts,
    likedPosts: reacted("like"),
    likeTaps: Object.fromEntries(
      rows.postReactions
        .filter(
          (row) =>
            row.user_id === userId &&
            row.kind === "like" &&
            row.taps > 1 &&
            postIds.has(row.post_id),
        )
        .map((row) => [row.post_id, row.taps]),
    ),
    wantedPosts: reacted("want"),
    spoilerReports: rows.spoilerReports
      .map((row) => row.post_id)
      .filter((id) => postIds.has(id)),
    readingNow,
    readingSessions,
    ...cards,
    readingRecords: rows.records
      .filter(
        (row) =>
          row.kind === "finished" &&
          bookIds.has(row.book_id) &&
          // Others' come only as far as their readers let them (the policy).
          (row.user_id === userId ||
            (shownToOthers(recordAudience(row)) && known.has(row.user_id))),
      )
      .flatMap((row) => recordFromRow(row, userId) ?? [])
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    settings: {
      composeIcon: COMPOSE_ICONS.includes(
        ownProfile?.compose_icon as ComposeIcon,
      )
        ? (ownProfile?.compose_icon as ComposeIcon)
        : "pen",
      visibility: visibilitiesFromRow(rows.readerSettings),
      // A database a migration behind has none: each follows the starting choice.
      shelfAudiences: cleanShelfAudiences(rows.readerSettings?.shelf_audiences),
      spoilerDisplay: SPOILER_DISPLAYS.includes(
        rows.readerSettings?.spoiler_display as SpoilerDisplay,
      )
        ? (rows.readerSettings?.spoiler_display as SpoilerDisplay)
        : "fold_possible",
      memoHint: rows.readerSettings?.memo_hint !== false,
      // No row, or a database a migration behind: the town as ever.
      mode: rows.readerSettings?.mode === "manage" ? "manage" : "normal",
    },
    seenNotifications: rows.seenNotifications.slice(-500),
    shopMessages: rows.shopMessages
      .filter((row) => row.message.trim() && known.has(row.user_id))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .map((row) => ({
        readerId: row.user_id,
        text: row.message,
        at: row.updated_at,
      })),
    // The person's own shop and profile go by their aliases, like everywhere.
    reviewFolds: Object.fromEntries(
      rows.folds.flatMap((row): [string, ReviewFold][] => {
        const kind = row.target_kind as ReviewKind;
        if (
          !REVIEW_KINDS.includes(kind) ||
          (row.state !== "folded" && row.state !== "held")
        )
          return [];
        const id =
          kind === "profile"
            ? readerId(row.target_id)
            : kind === "shop" && row.target_id === ownRow?.id
              ? OWN_SHOP_ID
              : row.target_id;
        return [[reviewKey(kind, id), { state: row.state, since: row.since }]];
      }),
    ),
    myReports: rows.myReports
      .flatMap((row): FiledReport[] => {
        const report = filedReportFrom(row);
        return report ? [report] : [];
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    posters: rows.posters
      .filter((row) => row.author_id === userId || known.has(row.author_id))
      .flatMap((row): Poster[] => {
        const poster = restorePoster(
          {
            id: row.id,
            authorId: readerId(row.author_id),
            template: row.template,
            theme: row.theme,
            font: row.font,
            pages: pagesFromRows(row.pages, (id) => sampleBookOfRow(id) ?? id),
            spoiler: row.spoiler,
            inTimeline: row.show_in_timeline,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
          bookIds,
        );
        // Others' drafts never reach the town, whatever the rows say.
        return poster &&
          (poster.status === "published" || row.author_id === userId)
          ? [poster]
          : [];
      })
      // Newest first, whatever order the rows came in.
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
  // The database keeps the blocked away already; the town does not count on
  // it.
  return withoutReaders(town, town.blocked);
}

/** What a read of posts after the town brought, as the database sent it. */
export interface ArrivedRows {
  posts: Tables<"posts">[];
  /** Writers of those posts the town did not know. */
  profiles: Tables<"profiles">[];
  /** Books of those posts the town did not know. */
  books: BookRow[];
  /** The reader's own reactions to them, and others' to the reader's own. */
  postReactions: Tables<"post_reactions">[];
  /** The reader's own 「ネタバレでは？」 among them. */
  spoilerReports: Pick<Tables<"spoiler_reports">, "post_id">[];
  folds: Pick<
    Tables<"moderation_folds">,
    "target_kind" | "target_id" | "state" | "since"
  >[];
  /** The writers' records of those posts' books, without their words. */
  records?: Tables<"reading_entries">[];
}

/**
 * Posts read after the town (newer, older, or one by its id), in the town's
 * shapes, as townFromRows makes them: the reader's own as "me", a 見本's book
 * by its own name. Their writers come without their nine, which the town
 * reads with it next time. Which of them the town takes is takeIn's
 * (arrived.ts) to decide. A book another reader typed in is told as theirs
 * only when the town tells the reader's own books apart (`ownBooksKnown`: it
 * read my_books), as townFromRows tells them.
 */
export function arrivedFromRows(
  rows: ArrivedRows,
  userId: string | null,
  ownBooksKnown = false,
): Arrived {
  const seen = new Set<string>();
  const posts = rows.posts
    .filter((row) => !seen.has(row.id) && seen.add(row.id))
    .map((row) =>
      row.book_id === null
        ? row
        : { ...row, book_id: sampleBookOfRow(row.book_id) ?? row.book_id },
    );
  const ids = new Set(posts.map((row) => row.id));
  const authors = new Set(posts.map((row) => row.author_id));
  const books = new Set(posts.flatMap((row) => row.book_id ?? []));
  // A reader's rows name their own books: a book typed in that no post of
  // the reader's names is the writer's (own-books.ts).
  const typedByMe = new Set(
    posts.flatMap((row) =>
      row.author_id === userId && row.book_id ? [row.book_id] : [],
    ),
  );
  const own = (kind: "like" | "want") =>
    rows.postReactions.filter(
      (row) =>
        row.user_id === userId && row.kind === kind && ids.has(row.post_id),
    );
  return {
    posts: posts.map((row) => postFromRow(row, userId, rows.postReactions)),
    readers: rows.profiles
      .filter((row) => row.id !== userId && authors.has(row.id))
      .map((row) => ({
        id: row.id,
        handle: row.handle ?? "",
        name: row.name,
        bio: row.bio,
        color: row.color,
        links: cleanLinks(row.links),
        lifeNine: [],
        nineNotes: {},
      })),
    books: rows.books
      .filter((row) => books.has(row.id) && !sampleBookOfRow(row.id))
      .map((row) =>
        ownBooksKnown &&
        userId !== null &&
        row.source === "manual" &&
        !typedByMe.has(row.id)
          ? { ...bookFromRow(row, false), theirs: true as const }
          : bookFromRow(row, false),
      ),
    likedPosts: own("like").map((row) => row.post_id),
    likeTaps: Object.fromEntries(
      own("like")
        .filter((row) => row.taps > 1)
        .map((row) => [row.post_id, row.taps]),
    ),
    wantedPosts: own("want").map((row) => row.post_id),
    spoilerReports: rows.spoilerReports
      .map((row) => row.post_id)
      .filter((id) => ids.has(id)),
    records: (rows.records ?? [])
      .filter(
        (row) =>
          row.kind === "finished" &&
          row.user_id !== userId &&
          shownToOthers(recordAudience(row)),
      )
      .flatMap(
        (row) =>
          recordFromRow(
            { ...row, book_id: sampleBookOfRow(row.book_id) ?? row.book_id },
            userId,
          ) ?? [],
      ),
    reviewFolds: Object.fromEntries(
      rows.folds
        .filter(
          (row) =>
            row.target_kind === "post" &&
            ids.has(row.target_id) &&
            (row.state === "folded" || row.state === "held"),
        )
        .map((row): [string, ReviewFold] => [
          reviewKey("post", row.target_id),
          { state: row.state as ReviewFold["state"], since: row.since },
        ]),
    ),
  };
}

/**
 * A record as the town keeps it: the reader's own as "me", its fields as
 * cleanRecord keeps them. Null for one cleanRecord turns away.
 */
function recordFromRow(
  row: Tables<"reading_entries">,
  userId: string | null,
): ReadingRecord | null {
  const fields = cleanRecord({
    feelings: row.feelings as Feeling[],
    note: row.body,
    spoiler: row.spoiler,
    audience: recordAudience(row),
  });
  return fields
    ? {
        id: row.id,
        readerId: row.user_id === userId ? ME_ID : row.user_id,
        bookId: row.book_id,
        ...fields,
        createdAt: row.created_at,
      }
    : null;
}

/** What a page read after the town (town-more.ts), as the database sent it. */
export interface MoreRows {
  records: Tables<"reading_entries">[];
  nine: Tables<"profile_nine">[];
  /** The books they name that the town may not know. */
  books: BookRow[];
}

/**
 * What a page read, in the town's shapes, as townFromRows makes them: only
 * others' finished records and nines (the reader's own are in the town
 * whole), a 見本's book by its own name. A book typed in is told by the
 * reader's own books (`mine`, from my_books), as townFromRows tells them:
 * one of theirs, or a copy of theirs, may be older than the town's newest
 * and found only now. Undefined tells none apart.
 */
export function moreFromRows(
  rows: MoreRows,
  userId: string | null,
  mine?: ReadonlyMap<string, string | null>,
): TownMore {
  const id = (bookId: string) => sampleBookOfRow(bookId) ?? bookId;
  const nines = new Map<string, Tables<"profile_nine">[]>();
  for (const row of rows.nine) {
    if (row.profile_id === userId) continue;
    const list = nines.get(row.profile_id);
    if (list) list.push(row);
    else nines.set(row.profile_id, [row]);
  }
  return {
    records: rows.records
      .filter(
        (row) =>
          row.kind === "finished" &&
          row.user_id !== userId &&
          shownToOthers(recordAudience(row)),
      )
      .flatMap(
        (row) =>
          recordFromRow({ ...row, book_id: id(row.book_id) }, userId) ?? [],
      ),
    nines: [...nines].map(([readerId, list]) => {
      const entries = list.sort((a, b) => a.position - b.position).slice(0, 9);
      return {
        readerId,
        lifeNine: entries.map((row) => id(row.book_id)),
        nineNotes: Object.fromEntries(
          entries
            .filter((row) => row.note)
            .map((row) => [id(row.book_id), row.note as string]),
        ),
      };
    }),
    books: rows.books
      .filter((row) => !sampleBookOfRow(row.id))
      .map((row) =>
        withTypist(
          bookFromRow(row, false),
          row,
          userId === null ? undefined : mine,
        ),
      ),
  };
}

/**
 * What town_counts answered, in the town's shapes: each book's counts by
 * its id (a 見本's by its own), and the works most shelved and talked of,
 * each by the book the database stood it for. Their books are not taken:
 * the page shows the town's book of each work, as only the town's books
 * open. Nothing of what is not of the answer's shape. `asked` are the
 * books it was asked of, by the town's ids.
 */
export function countsFromAnswer(answer: unknown, asked: string[]): TownMore {
  const id = (bookId: string) => sampleBookOfRow(bookId) ?? bookId;
  const counted = (value: unknown): TownCount | null => {
    const count = value as Partial<Record<keyof TownCount, unknown>> | null;
    const of = (n: unknown) =>
      typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
    const shelves = of(count?.shelves);
    const talk = of(count?.talk);
    const reviews = of(count?.reviews);
    return shelves === null || talk === null || reviews === null
      ? null
      : { shelves, talk, reviews };
  };
  const list = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : [];
  const given = (answer ?? {}) as Record<string, unknown>;
  const books: Record<string, TownCount> = {};
  for (const entry of list(given.counts)) {
    const book = (entry as { book?: unknown }).book;
    const count = counted(entry);
    if (typeof book === "string" && count) books[id(book)] = count;
  }
  const top = (value: unknown): CountedWork[] =>
    list(value).flatMap((entry) => {
      const row = (entry as { book?: Partial<BookRow> }).book;
      const count = counted(entry);
      if (typeof row?.id !== "string" || !count) return [];
      books[id(row.id)] = count;
      return [
        {
          book: id(row.id),
          work: typeof row.work_id === "string" ? row.work_id : null,
        },
      ];
    });
  return {
    ...emptyMore(),
    counts: {
      books,
      asked,
      shelved: top(given.shelved),
      talked: top(given.talked),
    },
  };
}

/** Every id a town refers to a book by, so they can be read in one go. */
export function referencedBookIds(rows: Omit<RemoteRows, "books">): string[] {
  const ids = new Set<string>();
  const shelves = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const shelf of value)
      if (record(shelf) && Array.isArray(shelf.items))
        for (const item of shelf.items)
          if (record(item) && typeof item.bookId === "string")
            ids.add(item.bookId);
  };
  const listed = (value: unknown) => {
    if (Array.isArray(value))
      for (const id of value) if (typeof id === "string") ids.add(id);
  };
  shelves(rows.ownShelves);
  listed(rows.ownSceneBooks);
  rows.shops.forEach((shop) => {
    shelves(shop.public_shelves);
    listed(shop.public_scene_books);
  });
  rows.nine.forEach((row) => ids.add(row.book_id));
  rows.marks.forEach((row) => ids.add(row.book_id));
  rows.libraryEntries?.forEach((row) => ids.add(row.book_id));
  rows.encounters?.forEach((row) => ids.add(row.book_id));
  rows.posts.forEach((row) => row.book_id && ids.add(row.book_id));
  rows.sessions.forEach((row) => row.book_id && ids.add(row.book_id));
  rows.records.forEach((row) => ids.add(row.book_id));
  rows.posters.forEach((row) =>
    pageRowBookIds(row.pages).forEach((id) => ids.add(id)),
  );
  // Shelves may hold a 見本's book by its name; the catalog has only ids.
  return [...ids].filter(isDatabaseId);
}

// Writes ------------------------------------------------------------------------

type Pair = Record<string, string>;

/** What changes of a card the app sends: everything but its id and reader. */
type ReadingCardPatch = Partial<
  Pick<
    Tables<"reading_cards">,
    | "time_zone"
    | "added_later"
    | "paused_at"
    | "paused_seconds"
    | "timer"
    | "timer_minutes"
    | "rest_minutes"
    | "timer_at"
    | "room"
    | "light"
    | "look"
  >
>;
/** What changes of a book of a card the app sends. */
type ReadingCardBookPatch = Partial<
  Pick<
    Tables<"reading_card_books">,
    | "read_seconds"
    | "page_from"
    | "page_to"
    | "page_unit"
    | "format"
    | "finished"
  >
>;
/** What changes of a note the app sends. */
type ReadingNotePatch = Partial<
  Pick<Tables<"reading_notes">, "kind" | "body" | "page">
>;

/** One step of saving. Each one can be run again safely after a failure. */
export type Write =
  // The database gives a book its edition and work; a reader may name neither.
  | {
      kind: "books";
      rows: Omit<TablesInsert<"books">, "work_id" | "edition_id">[];
    }
  // The reader's copies of books others typed in (own-books.ts), made by
  // the database (copy_book) under the ids the town gave them.
  | { kind: "copy-books"; rows: { id: string; copied_from: string }[] }
  // What a reader fixed of books they typed in. The database moves a book
  // whose ISBN changed to that ISBN's edition and work.
  | {
      kind: "fix-books";
      rows: {
        id: string;
        title: string;
        author: string;
        isbn: string | null;
      }[];
    }
  | {
      kind: "profile";
      patch: Partial<
        Pick<
          Tables<"profiles">,
          | "handle"
          | "name"
          | "bio"
          | "links"
          | "color"
          | "compose_icon"
          | "published"
        >
      >;
    }
  | { kind: "nine"; bookIds: string[]; notes: string[] }
  | { kind: "create-shop"; row: TablesInsert<"shops"> }
  // The shop's id goes with what is written to it: a write kept on the
  // device is sent from another page, which may not know the shop yet.
  | {
      kind: "update-shop";
      shopId: string;
      patch: Partial<
        Pick<Tables<"shops">, "name" | "description" | "tagline" | "theme">
      >;
    }
  | { kind: "shelves"; shopId: string; shelves: Shelf[] }
  | { kind: "delete-posts"; ids: string[] }
  | { kind: "posts"; rows: TablesInsert<"posts">[] }
  | { kind: "mark-spoilers"; ids: string[] }
  | { kind: "like-taps"; rows: { post_id: string; taps: number }[] }
  | { kind: "end-sessions"; rows: { id: string; ended_at: string }[] }
  | {
      kind: "session-changes";
      /**
       * A span's book changed a minute or less into it, or one ended read on
       * again (読書にもどる).
       */
      rows: {
        id: string;
        patch: Partial<
          Pick<Tables<"reading_sessions">, "book_id" | "ended_at">
        >;
      }[];
    }
  | { kind: "sessions"; rows: TablesInsert<"reading_sessions">[] }
  | {
      kind: "reading-cards";
      /** Cards new to the database: inserted, one already there kept as it is. */
      add: TablesInsert<"reading_cards">[];
      patches: { id: string; patch: ReadingCardPatch }[];
    }
  | {
      kind: "reading-card-books";
      /** Books of cards new to the database, as cards are. */
      add: TablesInsert<"reading_card_books">[];
      patches: { session_id: string; patch: ReadingCardBookPatch }[];
    }
  | {
      kind: "reading-notes";
      add: TablesInsert<"reading_notes">[];
      patches: { id: string; patch: ReadingNotePatch }[];
      remove: string[];
    }
  | {
      kind: "discard-readings";
      /**
       * Cards not kept (記録しない): the spans of their books first, then the
       * cards, so no span is left looking like a reading from before cards.
       */
      sessions: string[];
      cards: string[];
    }
  | { kind: "delete-records"; ids: string[] }
  | { kind: "records"; rows: TablesInsert<"reading_entries">[] }
  | {
      kind: "update-record";
      id: string;
      patch: Partial<
        Pick<
          Tables<"reading_entries">,
          "body" | "feelings" | "spoiler" | "audience"
        >
      >;
    }
  | {
      kind: "reader-settings";
      row: Pick<TablesInsert<"reader_settings">, "user_id"> &
        Partial<
          Pick<
            TablesInsert<"reader_settings">,
            | "spoiler_display"
            | "shelf_audiences"
            | "memo_hint"
            | "mode"
            | SettingsVisibilityColumn
          >
        >;
    }
  | { kind: "delete-posters"; ids: string[] }
  | { kind: "posters"; rows: TablesInsert<"posters">[] }
  | { kind: "update-poster"; id: string; patch: PosterFields }
  | { kind: "remove"; table: RelationTable; rows: Pair[] }
  | { kind: "add"; table: RelationTable; rows: Pair[] }
  | {
      kind: "library-shelves";
      /** Shelves new to the database: inserted, one already there kept as it is. */
      rows: TablesInsert<"library_shelves">[];
      /** What the reader changed of each shelf already there, and only that. */
      patches: { id: string; patch: LibraryShelfPatch }[];
    }
  | {
      kind: "shelf-books";
      /** Books put on shelves; one already there is kept as it is. */
      add: TablesInsert<"library_shelf_books">[];
      /** Books taken off, by their key. */
      remove: { shelf_id: string; book_id: string }[];
    }
  | {
      kind: "encounters";
      /** Encounters new to the database: inserted, one already there kept as it is. */
      add: TablesInsert<"book_encounters">[];
      /** What changed of one already there: only its memo and its taking back. */
      patches: {
        id: string;
        patch: Pick<
          TablesInsert<"book_encounters">,
          "memo" | "memo_at" | "undone_at"
        >;
      }[];
      /** Encounters deleted: taken back without a memo, or forgotten. */
      remove: string[];
    }
  | {
      kind: "library-entries";
      /** Rows new to the database: inserted, a row already there kept as it is. */
      rows: TablesInsert<"library_entries">[];
      /**
       * What the reader changed of each book's row, and only that, so a
       * device a change behind never puts back what another changed. One of
       * a new row (`made`) is applied only when the row was there already.
       */
      patches: { book_id: string; made: boolean; patch: LibraryPatch }[];
    };

/** The columns of a shelf the reader changes. */
export type LibraryShelfPatch = Partial<
  Pick<
    Tables<"library_shelves">,
    | "name"
    | "note"
    | "position"
    | "show_wanted"
    | "deleted_at"
    | "audience"
    | "rule"
  >
>;

/** The columns of a library row the reader changes. */
export type LibraryPatch = Partial<
  Pick<
    Tables<"library_entries">,
    | "status"
    | "status_at"
    | "wanted_at"
    | "liked_at"
    | "owned"
    | "removed_at"
    | "like_restored"
    | "ever_used"
  >
>;

const libraryColumns = (e: LibraryEntry): Required<LibraryPatch> => ({
  status: e.status,
  status_at: e.statusAt,
  wanted_at: e.wantedAt,
  liked_at: e.likedAt,
  owned: e.owned,
  removed_at: e.removedAt,
  like_restored: e.likeRestored,
  ever_used: e.everUsed,
});

/** The columns that differ between what a row was and what it is. */
function libraryPatch(from: LibraryEntry, to: LibraryEntry): LibraryPatch {
  const was = libraryColumns(from);
  const now = libraryColumns(to);
  return Object.fromEntries(
    (Object.keys(now) as (keyof LibraryPatch)[])
      .filter((key) => was[key] !== now[key])
      .map((key) => [key, now[key]]),
  );
}

type PosterFields = Pick<
  Tables<"posters">,
  "template" | "theme" | "font" | "spoiler" | "show_in_timeline" | "status"
> & { pages: PosterPageRow[] };

const posterFields = (poster: Poster): PosterFields => ({
  template: poster.template,
  theme: poster.theme,
  font: poster.font,
  pages: pagesToRows(poster.pages),
  spoiler: poster.spoiler,
  show_in_timeline: poster.inTimeline,
  status: poster.status,
});

export type RelationTable =
  | "shop_follows"
  | "blocks"
  | "book_marks"
  | "pop_reactions"
  | "post_reactions"
  | "spoiler_reports";

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Rows in one list and not the other, compared by their values. */
function difference(from: Pair[], to: Pair[]) {
  const keys = new Set(to.map((row) => JSON.stringify(row)));
  return from.filter((row) => !keys.has(JSON.stringify(row)));
}

/** The person's own relations, as the rows the database keeps for them. */
function relations(state: TownState, ids: RemoteIds) {
  const user_id = ids.userId;
  const realShop = (id: string) => (id === OWN_SHOP_ID ? ids.shopId : id);
  return {
    shop_follows: state.following.map((shop_id) => ({
      follower_id: user_id,
      shop_id: realShop(shop_id),
    })),
    blocks: state.blocked.map((blocked_id) => ({
      blocker_id: user_id,
      blocked_id,
    })),
    book_marks: MARK_KINDS.flatMap((kind) =>
      state[MARK_LISTS[kind]].map((book_id) => ({ user_id, book_id, kind })),
    ),
    pop_reactions: Object.entries(state.popReactions).flatMap(
      ([key, reactions]) => {
        const [shopId, shelfId, itemId] = JSON.parse(key) as string[];
        return reactions.map((reaction) => ({
          user_id,
          shop_id: realShop(shopId),
          placement_key: placementKey(shelfId, itemId),
          reaction,
        }));
      },
    ),
    post_reactions: [
      ...state.likedPosts.map((post_id) => ({
        user_id,
        post_id,
        kind: "like",
      })),
      ...state.wantedPosts.map((post_id) => ({
        user_id,
        post_id,
        kind: "want",
      })),
    ],
    spoiler_reports: state.spoilerReports.map((post_id) => ({
      reporter_id: user_id,
      post_id,
    })),
  } satisfies Record<RelationTable, Pair[]>;
}

/**
 * What to write so the database holds `next`, given that it already holds
 * `base`. Only the person's own records are ever written; others' posts and
 * shops in the town are left alone.
 */
export function planWrites(
  base: TownState,
  next: TownState,
  ids: RemoteIds,
): Write[] {
  const writes: Write[] = [];
  const user = ids.userId;

  const known = new Set(base.books.map((book) => book.id));
  const added = next.books.filter((book) => !known.has(book.id));
  const copies = added.flatMap((book) =>
    book.copyOf ? [{ id: book.id, copied_from: book.copyOf }] : [],
  );
  const typed = added.filter((book) => !book.copyOf);
  if (typed.length)
    writes.push({
      kind: "books",
      rows: typed.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn ?? null,
        price: book.price ?? null,
        source: "manual",
        created_by: user,
      })),
    });
  // Before any row naming them.
  if (copies.length) writes.push({ kind: "copy-books", rows: copies });
  // A book fixed: its title, author or ISBN (a book held back, answered).
  const booksBefore = new Map(base.books.map((book) => [book.id, book]));
  const fixed = next.books.filter((book) => {
    const was = booksBefore.get(book.id);
    return (
      was !== undefined &&
      isDatabaseId(book.id) &&
      (was.title !== book.title ||
        was.author !== book.author ||
        (was.isbn ?? null) !== (book.isbn ?? null))
    );
  });
  if (fixed.length)
    writes.push({
      kind: "fix-books",
      rows: fixed.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn ?? null,
      })),
    });

  // The library's rows the reader changed. A row new here may be one the
  // database has (another device made it), so what changed is sent as well,
  // against the row this device worked it out from. Written before the marks:
  // a save cut short leaves the rows ahead of the marks, never behind them.
  const rows: TablesInsert<"library_entries">[] = [];
  const patches: Extract<Write, { kind: "library-entries" }>["patches"] = [];
  let worked: Record<string, LibraryEntry> | null = null;
  for (const [book_id, entry] of Object.entries(next.libraryEntries)) {
    const kept = base.libraryEntries[book_id];
    if (kept === entry) continue;
    if (kept) {
      const patch = libraryPatch(kept, entry);
      if (Object.keys(patch).length)
        patches.push({ book_id, made: false, patch });
      continue;
    }
    worked ??= entriesOf(base);
    const from =
      worked[book_id] ?? blankEntry(book_id, entry.source, entry.addedAt);
    rows.push({
      user_id: user,
      book_id,
      source: entry.source,
      batch_id: entry.batchId,
      added_at: entry.addedAt,
      ...libraryColumns(entry),
    });
    const patch = libraryPatch(from, entry);
    if (Object.keys(patch).length) patches.push({ book_id, made: true, patch });
  }
  if (rows.length || patches.length)
    writes.push({ kind: "library-entries", rows, patches });

  // The shelves the reader made, then the books on them: a book goes on a
  // shelf only after its row and its shelf are there.
  const shelfColumns = (shelf: LibraryShelf) => ({
    name: shelf.name,
    note: shelf.note,
    position: shelf.position,
    show_wanted: shelf.showWanted,
    deleted_at: shelf.deletedAt,
    audience: shelf.audience,
    rule: shelf.rule as TablesInsert<"library_shelves">["rule"],
  });
  const baseShelves = new Map(
    base.libraryShelves.map((shelf) => [shelf.id, shelf]),
  );
  const shelfRows: TablesInsert<"library_shelves">[] = [];
  const shelfPatches: { id: string; patch: LibraryShelfPatch }[] = [];
  for (const shelf of next.libraryShelves) {
    const was = baseShelves.get(shelf.id);
    if (was === shelf) continue;
    if (!was) {
      shelfRows.push({
        id: shelf.id,
        user_id: user,
        created_at: shelf.createdAt,
        ...shelfColumns(shelf),
      });
      continue;
    }
    const from = shelfColumns(was);
    const to = shelfColumns(shelf);
    const patch = Object.fromEntries(
      (Object.keys(to) as (keyof typeof to)[])
        .filter((key) => !sameJson(from[key], to[key]))
        .map((key) => [key, to[key]]),
    ) as LibraryShelfPatch;
    if (Object.keys(patch).length) shelfPatches.push({ id: shelf.id, patch });
  }
  // New shelves private and filled by hand leave out who may see them and
  // the rule, both the database's own default, so they are written whether
  // or not the database has those columns yet (the app and the migration
  // reach production apart). One row sending them sends them for all: rows
  // sent together have the same columns.
  if (shelfRows.every((row) => row.audience === "private" && row.rule === null))
    for (const row of shelfRows) {
      delete row.audience;
      delete row.rule;
    }
  if (shelfRows.length || shelfPatches.length)
    writes.push({
      kind: "library-shelves",
      rows: shelfRows,
      patches: shelfPatches,
    });
  const shelfKey = (book: ShelfBook) =>
    JSON.stringify([book.shelfId, book.bookId]);
  // A book whose place on a shelf changed (an undo puts back when it was
  // put on) is taken off and put on again: added_at has no update grant.
  const samePlace = (a: ShelfBook, b: ShelfBook | undefined) =>
    b !== undefined && a.addedAt === b.addedAt && a.position === b.position;
  const baseOn = new Map(
    base.libraryShelfBooks.map((book) => [shelfKey(book), book]),
  );
  const nextOn = new Map(
    next.libraryShelfBooks.map((book) => [shelfKey(book), book]),
  );
  const putOn = next.libraryShelfBooks.filter(
    (book) => !samePlace(book, baseOn.get(shelfKey(book))),
  );
  const takenOff = base.libraryShelfBooks.filter(
    (book) => !samePlace(book, nextOn.get(shelfKey(book))),
  );
  if (putOn.length || takenOff.length)
    writes.push({
      kind: "shelf-books",
      add: putOn.map((book) => ({
        user_id: user,
        shelf_id: book.shelfId,
        book_id: book.bookId,
        added_at: book.addedAt,
        position: book.position,
      })),
      remove: takenOff.map((book) => ({
        shelf_id: book.shelfId,
        book_id: book.bookId,
      })),
    });

  const profile: Extract<Write, { kind: "profile" }>["patch"] = {};
  // A profile made public once (publishProfile) takes its ID and name in the
  // same write: the database keeps an ID exactly on a public profile.
  if (base.me.unpublished && !next.me.unpublished) profile.published = true;
  if (next.me.handle !== base.me.handle) profile.handle = next.me.handle;
  if (next.me.name !== base.me.name) profile.name = next.me.name;
  if (next.me.bio !== base.me.bio) profile.bio = next.me.bio;
  if (next.me.color !== base.me.color) profile.color = next.me.color;
  if (!sameJson(next.me.links ?? [], base.me.links ?? []))
    profile.links = next.me.links ?? [];
  if (next.settings.composeIcon !== base.settings.composeIcon)
    profile.compose_icon = next.settings.composeIcon;
  if (Object.keys(profile).length)
    writes.push({ kind: "profile", patch: profile });
  // The reader's own settings; folds and reports are never written from here.
  // Only the columns changed: an upsert sets every column it sends, and a
  // device a choice behind must not undo one made elsewhere. Sent before the
  // records, so a narrower starting choice (which the database applies to
  // the records kept before) never narrows a record widened after it.
  const settingsRow: Extract<Write, { kind: "reader-settings" }>["row"] = {
    user_id: user,
  };
  if (next.settings.spoilerDisplay !== base.settings.spoilerDisplay)
    settingsRow.spoiler_display = next.settings.spoilerDisplay;
  if (next.settings.memoHint !== base.settings.memoHint)
    settingsRow.memo_hint = next.settings.memoHint;
  if (next.settings.mode !== base.settings.mode)
    settingsRow.mode = next.settings.mode;
  Object.assign(
    settingsRow,
    visibilityChanges(base.settings.visibility, next.settings.visibility),
  );
  if (!sameJson(next.settings.shelfAudiences, base.settings.shelfAudiences))
    settingsRow.shelf_audiences = next.settings
      .shelfAudiences as TablesInsert<"reader_settings">["shelf_audiences"];
  if (Object.keys(settingsRow).length > 1)
    writes.push({ kind: "reader-settings", row: settingsRow });

  if (
    !sameJson(next.me.lifeNine, base.me.lifeNine) ||
    !sameJson(next.me.nineNotes, base.me.nineNotes)
  )
    writes.push({
      kind: "nine",
      bookIds: next.me.lifeNine,
      notes: next.me.lifeNine.map((id) => next.me.nineNotes[id] ?? ""),
    });

  const shop = next.ownShop;
  if (shop && !base.ownShop)
    writes.push(
      {
        kind: "create-shop",
        row: {
          id: ids.shopId,
          owner_id: user,
          name: shop.name,
          description: shop.description,
          tagline: shop.tagline,
          theme: shop.theme,
          // A new shop joins the town right away, as it does in the demo.
          is_open: true,
        },
      },
      { kind: "shelves", shopId: ids.shopId, shelves: shop.shelves },
    );
  else if (shop && base.ownShop) {
    const patch: Extract<Write, { kind: "update-shop" }>["patch"] = {};
    for (const field of ["name", "description", "tagline", "theme"] as const)
      if (shop[field] !== base.ownShop[field]) patch[field] = shop[field];
    if (Object.keys(patch).length)
      writes.push({ kind: "update-shop", shopId: ids.shopId, patch });
    if (!sameJson(shop.shelves, base.ownShop.shelves))
      writes.push({
        kind: "shelves",
        shopId: ids.shopId,
        shelves: shop.shelves,
      });
  }

  const own = (state: TownState) =>
    state.posts.filter((post) => post.authorId === ME_ID);
  const nextPosts = new Set(own(next).map((post) => post.id));
  const basePosts = new Set(own(base).map((post) => post.id));
  const removed = own(base).filter((post) => !nextPosts.has(post.id));
  if (removed.length)
    writes.push({ kind: "delete-posts", ids: removed.map((post) => post.id) });
  const created = own(next)
    .filter((post) => !basePosts.has(post.id))
    // Replies after the posts they answer.
    .sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  if (created.length)
    writes.push({
      kind: "posts",
      rows: created.map((post) => ({
        id: post.id,
        author_id: user,
        body: post.body,
        book_id: post.bookId,
        spoiler: post.spoiler,
        parent_id: post.parentId,
        reading_mode: post.readingMode,
      })),
    });
  const was = new Map(own(base).map((post) => [post.id, post]));
  const marked = own(next).filter((post) => {
    const before = was.get(post.id);
    return before && !before.spoiler && post.spoiler;
  });
  if (marked.length)
    writes.push({
      kind: "mark-spoilers",
      ids: marked.map((post) => post.id),
    });

  writes.push(...discardWrites(base, next));
  const before = new Map(
    base.readingSessions.map((entry) => [entry.id, entry]),
  );
  const ended = next.readingSessions.filter((entry) => {
    const previous = before.get(entry.id);
    return (
      previous && entry.endedAt !== null && previous.endedAt !== entry.endedAt
    );
  });
  // A running session ends before the next one starts: one runs at a time.
  if (ended.length)
    writes.push({
      kind: "end-sessions",
      rows: ended.map((entry) => ({
        id: entry.id,
        ended_at: entry.endedAt as string,
      })),
    });
  // A span's book changed, or one ended read on again: after the ends, so
  // the one read on is the only one running; before any new one begins.
  const sessionChanges = next.readingSessions.flatMap((entry) => {
    const was = before.get(entry.id);
    if (!was || was === entry) return [];
    const patch: Extract<
      Write,
      { kind: "session-changes" }
    >["rows"][number]["patch"] = {};
    if (was.bookId !== entry.bookId) patch.book_id = entry.bookId;
    if (was.endedAt !== null && entry.endedAt === null) patch.ended_at = null;
    return Object.keys(patch).length ? [{ id: entry.id, patch }] : [];
  });
  if (sessionChanges.length)
    writes.push({ kind: "session-changes", rows: sessionChanges });
  const started = next.readingSessions.filter((entry) => !before.has(entry.id));
  if (started.length)
    writes.push({
      kind: "sessions",
      rows: started.map((entry) => ({
        id: entry.id,
        user_id: user,
        book_id: entry.bookId,
        mode: entry.mode,
        started_at: entry.startedAt,
        ended_at: entry.endedAt,
      })),
    });
  writes.push(...cardWrites(base, next, user));

  const mine = (state: TownState) =>
    new Map(
      state.readingRecords
        .filter((record) => record.readerId === ME_ID)
        .map((record) => [record.id, record]),
    );
  const baseRecords = mine(base);
  const nextRecords = mine(next);
  const droppedRecords = [...baseRecords.keys()].filter(
    (id) => !nextRecords.has(id),
  );
  if (droppedRecords.length)
    writes.push({ kind: "delete-records", ids: droppedRecords });
  // The new app sends audience and never is_public, which the database
  // keeps equal to it for apps from before.
  const fields = (record: ReadingRecord) => ({
    body: record.note,
    feelings: record.feelings,
    spoiler: record.spoiler,
    audience: record.audience,
  });
  const newRecords = [...nextRecords.values()].filter(
    (record) => !baseRecords.has(record.id),
  );
  if (newRecords.length)
    writes.push({
      kind: "records",
      rows: newRecords.map((record) => ({
        id: record.id,
        user_id: user,
        book_id: record.bookId,
        kind: "finished",
        ...fields(record),
      })),
    });
  // Only the fields changed, so a device a change behind never puts back a
  // record's audience narrowed elsewhere.
  for (const record of nextRecords.values()) {
    const before = baseRecords.get(record.id);
    if (!before) continue;
    const was = fields(before);
    const now = fields(record);
    const patch = Object.fromEntries(
      (Object.keys(now) as (keyof typeof now)[])
        .filter((key) => !sameJson(was[key], now[key]))
        .map((key) => [key, now[key]]),
    );
    if (Object.keys(patch).length)
      writes.push({ kind: "update-record", id: record.id, patch });
  }

  const ownPosters = (state: TownState) =>
    new Map(
      state.posters
        .filter((poster) => poster.authorId === ME_ID)
        .map((poster) => [poster.id, poster]),
    );
  const basePosters = ownPosters(base);
  const nextPosters = ownPosters(next);
  const takenDown = [...basePosters.keys()].filter(
    (id) => !nextPosters.has(id),
  );
  if (takenDown.length) writes.push({ kind: "delete-posters", ids: takenDown });
  const madePosters = [...nextPosters.values()].filter(
    (poster) => !basePosters.has(poster.id),
  );
  if (madePosters.length)
    writes.push({
      kind: "posters",
      rows: madePosters.map((poster) => ({
        id: poster.id,
        author_id: user,
        ...posterFields(poster),
      })),
    });
  for (const poster of nextPosters.values()) {
    const before = basePosters.get(poster.id);
    if (before && !sameJson(posterFields(before), posterFields(poster)))
      writes.push({
        kind: "update-poster",
        id: poster.id,
        patch: posterFields(poster),
      });
  }

  const from = relations(base, ids);
  const to = relations(next, ids);
  for (const table of Object.keys(to) as RelationTable[]) {
    const gone = difference(from[table], to[table]);
    if (gone.length) writes.push({ kind: "remove", table, rows: gone });
  }
  for (const table of Object.keys(to) as RelationTable[]) {
    const fresh = difference(to[table], from[table]);
    if (fresh.length) writes.push({ kind: "add", table, rows: fresh });
  }
  // Pressing a like again changes its count, once its row is there. A new
  // row already starts at one press.
  const pressed = next.likedPosts
    .map((post_id) => ({ post_id, taps: tapsOf(next, post_id) }))
    .filter((row) => {
      const was = tapsOf(base, row.post_id);
      return row.taps !== was && !(was === 0 && row.taps === 1);
    });
  if (pressed.length) writes.push({ kind: "like-taps", rows: pressed });

  // Last: an encounter names its book, and the post or the shop met, which
  // the writes above put there first.
  const baseMet = new Map(base.encounters.map((c) => [c.id, c]));
  const nextMet = new Map(next.encounters.map((c) => [c.id, c]));
  const met = next.encounters.filter((c) => !baseMet.has(c.id));
  const changed = next.encounters.flatMap((c) => {
    const was = baseMet.get(c.id);
    if (!was || was === c) return [];
    const patch: Extract<
      Write,
      { kind: "encounters" }
    >["patches"][number]["patch"] = {};
    if (was.memo !== c.memo) patch.memo = c.memo;
    if (was.memoAt !== c.memoAt) patch.memo_at = c.memoAt;
    if (was.undoneAt !== c.undoneAt) patch.undone_at = c.undoneAt;
    return Object.keys(patch).length ? [{ id: c.id, patch }] : [];
  });
  const forgotten = base.encounters
    .filter((c) => !nextMet.has(c.id))
    .map((c) => c.id);
  if (met.length || changed.length || forgotten.length)
    writes.push({
      kind: "encounters",
      add: met.map((c) => ({
        id: c.id,
        user_id: user,
        book_id: c.bookId,
        kind: c.kind,
        via: c.via,
        post_id: c.postId,
        shop_id: c.shopId,
        placement_key: c.placementKey,
        // The database puts whose it was in from the post or the shop.
        other_reader_id: null,
        memo: c.memo,
        memo_at: c.memoAt,
        undone_at: c.undoneAt,
        created_at: c.createdAt,
      })),
      patches: changed,
      remove: forgotten,
    });

  return withSampleRows(writes);
}
/**
 * What changed of the reader's cards, after their spans (docs/機能/読書記録.md
 * 「アプリが書くときの決まり」): cards, then their books, then notes, every
 * row new to the database sent whole. A card not kept goes before
 * (discardWrites), its notes with it.
 */
function cardWrites(base: TownState, next: TownState, user: string): Write[] {
  const writes: Write[] = [];

  const baseCards = byId(base.readingCards);
  const cards = next.readingCards.filter((card) => !baseCards.has(card.id));
  const cardPatches = columnChanges(
    baseCards,
    next.readingCards,
    (card) => card.id,
    CARD_COLUMNS,
  );
  if (cards.length || cardPatches.length)
    writes.push({
      kind: "reading-cards",
      add: cards.map((card) => ({
        id: card.id,
        user_id: user,
        ...columnsOf(CARD_COLUMNS, card),
        created_at: card.createdAt,
      })),
      patches: cardPatches.map(({ key, patch }) => ({ id: key, patch })),
    });

  const baseBooks = new Map(
    base.readingCardBooks.map((book) => [book.sessionId, book]),
  );
  const books = next.readingCardBooks.filter(
    (book) => !baseBooks.has(book.sessionId),
  );
  const bookPatches = columnChanges(
    baseBooks,
    next.readingCardBooks,
    (book) => book.sessionId,
    BOOK_COLUMNS,
  );
  if (books.length || bookPatches.length)
    writes.push({
      kind: "reading-card-books",
      add: books.map((book) => ({
        user_id: user,
        session_id: book.sessionId,
        card_id: book.cardId,
        ...columnsOf(BOOK_COLUMNS, book),
        created_at: book.createdAt,
      })),
      patches: bookPatches.map(({ key, patch }) => ({
        session_id: key,
        patch,
      })),
    });

  const nextCards = byId(next.readingCards);
  const baseNotes = byId(base.readingNotes);
  const nextNotes = byId(next.readingNotes);
  const notes = next.readingNotes.filter((note) => !baseNotes.has(note.id));
  const notePatches = columnChanges(
    baseNotes,
    next.readingNotes,
    (note) => note.id,
    NOTE_COLUMNS,
  );
  // A note of a card not kept goes with the card.
  const erased = base.readingNotes
    .filter((note) => !nextNotes.has(note.id) && nextCards.has(note.cardId))
    .map((note) => note.id);
  if (notes.length || notePatches.length || erased.length)
    writes.push({
      kind: "reading-notes",
      add: notes.map((note) => ({
        id: note.id,
        user_id: user,
        card_id: note.cardId,
        session_id: note.sessionId,
        ...columnsOf(NOTE_COLUMNS, note),
        created_at: note.createdAt,
      })),
      patches: notePatches.map(({ key, patch }) => ({ id: key, patch })),
      remove: erased,
    });

  return writes;
}

const byId = <T extends { id: string }>(rows: T[]) =>
  new Map(rows.map((row) => [row.id, row]));

/** Columns the app changes of a row, each with how it keeps it. */
type Columns<T, P> = [keyof P, (row: T) => unknown][];

/** The row's columns, as the database keeps them. */
const columnsOf = <T, P>(columns: Columns<T, P>, row: T) =>
  Object.fromEntries(
    columns.map(([column, value]) => [column, value(row)]),
  ) as Required<P>;

/** The rows of `now` changed since `was`, each with its columns that changed. */
const columnChanges = <T, P>(
  was: Map<string, T>,
  now: T[],
  key: (row: T) => string,
  columns: Columns<T, P>,
) =>
  now.flatMap((row) => {
    const before = was.get(key(row));
    if (!before || before === row) return [];
    const patch = Object.fromEntries(
      columns.flatMap(([column, value]) =>
        value(before) === value(row) ? [] : [[column, value(row)]],
      ),
    ) as Partial<P>;
    return Object.keys(patch).length ? [{ key: key(row), patch }] : [];
  });

/**
 * The cards not kept (記録しない), their spans before them: first of the
 * reading's writes, so a reading begun after it is not refused for one
 * still running. Only a span of a card not kept is ever deleted.
 */
function discardWrites(base: TownState, next: TownState): Write[] {
  const kept = new Set(next.readingCards.map((card) => card.id));
  const cards = base.readingCards
    .filter((card) => !kept.has(card.id))
    .map((card) => card.id);
  if (!cards.length) return [];
  const gone = new Set(cards);
  const sessions = new Set(next.readingSessions.map((session) => session.id));
  return [
    {
      kind: "discard-readings",
      sessions: base.readingCardBooks
        .filter(
          (book) => gone.has(book.cardId) && !sessions.has(book.sessionId),
        )
        .map((book) => book.sessionId),
      cards,
    },
  ];
}

const CARD_COLUMNS: Columns<ReadingCard, ReadingCardPatch> = [
  ["time_zone", (card) => card.timeZone],
  ["added_later", (card) => card.addedLater],
  ["paused_at", (card) => card.pausedAt],
  ["paused_seconds", (card) => card.pausedSeconds],
  ["timer", (card) => card.timer],
  ["timer_minutes", (card) => card.timerMinutes],
  ["rest_minutes", (card) => card.restMinutes],
  ["timer_at", (card) => card.timerAt],
  ["room", (card) => card.room],
  ["light", (card) => card.light],
  ["look", (card) => card.look],
];
const BOOK_COLUMNS: Columns<ReadingCardBook, ReadingCardBookPatch> = [
  ["read_seconds", (book) => book.readSeconds],
  ["page_from", (book) => book.pageFrom],
  ["page_to", (book) => book.pageTo],
  ["page_unit", (book) => book.pageUnit],
  ["format", (book) => book.format],
  ["finished", (book) => book.finished],
];
const NOTE_COLUMNS: Columns<ReadingNote, ReadingNotePatch> = [
  ["kind", (note) => note.kind],
  ["body", (note) => note.body],
  ["page", (note) => note.page],
];

/**
 * The 見本 in what is written. Their books are named by their database ids,
 * rows the database keeps for everyone and nobody's (AUD-078), so none is
 * ever written; nobody stands behind their shops and posts, so nothing
 * addressed to those is written at all.
 */
function withSampleRows(writes: Write[]): Write[] {
  const keep = (bookId: string) =>
    isSampleBook(bookId) ? sampleBookRowId(bookId) : bookId;
  const named = <T extends { book_id?: string | null }>(row: T): T =>
    row.book_id ? { ...row, book_id: keep(row.book_id) } : row;
  const real = (row: Pair) =>
    (row.shop_id === undefined || isDatabaseId(row.shop_id)) &&
    (row.post_id === undefined || isDatabaseId(row.post_id)) &&
    (row.blocked_id === undefined || isDatabaseId(row.blocked_id));
  const mapped = writes.flatMap((write): Write[] => {
    switch (write.kind) {
      case "nine":
        return [{ ...write, bookIds: write.bookIds.map(keep) }];
      case "posts": {
        const rows = write.rows
          .filter((row) => !row.parent_id || isDatabaseId(row.parent_id))
          .map(named);
        return rows.length ? [{ ...write, rows }] : [];
      }
      case "sessions":
        return [{ ...write, rows: write.rows.map(named) }];
      case "session-changes":
        return [
          {
            ...write,
            rows: write.rows.map((row) => ({
              ...row,
              patch: named(row.patch),
            })),
          },
        ];
      case "records":
        return [{ ...write, rows: write.rows.map(named) }];
      case "posters":
        return [
          {
            ...write,
            rows: write.rows.map((row) => ({
              ...row,
              pages: withPageRowBooks(row.pages as PosterPageRow[], keep),
            })),
          },
        ];
      case "update-poster":
        return [
          {
            ...write,
            patch: {
              ...write.patch,
              pages: withPageRowBooks(write.patch.pages, keep),
            },
          },
        ];
      case "library-entries":
        return [
          {
            ...write,
            rows: write.rows.map((row) => ({
              ...row,
              book_id: keep(row.book_id),
            })),
            patches: write.patches.map((row) => ({
              ...row,
              book_id: keep(row.book_id),
            })),
          },
        ];
      case "encounters":
        // One met on a 見本's post or shop (a visitor's, carried over) has
        // nobody's post or shop to point to, so it stays on the device.
        return [
          {
            ...write,
            add: write.add
              .filter(
                (row) =>
                  (!row.post_id || isDatabaseId(row.post_id)) &&
                  (!row.shop_id || isDatabaseId(row.shop_id)),
              )
              .map((row) => ({
                ...row,
                book_id: keep(row.book_id),
              })),
          },
        ];
      case "shelf-books":
        return [
          {
            ...write,
            add: write.add.map((row) => ({
              ...row,
              book_id: keep(row.book_id),
            })),
            remove: write.remove.map((row) => ({
              ...row,
              book_id: keep(row.book_id),
            })),
          },
        ];
      case "add":
      case "remove": {
        const rows = write.rows
          .filter(real)
          .map((row) =>
            row.book_id === undefined
              ? row
              : { ...row, book_id: keep(row.book_id) },
          );
        return rows.length ? [{ ...write, rows }] : [];
      }
      default:
        return [write];
    }
  });
  return mapped;
}

/** Every kind of write, to tell one kept on the device (outbox.ts). */
const WRITE_KINDS: Record<Write["kind"], true> = {
  books: true,
  "copy-books": true,
  "fix-books": true,
  profile: true,
  nine: true,
  "create-shop": true,
  "update-shop": true,
  shelves: true,
  "delete-posts": true,
  posts: true,
  "mark-spoilers": true,
  "like-taps": true,
  "end-sessions": true,
  "session-changes": true,
  sessions: true,
  "reading-cards": true,
  "reading-card-books": true,
  "reading-notes": true,
  "discard-readings": true,
  "delete-records": true,
  records: true,
  "update-record": true,
  "reader-settings": true,
  "delete-posters": true,
  posters: true,
  "update-poster": true,
  remove: true,
  add: true,
  "library-shelves": true,
  "shelf-books": true,
  "library-entries": true,
  encounters: true,
};

/**
 * Whether `value` is a write as this app keeps one: read back from the
 * device, a write of another shape (an older app's) is let go.
 */
export const isWrite = (value: unknown): value is Write =>
  record(value) &&
  typeof value.kind === "string" &&
  Object.hasOwn(WRITE_KINDS, value.kind);

/**
 * A write of several rows as one write a row, in the order they go, so one
 * row the database turns away leaves the others to go (sync.ts). A book's
 * library row goes with what is changed of it, a shelf with its changes.
 * None for a write of one thing.
 */
export function splitWrite(write: Write): Write[] {
  switch (write.kind) {
    case "books":
    case "copy-books":
    case "fix-books":
    case "posts":
    case "like-taps":
    case "end-sessions":
    case "session-changes":
    case "sessions":
    case "records":
    case "posters":
      return write.rows.map((row) => ({ ...write, rows: [row] }) as Write);
    case "reading-cards":
    case "reading-card-books":
      return [
        ...write.add.map((row) => ({ ...write, add: [row], patches: [] })),
        ...write.patches.map((row) => ({ ...write, add: [], patches: [row] })),
      ] as Write[];
    case "reading-notes":
      // As applyWrite sends them: the erased first.
      return [
        ...write.remove.map((id) => ({
          ...write,
          add: [],
          patches: [],
          remove: [id],
        })),
        ...write.add.map((row) => ({
          ...write,
          add: [row],
          patches: [],
          remove: [],
        })),
        ...write.patches.map((row) => ({
          ...write,
          add: [],
          patches: [row],
          remove: [],
        })),
      ];
    case "remove":
    case "add":
      return write.rows.map((row) => ({ ...write, rows: [row] }));
    case "delete-posts":
    case "mark-spoilers":
    case "delete-records":
    case "delete-posters":
      return write.ids.map((id) => ({ ...write, ids: [id] }));
    case "library-entries": {
      const books = [
        ...new Set([
          ...write.rows.map((row) => row.book_id),
          ...write.patches.map((row) => row.book_id),
        ]),
      ];
      return books.map((book) => ({
        ...write,
        rows: write.rows.filter((row) => row.book_id === book),
        patches: write.patches.filter((row) => row.book_id === book),
      }));
    }
    case "library-shelves": {
      const shelves = [
        ...new Set([
          ...write.rows.map((row) => row.id as string),
          ...write.patches.map((row) => row.id),
        ]),
      ];
      return shelves.map((shelf) => ({
        ...write,
        rows: write.rows.filter((row) => row.id === shelf),
        patches: write.patches.filter((row) => row.id === shelf),
      }));
    }
    case "shelf-books":
      return [
        ...write.remove.map((row) => ({ ...write, add: [], remove: [row] })),
        ...write.add.map((row) => ({ ...write, add: [row], remove: [] })),
      ];
    case "encounters":
      return [
        ...write.remove.map((id) => ({
          ...write,
          add: [],
          patches: [],
          remove: [id],
        })),
        ...write.add.map((row) => ({
          ...write,
          add: [row],
          patches: [],
          remove: [],
        })),
        ...write.patches.map((row) => ({
          ...write,
          add: [],
          patches: [row],
          remove: [],
        })),
      ];
    default:
      return [];
  }
}

/**
 * For a write that sets a whole thing (the shop's shelves, the nine, a
 * poster's pages), which thing and what of it `state` holds, in the form
 * the database hands it back: a change kept on the device is then sent only
 * over the version it began from (sync.ts). Undefined for any other write.
 */
export function writeStake(
  state: TownState,
  write: Write,
): { key: string; value: unknown } | undefined {
  switch (write.kind) {
    case "shelves":
      return {
        key: "shelves",
        value: (state.ownShop?.shelves ?? []).map((shelf) => ({
          id: shelf.id,
          name: shelf.name,
          capacity: shelf.capacity,
          isPublic: shelf.isPublic,
          board: shelf.board,
          items: shelf.items.map((item) => ({
            id: item.id,
            bookId: item.bookId,
            display: item.display,
            pop: item.pop,
          })),
        })),
      };
    case "nine":
      return {
        key: "nine",
        value: state.me.lifeNine.map((id) => [
          id,
          state.me.nineNotes[id] ?? "",
        ]),
      };
    case "update-poster": {
      const poster = state.posters.find(
        (entry) => entry.id === write.id && entry.authorId === ME_ID,
      );
      return {
        key: "poster:" + write.id,
        value: poster ? posterFields(poster) : null,
      };
    }
    // A poster made may be there already (its answer lost) and changed
    // since on another device: made again only where it is not.
    case "posters": {
      const ids = write.rows.map((row) => row.id ?? "").sort();
      return {
        key: "posters:" + ids.join(","),
        value: ids.map((id) => {
          const poster = state.posters.find(
            (entry) => entry.id === id && entry.authorId === ME_ID,
          );
          return poster ? posterFields(poster) : null;
        }),
      };
    }
    default:
      return undefined;
  }
}

/** The words a 便り or a record carries in a write, in the screens' ids. */
export interface WrittenWords {
  posts: {
    body: string;
    bookId: string | null;
    spoiler: boolean;
    parentId: string | null;
  }[];
  /** A new record (by its book), or one changed (by its id). */
  records: (({ bookId: string } | { recordId: string }) &
    Partial<
      Pick<
        Tables<"reading_entries">,
        "body" | "feelings" | "spoiler" | "audience"
      >
    >)[];
}

/**
 * What the reader wrote that `write` carries: the words of 便り and records,
 * with a 見本's book named by its own id as the screens name it, not by its
 * row's (withSampleRows). Nothing for any other write.
 */
export function writtenWords(write: Write): WrittenWords {
  const book = (id: string | null | undefined) =>
    id ? (sampleBookOfRow(id) ?? id) : null;
  switch (write.kind) {
    case "posts":
      return {
        posts: write.rows.map((row) => ({
          body: row.body,
          bookId: book(row.book_id),
          spoiler: row.spoiler ?? false,
          parentId: row.parent_id ?? null,
        })),
        records: [],
      };
    case "records":
      return {
        posts: [],
        records: write.rows.flatMap((row) => {
          const bookId = book(row.book_id);
          return bookId
            ? [
                {
                  bookId,
                  body: row.body,
                  feelings: row.feelings,
                  spoiler: row.spoiler,
                  audience: row.audience,
                },
              ]
            : [];
        }),
      };
    case "update-record":
      return { posts: [], records: [{ recordId: write.id, ...write.patch }] };
    default:
      return { posts: [], records: [] };
  }
}

/** Stands in for "me" while nobody is signed in. */
export const visitorReader = (): Reader => emptyTown({ name: "ゲスト" }).me;

/** The town while a signed-in person's data is on its way: nothing yet. */
export function emptyTown(me: Partial<Reader> = {}): TownState {
  return {
    books: [],
    readers: [],
    shops: [],
    me: {
      id: ME_ID,
      handle: "",
      name: "",
      bio: "",
      color: "#768281",
      lifeNine: [],
      nineNotes: {},
      links: [],
      ...me,
    },
    ownShop: null,
    following: [],
    blocked: [],
    wishlist: [],
    favorites: [],
    popReactions: {},
    posts: [],
    likedPosts: [],
    likeTaps: {},
    wantedPosts: [],
    spoilerReports: [],
    readingNow: [],
    readingSessions: [],
    readingCards: [],
    readingCardBooks: [],
    readingNotes: [],
    finishedBooks: [],
    library: [],
    libraryEntries: {},
    libraryShelves: [],
    libraryShelfBooks: [],
    encounters: [],
    readingRecords: [],
    settings: {
      composeIcon: "pen",
      visibility: cleanVisibilities(null),
      shelfAudiences: {},
      spoilerDisplay: "fold_possible",
      memoHint: true,
      mode: "normal",
    },
    seenNotifications: [],
    shopMessages: [],
    reviewFolds: {},
    myReports: [],
    posters: [],
  };
}

export { REGISTERED_GENRE };
