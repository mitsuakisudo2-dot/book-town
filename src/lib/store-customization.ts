import {
  popReactionKey,
  type Book,
  type Shop,
  type TownState,
  type BookDisplay,
  type PopReaction,
} from "./types";
import {
  addBookPlacement,
  bookPop,
  furnitureBooks,
  objectById,
  placementWidth,
  SHELF_DOODLES,
  relayoutRow,
  setBookPop,
  validateScene,
  worldPolygon,
  type StoreScene,
  type SceneObject,
} from "./store-scene";
import { woodScene } from "./store-scene-adapter";

export const STORE_TEMPLATES = [
  {
    id: "warm",
    name: "灯りの本屋",
    description: "琥珀の灯りと、使い込んだ木の棚。",
    variant: 0,
    wood: "#6a371d",
    paper: "#f2dfb9",
    light: "#ffd293",
    darkness: 0.04,
  },
  {
    id: "study",
    name: "夜の書斎",
    description: "濃い木と、静かに並ぶ背表紙。",
    variant: 1,
    wood: "#38271e",
    paper: "#e7dfcb",
    light: "#dfd9bd",
    darkness: 0.18,
  },
  {
    id: "window",
    name: "窓辺の選書",
    description: "明るい木の棚と、今日の一冊を置く平台。",
    variant: 3,
    wood: "#93633c",
    paper: "#f8eaca",
    light: "#ffe3af",
    darkness: 0,
  },
] as const;
export type TemplateId = (typeof STORE_TEMPLATES)[number]["id"];
export interface SceneBackup {
  storeId: string;
  shop: Shop;
  migratedAt: string;
}
export const placementReactionKey = (scene: StoreScene, p: SceneObject) =>
  JSON.stringify(["scene", scene.storeId, p.id]);

/** Old private items are kept unplaced and private. The old Shop is never mutated. */
export function migrateShopScene(
  shop: Shop,
  books: Book[],
  existing?: StoreScene,
): StoreScene {
  if (existing?.ownerManaged) return structuredClone(existing);
  let scene = structuredClone(existing ?? woodScene(shop, books, 0));
  scene.ownerManaged = true;
  scene.templateId ??= "warm";
  for (const shelf of shop.shelves)
    for (const item of shelf.items) {
      const id = "placement:" + shop.id + ":" + item.id;
      let p = objectById(scene, id);
      const book = books.find((b) => b.id === item.bookId);
      if (!book) continue;
      if (!p) {
        scene = addBookPlacement(scene, book, null, id, item.display);
        scene = setBookPop(scene, id, item.pop);
        p = objectById(scene, id)!;
        p.source = { shopId: shop.id, shelfId: shelf.id, itemId: item.id };
      }
      p.isPublic = shelf.isPublic;
    }
  return scene;
}
export function importedPlacementReactions(
  scene: StoreScene,
  state: TownState,
) {
  const result: Record<string, PopReaction[]> = {};
  for (const p of scene.objects.filter((o) => o.kind === "book"))
    if (p.source) {
      const values =
        state.popReactions[
          popReactionKey(p.source.shopId, p.source.shelfId, p.source.itemId)
        ];
      if (values?.length) result[placementReactionKey(scene, p)] = [...values];
    }
  return result;
}
/** Only explicitly public, placed objects enter browsing and POP discovery. */
export function publicStoreScene(scene: StoreScene): StoreScene {
  const hidden = new Set(
    scene.objects
      .filter(
        (o) =>
          o.placed === false ||
          (o.kind === "row" && o.isPublic !== true) ||
          (o.kind === "book" && (o.isPublic === false || !o.parentId)),
      )
      .map((o) => o.id),
  );
  let added = true;
  while (added) {
    added = false;
    for (const o of scene.objects)
      if (o.parentId && hidden.has(o.parentId) && !hidden.has(o.id)) {
        hidden.add(o.id);
        added = true;
      }
  }
  return { ...scene, objects: scene.objects.filter((o) => !hidden.has(o.id)) };
}
export function hasPublicSceneBooks(scene: StoreScene, books: Book[]) {
  const ids = new Set(books.map((b) => b.id));
  return publicStoreScene(scene).objects.some(
    (o) => o.kind === "book" && ids.has(o.bookId!) && worldPolygon(scene, o),
  );
}
export function resolveStoreScene(
  shop: Shop,
  books: Book[],
  variant: number,
  overrides: StoreScene[],
): StoreScene {
  const saved = overrides.find((s) => s.storeId === shop.id);
  const candidate = saved ?? woodScene(shop, books, variant);
  return publicStoreScene(candidate);
}
/** Templates change furniture and palette. Book/POP IDs and explicit privacy survive. */
export function applyStoreTemplate(
  scene: StoreScene,
  id: TemplateId,
  books: Book[],
): StoreScene {
  const template = STORE_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error("Unknown template");
  const oldRows = scene.objects.filter((o) => o.kind === "row");
  const emptyShop: Shop = {
    id: scene.storeId,
    ownerId: "",
    name: objectById(scene, "sign")?.text ?? "私の本屋",
    tagline: objectById(scene, "greeting")?.text ?? "",
    description: "",
    theme: "sage",
    followers: 0,
    demo: false,
    shelves: [],
  };
  const base = woodScene(emptyShop, books, template.variant);
  base.ownerManaged = true;
  base.templateId = id;
  base.theme = {
    ...base.theme,
    wood: template.wood,
    paper: template.paper,
    light: template.light,
  };
  base.background.darkness = template.darkness;
  const rows = base.objects.filter((o) => o.kind === "row");
  rows.forEach((row, i) => {
    row.text = oldRows[i]?.text ?? row.text;
    row.isPublic = oldRows[i]?.isPublic ?? true;
    // Chalkboard copy belongs to the shelf, not to the furniture style.
    if (oldRows[i]?.boardTitle !== undefined)
      row.boardTitle = oldRows[i].boardTitle;
    if (oldRows[i]?.doodle !== undefined) row.doodle = oldRows[i].doodle;
  });
  for (const kind of ["sign", "ownerPop", "stamp"] as const) {
    const original = scene.objects.find((o) => o.kind === kind),
      next = base.objects.find((o) => o.kind === kind);
    if (original && next) {
      next.text = original.text;
      next.stamp = original.stamp;
      next.style = original.style;
    }
  }
  const order = scene.objects
    .filter((o) => o.kind === "furniture")
    .sort((a, b) => a.rect.y - b.rect.y)
    .flatMap((f) => furnitureBooks(scene, f.id));
  const placed = new Map(order.map((p, i) => [p.id, i]));
  for (const original of scene.objects.filter((o) => o.kind === "book")) {
    const p = structuredClone(original),
      i = placed.get(p.id);
    if (
      original.parentId &&
      objectById(scene, original.parentId)?.isPublic !== true
    )
      p.isPublic = false;
    p.parentId =
      i === undefined
        ? null
        : rows[
            Math.min(
              rows.length - 1,
              Math.floor((i * rows.length) / Math.max(1, order.length)),
            )
          ].id;
    p.order = i ?? p.order;
    base.objects.push(p);
    const pop = bookPop(scene, p.id);
    if (pop) base.objects.push(structuredClone(pop));
  }
  let next = base;
  for (const row of rows) next = relayoutRow(next, row.id);
  return next;
}
export function renameSceneObject(
  scene: StoreScene,
  id: string,
  text: string,
): StoreScene {
  const next = structuredClone(scene),
    o = objectById(next, id);
  if (!o || !["row", "label", "sign", "ownerPop"].includes(o.kind))
    throw new Error("Unknown label");
  o.text = text.slice(0, o.kind === "row" ? 80 : 500);
  return next;
}
/** Chalkboard heading and drawing for one shelf row; empty title removes it. */
export function setRowBoard(
  scene: StoreScene,
  rowId: string,
  patch: { boardTitle?: string; doodle?: string },
): StoreScene {
  const next = structuredClone(scene),
    row = objectById(next, rowId);
  if (row?.kind !== "row") throw new Error("Unknown row");
  if (patch.boardTitle !== undefined) {
    const title = patch.boardTitle.slice(0, 12);
    if (title.trim()) row.boardTitle = title;
    else delete row.boardTitle;
  }
  if (patch.doodle !== undefined) {
    if (!(SHELF_DOODLES as readonly string[]).includes(patch.doodle))
      throw new Error("Unknown doodle");
    row.doodle = patch.doodle;
  }
  return next;
}
export function changePlacement(
  scene: StoreScene,
  id: string,
  patch: {
    display?: BookDisplay;
    isPublic?: boolean;
    pop?: string;
    stamp?: string;
  },
  books: Book[],
): StoreScene {
  let next = structuredClone(scene);
  const p = objectById(next, id);
  if (p?.kind !== "book") throw new Error("Unknown placement");
  if (patch.isPublic !== undefined) p.isPublic = patch.isPublic;
  if (patch.display) {
    const book = books.find((b) => b.id === p.bookId);
    if (!book) throw new Error("Unknown book");
    p.display = patch.display;
    p.preferredSize = {
      h: p.preferredSize!.h,
      w: placementWidth(book, patch.display, p.preferredSize!.h),
    };
    if (p.parentId) next = relayoutRow(next, p.parentId);
  }
  if (patch.pop !== undefined)
    next = setBookPop(next, id, patch.pop.slice(0, 10000));
  if (patch.stamp !== undefined) {
    if (!["", "plane", "coffee", "leaf"].includes(patch.stamp))
      throw new Error("Unknown stamp");
    if (!bookPop(next, id)) next = setBookPop(next, id, "");
    bookPop(next, id)!.stamp = patch.stamp;
  }
  return next;
}
export function takePlacementOff(scene: StoreScene, id: string): StoreScene {
  const next = structuredClone(scene),
    p = objectById(next, id);
  if (p?.kind !== "book") throw new Error("Unknown placement");
  const old = p.parentId;
  p.parentId = null;
  return old ? relayoutRow(next, old) : next;
}
export function insertPlacement(
  scene: StoreScene,
  id: string,
  rowId: string,
  index: number,
): StoreScene {
  let next = structuredClone(scene);
  const p = objectById(next, id),
    row = objectById(next, rowId);
  if (p?.kind !== "book" || row?.kind !== "row")
    throw new Error("Unknown placement or row");
  const old = p.parentId;
  const siblings = next.objects
    .filter((o) => o.kind === "book" && o.parentId === rowId && o.id !== id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  siblings.splice(Math.max(0, Math.min(siblings.length, index)), 0, p);
  p.parentId = rowId;
  siblings.forEach((o, i) => (o.order = i));
  if (old && old !== rowId) next = relayoutRow(next, old);
  return relayoutRow(next, rowId);
}
export function validateOwnedScene(
  scene: StoreScene,
  shop: Shop,
  books: Book[],
) {
  if (scene.storeId !== shop.id || !scene.ownerManaged)
    return ["この書店の店内ではありません"];
  return validateScene(scene, new Set(books.map((b) => b.id)));
}
