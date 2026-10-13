import { createRegisteredBook, REGISTERED_GENRE } from "./books";
import { cleanLinks } from "./links";
import { cleanRecord } from "./records";
import {
  COMPOSE_ICONS,
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
  type TownState,
} from "./types";
import type { Tables, TablesInsert } from "./supabase/database.types";

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

/** Who typed a book in is not readable, so a book row comes without it. */
export type BookRow = Omit<Tables<"books">, "created_by">;

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
  marks: Tables<"book_marks">[];
  posts: Tables<"posts">[];
  /** The person's own reactions, and other people's reactions to their posts. */
  postReactions: Tables<"post_reactions">[];
  spoilerReports: Pick<Tables<"spoiler_reports">, "post_id">[];
  popReactions: Tables<"pop_reactions">[];
  /** The person's own reading, and others' reading together right now. */
  sessions: Tables<"reading_sessions">[];
  /** The person's own reading records, and others' public ones. */
  records: Tables<"reading_entries">[];
  seenNotifications: string[];
}

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
  const book = createRegisteredBook(row.id, {
    title: row.title,
    author: row.author,
    ...(row.isbn ? { isbn: row.isbn } : {}),
    ...(row.price ? { price: row.price } : {}),
  });
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

/** Builds the town the signed-in person sees from what the database let them read. */
export function townFromRows(
  rows: RemoteRows,
  ids: TownViewer,
  now = Date.now(),
): TownState {
  const { userId } = ids;
  const registered = new Set(
    rows.marks
      .filter((row) => row.kind === "library" && row.user_id === userId)
      .map((row) => row.book_id),
  );
  const books = rows.books.map((row) =>
    bookFromRow(row, registered.has(row.id)),
  );
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

  const shopFrom = (
    row: ShopRow,
    shelves: unknown,
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
    demo: false,
  });
  const ownRow = rows.shops.find((row) => row.owner_id === userId);
  const ownShop = ownRow
    ? {
        ...shopFrom(ownRow, rows.ownShelves, rows.ownShopFollowers),
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
    .map((row) => shopFrom(row, row.public_shelves, 0));
  const shopIds = new Set(shops.map((shop) => shop.id));

  const visible = rows.posts.filter(
    (row) =>
      (row.book_id === null || bookIds.has(row.book_id)) &&
      (row.author_id === userId || known.has(row.author_id)),
  );
  const topLevel = new Set(
    visible.filter((row) => row.parent_id === null).map((row) => row.id),
  );
  const reactionCount = (postId: string, kind: "like" | "want") =>
    rows.postReactions.filter(
      (row) =>
        row.post_id === postId && row.kind === kind && row.user_id !== userId,
    ).length;
  const posts: Post[] = visible
    .filter((row) => row.parent_id === null || topLevel.has(row.parent_id))
    .map((row) => {
      const mine = row.author_id === userId;
      return {
        id: row.id,
        authorId: readerId(row.author_id),
        body: row.body,
        bookId: row.book_id,
        spoiler: row.spoiler,
        ...(row.spoiler_folded && !row.spoiler ? { folded: true } : {}),
        parentId: row.parent_id,
        createdAt: row.created_at,
        likes: mine ? reactionCount(row.id, "like") : 0,
        wants: mine ? reactionCount(row.id, "want") : 0,
        readingMode: READING_MODES.includes(row.reading_mode as ReadingMode)
          ? (row.reading_mode as ReadingMode)
          : null,
      };
    })
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

  return {
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
    ...lists,
    popReactions,
    posts,
    likedPosts: reacted("like"),
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
          (row.user_id === userId || (row.is_public && known.has(row.user_id))),
      )
      .flatMap((row): ReadingRecord[] => {
        const fields = cleanRecord({
          feelings: row.feelings as Feeling[],
          note: row.body,
          spoiler: row.spoiler,
          isPublic: row.is_public,
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
      readingPublic: ownProfile?.reading_visibility === "public",
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
  rows.posts.forEach((row) => row.book_id && ids.add(row.book_id));
  rows.sessions.forEach((row) => row.book_id && ids.add(row.book_id));
  rows.records.forEach((row) => ids.add(row.book_id));
  return [...ids];
}

// Writes ------------------------------------------------------------------------

type Pair = Record<string, string>;

/** One step of saving. Each one can be run again safely after a failure. */
export type Write =
  | { kind: "books"; rows: TablesInsert<"books">[] }
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
          | "reading_visibility"
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
  | { kind: "end-sessions"; rows: { id: string; ended_at: string }[] }
  | { kind: "sessions"; rows: TablesInsert<"reading_sessions">[] }
  | { kind: "delete-records"; ids: string[] }
  | { kind: "records"; rows: TablesInsert<"reading_entries">[] }
  | {
      kind: "update-record";
      id: string;
      patch: Pick<
        Tables<"reading_entries">,
        "body" | "feelings" | "spoiler" | "is_public"
      >;
    }
  | { kind: "remove"; table: RelationTable; rows: Pair[] }
  | { kind: "add"; table: RelationTable; rows: Pair[] };

export type RelationTable =
  | "shop_follows"
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

  const profile: Extract<Write, { kind: "profile" }>["patch"] = {};
  if (next.me.handle !== base.me.handle) profile.handle = next.me.handle;
  if (next.me.name !== base.me.name) profile.name = next.me.name;
  if (next.me.bio !== base.me.bio) profile.bio = next.me.bio;
  if (next.me.color !== base.me.color) profile.color = next.me.color;
  if (!sameJson(next.me.links ?? [], base.me.links ?? []))
    profile.links = next.me.links ?? [];
  if (next.settings.composeIcon !== base.settings.composeIcon)
    profile.compose_icon = next.settings.composeIcon;
  if (next.settings.readingPublic !== base.settings.readingPublic)
    profile.reading_visibility = next.settings.readingPublic
      ? "public"
      : "private";
  if (Object.keys(profile).length)
    writes.push({ kind: "profile", patch: profile });

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
  const fields = (record: ReadingRecord) => ({
    body: record.note,
    feelings: record.feelings,
    spoiler: record.spoiler,
    is_public: record.isPublic,
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
  for (const record of nextRecords.values()) {
    const before = baseRecords.get(record.id);
    if (before && !sameJson(fields(before), fields(record)))
      writes.push({
        kind: "update-record",
        id: record.id,
        patch: fields(record),
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
  return writes;
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
    wishlist: [],
    favorites: [],
    popReactions: {},
    posts: [],
    likedPosts: [],
    wantedPosts: [],
    spoilerReports: [],
    readingNow: [],
    readingSessions: [],
    finishedBooks: [],
    library: [],
    readingRecords: [],
    settings: { composeIcon: "pen", readingPublic: false },
    seenNotifications: [],
    shopMessages: [],
  };
}

export { REGISTERED_GENRE };
