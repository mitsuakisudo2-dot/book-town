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
import {
  publicScenePops,
  sceneEntry,
  woodScene,
} from "../src/lib/store-scene-adapter";
import {
  STORE_TEMPLATES,
  applyStoreTemplate,
  changePlacement,
  importedPlacementReactions,
  insertPlacement,
  migrateShopScene,
  moveBook,
  placementReactionKey,
  publicStoreScene,
  renameSceneObject,
  sceneForShelves,
  setShopSize,
  takePlacementOff,
  validateOwnedScene,
} from "../src/lib/store-customization";
import { WALK_KEY, decodeWalk, encodeWalk } from "../src/lib/walk-repository";
import { GROW_MAX_TIERS, tiersOf, unpinRow } from "../src/lib/growing-shop";
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
/** The full case of three tiers that scenes decorated before the shop grew
 * with its books (管理表 27・28) keep; the commands here work on any rows. */
const fixedScene = (s: Shop) =>
  migrateShopScene(s, books, woodScene(s, books, 0, { tiers: "fixed" }));
const scene = fixedScene(shop);
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
  let dense = fixedScene({ ...shop, shelves: [] });
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
  let third = fixedScene({ ...shop, shelves: [] });
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
    fixedScene({ ...shop, shelves: [] }),
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
    let small = fixedScene({ ...shop, shelves: [] });
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
  "books shelved after the scene was first saved join its rows, with their POPs",
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
    assert.notEqual(c.parentId, null);
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
  // The book that left waits unplaced with its POP, no longer the shelf's.
  const left = objectById(reopened, "placement:mine:a")!;
  assert.equal(left.bookId, books[0].id);
  assert.equal(left.parentId, null);
  assert.equal(left.source, undefined);
  assert.equal(bookPop(reopened, "placement:mine:a")?.text, "公の言葉");
  const momo = objectById(reopened, "placement:mine:a:momo")!;
  assert.equal(momo.bookId, "momo");
  assert.notEqual(momo.parentId, null);
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
/** A shop of one public shelf holding these books, all face out. */
const shelfShop = (items: [string, string][]): Shop => ({
  ...shop,
  shelves: [
    {
      id: "public",
      name: "旅の入口",
      capacity: 20,
      isPublic: true,
      items: items.map(([id, bookId]) => ({
        id,
        bookId,
        display: "face" as const,
        pop: "",
      })),
    },
  ],
});
const placed = (s: StoreScene) =>
  s.objects
    .filter((o) => o.kind === "book" && o.parentId)
    .map((o) => o.bookId)
    .sort();
check(
  "a decorated shop follows the books put on and taken off its shelf",
  () => {
    const first = shelfShop([
      ["a", books[0].id],
      ["b", books[1].id],
      ["c", books[2].id],
    ]);
    const decorated = fixedScene(first);
    assert.deepEqual(
      placed(decorated),
      [books[0].id, books[1].id, books[2].id].sort(),
    );
    // The owner swaps two books (the shelf gives "b" to the next book) and
    // adds one more.
    const swapped = shelfShop([
      ["a", books[0].id],
      ["b", books[3].id],
      ["d", books[4].id],
      ["e", books[5].id],
    ]);
    const followed = migrateShopScene(swapped, books, decorated);
    assert.deepEqual(validateOwnedScene(followed, swapped, books), []);
    assert.deepEqual(
      placed(followed),
      [books[0].id, books[3].id, books[4].id, books[5].id].sort(),
    );
    // What left the shelf waits unplaced, not tied to it any more.
    const left = objectById(followed, "placement:mine:c")!;
    assert.equal(left.parentId, null);
    assert.equal(left.source, undefined);
    assert.ok(unplacedBooks(followed).some((o) => o.id === left.id));
    assert.deepEqual(migrateShopScene(swapped, books, followed), followed);
    // Put back on the shelf, the same placement comes back with its POP.
    const withPop = setBookPop(followed, left.id, "また並べる");
    const back = shelfShop([
      ...swapped.shelves[0].items.map(
        (i) => [i.id, i.bookId] as [string, string],
      ),
      ["f", books[2].id],
    ]);
    const returned = migrateShopScene(back, books, withPop);
    assert.equal(objectById(returned, left.id)!.parentId !== null, true);
    assert.equal(objectById(returned, left.id)!.source?.itemId, "f");
    assert.equal(bookPop(returned, left.id)!.text, "また並べる");
    assert.equal(
      returned.objects.filter(
        (o) => o.kind === "book" && o.bookId === books[2].id,
      ).length,
      1,
    );
  },
);
check(
  "books the owner set out by hand, or took off, stay where they are",
  () => {
    const one = shelfShop([["a", books[0].id]]);
    let s = fixedScene(one);
    s = addBookPlacement(s, books[6], "row-2", "by-hand", "spine", 0);
    s = takePlacementOff(s, "placement:mine:a");
    const again = migrateShopScene(one, books, s);
    assert.deepEqual(again, s);
  },
);
check("a private shelf's new book, or one with no room, waits unplaced", () => {
  const first = shelfShop([["a", books[0].id]]);
  const decorated = fixedScene(first);
  const secret = {
    ...first,
    shelves: [
      ...first.shelves,
      {
        id: "private",
        name: "秘密の棚",
        capacity: 20,
        isPublic: false,
        items: [
          { id: "s", bookId: books[1].id, display: "face" as const, pop: "" },
        ],
      },
    ],
  };
  const followed = migrateShopScene(secret, books, decorated);
  const p = objectById(followed, "placement:mine:s")!;
  assert.equal(p.parentId, null);
  assert.equal(p.isPublic, false);
  // Many face-outs: what the rows cannot hold waits, and the rest is valid.
  const many = shelfShop(
    books.slice(0, 20).map((b, i) => ["m" + i, b.id] as [string, string]),
  );
  const full = migrateShopScene(many, books, decorated);
  assert.deepEqual(validateOwnedScene(full, many, books), []);
  assert.ok(unplacedBooks(full).length > 0);
  assert.ok(placed(full).length > 3);
});
check("a decorated growing shop grows a tier for books with no room", () => {
  const ofShop = (n: number) =>
    shelfShop(
      Array.from(
        { length: n },
        (_, i) => ["g" + i, books[i % books.length].id] as [string, string],
      ),
    );
  // Decorated with one book: the stand, saved as a growing scene.
  const one = ofShop(1);
  const decorated = migrateShopScene(one, books);
  assert.equal(decorated.growth, "auto");
  assert.equal(tiersOf(decorated), 0);
  {
    // The second book turns the stand into a tier; both stand on it.
    const two = ofShop(2);
    const grown = migrateShopScene(two, books, decorated);
    assert.equal(tiersOf(grown), 1);
    assert.equal(objectById(grown, "main-shelf")!.furnitureType, "shelf");
    assert.deepEqual(placed(grown), placed(woodScene(two, books)));
    assert.deepEqual(validateOwnedScene(grown, two, books), []);
  }
  // Books keep coming: the case grows, never past four tiers, and what four
  // cannot hold waits unplaced. Nothing is lost.
  let s = decorated;
  for (const n of [5, 12, 30, 60, 90]) {
    const more = ofShop(n);
    s = migrateShopScene(more, books, s);
    assert.ok(tiersOf(s) <= GROW_MAX_TIERS, n + " books");
    assert.deepEqual(validateOwnedScene(s, more, books), [], n + " books");
    assert.equal(
      s.objects.filter((o) => o.kind === "book").length,
      n,
      n + " books",
    );
  }
  assert.equal(tiersOf(s), GROW_MAX_TIERS);
  assert.ok(unplacedBooks(s).length > 0);
  // Tiers the owner did not arrange are the shop's: set out as a new shop
  // would, and the same again when nothing changed.
  const before = migrateShopScene(ofShop(12), books, decorated);
  const after = migrateShopScene(ofShop(30), books, before);
  assert.deepEqual(
    arrangement(after),
    arrangement(woodScene(ofShop(30), books)),
  );
  assert.deepEqual(migrateShopScene(ofShop(30), books, after), after);
  // A template change keeps the growing case and its tiers.
  const changed = applyStoreTemplate(after, "study", books);
  assert.equal(changed.growth, "auto");
  assert.equal(tiersOf(changed), tiersOf(after));
  assert.deepEqual(placed(changed), placed(after));
  // A scene decorated before the shop grew keeps its full case of three.
  const old = fixedScene(ofShop(2));
  const followed = migrateShopScene(ofShop(90), books, old);
  assert.equal(followed.growth, undefined);
  assert.equal(followed.objects.filter((o) => o.kind === "row").length, 3);
  assert.equal(
    applyStoreTemplate(old, "study", books).objects.filter(
      (o) => o.kind === "row",
    ).length,
    3,
  );
});
check("a tier the owner arranged keeps its books as they are", () => {
  const ofShop = (n: number) =>
    shelfShop(
      Array.from(
        { length: n },
        (_, i) => ["k" + i, books[i % books.length].id] as [string, string],
      ),
    );
  const start = migrateShopScene(ofShop(14), books);
  assert.equal(tiersOf(start), 2);
  // The owner turns a book of the first tier: that tier is theirs now.
  const first = rowBooks(start, "row-0");
  const turned = changePlacement(
    start,
    first[first.length - 1],
    { display: "face" },
    books,
  );
  assert.equal(objectById(turned, "row-0")!.pinned, true);
  assert.equal(objectById(turned, "row-1")!.pinned, undefined);
  const mine = rowBooks(turned, "row-0");
  // New books go on the other tiers, and the case grows for them; the
  // arranged tier keeps its books in their order and their look.
  const grown = migrateShopScene(ofShop(30), books, turned);
  assert.deepEqual(rowBooks(grown, "row-0"), mine);
  for (const id of mine)
    assert.equal(
      objectById(grown, id)!.display,
      objectById(turned, id)!.display,
    );
  assert.ok(tiersOf(grown) > 2);
  assert.equal(grown.objects.filter((o) => o.kind === "book").length, 30);
  assert.equal(sceneForShelves(grown, ofShop(30), books), null);
  // With fewer books it does not go back on the arranged tier either.
  const fewer = migrateShopScene(ofShop(3), books, grown);
  assert.ok(rowBooks(fewer, "row-0").length > 0);
  assert.deepEqual(
    rowBooks(fewer, "row-0"),
    mine.filter((id) => /:k[0-2]$/.test(id)),
  );
  // Given back, the tier is set out by the shop again.
  const back = migrateShopScene(ofShop(30), books, unpinRow(grown, "row-0"));
  assert.deepEqual(
    arrangement(back),
    arrangement(woodScene(ofShop(30), books)),
  );
  // A book the owner took off waits, whatever the shelves do.
  const off = takePlacementOff(start, first[0]);
  const followed = migrateShopScene(ofShop(20), books, off);
  assert.equal(objectById(followed, first[0])!.parentId, null);
  assert.equal(objectById(followed, first[0])!.held, true);
  // Set out by hand again, it no longer waits.
  const put = insertPlacement(followed, first[0], "row-1", 0);
  assert.equal(objectById(put, first[0])!.held, undefined);
  assert.equal(objectById(put, "row-1")!.pinned, true);
});
check("a case goes back a tier only past two books of slack", () => {
  const ofShop = (n: number) =>
    shelfShop(
      Array.from(
        { length: n },
        (_, i) => ["h" + i, books[i % books.length].id] as [string, string],
      ),
    );
  const eleven = migrateShopScene(ofShop(11), books);
  assert.equal(tiersOf(eleven), 2);
  const ten = migrateShopScene(ofShop(10), books, eleven);
  assert.equal(tiersOf(ten), 2);
  const nine = migrateShopScene(ofShop(9), books, ten);
  assert.equal(tiersOf(nine), 2);
  const eight = migrateShopScene(ofShop(8), books, nine);
  assert.equal(tiersOf(eight), 1);
  // Back up past ten, it grows at once.
  assert.equal(tiersOf(migrateShopScene(ofShop(11), books, eight)), 2);
});
check("the owner chooses the size of the shop; nothing is lost", () => {
  const ofShop = (n: number) =>
    shelfShop(
      Array.from(
        { length: n },
        (_, i) => ["z" + i, books[i % books.length].id] as [string, string],
      ),
    );
  const thirty = ofShop(30);
  const start = migrateShopScene(thirty, books);
  for (const size of [1, 2, 3, 4] as const) {
    const sized = setShopSize(start, size, thirty, books);
    assert.equal(sized.growth, size);
    assert.equal(tiersOf(sized), size, size + " tiers");
    assert.deepEqual(validateOwnedScene(sized, thirty, books), []);
    assert.equal(sized.objects.filter((o) => o.kind === "book").length, 30);
    // Kept at that size, more books wait instead of growing the case.
    const more = migrateShopScene(ofShop(40), books, sized);
    assert.equal(tiersOf(more), size);
    assert.equal(more.objects.filter((o) => o.kind === "book").length, 40);
  }
  // One tier: covers turn to spines before a book has to wait.
  const one = setShopSize(start, 1, thirty, books);
  const onTier = one.objects.filter((o) => o.parentId === "row-0");
  assert.ok(onTier.filter((o) => o.display === "spine").length > 5);
  assert.ok(unplacedBooks(one).length > 0);
  // Back to growing with the books, the shop is set out as a new one.
  const auto = setShopSize(one, "auto", thirty, books);
  assert.equal(auto.growth, "auto");
  assert.deepEqual(arrangement(auto), arrangement(woodScene(thirty, books)));
  // A shop decorated before the shop grew moves to the growing case with
  // its books, POPs and its private tier.
  const old = structuredClone(fixedScene(ofShop(12)));
  objectById(old, "row-2")!.isPublic = false;
  const hidden = rowBooks(old, "row-2");
  const withPop = setBookPop(old, rowBooks(old, "row-0")[0], "店主の言葉");
  const moved = setShopSize(withPop, "auto", ofShop(12), books);
  assert.equal(moved.growth, "auto");
  assert.deepEqual(validateOwnedScene(moved, ofShop(12), books), []);
  assert.equal(moved.objects.filter((o) => o.kind === "book").length, 12);
  assert.equal(bookPop(moved, rowBooks(old, "row-0")[0])!.text, "店主の言葉");
  const privateRow = moved.objects.find(
    (o) => o.kind === "row" && o.isPublic === false,
  )!;
  assert.deepEqual(rowBooks(moved, privateRow.id), hidden);
  assert.equal(
    publicStoreScene(moved).objects.some((o) => hidden.includes(o.id)),
    false,
  );
});
check(
  "a book carried to another place moves there, and never pushes one off",
  () => {
    const ofShop = (n: number) =>
      shelfShop(
        Array.from(
          { length: n },
          (_, i) => ["m" + i, books[i % books.length].id] as [string, string],
        ),
      );
    const ten = ofShop(10);
    const shop = setShopSize(migrateShopScene(ten, books), 2, ten, books);
    const [top, low] = shop.objects
      .filter((o) => o.kind === "row" && o.parentId === "main-shelf")
      .sort((a, b) => a.rect.y - b.rect.y);
    const first = rowBooks(shop, top.id)[0];
    // To the end of its own tier: the tier keeps its books, in the new order.
    const within = moveBook(shop, first, top.id, Infinity, books)!;
    assert.deepEqual(rowBooks(within, top.id), [
      ...rowBooks(shop, top.id).slice(1),
      first,
    ]);
    assert.equal(objectById(within, top.id)!.pinned, true);
    assert.deepEqual(validateOwnedScene(within, ten, books), []);
    // To a full tier: room is made there, and no book leaves the shelves.
    const across = moveBook(shop, first, low.id, 0, books)!;
    assert.equal(rowBooks(across, low.id)[0], first);
    assert.equal(objectById(across, low.id)!.pinned, true);
    assert.equal(objectById(across, top.id)!.pinned, true);
    assert.equal(unplacedBooks(across).length, 0);
    const both = (s: StoreScene) =>
      [...rowBooks(s, top.id), ...rowBooks(s, low.id)].sort();
    assert.deepEqual(both(across), both(shop));
    assert.deepEqual(validateOwnedScene(across, ten, books), []);
    // A full tier takes no more: the book stays where it was.
    const thirty = ofShop(30);
    const full = setShopSize(migrateShopScene(thirty, books), 1, thirty, books);
    const waiting = unplacedBooks(full)[0];
    assert.ok(waiting);
    assert.equal(moveBook(full, waiting.id, "row-0", 0, books), null);
  },
);
console.log(passed + " customization domain checks passed");
