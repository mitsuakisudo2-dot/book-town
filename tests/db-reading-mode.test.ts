import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  clearOfJapanMidnight,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// 読書管理モードの土台 (item 98, supabase/migrations/*_reading_mode.sql). The
// design is 読書管理モード_基本設計_2026-10-18, decided by けにーさん: the mode
// is the reader's own setting and switching it changes nothing else; a
// reader without a public profile is found nowhere; in manage mode the
// database takes no new write that reaches people, and never refuses one
// that takes something back; a book's status counts only as normal mode
// last showed it, and never when it came in in manage mode (the table of
// cases in its section 4); terms are agreed to by version.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_reading_mode.sql"));
assert.ok(FILE, "the reading mode migration");
const LABEL = FILE.replace(/\.sql$/, "");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a"; // a reader of the town
const BEN = "00000000-0000-4000-8000-00000000000b"; // switches to manage mode
const CHI = "00000000-0000-4000-8000-00000000000c"; // no public profile
const DAI = "00000000-0000-4000-8000-00000000000d"; // looks on

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// One work in two editions, and other works, each its own book typed in by
// whoever keeps it (a reader's rows name their own books only).
const WORK_BOOKS = { aki: id(1, 1), benA: id(1, 2), benB: id(1, 3) };
const book = (n: number) => id(2, n);

const PAGES = JSON.stringify([{ blocks: [{ type: "text", text: "ことば" }] }]);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${DAI}', 'dai', 'ダイ');
`;

type Visitor = string | null;

async function migrated(upTo?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => !upTo || file < upTo))
    await db.exec(migrationText(file));
  await db.exec(SEED);
  return db;
}

function helpers(db: PGlite) {
  const rows = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => (await db.query<T>(sql, params)).rows;
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
  /** The error a request is refused with, or a failure if it is taken. */
  async function refused(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
    what = sql,
  ): Promise<{ code?: string; hint?: string; message: string }> {
    try {
      await as(visitor, sql, params);
    } catch (error) {
      return error as { code?: string; hint?: string; message: string };
    }
    assert.fail("expected a refusal: " + what);
  }
  const mode = (reader: string, to: "normal" | "manage") =>
    as(
      reader,
      `insert into reader_settings (user_id, mode) values ($1, $2)
       on conflict (user_id) do update set mode = excluded.mode`,
      [reader, to],
    );
  /** A book typed in by its reader. */
  const typed = (reader: string, bookId: string, title = "本") =>
    as(
      reader,
      `insert into books (id, title, author, source, created_by)
       values ($1, $2, '著者', 'manual', $3)`,
      [bookId, title, reader],
    );
  const keep = (reader: string, bookId: string, status: string | null) =>
    as(
      reader,
      `insert into library_entries (user_id, book_id, status, status_at, source)
       values ($1, $2, $3, case when $3::text is not null then now() end, 'manual')`,
      [reader, bookId, status],
    );
  const setStatus = (reader: string, bookId: string, status: string | null) =>
    as(
      reader,
      "update library_entries set status = $3, status_at = now() where user_id = $1 and book_id = $2",
      [reader, bookId, status],
    );
  const counted = async (reader: string, bookId: string) =>
    (
      await rows<{ status: string | null; wanted: boolean }>(
        `select c.status, c.wanted from library_entries e,
           lateral private.status_counted(e) c
         where e.user_id = $1 and e.book_id = $2`,
        [reader, bookId],
      )
    )[0];
  return { rows, as, refused, mode, typed, keep, setStatus, counted };
}

/** Every row of every table in public, as text, by table. */
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
        `select to_jsonb(t)::text as row from ${name} t order by 1`,
      )
    ).rows.map((row) => row.row);
  return all;
}

/**
 * Everything a migration makes or changes in public and private, by name. A
 * function's text is compared without its spacing: the rollback writes
 * is_hidden again from a comment.
 */
async function catalog(db: PGlite) {
  return (
    await db.query<{ kind: string; name: string; detail: string }>(
      `select 'function' as kind, p.oid::regprocedure::text as name,
              md5(btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g'))) || ' ' || coalesce(p.proacl::text, '') as detail
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
                || ' ' || a.attnotnull::text
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
         and a.attnum > 0 and not a.attisdropped
       union all
       select 'constraint', c.conrelid::regclass::text || ' ' || c.conname,
              pg_get_constraintdef(c.oid)
       from pg_constraint c
       where c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
       union all
       select 'policy', c.oid::regclass::text || ' ' || p.polname,
              p.polcmd::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
                || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
       from pg_policy p join pg_class c on c.oid = p.polrelid
       union all
       select 'trigger', t.tgrelid::regclass::text || ' ' || t.tgname,
              pg_get_triggerdef(t.oid)
       from pg_trigger t where not t.tgisinternal
       order by 1, 2`,
    )
  ).rows;
}

let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  // The table of cases (基本設計 4) --------------------------------------------------------

  await check(
    "a book's status counts as the table of cases says, and each person once a work",
    async () => {
      const db = await migrated();
      const { rows, as, mode, typed, keep, setStatus, counted } = helpers(db);
      for (let n = 1; n <= 6; n += 1) await typed(BEN, book(n));

      // 通常 → 通常: counted.
      await keep(BEN, book(1), "reading");
      await setStatus(BEN, book(1), "finished");
      assert.deepEqual(await counted(BEN, book(1)), {
        status: "finished",
        wanted: false,
      });
      // 通常 → 通常, then 自分だけ by hand: out at once.
      await keep(BEN, book(5), "finished");
      await as(
        BEN,
        "update library_entries set audience = 'private' where book_id = $1",
        [book(5)],
      );
      assert.equal((await counted(BEN, book(5))).status, null);
      // 通常 → 管理: what normal mode showed, whatever manage mode does.
      await keep(BEN, book(6), "reading");
      await as(
        BEN,
        "update library_entries set wanted_at = now() where book_id = $1",
        [book(6)],
      );
      await mode(BEN, "manage");
      await setStatus(BEN, book(6), "finished");
      await as(
        BEN,
        "update library_entries set wanted_at = null where book_id = $1",
        [book(6)],
      );
      await setStatus(BEN, book(6), null);
      await setStatus(BEN, book(6), "tsundoku");
      assert.deepEqual(await counted(BEN, book(6)), {
        status: "reading",
        wanted: true,
      });
      // 管理 → 管理: never.
      await keep(BEN, book(2), "finished");
      await keep(BEN, book(4), null);
      assert.equal((await counted(BEN, book(2))).status, null);
      // 管理 → 通常: never.
      await keep(BEN, book(3), "reading");
      await mode(BEN, "normal");
      await setStatus(BEN, book(3), "finished");
      assert.equal((await counted(BEN, book(3))).status, null);
      // 管理, then made public by hand: still never; it is seen, not counted.
      await as(
        BEN,
        "update library_entries set audience = 'everyone', detail = 'content', status = 'finished' where book_id = $1",
        [book(4)],
      );
      assert.equal((await counted(BEN, book(4))).status, null);
      // Back in normal mode, a change shows again: 通常 then 管理 then 通常.
      // The book as it is now, 読みたい taken off in manage mode too.
      await setStatus(BEN, book(6), "finished");
      assert.deepEqual(await counted(BEN, book(6)), {
        status: "finished",
        wanted: false,
      });
      // The rows made in manage mode say so, the others say normal.
      assert.deepEqual(
        (
          await rows<{ book_id: string; added_mode: string }>(
            "select book_id, added_mode from library_entries order by book_id",
          )
        ).map((row) => row.added_mode),
        ["normal", "manage", "manage", "manage", "normal", "normal"],
      );

      // Each person once a work: Ben keeps two editions of one work, one
      // reading and one finished; Aki one; Chi none (no public profile).
      const [work] = await rows<{ work_id: string }>(
        "select work_id from books where id = $1",
        [book(1)],
      );
      await rows("update books set work_id = $1 where id = any($2::uuid[])", [
        work.work_id,
        [book(5), book(6)],
      ]);
      await typed(AKI, WORK_BOOKS.aki);
      await rows("update books set work_id = $1 where id = $2", [
        work.work_id,
        WORK_BOOKS.aki,
      ]);
      await keep(AKI, WORK_BOOKS.aki, "reading");
      // Book 5 is private now; book 6 shows finished; book 1 finished.
      assert.deepEqual(
        await rows(
          "select wanted, reading, finished from private.reading_counts($1::uuid[])",
          [[work.work_id]],
        ),
        [{ wanted: 0, reading: 1, finished: 1 }],
      );
      // A block does not move it; the operator hiding a person does.
      await as(
        DAI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [DAI, BEN],
      );
      assert.equal(
        (
          await rows<{ finished: number }>(
            "select finished from private.reading_counts($1::uuid[])",
            [[work.work_id]],
          )
        )[0].finished,
        1,
      );
      await rows(
        "insert into moderation_hides (target_kind, target_id) values ('profile', $1)",
        [BEN],
      );
      assert.deepEqual(
        await rows(
          "select wanted, reading, finished from private.reading_counts($1::uuid[])",
          [[work.work_id]],
        ),
        [{ wanted: 0, reading: 1, finished: 0 }],
      );
      // Nobody reads the rule or the counts but the database.
      for (const visitor of [null, AKI]) {
        const error = await helpers(db).refused(
          visitor,
          "select * from private.reading_counts($1::uuid[])",
          [[work.work_id]],
        );
        assert.equal(error.code, "42501");
      }
      await db.close();
    },
  );

  await check(
    "a book taken out in manage mode is out at once; brought back, it shows nothing",
    async () => {
      const db = await migrated();
      const { as, mode, typed, keep, counted } = helpers(db);
      await typed(BEN, book(1));
      await keep(BEN, book(1), "reading");
      await mode(BEN, "manage");
      await as(
        BEN,
        "update library_entries set removed_at = now() where book_id = $1",
        [book(1)],
      );
      assert.equal((await counted(BEN, book(1))).status, null);
      await as(
        BEN,
        "update library_entries set removed_at = null, status = 'finished' where book_id = $1",
        [book(1)],
      );
      assert.deepEqual(await counted(BEN, book(1)), {
        status: null,
        wanted: false,
      });
      await mode(BEN, "normal");
      await as(
        BEN,
        "update library_entries set status = 'reading' where book_id = $1",
        [book(1)],
      );
      assert.equal((await counted(BEN, book(1))).status, "reading");
      await db.close();
    },
  );

  await check(
    "a book's audience starts from the starting choice, narrows with it, and the database's columns are its own",
    async () => {
      const db = await migrated();
      const { rows, as, refused, typed, keep } = helpers(db);
      await typed(AKI, book(1));
      await typed(AKI, book(2));
      await keep(AKI, book(1), "reading");
      assert.deepEqual(
        await rows(
          "select audience, detail from library_entries where book_id = $1",
          [book(1)],
        ),
        [{ audience: "everyone", detail: "count" }],
      );
      await as(
        AKI,
        "insert into reader_settings (user_id, status_audience, status_detail) values ($1, 'everyone', 'content')",
        [AKI],
      );
      await keep(AKI, book(2), "reading");
      assert.deepEqual(
        await rows(
          "select audience, detail from library_entries where book_id = $1",
          [book(2)],
        ),
        [{ audience: "everyone", detail: "content" }],
      );
      // 自分だけ narrows both; widening back widens neither.
      await as(
        AKI,
        "update reader_settings set status_audience = 'private' where user_id = $1",
        [AKI],
      );
      await as(
        AKI,
        "update reader_settings set status_audience = 'everyone' where user_id = $1",
        [AKI],
      );
      assert.deepEqual(
        (
          await rows<{ audience: string }>(
            "select audience from library_entries",
          )
        ).map((row) => row.audience),
        ["private", "private"],
      );
      for (const column of [
        "added_mode = 'manage'",
        "status_held = true",
        "shown_status = 'finished'",
      ]) {
        const error = await refused(
          AKI,
          `update library_entries set ${column} where user_id = $1`,
          [AKI],
        );
        assert.equal(error.code, "42501", column);
      }
      await db.close();
    },
  );

  // Switching changes nothing else ------------------------------------------------------------

  await check(
    "switching back and forth many times changes no record, shelf, statistic or audience",
    async () => {
      const db = await migrated();
      const { as, mode, typed, keep } = helpers(db);
      await typed(BEN, book(1));
      await typed(BEN, book(2));
      await keep(BEN, book(1), "reading");
      await keep(BEN, book(2), "finished");
      await as(
        BEN,
        "insert into reading_entries (user_id, book_id, audience, body) values ($1, $2, 'everyone', 'よかった')",
        [BEN, book(2)],
      );
      await as(
        BEN,
        "insert into library_shelves (id, user_id, name, position, audience) values ($1, $2, '旅', 'a', 'everyone')",
        [id(3, 1), BEN],
      );
      await as(
        BEN,
        "insert into reading_sessions (user_id, book_id, mode, ended_at) values ($1, $2, 'solo', now())",
        [BEN, book(1)],
      );
      await mode(BEN, "normal");
      const before = await everyRow(db);
      for (let n = 0; n < 7; n += 1) {
        await mode(BEN, "manage");
        await mode(BEN, "normal");
      }
      const after = await everyRow(db);
      const settings = (all: Record<string, string[]>) =>
        all["public.reader_settings"].map((row) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { updated_at: _, ...rest } = JSON.parse(row);
          return rest;
        });
      assert.deepEqual(settings(after), settings(before));
      delete before["public.reader_settings"];
      delete after["public.reader_settings"];
      assert.deepEqual(after, before);
      await db.close();
    },
  );

  // What manage mode refuses, and what it never does ----------------------------------------

  await check(
    "in manage mode the database refuses every new write that reaches people, and says why",
    async () => {
      const db = await migrated();
      const { rows, as, refused, mode, typed } = helpers(db);
      await typed(AKI, book(1));
      await typed(BEN, book(2));
      const [post] = await as<{ id: string }>(
        AKI,
        "insert into posts (author_id, body) values ($1, 'アキの便り') returning id",
        [AKI],
      );
      const [shop] = await as<{ id: string }>(
        AKI,
        "insert into shops (owner_id, name, is_open) values ($1, 'アキの本屋', true) returning id",
        [AKI],
      );
      const [benShop] = await as<{ id: string }>(
        BEN,
        "insert into shops (owner_id, name, is_open) values ($1, 'ベンの本屋', true) returning id",
        [BEN],
      );
      await as(
        BEN,
        `insert into shop_private (shop_id, shelves) values ($1,
         '[{"id":"s1","name":"旅","isPublic":true}]')`,
        [benShop.id],
      );
      const [poster] = await as<{ id: string }>(
        BEN,
        "insert into posters (author_id, template, pages) values ($1, 'text', $2) returning id",
        [BEN, JSON.stringify([{ blocks: [{ type: "text", text: "ベンの" }] }])],
      );
      const [record] = await as<{ id: string }>(
        BEN,
        "insert into reading_entries (user_id, book_id) values ($1, $2) returning id",
        [BEN, book(2)],
      );
      await as(
        BEN,
        "insert into library_shelves (id, user_id, name, position) values ($1, $2, '旅', 'a')",
        [id(3, 1), BEN],
      );
      await as(
        BEN,
        "insert into library_entries (user_id, book_id, source) values ($1, $2, 'manual')",
        [BEN, book(2)],
      );
      await as(
        BEN,
        "update library_entries set audience = 'private' where book_id = $1",
        [book(2)],
      );
      const [solo] = await as<{ id: string }>(
        BEN,
        "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'solo') returning id",
        [BEN, book(2)],
      );
      await mode(BEN, "manage");
      const before = await everyRow(db);

      const reaching: [string, string, unknown[]][] = [
        [
          "a 便り",
          "insert into posts (author_id, body) values ($1, '便り')",
          [BEN],
        ],
        [
          "a reply",
          "insert into posts (author_id, body, parent_id) values ($1, '返信', $2)",
          [BEN, post.id],
        ],
        [
          "a 一緒に読む memo",
          "insert into posts (author_id, body, reading_mode) values ($1, 'メモ', 'together')",
          [BEN],
        ],
        [
          "a like",
          "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like')",
          [BEN, post.id],
        ],
        [
          "読みたくなった",
          "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'want')",
          [BEN, post.id],
        ],
        [
          "a reaction to a POP",
          "insert into pop_reactions (user_id, shop_id, placement_key, reaction) values ($1, $2, 'p1', 'love')",
          [BEN, shop.id],
        ],
        [
          "following a person",
          "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
          [BEN, AKI],
        ],
        [
          "following a shop",
          "insert into shop_follows (follower_id, shop_id) values ($1, $2)",
          [BEN, shop.id],
        ],
        [
          "a like of a shop",
          "insert into shop_reactions (user_id, shop_id, liked) values ($1, $2, true)",
          [BEN, shop.id],
        ],
        [
          "a ひとこと",
          "insert into shop_reactions (user_id, shop_id, message) values ($1, $2, 'すてき')",
          [BEN, shop.id],
        ],
        [
          "opening a shop",
          "insert into shops (owner_id, name, is_open) values ($1, '新しい本屋', true)",
          [BEN],
        ],
        [
          "a public shelf more, in an open shop",
          `update shop_private set shelves = '[{"id":"s1","name":"旅","isPublic":true},{"id":"s2","name":"夜","isPublic":true}]' where shop_id = $1`,
          [benShop.id],
        ],
        [
          "the open shop's name",
          "update shops set name = '別の名前' where id = $1",
          [benShop.id],
        ],
        [
          "putting up a poster",
          "insert into posters (author_id, template, pages) values ($1, 'text', $2)",
          [BEN, PAGES],
        ],
        [
          "changing a poster that is up",
          "update posters set theme = 'navy' where id = $1",
          [poster.id],
        ],
        [
          "reading together",
          "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together')",
          [BEN, book(2)],
        ],
        [
          "reading alone made reading together",
          "update reading_sessions set mode = 'together' where id = $1",
          [solo.id],
        ],
        [
          "a record made public",
          "update reading_entries set audience = 'everyone' where id = $1",
          [record.id],
        ],
        [
          "a record made public by an old app",
          "update reading_entries set is_public = true where id = $1",
          [record.id],
        ],
        [
          "a shelf made public",
          "update library_shelves set audience = 'everyone' where id = $1",
          [id(3, 1)],
        ],
        [
          "a book's status shown as a number",
          "update library_entries set audience = 'everyone' where book_id = $1",
          [book(2)],
        ],
      ];
      for (const [what, sql, params] of reaching) {
        const error = await refused(BEN, sql, params, what);
        assert.equal(error.code, "42501", what);
        assert.equal(error.hint, "booktown:reading_mode", what);
        assert.doesNotMatch(error.message, /ベン|旅|すてき|便り/, what);
      }
      // Nothing it refused changed a row.
      assert.deepEqual(await everyRow(db), before);

      // What manage mode makes is its reader's alone, whatever the app sent.
      await as(
        BEN,
        "insert into reading_entries (user_id, book_id, audience) values ($1, $2, 'everyone')",
        [BEN, book(2)],
      );
      await as(
        BEN,
        "insert into reading_entries (user_id, book_id, is_public) values ($1, $2, true)",
        [BEN, book(2)],
      );
      await as(
        BEN,
        "insert into library_shelves (id, user_id, name, position, audience) values ($1, $2, '秘密', 'b', 'everyone')",
        [id(3, 2), BEN],
      );
      assert.deepEqual(
        await rows(
          `select audience, is_public,
                  exists (select from private.records_made_in_manage m
                          where m.entry_id = e.id) as in_manage
           from reading_entries e order by created_at`,
        ),
        [
          { audience: "private", is_public: false, in_manage: false },
          { audience: "private", is_public: false, in_manage: true },
          { audience: "private", is_public: false, in_manage: true },
        ],
      );
      // Nobody reads which mode a record or a reading was made in.
      for (const table of [
        "private.records_made_in_manage",
        "private.readings_made_in_manage",
      ]) {
        const error = await refused(BEN, `select * from ${table}`);
        assert.equal(error.code, "42501", table);
      }
      for (const table of ["reading_entries", "reading_sessions"])
        assert.equal(
          (
            await rows(
              `select from information_schema.columns
               where table_schema = 'public' and table_name = $1
                 and column_name like '%mode%' and column_name <> 'mode'`,
              [table],
            )
          ).length,
          0,
          table,
        );
      assert.deepEqual(
        await rows(
          "select audience, made_mode from library_shelves where id = $1",
          [id(3, 2)],
        ),
        [{ audience: "private", made_mode: "manage" }],
      );
      await db.close();
    },
  );

  await check(
    "manage mode never refuses taking things back: deleting, narrowing, closing, unfollowing, blocking, reporting, leaving",
    async () => {
      const db = await migrated();
      const { rows, as, mode, typed } = helpers(db);
      await typed(BEN, book(2));
      const [post] = await as<{ id: string }>(
        AKI,
        "insert into posts (author_id, body) values ($1, 'アキの便り') returning id",
        [AKI],
      );
      const [benPost] = await as<{ id: string }>(
        BEN,
        "insert into posts (author_id, body, book_id) values ($1, 'ベンの便り', $2) returning id",
        [BEN, book(2)],
      );
      const [shop] = await as<{ id: string }>(
        AKI,
        "insert into shops (owner_id, name, is_open) values ($1, 'アキの本屋', true) returning id",
        [AKI],
      );
      const [benShop] = await as<{ id: string }>(
        BEN,
        "insert into shops (owner_id, name, is_open) values ($1, 'ベンの本屋', true) returning id",
        [BEN],
      );
      const [poster] = await as<{ id: string }>(
        BEN,
        "insert into posters (author_id, template, pages) values ($1, 'text', $2) returning id",
        [BEN, PAGES],
      );
      await as(
        BEN,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [BEN, AKI],
      );
      await as(
        BEN,
        "insert into shop_follows (follower_id, shop_id) values ($1, $2)",
        [BEN, shop.id],
      );
      await as(
        BEN,
        "insert into shop_reactions (user_id, shop_id, liked, message) values ($1, $2, true, 'すてき')",
        [BEN, shop.id],
      );
      await as(
        BEN,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like')",
        [BEN, post.id],
      );
      const [record] = await as<{ id: string }>(
        BEN,
        "insert into reading_entries (user_id, book_id, audience) values ($1, $2, 'everyone') returning id",
        [BEN, book(2)],
      );
      const [together] = await as<{ id: string }>(
        BEN,
        "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together') returning id",
        [BEN, book(2)],
      );
      await mode(BEN, "manage");

      for (const [sql, params] of [
        [
          "insert into posts (author_id, body, reading_mode) values ($1, 'ひとりメモ', 'solo')",
          [BEN],
        ],
        ["update posts set spoiler = true where id = $1", [benPost.id]],
        ["delete from posts where id = $1", [benPost.id]],
        ["delete from post_reactions where user_id = $1", [BEN]],
        [
          "update shop_reactions set liked = false, message = '' where user_id = $1",
          [BEN],
        ],
        ["delete from shop_reactions where user_id = $1", [BEN]],
        ["delete from profile_follows where follower_id = $1", [BEN]],
        ["delete from shop_follows where follower_id = $1", [BEN]],
        [
          "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
          [BEN, DAI],
        ],
        ["delete from blocks where blocker_id = $1", [BEN]],
        [
          "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'post', $2, 'spam')",
          [BEN, post.id],
        ],
        [
          "update reading_entries set audience = 'private' where id = $1",
          [record.id],
        ],
        [
          "update reading_sessions set ended_at = now() where id = $1",
          [together.id],
        ],
        [
          "update posters set show_in_timeline = false, allow_display = false, spoiler = true where id = $1",
          [poster.id],
        ],
        ["update posters set status = 'draft' where id = $1", [poster.id]],
        ["delete from posters where id = $1", [poster.id]],
        ["update shops set is_open = false where id = $1", [benShop.id]],
        ["update shops set name = '閉じた本屋' where id = $1", [benShop.id]],
        ["delete from shops where id = $1", [benShop.id]],
        [
          "insert into saved_shops (user_id, shop_id) values ($1, $2)",
          [BEN, shop.id],
        ],
        [
          "insert into shop_visits (user_id, shop_id) values ($1, $2)",
          [BEN, shop.id],
        ],
      ] as [string, unknown[]][])
        await as(BEN, sql, params);
      await as(BEN, "select delete_my_account()");
      assert.equal(
        (await rows("select 1 from profiles where id = $1", [BEN])).length,
        0,
      );
      await db.close();
    },
  );

  // A reader without a public profile ---------------------------------------------------------

  await check(
    "a reader without a public profile is found nowhere, by nobody signed out nor any other reader",
    async () => {
      const db = await migrated();
      const { rows, as, refused, typed, keep } = helpers(db);
      // Chi keeps her reading only: a profile with no handle and no name.
      await as(
        CHI,
        "insert into profiles (id, name, handle, published) values ($1, '', null, false)",
        [CHI],
      );
      await typed(CHI, book(3), "チーだけの本");
      await keep(CHI, book(3), "finished");
      await as(
        CHI,
        "insert into profile_nine (profile_id, position, book_id) values ($1, 1, $2)",
        [CHI, book(3)],
      );
      await as(
        CHI,
        "insert into posts (author_id, body, book_id, reading_mode) values ($1, 'ひとりメモ', $2, 'solo')",
        [CHI, book(3)],
      );
      await as(
        CHI,
        "insert into reading_entries (user_id, book_id, audience, body) values ($1, $2, 'everyone', 'よかった')",
        [CHI, book(3)],
      );
      await as(
        CHI,
        "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'solo')",
        [CHI, book(3)],
      );
      await as(
        CHI,
        "insert into shops (owner_id, name) values ($1, 'チーの本屋')",
        [CHI],
      );

      // Her own: all of it.
      assert.equal(
        (await as(CHI, "select * from profiles where id = $1", [CHI])).length,
        1,
      );
      assert.equal(
        (await as(CHI, "select title from books where id = $1", [book(3)]))
          .length,
        1,
      );
      // Anyone else: nothing, through tables or functions.
      for (const visitor of [null, AKI, DAI]) {
        for (const [what, sql] of [
          ["her profile", "select * from profiles where id = $1"],
          ["her nine", "select * from profile_nine where profile_id = $1"],
          ["her posts", "select * from posts where author_id = $1"],
          ["her records", "select * from reading_entries where user_id = $1"],
          ["her reading", "select * from reading_sessions where user_id = $1"],
          ["her shop", "select * from shops where owner_id = $1"],
        ])
          assert.equal(
            (await as(visitor, sql, [CHI])).length,
            0,
            `${visitor} ${what}`,
          );
        assert.equal(
          (
            await as(visitor, "select title from books where id = $1", [
              book(3),
            ])
          ).length,
          0,
          `${visitor} her book`,
        );
        const [{ view }] = await as<{ view: Record<string, unknown> }>(
          visitor,
          "select town_view() as view",
        );
        assert.doesNotMatch(
          JSON.stringify(view),
          new RegExp(CHI),
          `${visitor} the town`,
        );
        assert.doesNotMatch(
          JSON.stringify(view),
          /チー/,
          `${visitor} the town`,
        );
        const found = await as(
          visitor,
          "select * from find_books(null, null, null, 50)",
        );
        assert.doesNotMatch(
          JSON.stringify(found),
          /チーだけ/,
          `${visitor} the search`,
        );
        const [{ records }] = await as<{ records: unknown[] }>(
          visitor,
          "select work_records($1) as records",
          [book(3)],
        );
        assert.deepEqual(records, [], `${visitor} the book's records`);
      }
      // Her own record even made public stays hers, and counts nowhere.
      assert.deepEqual(
        await rows("select audience from reading_entries where user_id = $1", [
          CHI,
        ]),
        [{ audience: "private" }],
      );
      assert.equal(
        (
          await rows<{ status: string | null }>(
            `select c.status from library_entries e, lateral private.status_counted(e) c
             where e.user_id = $1`,
            [CHI],
          )
        )[0].status,
        null,
      );
      // Nothing reaching people until she publishes.
      for (const [sql, params] of [
        ["insert into posts (author_id, body) values ($1, '便り')", [CHI]],
        [
          "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
          [CHI, AKI],
        ],
        ["update shops set is_open = true where owner_id = $1", [CHI]],
        [
          "update reading_entries set audience = 'everyone' where user_id = $1",
          [CHI],
        ],
      ] as [string, unknown[]][]) {
        const error = await refused(CHI, sql, params);
        assert.equal(error.code, "42501", sql);
        assert.equal(error.hint, "booktown:no_public_profile", sql);
      }
      // Not published, never with a handle: none taken tells anyone.
      assert.equal(
        (
          await refused(
            CHI,
            "update profiles set handle = 'chi' where id = $1",
            [CHI],
          )
        ).code,
        "23514",
      );
      // Published only with a handle and a name.
      for (const sql of [
        "update profiles set published = true where id = $1",
        "update profiles set published = true, handle = 'chi' where id = $1",
      ]) {
        const error = await refused(CHI, sql, [CHI]);
        assert.equal(error.code, "23514", sql);
      }
      await as(
        CHI,
        "update profiles set published = true, handle = 'chi', name = 'チー' where id = $1",
        [CHI],
      );
      // Now she is there, and what she kept before stays hers.
      assert.equal(
        (await as(DAI, "select * from profiles where id = $1", [CHI])).length,
        1,
      );
      assert.equal(
        (
          await as(DAI, "select * from reading_entries where user_id = $1", [
            CHI,
          ])
        ).length,
        0,
      );
      assert.equal(
        (
          await as(DAI, "select * from library_entries where user_id = $1", [
            CHI,
          ])
        ).length,
        0,
      );
      await as(
        CHI,
        "insert into posts (author_id, body) values ($1, '初めての便り')",
        [CHI],
      );
      // A public profile is not taken back by a request.
      const error = await refused(
        CHI,
        "update profiles set published = false where id = $1",
        [CHI],
      );
      assert.equal(error.hint, "booktown:published");
      await db.close();
    },
  );

  // What the app sends again, or as a whole row --------------------------------------------

  await check(
    "a write sent again, or as a whole row, is judged by what it changes",
    async () => {
      const db = await migrated();
      const { rows, as, refused, mode, typed } = helpers(db);
      await typed(BEN, book(1));
      await typed(BEN, book(2));
      const [shop] = await as<{ id: string }>(
        AKI,
        "insert into shops (owner_id, name, is_open) values ($1, 'アキの本屋', true) returning id",
        [AKI],
      );
      const [daiShop] = await as<{ id: string }>(
        DAI,
        "insert into shops (owner_id, name, is_open) values ($1, 'ダイの本屋', true) returning id",
        [DAI],
      );
      const [post] = await as<{ id: string }>(
        BEN,
        "insert into posts (author_id, body) values ($1, 'ベンの便り') returning id",
        [BEN],
      );
      const [together] = await as<{ id: string }>(
        BEN,
        "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together') returning id",
        [BEN, book(1)],
      );
      const reaction = `insert into shop_reactions (user_id, shop_id, liked, message)
        values ($1, $2, $3, $4) on conflict (user_id, shop_id)
        do update set liked = excluded.liked, message = excluded.message`;
      await as(BEN, reaction, [BEN, shop.id, true, "すてき"]);
      await as(
        BEN,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like')",
        [BEN, post.id],
      );
      await as(
        BEN,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [BEN, AKI],
      );
      await mode(BEN, "manage");

      // Sent again: there already, nothing new.
      for (const [sql, params] of [
        [
          "insert into posts (id, author_id, body) values ($1, $2, 'ベンの便り') on conflict (id) do nothing",
          [post.id, BEN],
        ],
        [
          "insert into reading_sessions (id, user_id, book_id, mode) values ($1, $2, $3, 'together') on conflict (id) do nothing",
          [together.id, BEN, book(1)],
        ],
        [
          "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like') on conflict do nothing",
          [BEN, post.id],
        ],
        [
          "insert into profile_follows (follower_id, followee_id) values ($1, $2) on conflict do nothing",
          [BEN, AKI],
        ],
        // The like taken back, the ひとこと kept, as the app sends it.
        [reaction, [BEN, shop.id, false, "すてき"]],
      ] as [string, unknown[]][])
        await as(BEN, sql, params);
      assert.deepEqual(
        await rows("select liked, message from shop_reactions"),
        [{ liked: false, message: "すてき" }],
      );

      // What it would change reaches people.
      for (const [what, sql, params] of [
        ["liked again", reaction, [BEN, shop.id, true, "すてき"]],
        ["another ひとこと", reaction, [BEN, shop.id, false, "いいね"]],
        [
          "the ひとこと moved to another shop",
          "update shop_reactions set shop_id = $2 where user_id = $1",
          [BEN, daiShop.id],
        ],
        [
          "reading together, another book",
          "update reading_sessions set book_id = $2 where id = $1",
          [together.id, book(2)],
        ],
        [
          "reading together, started again",
          "update reading_sessions set started_at = now() + interval '1 hour' where id = $1",
          [together.id],
        ],
        [
          "a like tapped again",
          "update post_reactions set taps = taps + 1 where user_id = $1",
          [BEN],
        ],
      ] as [string, string, unknown[]][]) {
        const error = await refused(BEN, sql, params, what);
        assert.equal(error.hint, "booktown:reading_mode", what);
      }
      // Ending it is not refused; going on again after is.
      await as(
        BEN,
        "update reading_sessions set ended_at = now() where id = $1",
        [together.id],
      );
      assert.equal(
        (
          await refused(
            BEN,
            "update reading_sessions set ended_at = null where id = $1",
            [together.id],
          )
        ).hint,
        "booktown:reading_mode",
      );
      await db.close();
    },
  );

  await check(
    "a book row moved to the reader's own copy keeps the mode it came in and what it showed",
    async () => {
      const db = await migrated();
      const { rows, mode, typed, keep, setStatus, counted } = helpers(db);
      await typed(BEN, book(1));
      await typed(BEN, book(2));
      await keep(BEN, book(1), "reading");
      await mode(BEN, "manage");
      await setStatus(BEN, book(1), "finished");
      await keep(BEN, book(2), "reading");
      const before = await rows(
        `select book_id, added_mode, audience, detail, status_held, shown_status
         from library_entries order by book_id`,
      );
      for (const original of [book(1), book(2)])
        await rows("select private.give_own_copy($1, $2, 'moved')", [
          original,
          BEN,
        ]);
      const after = await rows<Record<string, unknown>>(
        `select c.copied_from as book_id, e.added_mode, e.audience, e.detail,
                e.status_held, e.shown_status
         from library_entries e join private.book_copies c on c.book_id = e.book_id
         order by c.copied_from`,
      );
      assert.deepEqual(after, before);
      const [copy] = await rows<{ book_id: string }>(
        "select book_id from private.book_copies where copied_from = $1",
        [book(1)],
      );
      assert.deepEqual(await counted(BEN, copy.book_id), {
        status: "reading",
        wanted: false,
      });
      await db.close();
    },
  );

  await check(
    "a first starting choice narrower than 人数だけ narrows the books kept before",
    async () => {
      const db = await migrated();
      const { rows, as, typed, keep } = helpers(db);
      await typed(AKI, book(1));
      await keep(AKI, book(1), "reading");
      await as(
        AKI,
        "insert into reader_settings (user_id, status_audience) values ($1, 'private')",
        [AKI],
      );
      assert.deepEqual(await rows("select audience from library_entries"), [
        { audience: "private" },
      ]);
      await db.close();
    },
  );

  await check(
    "a book brought back in normal mode shows as it is now",
    async () => {
      const db = await migrated();
      const { as, mode, typed, keep, setStatus, counted } = helpers(db);
      await typed(BEN, book(1));
      await keep(BEN, book(1), "reading");
      await mode(BEN, "manage");
      await setStatus(BEN, book(1), "finished");
      await as(
        BEN,
        "update library_entries set removed_at = now() where book_id = $1",
        [book(1)],
      );
      await mode(BEN, "normal");
      await as(
        BEN,
        "update library_entries set removed_at = null where book_id = $1",
        [book(1)],
      );
      assert.deepEqual(await counted(BEN, book(1)), {
        status: "finished",
        wanted: false,
      });
      await db.close();
    },
  );

  await check(
    "a work nobody counts in has no row, and a book held from its work is not counted",
    async () => {
      const db = await migrated();
      const { rows, mode, typed, keep } = helpers(db);
      await typed(BEN, book(1));
      await typed(AKI, book(2));
      await mode(BEN, "manage");
      await keep(BEN, book(1), "finished");
      await keep(AKI, book(2), "finished");
      const works = (
        await rows<{ work_id: string }>(
          "select work_id from books where id = any($1::uuid[]) order by id",
          [[book(1), book(2)]],
        )
      ).map((row) => row.work_id);
      assert.deepEqual(
        await rows("select * from private.reading_counts($1::uuid[])", [
          [works[0]],
        ]),
        [],
      );
      assert.equal(
        (
          await rows("select * from private.reading_counts($1::uuid[])", [
            [works[1]],
          ])
        ).length,
        1,
      );
      await rows("delete from private.book_checks where book_id = $1", [
        book(2),
      ]);
      assert.deepEqual(
        await rows("select * from private.reading_counts($1::uuid[])", [
          [works[1]],
        ]),
        [],
      );
      await db.close();
    },
  );

  await check(
    "a shop's visitors last week leave out readers without a public profile",
    async () => {
      // The visits and the count must fall in the same week.
      await clearOfJapanMidnight();
      const db = await migrated();
      const { rows, as } = helpers(db);
      await as(
        CHI,
        "insert into profiles (id, name, handle, published) values ($1, '', null, false)",
        [CHI],
      );
      const [shop] = await as<{ id: string }>(
        AKI,
        "insert into shops (owner_id, name, is_open) values ($1, 'アキの本屋', true) returning id",
        [AKI],
      );
      await rows(
        `insert into shop_visits (user_id, shop_id, visited_at)
         select u, $1, private.last_visit_week()::timestamp at time zone 'Asia/Tokyo'
           + interval '1 day'
         from unnest($2::uuid[]) u`,
        [shop.id, [CHI, DAI]],
      );
      await rows("select private.count_shop_visitors()");
      assert.deepEqual(
        await rows("select visitors from private.shop_visitor_weeks"),
        [{ visitors: 1 }],
      );
      await db.close();
    },
  );

  await check(
    "the operator's service role, which has no use of schema private, writes every table the triggers watch",
    async () => {
      const db = await migrated();
      const { typed } = helpers(db);
      await typed(AKI, book(1));
      await db.exec(`
        grant usage on schema public to service_role;
        grant all on all tables in schema public to service_role;
        grant all on all sequences in schema public to service_role;
        grant execute on all functions in schema public to service_role;
        set role service_role;
      `);
      // reader_settings is left out: its check already asked schema private
      // before this move (is_shelf_audiences).
      try {
        for (const [sql, params] of [
          ["update profiles set name = 'アキ' where id = $1", [AKI]],
          [
            "insert into library_entries (user_id, book_id, status, source) values ($1, $2, 'reading', 'manual')",
            [AKI, book(1)],
          ],
          [
            "update library_entries set status = 'finished' where user_id = $1",
            [AKI],
          ],
          [
            "insert into reading_entries (user_id, book_id, audience) values ($1, $2, 'everyone')",
            [AKI, book(1)],
          ],
          [
            "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together')",
            [AKI, book(1)],
          ],
          [
            "insert into library_shelves (id, user_id, name, position) values ($1, $2, '旅', 'a')",
            [id(3, 1), AKI],
          ],
          ["insert into posts (author_id, body) values ($1, '便り')", [AKI]],
          [
            "insert into shops (owner_id, name, is_open) values ($1, '本屋', true)",
            [AKI],
          ],
          [
            "insert into posters (author_id, template, pages) values ($1, 'text', $2)",
            [AKI, PAGES],
          ],
        ] as [string, unknown[]][])
          await db.query(sql, params);
      } finally {
        await db.exec("reset role");
      }
      await db.close();
    },
  );

  // Terms ---------------------------------------------------------------------------------

  await check(
    "terms are agreed to by version, with being 13 or older, and a large change asks again",
    async () => {
      const db = await migrated();
      const { rows, as, refused } = helpers(db);
      const toAgree = async (reader: Visitor) => {
        const [row] = await as<{ v: string | null }>(
          reader,
          "select terms_to_agree() as v",
        );
        return row.v;
      };
      // The first terms, published with the pages (管理表44).
      assert.equal(await toAgree(AKI), "2026-10-26");
      assert.equal(
        (await refused(null, "select terms_to_agree()")).code,
        "42501",
      );
      // From none published, as before the first terms.
      await rows("delete from private.terms_versions");
      assert.equal(await toAgree(AKI), null, "none published yet");
      await rows(
        "insert into private.terms_versions (version, published_at) values ('1', now() - interval '2 days')",
      );
      assert.equal(await toAgree(AKI), "1");
      assert.equal(
        (
          await refused(
            AKI,
            "insert into terms_consents (user_id, version, thirteen_or_older) values ($1, '1', false)",
            [AKI],
          )
        ).code,
        "23514",
      );
      await as(
        AKI,
        "insert into terms_consents (user_id, version, thirteen_or_older, agreed_at) values ($1, '1', true, now())",
        [AKI],
      ).then(
        () => assert.fail("agreed_at is the database's"),
        (error) => assert.equal(error.code, "42501"),
      );
      await as(
        AKI,
        "insert into terms_consents (user_id, version, thirteen_or_older) values ($1, '1', true)",
        [AKI],
      );
      assert.equal(await toAgree(AKI), null);
      // A small change asks nobody again.
      await rows(
        "insert into private.terms_versions (version, published_at, asks_again) values ('1.1', now() - interval '1 day', false)",
      );
      assert.equal(await toAgree(AKI), null);
      assert.equal(await toAgree(BEN), "1.1");
      // Only the version now published may be agreed to.
      assert.equal(
        (
          await refused(
            BEN,
            "insert into terms_consents (user_id, version, thirteen_or_older) values ($1, '1', true)",
            [BEN],
          )
        ).code,
        "42501",
      );
      // A large change asks everyone again.
      await rows("insert into private.terms_versions (version) values ('2')");
      assert.equal(await toAgree(AKI), "2");
      // Each reader reads only their own; nobody changes or takes one back.
      assert.equal((await as(BEN, "select * from terms_consents")).length, 0);
      await as(AKI, "update terms_consents set version = '2'").then(
        () => assert.fail("a consent is kept as it is"),
        (error) => assert.equal(error.code, "42501"),
      );
      await as(AKI, "delete from terms_consents").then(
        () => assert.fail("a consent goes only with the account"),
        (error) => assert.equal(error.code, "42501"),
      );
      assert.equal(
        (await rows("select * from terms_consents where user_id = $1", [AKI]))
          .length,
        1,
      );
      await db.close();
    },
  );

  // The move and its undoing -------------------------------------------------------------------

  await check(
    "the move rewrites no row, and every row already there is normal, published and 人数だけ",
    async () => {
      const db = await migrated(FILE);
      const { as, typed, keep } = helpers(db);
      await typed(AKI, book(1));
      await keep(AKI, book(1), "finished");
      await as(
        AKI,
        "insert into reading_entries (user_id, book_id, is_public) values ($1, $2, true)",
        [AKI, book(1)],
      );
      // A row in each table the move copies.
      await as(
        AKI,
        "insert into reader_settings (user_id, status_audience) values ($1, 'everyone')",
        [AKI],
      );
      await as(
        AKI,
        "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together')",
        [AKI, book(1)],
      );
      await as(
        AKI,
        "insert into library_shelves (id, user_id, name, position, audience) values ($1, $2, '旅', 'a', 'everyone')",
        [id(3, 1), AKI],
      );
      const was = await everyRow(db);
      await db.exec(TEXT);
      const now = await everyRow(db);
      const without = (row: string, added: string[]) => {
        const value = JSON.parse(row);
        for (const name of added) delete value[name];
        return value;
      };
      const ADDED: Record<string, string[]> = {
        "public.profiles": ["published"],
        "public.library_entries": [
          "added_mode",
          "audience",
          "detail",
          "status_held",
          "shown_status",
          "wanted_held",
          "shown_wanted_at",
        ],
        "public.library_shelves": ["made_mode"],
        "public.reader_settings": ["mode"],
      };
      for (const name of Object.keys(was)) {
        assert.deepEqual(
          now[name].map((row) => without(row, ADDED[name] ?? [])),
          was[name].map((row) => JSON.parse(row)),
          name,
        );
      }
      const helped = helpers(db);
      assert.deepEqual(
        await helped.rows("select published from profiles order by id"),
        [{ published: true }, { published: true }, { published: true }],
      );
      assert.deepEqual(await helped.counted(AKI, book(1)), {
        status: "finished",
        wanted: false,
      });
      // Every copy was checked, and found nothing lost.
      const copies = await helped.rows<{
        source: string;
        checked: Record<string, number> | null;
      }>("select source, checked from keep.copies where label = $1", [LABEL]);
      assert.equal(copies.length, 6);
      for (const copy of copies) {
        assert.ok(copy.checked, copy.source);
        assert.equal(copy.checked.lost_rows, 0, copy.source);
        assert.equal(copy.checked.lost_links, 0, copy.source);
      }
      assert.deepEqual(await helped.rows("select mode from reader_settings"), [
        { mode: "normal" },
      ]);
      await db.close();
    },
  );

  await check(
    "the rollback, as the header writes it, leaves the database as it was, and the move runs again",
    async () => {
      const db = await migrated(FILE);
      const was = await catalog(db);
      await db.exec(TEXT);
      const header = TEXT.slice(0, TEXT.indexOf("\n\n")).split("\n");
      const start = header.findIndex((line) => line.startsWith("-- Rollback:"));
      const rollback: string[] = [];
      for (const line of header.slice(start + 1)) {
        if (!line.startsWith("--   ")) break;
        rollback.push(line.slice(3));
      }
      const sql = rollback.join("\n");
      assert.match(sql, /drop column published/);
      await db.exec(sql);
      assert.match(sql, /drop_copy/);
      assert.deepEqual(await catalog(db), was);
      await db.exec(TEXT);
      await db.close();
    },
  );

  console.log(`${passed} reading mode checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
