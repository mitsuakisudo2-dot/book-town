/**
 * The book in hand, as one step of 戻る: the shop, the shelf (none for a
 * book placed in a shop's scene) and the item. A page shown again on that
 * step puts the same book back in hand. Apart from BookInHand.tsx, so the
 * pages that only check for it do not load the book in hand itself.
 */
export type HeldBook = {
  shopId: string;
  shelfId: string | null;
  itemId: string;
};
const HELD = "book:";
export const heldBookName = (held: HeldBook) =>
  HELD + JSON.stringify([held.shopId, held.shelfId, held.itemId]);
export function heldBookOf(name: string): HeldBook | null {
  if (!name.startsWith(HELD)) return null;
  try {
    const [shopId, shelfId, itemId] = JSON.parse(name.slice(HELD.length));
    return typeof shopId === "string" && typeof itemId === "string"
      ? {
          shopId,
          shelfId: typeof shelfId === "string" ? shelfId : null,
          itemId,
        }
      : null;
  } catch {
    return null;
  }
}
