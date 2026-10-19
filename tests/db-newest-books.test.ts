import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { databaseSearch } from "../src/lib/search/rank";
import {
  migratedDatabase,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// The town's newest books (AUD-158; supabase/migrations/*_newest_books_shown.sql):
// town_view's catalog passes by the books nobody may be shown a slice at a
// time (private.newest_book_ids), and still holds, for each reader, exactly
// the newest books their own select of the books table gives, in the same
// order: a visitor, the owner, a follower, a stranger and one who blocked
// the owner, among books seen (or not) each one way and thousands kept to
// a library, older and newer. Its time does not grow with how many kept
// books stand between the ones shown. Who may call it, and undoing the file.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_newest_books_shown.sql"));
assert.ok(FILE, "the newest books migration");
const WINDOW = FILES.find((file) => file.endsWith("_town_window.sql"));
assert.ok(WINDOW, "the town window migration");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAN = "00000000-0000-4000-8000-00000000000d";
const VISITORS = [null, AKI, BEN, CHI, DAN];
// A sample book (private.is_sample_book), which has no owner.
const SAMPLE = "4a72eed4-7258-4c4b-88ea-90dbc0c0e244";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Chi's books, each seen (or not) one way. Aki follows Chi; Dan blocked Chi.
const WAYS: [number, string][] = [
  [1, "なにもない"],
  [2, "自分だけの記録"],
  [3, "公開の記録"],
  [4, "フォロワーの記録"],
  [5, "ひとり読みの投稿"],
  [6, "ふつうの投稿"],
  [7, "下書きのポスター"],
  [8, "公開のポスター"],
  [9, "ひとりの読書"],
  [10, "一緒の読書"],
  [11, "人生の9冊"],
  [12, "開いた店の棚"],
  [13, "準備中の店の棚"],
  [14, "ライブラリ"],
  [15, "目録の本"],
];
const way = (n: number) => id(4, n);
const posterPages = (book: string) =>
  JSON.stringify([{ blocks: [{ type: "books", book_ids: [book] }] }]);
const shelves = (book: string) =>
  JSON.stringify([
    { id: "shelf-1", name: "棚", isPublic: true, items: [{ bookId: book }] },
  ]);

/**
 * The town: Chi's books, one a minute apart, newest first, between them
 * `kept` books typed in and kept to Ben's library, newest of all and in
 * between; samples and catalog books older than all.
 */
async function town(kept: number): Promise<PGlite> {
  const db = await migratedDatabase();
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAN}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'),
      ('${CHI}', 'chi', 'チー'), ('${DAN}', 'dan', 'ダン');
    insert into profile_follows (follower_id, followee_id) values ('${AKI}', '${CHI}');
    insert into blocks (blocker_id, blocked_id) values ('${DAN}', '${CHI}');
    insert into books (id, title, author, source, created_by, created_at) values
      ${WAYS.map(
        ([n, t]) =>
          `('${way(n)}', '灯台の本 ${t}', '灯野', ${
            n === 15 ? "'ndl', null" : `'manual', '${CHI}'`
          }, now() - interval '${n} minutes')`,
      ).join(",\n")};
    insert into books (id, title, author, source, created_by, created_at)
      select ('50000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
        '控えの本 ' || k, 'ベン', 'manual', '${BEN}',
        now() - (k % 17) * interval '1 minute' + interval '30 seconds'
      from generate_series(1, ${kept}) k;
    insert into books (id, title, author, source, created_by, created_at)
      select ('60000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
        '見本の本 ' || k, '見本', 'manual', null, now() - interval '1 day'
      from generate_series(1, 3) k;
    insert into library_entries (user_id, book_id, source)
      select '${BEN}', b.id, 'manual' from books b where b.created_by = '${BEN}';
    -- A sample book (the migrations' own) anyone may read: used in a post.
    insert into posts (author_id, body, book_id) values
      ('${CHI}', '見本を読んだ', '${SAMPLE}');
    insert into library_entries (user_id, book_id, source) values
      ('${CHI}', '${way(14)}', 'manual');
    insert into reading_entries (user_id, book_id, kind, is_public, audience) values
      ('${CHI}', '${way(2)}', 'finished', false, 'private'),
      ('${CHI}', '${way(3)}', 'finished', true, 'everyone'),
      ('${CHI}', '${way(4)}', 'finished', false, 'followers');
    insert into posts (author_id, body, book_id, reading_mode) values
      ('${CHI}', 'ひとり', '${way(5)}', 'solo'),
      ('${CHI}', 'みんな', '${way(6)}', null);
    insert into posters (author_id, template, pages, status) values
      ('${CHI}', 'one_book', '${posterPages(way(7))}', 'draft'),
      ('${CHI}', 'one_book', '${posterPages(way(8))}', 'published');
    insert into reading_sessions (user_id, book_id, mode, started_at, ended_at) values
      ('${CHI}', '${way(9)}', 'solo', now() - interval '2 days', now() - interval '1 day'),
      ('${CHI}', '${way(10)}', 'together', now() - interval '2 days', now() - interval '1 day');
    insert into profile_nine (profile_id, position, book_id, note) values
      ('${CHI}', 1, '${way(11)}', '最初の一冊');
    insert into shops (owner_id, name, is_open, public_shelves) values
      ('${CHI}', 'チーの店', true, '${shelves(way(12))}'),
      ('${AKI}', 'アキの準備中の店', false, '${shelves(way(13))}');
    analyze;
  `);
  return db;
}

async function as<T = Record<string, unknown>>(
  db: PGlite,
  visitor: string | null,
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

const BOOK = `id, isbn, title, author, publisher, price, source, work_id, created_at, updated_at`;

/** The catalog of the town the app asks for, as the visitor. */
async function catalog(db: PGlite, visitor: string | null, limit: number) {
  const [{ books }] = await as<{ books: unknown[] }>(
    db,
    visitor,
    `select town_view(post_limit => 0, catalog_limit => ${limit},
       record_notes => false, record_window => 0, others_nine => false) -> 'catalog' as books`,
  );
  return books;
}

/** The newest books the visitor's own select of the table gives. */
async function selected(db: PGlite, visitor: string | null, limit: number) {
  return (
    await as<{ row: unknown }>(
      db,
      visitor,
      `select to_jsonb(c) as row from (select ${BOOK} from books
         where source = 'manual'
         order by created_at desc, id desc limit ${Math.min(Math.max(limit, 0), 1000)}) c`,
    )
  ).map((row) => row.row);
}

/** The first comment's rollback statements, lines starting "--   ". */
function rollbackSql(): string {
  const text = migrationText(FILE!);
  return text
    .slice(0, text.indexOf("\n\n"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(5))
    .join("\n");
}

/** The create function public.town_view of the town window file. */
function windowTownView(): string {
  const text = migrationText(WINDOW!);
  const start = text.indexOf("\ncreate function public.town_view(\n") + 1;
  const end = text.indexOf("\n$$;", start) + 4;
  return text
    .slice(start, end)
    .replace("create function", "create or replace function");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await town(2100);

  await check(
    "each reader's newest books are the ones their own select gives, in order",
    async () => {
      for (const visitor of VISITORS)
        for (const limit of [0, 1, 2, 5, 12, 300, 5000]) {
          const shown = await catalog(db, visitor, limit);
          assert.deepEqual(
            shown,
            await selected(db, visitor, limit),
            `${visitor} ${limit}`,
          );
          if (limit === 300 && visitor !== BEN)
            assert.ok(
              !JSON.stringify(shown).includes("控えの本"),
              `${visitor} sees no book kept to Ben's library`,
            );
        }
      const titles = async (visitor: string | null) =>
        new Set(
          ((await catalog(db, visitor, 300)) as { title: string }[]).map(
            (book) => book.title.replace("灯台の本 ", ""),
          ),
        );
      const seen = await titles(null);
      for (const shown of ["公開の記録", "ふつうの投稿", "公開のポスター"])
        assert.ok(seen.has(shown), shown);
      for (const hidden of ["なにもない", "自分だけの記録", "準備中の店の棚"])
        assert.ok(!seen.has(hidden), hidden);
      assert.ok((await titles(AKI)).has("フォロワーの記録"));
      assert.ok((await titles(CHI)).has("なにもない"));
      assert.ok((await titles(BEN)).has("控えの本 1"));
      // A sample book used where anyone may see it, to a visitor too.
      assert.ok(seen.has("旅をする木"));
      assert.ok(!seen.has("見本の本 1"));
      // The library's catalog is not the town's (library_catalog).
      for (const visitor of VISITORS)
        assert.ok(!(await titles(visitor)).has("目録の本"), String(visitor));
    },
  );

  await check(
    "a visitor's search finds a sample book used where anyone may see it",
    async () => {
      const ask = databaseSearch("旅をする木")!;
      for (const visitor of VISITORS) {
        const [{ ids }] = await as<{ ids: string[] }>(
          db,
          visitor,
          "select coalesce(jsonb_agg(b -> 'id'), '[]') as ids from jsonb_array_elements(find_books($1::jsonb, null, null, 100)) b",
          [JSON.stringify(ask.forms)],
        );
        assert.ok(ids.includes(SAMPLE), String(visitor));
      }
    },
  );

  await check(
    "a book shown later, or no longer, is in the newest books as the table says",
    async () => {
      await db.exec(`
        insert into posts (author_id, body, book_id) values ('${CHI}', 'やっぱり', '${way(1)}');
        delete from reading_entries where book_id = '${way(3)}';
      `);
      for (const visitor of VISITORS)
        assert.deepEqual(
          await catalog(db, visitor, 300),
          await selected(db, visitor, 300),
          String(visitor),
        );
    },
  );

  await check(
    "only readers and visitors may call it, and it runs with an empty search path",
    async () => {
      const { rows } = await db.query<Record<string, unknown>>(
        `select p.prosecdef as definer, p.proconfig as config,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as authed,
           has_function_privilege('public', p.oid, 'execute') as everyone
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = 'newest_book_ids'`,
      );
      assert.deepEqual(rows, [
        {
          definer: true,
          config: ['search_path=""'],
          anon: true,
          authed: true,
          everyone: false,
        },
      ]);
      // What it answers is only what the reader may read.
      for (const visitor of VISITORS) {
        const [{ ids }] = await as<{ ids: string[] }>(
          db,
          visitor,
          "select private.newest_book_ids(5000) as ids",
        );
        const readable = (
          await as<{ id: string }>(
            db,
            visitor,
            "select id from books where source = 'manual' order by created_at desc, id desc",
          )
        ).map((row) => row.id);
        assert.deepEqual(ids, readable.slice(0, 1000), String(visitor));
      }
    },
  );

  await check(
    "its time does not grow with the kept books between the books shown",
    async () => {
      // Shown books one a minute; between each two, 8, 25 or 75 kept ones.
      const timed = async (between: number) => {
        const many = await migratedDatabase();
        await many.exec(`
          insert into auth.users (id) values ('${AKI}'), ('${BEN}');
          insert into profiles (id, handle, name) values
            ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
          insert into books (title, author, source, created_by, created_at)
            select 'アキの本 ' || k, 'アキ', 'manual', '${AKI}', now() - k * interval '1 minute'
            from generate_series(1, 320) k;
          insert into books (title, author, source, created_by, created_at)
            select '控えの本 ' || k, 'ベン', 'manual', '${BEN}',
              now() - (k / ${between}.0 + 0.5) * interval '1 minute'
            from generate_series(1, ${between * 320}) k;
          analyze;
        `);
        let best = Infinity;
        for (let round = 0; round < 3; round += 1) {
          const started = performance.now();
          const books = await catalog(many, AKI, 300);
          best = Math.min(best, performance.now() - started);
          assert.equal(books.length, 300);
        }
        await many.close();
        return best;
      };
      const few = await timed(8);
      const some = await timed(25);
      const most = await timed(75);
      console.log(
        `  the newest 300 books with 8, 25 and 75 kept books between each: ` +
          `${few.toFixed(0)}ms, ${some.toFixed(0)}ms, ${most.toFixed(0)}ms (PGlite)`,
      );
      assert.ok(
        most <= few * 3 + 100,
        `${most.toFixed(0)}ms with 75 kept books between, ${few.toFixed(0)}ms with 8`,
      );
    },
  );

  await check(
    "the rollback, as the header writes it, leaves town_view as before",
    async () => {
      // Before library_catalog the catalog's rows were in the newest books
      // too; with none, this file's rollback is seen alone.
      await db.exec("delete from books where source = 'ndl'");
      const before: Record<string, unknown[]> = {};
      for (const visitor of VISITORS)
        before[String(visitor)] = await catalog(db, visitor, 300);
      await db.exec(windowTownView());
      await db.exec(rollbackSql());
      const { rows } = await db.query(
        "select 1 from pg_proc where proname = 'newest_book_ids'",
      );
      assert.equal(rows.length, 0);
      for (const visitor of VISITORS)
        assert.deepEqual(
          await catalog(db, visitor, 300),
          before[String(visitor)],
          String(visitor),
        );
    },
  );

  console.log(`${passed} newest books checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
