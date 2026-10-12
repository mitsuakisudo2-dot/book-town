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
      darkness: 0.28,
    },
    forbidden: [
      rect(0, 0, 1, 0.12),
      rect(0.83, 0.25, 0.17, 0.67),
      rect(0, 0.925, 1, 0.075),
    ],
    objects: [],
  };
  scene.objects.push(
    {
      id: "sign",
      kind: "sign",
      parentId: null,
      rect: rect(0.055, 0.135, 0.73, 0.115, -1),
      z: 2,
      text: shop.name,
    },
    {
      id: "greeting",
      kind: "ownerPop",
      parentId: null,
      rect: rect(0.08, 0.85, 0.55, 0.055, -3),
      z: 5,
      text: shop.tagline,
    },
    {
      id: "stamp",
      kind: "stamp",
      parentId: null,
      rect: rect(0.685, 0.85, 0.095, 0.05, 8),
      z: 5,
      stamp: variant % 2 ? "coffee" : "plane",
    },
  );
  const split = variant === 3;
  const furniture: SceneObject = {
    id: "main-shelf",
    kind: "furniture",
    parentId: null,
    rect: rect(0.035, 0.28, 0.77, split ? 0.42 : 0.555),
    z: 1,
    furnitureType: "shelf",
  };
  scene.objects.push(furniture);
  if (split)
    scene.objects.push({
      id: "table",
      kind: "furniture",
      parentId: null,
      rect: rect(0.1, 0.728, 0.69, 0.115),
      z: 2,
      furnitureType: "table",
    });
  const shelves = shop.shelves.filter((s) => s.isPublic);
  const source = shelves.flatMap((shelf) =>
    shelf.items.map((item) => ({ item, shelf })),
  );
  const rowCount = split ? 3 : 4;
  for (let i = 0; i < rowCount; i++)
    scene.objects.push({
      id: "row-" + i,
      kind: "row",
      parentId: "main-shelf",
      rect: rect(0.04, 0.02 + i / rowCount, 0.92, 0.92 / rowCount),
      z: 2,
      text:
        shelves[
          Math.min(
            shelves.length - 1,
            Math.floor((i * shelves.length) / rowCount),
          )
        ]?.name ?? "本のある場所",
      bookHeight: split ? 0.105 : 0.117,
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
      bookHeight: 0.093,
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
          row.id === "row-0" && variant !== 1 ? "face" : "spine",
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
