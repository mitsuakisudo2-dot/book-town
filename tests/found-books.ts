import assert from "node:assert/strict";
import { createTownStore } from "../src/lib/store";
import { accountTownBackend } from "../src/lib/supabase/town-backend";
import { bookById } from "../src/lib/book-name";
import { holds, mine } from "../src/lib/own-books";
import { moreKey } from "../src/lib/town-more";
import type { PersistenceStatus } from "../src/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";

// A book a page read after the town (a search's find_books, a book's page's
// work_records) and the town does not hold: the town reads only its newest
// books, and the library's catalog has thousands more. Put in the library,
// 読みたい or お気に入り, it is taken in as the database's own row, so the
// reader's rows name it, and it is never written back as a book the reader
// typed in; another reader's is copied first (own-books.ts). Run by
// own-books.test.ts.

type Row = Record<string, unknown>;

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const FAR = "00000000-0000-4000-8000-000000005000";
const THEIRS = "00000000-0000-4000-8000-000000005001";
// Aki typed this in long ago, and nothing of hers names it now.
const HERS = "00000000-0000-4000-8000-000000005002";
const at = (n: number) =>
  new Date(Date.parse("2026-10-01T00:00:00Z") + n * 1000).toISOString();
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;

const profile = (id: string, handle: string): Row => ({
  id,
  handle,
  name: handle,
  bio: "",
  color: "#768281",
  links: [],
  compose_icon: "pen",
  reading_visibility: "private",
  nine_version: 0,
  created_at: at(0),
  updated_at: at(0),
});
const book = (id: string, n: number, more: Row = {}): Row => ({
  id,
  isbn: null,
  title: "本" + n,
  author: "著者",
  publisher: "",
  price: null,
  source: "ndl",
  work_id: id,
  created_at: at(n),
  updated_at: at(n),
  ...more,
});

/** Aki's town, with two old books past the town's newest 300. */
function seed(): Record<string, Row[]> {
  return {
    profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
    books: [
      book(FAR, 0, { title: "遠い海の図書館", isbn: "9784000000019" }),
      book(THEIRS, 0, {
        title: "遠い山の手帖",
        isbn: "9784000000026",
        source: "manual",
        created_by: BEN,
      }),
      book(HERS, 0, {
        title: "遠い川の記録",
        source: "manual",
        created_by: AKI,
      }),
      ...Array.from({ length: 400 }, (_, n) => book(uuid(n), n + 1)),
    ],
    posts: [],
    my_books: [{ id: HERS, copied_from: null }],
  };
}

async function settled(
  store: ReturnType<typeof createTownStore>,
): Promise<PersistenceStatus> {
  for (let wait = 0; wait < 400; wait++) {
    const status = store.getPersistenceSnapshot();
    if (status !== "loading" && status !== "saving" && status !== "unavailable")
      return status;
    await new Promise((resume) => setTimeout(resume, 5));
  }
  throw new Error("The town never settled: " + store.getPersistenceSnapshot());
}

/** The checks, each run by the caller's `check`. */
export async function foundBookChecks(
  check: (name: string, run: () => Promise<void>) => Promise<void>,
) {
  const townOf = async (db: ReturnType<typeof fakeSupabase>) => {
    const store = createTownStore(
      accountTownBackend(db.client, AKI, {
        delay: 0,
        retryDelays: [10],
        storage: false,
      }),
    );
    store.initialize();
    assert.equal(await settled(store), "saved");
    return store;
  };
  const found = async (
    store: Awaited<ReturnType<typeof townOf>>,
    search: string,
  ) => {
    await store.more({ search });
    return store.getMore(moreKey({ search }))?.books ?? [];
  };

  await check(
    "a catalog book a search found goes in the library, and no book row is written",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const store = await townOf(db);
      assert.equal(bookById(store.getSnapshot().books, FAR), undefined);
      assert.ok((await found(store, "海の図書")).some((b) => b.id === FAR));
      const rows = db.tables.books.length;

      store.actions.toggleLibrary(FAR);
      store.actions.toggleWish(FAR);
      store.actions.toggleFavorite(FAR);
      const town = store.getSnapshot();
      assert.ok(holds(town, town.library, FAR));
      assert.ok(town.wishlist.includes(FAR));
      assert.ok(town.favorites.includes(FAR));
      assert.equal(await settled(store), "saved");
      // The catalog's row is named as it is: never typed in again.
      assert.equal(db.tables.books.length, rows);
      assert.ok(!db.writes.some((write) => write.table === "books"));
      assert.deepEqual(
        db.tables.library_entries.map((row) => row.book_id),
        [FAR],
      );
      assert.deepEqual(
        db.tables.book_marks.map((row) => [row.book_id, row.kind]).sort(),
        [
          [FAR, "favorite"],
          [FAR, "library"],
          [FAR, "wish"],
        ],
      );

      // Read again, the town has it, in the library.
      const again = (await townOf(db)).getSnapshot();
      assert.ok(bookById(again.books, FAR));
      assert.ok(again.library.includes(FAR));

      // Taken out again, as any book of the library is.
      store.actions.toggleLibrary(FAR);
      assert.ok(!store.getSnapshot().library.includes(FAR));
      assert.equal(await settled(store), "saved");
      assert.ok(
        !db.tables.book_marks.some(
          (row) => row.book_id === FAR && row.kind === "library",
        ),
      );
    },
  );

  await check(
    "another reader's book a search found is copied first, and no row names it",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const store = await townOf(db);
      const theirs = (await found(store, "山の手帖")).find(
        (b) => b.id === THEIRS,
      );
      assert.equal(theirs?.theirs, true);

      store.actions.toggleLibrary(THEIRS);
      const town = store.getSnapshot();
      const copy = mine(town, THEIRS);
      assert.notEqual(copy, THEIRS);
      assert.ok(holds(town, town.library, THEIRS));
      assert.equal(await settled(store), "saved");
      assert.deepEqual(db.tables.my_books.slice(1), [
        { id: copy, copied_from: THEIRS },
      ]);
      assert.ok(
        !db.writes.some(
          (write) => write.op === "upsert" && write.table === "books",
        ),
      );
      assert.ok(!JSON.stringify(db.tables.library_entries).includes(THEIRS));
    },
  );

  await check(
    "the reader's own old book a search found is theirs, and is not copied",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const store = await townOf(db);
      assert.equal(bookById(store.getSnapshot().books, HERS), undefined);
      const hers = (await found(store, "川の記録")).find((b) => b.id === HERS);
      assert.ok(hers && !hers.theirs);

      store.actions.toggleLibrary(HERS);
      assert.ok(store.getSnapshot().library.includes(HERS));
      assert.equal(await settled(store), "saved");
      assert.equal(db.tables.my_books.length, 1);
      assert.ok(!db.writes.some((write) => write.table === "books"));
    },
  );

  await check(
    "a book's page's book, read with its work, is taken in the same way",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const store = await townOf(db);
      await store.more({ work: FAR });
      assert.ok(
        store.getMore(moreKey({ work: FAR }))?.books.some((b) => b.id === FAR),
      );
      assert.equal(store.actions.ownBook(FAR), FAR);
      store.actions.toggleLibrary(FAR);
      assert.ok(store.getSnapshot().library.includes(FAR));
      assert.equal(await settled(store), "saved");
      assert.ok(!db.writes.some((write) => write.table === "books"));
    },
  );

  await check(
    "a book no page read is still turned away, and a refused row is told",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const store = await townOf(db);
      // Nothing read it: the town does not make it up.
      const before = store.getSnapshot();
      store.actions.toggleLibrary(FAR);
      assert.equal(store.getSnapshot(), before);
      assert.equal(db.writes.length, 0);

      await found(store, "海の図書");
      db.refuse = (write) =>
        write.table === "book_marks"
          ? { status: 403, code: "42501", message: "refused" }
          : null;
      store.actions.toggleLibrary(FAR);
      assert.equal(await settled(store), "recovered");
      // Back to what is saved: not in the library, and still no book row.
      assert.ok(!store.getSnapshot().library.includes(FAR));
      assert.ok(!db.writes.some((write) => write.table === "books"));
      // Asked again once it is taken, it is.
      db.refuse = () => null;
      store.actions.toggleLibrary(FAR);
      assert.equal(await settled(store), "saved");
      assert.ok(store.getSnapshot().library.includes(FAR));
      assert.ok(
        db.tables.book_marks.some(
          (row) => row.book_id === FAR && row.kind === "library",
        ),
      );
    },
  );
}
