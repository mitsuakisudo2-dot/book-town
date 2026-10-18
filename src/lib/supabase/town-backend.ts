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
import { bookKind, withSamples } from "../samples";
import { ME_ID, type TownState } from "../types";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "./database.generated";
import { REPORT_COLUMNS } from "./reports";
import { deviceOutbox, OUTBOX_KEY } from "../outbox";
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
  type SyncOptions,
} from "./sync";

type Client = SupabaseClient<Database>;

export { TownSyncError, shouldRetry };

// Supabase answers at most 1000 rows a request (PAGE). Every list the town
// shows is read whole, a page at a time (allRows), the pages after the first
// together: a town past 1000 waits for one more answer, and nothing is left
// out without a word. Only 便り and books are read a stretch at a time on
// purpose: the newest POSTS, with newer and older ones read after the town
// (remoteReads), and the newest CATALOG books with every book the rows point
// to (booksFor).
const POSTS = 500;
const CATALOG = 300;

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

/** The newest books the reader may read. Asked for with the town's other
    rows, not after them: on a slow line every step in turn is a wait. */
const catalogOf = (client: Client) =>
  all(
    client
      .from("books")
      .select(BOOK_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(CATALOG),
  );

/** The catalog, and every book the rows refer to that it leaves out. */
async function booksFor(
  client: Client,
  rows: Omit<RemoteRows, "books">,
  reading: ReturnType<typeof catalogOf>,
) {
  const catalog = await reading;
  const have = new Set(catalog.map((book) => book.id));
  const missing = referencedBookIds(rows).filter((id) => !have.has(id));
  return [
    ...catalog,
    ...(await byIds(missing, (ids) =>
      all(client.from("books").select(BOOK_COLUMNS).in("id", ids)),
    )),
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
    const asked = await client.rpc("my_books", {}, { head: true });
    if (asked.error?.code === "PGRST202") return undefined;
    throw error;
  }
}

/**
 * Reads the rows of the town `userId` sees, or a visitor (null) sees: the
 * same reads for both, the database deciding what each may read
 * (supabase/migrations). What only the signed-in person has (their marks,
 * follows, reactions, settings, shop) is not asked for a visitor. Their own
 * shop's id is handed back, if they have one.
 */
async function readTown(
  client: Client,
  userId: string | null,
): Promise<{ rows: Omit<RemoteRows, "seenNotifications">; shopId?: string }> {
  /** What only the signed-in person reads: nothing for a visitor. */
  const own = async <T>(read: (id: string) => Promise<T[]>): Promise<T[]> =>
    userId === null ? [] : read(userId);
  const catalog = catalogOf(client);
  // Awaited after the other rows: should one of them fail first, the
  // catalog's own failure (the same lost network) is not left unheard.
  catalog.catch(() => {});
  const [
    profiles,
    nine,
    shops,
    follows,
    blocks,
    marks,
    posts,
    postReactions,
    spoilerReports,
    popReactions,
    ownSessions,
    together,
    records,
    folds,
    myReports,
    readerSettings,
    posters,
    libraryEntries,
    libraryShelves,
    libraryShelfBooks,
    myBooks,
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
    all(
      client
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(POSTS),
    ),
    // The person's own reactions, and others' reactions to their posts.
    own(() =>
      allRows<Tables<"post_reactions">>(
        (count) => client.from("post_reactions").select("*", { count }),
        ["user_id", "post_id", "kind"],
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
    // Who is reading together right now; the person's own are read above.
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
    // The person's own posters, drafts too, and others' put up.
    allRows<Tables<"posters">>(
      (count) => client.from("posters").select("*", { count }),
      ["id"],
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

  const ownShop =
    userId === null
      ? undefined
      : shops.find((shop) => shop.owner_id === userId);
  let ownShelves: Json = [];
  let ownSceneBooks: Json = [];
  let ownShopFollowers = 0;
  let ownShopVisitors: RemoteRows["ownShopVisitors"] = null;
  let shopMessages: RemoteRows["shopMessages"] = [];
  if (ownShop && userId !== null) {
    const [privateRows, followers, messages, visitors] = await Promise.all([
      all(
        client
          .from("shop_private")
          .select("shelves, scene_books")
          .eq("shop_id", ownShop.id),
      ),
      settled(
        client
          .from("shop_follows")
          .select("shop_id", { count: "exact", head: true })
          .eq("shop_id", ownShop.id),
      ),
      allRows(
        (count) =>
          client
            .from("shop_reactions")
            .select("user_id, message, updated_at", { count })
            .eq("shop_id", ownShop.id)
            .neq("user_id", userId)
            .neq("message", ""),
        ["user_id"],
      ),
      // A nice-to-know: the town still opens if this cannot be read. The
      // number is last week's, settled by the database when the week ended.
      client.rpc("shop_visitors").then(
        (outcome) => (outcome.error ? undefined : outcome.data?.[0]),
        () => undefined,
      ),
    ]);
    ownShelves = privateRows[0]?.shelves ?? [];
    ownSceneBooks = privateRows[0]?.scene_books ?? [];
    ownShopFollowers = followers.count ?? 0;
    ownShopVisitors = visitors
      ? { count: visitors.visitors, at: visitors.week_end }
      : null;
    shopMessages = messages;
  }

  const rows: Omit<RemoteRows, "books" | "seenNotifications"> = {
    profiles,
    nine,
    shops,
    ownShelves,
    ownSceneBooks,
    ownShopFollowers,
    ownShopVisitors,
    shopMessages,
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
        catalog,
      ),
    },
    shopId: ownShop?.id,
  };
}

/** Reads everything the signed-in person's town shows. */
export async function loadTown(
  client: Client,
  userId: string,
  seenNotifications: string[] = [],
  newShopId: () => string = () => crypto.randomUUID(),
): Promise<{ state: TownState; ids: RemoteIds }> {
  const read = await readTown(client, userId);
  const ids: RemoteIds = { userId, shopId: read.shopId ?? newShopId() };
  return {
    state: townFromRows({ ...read.rows, seenNotifications }, ids),
    ids,
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
  const [profiles, bookRows, postReactions, spoilerReports, folds] =
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
    ]);
  return arrivedFromRows(
    {
      posts: rows,
      profiles,
      books: bookRows,
      postReactions,
      spoilerReports,
      folds,
    },
    userId,
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
): Required<Pick<TownBackend, "newer" | "older" | "post">> {
  const complete = (rows: PostRow[]) =>
    arrivedFor(client, rows, town(), userId);
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

/** Runs one planned write. Each can run twice without harm. */
export async function applyWrite(
  client: Client,
  write: Write,
  ids: RemoteIds,
): Promise<void> {
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
        // The 見本 keep the town from feeling empty while few have opened a
        // shop; they are left out of what is written (planWrites).
        return withSamples(loaded.state);
      },
      plan(base, target) {
        if (!ids) throw new TownSyncError("The town is not loaded yet", true);
        return planWrites(base, target, ids);
      },
      async apply(write) {
        if (!ids) throw new TownSyncError("The town is not loaded yet", true);
        await applyWrite(client, write, ids);
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
          : deviceOutbox(OUTBOX_KEY + userId, isWrite, device),
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
    ...remoteReads(client, userId, sync.current),
    close: sync.close,
  };
}

export { emptyTown };
