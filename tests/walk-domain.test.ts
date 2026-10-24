import assert from "node:assert/strict";
import { books, shops } from "../src/lib/data";
import type { BookDisplay, Shop } from "../src/lib/types";

const LEGACY_TAGLINE = "あなたの愛した一冊が、誰かの愛する一冊になる。";
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
  safeBackgroundUrl,
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
  horizontalSwipe,
  qualifiedVisit,
  startWalk,
  stepShelf,
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
check("a new owner's few books stand together as covers at eye level", () => {
  const own = (shelves: Shop["shelves"], tagline = ""): Shop => ({
    id: "mine",
    ownerId: "me",
    name: "雨音書店",
    description: "",
    tagline,
    theme: "sage",
    followers: 0,
    demo: false,
    shelves,
  });
  const shelf = (id: string, name: string, n: number, from = 0) => ({
    id,
    name,
    capacity: 20,
    isPublic: true,
    items: books.slice(from, from + n).map((b, i) => ({
      id: id + "-" + i,
      bookId: b.id,
      display: "spine" as BookDisplay,
      pop: "",
    })),
  });
  const view = woodScene(
    own([shelf("first", "はじめの本棚", 3)], LEGACY_TAGLINE),
    books,
  );
  const tierOf = (id: string) => objectById(view, id)!.parentId;
  const ids = ["first-0", "first-1", "first-2"].map(
    (item) => "placement:mine:" + item,
  );
  // While one tier holds them, they stand on the middle tier, all as covers,
  // centred, a little larger than a full shelf's (管理表 113).
  assert.deepEqual(ids.map(tierOf), ["row-1", "row-1", "row-1"]);
  assert.deepEqual(
    ids.map((id) => objectById(view, id)!.display),
    ["face", "face", "face"],
  );
  const middle = objectById(view, "row-1")!;
  assert.equal(middle.align, "center");
  assert.ok(middle.bookHeight! > 0.149);
  const xs = ids.map((id) => objectById(view, id)!.rect);
  const left = Math.min(...xs.map((r) => r.x));
  const right = 1 - Math.max(...xs.map((r) => r.x + r.w));
  assert.ok(left > 0.02 && Math.abs(left - right) < 1e-9);
  const odd = structuredClone(view);
  (objectById(odd, "row-1") as { align?: string }).align = "left";
  assert.deepEqual(validateScene(odd), ["row-1: invalid alignment"]);
  // Only the tier with books carries the shelf's name and chalkboard; the
  // tiers above and below stay a display shelf.
  assert.deepEqual(
    view.objects.filter((o) => o.kind === "row").map((o) => o.text ?? null),
    [null, "はじめの本棚", null],
  );
  // The old default slogan is not shown as the owner's words.
  assert.equal(objectById(view, "greeting")!.text, "");
  assert.deepEqual(validateScene(view, new Set(books.map((b) => b.id))), []);

  // Four still all show their covers, in every store style, and none is
  // left off the tier.
  for (let variant = 0; variant < 6; variant++) {
    const four = woodScene(
      own([shelf("first", "はじめの本棚", 4)]),
      books,
      variant,
    );
    const placed = four.objects.filter((o) => o.kind === "book");
    assert.equal(placed.length, 4);
    assert.ok(
      placed.every((o) => o.parentId === "row-1" && o.display === "face"),
    );
  }

  // More books turn spines from the right, still on the one tier.
  const nine = woodScene(own([shelf("first", "はじめの本棚", 9)]), books);
  const onNine = nine.objects.filter(
    (o) => o.kind === "book" && o.parentId === "row-1",
  );
  assert.equal(onNine.length, 9);
  const nineFaces = onNine.filter((o) => o.display === "face").length;
  assert.ok(nineFaces >= 1 && nineFaces < 9);
  assert.equal(objectById(nine, "row-1")!.bookHeight, 0.149);
  assert.deepEqual(validateScene(nine, new Set(books.map((b) => b.id))), []);

  // A full shelf flows on to the next tier, which shares its chalkboard.
  const full = woodScene(own([shelf("first", "はじめの本棚", 20)]), books);
  const rows = full.objects.filter((o) => o.kind === "row");
  assert.ok(rows.every((row) => row.align === undefined));
  const onRow = (row: string) =>
    full.objects.filter((o) => o.kind === "book" && o.parentId === row).length;
  assert.ok(onRow("row-0") > 3 && onRow("row-1") > 0);
  assert.equal(rows[1].text, "はじめの本棚");
  // Books past what the tiers hold stay in the scene, unplaced; none is lost.
  assert.equal(full.objects.filter((o) => o.kind === "book").length, 20);

  // Two shelves each start on a tier of their own.
  const two = woodScene(
    own([shelf("a", "人生の9冊", 2), shelf("b", "今年の5冊", 2, 4)]),
    books,
  );
  assert.equal(objectById(two, "placement:mine:a-1")!.parentId, "row-0");
  assert.equal(objectById(two, "placement:mine:b-0")!.parentId, "row-1");
  assert.deepEqual(
    two.objects.filter((o) => o.kind === "row").map((o) => o.text ?? null),
    ["人生の9冊", "今年の5冊", null],
  );
  // On a full shelf, an owner's own face-out choice is kept as it is.
  const chosen = shelf("first", "はじめの本棚", 20);
  chosen.items[2].display = "face";
  const kept = woodScene(own([chosen]), books);
  assert.deepEqual(
    chosen.items
      .slice(0, 3)
      .map((item) => objectById(kept, "placement:mine:" + item.id)!.display),
    ["spine", "spine", "face"],
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
check("a sideways swipe moves one shelf; pushing left goes to the next", () => {
  assert.equal(horizontalSwipe(-100, 4, 300), 1);
  assert.equal(horizontalSwipe(100, 4, 300), -1);
  assert.equal(horizontalSwipe(4, 0, 100), null);
  assert.equal(horizontalSwipe(-100, 4, 1400), null);
  assert.equal(horizontalSwipe(-100, 70, 300), null);
});
check("a sideways swipe keeps the design's three limits", () => {
  // At least 56 across.
  assert.equal(horizontalSwipe(-56, 0, 300), 1);
  assert.equal(horizontalSwipe(56, 0, 300), -1);
  assert.equal(horizontalSwipe(-55, 0, 300), null);
  // More than one and a half times as far across as up or down.
  assert.equal(horizontalSwipe(-60, 39, 300), 1);
  assert.equal(horizontalSwipe(-60, -39, 300), 1);
  assert.equal(horizontalSwipe(-60, 40, 300), null);
  // Over in less than 1.4 seconds.
  assert.equal(horizontalSwipe(-200, 10, 1399), 1);
  assert.equal(horizontalSwipe(-200, 10, 1400), null);
});
check("no gesture changes both the shop and the shelf", () => {
  for (const duration of [100, 1399, 1400])
    for (let dx = -300; dx <= 300; dx += 4)
      for (let dy = -300; dy <= 300; dy += 4)
        assert.ok(
          verticalSwipe(dx, dy, duration) === null ||
            horizontalSwipe(dx, dy, duration) === null,
          dx + "," + dy + "," + duration,
        );
});
check("shelves stop at either end instead of going round", () => {
  assert.deepEqual(stepShelf(0, 3, 1), { index: 1, atEdge: false });
  assert.deepEqual(stepShelf(2, 3, -1), { index: 1, atEdge: false });
  assert.deepEqual(stepShelf(2, 3, 1), { index: 2, atEdge: true });
  assert.deepEqual(stepShelf(0, 3, -1), { index: 0, atEdge: true });
  for (const direction of [-1, 1] as const)
    assert.deepEqual(stepShelf(0, 1, direction), { index: 0, atEdge: true });
  // An index left from a shop with more shelves is brought back in range.
  assert.deepEqual(stepShelf(5, 2, 1), { index: 1, atEdge: true });
});
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
check("only the town's own theme pictures stand behind a shop", () => {
  assert.equal(
    safeBackgroundUrl("/themes/woodshop/room-bokeh-v1.webp"),
    "/themes/woodshop/room-bokeh-v1.webp",
  );
  for (const url of [
    undefined,
    "",
    "https://example.com/track.gif",
    "//example.com/room.webp",
    "/themes/../api/secret",
    "/themes/woodshop/../../x.webp",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "/elsewhere/room.webp",
  ])
    assert.equal(safeBackgroundUrl(url), undefined, String(url));
});
console.log(passed + " walk domain checks passed");
