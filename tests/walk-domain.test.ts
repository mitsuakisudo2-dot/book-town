import assert from "node:assert/strict";
import { books, shops } from "../src/lib/data";
import {
  addBookPlacement,
  bookPop,
  deleteFurniture,
  furnitureBooks,
  moveFurniture,
  objectById,
  placeBook,
  rect,
  resizeFurniture,
  sceneFromJson,
  sceneToJson,
  setBookPop,
  setRowStyle,
  unplacedBooks,
  validateScene,
  worldPolygon,
  type StoreScene,
} from "../src/lib/store-scene";
import { publicScenePops, woodScene } from "../src/lib/store-scene-adapter";
import {
  clearVisits,
  emptyWalk,
  qualifiedVisit,
  startWalk,
  stepWalk,
  verticalSwipe,
  visitStore,
} from "../src/lib/walk-state";
import { decodeWalk, encodeWalk } from "../src/lib/walk-repository";
import { createInitialState } from "../src/lib/data";
import { deserializeTown, serializeTown } from "../src/lib/repository";
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed++;
  console.log("PASS " + name);
}
function base(): StoreScene {
  return {
    schemaVersion: 1,
    storeId: "test",
    theme: {
      id: "wood",
      wood: "#123456",
      light: "#ffbb88",
      paper: "#ffeecc",
      font: "serif",
    },
    background: { kind: "preset", blur: 0, darkness: 0.2 },
    forbidden: [rect(0, 0, 1, 0.1), rect(0.85, 0, 0.15, 1)],
    objects: [
      {
        id: "f1",
        kind: "furniture",
        parentId: null,
        rect: rect(0.05, 0.2, 0.65, 0.4),
        z: 1,
        furnitureType: "shelf",
      },
      {
        id: "r1",
        kind: "row",
        parentId: "f1",
        rect: rect(0.02, 0.02, 0.96, 0.48),
        z: 2,
        bookHeight: 0.13,
        gap: 0.005,
      },
      {
        id: "r2",
        kind: "row",
        parentId: "f1",
        rect: rect(0.02, 0.52, 0.96, 0.48),
        z: 2,
        bookHeight: 0.13,
        gap: 0.005,
      },
    ],
  };
}
let scene = addBookPlacement(base(), books[0], "r1", "p1", "face");
scene = setBookPop(scene, "p1", "一枚目の言葉");
scene = addBookPlacement(scene, books[0], "r2", "p2", "face");
scene = setBookPop(scene, "p2", "別の言葉");
check("same Book has independent placements and POPs", () => {
  assert.equal(
    objectById(scene, "p1")?.bookId,
    objectById(scene, "p2")?.bookId,
  );
  assert.notEqual(bookPop(scene, "p1")?.text, bookPop(scene, "p2")?.text);
  assert.deepEqual(validateScene(scene, new Set(books.map((b) => b.id))), []);
});
check(
  "moving furniture keeps local coordinates and translates children",
  () => {
    const before = worldPolygon(scene, objectById(scene, "p1")!)!;
    const moved = moveFurniture(scene, "f1", 0.1, 0.3);
    const after = worldPolygon(moved, objectById(moved, "p1")!)!;
    assert.deepEqual(objectById(scene, "p1"), objectById(moved, "p1"));
    assert.ok(Math.abs(after[0].x - before[0].x - 0.05) < 1e-8);
    assert.ok(Math.abs(after[0].y - before[0].y - 0.1) < 1e-8);
    assert.equal(bookPop(moved, "p1")?.parentId, "p1");
  },
);
check(
  "shrinking furniture returns overflow to unplaced without losing POP",
  () => {
    const small = resizeFurniture(scene, "f1", 0.08, 0.1);
    assert.equal(unplacedBooks(small).length, 2);
    assert.equal(bookPop(small, "p1")?.text, "一枚目の言葉");
    assert.deepEqual(validateScene(small), []);
  },
);
check("deleting furniture retains books and POPs for re-placement", () => {
  const removed = deleteFurniture(scene, "f1");
  assert.equal(unplacedBooks(removed).length, 2);
  assert.equal(bookPop(removed, "p2")?.text, "別の言葉");
  assert.deepEqual(validateScene(removed), []);
  removed.objects.push(...base().objects);
  const restored = placeBook(removed, "p1", "r2", 0);
  assert.equal(objectById(restored, "p1")?.parentId, "r2");
  assert.equal(bookPop(restored, "p1")?.text, "一枚目の言葉");
  assert.deepEqual(validateScene(restored), []);
});
check(
  "order is upper row then left-to-right without crossing furniture",
  () => {
    const next = addBookPlacement(scene, books[1], "r1", "p3", "spine", 1);
    assert.deepEqual(
      furnitureBooks(next, "f1").map((p) => p.id),
      ["p1", "p3", "p2"],
    );
  },
);
check("rotated geometry checks canvas and reserved regions", () => {
  assert.ok(
    validateScene(moveFurniture(scene, "f1", 0.55, 0.04, 35)).some((e) =>
      e.includes("forbidden"),
    ),
  );
  assert.ok(
    validateScene(moveFurniture(scene, "f1", 0.8, 0.8, 40)).some((e) =>
      e.includes("outside canvas"),
    ),
  );
});
check("missing parents and cycles are rejected without looping", () => {
  const missing = structuredClone(scene);
  objectById(missing, "p1")!.parentId = "missing";
  assert.ok(validateScene(missing).some((e) => e.includes("missing parent")));
  const cycle = base();
  objectById(cycle, "f1")!.parentId = "r1";
  assert.ok(validateScene(cycle).some((e) => e.includes("cyclic")));
});
check("orphan POP and unknown Book are rejected", () => {
  const bad = structuredClone(scene);
  bookPop(bad, "p1")!.parentId = "r1";
  objectById(bad, "p2")!.bookId = "unknown";
  assert.ok(
    validateScene(bad, new Set(books.map((b) => b.id))).some((e) =>
      e.includes("POP needs"),
    ),
  );
  assert.ok(
    validateScene(bad, new Set(books.map((b) => b.id))).some((e) =>
      e.includes("invalid book"),
    ),
  );
});
check("overlapping books exceed physical row capacity", () => {
  const bad = structuredClone(scene);
  objectById(bad, "p2")!.parentId = "r1";
  objectById(bad, "p2")!.rect = structuredClone(objectById(bad, "p1")!.rect);
  assert.ok(validateScene(bad).some((e) => e.includes("over capacity")));
});
check("placement JSON roundtrip includes unplaced books and POPs", () => {
  const deleted = deleteFurniture(scene, "f1");
  assert.deepEqual(sceneFromJson(sceneToJson(deleted)), deleted);
  assert.throws(() => sceneFromJson('{"schemaVersion":99}'));
});
check("all demo templates validate and differ through data", () => {
  const variants = shops.map((s, i) => woodScene(s, books, i));
  variants.forEach((s) =>
    assert.deepEqual(
      validateScene(s, new Set(books.map((b) => b.id))),
      [],
      s.storeId,
    ),
  );
  // Books are drawn large, so the spine-only store is the densest rather than
  // holding a fixed count.
  const placed = (scene: (typeof variants)[number]) =>
    scene.objects.filter((o) => o.kind === "book" && o.parentId).length;
  assert.ok(placed(variants[1]) > 20);
  assert.ok(variants.every((s) => placed(variants[1]) >= placed(s)));
  assert.ok(variants[3].objects.some((o) => o.furnitureType === "table"));
  assert.ok(
    variants[2].objects
      .filter((o) => o.kind === "book")
      .every((o) => o.display === "face"),
  );
});
check("private shelf content never enters a walk or public POP lookup", () => {
  const shop = structuredClone(shops[0]);
  shop.shelves[0].isPublic = false;
  const view = woodScene(shop, books);
  assert.ok(
    !view.objects.some((o) => o.source?.shelfId === shop.shelves[0].id),
  );
  assert.ok(
    publicScenePops([view]).every(
      (p) => p.legacy?.shelfId !== shop.shelves[0].id,
    ),
  );
});
check("explicit link beats resume and visited state", () => {
  let walk = startWalk(emptyWalk(), ["a", "b", "c"]);
  walk = stepWalk(walk, 1);
  walk = visitStore(walk, "c");
  assert.equal(startWalk(walk, ["a", "b", "c"], "c").lastStoreId, "c");
});
check("resume keeps fixed order and new session puts unvisited first", () => {
  let walk = visitStore(emptyWalk(), "b");
  walk = startWalk(walk, ["a", "b", "c"]);
  assert.deepEqual(walk.session?.ids, ["a", "c", "b"]);
  walk = stepWalk(walk, 1);
  walk = visitStore(walk, "a");
  assert.deepEqual(startWalk(walk, ["a", "b", "c"]).session?.ids, [
    "a",
    "c",
    "b",
  ]);
  assert.equal(startWalk(walk, ["a", "b", "c"]).lastStoreId, "c");
});
check(
  "unavailable shop is skipped without inserting new shops mid-session",
  () => {
    let walk = startWalk(emptyWalk(), ["a", "b", "c"]);
    walk = stepWalk(walk, 1);
    const resumed = startWalk(walk, ["a", "c", "d"]);
    assert.deepEqual(resumed.session?.ids, ["a", "c"]);
    assert.equal(resumed.lastStoreId, "c");
  },
);
check("the walk goes round, and starts again from the least recent", () => {
  let walk = startWalk(emptyWalk(), ["a", "b"]);
  walk = stepWalk(walk, -1);
  assert.equal(walk.lastStoreId, "a");
  walk = stepWalk(stepWalk(walk, 1), 1);
  assert.equal(walk.lastStoreId, "a");
  assert.equal(walk.session?.ended, false);
  // With every shop visited, a new walk begins at the one visited longest ago.
  walk = visitStore(
    visitStore(emptyWalk(), "b", "2026-10-01T00:00:00Z"),
    "a",
    "2026-10-02T00:00:00Z",
  );
  assert.deepEqual(startWalk(walk, ["a", "b"]).session?.ids, ["b", "a"]);
  assert.equal(startWalk(walk, ["a", "b"]).session?.ended, false);
  assert.equal(
    startWalk(walk, ["a", "b"], undefined, undefined, true).lastStoreId,
    "a",
  );
  // Only a town without shops has nowhere to walk.
  assert.equal(startWalk(emptyWalk(), []).session?.ended, true);
  assert.equal(stepWalk(startWalk(emptyWalk(), []), 1).lastStoreId, null);
});
check("history deletion keeps local reactions", () => {
  const walk = visitStore(emptyWalk(), "a");
  walk.reactions.a = { liked: true, saved: true, message: "ありがとう" };
  const cleared = clearVisits(walk);
  assert.deepEqual(cleared.visits, {});
  assert.equal(cleared.session, null);
  assert.equal(cleared.reactions.a.message, "ありがとう");
});
check("visit needs visible time or intentional interaction", () => {
  assert.equal(qualifiedVisit(2999, true, false), false);
  assert.equal(qualifiedVisit(3000, false, false), false);
  assert.equal(qualifiedVisit(3000, true, false), true);
  assert.equal(qualifiedVisit(0, true, true), true);
});
check(
  "gesture separates taps, diagonal motion and a single shop transition",
  () => {
    assert.equal(verticalSwipe(0, 4, 100), null);
    assert.equal(verticalSwipe(100, 60, 200), null);
    assert.equal(verticalSwipe(4, -100, 300), 1);
    assert.equal(verticalSwipe(4, 100, 300), -1);
  },
);
check(
  "walk roundtrip retains scene data, rejects corruption and unknown versions",
  () => {
    const walk = startWalk(emptyWalk(), ["a"]);
    assert.deepEqual(decodeWalk(encodeWalk(walk, [scene])).data, {
      schemaVersion: 2,
      walkState: walk,
      sceneOverrides: [scene],
      legacyBackups: [],
    });
    assert.equal(decodeWalk("{broken").status, "recovered");
    assert.equal(decodeWalk('{"schemaVersion":2}').status, "recovered");
  },
);
check("legacy storage envelope is unchanged", () => {
  const town = createInitialState();
  const raw = serializeTown(town);
  assert.equal(JSON.parse(raw).version, 1);
  assert.deepEqual(deserializeTown(raw).state.ownShop, town.ownShop);
});
check("row display and density changes retain placements and POPs", () => {
  const changed = setRowStyle(
    scene,
    "r1",
    { mode: "spine", bookHeight: 0.12, gap: 0.01 },
    books,
  );
  assert.equal(objectById(changed, "p1")?.display, "spine");
  assert.equal(bookPop(changed, "p1")?.text, "一枚目の言葉");
  assert.deepEqual(validateScene(changed), []);
});
check("rotated furniture resize preserves physical book dimensions", () => {
  const rotated = moveFurniture(scene, "f1", 0.05, 0.2, 8);
  const changed = resizeFurniture(rotated, "f1", 0.68, 0.42);
  const p = objectById(changed, "p1")!;
  const polygon = worldPolygon(changed, p)!;
  assert.ok(
    Math.abs(
      (Math.hypot(
        ((polygon[1].x - polygon[0].x) * 9) / 16,
        polygon[1].y - polygon[0].y,
      ) *
        16) /
        9 -
        p.preferredSize!.w,
    ) < 1e-8,
  );
  assert.deepEqual(validateScene(changed), []);
});
console.log(passed + " walk domain checks passed");
