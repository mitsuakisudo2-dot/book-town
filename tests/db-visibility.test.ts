import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// 見せる範囲 (item 8 of the 2026-10-16 plan,
// supabase/migrations/*_visibility.sql): the move from public or private to
// who may read (everyone, followers, private), what each kind of visitor
// gets afterwards, the narrowing a starting choice brings to records kept
// before, the old app's is_public, and undoing it all. The owner's rules
// (2026-10-16 05:31Z, 05:51Z): each kind of thing has a starting choice; a
// narrower one narrows what was kept before at once, a wider one asks.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_visibility.sql"));
assert.ok(FILE, "the visibility migration");
const LABEL = FILE.replace(/\.sql$/, "");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAI = "00000000-0000-4000-8000-00000000000d";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Aki chose public records and keeps one public, one private. Ben chose
// private and has a settings row already; Chi chose private and has none.
// Each book is typed in by hand, so who reads its title follows the records.
const AKI_BOOK = id(1, 1);
const AKI_SECRET_BOOK = id(1, 2);
const BEN_BOOK = id(1, 3);
const AKI_OPEN = id(2, 1);
const AKI_SECRET = id(2, 2);
const BEN_SECRET = id(2, 3);

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAI}');
  insert into profiles (id, handle, name, reading_visibility) values
    ('${AKI}', 'aki', 'アキ', 'public'), ('${BEN}', 'ben', 'ベン', 'private'),
    ('${CHI}', 'chi', 'チー', 'private'), ('${DAI}', 'dai', 'ダイ', 'private');
  insert into reader_settings (user_id, spoiler_display) values ('${BEN}', 'leave_out');
  insert into books (id, title, author, source, created_by) values
    ('${AKI_BOOK}', 'アキの本', 'アキ', 'manual', '${AKI}'),
    ('${AKI_SECRET_BOOK}', 'アキの秘密の本', 'アキ', 'manual', '${AKI}'),
    ('${BEN_BOOK}', 'ベンの本', 'ベン', 'manual', '${BEN}');
  insert into reading_entries (id, user_id, book_id, is_public, body, created_at, updated_at) values
    ('${AKI_OPEN}', '${AKI}', '${AKI_BOOK}', true, 'よかった', '2026-10-01', '2026-10-02'),
    ('${AKI_SECRET}', '${AKI}', '${AKI_SECRET_BOOK}', false, '', '2026-10-03', '2026-10-04'),
    ('${BEN_SECRET}', '${BEN}', '${BEN_BOOK}', false, 'ひとりで', '2026-10-05', '2026-10-06');
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
  /** The ids of a reader's records the visitor reads, oldest first. */
  const seen = async (visitor: Visitor, owner: string) =>
    (
      await as<{ id: string }>(
        visitor,
        "select id from reading_entries where user_id = $1 order by created_at",
        [owner],
      )
    ).map((row) => row.id);
  /** Whether the visitor reads a book's title. */
  const readsBook = async (visitor: Visitor, book: string) =>
    (await as(visitor, "select title from books where id = $1", [book]))
      .length === 1;
  const audienceOf = async (record: string) =>
    (
      await rows<{ audience: string; is_public: boolean }>(
        "select audience, is_public from reading_entries where id = $1",
        [record],
      )
    )[0];
  return { rows, as, refused, count, seen, readsBook, audienceOf };
}

/** Every row of every table in public and private. */
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

/** Everything a migration makes or changes in public and private, by name. */
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
                || ' ' || coalesce(col_description(a.attrelid, a.attnum), '')
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
         and a.attnum > 0 and not a.attisdropped
       union all
       select 'policy', c.oid::regclass::text || ' ' || p.polname,
              p.polcmd::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
                || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
       from pg_policy p join pg_class c on c.oid = p.polrelid
       union all
       select 'trigger', t.tgrelid::regclass::text || ' ' || t.tgname,
              t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
       from pg_trigger t
       where not t.tgisinternal
       union all
       select 'constraint', c.conrelid::regclass::text || ' ' || c.conname,
              pg_get_constraintdef(c.oid)
       from pg_constraint c
       where c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
       order by 1, 2`,
    )
  ).rows;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await before();
  const { rows, as, refused, count, seen, readsBook, audienceOf } = helpers(db);
  const rowsBefore = await everyRow(db);
  await db.exec(TEXT);

  // The move -------------------------------------------------------------------------

  await check(
    "each record shows what it showed, without being touched, and readers start their records as they chose",
    async () => {
      assert.deepEqual(await audienceOf(AKI_OPEN), {
        audience: "everyone",
        is_public: true,
      });
      assert.deepEqual(await audienceOf(AKI_SECRET), {
        audience: "private",
        is_public: false,
      });
      assert.deepEqual(await audienceOf(BEN_SECRET), {
        audience: "private",
        is_public: false,
      });
      // Only the new column differs: no record was dated anew.
      const after = (
        await rows<{ row: string }>(
          "select (to_jsonb(e) - 'audience')::text as row from reading_entries e order by 1",
        )
      ).map((row) => row.row);
      assert.deepEqual(after, rowsBefore["public.reading_entries"]);

      const settings = await rows<{
        user_id: string;
        records_audience: string;
        spoiler_display: string;
      }>(
        "select user_id, records_audience, spoiler_display from reader_settings order by user_id",
      );
      assert.deepEqual(settings, [
        {
          user_id: AKI,
          records_audience: "everyone",
          spoiler_display: "fold_possible",
        },
        {
          user_id: BEN,
          records_audience: "private",
          spoiler_display: "leave_out",
        },
      ]);
      // The copy holds both tables as they were.
      assert.equal(
        await count("select count(*) from keep.copies where label = $1", [
          LABEL,
        ]),
        2,
      );
    },
  );

  await check(
    "a reader with no settings row starts from the owner's defaults",
    async () => {
      await as(CHI, "insert into reader_settings (user_id) values ($1)", [CHI]);
      const [chi] = await as<Record<string, string>>(
        CHI,
        `select records_audience, status_audience, status_detail, shelves_audience,
           stats_audience, likes_audience, saves_audience, encounters_audience
         from reader_settings where user_id = $1`,
        [CHI],
      );
      assert.deepEqual(chi, {
        records_audience: "private",
        status_audience: "everyone",
        status_detail: "count",
        shelves_audience: "private",
        stats_audience: "private",
        likes_audience: "private",
        saves_audience: "private",
        encounters_audience: "private",
      });
      await db.query("delete from reader_settings where user_id = $1", [CHI]);
    },
  );

  await check(
    "the signup's choice on the new profile is where records start",
    async () => {
      const EVE = "00000000-0000-4000-8000-00000000000e";
      const FAY = "00000000-0000-4000-8000-00000000000f";
      await db.exec(
        `insert into auth.users (id) values ('${EVE}'), ('${FAY}')`,
      );
      await as(
        EVE,
        "insert into profiles (id, handle, name, reading_visibility) values ($1, 'eve', 'イヴ', 'public')",
        [EVE],
      );
      await as(
        FAY,
        "insert into profiles (id, handle, name, reading_visibility) values ($1, 'fay', 'フェイ', 'private')",
        [FAY],
      );
      assert.deepEqual(
        await rows(
          "select user_id, records_audience from reader_settings where user_id in ($1, $2)",
          [EVE, FAY],
        ),
        [{ user_id: EVE, records_audience: "everyone" }],
      );
      await db.query("delete from auth.users where id in ($1, $2)", [EVE, FAY]);
    },
  );

  // Who reads what ---------------------------------------------------------------------

  await check(
    "a public record is read by everyone, a private one by its reader alone",
    async () => {
      assert.deepEqual(await seen(AKI, AKI), [AKI_OPEN, AKI_SECRET]);
      assert.deepEqual(await seen(BEN, AKI), [AKI_OPEN]);
      assert.deepEqual(await seen(null, AKI), [AKI_OPEN]);
      assert.deepEqual(await seen(AKI, BEN), []);
      assert.equal(await readsBook(null, AKI_BOOK), true);
      assert.equal(await readsBook(BEN, AKI_SECRET_BOOK), false);
      assert.equal(await readsBook(AKI, AKI_SECRET_BOOK), true);
    },
  );

  await check(
    "a record for followers is read by the people following its reader, and by nobody else",
    async () => {
      await as(
        AKI,
        "update reading_entries set audience = 'followers' where id = $1",
        [AKI_SECRET],
      );
      assert.deepEqual(await audienceOf(AKI_SECRET), {
        audience: "followers",
        is_public: false,
      });
      // Not yet followed: nobody but Aki.
      assert.deepEqual(await seen(BEN, AKI), [AKI_OPEN]);
      assert.equal(await readsBook(BEN, AKI_SECRET_BOOK), false);
      // Ben follows Aki: he reads it, and its book with it.
      await as(
        BEN,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [BEN, AKI],
      );
      assert.deepEqual(await seen(BEN, AKI), [AKI_OPEN, AKI_SECRET]);
      assert.equal(await readsBook(BEN, AKI_SECRET_BOOK), true);
      // Following the other way round is not following.
      await as(
        AKI,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [AKI, CHI],
      );
      assert.deepEqual(await seen(CHI, AKI), [AKI_OPEN]);
      assert.equal(await readsBook(CHI, AKI_SECRET_BOOK), false);
      assert.deepEqual(await seen(null, AKI), [AKI_OPEN]);
      assert.equal(await readsBook(null, AKI_SECRET_BOOK), false);
      // What anyone may read does not count a record for followers: the
      // operator's candidates build on it.
      assert.equal(
        (
          await rows<{ listed: boolean }>(
            "select private.book_is_listed($1) as listed",
            [AKI_SECRET_BOOK],
          )
        )[0].listed,
        false,
      );
      // A block, either way, takes it away, the follow with it.
      await as(
        AKI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [AKI, BEN],
      );
      assert.deepEqual(await seen(BEN, AKI), []);
      assert.equal(await readsBook(BEN, AKI_SECRET_BOOK), false);
      await as(AKI, "delete from blocks where blocker_id = $1", [AKI]);
      assert.deepEqual(await seen(BEN, AKI), [AKI_OPEN]);
      await as(
        BEN,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [BEN, AKI],
      );
      assert.deepEqual(await seen(BEN, AKI), [AKI_OPEN, AKI_SECRET]);
      // A profile the operator hid shows nothing to anyone else.
      await db.exec(
        `insert into moderation_hides (target_kind, target_id) values ('profile', '${AKI}')`,
      );
      assert.deepEqual(await seen(BEN, AKI), []);
      assert.deepEqual(await seen(null, AKI), []);
      assert.deepEqual(await seen(AKI, AKI), [AKI_OPEN, AKI_SECRET]);
      await db.exec("delete from moderation_hides");
      // Unfollowing takes it away.
      await as(
        BEN,
        "delete from profile_follows where follower_id = $1 and followee_id = $2",
        [BEN, AKI],
      );
      assert.deepEqual(await seen(BEN, AKI), [AKI_OPEN]);
      assert.equal(await readsBook(BEN, AKI_SECRET_BOOK), false);
      await as(
        BEN,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [BEN, AKI],
      );
    },
  );

  await check(
    "only the reader writes a record's audience, and only a known one",
    async () => {
      assert.equal(
        (
          await as(
            BEN,
            "update reading_entries set audience = 'everyone' where id = $1 returning 1",
            [AKI_SECRET],
          )
        ).length,
        0,
      );
      await refused(
        () =>
          as(
            AKI,
            "update reading_entries set audience = 'friends' where id = $1",
            [AKI_SECRET],
          ),
        /check constraint/,
        "an audience nobody knows",
      );
      await refused(
        () =>
          as(
            null,
            "update reading_entries set audience = 'everyone' where id = $1",
            [AKI_SECRET],
          ),
        /permission/,
        "a visitor signed out",
      );
      // Nobody reads another reader's starting choices.
      assert.equal(
        (
          await as(BEN, "select 1 from reader_settings where user_id = $1", [
            AKI,
          ])
        ).length,
        0,
      );
      await refused(
        () => as(null, "select 1 from reader_settings", []),
        /permission/,
        "settings signed out",
      );
      assert.equal(
        (
          await as(
            BEN,
            "update reader_settings set records_audience = 'everyone' where user_id = $1 returning 1",
            [AKI],
          )
        ).length,
        0,
      );
      await refused(
        () =>
          as(
            AKI,
            "update reader_settings set status_detail = 'names' where user_id = $1",
            [AKI],
          ),
        /check constraint/,
        "a detail nobody knows",
      );
    },
  );

  // Starting choices -----------------------------------------------------------------

  await check(
    "a narrower starting choice narrows every record kept before at once; a wider one changes none",
    async () => {
      const aki = (sql: string, params: unknown[] = []) => as(AKI, sql, params);
      // Aki: one public, one for followers, one private.
      const third = id(2, 9);
      await aki(
        "insert into reading_entries (id, user_id, book_id, audience) values ($1, $2, $3, 'private')",
        [third, AKI, AKI_BOOK],
      );
      const audiences = async () =>
        (
          await rows<{ audience: string }>(
            "select audience from reading_entries where user_id = $1 order by created_at, id",
            [AKI],
          )
        ).map((row) => row.audience);
      assert.deepEqual(await audiences(), ["everyone", "followers", "private"]);

      // Widening from public to public changes nothing, and so does an
      // upsert that does not touch the choice.
      await aki(
        `insert into reader_settings (user_id, spoiler_display) values ($1, 'show_all')
         on conflict (user_id) do update set spoiler_display = excluded.spoiler_display`,
        [AKI],
      );
      assert.deepEqual(await audiences(), ["everyone", "followers", "private"]);

      // To followers: the public record narrows, the others stay.
      await aki(
        "update reader_settings set records_audience = 'followers' where user_id = $1",
        [AKI],
      );
      assert.deepEqual(await audiences(), [
        "followers",
        "followers",
        "private",
      ]);
      assert.equal((await audienceOf(AKI_OPEN)).is_public, false);
      assert.deepEqual(await seen(null, AKI), []);

      // Back to public: nothing widens by itself. The app widens what the
      // reader says to, record by record.
      await aki(
        "update reader_settings set records_audience = 'everyone' where user_id = $1",
        [AKI],
      );
      assert.deepEqual(await audiences(), [
        "followers",
        "followers",
        "private",
      ]);
      await aki(
        "update reading_entries set audience = 'everyone' where id = $1",
        [AKI_OPEN],
      );
      assert.deepEqual(await seen(null, AKI), [AKI_OPEN]);

      // To private: everything goes private, the exceptions too, and no
      // other reader's records are touched.
      await as(
        BEN,
        "update reading_entries set audience = 'everyone' where id = $1",
        [BEN_SECRET],
      );
      await aki(
        "update reader_settings set records_audience = 'private' where user_id = $1",
        [AKI],
      );
      assert.deepEqual(await audiences(), ["private", "private", "private"]);
      assert.deepEqual(await seen(BEN, AKI), []);
      assert.deepEqual(await seen(null, AKI), []);
      assert.equal((await audienceOf(BEN_SECRET)).audience, "everyone");

      // After narrowing, a record may still be set wider one by one.
      await aki(
        "update reading_entries set audience = 'everyone' where id = $1",
        [AKI_OPEN],
      );
      assert.deepEqual(await seen(null, AKI), [AKI_OPEN]);
      await aki("delete from reading_entries where id = $1", [third]);
    },
  );

  // The old app ----------------------------------------------------------------------

  await check(
    "an old app's is_public is taken as the audience, and is_public always follows it",
    async () => {
      const dai = (sql: string, params: unknown[] = []) => as(DAI, sql, params);
      const record = id(2, 20);
      // Sent with is_public and no audience, as the old app does.
      await dai(
        "insert into reading_entries (id, user_id, book_id, is_public) values ($1, $2, $3, true)",
        [record, DAI, AKI_BOOK],
      );
      assert.deepEqual(await audienceOf(record), {
        audience: "everyone",
        is_public: true,
      });
      // Its 自分だけにする.
      await dai("update reading_entries set is_public = false where id = $1", [
        record,
      ]);
      assert.deepEqual(await audienceOf(record), {
        audience: "private",
        is_public: false,
      });
      // Its note written again with is_public as it was: nothing moves.
      await dai(
        "update reading_entries set body = 'もう一度', is_public = false where id = $1",
        [record],
      );
      assert.equal((await audienceOf(record)).audience, "private");
      // The new app sends audience alone; is_public follows, whatever is sent.
      await dai(
        "update reading_entries set audience = 'everyone' where id = $1",
        [record],
      );
      assert.deepEqual(await audienceOf(record), {
        audience: "everyone",
        is_public: true,
      });
      await dai(
        "update reading_entries set audience = 'followers', is_public = true where id = $1",
        [record],
      );
      assert.deepEqual(await audienceOf(record), {
        audience: "followers",
        is_public: false,
      });
      // Sent with neither: private.
      const bare = id(2, 21);
      await dai(
        "insert into reading_entries (id, user_id, book_id) values ($1, $2, $3)",
        [bare, DAI, AKI_BOOK],
      );
      assert.deepEqual(await audienceOf(bare), {
        audience: "private",
        is_public: false,
      });
      // The old app's setting, on the profile, becomes the starting choice:
      // 公開 from now on, leaving the records kept before as they are...
      const startsAs = async () =>
        (
          await rows<{ records_audience: string }>(
            "select records_audience from reader_settings where user_id = $1",
            [DAI],
          )
        )[0]?.records_audience;
      await dai(
        "update profiles set reading_visibility = 'public' where id = $1",
        [DAI],
      );
      assert.equal(await startsAs(), "everyone");
      assert.equal((await audienceOf(bare)).audience, "private");
      // ...and 自分だけ narrowing them, as any narrower choice does.
      await dai(
        "update profiles set reading_visibility = 'private' where id = $1",
        [DAI],
      );
      assert.equal(await startsAs(), "private");
      assert.equal((await audienceOf(record)).audience, "private");
      // Writing the profile again without changing it changes nothing.
      await dai(
        "update reading_entries set audience = 'everyone' where id = $1",
        [record],
      );
      await dai(
        "update profiles set reading_visibility = 'private', bio = '本が好き' where id = $1",
        [DAI],
      );
      assert.equal((await audienceOf(record)).audience, "everyone");
      await dai("delete from reading_entries where user_id = $1", [DAI]);
    },
  );

  await db.close();

  // Undoing the move -------------------------------------------------------------------

  await check(
    "the rollback, as the header writes it, leaves the database as it was, and the move runs again",
    async () => {
      const earlier = await before();
      const { count: counted, rows: on } = helpers(earlier);
      const was = await catalog(earlier);
      const rowsWere = await everyRow(earlier);
      await earlier.exec(TEXT);
      // The indented lines after 「Rollback:」, up to the first that is not.
      const header = TEXT.slice(0, TEXT.indexOf("\n\n")).split("\n");
      const start = header.findIndex((line) => line.startsWith("-- Rollback:"));
      const rollback: string[] = [];
      for (const line of header.slice(start + 2)) {
        if (!line.startsWith("--   ")) break;
        rollback.push(line.slice(3));
      }
      const sql = rollback.join("\n");
      assert.match(sql, /drop column audience/);
      assert.match(sql, /comment on column/);
      await earlier.exec(sql);
      assert.deepEqual(await catalog(earlier), was);
      // The settings rows the move added stay, holding nothing but defaults;
      // every other row is as it was.
      const rowsNow = await everyRow(earlier);
      const settings = (all: Record<string, string[]>) =>
        all["public.reader_settings"].map((row) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { updated_at: _, ...rest } = JSON.parse(row);
          return rest;
        });
      assert.deepEqual(settings(rowsNow), [
        {
          user_id: AKI,
          memo_hint: true,
          library_hidden: [],
          spoiler_display: "fold_possible",
          likes_in_library: true,
          wanted_clears_on_status: false,
        },
        ...settings(rowsWere),
      ]);
      delete rowsNow["public.reader_settings"];
      delete rowsWere["public.reader_settings"];
      delete rowsNow["keep.copies"];
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(rowsNow).filter(([name]) => !name.startsWith("keep")),
        ),
        rowsWere,
      );
      // With the copy dropped, the move runs again as it did.
      await on("select private.drop_copy($1)", [LABEL]);
      await earlier.exec(TEXT);
      assert.equal(
        await counted(
          "select count(*) from reading_entries where audience = 'everyone'",
        ),
        1,
      );
      await earlier.close();
    },
  );

  await check(
    "a move whose check fails is rolled back whole, copy and all",
    async () => {
      const earlier = await before();
      const { count: counted } = helpers(earlier);
      const was = await catalog(earlier);
      const rowsWere = await everyRow(earlier);
      const spoiled = TEXT.replace(
        "set audience = case when is_public then 'everyone' else 'private' end;",
        "set audience = 'everyone';",
      );
      assert.notEqual(spoiled, TEXT);
      let error: unknown = null;
      try {
        await earlier.exec(spoiled);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /the move changed 2 reading records/);
      assert.deepEqual(await catalog(earlier), was);
      assert.deepEqual(await everyRow(earlier), rowsWere);
      assert.equal(
        await counted("select count(*) from keep.copies where label = $1", [
          LABEL,
        ]),
        0,
      );
      await earlier.close();
    },
  );

  console.log(passed + " visibility checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
