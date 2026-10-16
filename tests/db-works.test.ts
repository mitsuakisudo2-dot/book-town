import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { searchFold } from "../src/lib/search/fold";
import {
  SUPABASE_STANDIN,
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// Works and editions (item 4 of the 2026-10-16 plan,
// supabase/migrations/*_works.sql): the move on a database with readers in
// it, the work each new book is given, the operator's tools, and undoing it
// all. The owner's rules (2026-10-16 13:07Z): a work, an edition (one ISBN)
// and a registration (a row of books) are kept apart; the same ISBN is the
// same edition, at once, without comparing any text, so nothing another
// reader registered changes what happens; editions become one work only when
// the operator joins them, from candidates made of what anyone may read; a
// join holds for books that come later, can be undone exactly, and every
// change is written down.

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
/** ISBNs no book has before the tests give them one. */
const unused = (n: number) => isbn("9784100" + String(n).padStart(5, "0"));

// The books there are before the move. 華氏451度 has a catalog row, a
// reader's row of the same ISBN, and a third of the same ISBN that is
// another book typed in under the wrong number. ノルウェイの森 is typed in
// twice with the same ISBN, ノート twice with none, and 1984 twice as two
// translations with their own ISBNs. Chi's book is hers alone.
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
  /** A catalog row the operator puts in, as an import would. */
  async function add(
    book: string,
    title: string,
    author: string,
    bookIsbn: string | null,
  ) {
    await db.query(
      "insert into books (id, isbn, title, author, source) values ($1, $2, $3, $4, 'ndl')",
      [book, bookIsbn, title, author],
    );
    return book;
  }
  return { rows, as, refused, workOf, count, add };
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
    works: string;
    readers: number;
    reviews: number;
    shops: number;
  }>(
    `select array_to_string(array(select w::text from unnest(array[a.work_id, b.work_id]) w order by 1), ' ') as works,
       c.readers::int as readers, c.reviews::int as reviews, c.shops::int as shops
     from private.work_candidates() with ordinality c
     join books a on a.id = c.book_a join books b on b.id = c.book_b
     order by c.ordinality`,
  );
}
const pair = (a: string, b: string) => [a, b].sort().join(" ");

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // The move ---------------------------------------------------------------------

  const db = await beforeWorks();
  const { rows, as, refused, workOf, count, add } = helpers(db);
  const before = await everyRow(db);
  const seenBefore = await seenBooks(db);
  await db.exec(TEXT);

  await check(
    "the move changes no row of any table, and gives every book a work and every ISBN an edition",
    async () => {
      const after = await everyRow(db);
      for (const [table, kept] of Object.entries(before))
        assert.deepEqual(after[table], kept, table);
      assert.equal(
        await count("select count(*) from books where work_id is null"),
        0,
      );
      assert.deepEqual(
        (
          await rows<{ isbn: string }>("select isbn from editions order by 1")
        ).map((row) => row.isbn),
        [X1, X2, X3, X4, X5].sort(),
      );
    },
  );

  await check(
    "the same ISBN is one edition and one work, whatever its text; a book without one has a work of its own",
    async () => {
      const works = new Map<string, string>();
      for (const book of OLD_BOOKS) works.set(book, await workOf(book));
      // The wrong number joins too: the same ISBN is the same edition, and
      // registering never compares titles.
      assert.equal(works.get(NEW), works.get(NDL));
      assert.equal(works.get(TYPO), works.get(NDL));
      assert.equal(works.get(WOOD2), works.get(WOOD1));
      const apart = [
        NDL,
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
      // Each edition's work is its books'; a work is a fresh id, never a
      // book's; nothing is joined or written down yet.
      assert.equal(
        await count(
          "select count(*) from books b join editions e on e.isbn = b.isbn where e.work_id <> b.work_id",
        ),
        0,
      );
      assert.equal(
        await count("select count(*) from works w join books b on b.id = w.id"),
        0,
      );
      assert.equal(
        await count("select count(*) from works where merged_into is not null"),
        0,
      );
      assert.equal(await count("select count(*) from private.work_changes"), 0);
      // An edition is as old as its oldest book, and so is its work.
      assert.deepEqual(
        await rows(
          `select e.created_at = w.created_at as same, to_char(e.created_at, 'YYYY-MM-DD') as day
           from editions e join works w on w.id = e.work_id where e.isbn = $1`,
          [X1],
        ),
        [{ same: true, day: "2026-10-01" }],
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
    "every visitor reads the same books as before, and nothing another reader registered changes what a reader can find out",
    async () => {
      assert.deepEqual(await seenBooks(db), seenBefore);
      // Signed out, a book's work is read with it.
      assert.deepEqual(
        await as(null, "select work_id from books where id = $1", [NDL]),
        [{ work_id: await workOf(NDL) }],
      );
      // Ben registers two books of one ISBN whose titles disagree, once with
      // the ISBN of Chi's hidden book and once with one nobody has. What he
      // can find out is the same both times: the two share a work, and he
      // reads no other book of it.
      const probe = async (n: number, probed: string) => {
        const [a, b] = [id(6, n), id(6, n + 1)];
        for (const [book, title] of [
          [a, "秘密"],
          [b, "手帖"],
        ])
          await as(
            BEN,
            `insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, '', $4)
             on conflict (id) do nothing`,
            [book, probed, title, BEN],
          );
        const [workA, workB] = (
          await as<{ w: string }>(
            BEN,
            "select work_id as w from books where id = any ($1::uuid[]) order by id",
            [[a, b]],
          )
        ).map((row) => row.w);
        const others = await as<{ id: string }>(
          BEN,
          "select id from books where work_id = $1 and id <> all ($2::uuid[])",
          [workA, [a, b]],
        );
        return { together: workA === workB, others: others.length };
      };
      const hidden = await probe(1, X3);
      const nobody = await probe(3, unused(1));
      assert.deepEqual(hidden, { together: true, others: 0 });
      assert.deepEqual(nobody, hidden);
      // In truth his books joined Chi's edition, which only she reads.
      assert.equal(await workOf(id(6, 1)), await workOf(SECRET));
      assert.deepEqual(
        await as(CHI, "select id from books where work_id = $1", [
          await workOf(SECRET),
        ]),
        [{ id: SECRET }],
      );
      await db.query("delete from books where id = any ($1::uuid[])", [
        [id(6, 1), id(6, 2), id(6, 3), id(6, 4)],
      ]);
    },
  );

  // A new book ---------------------------------------------------------------------

  await check(
    "a new book of an ISBN joins its edition at once, and sent again it makes nothing",
    async () => {
      const book = id(4, 1);
      const send = () =>
        as(
          BEN,
          `insert into books (id, isbn, title, author, publisher, price, source, created_by, created_at, updated_at)
           values ($1, $2, '別の題名', '別の人', '', null, 'manual', $3, now(), now())
           on conflict (id) do nothing`,
          [book, X1, BEN],
        );
      const works = await count("select count(*) from works");
      const editions = await count("select count(*) from editions");
      await send();
      assert.equal(await workOf(book), await workOf(NDL));
      await send();
      assert.equal(await count("select count(*) from works"), works);
      assert.equal(await count("select count(*) from editions"), editions);
      assert.equal(await count("select count(*) from private.work_changes"), 0);
    },
  );

  await check(
    "a new ISBN gets an edition and a work, a book without one a work of its own, and a work named in an insert is not taken",
    async () => {
      const works = await count("select count(*) from works");
      const editions = await count("select count(*) from editions");
      const fresh = id(4, 2);
      await as(
        CHI,
        "insert into books (id, isbn, title, author, created_by) values ($1, $2, 'たったひとつの冴えたやりかた', 'ティプトリー', $3)",
        [fresh, unused(2), CHI],
      );
      assert.equal(await count("select count(*) from editions"), editions + 1);
      assert.deepEqual(
        await rows("select work_id from editions where isbn = $1", [unused(2)]),
        [{ work_id: await workOf(fresh) }],
      );
      const note = id(4, 3);
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
      assert.equal(await count("select count(*) from works"), works + 2);
      // Only the database decides a book's work, even for the operator.
      const named = id(4, 4);
      await db.query(
        "insert into books (id, isbn, title, work_id) values ($1, $2, '写し', $3)",
        [named, X2, await workOf(NOTE1)],
      );
      assert.equal(await workOf(named), await workOf(WOOD1));
      await db.query("delete from books where id = $1", [named]);
    },
  );

  await check(
    "two books of one new ISBN sent at once meet in one work, and one book sent twice at once makes one work",
    async () => {
      const works = await count("select count(*) from works");
      const [a, b] = [id(4, 5), id(4, 6)];
      await as(
        BEN,
        `insert into books (id, isbn, title, author, created_by) values
         ($1, $3, '同時の本', 'ベン', $4), ($2, $3, '同時の本', 'ベン', $4)`,
        [a, b, unused(3), BEN],
      );
      assert.equal(await workOf(a), await workOf(b));
      assert.equal(await count("select count(*) from works"), works + 1);
      const twice = id(4, 7);
      await as(
        BEN,
        `insert into books (id, title, created_by) values ($1, '二度の本', $2), ($1, '二度の本', $2)
         on conflict (id) do nothing`,
        [twice, BEN],
      );
      assert.equal(await count("select count(*) from works"), works + 2);
    },
  );

  await check(
    "readers never name a work; a book whose ISBN is changed moves to that edition, written down",
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
      const book = id(4, 8);
      await as(
        BEN,
        "insert into books (id, title, author, created_by) values ($1, '書き直す本', 'ベン', $2)",
        [book, BEN],
      );
      const alone = await workOf(book);
      const orwell = await workOf(ORWELL1);
      // A new title moves nothing.
      await as(BEN, "update books set title = '書き直した本' where id = $1", [
        book,
      ]);
      assert.equal(await workOf(book), alone);
      // An ISBN given: the book joins that edition.
      await as(BEN, "update books set isbn = $2 where id = $1", [book, X4]);
      assert.equal(await workOf(book), orwell);
      // Taken off again: a work of its own, not the one it had.
      await as(BEN, "update books set isbn = null where id = $1", [book]);
      const own = await workOf(book);
      assert.ok(![alone, orwell].includes(own));
      assert.deepEqual(
        await rows(
          "select kind, from_work, to_work from private.work_changes where book_id = $1 order by to_work = $2",
          [book, own],
        ),
        [
          { kind: "edited", from_work: alone, to_work: orwell },
          { kind: "edited", from_work: orwell, to_work: own },
        ],
      );
      await db.query("delete from books where id = $1", [book]);
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
    "nobody reaches works, editions, their records or the tools through the API",
    async () => {
      const work = await workOf(NOTE1);
      for (const visitor of [null, BEN]) {
        for (const sql of [
          "select * from works",
          "select * from editions",
          "insert into works default values",
          `insert into editions (isbn, work_id) values ('${unused(9)}', '${work}')`,
          "select * from private.work_changes",
          "select * from private.work_joins",
          "select * from private.works_apart",
          "select * from private.work_candidates()",
          `select private.join_works('${NOTE1}', '${NOTE2}')`,
          `select private.undo_join('${NOTE1}')`,
          `select private.part_books(array['${NOTE1}']::uuid[])`,
          `select private.keep_apart('${NOTE1}', '${NOTE2}')`,
          `select private.edition_work('${X1}')`,
          "select private.fold_book_text('a')",
          "select private.author_keys('a')",
          "select private.title_numbers('a')",
          "select private.titles_agree('a', 'b')",
          "select private.authors_agree(array['a'], 'a', array['b'], 'b')",
        ])
          await refused(
            () => as(visitor, sql),
            /permission denied/,
            `${visitor ?? "anon"}: ${sql}`,
          );
      }
    },
  );

  // Telling titles and authors apart --------------------------------------------------

  await check(
    "titles and authors are folded as the search folds them, people are found in author lines, and numbers tell volumes apart",
    async () => {
      for (const text of [
        "森鷗外",
        "ノルウエイの森",
        "こゝろ",
        "みすゞ",
        "ＡＢＣ abc",
        "ヴァイオリン",
        "髙田郁",
        "トーキョー",
        "Café",
        "華氏451度〔新訳版〕",
        "𠮟る",
        "ゝあ",
        "",
        "1Q84 BOOK1",
      ])
        assert.equal(
          (
            await rows<{ f: string }>(
              "select private.fold_book_text($1) as f",
              [text],
            )
          )[0].f,
          searchFold(text),
          text,
        );
      const agree = async (a: string, b: string) =>
        (
          await rows<{ x: boolean }>(
            `select private.authors_agree(private.author_keys($1), private.fold_book_text($1),
               private.author_keys($2), private.fold_book_text($2)) as x`,
            [a, b],
          )
        )[0].x;
      assert.ok(await agree("ブラッドベリ, レイ", "レイ・ブラッドベリ 著"));
      assert.ok(await agree("村上 春樹", "村上春樹, 柴田元幸 訳"));
      assert.ok(await agree("森鷗外", "森 鴎外"));
      assert.ok(!(await agree("村上春樹", "村上龍")));
      assert.ok(!(await agree("村上, 春樹", "村上, 龍")));
      assert.ok(!(await agree("スティーヴン・キング", "ホーキング")));
      assert.ok(!(await agree("", "")));
      const titles = async (a: string, b: string) =>
        (
          await rows<{ x: boolean }>(
            "select private.titles_agree(private.fold_book_text($1), private.fold_book_text($2)) as x",
            [a, b],
          )
        )[0].x;
      assert.ok(await titles("華氏451度", "華氏４５１度 新訳版"));
      assert.ok(await titles("火", "火"));
      assert.ok(!(await titles("ONE PIECE 1", "ONE PIECE 10")));
      assert.ok(!(await titles("進撃の巨人(1)", "進撃の巨人(12)")));
      assert.ok(!(await titles("進撃の巨人", "進撃の巨人 1")));
      assert.ok(!(await titles("ノルウェイの森 上", "ノルウェイの森 下")));
    },
  );

  // Candidates ---------------------------------------------------------------------------

  await check(
    "candidates come only from books anyone may read, busiest first",
    async () => {
      // Ben's ノート is his alone, and so is Chi's, so Aki's ノート has no
      // candidate yet; the books of one ISBN are one work already.
      assert.deepEqual(await candidates(db), []);
      await as(
        BEN,
        "insert into posts (author_id, body, book_id) values ($1, 'メモの本', $2)",
        [BEN, NOTE2],
      );
      const found = await candidates(db);
      assert.deepEqual(
        found.map((c) => c.works),
        [pair(await workOf(NOTE1), await workOf(NOTE2))],
      );
      // Ben's review; Aki's open shop shows her ノート in its scene.
      assert.deepEqual(
        [found[0].reviews, found[0].shops, found[0].readers],
        [1, 1, 0],
      );
      // Two catalog rows of one book with three reviews come first.
      const [river1, river2] = [id(5, 1), id(5, 2)];
      await add(river1, "銀河鉄道の夜", "宮沢賢治", unused(4));
      await add(river2, "銀河鉄道の夜", "宮澤賢治 著", unused(5));
      await db.exec(`
        insert into posts (author_id, body, book_id) values
          ('${CHI}', 'いい', '${river1}'), ('${DAI}', 'いい', '${river1}'), ('${AKI}', 'いい', '${river2}');
      `);
      const again = await candidates(db);
      assert.deepEqual(
        again.map((c) => c.works),
        [
          pair(await workOf(river1), await workOf(river2)),
          pair(await workOf(NOTE1), await workOf(NOTE2)),
        ],
      );
      assert.equal(again[0].reviews, 3);
      await db.query("delete from posts where book_id = any ($1::uuid[])", [
        [river1, river2],
      ]);
      await db.query("delete from books where id = any ($1::uuid[])", [
        [river1, river2],
      ]);
    },
  );

  await check(
    "a title is a candidate with its start, never with another number, and many copies of one book make one pair each",
    async () => {
      const old = await add(id(5, 3), "華氏４５１度", "Ｒ．ブラッドベリ", null);
      const fresh = await add(
        id(5, 4),
        "華氏451度 新訳版",
        "ブラッドベリ",
        unused(6),
      );
      const one = await add(id(5, 5), "ONE PIECE 1", "尾田栄一郎", unused(7));
      const ten = await add(id(5, 6), "ONE PIECE 10", "尾田栄一郎", unused(8));
      const other = await add(id(5, 7), "華氏451度 新訳版", "別の人", null);
      const blank = await add(id(5, 8), "華氏451度", "", null);
      const ogai1 = await add(id(5, 9), "舞姫", "森鷗外", unused(10));
      const ogai2 = await add(id(5, 10), "舞姫", "森 鴎外", unused(11));
      const pairs = (await candidates(db)).map((c) => c.works);
      const has = async (a: string, b: string) =>
        pairs.includes(pair(await workOf(a), await workOf(b)));
      assert.ok(await has(old, fresh), "華氏451度 and its new edition");
      assert.ok(await has(NDL, fresh), "the catalog row and the new edition");
      assert.ok(await has(ogai1, ogai2), "鷗 and 鴎");
      assert.ok(!(await has(one, ten)), "another volume");
      assert.ok(!(await has(fresh, other)), "another author");
      assert.ok(!(await has(old, blank)), "no author");
      // Five works of one title and author: four pairs, not ten.
      const copies = [11, 12, 13, 14, 15].map((n) => id(5, n));
      for (const copy of copies) await add(copy, "同じ本", "同じ人", null);
      const works = await Promise.all(copies.map(workOf));
      const among = (await candidates(db)).filter((c) =>
        c.works.split(" ").every((work) => works.includes(work)),
      );
      assert.equal(among.length, 4);
      await db.query("delete from books where id = any ($1::uuid[])", [
        [old, fresh, one, ten, other, blank, ogai1, ogai2, ...copies],
      ]);
    },
  );

  // The operator's tools ---------------------------------------------------------------

  let orwellJoin = "";
  const later = id(4, 9);

  await check(
    "the operator joins two translations, and a book of either ISBN registered later joins them",
    async () => {
      const kept = await workOf(ORWELL1);
      const gone = await workOf(ORWELL2);
      const [joined] = await rows<{ join_id: string; moved: number }>(
        "select * from private.join_works($1, $2)",
        [ORWELL1, ORWELL2],
      );
      orwellJoin = joined.join_id;
      assert.equal(joined.moved, 1);
      assert.equal(await workOf(ORWELL2), kept);
      assert.deepEqual(
        await rows("select work_id from editions where isbn = $1", [X5]),
        [{ work_id: kept }],
      );
      assert.deepEqual(
        await rows("select merged_into from works where id = $1", [gone]),
        [{ merged_into: kept }],
      );
      assert.deepEqual(
        await rows(
          "select kept, gone, isbns, undone_at from private.work_joins where id = $1",
          [orwellJoin],
        ),
        [{ kept, gone, isbns: [X5], undone_at: null }],
      );
      assert.deepEqual(
        await rows(
          "select kind, from_work, to_work, join_id from private.work_changes where book_id = $1",
          [ORWELL2],
        ),
        [{ kind: "join", from_work: gone, to_work: kept, join_id: orwellJoin }],
      );
      await as(
        DAI,
        "insert into books (id, isbn, title, author, created_by) values ($1, $2, '一九八四年', 'ジョージ・オーウェル', $3)",
        [later, X5, DAI],
      );
      assert.equal(await workOf(later), kept);
    },
  );

  await check(
    "undoing a join puts back exactly what it moved, books registered since included, and keeps the two apart",
    async () => {
      const [{ kept, gone }] = await rows<{ kept: string; gone: string }>(
        "select kept, gone from private.work_joins where id = $1",
        [orwellJoin],
      );
      assert.deepEqual(
        await rows("select private.undo_join($1) as moved", [orwellJoin]),
        [{ moved: 2 }],
      );
      assert.equal(await workOf(ORWELL2), gone);
      assert.equal(await workOf(later), gone);
      assert.equal(await workOf(ORWELL1), kept);
      assert.deepEqual(
        await rows("select work_id from editions where isbn = $1", [X5]),
        [{ work_id: gone }],
      );
      assert.deepEqual(
        await rows("select merged_into from works where id = $1", [gone]),
        [{ merged_into: null }],
      );
      assert.equal(
        await count(
          "select count(*) from private.works_apart where work_a = least($1::uuid, $2::uuid) and work_b = greatest($1::uuid, $2::uuid)",
          [kept, gone],
        ),
        1,
      );
      assert.equal(
        await count(
          "select count(*) from private.work_changes where join_id = $1 and kind = 'unjoin'",
          [orwellJoin],
        ),
        2,
      );
      await refused(
        () => rows("select private.undo_join($1)", [orwellJoin]),
        /undone already/,
        "undone twice",
      );
    },
  );

  await check(
    "joins one after another are undone the other way round, each as it was",
    async () => {
      const [p, q, r] = [id(7, 1), id(7, 2), id(7, 3)];
      await add(p, "連なる本", "甲", unused(12));
      await add(q, "連なる本", "乙", unused(13));
      await add(r, "連なる本", "丙", unused(14));
      const [wp, wq, wr] = [await workOf(p), await workOf(q), await workOf(r)];
      const merged = async () =>
        Object.fromEntries(
          (
            await rows<{ id: string; merged_into: string | null }>(
              "select id, merged_into from works where id = any ($1::uuid[])",
              [[wp, wq, wr]],
            )
          ).map((row) => [row.id, row.merged_into]),
        );
      const [first] = await rows<{ join_id: string }>(
        "select * from private.join_works($1, $2)",
        [r, q],
      );
      const [second] = await rows<{ join_id: string }>(
        "select * from private.join_works($1, $2)",
        [p, r],
      );
      assert.deepEqual(await merged(), { [wp]: null, [wq]: wp, [wr]: wp });
      await refused(
        () => rows("select private.undo_join($1)", [first.join_id]),
        /undo that join first/,
        "the earlier join first",
      );
      assert.deepEqual(
        await rows("select private.undo_join($1) as moved", [second.join_id]),
        [{ moved: 2 }],
      );
      assert.deepEqual(
        [await workOf(p), await workOf(q), await workOf(r)],
        [wp, wr, wr],
      );
      assert.deepEqual(await merged(), { [wp]: null, [wq]: wr, [wr]: null });
      assert.deepEqual(
        await rows("select private.undo_join($1) as moved", [first.join_id]),
        [{ moved: 1 }],
      );
      assert.deepEqual(
        [await workOf(p), await workOf(q), await workOf(r)],
        [wp, wq, wr],
      );
      assert.deepEqual(await merged(), { [wp]: null, [wq]: null, [wr]: null });
      await db.query("delete from books where id = any ($1::uuid[])", [
        [p, q, r],
      ]);
    },
  );

  await check(
    "parting takes whole editions out of one work, kept apart and written down, and a join puts them back",
    async () => {
      await rows("select * from private.join_works($1, $2)", [
        ORWELL1,
        ORWELL2,
      ]);
      const kept = await workOf(ORWELL1);
      assert.equal(await workOf(later), kept);
      const fresh = (
        await rows<{ w: string }>(
          "select private.part_books(array[$1]::uuid[]) as w",
          [ORWELL2],
        )
      )[0].w;
      // Dai's book of the same ISBN goes with it: one ISBN, one edition.
      assert.equal(await workOf(ORWELL2), fresh);
      assert.equal(await workOf(later), fresh);
      assert.equal(await workOf(ORWELL1), kept);
      assert.deepEqual(
        await rows("select work_id from editions where isbn = $1", [X5]),
        [{ work_id: fresh }],
      );
      assert.deepEqual(
        await rows(
          "select book_id, from_work from private.work_changes where kind = 'part' and to_work = $1 order by book_id",
          [fresh],
        ),
        [ORWELL2, later].sort().map((book) => ({
          book_id: book,
          from_work: kept,
        })),
      );
      assert.equal(
        await count(
          "select count(*) from private.works_apart where work_a = least($1::uuid, $2::uuid) and work_b = greatest($1::uuid, $2::uuid)",
          [kept, fresh],
        ),
        1,
      );
      await rows("select * from private.join_works($1, $2)", [
        ORWELL1,
        ORWELL2,
      ]);
      assert.equal(await workOf(ORWELL2), kept);
      assert.equal(await workOf(later), kept);
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
      const listed = async () => (await candidates(db)).map((c) => c.works);
      const notes = pair(await workOf(NOTE1), await workOf(NOTE2));
      assert.ok((await listed()).includes(notes));
      await db.query("select private.keep_apart($1, $2)", [NOTE1, NOTE2]);
      assert.ok(!(await listed()).includes(notes));
      // Chi's ノート, typed in above, shown in public, and joined into
      // Ben's: what was decided about Ben's work is now about it.
      const chis = id(4, 3);
      await as(
        CHI,
        "insert into posts (author_id, body, book_id) values ($1, 'わたしのノート', $2)",
        [CHI, chis],
      );
      await db.query("select * from private.join_works($1, $2)", [chis, NOTE2]);
      assert.ok(
        !(await listed()).includes(
          pair(await workOf(NOTE1), await workOf(chis)),
        ),
      );
      // Undone by hand, as the migration says.
      await db.query(
        "delete from private.works_apart where $1 in (work_a, work_b)",
        [await workOf(NOTE1)],
      );
      assert.ok(
        (await listed()).includes(
          pair(await workOf(NOTE1), await workOf(chis)),
        ),
      );
    },
  );

  await check(
    "the tools refuse what they cannot do, and change nothing",
    async () => {
      const changes = await count("select count(*) from private.work_changes");
      const works = await count("select count(*) from works");
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
        () => rows("select private.undo_join($1)", [nobody]),
        /no join has that id/,
        "no join",
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
        () => rows("select private.part_books($1::uuid[])", [[WOOD1, NOTE1]]),
        /more than one work/,
        "two works",
      );
      await refused(
        () => rows("select private.part_books($1::uuid[])", [[WOOD1]]),
        /all the books of their work/,
        "the whole work",
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
      assert.equal(await count("select count(*) from works"), works);
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
      assert.match(rollback, /drop table public\.editions, public\.works/);
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
      assert.equal(await counted("select count(*) from works"), 8);
      assert.equal(await counted("select count(*) from editions"), 5);
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
        "update public.books k set work_id = e.work_id\n",
        "update public.books k set work_id = e.work_id, title = k.title || '！'\n",
      );
      assert.notEqual(spoiled, TEXT);
      let error: unknown = null;
      try {
        await earlier.exec(spoiled);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /the move changed 8 books/);
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
