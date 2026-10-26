import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { migrationFiles } from "./fixtures/pglite-supabase";
import { helpers, migrated, numbered } from "./fixtures/bibliography";

// A book taken back in the scanner goes when its scan ends (AUD-055;
// supabase/migrations/*_forget_undone_books.sql): forget_books takes the
// caller's own typed book of that scan, still taken out of the library and
// named by nothing else, with its library row, library mark and shelf
// places; any other book it leaves as it is.

const FILE = migrationFiles().find((file) =>
  file.endsWith("_forget_undone_books.sql"),
);
assert.ok(FILE, "the migration forgetting books taken back in a scan");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const SCAN = "30000000-0000-4000-8000-000000000001";
const EARLIER = "30000000-0000-4000-8000-000000000002";
const SHELF = "40000000-0000-4000-8000-000000000001";
const SHOP = "50000000-0000-4000-8000-000000000001";
const book = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const passed: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}

/** Aki's book `n` as the scanner leaves it after ［登録を取り消す］. */
async function takenBack(
  db: PGlite,
  n: number,
  { isbn = true, batch = SCAN }: { isbn?: boolean; batch?: string } = {},
) {
  const { as } = helpers(db);
  await as(
    AKI,
    "insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, '試験 花子', $4)",
    [book(n), isbn ? numbered(n) : null, "試験の本 " + n, AKI],
  );
  await as(
    AKI,
    `insert into library_entries (user_id, book_id, source, batch_id, status, owned)
     values ($1, $2, 'scan', $3, 'finished', 'yes')`,
    [AKI, book(n), batch],
  );
  await as(
    AKI,
    "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'library')",
    [AKI, book(n)],
  );
  await as(
    AKI,
    "update library_entries set removed_at = now() where user_id = $1 and book_id = $2",
    [AKI, book(n)],
  );
}

async function seeded(): Promise<PGlite> {
  const db = await migrated();
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
  `);
  return db;
}

async function main() {
  const db = await seeded();
  const { rows, as, refused, count } = helpers(db);
  /** When the app last saw each book taken out: its saved row's. */
  const outAt = async (ids: string[]) =>
    Promise.all(
      ids.map(async (id) => {
        const [row] = await rows<{ at: string | null }>(
          `select to_char(removed_at at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
           from library_entries where user_id = $1 and book_id = $2`,
          [AKI, id],
        );
        return row?.at ?? "2026-10-24T00:00:00.000Z";
      }),
    );
  const ask = async (
    who: string | null,
    ids: unknown,
    removed: unknown,
    batch: string | null = SCAN,
  ) =>
    (
      await as<{ gone: string[] }>(
        who,
        "select forget_books($1::uuid[], $2::timestamptz[], $3::uuid) as gone",
        [ids, removed, batch],
      )
    )[0].gone;
  const forget = async (who: string | null, ids: string[], batch = SCAN) =>
    ask(who, ids, await outAt(ids), batch);
  const left = (n: number) =>
    count("select count(*) from books where id = $1", [book(n)]);
  const named = (n: number) =>
    count(
      `select (select count(*) from library_entries where book_id = $1)
         + (select count(*) from book_marks where book_id = $1)
         + (select count(*) from library_shelf_books where book_id = $1)`,
      [book(n)],
    );

  await check(
    "a book of this scan still taken back goes, with its library row, mark and shelf place",
    async () => {
      await takenBack(db, 1);
      await as(
        AKI,
        "insert into library_shelves (id, user_id, name, position) values ($1, $2, '旅の棚', 'a')",
        [SHELF, AKI],
      );
      await as(
        AKI,
        "insert into library_shelf_books (shelf_id, user_id, book_id) values ($1, $2, $3)",
        [SHELF, AKI, book(1)],
      );
      assert.equal(await named(1), 3);
      assert.deepEqual(await forget(AKI, [book(1)]), [book(1)]);
      assert.equal(await left(1), 0);
      assert.equal(await named(1), 0);
      // Its shelf stays.
      assert.equal(
        await count("select count(*) from library_shelves where id = $1", [
          SHELF,
        ]),
        1,
      );
      // Asked again, nothing is left to go.
      assert.deepEqual(await forget(AKI, [book(1)]), []);
    },
  );

  await check("a book still in the library stays", async () => {
    await takenBack(db, 2);
    await as(
      AKI,
      "update library_entries set removed_at = null where user_id = $1 and book_id = $2",
      [AKI, book(2)],
    );
    assert.deepEqual(await forget(AKI, [book(2)]), []);
    assert.equal(await left(2), 1);
    assert.equal(await named(2), 2);
  });

  await check(
    "a book of another scan, or that came in some other way, stays",
    async () => {
      await takenBack(db, 3, { batch: EARLIER });
      assert.deepEqual(await forget(AKI, [book(3)]), []);
      assert.equal(await left(3), 1);
      await takenBack(db, 4);
      await rows(
        "update library_entries set batch_id = null where user_id = $1 and book_id = $2",
        [AKI, book(4)],
      );
      assert.deepEqual(await forget(AKI, [book(4)]), []);
      assert.equal(await left(4), 1);
    },
  );

  await check(
    "a book used anywhere stays: once used, wished, posted about, on a shop's shelf",
    async () => {
      await takenBack(db, 5);
      await rows(
        "update library_entries set ever_used = true where user_id = $1 and book_id = $2",
        [AKI, book(5)],
      );
      await takenBack(db, 6);
      await as(
        AKI,
        "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
        [AKI, book(6)],
      );
      await takenBack(db, 7);
      await as(
        AKI,
        "insert into posts (author_id, body, book_id) values ($1, 'よかった', $2)",
        [AKI, book(7)],
      );
      await takenBack(db, 8);
      await rows(
        "insert into shops (id, owner_id, name, is_open) values ($1, $2, 'アキの本屋', true)",
        [SHOP, AKI],
      );
      await rows(
        "insert into shop_private (shop_id, shelves) values ($1, $2)",
        [
          SHOP,
          JSON.stringify([
            {
              id: "s1",
              name: "旅の棚",
              capacity: 12,
              isPublic: false,
              items: [{ id: "i1", bookId: book(8), display: "face" }],
            },
          ]),
        ],
      );
      const asked = [5, 6, 7, 8].map(book);
      assert.deepEqual(await forget(AKI, asked), []);
      for (const n of [5, 6, 7, 8]) assert.equal(await left(n), 1);
    },
  );

  await check(
    "a book without an ISBN stays, with its own edition",
    async () => {
      await takenBack(db, 9, { isbn: false });
      assert.deepEqual(await forget(AKI, [book(9)]), []);
      assert.equal(await left(9), 1);
    },
  );

  await check(
    "only the reader's own: another reader, a visitor and no scan forget nothing",
    async () => {
      await takenBack(db, 10);
      assert.deepEqual(await forget(BEN, [book(10)]), []);
      await refused(
        () => forget(null, [book(10)]),
        /permission denied/,
        "a visitor may not call it",
      );
      assert.deepEqual(
        await ask(AKI, [book(10)], await outAt([book(10)]), null),
        [],
      );
      assert.equal(await left(10), 1);
      // Several at once, the ones that may go going.
      await takenBack(db, 11);
      assert.deepEqual(
        [
          ...(await forget(AKI, [book(11), book(2), book(10), book(11)])),
        ].sort(),
        [book(10), book(11)],
      );
    },
  );

  await check(
    "a book taken out again since, elsewhere or by hand, stays with what its row was given",
    async () => {
      await takenBack(db, 12);
      const seen = await outAt([book(12)]);
      // Brought back on another device, marked, then taken out by hand.
      await as(
        AKI,
        "update library_entries set removed_at = null, status = 'reading' where user_id = $1 and book_id = $2",
        [AKI, book(12)],
      );
      await as(
        AKI,
        "update library_entries set removed_at = now() + interval '1 second' where user_id = $1 and book_id = $2",
        [AKI, book(12)],
      );
      assert.deepEqual(await ask(AKI, [book(12)], seen), []);
      assert.equal(await left(12), 1);
    },
  );

  await check(
    "a book copied, or a list not as asked (nested, uneven, over 200), forgets nothing",
    async () => {
      await takenBack(db, 13);
      await rows(
        "insert into books (id, isbn, title, author, created_by) values ($1, $2, '写し', '試験 花子', $3)",
        [book(113), numbered(13), BEN],
      );
      await rows(
        "insert into private.book_copies (book_id, copied_from, reason) values ($1, $2, 'moved')",
        [book(113), book(13)],
      );
      assert.deepEqual(await forget(AKI, [book(13)]), []);
      assert.equal(await left(13), 1);

      await takenBack(db, 14);
      await takenBack(db, 15);
      const two = await outAt([book(14), book(15)]);
      assert.deepEqual(
        await ask(AKI, [[book(14)], [book(15)]], [[two[0]], [two[1]]]),
        [],
      );
      assert.deepEqual(await ask(AKI, [book(14), book(15)], [two[0]]), []);
      const many = Array.from({ length: 201 }, (_, at) => book(1000 + at));
      many[0] = book(14);
      assert.deepEqual(
        await ask(
          AKI,
          many,
          many.map(() => two[0]),
        ),
        [],
      );
      assert.equal(await left(14), 1);
      assert.equal(await left(15), 1);
      assert.deepEqual(
        [...(await ask(AKI, [book(14), book(15)], two))].sort(),
        [book(14), book(15)],
      );
    },
  );

  await check(
    "the time the app wrote when taking it out is the time it asks with",
    async () => {
      await takenBack(db, 16);
      const wrote = "2026-10-24T05:06:07.890Z";
      await as(
        AKI,
        "update library_entries set removed_at = $3 where user_id = $1 and book_id = $2",
        [AKI, book(16), wrote],
      );
      assert.deepEqual(await ask(AKI, [book(16)], [wrote]), [book(16)]);
    },
  );

  // A reader keeps one book of their own for an ISBN (AUD-010,
  // supabase/migrations/*_own_isbn_once.sql), so a book taken back here
  // and forgotten leaves its ISBN free to be registered again.
  await check(
    "a reader's second book of one ISBN is refused, another reader's, the catalog's and books without one are not, and a forgotten one frees its ISBN",
    async () => {
      const typed = (who: string, id: string, isbn: string | null) =>
        as(
          who,
          "insert into books (id, isbn, title, author, created_by) values ($1, $2, '同じ本', '試験 花子', $3)",
          [id, isbn, who],
        );
      const X = numbered(50);
      await typed(AKI, book(50), X);
      // Sent again under the same id (an answer lost), it is the same book.
      await as(
        AKI,
        `insert into books (id, isbn, title, author, created_by)
         values ($1, $2, '同じ本', '試験 花子', $3) on conflict (id) do nothing`,
        [book(50), X, AKI],
      );
      // From another page under another id: refused, nothing added.
      await refused(
        () => typed(AKI, book(51), X),
        /books_own_isbn/,
        "a second book of an ISBN the reader has",
      );
      assert.equal(await left(51), 0);
      // Nor may another of hers be moved to it.
      await typed(AKI, book(52), numbered(52));
      await refused(
        () =>
          as(AKI, "update books set isbn = $2 where id = $1", [book(52), X]),
        /books_own_isbn/,
        "an ISBN fixed to one the reader has",
      );
      // Another reader, the catalog, and books without an ISBN are free.
      await typed(BEN, book(53), X);
      await rows(
        "insert into books (id, isbn, title, author, source, created_by) values ($1, $2, '同じ本', '', 'ndl', null)",
        [book(54), X],
      );
      await typed(AKI, book(55), null);
      await typed(AKI, book(56), null);
      assert.equal(
        await count("select count(*) from books where isbn = $1", [X]),
        3,
      );
      // Taken back in a scan and forgotten, its ISBN may come in again.
      await takenBack(db, 57);
      await refused(
        () => typed(AKI, book(58), numbered(57)),
        /books_own_isbn/,
        "an ISBN still held by a book taken back",
      );
      assert.deepEqual(await forget(AKI, [book(57)]), [book(57)]);
      await typed(AKI, book(58), numbered(57));
      assert.equal(await left(58), 1);
    },
  );

  await check("the helper is no one's to call through the API", async () => {
    await refused(
      () =>
        as(AKI, "select private.book_used_besides_own($1, $2)", [book(2), AKI]),
      /permission denied/,
      "a reader may not ask about a book's uses",
    );
  });

  console.log(`${passed.length} forget-books checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
