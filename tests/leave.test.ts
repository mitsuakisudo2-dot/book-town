import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// 退会 lets go of everything this browser keeps for the reader
// (src/lib/leave.ts). Every module that keeps a reader's work must be known
// there, or what they left unsent would stay behind on the device.
// Everything runs inside main() because tsx compiles this file as CommonJS.

const root = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.tsx?$/.test(name)
        ? [path]
        : [];
  });

async function main() {
  const source = files(join(root, "src"));
  const leave = readFileSync(join(root, "src/lib/leave.ts"), "utf8");

  // Each store of kept work is made in a module leave.ts imports.
  for (const path of source) {
    if (path.endsWith("kept-draft.ts")) continue;
    const text = readFileSync(path, "utf8");
    if (!/createKeptDraftStore\s*[<(]/.test(text)) continue;
    const name =
      "./" + relative(join(root, "src/lib"), path).replace(/\.tsx?$/, "");
    assert.ok(
      leave.includes(`"${name}"`),
      `${name} keeps work: import it in src/lib/leave.ts`,
    );
  }

  // Each key kept per account (a key, then the account id) is let go of.
  const store = new Map<string, string>();
  const memory = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  // A window that hears other tabs (the storage event).
  const tab = new EventTarget();
  Object.assign(tab, { localStorage: memory });
  Object.assign(globalThis, { window: tab });
  const { PER_ACCOUNT_KEYS, forgetReaderHere } =
    await import("../src/lib/leave");
  const perAccount = new Set<string>();
  for (const path of source)
    for (const match of readFileSync(path, "utf8").matchAll(
      /"(book-town-[\w-]+:)"/g,
    ))
      perAccount.add(match[1]);
  assert.ok(perAccount.size >= 3);
  assert.deepEqual([...perAccount].sort(), [...PER_ACCOUNT_KEYS].sort());

  const ben = "6f1c0a2e-0000-4000-8000-00000000b0b0";
  const chi = "6f1c0a2e-0000-4000-8000-0000000c0c0c";
  for (const key of PER_ACCOUNT_KEYS) {
    store.set(key + ben, "[]");
    store.set(key + chi, "[]");
  }
  store.set(
    "book-town-post-drafts-v1",
    JSON.stringify({
      version: 1,
      drafts: {
        [ben + ":timeline"]: {
          body: "ベンの書きかけ",
          bookId: null,
          spoiler: false,
        },
        [chi + ":timeline"]: {
          body: "チーの書きかけ",
          bookId: null,
          spoiler: false,
        },
      },
    }),
  );
  // A shop's sign is kept as owner/shop (and a shelf's name as owner/shop/shelf).
  store.set(
    "book-town-shop-sign-drafts-v1",
    JSON.stringify({
      version: 1,
      drafts: {
        [ben + "/shop-1"]: { name: "ベンの看板" },
        [chi + "/shop-2"]: { name: "チーの看板" },
      },
    }),
  );
  forgetReaderHere(ben);
  for (const key of PER_ACCOUNT_KEYS) {
    assert.equal(store.has(key + ben), false, key);
    assert.equal(store.has(key + chi), true, key);
  }
  const kept = JSON.parse(store.get("book-town-post-drafts-v1") ?? "{}");
  assert.deepEqual(Object.keys(kept.drafts), [chi + ":timeline"]);
  assert.deepEqual(
    Object.keys(
      JSON.parse(store.get("book-town-shop-sign-drafts-v1") ?? "{}").drafts,
    ),
    [chi + "/shop-2"],
  );
  assert.ok(![...store.values()].some((value) => value.includes(ben)));
  assert.ok(![...store.keys()].some((key) => key.includes(ben)));

  // Another tab still holding their work lets go of it when told, so its
  // next change does not write it back.
  const { createKeptDraftStore } = await import("../src/lib/kept-draft");
  const other = createKeptDraftStore<string>(
    {
      storageKey: "test-other-tab-v1",
      keyPattern: /^[\w-]+:.+$/,
      read: (value) => (typeof value === "string" ? value : null),
    },
    () => memory,
  );
  other.set(chi + ":a", "チーの");
  other.set(ben + ":a", "ベンの");
  // The tab that left cleared storage; this one only hears the word.
  store.set(
    "test-other-tab-v1",
    JSON.stringify({ version: 1, drafts: { [chi + ":a"]: "チーの" } }),
  );
  const told = Object.assign(new Event("storage"), {
    key: "book-town-left-v1",
    newValue: JSON.stringify({ owner: ben, at: 1 }),
  });
  tab.dispatchEvent(told);
  other.set(chi + ":b", "チーの2");
  assert.deepEqual(
    Object.keys(JSON.parse(store.get("test-other-tab-v1") ?? "{}").drafts),
    [chi + ":a", chi + ":b"],
  );
  assert.equal(other.get(ben + ":a"), null);

  console.log("leave ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
