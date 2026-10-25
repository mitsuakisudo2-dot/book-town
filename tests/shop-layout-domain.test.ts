import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { demoBooks } from "../src/lib/data";
import {
  objectById,
  placementSize,
  reachableOnly,
  rect,
  setRowStyle,
  validateScene,
  type SceneObject,
  type StoreScene,
} from "../src/lib/store-scene";
import { woodScene } from "../src/lib/store-scene-adapter";
import {
  changePlacement,
  migrateShopScene,
  publicStoreScene,
  renameSceneObject,
  setRowBoard,
  STORE_TEMPLATES,
} from "../src/lib/store-customization";
import {
  discardDraft,
  dropKinds,
  hiddenSincePublished,
  HARD_MAX_SHELVES,
  jsonbTextBytes,
  keptKeys,
  layoutFromLegacyShop,
  layoutFromScene,
  legacySlot,
  lostKeys,
  MAIN_SHELF_ID,
  MAX_SHELVES,
  protectedKeys,
  PUBLIC_KINDS,
  publicFingerprint,
  publicShelfScene,
  publicShelfScenes,
  readableScene,
  repairLost,
  shelfScene,
  slotOf,
  stripOwnerData,
  validateLayout,
  writeBackShelf,
  type LayoutCheck,
  type RetiredShelf,
  type ShelfDoc,
  type ShelfId,
  type ShopLayout,
} from "../src/lib/shop-layout";
import {
  addShelf,
  applyShelfPreset,
  applyShopWorld,
  moveShelf,
  moveToShelf,
  removeShelf,
} from "../src/lib/shop-layout-commands";
import {
  presetSkeleton,
  SHELF_PRESETS,
  SHOP_WORLDS,
  type ShelfPresetId,
} from "../src/lib/shelf-presets";
import { sameWork, workOf } from "../src/lib/works";
import {
  BOOK_A,
  BOOK_B,
  BOOK_D,
  BOOK_IDS,
  BOOKS,
  BROKEN_IDS,
  brokenLayout,
  demoScene,
  EMPTY_PARENT_BOOK,
  emptyParentScene,
  JSONB_SAMPLES,
  legacyOnlyShop,
  mulberry32,
  newerLayout,
  placeOn,
  privateBookId,
  privateScene,
  randomLayout,
  sampleBookScene,
  threeShelves,
  windowScene,
  workBooks,
} from "./fixtures/shop-layouts";

// Checks the shop layout: a v1 scene becomes one shelf and back without loss,
// no command loses a placement or POP or shows what was private, and what
// visitors get of each shelf is filtered as the database will filter it.
// Everything runs inside main() because tsx compiles this file as CommonJS.

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed++;
  console.log("PASS " + name);
}

const PRESETS = SHELF_PRESETS.map((p) => p.id);
const byId = (objects: SceneObject[]) =>
  [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const sorted = (keys: Set<string>) => [...keys].sort();
const ok = (check: LayoutCheck) => {
  assert.deepEqual(check, { ok: true });
};
const errorsOf = (check: LayoutCheck) => {
  assert.equal(check.ok, false);
  assert.ok(!check.ok && !check.newer, "expected errors, not a newer format");
  return !check.ok && !check.newer ? check.errors.join("\n") : "";
};
/** Every book and POP pair visitors can see in the layout. */
const visibleKeys = (L: ShopLayout) =>
  new Set(publicShelfScenes(L, "s").flatMap((scene) => [...keptKeys(scene)]));
const visibleIds = (L: ShopLayout) =>
  new Set(
    publicShelfScenes(L, "s").flatMap((scene) =>
      scene.objects.map((o) => o.id),
    ),
  );
const subset = (small: Set<string>, large: Set<string>, what: string) => {
  for (const key of small) assert.ok(large.has(key), what + ": " + key);
};
const shelfOf = (L: ShopLayout, id: string) =>
  L.shelves.find((s) => s.id === id)!;
const everything = (L: ShopLayout) => [
  ...L.common.objects,
  ...L.shelves.flatMap((s) => s.objects),
  ...L.unplaced,
  ...(L.retired ?? []).flatMap((r) => r.shelf.objects),
];
const find = (L: ShopLayout, id: string) =>
  everything(L).find((o) => o.id === id);
/** Every way a command may change a layout must keep its pairs and its validity. */
const keepsEverything = (
  before: ShopLayout,
  after: ShopLayout,
  what: string,
) => {
  assert.deepEqual(sorted(keptKeys(after)), sorted(keptKeys(before)), what);
  ok(validateLayout(after, { bookIds: BOOK_IDS }));
};

async function main() {
  const legacy = legacyOnlyShop();
  const scenes: [string, () => StoreScene][] = [
    ["the demo shop", demoScene],
    ["the window template", windowScene],
    ["private rows, books, labels and unplaced books", privateScene],
    ["a sample book and a registered one", sampleBookScene],
    [
      "a shop of old shelves only",
      () => migrateShopScene(legacy.shop, legacy.books),
    ],
  ];

  // 1. A v1 scene and its layout ------------------------------------------------

  await check("the fixtures are valid v1 scenes", () => {
    for (const [name, make] of scenes)
      assert.deepEqual(validateScene(make(), BOOK_IDS), [], name);
  });

  await check(
    "a v1 scene becomes one public shelf and comes back object for object",
    () => {
      for (const [name, make] of scenes) {
        const scene = make();
        const L = layoutFromScene(scene);
        ok(validateLayout(L, { bookIds: BOOK_IDS }));
        assert.equal(L.shelves.length, 1, name);
        assert.equal(L.shelves[0].id, MAIN_SHELF_ID);
        assert.equal(L.shelves[0].isPublic, true);
        assert.equal(L.shelves[0].presetId, scene.templateId ?? "warm");
        assert.equal(L.common.worldId, scene.templateId ?? "warm");
        const back = shelfScene(L, MAIN_SHELF_ID, scene.storeId, {
          unplaced: true,
        });
        assert.deepEqual(byId(back.objects), byId(scene.objects), name);
        assert.deepEqual(back.theme, scene.theme, name);
        assert.deepEqual(back.background, scene.background, name);
        assert.deepEqual(back.forbidden, scene.forbidden, name);
      }
    },
  );

  await check(
    "the shared part, the shelf and the drawer each get what is theirs",
    () => {
      const L = layoutFromScene(privateScene());
      assert.deepEqual(
        L.common.objects.map((o) => o.id),
        ["sign", "greeting", "stamp"],
      );
      assert.ok(
        L.unplaced.every((o) => o.kind === "book" || o.kind === "bookPop"),
      );
      assert.deepEqual(
        L.unplaced.filter((o) => o.kind === "book").map((o) => o.id),
        ["placement:waiting-a", "placement:waiting-b"],
      );
      assert.ok(
        shelfOf(L, MAIN_SHELF_ID).objects.some((o) => o.id === "label:note"),
      );
      assert.ok(
        shelfOf(L, MAIN_SHELF_ID).objects.some((o) => o.id === "label:stored"),
      );
      assert.deepEqual(shelfOf(L, MAIN_SHELF_ID).look, {
        wood: privateScene().theme.wood,
        paper: privateScene().theme.paper,
      });
    },
  );

  await check(
    "visitors see the same of the new shelf as of the v1 scene",
    () => {
      for (const [name, make] of scenes) {
        const scene = make();
        const L = layoutFromScene(scene);
        const shelf = publicShelfScene(L, L.shelves[0], scene.storeId, 0)!;
        assert.deepEqual(
          shelf.objects,
          stripOwnerData(publicStoreScene(scene)).objects,
          name,
        );
        assert.equal(shelf.storeId, scene.storeId);
        assert.equal(shelf.shelfId, MAIN_SHELF_ID);
        assert.equal(shelf.shelfIndex, 0);
        assert.equal(shelf.shelfTitle, "");
        assert.equal(shelf.shelfIntro, "");
        // A valid v1 scene has nothing out of reach.
        assert.deepEqual(reachableOnly(scene), scene, name);
      }
    },
  );

  await check("converting twice gives the same layout", () => {
    for (const [name, make] of scenes) {
      const scene = make();
      const L = layoutFromScene(scene);
      const again = layoutFromScene(
        shelfScene(L, MAIN_SHELF_ID, scene.storeId, { unplaced: true }),
      );
      assert.deepEqual(again, L, name);
    }
  });

  await check(
    "old shelves become a layout without touching them; private shelves stay private",
    () => {
      const { shop, books } = legacyOnlyShop();
      const before = JSON.stringify(shop);
      const L = layoutFromLegacyShop(shop, books);
      assert.equal(JSON.stringify(shop), before);
      // From the full case of three tiers that the presets are made of.
      assert.deepEqual(
        L,
        layoutFromScene(
          migrateShopScene(
            shop,
            books,
            woodScene(shop, books, 0, { tiers: "fixed" }),
          ),
        ),
      );
      const secret = L.unplaced.find((o) => o.id === "placement:mine:secret")!;
      assert.equal(secret.parentId, null);
      assert.equal(secret.isPublic, false);
      assert.ok(L.unplaced.some((o) => o.parentId === secret.id));
      assert.ok(!visibleIds(L).has(secret.id));
      assert.ok(visibleIds(L).has("placement:mine:a"));
    },
  );

  await check(
    "an empty parentId becomes null, so a scene today's screens accept can be drafted",
    () => {
      const scene = emptyParentScene();
      assert.deepEqual(validateScene(scene), []);
      const L = layoutFromScene(scene);
      ok(validateLayout(L, { bookIds: BOOK_IDS }));
      assert.ok(everything(L).every((o) => o.parentId !== ""));
      assert.equal(
        L.common.objects.find((o) => o.id === "sign")!.parentId,
        null,
      );
      const book = L.unplaced.find((o) => o.id === EMPTY_PARENT_BOOK)!;
      assert.equal(book.parentId, null);
      assert.ok(L.unplaced.some((o) => o.parentId === EMPTY_PARENT_BOOK));
      const today = stripOwnerData(publicStoreScene(scene)).objects.map((o) =>
        o.parentId === "" ? { ...o, parentId: null } : o,
      );
      assert.deepEqual(
        publicShelfScene(L, L.shelves[0], scene.storeId, 0)!.objects,
        today,
      );
      // The pairs do not use parentId for books, so nothing protected changes.
      assert.deepEqual(sorted(keptKeys(L)), sorted(keptKeys(scene)));
    },
  );

  // 2. No command loses a placement or a POP ---------------------------------------

  await check("slots come from the object, else from the old fixed IDs", () => {
    assert.equal(legacySlot("main-shelf"), "case");
    assert.equal(legacySlot("row-2"), "tier-2");
    assert.equal(legacySlot("table"), "table");
    assert.equal(legacySlot("table-row"), "table-tier");
    assert.equal(legacySlot("row-x"), undefined);
    assert.equal(legacySlot("placement:mine:a"), undefined);
    const tier = presetSkeleton("warm", "shelf:x")[1];
    assert.equal(slotOf(tier), "tier-0");
    assert.equal(slotOf({ ...tier, id: "row-1", slot: undefined }), "tier-1");
  });

  await check(
    "every preset to every preset keeps all pairs, and the round trip brings the words back",
    () => {
      const bases = [windowScene(), privateScene(), sampleBookScene()].map(
        layoutFromScene,
      );
      for (const base of bases) {
        // Words and boards of the shelf's own, to see them come back.
        let scene = shelfScene(base, MAIN_SHELF_ID, "mine", { unplaced: true });
        scene = renameSceneObject(scene, "row-0", "一段目の札");
        scene = setRowBoard(scene, "row-2", {
          boardTitle: "三段目",
          doodle: "lamp",
        });
        const marked = writeBackShelf(base, MAIN_SHELF_ID, scene);
        for (const from of PRESETS) {
          const start = applyShelfPreset(marked, MAIN_SHELF_ID, from, BOOKS);
          keepsEverything(marked, start, "to " + from);
          const frameOf = (L: ShopLayout) =>
            shelfOf(L, MAIN_SHELF_ID)
              .objects.filter((o) => o.kind === "row" || o.kind === "furniture")
              .map((o) => ({
                id: o.id,
                text: o.text,
                boardTitle: o.boardTitle,
                doodle: o.doodle,
                isPublic: o.isPublic,
                placed: o.placed,
              }));
          for (const to of PRESETS) {
            const there = applyShelfPreset(start, MAIN_SHELF_ID, to, BOOKS);
            keepsEverything(start, there, from + " to " + to);
            assert.equal(shelfOf(there, MAIN_SHELF_ID).presetId, to);
            const back = applyShelfPreset(there, MAIN_SHELF_ID, from, BOOKS);
            keepsEverything(there, back, to + " back to " + from);
            const kept = new Map(frameOf(back).map((o) => [o.id, o]));
            for (const part of frameOf(start))
              assert.deepEqual(
                kept.get(part.id),
                part,
                from + " → " + to + " → " + from,
              );
          }
        }
      }
    },
  );

  await check(
    "a preset changes one shelf's frame and colour, nothing of the shop or other shelves",
    () => {
      const L = threeShelves();
      const next = applyShelfPreset(L, "shelf:third", "study", BOOKS);
      assert.deepEqual(next.common, L.common);
      assert.deepEqual(next.shelves[0], L.shelves[0]);
      assert.deepEqual(next.shelves[1], L.shelves[1]);
      const third = shelfOf(next, "shelf:third");
      assert.equal(third.presetId, "study");
      assert.deepEqual(third.look, { wood: "#38271e", paper: "#e7dfcb" });
      // The table is put away with its words, ready to come back.
      const table = third.objects.find(
        (o) => o.id === "shelf:third/table-tier",
      )!;
      assert.equal(table.placed, false);
      assert.equal(table.text, "今日、手に取りたい本");
      assert.ok(!visibleIds(next).has("shelf:third/table-tier"));
      const again = applyShelfPreset(next, "shelf:third", "window", BOOKS);
      const back = shelfOf(again, "shelf:third").objects.find(
        (o) => o.id === "shelf:third/table-tier",
      )!;
      assert.equal(back.placed, undefined);
      assert.equal(back.text, "今日、手に取りたい本");
    },
  );

  await check(
    "a preset leaves a stored table's books unplaced and a private row's books private",
    () => {
      const L = layoutFromScene(windowScene());
      const shelf = shelfOf(L, MAIN_SHELF_ID);
      shelf.objects.find((o) => o.id === "table-row")!.isPublic = false;
      const onTable = shelf.objects
        .filter((o) => o.kind === "book" && o.parentId === "table-row")
        .map((o) => o.id);
      assert.ok(onTable.length > 0);
      const next = applyShelfPreset(L, MAIN_SHELF_ID, "warm", BOOKS);
      for (const id of onTable) {
        const p = next.unplaced.find((o) => o.id === id)!;
        assert.equal(p.parentId, null);
        assert.equal(p.isPublic, false);
      }
      assert.equal(find(next, "table")!.placed, false);
      assert.equal(find(next, "table-row")!.placed, false);
    },
  );

  await check(
    "a row brought back from storage does not show a book it was hiding",
    () => {
      const L = layoutFromScene(windowScene());
      const shelf = shelfOf(L, MAIN_SHELF_ID);
      // Broken old data: a stored row still holding a book.
      shelf.objects.find((o) => o.id === "table")!.placed = false;
      const held = shelf.objects.find(
        (o) => o.kind === "book" && o.parentId === "table-row",
      )!;
      assert.ok(!visibleIds(L).has(held.id));
      const next = applyShelfPreset(L, MAIN_SHELF_ID, "window", BOOKS);
      assert.ok(!visibleIds(next).has(held.id));
      assert.equal(find(next, held.id)!.isPublic, false);
    },
  );

  await check(
    "the world changes only the light and the room's darkness",
    () => {
      const L = threeShelves();
      for (const world of SHOP_WORLDS) {
        const next = applyShopWorld(L, world.id);
        keepsEverything(L, next, world.id);
        assert.equal(next.common.worldId, world.id);
        assert.equal(next.common.theme.light, world.light);
        assert.equal(next.common.background.darkness, world.darkness);
        const same = structuredClone(next);
        same.common.worldId = L.common.worldId;
        same.common.theme.light = L.common.theme.light;
        same.common.background.darkness = L.common.background.darkness;
        assert.deepEqual(same, L);
      }
    },
  );

  await check(
    "shelves are added up to the limit with new IDs, never a retired one",
    () => {
      let L = layoutFromScene(demoScene());
      L = addShelf(L, "window");
      const added = L.shelves[1];
      assert.match(added.id, /^shelf:[0-9a-f-]{36}$/);
      assert.equal(added.isPublic, true);
      assert.deepEqual(added.look, { wood: "#93633c", paper: "#f8eaca" });
      assert.deepEqual(added.objects, presetSkeleton("window", added.id));
      keepsEverything(layoutFromScene(demoScene()), L, "add");
      L = addShelf(L, "study");
      assert.equal(L.shelves.length, MAX_SHELVES);
      assert.throws(() => addShelf(L, "warm"), /No more shelves/);
      const three = threeShelves();
      const two = removeShelf(three, "shelf:third", "2026-10-02T00:00:00.000Z");
      assert.throws(
        () => addShelf(two, "warm", "shelf:spring"),
        /already used/,
      );
      assert.throws(() => addShelf(two, "warm", "shelf:third"), /already used/);
      assert.throws(() => addShelf(two, "warm", "shelf:main"), /already used/);
    },
  );

  await check(
    "a shelf put away sends its books to the drawer and keeps its frame and words",
    () => {
      const L = threeShelves();
      const next = removeShelf(L, "shelf:second", "2026-10-02T00:00:00.000Z");
      keepsEverything(L, next, "remove");
      assert.deepEqual(
        next.shelves.map((s) => s.id),
        [MAIN_SHELF_ID, "shelf:third"],
      );
      const retired = next.retired!.find((r) => r.shelf.id === "shelf:second")!;
      assert.equal(retired.retiredAt, "2026-10-02T00:00:00.000Z");
      assert.ok(
        retired.shelf.objects.every(
          (o) => o.kind !== "book" && o.kind !== "bookPop",
        ),
      );
      assert.deepEqual(
        retired.shelf.objects.map((o) => o.id),
        presetSkeleton("study", "shelf:second").map((o) => o.id),
      );
      // It was a private shelf: its book stays private in the drawer.
      const book = next.unplaced.find((o) => o.id === "placement:second-1")!;
      assert.equal(book.parentId, null);
      assert.equal(book.isPublic, false);
      assert.ok(next.unplaced.some((o) => o.parentId === "placement:second-1"));
      assert.throws(
        () => removeShelf(removeShelf(next, "shelf:third"), MAIN_SHELF_ID),
        /last shelf/,
      );
    },
  );

  await check(
    "a book on a private row of a public shelf put away stays private, wherever it goes next",
    () => {
      const L = threeShelves();
      find(L, "shelf:third/tier-0")!.isPublic = false;
      assert.equal(shelfOf(L, "shelf:third").isPublic, true);
      assert.ok(!visibleIds(L).has("placement:third-1"));
      const next = removeShelf(L, "shelf:third", "2026-10-02T00:00:00.000Z");
      keepsEverything(L, next, "remove");
      const book = next.unplaced.find((o) => o.id === "placement:third-1")!;
      assert.equal(book.parentId, null);
      assert.equal(book.isPublic, false);
      // Put on a public row of a public shelf later, it still does not show.
      const { layout, unplaced } = moveToShelf(
        addShelf(next, "warm", "shelf:fresh"),
        "placement:third-1",
        "shelf:fresh",
        BOOKS,
      );
      assert.equal(unplaced, false);
      assert.equal(
        find(layout, "placement:third-1")!.parentId,
        "shelf:fresh/tier-0",
      );
      assert.ok(!visibleIds(layout).has("placement:third-1"));
      // A book visitors saw leaves unmarked, ready to be shown again.
      const open = removeShelf(
        threeShelves(),
        "shelf:third",
        "2026-10-02T00:00:00.000Z",
      );
      assert.equal(find(open, "placement:third-1")!.isPublic, undefined);
    },
  );

  await check("shelves move one place and stop at the ends", () => {
    const L = threeShelves();
    const later = moveShelf(L, MAIN_SHELF_ID, 1);
    keepsEverything(L, later, "move");
    assert.deepEqual(
      later.shelves.map((s) => s.id),
      ["shelf:second", MAIN_SHELF_ID, "shelf:third"],
    );
    assert.equal(moveShelf(L, MAIN_SHELF_ID, -1), L);
    assert.equal(moveShelf(L, "shelf:third", 1), L);
    // Order is all that changed; the public shelves are renumbered.
    assert.deepEqual(
      publicShelfScenes(moveShelf(L, "shelf:third", -1), "s").map((s) => [
        s.shelfId,
        s.shelfIndex,
      ]),
      [
        [MAIN_SHELF_ID, 0],
        ["shelf:third", 1],
      ],
    );
    assert.deepEqual(
      publicShelfScenes(
        moveShelf(moveShelf(L, "shelf:third", -1), "shelf:third", -1),
        "s",
      ).map((s) => [s.shelfId, s.shelfIndex]),
      [
        ["shelf:third", 0],
        [MAIN_SHELF_ID, 1],
      ],
    );
  });

  await check(
    "a placement moves with its POP to the end of another shelf's first row",
    () => {
      const L = threeShelves();
      const id = "placement:shop-orbit:o1";
      const pop = find(L, "pop:" + id)!;
      const { layout, unplaced } = moveToShelf(L, id, "shelf:third", BOOKS);
      keepsEverything(L, layout, "move to shelf");
      assert.equal(unplaced, false);
      const third = shelfOf(layout, "shelf:third");
      const moved = third.objects.find((o) => o.id === id)!;
      assert.equal(moved.parentId, "shelf:third/tier-0");
      assert.ok(
        third.objects
          .filter((o) => o.kind === "book" && o.parentId === moved.parentId)
          .every((o) => o.order! <= moved.order!),
      );
      assert.deepEqual(
        third.objects.find((o) => o.id === pop.id),
        pop,
      );
      assert.ok(
        !shelfOf(layout, MAIN_SHELF_ID).objects.some((o) => o.id === id),
      );
      assert.ok(visibleIds(layout).has(id));
      // Its size follows the row it now stands in.
      const row = third.objects.find((o) => o.id === moved.parentId)!;
      assert.deepEqual(
        moved.preferredSize,
        placementSize(
          demoBooks.find((b) => b.id === moved.bookId)!,
          moved.display!,
          row.bookHeight,
        ),
      );
    },
  );

  await check(
    "a book takes the height of the row it comes to, by a move or by a preset",
    () => {
      const sizeOn = (p: SceneObject, bookHeight: number) =>
        placementSize(
          BOOKS.find((b) => b.id === p.bookId)!,
          p.display!,
          bookHeight,
        );
      // From the table, whose books are 0.105 high, to a shelf tier of 0.146.
      const L = addShelf(layoutFromScene(windowScene()), "warm", "shelf:next");
      const onTable = find(L, "placement:shop-orbit:o12")!;
      assert.equal(onTable.parentId, "table-row");
      assert.equal(find(L, "table-row")!.bookHeight, 0.105);
      const { layout, unplaced } = moveToShelf(
        L,
        onTable.id,
        "shelf:next",
        BOOKS,
      );
      assert.equal(unplaced, false);
      const moved = find(layout, onTable.id)!;
      assert.equal(moved.parentId, "shelf:next/tier-0");
      assert.equal(find(layout, "shelf:next/tier-0")!.bookHeight, 0.146);
      assert.deepEqual(moved.preferredSize, sizeOn(moved, 0.146));
      assert.notDeepEqual(moved.preferredSize, onTable.preferredSize);
      // A preset gives a row its own height back, and its books follow.
      let scene = shelfScene(L, MAIN_SHELF_ID, "mine", { unplaced: true });
      scene = setRowStyle(scene, "row-0", { bookHeight: 0.12 }, BOOKS);
      const lowered = writeBackShelf(L, MAIN_SHELF_ID, scene);
      const onRow0 = shelfOf(lowered, MAIN_SHELF_ID).objects.filter(
        (o) => o.kind === "book" && o.parentId === "row-0",
      );
      assert.ok(onRow0.length > 0);
      for (const p of onRow0)
        assert.deepEqual(p.preferredSize, sizeOn(p, 0.12), p.id);
      const reset = applyShelfPreset(lowered, MAIN_SHELF_ID, "warm", BOOKS);
      assert.equal(find(reset, "row-0")!.bookHeight, 0.146);
      for (const p of onRow0) {
        const after = find(reset, p.id)!;
        assert.equal(after.parentId, "row-0", p.id);
        assert.deepEqual(after.preferredSize, sizeOn(after, 0.146), p.id);
      }
    },
  );

  await check(
    "a placement leaving a private row or shelf is marked private on the way",
    () => {
      const L = threeShelves();
      const row1 = shelfOf(L, MAIN_SHELF_ID).objects.find(
        (o) => o.id === "row-1",
      )!;
      row1.isPublic = false;
      const hidden = shelfOf(L, MAIN_SHELF_ID).objects.find(
        (o) => o.kind === "book" && o.parentId === "row-1",
      )!;
      const fromRow = moveToShelf(L, hidden.id, "shelf:third", BOOKS).layout;
      assert.equal(find(fromRow, hidden.id)!.isPublic, false);
      assert.ok(!visibleIds(fromRow).has(hidden.id));
      const fromShelf = moveToShelf(
        L,
        "placement:second-1",
        MAIN_SHELF_ID,
        BOOKS,
      ).layout;
      assert.equal(find(fromShelf, "placement:second-1")!.isPublic, false);
      assert.ok(!visibleIds(fromShelf).has("placement:second-1"));
      // Within one private shelf, from a public row to another, it stays as it was.
      const inside = moveToShelf(
        L,
        "placement:second-1",
        "shelf:second",
        BOOKS,
      ).layout;
      assert.equal(find(inside, "placement:second-1")!.isPublic, undefined);
    },
  );

  await check(
    "a placement that does not fit waits unplaced, and says so",
    () => {
      let L = threeShelves();
      for (let i = 0; i < 12; i++)
        L = placeOn(L, "shelf:third", BOOK_D, "placement:fill-" + i, "");
      const full = shelfScene(L, "shelf:third", "s", { unplaced: true });
      assert.ok(
        full.objects.some(
          (o) => o.id.startsWith("placement:fill-") && o.parentId === null,
        ),
      );
      const id = "placement:shop-orbit:o1";
      const { layout, unplaced } = moveToShelf(L, id, "shelf:third", BOOKS);
      keepsEverything(L, layout, "overflow");
      assert.equal(unplaced, true);
      assert.equal(layout.unplaced.find((o) => o.id === id)!.parentId, null);
      assert.ok(layout.unplaced.some((o) => o.id === "pop:" + id));
      subset(visibleKeys(layout), visibleKeys(L), "overflow shows nothing new");
    },
  );

  await check(
    "an edit written back keeps every pair, and one that loses or swaps a pair is refused",
    () => {
      const L = layoutFromScene(privateScene());
      const scene = shelfScene(L, MAIN_SHELF_ID, "mine", { unplaced: true });
      const edited = changePlacement(
        scene,
        "placement:waiting-a",
        { pop: "書き直した言葉" },
        BOOKS,
      );
      const next = writeBackShelf(L, MAIN_SHELF_ID, edited);
      keepsEverything(L, next, "write back");
      assert.equal(
        find(next, "pop:placement:waiting-a")!.text,
        "書き直した言葉",
      );
      const without = {
        ...scene,
        objects: scene.objects.filter(
          (o) => o.id !== "pop:placement:waiting-a",
        ),
      };
      assert.throws(
        () => writeBackShelf(L, MAIN_SHELF_ID, without),
        /would lose/,
      );
      const swapped = structuredClone(scene);
      objectById(swapped, "placement:waiting-a")!.bookId = BOOK_D.id;
      assert.throws(
        () => writeBackShelf(L, MAIN_SHELF_ID, swapped),
        /would lose/,
      );
      const moved = structuredClone(scene);
      objectById(moved, "pop:placement:waiting-a")!.parentId =
        "placement:waiting-b";
      assert.throws(
        () => writeBackShelf(L, MAIN_SHELF_ID, moved),
        /would lose/,
      );
      // The drawer must come along: a scene without it would lose its books.
      assert.throws(
        () =>
          writeBackShelf(
            L,
            MAIN_SHELF_ID,
            shelfScene(L, MAIN_SHELF_ID, "mine", { unplaced: false }),
          ),
        /would lose/,
      );
      const three = threeShelves();
      const taking = shelfScene(three, "shelf:third", "mine", {
        unplaced: true,
      });
      taking.objects.push({ ...find(three, "row-0")! });
      assert.throws(
        () => writeBackShelf(three, "shelf:third", taking),
        /already used/,
      );
    },
  );

  await check(
    "fifty seeded layouts stay whole and private under every command",
    () => {
      for (let seed = 1; seed <= 50; seed++) {
        let L = randomLayout(seed);
        ok(validateLayout(L, { bookIds: BOOK_IDS }));
        const random = mulberry32(seed * 7919);
        const pick = <T>(list: readonly T[]): T =>
          list[Math.floor(random() * list.length)];
        for (let step = 0; step < 6; step++) {
          const shelf = pick(L.shelves);
          const placed = L.shelves.flatMap((s) =>
            s.objects.filter((o) => o.kind === "book").map((o) => o.id),
          );
          const choice = Math.floor(random() * 5);
          let next: ShopLayout;
          if (choice === 0)
            next = applyShelfPreset(L, shelf.id, pick(PRESETS), BOOKS);
          else if (choice === 1 && placed.length)
            next = moveToShelf(L, pick(placed), shelf.id, BOOKS).layout;
          else if (choice === 2 && L.shelves.length > 1)
            next = removeShelf(L, shelf.id, "2026-10-03T00:00:00.000Z");
          else if (choice === 3)
            next = moveShelf(L, shelf.id, random() < 0.5 ? -1 : 1);
          else next = applyShopWorld(L, pick(SHOP_WORLDS).id);
          keepsEverything(L, next, "seed " + seed + " step " + step);
          subset(
            visibleKeys(next),
            visibleKeys(L),
            "seed " + seed + " step " + step,
          );
          // A placement hidden where it stood is marked private when it leaves
          // its shelf, so no later move can show it unasked.
          const seen = visibleIds(L);
          for (const before of L.shelves) {
            const still = next.shelves.find((s) => s.id === before.id);
            for (const p of before.objects)
              if (
                p.kind === "book" &&
                !seen.has(p.id) &&
                !still?.objects.some((o) => o.id === p.id)
              )
                assert.equal(
                  find(next, p.id)!.isPublic,
                  false,
                  "seed " + seed + " step " + step + " " + p.id,
                );
          }
          L = next;
        }
      }
    },
  );

  await check(
    "back to the published version is the published layout, else the first draft",
    () => {
      const published = threeShelves(),
        base = layoutFromScene(demoScene());
      const fromPublished = discardDraft({
        scene: demoScene(),
        baseLayout: base,
        publishedLayout: published,
      })!;
      assert.deepEqual(fromPublished, published);
      assert.notEqual(fromPublished, published);
      const fromBase = discardDraft({
        scene: demoScene(),
        baseLayout: base,
        publishedLayout: null,
      })!;
      assert.deepEqual(fromBase, base);
      assert.notEqual(fromBase, base);
      assert.equal(
        discardDraft({ scene: null, baseLayout: null, publishedLayout: null }),
        null,
      );
    },
  );

  await check(
    "before any publishing, going back keeps hidden what was hidden at once",
    () => {
      // A v1 shop never published: its first draft was saved from the scene.
      const scene = demoScene();
      const base = layoutFromScene(scene);
      const book = "placement:shop-orbit:o2";
      let edited = shelfScene(base, MAIN_SHELF_ID, "mine", { unplaced: true });
      edited = changePlacement(edited, book, { isPublic: false }, BOOKS);
      objectById(edited, "row-2")!.isPublic = false;
      const draft = writeBackShelf(base, MAIN_SHELF_ID, edited);
      const ids = hiddenSincePublished(publicShelfScenes(draft, "mine"), [
        publicStoreScene(scene),
      ]);
      assert.ok(ids.includes(book) && ids.includes("row-2"));
      // Hiding at once (hide_published) has no published layout to change,
      // so it marks the v1 scene's rows and books (private.with_private).
      const hidden = structuredClone(scene);
      for (const o of hidden.objects)
        if ((o.kind === "row" || o.kind === "book") && ids.includes(o.id))
          o.isPublic = false;
      const seen = publicStoreScene(hidden).objects.map((o) => o.id);
      for (const id of ids) assert.ok(!seen.includes(id), id);
      const back = discardDraft({
        scene: hidden,
        baseLayout: base,
        publishedLayout: null,
      })!;
      ok(validateLayout(back, { bookIds: BOOK_IDS }));
      assert.equal(find(back, book)!.isPublic, false);
      assert.equal(find(back, "row-2")!.isPublic, false);
      for (const id of ids) assert.ok(!visibleIds(back).has(id), id);
      // What the owner sees is what visitors see: nothing to publish.
      assert.equal(
        publicFingerprint(publicShelfScenes(back, "mine")),
        publicFingerprint([publicStoreScene(hidden)]),
      );
      // Only marks change, and the saved first draft is left as it was.
      assert.deepEqual(sorted(keptKeys(back)), sorted(keptKeys(base)));
      assert.deepEqual(base, layoutFromScene(scene));
      // A book the scene hides is hidden in the drawer too.
      const waiting = layoutFromScene(privateScene());
      assert.notEqual(find(waiting, "placement:waiting-a")!.isPublic, false);
      const marked = privateScene();
      objectById(marked, "placement:waiting-a")!.isPublic = false;
      const fromDrawer = discardDraft({
        scene: marked,
        baseLayout: waiting,
        publishedLayout: null,
      })!;
      assert.equal(fromDrawer.unplaced[0].id, "placement:waiting-a");
      assert.equal(fromDrawer.unplaced[0].isPublic, false);
      // It only ever hides: what the first draft hides stays hidden.
      const privateBase = layoutFromScene(privateScene());
      assert.deepEqual(
        discardDraft({
          scene: demoScene(),
          baseLayout: privateBase,
          publishedLayout: null,
        }),
        privateBase,
      );
    },
  );

  await check(
    "lost placements come back unplaced and private; a placement that took another's ID gets a new one",
    () => {
      const scene = demoScene();
      const published = layoutFromScene(scene);
      const source = {
        scene,
        baseLayout: published,
        publishedLayout: published,
      };
      const protect = protectedKeys(source);
      assert.deepEqual(sorted(protect), sorted(keptKeys(scene)));
      const draft = structuredClone(published);
      const shelf = shelfOf(draft, MAIN_SHELF_ID);
      const gone = "placement:shop-orbit:o1",
        taken = "placement:shop-orbit:o2";
      const original = find(published, taken)!;
      shelf.objects = shelf.objects.filter(
        (o) => o.id !== gone && o.parentId !== gone,
      );
      shelf.objects.find((o) => o.id === taken)!.bookId = BOOK_D.id;
      // A placement only in the draft is not protected; repairing leaves it be.
      const extra = placeOn(
        draft,
        MAIN_SHELF_ID,
        BOOK_A,
        "placement:draft-only",
        "下書きだけ",
      );
      assert.deepEqual(
        lostKeys(protect, extra).sort(),
        [
          JSON.stringify(["book", gone, find(published, gone)!.bookId]),
          JSON.stringify(["bookPop", "pop:" + gone, gone]),
          JSON.stringify(["book", taken, original.bookId]),
        ].sort(),
      );
      let n = 0;
      const repaired = repairLost(
        extra,
        source,
        () => "placement:fresh-" + n++,
      );
      assert.deepEqual(lostKeys(protect, repaired), []);
      ok(validateLayout(repaired, { bookIds: BOOK_IDS }));
      const back = repaired.unplaced.find((o) => o.id === gone)!;
      assert.equal(back.parentId, null);
      assert.equal(back.isPublic, false);
      assert.ok(repaired.unplaced.some((o) => o.id === "pop:" + gone));
      const returned = repaired.unplaced.find((o) => o.id === taken)!;
      assert.equal(returned.bookId, original.bookId);
      assert.equal(returned.isPublic, false);
      assert.equal(find(repaired, "pop:" + taken)!.parentId, taken);
      const fresh = find(repaired, "placement:fresh-0")!;
      assert.equal(fresh.bookId, BOOK_D.id);
      assert.equal(fresh.parentId, original.parentId);
      assert.equal(find(repaired, "pop:placement:fresh-0")!.parentId, fresh.id);
      assert.ok(find(repaired, "placement:draft-only"));
      assert.ok(!visibleIds(repaired).has(gone));
      assert.ok(!visibleIds(repaired).has(taken));
      // What is not lost is left as it is.
      assert.deepEqual(repairLost(published, source), published);
    },
  );

  await check(
    "the v1 scene and the published layout are each protected, even without the other",
    () => {
      const scene = demoScene();
      const base = layoutFromScene(scene);
      const drop = (L: ShopLayout, id: string) => {
        const next = structuredClone(L);
        const shelf = shelfOf(next, MAIN_SHELF_ID);
        shelf.objects = shelf.objects.filter(
          (o) => o.id !== id && o.parentId !== id,
        );
        return next;
      };
      // Never published: readers have seen only the v1 scene.
      const unpublished = { scene, baseLayout: base, publishedLayout: null };
      assert.deepEqual(
        sorted(protectedKeys(unpublished)),
        sorted(keptKeys(scene)),
      );
      const v1Only = "placement:shop-orbit:o7";
      const fromScene = repairLost(drop(base, v1Only), unpublished);
      assert.deepEqual(lostKeys(protectedKeys(unpublished), fromScene), []);
      assert.equal(find(fromScene, v1Only)!.parentId, null);
      assert.equal(find(fromScene, v1Only)!.isPublic, false);
      // Published in the new form, with a book added after the move: only the
      // published layout has it, and it is protected all the same.
      const added = "placement:after-move";
      const published = placeOn(
        addShelf(base, "warm", "shelf:new"),
        "shelf:new",
        BOOK_A,
        added,
        "公開したあとで足した本",
      );
      const source = { scene, baseLayout: base, publishedLayout: published };
      const protect = protectedKeys(source);
      const pairs = [
        JSON.stringify(["book", added, BOOK_A.id]),
        JSON.stringify(["bookPop", "pop:" + added, added]),
      ];
      for (const key of pairs) {
        assert.ok(!keptKeys(scene).has(key), key);
        assert.ok(protect.has(key), key);
      }
      assert.deepEqual(
        sorted(protect),
        sorted(new Set([...keptKeys(scene), ...keptKeys(published)])),
      );
      // A draft from before it was added gets it back, private, with its POP.
      const repaired = repairLost(base, source);
      assert.deepEqual(lostKeys(protect, repaired), []);
      ok(validateLayout(repaired, { bookIds: BOOK_IDS }));
      const back = repaired.unplaced.find((o) => o.id === added)!;
      assert.equal(back.parentId, null);
      assert.equal(back.isPublic, false);
      assert.equal(find(repaired, "pop:" + added)!.parentId, added);
    },
  );

  // 3. Nothing private reaches visitors ---------------------------------------------

  await check(
    "a private placement stays hidden even when its row is made public",
    () => {
      const L = layoutFromScene(privateScene());
      const id = privateBookId();
      assert.ok(!visibleIds(L).has(id));
      const row1 = shelfOf(L, MAIN_SHELF_ID).objects.find(
        (o) => o.id === "row-1",
      )!;
      const onRow1 = shelfOf(L, MAIN_SHELF_ID)
        .objects.filter((o) => o.kind === "book" && o.parentId === "row-1")
        .map((o) => o.id);
      assert.ok(onRow1.every((p) => !visibleIds(L).has(p)));
      row1.isPublic = true;
      assert.ok(onRow1.every((p) => visibleIds(L).has(p)));
      assert.ok(!visibleIds(L).has(id));
      delete shelfOf(L, MAIN_SHELF_ID).objects.find((o) => o.id === "row-0")!
        .isPublic;
      assert.ok(
        !publicShelfScenes(L, "s")[0].objects.some(
          (o) => o.parentId === "row-0",
        ),
      );
    },
  );

  await check(
    "private shelves are not shown, and the owner's notes and old identities are stripped",
    () => {
      const L = threeShelves();
      const own = find(L, "placement:shop-orbit:o1")!;
      own.own = { note: "店主だけのメモ", savedPopId: "x" };
      const shown = publicShelfScenes(
        L,
        "00000000-0000-4000-8000-0000000000f1",
      );
      assert.ok(!shown.some((s) => s.shelfId === "shelf:second"));
      assert.ok(!visibleIds(L).has("placement:second-1"));
      assert.equal(
        publicShelfScene(L, shelfOf(L, "shelf:second"), "s", 1),
        null,
      );
      for (const scene of shown) {
        assert.equal(scene.storeId, "00000000-0000-4000-8000-0000000000f1");
        assert.ok(
          scene.objects.every((o) => !("own" in o) && !("source" in o)),
        );
      }
      assert.ok(own.source, "the layout itself keeps them");
    },
  );

  await check(
    "broken parents are refused, and visitors see none of it nor what stands on it",
    () => {
      const L = brokenLayout();
      const problems = errorsOf(validateLayout(L, { bookIds: BOOK_IDS }));
      for (const id of [
        "broken:orphan",
        "broken:empty",
        "broken:number",
        "broken:stray-pop",
      ])
        assert.match(problems, new RegExp(id + ": parent outside its place"));
      const visible = visibleIds(L);
      for (const id of BROKEN_IDS) assert.ok(!visible.has(id), id);
      const row1 = shelfOf(L, MAIN_SHELF_ID)
        .objects.filter(
          (o) =>
            o.parentId === "row-1" ||
            shelfOf(L, MAIN_SHELF_ID).objects.some(
              (p) => p.id === o.parentId && p.parentId === "row-1",
            ),
        )
        .map((o) => o.id);
      assert.ok(row1.some((id) => id.startsWith("pop:")));
      for (const id of row1) assert.ok(!visible.has(id), id);
      // Why reachableOnly comes first: the v1 filter alone would show these.
      const v1 = publicStoreScene(
        shelfScene(L, MAIN_SHELF_ID, "s", { unplaced: false }),
      ).objects.map((o) => o.id);
      assert.ok(v1.includes("broken:orphan"));
      assert.ok(v1.includes("pop:broken:number"));
      assert.ok(v1.includes("broken:cycled"));
    },
  );

  await check("only what can be reached from a root is kept", () => {
    const scene = brokenLayout();
    const all = shelfScene(scene, MAIN_SHELF_ID, "s", { unplaced: true });
    const kept = reachableOnly(all).objects.map((o) => o.id);
    for (const id of BROKEN_IDS.filter((id) => id !== "broken:stray-pop"))
      assert.ok(!kept.includes(id), id);
    assert.ok(kept.includes("broken:stray-pop"), "its parent is in this scene");
    assert.ok(kept.includes("sign"));
    assert.ok(kept.includes("row-1"));
    const missing = { ...all, objects: all.objects.map((o) => ({ ...o })) };
    delete (missing.objects[0] as Partial<SceneObject>).parentId;
    assert.ok(
      reachableOnly(missing).objects.some((o) => o.id === all.objects[0].id),
    );
    assert.deepEqual(
      reachableOnly({ ...all, objects: "none" as unknown as SceneObject[] })
        .objects,
      [],
    );
  });

  await check(
    "an ID two objects carry names neither: both go, with all that stands on them",
    () => {
      const L = layoutFromScene(demoScene());
      const loose = (id: string, kind: SceneObject["kind"], parentId: string) =>
        ({
          id,
          kind,
          parentId,
          rect: rect(0.2, 0.1, 0.1, 0.2),
          z: 3,
          isPublic: true,
          ...(kind === "book"
            ? {
                bookId: BOOK_A.id,
                display: "face",
                order: 99,
                preferredSize: { w: 0.05, h: 0.1 },
              }
            : {}),
        }) as SceneObject;
      // A second "row-0" hung on nothing, with a book and a POP on it, and a
      // book that copies the shared sign's ID.
      shelfOf(L, MAIN_SHELF_ID).objects.push(
        loose("row-0", "row", "gone"),
        loose("placement:hung", "book", "row-0"),
        loose("pop:placement:hung", "bookPop", "placement:hung"),
        loose("sign", "book", "gone"),
      );
      assert.match(
        errorsOf(validateLayout(L, { bookIds: BOOK_IDS })),
        /row-0: duplicate ID/,
      );
      const all = shelfScene(L, MAIN_SHELF_ID, "s", { unplaced: false });
      const kept = new Set(reachableOnly(all).objects.map((o) => o.id));
      // Everything whose chain passes through a doubled ID.
      const doubled = new Set(["row-0", "sign"]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const o of all.objects)
          if (o.parentId && doubled.has(o.parentId) && !doubled.has(o.id)) {
            doubled.add(o.id);
            grew = true;
          }
      }
      assert.ok(doubled.has("placement:hung"));
      assert.ok(doubled.has("pop:placement:hung"));
      assert.ok(doubled.has("placement:shop-orbit:o2"));
      const visible = visibleIds(L);
      for (const id of doubled) {
        assert.ok(!kept.has(id), id);
        assert.ok(!visible.has(id), id);
      }
      // The rest of the shelf stands as it did.
      for (const id of ["main-shelf", "row-1", "greeting", "stamp"])
        assert.ok(kept.has(id) && visible.has(id), id);
      assert.ok(visible.has("placement:shop-orbit:o7"));
    },
  );

  await check(
    "a kind visitors may not see yet stays with the owner, with what stands on it",
    () => {
      assert.ok(!PUBLIC_KINDS.includes("poster"));
      const L = threeShelves();
      shelfOf(L, MAIN_SHELF_ID).objects.push(
        {
          id: "poster:1",
          kind: "poster" as SceneObject["kind"],
          parentId: null,
          rect: rect(0.05, 0.14, 0.3, 0.04),
          z: 4,
          posterRef: { posterId: "00000000-0000-4000-8000-0000000000d1" },
        },
        {
          id: "stamp:on-poster",
          kind: "stamp",
          parentId: "poster:1",
          rect: rect(0.1, 0.1, 0.2, 0.2),
          z: 5,
        },
      );
      const visible = visibleIds(L);
      assert.ok(!visible.has("poster:1"));
      assert.ok(!visible.has("stamp:on-poster"));
      assert.ok(visible.has("row-0"));
      assert.deepEqual(
        publicShelfScenes(L, "s").map((s) => s.objects),
        publicShelfScenes(threeShelves(), "s").map((s) => s.objects),
      );
    },
  );

  // 4. Validation ------------------------------------------------------------------------

  await check(
    "the valid fixtures pass, and book IDs are only looked up when given",
    () => {
      for (const L of [
        threeShelves(),
        layoutFromScene(sampleBookScene()),
        layoutFromLegacyShop(legacy.shop, legacy.books),
        randomLayout(99),
      ])
        ok(validateLayout(L, { bookIds: BOOK_IDS }));
      const L = threeShelves();
      find(L, "placement:third-1")!.bookId = "isbn-978414X";
      ok(validateLayout(L));
      assert.match(
        errorsOf(validateLayout(L, { bookIds: BOOK_IDS })),
        /placement:third-1: invalid book/,
      );
    },
  );

  await check("validation refuses what the database would", () => {
    const refuses = (change: (L: ShopLayout) => void, reason: RegExp) => {
      const L = threeShelves();
      change(L);
      assert.match(errorsOf(validateLayout(L, { bookIds: BOOK_IDS })), reason);
    };
    refuses((L) => {
      shelfOf(L, "shelf:third").objects.push({ ...find(L, "row-0")! });
    }, /row-0: duplicate ID/);
    refuses((L) => {
      L.unplaced.push({
        ...find(L, "pop:placement:third-1")!,
        id: "pop:stray",
        parentId: "placement:third-1",
      });
    }, /pop:stray: parent outside its place/);
    refuses((L) => {
      find(L, "placement:third-1")!.parentId = "";
    }, /placement:third-1: parent outside its place/);
    refuses((L) => {
      delete (find(L, "placement:third-1") as Partial<SceneObject>).parentId;
    }, /placement:third-1: parent outside its place/);
    refuses((L) => {
      L.retired![0].shelf.objects.push({
        ...find(L, "placement:third-1")!,
        id: "placement:old",
      });
    }, /a retired shelf keeps no books/);
    refuses((L) => {
      L.shelves[0].look = { wood: "brown" };
    }, /shelf:main: invalid look/);
    refuses((L) => {
      L.common.theme.light = "#fff";
    }, /invalid theme/);
    refuses((L) => {
      L.common.background.url = "https://example.com/room.webp";
    }, /invalid background/);
    refuses((L) => {
      L.common.background.url = "/themes/../secret.webp";
    }, /invalid background/);
    refuses((L) => {
      shelfOf(L, "shelf:third").objects.push({
        id: "label:long",
        kind: "label",
        parentId: null,
        rect: rect(0.05, 0.14, 0.3, 0.04),
        z: 4,
        text: "あ".repeat(180_000),
      });
    }, /shelf:third: too large/);
    refuses((L) => {
      L.shelves = Array.from({ length: HARD_MAX_SHELVES + 1 }, (_, i) => ({
        id: `shelf:s${i}` as ShelfId,
        presetId: "warm",
        isPublic: false,
        objects: [],
      }));
    }, /shelf count/);
    refuses((L) => {
      shelfOf(L, "shelf:third").objects.push({
        ...find(L, "pop:placement:third-1")!,
        id: "poster:1",
        kind: "poster" as SceneObject["kind"],
        parentId: null,
      });
    }, /poster:1: unknown kind/);
    refuses((L) => {
      find(L, "pop:placement:third-1")!.text = "途中で\u0000切れる";
    }, /U\+0000/);
    refuses((L) => {
      find(L, "pop:placement:third-1")!.text = "月\ud83d";
    }, /half a character/);
    refuses((L) => {
      find(L, "row-0")!.posterRef = { posterId: "poster-1" };
    }, /row-0: invalid poster/);
    refuses((L) => {
      L.shelves[2].id = "shelf:spring";
    }, /duplicate shelf/);
    refuses((L) => {
      L.shelves[0].id = "shelf:with space" as ShelfId;
    }, /invalid shelf ID/);
    refuses((L) => {
      L.shelves[0].title = "あ".repeat(25);
    }, /invalid title/);
    refuses((L) => {
      L.common.objects.push({
        ...find(L, "row-0")!,
        id: "row:shared",
        parentId: null,
      });
    }, /not shared by the whole shop/);
    refuses((L) => {
      find(L, "row-0")!.textStyle = { font: "Comic Sans" };
    }, /row-0: invalid text style/);
    refuses((L) => {
      find(L, "row-0")!.layer = "sky" as SceneObject["layer"];
    }, /row-0: invalid layer/);
    refuses((L) => {
      L.shelves = [];
    }, /shelf count/);
    refuses((L) => {
      delete (L.shelves[0] as Partial<ShelfDoc>).isPublic;
    }, /shelf:main: invalid visibility/);
    refuses((L) => {
      L.unplaced.push({
        id: "label:loose",
        kind: "label",
        parentId: null,
        rect: rect(0.05, 0.14, 0.3, 0.04),
        z: 4,
        text: "まだ置いていない札",
      });
    }, /label:loose: only books wait unplaced/);
    refuses((L) => {
      find(L, "pop:placement:third-1")!.id = "p".repeat(201);
    }, /shelf:third: invalid object/);
    refuses((L) => {
      find(L, "pop:placement:third-1")!.id = "";
    }, /shelf:third: invalid object/);
    refuses((L) => {
      L.shelves[0].intro = "あ".repeat(501);
    }, /shelf:main: invalid intro/);
    refuses((L) => {
      L.shelves[0].look = { ...L.shelves[0].look, paper: "cream" };
    }, /shelf:main: invalid look/);
    refuses((L) => {
      L.shelves[0].own = { snapshotId: 5 as unknown as string };
    }, /shelf:main: invalid own data/);
    refuses((L) => {
      find(L, "row-0")!.own = { note: 5 as unknown as string };
    }, /row-0: invalid own data/);
    refuses((L) => {
      find(L, "row-0")!.textStyle = { color: "red" };
    }, /row-0: invalid text style/);
    refuses((L) => {
      (find(L, "row-0") as unknown as Record<string, unknown>)["a\u0000b"] =
        "鍵に隠れた文字";
    }, /U\+0000/);
    refuses((L) => {
      delete (L.retired![0] as Partial<RetiredShelf>).retiredAt;
    }, /retired 1: invalid/);
    refuses((L) => {
      L.retired![0].shelf.objects.push({
        id: "label:retired",
        kind: "label",
        parentId: "row-0",
        rect: rect(0.05, 0.14, 0.3, 0.04),
        z: 4,
        text: "別の本棚の段に掛けた札",
      });
    }, /label:retired: parent outside its place/);
    // Over 2MB in all, though every shelf keeps within its own limit.
    refuses((L) => {
      L.retired![0].shelf.objects.push({
        id: "label:long",
        kind: "label",
        parentId: null,
        rect: rect(0.05, 0.14, 0.3, 0.04),
        z: 4,
        text: "あ".repeat(700_000),
      });
    }, /(^|\n)too large($|\n)/);
    // Well-formed reserved values pass.
    const L = threeShelves();
    find(L, "pop:placement:third-1")!.id = "語".repeat(200);
    L.shelves[0].intro = "あ".repeat(500);
    find(L, "row-0")!.posterRef = {
      posterId: "00000000-0000-4000-8000-0000000000d1",
    };
    find(L, "row-0")!.textStyle = {
      font: "mincho",
      color: "#223344",
      size: 0.02,
      align: "center",
      vertical: true,
    };
    find(L, "row-0")!.layer = "books";
    find(L, "row-0")!.own = { note: "メモ" };
    L.shelves[0].title = "🌙".repeat(24);
    ok(validateLayout(L, { bookIds: BOOK_IDS }));
  });

  await check(
    "a newer format is opened read-only; an older or missing one is refused",
    () => {
      assert.deepEqual(validateLayout(newerLayout()), {
        ok: false,
        newer: true,
      });
      assert.match(
        errorsOf(validateLayout({ ...threeShelves(), formatVersion: 1 })),
        /format/,
      );
      assert.match(errorsOf(validateLayout(null)), /not a layout/);
      assert.match(errorsOf(validateLayout({ formatVersion: 2 })), /shape/);
    },
  );

  // 5. Other shops' scenes, read leniently --------------------------------------------

  await check(
    "unknown kinds are left out with what stands on them; the shelf stays",
    () => {
      const scene = publicStoreScene(demoScene());
      const withPoster = structuredClone(scene) as StoreScene;
      withPoster.objects.push(
        {
          id: "poster:1",
          kind: "poster" as SceneObject["kind"],
          parentId: null,
          rect: rect(0.05, 0.14, 0.3, 0.04),
          z: 4,
          posterRef: { posterId: "00000000-0000-4000-8000-0000000000d1" },
        },
        {
          id: "stamp:on-poster",
          kind: "stamp",
          parentId: "poster:1",
          rect: rect(0.1, 0.1, 0.2, 0.2),
          z: 5,
        },
      );
      assert.notDeepEqual(validateScene(withPoster), []);
      const read = readableScene(
        JSON.parse(JSON.stringify(withPoster)),
        "elsewhere",
      )!;
      assert.equal(read.storeId, "elsewhere");
      assert.deepEqual(read.objects, scene.objects);
      assert.deepEqual(
        dropKinds(withPoster, ["furniture", "row"]).objects.map((o) => o.kind),
        scene.objects
          .filter((o) => o.kind === "furniture" || o.kind === "row")
          .map((o) => o.kind),
      );
      assert.equal(readableScene(null, "x"), null);
      assert.equal(readableScene([], "x"), null);
      assert.equal(readableScene({ objects: "none" }, "x"), null);
      const bent = structuredClone(scene);
      bent.objects[0].rect.x = 5;
      assert.equal(readableScene(bent, "x"), null);
    },
  );

  // 6. Headings and the mark of unpublished changes -------------------------------------

  await check(
    "public shelves are numbered among themselves, titled or not",
    () => {
      const shown = publicShelfScenes(threeShelves(), "s");
      assert.deepEqual(
        shown.map((s) => [s.shelfId, s.shelfIndex, s.shelfTitle, s.shelfIntro]),
        [
          [MAIN_SHELF_ID, 0, "夏の棚", "夏に読みたい本を集めました。"],
          ["shelf:third", 1, "", ""],
        ],
      );
      assert.equal(shown[1].templateId, "window");
      assert.equal(shown[1].theme.wood, "#93633c");
      assert.equal(shown[0].theme.wood, demoScene().theme.wood);
      // Each shelf's own colours over the shop's; the shop's when it has none.
      const L = threeShelves();
      assert.notEqual(L.common.theme.paper, "#f8eaca");
      assert.equal(shown[1].theme.paper, "#f8eaca");
      shelfOf(L, "shelf:third").look = { paper: "#fefefe" };
      delete shelfOf(L, MAIN_SHELF_ID).look;
      const [main, third] = publicShelfScenes(L, "s");
      assert.deepEqual(main.theme, L.common.theme);
      assert.deepEqual(third.theme, { ...L.common.theme, paper: "#fefefe" });
    },
  );

  await check("right after the move there is nothing to publish", () => {
    for (const [name, make] of scenes) {
      const scene = make();
      assert.equal(
        publicFingerprint(publicShelfScenes(layoutFromScene(scene), "mine")),
        publicFingerprint([publicStoreScene(scene)]),
        name,
      );
    }
    const { shop, books } = legacyOnlyShop();
    assert.equal(
      publicFingerprint(
        publicShelfScenes(layoutFromLegacyShop(shop, books), "mine"),
      ),
      // The full case: shelf presets do not grow yet (管理表 28).
      publicFingerprint([
        publicStoreScene(woodScene(shop, books, 0, { tiers: "fixed" })),
      ]),
    );
  });

  await check(
    "the mark ignores a private POP, and notices titles, introductions and public books",
    () => {
      const L = layoutFromScene(privateScene());
      const mark = (layout: ShopLayout) =>
        publicFingerprint(publicShelfScenes(layout, "mine"));
      const edit = (change: (scene: StoreScene) => StoreScene) =>
        writeBackShelf(
          L,
          MAIN_SHELF_ID,
          change(shelfScene(L, MAIN_SHELF_ID, "mine", { unplaced: true })),
        );
      assert.equal(
        mark(
          edit((s) =>
            changePlacement(s, privateBookId(), { pop: "内緒" }, BOOKS),
          ),
        ),
        mark(L),
      );
      assert.equal(
        mark(
          edit((s) =>
            changePlacement(s, "placement:waiting-a", { pop: "まだ" }, BOOKS),
          ),
        ),
        mark(L),
      );
      const titled = structuredClone(L);
      titled.shelves[0].title = "秋の棚";
      assert.notEqual(mark(titled), mark(L));
      const introduced = structuredClone(L);
      introduced.shelves[0].intro = "はじめまして。";
      assert.notEqual(mark(introduced), mark(L));
      assert.notEqual(
        mark(
          edit((s) =>
            changePlacement(
              s,
              "placement:shop-orbit:o1",
              { pop: "変えた" },
              BOOKS,
            ),
          ),
        ),
        mark(L),
      );
      const moved = moveToShelf(
        addShelf(L, "warm", "shelf:next"),
        "placement:shop-orbit:o1",
        "shelf:next",
        BOOKS,
      ).layout;
      assert.notEqual(mark(moved), mark(addShelf(L, "warm", "shelf:next")));
    },
  );

  await check(
    "the mark notices the world, the preset and every part of the frame",
    () => {
      const L = layoutFromScene(demoScene());
      const mark = (layout: ShopLayout) =>
        publicFingerprint(publicShelfScenes(layout, "mine"));
      assert.notEqual(mark(applyShopWorld(L, "study")), mark(L));
      assert.notEqual(
        mark(applyShelfPreset(L, MAIN_SHELF_ID, "study", BOOKS)),
        mark(L),
      );
      const changes: Record<string, (L: ShopLayout) => void> = {
        light: (L) => {
          L.common.theme.light = "#ffffff";
        },
        wood: (L) => {
          L.shelves[0].look = { wood: "#123456" };
        },
        preset: (L) => {
          L.shelves[0].presetId = "study";
        },
        darkness: (L) => {
          L.common.background.darkness = 0.5;
        },
        forbidden: (L) => {
          L.common.forbidden = [];
        },
        "shelf ID": (L) => {
          L.shelves[0].id = "shelf:renamed";
        },
      };
      for (const [what, change] of Object.entries(changes)) {
        const changed = structuredClone(L);
        change(changed);
        assert.notEqual(mark(changed), mark(L), what);
      }
      // Where an object sits in the list does not count; the shelf's number does.
      const [scene] = publicShelfScenes(L, "mine");
      const reversed = { ...scene, objects: [...scene.objects].reverse() };
      assert.notDeepEqual(reversed.objects, scene.objects);
      assert.equal(publicFingerprint([reversed]), publicFingerprint([scene]));
      assert.notEqual(
        publicFingerprint([{ ...scene, shelfIndex: 1 }]),
        publicFingerprint([scene]),
      );
    },
  );

  await check("what the draft hides but visitors still see is named", () => {
    const L = threeShelves();
    const published = publicShelfScenes(L, "s");
    assert.deepEqual(hiddenSincePublished(published, published), []);
    const draft = structuredClone(L);
    find(draft, "placement:shop-orbit:o2")!.isPublic = false;
    find(draft, "row-2")!.isPublic = false;
    shelfOf(draft, "shelf:third").isPublic = false;
    const hidden = hiddenSincePublished(
      publicShelfScenes(draft, "s"),
      published,
    );
    const onRow2 = shelfOf(L, MAIN_SHELF_ID)
      .objects.filter((o) => o.kind === "book" && o.parentId === "row-2")
      .map((o) => o.id);
    assert.deepEqual(
      new Set(hidden),
      new Set([
        "placement:shop-orbit:o2",
        "row-2",
        ...onRow2,
        "shelf:third",
        ...shelfOf(L, "shelf:third")
          .objects.filter((o) => o.kind === "row" || o.kind === "book")
          .map((o) => o.id),
      ]),
    );
    // A book moved to another public shelf is still seen.
    const moved = moveToShelf(
      L,
      "placement:shop-orbit:o1",
      "shelf:third",
      BOOKS,
    ).layout;
    assert.deepEqual(
      hiddenSincePublished(publicShelfScenes(moved, "s"), published),
      [],
    );
  });

  // 7. Sizes as the database counts them --------------------------------------------------

  await check("jsonb text sizes match PostgreSQL's", async () => {
    const db = new PGlite();
    const values = [
      ...JSONB_SAMPLES,
      threeShelves(),
      randomLayout(7),
      brokenLayout(),
    ];
    for (const value of values) {
      const rows = await db.query<{ n: number }>(
        "select octet_length($1::jsonb::text) as n",
        [JSON.stringify(value)],
      );
      assert.equal(
        jsonbTextBytes(value),
        rows.rows[0].n,
        JSON.stringify(value).slice(0, 60),
      );
    }
    assert.equal(
      jsonbTextBytes({ gone: undefined, kept: [undefined] }),
      jsonbTextBytes({ kept: [null] }),
    );
    await db.close();
  });

  // 8. The presets' shape ---------------------------------------------------------------------

  // The full case: shelf presets do not grow yet (管理表 28).
  await check("each preset has woodScene's furniture and rows, by slot", () => {
    const empty = { ...legacyOnlyShop().shop, shelves: [] };
    for (const preset of SHELF_PRESETS) {
      const wood = woodScene(empty, [], preset.variant, { tiers: "fixed" });
      const skeleton = presetSkeleton(preset.id as ShelfPresetId, "shelf:x");
      assert.deepEqual(
        skeleton.map((o) => o.slot),
        [...preset.slots],
      );
      const shape = (o: SceneObject) => {
        const copy: Partial<SceneObject> = { ...o };
        delete copy.id;
        delete copy.parentId;
        delete copy.slot;
        return copy;
      };
      const frame = wood.objects.filter(
        (o) => o.kind === "furniture" || o.kind === "row",
      );
      assert.deepEqual(
        skeleton.map((o) => [legacyIdOf(o.slot!), shape(o)]),
        frame.map((o) => [o.id, shape(o)]),
        preset.id,
      );
      for (const o of skeleton) assert.equal(o.id, "shelf:x/" + o.slot);
      for (const o of skeleton.filter((o) => o.kind === "row"))
        assert.equal(
          o.parentId,
          o.slot === "table-tier" ? "shelf:x/table" : "shelf:x/case",
        );
    }
  });

  await check(
    "presets and worlds keep the colours of today's templates",
    () => {
      assert.deepEqual(
        SHELF_PRESETS.map(({ id, name, variant, wood, paper }) => ({
          id,
          name,
          variant,
          wood,
          paper,
        })),
        STORE_TEMPLATES.map(({ id, name, variant, wood, paper }) => ({
          id,
          name,
          variant,
          wood,
          paper,
        })),
      );
      assert.deepEqual(
        SHOP_WORLDS.map(({ id, light, darkness }) => ({ id, light, darkness })),
        STORE_TEMPLATES.map(({ id, light, darkness }) => ({
          id,
          light,
          darkness,
        })),
      );
    },
  );

  // 9. Works ------------------------------------------------------------------------------------

  await check(
    "two editions of one work are the same work; a sample book is its own",
    () => {
      const { work, first, second, sample } = workBooks();
      assert.notEqual(first.id, second.id);
      assert.notEqual(work, first.id);
      assert.notEqual(work, second.id);
      assert.equal(workOf(first), work);
      assert.ok(sameWork(first, second));
      assert.equal(workOf(sample), sample.id);
      assert.ok(!sameWork(first, sample));
      assert.ok(sameWork(sample, { id: sample.id }));
      assert.ok(!sameWork(BOOK_A, BOOK_B));
    },
  );

  // 10. Sample book IDs -------------------------------------------------------------------------

  await check(
    "every sample book ID has the form the database will allow",
    () => {
      for (const book of demoBooks) {
        assert.match(book.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
        assert.ok(book.id.length <= 64, book.id);
      }
    },
  );

  console.log(passed + " shop layout domain checks passed");
}

/** The fixed ID woodScene gives the object playing a slot. */
const legacyIdOf = (slot: string) =>
  ({ case: "main-shelf", table: "table", "table-tier": "table-row" })[slot] ??
  slot.replace("tier-", "row-");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
