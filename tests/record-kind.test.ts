import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  demoBooks,
  demoPosters,
  demoPosts,
  demoReaders,
  demoShops,
  seedState,
} from "../src/lib/data";
import { booksBeforeSearch } from "../src/lib/book-lists";
import { isDatabaseId, isSampleId, recordKind } from "../src/lib/record-kind";
import { bookKind, sampleBookRowId } from "../src/lib/samples";
import { createTownStore } from "../src/lib/store";
import { counterId } from "../src/lib/town-backend";
import { ME_ID, OWN_SHOP_ID, type TownState } from "../src/lib/types";

// Whether a reader, a shop, a 便り or a poster is the viewer's own, kept in
// the database, or a 見本's is asked of src/lib/record-kind.ts alone, and a
// book of `bookKind` (src/lib/samples.ts). Asked anywhere else, by hand, a
// 見本 could miss its 「見本」 or offer a button that reaches nobody, and a
// real reader could be taken for one. The last checks keep it asked here.

const root = path.resolve(__dirname, "..");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const READER = "0b6c2a8e-3f1d-4c55-9a77-2e4f6d8b1a03";
const POST = "5d1e9c40-7a2b-4e86-b3f5-91c0d2e4a6b7";

check("the viewer's own is neither a 見本 nor in the database", () => {
  for (const id of [ME_ID, OWN_SHOP_ID]) {
    assert.equal(recordKind(id), "own");
    assert.equal(isSampleId(id), false);
    assert.equal(isDatabaseId(id), false);
  }
});

check("every 見本 reader, shop, 便り and poster is a 見本", () => {
  const ids = [
    ...demoReaders.map((entry) => entry.id),
    ...demoShops.map((entry) => entry.id),
    ...demoPosts.map((entry) => entry.id),
    ...demoPosters.map((entry) => entry.id),
  ].filter((id) => id !== ME_ID && id !== OWN_SHOP_ID);
  assert.ok(ids.length > 10);
  for (const id of ids) assert.equal(recordKind(id), "sample", id);
});

check("a record from the database is never taken for a 見本", () => {
  for (const id of [READER, POST, READER.toUpperCase()]) {
    assert.equal(recordKind(id), "database");
    assert.equal(isSampleId(id), false);
  }
  // Almost a UUID is not one.
  assert.equal(recordKind(READER + "0"), "sample");
});

check("a 見本's book is the 見本's under its database id too", () => {
  for (const book of demoBooks) {
    assert.equal(bookKind(book.id), "sample");
    const row = sampleBookRowId(book.id);
    assert.ok(isDatabaseId(row), "kept under a UUID");
    assert.equal(bookKind(row), "sample", row);
  }
  assert.equal(bookKind(POST), "database");
  assert.equal(bookKind("my-book-3"), "local");
  assert.equal(bookKind("isbn-9784150119553"), "local");
});

check(
  "a list keeps the 見本's books, by either id, before anything is typed",
  () => {
    const sample = demoBooks[0];
    const town: TownState = {
      ...seedState,
      books: [
        ...seedState.books,
        { ...sample, id: sampleBookRowId(sample.id) },
        { ...sample, id: POST },
      ],
    };
    const ids = booksBeforeSearch(town).map((book) => book.id);
    assert.ok(ids.includes(sample.id));
    assert.ok(ids.includes(sampleBookRowId(sample.id)));
    // A reader's registration nobody uses is not shown before a search.
    assert.ok(!ids.includes(POST));
  },
);

check(
  "with an account, a 見本's 便り about a 見本's book is marked and turned away, a real reader's is not",
  () => {
    const samplePost = seedState.posts.find(
      (post) => post.authorId !== ME_ID && post.bookId,
    )!;
    const realPost = {
      ...samplePost,
      id: POST,
      authorId: READER,
      // Read back from the database, a 見本's book keeps its own id.
      bookId: samplePost.bookId,
    };
    const town: TownState = {
      ...structuredClone(seedState),
      readers: [
        ...seedState.readers,
        { ...seedState.readers[1], id: READER, name: "本物の読書家" },
      ],
      posts: [...seedState.posts, realPost],
    };
    let refused = 0;
    const account = createTownStore(
      {
        kind: "account",
        newId: counterId,
        load: () => ({ state: structuredClone(town), status: "saved" }),
        save: () => "saved",
      },
      undefined,
      { onSample: () => (refused += 1) },
    );
    account.initialize();
    // 「見本」 beside the 見本's name, none beside the real reader's.
    assert.equal(isSampleId(samplePost.authorId), true);
    assert.equal(isSampleId(realPost.authorId), false);
    // The like for the 見本 says why nothing happened.
    const before = account.getSnapshot();
    account.actions.toggleLike(samplePost.id);
    assert.equal(refused, 1);
    assert.equal(account.getSnapshot(), before);
    // The real reader's is kept, and so is wanting the 見本's book.
    account.actions.toggleLike(realPost.id);
    account.actions.toggleWish(samplePost.bookId!);
    assert.equal(refused, 1);
    assert.notEqual(account.getSnapshot(), before);
    assert.ok(account.getSnapshot().wishlist.includes(samplePost.bookId!));
  },
);

/** The app's own code. */
const sources = readdirSync(path.join(root, "src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
  .map((file) => ({
    file,
    text: readFileSync(path.join(root, file), "utf8"),
  }));
const HOME = "src/lib/record-kind.ts";

check("only record-kind.ts tells a database id by its shape", () => {
  const found = sources
    .filter(({ file, text }) => file !== HOME && /\[0-9a-f\]\{8\}-/.test(text))
    .map(({ file }) => file);
  assert.deepEqual(found, [], "use DATABASE_ID or recordKind");
});

check("no judgment of its own: the 見本 is asked of record-kind.ts", () => {
  const own =
    /\b(?:const|let|function)\s+(?:isDatabaseId|isSampleId|isSample|recordKind|bookKind)\b/;
  const found = sources
    .filter(
      ({ file, text }) =>
        file !== HOME && file !== "src/lib/samples.ts" && own.test(text),
    )
    .map(({ file }) => file);
  assert.deepEqual(found, []);
});

check("「not in the database」 is never written for 「a 見本」", () => {
  // !isDatabaseId(...) holds for the viewer's own too: isSampleId says which.
  // Two places mean the database itself: 通報 is kept only for its records,
  // and a 便り is read from it only by a database id.
  const allowed = new Set([
    "src/components/Report.tsx",
    "src/lib/supabase/town-backend.ts",
  ]);
  const found = sources
    .filter(
      ({ file, text }) => !allowed.has(file) && /!\s*isDatabaseId\(/.test(text),
    )
    .map(({ file }) => file);
  assert.deepEqual(found, [], "use isSampleId");
});

check("a book's database id is told from a 見本's by bookKind", () => {
  // Only the code that reads and writes the rows turns one id into the other.
  const allowed = new Set(["src/lib/samples.ts", "src/lib/town-remote.ts"]);
  const found = sources
    .filter(
      ({ file, text }) => !allowed.has(file) && /sampleBookOfRow\(/.test(text),
    )
    .map(({ file }) => file);
  assert.deepEqual(found, [], "use bookKind");
});

console.log(`${passed} record-kind checks passed`);
