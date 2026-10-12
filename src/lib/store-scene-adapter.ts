import type { Book, Shop, TownState } from "./types";
import {
  addBookPlacement,
  bookPop,
  furnitureBooks,
  objectById,
  rect,
  setBookPop,
  worldPolygon,
  type SceneObject,
  type StoreScene,
} from "./store-scene";

export interface ReadEntry {
  id: string;
  bookId: string;
  pop: string;
  stamp?: string;
  shopId: string;
  label: string;
  legacy?: { shelfId: string; itemId: string };
}
export function sceneEntry(
  scene: StoreScene,
  placement: SceneObject,
): ReadEntry {
  const row = placement.parentId
    ? objectById(scene, placement.parentId)
    : undefined;
  return {
    id: placement.id,
    bookId: placement.bookId!,
    pop: bookPop(scene, placement.id)?.text ?? "",
    stamp: bookPop(scene, placement.id)?.stamp,
    shopId: scene.storeId,
    label: row?.text ?? "この店の本",
    legacy:
      placement.source && !scene.ownerManaged
        ? { shelfId: placement.source.shelfId, itemId: placement.source.itemId }
        : undefined,
  };
}
export function readingEntries(scene: StoreScene, furnitureId: string) {
  return furnitureBooks(scene, furnitureId).map((p) => sceneEntry(scene, p));
}
export function publicScenePops(scenes: StoreScene[]) {
  return scenes.flatMap((scene) =>
    scene.objects
      .filter(
        (o) =>
          o.kind === "book" &&
          o.parentId &&
          o.isPublic !== false &&
          objectById(scene, o.parentId)?.isPublic === true &&
          worldPolygon(scene, o),
      )
      .map((p) => sceneEntry(scene, p)),
  );
}
/** Rows starting this far into a shelf leave room for a sign beside them. */
export const SHELF_GUTTER = 0.2;
export function woodScene(shop: Shop, books: Book[], variant = 0): StoreScene {
  const lights = [
    "#ffd293",
    "#dcd7a7",
    "#edbf9e",
    "#f5dbaa",
    "#dec6ad",
    "#f2ce83",
  ];
  variant = Math.max(0, variant);
  let scene: StoreScene = {
    schemaVersion: 1,
    storeId: shop.id,
    theme: {
      id: "woodshop",
      light: lights[variant % lights.length],
      wood: "#6a371d",
      paper: "#f1dfb7",
      font: "serif",
    },
    background: {
      kind: "preset",
      url: "/themes/woodshop/room.webp",
      blur: 0,
      darkness: 0.2,
    },
    // The shop's own controls stand on the floor; the shelf fills the rest.
    forbidden: [rect(0.54, 0.895, 0.46, 0.105)],
    objects: [],
  };
  scene.objects.push(
    {
      id: "sign",
      kind: "sign",
      parentId: null,
      rect: rect(0.1, 0.012, 0.8, 0.08, -0.5),
      z: 2,
      text: shop.name,
    },
    {
      id: "greeting",
      kind: "ownerPop",
      parentId: null,
      rect: rect(0.035, 0.904, 0.48, 0.072, -1),
      z: 5,
      // The tagline hangs on the signboard; the floor POP carries the owner's own words.
      text: shop.description || shop.tagline,
    },
    {
      id: "stamp",
      kind: "stamp",
      parentId: null,
      rect: rect(0.912, 0.028, 0.068, 0.038, 8),
      z: 5,
      stamp: variant % 2 ? "coffee" : "plane",
    },
  );
  const split = variant === 3;
  const furniture: SceneObject = {
    id: "main-shelf",
    kind: "furniture",
    parentId: null,
    rect: rect(0.02, 0.147, 0.96, split ? 0.53 : 0.738),
    z: 1,
    furnitureType: "shelf",
  };
  scene.objects.push(furniture);
  if (split)
    scene.objects.push({
      id: "table",
      kind: "furniture",
      parentId: null,
      rect: rect(0.06, 0.69, 0.88, 0.195),
      z: 2,
      furnitureType: "table",
    });
  const shelves = shop.shelves.filter((s) => s.isPublic);
  const source = shelves.flatMap((shelf) =>
    shelf.items.map((item) => ({ item, shelf })),
  );
  // Few, tall rows: each book is drawn large rather than adding more books.
  const rowCount = split ? 2 : 3;
  for (let i = 0; i < rowCount; i++)
    scene.objects.push({
      id: "row-" + i,
      kind: "row",
      parentId: "main-shelf",
      // The left gutter holds a chalkboard shelf sign or a small shop object.
      rect: rect(
        SHELF_GUTTER,
        0.02 + i / rowCount,
        0.96 - SHELF_GUTTER,
        0.92 / rowCount,
      ),
      z: 2,
      text:
        shelves[
          Math.min(
            shelves.length - 1,
            Math.floor((i * shelves.length) / rowCount),
          )
        ]?.name ?? "本のある場所",
      bookHeight: 0.19,
      gap: 0.008,
      mode: variant === 1 ? "spine" : variant === 2 ? "face" : "mixed",
      isPublic: true,
    });
  if (split)
    scene.objects.push({
      id: "table-row",
      kind: "row",
      parentId: "table",
      rect: rect(0.05, 0, 0.9, 0.86),
      z: 3,
      text: "今日、手に取りたい本",
      bookHeight: 0.15,
      gap: 0.008,
      mode: "face",
      isPublic: true,
    });
  const rows = scene.objects.filter((o) => o.kind === "row");
  source.forEach(({ item, shelf }, i) => {
    const row =
      rows[
        Math.min(
          rows.length - 1,
          Math.floor((i * rows.length) / Math.max(1, source.length)),
        )
      ];
    const book = books.find((b) => b.id === item.bookId);
    if (!book) return;
    const display =
      variant === 1
        ? "spine"
        : variant === 2 ||
            row.id === "table-row" ||
            (row.id === "row-0" && i < 3)
          ? "face"
          : item.display;
    const id = "placement:" + shop.id + ":" + item.id;
    scene = addBookPlacement(scene, book, row.id, id, display, i);
    objectById(scene, id)!.source = {
      shopId: shop.id,
      shelfId: shelf.id,
      itemId: item.id,
    };
    scene = setBookPop(scene, id, item.pop);
  });
  // Existing demo shop only: additional catalog copies demonstrate a dense row.
  // No readers, catalog books, activity or popularity is generated.
  if (shop.demo && variant !== 2) {
    const genres = new Set(
      source.map((s) => books.find((b) => b.id === s.item.bookId)?.genre),
    );
    const pool = books.filter((b) => genres.has(b.genre));
    for (const row of rows) {
      if (row.id === "table-row") continue;
      for (let i = 0; pool.length && i < pool.length * 3; i++) {
        const id = "demo-placement:" + shop.id + ":" + row.id + ":" + i;
        scene = addBookPlacement(
          scene,
          pool[(i + variant * 3) % pool.length],
          row.id,
          id,
          // Spines only fill what the shop's own face-out books leave open.
          "spine",
          100 + i,
        );
        if (!objectById(scene, id)!.parentId) break;
      }
    }
  }
  return scene;
}
export function publicWalkShops(
  state: Pick<TownState, "shops" | "ownShop" | "books">,
) {
  return [...state.shops, ...(state.ownShop ? [state.ownShop] : [])].filter(
    (s) =>
      s.shelves.some(
        (row) =>
          row.isPublic &&
          row.items.some((p) => state.books.some((b) => b.id === p.bookId)),
      ),
  );
}
