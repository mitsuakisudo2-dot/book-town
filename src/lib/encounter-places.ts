import type { Encounter } from "./library";
import type { Shop } from "./types";

/**
 * Where an encounter happened, found again from its place key: nothing of
 * the POP is kept on the encounter, so its words are read where they stand
 * now, and are gone once the POP is (管理表9).
 */

/** A POP on a shop's shelf: the key popReactionKey makes, [shop, shelf, item]. */
export function shelfPopOf(
  c: Pick<Encounter, "via" | "shopId" | "placementKey">,
  shops: readonly Shop[],
): { words: string; shelfId: string } | null {
  const key = keyOf(c);
  if (!key || key.length !== 3 || key[0] === "scene") return null;
  const [shopId, shelfId, itemId] = key;
  if (shopId !== c.shopId) return null;
  const shelf = shops
    .find((shop) => shop.id === shopId)
    ?.shelves.find((entry) => entry.id === shelfId && entry.isPublic);
  const words = shelf?.items.find((item) => item.id === itemId)?.pop.trim();
  return words ? { words, shelfId } : null;
}

/** A POP in a shop's scene (the walk): ["scene", shop, placement]. */
export function scenePopOf(
  c: Pick<Encounter, "via" | "shopId" | "placementKey">,
): { shopId: string; placementId: string } | null {
  const key = keyOf(c);
  if (!key || key.length !== 3 || key[0] !== "scene") return null;
  const [, shopId, placementId] = key;
  return shopId === c.shopId ? { shopId, placementId } : null;
}

function keyOf(
  c: Pick<Encounter, "via" | "shopId" | "placementKey">,
): string[] | null {
  if (c.via !== "pop" || !c.shopId || !c.placementKey) return null;
  try {
    const key: unknown = JSON.parse(c.placementKey);
    return Array.isArray(key) && key.every((part) => typeof part === "string")
      ? key
      : null;
  } catch {
    return null;
  }
}
