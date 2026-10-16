import type { SupabaseClient } from "@supabase/supabase-js";
import {
  arrivedFromRows,
  emptyTown,
  planWrites,
  visitorReader,
  referencedBookIds,
  townFromRows,
  type RelationTable,
  type RemoteIds,
  type RemoteRows,
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
import { isDatabaseId } from "../paths";
import { sampleBookOfRow, withSamples } from "../samples";
import { ME_ID, type TownState } from "../types";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "./database.generated";
import { REPORT_COLUMNS } from "./reports";
import {
  all,
  allRows,
  backgroundSync,
  chunks,
  settled,
  shouldRetry,
  TownSyncError,
  type Outcome,
  type SyncOptions,
} from "./sync";

type Client = SupabaseClient<Database>;

export { TownSyncError, shouldRetry };

// Supabase returns at most 1000 rows a request. The person's own marks,
// readings and records are read a page at a time (allRows), and their own nine
// on its own, so none is left out; the rest stops at 1000, which covers
// everyone while Booktown is invite-only.
const LIMIT = 1000;
const POSTS = 500;
const CATALOG = 300;

// Everything but who typed the book in, which the database does not show.
const BOOK_COLUMNS =
  "id, isbn, title, author, publisher, price, source, created_at, updated_at";

const SHOP_COLUMNS =
  "id, owner_id, name, description, tagline, theme, is_open, public_shelves, public_scene_books";

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
  const more = await Promise.all(
    chunks(missing, 100).map((ids) =>
      all(client.from("books").select(BOOK_COLUMNS).in("id", ids)),
    ),
  );
  return [...catalog, ...more.flat()];
}

/** Reads everything the signed-in person's town shows. */
export async function loadTown(
  client: Client,
  userId: string,
  seenNotifications: string[] = [],
  newShopId: () => string = () => crypto.randomUUID(),
): Promise<{ state: TownState; ids: RemoteIds }> {
  const catalog = catalogOf(client);
  const [
    someProfiles,
    ownNine,
    othersNine,
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
    ownRecords,
    othersRecords,
    folds,
    myReports,
    readerSettings,
    posters,
  ] = await Promise.all([
    all(client.from("profiles").select("*").limit(LIMIT)),
    // The person's own nine, whole, as changing it rewrites the list; and
    // others'.
    all(client.from("profile_nine").select("*").eq("profile_id", userId)),
    all(
      client
        .from("profile_nine")
        .select("*")
        .neq("profile_id", userId)
        .limit(LIMIT),
    ),
    all(client.from("shops").select(SHOP_COLUMNS).limit(LIMIT)),
    all(
      client.from("shop_follows").select("shop_id").eq("follower_id", userId),
    ),
    all(client.from("blocks").select("blocked_id").eq("blocker_id", userId)),
    allRows(
      (count) =>
        client.from("book_marks").select("*", { count }).eq("user_id", userId),
      ["book_id", "kind"],
    ),
    all(
      client
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(POSTS),
    ),
    // The person's own reactions, and others' reactions to their posts.
    all(client.from("post_reactions").select("*").limit(LIMIT)),
    all(
      client
        .from("spoiler_reports")
        .select("post_id")
        .eq("reporter_id", userId),
    ),
    all(client.from("pop_reactions").select("*").eq("user_id", userId)),
    allRows(
      (count) =>
        client
          .from("reading_sessions")
          .select("*", { count })
          .eq("user_id", userId),
      ["id"],
    ),
    all(
      client
        .from("reading_sessions")
        .select("*")
        .eq("mode", "together")
        .is("ended_at", null)
        .neq("user_id", userId)
        .limit(LIMIT),
    ),
    // Every one of the person's own records, and the newest of others'
    // public ones.
    allRows(
      (count) =>
        client
          .from("reading_entries")
          .select("*", { count })
          .eq("user_id", userId),
      ["id"],
    ),
    all(
      client
        .from("reading_entries")
        .select("*")
        .neq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
    ),
    all(client.from("moderation_folds").select(FOLD_COLUMNS).limit(LIMIT)),
    all(
      client
        .from("reports")
        // Only the reader's own come back (the policy); reporter_id itself is
        // not theirs to read, so it cannot be filtered on.
        .select(REPORT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    all(
      client
        .from("reader_settings")
        .select("spoiler_display")
        .eq("user_id", userId),
    ),
    // The person's own posters, drafts too, and others' put up.
    all(
      client
        .from("posters")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMIT),
    ),
  ]);

  // Whoever the person blocked is named in their list, even past the
  // profiles read for the town.
  const unread = [
    ...new Set(
      blocks
        .map((row) => row.blocked_id)
        .filter((id) => !someProfiles.some((row) => row.id === id)),
    ),
  ];
  const profiles = unread.length
    ? [
        ...someProfiles,
        ...(
          await all(client.from("profiles").select("*").in("id", unread))
        ).filter((row) => unread.includes(row.id)),
      ]
    : someProfiles;

  const own = shops.find((shop) => shop.owner_id === userId);
  let ownShelves: Json = [];
  let ownSceneBooks: Json = [];
  let ownShopFollowers = 0;
  let ownShopVisitors: RemoteRows["ownShopVisitors"] = null;
  let shopMessages: RemoteRows["shopMessages"] = [];
  if (own) {
    const [privateRows, followers, messages, visitors] = await Promise.all([
      all(
        client
          .from("shop_private")
          .select("shelves, scene_books")
          .eq("shop_id", own.id),
      ),
      settled(
        client
          .from("shop_follows")
          .select("shop_id", { count: "exact", head: true })
          .eq("shop_id", own.id),
      ),
      all(
        client
          .from("shop_reactions")
          .select("user_id, message, updated_at")
          .eq("shop_id", own.id)
          .neq("user_id", userId)
          .neq("message", "")
          .order("updated_at", { ascending: false })
          .limit(LIMIT),
      ),
      // A nice-to-know: the town still opens if this cannot be read.
      client.rpc("shop_visitors", { days: 7 }).then(
        (outcome) => (outcome.error ? 0 : (outcome.data ?? 0)),
        () => 0,
      ),
    ]);
    ownShelves = privateRows[0]?.shelves ?? [];
    ownSceneBooks = privateRows[0]?.scene_books ?? [];
    ownShopFollowers = followers.count ?? 0;
    ownShopVisitors = { count: visitors, at: new Date().toISOString() };
    shopMessages = messages;
  }

  const rows: Omit<RemoteRows, "books"> = {
    profiles,
    nine: [...ownNine, ...othersNine],
    shops,
    ownShelves,
    ownSceneBooks,
    ownShopFollowers,
    ownShopVisitors,
    shopMessages,
    follows,
    blocks,
    marks,
    posts,
    postReactions,
    spoilerReports,
    popReactions,
    sessions: [...ownSessions, ...together],
    records: [...ownRecords, ...othersRecords],
    posters,
    seenNotifications,
    folds,
    myReports,
    readerSettings: readerSettings[0] ?? null,
  };
  const ids: RemoteIds = { userId, shopId: own?.id ?? newShopId() };
  return {
    state: townFromRows(
      { ...rows, books: await booksFor(client, rows, catalog) },
      ids,
    ),
    ids,
  };
}

/**
 * Reads what anyone may see without signing in: profiles, open shops, posts
 * that are not private notes, and who is reading together right now. The
 * database decides what is public (supabase/migrations); this only asks.
 */
export async function loadPublicTown(client: Client): Promise<TownState> {
  const catalog = catalogOf(client);
  const [profiles, nine, shops, posts, together, records, folds, posters] =
    await Promise.all([
      all(client.from("profiles").select("*").limit(LIMIT)),
      all(client.from("profile_nine").select("*").limit(LIMIT)),
      all(
        client
          .from("shops")
          .select(SHOP_COLUMNS)
          .eq("is_open", true)
          .limit(LIMIT),
      ),
      all(
        client
          .from("posts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(POSTS),
      ),
      all(
        client
          .from("reading_sessions")
          .select("*")
          .eq("mode", "together")
          .is("ended_at", null)
          .limit(LIMIT),
      ),
      all(
        client
          .from("reading_entries")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(LIMIT),
      ),
      all(client.from("moderation_folds").select(FOLD_COLUMNS).limit(LIMIT)),
      all(
        client
          .from("posters")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(LIMIT),
      ),
    ]);
  const rows: Omit<RemoteRows, "books"> = {
    profiles,
    nine,
    shops,
    ownShelves: [],
    ownSceneBooks: [],
    ownShopFollowers: 0,
    ownShopVisitors: null,
    shopMessages: [],
    follows: [],
    blocks: [],
    marks: [],
    posts,
    postReactions: [],
    spoilerReports: [],
    popReactions: [],
    sessions: together,
    records,
    posters,
    seenNotifications: [],
    folds,
    // A visitor files no reports and keeps no settings: the defaults.
    myReports: [],
    readerSettings: null,
  };
  return townFromRows(
    { ...rows, books: await booksFor(client, rows, catalog) },
    { userId: null, shopId: "" },
  );
}

type PostRow = Tables<"posts">;

/** Rows matching `ids`, read 100 ids at a time. */
async function byIds<T>(
  ids: string[],
  read: (some: string[]) => PromiseLike<Outcome<T[]>>,
): Promise<T[]> {
  const pages = await Promise.all(
    chunks(ids, 100).map((some) => all(read(some))),
  );
  return pages.flat();
}

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
    (id) => isDatabaseId(id) && !sampleBookOfRow(id) && !books.has(id),
  );
  const [profiles, bookRows, postReactions, spoilerReports, folds] =
    await Promise.all([
      byIds(authors, (some) =>
        client.from("profiles").select("*").in("id", some),
      ),
      byIds(missing, (some) =>
        client.from("books").select(BOOK_COLUMNS).in("id", some),
      ),
      userId
        ? byIds(ids, (some) =>
            client.from("post_reactions").select("*").in("post_id", some),
          )
        : [],
      userId
        ? byIds(ids, (some) =>
            client
              .from("spoiler_reports")
              .select("post_id")
              .eq("reporter_id", userId)
              .in("post_id", some),
          )
        : [],
      byIds(ids, (some) =>
        client
          .from("moderation_folds")
          .select(FOLD_COLUMNS)
          .eq("target_kind", "post")
          .in("target_id", some),
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
  const posts = () => client.from("posts").select("*");
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
      // more, so a page is still full when there is more. One read alone
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
      const found = (
        await all(
          posts()
            .is("parent_id", null)
            .in("author_id", ids)
            .lte("created_at", before)
            .order("created_at", { ascending: false })
            .limit(OLDER_PAGE + have.size),
        )
      )
        .filter((row) => !have.has(row.id))
        .slice(0, OLDER_PAGE);
      const replies = await byIds(
        found.map((row) => row.id),
        (some) => posts().in("parent_id", some),
      );
      return complete([...found, ...replies]);
    },
    async post(id) {
      if (!isDatabaseId(id)) return emptyArrived();
      const [found] = await all(posts().eq("id", id));
      if (!found) return emptyArrived();
      const top = found.parent_id ?? found.id;
      const [heads, replies] = await Promise.all([
        found.parent_id ? all(posts().eq("id", top)) : [found],
        all(posts().eq("parent_id", top)),
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
        const state = withSamples(await loadPublicTown(client));
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
        client.from("shops").update(write.patch).eq("id", ids.shopId),
      );
      return;
    case "shelves":
      await settled(
        client.from("shop_private").upsert({
          shop_id: ids.shopId,
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

const SEEN_KEY = "book-town-seen-v1:";

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
  storage?: boolean;
}

/**
 * The signed-in person's town: read from Supabase, kept in memory for the
 * screens, and saved back in the background. Changes are written by comparing
 * the town with the last one the database confirmed, so a failed save is simply
 * planned again on the next try.
 */
export function accountTownBackend(
  client: Client,
  userId: string,
  options: AccountBackendOptions = {},
): TownBackend {
  const storage = options.storage ?? typeof window !== "undefined";
  let ids: RemoteIds | null = null;
  const sync = backgroundSync<TownState>(
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
      async write(base, target) {
        if (!ids) throw new TownSyncError("The town is not loaded yet", true);
        for (const write of planWrites(base, target, ids))
          await applyWrite(client, write, ids);
        if (storage && target.seenNotifications !== base.seenNotifications)
          writeSeen(userId, target.seenNotifications);
      },
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
    load: async () => ({ state: await sync.load(), status: "saved" as const }),
    save: sync.save,
    watch: sync.watch,
    absorb: sync.absorb,
    ...remoteReads(client, userId, sync.current),
    close: sync.close,
  };
}

export { emptyTown };
