import type { Book } from "./types";
import {
  objectById,
  placementSize,
  relayoutRow,
  worldPolygon,
  type SceneObject,
  type StoreScene,
} from "./store-scene";
import {
  containerHides,
  MAX_SHELVES,
  SHELF_ID_PATTERN,
  shelfScene,
  slotOf,
  writeBackShelf,
  type ShelfId,
  type ShopLayout,
} from "./shop-layout";
import {
  presetSkeleton,
  SHELF_PRESETS,
  SHOP_WORLDS,
  type ShelfPresetId,
  type ShopWorldId,
} from "./shelf-presets";

// Commands on a whole layout. None removes a placement or a POP, none changes
// which book a placement holds or which placement a POP belongs to, and none
// lets visitors see a book its place used to hide (tests keep all three).
// Edits inside one shelf use the v1 commands through shelfScene and
// writeBackShelf instead.

/** The store ID does not matter while a shelf is worked on and written back. */
const WORKING = "layout";

function shelfIndex(L: ShopLayout, shelfId: ShelfId) {
  const i = L.shelves.findIndex((s) => s.id === shelfId);
  if (i < 0) throw new Error("Unknown shelf");
  return i;
}

/** Re-lays a row after a book left it, when the row still stands. */
function tidyRow(scene: StoreScene, rowId: string | null) {
  const row = rowId ? objectById(scene, rowId) : undefined;
  return row?.kind === "row" && worldPolygon(scene, row)
    ? relayoutRow(scene, row.id)
    : scene;
}

/** Gives one shelf another preset. Furniture and rows are matched by slot:
 * a match keeps its ID, words, chalkboard, public mark and anything unknown,
 * and takes only the preset's shape. A slot the preset lacks is put away
 * (placed: false) with its words, ready for a preset that has it again; its
 * books wait unplaced. Books keep their row, sized to it; those that no longer
 * fit wait unplaced too. The shop's shared part and other shelves stay. */
export function applyShelfPreset(
  L: ShopLayout,
  shelfId: ShelfId,
  presetId: ShelfPresetId,
  books: Book[],
): ShopLayout {
  const preset = SHELF_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error("Unknown preset");
  const shelf = L.shelves[shelfIndex(L, shelfId)];
  const before = shelfScene(L, shelfId, WORKING, { unplaced: true });
  let scene = structuredClone(before);
  const frameIds = new Set(
    shelf.objects
      .filter((o) => o.kind === "furniture" || o.kind === "row")
      .map((o) => o.id),
  );
  const frame = scene.objects.filter((o) => frameIds.has(o.id));
  const bySlot = new Map<string, SceneObject>();
  for (const o of frame) {
    const slot = slotOf(o);
    if (slot && !bySlot.has(slot)) bySlot.set(slot, o);
  }
  const skeleton = presetSkeleton(presetId, shelfId);
  const idFor = new Map(
    skeleton.map((part) => [part.id, bySlot.get(part.slot!)?.id ?? part.id]),
  );
  const kept = new Set<string>();
  for (const part of skeleton) {
    const parentId = part.parentId && idFor.get(part.parentId)!;
    const old = bySlot.get(part.slot!);
    if (!old) {
      scene.objects.push({ ...part, parentId });
      kept.add(part.id);
      continue;
    }
    const shape = {
      rect: part.rect,
      parentId,
      bookHeight: part.bookHeight,
      gap: part.gap,
      mode: part.mode,
      furnitureType: part.furnitureType,
    };
    Object.assign(old, shape);
    for (const key of ["bookHeight", "gap", "mode", "furnitureType"] as const)
      if (shape[key] === undefined) delete old[key];
    delete old.placed;
    kept.add(old.id);
  }
  for (const o of frame) if (!kept.has(o.id)) o.placed = false;
  const rows = skeleton
    .filter((part) => part.kind === "row")
    .map((part) => idFor.get(part.id)!);
  for (const p of scene.objects) {
    if (p.kind !== "book" || p.parentId === null) continue;
    if (!rows.includes(p.parentId)) {
      p.parentId = null;
      continue;
    }
    const row = objectById(scene, p.parentId)!,
      book = books.find((b) => b.id === p.bookId);
    if (book) p.preferredSize = placementSize(book, p.display!, row.bookHeight);
    // A row brought back from storage shows again; what it hid stays hidden.
    if (
      containerHides(before, objectById(before, p.id)!) &&
      !containerHides(scene, p)
    )
      p.isPublic = false;
  }
  for (const rowId of rows) scene = relayoutRow(scene, rowId);
  const next = writeBackShelf(L, shelfId, scene);
  const changed = next.shelves[shelfIndex(next, shelfId)];
  changed.presetId = presetId;
  changed.look = { ...changed.look, wood: preset.wood, paper: preset.paper };
  return next;
}

/** Changes the shop's light and how dark its room is, nothing else. */
export function applyShopWorld(
  L: ShopLayout,
  worldId: ShopWorldId,
): ShopLayout {
  const world = SHOP_WORLDS.find((w) => w.id === worldId);
  if (!world) throw new Error("Unknown world");
  const next = structuredClone(L);
  next.common.worldId = world.id;
  next.common.theme.light = world.light;
  next.common.background.darkness = world.darkness;
  return next;
}

/** A new public shelf at the end, with an empty preset frame. Shelf IDs are
 * never reused, not even a retired shelf's. */
export function addShelf(
  L: ShopLayout,
  presetId: ShelfPresetId,
  id: ShelfId = `shelf:${crypto.randomUUID()}`,
): ShopLayout {
  if (L.shelves.length >= MAX_SHELVES) throw new Error("No more shelves");
  const preset = SHELF_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error("Unknown preset");
  const objects = presetSkeleton(presetId, id);
  const used = new Set(
    [
      L.common.objects,
      ...L.shelves.map((s) => s.objects),
      L.unplaced,
      ...(L.retired ?? []).map((r) => r.shelf.objects),
    ].flatMap((list) => list.map((o) => o.id)),
  );
  if (
    !SHELF_ID_PATTERN.test(id) ||
    [...L.shelves, ...(L.retired ?? []).map((r) => r.shelf)].some(
      (s) => s.id === id,
    ) ||
    objects.some((o) => used.has(o.id))
  )
    throw new Error("Shelf ID already used");
  const next = structuredClone(L);
  next.shelves.push({
    id,
    presetId,
    isPublic: true,
    look: { wood: preset.wood, paper: preset.paper },
    objects,
  });
  return next;
}

/** Puts a shelf away. Its books and POPs wait unplaced (private if their
 * place was); its frame and words are kept among the retired shelves.
 * The last shelf stays. */
export function removeShelf(
  L: ShopLayout,
  shelfId: ShelfId,
  retiredAt = new Date().toISOString(),
): ShopLayout {
  if (L.shelves.length <= 1) throw new Error("The last shelf stays");
  const shelf = L.shelves[shelfIndex(L, shelfId)];
  const scene = shelfScene(L, shelfId, WORKING, { unplaced: false });
  const moving = new Set(
    shelf.objects
      .filter((o) => o.kind === "book" || o.kind === "bookPop")
      .map((o) => o.id),
  );
  let added = true;
  while (added) {
    added = false;
    for (const o of shelf.objects)
      if (o.parentId && moving.has(o.parentId) && !moving.has(o.id)) {
        moving.add(o.id);
        added = true;
      }
  }
  const frame: SceneObject[] = [],
    leaving: SceneObject[] = [];
  for (const o of shelf.objects) {
    const copy = structuredClone(o);
    if (!moving.has(o.id)) frame.push(copy);
    else {
      if (copy.kind === "book") {
        if (!shelf.isPublic || containerHides(scene, o)) copy.isPublic = false;
        copy.parentId = null;
      }
      leaving.push(copy);
    }
  }
  const next = structuredClone(L);
  next.shelves = next.shelves.filter((s) => s.id !== shelfId);
  next.unplaced.push(...leaving);
  next.retired = [
    ...(next.retired ?? []),
    { shelf: { ...structuredClone(shelf), objects: frame }, retiredAt },
  ];
  return next;
}

/** Moves a shelf one place earlier or later. At either end nothing happens. */
export function moveShelf(
  L: ShopLayout,
  shelfId: ShelfId,
  delta: -1 | 1,
): ShopLayout {
  const i = shelfIndex(L, shelfId),
    j = i + delta;
  if (j < 0 || j >= L.shelves.length) return L;
  const next = structuredClone(L);
  [next.shelves[i], next.shelves[j]] = [next.shelves[j], next.shelves[i]];
  return next;
}

/** Puts a placement, with its POP, at the end of another shelf's first row
 * ("tier-0", else the highest row). What does not fit there waits unplaced,
 * and the answer says so. A book leaving a private row or shelf is marked
 * private on the way (writeBackShelf). */
export function moveToShelf(
  L: ShopLayout,
  placementId: string,
  targetShelfId: ShelfId,
  books: Book[],
): { layout: ShopLayout; unplaced: boolean } {
  shelfIndex(L, targetShelfId);
  const isPlacement = (o: SceneObject) =>
    o.id === placementId && o.kind === "book";
  const home = L.shelves.find((s) => s.objects.some(isPlacement));
  if (!home && !L.unplaced.some(isPlacement))
    throw new Error("Unknown placement");
  // Off its row first. Across shelves it passes through the drawer, which
  // marks it private when its row or shelf was; within one shelf it does not.
  const off = (layout: ShopLayout, shelfId: ShelfId) => {
    const scene = shelfScene(layout, shelfId, WORKING, { unplaced: true });
    const p = objectById(scene, placementId)!,
      old = p.parentId;
    p.parentId = null;
    return tidyRow(scene, old);
  };
  const layout =
    home && home.id !== targetShelfId
      ? writeBackShelf(L, home.id, off(L, home.id))
      : L;
  const scene = off(layout, targetShelfId);
  const top = (row: SceneObject) =>
    Math.min(...worldPolygon(scene, row)!.map((point) => point.y));
  const rows = scene.objects
    .filter((o) => o.kind === "row" && worldPolygon(scene, o))
    .sort((a, b) => top(a) - top(b));
  const row = rows.find((r) => slotOf(r) === "tier-0") ?? rows[0];
  if (!row)
    return {
      layout: writeBackShelf(layout, targetShelfId, scene),
      unplaced: true,
    };
  const p = objectById(scene, placementId)!;
  p.order =
    Math.max(
      -1,
      ...scene.objects
        .filter((o) => o.kind === "book" && o.parentId === row.id)
        .map((o) => o.order ?? 0),
    ) + 1;
  p.parentId = row.id;
  const book = books.find((b) => b.id === p.bookId);
  if (book) p.preferredSize = placementSize(book, p.display!, row.bookHeight);
  const placed = relayoutRow(scene, row.id);
  return {
    layout: writeBackShelf(layout, targetShelfId, placed),
    unplaced: objectById(placed, placementId)!.parentId === null,
  };
}
