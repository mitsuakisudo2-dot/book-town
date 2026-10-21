import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// The town in one answer (AUD-006 6a; supabase/migrations/*_town_view.sql):
// town_view answers, as each reader who asks, exactly the rows the app read
// table by table before, in the same order, and town_books the books it
// names. Neither shows anything the tables did not: a visitor, a reader, one
// they blocked, a follower and a stranger each get what their own selects
// give. Who may call them, and undoing the file.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_town_view.sql"));
assert.ok(FILE, "the town view migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAN = "00000000-0000-4000-8000-00000000000d";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const AKI_SHOP = id(1, 1);
const BEN_SHOP = id(1, 2);
const LISTED = id(2, 1); // Aki's typed-in book, in a post anyone may read
const UNLISTED = id(2, 2); // Aki's typed-in book, used nowhere
const CHIS = id(2, 3); // Chi's, in a private note only
const AKI_POST = id(3, 1);
const BEN_POST = id(3, 2);
const CHI_NOTE = id(3, 3);
const REPLY = id(3, 4);
const FOLDED = id(3, 5);

// Each reader's own way of acting, as the app's requests do.
const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAN}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'),
    ('${CHI}', 'chi', 'チー'), ('${DAN}', 'dan', 'ダン');
  insert into books (id, title, author, source, created_by) values
    ('${LISTED}', '雨の本', 'アキ', 'manual', '${AKI}'),
    ('${UNLISTED}', '誰にも見せない本', 'アキ', 'manual', '${AKI}'),
    ('${CHIS}', 'チーの本', 'チー', 'manual', '${CHI}');
  insert into shops (id, owner_id, name, is_open) values
    ('${AKI_SHOP}', '${AKI}', 'アキの店', true),
    ('${BEN_SHOP}', '${BEN}', 'ベンの準備中の店', false);
  insert into profile_nine (profile_id, position, book_id, note) values
    ('${AKI}', 1, '${LISTED}', '最初の一冊');
  insert into shop_follows (follower_id, shop_id) values ('${BEN}', '${AKI_SHOP}');
  -- The database dates a post when it is saved (posts_stamp_time), and
  -- PGlite's clock moves by the millisecond, so two posts saved together
  -- could share a time: the times written here are kept instead.
  alter table posts disable trigger posts_stamp_time;
  insert into posts (id, author_id, body, book_id, created_at) values
    ('${AKI_POST}', '${AKI}', '雨の日に', '${LISTED}', now() - interval '3 hours'),
    ('${BEN_POST}', '${BEN}', 'こんにちは', null, now() - interval '2 hours'),
    ('${FOLDED}', '${BEN}', 'たたまれる便り', null, now() - interval '90 minutes');
  insert into posts (id, author_id, body, book_id, reading_mode, created_at) values
    ('${CHI_NOTE}', '${CHI}', 'ひとりのメモ', '${CHIS}', 'solo', now() - interval '1 hour');
  insert into posts (id, author_id, body, parent_id, created_at) values
    ('${REPLY}', '${BEN}', 'いいですね', '${AKI_POST}', now() - interval '30 minutes');
  alter table posts enable trigger posts_stamp_time;
  insert into post_reactions (user_id, post_id, kind) values
    ('${BEN}', '${AKI_POST}', 'like'), ('${BEN}', '${AKI_POST}', 'want'),
    ('${CHI}', '${BEN_POST}', 'like'), ('${AKI}', '${BEN_POST}', 'like'),
    ('${DAN}', '${BEN_POST}', 'want');
  insert into reading_entries (user_id, book_id, kind, body, audience) values
    ('${AKI}', '${LISTED}', 'finished', '読み終えた', 'everyone'),
    ('${AKI}', '${LISTED}', 'note', 'フォロワーにだけ', 'followers'),
    ('${AKI}', '${LISTED}', 'note', '自分だけ', 'private'),
    ('${CHI}', '${CHIS}', 'finished', 'チーの記録', 'everyone');
  insert into reading_sessions (user_id, book_id, mode) values
    ('${AKI}', '${LISTED}', 'together'),
    ('${BEN}', null, 'together'),
    ('${CHI}', null, 'solo');
  insert into reading_sessions (user_id, mode, ended_at) values
    ('${DAN}', 'together', now());
  insert into posters (author_id, template, pages, status) values
    ('${AKI}', 'text', '[{"blocks":[{"type":"text","text":"夜に"}]}]', 'published'),
    ('${AKI}', 'text', '[{"blocks":[{"type":"text","text":"夜に"}]}]', 'draft'),
    ('${BEN}', 'text', '[{"blocks":[{"type":"text","text":"夜に"}]}]', 'published');
  insert into moderation_folds (target_kind, target_id, state, owner_id) values
    ('post', '${FOLDED}', 'folded', '${BEN}'),
    ('post', '${BEN_POST}', 'held', '${BEN}');
  insert into blocks (blocker_id, blocked_id) values ('${DAN}', '${AKI}');
`;

/** A database with every migration up to this one's file, and the town. */
async function before(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
    await db.exec(migrationText(file));
  await db.exec(SEED);
  return db;
}

type Visitor = string | null;

const BOOK = `id, isbn, title, author, publisher, price, source, work_id, created_at, updated_at`;

/**
 * What the app read table by table (src/lib/supabase/town-backend.ts before
 * this file), as each reader: the same selects, filters and order.
 */
const BY_TABLES: Record<string, (reader: Visitor) => string> = {
  profiles: () =>
    "select to_jsonb(p) as row from profiles p order by created_at, id",
  nine: () =>
    "select to_jsonb(n) as row from profile_nine n order by profile_id, position",
  shops: () =>
    `select to_jsonb(s) as row from (select id, owner_id, name, description,
       tagline, theme, is_open, public_shelves, public_scene_books, created_at
       from shops order by created_at, id) s`,
  posts: () =>
    "select to_jsonb(p) as row from (select * from posts order by created_at desc, id desc limit 500) p",
  post_reactions: (reader) =>
    reader === null
      ? "select null::jsonb as row where false"
      : "select to_jsonb(r) as row from post_reactions r order by user_id, post_id, kind",
  together: (reader) =>
    `select to_jsonb(t) as row from reading_sessions t
     where mode = 'together' and ended_at is null
     ${reader === null ? "" : `and user_id <> '${reader}'`} order by id`,
  records: () => "select to_jsonb(e) as row from reading_entries e order by id",
  folds: () =>
    `select to_jsonb(f) as row from (select target_kind, target_id, state, since
       from moderation_folds order by target_kind, target_id) f`,
  posters: () => "select to_jsonb(x) as row from posters x order by id",
  catalog: () =>
    `select to_jsonb(c) as row from (select ${BOOK} from books
       order by created_at desc, id desc limit 300) c`,
};

function helpers(db: PGlite) {
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
  async function view(visitor: Visitor, args = "") {
    const [{ view }] = await as<{ view: Record<string, unknown[]> }>(
      visitor,
      `select town_view(${args}) as view`,
    );
    return view;
  }
  async function tables(visitor: Visitor) {
    const out: Record<string, unknown[]> = {};
    for (const [key, sql] of Object.entries(BY_TABLES))
      out[key] = (await as<{ row: unknown }>(visitor, sql(visitor))).map(
        (r) => r.row,
      );
    return out;
  }
  async function books(visitor: Visitor, ids: string[]) {
    const [{ books }] = await as<{ books: { id: string }[] }>(
      visitor,
      "select town_books($1::uuid[]) as books",
      [ids],
    );
    return books;
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
  return { as, view, tables, books, refused };
}

/** The first comment's rollback statements, lines starting "--   ". */
function rollbackSql(): string {
  return TEXT.slice(0, TEXT.indexOf("\n\n"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(5))
    .join("\n");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await before();
  const schemaBefore = await db.query<{ name: string }>(
    `select table_schema || '.' || table_name || '.' || column_name as name
     from information_schema.columns
     where table_schema in ('public', 'private') order by 1`,
  );
  await db.exec(TEXT);
  const { as, view, tables, books, refused } = helpers(db);

  for (const [who, reader] of [
    ["a visitor", null],
    ["a reader with a shop", AKI],
    ["a follower", BEN],
    ["a reader with a private note", CHI],
    ["a reader who blocked someone", DAN],
  ] as const)
    await check(
      `${who} gets from town_view what their own selects give`,
      async () => {
        const got = await view(reader);
        const want = await tables(reader);
        assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
        for (const key of Object.keys(want))
          assert.deepEqual(got[key], want[key], `${who}: ${key}`);
      },
    );

  await check("nothing private reaches anyone but its owner", async () => {
    for (const who of [null, BEN, CHI, DAN]) {
      const bodies = ((await view(who)).records as { body: string }[]).map(
        (r) => r.body,
      );
      assert.ok(
        !bodies.includes("自分だけ"),
        "a private record is its reader's",
      );
    }
    assert.ok(
      ((await view(AKI)).records as { body: string }[]).some(
        (r) => r.body === "自分だけ",
      ),
    );
    const visitor = await view(null);
    assert.deepEqual(
      (visitor.records as { body: string }[]).map((r) => r.body).sort(),
      ["チーの記録", "読み終えた"],
    );
    const posts = (visitor.posts as { id: string }[]).map((p) => p.id);
    assert.ok(!posts.includes(CHI_NOTE), "a private note is its writer's");
    assert.ok(
      (await view(CHI)).posts.some(
        (p) => (p as { id: string }).id === CHI_NOTE,
      ),
    );
    assert.deepEqual(
      visitor.post_reactions,
      [],
      "a visitor reads no reactions",
    );
    const aki = await view(AKI);
    assert.equal(
      (aki.posters as unknown[]).length,
      3,
      "Aki reads her draft and the posters put up",
    );
    assert.equal(
      (visitor.posters as unknown[]).length,
      2,
      "nobody else reads a draft",
    );
    const held = (r: Record<string, unknown[]>) =>
      (r.folds as { state: string }[]).filter((f) => f.state === "held").length;
    assert.equal(held(await view(BEN)), 1, "the held 便り is its writer's");
    assert.equal(held(aki), 0);
  });

  await check(
    "a reader reads their own reactions and those on their own 便り",
    async () => {
      const reactions = (await view(BEN)).post_reactions as {
        user_id: string;
        post_id: string;
      }[];
      assert.deepEqual(
        reactions
          .map((r) => `${r.user_id.slice(-1)}:${r.post_id.slice(-1)}`)
          .sort(),
        ["a:2", "b:1", "b:1", "c:2", "d:2"],
      );
      const shared = (await view(CHI)).post_reactions as { user_id: string }[];
      assert.deepEqual(
        shared.map((r) => r.user_id),
        [CHI],
        "only Chi's own",
      );
    },
  );

  await check(
    "reading together leaves out the reader's own and the ended",
    async () => {
      const together = (who: Visitor) =>
        view(who).then((v) =>
          (v.together as { user_id: string }[]).map((t) => t.user_id).sort(),
        );
      assert.deepEqual(await together(null), [AKI, BEN]);
      assert.deepEqual(await together(AKI), [BEN]);
    },
  );

  await check(
    "without record notes, others' records come without their words, the reader's own with them",
    async () => {
      const words = async (who: Visitor) =>
        (
          (await view(who, "record_notes => false")).records as {
            user_id: string;
            body: string;
          }[]
        )
          .map((r) => `${r.user_id.slice(-1)}:${r.body}`)
          .sort();
      assert.deepEqual(await words(null), ["a:", "c:"]);
      assert.deepEqual(await words(AKI), [
        "a:フォロワーにだけ",
        "a:自分だけ",
        "a:読み終えた",
        "c:",
      ]);
      // Everything else of a record is as before.
      const strip = (records: unknown[]) =>
        (records as Record<string, unknown>[]).map((r) => ({
          ...r,
          body: "",
        }));
      for (const who of [null, BEN, CHI])
        assert.deepEqual(
          strip((await view(who, "record_notes => false")).records),
          strip((await view(who)).records),
        );
    },
  );

  await check(
    "the newest 便り and books come up to the limits asked",
    async () => {
      const small = await view(null, "post_limit => 2, catalog_limit => 1");
      assert.deepEqual(
        (small.posts as { id: string }[]).map((p) => p.id),
        [REPLY, FOLDED],
      );
      assert.equal((small.catalog as unknown[]).length, 1);
      const none = await view(null, "post_limit => -5, catalog_limit => 0");
      assert.deepEqual(none.posts, []);
      assert.deepEqual(none.catalog, []);
    },
  );

  await check(
    "town_books answers only the books the reader may read",
    async () => {
      const ids = [LISTED, UNLISTED, CHIS, id(9, 9)];
      const visible = async (who: Visitor) =>
        (await books(who, ids)).map((b) => b.id).sort();
      const direct = async (who: Visitor) =>
        (
          await as<{ id: string }>(
            who,
            "select id from books where id = any($1::uuid[]) order by id",
            [ids],
          )
        ).map((b) => b.id);
      for (const who of [null, AKI, BEN, CHI])
        assert.deepEqual(await visible(who), await direct(who));
      for (const who of [null, BEN, CHI])
        assert.ok(
          !(await visible(who)).includes(UNLISTED),
          "a typed-in book used nowhere public is its typist's",
        );
      assert.ok((await visible(AKI)).includes(UNLISTED));
      const [book] = await books(null, [LISTED]);
      assert.deepEqual(Object.keys(book).sort(), BOOK.split(", ").sort());
      assert.ok(!("created_by" in book), "who typed a book in is not shown");
    },
  );

  await check(
    "anyone may call both, signed in or not; they run as the caller",
    async () => {
      const [grants] = await as<{
        view: boolean;
        books: boolean;
        definer: boolean;
      }>(
        null,
        `select has_function_privilege('anon', 'public.town_view(integer, integer, boolean)', 'execute') as view,
         has_function_privilege('anon', 'public.town_books(uuid[])', 'execute') as books,
         bool_or(prosecdef) as definer
       from pg_proc where proname in ('town_view', 'town_books')`,
      );
      assert.deepEqual(grants, { view: true, books: true, definer: false });
      await db.exec("create role nobody nologin");
      const [nobody] = (
        await db.query<{ can: boolean }>(
          "select has_function_privilege('nobody', 'public.town_view(integer, integer, boolean)', 'execute') as can",
        )
      ).rows;
      assert.equal(nobody.can, false, "not opened to every role");
    },
  );

  await check(
    "the rollback, as the header writes it, leaves the database as it was",
    async () => {
      await db.exec(rollbackSql());
      const left = await db.query<{ n: number }>(
        "select count(*)::int as n from pg_proc where proname in ('town_view', 'town_books')",
      );
      assert.equal(left.rows[0].n, 0);
      const schemaAfter = await db.query<{ name: string }>(
        `select table_schema || '.' || table_name || '.' || column_name as name
       from information_schema.columns
       where table_schema in ('public', 'private') order by 1`,
      );
      assert.deepEqual(
        schemaAfter.rows,
        schemaBefore.rows,
        "no table or column changed",
      );
      await refused(() => view(null), "town_view is gone");
    },
  );

  console.log(`${passed} town view checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
