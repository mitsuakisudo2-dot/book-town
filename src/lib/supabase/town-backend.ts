import type { SupabaseClient } from "@supabase/supabase-js";
import {
  arrivedFromRows,
  emptyTown,
  isWrite,
  planWrites,
  splitWrite,
  writeStake,
  visitorReader,
  referencedBookIds,
  townFromRows,
  moreFromRows,
  countsFromAnswer,
  type BookRow,
  type MoreRows,
  type RelationTable,
  type RemoteIds,
  type RemoteRows,
  type ShopRow,
  type Write,
} from "../town-remote";
import {
  counterId,
  NEWER_MAX,
  NEWER_PAGES,
  NEWER_SLACK,
  OLDER_PAGE,
  type RecordKind,
  type TownBackend,
} from "../town-backend";
import { emptyArrived, type Arrived } from "../arrived";
import { isDatabaseId } from "../record-kind";
import { bookKind, sampleBookRowId, withSamples } from "../samples";
import { emptyMore } from "../town-more";
import { booksBeforeSearch } from "../book-lists";
import { databaseSearch } from "../search/rank";
import { normalizeIsbn } from "../books";
import type { SeriesRow } from "../series";
import { FEELINGS, ME_ID, type TownState } from "../types";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "./database.generated";
import { REPORT_COLUMNS } from "./reports";
import { deviceOutbox, OUTBOX_KEY, OUTBOX_KEY_BEFORE } from "../outbox";
import {
  all,
  allRows,
  backgroundSync,
  chunks,
  PAGE,
  settled,
  shouldRetry,
  steadily,
  TownSyncError,
  Versioned,
  type SyncOptions,
  type Versions,
} from "./sync";
import { takeTownAhead } from "./town-ahead";

type Client = SupabaseClient<Database>;

export { TownSyncError, shouldRetry };

// The rows every reader sees some of come in one answer (town_view), the
// books they point to in another (town_books); the person's own rows are
// read table by table, each whole, a page at a time (allRows: Supabase
// answers at most 1000 rows a request, PAGE). Only 便り and books are read a
// stretch at a time on purpose: the newest POSTS, with newer and older ones
// read after the town (remoteReads), and the newest CATALOG books with every
// book the rows point to (booksFor).
const POSTS = 500;
const CATALOG = 300;
/**
 * How many of others' newest records the town reads (town_view's
 * record_window): for the books finished lately. The rest of others'
 * records, and their 人生の9冊, are read on the page that shows them
 * (more()).
 */
const RECORD_WINDOW = 300;

/** What the town asks town_view for (also what tests/db-town-size.test.ts asks). */
export const TOWN_VIEW_ARGS = {
  post_limit: POSTS,
  catalog_limit: CATALOG,
  // Others' words are read on their profile's page (more below).
  record_notes: false,
  record_window: RECORD_WINDOW,
  others_nine: false,
};
/** Of a book's work, the newest records its page reads (work_records). */
const WORK_RECORDS = 200;
/** Of a feeling, the newest records the search reads for its books. */
const FELT_RECORDS = 100;
/** How many books the search asks the database for (find_books). */
export const FOUND_BOOKS = 100;
/** Of the town's books, how many the search asks the counts of (town_counts). */
const COUNTED_BOOKS = 1000;
/** How many works most shelved and most talked of the search asks for. */
const COUNTED_TOP = 12;
// A record without its words, as the town reads others' (body is left out).
const RECORD_COLUMNS =
  "id, user_id, book_id, kind, feelings, spoiler, is_public, audience, created_at, updated_at";

/** How many books one town_books request asks for (about 160KB of ids in its body). */
const BOOKS_AT_ONCE = 4000;

/** Rows matching `ids`, read 100 ids at a time (a URL has room for that). */
async function byIds<T>(
  ids: string[],
  read: (some: string[]) => Promise<T[]>,
): Promise<T[]> {
  const pages = await Promise.all(chunks(ids, 100).map(read));
  return pages.flat();
}

// Everything but who typed the book in, which the database does not show.
const BOOK_COLUMNS =
  "id, isbn, title, author, publisher, price, source, work_id, created_at, updated_at";

// created_at puts the shops in the order they opened, as the walk goes.
const SHOP_COLUMNS =
  "id, owner_id, name, description, tagline, theme, is_open, public_shelves, public_scene_books, created_at";

// Everything folded for everyone; the person's own held things too.
const FOLD_COLUMNS = "target_kind, target_id, state, since";

/**
 * The books `ids` that the reader may read, any number: in one request to
 * town_books for each thousand, or, from a database without it (the app can
 * be out before its migration), a hundred at a time by the table.
 */
async function booksByIds(client: Client, ids: string[]): Promise<BookRow[]> {
  if (!ids.length) return [];
  try {
    const pages = await Promise.all(
      chunks(ids, BOOKS_AT_ONCE).map(async (some) =>
        rowsOf<BookRow>(
          (await settled(client.rpc("town_books", { ids: some }))).data,
        ),
      ),
    );
    return pages.flat();
  } catch (error) {
    if (!(error instanceof TownSyncError && error.code === "PGRST202"))
      throw error;
    return byIds(ids, (some) =>
      all(client.from("books").select(BOOK_COLUMNS).in("id", some)),
    );
  }
}

/** The catalog, and every book the rows refer to that it leaves out. */
async function booksFor(
  client: Client,
  rows: Omit<RemoteRows, "books">,
  catalog: BookRow[],
) {
  const have = new Set(catalog.map((book) => book.id));
  const missing = referencedBookIds(rows).filter((id) => !have.has(id));
  // In the order the rows name them, however they come back.
  const place = new Map(missing.map((id, index) => [id, index]));
  const found = await booksByIds(client, missing);
  return [
    ...catalog,
    ...found.sort((a, b) => place.get(a.id)! - place.get(b.id)!),
  ];
}

/**
 * The books the person typed in, their copies of others' among them
 * (my_books). Undefined from a database that has no my_books yet (the app
 * can be out before its migration): the town then tells no book apart as
 * another reader's (own-books.ts).
 */
async function myBooksOf(client: Client): Promise<RemoteRows["myBooks"]> {
  try {
    return await allRows<{ id: string; copied_from: string | null }>(
      (count) => client.rpc("my_books", {}, { count }),
      ["id"],
    );
  } catch (error) {
    if (error instanceof TownSyncError && error.code === "PGRST202")
      return undefined;
    throw error;
  }
}

/**
 * The rows of the town every reader may see some of, read whole as the
 * database lets the reader see them: who is in the town and their 人生の9冊,
 * the shops, the newest 便り, reactions (the person's own and those on their
 * 便り), others' reading together, records, folds, posters and the newest
 * books.
 */
interface TownView {
  /** Whether all of it was read at one moment (town_view). */
  oneMoment: boolean;
  profiles: Tables<"profiles">[];
  nine: Tables<"profile_nine">[];
  shops: (ShopRow & Pick<Tables<"shops">, "created_at">)[];
  posts: Tables<"posts">[];
  postReactions: Tables<"post_reactions">[];
  together: Tables<"reading_sessions">[];
  records: Tables<"reading_entries">[];
  folds: RemoteRows["folds"];
  posters: Tables<"posters">[];
  catalog: BookRow[];
}

/** A list in town_view's answer; none when it is missing. */
const rowsOf = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

/**
 * The town's shared rows in one answer from town_view: one request, all from
 * one moment, so nothing moves between pages and the town is not read again
 * for it (AUD-006, AUD-135). A database without it (the app can be out
 * before its migration) is read table by table, as before.
 */
async function townViewOf(
  client: Client,
  userId: string | null,
): Promise<TownView> {
  // Someone not signed in may have it asked already, by the page's head.
  const ahead = userId === null ? await takeTownAhead() : undefined;
  if (ahead && typeof ahead === "object") return viewFrom(ahead as Json);
  let data: Json;
  try {
    data = (await settled(client.rpc("town_view", TOWN_VIEW_ARGS))).data;
  } catch (error) {
    if (!(error instanceof TownSyncError && error.code === "PGRST202"))
      throw error;
    // A database from before the window (20261110000000_town_window) answers
    // the whole town, and one from before town_view is read table by table.
    try {
      const { post_limit, catalog_limit, record_notes } = TOWN_VIEW_ARGS;
      data = (
        await settled(
          client.rpc("town_view", { post_limit, catalog_limit, record_notes }),
        )
      ).data;
    } catch (again) {
      if (again instanceof TownSyncError && again.code === "PGRST202")
        return townByTables(client, userId);
      throw again;
    }
  }
  return viewFrom(data);
}

/** The town in town_view's answer. */
function viewFrom(data: Json): TownView {
  const view = (data ?? {}) as Record<string, unknown>;
  return {
    oneMoment: true,
    profiles: rowsOf(view.profiles),
    nine: rowsOf(view.nine),
    shops: rowsOf(view.shops),
    posts: rowsOf(view.posts),
    postReactions: rowsOf(view.post_reactions),
    together: rowsOf(view.together),
    records: rowsOf(view.records),
    folds: rowsOf(view.folds),
    posters: rowsOf(view.posters),
    catalog: rowsOf(view.catalog),
  };
}

/** The same rows table by table, a page at a time: before town_view. */
async function townByTables(
  client: Client,
  userId: string | null,
): Promise<TownView> {
  const [
    profiles,
    nine,
    shops,
    posts,
    postReactions,
    together,
    records,
    folds,
    posters,
    catalog,
  ] = await Promise.all([
    // In the order they joined.
    allRows<Tables<"profiles">>(
      (count) => client.from("profiles").select("*", { count }),
      ["created_at", "id"],
    ),
    allRows<Tables<"profile_nine">>(
      (count) => client.from("profile_nine").select("*", { count }),
      ["profile_id", "position"],
    ),
    // Open shops, and the person's own whether it is open or not.
    allRows<ShopRow & Pick<Tables<"shops">, "created_at">>(
      (count) => client.from("shops").select(SHOP_COLUMNS, { count }),
      ["created_at", "id"],
    ),
    all(
      client
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(POSTS),
    ),
    // The person's own reactions, and others' reactions to their posts.
    userId === null
      ? []
      : allRows<Tables<"post_reactions">>(
          (count) => client.from("post_reactions").select("*", { count }),
          ["user_id", "post_id", "kind"],
        ),
    // Who is reading together right now; the person's own are read apart.
    allRows(
      (count) => {
        const open = client
          .from("reading_sessions")
          .select("*", { count })
          .eq("mode", "together")
          .is("ended_at", null);
        return userId === null ? open : open.neq("user_id", userId);
      },
      ["id"],
    ),
    // Every one of the person's own records, and others' they may read.
    allRows<Tables<"reading_entries">>(
      (count) => client.from("reading_entries").select("*", { count }),
      ["id"],
    ),
    allRows<RemoteRows["folds"][number]>(
      (count) =>
        client.from("moderation_folds").select(FOLD_COLUMNS, { count }),
      ["target_kind", "target_id"],
    ),
    // The person's own posters, drafts too, and others' put up.
    allRows<Tables<"posters">>(
      (count) => client.from("posters").select("*", { count }),
      ["id"],
    ),
    // The newest books the reader may read.
    all(
      client
        .from("books")
        .select(BOOK_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(CATALOG),
    ),
  ]);
  return {
    oneMoment: false,
    profiles,
    nine,
    shops,
    posts,
    postReactions,
    together,
    records,
    folds,
    posters,
    catalog,
  };
}

/** What only the owner reads of their shop. */
interface OwnShopRows {
  /** The shop they are of; null when it keeps no private row yet. */
  shopId: string | null;
  shelves: Json;
  sceneBooks: Json;
  shelvesVersion: number;
  followers: number;
  visitors: RemoteRows["ownShopVisitors"];
  messages: RemoteRows["shopMessages"];
}

/**
 * The owner's rows of their shop: of the shop `shopId`, or of the one
 * `userId` owns (a person keeps one shop, shops.owner_id), when it is asked
 * for before the town names it. A database from before versions has no
 * shelves_version, so it is asked for only when `versioned`.
 */
async function ownShopRows(
  client: Client,
  userId: string,
  shopId: string | null,
  versioned: boolean,
): Promise<OwnShopRows | undefined> {
  // Through the shop the person owns, read in the same answer.
  const shop = shopId === null ? ", shops!inner(owner_id)" : "";
  const ofShop = <T extends { eq(column: string, value: string): T }>(
    query: T,
  ) =>
    shopId === null
      ? query.eq("shops.owner_id", userId)
      : query.eq("shop_id", shopId);
  const [privateRows, followers, messages, visitors] = await Promise.all([
    all(
      ofShop(
        client
          .from("shop_private")
          .select(
            ((versioned
              ? "shop_id, shelves, scene_books, shelves_version"
              : "shop_id, shelves, scene_books") +
              shop) as "shop_id, shelves, scene_books, shelves_version",
          ),
      ),
    ),
    settled(
      ofShop(
        client.from("shop_follows").select(("shop_id" + shop) as "shop_id", {
          count: "exact",
          head: true,
        }),
      ),
    ),
    allRows(
      (count) =>
        ofShop(
          client
            .from("shop_reactions")
            .select(
              ("user_id, message, updated_at" +
                shop) as "user_id, message, updated_at",
              { count },
            )
            .neq("user_id", userId)
            .neq("message", ""),
        ),
      ["user_id"],
    ),
    // A nice-to-know: the town still opens if this cannot be read. The
    // number is last week's, settled by the database when the week ended.
    client.rpc("shop_visitors").then(
      (outcome) => (outcome.error ? undefined : outcome.data?.[0]),
      () => undefined,
    ),
  ]);
  const row = privateRows[0];
  return {
    shopId: row?.shop_id ?? shopId,
    shelves: row?.shelves ?? [],
    sceneBooks: row?.scene_books ?? [],
    shelvesVersion: row?.shelves_version ?? 0,
    followers: followers.count ?? 0,
    visitors: visitors
      ? { count: visitors.visitors, at: visitors.week_end }
      : null,
    // Without the shop each came through.
    messages: messages.map(({ user_id, message, updated_at }) => ({
      user_id,
      message,
      updated_at,
    })),
  };
}

/**
 * The owner's rows of the shop `userId` owns, asked for beside the town
 * (empty when they have none: the town then names no shop of theirs).
 * Undefined when they cannot be read so: the town then reads them by the id
 * it names, after it, as it did before.
 */
function ownShopAhead(
  client: Client,
  userId: string,
): Promise<OwnShopRows | undefined> {
  return ownShopRows(client, userId, null, true).catch(() => undefined);
}

/**
 * Reads the rows of the town `userId` sees, or a visitor (null) sees: the
 * same reads for both, the database deciding what each may read
 * (supabase/migrations). What only the signed-in person has (their marks,
 * follows, reactions, settings, shop) is not asked for a visitor. Their own
 * shop's id is handed back, if they have one, and the versions of what they
 * save whole (versionsOf).
 */
async function readTown(
  client: Client,
  userId: string | null,
): Promise<{
  rows: Omit<RemoteRows, "seenNotifications">;
  shopId?: string;
  versions: Versions;
}> {
  /** What only the signed-in person reads: nothing for a visitor. */
  const own = async <T>(read: (id: string) => Promise<T[]>): Promise<T[]> =>
    userId === null ? [] : read(userId);
  // The person's own shop, if they have one, in the same moment as the town
  // rather than after it: one wait fewer before Home shows.
  const ownAhead = userId === null ? undefined : ownShopAhead(client, userId);
  const [
    view,
    follows,
    blocks,
    marks,
    spoilerReports,
    popReactions,
    ownSessions,
    myReports,
    readerSettings,
    libraryEntries,
    libraryShelves,
    libraryShelfBooks,
    myBooks,
  ] = await Promise.all([
    townViewOf(client, userId),
    own((id) =>
      allRows(
        (count) =>
          client
            .from("shop_follows")
            .select("shop_id", { count })
            .eq("follower_id", id),
        ["shop_id"],
      ),
    ),
    own((id) =>
      allRows(
        (count) =>
          client
            .from("blocks")
            .select("blocked_id", { count })
            .eq("blocker_id", id),
        ["blocked_id"],
      ),
    ),
    own((id) =>
      allRows(
        (count) =>
          client.from("book_marks").select("*", { count }).eq("user_id", id),
        ["book_id", "kind"],
      ),
    ),
    own((id) =>
      allRows(
        (count) =>
          client
            .from("spoiler_reports")
            .select("post_id", { count })
            .eq("reporter_id", id),
        ["post_id"],
      ),
    ),
    own((id) =>
      allRows(
        (count) =>
          client.from("pop_reactions").select("*", { count }).eq("user_id", id),
        ["shop_id", "placement_key", "reaction"],
      ),
    ),
    own((id) =>
      allRows(
        (count) =>
          client
            .from("reading_sessions")
            .select("*", { count })
            .eq("user_id", id),
        ["id"],
      ),
    ),
    own(() =>
      allRows<RemoteRows["myReports"][number]>(
        (count) =>
          client
            .from("reports")
            // Only the reader's own come back (the policy); reporter_id
            // itself is not theirs to read, so it cannot be filtered on.
            .select(REPORT_COLUMNS, { count }),
        ["id"],
      ),
    ),
    own((id) =>
      all(client.from("reader_settings").select("*").eq("user_id", id)),
    ),
    // The person's own library, every row.
    own((id) =>
      allRows(
        (count) =>
          client
            .from("library_entries")
            .select("*", { count })
            .eq("user_id", id),
        ["book_id"],
      ),
    ),
    // The shelves the person made in their library, and their books.
    own((id) =>
      allRows(
        (count) =>
          client
            .from("library_shelves")
            .select("*", { count })
            .eq("user_id", id),
        ["id"],
      ),
    ),
    own((id) =>
      allRows(
        (count) =>
          client
            .from("library_shelf_books")
            .select("*", { count })
            .eq("user_id", id),
        ["shelf_id", "book_id"],
      ),
    ),
    // The books the person typed in, to tell others' apart.
    userId === null ? undefined : myBooksOf(client),
  ]);
  const {
    profiles,
    nine,
    shops,
    posts,
    postReactions,
    together,
    records,
    folds,
    posters,
  } = view;

  const ownShop =
    userId === null
      ? undefined
      : shops.find((shop) => shop.owner_id === userId);
  // A database that counts versions has one on every profile (write_versions).
  const versioned =
    typeof profiles.find((profile) => profile.id === userId)?.nine_version ===
    "number";
  // Read table by table, the person's own nine is read again after its
  // version (read with the profiles), so the page never holds a nine older
  // than the version it writes over: one saved on another device between
  // the two reads is refused once and read again, not written over.
  // town_view answers both from one moment.
  const ownNine =
    versioned && userId !== null && !view.oneMoment
      ? all(client.from("profile_nine").select("*").eq("profile_id", userId))
      : null;
  // Waited on below; the town fails as one if it cannot be read.
  ownNine?.catch(() => {});
  // Asked for beside the town (ownShopAhead), they are read again by the
  // shop's id only if that answer is of another shop (one made or replaced
  // between the two) or could not be had (a database that does not count
  // versions). A shop with no private row yet reads as empty either way;
  // one written meanwhile is held at version 0, so its first save is
  // refused and the town read again rather than written over.
  const ahead = ownShop ? await ownAhead : undefined;
  const ownRows = ownShop
    ? ahead && (ahead.shopId === ownShop.id || ahead.shopId === null)
      ? ahead
      : await ownShopRows(client, userId!, ownShop.id, versioned)
    : undefined;
  const shelvesVersion = ownRows?.shelvesVersion ?? 0;

  const rows: Omit<RemoteRows, "books" | "seenNotifications"> = {
    profiles,
    // The person's own last, read again or not, so the town comes out the
    // same either way.
    nine: [
      ...nine.filter((row) => row.profile_id !== userId),
      ...(ownNine
        ? await ownNine
        : nine.filter((row) => row.profile_id === userId)),
    ],
    shops,
    ownShelves: ownRows?.shelves ?? [],
    ownSceneBooks: ownRows?.sceneBooks ?? [],
    ownShopFollowers: ownRows?.followers ?? 0,
    ownShopVisitors: ownRows?.visitors ?? null,
    shopMessages: ownRows?.messages ?? [],
    follows,
    blocks,
    marks,
    myBooks,
    libraryEntries,
    libraryShelves,
    libraryShelfBooks,
    posts,
    postReactions,
    spoilerReports,
    popReactions,
    sessions: [...ownSessions, ...together],
    records,
    posters,
    folds,
    // A visitor files no reports and keeps no settings: the defaults.
    myReports,
    readerSettings: readerSettings[0] ?? null,
  };
  return {
    rows: {
      ...rows,
      books: await booksFor(
        client,
        { ...rows, seenNotifications: [] },
        view.catalog,
      ),
    },
    shopId: ownShop?.id,
    versions:
      userId !== null && versioned
        ? versionsOf(userId, profiles, shelvesVersion, posters)
        : {},
  };
}

/**
 * The versions the database counts of what the person saves whole, by the
 * key writeStake gives each: their shelves (0 while their shop has none, or
 * there is no shop yet), 人生の9冊 and each of their posters.
 */
function versionsOf(
  userId: string,
  profiles: Tables<"profiles">[],
  shelves: number,
  posters: Tables<"posters">[],
): Versions {
  const versions: Versions = { shelves };
  const own = profiles.find((profile) => profile.id === userId);
  if (own) versions.nine = own.nine_version;
  for (const poster of posters)
    if (poster.author_id === userId && typeof poster.version === "number")
      versions["poster:" + poster.id] = poster.version;
  return versions;
}

/** Reads everything the signed-in person's town shows. */
export async function loadTown(
  client: Client,
  userId: string,
  seenNotifications: string[] = [],
  newShopId: () => string = () => crypto.randomUUID(),
): Promise<{
  state: TownState;
  ids: RemoteIds;
  /**
   * The person's own books typed in, each with the book it copies (my_books);
   * undefined from a database without it, which tells none apart.
   */
  myBooks: ReadonlyMap<string, string | null> | undefined;
  /** Of what the person saves whole; none from a database without them. */
  versions: Versions;
}> {
  const read = await readTown(client, userId);
  const ids: RemoteIds = { userId, shopId: read.shopId ?? newShopId() };
  return {
    state: townFromRows({ ...read.rows, seenNotifications }, ids),
    ids,
    myBooks:
      read.rows.myBooks &&
      new Map(read.rows.myBooks.map((row) => [row.id, row.copied_from])),
    versions: read.versions,
  };
}

/**
 * Reads what anyone may see without signing in: profiles, open shops, posts
 * that are not private notes, and who is reading together right now.
 */
export async function loadPublicTown(client: Client): Promise<TownState> {
  const read = await readTown(client, null);
  return townFromRows(
    { ...read.rows, seenNotifications: [] },
    { userId: null, shopId: "" },
  );
}

type PostRow = Tables<"posts">;

/**
 * Posts read after the town, with what the town needs to show them: their
 * writers and books it does not know yet, the reader's own reactions to
 * them (and others' to the reader's own), their 「ネタバレでは？」 and folds.
 */
async function arrivedFor(
  client: Client,
  rows: PostRow[],
  town: TownState | null,
  userId: string | null,
  ownBooksKnown: boolean,
): Promise<Arrived> {
  if (!rows.length) return emptyArrived();
  const ids = [...new Set(rows.map((row) => row.id))];
  const readers = new Set(town?.readers.map((reader) => reader.id));
  const authors = [...new Set(rows.map((row) => row.author_id))].filter(
    (id) => id !== userId && !readers.has(id),
  );
  const books = new Set(town?.books.map((book) => book.id));
  const missing = [...new Set(rows.flatMap((row) => row.book_id ?? []))].filter(
    (id) => bookKind(id) === "database" && !books.has(id),
  );
  // The writers' records of these posts' books, for the feelings a post
  // shows: the town reads only a window of others' records.
  const writers = [...new Set(rows.map((row) => row.author_id))].filter(
    (id) => id !== userId,
  );
  const named = [...new Set(rows.flatMap((row) => row.book_id ?? []))];
  const [profiles, bookRows, postReactions, spoilerReports, folds, records] =
    await Promise.all([
      byIds(authors, (some) =>
        all(client.from("profiles").select("*").in("id", some)),
      ),
      byIds(missing, (some) =>
        all(client.from("books").select(BOOK_COLUMNS).in("id", some)),
      ),
      // A hundred of the reader's own 便り may hold more than a page of
      // others' reactions.
      userId
        ? byIds(ids, (some) =>
            allRows(
              (count) =>
                client
                  .from("post_reactions")
                  .select("*", { count })
                  .in("post_id", some),
              ["user_id", "post_id", "kind"],
            ),
          )
        : [],
      userId
        ? byIds(ids, (some) =>
            all(
              client
                .from("spoiler_reports")
                .select("post_id")
                .eq("reporter_id", userId)
                .in("post_id", some),
            ),
          )
        : [],
      byIds(ids, (some) =>
        all(
          client
            .from("moderation_folds")
            .select(FOLD_COLUMNS)
            .eq("target_kind", "post")
            .in("target_id", some),
        ),
      ),
      named.length
        ? byIds(writers, async (some) =>
            (
              await all(
                client
                  .from("reading_entries")
                  .select(RECORD_COLUMNS)
                  .in("user_id", some)
                  .in("book_id", named)
                  .eq("kind", "finished"),
              )
            ).map((row) => ({ ...row, body: "" })),
          )
        : [],
    ]);
  return arrivedFromRows(
    {
      posts: rows,
      profiles,
      books: bookRows,
      postReactions,
      spoilerReports,
      folds,
      records,
    },
    userId,
    ownBooksKnown,
  );
}

/**
 * What a town reads after it was read (PR 2): newer 便り for polling and a
 * pull, older ones for 便りだけ, one post by its id. The database decides
 * what may be read, as for the town itself; `town` is the town as it is
 * now, so only what it lacks is asked for.
 */
function remoteReads(
  client: Client,
  userId: string | null,
  town: () => TownState | null,
  myBooks: () => ReadonlyMap<string, string | null> | undefined = () =>
    undefined,
): Required<Pick<TownBackend, "newer" | "older" | "post" | "more">> {
  // Whether the town tells the person's own books from others' (my_books).
  const ownBooksKnown = () => myBooks() !== undefined;
  const complete = (rows: PostRow[]) =>
    arrivedFor(client, rows, town(), userId, ownBooksKnown());
  const posts = (count?: "exact") =>
    client.from("posts").select("*", { count });
  /** Every reply to the 便り `parents` (a 便り may have many). */
  const repliesTo = (parents: string[]) =>
    byIds(parents, (some) =>
      allRows((count) => posts(count).in("parent_id", some), ["id"]),
    );
  /** Rows the town lacks, each once: never one it has, nor the reader's own. */
  const lacking = (rows: PostRow[]) => {
    const have = new Set(town()?.posts.map((post) => post.id));
    return rows.filter(
      (row) =>
        row.author_id !== userId && !have.has(row.id) && have.add(row.id),
    );
  };
  return {
    async newer(since) {
      if (!since)
        return complete(
          lacking(
            await all(
              posts()
                .order("created_at", { ascending: false })
                .limit(NEWER_MAX),
            ),
          ),
        );
      // Oldest first from a little before `since`, page after page, so
      // what is read always joins on to what the town has: the next read
      // goes on from the newest of it, and nothing in between is skipped.
      // A post's time is when it was written, not when it was saved, so
      // one saved late may be a little older than the newest known.
      const at = Date.parse(since);
      let from = Number.isNaN(at)
        ? since
        : new Date(at - NEWER_SLACK).toISOString();
      const rows: PostRow[] = [];
      for (let page = 0; page < NEWER_PAGES; page += 1) {
        const found = await all(
          posts()
            .gte("created_at", from)
            .order("created_at", { ascending: true })
            .limit(NEWER_MAX),
        );
        rows.push(...found);
        if (found.length < NEWER_MAX) break;
        from = found[found.length - 1].created_at;
      }
      return complete(lacking(rows));
    },
    async older(before, authors) {
      const ids = [
        ...new Set(authors.map((id) => (id === ME_ID ? userId : id))),
      ].filter((id): id is string => !!id && isDatabaseId(id));
      if (!ids.length) return emptyArrived();
      // From `before` itself, not only below it: 便り written at the same
      // moment may lie on both sides of the last page, or of the town's own
      // reading, and none of them may be skipped. What the town has of
      // these writers at that moment is left out, and asked for that many
      // more, so a page is still full when there is more; past the
      // server's limit a request, from the oldest read on. One read alone
      // by its id is not: the page brings it to its place in 便りだけ.
      const state = town();
      const at = Date.parse(before);
      const writers = new Set(authors);
      const have = new Set(
        (state?.posts ?? [])
          .filter(
            (post) =>
              post.parentId === null &&
              writers.has(post.authorId) &&
              state?.readAfter?.[post.id] !== "alone" &&
              !(Date.parse(post.createdAt) > at),
          )
          .map((post) => post.id),
      );
      const wanted = OLDER_PAGE + have.size;
      const read = new Map<string, PostRow>();
      for (let until = before, size = Math.min(wanted, PAGE); ; size = PAGE) {
        const page = await all(
          posts()
            .is("parent_id", null)
            .in("author_id", ids)
            .lte("created_at", until)
            .order("created_at", { ascending: false })
            .limit(size),
        );
        const known = read.size;
        for (const row of page) if (!read.has(row.id)) read.set(row.id, row);
        if (page.length < size || read.size === known || read.size >= wanted)
          break;
        until = page[page.length - 1].created_at;
      }
      const found = [...read.values()]
        .filter((row) => !have.has(row.id))
        .slice(0, OLDER_PAGE);
      const replies = await repliesTo(found.map((row) => row.id));
      return complete([...found, ...replies]);
    },
    async more(ask) {
      const known = new Set(town()?.books.map((book) => book.id));
      let rows: Omit<MoreRows, "books">;
      if ("reader" in ask) {
        if (!isDatabaseId(ask.reader) || ask.reader === userId)
          return emptyMore();
        // Every record of the reader's the database lets this reader see,
        // with its words, and their nine.
        const [records, nine] = await Promise.all([
          allRows<Tables<"reading_entries">>(
            (count) =>
              client
                .from("reading_entries")
                .select("*", { count })
                .eq("user_id", ask.reader)
                .eq("kind", "finished"),
            ["id"],
          ),
          all(
            client
              .from("profile_nine")
              .select("*")
              .eq("profile_id", ask.reader),
          ),
        ]);
        rows = { records, nine };
      } else if ("work" in ask) {
        const kind = bookKind(ask.work);
        if (kind === "local") return emptyMore();
        const book =
          kind === "sample" && !isDatabaseId(ask.work)
            ? sampleBookRowId(ask.work)
            : ask.work;
        let records: Tables<"reading_entries">[];
        try {
          records = rowsOf(
            (
              await settled(
                client.rpc("work_records", {
                  book,
                  record_limit: WORK_RECORDS,
                }),
              )
            ).data,
          );
        } catch (error) {
          // A database from before work_records reads every record with
          // the town: there is nothing more to read.
          if (error instanceof TownSyncError && error.code === "PGRST202")
            return emptyMore();
          throw error;
        }
        rows = { records, nine: [] };
      } else if ("felt" in ask) {
        let felt: Json;
        try {
          felt = (await settled(client.rpc("felt_in_town"))).data;
        } catch (error) {
          // A database from before felt_in_town reads every record with the
          // town, and the town knows what was felt.
          if (error instanceof TownSyncError && error.code === "PGRST202")
            return emptyMore();
          throw error;
        }
        return {
          ...emptyMore(),
          felt: FEELINGS.filter((feeling) =>
            rowsOf<string>(felt).includes(feeling),
          ),
        };
      } else if ("search" in ask) {
        // Every book the reader may read that the query finds, not only
        // the town's (find_books); ranked with the town's by the page.
        const asked = databaseSearch(ask.search);
        if (!asked) return emptyMore();
        let books: BookRow[];
        try {
          books = rowsOf<BookRow>(
            (
              await settled(
                client.rpc("find_books", {
                  forms: asked.forms,
                  ...(asked.isbn ? { isbn: asked.isbn } : {}),
                  ...(asked.isbnStart ? { isbn_start: asked.isbnStart } : {}),
                  book_limit: FOUND_BOOKS,
                }),
              )
            ).data,
          );
        } catch (error) {
          // A database from before find_books: the town's books are searched.
          if (error instanceof TownSyncError && error.code === "PGRST202")
            return emptyMore();
          throw error;
        }
        // An ISBN nothing answers is counted, the ISBN alone, for choosing
        // what the catalog takes first (note_missing_isbn). Nothing waits
        // on it, and a failure changes nothing.
        if (asked.isbn && books.length === 0)
          void client.rpc("note_missing_isbn", { isbn: asked.isbn }).then(
            () => undefined,
            () => undefined,
          );
        return moreFromRows(
          { records: [], nine: [], books },
          userId,
          myBooks(),
        );
      } else if ("series" in ask) {
        // The series a book of the ISBN is in, with the books of their
        // volumes the town does not hold (series_for_isbn, 管理表 13).
        const isbn = normalizeIsbn(ask.series);
        if (!isbn) return emptyMore();
        let found: SeriesRow[];
        try {
          found = rowsOf<SeriesRow>(
            (await settled(client.rpc("series_for_isbn", { isbn }))).data,
          );
        } catch (error) {
          // A database from before series_for_isbn: no series yet.
          if (error instanceof TownSyncError && error.code === "PGRST202")
            return emptyMore();
          throw error;
        }
        // Read only where a series is shown: not with every page.
        const { seriesFromRows } = await import("../series");
        const series = seriesFromRows(found);
        const missing = [
          ...new Set(
            series.flatMap((entry) =>
              entry.lines.flatMap((line) =>
                line.volumes.map((volume) => volume.bookId),
              ),
            ),
          ),
        ].filter((id) => isDatabaseId(id) && !known.has(id));
        return {
          ...moreFromRows(
            { records: [], nine: [], books: await booksByIds(client, missing) },
            userId,
            myBooks(),
          ),
          series,
        };
      } else if ("counts" in ask) {
        // How often the town's books are shelved and talked of, of all
        // time, and the works most shelved and talked of (town_counts): the
        // town holds only the newest 便り. The 見本's books by their rows.
        const asked = booksBeforeSearch(town() ?? emptyTown())
          .filter((book) => bookKind(book.id) !== "local")
          .slice(0, COUNTED_BOOKS);
        const rowOf = (bookId: string) =>
          bookKind(bookId) === "sample" && !isDatabaseId(bookId)
            ? sampleBookRowId(bookId)
            : bookId;
        let answer: Json;
        try {
          answer = (
            await settled(
              client.rpc("town_counts", {
                books: asked.map((book) => rowOf(book.id)),
                top: COUNTED_TOP,
              }),
            )
          ).data;
        } catch (error) {
          // A database from before town_counts: the page counts the town.
          if (error instanceof TownSyncError && error.code === "PGRST202")
            return emptyMore();
          throw error;
        }
        return countsFromAnswer(
          answer,
          asked.map((book) => book.id),
        );
      } else {
        let records: Tables<"reading_entries">[];
        try {
          // A feeling's records found by their index (feeling_records).
          records = rowsOf(
            (
              await settled(
                client.rpc("feeling_records", {
                  feeling: ask.feeling,
                  record_limit: FELT_RECORDS,
                }),
              )
            ).data,
          );
        } catch (error) {
          if (!(error instanceof TownSyncError && error.code === "PGRST202"))
            throw error;
          // A database from before feeling_records.
          records = (
            await all(
              client
                .from("reading_entries")
                .select(RECORD_COLUMNS)
                .contains("feelings", [ask.feeling])
                .eq("kind", "finished")
                .order("created_at", { ascending: false })
                .limit(FELT_RECORDS),
            )
          ).map((row) => ({ ...row, body: "" }));
        }
        rows = { records, nine: [] };
      }
      const missing = [
        ...new Set([
          // A book's page asks its work by the book, which the town may not
          // hold (one a search found).
          ...("work" in ask ? [ask.work] : []),
          ...rows.records.map((row) => row.book_id),
          ...rows.nine.map((row) => row.book_id),
        ]),
      ].filter((id) => bookKind(id) === "database" && !known.has(id));
      return moreFromRows(
        { ...rows, books: await booksByIds(client, missing) },
        userId,
        myBooks(),
      );
    },
    async post(id) {
      if (!isDatabaseId(id)) return emptyArrived();
      const [found] = await all(posts().eq("id", id));
      if (!found) return emptyArrived();
      const top = found.parent_id ?? found.id;
      const [heads, replies] = await Promise.all([
        found.parent_id ? all(posts().eq("id", top)) : [found],
        repliesTo([top]),
      ]);
      return complete([...heads, ...replies, found]);
    },
  };
}

/**
 * The town for someone who is not signed in: real shops and posts beside the
 * 見本, to look at only. The store asks them to sign in before any change
 * (store.ts), so nothing here is ever saved.
 */
export function visitorTownBackend(client: Client): TownBackend {
  // The town shown, for taking in what is read after it: nothing is saved.
  let shown: TownState | null = null;
  return {
    kind: "visitor",
    newId: counterId,
    async load() {
      try {
        // Rows that move while being read are read again at once, as for
        // the signed-in town (sync.ts).
        const state = withSamples(await steadily(() => loadPublicTown(client)));
        shown = state;
        return { state, status: "saved" as const };
      } catch {
        // The 見本 still make a town to walk through.
        const state = withSamples({ ...emptyTown(), me: visitorReader() });
        shown = state;
        return { state, status: "unavailable" as const };
      }
    },
    save(state) {
      shown = state;
      return "saved";
    },
    absorb(take) {
      if (!shown) return null;
      shown = take(shown, shown);
      return shown;
    },
    ...remoteReads(client, null, () => shown),
  };
}

const KEYS: Record<RelationTable, string> = {
  shop_follows: "follower_id,shop_id",
  blocks: "blocker_id,blocked_id",
  book_marks: "user_id,book_id,kind",
  pop_reactions: "user_id,shop_id,placement_key,reaction",
  post_reactions: "user_id,post_id,kind",
  spoiler_reports: "reporter_id,post_id",
};

/** The version a save_ function answers it wrote at (or already held). */
async function savedAt(
  request: PromiseLike<{
    data: number | null;
    error: { message: string; code?: string } | null;
    status: number;
  }>,
): Promise<number> {
  const { data } = await settled(request);
  if (typeof data !== "number")
    throw new TownSyncError("The database did not answer a version", true);
  return data;
}

/**
 * Runs one planned write. Each can run twice without harm. A thing saved
 * whole (the shelves, the nine, a poster) with the version it began from
 * (`base`) goes through the database's save_ functions, written only over
 * that version (docs/09「版を確かめて書く」), and the versions they answer
 * are handed back; without one (a database from before versions) it is
 * written the old way. `versioned`: whether the database counts versions,
 * for a poster made, which begins with none.
 */
export async function applyWrite(
  client: Client,
  write: Write,
  ids: RemoteIds,
  base?: number,
  versioned = false,
): Promise<Versions | void> {
  const ignore = { ignoreDuplicates: true } as const;
  switch (write.kind) {
    case "books":
      // The database gives each new book its work (the books_work trigger);
      // a reader has no grant to send one, so the rows come without it.
      await settled(
        client.from("books").upsert(write.rows as TablesInsert<"books">[], {
          onConflict: "id",
          ...ignore,
        }),
      );
      return;
    case "copy-books":
      // Each copy is made once: asked again, the database leaves it be.
      for (const row of write.rows)
        await settled(
          client.rpc("copy_book", { original: row.copied_from, copy: row.id }),
        );
      return;
    case "fix-books":
      for (const { id, ...fix } of write.rows) {
        const fixed = await all(
          client.from("books").update(fix).eq("id", id).select("id"),
        );
        // Only a book the reader typed in can be fixed (row level security
        // leaves any other alone, without an error): not saved, then.
        if (!fixed.length)
          throw new TownSyncError("The book could not be fixed", false);
      }
      return;
    case "profile":
      await settled(
        client.from("profiles").update(write.patch).eq("id", ids.userId),
      );
      return;
    case "nine":
      if (base !== undefined)
        return {
          nine: await savedAt(
            client.rpc("save_nine", {
              book_ids: write.bookIds,
              notes: write.notes,
              base,
            }),
          ),
        };
      await settled(
        client.rpc("replace_profile_nine", {
          book_ids: write.bookIds,
          notes: write.notes,
        }),
      );
      return;
    case "create-shop":
      await settled(
        client.from("shops").upsert(write.row, { onConflict: "id", ...ignore }),
      );
      return;
    case "update-shop":
      await settled(
        client.from("shops").update(write.patch).eq("id", write.shopId),
      );
      return;
    case "shelves":
      if (base !== undefined)
        return {
          shelves: await savedAt(
            client.rpc("save_shelves", {
              shop: write.shopId,
              value: write.shelves as unknown as Json[],
              base,
            }),
          ),
        };
      await settled(
        client.from("shop_private").upsert({
          shop_id: write.shopId,
          shelves: write.shelves as unknown as Json[],
        }),
      );
      return;
    case "delete-posts":
      await settled(client.from("posts").delete().in("id", write.ids));
      return;
    case "posts":
      await settled(
        client
          .from("posts")
          .upsert(write.rows, { onConflict: "id", ...ignore }),
      );
      return;
    case "mark-spoilers":
      await settled(
        client.from("posts").update({ spoiler: true }).in("id", write.ids),
      );
      return;
    case "like-taps":
      for (const row of write.rows)
        await settled(
          client
            .from("post_reactions")
            .update({ taps: row.taps })
            .eq("user_id", ids.userId)
            .eq("post_id", row.post_id)
            .eq("kind", "like"),
        );
      return;
    case "end-sessions":
      for (const row of write.rows)
        await settled(
          client
            .from("reading_sessions")
            .update({ ended_at: row.ended_at })
            .eq("id", row.id),
        );
      return;
    case "sessions":
      await settled(
        client
          .from("reading_sessions")
          .upsert(write.rows, { onConflict: "id", ...ignore }),
      );
      return;
    case "delete-records":
      await settled(
        client
          .from("reading_entries")
          .delete()
          .eq("user_id", ids.userId)
          .in("id", write.ids),
      );
      return;
    case "records":
      await settled(
        client
          .from("reading_entries")
          .upsert(write.rows, { onConflict: "id", ...ignore }),
      );
      return;
    case "update-record":
      await settled(
        client
          .from("reading_entries")
          .update(write.patch)
          .eq("id", write.id)
          .eq("user_id", ids.userId),
      );
      return;
    case "reader-settings":
      await settled(
        client
          .from("reader_settings")
          .upsert(write.row, { onConflict: "user_id" }),
      );
      return;
    case "delete-posters":
      await settled(
        client
          .from("posters")
          .delete()
          .eq("author_id", ids.userId)
          .in("id", write.ids),
      );
      return;
    case "posters": {
      if (versioned) {
        // Made where it is not there yet; one there already (an earlier
        // try whose answer was lost) takes these fields.
        const versions: Versions = {};
        for (const { id, author_id: _author, ...fields } of write.rows)
          if (id)
            versions["poster:" + id] = await savedAt(
              client.rpc("save_poster", {
                poster: id,
                value: fields as unknown as Json,
              }),
            );
        return versions;
      }
      const made = await all(
        client
          .from("posters")
          .upsert(write.rows, { onConflict: "id", ...ignore })
          .select("id"),
      );
      // A poster already there was kept by an earlier try whose answer was
      // lost; the maker may have changed it since, so it takes these fields.
      const fresh = new Set(made.map((row) => row.id));
      for (const row of write.rows)
        if (row.id && !fresh.has(row.id))
          await settled(
            client
              .from("posters")
              .update({
                template: row.template,
                theme: row.theme,
                font: row.font,
                pages: row.pages,
                spoiler: row.spoiler,
                show_in_timeline: row.show_in_timeline,
                status: row.status,
              })
              .eq("id", row.id)
              .eq("author_id", ids.userId),
          );
      return;
    }
    case "update-poster":
      // On a database that counts versions, never the old way: a poster
      // whose version this page does not know (its making was refused, or
      // changed elsewhere) is written only over the version it was made at,
      // and one not there is told as taken down.
      if (base !== undefined || versioned)
        return {
          ["poster:" + write.id]: await savedAt(
            client.rpc("save_poster", {
              poster: write.id,
              value: write.patch as unknown as Json,
              base: base ?? 0,
            }),
          ),
        };
      await settled(
        client
          .from("posters")
          .update(write.patch)
          .eq("id", write.id)
          .eq("author_id", ids.userId),
      );
      return;
    case "library-entries": {
      // New rows in, ignoring one already there; then what the reader
      // changed, of the rows already there. Never a partial upsert, which
      // would write every column it sends.
      const made = new Set<string>();
      for (const some of chunks(write.rows, 500))
        for (const row of await all(
          client
            .from("library_entries")
            .upsert(some, { onConflict: "user_id,book_id", ...ignore })
            .select("book_id"),
        ))
          made.add(row.book_id);
      const patches = write.patches.filter(
        (row) => !(row.made && made.has(row.book_id)),
      );
      // A few at a time: changing fifty books at once is fifty rows.
      for (const some of chunks(patches, 8))
        await Promise.all(
          some.map((row) =>
            settled(
              client
                .from("library_entries")
                .update(row.patch)
                .eq("user_id", ids.userId)
                .eq("book_id", row.book_id),
            ),
          ),
        );
      return;
    }
    case "library-shelves": {
      // New shelves in, ignoring one already there (an earlier try whose
      // answer was lost); then what the reader changed of the others.
      for (const some of chunks(write.rows, 500))
        await settled(
          client
            .from("library_shelves")
            .upsert(some, { onConflict: "id", ...ignore }),
        );
      for (const row of write.patches)
        await settled(
          client
            .from("library_shelves")
            .update(row.patch)
            .eq("id", row.id)
            .eq("user_id", ids.userId),
        );
      return;
    }
    case "shelf-books":
      for (const row of write.remove)
        await settled(
          client
            .from("library_shelf_books")
            .delete()
            .match({ user_id: ids.userId, ...row }),
        );
      for (const some of chunks(write.add, 500))
        await settled(
          client.from("library_shelf_books").upsert(some, {
            onConflict: "user_id,shelf_id,book_id",
            ...ignore,
          }),
        );
      return;
    case "remove":
      for (const row of write.rows)
        await settled(client.from(write.table).delete().match(row));
      return;
    case "add":
      await settled(
        client
          .from(write.table)
          // Each table's own row shape; planWrites builds them per table.
          .upsert(write.rows as never, {
            onConflict: KEYS[write.table],
            ...ignore,
          }),
      );
      return;
  }
}

export const SEEN_KEY = "book-town-seen-v1:";

function readSeen(userId: string): string[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(SEEN_KEY + userId) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(-500)
      : [];
  } catch {
    return [];
  }
}

function writeSeen(userId: string, seen: string[]) {
  try {
    window.localStorage.setItem(SEEN_KEY + userId, JSON.stringify(seen));
  } catch {
    // Which notices were read is a convenience; losing it loses nothing else.
  }
}

export interface AccountBackendOptions extends SyncOptions {
  /** Keeps what is kept per account in this browser (off in tests). */
  storage?: boolean;
  /** Where changes wait to be sent (outbox.ts): the browser's, with storage. */
  device?: Parameters<typeof deviceOutbox>[2];
}

/**
 * The signed-in person's town: read from Supabase, kept in memory for the
 * screens, and saved back in the background. Changes are written by comparing
 * the town with the last one the database confirmed, so a failed save is simply
 * planned again on the next try; while they wait, they are kept on the device
 * (outbox.ts) and sent from the next page if this one closes first.
 */
export function accountTownBackend(
  client: Client,
  userId: string,
  options: AccountBackendOptions = {},
): TownBackend {
  const storage = options.storage ?? typeof window !== "undefined";
  const device = options.device ?? (storage ? undefined : null);
  let ids: RemoteIds | null = null;
  let myBooks: ReadonlyMap<string, string | null> | undefined;
  // Whether the database counts versions (write_versions), as last read.
  let versioned = false;
  const sync = backgroundSync<TownState, Write>(
    {
      async read() {
        const loaded = await loadTown(
          client,
          userId,
          storage ? readSeen(userId) : [],
          () => ids?.shopId ?? crypto.randomUUID(),
        );
        ids = loaded.ids;
        myBooks = loaded.myBooks;
        versioned = "nine" in loaded.versions;
        // The 見本 keep the town from feeling empty while few have opened a
        // shop; they are left out of what is written (planWrites).
        return new Versioned(withSamples(loaded.state), loaded.versions);
      },
      plan(base, target) {
        if (!ids) throw new TownSyncError("The town is not loaded yet", true);
        return planWrites(base, target, ids);
      },
      async apply(write, base) {
        if (!ids) throw new TownSyncError("The town is not loaded yet", true);
        return applyWrite(client, write, ids, base, versioned);
      },
      split: splitWrite,
      stake: writeStake,
      landed(base, target) {
        if (storage && target.seenNotifications !== base.seenNotifications)
          writeSeen(userId, target.seenNotifications);
      },
      outbox:
        device === null
          ? undefined
          : deviceOutbox(
              OUTBOX_KEY + userId,
              isWrite,
              device,
              undefined,
              OUTBOX_KEY_BEFORE + userId,
            ),
    },
    options,
  );

  return {
    kind: "account",
    newId(kind: RecordKind, existing: string[], isbn?: string | null) {
      // Shelves and their books live inside the shop's own record.
      return kind === "shelf" || kind === "item"
        ? counterId(kind, existing, isbn)
        : crypto.randomUUID();
    },
    load: async () => ({ state: await sync.load(), status: sync.loaded() }),
    save: sync.save,
    watch: sync.watch,
    absorb: sync.absorb,
    async forgetBooks(
      books: { id: string; removedAt: string }[],
      batch: string,
    ) {
      const { data } = await settled(
        client.rpc("forget_books", {
          ids: books.map((book) => book.id),
          removed: books.map((book) => book.removedAt),
          batch,
        }),
      );
      return Array.isArray(data) ? data : [];
    },
    ...remoteReads(client, userId, sync.current, () => myBooks),
    close: sync.close,
  };
}

export { emptyTown };
