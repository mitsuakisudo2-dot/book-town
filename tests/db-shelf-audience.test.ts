import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// 自分の本棚, its second part (item 15, supabase/migrations/*_shelf_audience.sql):
// who may see each shelf, a smart shelf's rule, the shelves every library
// has, and a narrower starting choice narrowing them all. Nothing shows a
// shelf to anyone else yet (the owner, 2026-10-17 04:47Z「まだ見せない」), so
// a shelf and its books stay the reader's own to read, whatever it says.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_shelf_audience.sql"));
assert.ok(FILE, "the shelf audience migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Aki keeps a typed-in book on a shelf made before this file.
const AKI_BOOK = id(1, 1);
const OLD_SHELF = id(2, 1);
const NEW_SHELF = id(2, 2);
const SMART = id(2, 3);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
  insert into books (id, title, author, source, created_by) values
    ('${AKI_BOOK}', 'アキの本', 'アキ', 'manual', '${AKI}');
  insert into library_entries (user_id, book_id, source, status) values
    ('${AKI}', '${AKI_BOOK}', 'manual', 'finished');
  insert into library_shelves (id, user_id, name, position) values
    ('${OLD_SHELF}', '${AKI}', '雨の日に', 'a0');
  insert into library_shelf_books (shelf_id, user_id, book_id) values
    ('${OLD_SHELF}', '${AKI}', '${AKI_BOOK}');
`;

/** A database migrated up to the file before this one, with readers in it. */
async function before(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
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
  async function refused(run: () => Promise<unknown>, what: string) {
    let error: unknown = null;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, "expected a refusal: " + what);
  }
  const shelves = async () =>
    rows<{ id: string; audience: string }>(
      "select id, audience from library_shelves order by id",
    );
  const fixed = async (reader: string) =>
    (
      await rows<{ shelf_audiences: Record<string, string> }>(
        "select shelf_audiences from reader_settings where user_id = $1",
        [reader],
      )
    )[0]?.shelf_audiences;
  return { rows, as, refused, shelves, fixed };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await before();
  const { rows, as, refused, shelves, fixed } = helpers(db);
  const shelfBefore = await rows<{ row: string }>(
    "select to_jsonb(s)::text as row from library_shelves s",
  );
  await db.exec(TEXT);

  await check(
    "a shelf made before is private and has no rule, and nothing else of it changed",
    async () => {
      const [shelf] = await rows<{
        audience: string;
        rule: unknown;
        row: string;
      }>(
        `select audience, rule, (to_jsonb(s) - 'audience' - 'rule')::text as row
         from library_shelves s`,
      );
      assert.equal(shelf.audience, "private");
      assert.equal(shelf.rule, null);
      assert.equal(shelf.row, shelfBefore[0].row);
    },
  );

  await check(
    "the reader makes a public shelf and a smart one, and changes who may see them",
    async () => {
      await as(
        AKI,
        `insert into library_shelves (id, user_id, name, position, audience, rule)
         values ($1, $2, '読んだSF', 'a1', 'everyone', null),
                ($3, $2, '今年の読了', 'a2', 'private', $4)`,
        [
          NEW_SHELF,
          AKI,
          SMART,
          JSON.stringify({ status: ["finished"], since: "2026-01" }),
        ],
      );
      await as(
        AKI,
        "update library_shelves set audience = 'everyone' where id = $1",
        [OLD_SHELF],
      );
      assert.deepEqual(await shelves(), [
        { id: OLD_SHELF, audience: "everyone" },
        { id: NEW_SHELF, audience: "everyone" },
        { id: SMART, audience: "private" },
      ]);
      const [smart] = await as<{ rule: unknown }>(
        AKI,
        "select rule from library_shelves where id = $1",
        [SMART],
      );
      assert.deepEqual(smart.rule, {
        status: ["finished"],
        since: "2026-01",
      });
    },
  );

  await check(
    "until a page shows shelves, nobody else reads a public shelf, its books or its typed-in titles",
    async () => {
      assert.deepEqual(await as(BEN, "select id from library_shelves"), []);
      assert.deepEqual(
        await as(BEN, "select book_id from library_shelf_books"),
        [],
      );
      // Signed out, the tables are not even open.
      await refused(
        () => as(null, "select id from library_shelves"),
        "the shelves, signed out",
      );
      await refused(
        () => as(null, "select book_id from library_shelf_books"),
        "the shelves' books, signed out",
      );
      for (const visitor of [BEN, null]) {
        assert.deepEqual(
          await as(visitor, "select title from books where id = $1", [
            AKI_BOOK,
          ]),
          [],
        );
      }
      await as(BEN, "update library_shelves set audience = 'private'");
      assert.equal(
        (await shelves()).filter((shelf) => shelf.audience === "everyone")
          .length,
        2,
      );
    },
  );

  await check(
    "an audience, a rule or a shelf every library has that is not one is refused",
    async () => {
      await refused(
        () =>
          as(
            AKI,
            "update library_shelves set audience = 'friends' where id = $1",
            [NEW_SHELF],
          ),
        "an audience not offered",
      );
      await refused(
        () =>
          as(AKI, "update library_shelves set rule = '[1]' where id = $1", [
            SMART,
          ]),
        "a rule that is not an object",
      );
      await refused(
        () =>
          as(AKI, "update library_shelves set rule = $2 where id = $1", [
            SMART,
            JSON.stringify({ author: "あ".repeat(2000) }),
          ]),
        "a rule too large",
      );
      await as(
        AKI,
        `insert into reader_settings (user_id, shelf_audiences)
         values ($1, '{"finished": "everyone", "want": "private"}')`,
        [AKI],
      );
      assert.deepEqual(await fixed(AKI), {
        finished: "everyone",
        want: "private",
      });
      await refused(
        () =>
          as(
            AKI,
            `update reader_settings set shelf_audiences = '{"secret": "everyone"}'
             where user_id = $1`,
            [AKI],
          ),
        "a shelf no library has",
      );
      await refused(
        () =>
          as(
            AKI,
            `update reader_settings set shelf_audiences = '{"finished": "friends"}'
             where user_id = $1`,
            [AKI],
          ),
        "an audience not offered, for a shelf every library has",
      );
      await refused(
        () =>
          as(
            AKI,
            `update reader_settings set shelf_audiences = '["finished"]'
             where user_id = $1`,
            [AKI],
          ),
        "a list, not the shelves by key",
      );
    },
  );

  await check(
    "a narrower starting choice narrows every shelf at once; a wider one widens none",
    async () => {
      await as(
        AKI,
        "update reader_settings set shelves_audience = 'everyone' where user_id = $1",
        [AKI],
      );
      assert.deepEqual(await shelves(), [
        { id: OLD_SHELF, audience: "everyone" },
        { id: NEW_SHELF, audience: "everyone" },
        { id: SMART, audience: "private" },
      ]);
      await as(
        AKI,
        "update reader_settings set shelves_audience = 'followers' where user_id = $1",
        [AKI],
      );
      assert.deepEqual(await shelves(), [
        { id: OLD_SHELF, audience: "followers" },
        { id: NEW_SHELF, audience: "followers" },
        { id: SMART, audience: "private" },
      ]);
      assert.deepEqual(await fixed(AKI), {
        finished: "followers",
        want: "private",
      });
      // Sent together, the narrower choice wins over what came with it.
      await as(
        AKI,
        `update reader_settings set shelves_audience = 'private',
           shelf_audiences = '{"liked": "everyone"}' where user_id = $1`,
        [AKI],
      );
      assert.deepEqual(await fixed(AKI), { liked: "private" });
      assert.ok(
        (await shelves()).every((shelf) => shelf.audience === "private"),
      );
    },
  );

  await db.close();

  await check(
    "the rollback, as the header writes it, leaves the database as it was",
    async () => {
      const earlier = await before();
      const catalog = async () =>
        (
          await earlier.query<{ row: string }>(
            `select a.attrelid::regclass::text || '.' || a.attname || ' '
                || coalesce(a.attacl::text, '') as row
             from pg_attribute a join pg_class c on c.oid = a.attrelid
             where c.relnamespace = 'public'::regnamespace and a.attnum > 0
               and not a.attisdropped
             union all
             select p.oid::regprocedure::text from pg_proc p
             where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
             union all
             select t.tgrelid::regclass::text || ' ' || t.tgname from pg_trigger t
             where not t.tgisinternal
             order by 1`,
          )
        ).rows.map((row) => row.row);
      const was = await catalog();
      await earlier.exec(TEXT);
      const header = TEXT.slice(0, TEXT.indexOf("\n\n")).split("\n");
      const start = header.findIndex((line) => line.startsWith("-- Rollback:"));
      const rollback: string[] = [];
      for (const line of header.slice(start + 1)) {
        if (!line.startsWith("--   ")) break;
        rollback.push(line.slice(3));
      }
      const sql = rollback.join("\n");
      assert.match(sql, /drop column audience/);
      await earlier.exec(sql);
      assert.deepEqual(await catalog(), was);
      await earlier.exec(TEXT);
      await earlier.close();
    },
  );

  console.log(`${passed} shelf audience checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
