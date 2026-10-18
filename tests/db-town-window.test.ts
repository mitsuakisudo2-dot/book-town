import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import { FEELINGS } from "../src/lib/types";

// The town without every reader's records and 人生の9冊 (AUD-006 6a, the
// third part; supabase/migrations/*_town_window.sql). Asked as before,
// town_view answers what it answered before; with a window, others' nines
// stay out and their records come only as far as the town shows them: the
// newest, the ones its 便り stand on, the ones of works the reader finished,
// never one the reader may not see. Which feelings anyone kept, of all
// time. work_records answers a book's page. Who may call them, and undoing
// the file.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_town_window.sql"));
assert.ok(FILE, "the town window migration");
const TEXT = migrationText(FILE);
const BEFORE = FILES.find((file) => file.endsWith("_town_view.sql"));
assert.ok(BEFORE, "the town view migration");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAN = "00000000-0000-4000-8000-00000000000d";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Books: one work typed in by three readers (each their own copy, all used
// where everyone sees them), and books of their own.
const AKI_RAIN = id(2, 1);
const BEN_RAIN = id(2, 2);
const CHI_RAIN = id(2, 3);
const BEN_OWN = id(2, 4);
const CHI_OWN = id(2, 5);
const DAN_OWN = id(2, 6);
// Records, oldest first.
const BEN_OLD = id(4, 1); // Ben's, of the work Aki finished: old
const CHI_PRIVATE = id(4, 2); // Chi's, for Chi alone
const CHI_FOLLOWERS = id(4, 3); // Chi's, for Chi's followers (Aki follows)
const DAN_POSTED = id(4, 4); // Dan's, of the book of Dan's 便り: old
const BEN_NOTE = id(4, 5); // Ben's note (not a finished record)
const BEN_NEW = id(4, 6); // Ben's newest
const AKI_FINISHED = id(4, 7); // Aki's own
const DAN_POST = id(3, 1);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAN}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'),
    ('${CHI}', 'chi', 'チー'), ('${DAN}', 'dan', 'ダン');
  insert into books (id, title, author, source, created_by, isbn) values
    ('${AKI_RAIN}', '雨の本', '雨野', 'manual', '${AKI}', '9784000000017'),
    ('${BEN_RAIN}', '雨の本', '雨野', 'manual', '${BEN}', '9784000000017'),
    ('${CHI_RAIN}', '雨の本', '雨野', 'manual', '${CHI}', '9784000000017');
  insert into books (id, title, author, source, created_by) values
    ('${BEN_OWN}', 'ベンの本', 'ベン', 'manual', '${BEN}'),
    ('${CHI_OWN}', 'チーの本', 'チー', 'manual', '${CHI}'),
    ('${DAN_OWN}', 'ダンの本', 'ダン', 'manual', '${DAN}');
  insert into profile_nine (profile_id, position, book_id, note) values
    ('${AKI}', 1, '${AKI_RAIN}', 'アキの一冊'),
    ('${BEN}', 1, '${BEN_OWN}', 'ベンの一冊'),
    ('${CHI}', 1, '${CHI_OWN}', 'チーの一冊');
  insert into profile_follows (follower_id, followee_id) values ('${AKI}', '${CHI}');
  insert into posts (id, author_id, body, book_id, created_at) values
    ('${DAN_POST}', '${DAN}', 'この本のこと', '${DAN_OWN}', now() - interval '1 hour');
  insert into reading_entries (id, user_id, book_id, kind, body, feelings, audience, created_at) values
    ('${BEN_OLD}', '${BEN}', '${BEN_RAIN}', 'finished', 'ベンの古い記録', '{cried}', 'everyone', now() - interval '9 days'),
    ('${CHI_PRIVATE}', '${CHI}', '${CHI_RAIN}', 'finished', 'チーだけ', '{scared}', 'private', now() - interval '8 days'),
    ('${CHI_FOLLOWERS}', '${CHI}', '${CHI_OWN}', 'finished', 'フォロワーに', '{warm}', 'followers', now() - interval '7 days'),
    ('${DAN_POSTED}', '${DAN}', '${DAN_OWN}', 'finished', 'ダンの記録', '{laughed}', 'everyone', now() - interval '6 days'),
    ('${BEN_NOTE}', '${BEN}', '${BEN_OWN}', 'note', 'ベンのメモ', '{}', 'everyone', now() - interval '2 days'),
    ('${BEN_NEW}', '${BEN}', '${BEN_OWN}', 'finished', 'ベンの新しい記録', '{talk}', 'everyone', now() - interval '1 day'),
    ('${AKI_FINISHED}', '${AKI}', '${AKI_RAIN}', 'finished', 'アキの記録', '{quiet}', 'private', now() - interval '3 days');
`;

type Visitor = string | null;
type Rows = Record<string, unknown>[];

async function as<T = Record<string, unknown>>(
  db: PGlite,
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

async function view(db: PGlite, visitor: Visitor, args = "") {
  const [{ view }] = await as<{ view: Record<string, Rows> }>(
    db,
    visitor,
    `select town_view(${args}) as view`,
  );
  return view;
}

const WINDOW = "500, 300, false, 300, false";
const ids = (rows: Rows) => rows.map((row) => row.id as string).sort();

/** The first comment's rollback statements, lines starting "--   ". */
function rollbackSql(): string {
  const lines = TEXT.slice(TEXT.indexOf("-- Rollback:")).split("\n").slice(1);
  return lines
    .slice(
      0,
      lines.findIndex((line) => !line.startsWith("--   ")),
    )
    .map((line) => line.slice(5))
    .join("\n");
}

/** town_view as 20261109000000_town_view.sql made it, with its grants. */
function townViewBefore(): string {
  const text = migrationText(BEFORE!);
  const start = text.indexOf("create function public.town_view(");
  const end = text.indexOf("$$;", start) + 3;
  return [
    text.slice(start, end),
    "revoke all on function public.town_view(integer, integer, boolean) from public;",
    "grant execute on function public.town_view(integer, integer, boolean) to anon, authenticated;",
  ].join("\n");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
    await db.exec(migrationText(file));
  await db.exec(SEED);
  const readers: Visitor[] = [null, AKI, BEN, CHI, DAN];
  const before = new Map<Visitor, unknown>();
  for (const reader of readers) {
    before.set(reader, await view(db, reader, "500, 300, false"));
    before.set("words:" + reader, await view(db, reader));
  }
  await db.exec(TEXT);

  await check("asked as before, town_view answers as before", async () => {
    for (const reader of readers) {
      assert.deepEqual(
        await view(db, reader, "500, 300, false"),
        before.get(reader),
        String(reader),
      );
      assert.deepEqual(
        await view(db, reader),
        before.get("words:" + reader),
        String(reader),
      );
    }
  });

  await check(
    "with the window, only the reader's own nine comes, and none to a visitor",
    async () => {
      const aki = await view(db, AKI, WINDOW);
      assert.deepEqual(
        aki.nine.map((row) => row.profile_id),
        [AKI],
      );
      assert.deepEqual((await view(db, null, WINDOW)).nine, []);
      // Asked with others' nines, all of them, as before.
      const all = await view(db, AKI, "500, 300, false, 300, true");
      assert.equal(all.nine.length, 3);
    },
  );

  await check(
    "a window of one: the reader's own, the newest, what 便り stand on, what met the reader's finished works",
    async () => {
      const aki = await view(db, AKI, "500, 300, false, 1, false");
      assert.deepEqual(
        ids(aki.records),
        [
          AKI_FINISHED, // the reader's own, private too
          BEN_NEW, // the newest of others'
          DAN_POSTED, // Dan's 便り stands on it
          BEN_OLD, // the work Aki finished (Ben's own copy of it)
        ].sort(),
      );
      // Others' without their words.
      for (const row of aki.records)
        assert.equal(row.body === "", row.user_id !== AKI);
      // A visitor: no reader's own, no finished works; never a private one.
      const visitor = await view(db, null, "500, 300, false, 1, false");
      assert.deepEqual(ids(visitor.records), [BEN_NEW, DAN_POSTED].sort());
    },
  );

  await check(
    "the window never brings what the reader may not see, nor notes",
    async () => {
      const all = async (reader: Visitor) =>
        ids((await view(db, reader, WINDOW)).records);
      // Chi's private record reaches only Chi; the followers' one, Aki
      // (who follows Chi) and Chi.
      for (const reader of readers) {
        const seen = await all(reader);
        assert.equal(seen.includes(CHI_PRIVATE), reader === CHI);
        assert.equal(
          seen.includes(CHI_FOLLOWERS),
          reader === AKI || reader === CHI,
        );
        // Another reader's note, which the app never shows, stays out.
        assert.equal(seen.includes(BEN_NOTE), reader === BEN);
      }
    },
  );

  await check(
    "the feelings anyone kept come from every record the reader may see, of all time",
    async () => {
      const felt = async (reader: Visitor) =>
        (
          await as<{ felt: string[] }>(
            db,
            reader,
            "select felt_in_town() as felt",
          )
        )[0].felt;
      // Ben's old record is out of a window of one; its feeling is not.
      assert.deepEqual(await felt(null), ["cried", "laughed", "talk"]);
      assert.deepEqual(await felt(AKI), [
        "cried",
        "quiet",
        "warm",
        "laughed",
        "talk",
      ]);
      // Not read with the town: the search asks when it opens.
      assert.equal(
        (await view(db, null, "500, 300, false, 1, false")).felt,
        undefined,
      );
    },
  );

  await check(
    "the feelings felt_in_town knows are the ones reading_entries allows, and the app's",
    async () => {
      const {
        rows: [{ check }],
      } = await db.query<{ check: string }>(
        `select pg_get_constraintdef(oid) as check from pg_constraint
         where conrelid = 'public.reading_entries'::regclass
           and pg_get_constraintdef(oid) like '%feelings <@%'`,
      );
      const allowed = [...check.matchAll(/'(\w+)'/g)].map((match) => match[1]);
      const asked = TEXT.slice(TEXT.indexOf("every text[] := array["));
      const known = [
        ...asked.slice(0, asked.indexOf("];")).matchAll(/'(\w+)'/g),
      ].map((match) => match[1]);
      assert.deepEqual(known, allowed);
      assert.deepEqual(known, [...FEELINGS]);
    },
  );

  await check(
    "a book's page reads its work's records, of every copy the reader may see, newest first",
    async () => {
      const work = async (reader: Visitor, book: string, limit = 200) =>
        (
          await as<{ rows: Rows }>(
            db,
            reader,
            "select work_records($1::uuid, $2) as rows",
            [book, limit],
          )
        )[0].rows;
      // From any copy of the work: Ben's old record, and Aki's own (Aki's
      // eyes only); Chi's private one, Chi's alone.
      const aki = await work(AKI, BEN_RAIN);
      assert.deepEqual(
        aki.map((row) => row.id),
        [AKI_FINISHED, BEN_OLD],
      );
      assert.deepEqual(
        aki.map((row) => row.body),
        ["アキの記録", ""],
      );
      assert.deepEqual(
        (await work(null, AKI_RAIN)).map((row) => row.id),
        [BEN_OLD],
      );
      assert.deepEqual(
        (await work(CHI, AKI_RAIN)).map((row) => row.id),
        [CHI_PRIVATE, BEN_OLD],
      );
      assert.equal((await work(AKI, BEN_RAIN, 1)).length, 1);
      // A book of no work the reader may see: nothing.
      assert.deepEqual(await work(null, id(9, 9)), []);
    },
  );

  await check(
    "both run as the reader, and only readers and visitors may call them",
    async () => {
      const { rows } = await db.query<{
        name: string;
        definer: boolean;
        anon: boolean;
        authenticated: boolean;
        everyone: boolean;
      }>(
        `select p.proname as name, p.prosecdef as definer,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
           exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as everyone
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('felt_in_town', 'town_view', 'work_records')
         order by 1`,
      );
      assert.deepEqual(rows, [
        {
          name: "felt_in_town",
          definer: false,
          anon: true,
          authenticated: true,
          everyone: false,
        },
        {
          name: "town_view",
          definer: false,
          anon: true,
          authenticated: true,
          everyone: false,
        },
        {
          name: "work_records",
          definer: false,
          anon: true,
          authenticated: true,
          everyone: false,
        },
      ]);
    },
  );

  await check(
    "undone, town_view is the one before, asked as before",
    async () => {
      await db.exec(rollbackSql());
      await db.exec(townViewBefore());
      for (const reader of readers)
        assert.deepEqual(
          await view(db, reader, "500, 300, false"),
          before.get(reader),
          String(reader),
        );
      let refused = false;
      try {
        await view(db, null, WINDOW);
      } catch {
        refused = true;
      }
      assert.ok(refused, "no window after undoing");
      const { rows: left } = await db.query(
        `select proname as name from pg_proc
         where proname in ('felt_in_town', 'work_records')
         union all
         select indexname from pg_indexes
         where indexname in ('reading_entries_newest', 'reading_entries_book')`,
      );
      assert.deepEqual(left, []);
    },
  );

  console.log(`${passed} town window checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
