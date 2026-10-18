import { isDatabaseId } from "./record-kind";
import { validateScene, type StoreScene } from "./store-scene";
import {
  OWN_SHOP_ID,
  POP_REACTIONS,
  SHOP_MESSAGE_MAX_LENGTH,
  type PopReaction,
} from "./types";
import type { Tables, TablesInsert } from "./supabase/database.types";
import type { WalkData } from "./walk-backend";
import type { WalkPosition } from "./walk-repository";
import { emptyWalk, type ShopReaction } from "./walk-state";

/**
 * The signed-in walk, translated between database rows and the WalkData the
 * screens use. As in town-remote.ts, the person's own shop keeps the alias
 * "mine" on screen; every other shop keeps its database id.
 *
 * Nothing here talks to the network: supabase/walk-backend.ts reads the rows
 * and runs the writes this module plans.
 */

export interface WalkIds {
  userId: string;
  /** The person's shop, once it is in the database. */
  shopId: string | null;
}

export interface WalkRows {
  /** The whole scene of the person's own shop, private parts included. */
  ownScene: unknown;
  /** Other shops' public scenes, as the database copied them. */
  scenes: { id: string; public_scene: unknown }[];
  reactions: Pick<Tables<"shop_reactions">, "shop_id" | "liked" | "message">[];
  saved: Pick<Tables<"saved_shops">, "shop_id">[];
  popReactions: Pick<
    Tables<"pop_reactions">,
    "shop_id" | "placement_key" | "reaction"
  >[];
  visits: Pick<Tables<"shop_visits">, "shop_id" | "visited_at">[];
}

/**
 * How a reaction to a POP in a store scene is keyed in pop_reactions. POPs on
 * the old shelves use [shelfId, itemId] (town-remote.ts), so the two never mix.
 */
export const scenePlacementKey = (placementId: string) =>
  JSON.stringify({ scene: placementId });

function parseScenePlacement(key: string): string | null {
  try {
    const value: unknown = JSON.parse(key);
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { scene?: unknown }).scene === "string"
      ? (value as { scene: string }).scene
      : null;
  } catch {
    return null;
  }
}

/** The key the walk uses on screen (placementReactionKey in store-customization). */
const screenKey = (storeId: string, placementId: string) =>
  JSON.stringify(["scene", storeId, placementId]);

export function parseScreenKey(key: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) &&
      value.length === 3 &&
      value[0] === "scene" &&
      typeof value[1] === "string" &&
      typeof value[2] === "string"
      ? [value[1], value[2]]
      : null;
  } catch {
    return null;
  }
}

/** A scene from the database, if it is well formed; labelled with its shop. */
export function sceneFromRow(
  value: unknown,
  storeId: string,
): StoreScene | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scene = { ...(value as object), storeId } as StoreScene;
  try {
    return validateScene(scene).length ? null : scene;
  } catch {
    return null;
  }
}

/**
 * Builds the walk from the database rows and this device's walk position.
 * A visitor's has no shop of their own (shopId null) and only others' scenes.
 */
export function walkFromRows(
  rows: WalkRows,
  ids: Pick<WalkIds, "shopId">,
  position: WalkPosition,
): WalkData {
  const alias = (shopId: string) =>
    shopId === ids.shopId ? OWN_SHOP_ID : shopId;

  const reactions: Record<string, ShopReaction> = {};
  const reactionFor = (shopId: string) =>
    (reactions[alias(shopId)] ??= { liked: false, saved: false, message: "" });
  for (const row of rows.reactions) {
    const entry = reactionFor(row.shop_id);
    entry.liked = row.liked;
    entry.message = row.message;
  }
  for (const row of rows.saved) reactionFor(row.shop_id).saved = true;

  const placementReactions: Record<string, PopReaction[]> = {};
  for (const row of rows.popReactions) {
    const placement = parseScenePlacement(row.placement_key);
    if (!placement || !POP_REACTIONS.includes(row.reaction as PopReaction))
      continue;
    const key = screenKey(alias(row.shop_id), placement);
    placementReactions[key] = [
      ...new Set([
        ...(placementReactions[key] ?? []),
        row.reaction as PopReaction,
      ]),
    ];
  }

  const visits: Record<string, string> = {};
  for (const row of rows.visits)
    if (Number.isFinite(Date.parse(row.visited_at)))
      visits[alias(row.shop_id)] = row.visited_at;

  const own = sceneFromRow(rows.ownScene, OWN_SHOP_ID);
  const scenes = rows.scenes
    .filter((row) => row.id !== ids.shopId)
    .map((row) => sceneFromRow(row.public_scene, row.id))
    .filter((scene): scene is StoreScene => scene !== null);

  return {
    state: {
      ...emptyWalk(),
      ...position,
      visits,
      reactions,
      placementReactions,
    },
    scenes: own ? [own, ...scenes] : scenes,
    backups: [],
  };
}

// Writes ------------------------------------------------------------------------

type Pair = Record<string, string>;

/** Tables keyed by (user_id, shop_id). */
export type ShopTable = "shop_reactions" | "saved_shops" | "shop_visits";

/** One step of saving. Each one can be run again safely after a failure. */
export type WalkWrite =
  /** The person's own scene; null takes it down. */
  | { kind: "scene"; scene: StoreScene | null }
  | { kind: "reactions"; rows: TablesInsert<"shop_reactions">[] }
  | { kind: "visits"; rows: TablesInsert<"shop_visits">[] }
  | { kind: "saved"; rows: TablesInsert<"saved_shops">[] }
  | { kind: "pops"; rows: TablesInsert<"pop_reactions">[] }
  | { kind: "forget"; table: ShopTable; shopIds: string[] }
  | { kind: "unpop"; rows: Pair[] };

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Pop reactions as rows, for shops the database knows. */
function popRows(
  data: WalkData,
  real: (id: string) => string | null,
  userId: string,
): Pair[] {
  return Object.entries(data.state.placementReactions).flatMap(
    ([key, values]) => {
      const parsed = parseScreenKey(key);
      const shopId = parsed && real(parsed[0]);
      if (!parsed || !shopId) return [];
      return values.map((reaction) => ({
        user_id: userId,
        shop_id: shopId,
        placement_key: scenePlacementKey(parsed[1]),
        reaction,
      }));
    },
  );
}

/**
 * What to write so the database holds `next`, given that it already holds
 * `base`. Only the person's own records are written. Shops that are not in the
 * database (the demo's) are skipped, and so is the person's own shop until it
 * has been saved.
 */
export function planWalkWrites(
  base: WalkData,
  next: WalkData,
  ids: WalkIds,
): WalkWrite[] {
  const writes: WalkWrite[] = [];
  const user_id = ids.userId;
  const real = (id: string) => {
    const shopId = id === OWN_SHOP_ID ? ids.shopId : id;
    return shopId && isDatabaseId(shopId) ? shopId : null;
  };

  const own = (data: WalkData) =>
    data.scenes.find((scene) => scene.storeId === OWN_SHOP_ID) ?? null;
  if (!sameJson(own(base), own(next)))
    writes.push({ kind: "scene", scene: own(next) });

  const said = (reaction?: ShopReaction) =>
    !!reaction && (reaction.liked || reaction.message !== "");
  const reacted: TablesInsert<"shop_reactions">[] = [];
  const unreacted: string[] = [];
  const saved: TablesInsert<"saved_shops">[] = [];
  const unsaved: string[] = [];
  for (const id of new Set([
    ...Object.keys(base.state.reactions),
    ...Object.keys(next.state.reactions),
  ])) {
    const shop_id = real(id);
    if (!shop_id) continue;
    const before = base.state.reactions[id];
    const after = next.state.reactions[id];
    if (
      said(after) &&
      (!said(before) ||
        before!.liked !== after!.liked ||
        before!.message !== after!.message)
    )
      reacted.push({
        user_id,
        shop_id,
        liked: after!.liked,
        message: after!.message.slice(0, SHOP_MESSAGE_MAX_LENGTH),
      });
    else if (said(before) && !said(after)) unreacted.push(shop_id);
    if (!before?.saved && after?.saved) saved.push({ user_id, shop_id });
    else if (before?.saved && !after?.saved) unsaved.push(shop_id);
  }

  const visited: TablesInsert<"shop_visits">[] = [];
  const unvisited: string[] = [];
  for (const id of new Set([
    ...Object.keys(base.state.visits),
    ...Object.keys(next.state.visits),
  ])) {
    const shop_id = real(id);
    if (!shop_id) continue;
    const before = base.state.visits[id];
    const after = next.state.visits[id];
    if (after && after !== before)
      visited.push({ user_id, shop_id, visited_at: after });
    else if (before && !after) unvisited.push(shop_id);
  }

  const beforePops = popRows(base, real, user_id);
  const afterPops = popRows(next, real, user_id);
  const had = new Set(beforePops.map((row) => JSON.stringify(row)));
  const has = new Set(afterPops.map((row) => JSON.stringify(row)));

  if (unreacted.length)
    writes.push({
      kind: "forget",
      table: "shop_reactions",
      shopIds: unreacted,
    });
  if (unsaved.length)
    writes.push({ kind: "forget", table: "saved_shops", shopIds: unsaved });
  if (unvisited.length)
    writes.push({ kind: "forget", table: "shop_visits", shopIds: unvisited });
  const unpopped = beforePops.filter((row) => !has.has(JSON.stringify(row)));
  if (unpopped.length) writes.push({ kind: "unpop", rows: unpopped });

  if (reacted.length) writes.push({ kind: "reactions", rows: reacted });
  if (saved.length) writes.push({ kind: "saved", rows: saved });
  if (visited.length) writes.push({ kind: "visits", rows: visited });
  const popped = afterPops.filter((row) => !had.has(JSON.stringify(row)));
  if (popped.length)
    writes.push({
      kind: "pops",
      rows: popped as TablesInsert<"pop_reactions">[],
    });
  return writes;
}

/** Every kind of walk write, to tell one kept on the device (outbox.ts). */
const WALK_WRITE_KINDS: Record<WalkWrite["kind"], true> = {
  scene: true,
  reactions: true,
  visits: true,
  saved: true,
  pops: true,
  forget: true,
  unpop: true,
};

/** Whether `value` is a walk write as this app keeps one (isWrite). */
export const isWalkWrite = (value: unknown): value is WalkWrite =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { kind?: unknown }).kind === "string" &&
  Object.hasOwn(WALK_WRITE_KINDS, (value as { kind: string }).kind);

/**
 * A walk write of several rows as one write a row (splitWrite in
 * town-remote.ts); none for the scene, which is one thing.
 */
export function splitWalkWrite(write: WalkWrite): WalkWrite[] {
  switch (write.kind) {
    case "reactions":
    case "visits":
    case "saved":
    case "pops":
      return write.rows.map((row) => ({ ...write, rows: [row] }) as WalkWrite);
    case "unpop":
      return write.rows.map((row) => ({ ...write, rows: [row] }));
    case "forget":
      return write.shopIds.map((shopId) => ({ ...write, shopIds: [shopId] }));
    case "scene":
      return [];
  }
}

/**
 * The person's own scene as `data` holds it, for a scene write kept on the
 * device (writeStake in town-remote.ts). The shop's id is left out, as the
 * database and the screens name it apart (sceneMark).
 */
export function walkStake(
  data: WalkData,
  write: WalkWrite,
): { key: string; value: unknown } | undefined {
  if (write.kind !== "scene") return undefined;
  const own = data.scenes.find((scene) => scene.storeId === OWN_SHOP_ID);
  return { key: "scene", value: own ? { ...own, storeId: "" } : null };
}
