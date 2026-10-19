// 自由3枠 (資料 4章「下段：自由3ボタン」): the second row of a card in the
// scanner holds up to three buttons the reader picks and puts in order. It
// starts as 未所持・お気に入り・＋本棚 (the 資料's example), and a shelf of
// their own can have a button of its own. This device remembers the row,
// as it does the compact view.

/** 未所持, お気に入り, ＋本棚 (pick shelves), or one shelf of the reader's own. */
export type Slot = "not-owned" | "favorite" | "shelves" | `shelf:${string}`;

export const SLOT_COUNT = 3;
export const DEFAULT_SLOTS: readonly Slot[] = [
  "not-owned",
  "favorite",
  "shelves",
];
export const SLOTS_KEY = "book-town-scan-slots";

const FIXED: readonly Slot[] = ["not-owned", "favorite", "shelves"];

const isSlot = (value: unknown): value is Slot =>
  typeof value === "string" &&
  (FIXED.includes(value as Slot) ||
    (value.startsWith("shelf:") && value.length > "shelf:".length));

/** The row as kept on this device; the first row when nothing (or nothing readable) is kept. */
export function readSlots(raw: string | null): Slot[] {
  if (raw === null) return [...DEFAULT_SLOTS];
  try {
    const kept: unknown = JSON.parse(raw);
    if (!Array.isArray(kept)) return [...DEFAULT_SLOTS];
    return [...new Set(kept.filter(isSlot))].slice(0, SLOT_COUNT);
  } catch {
    return [...DEFAULT_SLOTS];
  }
}

/** The shelf a slot of one shelf names. */
export const shelfOfSlot = (slot: Slot): string | null =>
  slot.startsWith("shelf:") ? slot.slice("shelf:".length) : null;

/** The row as shown: a slot of a shelf the reader no longer has is left out. */
export const liveSlots = (
  slots: readonly Slot[],
  shelves: ReadonlySet<string>,
): Slot[] =>
  slots.filter((slot) => {
    const shelf = shelfOfSlot(slot);
    return shelf === null || shelves.has(shelf);
  });

/** Put in at the end while there is room, or taken out. */
export function toggleSlot(slots: readonly Slot[], slot: Slot): Slot[] {
  if (slots.includes(slot)) return slots.filter((one) => one !== slot);
  return slots.length < SLOT_COUNT ? [...slots, slot] : [...slots];
}

/** Put at a place in the row (dragged there), the others closing up around it. */
export function placeSlot(
  slots: readonly Slot[],
  slot: Slot,
  at: number,
): Slot[] {
  const from = slots.indexOf(slot);
  if (from < 0 || at < 0 || at >= slots.length || at === from)
    return [...slots];
  const next = slots.filter((one) => one !== slot);
  next.splice(at, 0, slot);
  return next;
}
