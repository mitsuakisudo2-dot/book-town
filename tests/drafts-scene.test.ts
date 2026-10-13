import assert from "node:assert/strict";
import { books } from "../src/lib/data";
import { createKeptDraftStore } from "../src/lib/kept-draft";
import {
  SCENE_DRAFT_KEY,
  readKeptScene,
  sceneDraftOptions,
  sceneMark,
  sceneWorkKey,
  sceneWorkState,
  type KeptScene,
} from "../src/lib/scene-draft";
import { objectById } from "../src/lib/store-scene";
import {
  changePlacement,
  migrateShopScene,
  renameSceneObject,
} from "../src/lib/store-customization";
import type { Shop } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed++;
  console.log("PASS " + name);
}
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const shop: Shop = {
  id: "mine",
  ownerId: "me",
  name: "小さな灯り",
  description: "",
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
      ],
    },
  ],
};
const saved = migrateShopScene(shop, books);
const work: KeptScene = {
  scene: changePlacement(
    renameSceneObject(saved, "greeting", "ようこそ、雨の日の本屋へ。"),
    "placement:mine:a",
    { pop: "遠い星の海で" },
    books,
  ),
  from: sceneMark(saved),
};

check("work is kept per reader and shop, and read back by a new page", () => {
  const storage = memory();
  const store = createKeptDraftStore(sceneDraftOptions, () => storage);
  const mine = sceneWorkKey("reader-1", "mine");
  store.set(mine, work);
  store.set(sceneWorkKey(null, "mine"), work);
  // Another reader on the same browser has nothing of the first one's.
  assert.equal(store.get(sceneWorkKey("reader-2", "mine")), null);
  assert.equal(store.get(sceneWorkKey("reader-1", "elsewhere")), null);
  const reopened = createKeptDraftStore(sceneDraftOptions, () => storage);
  reopened.initialize();
  assert.deepEqual(reopened.get(mine), work);
  assert.equal(
    objectById(reopened.get(mine)!.scene, "greeting")?.text,
    "ようこそ、雨の日の本屋へ。",
  );
  reopened.clear(mine);
  reopened.clear(sceneWorkKey(null, "mine"));
  assert.equal(storage.data.has(SCENE_DRAFT_KEY), false);
});

check("work that is not a scene the editor makes is not read back", () => {
  const broken = (change: (scene: KeptScene["scene"]) => void) => {
    const copy = structuredClone(work);
    change(copy.scene);
    return readKeptScene(copy);
  };
  assert.deepEqual(readKeptScene(work), work);
  assert.equal(readKeptScene({ scene: work.scene }), null);
  assert.equal(readKeptScene({ ...work, from: 3 }), null);
  assert.equal(readKeptScene("scene"), null);
  // Longer than the fields take.
  assert.equal(
    broken(
      (s) => (objectById(s, "pop:placement:mine:a")!.text = "あ".repeat(10001)),
    ),
    null,
  );
  assert.ok(
    broken(
      (s) => (objectById(s, "pop:placement:mine:a")!.text = "あ".repeat(10000)),
    ),
  );
  assert.equal(
    broken((s) => (objectById(s, "sign")!.text = "店".repeat(81))),
    null,
  );
  assert.equal(
    broken((s) => (objectById(s, "row-0")!.text = "棚".repeat(81))),
    null,
  );
  // The greeting starts as the shop's description, which can be longer.
  assert.ok(
    broken((s) => (objectById(s, "greeting")!.text = "a".repeat(2000))),
  );
  assert.equal(
    broken((s) => (objectById(s, "greeting")!.text = "a".repeat(2001))),
    null,
  );
  assert.equal(
    broken((s) => (objectById(s, "stamp")!.stamp = "skull")),
    null,
  );
  assert.equal(
    broken((s) => (objectById(s, "sign")!.rect.x = 2)),
    null,
  );
  assert.equal(
    broken((s) => (s.ownerManaged = false)),
    null,
  );
  // Stored work with a bad entry keeps the good one.
  const storage = memory();
  storage.setItem(
    SCENE_DRAFT_KEY,
    JSON.stringify({
      version: 1,
      drafts: {
        "demo/mine": work,
        "reader:x/mine": { scene: { objects: "no" }, from: "a" },
        "stray/mine": work,
      },
    }),
  );
  const store = createKeptDraftStore(sceneDraftOptions, () => storage);
  store.initialize();
  assert.deepEqual(Object.keys(store.getSnapshot().drafts), ["demo/mine"]);
});

check("a scene's mark reads what it holds, not how it was written", () => {
  // The database gives keys back in its own order, and its own shop id.
  const reordered = JSON.parse(
    JSON.stringify(saved, (_, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  reordered.storeId = "a-database-id";
  assert.equal(sceneMark(reordered), sceneMark(saved));
  assert.notEqual(sceneMark(work.scene), sceneMark(saved));
  assert.equal(sceneMark(undefined), "none");
});

check("work is fresh, stale after another save, or already saved", () => {
  assert.equal(sceneWorkState(work, sceneMark(saved)), "fresh");
  // Saved over since on another device: the work is not used on its own.
  const elsewhere = renameSceneObject(saved, "sign", "別の端末の店");
  assert.equal(sceneWorkState(work, sceneMark(elsewhere)), "stale");
  // The account has the very scene the work holds: nothing left to keep.
  assert.equal(sceneWorkState(work, sceneMark(work.scene)), "saved");
  // Work begun before the first save goes on from no saved scene at all.
  assert.equal(
    sceneWorkState({ ...work, from: sceneMark(undefined) }, "none"),
    "fresh",
  );
});

console.log(passed + " scene draft checks passed");
