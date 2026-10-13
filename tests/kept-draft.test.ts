import assert from "node:assert/strict";
import {
  createKeptDraftStore,
  isKeptNotice,
  keptIds,
  keptText,
} from "../src/lib/kept-draft";
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
  ])
    assert.equal(isKeptNotice(refused), true, refused);
  for (const done of ["記録を書き直しました", "『こころ』を登録しました"])
    assert.equal(isKeptNotice(done), false, done);
}

console.log("kept-draft ok");
