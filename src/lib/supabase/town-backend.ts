import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyTown,
  planWrites,
  referencedBookIds,
  townFromRows,
  type RelationTable,
  type RemoteIds,
  type RemoteRows,
  type Write,
} from "../town-remote";
import {
  counterId,
  type RecordKind,
  type TownBackend,
  type TownBackendListener,
} from "../town-backend";
import type { PersistenceStatus, TownState } from "../types";
import type { Database, Json } from "./database.generated";

type Client = SupabaseClient<Database>;

/** What a Supabase request hands back, as far as saving needs to know. */
interface Outcome<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
  count?: number | null;
}

/** A request that failed: worth retrying (offline, server busy) or refused for good. */
export class TownSyncError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

/**
 * Network trouble, a busy server and an expired login get another try. Anything
 * else is the database saying no (a rule, a limit, a taken ID) and would only
 * fail again.
 */
export function shouldRetry(status: number, code = ""): boolean {
  return (
    status === 0 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    /^PGRST(00\d|30\d)$/.test(code)
  );
}

async function settled<T>(
  request: PromiseLike<Outcome<T>>,
): Promise<Outcome<T>> {
  const outcome = await request;
  if (outcome.error)
    throw new TownSyncError(
      outcome.error.message,
      shouldRetry(outcome.status, outcome.error.code),
    );
  return outcome;
}
const all = async <T>(request: PromiseLike<Outcome<T[]>>): Promise<T[]> =>
  (await settled(request)).data ?? [];

const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, index * size + size),
  );

// Supabase returns at most 1000 rows a request. That covers everyone while
// Booktown is invite-only; paging comes with more readers.
const LIMIT = 1000;
const POSTS = 500;
const CATALOG = 300;

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
  ] = await Promise.all([
    all(client.from("profiles").select("*").limit(LIMIT)),
    all(client.from("profile_nine").select("*").limit(LIMIT)),
    all(
      client
        .from("shops")
        .select(
          "id, owner_id, name, description, tagline, theme, is_open, public_shelves",
        )
        .limit(LIMIT),
    ),
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
  ]);

  const own = shops.find((shop) => shop.owner_id === userId);
  let ownShelves: Json = [];
  let ownShopFollowers = 0;
  if (own) {
    const [privateRows, followers] = await Promise.all([
      all(client.from("shop_private").select("shelves").eq("shop_id", own.id)),
      settled(
        client
          .from("shop_follows")
          .select("shop_id", { count: "exact", head: true })
          .eq("shop_id", own.id),
      ),
    ]);
    ownShelves = privateRows[0]?.shelves ?? [];
    ownShopFollowers = followers.count ?? 0;
  }

  const rows: Omit<RemoteRows, "books"> = {
    profiles,
    nine,
    shops,
    ownShelves,
    ownShopFollowers,
    follows,
    marks,
    posts,
    postReactions,
    spoilerReports,
    popReactions,
    sessions: [...ownSessions, ...together],
    seenNotifications,
  };
  const catalog = await all(
    client
      .from("books")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(CATALOG),
  );
  const have = new Set(catalog.map((book) => book.id));
  const missing = referencedBookIds(rows).filter((id) => !have.has(id));
  const more = await Promise.all(
    chunks(missing, 100).map((ids) =>
      all(client.from("books").select("*").in("id", ids)),
    ),
  );
  const ids: RemoteIds = { userId, shopId: own?.id ?? newShopId() };
  return {
    state: townFromRows({ ...rows, books: [...catalog, ...more.flat()] }, ids),
    ids,
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

export interface AccountBackendOptions {
  /** Waits before writing, so a burst of changes goes out together. */
  delay?: number;
  /** Waits between tries while the network is down: 2s, 5s, 15s, then 30s. */
  retryDelays?: number[];
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
  const delay = options.delay ?? 400;
  const retryDelays = options.retryDelays ?? [2000, 5000, 15000, 30000];
  const storage = options.storage ?? typeof window !== "undefined";
  let ids: RemoteIds | null = null;
  let synced: TownState | null = null;
  let latest: TownState | null = null;
  let listener: TownBackendListener | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let failures = 0;
  let closed = false;

  const report = (status: PersistenceStatus) => {
    if (!closed) listener?.status(status);
  };
  const pending = () => latest !== null && latest !== synced;

  const schedule = (wait: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, wait);
  };

  async function reload(status: PersistenceStatus) {
    const fresh = await load();
    if (closed) return;
    latest = fresh.state;
    listener?.replace(fresh.state, status);
  }

  async function flush() {
    if (closed || writing || !ids || !synced || !latest) return;
    if (!pending()) return report("saved");
    writing = true;
    const base = synced;
    const target = latest;
    try {
      for (const write of planWrites(base, target, ids))
        await applyWrite(client, write, ids);
      synced = target;
      failures = 0;
      if (storage && target.seenNotifications !== base.seenNotifications)
        writeSeen(userId, target.seenNotifications);
      report(pending() ? "saving" : "saved");
    } catch (error) {
      if (error instanceof TownSyncError && error.retry) {
        report("unavailable");
        schedule(retryDelays[Math.min(failures, retryDelays.length - 1)]);
        failures += 1;
        return;
      }
      // The database refused: show the town as it really is.
      failures = 0;
      try {
        await reload("recovered");
      } catch {
        report("unavailable");
        schedule(retryDelays[0]);
      }
      return;
    } finally {
      writing = false;
    }
    if (pending()) schedule(delay);
  }

  const online = () => {
    if (pending()) schedule(0);
  };
  const leaving = (event: BeforeUnloadEvent) => {
    // Ask before closing the page while changes are still on their way.
    if (pending()) event.preventDefault();
  };

  async function load() {
    for (let attempt = 0; ; attempt++) {
      try {
        const loaded = await loadTown(
          client,
          userId,
          storage ? readSeen(userId) : [],
          () => ids?.shopId ?? crypto.randomUUID(),
        );
        ids = loaded.ids;
        synced = loaded.state;
        return { state: loaded.state, status: "saved" as const };
      } catch (error) {
        if (closed || !(error instanceof TownSyncError && error.retry))
          throw error;
        report("unavailable");
        await new Promise((resume) =>
          setTimeout(
            resume,
            retryDelays[Math.min(attempt, retryDelays.length - 1)],
          ),
        );
      }
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", leaving);
  }

  return {
    kind: "account",
    newId(kind: RecordKind, existing: string[], isbn?: string | null) {
      // Shelves and their books live inside the shop's own record.
      return kind === "shelf" || kind === "item"
        ? counterId(kind, existing, isbn)
        : crypto.randomUUID();
    },
    load,
    save(state) {
      if (!synced) return "loading";
      latest = state;
      if (!pending()) return "saved";
      if (!writing) schedule(delay);
      return "saving";
    },
    watch(next) {
      listener = next;
      return () => {
        if (listener === next) listener = null;
      };
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", online);
        window.removeEventListener("beforeunload", leaving);
      }
    },
  };
}

export { emptyTown };
