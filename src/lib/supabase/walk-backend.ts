import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyWalkData,
  type WalkBackend,
  type WalkData,
} from "../walk-backend";
import {
  planWalkWrites,
  walkFromRows,
  type WalkIds,
  type WalkRows,
  type WalkWrite,
} from "../walk-remote";
import { loadPosition, noPosition, savePosition } from "../walk-repository";
import type { Database, Json } from "./database.generated";
import {
  all,
  allRows,
  backgroundSync,
  settled,
  steadily,
  TownSyncError,
  type SyncOptions,
} from "./sync";

type Client = SupabaseClient<Database>;

async function ownShopId(client: Client, userId: string) {
  const rows = await all(
    client.from("shops").select("id").eq("owner_id", userId),
  );
  return rows[0]?.id ?? null;
}

/**
 * Reads the walk `userId` sees, or a visitor (null) sees: the public scene of
 * every shop the database lets them see, each list whole, a page at a time
 * (allRows, as the town). Signed in, also their own scene and what they did
 * on their walks, and their own shop's id.
 */
export async function loadWalkRows(
  client: Client,
  userId: string | null,
): Promise<{ rows: WalkRows; shopId: string | null }> {
  /** What only the signed-in person reads: nothing for a visitor. */
  const own = async <T>(read: (id: string) => Promise<T[]>): Promise<T[]> =>
    userId === null ? [] : read(userId);
  const [shopId, scenes, reactions, saved, popReactions, visits] =
    await Promise.all([
      userId === null ? null : ownShopId(client, userId),
      // Others' shops: the person's own scene is read whole below.
      allRows(
        (count) => {
          const shown = client
            .from("shops")
            .select("id, public_scene", { count })
            .not("public_scene", "is", null);
          return userId === null ? shown : shown.neq("owner_id", userId);
        },
        ["id"],
      ),
      own((id) =>
        allRows(
          (count) =>
            client
              .from("shop_reactions")
              .select("shop_id, liked, message", { count })
              .eq("user_id", id),
          ["shop_id"],
        ),
      ),
      own((id) =>
        allRows(
          (count) =>
            client
              .from("saved_shops")
              .select("shop_id", { count })
              .eq("user_id", id),
          ["shop_id"],
        ),
      ),
      own((id) =>
        allRows(
          (count) =>
            client
              .from("pop_reactions")
              .select("shop_id, placement_key, reaction", { count })
              .eq("user_id", id),
          ["shop_id", "placement_key", "reaction"],
        ),
      ),
      own((id) =>
        allRows(
          (count) =>
            client
              .from("shop_visits")
              .select("shop_id, visited_at", { count })
              .eq("user_id", id),
          ["shop_id"],
        ),
      ),
    ]);
  const ownScene = shopId
    ? await all(
        client.from("shop_private").select("scene").eq("shop_id", shopId),
      )
    : [];
  return {
    rows: {
      ownScene: ownScene[0]?.scene ?? null,
      scenes,
      reactions,
      saved,
      popReactions,
      visits,
    },
    shopId,
  };
}

/** Runs one planned write. Each can run twice without harm. */
export async function applyWalkWrite(
  client: Client,
  write: WalkWrite,
  ids: WalkIds,
): Promise<void> {
  switch (write.kind) {
    case "scene": {
      // The shop is saved by the town; the scene waits for it.
      if (!ids.shopId)
        throw new TownSyncError("The shop is not saved yet", true);
      const scene = write.scene && { ...write.scene, storeId: ids.shopId };
      await settled(
        client.from("shop_private").upsert({
          shop_id: ids.shopId,
          scene: scene as unknown as Json,
        }),
      );
      return;
    }
    case "reactions":
      await settled(
        client
          .from("shop_reactions")
          .upsert(write.rows, { onConflict: "user_id,shop_id" }),
      );
      return;
    case "visits":
      await settled(
        client
          .from("shop_visits")
          .upsert(write.rows, { onConflict: "user_id,shop_id" }),
      );
      return;
    case "saved":
      await settled(
        client.from("saved_shops").upsert(write.rows, {
          onConflict: "user_id,shop_id",
          ignoreDuplicates: true,
        }),
      );
      return;
    case "pops":
      await settled(
        client.from("pop_reactions").upsert(write.rows, {
          onConflict: "user_id,shop_id,placement_key,reaction",
          ignoreDuplicates: true,
        }),
      );
      return;
    case "forget":
      await settled(
        client
          .from(write.table)
          .delete()
          .eq("user_id", ids.userId)
          .in("shop_id", write.shopIds),
      );
      return;
    case "unpop":
      for (const row of write.rows)
        await settled(client.from("pop_reactions").delete().match(row));
      return;
  }
}

export interface AccountWalkOptions extends SyncOptions {
  /** Keeps where the walk stopped in this browser (off in tests). */
  storage?: boolean;
}

/**
 * The signed-in person's walk: read from Supabase and saved back in the
 * background, the same way as their town (supabase/town-backend.ts).
 */
export function accountWalkBackend(
  client: Client,
  userId: string,
  options: AccountWalkOptions = {},
): WalkBackend {
  const storage = options.storage ?? typeof window !== "undefined";
  let ids: WalkIds | null = null;
  const sync = backgroundSync<WalkData>(
    {
      async read() {
        const loaded = await loadWalkRows(client, userId);
        ids = { userId, shopId: loaded.shopId };
        return walkFromRows(
          loaded.rows,
          ids,
          storage ? loadPosition(userId) : noPosition(),
        );
      },
      async write(base, target) {
        if (!ids) throw new TownSyncError("The walk is not loaded yet", true);
        // A shop opened since the walk was read: find it once it is saved.
        ids.shopId ??= await ownShopId(client, userId);
        for (const write of planWalkWrites(base, target, ids))
          await applyWalkWrite(client, write, ids);
      },
    },
    options,
  );
  return {
    kind: "account",
    load: async () => ({ data: await sync.load(), status: "saved" as const }),
    save(data) {
      if (storage) savePosition(userId, data.state);
      return sync.save(data);
    },
    writable: () => true,
    watch: sync.watch,
    close: sync.close,
  };
}

/**
 * The walk for a visitor who is not signed in: the public part of every open
 * shop's scene. Where they walk stays on this page; likes and words ask them
 * to sign in first (walk-store.ts).
 */
export function visitorWalkBackend(client: Client): WalkBackend {
  return {
    kind: "visitor",
    async load() {
      try {
        // Rows that move while being read are read again at once.
        const loaded = await steadily(() => loadWalkRows(client, null));
        return {
          data: walkFromRows(loaded.rows, { shopId: null }, noPosition()),
          status: "saved" as const,
        };
      } catch {
        return { data: emptyWalkData(), status: "unavailable" as const };
      }
    },
    save: () => "saved",
    writable: () => true,
  };
}
