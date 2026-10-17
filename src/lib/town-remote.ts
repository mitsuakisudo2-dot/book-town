import { createRegisteredBook, REGISTERED_GENRE } from "./books";
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
  validateEntry,
  validateShelf,
  type LibraryEntry,
  type LibraryShelf,
  type ShelfBook,
} from "./library";
import { entriesOf } from "./library-town";
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
} from "./types";
import type { Tables, TablesInsert } from "./supabase/database.types";
import { demoBooks } from "./data";
import { isDatabaseId } from "./record-kind";
import { withoutReaders } from "./blocks";
import { isSampleBook, sampleBookOfRow, sampleBookRowId } from "./samples";
import { filedReportFrom } from "./supabase/reports";
import type { Arrived } from "./arrived";
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
  /** Readers who stopped by the person's own shop in the 7 days before `at`. */
  ownShopVisitors: { count: number; at: string } | null;
  follows: Pick<Tables<"shop_follows">, "shop_id">[];
  /** Whom the person blocked (only the blocker reads their blocks). */
  blocks: Pick<Tables<"blocks">, "blocked_id">[];
  marks: Tables<"book_marks">[];
  /** The person's own library rows; none in a visitor's town. */
  libraryEntries?: Tables<"library_entries">[];
  /** The shelves the person made in their library, and their books; none in a visitor's town. */
  libraryShelves?: Tables<"library_shelves">[];
  libraryShelfBooks?: Tables<"library_shelf_books">[];
  posts: Tables<"posts">[];
  /** The person's own reactions, and other people's reactions to their posts. */
  postReactions: Tables<"post_reactions">[];
  spoilerReports: Pick<Tables<"spoiler_reports">, "post_id">[];
  popReactions: Tables<"pop_reactions">[];
  /** The person's own reading, and others' reading together right now. */
  sessions: Tables<"reading_sessions">[];
  /** The person's own reading records, and others' public ones. */
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
        summary: "読書家が登録した本です。あらすじは登録されていません。",
      };
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
      !text(candidate.name, 120) ||
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
        !text(item.pop, 10000)
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
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    };
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
  // The 見本's books are known to everyone, whoever kept them first.
  const books = [
    ...rows.books.map((row) => bookFromRow(row, registered.has(row.id))),
    ...structuredClone(demoBooks),
  ];
  const bookIds = new Set(books.map((book) => book.id));
  const readerId = (id: string) => (id === userId ? ME_ID : id);

  const nineOf = (profileId: string) => {
    const entries = rows.nine
      .filter((row) => row.profile_id === profileId && bookIds.has(row.book_id))
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
    handle: row.handle,
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
    me: ownProfile ? readerFrom(ownProfile) : visitorReader(),
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
    readingRecords: rows.records
      .filter(
        (row) =>
          row.kind === "finished" &&
          bookIds.has(row.book_id) &&
          // Others' come only as far as their readers let them (the policy).
          (row.user_id === userId ||
            (shownToOthers(recordAudience(row)) && known.has(row.user_id))),
      )
      .flatMap((row): ReadingRecord[] => {
        const fields = cleanRecord({
          feelings: row.feelings as Feeling[],
          note: row.body,
          spoiler: row.spoiler,
          audience: recordAudience(row),
        });
        return fields
          ? [
              {
                id: row.id,
                readerId: readerId(row.user_id),
                bookId: row.book_id,
                ...fields,
                createdAt: row.created_at,
              },
            ]
          : [];
      })
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    settings: {
      composeIcon: COMPOSE_ICONS.includes(
        ownProfile?.compose_icon as ComposeIcon,
      )
        ? (ownProfile?.compose_icon as ComposeIcon)
        : "pen",
      visibility: visibilitiesFromRow(rows.readerSettings),
      spoilerDisplay: SPOILER_DISPLAYS.includes(
        rows.readerSettings?.spoiler_display as SpoilerDisplay,
      )
        ? (rows.readerSettings?.spoiler_display as SpoilerDisplay)
        : "fold_possible",
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
}

/**
 * Posts read after the town (newer, older, or one by its id), in the town's
 * shapes, as townFromRows makes them: the reader's own as "me", a 見本's book
 * by its own name. Their writers come without their nine, which the town
 * reads with it next time. Which of them the town takes is takeIn's
 * (arrived.ts) to decide.
 */
export function arrivedFromRows(
  rows: ArrivedRows,
  userId: string | null,
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
        handle: row.handle,
        name: row.name,
        bio: row.bio,
        color: row.color,
        links: cleanLinks(row.links),
        lifeNine: [],
        nineNotes: {},
      })),
    books: rows.books
      .filter((row) => books.has(row.id) && !sampleBookOfRow(row.id))
      .map((row) => bookFromRow(row, false)),
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

/** One step of saving. Each one can be run again safely after a failure. */
export type Write =
  // The database gives a book its edition and work; a reader may name neither.
  | {
      kind: "books";
      rows: Omit<TablesInsert<"books">, "work_id" | "edition_id">[];
    }
  | {
      kind: "profile";
      patch: Partial<
        Pick<
          Tables<"profiles">,
          "handle" | "name" | "bio" | "links" | "color" | "compose_icon"
        >
      >;
    }
  | { kind: "nine"; bookIds: string[]; notes: string[] }
  | { kind: "create-shop"; row: TablesInsert<"shops"> }
  | {
      kind: "update-shop";
      patch: Partial<
        Pick<Tables<"shops">, "name" | "description" | "tagline" | "theme">
      >;
    }
  | { kind: "shelves"; shelves: Shelf[] }
  | { kind: "delete-posts"; ids: string[] }
  | { kind: "posts"; rows: TablesInsert<"posts">[] }
  | { kind: "mark-spoilers"; ids: string[] }
  | { kind: "like-taps"; rows: { post_id: string; taps: number }[] }
  | { kind: "end-sessions"; rows: { id: string; ended_at: string }[] }
  | { kind: "sessions"; rows: TablesInsert<"reading_sessions">[] }
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
            "spoiler_display" | SettingsVisibilityColumn
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
    "name" | "note" | "position" | "show_wanted" | "deleted_at"
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
  if (added.length)
    writes.push({
      kind: "books",
      rows: added.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn ?? null,
        price: book.price ?? null,
        source: "manual",
        created_by: user,
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
        .filter((key) => from[key] !== to[key])
        .map((key) => [key, to[key]]),
    ) as LibraryShelfPatch;
    if (Object.keys(patch).length) shelfPatches.push({ id: shelf.id, patch });
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
  Object.assign(
    settingsRow,
    visibilityChanges(base.settings.visibility, next.settings.visibility),
  );
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
      { kind: "shelves", shelves: shop.shelves },
    );
  else if (shop && base.ownShop) {
    const patch: Extract<Write, { kind: "update-shop" }>["patch"] = {};
    for (const field of ["name", "description", "tagline", "theme"] as const)
      if (shop[field] !== base.ownShop[field]) patch[field] = shop[field];
    if (Object.keys(patch).length) writes.push({ kind: "update-shop", patch });
    if (!sameJson(shop.shelves, base.ownShop.shelves))
      writes.push({ kind: "shelves", shelves: shop.shelves });
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

  return withSampleRows(writes, user);
}
/**
 * The 見本 in what is written. Their books are written under their database
 * ids, each catalog row first; nobody stands behind their shops and posts, so
 * nothing addressed to those is written at all.
 */
function withSampleRows(writes: Write[], user: string): Write[] {
  const kept = new Set<string>();
  const keep = (bookId: string) => {
    if (!isSampleBook(bookId)) return bookId;
    kept.add(bookId);
    return sampleBookRowId(bookId);
  };
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
              book_id: isSampleBook(row.book_id)
                ? sampleBookRowId(row.book_id)
                : row.book_id,
            })),
          },
        ];
      case "add":
      case "remove": {
        const rows = write.rows.filter(real).map((row) =>
          row.book_id === undefined
            ? row
            : {
                ...row,
                book_id:
                  write.kind === "add"
                    ? keep(row.book_id)
                    : isSampleBook(row.book_id)
                      ? sampleBookRowId(row.book_id)
                      : row.book_id,
              },
        );
        return rows.length ? [{ ...write, rows }] : [];
      }
      default:
        return [write];
    }
  });
  if (!kept.size) return mapped;
  const catalog: Write = {
    kind: "books",
    rows: demoBooks
      .filter((book) => kept.has(book.id))
      .map((book) => ({
        id: sampleBookRowId(book.id),
        title: book.title,
        author: book.author,
        source: "manual",
        created_by: user,
      })),
  };
  return [catalog, ...mapped];
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
    finishedBooks: [],
    library: [],
    libraryEntries: {},
    libraryShelves: [],
    libraryShelfBooks: [],
    readingRecords: [],
    settings: {
      composeIcon: "pen",
      visibility: cleanVisibilities(null),
      spoilerDisplay: "fold_possible",
    },
    seenNotifications: [],
    shopMessages: [],
    reviewFolds: {},
    myReports: [],
    posters: [],
  };
}

export { REGISTERED_GENRE };
