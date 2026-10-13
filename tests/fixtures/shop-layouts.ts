import { createRegisteredBook } from "../../src/lib/books";
import { demoBooks, demoShops } from "../../src/lib/data";
import {
  addBookPlacement,
  objectById,
  rect,
  setBookPop,
  worldPolygon,
  type SceneObject,
  type StoreScene,
} from "../../src/lib/store-scene";
import {
  applyStoreTemplate,
  changePlacement,
  migrateShopScene,
} from "../../src/lib/store-customization";
import {
  layoutFromScene,
  MAIN_SHELF_ID,
  shelfScene,
  slotOf,
  writeBackShelf,
  type ShelfId,
  type ShopLayout,
} from "../../src/lib/shop-layout";
import {
  addShelf,
  applyShelfPreset,
  removeShelf,
} from "../../src/lib/shop-layout-commands";
import { presetSkeleton, SHELF_PRESETS } from "../../src/lib/shelf-presets";
import type { Book, Shop } from "../../src/lib/types";

// Shops and layouts shared by the shelf tests here and, later, the database
// checks that compare TypeScript with SQL. The v1 scenes are built from the
// demo town each time, so they follow the samples when those change.

const registered = (id: string, title: string, author: string) =>
  createRegisteredBook(id, { title, author });
export const BOOK_A = registered(
  "00000000-0000-4000-8000-0000000000a1",
  "灯台へ",
  "ヴァージニア・ウルフ",
);
export const BOOK_B = registered(
  "00000000-0000-4000-8000-0000000000a2",
  "雪国",
  "川端康成",
);
export const BOOK_C = registered(
  "00000000-0000-4000-8000-0000000000a3",
  "砂の女",
  "安部公房",
);
export const BOOK_D = registered(
  "00000000-0000-4000-8000-0000000000a4",
  "檸檬",
  "梶井基次郎",
);
/** The demo catalogue and the four registered books. */
export const BOOKS: Book[] = [...demoBooks, BOOK_A, BOOK_B, BOOK_C, BOOK_D];
export const BOOK_IDS = new Set(BOOKS.map((b) => b.id));

/** The first demo shop as its owner's managed scene, two POPs stamped. */
export function demoScene(): StoreScene {
  let scene = migrateShopScene(demoShops[0], demoBooks);
  const [first, second] = scene.objects.filter(
    (o) => o.kind === "book" && o.source,
  );
  scene = changePlacement(scene, first.id, { stamp: "plane" }, demoBooks);
  return changePlacement(scene, second.id, { stamp: "coffee" }, demoBooks);
}

/** The demo scene in the window template: a table and its row. */
export const windowScene = () =>
  applyStoreTemplate(demoScene(), "window", demoBooks);

/** Private things of every kind a v1 scene can hold. */
export function privateScene(): StoreScene {
  let scene = demoScene();
  objectById(scene, "row-1")!.isPublic = false;
  const kept = scene.objects.find(
    (o) => o.kind === "book" && o.parentId === "row-0",
  )!;
  scene = changePlacement(scene, kept.id, { isPublic: false }, demoBooks);
  scene = addBookPlacement(scene, BOOK_A, null, "placement:waiting-a", "face");
  scene = setBookPop(scene, "placement:waiting-a", "まだ並べていない本の言葉");
  scene = addBookPlacement(scene, BOOK_B, null, "placement:waiting-b", "spine");
  scene.objects.push(
    {
      id: "label:note",
      kind: "label",
      parentId: null,
      rect: rect(0.05, 0.135, 0.3, 0.04),
      z: 4,
      text: "今週の灯り",
    },
    {
      id: "label:stored",
      kind: "label",
      parentId: null,
      rect: rect(0.4, 0.135, 0.3, 0.04),
      z: 4,
      text: "しまった札",
      placed: false,
    },
  );
  return scene;
}
/** The placement privateScene marks private on a public row. */
export const privateBookId = () =>
  demoScene().objects.find((o) => o.kind === "book" && o.parentId === "row-0")!
    .id;

/** A sign and a placed book whose parentId is "". Today's validateScene lets
 * it through and the screens read "" as no parent. */
export function emptyParentScene(): StoreScene {
  const scene = demoScene();
  objectById(scene, "sign")!.parentId = "";
  objectById(scene, EMPTY_PARENT_BOOK)!.parentId = "";
  return scene;
}
export const EMPTY_PARENT_BOOK = "placement:shop-orbit:o3";

/** A signed-in owner's scene with a sample book (named ID) and a registered one (uuid). */
export function sampleBookScene(): StoreScene {
  const shop = ownerShop([
    {
      id: "first",
      name: "最初の棚",
      capacity: 20,
      isPublic: true,
      items: [
        { id: "i1", bookId: "solaris", display: "face", pop: "見本の本" },
        { id: "i2", bookId: BOOK_A.id, display: "spine", pop: "登録した本" },
      ],
    },
  ]);
  return migrateShopScene(shop, BOOKS);
}

const ownerShop = (shelves: Shop["shelves"]): Shop => ({
  id: "mine",
  ownerId: "me",
  name: "夜の本屋",
  description: "眠れない夜のための本屋です。",
  tagline: "",
  theme: "sage",
  followers: 0,
  demo: false,
  shelves,
});

/** A shop known only by its old shelves: one public, one private. */
export function legacyOnlyShop(): { shop: Shop; books: Book[] } {
  return {
    shop: ownerShop([
      {
        id: "open",
        name: "旅の入口",
        capacity: 20,
        isPublic: true,
        items: [
          { id: "a", bookId: "momo", display: "face", pop: "公開の言葉" },
          { id: "b", bookId: BOOK_C.id, display: "spine", pop: "二冊目" },
        ],
      },
      {
        id: "closed",
        name: "秘密の棚",
        capacity: 20,
        isPublic: false,
        items: [
          {
            id: "secret",
            bookId: "walden",
            display: "face",
            pop: "秘密の言葉",
          },
        ],
      },
    ]),
    books: BOOKS,
  };
}

/** IDs in brokenLayout that must never reach visitors, nor anything on them. */
export const BROKEN_IDS = [
  "broken:orphan",
  "pop:broken:orphan",
  "broken:empty",
  "pop:broken:empty",
  "broken:number",
  "pop:broken:number",
  "broken:a",
  "broken:b",
  "broken:cycled",
  "pop:broken:cycled",
  "broken:stray-pop",
];
const brokenBook = (id: string, parentId: unknown): SceneObject[] => [
  {
    id,
    kind: "book",
    parentId: parentId as string,
    rect: rect(0.1, 0.1, 0.1, 0.8),
    z: 3,
    bookId: BOOK_A.id,
    display: "face",
    order: 0,
    preferredSize: { w: 0.05, h: 0.1 },
    isPublic: true,
  },
  {
    id: "pop:" + id,
    kind: "bookPop",
    parentId: id,
    rect: rect(0.025, 0.65, 0.95, 0.35),
    z: 5,
    text: "漏れてはいけない言葉",
  },
];
/** A layout with each way a parent can be wrong, and a private row's POPs. */
export function brokenLayout(): ShopLayout {
  const L = layoutFromScene(demoScene());
  const shelf = L.shelves[0];
  shelf.objects.find((o) => o.id === "row-1")!.isPublic = false;
  const visible = shelf.objects.find(
    (o) => o.kind === "book" && o.parentId === "row-0",
  )!;
  shelf.objects.push(
    ...brokenBook("broken:orphan", "gone"),
    ...brokenBook("broken:empty", ""),
    ...brokenBook("broken:number", 5),
    {
      id: "broken:a",
      kind: "row",
      parentId: "broken:b",
      rect: rect(0.2, 0.1, 0.7, 0.2),
      z: 2,
      isPublic: true,
    },
    {
      id: "broken:b",
      kind: "row",
      parentId: "broken:a",
      rect: rect(0.2, 0.4, 0.7, 0.2),
      z: 2,
      isPublic: true,
    },
    ...brokenBook("broken:cycled", "broken:a"),
  );
  L.unplaced.push({
    id: "broken:stray-pop",
    kind: "bookPop",
    parentId: visible.id,
    rect: rect(0.025, 0.65, 0.95, 0.35),
    z: 5,
    text: "別の入れ物から指す言葉",
  });
  return L;
}

/** Puts a new placement with a POP at the end of a shelf's first row. */
export function placeOn(
  L: ShopLayout,
  shelfId: ShelfId,
  book: Book,
  id: string,
  pop: string,
): ShopLayout {
  let scene = shelfScene(L, shelfId, "mine", { unplaced: true });
  const row = scene.objects.find(
    (o) => o.kind === "row" && slotOf(o) === "tier-0",
  )!;
  scene = addBookPlacement(scene, book, row.id, id, "face");
  return writeBackShelf(L, shelfId, setBookPop(scene, id, pop));
}

/** Three shelves: 「夏の棚」 public, the second private, the third public
 * and untitled; one more retired. */
export function threeShelves(): ShopLayout {
  let L = layoutFromScene(demoScene());
  L.shelves[0].title = "夏の棚";
  L.shelves[0].intro = "夏に読みたい本を集めました。";
  L = addShelf(L, "study", "shelf:second");
  L.shelves[1].isPublic = false;
  L = addShelf(L, "window", "shelf:third");
  L = placeOn(L, "shelf:second", BOOK_B, "placement:second-1", "非公開の棚");
  L = placeOn(L, "shelf:third", BOOK_C, "placement:third-1", "三つ目の棚");
  L.retired = [
    {
      shelf: {
        id: "shelf:spring",
        presetId: "warm",
        isPublic: true,
        title: "春の棚",
        objects: presetSkeleton("warm", "shelf:spring"),
      },
      retiredAt: "2026-10-01T00:00:00.000Z",
    },
  ];
  return L;
}

/** Written by a newer app. */
export const newerLayout = () =>
  ({ ...layoutFromScene(demoScene()), formatVersion: 3 }) as unknown;

/** Two editions of one work (the work's ID is neither book's) and a sample book. */
export function workBooks() {
  const work = "00000000-0000-4000-8000-0000000000c9";
  return {
    work,
    first: {
      ...registered(
        "00000000-0000-4000-8000-0000000000b1",
        "星の王子さま",
        "サン＝テグジュペリ",
      ),
      workId: work,
    },
    second: {
      ...registered(
        "00000000-0000-4000-8000-0000000000b2",
        "小さな王子",
        "サン＝テグジュペリ",
      ),
      workId: work,
    },
    sample: demoBooks[0],
  };
}

/** Values whose jsonb text size the tests compare with PostgreSQL's. */
export const JSONB_SAMPLES: unknown[] = [
  "窓辺で読む、短い夏の本。",
  'a"b\\c\n\t\u0001/',
  [1, [2, [3, []]], { a: { b: [null, true] } }],
  { "": "", 鍵: "値", nested: { list: [0.25, -3, "x"] } },
  {},
  [],
  0,
  -1,
  0.5,
  123456789,
  0.1 + 0.2,
  1e-7,
  -1.5e-9,
  1e21,
  1.5e300,
  true,
  null,
  "🌙📚",
  demoScene(),
];

/** A small seeded generator (mulberry32), so a failing layout can be rebuilt. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A valid layout made from a seed: 1-3 shelves of each preset, public and
 * private shelves, rows and books, books waiting unplaced, POPs, sometimes a
 * retired shelf. */
export function randomLayout(seed: number): ShopLayout {
  const random = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(random() * list.length)];
  const presets = SHELF_PRESETS.map((p) => p.id);
  let L = layoutFromScene(migrateShopScene(ownerShop([]), BOOKS));
  L = applyShelfPreset(L, MAIN_SHELF_ID, pick(presets), BOOKS);
  const count = 1 + Math.floor(random() * 3);
  for (let i = 1; i < count; i++)
    L = addShelf(L, pick(presets), `shelf:r${seed}-${i}`);
  for (const shelf of L.shelves) {
    shelf.isPublic = random() < 0.7;
    for (const o of shelf.objects)
      if (o.kind === "row") o.isPublic = random() < 0.75;
  }
  const books = 4 + Math.floor(random() * 14);
  for (let k = 0; k < books; k++) {
    const shelf = pick(L.shelves);
    const scene = shelfScene(L, shelf.id, "mine", { unplaced: true });
    const rows = scene.objects.filter(
      (o) => o.kind === "row" && worldPolygon(scene, o),
    );
    const row = random() < 0.15 ? null : pick(rows).id;
    const id = `placement:r${seed}-${k}`;
    let next = addBookPlacement(
      scene,
      pick(BOOKS),
      row,
      id,
      random() < 0.4 ? "face" : "spine",
      k,
    );
    if (random() < 0.3)
      next = changePlacement(next, id, { isPublic: random() < 0.5 }, BOOKS);
    if (random() < 0.7)
      next = changePlacement(
        next,
        id,
        { pop: "POP " + k, stamp: pick(["", "plane", "coffee", "leaf"]) },
        BOOKS,
      );
    L = writeBackShelf(L, shelf.id, next);
  }
  if (L.shelves.length > 1 && random() < 0.3)
    L = removeShelf(L, pick(L.shelves.slice(1)).id, "2026-10-01T00:00:00.000Z");
  return L;
}
