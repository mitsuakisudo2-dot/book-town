import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { demoBooks } from "../src/lib/data";
import { sampleBookRowId } from "../src/lib/samples";
import {
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import {
  answerAll,
  catalog,
  helpers,
  migrated,
  numbered,
  openbd,
  sru,
} from "./fixtures/bibliography";

// Every reader's rows name a book of their own (AUD-001 and AUD-078; the
// owner's answer of 2026-10-18 00:28Z; supabase/migrations/*_own_book_rows.sql):
// the move giving each reader whose rows named someone else's book a copy of
// their own, the 見本's books as the database's rows, a typist's edit and a
// hold that reach no one else, who may call what, and undoing it.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const OWN_FILE = FILES.find((file) => file.endsWith("_own_book_rows.sql"));
assert.ok(OWN_FILE, "the migration giving readers their own book rows");
const OWN = OWN_FILE;
const TEXT = migrationText(OWN);
const LABEL = OWN.replace(/\.sql$/, "");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const PEOPLE = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
`;

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const X = (n: number) => numbered(300 + n);

/** The rollback as the header writes it, and touch_updated_at as it was. */
function rollbackSql(): string {
  const statements = TEXT.slice(0, TEXT.indexOf("\n\n"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
  const first = migrationText(FILES[0]);
  const start = first.indexOf("create function public.touch_updated_at(");
  const touch = first.slice(start, first.indexOf("$$;\n", start) + 4);
  assert.ok(start >= 0, "touch_updated_at in the first migration");
  return (
    statements +
    "\n" +
    touch.replace("create function", "create or replace function")
  );
}

/** The undoing of the move, as the second comment writes it. */
function undoSql(): string {
  const second = TEXT.slice(TEXT.indexOf("\n\n") + 2);
  return second
    .slice(0, second.indexOf("\n\n"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
}

// What Aki typed in, and what Ben and Chi did with it before this file ------------------

const AKIS_X = id(1, 1); // with an ISBN
const AKIS_Y = id(1, 2); // without
const AKIS_POST = id(2, 1);
const BENS_POST = id(2, 2);
const BENS_SHELF = id(3, 1);
const BENS_SHOP = id(4, 1);
const BENS_POSTER = id(5, 1);
const BENS_LIKE = id(6, 1);
const BENS_RECORD = id(7, 1);
const SAMPLE = sampleBookRowId(demoBooks[0].id);

const shelves = (book: string) =>
  JSON.stringify([
    {
      id: "s1",
      name: "旅の棚",
      capacity: 12,
      isPublic: true,
      items: [
        { id: "i1", bookId: book, display: "face", pop: "旅に出たくなる" },
      ],
    },
  ]);
const scene = (book: string) =>
  JSON.stringify({
    storeId: BENS_SHOP,
    objects: [
      {
        id: "row1",
        kind: "row",
        parentId: null,
        isPublic: true,
        rect: { x: 0, y: 0, w: 1, h: 0.2 },
        z: 1,
      },
      {
        id: "placement:i1",
        kind: "book",
        parentId: "row1",
        bookId: book,
        isPublic: true,
        rect: { x: 0, y: 0, w: 0.1, h: 0.2 },
        z: 3,
        source: { shopId: BENS_SHOP, shelfId: "s1", itemId: "i1" },
      },
    ],
  });

async function seeded(): Promise<PGlite> {
  const db = await migrated(OWN);
  await db.exec(`
    ${PEOPLE}
    insert into books (id, isbn, title, author, publisher, price, created_by) values
      ('${AKIS_X}', '${X(1)}', '架空の図書館', '山田一郎', '架空書房', 1200, '${AKI}'),
      ('${AKIS_Y}', null, '手帖の本', 'アキ', '', null, '${AKI}');
    insert into library_entries (user_id, book_id, source) values
      ('${AKI}', '${AKIS_X}', 'isbn'), ('${AKI}', '${AKIS_Y}', 'manual');
    insert into posts (id, author_id, body, book_id) values
      ('${AKIS_POST}', '${AKI}', 'よかった', '${AKIS_X}');

    -- Ben registered the same ISBN and was given Aki's row, and used it.
    insert into library_entries (user_id, book_id, source, status, status_at) values
      ('${BEN}', '${AKIS_X}', 'isbn', 'reading', '2026-10-01T00:00:00Z');
    insert into library_shelves (id, user_id, name, position) values
      ('${BENS_SHELF}', '${BEN}', '旅', 'a');
    insert into library_shelf_books (shelf_id, user_id, book_id) values
      ('${BENS_SHELF}', '${BEN}', '${AKIS_X}');
    insert into book_marks (user_id, book_id, kind) values
      ('${BEN}', '${AKIS_X}', 'wish'), ('${BEN}', '${AKIS_X}', 'favorite');
    insert into posts (id, author_id, body, book_id) values
      ('${BENS_POST}', '${BEN}', '旅先で読んだ', '${AKIS_X}');
    insert into book_encounters (id, user_id, book_id, kind, via, post_id) values
      ('${BENS_LIKE}', '${BEN}', '${AKIS_X}', 'like', 'post', '${AKIS_POST}');
    insert into reading_entries (id, user_id, book_id, audience) values
      ('${BENS_RECORD}', '${BEN}', '${AKIS_X}', 'everyone');
    insert into reading_sessions (user_id, book_id, mode) values
      ('${BEN}', '${AKIS_X}', 'together');
    insert into profile_nine (profile_id, position, book_id) values
      ('${BEN}', 1, '${AKIS_X}');
    insert into posters (id, author_id, template, pages) values
      ('${BENS_POSTER}', '${BEN}', 'lineup',
       '[{"blocks": [{"type": "heading", "text": "旅の本"},
                     {"type": "books", "book_ids": ["${AKIS_X}", "${AKIS_Y}"]}]}]');
    insert into shops (id, owner_id, name, is_open) values
      ('${BENS_SHOP}', '${BEN}', 'ベンの本屋', true);
    insert into shop_private (shop_id, shelves, scene) values
      ('${BENS_SHOP}', '${shelves(AKIS_X)}', '${scene(AKIS_X)}');

    -- Chi wanted Aki's book without an ISBN.
    -- (Her mark brings it into her library, as library_follows_marks does.)
    insert into book_marks (user_id, book_id, kind) values ('${CHI}', '${AKIS_Y}', 'wish');

    -- Ben was the first to keep a 見本's book, so its row was his; Chi keeps it too.
    insert into books (id, title, author, created_by) values
      ('${SAMPLE}', '${demoBooks[0].title}', '${demoBooks[0].author}', '${BEN}');
    insert into book_marks (user_id, book_id, kind) values
      ('${BEN}', '${SAMPLE}', 'wish'), ('${CHI}', '${SAMPLE}', 'wish');
  `);
  // As if all this were written a while ago, so a kept time shows.
  await db.exec(`
    update posters set updated_at = '2026-10-03T00:00:00Z';
    update reading_entries set updated_at = '2026-10-03T00:00:00Z';
    update shops set updated_at = '2026-10-03T00:00:00Z';
    update shop_private set updated_at = '2026-10-03T00:00:00Z';
    update library_entries set updated_at = '2026-10-03T00:00:00Z';
  `);
  return db;
}

/** Which of nobody, Aki, Ben and Chi can read a book's row. */
async function readersOf(db: PGlite, book: string) {
  const { as } = helpers(db);
  const seen: boolean[] = [];
  for (const visitor of [null, AKI, BEN, CHI])
    seen.push(
      (await as(visitor, "select 1 from books where id = $1", [book])).length >
        0,
    );
  return seen;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // The move ---------------------------------------------------------------------------

  {
    const db = await seeded();
    const { rows, count } = helpers(db);
    const timesOf = () =>
      rows(
        `select 'posters' as t, updated_at::text from posters
         union all select 'reading_entries', updated_at::text from reading_entries
         union all select 'shops', updated_at::text from shops
         union all select 'shop_private', updated_at::text from shop_private
         union all select 'library_entries', updated_at::text from library_entries
         order by 1, 2`,
      );
    const timesWere = await timesOf();
    const akisWere = await rows(
      "select to_jsonb(b) - 'id' - 'created_by' as row from books b where id = $1",
      [AKIS_X],
    );
    await db.exec(TEXT);
    const copyOf = async (reader: string, book: string) =>
      (
        await rows<{ book_id: string }>(
          `select c.book_id from private.book_copies c join books b on b.id = c.book_id
           where c.copied_from = $1 and b.created_by = $2`,
          [book, reader],
        )
      ).map((row) => row.book_id);

    await check(
      "the move gives each reader whose rows name a book someone else typed in a copy of their own, and moves every row of theirs to it",
      async () => {
        const [bensX] = await copyOf(BEN, AKIS_X);
        const [bensY] = await copyOf(BEN, AKIS_Y);
        const [chisY] = await copyOf(CHI, AKIS_Y);
        assert.ok(bensX && bensY && chisY, "a copy each");
        assert.deepEqual(await copyOf(AKI, AKIS_X), [], "not for its typist");
        // Ben's rows, every kind of them, name his copy now.
        const named = (sql: string) =>
          rows<{ book_id: string }>(sql, [BEN]).then((r) =>
            r.map((row) => row.book_id),
          );
        assert.deepEqual(
          await named(
            `select book_id from library_entries where user_id = $1
             order by book_id = '${SAMPLE}'`,
          ),
          [bensX, SAMPLE],
        );
        assert.deepEqual(
          await named(
            "select book_id from library_shelf_books where user_id = $1",
          ),
          [bensX],
        );
        assert.deepEqual(
          (
            await rows<{ book_id: string; kind: string }>(
              "select book_id, kind from book_marks where user_id = $1 order by book_id = $2, kind",
              [BEN, SAMPLE],
            )
          ).map((row) => [row.book_id, row.kind]),
          [
            [bensX, "favorite"],
            [bensX, "wish"],
            [SAMPLE, "wish"],
          ],
        );
        for (const table of [
          "posts where author_id = $1",
          "book_encounters where user_id = $1",
          "reading_entries where user_id = $1",
          "reading_sessions where user_id = $1",
          "profile_nine where profile_id = $1",
        ])
          assert.deepEqual(
            await named(`select book_id from ${table}`),
            [bensX],
            table,
          );
        assert.deepEqual(
          await named(
            "select pb.book_id from poster_books pb join posters p on p.id = pb.poster_id where p.author_id = $1 order by pb.book_id",
          ),
          [bensX, bensY].sort(),
        );
        const [shop] = await rows<{
          shelves: { items: { bookId: string; pop: string }[] }[];
          public_shelves: { items: { bookId: string }[] }[];
          scene_books: string[];
          public_scene_books: string[];
        }>(
          `select sp.shelves, s.public_shelves, sp.scene_books, s.public_scene_books
           from shop_private sp join shops s on s.id = sp.shop_id where s.owner_id = $1`,
          [BEN],
        );
        assert.deepEqual(shop.shelves[0].items[0], {
          id: "i1",
          bookId: bensX,
          display: "face",
          pop: "旅に出たくなる",
        });
        assert.equal(shop.public_shelves[0].items[0].bookId, bensX);
        assert.deepEqual(shop.scene_books, [bensX]);
        assert.deepEqual(shop.public_scene_books, [bensX]);
        // Aki's rows still name her book, and Chi's name her own copy.
        assert.deepEqual(
          (
            await rows<{ book_id: string }>(
              "select book_id from library_entries where user_id = $1 order by book_id",
              [AKI],
            )
          ).map((row) => row.book_id),
          [AKIS_X, AKIS_Y],
        );
        assert.deepEqual(
          (
            await rows<{ book_id: string }>(
              `select book_id from library_entries where user_id = $1 and book_id <> $2
               union all select book_id from book_marks where user_id = $1 and book_id <> $2`,
              [CHI, SAMPLE],
            )
          ).map((row) => row.book_id),
          [chisY, chisY],
        );
        // A copy is its book but for its id and whose it is: in its ISBN's
        // edition, or, without one, in the book's own edition and work.
        const book = (bookId: string) =>
          rows<Record<string, unknown>>(
            "select to_jsonb(b) - 'id' - 'created_by' as row, created_by from books b where id = $1",
            [bookId],
          ).then((r) => r[0]);
        assert.deepEqual((await book(bensX)).row, akisWere[0].row);
        assert.equal((await book(bensX)).created_by, BEN);
        assert.deepEqual((await book(bensY)).row, (await book(AKIS_Y)).row);
        assert.deepEqual((await book(chisY)).row, (await book(AKIS_Y)).row);
        assert.equal(
          await count(
            "select count(*) from editions e where not exists (select 1 from books b where b.edition_id = e.id)",
          ),
          0,
          "no edition is left without a book",
        );
        assert.deepEqual(
          await rows(
            "select copied_from, reason from private.book_copies order by copied_from, book_id",
          ),
          [
            { copied_from: AKIS_X, reason: "moved" },
            { copied_from: AKIS_Y, reason: "moved" },
            { copied_from: AKIS_Y, reason: "moved" },
          ],
        );
        // Placed when Aki's book was, and judged again as Ben's own.
        assert.deepEqual(
          await rows(
            `select c.placed_at = o.placed_at as same_place, c.checked_at is null as due
             from private.book_checks c, private.book_checks o
             where c.book_id = $1 and o.book_id = $2`,
            [bensX, AKIS_X],
          ),
          [{ same_place: true, due: true }],
        );
        // Nothing moved looks changed: every time stays.
        assert.deepEqual(await timesOf(), timesWere);
      },
    );

    await check(
      "after the move each reader reads their copy where they read the book, and Aki's book is read where she uses it",
      async () => {
        const [bensX] = await copyOf(BEN, AKIS_X);
        const [chisY] = await copyOf(CHI, AKIS_Y);
        // Ben's copy is in his public post and shop: everyone reads it.
        assert.deepEqual(await readersOf(db, bensX), [true, true, true, true]);
        // Aki's is in her public post.
        assert.deepEqual(await readersOf(db, AKIS_X), [true, true, true, true]);
        // Aki's book without an ISBN is in no public place now, and Chi's
        // copy of it is hers alone.
        assert.deepEqual(await readersOf(db, AKIS_Y), [
          false,
          true,
          false,
          false,
        ]);
        assert.deepEqual(await readersOf(db, chisY), [
          false,
          false,
          false,
          true,
        ]);
      },
    );

    await check(
      "the 見本's books are rows of the database's, with nobody's name: the one Ben made is nobody's, and every reader's mark of it stays",
      async () => {
        const kept = await rows<{
          id: string;
          title: string;
          author: string;
          isbn: string | null;
          publisher: string;
          price: number | null;
          source: string;
          created_by: string | null;
        }>(
          "select id, title, author, isbn, publisher, price, source, created_by from books where id = any ($1::uuid[]) order by id",
          [demoBooks.map((book) => sampleBookRowId(book.id))],
        );
        assert.deepEqual(
          kept,
          demoBooks
            .map((book) => ({
              id: sampleBookRowId(book.id),
              title: book.title,
              author: book.author,
              isbn: null,
              publisher: "",
              price: null,
              source: "manual",
              created_by: null,
            }))
            .sort((a, b) => (a.id < b.id ? -1 : 1)),
        );
        assert.equal(
          await count(
            "select count(*) from books b where private.is_sample_book(b.id)",
          ),
          demoBooks.length,
          "private.is_sample_book knows every 見本's book",
        );
        assert.equal(
          await count("select count(*) from book_marks where book_id = $1", [
            SAMPLE,
          ]),
          2,
        );
        assert.deepEqual(await readersOf(db, SAMPLE), [
          false,
          false,
          true,
          true,
        ]);
      },
    );

    await check(
      "a reader's write of a 見本's book changes nothing and is not refused; nobody edits one",
      async () => {
        const { as } = helpers(db);
        for (const reader of [AKI, BEN]) {
          const saved = await as<{ n: number }>(
            reader,
            `with saved as (
               insert into books (id, title, author, source, created_by)
               values ($1, $2, $3, 'manual', $4) on conflict (id) do nothing returning 1)
             select count(*)::int as n from saved`,
            [SAMPLE, demoBooks[0].title, demoBooks[0].author, reader],
          );
          assert.equal(saved[0].n, 0, reader);
          const edited = await as<{ n: number }>(
            reader,
            `with edited as (update books set title = '別の題名' where id = $1 returning 1)
             select count(*)::int as n from edited`,
            [SAMPLE],
          );
          assert.equal(edited[0].n, 0, reader);
        }
        assert.equal(
          (
            await rows<{ title: string }>(
              "select title from books where id = $1",
              [SAMPLE],
            )
          )[0].title,
          demoBooks[0].title,
        );
      },
    );

    await check(
      "a typist and a reader given a copy can each leave: their own rows go, and the copies stay books",
      async () => {
        const [bensX] = await copyOf(BEN, AKIS_X);
        const copies = await count("select count(*) from private.book_copies");
        await deleteAccounts(db, [AKI]);
        assert.deepEqual(
          await rows(
            "select book_id from book_marks where user_id = $1 and book_id = $2",
            [BEN, bensX],
          ),
          [{ book_id: bensX }, { book_id: bensX }],
        );
        assert.deepEqual(
          await rows(
            "select created_by from books where id = any ($1::uuid[]) order by created_by",
            [[AKIS_X, bensX]],
          ),
          [{ created_by: BEN }, { created_by: null }],
        );
        await deleteAccounts(db, [BEN]);
        assert.equal(
          await count("select count(*) from book_marks where user_id = $1", [
            BEN,
          ]),
          0,
        );
        assert.equal(
          await count("select count(*) from private.book_copies"),
          copies,
        );
      },
    );
    await db.close();
  }

  // Who may call what ------------------------------------------------------------------

  {
    const db = await migrated();
    const { rows, as } = helpers(db);
    await db.exec(PEOPLE);

    await check(
      "nobody reads the copies or calls what makes them through the API",
      async () => {
        for (const visitor of [null, AKI]) {
          let error: unknown = null;
          try {
            await as(visitor, "select * from private.book_copies");
          } catch (caught) {
            error = caught;
          }
          assert.ok(error instanceof Error, String(visitor));
          assert.match(error.message, /permission denied/);
        }
        const callable = await rows<{ name: string }>(
          `select p.oid::regprocedure::text as name from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('is_sample_book', 'swap_book', 'book_users', 'give_own_copy')
             and (has_function_privilege('anon', p.oid, 'EXECUTE')
               or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
        );
        assert.deepEqual(callable, []);
      },
    );
    await db.close();
  }

  // A held book, a book taken out, a catalog row ---------------------------------------

  {
    const db = await migrated(OWN);
    const { rows, as, register, tick, later } = helpers(db);
    await db.exec(PEOPLE);
    const MASTER = {
      library: { [X(5)]: sru({ isbns: [X(5)], title: "架空の図書館" }) },
      open: { [X(5)]: openbd({ isbn: X(5), title: "架空の図書館" }) },
    };
    const holds = (reader: string) =>
      as<{ book_id: string; title: string }>(
        reader,
        "select book_id, title from book_holds()",
      );
    const copyOf = async (reader: string, book: string) =>
      (
        await rows<{ book_id: string; reason: string }>(
          `select c.book_id, c.reason from private.book_copies c join books b on b.id = c.book_id
           where c.copied_from = $1 and b.created_by = $2`,
          [book, reader],
        )
      )[0];
    const akis = id(9, 1);
    const catalogRow = id(9, 2);

    // Aki's book is held; Ben wanted it, and Chi had it in her library and
    // took it out. Ben wanted a catalog row too.
    await register(AKI, akis, X(5), "まったく別の本");
    await as(
      BEN,
      "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
      [BEN, akis],
    );
    await rows(
      "insert into library_entries (user_id, book_id, source, removed_at) values ($1, $2, 'isbn', now())",
      [CHI, akis],
    );
    await rows(
      "insert into books (id, title, source) values ($1, '目録の本', 'ndl')",
      [catalogRow],
    );
    await as(
      BEN,
      "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
      [BEN, catalogRow],
    );
    await tick();
    await answerAll(db, MASTER.library, MASTER.open);
    await tick();
    await later(11);
    await tick();
    assert.deepEqual(
      (await holds(AKI)).map((h) => [h.book_id, h.title]),
      [[akis, "架空の図書館"]],
    );
    await db.exec(TEXT);

    await check(
      "a reader given a copy of a held book is told of it on the next tick, as of their own, and answers for their own",
      async () => {
        const bens = await copyOf(BEN, akis);
        assert.equal(bens.reason, "moved");
        assert.deepEqual(
          await rows(
            "select book_id from book_marks where user_id = $1 and book_id <> $2",
            [BEN, catalogRow],
          ),
          [{ book_id: bens.book_id }],
        );
        // Not told until his copy is judged, on the next tick.
        assert.deepEqual(await holds(BEN), []);
        await tick();
        assert.deepEqual(
          (await holds(BEN)).map((h) => [h.book_id, h.title]),
          [[bens.book_id, "架空の図書館"]],
        );
        // Aki says hers is the ISBN's: Ben's stays held until he answers.
        await as(AKI, "select confirm_book_isbn($1)", [akis]);
        assert.deepEqual(await holds(AKI), []);
        assert.deepEqual(
          (await holds(BEN)).map((h) => h.book_id),
          [bens.book_id],
        );
        await as(BEN, "select confirm_book_isbn($1)", [bens.book_id]);
        assert.deepEqual(await holds(BEN), []);
      },
    );

    await check(
      "a library row taken out names the reader's own copy too, still taken out; a catalog row stays everyone's",
      async () => {
        const chis = await copyOf(CHI, akis);
        assert.ok(chis, "Chi's copy");
        assert.deepEqual(
          await rows(
            "select book_id, removed_at is not null as out from library_entries where user_id = $1",
            [CHI],
          ),
          [{ book_id: chis.book_id, out: true }],
        );
        assert.deepEqual(
          await rows(
            "select count(*)::int as n from private.book_copies where copied_from = $1",
            [catalogRow],
          ),
          [{ n: 0 }],
        );
        assert.deepEqual(
          await rows(
            "select count(*)::int as n from book_marks where user_id = $1 and book_id = $2",
            [BEN, catalogRow],
          ),
          [{ n: 1 }],
        );
      },
    );
    await db.close();
  }

  // Undoing it --------------------------------------------------------------------------

  await check(
    "the rollback in the header leaves the database as it was before, and the file runs again",
    async () => {
      const earlier = await migrated(OWN);
      const on = helpers(earlier);
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      assert.notDeepEqual(await catalog(earlier), was);
      const rollback = rollbackSql();
      assert.match(rollback, /drop table private\.book_copies;/);
      assert.doesNotMatch(rollback, /restore_copy/);
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      await on.rows("select private.drop_copy($1)", [LABEL]);
      await earlier.exec(TEXT);
      await earlier.close();
    },
  );

  await check(
    "the move is undone with the steps the header gives: every reader's rows name the books they named, and the copies go",
    async () => {
      const db = await seeded();
      const { rows, count } = helpers(db);
      const everything = () =>
        rows(
          `select 'library' as t, to_jsonb(l)::text as row from library_entries l
           union all select 'shelf', to_jsonb(s)::text from library_shelf_books s
           union all select 'mark', to_jsonb(m)::text from book_marks m
           union all select 'post', to_jsonb(p)::text from posts p
           union all select 'met', to_jsonb(c)::text from book_encounters c
           union all select 'record', to_jsonb(e)::text from reading_entries e
           union all select 'nine', to_jsonb(n)::text from profile_nine n
           union all select 'poster', to_jsonb(p)::text from posters p
           union all select 'shop', to_jsonb(s)::text from shop_private s
           union all select 'session', to_jsonb(r)::text from reading_sessions r
           union all select 'shops', to_jsonb(s)::text from shops s
           order by 1, 2`,
        );
      const were = await everything();
      await db.exec(TEXT);
      assert.notDeepEqual(await everything(), were);
      await db.exec(undoSql());
      assert.deepEqual(await everything(), were);
      assert.equal(
        await count(
          "select count(*) from books b join private.book_copies c on c.book_id = b.id",
        ),
        0,
      );
      await db.close();
    },
  );

  console.log(`${passed} own book rows checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
