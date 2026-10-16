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
  Object.assign(globalThis, { window: { localStorage: memory } });
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
  forgetReaderHere(ben);
  for (const key of PER_ACCOUNT_KEYS) {
    assert.equal(store.has(key + ben), false, key);
    assert.equal(store.has(key + chi), true, key);
  }
  const kept = JSON.parse(store.get("book-town-post-drafts-v1") ?? "{}");
  assert.deepEqual(Object.keys(kept.drafts), [chi + ":timeline"]);
  assert.ok(![...store.values()].some((value) => value.includes(ben)));

  console.log("leave ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
