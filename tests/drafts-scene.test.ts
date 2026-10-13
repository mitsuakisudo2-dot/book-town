import assert from "node:assert/strict";
import { books, createInitialState } from "../src/lib/data";
import { createKeptDraftStore } from "../src/lib/kept-draft";
import {
  SCENE_DRAFT_KEY,
  keepUntilSaved,
  readKeptScene,
  sceneDraftOptions,
  sceneMark,
  sceneWorkKey,
  sceneWorkState,
  type KeptScene,
} from "../src/lib/scene-draft";
import { objectById, type StoreScene } from "../src/lib/store-scene";
import {
  changePlacement,
  migrateShopScene,
  renameSceneObject,
} from "../src/lib/store-customization";
import {
  emptyWalkData,
  type WalkBackend,
  type WalkBackendListener,
} from "../src/lib/walk-backend";
import { createWalkStore } from "../src/lib/walk-store";
import type { PersistenceStatus, Shop } from "../src/lib/types";

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
  const mine = sceneWorkKey("reader-1", "mine")!;
  store.set(mine, work);
  store.set(sceneWorkKey("demo", "mine")!, work);
  // Another reader on the same browser has nothing of the first one's.
  assert.equal(store.get(sceneWorkKey("reader-2", "mine")!), null);
  assert.equal(store.get(sceneWorkKey("reader-1", "elsewhere")!), null);
  const reopened = createKeptDraftStore(sceneDraftOptions, () => storage);
  reopened.initialize();
  assert.deepEqual(reopened.get(mine), work);
  assert.equal(
    objectById(reopened.get(mine)!.scene, "greeting")?.text,
    "ようこそ、雨の日の本屋へ。",
  );
  reopened.clear(mine);
  reopened.clear(sceneWorkKey("demo", "mine")!);
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
        "u-1/mine": { scene: { objects: "no" }, from: "a" },
        "reader:u-1/mine": work,
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

const town = createInitialState();
town.ownShop = shop;
/** A reader's account whose saves the check settles by hand. */
function accountWalk(scenes: StoreScene[]) {
  let listener: WalkBackendListener | null = null;
  let answer: PersistenceStatus = "saving";
  let switchTo: (backend: WalkBackend) => void = () => {};
  const account: WalkBackend = {
    kind: "account",
    load: () => ({ data: { ...emptyWalkData(), scenes }, status: "saved" }),
    save: () => answer,
    writable: () => true,
    watch(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  const walk = createWalkStore(account, {
    follow(next) {
      switchTo = next;
      next(account);
    },
  });
  walk.initialize();
  return {
    walk,
    /** What the account answers at once to the next save. */
    answer: (status: PersistenceStatus) => void (answer = status),
    report: (status: PersistenceStatus) => listener!.status(status),
    refuse: (held: StoreScene[]) =>
      listener!.replace({ ...emptyWalkData(), scenes: held }, "recovered"),
    signOut: () =>
      switchTo({
        kind: "local",
        load: () => ({ data: emptyWalkData(), status: "saved" }),
        save: () => "saved",
        writable: () => true,
      }),
  };
}
const key = sceneWorkKey("reader-1", "mine")!;
/** Saves the kept work to the account as the editor does, and closes. */
function send(
  account: ReturnType<typeof accountWalk>,
  store: ReturnType<typeof createKeptDraftStore<KeptScene>>,
  sent: KeptScene,
) {
  store.set(key, sent);
  assert.equal(account.walk.saveScene(sent.scene, town).ok, true);
  keepUntilSaved(store, key, sent.scene, account.walk);
}

check("an account's save lets the work go once the account has it", () => {
  const storage = memory();
  const store = createKeptDraftStore(sceneDraftOptions, () => storage);
  const account = accountWalk([saved]);
  send(account, store, work);
  // On its way, and waiting out network trouble: still kept.
  assert.deepEqual(store.get(key), work);
  account.report("unavailable");
  assert.deepEqual(store.get(key), work);
  account.report("saved");
  // Gone with the editor closed, so a scene saved later on another device
  // finds no older work here to offer.
  assert.equal(store.get(key), null);
  assert.equal(storage.data.has(SCENE_DRAFT_KEY), false);
  // A scene the account already holds lets the work go at once.
  const again = accountWalk([work.scene]);
  again.answer("saved");
  send(again, store, work);
  assert.equal(store.get(key), null);
});

check(
  "a refused save keeps the work, to go on from the account's scene",
  () => {
    const store = createKeptDraftStore(sceneDraftOptions, () => memory());
    const account = accountWalk([saved]);
    send(account, store, work);
    account.refuse([saved]);
    assert.deepEqual(store.get(key), work);
    assert.equal(sceneWorkState(store.get(key)!, sceneMark(saved)), "fresh");
    // Nothing heard afterwards lets it go.
    account.report("saved");
    assert.deepEqual(store.get(key), work);
    // Nor does signing out while the save is on its way.
    const leaving = accountWalk([saved]);
    send(leaving, store, work);
    leaving.signOut();
    assert.deepEqual(store.get(key), work);
  },
);

check("work begun after a save is not let go with it", () => {
  const store = createKeptDraftStore(sceneDraftOptions, () => memory());
  const account = accountWalk([saved]);
  send(account, store, work);
  // Reopened before the account answered, and written on.
  const more: KeptScene = {
    scene: renameSceneObject(work.scene, "sign", "続きの店"),
    from: sceneMark(work.scene),
  };
  store.set(key, more);
  account.report("saved");
  assert.deepEqual(store.get(key), more);
  // Saved again in turn, only the last scene's work is let go, once.
  send(account, store, more);
  account.report("saved");
  assert.equal(store.get(key), null);
});

console.log(passed + " scene draft checks passed");
