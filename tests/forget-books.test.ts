import assert from "node:assert/strict";
import { createInitialState } from "../src/lib/data";
import { forgettable, notKeptInBrowser } from "../src/lib/forget-books";
import { createMemoryRepository } from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import type { PersistenceStatus, TownState } from "../src/lib/types";

// A book taken back in the scanner is forgotten when its scan ends
// (AUD-055, forget-books.ts): only a book that scan brought in and left
// taken back, used nowhere else; in the demo at once, in an account by the
// database's answer, taken in without being written back.

const SCAN = "30000000-0000-4000-8000-000000000001";
const EARLIER = "30000000-0000-4000-8000-000000000002";
let clock = Date.parse("2026-10-24T03:00:00.000Z");
const tick = () => new Date((clock += 1000));

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log("PASS " + name);
}

const isbnOf = (n: number) => {
  const body = "978409" + String(n).padStart(6, "0");
  const sum = [...body].reduce(
    (total, digit, at) => total + Number(digit) * (at % 2 ? 3 : 1),
    0,
  );
  return body + ((10 - (sum % 10)) % 10);
};

type Store = ReturnType<typeof createTownStore>;
/** Book `n` read in scan `batch`, then taken back. */
function takenBack(store: Store, n: number, batch = SCAN): string {
  const done = store.actions.registerBook(
    { title: "試験の本 " + n, author: "試験 花子", isbn: isbnOf(n) },
    "scan",
    undefined,
    batch,
  );
  assert.ok(done && done.result === "added");
  store.actions.changeLibrary([done.bookId], { removed: true });
  assert.ok(!store.getSnapshot().library.includes(done.bookId));
  return done.bookId;
}
const has = (store: Store, id: string) =>
  store.getSnapshot().books.some((book) => book.id === id);

async function main() {
  await check(
    "in the demo, a book of the scan still taken back goes with its row",
    async () => {
      const store = createTownStore(
        createMemoryRepository(createInitialState()),
        tick,
      );
      store.initialize();
      const book = takenBack(store, 1);
      assert.ok(store.getSnapshot().libraryEntries[book]);
      assert.deepEqual(await store.forget([book], SCAN), [book]);
      assert.equal(has(store, book), false);
      assert.equal(store.getSnapshot().libraryEntries[book], undefined);
    },
  );

  await check(
    "a book back in the library, of another scan, wished or without an ISBN stays",
    async () => {
      const store = createTownStore(
        createMemoryRepository(createInitialState()),
        tick,
      );
      store.initialize();
      const back = takenBack(store, 2);
      store.actions.changeLibrary([back], { removed: false });
      const other = takenBack(store, 3, EARLIER);
      const wished = takenBack(store, 4);
      store.actions.toggleWish(wished);
      const typed = store.actions.registerBook(
        { title: "手帖の本", author: "アキ" },
        "manual",
        undefined,
        SCAN,
      );
      assert.ok(typed && typed.result === "added");
      store.actions.changeLibrary([typed.bookId], { removed: true });
      const asked = [back, other, wished, typed.bookId];
      assert.deepEqual(forgettable(store.getSnapshot(), asked, SCAN), []);
      assert.deepEqual(await store.forget(asked, SCAN), []);
      for (const id of asked) assert.ok(has(store, id));
      // Another reader's book, one the town lacks: nothing.
      assert.deepEqual(await store.forget(["nobody"], SCAN), []);
    },
  );

  await check(
    "in an account, the database is asked once what is saved has them out, and its answer taken in unwritten",
    async () => {
      const demo = createTownStore(
        createMemoryRepository(createInitialState()),
        tick,
      );
      demo.initialize();
      const one = takenBack(demo, 5);
      const two = takenBack(demo, 6);
      const start = demo.getSnapshot();
      let status: PersistenceStatus = "saving";
      let shown: TownState = start;
      const saves: TownState[] = [];
      const asked: string[][] = [];
      let tell: ((update: PersistenceStatus) => void) | null = null;
      const store = createTownStore(
        {
          kind: "account",
          newId: () => crypto.randomUUID(),
          load: () => ({ state: start, status }),
          save: (state) => {
            saves.push(state);
            return status;
          },
          watch: (listener) => {
            tell = listener.status;
            return () => {};
          },
          absorb: (take) => (shown = take(shown, shown)),
          forgetBooks: async (books, batch) => {
            assert.equal(batch, SCAN);
            // Each with when it was taken out, as saved.
            for (const book of books)
              assert.equal(
                book.removedAt,
                start.libraryEntries[book.id]?.removedAt,
              );
            asked.push(books.map((book) => book.id));
            // The database keeps one: something else came to name the other.
            return [one];
          },
        },
        tick,
      );
      store.initialize();
      const forgetting = store.forget([one, two], SCAN);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Not while the taking back is on its way.
      assert.deepEqual(asked, []);
      status = "saved";
      tell!("saved");
      assert.deepEqual(await forgetting, [one]);
      assert.deepEqual(asked, [[one, two]]);
      assert.equal(has(store, one), false);
      assert.ok(has(store, two));
      // Taken in as the database's own: nothing is saved for it.
      assert.equal(saves.length, 0);
    },
  );

  await check("a save turned away asks nothing", async () => {
    const demo = createTownStore(
      createMemoryRepository(createInitialState()),
      tick,
    );
    demo.initialize();
    const book = takenBack(demo, 7);
    let asked = 0;
    const store = createTownStore(
      {
        kind: "account",
        newId: () => crypto.randomUUID(),
        load: () => ({ state: demo.getSnapshot(), status: "recovered" }),
        save: () => "recovered",
        absorb: (take) => take(demo.getSnapshot(), demo.getSnapshot()),
        forgetBooks: async () => {
          asked += 1;
          return [];
        },
      },
      tick,
    );
    store.initialize();
    assert.deepEqual(await store.forget([book], SCAN), []);
    assert.equal(asked, 0);
  });

  await check(
    "a book that work kept in this browser names stays, and storage that will not be read keeps all",
    () => {
      const kept: Record<string, string> = {
        "book-town-scene-drafts-v1": JSON.stringify({
          "me:shop": { books: ["b-1"] },
        }),
        "book-town-walk-v1": JSON.stringify({ scene: { bookIds: ["b-2"] } }),
        "book-town-left-v1": "b-3",
      };
      const storage = {
        get length() {
          return Object.keys(kept).length;
        },
        key: (at: number) => Object.keys(kept)[at] ?? null,
        getItem: (key: string) => kept[key] ?? null,
      };
      assert.deepEqual(
        notKeptInBrowser(["b-1", "b-2", "b-3", "b-4"], storage),
        ["b-3", "b-4"],
      );
      assert.deepEqual(notKeptInBrowser(["b-4"], null), []);
      assert.deepEqual(
        notKeptInBrowser(["b-4"], {
          length: 1,
          key: () => "book-town-post-drafts-v1",
          getItem: () => {
            throw new Error("blocked");
          },
        }),
        [],
      );
    },
  );

  console.log(`${passed} forget-books checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
