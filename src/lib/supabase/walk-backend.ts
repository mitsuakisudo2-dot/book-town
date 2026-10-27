import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyWalkData,
  type WalkBackend,
  type WalkData,
} from "../walk-backend";
import {
  isWalkWrite,
  planWalkWrites,
  splitWalkWrite,
  sceneFromRow,
  walkFromRows,
  walkStake,
  type WalkIds,
  type WalkRows,
  type WalkWrite,
} from "../walk-remote";
import { loadPosition, noPosition, savePosition } from "../walk-repository";
import { isDatabaseId } from "../record-kind";
import type { StoreScene } from "../store-scene";
import type { Database, Json } from "./database.generated";
import { deviceOutbox, WALK_OUTBOX_KEY } from "../outbox";
import {
  all,
  allRows,
  backgroundSync,
  settled,
  steadily,
  TownSyncError,
  Versioned,
  type SyncOptions,
  type Versions,
} from "./sync";

type Client = SupabaseClient<Database>;

async function ownShopId(client: Client, userId: string) {
  const rows = await all(
    client.from("shops").select("id").eq("owner_id", userId),
  );
  return rows[0]?.id ?? null;
}

/**
 * The person's own scene and the version the database counts of it
 * (write_versions): 0 while their shop has none, or there is no shop yet.
 * A database from before versions has none, and the scene is read alone.
 */
async function ownSceneOf(
  client: Client,
  shopId: string | null,
): Promise<{ scene: Json | null; versions: Versions }> {
  const asked = client.from("shop_private").select("scene, scene_version");
  const outcome = await (shopId ? asked.eq("shop_id", shopId) : asked.limit(0));
  if (outcome.error?.code === "42703") {
    const rows = shopId
      ? await all(
          client.from("shop_private").select("scene").eq("shop_id", shopId),
        )
      : [];
    return { scene: rows[0]?.scene ?? null, versions: {} };
  }
  const rows = (await settled(Promise.resolve(outcome))).data ?? [];
  const version = rows.length ? rows[0].scene_version : 0;
  return {
    scene: rows[0]?.scene ?? null,
    // Only a version the database named: a row without one is written the
    // old way, as the town does a profile without nine_version.
    versions: typeof version === "number" ? { scene: version } : {},
  };
}

/** Shops asked for their scenes in one request: well within a URL. */
const SCENES_AT_ONCE = 50;

/**
 * The public scenes of the shops `ids`, as walk-backend's `scenes` hands
 * them over: each shop asked for once, null for one the database has no
 * scene of (or does not let the reader see), or one not well formed.
 */
export async function scenesOf(
  client: Client,
  ids: string[],
): Promise<Map<string, StoreScene | null>> {
  const asked = [...new Set(ids)].filter(isDatabaseId);
  const found = new Map<string, StoreScene | null>(
    asked.map((id) => [id, null]),
  );
  for (let at = 0; at < asked.length; at += SCENES_AT_ONCE) {
    const rows = await all(
      client
        .from("shops")
        .select("id, public_scene")
        .in("id", asked.slice(at, at + SCENES_AT_ONCE)),
    );
    for (const row of rows)
      found.set(row.id, sceneFromRow(row.public_scene, row.id));
  }
  return found;
}

/**
 * Reads the walk `userId` sees, or a visitor (null) sees: which shops the
 * database lets them see a public scene of, each list whole, a page at a
 * time (allRows, as the town); the scenes themselves are read when a shop is
 * walked to (scenesOf, AUD-006). Signed in, also their own scene (with its
 * version) and what they did on their walks, and their own shop's id.
 */
export async function loadWalkRows(
  client: Client,
  userId: string | null,
): Promise<{ rows: WalkRows; shopId: string | null; versions: Versions }> {
  /** What only the signed-in person reads: nothing for a visitor. */
  const own = async <T>(read: (id: string) => Promise<T[]>): Promise<T[]> =>
    userId === null ? [] : read(userId);
  const [shopId, elsewhere, reactions, saved, popReactions, visits] =
    await Promise.all([
      userId === null ? null : ownShopId(client, userId),
      // Others' shops: the person's own scene is read whole below.
      allRows(
        (count) => {
          const shown = client
            .from("shops")
            .select("id", { count })
            .not("public_scene", "is", null);
          return userId === null ? shown : shown.neq("owner_id", userId);
        },
        ["id"],
      ).then((rows) => rows.map((row) => row.id)),
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
  const mine =
    userId === null
      ? { scene: null, versions: {} }
      : await ownSceneOf(client, shopId);
  return {
    rows: {
      ownScene: mine.scene,
      scenes: [],
      elsewhere,
      reactions,
      saved,
      popReactions,
      visits,
    },
    shopId,
    versions: mine.versions,
  };
}

/**
 * Runs one planned write. Each can run twice without harm. The scene with
 * the version it began from (`base`) is written only over that version
 * (save_scene), and the version it is at handed back; without one (a
 * database from before versions), the old way.
 */
export async function applyWalkWrite(
  client: Client,
  write: WalkWrite,
  ids: WalkIds,
  base?: number,
): Promise<Versions | void> {
  switch (write.kind) {
    case "scene": {
      // The shop is saved by the town; the scene waits for it.
      if (!ids.shopId)
        throw new TownSyncError("The shop is not saved yet", true);
      const scene = write.scene && { ...write.scene, storeId: ids.shopId };
      if (base !== undefined) {
        const { data } = await settled(
          client.rpc("save_scene", {
            shop: ids.shopId,
            value: scene as unknown as Json,
            base,
          }),
        );
        if (typeof data !== "number")
          throw new TownSyncError(
            "The database did not answer a version",
            true,
          );
        return { scene: data };
      }
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
  /** Where changes wait to be sent (outbox.ts): the browser's, with storage. */
  device?: Parameters<typeof deviceOutbox>[2];
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
  const device = options.device ?? (storage ? undefined : null);
  let ids: WalkIds | null = null;
  const loaded = () => {
    if (!ids) throw new TownSyncError("The walk is not loaded yet", true);
    return ids;
  };
  const sync = backgroundSync<WalkData, WalkWrite>(
    {
      async read() {
        const loaded = await loadWalkRows(client, userId);
        ids = { userId, shopId: loaded.shopId };
        return new Versioned(
          walkFromRows(
            loaded.rows,
            ids,
            storage ? loadPosition(userId) : noPosition(),
          ),
          loaded.versions,
        );
      },
      plan: (base, target) => planWalkWrites(base, target, loaded()),
      async prepare() {
        // A shop opened since the walk was read: find it once it is saved.
        const known = loaded();
        known.shopId ??= await ownShopId(client, userId);
      },
      apply: (write, base) => applyWalkWrite(client, write, loaded(), base),
      split: splitWalkWrite,
      stake: walkStake,
      // The shop's scene is its shelves as the reader arranged them.
      stumble: (write) => (write.kind === "scene" ? "shelf" : null),
      outbox:
        device === null
          ? undefined
          : deviceOutbox(WALK_OUTBOX_KEY + userId, isWalkWrite, device),
    },
    options,
  );
  return {
    kind: "account",
    load: async () => ({ data: await sync.load(), status: sync.loaded() }),
    save(data) {
      if (storage) savePosition(userId, data.state);
      return sync.save(data);
    },
    writable: () => true,
    scenes: (ids) => scenesOf(client, ids),
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
    scenes: (ids) => scenesOf(client, ids),
  };
}
