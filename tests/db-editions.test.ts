import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// Editions get ids of their own (item 4 of the 2026-10-16 plan, the owner's
// review of 2026-10-16 22:36Z ⑤, supabase/migrations/*_edition_ids.sql): the
// move on a database with books and joins in it, the edition each new book
// is given, the operator's tools by edition, who reads what, and undoing it
// all. What stays as tests/db-works.test.ts has it: the same ISBN is the
// same edition, at once, without comparing any text; a book without an ISBN
// is an edition of its own.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const EDITIONS_FILE = FILES.find((file) => file.endsWith("_edition_ids.sql"));
assert.ok(EDITIONS_FILE, "the edition ids migration");
const EDITIONS = EDITIONS_FILE;
const WORKS_FILE = FILES.find((file) => file.endsWith("_works.sql"));
assert.ok(WORKS_FILE, "the works migration");
const WORKS = WORKS_FILE;
const LABEL = EDITIONS.replace(/\.sql$/, "");
const TEXT = migrationText(EDITIONS);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A valid ISBN-13 from its first twelve digits. */
function isbn(first: string): string {
  const sum = [...first].reduce(
    (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return first + ((10 - (sum % 10)) % 10);
}

const X1 = isbn("978415011955");
const X2 = isbn("978406203516");
const X4 = isbn("978415012053");
const X5 = isbn("978415012054");
/** ISBNs no book has before the tests give them one. */
const unused = (n: number) => isbn("9784100" + String(n).padStart(5, "0"));

// The books there are before the move: 華氏451度 twice with one ISBN,
// ノルウェイの森 once, ノート twice and a sample without one, and 1984 as
// two translations, which the operator joined into one work. The second ノート
// was joined into the first's work too, before editions had ids, so the
// join wrote down no ISBN for it.
const NDL = id(1, 1);
const NEW = id(1, 2);
const WOOD = id(1, 4);
const NOTE1 = id(1, 6);
const NOTE2 = id(1, 7);
const ORWELL1 = id(1, 9);
const ORWELL2 = id(1, 10);
const SAMPLE = id(1, 11);
const POST = id(2, 1);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}');
  insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
  insert into books (id, isbn, title, author, source, created_by, created_at, updated_at) values
    ('${NDL}', '${X1}', '華氏451度', 'レイ・ブラッドベリ', 'ndl', null, '2026-10-05', '2026-10-05'),
    ('${NEW}', '${X1}', '華氏451度〔新訳版〕', 'ブラッドベリ, レイ 著', 'manual', '${BEN}', '2026-10-01', '2026-10-06'),
    ('${WOOD}', '${X2}', 'ノルウェイの森', '村上春樹', 'manual', '${AKI}', '2026-10-03', '2026-10-03'),
    ('${NOTE1}', null, 'ノート', 'アキ', 'manual', '${AKI}', '2026-10-03', '2026-10-03'),
    ('${NOTE2}', null, 'ノート', 'アキ', 'manual', '${BEN}', '2026-10-04', '2026-10-08'),
    ('${ORWELL1}', '${X4}', '1984年', 'ジョージ・オーウェル', 'manual', '${AKI}', '2026-10-06', '2026-10-06'),
    ('${ORWELL2}', '${X5}', '一九八四年', 'オーウェル', 'manual', '${BEN}', '2026-10-06', '2026-10-07'),
    ('${SAMPLE}', null, '見本の本', '', 'manual', null, '2026-10-01', '2026-10-01');
  insert into posts (id, author_id, body, book_id) values ('${POST}', '${AKI}', '面白かった', '${NOTE2}');
  select private.join_works('${ORWELL1}', '${ORWELL2}');
  select private.join_works('${NOTE1}', '${NOTE2}');
`;

/** A database migrated up to the file before this one, with books and joins in it. */
async function beforeEditions(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < EDITIONS))
    await db.exec(migrationText(file));
  await db.exec(SEED);
  return db;
}

type Visitor = string | null;

function helpers(db: PGlite) {
  async function rows<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }
  async function as<T = Record<string, unknown>>(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await db.exec(
      visitor
        ? `set role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', false);`
        : `set role anon; select set_config('request.jwt.claim.sub', '', false);`,
    );
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("reset role");
    }
  }
  async function refused(
    run: () => Promise<unknown>,
    reason: RegExp,
    what: string,
  ) {
    let error: unknown = null;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, "expected a refusal: " + what);
    assert.match(error.message, reason, what);
  }
  const count = async (sql: string, params: unknown[] = []) =>
    (await rows<{ n: number }>(`select (${sql})::int as n`, params))[0].n;
  /** A book's edition and work, and its edition's ISBN and work. */
  const placeOf = async (book: string) =>
    (
      await rows<{
        edition: string;
        work: string;
        isbn: string | null;
        edition_work: string;
      }>(
        `select b.edition_id as edition, b.work_id as work, e.isbn, e.work_id as edition_work
         from books b join editions e on e.id = b.edition_id where b.id = $1`,
        [book],
      )
    )[0];
  /**
   * What holds for every book: one with an ISBN is in that ISBN's edition,
   * one without is alone in an edition without one, and each is in its
   * edition's work.
   */
  async function holds(what: string) {
    assert.equal(
      await count(
        `select count(*) from books b join editions e on e.id = b.edition_id
         where b.isbn is not null and e.isbn is distinct from b.isbn`,
      ),
      0,
      what + ": books in their ISBN's edition",
    );
    assert.equal(
      await count(
        `select count(*) from books b join editions e on e.id = b.edition_id
         where b.isbn is null and (e.isbn is not null or exists (
           select 1 from books o where o.edition_id = b.edition_id and o.id <> b.id))`,
      ),
      0,
      what + ": books without an ISBN alone in their edition",
    );
    assert.equal(
      await count(
        `select count(*) from books b join editions e on e.id = b.edition_id
         where e.work_id <> b.work_id`,
      ),
      0,
      what + ": books in their edition's work",
    );
  }
  return { rows, as, refused, count, placeOf, holds };
}

/**
 * Every row of every table in public and private: books without the edition,
 * editions without their id (and only those with an ISBN, the ones there
 * were), joins without their editions.
 */
async function everyRow(db: PGlite): Promise<Record<string, string[]>> {
  const tables = (
    await db.query<{ name: string }>(
      `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname in ('public', 'private')
       order by 1`,
    )
  ).rows;
  const all: Record<string, string[]> = {};
  for (const { name } of tables)
    all[name] = (
      await db.query<{ row: string }>(
        `select (to_jsonb(t) - 'edition_id' - 'editions'
           - case when '${name}' = 'public.editions' then 'id' else '' end)::text as row
         from ${name} t
         where '${name}' <> 'public.editions' or to_jsonb(t) ->> 'isbn' is not null
         order by 1`,
      )
    ).rows.map((row) => row.row);
  return all;
}

/** The books each visitor reads, as the app asks for them. */
async function seenBooks(db: PGlite): Promise<Record<string, unknown[]>> {
  const { as } = helpers(db);
  const seen: Record<string, unknown[]> = {};
  for (const visitor of [null, AKI, BEN])
    seen[visitor ?? "anon"] = await as(
      visitor,
      "select id, isbn, title, author, publisher, price, source, work_id, created_at, updated_at from books order by id",
    );
  return seen;
}

/**
 * Everything a migration makes or changes in public and private, by name, as
 * tests/db-works.test.ts compares its rollback.
 */
async function catalog(db: PGlite) {
  return (
    await db.query<{ kind: string; name: string; detail: string }>(
      `select 'function' as kind, p.oid::regprocedure::text as name,
              md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') as detail
       from pg_proc p
       where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       union all
       select 'relation', c.oid::regclass::text,
              c.relkind::text || ' ' || coalesce(c.relacl::text, '') || ' ' || c.relrowsecurity::text
       from pg_class c
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
       union all
       select 'column', a.attrelid::regclass::text || '.' || a.attname,
              format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' '
                || coalesce(a.attacl::text, '')
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
         and a.attnum > 0 and not a.attisdropped
       union all
       select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
              pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text
       from pg_trigger t where not t.tgisinternal
       union all
       select 'policy', p.polrelid::regclass::text || '.' || p.polname, ''
       from pg_policy p
       union all
       select 'constraint', c.conrelid::regclass::text || '.' || c.conname,
              pg_get_constraintdef(c.oid)
       from pg_constraint c
       where c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
       order by 1, 2, 3`,
    )
  ).rows;
}

/**
 * The rollback as the header writes it: the indented lines of its first
 * comment, then the functions as the works migration made them.
 */
function rollbackSql(): string {
  const statements = TEXT.slice(0, TEXT.indexOf("\n\n"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
  const works = migrationText(WORKS);
  const remade = [
    "edition_work",
    "book_work",
    "book_work_edited",
    "join_works",
    "undo_join",
    "part_books",
  ].map((name) => {
    const start = works.indexOf(`create function private.${name}(`);
    const revoke = works.indexOf(
      `revoke all on function private.${name}(`,
      start,
    );
    assert.ok(start >= 0 && revoke > start, name);
    return works
      .slice(start, works.indexOf("\n", revoke) + 1)
      .replace("create function", "create or replace function");
  });
  return statements + "\n" + remade.join("\n");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // The move ---------------------------------------------------------------------

  const db = await beforeEditions();
  const { rows, as, refused, count, placeOf, holds } = helpers(db);
  const before = await everyRow(db);
  const seenBefore = await seenBooks(db);
  const editionsBefore = await count("select count(*) from editions");
  const worksBefore = await count("select count(*) from works");
  // The 1984 join first (it moved an ISBN), then the ノート's (none).
  const joins = await rows<{ id: string; gone_isbns: string[] }>(
    "select id, isbns as gone_isbns from private.work_joins order by cardinality(isbns) desc",
  );
  await db.exec(TEXT);

  await check(
    "the move changes no row, keeps every edition's ISBN, work and age, and gives each book without an ISBN an edition of its own",
    async () => {
      const after = await everyRow(db);
      for (const [table, kept] of Object.entries(before))
        assert.deepEqual(after[table], kept, table);
      // One edition more for each book without an ISBN, and no work more.
      assert.equal(
        await count("select count(*) from editions"),
        editionsBefore + 3,
      );
      assert.equal(await count("select count(*) from works"), worksBefore);
      assert.equal(
        await count("select count(*) from books where edition_id is null"),
        0,
      );
      for (const book of [NOTE1, NOTE2, SAMPLE]) {
        const place = await placeOf(book);
        assert.equal(place.isbn, null, book);
        assert.deepEqual(
          await rows(
            `select e.created_at = b.created_at as same_age from editions e
             join books b on b.edition_id = e.id where b.id = $1`,
            [book],
          ),
          [{ same_age: true }],
          book,
        );
      }
      // The ISBN's books share its edition; the joined ノート are one work
      // still, each with its own edition.
      assert.equal((await placeOf(NDL)).edition, (await placeOf(NEW)).edition);
      assert.equal((await placeOf(NOTE1)).work, (await placeOf(NOTE2)).work);
      assert.notEqual(
        (await placeOf(NOTE1)).edition,
        (await placeOf(NOTE2)).edition,
      );
      // An edition's id is a fresh one, never a book's or a work's.
      assert.equal(
        await count(
          "select count(*) from editions e where exists (select 1 from books b where b.id = e.id) or exists (select 1 from works w where w.id = e.id)",
        ),
        0,
      );
      await holds("after the move");
    },
  );

  await check(
    "a join made before the move knows the editions it moved, with an ISBN or without",
    async () => {
      assert.equal(joins.length, 2);
      const known = await rows<{ editions: string[] }>(
        "select editions from private.work_joins order by cardinality(isbns) desc",
      );
      assert.deepEqual(known[0].editions, [(await placeOf(ORWELL2)).edition]);
      assert.deepEqual(joins[0].gone_isbns, [X5]);
      assert.deepEqual(known[1].editions, [(await placeOf(NOTE2)).edition]);
      assert.deepEqual(joins[1].gone_isbns, []);
    },
  );

  await check(
    "the copy holds the books, checked with nothing lost, and the editions as they were are not left behind",
    async () => {
      const copies = await rows<{ source: string; lost: string; n: number }>(
        `select source, (checked ->> 'lost_rows') || ' ' || (checked ->> 'lost_links') as lost,
           row_count::int as n
         from keep.copies where label = $1`,
        [LABEL],
      );
      assert.deepEqual(copies, [
        {
          source: "public.books",
          lost: "0 0",
          n: await count("select count(*) from books"),
        },
      ]);
      assert.equal(
        await count(
          "select count(*) from pg_class where relname = 'editions_before'",
        ),
        0,
      );
    },
  );

  await check(
    "every visitor reads the same books as before, and nobody reads an edition through the API",
    async () => {
      assert.deepEqual(await seenBooks(db), seenBefore);
      for (const visitor of [null, AKI]) {
        await refused(
          () => as(visitor, "select edition_id from books"),
          /permission denied/,
          "a book's edition",
        );
        await refused(
          () => as(visitor, "select id from editions"),
          /permission denied/,
          "the editions",
        );
        await refused(
          () => as(visitor, "select * from private.isbn_edition($1)", [X1]),
          /permission denied/,
          "placing a book",
        );
      }
    },
  );

  // A new book ---------------------------------------------------------------------

  await check(
    "a new book of an ISBN joins its edition at once, a new ISBN makes one edition and one work, and sent again nothing is made",
    async () => {
      const editions = await count("select count(*) from editions");
      const works = await count("select count(*) from works");
      const same = id(4, 1);
      const send = (book: string, given: string) =>
        as(
          BEN,
          `insert into books (id, isbn, title, author, created_by) values ($1, $2, '別の題名', '別の人', $3)
           on conflict (id) do nothing`,
          [book, given, BEN],
        );
      await send(same, X1);
      await send(same, X1);
      assert.equal((await placeOf(same)).edition, (await placeOf(NDL)).edition);
      assert.equal(await count("select count(*) from editions"), editions);
      const fresh = id(4, 2);
      await send(fresh, unused(1));
      await send(fresh, unused(1));
      const place = await placeOf(fresh);
      assert.equal(place.isbn, unused(1));
      assert.equal(await count("select count(*) from editions"), editions + 1);
      assert.equal(await count("select count(*) from works"), works + 1);
      // Two first registrations of one ISBN in one statement meet in one edition.
      const [a, b] = [id(4, 3), id(4, 4)];
      await as(
        BEN,
        `insert into books (id, isbn, title, author, created_by) values
         ($1, $3, '同時の本', 'ベン', $4), ($2, $3, '同時の本', 'ベン', $4)`,
        [a, b, unused(2), BEN],
      );
      assert.equal((await placeOf(a)).edition, (await placeOf(b)).edition);
      assert.equal(await count("select count(*) from editions"), editions + 2);
      await holds("new books of an ISBN");
    },
  );

  await check(
    "a book without an ISBN gets an edition and a work of its own, never shared, and sent again, even twice at once, it makes nothing",
    async () => {
      const editions = await count("select count(*) from editions");
      const works = await count("select count(*) from works");
      const [one, other] = [id(4, 5), id(4, 6)];
      for (const book of [one, other, one])
        await as(
          AKI,
          `insert into books (id, title, author, created_by) values ($1, 'ノート', 'アキ', $2)
           on conflict (id) do nothing`,
          [book, AKI],
        );
      assert.notEqual(
        (await placeOf(one)).edition,
        (await placeOf(other)).edition,
      );
      assert.notEqual((await placeOf(one)).work, (await placeOf(other)).work);
      assert.equal((await placeOf(one)).isbn, null);
      const twice = id(4, 7);
      await as(
        AKI,
        `insert into books (id, title, created_by) values ($1, '二度の本', $2), ($1, '二度の本', $2)
         on conflict (id) do nothing`,
        [twice, AKI],
      );
      assert.equal(await count("select count(*) from editions"), editions + 3);
      assert.equal(await count("select count(*) from works"), works + 3);
      await holds("new books without an ISBN");
    },
  );

  await check(
    "until it is saved, a registration holds its edition's row, whether the edition was there or it made it",
    async () => {
      const held = async (n: number, probed: string) => {
        await db.exec("begin");
        try {
          await as(
            BEN,
            "insert into books (id, isbn, title, author, created_by) values ($1, $2, '鍵', '', $3)",
            [id(6, n), probed, BEN],
          );
          return await count(
            `select count(*) from editions
             where isbn = $1 and pg_current_xact_id()::text in (xmin::text, xmax::text)`,
            [probed],
          );
        } finally {
          await db.exec("rollback");
        }
      };
      assert.equal(await held(1, X2), 1);
      assert.equal(await held(2, unused(3)), 1);
    },
  );

  await check(
    "readers never name an edition, and an edition named by the operator is not taken",
    async () => {
      const edition = (await placeOf(NOTE1)).edition;
      await refused(
        () =>
          as(
            BEN,
            "insert into books (title, created_by, edition_id) values ('名指し', $1, $2)",
            [BEN, edition],
          ),
        /permission denied/,
        "a reader names an edition",
      );
      await refused(
        () =>
          as(BEN, "update books set edition_id = $1 where id = $2", [
            edition,
            NOTE2,
          ]),
        /permission denied/,
        "a reader moves their book to another edition",
      );
      const named = id(4, 8);
      await db.query(
        "insert into books (id, isbn, title, edition_id, work_id) values ($1, $2, '写し', $3, $4)",
        [named, X2, edition, (await placeOf(NOTE1)).work],
      );
      assert.equal(
        (await placeOf(named)).edition,
        (await placeOf(WOOD)).edition,
      );
      const loose = id(4, 9);
      await db.query(
        "insert into books (id, title, edition_id) values ($1, '写し', $2)",
        [loose, edition],
      );
      assert.notEqual((await placeOf(loose)).edition, edition);
      await db.query("delete from books where id = any ($1::uuid[])", [
        [named, loose],
      ]);
      await holds("named editions");
    },
  );

  await check(
    "a book whose ISBN is changed moves to that ISBN's edition, or with it taken off to one of its own, written down and stamped",
    async () => {
      const book = id(4, 10);
      await as(
        AKI,
        "insert into books (id, title, author, created_by, updated_at) values ($1, '手帖', 'アキ', $2, '2026-10-01')",
        [book, AKI],
      );
      const alone = await placeOf(book);
      await as(AKI, "update books set isbn = $1 where id = $2", [X2, book]);
      const moved = await placeOf(book);
      assert.equal(moved.edition, (await placeOf(WOOD)).edition);
      assert.equal(moved.work, (await placeOf(WOOD)).work);
      await as(AKI, "update books set isbn = null where id = $1", [book]);
      const off = await placeOf(book);
      assert.equal(off.isbn, null);
      assert.ok(![alone.edition, moved.edition].includes(off.edition));
      assert.ok(![alone.work, moved.work].includes(off.work));
      assert.deepEqual(
        await rows(
          `select kind, from_work = $2 as from_alone, to_work = $3 as to_wood
           from private.work_changes where book_id = $1 order by changed_at, id limit 1`,
          [book, alone.work, moved.work],
        ),
        [{ kind: "edited", from_alone: true, to_wood: true }],
      );
      assert.equal(
        await count(
          "select count(*) from private.work_changes where book_id = $1",
          [book],
        ),
        2,
      );
      assert.notEqual(
        (
          await rows<{ day: string }>(
            "select to_char(updated_at, 'YYYY-MM-DD') as day from books where id = $1",
            [book],
          )
        )[0].day,
        "2026-10-01",
      );
      // A title changed is not an ISBN changed: the book stays.
      await as(AKI, "update books set title = '手帖（改）' where id = $1", [
        book,
      ]);
      assert.equal((await placeOf(book)).edition, off.edition);
      await holds("edited ISBNs");
    },
  );

  // The operator's tools, by edition -------------------------------------------------

  await check(
    "a join from before the move is undone by its editions, with a book of a moved ISBN registered since",
    async () => {
      const later = id(4, 11);
      await as(
        BEN,
        "insert into books (id, isbn, title, created_by) values ($1, $2, '一九八四年', $3)",
        [later, X5, BEN],
      );
      const joined = (await placeOf(ORWELL1)).work;
      assert.equal((await placeOf(later)).work, joined);
      const [first, second] = joins;
      const stamps = await rows(
        "select id, updated_at from books where id = any ($1::uuid[]) order by id",
        [[ORWELL2, later, NOTE2]],
      );
      // The ノート first: the later join's work stays as it is.
      assert.deepEqual(
        await rows("select private.undo_join($1) as n", [second.id]),
        [{ n: 1 }],
      );
      assert.notEqual((await placeOf(NOTE2)).work, (await placeOf(NOTE1)).work);
      assert.deepEqual(
        await rows("select private.undo_join($1) as n", [first.id]),
        [{ n: 2 }],
      );
      assert.equal((await placeOf(ORWELL2)).work, (await placeOf(later)).work);
      assert.notEqual((await placeOf(ORWELL2)).work, joined);
      assert.equal((await placeOf(ORWELL1)).work, joined);
      assert.deepEqual(
        await rows(
          "select id, updated_at from books where id = any ($1::uuid[]) order by id",
          [[ORWELL2, later, NOTE2]],
        ),
        stamps,
      );
      await holds("undoing the joins from before");
    },
  );

  await check(
    "a join writes down every edition it moves, and undoing it moves exactly those back",
    async () => {
      const [{ join_id: made, moved }] = await rows<{
        join_id: string;
        moved: number;
      }>("select * from private.join_works($1, $2)", [WOOD, NOTE1]);
      assert.equal(moved, 1);
      assert.deepEqual(
        (
          await rows<{ editions: string[]; isbns: string[] }>(
            "select editions, isbns from private.work_joins where id = $1",
            [made],
          )
        )[0],
        { editions: [(await placeOf(NOTE1)).edition], isbns: [] },
      );
      assert.equal((await placeOf(NOTE1)).work, (await placeOf(WOOD)).work);
      await holds("a join of a book without an ISBN");
      // A book of the work registered since stays where it went.
      const since = id(4, 12);
      await as(
        AKI,
        "insert into books (id, isbn, title, created_by) values ($1, $2, 'ノルウェイの森 下', $3)",
        [since, X2, AKI],
      );
      assert.deepEqual(
        await rows("select private.undo_join($1) as n", [made]),
        [{ n: 1 }],
      );
      assert.notEqual((await placeOf(NOTE1)).work, (await placeOf(WOOD)).work);
      assert.equal((await placeOf(since)).work, (await placeOf(WOOD)).work);
      await holds("undoing a join of a book without an ISBN");
    },
  );

  await check(
    "parting takes the whole edition of each book named, with an ISBN or without, and leaves the rest",
    async () => {
      await rows("select * from private.join_works($1, $2)", [
        ORWELL1,
        ORWELL2,
      ]);
      await rows("select * from private.join_works($1, $2)", [ORWELL1, NOTE2]);
      const whole = (await placeOf(ORWELL1)).work;
      const fresh = (
        await rows<{ w: string }>("select private.part_books($1) as w", [
          [ORWELL2, NOTE2],
        ])
      )[0].w;
      // ORWELL2 takes the book registered since with its ISBN, and NOTE2 its
      // own edition.
      assert.equal(
        await count("select count(*) from books where work_id = $1", [fresh]),
        3,
      );
      assert.equal((await placeOf(NOTE2)).edition_work, fresh);
      assert.equal((await placeOf(ORWELL1)).work, whole);
      assert.equal(
        await count(
          "select count(*) from editions where work_id = $1 and isbn is null",
          [fresh],
        ),
        1,
      );
      await holds("parting");
      await refused(
        () => rows("select private.part_books($1)", [[ORWELL1]]),
        /nothing to part/,
        "parting a whole work",
      );
    },
  );

  // People ------------------------------------------------------------------------

  await check(
    "an account deleted leaves no trace of it in the move's copy, and its books keep their editions",
    async () => {
      const place = await placeOf(NOTE2);
      await deleteAccounts(db, [BEN]);
      const [{ copy_name }] = await rows<{ copy_name: string }>(
        "select copy_name from keep.copies where label = $1",
        [LABEL],
      );
      assert.equal(
        await count(
          `select count(*) from keep.${JSON.stringify(copy_name)} t where to_jsonb(t)::text like '%' || $1 || '%'`,
          [BEN],
        ),
        0,
      );
      assert.deepEqual(await placeOf(NOTE2), place);
      await holds("after an account is deleted");
    },
  );
  await db.close();

  // Undoing the move -------------------------------------------------------------------

  await check(
    "the rollback, as the header writes it, leaves the database as it was; the books come back from the copy; and the move runs again",
    async () => {
      const earlier = await beforeEditions();
      const on = helpers(earlier);
      const was = await catalog(earlier);
      const rowsWere = await everyRow(earlier);
      await earlier.exec(TEXT);
      const rollback = rollbackSql();
      assert.match(rollback, /drop function private\.isbn_edition\(text\)/);
      assert.doesNotMatch(rollback, /restore_copy/);
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      assert.deepEqual(await everyRow(earlier), rowsWere);
      // A book spoiled since comes back as the copy kept it.
      await earlier.query(
        "update books set title = 'こわれた題名' where id = $1",
        [NOTE1],
      );
      await on.rows(
        "select * from private.restore_copy($1, array['public.books']::regclass[])",
        [LABEL],
      );
      assert.deepEqual(await everyRow(earlier), rowsWere);
      // With the copy dropped, the move runs again; books registered after
      // it go back too, and keep their works.
      await on.rows("select private.drop_copy($1)", [LABEL]);
      await earlier.exec(TEXT);
      const [alone, numbered] = [id(5, 1), id(5, 2)];
      await on.as(
        AKI,
        `insert into books (id, isbn, title, created_by) values
         ($1, null, '手帖', $3), ($2, $4, '新しい本', $3)`,
        [alone, numbered, AKI, unused(9)],
      );
      const works = await on.rows(
        "select id, work_id from books where id = any ($1::uuid[]) order by id",
        [[alone, numbered]],
      );
      await on.rows("select private.drop_copy($1)", [LABEL]);
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      assert.deepEqual(
        await on.rows(
          "select id, work_id from books where id = any ($1::uuid[]) order by id",
          [[alone, numbered]],
        ),
        works,
      );
      assert.equal(
        await on.count("select count(*) from editions"),
        await on.count(
          "select count(distinct isbn) from books where isbn is not null",
        ),
      );
      await earlier.exec(TEXT);
      await on.holds("the move run again");
      await earlier.close();
    },
  );

  await check(
    "a move whose check fails is rolled back whole, copy and editions and all",
    async () => {
      const spoils: { from: string; to: string; reason: RegExp }[] = [
        {
          from: "select b.edition_id, b.work_id, b.created_at from public.books b where b.isbn is null;",
          to: "select b.edition_id, b.work_id, now() from public.books b where b.isbn is null;",
          reason:
            /3 books without an ISBN are not alone in an edition of their own/,
        },
        {
          from: "alter table public.editions add column id uuid not null default gen_random_uuid();\n",
          to: "alter table public.editions add column id uuid not null default gen_random_uuid();\nupdate public.editions set created_at = created_at - interval '1 day';\n",
          reason: /4 editions changed/,
        },
        {
          from: "update public.books b set edition_id = gen_random_uuid() where b.isbn is null;\n",
          to: "update public.books b set edition_id = gen_random_uuid(), title = b.title || '！' where b.isbn is null;\n",
          reason: /the move changed 3 books/,
        },
      ];
      for (const { from, to, reason } of spoils) {
        const spoil = TEXT.replace(from, to);
        assert.notEqual(spoil, TEXT);
        const earlier = await beforeEditions();
        const on = helpers(earlier);
        const was = await catalog(earlier);
        const rowsWere = await everyRow(earlier);
        await on.refused(() => earlier.exec(spoil), reason, String(reason));
        assert.deepEqual(await catalog(earlier), was);
        assert.deepEqual(await everyRow(earlier), rowsWere);
        assert.equal(await on.count("select count(*) from keep.copies"), 0);
        assert.equal(
          await on.count(
            "select count(*) from pg_class where relname = 'editions_before'",
          ),
          0,
        );
        await earlier.close();
      }
    },
  );

  console.log(passed + " edition checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
