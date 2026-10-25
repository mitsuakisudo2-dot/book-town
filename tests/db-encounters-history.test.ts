import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// 出会いの記録と操作の履歴 (item 9, supabase/migrations/*_encounters_and_history.sql;
// docs/機能/本棚とライブラリ.md). A 読みたい pressed on a book in another
// reader's shop is kept as an encounter naming the shop; every change the
// reader makes to their library is kept in library_events by the database,
// theirs alone, for a year, and never stops the write it follows.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_encounters_and_history.sql"));
assert.ok(FILE, "the encounters and history migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a"; // keeps a library
const BEN = "00000000-0000-4000-8000-00000000000b"; // keeps a shop
const CHI = "00000000-0000-4000-8000-00000000000c"; // looks on

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const book = (n: number) => id(2, n);
const shelf = (n: number) => id(3, n);
const encounter = (n: number) => id(4, n);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
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
  async function refused(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ code?: string; message: string }> {
    try {
      await as(visitor, sql, params);
    } catch (error) {
      return error as { code?: string; message: string };
    }
    assert.fail("expected a refusal: " + sql);
  }
  const typed = (reader: string, bookId: string) =>
    as(
      reader,
      `insert into books (id, title, author, source, created_by)
       values ($1, '本', '著者', 'manual', $2)`,
      [bookId, reader],
    );
  const keep = (reader: string, bookId: string, more = "") =>
    as(
      reader,
      `insert into library_entries (user_id, book_id, source${more ? ", " + more.split("=")[0] : ""})
       values ($1, $2, 'scan'${more ? ", " + more.split("=")[1] : ""})`,
      [reader, bookId],
    );
  const history = (reader: string, bookId?: string) =>
    rows<{
      kind: string;
      was: string | null;
      became: string | null;
      shelf_id: string | null;
      manage: boolean;
    }>(
      `select kind, was, became, shelf_id, manage from library_events
       where user_id = $1 and ($2::uuid is null or book_id = $2) order by at`,
      [reader, bookId ?? null],
    );
  return { rows, as, refused, typed, keep, history };
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, run: () => Promise<void>) =>
  tests.push([name, run]);

test("a 読みたい in another's shop is kept with the shop and whose it was", async () => {
  const db = await migrated();
  const { rows, as, typed } = helpers(db);
  const [open] = await as<{ id: string }>(
    BEN,
    "insert into shops (owner_id, name, is_open) values ($1, '夜の本屋', true) returning id",
    [BEN],
  );
  await typed(AKI, book(1));
  await as(
    AKI,
    `insert into book_encounters (id, user_id, book_id, kind, via, shop_id, other_reader_id)
     values ($1, $2, $3, 'want', 'shop', $4, $5)`,
    [encounter(1), AKI, book(1), open.id, CHI],
  );
  assert.deepEqual(
    await rows(
      "select via, shop_id, other_reader_id from book_encounters where id = $1",
      [encounter(1)],
    ),
    [{ via: "shop", shop_id: open.id, other_reader_id: BEN }],
    "whose shop it was comes from the shop, never from the device",
  );
});

test("an encounter in a shop is refused as the others are", async () => {
  const db = await migrated();
  const { as, refused, typed } = helpers(db);
  const [open] = await as<{ id: string }>(
    BEN,
    "insert into shops (owner_id, name, is_open) values ($1, '夜の本屋', true) returning id",
    [BEN],
  );
  const [shut] = await as<{ id: string }>(
    CHI,
    "insert into shops (owner_id, name) values ($1, '準備中の本屋') returning id",
    [CHI],
  );
  const [akis] = await as<{ id: string }>(
    AKI,
    "insert into shops (owner_id, name, is_open) values ($1, 'アキの本屋', true) returning id",
    [AKI],
  );
  await typed(AKI, book(1));
  const meet = (
    n: number,
    shopId: string,
    kind = "want",
    placement: string | null = null,
  ) =>
    `insert into book_encounters (id, user_id, book_id, kind, via, shop_id, placement_key)
     values ('${encounter(n)}', '${AKI}', '${book(1)}', '${kind}', 'shop', '${shopId}', ${
       placement ? `'${placement}'` : "null"
     })`;
  assert.equal(
    (await refused(AKI, meet(1, shut.id))).code,
    "23503",
    "a closed shop is not found",
  );
  assert.equal(
    (await refused(AKI, meet(2, id(9, 9)))).code,
    "23503",
    "one that is not there is refused the same way",
  );
  assert.equal(
    (await refused(AKI, meet(3, akis.id))).code,
    "23514",
    "never their own shop",
  );
  assert.equal(
    (await refused(AKI, meet(4, open.id, "like"))).code,
    "23514",
    "only 読みたい",
  );
  assert.equal(
    (await refused(AKI, meet(5, open.id, "want", "[1]"))).code,
    "23514",
    "a shop's book without a POP has no place",
  );
  await as(AKI, meet(6, open.id));
  assert.equal(
    (await refused(AKI, meet(7, open.id))).code,
    "23505",
    "one of each shop and book",
  );
  // A POP still names its place, as before.
  assert.equal(
    (
      await refused(
        AKI,
        `insert into book_encounters (id, user_id, book_id, kind, via, shop_id)
         values ('${encounter(8)}', '${AKI}', '${book(1)}', 'like', 'pop', '${open.id}')`,
      )
    ).code,
    "23514",
  );
  // The shop going leaves the encounter, as a POP's.
  await db.query("delete from shops where id = $1", [open.id]);
  assert.deepEqual(
    await db
      .query(
        "select shop_id, other_reader_id from book_encounters where id = $1",
        [encounter(6)],
      )
      .then((r) => r.rows),
    [{ shop_id: null, other_reader_id: BEN }],
  );
});

test("each change to the library is kept, the reader's alone", async () => {
  const db = await migrated();
  const { as, refused, typed, keep, history } = helpers(db);
  await typed(AKI, book(1));
  await keep(AKI, book(1), "status='tsundoku'");
  assert.deepEqual(
    (await history(AKI)).map((e) => [e.kind, e.was, e.became]),
    [
      ["added", null, "scan"],
      ["status", null, "tsundoku"],
    ],
  );
  const set = (sql: string) =>
    as(
      AKI,
      `update library_entries set ${sql} where user_id = $1 and book_id = $2`,
      [AKI, book(1)],
    );
  await set("status = 'reading', status_at = now()");
  await set("wanted_at = now()");
  await set("owned = 'yes'");
  await set("removed_at = now()");
  await set("removed_at = null, wanted_at = null");
  await set("like_restored = true"); // nothing the history keeps
  await as(
    AKI,
    `insert into library_shelves (id, user_id, name, position) values ($1, $2, 'SF', 'a')`,
    [shelf(1), AKI],
  );
  await as(
    AKI,
    `insert into library_shelf_books (shelf_id, user_id, book_id) values ($1, $2, $3)`,
    [shelf(1), AKI, book(1)],
  );
  await as(AKI, "delete from library_shelf_books where user_id = $1", [AKI]);
  assert.deepEqual(
    (await history(AKI)).map((e) => [e.kind, e.was, e.became, e.shelf_id]),
    [
      ["added", null, "scan", null],
      ["status", null, "tsundoku", null],
      ["status", "tsundoku", "reading", null],
      ["wanted", null, null, null],
      ["owned", null, "yes", null],
      ["removed", null, null, null],
      ["restored", null, null, null],
      ["unwanted", null, null, null],
      ["shelved", null, null, shelf(1)],
      ["unshelved", null, null, shelf(1)],
    ],
  );
  assert.equal(
    (await as(AKI, "select * from library_events")).length,
    10,
    "the reader reads it",
  );
  assert.equal(
    (await as(CHI, "select * from library_events")).length,
    0,
    "nobody else does",
  );
  assert.equal((await as(BEN, "select * from library_events")).length, 0);
  for (const sql of [
    `insert into library_events (user_id, book_id, kind) values ('${AKI}', '${book(1)}', 'added')`,
    "update library_events set kind = 'added'",
    "delete from library_events",
  ])
    assert.equal(
      (await refused(AKI, sql)).code,
      "42501",
      "only the database writes it: " + sql,
    );
  assert.equal(
    (await refused(null, "select * from library_events")).code,
    "42501",
    "nothing for anyone signed out",
  );
});

test("only the reader's own requests are kept, and manage mode says so", async () => {
  const db = await migrated();
  const { as, typed, keep, history } = helpers(db);
  await typed(AKI, book(1));
  await typed(AKI, book(2));
  // The database's own work (a migration, a nightly job) keeps nothing.
  await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  await db.query(
    "insert into library_entries (user_id, book_id, source) values ($1, $2, 'legacy')",
    [AKI, book(2)],
  );
  assert.deepEqual(await history(AKI, book(2)), []);
  await as(
    AKI,
    `insert into reader_settings (user_id, mode) values ($1, 'manage')
     on conflict (user_id) do update set mode = excluded.mode`,
    [AKI],
  );
  await keep(AKI, book(1));
  assert.deepEqual(
    (await history(AKI, book(1))).map((e) => [e.kind, e.manage]),
    [["added", true]],
  );
});

test("a busy script's day is not kept past its limit, and the write goes on", async () => {
  const db = await migrated();
  const { rows, as, typed, keep, history } = helpers(db);
  await typed(AKI, book(1));
  await typed(AKI, book(2));
  await typed(AKI, book(3));
  await keep(AKI, book(1));
  // 49999 rows in the last day, the one above among them: one more is kept.
  await db.query(
    `insert into library_events (user_id, book_id, kind, at)
     select $1, $2, 'owned', now() - interval '1 hour' from generate_series(1, 49998)`,
    [AKI, book(1)],
  );
  await keep(AKI, book(2), "status='finished'");
  assert.deepEqual(
    (await history(AKI, book(2))).map((e) => e.kind),
    ["added", "status"],
    "a write is kept whole once begun under the limit",
  );
  await keep(AKI, book(3));
  assert.equal((await history(AKI, book(3))).length, 0, "nothing more is kept");
  await as(
    AKI,
    "update library_entries set status = 'reading' where user_id = $1 and book_id = $2",
    [AKI, book(3)],
  );
  assert.deepEqual(
    await rows(
      "select status from library_entries where user_id = $1 and book_id = $2",
      [AKI, book(3)],
    ),
    [{ status: "reading" }],
    "but the library row is written",
  );
  // A day later the history goes on.
  await db.query("update library_events set at = at - interval '1 day'");
  await as(
    AKI,
    "update library_entries set status = 'finished' where user_id = $1 and book_id = $2",
    [AKI, book(3)],
  );
  assert.deepEqual(
    (await history(AKI, book(3))).map((e) => [e.was, e.became]),
    [["reading", "finished"]],
  );
});

test("an undo comes last, whatever times the row is written back with", async () => {
  const db = await migrated();
  const { as, typed, history } = helpers(db);
  await typed(AKI, book(1));
  await as(
    AKI,
    `insert into library_entries (user_id, book_id, source, status, status_at, added_at)
     values ($1, $2, 'scan', 'tsundoku', now() - interval '30 days', now() - interval '30 days')`,
    [AKI, book(1)],
  );
  const set = (sql: string) =>
    as(
      AKI,
      `update library_entries set ${sql} where user_id = $1 and book_id = $2`,
      [AKI, book(1)],
    );
  await set("status = 'reading', status_at = now()");
  await set("status = 'tsundoku', status_at = now() - interval '30 days'");
  await as(
    AKI,
    `insert into library_shelves (id, user_id, name, position) values ($1, $2, 'SF', 'a')`,
    [shelf(1), AKI],
  );
  const shelve = () =>
    as(
      AKI,
      `insert into library_shelf_books (shelf_id, user_id, book_id, added_at)
       values ($1, $2, $3, now() - interval '400 days')`,
      [shelf(1), AKI, book(1)],
    );
  await shelve();
  await as(AKI, "delete from library_shelf_books where user_id = $1", [AKI]);
  await shelve();
  assert.deepEqual(
    (await history(AKI)).map((e) => [e.kind, e.was, e.became]),
    [
      ["added", null, "scan"],
      ["status", null, "tsundoku"],
      ["status", "tsundoku", "reading"],
      ["status", "reading", "tsundoku"],
      ["shelved", null, null],
      ["unshelved", null, null],
      ["shelved", null, null],
    ],
  );
  await db.query("select private.forget_library_events()");
  assert.equal((await history(AKI)).length, 7, "nothing is a year old");
});

test("a row sent again, an old app's mark and a move to a copy", async () => {
  const db = await migrated();
  const { as, typed, history } = helpers(db);
  await typed(AKI, book(1));
  const send = () =>
    as(
      AKI,
      `insert into library_entries (user_id, book_id, source) values ($1, $2, 'scan')
       on conflict (user_id, book_id) do nothing`,
      [AKI, book(1)],
    );
  await send();
  await send();
  assert.deepEqual(
    (await history(AKI)).map((e) => e.kind),
    ["added"],
    "sent again, kept once",
  );
  // An app without the library writes a mark; the database copies it to the row.
  await typed(AKI, book(2));
  await as(
    AKI,
    "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
    [AKI, book(2)],
  );
  assert.deepEqual(
    (await history(AKI, book(2))).map((e) => [e.kind, e.became]),
    [
      ["added", "legacy"],
      ["wanted", null],
    ],
  );
  // The database moving rows to a reader's copy of a book keeps nothing.
  await db.exec("select set_config('private.copying', 'on', false)");
  await as(AKI, "update library_entries set owned = 'yes' where user_id = $1", [
    AKI,
  ]);
  await db.exec("select set_config('private.copying', '', false)");
  assert.equal(
    (await history(AKI)).filter((e) => e.kind === "owned").length,
    0,
  );
});

test("rows go after a year, and with the library row or the account", async () => {
  const db = await migrated();
  const { rows, as, typed, keep, history } = helpers(db);
  await typed(AKI, book(1));
  await typed(AKI, book(2));
  await keep(AKI, book(1));
  await keep(AKI, book(2));
  await db.query(
    "update library_events set at = now() - interval '1 year 1 day' where book_id = $1",
    [book(1)],
  );
  await db.query("select private.forget_library_events()");
  assert.deepEqual(
    (await rows<{ book_id: string }>("select book_id from library_events")).map(
      (r) => r.book_id,
    ),
    [book(2)],
  );
  assert.deepEqual(
    await rows(
      "select jobname, schedule from cron.job where jobname = 'library-events'",
    ),
    [{ jobname: "library-events", schedule: "31 19 * * *" }],
  );
  // A book forgotten after the scanner took it back (AUD-055) takes its
  // history with it; its shelf places say so first.
  await as(
    AKI,
    `insert into library_shelves (id, user_id, name, position) values ($1, $2, 'SF', 'a')`,
    [shelf(1), AKI],
  );
  await as(
    AKI,
    `insert into library_shelf_books (shelf_id, user_id, book_id) values ($1, $2, $3)`,
    [shelf(1), AKI, book(2)],
  );
  // As forget_books does, in one transaction: its shelf places first, then
  // its row (the reader asking).
  await db.exec("begin");
  await db.query(
    "delete from library_shelf_books where user_id = $1 and book_id = $2",
    [AKI, book(2)],
  );
  assert.deepEqual((await history(AKI, book(2))).map((e) => e.kind).slice(-1), [
    "unshelved",
  ]);
  await db.query(
    "delete from library_entries where user_id = $1 and book_id = $2",
    [AKI, book(2)],
  );
  await db.exec("commit");
  assert.deepEqual(await history(AKI, book(2)), []);
  // An account going takes everything, its shelves' places included.
  await typed(AKI, book(3));
  await keep(AKI, book(3));
  await as(
    AKI,
    `insert into library_shelf_books (shelf_id, user_id, book_id) values ($1, $2, $3)`,
    [shelf(1), AKI, book(3)],
  );
  // As the sign-in service deletes it: nobody signed in (database-policies
  // deletes as supabase_auth_admin itself).
  await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("delete from auth.users where id = $1", [AKI]);
  assert.equal((await rows("select * from library_events")).length, 0);
});

test("the history does not count as a use of a book", async () => {
  const db = await migrated();
  const { rows } = helpers(db);
  assert.deepEqual(
    await rows(
      `select c.conrelid::regclass::text t from pg_constraint c
       where c.contype = 'f' and c.confrelid = 'public.books'::regclass
         and c.conrelid = 'public.library_events'::regclass`,
    ),
    [],
    "no foreign key to books: catalog_used and book_used_besides_own pass it by",
  );
});

test("the rollback undoes it, and it applies again", async () => {
  const db = await migrated();
  const before = await migrated(FILE);
  const rollback = TEXT.split("-- Rollback (a new migration):\n")[1]
    .split("\n-- No data moves")[0]
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(5))
    .join("\n")
    .replace(/and, while no row has via 'shop'[^\n]*\n/, "")
    .replace(/and private\.check_book_encounter\(\) again[^\n]*\n?/, "");
  await db.exec(rollback);
  const own = migrationText(
    FILES.find((file) => file.endsWith("_own_books_only.sql"))!,
  );
  const check = own.slice(
    own.indexOf("create or replace function private.check_book_encounter()"),
  );
  await db.exec(
    check.slice(0, check.indexOf("$$;", check.indexOf("$$") + 2) + 3),
  );
  const shape = (d: PGlite) =>
    d
      .query<{ s: string }>(
        `select string_agg(x, E'\\n' order by x) s from (
           select 'table ' || table_schema || '.' || table_name x from information_schema.tables
             where table_schema in ('public', 'private')
           union all select 'constraint ' || conrelid::regclass || ' ' || pg_get_constraintdef(oid)
             from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace)
           union all select 'index ' || indexdef from pg_indexes
             where schemaname in ('public', 'private')
           union all select 'function ' || p.oid::regprocedure || ' ' || md5(p.prosrc)
             from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
           union all select 'trigger ' || tgrelid::regclass || ' ' || tgname from pg_trigger
             where not tgisinternal
           union all select 'job ' || jobname from cron.job
         ) all_of_it`,
      )
      .then((r) => r.rows[0].s);
  assert.equal(await shape(db), await shape(before), "as it was before");
  await db.exec(TEXT);
});

async function main() {
  for (const [name, run] of tests) {
    await run();
    console.log("ok -", name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
