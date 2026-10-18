import assert from "node:assert/strict";
import {
  createKeptDraftStore,
  forgetOwnerEverywhere,
  isKeptNotice,
  keptIds,
  keptText,
} from "../src/lib/kept-draft";
import { closingNotice } from "../src/lib/scan";
import { SAVE_REFUSED } from "../src/lib/shop-draft";

type Note = { text: string; ids: string[] };
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const options = {
  storageKey: "test-drafts-v1",
  keyPattern: /^(new|note:.+)$/,
  read(value: unknown): Note | null {
    const note = value as Partial<Note> | null;
    if (!note || !keptText(note.text, 20) || !keptIds(note.ids, 3)) return null;
    return { text: note.text, ids: [...note.ids] };
  },
  isEmpty: (note: Note) => !note.text && !note.ids.length,
  limit: 3,
};

{
  // Work written is read back by a new page, and cleared work is gone.
  const storage = memory();
  const store = createKeptDraftStore<Note>(options, () => storage);
  assert.equal(store.getSnapshot().loaded, false);
  assert.equal(store.getServerSnapshot().loaded, false);
  store.set("note:a", { text: "書きかけ", ids: ["momo"] });
  assert.deepEqual(store.get("note:a"), { text: "書きかけ", ids: ["momo"] });
  assert.equal(store.getSnapshot().loaded, true);
  const reopened = createKeptDraftStore<Note>(options, () => storage);
  reopened.initialize();
  assert.deepEqual(reopened.get("note:a"), { text: "書きかけ", ids: ["momo"] });
  reopened.clear("note:a");
  assert.equal(reopened.get("note:a"), null);
  assert.equal(storage.data.has("test-drafts-v1"), false);
}

{
  // Two tabs of the same store: each keeps what the other wrote, and a
  // change in one is heard by the other (the storage event).
  const storage = memory();
  const heard: ((event: { key: string | null }) => void)[] = [];
  const realWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, listener: never) => {
      if (type === "storage") heard.push(listener);
    },
  };
  const tabA = createKeptDraftStore<Note>(options, () => storage);
  const tabB = createKeptDraftStore<Note>(options, () => storage);
  const stopA = tabA.subscribe(() => {});
  tabA.set("note:a", { text: "Aの感想", ids: [] });
  tabB.initialize();
  tabB.set("note:b", { text: "B", ids: [] });
  // Tab A's next keystroke does not take tab B's work out of storage.
  tabA.set("note:a", { text: "Aの感想です", ids: [] });
  const kept = () =>
    Object.keys(JSON.parse(storage.getItem("test-drafts-v1")!).drafts).sort();
  assert.deepEqual(kept(), ["note:a", "note:b"]);
  // Nor does tab B's clearing of its own work take tab A's.
  tabB.clear("note:b");
  assert.deepEqual(kept(), ["note:a"]);
  assert.deepEqual(tabB.get("note:a"), { text: "Aの感想です", ids: [] });
  // A move in one tab keeps the other's work too.
  tabB.set("new", { text: "新しい", ids: [] });
  tabA.move("new", "note:c");
  assert.deepEqual(kept(), ["note:a", "note:c"]);
  // The other tab hears of a change and shows it.
  tabB.set("note:b", { text: "またB", ids: [] });
  assert.equal(tabA.get("note:b"), null);
  for (const listener of heard) listener({ key: "test-drafts-v1" });
  assert.deepEqual(tabA.get("note:b"), { text: "またB", ids: [] });
  for (const listener of heard) listener({ key: "another-key" });
  assert.deepEqual(tabA.get("note:b"), { text: "またB", ids: [] });
  stopA();
  (globalThis as { window?: unknown }).window = realWindow;
}

{
  // Work that only this tab holds (storage refused it) is kept on the next
  // change, with what storage holds from other tabs.
  const storage = memory();
  let refuse = true;
  const tab = createKeptDraftStore<Note>(options, () => ({
    ...storage,
    setItem: (key, value) => {
      if (refuse) throw new Error("full");
      storage.setItem(key, value);
    },
  }));
  tab.set("note:mine", { text: "ここだけ", ids: [] });
  assert.equal(tab.getSnapshot().saved, false);
  const other = createKeptDraftStore<Note>(options, () => storage);
  other.set("note:other", { text: "ほかのタブ", ids: [] });
  refuse = false;
  tab.set("new", { text: "次", ids: [] });
  assert.deepEqual(
    Object.keys(JSON.parse(storage.getItem("test-drafts-v1")!).drafts).sort(),
    ["new", "note:mine", "note:other"],
  );
  assert.equal(tab.getSnapshot().saved, true);
}

{
  // Empty work is not kept; keys outside the store are ignored.
  const storage = memory();
  const store = createKeptDraftStore<Note>(options, () => storage);
  store.set("new", { text: "", ids: [] });
  assert.equal(store.get("new"), null);
  store.set("other:x", { text: "x", ids: [] });
  assert.equal(store.get("other:x"), null);
  assert.equal(storage.data.size, 0);
}

{
  // The least recently written entry goes first past the limit.
  const storage = memory();
  const store = createKeptDraftStore<Note>(options, () => storage);
  for (const key of ["note:1", "note:2", "note:3"])
    store.set(key, { text: key, ids: [] });
  store.set("note:1", { text: "again", ids: [] });
  store.set("note:4", { text: "four", ids: [] });
  assert.deepEqual(Object.keys(store.getSnapshot().drafts), [
    "note:3",
    "note:1",
    "note:4",
  ]);
}

{
  // Malformed or oversized entries read back are dropped, the rest kept.
  const storage = memory();
  storage.setItem(
    "test-drafts-v1",
    JSON.stringify({
      version: 1,
      drafts: {
        "note:ok": { text: "よし", ids: [] },
        "note:long": { text: "あ".repeat(21), ids: [] },
        "note:ids": { text: "x", ids: ["a", "b", "c", "d"] },
        "note:bad": { text: 3, ids: [] },
        "stray:1": { text: "x", ids: [] },
      },
    }),
  );
  const store = createKeptDraftStore<Note>(options, () => storage);
  store.initialize();
  assert.deepEqual(Object.keys(store.getSnapshot().drafts), ["note:ok"]);
  const broken = memory();
  broken.setItem("test-drafts-v1", "{not json");
  const fromBroken = createKeptDraftStore<Note>(options, () => broken);
  fromBroken.initialize();
  assert.deepEqual(fromBroken.getSnapshot().drafts, {});
}

{
  // Storage that refuses keeps the work in memory and says it was not saved.
  const store = createKeptDraftStore<Note>(options, () => ({
    getItem: () => null,
    setItem: () => {
      throw new Error("full");
    },
    removeItem: () => {},
  }));
  store.set("new", { text: "まだ", ids: [] });
  assert.deepEqual(store.get("new"), { text: "まだ", ids: [] });
  assert.equal(store.getSnapshot().saved, false);
  let heard = 0;
  const stop = store.subscribe(() => heard++);
  store.set("new", { text: "まだまだ", ids: [] });
  stop();
  store.set("new", { text: "もう", ids: [] });
  assert.equal(heard, 1);
}

{
  // A refused save that kept the work is told without the tick of a save.
  for (const refused of [
    SAVE_REFUSED,
    "保存できませんでした。書きかけはそのまま残しています",
    "街を読み込んでいます。下書きはそのまま残しています",
    "プロフィールを保存できませんでした。書きかけは残しています。",
    // The scanner's books kept on the device, not registered yet.
    closingNotice({ added: 0, waiting: 1, later: 1 })!,
    closingNotice({ added: 0, waiting: 0, later: 2 })!,
    "まだ保存できません。読み込みが終わってから、もう一度押してください",
    "『こころ』は端末に控えました。ページを読み込み直すと登録します",
    "『こころ』は、読み込みが終わったら登録します",
  ])
    assert.equal(isKeptNotice(refused), true, refused);
  for (const done of [
    "記録を書き直しました",
    "『こころ』を登録しました",
    closingNotice({ added: 2, waiting: 1, later: 1 })!,
    "控えていた3冊を登録しました",
    "控えに戻しました",
    "控えから外しました",
  ])
    assert.equal(isKeptNotice(done), false, done);
}

{
  // 退会: one owner's work goes, in every store, from storage as well as
  // this tab; other owners' work, and work from before keys had owners,
  // stays.
  const storage = memory();
  const owned = {
    storageKey: "test-owned-v1",
    keyPattern: /^[\w-]+:note:.+$|^[\w-]+$/,
    unowned: /^note:.+$/,
    read: options.read,
    isEmpty: options.isEmpty,
  };
  const store = createKeptDraftStore<Note>(owned, () => storage);
  store.set("u-1:note:a", { text: "私の", ids: [] });
  store.set("u-1", { text: "名前", ids: [] });
  store.set("u-12:note:a", { text: "別の人", ids: [] });
  // Another tab kept more for them, and old work waits for its owner.
  const raw = JSON.parse(storage.getItem("test-owned-v1")!);
  raw.drafts["u-1:note:b"] = { text: "別のタブ", ids: [] };
  raw.drafts["note:old"] = { text: "前の", ids: [] };
  storage.setItem("test-owned-v1", JSON.stringify(raw));
  const other = createKeptDraftStore<Note>(
    { ...options, storageKey: "test-other-v1", keyPattern: /^[\w-]+:.+$/ },
    () => storage,
  );
  other.set("u-1:x", { text: "ほか", ids: [] });
  forgetOwnerEverywhere("u-1");
  assert.equal(store.get("u-1:note:a"), null);
  assert.equal(store.get("u-1"), null);
  assert.deepEqual(store.get("u-12:note:a"), { text: "別の人", ids: [] });
  assert.deepEqual(
    Object.keys(JSON.parse(storage.getItem("test-owned-v1")!).drafts).sort(),
    ["note:old", "u-12:note:a"],
  );
  assert.equal(other.get("u-1:x"), null);
  assert.equal(storage.data.has("test-other-v1"), false);
  // Nothing of theirs: nothing is written.
  let writes = 0;
  const counted = createKeptDraftStore<Note>(
    { ...owned, storageKey: "test-counted-v1" },
    () => ({
      ...storage,
      setItem: (key, value) => {
        writes += 1;
        storage.setItem(key, value);
      },
    }),
  );
  counted.forget("u-9");
  assert.equal(writes, 0);
}

console.log("kept-draft ok");
