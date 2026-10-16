import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// Works and editions (item 4 of the 2026-10-16 plan,
// supabase/migrations/*_works.sql): the move on a database with readers in
// it, the work each new book is given, the operator's tools, and undoing it
// all. The owner's rules (2026-10-16 12:10Z): the same ISBN joins a work
// unless the titles or authors clearly disagree; the same title and author
// is only a candidate; a join the operator made holds for books that come
// later; a join can be parted again, and every change is written down.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const WORKS_FILE = FILES.find((file) => file.endsWith("_works.sql"));
assert.ok(WORKS_FILE, "the works migration");
const WORKS = WORKS_FILE;
const LABEL = WORKS.replace(/\.sql$/, "");
const TEXT = migrationText(WORKS);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAI = "00000000-0000-4000-8000-00000000000d";

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
const X3 = isbn("978400000003");
const X4 = isbn("978415012053");
const X5 = isbn("978415012054");
const X6 = isbn("978400000006");
const X7 = isbn("978400000007");

// The books there are before the move. 華氏451度 has a catalog row and a
// reader's row of the same ISBN that agrees with it, and a third of the same
// ISBN that is another book typed in under the wrong number. ノルウェイの森 is
// typed in twice with the same ISBN, ノート twice with none, and 1984 twice
// as two translations with their own ISBNs.
const NDL = id(1, 1);
const NEW = id(1, 2);
const TYPO = id(1, 3);
const WOOD1 = id(1, 4);
const WOOD2 = id(1, 5);
const NOTE1 = id(1, 6);
const NOTE2 = id(1, 7);
const SECRET = id(1, 8);
const ORWELL1 = id(1, 9);
const ORWELL2 = id(1, 10);
const SAMPLE = id(1, 11);
const OLD_BOOKS = [
  NDL,
  NEW,
  TYPO,
  WOOD1,
  WOOD2,
  NOTE1,
  NOTE2,
  SECRET,
  ORWELL1,
  ORWELL2,
  SAMPLE,
];

const POST1 = id(2, 1);
const POST2 = id(2, 2);
const POST3 = id(2, 3);
const SHELF = id(3, 1);
const MEET = id(3, 2);
const POSTER = id(3, 3);
const SHOP = id(3, 4);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'),
    ('${CHI}', 'chi', 'チー'), ('${DAI}', 'dai', 'ダイ');
  insert into books (id, isbn, title, author, source, created_by, created_at, updated_at) values
    ('${NDL}', '${X1}', '華氏451度', 'レイ・ブラッドベリ', 'ndl', null, '2026-10-05', '2026-10-05'),
    ('${NEW}', '${X1}', '華氏451度〔新訳版〕', 'ブラッドベリ, レイ 著', 'manual', '${BEN}', '2026-10-01', '2026-10-06'),
    ('${TYPO}', '${X1}', '動物農場', 'ジョージ・オーウェル', 'manual', '${CHI}', '2026-10-02', '2026-10-02'),
    ('${WOOD1}', '${X2}', 'ノルウェイの森', '村上春樹', 'manual', '${AKI}', '2026-10-03', '2026-10-03'),
    ('${WOOD2}', '${X2}', 'ノルウェイの森', '村上 春樹', 'manual', '${DAI}', '2026-10-04', '2026-10-07'),
    ('${NOTE1}', null, 'ノート', 'アキ', 'manual', '${AKI}', '2026-10-03', '2026-10-03'),
    ('${NOTE2}', null, 'ノート', 'アキ', 'manual', '${BEN}', '2026-10-04', '2026-10-04'),
    ('${SECRET}', '${X3}', 'チーだけの本', 'チー', 'manual', '${CHI}', '2026-10-05', '2026-10-05'),
    ('${ORWELL1}', '${X4}', '1984年', 'ジョージ・オーウェル', 'manual', '${AKI}', '2026-10-06', '2026-10-06'),
    ('${ORWELL2}', '${X5}', '一九八四年', 'オーウェル', 'manual', '${BEN}', '2026-10-06', '2026-10-06'),
    ('${SAMPLE}', null, '見本の本', '', 'manual', null, '2026-10-01', '2026-10-01');
  insert into posts (id, author_id, body, book_id) values ('${POST1}', '${AKI}', '面白かった', '${NDL}');
  insert into posts (id, author_id, body, parent_id) values ('${POST2}', '${BEN}', 'わたしも', '${POST1}');
  insert into posts (id, author_id, body, book_id, reading_mode)
    values ('${POST3}', '${CHI}', '自分だけのメモ', '${TYPO}', 'solo');
  insert into book_marks (user_id, book_id, kind) values ('${BEN}', '${NEW}', 'wish');
  insert into library_entries (user_id, book_id, source, status) values
    ('${AKI}', '${WOOD1}', 'scan', 'reading'), ('${CHI}', '${SECRET}', 'manual', null);
  insert into library_shelves (id, user_id, name, position) values ('${SHELF}', '${AKI}', '今年の本', 'a');
  insert into library_shelf_books (shelf_id, user_id, book_id) values ('${SHELF}', '${AKI}', '${WOOD1}');
  insert into book_encounters (id, user_id, book_id, kind, via) values ('${MEET}', '${DAI}', '${NDL}', 'want', 'book');
  insert into reading_entries (user_id, book_id, is_public, body) values
    ('${AKI}', '${WOOD1}', true, 'よかった'), ('${CHI}', '${SECRET}', false, '');
  insert into reading_sessions (user_id, book_id, mode) values
    ('${BEN}', '${NEW}', 'together'), ('${CHI}', '${SECRET}', 'solo');
  insert into profile_nine (profile_id, position, book_id) values ('${DAI}', 1, '${WOOD2}');
  insert into posters (id, author_id, template, pages) values
    ('${POSTER}', '${AKI}', 'one_book', '[{"blocks": [{"type": "books", "book_ids": ["${NOTE1}"]}]}]');
  insert into shops (id, owner_id, name, is_open, public_shelves, public_scene) values
    ('${SHOP}', '${AKI}', '軌道書房', true,
     '[{"name": "棚", "items": [{"bookId": "${WOOD1}"}]}]',
     '{"objects": [{"kind": "book", "bookId": "${NOTE1}"}]}');
`;

/** A database migrated up to the file before the works, with readers in it. */
async function beforeWorks(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < WORKS))
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
  const workOf = async (book: string) =>
    (
      await rows<{ w: string }>(
        "select work_id as w from books where id = $1",
        [book],
      )
    )[0].w;
  const count = async (sql: string, params: unknown[] = []) =>
    (await rows<{ n: number }>(`select (${sql})::int as n`, params))[0].n;
  return { rows, as, refused, workOf, count };
}

/** Every row of every table in public and private, books without work_id. */
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
        `select (to_jsonb(t) - 'work_id')::text as row from ${name} t order by 1`,
      )
    ).rows.map((row) => row.row);
  return all;
}

/** The books each visitor reads, as the app asks for them. */
async function seenBooks(db: PGlite): Promise<Record<string, unknown[]>> {
  const { as } = helpers(db);
  const seen: Record<string, unknown[]> = {};
  for (const visitor of [null, AKI, BEN, CHI, DAI])
    seen[visitor ?? "anon"] = await as(
      visitor,
      "select id, isbn, title, author, publisher, price, source, created_at, updated_at from books order by id",
    );
  return seen;
}

/**
 * Everything a migration makes or changes in public and private, by name, as
 * tests/database-policies.test.ts compares the library's rollback.
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
              format_type(a.atttypid, a.atttypmod) || ' ' || coalesce(a.attacl::text, '')
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
         and a.attnum > 0 and not a.attisdropped
       union all
       select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
              t.tgfoid::regproc::text || ' ' || t.tgenabled::text
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

/** The pairs work_candidates offers, as the works of their two books. */
async function candidates(db: PGlite) {
  const { rows } = helpers(db);
  return rows<{
    reason: string;
    works: string[];
    readers: number;
    reviews: number;
    shops: number;
  }>(
    `select c.reason,
       array(select w from unnest(array[a.work_id, b.work_id]) w order by w) as works,
       c.readers::int as readers, c.reviews::int as reviews, c.shops::int as shops
     from private.work_candidates() with ordinality c
     join books a on a.id = c.book_a join books b on b.id = c.book_b
     order by c.ordinality`,
  );
}
const pair = (a: string, b: string) => [a, b].sort();

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // The move ---------------------------------------------------------------------

  const db = await beforeWorks();
  const { rows, as, refused, workOf, count } = helpers(db);
  const before = await everyRow(db);
  const seenBefore = await seenBooks(db);
  await db.exec(TEXT);

  await check(
    "the move changes no row of any table, and gives every book a work",
    async () => {
      const after = await everyRow(db);
      for (const [table, kept] of Object.entries(before))
        assert.deepEqual(after[table], kept, table);
      assert.equal(
        await count("select count(*) from books where work_id is null"),
        0,
      );
    },
  );

  await check(
    "the same ISBN joins a work, unless the titles or authors disagree; no ISBN never joins",
    async () => {
      const works = new Map<string, string>();
      for (const book of OLD_BOOKS) works.set(book, await workOf(book));
      // The catalog row's work, though the reader's row is older.
      assert.equal(works.get(NEW), works.get(NDL));
      assert.equal(works.get(WOOD2), works.get(WOOD1));
      const apart = [
        NDL,
        TYPO,
        WOOD1,
        NOTE1,
        NOTE2,
        SECRET,
        ORWELL1,
        ORWELL2,
        SAMPLE,
      ];
      assert.equal(
        new Set(apart.map((book) => works.get(book))).size,
        apart.length,
      );
      assert.equal(await count("select count(*) from works"), apart.length);
      // A work is a fresh id, never a book's.
      assert.equal(
        await count("select count(*) from works w join books b on b.id = w.id"),
        0,
      );
      assert.equal(
        await count("select count(*) from works where merged_into is not null"),
        0,
      );
      // Each book placed with another is written down, dated as the book.
      assert.deepEqual(
        await rows(
          `select c.book_id, c.kind, c.from_work, c.to_work = b.work_id as now_there,
             c.changed_at = b.created_at as dated
           from private.work_changes c join books b on b.id = c.book_id
           order by b.created_at`,
        ),
        [
          {
            book_id: NEW,
            kind: "isbn",
            from_work: null,
            now_there: true,
            dated: true,
          },
          {
            book_id: WOOD2,
            kind: "isbn",
            from_work: null,
            now_there: true,
            dated: true,
          },
        ],
      );
    },
  );

  await check(
    "the copy holds every table that points at a book, checked with nothing lost",
    async () => {
      const copies = await rows<{
        source: string;
        row_count: number;
        lost: string;
      }>(
        `select source, row_count::int as row_count,
           (checked ->> 'lost_rows') || ' ' || (checked ->> 'lost_links') as lost
         from keep.copies where label = $1 order by source`,
        [LABEL],
      );
      // Every table with a book's id in it (library_shelf_books points at
      // the library's rows, and through them at the book).
      const pointing = await rows<{ t: string }>(
        `select 'public.' || table_name as t from information_schema.columns
         where table_schema = 'public' and column_name = 'book_id'`,
      );
      assert.deepEqual(
        copies.map((copy) => copy.source),
        ["public.books", ...pointing.map((row) => row.t)].sort(),
      );
      for (const copy of copies) {
        assert.equal(copy.lost, "0 0", copy.source);
        assert.equal(
          copy.row_count,
          await count(`select count(*) from ${copy.source}`),
          copy.source,
        );
      }
    },
  );

  await check(
    "every visitor reads the same books as before, and a work id shows no other book",
    async () => {
      assert.deepEqual(await seenBooks(db), seenBefore);
      // Chi's book is hers alone. Ben types in the same ISBN and title: his
      // row joins her work, and the work shows him nothing but his own.
      const bens = id(4, 1);
      await as(
        BEN,
        `insert into books (id, isbn, title, author, created_by) values ($1, $2, 'チーだけの本', 'チー', $3)
         on conflict (id) do nothing`,
        [bens, X3, BEN],
      );
      const work = (
        await as<{ w: string }>(
          BEN,
          "select work_id as w from books where id = $1",
          [bens],
        )
      )[0].w;
      assert.equal(work, await workOf(SECRET));
      assert.deepEqual(
        await as(BEN, "select id from books where work_id = $1", [work]),
        [{ id: bens }],
      );
      assert.deepEqual(
        await as(null, "select id from books where work_id = $1", [work]),
        [],
      );
      assert.deepEqual(
        await as(CHI, "select id from books where work_id = $1", [work]),
        [{ id: SECRET }],
      );
      // Signed out, a book's work is read with it.
      assert.deepEqual(
        await as(null, "select work_id from books where id = $1", [NDL]),
        [{ work_id: await workOf(NDL) }],
      );
    },
  );

  await check(
    "candidates: the same ISBN whose text disagrees, and the same title and author, busiest first",
    async () => {
      const found = await candidates(db);
      assert.deepEqual(
        found.map((c) => [c.reason, c.works]),
        [
          ["isbn", pair(await workOf(NDL), await workOf(TYPO))],
          ["title", pair(await workOf(NOTE1), await workOf(NOTE2))],
        ],
      );
      const [same, title] = found;
      // Aki's review of the catalog row; the reply and Chi's own note do
      // not count. Ben's wish is in his library.
      assert.equal(same.reviews, 1);
      assert.equal(same.readers, 1);
      // Aki's open shop shows ノート in its scene.
      assert.equal(title.shops, 1);
      // Three reviews of ベン's ノート put the pair first.
      await db.exec(`
        insert into posts (author_id, body, book_id) values
          ('${CHI}', 'いい', '${NOTE2}'), ('${DAI}', 'いい', '${NOTE2}'), ('${AKI}', 'いい', '${NOTE2}');
      `);
      const again = await candidates(db);
      assert.deepEqual(
        again.map((c) => c.reason),
        ["title", "isbn"],
      );
      assert.equal(again[0].reviews, 3);
    },
  );

  await check(
    "a title is a candidate with its start, never with another number",
    async () => {
      const add = async (
        n: number,
        title: string,
        author: string,
        bookIsbn: string | null,
      ) => {
        const book = id(5, n);
        await db.query(
          "insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, $4, $5)",
          [book, bookIsbn, title, author, AKI],
        );
        return book;
      };
      const old = await add(1, "華氏４５１度", "Ｒ．ブラッドベリ", null);
      const fresh = await add(2, "華氏451度 新訳版", "ブラッドベリ", X6);
      const one = await add(3, "ONE PIECE 1", "尾田栄一郎", null);
      const ten = await add(4, "ONE PIECE 10", "尾田栄一郎", null);
      const other = await add(5, "華氏451度 新訳版", "別の人", null);
      const blank = await add(6, "華氏451度", "", null);
      const pairs = (await candidates(db)).map((c) => c.works.join(" "));
      const has = async (a: string, b: string) =>
        pairs.includes(pair(await workOf(a), await workOf(b)).join(" "));
      assert.ok(await has(old, fresh), "華氏451度 and its new edition");
      assert.ok(await has(NDL, fresh), "the catalog row and the new edition");
      assert.ok(!(await has(one, ten)), "another volume");
      assert.ok(!(await has(fresh, other)), "another author");
      assert.ok(!(await has(old, blank)), "no author");
      await db.query("delete from books where id = any ($1::uuid[])", [
        [old, fresh, one, ten, other, blank],
      ]);
    },
  );

  // A new book ---------------------------------------------------------------------

  await check(
    "a new book of an ISBN joins its work, sent again it makes nothing, and it is written down",
    async () => {
      const book = id(4, 2);
      const send = () =>
        as(
          BEN,
          `insert into books (id, isbn, title, author, publisher, price, source, created_by, created_at, updated_at)
           values ($1, $2, '華氏451度', 'ブラッドベリ', '', null, 'manual', $3, now(), now())
           on conflict (id) do nothing`,
          [book, X1, BEN],
        );
      await send();
      assert.equal(await workOf(book), await workOf(NDL));
      const works = await count("select count(*) from works");
      const changes = await count("select count(*) from private.work_changes");
      await send();
      assert.equal(await count("select count(*) from works"), works);
      assert.equal(
        await count("select count(*) from private.work_changes"),
        changes,
      );
      assert.deepEqual(
        await rows(
          "select kind, from_work from private.work_changes where book_id = $1",
          [book],
        ),
        [{ kind: "isbn", from_work: null }],
      );
    },
  );

  await check(
    "a new book whose text disagrees, or with no ISBN, gets a work of its own",
    async () => {
      const other = id(4, 3);
      await as(
        CHI,
        "insert into books (id, isbn, title, author, created_by) values ($1, $2, 'たったひとつの冴えたやりかた', 'ティプトリー', $3)",
        [other, X1, CHI],
      );
      const work = await workOf(other);
      assert.notEqual(work, await workOf(NDL));
      assert.notEqual(work, await workOf(TYPO));
      assert.equal(
        await count(
          "select count(*) from private.work_changes where book_id = $1",
          [other],
        ),
        0,
      );
      assert.ok(
        (await candidates(db)).some(
          (c) => c.reason === "isbn" && c.works.includes(work),
        ),
      );
      const note = id(4, 4);
      await as(
        CHI,
        "insert into books (id, title, author, created_by) values ($1, 'ノート', 'アキ', $2)",
        [note, CHI],
      );
      assert.ok(
        ![await workOf(NOTE1), await workOf(NOTE2)].includes(
          await workOf(note),
        ),
      );
    },
  );

  await check(
    "two books of one new ISBN sent at once meet in one work",
    async () => {
      const [a, b] = [id(4, 5), id(4, 6)];
      await as(
        BEN,
        `insert into books (id, isbn, title, author, created_by) values
         ($1, $3, '同時の本', 'ベン', $4), ($2, $3, '同時の本', 'ベン', $4)`,
        [a, b, X7, BEN],
      );
      assert.equal(await workOf(a), await workOf(b));
      assert.equal(
        await count(
          "select count(*) from private.work_changes where book_id = any ($1::uuid[])",
          [[a, b]],
        ),
        1,
      );
    },
  );

  await check(
    "readers never name a work, and a book they fix keeps its work",
    async () => {
      const work = await workOf(NOTE1);
      await refused(
        () =>
          as(
            BEN,
            "insert into books (title, created_by, work_id) values ('名指し', $1, $2)",
            [BEN, work],
          ),
        /permission denied/,
        "a reader names a work",
      );
      await refused(
        () =>
          as(BEN, "update books set work_id = $1 where id = $2", [work, NOTE2]),
        /permission denied/,
        "a reader moves their book",
      );
      await refused(
        () => as(null, "insert into books (title) values ('だれか')"),
        /permission denied/,
        "a visitor signed out writes a book",
      );
      const mine = await workOf(NOTE2);
      assert.equal(
        (
          await as(
            BEN,
            "update books set title = 'ノート（改）', isbn = $2 where id = $1 returning 1",
            [NOTE2, X4],
          )
        ).length,
        1,
      );
      assert.equal(await workOf(NOTE2), mine);
      await db.query(
        "update books set title = 'ノート', isbn = null where id = $1",
        [NOTE2],
      );
      // ISBN-10s never reach the database as they are: the app turns them
      // into ISBN-13s, so the same book is always the same number.
      await refused(
        () =>
          as(
            BEN,
            "insert into books (title, isbn, created_by) values ('十桁', '415011955X', $1)",
            [BEN],
          ),
        /isbn13_valid|check constraint/,
        "an ISBN-10",
      );
    },
  );

  await check(
    "a work named by the operator stays, or leads to where it went",
    async () => {
      const book = id(4, 7);
      await db.query(
        "insert into books (id, title, author, work_id) values ($1, 'ノートの写し', 'アキ', $2)",
        [book, await workOf(NOTE1)],
      );
      assert.equal(await workOf(book), await workOf(NOTE1));
      assert.deepEqual(
        await rows("select kind from private.work_changes where book_id = $1", [
          book,
        ]),
        [{ kind: "named" }],
      );
      await db.query("delete from books where id = $1", [book]);
    },
  );

  await check(
    "nobody reaches works, their records or the tools through the API",
    async () => {
      for (const visitor of [null, BEN]) {
        for (const sql of [
          "select * from works",
          "insert into works default values",
          "select * from private.work_changes",
          "select * from private.works_apart",
          "select * from private.work_candidates()",
          `select private.join_works('${NOTE1}', '${NOTE2}')`,
          `select private.part_books(array['${NOTE1}']::uuid[])`,
          `select private.keep_apart('${NOTE1}', '${NOTE2}')`,
          `select private.isbn_work('${X1}', '華氏451度', '')`,
          "select private.same_edition_text('a', 'b', 'c', 'd')",
          "select private.same_author_text('a', 'b')",
          "select private.fold_book_text('a')",
        ])
          await refused(
            () => as(visitor, sql),
            /permission denied/,
            `${visitor ?? "anon"}: ${sql}`,
          );
      }
    },
  );

  // The operator's tools ---------------------------------------------------------------

  // The work ORWELL2 had before the operator joined it into ORWELL1's.
  let orwellGone = "";

  await check(
    "the operator joins two translations, and a book of either ISBN registered later joins them",
    async () => {
      const kept = await workOf(ORWELL1);
      const gone = await workOf(ORWELL2);
      orwellGone = gone;
      assert.deepEqual(
        await rows("select private.join_works($1, $2) as moved", [
          ORWELL1,
          ORWELL2,
        ]),
        [{ moved: 1 }],
      );
      assert.equal(await workOf(ORWELL2), kept);
      assert.deepEqual(
        await rows("select merged_into from works where id = $1", [gone]),
        [{ merged_into: kept }],
      );
      assert.deepEqual(
        await rows(
          "select kind, from_work, to_work from private.work_changes where book_id = $1",
          [ORWELL2],
        ),
        [{ kind: "join", from_work: gone, to_work: kept }],
      );
      const later = id(4, 8);
      await as(
        DAI,
        "insert into books (id, isbn, title, author, created_by) values ($1, $2, '一九八四年', 'ジョージ・オーウェル', $3)",
        [later, X5, DAI],
      );
      assert.equal(await workOf(later), kept);
      // A work named by an id it had before the join leads to it now.
      const named = id(4, 9);
      await db.query(
        "insert into books (id, title, work_id) values ($1, '写し', $2)",
        [named, gone],
      );
      assert.equal(await workOf(named), kept);
      await db.query("delete from books where id = $1", [named]);
    },
  );

  await check(
    "a join is parted again, kept apart, written down, and can be joined back",
    async () => {
      const kept = await workOf(ORWELL1);
      const fresh = (
        await rows<{ w: string }>(
          "select private.part_books(array[$1]::uuid[]) as w",
          [ORWELL2],
        )
      )[0].w;
      assert.equal(await workOf(ORWELL2), fresh);
      assert.equal(await workOf(ORWELL1), kept);
      assert.deepEqual(
        await rows(
          "select kind, from_work, to_work from private.work_changes where book_id = $1 order by changed_at, kind",
          [ORWELL2],
        ),
        [
          { kind: "join", from_work: orwellGone, to_work: kept },
          { kind: "part", from_work: kept, to_work: fresh },
        ],
      );
      // The later book of the same ISBN stays with 1984年; the parted pair is
      // decided, so it is no candidate.
      assert.ok(
        !(await candidates(db)).some((c) => c.works.includes(fresh)),
        "a parted book comes back as a candidate",
      );
      assert.deepEqual(
        await rows("select private.join_works($1, $2) as moved", [
          ORWELL1,
          ORWELL2,
        ]),
        [{ moved: 1 }],
      );
      assert.equal(await workOf(ORWELL2), kept);
      assert.equal(
        await count(
          "select count(*) from private.works_apart where $1 in (work_a, work_b)",
          [fresh],
        ),
        0,
      );
    },
  );

  await check(
    "two works kept apart leave the candidates, and that holds after one is joined into a third",
    async () => {
      const title = async () =>
        (await candidates(db))
          .filter((c) => c.reason === "title")
          .map((c) => c.works.join(" "));
      const notes = pair(await workOf(NOTE1), await workOf(NOTE2)).join(" ");
      assert.ok((await title()).includes(notes));
      await db.query("select private.keep_apart($1, $2)", [NOTE1, NOTE2]);
      assert.ok(!(await title()).includes(notes));
      // Chi's ノート (typed in above) is joined into Ben's: the decision about
      // Ben's work is now about the work it went into.
      const chis = id(4, 4);
      await db.query("select private.join_works($1, $2)", [chis, NOTE2]);
      assert.ok(
        !(await title()).includes(
          pair(await workOf(NOTE1), await workOf(chis)).join(" "),
        ),
      );
      // Undone by hand, as the migration says.
      await db.query(
        "delete from private.works_apart where $1 in (work_a, work_b)",
        [await workOf(NOTE1)],
      );
      assert.ok(
        (await title()).includes(
          pair(await workOf(NOTE1), await workOf(chis)).join(" "),
        ),
      );
    },
  );

  await check(
    "the tools refuse what they cannot do, and change nothing",
    async () => {
      const changes = await count("select count(*) from private.work_changes");
      const nobody = id(9, 9);
      await refused(
        () => rows("select private.join_works($1, $2)", [WOOD1, WOOD2]),
        /one work already/,
        "one work",
      );
      await refused(
        () => rows("select private.join_works($1, $2)", [WOOD1, nobody]),
        /no book has that id/,
        "no book",
      );
      await refused(
        () => rows("select private.part_books($1::uuid[])", [[]]),
        /name the books/,
        "no books",
      );
      await refused(
        () => rows("select private.part_books($1::uuid[])", [[WOOD1, nobody]]),
        /no book has that id/,
        "no book",
      );
      await refused(
        () => rows("select private.keep_apart($1, $2)", [WOOD1, WOOD2]),
        /one work/,
        "one work",
      );
      assert.equal(
        await count("select count(*) from private.work_changes"),
        changes,
      );
    },
  );

  await check(
    "an account deleted leaves no trace of it in the move's copies",
    async () => {
      await deleteAccounts(db, [DAI]);
      const copies = await rows<{ copy_name: string }>(
        "select copy_name from keep.copies where label = $1",
        [LABEL],
      );
      assert.equal(copies.length, 10);
      for (const { copy_name } of copies)
        assert.equal(
          await count(
            `select count(*) from keep.${JSON.stringify(copy_name)} t where to_jsonb(t)::text like '%' || $1 || '%'`,
            [DAI],
          ),
          0,
          copy_name,
        );
    },
  );

  await check(
    "putting the books back from the copy waits for the rollback, and changes nothing until then",
    async () => {
      await db.query("update books set title = 'こわれた題名' where id = $1", [
        NOTE1,
      ]);
      await refused(
        () =>
          rows(
            "select * from private.restore_copy($1, array['public.books']::regclass[])",
            [LABEL],
          ),
        /could not be put back/,
        "restoring books that need a work",
      );
      assert.equal(
        (
          await rows<{ title: string }>(
            "select title from books where id = $1",
            [NOTE1],
          )
        )[0].title,
        "こわれた題名",
      );
      assert.equal(
        await count(
          "select count(*) from pg_trigger where tgrelid = 'public.books'::regclass and not tgisinternal and tgenabled = 'D'",
        ),
        0,
      );
    },
  );
  await db.close();

  // Undoing the move -------------------------------------------------------------------

  await check(
    "the rollback, as the header writes it, leaves the database as it was; the books come back from the copy; and the move runs again",
    async () => {
      const earlier = await beforeWorks();
      const { rows: on, count: counted } = helpers(earlier);
      const was = await catalog(earlier);
      const rowsWere = await everyRow(earlier);
      await earlier.exec(TEXT);
      // The rollback is the indented lines of the header, the comment
      // before the file's first blank line.
      const rollback = TEXT.slice(0, TEXT.indexOf("\n\n"))
        .split("\n")
        .filter((line) => line.startsWith("--   "))
        .map((line) => line.slice(3))
        .join("\n");
      assert.match(rollback, /drop table public\.works/);
      assert.doesNotMatch(rollback, /restore_copy/);
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      assert.deepEqual(await everyRow(earlier), rowsWere);
      // A book spoiled since comes back as the copy kept it.
      await earlier.query(
        "update books set title = 'こわれた題名' where id = $1",
        [NOTE1],
      );
      await on(
        "select * from private.restore_copy($1, array['public.books']::regclass[])",
        [LABEL],
      );
      assert.deepEqual(await everyRow(earlier), rowsWere);
      // With the copy dropped, the move runs again as it did.
      await on("select private.drop_copy($1)", [LABEL]);
      assert.equal(await counted("select count(*) from keep.copies"), 0);
      await earlier.exec(TEXT);
      assert.equal(await counted("select count(*) from works"), 9);
      assert.equal(
        await counted("select count(*) from keep.copies where label = $1", [
          LABEL,
        ]),
        10,
      );
      await earlier.close();
    },
  );

  await check(
    "a move whose check fails is rolled back whole, copy and works and all",
    async () => {
      const earlier = await beforeWorks();
      const { count: counted } = helpers(earlier);
      const was = await catalog(earlier);
      const rowsWere = await everyRow(earlier);
      const spoiled = TEXT.replace(
        "update public.books set work_id = found_work where id = b.id;",
        "update public.books set work_id = found_work, title = title || '！' where id = b.id;",
      );
      assert.notEqual(spoiled, TEXT);
      let error: unknown = null;
      try {
        await earlier.exec(spoiled);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /the move changed 11 books/);
      assert.deepEqual(await catalog(earlier), was);
      assert.deepEqual(await everyRow(earlier), rowsWere);
      assert.equal(await counted("select count(*) from keep.copies"), 0);
      assert.equal(
        await counted(
          "select count(*) from pg_class where relnamespace = 'keep'::regnamespace and relkind = 'r'",
        ),
        1,
      );
      await earlier.close();
    },
  );

  console.log(passed + " works checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
