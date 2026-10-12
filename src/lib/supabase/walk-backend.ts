import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalkBackend, WalkData } from "../walk-backend";
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
  backgroundSync,
  settled,
  TownSyncError,
  type SyncOptions,
} from "./sync";

type Client = SupabaseClient<Database>;

// The same row limit as the town; paging comes with more readers.
const LIMIT = 1000;

async function ownShopId(client: Client, userId: string) {
  const rows = await all(
    client.from("shops").select("id").eq("owner_id", userId),
  );
  return rows[0]?.id ?? null;
}

/** Reads the person's walk and the scenes of every shop they can see. */
export async function loadWalkRows(
  client: Client,
  userId: string,
): Promise<{ rows: WalkRows; ids: WalkIds }> {
  const [shopId, scenes, reactions, saved, popReactions, visits] =
    await Promise.all([
      ownShopId(client, userId),
      all(
        client
          .from("shops")
          .select("id, public_scene")
          .not("public_scene", "is", null)
          .neq("owner_id", userId)
          .limit(LIMIT),
      ),
      all(
        client
          .from("shop_reactions")
          .select("shop_id, liked, message")
          .eq("user_id", userId),
      ),
      all(client.from("saved_shops").select("shop_id").eq("user_id", userId)),
      all(
        client
          .from("pop_reactions")
          .select("shop_id, placement_key, reaction")
          .eq("user_id", userId),
      ),
      all(
        client
          .from("shop_visits")
          .select("shop_id, visited_at")
          .eq("user_id", userId),
      ),
    ]);
  const own = shopId
    ? await all(
        client.from("shop_private").select("scene").eq("shop_id", shopId),
      )
    : [];
  return {
    rows: {
      ownScene: own[0]?.scene ?? null,
      scenes,
      reactions,
      saved,
      popReactions,
      visits,
    },
    ids: { userId, shopId },
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
        ids = loaded.ids;
        return walkFromRows(
          loaded.rows,
          loaded.ids,
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
