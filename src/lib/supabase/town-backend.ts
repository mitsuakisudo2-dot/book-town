import type { SupabaseClient } from "@supabase/supabase-js";
import {
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
import { counterId, type RecordKind, type TownBackend } from "../town-backend";
import { withSamples } from "../samples";
import type { TownState } from "../types";
import type { Database, Json } from "./database.generated";
import {
  all,
  backgroundSync,
  chunks,
  settled,
  shouldRetry,
  TownSyncError,
  type SyncOptions,
} from "./sync";

type Client = SupabaseClient<Database>;

export { TownSyncError, shouldRetry };

// Supabase returns at most 1000 rows a request. That covers everyone while
// Booktown is invite-only; paging comes with more readers.
const LIMIT = 1000;
const POSTS = 500;
const CATALOG = 300;

// Everything but who typed the book in, which the database does not show.
const BOOK_COLUMNS =
  "id, isbn, title, author, publisher, price, source, created_at, updated_at";

const SHOP_COLUMNS =
  "id, owner_id, name, description, tagline, theme, is_open, public_shelves, public_scene_books";

/** The newest books, and every book the rows refer to. */
async function booksFor(client: Client, rows: Omit<RemoteRows, "books">) {
  const catalog = await all(
    client
      .from("books")
      .select(BOOK_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(CATALOG),
  );
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
  const [
    profiles,
    nine,
    shops,
    follows,
    marks,
    posts,
    postReactions,
    spoilerReports,
    popReactions,
    ownSessions,
    together,
    records,
  ] = await Promise.all([
    all(client.from("profiles").select("*").limit(LIMIT)),
    all(client.from("profile_nine").select("*").limit(LIMIT)),
    all(client.from("shops").select(SHOP_COLUMNS).limit(LIMIT)),
    all(
      client.from("shop_follows").select("shop_id").eq("follower_id", userId),
    ),
    all(client.from("book_marks").select("*").eq("user_id", userId)),
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
    all(client.from("reading_sessions").select("*").eq("user_id", userId)),
    all(
      client
        .from("reading_sessions")
        .select("*")
        .eq("mode", "together")
        .is("ended_at", null)
        .neq("user_id", userId)
        .limit(LIMIT),
    ),
    // The person's own records, and others' public ones.
    all(
      client
        .from("reading_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMIT),
    ),
  ]);

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
    nine,
    shops,
    ownShelves,
    ownSceneBooks,
    ownShopFollowers,
    ownShopVisitors,
    shopMessages,
    follows,
    marks,
    posts,
    postReactions,
    spoilerReports,
    popReactions,
    sessions: [...ownSessions, ...together],
    records,
    seenNotifications,
  };
  const ids: RemoteIds = { userId, shopId: own?.id ?? newShopId() };
  return {
    state: townFromRows({ ...rows, books: await booksFor(client, rows) }, ids),
    ids,
  };
}

/**
 * Reads what anyone may see without signing in: profiles, open shops, posts
 * that are not private notes, and who is reading together right now. The
 * database decides what is public (supabase/migrations); this only asks.
 */
export async function loadPublicTown(client: Client): Promise<TownState> {
  const [profiles, nine, shops, posts, together, records] = await Promise.all([
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
    marks: [],
    posts,
    postReactions: [],
    spoilerReports: [],
    popReactions: [],
    sessions: together,
    records,
    seenNotifications: [],
  };
  return townFromRows(
    { ...rows, books: await booksFor(client, rows) },
    { userId: null, shopId: "" },
  );
}

/**
 * The town for someone who is not signed in: real shops and posts beside the
 * 見本, to look at only. The store asks them to sign in before any change
 * (store.ts), so nothing here is ever saved.
 */
export function visitorTownBackend(client: Client): TownBackend {
  return {
    kind: "visitor",
    newId: counterId,
    async load() {
      try {
        const state = withSamples(await loadPublicTown(client));
        return { state, status: "saved" as const };
      } catch {
        // The 見本 still make a town to walk through.
        const state = withSamples({ ...emptyTown(), me: visitorReader() });
        return { state, status: "unavailable" as const };
      }
    },
    save: () => "saved",
  };
}

const KEYS: Record<RelationTable, string> = {
  shop_follows: "follower_id,shop_id",
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
      await settled(
        client
          .from("books")
          .upsert(write.rows, { onConflict: "id", ...ignore }),
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
        return loaded.state;
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
    close: sync.close,
  };
}

export { emptyTown };
