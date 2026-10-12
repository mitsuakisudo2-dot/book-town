import {
  ownTagline,
  type Book,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownState,
} from "./types";
import {
  addBookPlacement,
  placementSize,
  SPINE_GAP,
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
/** Rows starting this far into a shelf leave room for a chalkboard beside them. */
export const SHELF_GUTTER = 0.2058;
/** Reference-store geometry (canvas units: x of width, y/h of height). */
export const WALK_LAYOUT = {
  sign: rect(0.207, 0.018, 0.676, 0.112, -2.5),
  furniture: rect(0.008, 0.185, 0.972, 0.6207),
  // Shelf-local tiers: top rail, then three tiers whose boards sit between them.
  tiers: [
    { y: 0.016916, h: 0.26905, w: 0.76749, bookHeight: 0.146 },
    { y: 0.32898, h: 0.30514, w: 0.72428, bookHeight: 0.149 },
    { y: 0.67102, h: 0.27356, w: 0.72428, bookHeight: 0.139 },
  ],
  table: rect(0.035, 0.84, 0.53, 0.15),
  ownerPop: rect(0.6, 0.842, 0.27, 0.118, 3),
  stamp: rect(0.81, 0.85, 0.05, 0.028, 10),
  // The like / POP / save / share rail stands beside the 2nd and 3rd tiers.
  controls: rect(0.918, 0.48, 0.082, 0.265),
};
const FACES_PER_TIER: Record<number, number[]> = {
  1: [2, 2, 2],
  2: [99, 99, 99],
};
const DEFAULT_DOODLES = ["travel", "daily", "forest"];
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
  const L = WALK_LAYOUT;
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
      url: "/themes/woodshop/room-bokeh-v1.webp",
      blur: 0,
      darkness: 0.04,
    },
    forbidden: [{ ...L.controls }],
    objects: [],
  };
  scene.objects.push(
    {
      id: "sign",
      kind: "sign",
      parentId: null,
      rect: { ...L.sign },
      z: 2,
      text: shop.name,
    },
    {
      id: "greeting",
      kind: "ownerPop",
      parentId: null,
      rect: { ...L.ownerPop },
      z: 5,
      text: shop.description || ownTagline(shop),
    },
    {
      id: "stamp",
      kind: "stamp",
      parentId: null,
      rect: { ...L.stamp },
      z: 6,
      stamp: variant % 2 ? "coffee" : "plane",
    },
    {
      id: "main-shelf",
      kind: "furniture",
      parentId: null,
      rect: { ...L.furniture },
      z: 1,
      furnitureType: "shelf",
    },
  );
  const split = variant === 3;
  const shelves = shop.shelves.filter((s) => s.isPublic);
  // Demo shops map each public shelf to its own tier. An owner's shop does
  // that only when it has exactly one shelf per tier; otherwise its books
  // fill the tiers from the top, so a new shop's few books stand together.
  const byShelf = shop.demo
    ? shelves.length <= L.tiers.length
    : shelves.length === L.tiers.length;
  const packed = !shop.demo && !byShelf;
  const faces = FACES_PER_TIER[variant] ?? [3, 2, 3];
  L.tiers.forEach((t, i) => {
    const shelf = byShelf
      ? shelves[i]
      : packed
        ? undefined
        : shelves[
            Math.min(
              shelves.length - 1,
              Math.floor((i * shelves.length) / L.tiers.length),
            )
          ];
    scene.objects.push({
      id: "row-" + i,
      kind: "row",
      parentId: "main-shelf",
      rect: rect(SHELF_GUTTER, t.y, t.w, t.h),
      z: 2,
      // Saved scenes round-trip through JSON, so absent fields stay absent.
      ...(shelf
        ? {
            text: shelf.name,
            doodle: (byShelf && shelf.board?.doodle) || DEFAULT_DOODLES[i],
          }
        : {}),
      ...(byShelf && shelf?.board ? { boardTitle: shelf.board.title } : {}),
      bookHeight: t.bookHeight,
      gap: variant === 2 ? 0.01 : 0.012,
      mode: variant === 2 ? "face" : "mixed",
      isPublic: true,
    });
  });
  // The table row comes after the shelf rows so templates fill the shelf first.
  if (split)
    scene.objects.push(
      {
        id: "table",
        kind: "furniture",
        parentId: null,
        rect: { ...L.table },
        z: 3,
        furnitureType: "table",
      },
      {
        id: "table-row",
        kind: "row",
        parentId: "table",
        rect: rect(0.05, 0, 0.9, 0.8),
        z: 3,
        text: "今日、手に取りたい本",
        bookHeight: 0.105,
        gap: 0.012,
        mode: "face",
        isPublic: true,
      },
    );
  const place = (
    book: Book,
    rowId: string,
    id: string,
    display: "face" | "spine",
    order: number,
  ) => {
    scene = addBookPlacement(scene, book, rowId, id, display, order);
    return objectById(scene, id)!.parentId !== null;
  };
  type Entry = { item: ShelfItem; shelf: Shelf };
  const bookOf = (e: Entry) => books.find((b) => b.id === e.item.bookId);
  const shelfEntries = shelves.flatMap((shelf) =>
    shelf.items.map((item) => ({ item, shelf })),
  );
  const known = shelfEntries.filter(bookOf);
  // An owner's shop with no face-out at all shows its first books by their
  // covers, so it does not open as a row of thin spines. Nothing is saved.
  const covers = new Set(
    shop.demo || known.some((e) => e.item.display === "face")
      ? []
      : known.slice(0, known.length >= 3 ? 2 : 1).map((e) => e.item.id),
  );
  const faceOf = (e: Entry) =>
    e.item.display === "face" || covers.has(e.item.id);
  // A tier's lead face-out stands last among the face-outs so its POP card
  // meets the spines. Demo shops show a fixed number of face-outs per tier;
  // an owner's own face/spine choice is kept as it is.
  const arrange = (entries: Entry[], i: number) => {
    const own = entries.filter(bookOf);
    const lead = own.find(faceOf) ?? own[0];
    const rest = own.filter((e) => e !== lead);
    const faceCount = shop.demo
      ? Math.min(own.length, faces[i])
      : own.filter(faceOf).length;
    const ordered = shop.demo
      ? [
          ...rest.slice(0, faceCount - 1),
          ...(lead ? [lead] : []),
          ...rest.slice(faceCount - 1),
        ]
      : [
          ...rest.filter(faceOf),
          ...(lead ? [lead] : []),
          ...rest.filter((e) => !faceOf(e)),
        ];
    return ordered.map((entry, n) => ({
      entry,
      display:
        variant === 2 || (shop.demo ? n < faceCount : faceOf(entry))
          ? ("face" as const)
          : ("spine" as const),
    }));
  };
  const fits = (entries: Entry[], i: number) => {
    let trial = scene;
    const ids = arrange(entries, i).map(({ entry, display }, n) => {
      const id = "trial:" + n;
      trial = addBookPlacement(
        trial,
        bookOf(entry)!,
        "row-" + i,
        id,
        display,
        n,
      );
      return id;
    });
    return ids.every((id) => objectById(trial, id)!.parentId !== null);
  };
  const tierItems: Entry[][] = L.tiers.map((_, i) =>
    byShelf
      ? (shelves[i]?.items ?? []).map((item) => ({ item, shelf: shelves[i] }))
      : packed
        ? []
        : shelfEntries.filter(
            (_, j, all) =>
              Math.min(
                L.tiers.length - 1,
                Math.floor((j * L.tiers.length) / all.length),
              ) === i,
          ),
  );
  if (packed) {
    // Each tier takes what fits; with no more shelves than tiers, each shelf
    // also starts on a tier of its own. What the last tier cannot hold stays
    // unplaced, as before.
    const last = L.tiers.length - 1;
    let t = 0;
    known.forEach((entry, j) => {
      if (
        j > 0 &&
        entry.shelf !== known[j - 1].shelf &&
        shelves.length <= L.tiers.length &&
        t < last
      )
        t++;
      while (t < last && !fits([...tierItems[t], entry], t)) t++;
      tierItems[t].push(entry);
    });
    // Only tiers with books carry a shelf name; a tier that continues the
    // shelf above shares its chalkboard (StoreCanvas).
    tierItems.forEach((entries, i) => {
      if (!entries[0]) return;
      const row = objectById(scene, "row-" + i)!;
      row.text = entries[0].shelf.name;
      row.doodle = DEFAULT_DOODLES[i];
    });
  }
  const used = new Set<string>();
  if (variant === 2 && !packed)
    // Face-out-only store: each tier shrinks just enough to show its whole shelf.
    tierItems.forEach((entries, i) => {
      const row = objectById(scene, "row-" + i)!;
      const width = L.tiers[i].w * L.furniture.w;
      for (const h of [0.146, 0.135, 0.125, 0.118, 0.112, 0.105, 0.098]) {
        const total = entries.reduce((sum, e) => {
          const b = bookOf(e);
          return b ? sum + placementSize(b, "face", h).w + 0.01 : sum;
        }, 0.01);
        row.bookHeight = h;
        if (total <= width) break;
      }
    });
  tierItems.forEach((entries, i) =>
    arrange(entries, i).forEach(({ entry, display }, n) => {
      const { item, shelf } = entry;
      const book = bookOf(entry)!;
      const id = "placement:" + shop.id + ":" + item.id;
      place(book, "row-" + i, id, display, n);
      objectById(scene, id)!.source = {
        shopId: shop.id,
        shelfId: shelf.id,
        itemId: item.id,
      };
      scene = setBookPop(scene, id, item.pop);
      used.add(book.id);
    }),
  );
  // Demo shops only: catalog copies fill what the shop's own books leave open.
  // Each title appears once per store; nothing about readers or popularity is generated.
  if (shop.demo && variant !== 2) {
    const genres = new Set(
      tierItems
        .flat()
        .map((e) => books.find((b) => b.id === e.item.bookId)?.genre),
    );
    const pool = books.filter((b) => !used.has(b.id));
    pool.sort(
      (a, b) => Number(genres.has(b.genre)) - Number(genres.has(a.genre)),
    );
    const shift = (variant * 5) % Math.max(1, pool.length);
    const queue = [...pool.slice(shift), ...pool.slice(0, shift)];
    const rows = [
      ...(split ? ["table-row"] : []),
      ...L.tiers.map((_, i) => "row-" + i),
    ];
    rows.forEach((rowId, r) => {
      const quota = Math.ceil(queue.length / (rows.length - r));
      for (let n = 0; n < quota; n++) {
        const id = "demo-placement:" + shop.id + ":" + rowId + ":" + n;
        const display = rowId === "table-row" ? "face" : "spine";
        const row = objectById(scene, rowId)!,
          rowW = row.rect.w * objectById(scene, row.parentId!)!.rect.w,
          end = Math.max(
            0,
            ...scene.objects
              .filter((o) => o.kind === "book" && o.parentId === rowId)
              .map((o) => o.rect.x + o.rect.w),
          ),
          free = (1 - end) * rowW - Math.min(row.gap ?? 0.004, SPINE_GAP);
        // The first title in the queue that still fits; nothing is left unplaced.
        const k = queue.findIndex((book) => {
          if (placementSize(book, display, row.bookHeight).w > free + 1e-8)
            return false;
          if (place(book, rowId, id, display, 100 + n)) return true;
          scene.objects = scene.objects.filter((o) => o.id !== id);
          return false;
        });
        if (k < 0) break;
        queue.splice(k, 1);
      }
    });
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
/** Whole sentences up to `max` characters; otherwise the full text, which CSS clamps. */
export function popExcerpt(text: string, max: number): string {
  const sentences = text.match(/[^。！？]+[。！？]?/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    if ((out + sentence).length > max) break;
    out += sentence;
  }
  return out || text;
}
/**
 * One POP card stands on each tier: the rightmost face-out with POP text, or
 * the first spine with POP text when the tier has no face-outs. Face-out-only
 * rows show a card on every cover instead, so they have no tier owner.
 */
export function tierCardOwners(scene: StoreScene): Map<string, string> {
  const owners = new Map<string, string>();
  for (const row of scene.objects.filter((o) => o.kind === "row")) {
    if (row.mode === "face") continue;
    const withPop = scene.objects
      .filter(
        (o) =>
          o.kind === "book" &&
          o.parentId === row.id &&
          bookPop(scene, o.id)?.text,
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const faces = withPop.filter((o) => o.display === "face");
    const owner = faces[faces.length - 1] ?? withPop[0];
    if (owner) owners.set(row.id, owner.id);
  }
  return owners;
}
