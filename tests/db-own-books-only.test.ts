import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { demoBooks } from "../src/lib/data";
import { sampleBookRowId } from "../src/lib/samples";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";
import {
  answerAll,
  catalog,
  helpers,
  migrated,
  numbered,
  openbd,
  sru,
} from "./fixtures/bibliography";

// A reader's rows name only books of their own (AUD-001, its second step; the
// owner's answer of 2026-10-18 00:28Z; supabase/migrations/*_own_books_only.sql):
// the rows that came to share someone else's book moved to copies, the
// database refusing any row of a reader's naming a book typed in by someone
// else, the copy the app makes when a reader first uses one (copy_book), the
// reader's own books (my_books), an encounter on a post naming the reader's
// copy, who may call what, and undoing it.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const ONLY_FILE = FILES.find((file) => file.endsWith("_own_books_only.sql"));
assert.ok(ONLY_FILE, "the migration keeping readers' rows to their own books");
const ONLY = ONLY_FILE;
const TEXT = migrationText(ONLY);
const LABEL = ONLY.replace(/\.sql$/, "");

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
const X = (n: number) => numbered(400 + n);

/** The first comment's statements, as a list of lines starting "--   ". */
function statementsOf(block: string): string {
  return block
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(5))
    .join("\n");
}

/** The rollback as the header writes it, and check_book_encounter as it was. */
function rollbackSql(): string {
  const library = migrationText(
    FILES.find((file) => file.endsWith("_library.sql")) as string,
  );
  const start = library.indexOf(
    "create function private.check_book_encounter()",
  );
  assert.ok(start >= 0, "check_book_encounter in the library's migration");
  const check = library.slice(start, library.indexOf("$$;\n", start) + 4);
  return (
    statementsOf(TEXT.slice(0, TEXT.indexOf("\n\n"))) +
    "\n" +
    check.replace("create function", "create or replace function")
  );
}

/** The undoing of the move, as the second comment writes it. */
function undoSql(): string {
  const second = TEXT.slice(TEXT.indexOf("\n\n") + 2);
  return statementsOf(second.slice(0, second.indexOf("\n\n")));
}

const AKIS_X = id(1, 1); // with an ISBN
const AKIS_Y = id(1, 2); // without
const AKIS_POST = id(2, 1);
const BENS_POST = id(2, 2);
const BENS_SHOP = id(4, 1);
const BENS_POSTER = id(5, 1);
const SAMPLE = sampleBookRowId(demoBooks[0].id);

const shelves = (book: string) =>
  JSON.stringify([
    {
      id: "s1",
      name: "旅の棚",
      capacity: 12,
      isPublic: true,
      items: [{ id: "i1", bookId: book, display: "face", pop: "旅に" }],
    },
  ]);

/**
 * Aki's books, and Ben's and Chi's rows that came to name them after the
 * first step (an app still sharing a book's row).
 */
async function seeded(): Promise<PGlite> {
  const db = await migrated(ONLY);
  await db.exec(`
    ${PEOPLE}
    insert into books (id, isbn, title, author, publisher, price, created_by) values
      ('${AKIS_X}', '${X(1)}', '架空の図書館', '山田一郎', '架空書房', 1200, '${AKI}'),
      ('${AKIS_Y}', null, '手帖の本', 'アキ', '', null, '${AKI}');
    insert into library_entries (user_id, book_id, source) values
      ('${AKI}', '${AKIS_X}', 'isbn'), ('${AKI}', '${AKIS_Y}', 'manual');
    insert into posts (id, author_id, body, book_id) values
      ('${AKIS_POST}', '${AKI}', 'よかった', '${AKIS_X}');

    insert into library_entries (user_id, book_id, source, status, status_at) values
      ('${BEN}', '${AKIS_X}', 'isbn', 'reading', '2026-10-01T00:00:00Z');
    insert into book_marks (user_id, book_id, kind) values ('${BEN}', '${AKIS_X}', 'wish');
    insert into posts (id, author_id, body, book_id) values
      ('${BENS_POST}', '${BEN}', '旅先で読んだ', '${AKIS_X}');
    insert into profile_nine (profile_id, position, book_id) values ('${BEN}', 1, '${AKIS_X}');
    insert into posters (id, author_id, template, pages) values
      ('${BENS_POSTER}', '${BEN}', 'lineup',
       '[{"blocks": [{"type": "books", "book_ids": ["${AKIS_X}", "${AKIS_Y}"]}]}]');
    insert into shops (id, owner_id, name, is_open) values
      ('${BENS_SHOP}', '${BEN}', 'ベンの本屋', true);
    insert into shop_private (shop_id, shelves) values ('${BENS_SHOP}', '${shelves(AKIS_X)}');

    insert into book_marks (user_id, book_id, kind) values ('${CHI}', '${AKIS_Y}', 'wish');
  `);
  return db;
}

/** Whose rows name which book: [reader, book] of every row naming one. */
const NAMED = `
  select user_id::text as who, book_id::text as book from library_entries
  union all select user_id::text, book_id::text from library_shelf_books
  union all select user_id::text, book_id::text from book_marks
  union all select user_id::text, book_id::text from book_encounters
  union all select author_id::text, book_id::text from posts where book_id is not null
  union all select user_id::text, book_id::text from reading_entries
  union all select user_id::text, book_id::text from reading_sessions where book_id is not null
  union all select profile_id::text, book_id::text from profile_nine
  union all select p.author_id::text, pb.book_id::text from poster_books pb
    join posters p on p.id = pb.poster_id
  union all select s.owner_id::text, item ->> 'bookId' from shop_private sp
    join shops s on s.id = sp.shop_id,
    jsonb_array_elements(sp.shelves) shelf, jsonb_array_elements(shelf -> 'items') item`;

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // The move, and the rule after it -------------------------------------------------------

  {
    const db = await seeded();
    const { rows, as, refused, count } = helpers(db);
    await db.exec(TEXT);
    const copyOf = async (reader: string, book: string) =>
      (
        await rows<{ book_id: string; reason: string }>(
          `select c.book_id, c.reason from private.book_copies c join books b on b.id = c.book_id
           where c.copied_from = $1 and b.created_by = $2`,
          [book, reader],
        )
      )[0];

    await check(
      "the move gives each reader whose rows came to name a book someone else typed in a copy of their own",
      async () => {
        const bensX = await copyOf(BEN, AKIS_X);
        const bensY = await copyOf(BEN, AKIS_Y);
        const chisY = await copyOf(CHI, AKIS_Y);
        assert.ok(bensX && bensY && chisY, "a copy each");
        assert.deepEqual(
          [bensX.reason, bensY.reason, chisY.reason],
          ["moved", "moved", "moved"],
        );
        const named = await rows<{ who: string; book: string }>(
          `select who, book from (${NAMED}) n order by who, book`,
        );
        const of = (who: string) =>
          named
            .filter((row) => row.who === who)
            .map((row) => row.book)
            .sort();
        assert.deepEqual(of(AKI), [AKIS_X, AKIS_X, AKIS_Y].sort());
        assert.deepEqual(
          of(BEN),
          [...Array(6).fill(bensX.book_id), bensY.book_id].sort(),
        );
        assert.deepEqual(of(CHI), [chisY.book_id, chisY.book_id]);
        // In its book's edition: an ISBN's, or, without one, the book's own.
        assert.equal(
          await count(
            `select count(*) from books c join books o on o.edition_id = c.edition_id
             and o.work_id = c.work_id where (c.id, o.id) in (($1::uuid, $2::uuid), ($3::uuid, $4::uuid))`,
            [bensX.book_id, AKIS_X, chisY.book_id, AKIS_Y],
          ),
          2,
        );
        // The first step's copy is let go; this one's is kept until checked.
        assert.deepEqual(
          await rows("select distinct label from keep.copies order by label"),
          [{ label: LABEL }],
        );
      },
    );

    await check(
      "after it no row of a reader's names a book someone else typed in: their own, the catalog's and the 見本's they may name",
      async () => {
        const catalogRow = id(9, 9);
        await rows(
          "insert into books (id, title, source) values ($1, '目録の本', 'ndl')",
          [catalogRow],
        );
        const bens = id(8, 1);
        await as(
          BEN,
          "insert into books (id, title, created_by) values ($1, '砂の器', $2)",
          [bens, BEN],
        );
        const writes: [string, (book: string) => unknown[]][] = [
          [
            "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'favorite')",
            (book) => [BEN, book],
          ],
          [
            "insert into reading_entries (user_id, book_id) values ($1, $2)",
            (book) => [BEN, book],
          ],
          [
            "insert into reading_sessions (user_id, book_id, mode, ended_at) values ($1, $2, 'solo', now())",
            (book) => [BEN, book],
          ],
          [
            "insert into posts (author_id, body, book_id) values ($1, 'また読む', $2)",
            (book) => [BEN, book],
          ],
          ["select replace_profile_nine($1, $2)", (book) => [[book], [""]]],
          [
            "update shop_private set shelves = $2 where shop_id = $1",
            (book) => [BENS_SHOP, shelves(book)],
          ],
          [
            "update posters set pages = $2 where id = $1",
            (book) => [
              BENS_POSTER,
              JSON.stringify([
                { blocks: [{ type: "books", book_ids: [book] }] },
              ]),
            ],
          ],
        ];
        for (const [sql, args] of writes) {
          for (const theirs of [AKIS_X, AKIS_Y])
            await refused(
              () => as(BEN, sql, args(theirs)),
              /their own books/,
              sql,
            );
          for (const book of [bens, catalogRow, SAMPLE])
            await as(BEN, sql, args(book));
        }
        // Aki's edit of her book reaches no row of Ben's, nor its title.
        await as(
          AKI,
          "update books set title = '書き換えた題名' where id = $1",
          [AKIS_X],
        );
        const bensX = await copyOf(BEN, AKIS_X);
        assert.deepEqual(
          await rows("select title from books where id = $1", [bensX.book_id]),
          [{ title: "架空の図書館" }],
        );
        assert.equal(
          await count(
            `select count(*) from (${NAMED}) n where n.who = $1 and n.book = $2`,
            [BEN, AKIS_X],
          ),
          0,
        );
      },
    );
    await db.close();
  }

  // The app's copies, and the reader's own books ----------------------------------------

  {
    const db = await migrated();
    const { rows, as, refused, count } = helpers(db);
    await db.exec(`
      ${PEOPLE}
      insert into books (id, isbn, title, author, publisher, price, created_by) values
        ('${AKIS_X}', '${X(2)}', '架空の図書館', '山田一郎', '架空書房', 1200, '${AKI}'),
        ('${AKIS_Y}', null, '手帖の本', 'アキ', '', null, '${AKI}'),
        ('${id(1, 3)}', null, 'まだ見せない本', 'アキ', '', null, '${AKI}');
      insert into posts (id, author_id, body, book_id) values
        ('${AKIS_POST}', '${AKI}', 'よかった', '${AKIS_X}'),
        ('${id(2, 3)}', '${AKI}', '手帖', '${AKIS_Y}');
      insert into books (id, title, source) values ('${id(9, 1)}', '目録の本', 'ndl');
    `);
    const copy = (reader: string | null, original: string, made: string) =>
      as(reader, "select copy_book($1, $2)", [original, made]);
    const bensX = id(7, 1);
    const bensY = id(7, 2);

    await check(
      "copy_book makes the reader's own copy of a book they read, in its edition, under the id the app gave it",
      async () => {
        await copy(BEN, AKIS_X, bensX);
        await copy(BEN, AKIS_Y, bensY);
        const pair = (made: string, original: string) =>
          rows<{
            same: boolean;
            edition: boolean;
            work: boolean;
            created_by: string;
            reason: string;
          }>(
            `select (to_jsonb(c) - array['id', 'created_by', 'created_at', 'updated_at'])
                 = (to_jsonb(o) - array['id', 'created_by', 'created_at', 'updated_at']) as same,
               c.edition_id = o.edition_id as edition, c.work_id = o.work_id as work,
               c.created_by, k.reason
             from books c join books o on o.id = $2
             join private.book_copies k on k.book_id = c.id and k.copied_from = o.id
             where c.id = $1`,
            [made, original],
          );
        for (const [made, original] of [
          [bensX, AKIS_X],
          [bensY, AKIS_Y],
        ])
          assert.deepEqual(await pair(made, original), [
            {
              same: true,
              edition: true,
              work: true,
              created_by: BEN,
              reason: "taken",
            },
          ]);
        // Sent again, its answer lost: nothing more.
        const books = await count("select count(*) from books");
        await copy(BEN, AKIS_X, bensX);
        assert.equal(await count("select count(*) from books"), books);
        // Aki's later edit stays hers.
        await as(
          AKI,
          "update books set title = '書き換えた題名' where id = $1",
          [AKIS_Y],
        );
        assert.deepEqual(
          await as(BEN, "select title from books where id = $1", [bensY]),
          [{ title: "手帖の本" }],
        );
        // His rows may name it; an encounter on Aki's post names his copy,
        // and no other book of his.
        await as(
          BEN,
          "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
          [BEN, bensX],
        );
        await as(
          BEN,
          "insert into book_encounters (id, user_id, book_id, kind, via, post_id) values ($1, $2, $3, 'like', 'post', $4)",
          [id(6, 1), BEN, bensX, AKIS_POST],
        );
        await refused(
          () =>
            as(
              BEN,
              "insert into book_encounters (id, user_id, book_id, kind, via, post_id) values ($1, $2, $3, 'want', 'post', $4)",
              [id(6, 2), BEN, bensY, AKIS_POST],
            ),
          /the post's own book/,
          "another book of his",
        );
        await refused(
          () =>
            as(
              BEN,
              "insert into book_encounters (id, user_id, book_id, kind, via, post_id) values ($1, $2, $3, 'want', 'post', $4)",
              [id(6, 3), BEN, AKIS_X, AKIS_POST],
            ),
          /their own books/,
          "the post's book itself",
        );
      },
    );

    await check(
      "copy_book copies nothing else: a book the reader cannot read is answered as one that is not there",
      async () => {
        const answer = async (reader: string | null, original: string) => {
          try {
            await copy(reader, original, id(7, 9));
          } catch (caught) {
            const { message, code } = caught as {
              message: string;
              code?: string;
            };
            return { message, code };
          }
          assert.fail("expected a refusal");
        };
        const none = await answer(BEN, id(1, 99));
        assert.deepEqual(none, {
          message: "no book has that id",
          code: "P0002",
        });
        // Aki's book used nowhere, his own, a catalog row, a 見本's.
        for (const original of [id(1, 3), bensX, id(9, 1), SAMPLE])
          assert.deepEqual(await answer(BEN, original), none, original);
        assert.match((await answer(null, AKIS_X)).message, /permission denied/);
        // An id already taken is no copy.
        await refused(
          () => copy(CHI, AKIS_X, AKIS_Y),
          /duplicate key/,
          "an id taken",
        );
        assert.equal(
          await count("select count(*) from books where id = $1", [id(7, 9)]),
          0,
        );
      },
    );

    await check(
      "my_books answers the reader's own books, a copy with the book it was made from, and nobody else's",
      async () => {
        const bens = id(8, 1);
        await as(
          BEN,
          "insert into books (id, title, created_by) values ($1, '砂の器', $2)",
          [bens, BEN],
        );
        const mine = (reader: string) =>
          as<{ id: string; copied_from: string | null }>(
            reader,
            "select id, copied_from from my_books() order by id",
          );
        assert.deepEqual(
          await mine(BEN),
          [
            { id: bensX, copied_from: AKIS_X },
            { id: bensY, copied_from: AKIS_Y },
            { id: bens, copied_from: null },
          ].sort((a, b) => (a.id < b.id ? -1 : 1)),
        );
        assert.deepEqual(
          (await mine(AKI)).map((row) => row.id),
          [AKIS_X, AKIS_Y, id(1, 3)].sort(),
        );
        assert.deepEqual(await mine(CHI), []);
        await refused(
          () => as(null, "select * from my_books()"),
          /permission denied/,
          "signed out",
        );
      },
    );

    await check(
      "only the app's two calls are open, to readers alone; the rule's own functions to nobody",
      async () => {
        const open = await rows<{
          name: string;
          anon: boolean;
          reader: boolean;
        }>(
          `select p.oid::regprocedure::text as name,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as reader
           from pg_proc p
           where p.proname in ('copy_book', 'my_books', 'may_name_book', 'own_books_only',
             'poster_books_own', 'shop_books_own', 'is_my_book_of')
           order by 1`,
        );
        assert.deepEqual(open, [
          { name: "copy_book(uuid,uuid)", anon: false, reader: true },
          { name: "my_books()", anon: false, reader: true },
          // Asked by check_book_encounter, which runs as the reader.
          {
            name: "private.is_my_book_of(uuid,uuid)",
            anon: false,
            reader: true,
          },
          {
            name: "private.may_name_book(uuid,uuid)",
            anon: false,
            reader: false,
          },
          { name: "private.own_books_only()", anon: false, reader: false },
          { name: "private.poster_books_own()", anon: false, reader: false },
          { name: "private.shop_books_own()", anon: false, reader: false },
        ]);
        // is_my_book_of tells a reader of their own books only.
        assert.deepEqual(
          await as(AKI, "select private.is_my_book_of($1, $2) as mine", [
            AKIS_X,
            bensX,
          ]),
          [{ mine: false }],
        );
      },
    );
    await db.close();
  }

  // A copy of a held book ------------------------------------------------------------------

  {
    const db = await migrated();
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
    const akis = id(9, 1);
    const bens = id(9, 2);
    // Aki's book is held, and stands in her public post.
    await register(AKI, akis, X(5), "まったく別の本");
    await as(
      AKI,
      "insert into posts (author_id, body, book_id) values ($1, '読んだ', $2)",
      [AKI, akis],
    );
    await tick();
    await answerAll(db, MASTER.library, MASTER.open);
    await tick();
    await later(11);
    await tick();
    assert.deepEqual(
      (await holds(AKI)).map((h) => h.book_id),
      [akis],
    );

    await check(
      "a reader's copy comes in as their own registration: judged from now, told to them alone, answered by them",
      async () => {
        await as(BEN, "select copy_book($1, $2)", [akis, bens]);
        assert.deepEqual(
          await rows(
            `select c.placed_at > o.placed_at as later from private.book_checks c, private.book_checks o
             where c.book_id = $1 and o.book_id = $2`,
            [bens, akis],
          ),
          [{ later: true }],
        );
        await tick();
        assert.deepEqual(await holds(BEN), []);
        await later(11);
        await tick();
        assert.deepEqual(
          (await holds(BEN)).map((h) => [h.book_id, h.title]),
          [[bens, "架空の図書館"]],
        );
        await as(BEN, "select confirm_book_isbn($1)", [bens]);
        assert.deepEqual(await holds(BEN), []);
        assert.deepEqual(
          (await holds(AKI)).map((h) => h.book_id),
          [akis],
        );
      },
    );
    await db.close();
  }

  // Undoing it -------------------------------------------------------------------------------

  await check(
    "the rollback in the header leaves the database as it was before, but for the reasons a copy may have",
    async () => {
      const earlier = await migrated(ONLY);
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      const rollback = rollbackSql();
      assert.doesNotMatch(rollback, /restore_copy/);
      await earlier.exec(rollback);
      const reasons = (row: { kind: string; name: string }) =>
        row.kind === "constraint" &&
        row.name === "private.book_copies.book_copies_reason_check";
      assert.deepEqual(
        (await catalog(earlier)).filter((row) => !reasons(row)),
        was.filter((row) => !reasons(row)),
      );
      // Nothing refuses a row naming someone else's book any more.
      await earlier.exec(`
        ${PEOPLE}
        insert into books (id, title, created_by) values ('${AKIS_X}', '架空の図書館', '${AKI}');
        insert into book_marks (user_id, book_id, kind) values ('${BEN}', '${AKIS_X}', 'wish');
      `);
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
           union all select 'mark', to_jsonb(m)::text from book_marks m
           union all select 'post', to_jsonb(p)::text from posts p
           union all select 'nine', to_jsonb(n)::text from profile_nine n
           union all select 'poster', to_jsonb(p)::text from posters p
           union all select 'shop', to_jsonb(s)::text from shop_private s
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

  console.log(`${passed} own books only checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
