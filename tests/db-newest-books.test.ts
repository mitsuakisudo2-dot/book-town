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
// The books named by a row but not seen (AUD-160;
// supabase/migrations/*_seen_in_one_question.sql) are asked about a slice
// at a time (private.seen_book_ids), and records for followers name their
// books only to followers: still each reader's own select, among hundreds
// of books in records for followers, 見本 used one way each, and uses
// hidden by the operator; and its time does not grow with the books in
// records for followers between the ones shown, to a visitor, a stranger
// or a follower.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_newest_books_shown.sql"));
assert.ok(FILE, "the newest books migration");
const WINDOW = FILES.find((file) => file.endsWith("_town_window.sql"));
assert.ok(WINDOW, "the town window migration");
const SEEN = FILES.find((file) => file.endsWith("_seen_in_one_question.sql"));
assert.ok(SEEN, "the seen in one question migration");
const BEFORE_SEEN = {
  candidates: FILES.find((file) =>
    file.endsWith("_sample_book_candidates.sql"),
  ),
  found: FILES.find((file) => file.endsWith("_search_candidates.sql")),
};
assert.ok(BEFORE_SEEN.candidates && BEFORE_SEEN.found);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAN = "00000000-0000-4000-8000-00000000000d";
const ERI = "00000000-0000-4000-8000-00000000000e";
const VISITORS = [null, AKI, BEN, CHI, DAN, ERI];
// A sample book (private.is_sample_book), which has no owner.
const SAMPLE = "4a72eed4-7258-4c4b-88ea-90dbc0c0e244";
// More of them, each used one way (AUD-160).
const SAMPLES = {
  takenOut: "b36e28bd-a2d0-461a-896a-b7e4e8d49943",
  marked: "b007fdc0-45e4-4ca7-8061-d6690582770e",
  backRoom: "e5fca121-85d5-43c3-8b2d-e04f7b04b2ad",
  shelved: "21c7ab23-acc9-421e-866a-8de4fb64e4d9",
  met: "117e8206-84e3-425c-85d4-9dfcb0496da6",
};
// Books in Chi's records for followers, between the others (AUD-160).
const FOLLOWED = 600;

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// A book whose owner left (created_by set null), not a 見本.
const ORPHAN = id(8, 1);

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
  [16, "隠した投稿"],
  // Eri's, whose profile the operator hid; Aki follows Eri.
  [17, "隠れた人のフォロワーの記録"],
  [18, "隠れた人の公開の記録"],
];
const owner = (n: number) =>
  n === 15 ? "'ndl', null" : `'manual', '${n >= 17 ? ERI : CHI}'`;
const way = (n: number) => id(4, n);
const posterPages = (book: string) =>
  JSON.stringify([{ blocks: [{ type: "books", book_ids: [book] }] }]);
const shelves = (...books: string[]) =>
  JSON.stringify([
    {
      id: "shelf-1",
      name: "棚",
      isPublic: true,
      items: books.map((bookId) => ({ bookId })),
    },
  ]);

// Chi's shop: an open shelf, and a back room only Chi reads.
const chiShelves = JSON.stringify([
  ...JSON.parse(shelves(way(12), SAMPLES.shelved)),
  {
    id: "shelf-2",
    name: "奥",
    isPublic: false,
    items: [{ bookId: SAMPLES.backRoom }],
  },
]);

/**
 * The town: Chi's books, one a minute apart, newest first, between them
 * `kept` books typed in and kept to Ben's library, newest of all and in
 * between; samples and catalog books older than all.
 */
async function town(kept: number): Promise<PGlite> {
  const db = await migratedDatabase();
  await db.exec(`
    insert into auth.users (id) values
      ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAN}'), ('${ERI}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'),
      ('${CHI}', 'chi', 'チー'), ('${DAN}', 'dan', 'ダン'), ('${ERI}', 'eri', 'エリ');
    insert into profile_follows (follower_id, followee_id) values
      ('${AKI}', '${CHI}'), ('${AKI}', '${ERI}');
    insert into blocks (blocker_id, blocked_id) values ('${DAN}', '${CHI}');
    -- Dan followed Chi before the block, and the follow stays (AUD-160):
    -- may_see still keeps Chi's records for followers from him.
    insert into profile_follows (follower_id, followee_id) values ('${DAN}', '${CHI}');
    -- A book whose owner left: no owner, not a 見本, used nowhere.
    insert into books (id, title, author, source, created_by, created_at) values
      ('${ORPHAN}', '持ち主の去った本', '誰か', 'manual', null, now());
    insert into books (id, title, author, source, created_by, created_at) values
      ${WAYS.map(
        ([n, t]) =>
          `('${way(n)}', '灯台の本 ${t}', '灯野', ${owner(n)}, now() - interval '${n} minutes')`,
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
      ('${CHI}', '${way(4)}', 'finished', false, 'followers'),
      ('${ERI}', '${way(17)}', 'finished', false, 'followers'),
      ('${ERI}', '${way(18)}', 'finished', true, 'everyone');
    insert into posts (author_id, body, book_id, reading_mode) values
      ('${CHI}', 'ひとり', '${way(5)}', 'solo'),
      ('${CHI}', 'みんな', '${way(6)}', null),
      ('${CHI}', '隠される', '${way(16)}', null);
    insert into moderation_hides (target_kind, target_id)
      select 'post', p.id from posts p where p.book_id = '${way(16)}'
      union all select 'profile', '${ERI}';
    -- Chi's records for followers, between Ben's kept books and the rest.
    insert into books (id, title, author, source, created_by, created_at)
      select ('70000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
        'フォロワーだけの本 ' || k, 'チー', 'manual', '${CHI}',
        now() - (k % 19) * interval '1 minute' + interval '10 seconds'
      from generate_series(1, ${FOLLOWED}) k;
    insert into reading_entries (user_id, book_id, kind, is_public, audience)
      select '${CHI}', b.id, 'finished', false, 'followers'
      from books b where b.title like 'フォロワーだけの本 %';
    -- 見本, each used one way.
    insert into library_entries (user_id, book_id, source, removed_at) values
      ('${AKI}', '${SAMPLES.takenOut}', 'manual', now());
    insert into book_marks (user_id, book_id, kind) values
      ('${AKI}', '${SAMPLES.marked}', 'wish');
    insert into book_encounters (id, user_id, book_id, kind, via) values
      (gen_random_uuid(), '${AKI}', '${SAMPLES.met}', 'want', 'book');
    insert into posters (author_id, template, pages, status) values
      ('${CHI}', 'one_book', '${posterPages(way(7))}', 'draft'),
      ('${CHI}', 'one_book', '${posterPages(way(8))}', 'published');
    insert into reading_sessions (user_id, book_id, mode, started_at, ended_at) values
      ('${CHI}', '${way(9)}', 'solo', now() - interval '2 days', now() - interval '1 day'),
      ('${CHI}', '${way(10)}', 'together', now() - interval '2 days', now() - interval '1 day');
    insert into profile_nine (profile_id, position, book_id, note) values
      ('${CHI}', 1, '${way(11)}', '最初の一冊');
    insert into shops (owner_id, name, is_open, public_shelves) values
      ('${CHI}', 'チーの店', true, '${shelves(way(12), SAMPLES.shelved)}'),
      ('${AKI}', 'アキの準備中の店', false, '${shelves(way(13))}');
    -- The back room of Chi's shop: only Chi reads it.
    -- The whole of Chi's shop, as the app saves it; the public shelf is
    -- copied to the shop by the database.
    insert into shop_private (shop_id, shelves)
      select s.id, '${chiShelves}' from shops s where s.owner_id = '${CHI}'
    on conflict (shop_id) do update set shelves = excluded.shelves;
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

/** A function of a migration, from its create to its $$;, to create again. */
function functionOf(file: string, start: string): string {
  const text = migrationText(file);
  const at = text.indexOf(start);
  assert.ok(at >= 0, start);
  return text
    .slice(at, text.indexOf("$$;", at) + 3)
    .replace(/^create function/, "create or replace function");
}

/** The ids of what the visitor's search for `query` gives. */
async function found(db: PGlite, visitor: string | null, query: string) {
  const [{ ids }] = await as<{ ids: string[] }>(
    db,
    visitor,
    "select coalesce(jsonb_agg(b -> 'id'), '[]') as ids from jsonb_array_elements(find_books($1::jsonb, null, null, 100)) b",
    [JSON.stringify(databaseSearch(query)!.forms)],
  );
  return ids;
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
      for (const shown of [
        "公開の記録",
        "ふつうの投稿",
        "公開のポスター",
        "開いた店の棚",
      ])
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
    "books named but not seen are each reader's own select, one way at a time",
    async () => {
      const newest = async (visitor: string | null) =>
        new Set(
          (
            await as<{ ids: string[] }>(
              db,
              visitor,
              "select private.newest_book_ids(1000) as ids",
            )
          )[0].ids,
        );
      const followed = id(7, 1);
      const sees = {
        visitor: await newest(null),
        aki: await newest(AKI),
        ben: await newest(BEN),
        chi: await newest(CHI),
        dan: await newest(DAN),
        eri: await newest(ERI),
      };
      // A record for followers: its owner and a follower, nobody else.
      for (const [who, seen] of Object.entries(sees))
        assert.equal(
          seen.has(followed),
          who === "aki" || who === "chi",
          `${who}: a book in a record for followers`,
        );
      assert.ok(sees.aki.has(way(4)) && !sees.ben.has(way(4)));
      // Hidden by the operator: a post, and Eri, records and all.
      for (const [who, seen] of Object.entries(sees)) {
        assert.equal(seen.has(way(16)), who === "chi", `${who}: a hidden post`);
        for (const n of [17, 18])
          assert.equal(seen.has(way(n)), who === "eri", `${who}: ${n}`);
      }
      for (const [who, seen] of Object.entries(sees))
        assert.ok(!seen.has(ORPHAN), `${who}: a book whose owner left`);
      // 見本, each used one way.
      for (const [who, seen] of Object.entries(sees)) {
        assert.ok(seen.has(SAMPLES.shelved), `${who}: on an open shop's shelf`);
        assert.ok(!seen.has(SAMPLES.takenOut), `${who}: taken out`);
        assert.equal(seen.has(SAMPLES.marked), who === "aki", `${who}: marked`);
        assert.equal(seen.has(SAMPLES.met), who === "aki", `${who}: met`);
        assert.equal(
          seen.has(SAMPLES.backRoom),
          who === "chi",
          `${who}: in the back room`,
        );
      }
    },
  );

  await check(
    "seen_book_ids gives the books each reader's select gives, all at once",
    async () => {
      const all = (
        await db.query<{ id: string }>("select id from books")
      ).rows.map((row) => row.id);
      await db.exec(
        "begin; grant execute on function private.seen_book_ids(uuid[]) to anon, authenticated;",
      );
      try {
        for (const visitor of VISITORS) {
          const seen = (
            await as<{ id: string }>(
              db,
              visitor,
              "select s.id from private.seen_book_ids($1::uuid[]) s(id)",
              [all],
            )
          ).map((row) => row.id);
          const readable = (
            await as<{ id: string }>(db, visitor, "select id from books")
          ).map((row) => row.id);
          assert.deepEqual(seen.sort(), readable.sort(), String(visitor));
          assert.equal(new Set(seen).size, seen.length, "each once");
        }
      } finally {
        await db.exec("rollback");
      }
    },
  );

  await check(
    "seen_book_ids looks in every table the books' policy looks in",
    async () => {
      const tables = async (name: string) => {
        const { rows } = await db.query<{ src: string }>(
          `select p.prosrc as src from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = $1`,
          [name],
        );
        assert.equal(rows.length, 1, name);
        return new Set(rows[0].src.match(/public\.\w+/g));
      };
      const seen = await tables("seen_book_ids");
      for (const name of ["book_is_listed", "book_is_mine", "book_is_shared"])
        for (const table of await tables(name))
          assert.ok(seen.has(table), `${name} looks in ${table}`);
      // And the policy asks nothing else.
      const { rows } = await db.query<{ qual: string }>(
        `select qual from pg_policies
         where tablename = 'books' and policyname = 'books are seen where they are used'`,
      );
      assert.equal(
        rows[0].qual.replace(/\s+/g, " "),
        "((source <> 'manual'::text) OR (created_by = ( SELECT auth.uid() AS uid)) OR private.book_is_listed(id) OR private.book_is_mine(id) OR private.book_is_shared(id))",
      );
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
          insert into auth.users (id) values ('${BEN}'), ('${DAN}');
          insert into profiles (id, handle, name) values
            ('${BEN}', 'ben', 'ベン'), ('${DAN}', 'dan', 'ダン');
          -- Shown to everyone: Dan's books, each in a post of his (the
          -- library's catalog is not in the newest books, library_catalog).
          insert into books (title, author, source, created_by, created_at)
            select '公開の本 ' || k, '著者', 'manual', '${DAN}', now() - k * interval '1 minute'
            from generate_series(1, 320) k;
          insert into posts (author_id, body, book_id)
            select '${DAN}', '読んだ', b.id from books b where b.created_by = '${DAN}';
          insert into books (title, author, source, created_by, created_at)
            select '控えの本 ' || k, 'ベン', 'manual', '${BEN}',
              now() - (k / ${between}.0 + 0.5) * interval '1 minute'
            from generate_series(1, ${between * 320}) k;
          analyze;
        `);
        let best = Infinity;
        for (let round = 0; round < 3; round += 1) {
          const started = performance.now();
          const books = await catalog(many, null, 300);
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
    "its time does not grow with the books in records for followers between",
    async () => {
      // Shown books one a minute; between each two, 8 or 75 of Chi's books,
      // each in a record for followers. Aki follows Chi; Ben does not.
      const timed = async (between: number) => {
        const many = await migratedDatabase();
        await many.exec(`
          insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAN}');
          insert into profiles (id, handle, name) values
            ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー'),
            ('${DAN}', 'dan', 'ダン');
          insert into profile_follows (follower_id, followee_id) values ('${AKI}', '${CHI}');
          -- Shown to everyone: Dan's books, each in a post of his (the
          -- library's catalog is not in the newest books, library_catalog).
          insert into books (title, author, source, created_by, created_at)
            select '公開の本 ' || k, '著者', 'manual', '${DAN}', now() - k * interval '1 minute'
            from generate_series(1, 320) k;
          insert into posts (author_id, body, book_id)
            select '${DAN}', '読んだ', b.id from books b where b.created_by = '${DAN}';
          insert into books (title, author, source, created_by, created_at)
            select '灯の本 ' || k, 'チー', 'manual', '${CHI}',
              now() - (k / ${between}.0 + 0.5) * interval '1 minute'
            from generate_series(1, ${between * 320}) k;
          insert into reading_entries (user_id, book_id, kind, is_public, audience)
            select '${CHI}', b.id, 'finished', false, 'followers'
            from books b where b.created_by = '${CHI}';
          analyze;
        `);
        const best: Record<string, number> = {};
        for (const [who, visitor] of [
          ["visitor", null],
          ["stranger", BEN],
          ["follower", AKI],
        ] as const) {
          best[who] = Infinity;
          for (let round = 0; round < 3; round += 1) {
            const started = performance.now();
            const books = await catalog(many, visitor, 300);
            best[who] = Math.min(best[who], performance.now() - started);
            assert.equal(books.length, 300);
          }
          best[`${who} search`] = Infinity;
          for (let round = 0; round < 3; round += 1) {
            const started = performance.now();
            const ids = await found(many, visitor, "本");
            best[`${who} search`] = Math.min(
              best[`${who} search`],
              performance.now() - started,
            );
            assert.equal(ids.length, 100);
          }
        }
        await many.close();
        return best;
      };
      const few = await timed(8);
      const most = await timed(75);
      for (const what of Object.keys(few)) {
        console.log(
          `  ${what}, 8 and 75 books in records for followers between each: ` +
            `${few[what].toFixed(0)}ms, ${most[what].toFixed(0)}ms (PGlite)`,
        );
        // 75 between is about nine times as many books as 8, and cutting
        // them newest first and looking for rows that name them grows with
        // them; a follower's search also orders the near titles of all of
        // them. What is asked of the policy does not grow: before, a
        // visitor's town took seconds here. Loose, for slower machines.
        const bound =
          what === "follower search"
            ? few[what] * 12 + 600
            : few[what] * 6 + 400;
        assert.ok(
          most[what] <= bound,
          `${what}: ${most[what].toFixed(0)}ms with 75 between, ${few[what].toFixed(0)}ms with 8`,
        );
      }
    },
  );

  await check(
    "undone, the seen file leaves lists and searches as they were",
    async () => {
      // Before library_catalog the catalog's rows were in the newest books
      // too; with none, this file's rollback is seen alone. Its search weighs
      // at most 2,000 near titles (more than that hold a pair here), and its
      // rollback puts this file's back first.
      await db.exec("delete from books where source = 'ndl'");
      await db.exec(
        functionOf(SEEN!, "create or replace function private.found_book_ids("),
      );
      const queries = ["灯台の本", "フォロワーだけの本", "旅をする木"];
      const answers = async () => {
        const all: unknown[] = [];
        for (const visitor of VISITORS) {
          all.push(await catalog(db, visitor, 300));
          for (const query of queries)
            all.push(await found(db, visitor, query));
        }
        return all;
      };
      const before = await answers();
      await db.exec(
        functionOf(
          BEFORE_SEEN.candidates!,
          "create or replace function private.search_candidates(",
        ),
      );
      await db.exec(
        functionOf(FILE!, "create function private.newest_book_ids("),
      );
      await db.exec(
        functionOf(
          BEFORE_SEEN.found!,
          "create or replace function private.found_book_ids(",
        ),
      );
      const text = migrationText(SEEN!);
      await db.exec(
        text
          .slice(0, text.indexOf("\n\n", text.indexOf("-- Rollback:")))
          .split("\n")
          .filter((line) => line.startsWith("--   drop "))
          .map((line) => line.slice(5))
          .join("\n"),
      );
      const { rows } = await db.query(
        "select 1 from pg_proc where proname in ('seen_book_ids', 'keep_seen_books')",
      );
      assert.equal(rows.length, 0);
      assert.deepEqual(await answers(), before);
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
