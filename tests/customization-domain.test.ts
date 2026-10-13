import assert from "node:assert/strict";
import { books, createInitialState } from "../src/lib/data";
import { popReactionKey, type Shop } from "../src/lib/types";
import {
  addBookPlacement,
  bookPop,
  objectById,
  setBookPop,
  unplacedBooks,
  validateScene,
  type StoreScene,
} from "../src/lib/store-scene";
import { publicScenePops, sceneEntry } from "../src/lib/store-scene-adapter";
import {
  STORE_TEMPLATES,
  applyStoreTemplate,
  changePlacement,
  importedPlacementReactions,
  insertPlacement,
  migrateShopScene,
  placementReactionKey,
  publicStoreScene,
  renameSceneObject,
  takePlacementOff,
  validateOwnedScene,
} from "../src/lib/store-customization";
import { WALK_KEY, decodeWalk, encodeWalk } from "../src/lib/walk-repository";
import { emptyWalk, startWalk } from "../src/lib/walk-state";
import { saveOwnedScene, updateWalk } from "../src/lib/walk-store";
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed++;
  console.log("PASS " + name);
}
const shop: Shop = {
  id: "mine",
  ownerId: "me",
  name: "小さな灯り",
  description: "私の店",
  tagline: "今日を少し好きになる。",
  theme: "sage",
  demo: false,
  followers: 0,
  shelves: [
    {
      id: "public",
      name: "旅の入口",
      capacity: 20,
      isPublic: true,
      items: [
        { id: "a", bookId: books[0].id, display: "face", pop: "公の言葉" },
        { id: "b", bookId: books[1].id, display: "spine", pop: "二つめ" },
      ],
    },
    {
      id: "private",
      name: "秘密の棚",
      capacity: 20,
      isPublic: false,
      items: [
        {
          id: "secret",
          bookId: books[0].id,
          display: "face",
          pop: "秘密の言葉",
        },
      ],
    },
  ],
};
const before = JSON.stringify(shop);
const scene = migrateShopScene(shop, books);
check(
  "migration preserves legacy data and private items without publishing them",
  () => {
    assert.equal(JSON.stringify(shop), before);
    assert.equal(scene.ownerManaged, true);
    assert.deepEqual(validateOwnedScene(scene, shop, books), []);
    assert.equal(scene.objects.filter((o) => o.kind === "book").length, 3);
    const secret = objectById(scene, "placement:mine:secret")!;
    assert.equal(secret.parentId, null);
    assert.equal(secret.isPublic, false);
    assert.equal(bookPop(scene, secret.id)?.text, "秘密の言葉");
    assert.ok(!publicStoreScene(scene).objects.some((o) => o.id === secret.id));
    assert.ok(!publicScenePops([scene]).some((p) => p.pop === "秘密の言葉"));
  },
);
check(
  "three template changes retain all book/POP identities and stay valid",
  () => {
    for (const t of STORE_TEMPLATES) {
      const changed = applyStoreTemplate(scene, t.id, books);
      assert.equal(changed.templateId, t.id);
      assert.deepEqual(validateScene(changed), []);
      assert.deepEqual(
        changed.objects.filter((o) => o.kind === "book").map((o) => o.id),
        scene.objects.filter((o) => o.kind === "book").map((o) => o.id),
      );
      assert.equal(bookPop(changed, "placement:mine:a")?.text, "公の言葉");
      assert.equal(
        bookPop(changed, "placement:mine:secret")?.text,
        "秘密の言葉",
      );
      assert.equal(
        objectById(changed, "placement:mine:secret")?.isPublic,
        false,
      );
    }
  },
);
check("switching furniture cannot publish a previously private row", () => {
  const hidden = structuredClone(scene);
  objectById(hidden, "row-0")!.isPublic = false;
  const changed = applyStoreTemplate(hidden, "window", books);
  assert.equal(objectById(changed, "placement:mine:a")!.isPublic, false);
  assert.ok(
    !publicScenePops([changed]).some((p) => p.id === "placement:mine:a"),
  );
});
check(
  "effective publication excludes hidden ancestors and missing privacy flags",
  () => {
    const hidden = structuredClone(scene);
    objectById(hidden, "main-shelf")!.placed = false;
    assert.equal(publicScenePops([hidden]).length, 0);
    const implicit = structuredClone(scene);
    delete objectById(implicit, "row-0")!.isPublic;
    assert.ok(
      !publicStoreScene(implicit).objects.some(
        (o) => o.id === "placement:mine:a",
      ),
    );
  },
);
check(
  "POP edits and stamps belong to a placement, not to the shared book",
  () => {
    const changed = changePlacement(
      scene,
      "placement:mine:a",
      { pop: "窓の向こうへ。", stamp: "plane" },
      books,
    );
    assert.equal(bookPop(changed, "placement:mine:a")?.stamp, "plane");
    assert.equal(bookPop(changed, "placement:mine:secret")?.text, "秘密の言葉");
    assert.equal(bookPop(scene, "placement:mine:a")?.text, "公の言葉");
    assert.equal(
      sceneEntry(changed, objectById(changed, "placement:mine:a")!).stamp,
      "plane",
    );
    assert.equal(
      sceneEntry(changed, objectById(changed, "placement:mine:a")!).legacy,
      undefined,
    );
  },
);
check(
  "reopening a managed scene preserves its privacy and ignores later legacy edits",
  () => {
    const changed = changePlacement(
      scene,
      "placement:mine:a",
      { isPublic: false, pop: "新しい正本の言葉" },
      books,
    );
    const old = structuredClone(shop);
    old.shelves[0].items[0].pop = "昔の棚の言葉";
    const reopened = migrateShopScene(old, books, changed);
    assert.equal(objectById(reopened, "placement:mine:a")!.isPublic, false);
    assert.equal(
      bookPop(reopened, "placement:mine:a")!.text,
      "新しい正本の言葉",
    );
    assert.deepEqual(reopened, changed);
    assert.notEqual(reopened, changed);
  },
);
check("invalid publication flags are rejected during decoding", () => {
  const invalid = JSON.parse(encodeWalk(emptyWalk(), [scene]));
  invalid.sceneOverrides[0].objects.find(
    (o: { id: string }) => o.id === "placement:mine:a",
  ).isPublic = "false";
  assert.equal(decodeWalk(JSON.stringify(invalid)).status, "recovered");
});
check(
  "taking off and replacing keeps a stable POP, stamp, privacy and reaction key",
  () => {
    const changed = changePlacement(
      scene,
      "placement:mine:a",
      { stamp: "coffee", isPublic: false },
      books,
    );
    const key = placementReactionKey(
      changed,
      objectById(changed, "placement:mine:a")!,
    );
    const off = takePlacementOff(changed, "placement:mine:a");
    assert.ok(unplacedBooks(off).some((p) => p.id === "placement:mine:a"));
    const replaced = insertPlacement(off, "placement:mine:a", "row-1", 0);
    assert.equal(objectById(replaced, "placement:mine:a")!.parentId, "row-1");
    assert.equal(bookPop(replaced, "placement:mine:a")!.stamp, "coffee");
    assert.equal(
      placementReactionKey(replaced, objectById(replaced, "placement:mine:a")!),
      key,
    );
    assert.equal(objectById(replaced, "placement:mine:a")!.isPublic, false);
    assert.deepEqual(validateScene(replaced), []);
  },
);
check("explicit reordering inserts at the intended left-to-right index", () => {
  let next = changePlacement(
    scene,
    "placement:mine:a",
    { display: "spine" },
    books,
  );
  next = addBookPlacement(next, books[2], "row-0", "extra-1", "spine", 1);
  next = addBookPlacement(next, books[3], "row-0", "extra-2", "spine", 2);
  next = insertPlacement(next, "extra-2", "row-0", 0);
  assert.deepEqual(
    next.objects
      .filter((o) => o.kind === "book" && o.parentId === "row-0")
      .sort((a, b) => a.order! - b.order!)
      .map((o) => o.id),
    ["extra-2", "placement:mine:a", "placement:mine:b", "extra-1"],
  );
  assert.deepEqual(validateScene(next), []);
});
check("dense rows and template changes keep overflow with its POP", () => {
  let dense = migrateShopScene({ ...shop, shelves: [] }, books);
  for (let i = 0; i < 30; i++) {
    dense = addBookPlacement(dense, books[0], "row-0", "dense-" + i, "face", i);
    dense = setBookPop(dense, "dense-" + i, "POP " + i);
  }
  const changed = applyStoreTemplate(dense, "window", books);
  assert.equal(changed.objects.filter((o) => o.kind === "book").length, 30);
  assert.equal(changed.objects.filter((o) => o.kind === "bookPop").length, 30);
  assert.ok(unplacedBooks(changed).length > 0);
  assert.deepEqual(validateScene(changed), []);
});
/** The placements on a row, left to right. */
const rowBooks = (s: StoreScene, rowId: string) =>
  s.objects
    .filter((o) => o.kind === "book" && o.parentId === rowId)
    .sort((a, b) => a.order! - b.order!)
    .map((o) => o.id);
const arrangement = (s: StoreScene) =>
  s.objects
    .filter((o) => o.kind === "row")
    .map((row) => [row.id, rowBooks(s, row.id)]);
check("all books on row 3 stay on row 3 after warm, study and warm", () => {
  let third = migrateShopScene({ ...shop, shelves: [] }, books);
  for (const [i, id] of [
    "left-hand",
    "solaris",
    "dispossessed",
    "fahrenheit",
  ].entries())
    third = addBookPlacement(
      third,
      books.find((b) => b.id === id)!,
      "row-2",
      "third-" + i,
      "spine",
      i,
    );
  const warm = applyStoreTemplate(third, "warm", books);
  const study = applyStoreTemplate(warm, "study", books);
  const back = applyStoreTemplate(study, "warm", books);
  const expected = [
    ["row-0", []],
    ["row-1", []],
    ["row-2", ["third-0", "third-1", "third-2", "third-3"]],
  ];
  assert.deepEqual(arrangement(warm), expected);
  assert.deepEqual(arrangement(study), expected);
  assert.deepEqual(back, warm);
  assert.deepEqual(validateScene(back), []);
});
check("the window table's books join the last shelf row, after it", () => {
  let table = applyStoreTemplate(
    migrateShopScene({ ...shop, shelves: [] }, books),
    "window",
    books,
  );
  table = addBookPlacement(table, books[0], "row-2", "shelf", "spine", 0);
  table = addBookPlacement(table, books[1], "table-row", "table-1", "face", 0);
  table = addBookPlacement(table, books[2], "table-row", "table-2", "face", 1);
  const warm = applyStoreTemplate(table, "warm", books);
  assert.deepEqual(rowBooks(warm, "row-2"), ["shelf", "table-1", "table-2"]);
  assert.deepEqual(validateScene(warm), []);
  // And back at the window, the shelf row keeps them in that order.
  const again = applyStoreTemplate(warm, "window", books);
  assert.deepEqual(rowBooks(again, "row-2"), ["shelf", "table-1", "table-2"]);
});
check(
  "what a row cannot hold after a change goes on to the next row as public",
  () => {
    // Saved with books smaller than the furniture now takes.
    let small = migrateShopScene({ ...shop, shelves: [] }, books);
    objectById(small, "row-0")!.bookHeight = 0.06;
    for (let i = 0; i < 8; i++)
      small = addBookPlacement(small, books[i], "row-0", "s-" + i, "face", i);
    small.objects = small.objects.filter(
      (o) => o.kind !== "book" || o.parentId,
    );
    const placed = rowBooks(small, "row-0");
    assert.ok(placed.length >= 6);
    for (const hidden of [false, true]) {
      const before = structuredClone(small);
      objectById(before, "row-1")!.isPublic = !hidden;
      const changed = applyStoreTemplate(before, "study", books);
      const [kept, next, last] = ["row-0", "row-1", "row-2"].map((id) =>
        rowBooks(changed, id),
      );
      assert.ok(kept.length > 0 && kept.length < placed.length);
      // The row keeps its first books; the rest follow on, in order, and
      // never onto a row less public than the one they left.
      assert.deepEqual(
        [...kept, ...next, ...last, ...unplacedBooks(changed).map((o) => o.id)],
        placed,
      );
      assert.ok((hidden ? last : next).length > 0);
      if (hidden) assert.deepEqual(next, []);
      assert.deepEqual(validateScene(changed), []);
    }
  },
);
check(
  "books shelved after the scene was first saved join it unplaced, with their POPs",
  () => {
    const managed = changePlacement(
      applyStoreTemplate(scene, "study", books),
      "placement:mine:a",
      { pop: "店内の言葉", isPublic: false },
      books,
    );
    const later = structuredClone(shop);
    later.shelves[0].items.push({
      id: "c",
      bookId: "momo",
      display: "face",
      pop: "あとから来た本",
    });
    later.shelves[1].items.push({
      id: "d",
      bookId: "fictions",
      display: "spine",
      pop: "秘密のあと",
    });
    const reopened = migrateShopScene(later, books, managed);
    // What the scene had is untouched: template, rows, POPs, privacy, order.
    assert.deepEqual(
      reopened.objects.slice(0, managed.objects.length),
      managed.objects,
    );
    assert.equal(reopened.templateId, "study");
    const c = objectById(reopened, "placement:mine:c")!;
    assert.equal(c.parentId, null);
    assert.equal(c.isPublic, true);
    assert.equal(c.display, "face");
    assert.deepEqual(c.source, {
      shopId: "mine",
      shelfId: "public",
      itemId: "c",
    });
    assert.equal(bookPop(reopened, c.id)?.text, "あとから来た本");
    const d = objectById(reopened, "placement:mine:d")!;
    assert.equal(d.isPublic, false);
    assert.equal(bookPop(reopened, d.id)?.text, "秘密のあと");
    assert.ok(!publicScenePops([reopened]).some((p) => p.pop === "秘密のあと"));
    assert.deepEqual(validateOwnedScene(reopened, later, books), []);
    // Opening it again adds nothing more.
    assert.deepEqual(migrateShopScene(later, books, reopened), reopened);
  },
);
check("a shelf item id given to another book gets its own placement", () => {
  // The first book left the shelf, and its item id went to the next book.
  const reused = structuredClone(shop);
  reused.shelves[0].items[0] = {
    id: "a",
    bookId: "momo",
    display: "spine",
    pop: "同じ番号の別の本",
  };
  const reopened = migrateShopScene(reused, books, scene);
  assert.equal(objectById(reopened, "placement:mine:a")!.bookId, books[0].id);
  assert.equal(bookPop(reopened, "placement:mine:a")?.text, "公の言葉");
  const momo = objectById(reopened, "placement:mine:a:momo")!;
  assert.equal(momo.bookId, "momo");
  assert.equal(momo.parentId, null);
  assert.equal(bookPop(reopened, momo.id)?.text, "同じ番号の別の本");
  assert.deepEqual(validateScene(reopened), []);
  assert.deepEqual(migrateShopScene(reused, books, reopened), reopened);
});
check(
  "labels preserve input spaces and are independent from the legacy shop",
  () => {
    const changed = renameSceneObject(scene, "row-0", "旅の本 ");
    assert.equal(objectById(changed, "row-0")?.text, "旅の本 ");
    assert.equal(JSON.stringify(shop), before);
    assert.throws(() => renameSceneObject(scene, "main-shelf", "悪い編集"));
  },
);
check(
  "Phase 1 saves migrate to version 2 without losing history or scenes",
  () => {
    const walk = startWalk(emptyWalk(), ["mine"]);
    walk.visits.mine = "2026-10-12T00:00:00.000Z";
    walk.reactions.mine = { liked: true, saved: true, message: "ありがとう" };
    const raw = JSON.stringify({
      schemaVersion: 1,
      walkState: walk,
      sceneOverrides: [scene],
    });
    const decoded = decodeWalk(raw);
    assert.equal(decoded.status, "ready");
    assert.equal(decoded.data.schemaVersion, 2);
    assert.deepEqual(decoded.data.walkState, walk);
    assert.deepEqual(decoded.data.sceneOverrides, [scene]);
    assert.deepEqual(decoded.data.legacyBackups, []);
    assert.equal(JSON.parse(raw).schemaVersion, 1);
  },
);
check(
  "backup and scene roundtrip rejects future versions and corrupt backup",
  () => {
    const backup = {
      storeId: shop.id,
      shop,
      migratedAt: "2026-10-12T00:00:00.000Z",
    };
    const raw = encodeWalk(emptyWalk(), [scene], [backup]);
    assert.deepEqual(decodeWalk(raw).data.legacyBackups, [backup]);
    const tampered = JSON.parse(raw);
    tampered.schemaVersion = 99;
    assert.equal(decodeWalk(JSON.stringify(tampered)).status, "recovered");
    tampered.schemaVersion = 2;
    tampered.legacyBackups[0].shop.shelves[0].isPublic = "yes";
    assert.equal(decodeWalk(JSON.stringify(tampered)).status, "recovered");
  },
);
const town = createInitialState();
town.ownShop = shop;
town.popReactions[popReactionKey("mine", "public", "a")] = ["like"];
check(
  "legacy reactions copy to the stable scene target without changing old reactions",
  () => {
    assert.deepEqual(
      importedPlacementReactions(scene, town)[
        placementReactionKey(scene, objectById(scene, "placement:mine:a")!)
      ],
      ["like"],
    );
    assert.deepEqual(town.popReactions[popReactionKey("mine", "public", "a")], [
      "like",
    ]);
  },
);
let raw: string | null = JSON.stringify({
  schemaVersion: 1,
  walkState: emptyWalk(),
  sceneOverrides: [],
});
let fail = false;
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => (key === WALK_KEY ? raw : null),
      setItem: (key: string, value: string) => {
        assert.equal(key, WALK_KEY);
        if (fail) throw new Error("quota");
        raw = value;
      },
    },
  },
  configurable: true,
});
check(
  "save adopts a validated scene only after writing and makes one legacy backup",
  () => {
    assert.equal(saveOwnedScene(scene, town).ok, true);
    const decoded = decodeWalk(raw).data;
    assert.deepEqual(decoded.sceneOverrides, [scene]);
    assert.equal(decoded.legacyBackups.length, 1);
    assert.equal(JSON.stringify(decoded.legacyBackups[0].shop), before);
    const next = changePlacement(
      scene,
      "placement:mine:a",
      { pop: "二度目" },
      books,
    );
    assert.equal(saveOwnedScene(next, town).ok, true);
    assert.equal(decodeWalk(raw).data.legacyBackups.length, 1);
    updateWalk((w) => ({ ...w, lastStoreId: "mine" }));
    assert.equal(
      decodeWalk(raw).data.sceneOverrides[0].objects.find(
        (o) => o.id === "pop:placement:mine:a",
      )!.text,
      "二度目",
    );
    assert.equal(decodeWalk(raw).data.legacyBackups.length, 1);
  },
);
check(
  "failed or unauthorized saves leave the previous persisted scene intact",
  () => {
    const original = raw;
    fail = true;
    assert.equal(
      saveOwnedScene(renameSceneObject(scene, "sign", "失敗候補"), town).ok,
      false,
    );
    assert.equal(raw, original);
    fail = false;
    assert.equal(
      saveOwnedScene(scene, {
        ...town,
        ownShop: { ...shop, ownerId: "someone-else" },
      }).ok,
      false,
    );
    assert.equal(raw, original);
    const invalid = structuredClone(scene);
    objectById(invalid, "sign")!.rect.x = 2;
    assert.equal(saveOwnedScene(invalid, town).ok, false);
    assert.equal(raw, original);
  },
);
console.log(passed + " customization domain checks passed");
