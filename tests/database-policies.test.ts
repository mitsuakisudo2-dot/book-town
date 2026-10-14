import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { auto_explain } from "@electric-sql/pglite/contrib/auto_explain";
import { demoBooks } from "../src/lib/data";
import {
  ENCOUNTER_MEMO_MAX_LENGTH,
  ENTRY_SOURCES,
  type LibraryEntry,
} from "../src/lib/library";
import { sampleBookRowId } from "../src/lib/samples";
import { REPORT_COLUMNS } from "../src/lib/supabase/reports";
import { pagePattern } from "../src/lib/supabase/site-notes";
import {
  entryOf,
  type EntryPart,
  LIBRARY_CASES,
} from "./fixtures/library-cases";

// Runs the Supabase migrations on an in-memory Postgres and checks, as each kind of
// visitor, that the row level security policies allow and refuse the right things.
// Everything runs inside main() because tsx compiles this file as CommonJS.

async function main() {
  const db = new PGlite();

  // The parts of Supabase the migrations rely on: its roles, auth.users and auth.uid().
  const supabase = `
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- What Supabase gives anything new in public until a migration says otherwise.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `;
  await db.exec(supabase);

  const migrations = join(__dirname, "..", "supabase", "migrations");
  const files = readdirSync(migrations).sort();
  const migrate = (file: string) =>
    readFileSync(join(migrations, file), "utf8");
  for (const file of files) await db.exec(migrate(file));

  const AKI = "00000000-0000-4000-8000-00000000000a";
  const BEN = "00000000-0000-4000-8000-00000000000b";
  const CHI = "00000000-0000-4000-8000-00000000000c";

  type Visitor = string | null;

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
    reason?: RegExp,
  ) {
    let error: unknown = null;
    try {
      await as(visitor, sql, params);
    } catch (caught) {
      error = caught;
    }
    assert.ok(
      error instanceof Error,
      "expected the database to refuse: " + sql,
    );
    if (reason) assert.match(error.message, reason);
  }

  /** Updates and deletes that a policy hides affect no rows rather than failing. */
  async function affects(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ) {
    return (await as(visitor, sql + " returning 1", params)).length;
  }

  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // Three people sign up. Aki opens a shop; Ben's shop stays closed.
  await db.exec(
    `insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}')`,
  );
  for (const [id, handle] of [
    [AKI, "aki"],
    [BEN, "ben"],
    [CHI, "chi"],
  ])
    await as(
      id,
      "insert into profiles (id, handle, name) values ($1, $2, $3)",
      [id, handle, handle.toUpperCase()],
    );

  const [book] = await as<{ id: string }>(
    AKI,
    "insert into books (title, author, isbn, created_by) values ('華氏451度', 'レイ・ブラッドベリ', '9784150119553', $1) returning id",
    [AKI],
  );
  const [akiShop] = await as<{ id: string }>(
    AKI,
    "insert into shops (owner_id, name, is_open) values ($1, '夜の本屋', true) returning id",
    [AKI],
  );
  // The owner writes every shelf here; the database copies the public ones.
  await as(
    AKI,
    `insert into shop_private (shop_id, shelves) values ($1,
     '[{"id":"s1","name":"旅","isPublic":true},{"id":"s2","name":"秘密の棚","isPublic":false}]')`,
    [akiShop.id],
  );
  const [benShop] = await as<{ id: string }>(
    BEN,
    "insert into shops (owner_id, name) values ($1, '準備中の本屋') returning id",
    [BEN],
  );

  await check(
    "every public table has row level security turned on",
    async () => {
      const open = await db.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
      );
      assert.deepEqual(open.rows, []);
      const anonWrites = await db.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
         where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT'`,
      );
      assert.deepEqual(anonWrites.rows, []);
    },
  );

  await check(
    "visitors who are not logged in read public things only",
    async () => {
      assert.equal((await as(null, "select * from profiles")).length, 3);
      // Aki's book is used nowhere yet: a typed-in book is its reader's own
      // until it is shown (hide_registered_titles, below).
      assert.equal((await as(null, "select id, title from books")).length, 0);
      const shops = await as<{ name: string }>(null, "select name from shops");
      assert.deepEqual(
        shops.map((shop) => shop.name),
        ["夜の本屋"],
      );
      await refused(
        null,
        "select * from shop_private",
        [],
        /permission denied/,
      );
      await refused(null, "select * from book_marks", [], /permission denied/);
      await refused(
        null,
        "insert into posts (author_id, body) values ($1, 'hi')",
        [AKI],
        /permission denied/,
      );
    },
  );

  await check("a closed shop is visible to its owner only", async () => {
    assert.equal((await as(BEN, "select * from shops")).length, 2);
    assert.equal((await as(CHI, "select * from shops")).length, 1);
    await refused(
      CHI,
      "insert into shop_follows (follower_id, shop_id) values ($1, $2)",
      [CHI, benShop.id],
      /row-level security/,
    );
  });

  await check("private shelves never reach anyone but the owner", async () => {
    assert.equal((await as(AKI, "select * from shop_private")).length, 1);
    assert.equal((await as(BEN, "select * from shop_private")).length, 0);
    assert.equal(
      await affects(
        BEN,
        "update shop_private set shelves = '[]' where shop_id = $1",
        [akiShop.id],
      ),
      0,
    );
    await refused(
      BEN,
      "insert into shop_private (shop_id) values ($1)",
      [akiShop.id],
      /row-level security/,
    );
  });

  await check(
    "nobody edits another person's profile, shop or book",
    async () => {
      assert.equal(
        await affects(BEN, "update profiles set name = 'x' where id = $1", [
          AKI,
        ]),
        0,
      );
      assert.equal(
        await affects(BEN, "update shops set name = 'x' where id = $1", [
          akiShop.id,
        ]),
        0,
      );
      assert.equal(
        await affects(BEN, "delete from shops where id = $1", [akiShop.id]),
        0,
      );
      assert.equal(
        await affects(BEN, "update books set title = 'x' where id = $1", [
          book.id,
        ]),
        0,
      );
      await refused(
        BEN,
        "update profiles set id = $1 where id = $2",
        [CHI, BEN],
        /row-level security|foreign key|duplicate/,
      );
      await refused(
        BEN,
        "insert into profiles (id, handle, name) values ($1, 'ben2', 'B')",
        [CHI],
        /row-level security/,
      );
      await refused(
        BEN,
        "insert into shops (owner_id, name) values ($1, 'なりすまし')",
        [CHI],
        /row-level security/,
      );
    },
  );

  await check(
    "the life nine is public and edited by its owner only",
    async () => {
      await as(
        AKI,
        "insert into profile_nine (profile_id, position, book_id, note) values ($1, 1, $2, '最初の一冊')",
        [AKI, book.id],
      );
      assert.equal((await as(null, "select * from profile_nine")).length, 1);
      await refused(
        BEN,
        "insert into profile_nine (profile_id, position, book_id) values ($1, 2, $2)",
        [AKI, book.id],
        /row-level security/,
      );
      assert.equal(
        await affects(
          BEN,
          "update profile_nine set note = 'x' where profile_id = $1",
          [AKI],
        ),
        0,
      );
      assert.equal(
        await affects(BEN, "delete from profile_nine where profile_id = $1", [
          AKI,
        ]),
        0,
      );
    },
  );

  await check("the life nine is replaced in one step", async () => {
    const [second] = await as<{ id: string }>(
      AKI,
      "insert into books (title, created_by) values ('砂の女', $1) returning id",
      [AKI],
    );
    const nine = async (who: string) =>
      (
        await as<{ book_id: string; note: string }>(
          null,
          "select book_id, note from profile_nine where profile_id = $1 order by position",
          [who],
        )
      ).map((row) => [row.book_id, row.note]);
    await as(AKI, "select replace_profile_nine($1, $2)", [
      [second.id, book.id],
      ["二冊目", "一冊目"],
    ]);
    assert.deepEqual(await nine(AKI), [
      [second.id, "二冊目"],
      [book.id, "一冊目"],
    ]);
    // Swapping two books never trips the one-book-once rule halfway.
    await as(AKI, "select replace_profile_nine($1, $2)", [
      [book.id, second.id],
      ["一冊目", ""],
    ]);
    assert.deepEqual(await nine(AKI), [
      [book.id, "一冊目"],
      [second.id, ""],
    ]);
    await refused(
      AKI,
      "select replace_profile_nine($1, $2)",
      [Array(10).fill(book.id), Array(10).fill("")],
      /up to nine/,
    );
    await refused(
      AKI,
      "select replace_profile_nine($1, $2)",
      [[book.id], []],
      /up to nine/,
    );
    await refused(
      AKI,
      "select replace_profile_nine($1, $2)",
      [[book.id], ["x".repeat(501)]],
      /check constraint/,
    );
    assert.deepEqual(await nine(AKI), [
      [book.id, "一冊目"],
      [second.id, ""],
    ]);
    await refused(
      null,
      "select replace_profile_nine($1, $2)",
      [[book.id], [""]],
      /permission denied/,
    );
    await as(BEN, "select replace_profile_nine($1, $2)", [
      [second.id],
      ["ベンの一冊"],
    ]);
    assert.deepEqual(await nine(BEN), [[second.id, "ベンの一冊"]]);
    assert.equal((await nine(AKI)).length, 2);
    await as(BEN, "select replace_profile_nine($1, $2)", [[], []]);
    assert.deepEqual(await nine(BEN), []);
  });

  await check("one shop per person for now", async () => {
    await refused(
      AKI,
      "insert into shops (owner_id, name) values ($1, '二軒目')",
      [AKI],
      /duplicate key/,
    );
  });

  await check(
    "handles, links and texts are checked by the database too",
    async () => {
      await refused(
        CHI,
        "update profiles set handle = 'Aki' where id = $1",
        [CHI],
        /check constraint/,
      );
      await refused(
        CHI,
        "update profiles set handle = 'aki' where id = $1",
        [CHI],
        /duplicate key/,
      );
      await refused(
        CHI,
        "update profiles set handle = 'booktown' where id = $1",
        [CHI],
        /check constraint/,
      );
      await refused(
        CHI,
        "update profiles set links = array['javascript:alert(1)'] where id = $1",
        [CHI],
        /check constraint/,
      );
      await refused(
        CHI,
        "update profiles set links = array['https://note.com/a', 'https://note.com/a'] where id = $1",
        [CHI],
        /check constraint/,
      );
      assert.equal(
        await affects(
          CHI,
          "update profiles set links = array['https://note.com/chi', 'http://example.jp/?q=1'] where id = $1",
          [CHI],
        ),
        1,
      );
      await refused(
        CHI,
        "update profiles set name = '   ' where id = $1",
        [CHI],
        /check constraint/,
      );
      await refused(
        CHI,
        "insert into posts (author_id, body) values ($1, repeat('あ', 1001))",
        [CHI],
        /check constraint/,
      );
      // Only the database writes the public copies, so check their limits directly.
      await assert.rejects(
        db.query(
          "update shops set public_scene = jsonb_build_object('pad', repeat('x', 600000)) where owner_id = $1",
          [AKI],
        ),
        /check constraint/,
      );
      await assert.rejects(
        db.query("update shops set public_shelves = '{}' where owner_id = $1", [
          AKI,
        ]),
        /check constraint/,
      );
      await refused(
        AKI,
        "update shop_private set shelves = jsonb_build_array(repeat('x', 300000)) where shop_id = $1",
        [akiShop.id],
        /check constraint/,
      );
    },
  );

  await check(
    "the database copies the public shelves; owners cannot write them",
    async () => {
      const publicShelves = async () =>
        (
          await as<{ public_shelves: { id: string }[] }>(
            CHI,
            "select public_shelves from shops where id = $1",
            [akiShop.id],
          )
        )[0].public_shelves.map((shelf) => shelf.id);
      assert.deepEqual(await publicShelves(), ["s1"]);
      await as(
        AKI,
        `update shop_private set shelves = '[
          {"id":"s3","name":"新しい棚","isPublic":true},
          {"id":"s2","name":"秘密の棚","isPublic":false},
          "not a shelf",
          {"id":"s1","name":"旅","isPublic":true},
          {"id":"s4","name":"下書き","isPublic":"true"}
        ]' where shop_id = $1`,
        [akiShop.id],
      );
      assert.deepEqual(await publicShelves(), ["s3", "s1"]);
      await refused(
        AKI,
        'update shops set public_shelves = \'[{"id":"s2","isPublic":true}]\' where id = $1',
        [akiShop.id],
        /permission denied/,
      );
      await refused(
        AKI,
        "update shops set public_scene = '{}' where id = $1",
        [akiShop.id],
        /permission denied/,
      );
      await refused(
        CHI,
        `insert into shops (owner_id, name, public_shelves)
         values ($1, '偽の棚', '[{"id":"x","isPublic":true}]')`,
        [CHI],
        /permission denied/,
      );
      assert.equal(
        await affects(
          AKI,
          "update shops set name = '夜の本屋', tagline = 'ようこそ', is_open = true where id = $1",
          [akiShop.id],
        ),
        1,
      );
      // Nobody else's write reaches the copy either.
      assert.equal(
        await affects(
          BEN,
          `update shop_private set shelves = '[{"id":"x","isPublic":true}]' where shop_id = $1`,
          [akiShop.id],
        ),
        0,
      );
      assert.deepEqual(await publicShelves(), ["s3", "s1"]);
      await as(
        AKI,
        `update shop_private set shelves = '[
          {"id":"s1","name":"旅","isPublic":true},
          {"id":"s2","name":"秘密の棚","isPublic":false}
        ]' where shop_id = $1`,
        [akiShop.id],
      );
      assert.deepEqual(await publicShelves(), ["s1"]);
    },
  );

  await check(
    "the database copies the public part of the store scene",
    async () => {
      const scene = {
        schemaVersion: 1,
        storeId: "mine",
        objects: [
          { id: "shelf", kind: "furniture", parentId: null },
          { id: "row-open", kind: "row", parentId: "shelf", isPublic: true },
          { id: "row-closed", kind: "row", parentId: "shelf" },
          { id: "b1", kind: "book", bookId: "book-1", parentId: "row-open" },
          { id: "pop:b1", kind: "bookPop", parentId: "b1", text: "旅に" },
          {
            id: "b2",
            kind: "book",
            bookId: "book-2",
            parentId: "row-open",
            isPublic: false,
          },
          { id: "pop:b2", kind: "bookPop", parentId: "b2", text: "秘密" },
          { id: "b3", kind: "book", bookId: "book-3", parentId: "row-closed" },
          { id: "b4", kind: "book", bookId: "book-4", parentId: null },
          { id: "note", kind: "label", parentId: null, placed: false },
          { id: "sign", kind: "sign", parentId: null, text: "夜の本屋" },
        ],
      };
      const publicScene = async () =>
        (
          await as<{
            public_scene: { storeId: string; objects: { id: string }[] } | null;
          }>(CHI, "select public_scene from shops where id = $1", [akiShop.id])
        )[0].public_scene;
      await as(AKI, "update shop_private set scene = $2 where shop_id = $1", [
        akiShop.id,
        JSON.stringify(scene),
      ]);
      const copy = await publicScene();
      assert.equal(copy?.storeId, akiShop.id);
      // Each side lists the books it shows, so the town can load just those.
      assert.deepEqual(
        (
          await as<{ public_scene_books: string[] }>(
            CHI,
            "select public_scene_books from shops where id = $1",
            [akiShop.id],
          )
        )[0].public_scene_books,
        ["book-1"],
      );
      assert.deepEqual(
        (
          await as<{ scene_books: string[] }>(
            AKI,
            "select scene_books from shop_private where shop_id = $1",
            [akiShop.id],
          )
        )[0].scene_books,
        ["book-1", "book-2", "book-3", "book-4"],
      );
      assert.deepEqual(
        copy?.objects.map((o) => o.id),
        ["shelf", "row-open", "b1", "pop:b1", "sign"],
      );
      // The whole scene stays with the owner.
      assert.equal(
        (
          await as<{ scene: { objects: unknown[] } }>(
            AKI,
            "select scene from shop_private where shop_id = $1",
            [akiShop.id],
          )
        )[0].scene.objects.length,
        scene.objects.length,
      );
      assert.equal((await as(CHI, "select scene from shop_private")).length, 0);
      await as(AKI, "update shop_private set scene = null where shop_id = $1", [
        akiShop.id,
      ]);
      assert.equal(await publicScene(), null);
    },
  );

  await check("books typed in by hand belong to their writer", async () => {
    await refused(
      BEN,
      "insert into books (title, created_by) values ('なりすまし', $1)",
      [AKI],
      /row-level security/,
    );
    await refused(
      BEN,
      "insert into books (title, source, created_by) values ('目録', 'ndl', $1)",
      [BEN],
      /row-level security/,
    );
    await refused(
      BEN,
      "insert into books (title, isbn, created_by) values ('誤り', '9784150119554', $1)",
      [BEN],
      /check constraint/,
    );
    // A second hand-typed entry with the same ISBN is allowed.
    assert.equal(
      (
        await as(
          BEN,
          "insert into books (title, isbn, created_by) values ('華氏451度', '9784150119553', $1) returning id",
          [BEN],
        )
      ).length,
      1,
    );
  });

  await check(
    "who typed a book in, and who blocked whom, cannot be asked",
    async () => {
      // Everyone reads the catalog, but not who typed each book in.
      for (const visitor of [null, AKI, BEN])
        await refused(
          visitor,
          "select created_by from books",
          [],
          /permission/,
        );
      assert.equal(
        (
          await as(
            null,
            "select id, isbn, title, author, publisher, price, source, created_at, updated_at from books where id = $1",
            [book.id],
          )
        ).length,
        1,
      );
      // A new book is saved the way the app does it, twice without harm, and
      // only the one who typed it in can fix it.
      const typed = "00000000-0000-4000-8000-0000000000b1";
      // (The shape below is the statement the API builds for the app's upsert.)
      for (let time = 0; time < 2; time++)
        await as(
          BEN,
          `with saved as (
             insert into books (id, title, created_by)
             select id, title, created_by
             from json_populate_recordset(null::books, $1) as row
             on conflict (id) do nothing
             returning 1
           ) select count(*) from saved`,
          [JSON.stringify([{ id: typed, title: "砂丘", created_by: BEN }])],
        );
      assert.equal(
        await affects(BEN, "update books set title = '砂の丘' where id = $1", [
          typed,
        ]),
        1,
      );
      assert.equal(
        await affects(AKI, "update books set title = '横取り' where id = $1", [
          typed,
        ]),
        0,
      );
      await db.exec(`delete from books where id = '${typed}'`);
      // Whether someone blocked you is not a question anyone can call.
      for (const visitor of [null, AKI]) {
        await refused(visitor, "select public.is_blocked_with($1)", [BEN]);
        await refused(visitor, "select private.end_follows_on_block()", []);
      }
      // Visits are only ever the signed-in reader's own.
      await refused(null, "select * from shop_visits", [], /permission/);
      await refused(AKI, "truncate shop_visits", [], /permission/);
      // Anything added to public later is closed until a migration opens it.
      await db.exec(
        "create table public.added_later (id int); create function public.added_later_fn() returns int language sql as 'select 1';",
      );
      for (const visitor of [null, AKI]) {
        await refused(visitor, "select * from added_later", [], /permission/);
        await refused(visitor, "select added_later_fn()", [], /permission/);
      }
      await db.exec(
        "drop table public.added_later; drop function public.added_later_fn();",
      );
    },
  );

  const [akiNote] = await as<{ id: string }>(
    AKI,
    "insert into posts (author_id, body, book_id, reading_mode) values ($1, 'ひとりのメモ', $2, 'solo') returning id",
    [AKI, book.id],
  );
  const [akiReview] = await as<{ id: string }>(
    AKI,
    "insert into posts (author_id, body, book_id) values ($1, '燃やされる本の話', $2) returning id",
    [AKI, book.id],
  );
  const [akiChat] = await as<{ id: string }>(
    AKI,
    "insert into posts (author_id, body) values ($1, '今日は雨') returning id",
    [AKI],
  );

  await check("posts are dated by the database", async () => {
    const [post] = await as<{ id: string; created_at: string }>(
      AKI,
      "insert into posts (author_id, body, created_at) values ($1, '未来から', '2099-01-01') returning id, created_at",
      [AKI],
    );
    assert.ok(new Date(post.created_at).getFullYear() < 2099);
    await as(AKI, "delete from posts where id = $1", [post.id]);
  });

  await check("solo reading notes stay private", async () => {
    const mine = await as(AKI, "select id from posts where id = $1", [
      akiNote.id,
    ]);
    assert.equal(mine.length, 1);
    assert.equal(
      (await as(BEN, "select id from posts where id = $1", [akiNote.id]))
        .length,
      0,
    );
    assert.equal(
      (await as(null, "select id from posts where id = $1", [akiNote.id]))
        .length,
      0,
    );
    await refused(
      BEN,
      "insert into posts (author_id, body, parent_id) values ($1, '返信', $2)",
      [BEN, akiNote.id],
      /not found/,
    );
    await refused(
      AKI,
      "insert into posts (author_id, body, parent_id) values ($1, '自分に返信', $2)",
      [AKI, akiNote.id],
      /private notes/,
    );
  });

  await check(
    "replies are one level deep and posts are written as yourself",
    async () => {
      const [reply] = await as<{ id: string }>(
        BEN,
        "insert into posts (author_id, body, parent_id) values ($1, 'いいですね', $2) returning id",
        [BEN, akiReview.id],
      );
      await refused(
        CHI,
        "insert into posts (author_id, body, parent_id) values ($1, '孫返信', $2)",
        [CHI, reply.id],
        /one level deep/,
      );
      await refused(
        BEN,
        "insert into posts (author_id, body) values ($1, 'なりすまし')",
        [AKI],
        /row-level security/,
      );
      await refused(
        BEN,
        "insert into posts (author_id, body, spoiler) values ($1, '結末は', true)",
        [BEN],
        /check constraint/,
      );
      assert.equal(
        await affects(BEN, "delete from posts where id = $1", [akiReview.id]),
        0,
      );
      // Words cannot change after posting, not even by their author.
      await refused(
        AKI,
        "update posts set body = '書き換え' where id = $1",
        [akiReview.id],
        /permission/,
      );
    },
  );

  await check(
    "reactions are seen by the reactor and the author only",
    async () => {
      await as(
        BEN,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like'), ($1, $2, 'want')",
        [BEN, akiReview.id],
      );
      assert.equal(
        (
          await as(AKI, "select * from post_reactions where post_id = $1", [
            akiReview.id,
          ])
        ).length,
        2,
      );
      assert.equal(
        (
          await as(BEN, "select * from post_reactions where post_id = $1", [
            akiReview.id,
          ])
        ).length,
        2,
      );
      assert.equal(
        (
          await as(CHI, "select * from post_reactions where post_id = $1", [
            akiReview.id,
          ])
        ).length,
        0,
      );
      await refused(
        AKI,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'want')",
        [AKI, akiReview.id],
        /row-level security/,
      );
      await refused(
        BEN,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'want')",
        [BEN, akiChat.id],
        /row-level security/,
      );
      await refused(
        BEN,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like')",
        [BEN, akiNote.id],
        /row-level security/,
      );
      await refused(
        CHI,
        "insert into post_reactions (user_id, post_id, kind) values ($1, $2, 'like')",
        [BEN, akiChat.id],
        /row-level security/,
      );
    },
  );

  await check(
    "a like is pressed again up to ten times, and only by its reader",
    async () => {
      const taps = async (visitor: Visitor) =>
        (
          await as<{ taps: number }>(
            visitor,
            "select taps from post_reactions where user_id = $1 and post_id = $2 and kind = 'like'",
            [BEN, akiReview.id],
          )
        )[0]?.taps;
      assert.equal(await taps(BEN), 1);
      const press = (visitor: string, count: number) =>
        affects(
          visitor,
          "update post_reactions set taps = $3 where user_id = $1 and post_id = $2 and kind = 'like'",
          [BEN, akiReview.id, count],
        );
      assert.equal(await press(BEN, 7), 1);
      // The writer sees how many; nobody else does, nor changes it.
      assert.equal(await taps(AKI), 7);
      assert.equal(await taps(CHI), undefined);
      assert.equal(await press(CHI, 10), 0);
      assert.equal(await press(AKI, 10), 0);
      assert.equal(await taps(BEN), 7);
      await refused(
        BEN,
        "update post_reactions set taps = 11 where user_id = $1 and post_id = $2 and kind = 'like'",
        [BEN, akiReview.id],
        /check constraint/,
      );
      // 読みたくなった is pressed once.
      await refused(
        BEN,
        "update post_reactions set taps = 2 where user_id = $1 and post_id = $2 and kind = 'want'",
        [BEN, akiReview.id],
        /check constraint/,
      );
      // Only the count changes, never whose or which post it is.
      await refused(
        BEN,
        "update post_reactions set post_id = $2 where user_id = $1 and kind = 'like'",
        [BEN, akiChat.id],
        /permission/,
      );
      await press(BEN, 1);
    },
  );

  await check(
    "spoiler reports go on other people's unmarked posts",
    async () => {
      await as(
        BEN,
        "insert into spoiler_reports (reporter_id, post_id) values ($1, $2)",
        [BEN, akiReview.id],
      );
      assert.equal((await as(AKI, "select * from spoiler_reports")).length, 0);
      await refused(
        AKI,
        "insert into spoiler_reports (reporter_id, post_id) values ($1, $2)",
        [AKI, akiReview.id],
        /row-level security/,
      );
    },
  );

  await check(
    "three 「ネタバレでは？」 fold a post for everyone, and its writer can mark it",
    async () => {
      const EMI = "00000000-0000-4000-8000-00000000000e";
      await db.exec(`insert into auth.users (id) values ('${EMI}')`);
      await as(
        EMI,
        "insert into profiles (id, handle, name) values ($1, 'emi', 'EMI')",
        [EMI],
      );
      const [post] = await as<{ id: string }>(
        AKI,
        "insert into posts (author_id, body, book_id) values ($1, '最後の場面で泣いた', $2) returning id",
        [AKI, book.id],
      );
      const folded = async (visitor: Visitor) =>
        (
          await as<{ spoiler_folded: boolean }>(
            visitor,
            "select spoiler_folded from posts where id = $1",
            [post.id],
          )
        )[0]?.spoiler_folded;
      const ask = (visitor: string) =>
        as(
          visitor,
          "insert into spoiler_reports (reporter_id, post_id) values ($1, $2)",
          [visitor, post.id],
        );
      await ask(BEN);
      await ask(CHI);
      assert.equal(await folded(null), false);
      await ask(EMI);
      // Folded, not hidden: everyone still gets the post, and who asked stays theirs.
      assert.equal(await folded(null), true);
      assert.equal(await folded(AKI), true);
      assert.equal(
        (
          await as(AKI, "select * from spoiler_reports where post_id = $1", [
            post.id,
          ])
        ).length,
        0,
      );
      // Taking a question back can unfold it.
      await as(
        CHI,
        "delete from spoiler_reports where reporter_id = $1 and post_id = $2",
        [CHI, post.id],
      );
      assert.equal(await folded(BEN), false);
      await ask(CHI);
      assert.equal(await folded(BEN), true);

      // Nobody folds by hand, and a new post never starts folded.
      await refused(
        AKI,
        "update posts set spoiler_folded = false where id = $1",
        [post.id],
        /permission/,
      );
      await refused(
        AKI,
        "insert into posts (author_id, body, spoiler_folded) values ($1, '最初から', true)",
        [AKI],
        /permission/,
      );

      // Its writer can add the spoiler mark afterwards; nobody else can, and
      // the mark is not taken off.
      assert.equal(
        await affects(BEN, "update posts set spoiler = true where id = $1", [
          post.id,
        ]),
        0,
      );
      assert.equal(
        await affects(AKI, "update posts set spoiler = true where id = $1", [
          post.id,
        ]),
        1,
      );
      await refused(
        AKI,
        "update posts set spoiler = false where id = $1",
        [post.id],
        /row-level security/,
      );
      // A post without a book has no door to wait behind.
      await refused(
        AKI,
        "update posts set spoiler = true where id = $1",
        [akiChat.id],
        /check constraint/,
      );
      // Deleting a folded post takes its questions with it.
      assert.equal(
        await affects(AKI, "delete from posts where id = $1", [post.id]),
        1,
      );
      assert.equal(
        (
          await db.query("select * from spoiler_reports where post_id = $1", [
            post.id,
          ])
        ).rows.length,
        0,
      );
    },
  );

  await check("a report of a spoiler never hides a post outright", async () => {
    const [post] = await as<{ id: string }>(
      AKI,
      "insert into posts (author_id, body, book_id) values ($1, '終盤の話', $2) returning id",
      [AKI, book.id],
    );
    for (const visitor of [BEN, CHI, "00000000-0000-4000-8000-00000000000e"])
      await as(
        visitor,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'post', $2, 'spoiler')",
        [visitor, post.id],
      );
    assert.equal(
      (await as(null, "select id from posts where id = $1", [post.id])).length,
      1,
    );
    await as(AKI, "delete from posts where id = $1", [post.id]);
    await db.exec(`delete from reports where target_id = '${post.id}'`);
  });

  await check("follows, shop reactions and saved shops", async () => {
    await as(
      BEN,
      "insert into shop_follows (follower_id, shop_id) values ($1, $2)",
      [BEN, akiShop.id],
    );
    await as(
      BEN,
      "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
      [BEN, AKI],
    );
    await as(
      BEN,
      "insert into shop_reactions (user_id, shop_id, liked, message) values ($1, $2, true, '旅の棚が好きです')",
      [BEN, akiShop.id],
    );
    await as(
      BEN,
      "insert into saved_shops (user_id, shop_id) values ($1, $2)",
      [BEN, akiShop.id],
    );
    await as(
      BEN,
      "insert into pop_reactions (user_id, shop_id, placement_key, reaction) values ($1, $2, 'p1', 'love')",
      [BEN, akiShop.id],
    );
    for (const table of [
      "shop_follows",
      "profile_follows",
      "shop_reactions",
      "pop_reactions",
    ]) {
      assert.equal((await as(AKI, `select * from ${table}`)).length, 1, table);
      assert.equal((await as(CHI, `select * from ${table}`)).length, 0, table);
    }
    assert.equal((await as(AKI, "select * from saved_shops")).length, 0);
    assert.equal((await as(BEN, "select * from saved_shops")).length, 1);
    await refused(
      AKI,
      "insert into profile_follows (follower_id, followee_id) values ($1, $1)",
      [AKI],
      /check constraint/,
    );
    await refused(
      CHI,
      "insert into shop_reactions (user_id, shop_id, message) values ($1, $2, '書き込み')",
      [CHI, benShop.id],
      /row-level security/,
    );
    assert.equal(
      await affects(
        AKI,
        "update shop_reactions set message = '消しました' where user_id = $1",
        [BEN],
      ),
      0,
    );
  });

  await check("walk visits are private", async () => {
    await as(
      BEN,
      "insert into shop_visits (user_id, shop_id, visited_at) values ($1, $2, '2026-10-12T10:00:00Z')",
      [BEN, akiShop.id],
    );
    assert.equal((await as(BEN, "select * from shop_visits")).length, 1);
    assert.equal((await as(AKI, "select * from shop_visits")).length, 0);
    await refused(
      CHI,
      "insert into shop_visits (user_id, shop_id) values ($1, $2)",
      [BEN, akiShop.id],
      /row-level security/,
    );
    // A closed shop cannot be visited by anyone but its owner.
    await refused(
      CHI,
      "insert into shop_visits (user_id, shop_id) values ($1, $2)",
      [CHI, benShop.id],
      /row-level security/,
    );
  });

  await check(
    "an owner learns how many stopped by this week, never who",
    async () => {
      const count = async (visitor: Visitor, days = 7) =>
        (
          await as<{ n: number }>(visitor, "select shop_visitors($1) as n", [
            days,
          ])
        )[0].n;
      // Ben came ten days ago, Chi yesterday; Aki's own visit is not counted.
      await db.exec(
        `update shop_visits set visited_at = now() - interval '10 days' where user_id = '${BEN}'`,
      );
      await as(
        CHI,
        "insert into shop_visits (user_id, shop_id, visited_at) values ($1, $2, now() - interval '1 day')",
        [CHI, akiShop.id],
      );
      await as(
        AKI,
        "insert into shop_visits (user_id, shop_id) values ($1, $2)",
        [AKI, akiShop.id],
      );
      assert.equal(await count(AKI), 1);
      assert.equal(await count(AKI, 30), 2);
      // Others hear nothing about Aki's shop, and visitors without an account
      // cannot ask at all.
      assert.equal(await count(BEN), 0);
      assert.equal(await count(CHI), 0);
      await refused(null, "select shop_visitors(7)", [], /permission/);
      // Someone either of them blocked is not counted.
      await as(
        AKI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [AKI, CHI],
      );
      assert.equal(await count(AKI), 0);
      await as(AKI, "delete from blocks where blocker_id = $1", [AKI]);
      await db.exec(
        `delete from shop_visits where user_id in ('${CHI}', '${AKI}')`,
      );
    },
  );

  await check("book lists are private", async () => {
    await as(
      CHI,
      "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
      [CHI, book.id],
    );
    assert.equal((await as(AKI, "select * from book_marks")).length, 0);
    assert.equal((await as(CHI, "select * from book_marks")).length, 1);
    await refused(
      AKI,
      "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
      [CHI, book.id],
      /row-level security/,
    );
  });

  await check(
    "reading together is public and one session runs at a time",
    async () => {
      await as(
        AKI,
        "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together')",
        [AKI, book.id],
      );
      await as(
        CHI,
        "insert into reading_sessions (user_id, mode) values ($1, 'solo')",
        [CHI],
      );
      assert.equal(
        (await as(null, "select * from reading_sessions")).length,
        1,
      );
      assert.equal((await as(CHI, "select * from reading_sessions")).length, 2);
      await refused(
        AKI,
        "insert into reading_sessions (user_id, mode) values ($1, 'solo')",
        [AKI],
        /duplicate key/,
      );
      assert.equal(
        await affects(
          AKI,
          "update reading_sessions set ended_at = now() where user_id = $1",
          [AKI],
        ),
        1,
      );
      assert.equal(
        await affects(
          BEN,
          "update reading_sessions set ended_at = now() where user_id = $1",
          [CHI],
        ),
        0,
      );
    },
  );

  await check(
    "a block hides each person from the other, both ways",
    async () => {
      const [chiPost] = await as<{ id: string }>(
        CHI,
        "insert into posts (author_id, body) values ($1, 'こんにちは') returning id",
        [CHI],
      );
      await as(
        CHI,
        "insert into shop_follows (follower_id, shop_id) values ($1, $2)",
        [CHI, akiShop.id],
      );
      await as(
        CHI,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [CHI, AKI],
      );
      await as(
        CHI,
        "insert into shop_reactions (user_id, shop_id, message) values ($1, $2, 'また来ます')",
        [CHI, akiShop.id],
      );
      const words = async () =>
        (
          await as(AKI, "select * from shop_reactions where user_id = $1", [
            CHI,
          ])
        ).length;
      assert.equal(await words(), 1);
      await as(
        AKI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [AKI, CHI],
      );
      // The owner no longer reads what a blocked reader left; the reader still can.
      assert.equal(await words(), 0);
      assert.equal(
        (
          await as(CHI, "select * from shop_reactions where user_id = $1", [
            CHI,
          ])
        ).length,
        1,
      );
      const follows = await db.query<{ n: number }>(
        `select (select count(*) from shop_follows where follower_id = '${CHI}')
            + (select count(*) from profile_follows where follower_id = '${CHI}') as n`,
      );
      assert.equal(Number(follows.rows[0].n), 0);
      assert.equal(
        (await as(CHI, "select * from shops where id = $1", [akiShop.id]))
          .length,
        0,
      );
      assert.equal(
        (await as(CHI, "select * from posts where author_id = $1", [AKI]))
          .length,
        0,
      );
      assert.equal(
        (
          await as(CHI, "select * from reading_sessions where user_id = $1", [
            AKI,
          ])
        ).length,
        0,
      );
      assert.equal(
        (await as(AKI, "select * from posts where id = $1", [chiPost.id]))
          .length,
        0,
      );
      // Profiles stay readable, so the blocker can still manage their block list.
      assert.equal(
        (await as(CHI, "select * from profiles where id = $1", [AKI])).length,
        1,
      );
      await refused(
        CHI,
        "insert into profile_follows (follower_id, followee_id) values ($1, $2)",
        [CHI, AKI],
        /row-level security/,
      );
      await refused(
        CHI,
        "insert into shop_follows (follower_id, shop_id) values ($1, $2)",
        [CHI, akiShop.id],
        /row-level security/,
      );
      await refused(
        CHI,
        "insert into posts (author_id, body, parent_id) values ($1, '返信', $2)",
        [CHI, akiReview.id],
        /not found/,
      );
      // Only the blocker sees the block, and nobody can block in someone else's name.
      assert.equal((await as(CHI, "select * from blocks")).length, 0);
      assert.equal((await as(AKI, "select * from blocks")).length, 1);
      await refused(
        CHI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [BEN, AKI],
        /row-level security/,
      );
      await as(
        AKI,
        "delete from blocks where blocker_id = $1 and blocked_id = $2",
        [AKI, CHI],
      );
      assert.equal(
        (await as(CHI, "select * from shops where id = $1", [akiShop.id]))
          .length,
        1,
      );
      assert.equal(await words(), 1);
    },
  );

  await check(
    "reports are filed as open and seen by the reporter only",
    async () => {
      await as(
        CHI,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'post', $2, 'harassment')",
        [CHI, akiChat.id],
      );
      // The app's own read: every column it asks for is granted, and the
      // policy alone keeps the rows the reporter's own.
      const columns = REPORT_COLUMNS;
      const [filed] = await as<{ progress: string }>(
        CHI,
        `select ${columns} from reports order by created_at desc limit 200`,
      );
      assert.equal(filed.progress, "open");
      assert.equal((await as(AKI, `select ${columns} from reports`)).length, 0);
      // reporter_id is not granted, so filtering on it is refused too.
      await refused(
        CHI,
        `select ${columns} from reports where reporter_id = $1`,
        [CHI],
        /permission/,
      );
      await refused(
        CHI,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'post', $2, 'spam')",
        [CHI, akiChat.id],
        /duplicate key/,
      );
      await refused(
        CHI,
        "insert into reports (reporter_id, target_kind, target_id, reason, status) values ($1, 'shop', $2, 'spam', 'resolved')",
        [CHI, akiShop.id],
        /permission/,
      );
      await refused(
        CHI,
        "update reports set status = 'dismissed' where reporter_id = $1",
        [CHI],
        /permission/,
      );
      // Nor can a report be filed about yourself, or in someone else's name.
      await refused(
        CHI,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'profile', $1, 'other')",
        [CHI],
        /row-level security/,
      );
      await refused(
        CHI,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'shop', $2, 'other')",
        [BEN, akiShop.id],
        /row-level security/,
      );
    },
  );

  // Readers of different ages, for weighing reports. Each established one was
  // made more than a day apart from the others; the twins within hours.
  const reader = (n: number) =>
    "00000000-0000-4000-8000-0000000001" + String(n).padStart(2, "0");
  const OLD1 = reader(1);
  const OLD2 = reader(2);
  const OLD3 = reader(3);
  const OLD4 = reader(4);
  const FRESH = reader(5);
  const TWIN1 = reader(6);
  const TWIN2 = reader(7);
  const TWIN3 = reader(8);
  const LEAVER = reader(9);
  /** Dates an account back: its sign-up and its profile. */
  const age = (id: string, days: number, hours = 0) =>
    db.exec(`
      update auth.users set created_at = now() - interval '${days} days ${hours} hours' where id = '${id}';
      update profiles set created_at = now() - interval '${days} days ${hours} hours' where id = '${id}';
    `);
  for (const [id, days, hours] of [
    [OLD1, 30, 0],
    [OLD2, 60, 0],
    [OLD3, 90, 0],
    [OLD4, 120, 0],
    [FRESH, 2, 0],
    [TWIN1, 200, 0],
    [TWIN2, 200, 3],
    [TWIN3, 200, 6],
    [LEAVER, 300, 0],
  ] as const) {
    await db.exec(`insert into auth.users (id) values ('${id}')`);
    await as(
      id,
      "insert into profiles (id, handle, name) values ($1, $2, $2)",
      [id, "r" + id.slice(-2)],
    );
    await age(id, days, hours);
  }
  const newPost = async (body: string) =>
    (
      await as<{ id: string }>(
        AKI,
        "insert into posts (author_id, body) values ($1, $2) returning id",
        [AKI, body],
      )
    )[0].id;
  const report = (
    visitor: string,
    kind: string,
    target: string,
    reason = "spam",
  ) =>
    as(
      visitor,
      "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, $2, $3, $4)",
      [visitor, kind, target, reason],
    );
  /** How a thing stands for a visitor: folded, held, or nothing they can see. */
  const fold = async (visitor: Visitor, kind: string, target: string) =>
    (
      await as<{ state: string }>(
        visitor,
        "select state from moderation_folds where target_kind = $1 and target_id = $2",
        [kind, target],
      )
    )[0]?.state ?? null;
  const readable = async (visitor: Visitor, post: string) =>
    (await as(visitor, "select id from posts where id = $1", [post])).length ===
    1;
  const operator = (sql: string) => db.exec(sql);

  await check(
    "three established, unrelated readers fold a post, and it stays readable",
    async () => {
      const post = await newPost("ふつうの感想");
      await report(OLD1, "post", post);
      await report(OLD2, "post", post);
      assert.equal(await fold(null, "post", post), null);
      await report(OLD3, "post", post);
      for (const visitor of [null, BEN, AKI, OLD1])
        assert.equal(await fold(visitor, "post", post), "folded");
      // Folded, not hidden: everyone still reads it, a tap away.
      for (const visitor of [null, BEN, AKI])
        assert.ok(await readable(visitor, post));
    },
  );

  await check(
    "a new account weighs half: two people and a 2-day-old account do not fold",
    async () => {
      const post = await newPost("夜の読書");
      await report(OLD1, "post", post);
      await report(OLD2, "post", post);
      await report(FRESH, "post", post);
      assert.equal(await fold(null, "post", post), null);
      await report(OLD3, "post", post);
      assert.equal(await fold(null, "post", post), "folded");
    },
  );

  await check(
    "accounts made within a day of each other count as one person",
    async () => {
      const post = await newPost("雨の日の本");
      for (const twin of [TWIN1, TWIN2, TWIN3])
        await report(twin, "post", post);
      // Old accounts, but made together: one person's worth.
      assert.equal(await fold(null, "post", post), null);
      assert.ok(await readable(null, post));
      await report(OLD1, "post", post);
      assert.equal(await fold(null, "post", post), null);
      await report(OLD2, "post", post);
      assert.equal(await fold(null, "post", post), "folded");
    },
  );

  await check(
    "the operator checks: 確認中 keeps the fold, 問題なし lifts it, a hide hides",
    async () => {
      const post = await newPost("確認される投稿");
      for (const visitor of [OLD1, OLD2, OLD3])
        await report(visitor, "post", post);
      assert.equal(await fold(null, "post", post), "folded");
      await operator(
        `update reports set status_at = status_at - interval '1 day' where target_id = '${post}'`,
      );
      await operator(
        `update reports set status = 'checking' where target_id = '${post}'`,
      );
      assert.equal(await fold(null, "post", post), "folded");
      // The reporter sees 確認中, and when it changed.
      const [mine] = await as<{ progress: string; late: boolean }>(
        OLD1,
        "select progress, status_at > created_at as late from reports where target_id = $1",
        [post],
      );
      assert.deepEqual(mine, { progress: "checking", late: true });
      await operator(
        `update reports set status = 'dismissed' where target_id = '${post}' and reporter_id = '${OLD3}'`,
      );
      assert.equal(await fold(null, "post", post), null);
      // Hiding for real is the operator's: a hide, and the reports resolved.
      await operator(`
        insert into moderation_hides (target_kind, target_id) values ('post', '${post}');
        update reports set status = 'resolved' where target_id = '${post}' and status <> 'dismissed';
      `);
      // Acted on or not, each reporter reads only 確認しました ('checked'),
      // and cannot ask the database which, not even in a filter.
      for (const visitor of [OLD1, OLD3])
        assert.deepEqual(
          await as(
            visitor,
            "select progress from reports where target_id = $1",
            [post],
          ),
          [{ progress: "checked" }],
        );
      await refused(OLD1, "select status from reports", [], /permission/);
      await refused(
        OLD1,
        "select id from reports where status = 'resolved'",
        [],
        /permission/,
      );
      // Changing one's mind between the two moves nothing the reporter sees.
      const at = async () =>
        (
          await as<{ status_at: string }>(
            OLD3,
            "select status_at from reports where target_id = $1",
            [post],
          )
        )[0].status_at;
      const before = await at();
      await operator(
        `update reports set status = 'resolved' where target_id = '${post}' and reporter_id = '${OLD3}'`,
      );
      assert.equal(String(await at()), String(before));
      assert.equal(await fold(null, "post", post), null);
      assert.ok(!(await readable(null, post)));
      assert.ok(!(await readable(OLD1, post)));
      assert.ok(await readable(AKI, post));
      await operator("delete from moderation_hides");
      assert.ok(await readable(null, post));

      // Nobody but the operator reads or writes the hides.
      await refused(null, "select * from moderation_hides", [], /permission/);
      await refused(
        BEN,
        "insert into moderation_hides (target_kind, target_id) values ('post', $1)",
        [post],
        /permission/,
      );
    },
  );

  await check(
    "a threat from an established account holds a post at once, for all but its writer",
    async () => {
      const post = await newPost("名指しの言葉");
      await report(OLD4, "post", post, "threat");
      assert.ok(!(await readable(null, post)));
      assert.ok(!(await readable(CHI, post)));
      assert.ok(!(await readable(OLD4, post)));
      assert.ok(await readable(AKI, post));
      // The writer alone knows it is held; the reporter does not learn it acted.
      assert.equal(await fold(AKI, "post", post), "held");
      assert.equal(await fold(OLD4, "post", post), null);
      assert.equal(await fold(null, "post", post), null);
      await refused(OLD4, "select urgent from reports", [], /permission/);
      // Checked and found fine, it comes back.
      await operator(
        `update reports set status = 'dismissed' where target_id = '${post}'`,
      );
      assert.ok(await readable(null, post));
      assert.equal(await fold(AKI, "post", post), null);
    },
  );

  await check(
    "serious reports on people and shops fold their words, never erase them",
    async () => {
      // From a new account, a serious report counts as an ordinary half.
      const post = await newPost("住所の話");
      await report(FRESH, "post", post, "personal_info");
      assert.ok(await readable(null, post));
      assert.equal(await fold(AKI, "post", post), null);

      await report(OLD1, "profile", CHI, "personal_info");
      await report(OLD2, "shop", akiShop.id, "threat");
      assert.equal(await fold(null, "profile", CHI), "folded");
      assert.equal(await fold(null, "shop", akiShop.id), "folded");
      assert.equal(await fold(AKI, "shop", akiShop.id), "folded");
      const seen = async (sql: string, id: string) =>
        (await as(null, sql, [id])).length;
      assert.equal(await seen("select id from profiles where id = $1", CHI), 1);
      assert.equal(
        await seen("select id from shops where id = $1", akiShop.id),
        1,
      );
      assert.ok(
        (await seen("select id from posts where author_id = $1", AKI)) > 0,
      );
      await operator(
        `update reports set status = 'dismissed' where target_kind in ('profile', 'shop')`,
      );
      assert.equal(await fold(null, "profile", CHI), null);
      assert.equal(await fold(null, "shop", akiShop.id), null);
    },
  );

  await check(
    "an account acts at once on three serious reports a day, not a fourth",
    async () => {
      const posts = [];
      for (let n = 0; n < 4; n++) posts.push(await newPost("言葉 " + n));
      for (const post of posts) await report(OLD3, "post", post, "threat");
      const urgent = await db.query<{ urgent: boolean }>(
        `select urgent from reports where reporter_id = '${OLD3}' and target_id = any($1) order by created_at`,
        [posts],
      );
      assert.deepEqual(
        urgent.rows.map((row) => row.urgent),
        [true, true, true, false],
      );
      assert.ok(!(await readable(null, posts[2])));
      assert.ok(await readable(null, posts[3]));
      await operator(
        `update reports set status = 'dismissed' where reporter_id = '${OLD3}' and reason = 'threat'`,
      );
    },
  );

  await check(
    "a forged older profile date does not make a new account weigh full",
    async () => {
      await as(FRESH, "update profiles set created_at = $2 where id = $1", [
        FRESH,
        "2020-01-01T00:00:00Z",
      ]);
      const post = await newPost("偽りの古さ");
      await report(FRESH, "post", post, "threat");
      assert.ok(await readable(null, post));
      const filed = await db.query<{ urgent: boolean }>(
        `select urgent from reports where reporter_id = '${FRESH}' and target_id = '${post}'`,
      );
      assert.equal(filed.rows[0].urgent, false);
      await age(FRESH, 2);
    },
  );

  await check(
    "accounts made together cannot split themselves apart with forged newer profile dates",
    async () => {
      // Six throwaway accounts, made at the same moment, each moving its
      // profile's date a day further on, at sign-up or after.
      const throwaways = [0, 1, 2, 3, 4, 5].map(
        (n) =>
          "00000000-0000-4000-8000-0000000002" + String(n).padStart(2, "0"),
      );
      for (const [n, id] of throwaways.entries()) {
        await db.exec(
          `insert into auth.users (id, created_at) values ('${id}', now() - interval '30 days')`,
        );
        await as(
          id,
          "insert into profiles (id, handle, name, created_at) values ($1, $2, $2, now() + $3::interval)",
          [id, "t" + id.slice(-2), `${n * 25} hours`],
        );
        await as(
          id,
          "update profiles set created_at = now() + $2::interval where id = $1",
          [id, `${n * 25 + 1} hours`],
        );
      }
      // The database dated each profile when it was made, and kept it.
      const dates = await db.query<{ kept: boolean }>(
        `select max(created_at) <= now() and max(created_at) - min(created_at) < interval '1 hour' as kept
         from profiles where id = any($1)`,
        [throwaways],
      );
      assert.ok(dates.rows[0].kept);
      const post = await newPost("ふつうの言葉");
      for (const id of throwaways) await report(id, "post", post);
      // Made together, they are one person's worth: nothing folds.
      assert.equal(await fold(null, "post", post), null);
      await db.query("delete from auth.users where id = any($1)", [throwaways]);
    },
  );

  await check(
    "one reporter's serious reports are weighed one at a time",
    async () => {
      // Each serious report takes a lock for its reporter until it is saved,
      // so reports sent together wait for each other and see each other.
      const post = await newPost("一度に送られる通報");
      const key = (text: string) =>
        `(hashtext(${text})::bigint & 4294967295)::oid`;
      const held = () =>
        db.query<{ n: number }>(
          `select count(*)::int as n from pg_locks
           where locktype = 'advisory' and objsubid = 2
             and classid = ${key("'book-town.urgent-reports'")}
             and objid = ${key("$1::text")}`,
          [OLD2],
        );
      await db.exec("begin");
      try {
        assert.equal((await held()).rows[0].n, 0);
        await report(OLD2, "post", post, "personal_info");
        assert.equal((await held()).rows[0].n, 1);
      } finally {
        await db.exec("rollback");
      }
      assert.equal((await held()).rows[0].n, 0);
    },
  );

  await check(
    "clients file reports and nothing more; folds are the database's",
    async () => {
      const post = await newPost("書き換えられない");
      for (const [column, value] of [
        ["urgent", "true"],
        ["status", "'checking'"],
        ["status_at", "now()"],
        ["created_at", "now()"],
      ])
        await refused(
          OLD1,
          `insert into reports (reporter_id, target_kind, target_id, reason, ${column}) values ($1, 'post', $2, 'spam', ${value})`,
          [OLD1, post],
          /permission/,
        );
      await report(OLD1, "post", post);
      await refused(
        OLD1,
        "update reports set reason = 'other' where reporter_id = $1",
        [OLD1],
        /permission/,
      );
      await refused(
        OLD1,
        "delete from reports where reporter_id = $1",
        [OLD1],
        /permission/,
      );
      await refused(null, "select id from reports", [], /permission/);
      for (const visitor of [null, AKI, OLD1]) {
        await refused(
          visitor,
          "insert into moderation_folds (target_kind, target_id, state) values ('post', $1, 'folded')",
          [post],
          /permission/,
        );
        await refused(
          visitor,
          "update moderation_folds set state = 'folded'",
          [],
          /permission/,
        );
        await refused(
          visitor,
          "delete from moderation_folds",
          [],
          /permission/,
        );
      }
      // Whose a fold is stays the database's to know.
      await refused(
        AKI,
        "select owner_id from moderation_folds",
        [],
        /permission/,
      );
    },
  );

  await check(
    "a cover removal request is a report about a book, with who asks",
    async () => {
      await as(
        BEN,
        "insert into reports (reporter_id, target_kind, target_id, reason, detail) values ($1, 'book', $2, 'cover', $3)",
        [
          BEN,
          book.id,
          "版元の者です。表紙の出どころ: Google Books / ISBN 9784150119553",
        ],
      );
      assert.deepEqual(
        await as(
          BEN,
          "select target_kind, reason, progress from reports where target_kind = 'book'",
        ),
        [{ target_kind: "book", reason: "cover", progress: "open" }],
      );
      for (const [kind, reason, detail] of [
        ["book", "spam", "x"],
        ["post", "cover", "x"],
        ["book", "cover", "  "],
      ])
        await refused(
          CHI,
          "insert into reports (reporter_id, target_kind, target_id, reason, detail) values ($1, $2, $3, $4, $5)",
          [CHI, kind, kind === "book" ? book.id : akiChat.id, reason, detail],
          /check constraint/,
        );
      // A request never folds anything.
      assert.equal(
        (
          await db.query(
            "select * from moderation_folds where target_id = $1",
            [book.id],
          )
        ).rows.length,
        0,
      );
    },
  );

  await check(
    "only the operator decides which covers are not shown",
    async () => {
      await operator(
        "insert into cover_refusals (isbn, source, note) values ('9784150119553', 'google', '版元から')",
      );
      for (const visitor of [null, AKI])
        assert.deepEqual(
          await as(visitor, "select isbn, source from cover_refusals"),
          [{ isbn: "9784150119553", source: "google" }],
        );
      await refused(null, "select note from cover_refusals", [], /permission/);
      for (const visitor of [null, AKI]) {
        await refused(
          visitor,
          "insert into cover_refusals (isbn, source) values ('9784101010137', 'openbd')",
          [],
          /permission/,
        );
        await refused(visitor, "delete from cover_refusals", [], /permission/);
      }
      let bad: unknown = null;
      try {
        await operator(
          "insert into cover_refusals (isbn, source) values ('9784150119554', 'google')",
        );
      } catch (error) {
        bad = error;
      }
      assert.ok(bad instanceof Error && /check constraint/.test(bad.message));
      await operator("delete from cover_refusals");
    },
  );

  await check("a reader's settings are theirs alone", async () => {
    // The statement the API builds for the app's upsert.
    const upsert = (visitor: string, user: string, value: string) =>
      as(
        visitor,
        `insert into reader_settings (user_id, spoiler_display) values ($1, $2)
         on conflict (user_id) do update
           set user_id = excluded.user_id, spoiler_display = excluded.spoiler_display`,
        [user, value],
      );
    await upsert(AKI, AKI, "leave_out");
    await upsert(AKI, AKI, "show_all");
    assert.deepEqual(
      await as(AKI, "select user_id, spoiler_display from reader_settings"),
      [{ user_id: AKI, spoiler_display: "show_all" }],
    );
    assert.equal((await as(CHI, "select * from reader_settings")).length, 0);
    await refused(
      CHI,
      "insert into reader_settings (user_id, spoiler_display) values ($1, 'show_all')",
      [AKI],
      /row-level security/,
    );
    assert.equal(
      await affects(
        CHI,
        "update reader_settings set spoiler_display = 'leave_out' where user_id = $1",
        [AKI],
      ),
      0,
    );
    await refused(null, "select * from reader_settings", [], /permission/);
    await refused(
      AKI,
      "update reader_settings set spoiler_display = 'hide_all' where user_id = $1",
      [AKI],
      /check constraint/,
    );
    await refused(
      AKI,
      "update reader_settings set updated_at = now() where user_id = $1",
      [AKI],
      /permission/,
    );
  });

  await check("the old spoiler reason never folds or hides", async () => {
    const post = await newPost("終盤の話をした");
    for (const visitor of [OLD1, OLD2, OLD3, OLD4])
      await report(visitor, "post", post, "spoiler");
    assert.ok(await readable(null, post));
    assert.equal(await fold(null, "post", post), null);
  });

  await check(
    "a reporter's account deleted takes its weight along",
    async () => {
      const post = await newPost("消えた人の通報");
      for (const visitor of [OLD1, OLD2, LEAVER])
        await report(visitor, "post", post);
      assert.equal(await fold(null, "post", post), "folded");
      await operator(`delete from auth.users where id = '${LEAVER}'`);
      assert.equal(await fold(null, "post", post), null);
    },
  );

  await check(
    "the new tables and functions are open only as far as granted",
    async () => {
      const table = async (role: string, name: string, privilege: string) =>
        (
          await db.query<{ ok: boolean }>(
            "select has_table_privilege($1, $2, $3) as ok",
            [role, name, privilege],
          )
        ).rows[0].ok;
      for (const role of ["anon", "authenticated"]) {
        for (const name of [
          "public.moderation_folds",
          "public.cover_refusals",
          "public.reader_settings",
          "public.reports",
        ])
          for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"])
            if (name !== "public.reader_settings" || role === "anon")
              assert.equal(
                await table(role, name, privilege),
                false,
                `${role} ${privilege} ${name}`,
              );
        for (const name of ["public.moderation_folds", "public.cover_refusals"])
          assert.equal(await table(role, name, "INSERT"), false, name);
      }
      assert.equal(
        await table("anon", "public.reader_settings", "SELECT"),
        false,
      );
      assert.equal(await table("anon", "public.reports", "SELECT"), false);
      const column = await db.query<{ ok: boolean }>(
        "select has_column_privilege('authenticated', 'public.reports', 'urgent', 'SELECT') as ok",
      );
      assert.equal(column.rows[0].ok, false);
      for (const fn of [
        "private.account_born(uuid)",
        "private.review_state(text, uuid)",
        "private.refold_review(text, uuid)",
        "private.owner_of(text, uuid)",
        "private.weigh_report()",
        "private.refold_reports()",
        "private.refold_taken_down()",
        "private.stamp_report_status()",
        "private.stamp_profile_time()",
      ])
        for (const role of ["anon", "authenticated"])
          assert.equal(
            (
              await db.query<{ ok: boolean }>(
                "select has_function_privilege($1, $2, 'EXECUTE') as ok",
                [role, fn],
              )
            ).rows[0].ok,
            false,
            role + " " + fn,
          );
      // The policies still ask whether something is hidden.
      assert.equal(
        (
          await db.query<{ ok: boolean }>(
            "select has_function_privilege('anon', 'private.is_hidden(text, uuid)', 'EXECUTE') as ok",
          )
        ).rows[0].ok,
        true,
      );
    },
  );

  await check(
    "a hidden shop or person is gone for others, not for themselves",
    async () => {
      const count = async (visitor: Visitor, sql: string) =>
        (await as(visitor, sql, [AKI])).length;
      const shops = "select * from shops where owner_id = $1";
      const people = "select * from profiles where id = $1";
      const posts = "select * from posts where author_id = $1";
      const nine = "select * from profile_nine where profile_id = $1";
      assert.ok((await count(null, shops)) > 0);
      assert.ok((await count(null, nine)) > 0);

      await db.exec(
        `insert into moderation_hides (target_kind, target_id) values ('shop', '${akiShop.id}')`,
      );
      assert.equal(await count(null, shops), 0);
      assert.equal(await count(CHI, shops), 0);
      assert.equal(await count(AKI, shops), 1);
      assert.equal(await count(null, people), 1);
      await db.exec("delete from moderation_hides");

      await db.exec(
        `insert into moderation_hides (target_kind, target_id) values ('profile', '${AKI}')`,
      );
      for (const sql of [shops, people, posts, nine])
        assert.equal(await count(CHI, sql), 0, sql);
      assert.equal(await count(null, posts), 0);
      assert.equal(await count(AKI, people), 1);
      assert.equal(await count(AKI, shops), 1);
      assert.ok((await count(AKI, posts)) > 0);
      await db.exec("delete from moderation_hides");
      assert.equal(await count(null, people), 1);
    },
  );

  await check(
    "reading records stay with their reader unless they share them",
    async () => {
      // New people keep their records to themselves until they choose.
      const [chi] = await as<{ reading_visibility: string }>(
        CHI,
        "select reading_visibility from profiles where id = $1",
        [CHI],
      );
      assert.equal(chi.reading_visibility, "private");

      const [shared] = await as<{ id: string; created_at: string }>(
        AKI,
        `insert into reading_entries (user_id, book_id, feelings, is_public, created_at)
         values ($1, $2, '{quiet,talk}', true, '2099-01-01') returning id, created_at`,
        [AKI, book.id],
      );
      assert.ok(new Date(shared.created_at).getFullYear() < 2099);
      const [secret] = await as<{ id: string }>(
        AKI,
        "insert into reading_entries (user_id, book_id, body) values ($1, $2, '誰にも言わない') returning id",
        [AKI, book.id],
      );
      const seen = async (visitor: Visitor) =>
        (
          await as<{ id: string }>(
            visitor,
            "select id from reading_entries where user_id = $1 order by created_at",
            [AKI],
          )
        ).map((row) => row.id);
      assert.deepEqual(await seen(AKI), [shared.id, secret.id]);
      assert.deepEqual(await seen(CHI), [shared.id]);
      assert.deepEqual(await seen(null), [shared.id]);

      // Feelings come from the list; nobody writes as someone else, and a
      // record stays about the same book and the same reader.
      await refused(
        AKI,
        "insert into reading_entries (user_id, book_id, feelings) values ($1, $2, '{bored}')",
        [AKI, book.id],
        /check constraint/,
      );
      await refused(
        CHI,
        "insert into reading_entries (user_id, book_id) values ($1, $2)",
        [AKI, book.id],
        /row-level security/,
      );
      await refused(
        AKI,
        "update reading_entries set user_id = $1 where id = $2",
        [CHI, shared.id],
        /permission/,
      );
      await refused(
        null,
        "insert into reading_entries (user_id, book_id) values ($1, $2)",
        [AKI, book.id],
        /permission/,
      );
      assert.equal(
        await affects(
          CHI,
          "update reading_entries set is_public = true where id = $1",
          [secret.id],
        ),
        0,
      );
      assert.equal(
        await affects(CHI, "delete from reading_entries where id = $1", [
          shared.id,
        ]),
        0,
      );
      assert.equal(
        await affects(
          AKI,
          "update reading_entries set is_public = true, body = '話したい' where id = $1",
          [secret.id],
        ),
        1,
      );
      assert.equal((await seen(CHI)).length, 2);

      // A block or a hidden profile takes the records away from others.
      await as(
        CHI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [CHI, AKI],
      );
      assert.deepEqual(await seen(CHI), []);
      await as(CHI, "delete from blocks where blocker_id = $1", [CHI]);
      await db.exec(
        `insert into moderation_hides (target_kind, target_id) values ('profile', '${AKI}')`,
      );
      assert.deepEqual(await seen(null), []);
      assert.equal((await seen(AKI)).length, 2);
      await db.exec("delete from moderation_hides");

      await as(AKI, "delete from reading_entries where user_id = $1", [AKI]);
      assert.deepEqual(await seen(AKI), []);
    },
  );

  const pages = (...bookIds: string[]) =>
    JSON.stringify([
      {
        blocks: [
          { type: "heading", text: "夜の本" },
          ...(bookIds.length ? [{ type: "books", book_ids: bookIds }] : []),
          { type: "text", text: "眠れない夜に。" },
        ],
      },
    ]);

  await check(
    "posters put up are seen by everyone, drafts by their maker only",
    async () => {
      const [second] = await as<{ id: string }>(
        AKI,
        "insert into books (title, author, created_by) values ('ソラリス', 'スタニスワフ・レム', $1) returning id",
        [AKI],
      );
      const [up] = await as<{ id: string; created_at: string }>(
        AKI,
        `insert into posters (author_id, template, pages, show_in_timeline, created_at)
         values ($1, 'lineup', $2, true, '2099-01-01') returning id, created_at`,
        [AKI, pages(book.id, second.id)],
      );
      // Dated by the database, like posts.
      assert.ok(new Date(up.created_at).getFullYear() < 2099);
      const [draft] = await as<{ id: string; created_at: string }>(
        AKI,
        "insert into posters (author_id, template, pages, status) values ($1, 'one_book', $2, 'draft') returning id, created_at",
        [AKI, pages(book.id)],
      );
      const seen = async (visitor: Visitor) =>
        (
          await as<{ id: string }>(
            visitor,
            "select id from posters where author_id = $1 order by created_at",
            [AKI],
          )
        ).map((row) => row.id);
      assert.deepEqual(await seen(AKI), [up.id, draft.id]);
      assert.deepEqual(await seen(BEN), [up.id]);
      assert.deepEqual(await seen(null), [up.id]);

      // The database lists each poster's books from its pages, and shows
      // them only with the poster.
      const books = async (visitor: Visitor) =>
        (
          await as<{ poster_id: string; book_id: string; first_page: number }>(
            visitor,
            "select poster_id, book_id, first_page from poster_books where poster_id in ($1, $2) order by poster_id, book_id",
            [up.id, draft.id],
          )
        ).map((row) => [row.poster_id, row.book_id, row.first_page]);
      assert.deepEqual(
        (await books(null)).sort(),
        [
          [up.id, book.id, 1],
          [up.id, second.id, 1],
        ].sort(),
      );
      assert.equal((await books(AKI)).length, 3);
      assert.equal(
        await affects(AKI, "update posters set pages = $2 where id = $1", [
          up.id,
          JSON.stringify([
            { blocks: [{ type: "heading", text: "表紙" }] },
            { blocks: [{ type: "books", book_ids: [second.id] }] },
          ]),
        ]),
        1,
      );
      assert.deepEqual(await books(null), [[up.id, second.id, 2]]);
      await refused(
        AKI,
        "insert into poster_books (poster_id, book_id, first_page) values ($1, $2, 1)",
        [up.id, book.id],
        /permission/,
      );

      // A draft put up is new on the board from then on.
      await as(AKI, "update posters set status = 'published' where id = $1", [
        draft.id,
      ]);
      const [putUp] = await as<{ created_at: string }>(
        AKI,
        "select created_at from posters where id = $1",
        [draft.id],
      );
      assert.ok(
        new Date(putUp.created_at).getTime() >
          new Date(draft.created_at).getTime(),
      );
      assert.deepEqual(await seen(BEN), [up.id, draft.id]);

      // Only the maker makes, changes or takes down their posters.
      await refused(
        BEN,
        "insert into posters (author_id, template, pages) values ($1, 'text', $2)",
        [AKI, pages()],
        /row-level security/,
      );
      assert.equal(
        await affects(BEN, "update posters set spoiler = true where id = $1", [
          up.id,
        ]),
        0,
      );
      assert.equal(
        await affects(BEN, "delete from posters where id = $1", [up.id]),
        0,
      );
      for (const column of ["author_id", "created_at"])
        await refused(
          AKI,
          `update posters set ${column} = ${column} where id = $1`,
          [up.id],
          /permission/,
        );
      await refused(
        null,
        "insert into posters (author_id, template, pages) values ($1, 'text', $2)",
        [AKI, pages()],
        /permission/,
      );

      // A block hides each person's posters from the other.
      await as(
        BEN,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [BEN, AKI],
      );
      assert.deepEqual(await seen(BEN), []);
      await as(BEN, "delete from blocks where blocker_id = $1", [BEN]);
      assert.equal(
        await affects(AKI, "delete from posters where id = $1", [draft.id]),
        1,
      );
      assert.deepEqual(await books(AKI), [[up.id, second.id, 2]]);
    },
  );

  await check(
    "a poster keeps to its limits: pages, books, words and the presets",
    async () => {
      const make = (template: string, value: unknown, theme = "kinari") =>
        as(
          AKI,
          "insert into posters (author_id, template, theme, pages) values ($1, $2, $3, $4)",
          [AKI, template, theme, JSON.stringify(value)],
        );
      const page = (blocks: unknown[]) => ({ blocks });
      const words = (n: number) => "あ".repeat(n);
      const many = (n: number) =>
        Array.from(
          { length: n },
          (_, i) => "00000000-0000-4000-8000-" + String(i).padStart(12, "0"),
        );
      for (const [value, reason] of [
        [[], /1 to 10 pages/],
        [
          Array.from({ length: 11 }, () =>
            page([{ type: "heading", text: "a" }]),
          ),
          /1 to 10 pages/,
        ],
        [[page([{ type: "heading", text: words(61) }])], /heading, words/],
        [[page([{ type: "text", text: words(2001) }])], /heading, words/],
        [[page([{ type: "text", text: 3 }])], /heading, words/],
        [[page([{ type: "photo", url: "x" }])], /heading, words/],
        [[{ title: "x" }], /list of blocks/],
        [[page([{ type: "books", book_ids: many(10) }])], /at most 9 books/],
        // A book the catalog does not have refuses the save.
        [[page([{ type: "books", book_ids: many(1) }])], /foreign key/],
        [[page([{ type: "books", book_ids: ["not-a-book"] }])], /uuid/],
        // Nothing but the blocks is kept, so a page cannot carry anything else.
        [[{ ...page([]), note: "x" }], /list of blocks/],
        [[page([{ type: "heading", text: "a", note: "x" }])], /heading, words/],
        [
          [page([{ type: "books", book_ids: [], note: words(9000) }])],
          /heading, words/,
        ],
        [
          [
            page([
              { type: "text", text: words(2000) },
              { type: "text", text: words(2000) },
            ]),
          ],
          /one block of each kind/,
        ],
        [[page(Array.from({ length: 4 }, () => "x"))], /list of blocks/],
      ] as const) {
        let error: unknown = null;
        try {
          await make("lineup", value);
        } catch (caught) {
          error = caught;
        }
        assert.ok(error instanceof Error, JSON.stringify(value).slice(0, 80));
        assert.match(error.message, reason);
      }
      await refused(
        AKI,
        "insert into posters (author_id, template, theme, pages) values ($1, 'lineup', 'neon', $2)",
        [AKI, pages()],
        /check constraint/,
      );
      await refused(
        AKI,
        "insert into posters (author_id, template, pages) values ($1, 'ranking', $2)",
        [AKI, pages()],
        /check constraint/,
      );
      // A one-book poster shows one book a page, words alone none.
      const two = [page([{ type: "books", book_ids: many(2) }])];
      await refused(
        AKI,
        "insert into posters (author_id, template, pages) values ($1, 'one_book', $2)",
        [AKI, JSON.stringify(two)],
        /fewer books/,
      );
      await refused(
        AKI,
        "insert into posters (author_id, template, pages) values ($1, 'text', $2)",
        [AKI, JSON.stringify([page([{ type: "books", book_ids: many(1) }])])],
        /fewer books/,
      );
      // At the limits, it is kept.
      await make(
        "text",
        Array.from({ length: 10 }, () =>
          page([
            { type: "heading", text: words(60) },
            { type: "text", text: words(2000) },
          ]),
        ),
        "sumi",
      );
      await db.exec("delete from posters where template = 'text'");
    },
  );

  await check("a poster can be reported, and hidden like a post", async () => {
    const [poster] = await as<{ id: string }>(
      AKI,
      "insert into posters (author_id, template, pages) values ($1, 'one_book', $2) returning id",
      [AKI, pages(book.id)],
    );
    const seen = async (visitor: Visitor) =>
      (await as(visitor, "select id from posters where id = $1", [poster.id]))
        .length;
    for (const reporter of [BEN, CHI])
      await as(
        reporter,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'poster', $2, 'inappropriate')",
        [reporter, poster.id],
      );
    assert.equal(await seen(null), 1);
    await db.exec(
      `insert into moderation_hides (target_kind, target_id) values ('poster', '${poster.id}')`,
    );
    assert.equal(await seen(null), 0);
    assert.equal(await seen(BEN), 0);
    assert.equal(await seen(AKI), 1);
    await db.exec("delete from moderation_hides");
    await db.exec("delete from reports where target_kind = 'poster'");
    assert.equal(await seen(BEN), 1);
    await refused(
      BEN,
      "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'poster_book', $2, 'spam')",
      [BEN, poster.id],
      /check constraint/,
    );
    // Ben makes one too, for the account deletion below.
    await as(
      BEN,
      "insert into posters (author_id, template, pages) values ($1, 'text', $2)",
      [BEN, pages()],
    );
  });

  await check(
    "a post or a poster its writer takes down keeps no fold, held or folded",
    async () => {
      const rows = async (target: string) =>
        (
          await db.query(
            "select state from moderation_folds where target_id = $1",
            [target],
          )
        ).rows.length;
      // Held, then taken down: nobody, the writer included, reads it as held.
      const post = await newPost("消す前の言葉");
      await report(OLD1, "post", post, "threat");
      assert.equal(await fold(AKI, "post", post), "held");
      await as(AKI, "delete from posts where id = $1", [post]);
      assert.equal(await fold(AKI, "post", post), null);
      assert.equal(await rows(post), 0);
      const [poster] = await as<{ id: string }>(
        AKI,
        "insert into posters (author_id, template, pages) values ($1, 'one_book', $2) returning id",
        [AKI, pages(book.id)],
      );
      await report(OLD4, "poster", poster.id, "threat");
      assert.equal(await fold(AKI, "poster", poster.id), "held");
      await as(AKI, "delete from posters where id = $1", [poster.id]);
      assert.equal(await fold(AKI, "poster", poster.id), null);
      assert.equal(await rows(poster.id), 0);
      // Its reports stay for the operator; looking at them folds nothing back.
      await operator(
        `update reports set status = 'checking' where target_id in ('${post}', '${poster.id}')`,
      );
      assert.equal(await rows(post), 0);
      assert.equal(await rows(poster.id), 0);
      // Folded by three, then taken down: gone for everyone.
      const folded = await newPost("たたまれてから消す言葉");
      for (const visitor of [OLD1, OLD2, OLD3])
        await report(visitor, "post", folded);
      assert.equal(await fold(null, "post", folded), "folded");
      await as(AKI, "delete from posts where id = $1", [folded]);
      assert.equal(await rows(folded), 0);
      await operator(
        `update reports set status = 'dismissed' where target_id in ('${post}', '${poster.id}', '${folded}')`,
      );
    },
  );

  // A book scanned or typed in is its reader's own until they use it where
  // others can see (20261024000000_hide_registered_titles.sql). Ben scans
  // one. Aki and Chi have never seen it, and neither has anyone signed out.
  const scanned = "00000000-0000-4000-8000-0000000000b2";
  /** The statement the API builds for the app's upsert of book rows. */
  const saveBook = (visitor: string, id: string, title: string) =>
    as<{ count: number }>(
      visitor,
      `with saved as (
         insert into books (id, title, created_by)
         select id, title, created_by
         from json_populate_recordset(null::books, $1) as row
         on conflict (id) do nothing
         returning 1
       ) select count(*)::int as count from saved`,
      [JSON.stringify([{ id, title, created_by: visitor }])],
    );
  /** Whether a visitor reads a book, by its id and among the newest. */
  const reads = async (visitor: Visitor, id: string) => {
    const byId =
      (await as(visitor, "select id, title from books where id = $1", [id]))
        .length === 1;
    const newest = await as<{ id: string }>(
      visitor,
      "select id, title from books order by created_at desc limit 300",
    );
    assert.equal(
      newest.some((row) => row.id === id),
      byId,
      "the newest books agree with the book read by its id",
    );
    return byId;
  };
  /** Who reads a book: someone signed out, Aki, Ben and Chi. */
  const readersOf = async (id: string) => [
    await reads(null, id),
    await reads(AKI, id),
    await reads(BEN, id),
    await reads(CHI, id),
  ];
  const EVERYONE = [true, true, true, true];
  const BEN_ALONE = [false, false, true, false];
  const BEN_AND_CHI = [false, false, true, true];
  const readBy = async (expected: boolean[], why: string) =>
    assert.deepEqual(await readersOf(scanned), expected, why);
  const hide = (kind: string, id: string) =>
    operator(
      `insert into moderation_hides (target_kind, target_id) values ('${kind}', '${id}')`,
    );
  const unhide = () => operator("delete from moderation_hides");
  /** What three reports ('folded') or a serious one ('held') leave. */
  const foldAs = (kind: string, id: string, state: string, owner = BEN) =>
    operator(
      `insert into moderation_folds (target_kind, target_id, state, owner_id)
       values ('${kind}', '${id}', '${state}', '${owner}')
       on conflict (target_kind, target_id) do update set state = excluded.state`,
    );
  const unfold = (id: string) =>
    operator(`delete from moderation_folds where target_id = '${id}'`);
  /** One shelf holding the book, as the app saves a shop's shelves. */
  const shelvesWith = (bookId: string, isPublic: boolean) =>
    JSON.stringify([
      {
        id: "s1",
        name: "新着",
        isPublic,
        items: [{ id: "i1", bookId, display: "face" }],
      },
    ]);
  /** A store scene with the book on one shelf row. */
  const sceneWith = (bookId: string, isPublic: boolean) =>
    JSON.stringify({
      schemaVersion: 1,
      storeId: "mine",
      objects: [
        { id: "shelf", kind: "furniture", parentId: null },
        { id: "row", kind: "row", parentId: "shelf", isPublic },
        { id: "b1", kind: "book", bookId, parentId: "row" },
      ],
    });

  await check(
    "a book scanned or typed in is read by its reader alone",
    async () => {
      assert.deepEqual(await saveBook(BEN, scanned, "砂の器"), [{ count: 1 }]);
      // Sent again after its answer was lost: nothing changes, nothing fails.
      assert.deepEqual(await saveBook(BEN, scanned, "砂の器"), [{ count: 0 }]);
      await readBy(BEN_ALONE, "scanned only");
      // Its reader still fixes it and reads it back.
      assert.deepEqual(
        await as(
          BEN,
          "update books set author = '松本清張' where id = $1 returning title, author",
          [scanned],
        ),
        [{ title: "砂の器", author: "松本清張" }],
      );
      // Anyone else's write of it changes nothing, and tells only that the
      // id is taken.
      for (const visitor of [AKI, CHI]) {
        assert.deepEqual(await saveBook(visitor, scanned, "横取り"), [
          { count: 0 },
        ]);
        assert.equal(
          await affects(
            visitor,
            "update books set title = '横取り' where id = $1",
            [scanned],
          ),
          0,
        );
      }
      await refused(
        CHI,
        "insert into books (id, title, created_by) values ($1, '横取り', $2)",
        [scanned, CHI],
        /duplicate key/,
      );
      const [kept] = (
        await db.query<{ title: string }>(
          "select title from books where id = $1",
          [scanned],
        )
      ).rows;
      assert.equal(kept.title, "砂の器");
      await readBy(BEN_ALONE, "after the others tried");
    },
  );

  await check(
    "a scanned book is read by everyone where it is shown, and only there",
    async () => {
      // An open shop's public shelf; not a closed shop's, nor a private shelf.
      const shelve = (isPublic: boolean) =>
        as(BEN, "update shop_private set shelves = $2 where shop_id = $1", [
          benShop.id,
          shelvesWith(scanned, isPublic),
        ]);
      await as(BEN, "insert into shop_private (shop_id) values ($1)", [
        benShop.id,
      ]);
      await shelve(true);
      await readBy(BEN_ALONE, "a public shelf of a closed shop");
      await as(BEN, "update shops set is_open = true where id = $1", [
        benShop.id,
      ]);
      await readBy(EVERYONE, "a public shelf of an open shop");
      await shelve(false);
      await readBy(BEN_ALONE, "a private shelf");
      await shelve(true);
      await readBy(EVERYONE, "back on the public shelf");
      await hide("shop", benShop.id);
      await readBy(BEN_ALONE, "a hidden shop");
      await unhide();
      await hide("profile", BEN);
      await readBy(BEN_ALONE, "the shop of a hidden person");
      await unhide();
      await as(
        BEN,
        "update shop_private set shelves = '[]' where shop_id = $1",
        [benShop.id],
      );
      await readBy(BEN_ALONE, "taken off the shelf");

      // The store scene: a public row of an open shop.
      const place = (isPublic: boolean) =>
        as(BEN, "update shop_private set scene = $2 where shop_id = $1", [
          benShop.id,
          sceneWith(scanned, isPublic),
        ]);
      await place(false);
      await readBy(BEN_ALONE, "a private row of the store scene");
      await place(true);
      await readBy(EVERYONE, "a public row of the store scene");
      await as(BEN, "update shops set is_open = false where id = $1", [
        benShop.id,
      ]);
      await readBy(BEN_ALONE, "the scene of a closed shop");
      await as(BEN, "update shop_private set scene = null where shop_id = $1", [
        benShop.id,
      ]);

      // A post, a reply or a memo of reading together; never a private note,
      // nor a post the operator hid or a serious report holds. A folded post
      // is still read with a tap, and so is its book.
      const post = async (mode: string | null, parent: string | null = null) =>
        (
          await as<{ id: string }>(
            BEN,
            `insert into posts (author_id, body, book_id, reading_mode, parent_id)
             values ($1, '読んだ', $2, $3, $4) returning id`,
            [BEN, scanned, mode, parent],
          )
        )[0].id;
      const takeDown = (id: string) =>
        as(BEN, "delete from posts where id = $1", [id]);
      const note = await post("solo");
      await readBy(BEN_ALONE, "a private note");
      const review = await post(null);
      await readBy(EVERYONE, "a post");
      await hide("post", review);
      await readBy(BEN_ALONE, "a hidden post");
      await unhide();
      await foldAs("post", review, "held");
      await readBy(BEN_ALONE, "a held post");
      await foldAs("post", review, "folded");
      await readBy(EVERYONE, "a folded post");
      await unfold(review);
      await hide("profile", BEN);
      await readBy(BEN_ALONE, "a hidden person's post");
      await unhide();
      // A block keeps the post from Chi, not its book, which anyone signed
      // out can read.
      await as(
        BEN,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [BEN, CHI],
      );
      assert.equal(
        (await as(CHI, "select id from posts where id = $1", [review])).length,
        0,
      );
      await readBy(EVERYONE, "a post kept from Chi by a block");
      await as(BEN, "delete from blocks where blocker_id = $1", [BEN]);
      await takeDown(review);
      await readBy(BEN_ALONE, "a post taken down");
      const reply = await post(null, await newPost("何を読んでいますか"));
      await readBy(EVERYONE, "a reply");
      await takeDown(reply);
      const together = await post("together");
      await readBy(EVERYONE, "a memo of reading together");
      await takeDown(together);
      await takeDown(note);
      await readBy(BEN_ALONE, "no post left");

      // A public reading record.
      const [record] = await as<{ id: string }>(
        BEN,
        "insert into reading_entries (user_id, book_id) values ($1, $2) returning id",
        [BEN, scanned],
      );
      await readBy(BEN_ALONE, "a private record");
      await as(
        BEN,
        "update reading_entries set is_public = true where id = $1",
        [record.id],
      );
      await readBy(EVERYONE, "a public record");
      await hide("profile", BEN);
      await readBy(BEN_ALONE, "a hidden person's record");
      await unhide();
      await as(BEN, "delete from reading_entries where id = $1", [record.id]);
      await readBy(BEN_ALONE, "the record removed");

      // 人生の9冊.
      await as(BEN, "select replace_profile_nine($1, $2)", [[scanned], [""]]);
      await readBy(EVERYONE, "the nine");
      await hide("profile", BEN);
      await readBy(BEN_ALONE, "a hidden person's nine");
      await unhide();
      await as(BEN, "select replace_profile_nine($1, $2)", [[], []]);
      await readBy(BEN_ALONE, "out of the nine");

      // A poster put up; not a draft, nor one hidden or held.
      const [poster] = await as<{ id: string }>(
        BEN,
        "insert into posters (author_id, template, pages, status) values ($1, 'one_book', $2, 'draft') returning id",
        [BEN, pages(scanned)],
      );
      await readBy(BEN_ALONE, "a draft poster");
      await as(BEN, "update posters set status = 'published' where id = $1", [
        poster.id,
      ]);
      await readBy(EVERYONE, "a poster put up");
      await hide("poster", poster.id);
      await readBy(BEN_ALONE, "a hidden poster");
      await unhide();
      await foldAs("poster", poster.id, "held");
      await readBy(BEN_ALONE, "a held poster");
      await foldAs("poster", poster.id, "folded");
      await readBy(EVERYONE, "a folded poster");
      await unfold(poster.id);
      await as(BEN, "update posters set pages = $2 where id = $1", [
        poster.id,
        pages(),
      ]);
      await readBy(BEN_ALONE, "taken off the poster");
      await as(BEN, "delete from posters where id = $1", [poster.id]);

      // Reading together, while it runs and after: the session stays
      // readable once it ends, and so does its book. Not reading alone.
      const read = async (mode: string) =>
        (
          await as<{ id: string }>(
            BEN,
            "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, $3) returning id",
            [BEN, scanned, mode],
          )
        )[0].id;
      const end = (id: string) =>
        as(BEN, "update reading_sessions set ended_at = now() where id = $1", [
          id,
        ]);
      await end(await read("solo"));
      await readBy(BEN_ALONE, "reading alone");
      const together2 = await read("together");
      await readBy(EVERYONE, "reading together");
      await end(together2);
      await readBy(EVERYONE, "read together, ended");
      await hide("profile", BEN);
      await readBy(BEN_ALONE, "a hidden person's reading");
      await unhide();
      await as(BEN, "delete from reading_sessions where user_id = $1", [BEN]);
      await readBy(BEN_ALONE, "used nowhere again");
    },
  );

  await check(
    "a reader's own use of a book, private ones too, shows it to them alone",
    async () => {
      const chi = (sql: string, params: unknown[]) =>
        as<{ id: string }>(CHI, sql, params);
      await chi(
        "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
        [CHI, scanned],
      );
      await readBy(BEN_AND_CHI, "a wish");
      await chi("delete from book_marks where user_id = $1", [CHI]);
      await readBy(BEN_ALONE, "the wish taken back");

      const [note] = await chi(
        "insert into posts (author_id, body, book_id, reading_mode) values ($1, 'ひとりで', $2, 'solo') returning id",
        [CHI, scanned],
      );
      await readBy(BEN_AND_CHI, "a private note");
      // Her post held by a serious report is still hers.
      const [held] = await chi(
        "insert into posts (author_id, body, book_id) values ($1, '話したい', $2) returning id",
        [CHI, scanned],
      );
      await foldAs("post", held.id, "held", CHI);
      await readBy(BEN_AND_CHI, "a held post");
      await chi("delete from posts where id in ($1, $2)", [note.id, held.id]);

      const [record] = await chi(
        "insert into reading_entries (user_id, book_id) values ($1, $2) returning id",
        [CHI, scanned],
      );
      await readBy(BEN_AND_CHI, "a private record");
      await chi("delete from reading_entries where id = $1", [record.id]);

      const [draft] = await chi(
        "insert into posters (author_id, template, pages, status) values ($1, 'one_book', $2, 'draft') returning id",
        [CHI, pages(scanned)],
      );
      await readBy(BEN_AND_CHI, "a draft poster");
      await chi("delete from posters where id = $1", [draft.id]);

      // Her earlier session still runs, so this one has ended.
      const [alone] = await chi(
        "insert into reading_sessions (user_id, book_id, mode, ended_at) values ($1, $2, 'solo', now()) returning id",
        [CHI, scanned],
      );
      await readBy(BEN_AND_CHI, "reading alone");
      await chi("delete from reading_sessions where id = $1", [alone.id]);

      // Her own shop, closed: a private shelf, then the scene's private row.
      const [shop] = await chi(
        "insert into shops (owner_id, name) values ($1, '小さな本屋') returning id",
        [CHI],
      );
      await chi("insert into shop_private (shop_id, shelves) values ($1, $2)", [
        shop.id,
        shelvesWith(scanned, false),
      ]);
      await readBy(BEN_AND_CHI, "a private shelf");
      await chi(
        "update shop_private set shelves = '[]', scene = $2 where shop_id = $1",
        [shop.id, sceneWith(scanned, false)],
      );
      await readBy(BEN_AND_CHI, "a private row of the store scene");
      await chi("delete from shops where id = $1", [shop.id]);
      await readBy(BEN_ALONE, "used by nobody but Ben");
    },
  );

  await check(
    "catalog books are everyone's, and a 見本's book is kept by every reader",
    async () => {
      const ndl = "00000000-0000-4000-8000-0000000000d1";
      await operator(
        `insert into books (id, title, source) values ('${ndl}', '目録の本', 'ndl')`,
      );
      assert.deepEqual(await readersOf(ndl), EVERYONE);
      await operator(`delete from books where id = '${ndl}'`);

      // A 見本's book is written under one id for everyone, by the first
      // reader who keeps it (withSampleRows in src/lib/town-remote.ts). The
      // next reader's write of it changes nothing and is not refused, though
      // they cannot read that row, and their own mark of it is kept. The app
      // shows a 見本's books from its own copy, row or no row.
      const sample = sampleBookRowId(demoBooks[1].id);
      const keep = async (visitor: string) => {
        const saved = await saveBook(visitor, sample, demoBooks[1].title);
        await as(
          visitor,
          "insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')",
          [visitor, sample],
        );
        return saved[0].count;
      };
      assert.equal(await keep(AKI), 1);
      assert.deepEqual(await readersOf(sample), [false, true, false, false]);
      assert.equal(await keep(CHI), 0);
      assert.deepEqual(await readersOf(sample), [false, true, false, true]);
      assert.equal(
        (await as(CHI, "select * from book_marks where book_id = $1", [sample]))
          .length,
        1,
      );
      // Written about, it is read by everyone, like any book.
      const [post] = await as<{ id: string }>(
        CHI,
        "insert into posts (author_id, body, book_id) values ($1, '見本の本', $2) returning id",
        [CHI, sample],
      );
      assert.deepEqual(await readersOf(sample), EVERYONE);
      await as(CHI, "delete from posts where id = $1", [post.id]);
      for (const visitor of [AKI, CHI])
        await as(visitor, "delete from book_marks where book_id = $1", [
          sample,
        ]);
    },
  );

  await check(
    "every book a reader sees used, they read, and no other typed-in book",
    async () => {
      // Every column that keeps a book's id as a foreign key. A new one must
      // be taught to private.book_is_listed and private.book_is_mine (create
      // or replace), or its books go missing from the screens; so must a new
      // jsonb column with book ids in it, which this list cannot see.
      const keys = await db.query<{ ref: string }>(
        `select c.conrelid::regclass::text || '.' || a.attname as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.confrelid = 'public.books'::regclass
         order by 1`,
      );
      assert.deepEqual(
        keys.rows.map((row) => row.ref),
        [
          "book_encounters.book_id",
          "book_marks.book_id",
          "library_entries.book_id",
          "poster_books.book_id",
          "posts.book_id",
          "profile_nine.book_id",
          "reading_entries.book_id",
          "reading_sessions.book_id",
        ],
      );

      // Aki's open shop shows a book on a public shelf and in its scene,
      // keeps another on a private shelf, and she shares a record.
      const [hers] = await as<{ id: string }>(
        AKI,
        "insert into books (title, created_by) values ('棚の奥の本', $1) returning id",
        [AKI],
      );
      await as(
        AKI,
        "update shop_private set shelves = $2, scene = $3 where shop_id = $1",
        [
          akiShop.id,
          JSON.stringify([
            ...JSON.parse(shelvesWith(book.id, true)),
            ...JSON.parse(shelvesWith(hers.id, false)),
          ]),
          sceneWith(book.id, true),
        ],
      );
      const [record] = await as<{ id: string }>(
        AKI,
        "insert into reading_entries (user_id, book_id, is_public) values ($1, $2, true) returning id",
        [AKI, book.id],
      );

      // The book ids in the rows a visitor reads, as the town gathers them
      // (referencedBookIds in src/lib/town-remote.ts).
      const shown = `
        select book_id::text as id from profile_nine
        union select book_id::text from posts where book_id is not null
        union select book_id::text from reading_sessions where book_id is not null
        union select book_id::text from reading_entries
        union select book_id::text from poster_books
        union select listed.value #>> '{}' from posters,
          jsonb_array_elements(pages) page (value),
          jsonb_array_elements(page.value -> 'blocks') block (value),
          jsonb_array_elements(block.value -> 'book_ids') listed (value)
          where block.value ->> 'type' = 'books'
        union select jsonb_array_elements_text(public_scene_books) from shops
        union select item.value ->> 'bookId' from shops,
          jsonb_array_elements(public_shelves) shelf (value),
          jsonb_array_elements(shelf.value -> 'items') item (value)`;
      const own = `
        union select book_id::text from book_marks
        union select book_id::text from library_entries where removed_at is null
        union select book_id::text from book_encounters
        union select jsonb_array_elements_text(scene_books) from shop_private
        union select item.value ->> 'bookId' from shop_private,
          jsonb_array_elements(shelves) shelf (value),
          jsonb_array_elements(shelf.value -> 'items') item (value)`;
      const uuid = "'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'";
      for (const visitor of [null, AKI, BEN, CHI]) {
        const used = (
          await as<{ id: string }>(
            visitor,
            `select id from (${shown}${visitor ? own : ""}) used
             where id ~ ${uuid} order by id`,
          )
        ).map((row) => row.id);
        assert.ok(used.length >= 3, "the check sees books in use");
        const typedIn = (
          await as<{ id: string }>(
            visitor,
            "select id from books where source = 'manual' order by id",
          )
        ).map((row) => row.id);
        const theirOwn = visitor
          ? (
              await db.query<{ id: string }>(
                "select id::text from books where created_by = $1",
                [visitor],
              )
            ).rows.map((row) => row.id)
          : [];
        assert.deepEqual(
          used.filter((id) => !typedIn.includes(id)),
          [],
          `${visitor ?? "anon"} reads every book they see used`,
        );
        assert.deepEqual(
          typedIn.filter((id) => !used.includes(id) && !theirOwn.includes(id)),
          [],
          `${visitor ?? "anon"} reads no other typed-in book`,
        );
      }
      await as(AKI, "delete from reading_entries where id = $1", [record.id]);
      await as(
        AKI,
        `update shop_private set scene = null, shelves = '[
           {"id":"s1","name":"旅","isPublic":true},
           {"id":"s2","name":"秘密の棚","isPublic":false}
         ]' where shop_id = $1`,
        [akiShop.id],
      );
    },
  );

  await check(
    "the two questions about a book are the policy's, not the API's",
    async () => {
      // book_is_listed is planned to use its indexes, however few shops
      // there are (below).
      for (const [fn, config] of [
        [
          "private.book_is_listed(uuid)",
          ['search_path=""', "enable_seqscan=off"],
        ],
        ["private.book_is_mine(uuid)", ['search_path=""']],
      ] as const) {
        const [about] = (
          await db.query<{
            definer: boolean;
            config: string[];
            grantees: string[];
          }>(
            `select p.prosecdef as definer, p.proconfig as config,
               array(
                 select coalesce(r.rolname, 'PUBLIC')
                 from aclexplode(p.proacl) a
                 left join pg_roles r on r.oid = a.grantee
                 where a.grantee <> p.proowner
                 order by 1
               ) as grantees
             from pg_proc p where p.oid = $1::regprocedure`,
            [fn],
          )
        ).rows;
        // Run by anyone's reads through the policy, by nobody else; in the
        // private schema, which the API does not serve.
        assert.deepEqual(
          about,
          {
            definer: true,
            config,
            grantees: ["anon", "authenticated"],
          },
          fn,
        );
      }
      // It only ever answers about the reader who asks. Ben's request to take
      // down the book's cover (a report about it, filed above) is not a use
      // of it.
      const mine = (visitor: Visitor) =>
        as<{ mine: boolean }>(
          visitor,
          "select private.book_is_mine($1) as mine",
          [book.id],
        );
      const covers = await db.query<{ n: number }>(
        `select count(*)::int as n from reports
         where reporter_id = $1 and target_kind = 'book' and target_id = $2`,
        [BEN, book.id],
      );
      assert.equal(covers.rows[0].n, 1, "Ben's cover report is still there");
      assert.deepEqual(await mine(null), [{ mine: false }]);
      assert.deepEqual(await mine(AKI), [{ mine: true }]);
      assert.deepEqual(await mine(BEN), [{ mine: false }]);
    },
  );

  await check(
    "a book is asked about without searching every shop, nor every typed-in book",
    async () => {
      // The policy runs for each typed-in book a reader is not shown, so how
      // the database plans its questions decides how long a town takes to
      // load. What it plans follows the counts, so this is a town of its own,
      // analyzed as the hosted database is: a dozen open shops, each with a
      // public and a private shelf, and books its owner only scanned.
      const town = new PGlite({ extensions: { auto_explain } });
      await town.exec(supabase);
      for (const file of files) await town.exec(migrate(file));
      const id = (n: number) =>
        "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
      const shelf = (name: string, isPublic: boolean, books: string[]) => ({
        id: name,
        name,
        isPublic,
        items: books.map((bookId, i) => ({
          id: name + i,
          bookId,
          display: "face",
          pop: "店主のひとこと".repeat(8),
        })),
      });
      for (let n = 1; n <= 12; n++) {
        const owner = id(n);
        const books = Array.from({ length: 60 }, (_, i) => id(n * 1000 + i));
        await town.query("insert into auth.users (id) values ($1)", [owner]);
        await town.query(
          "insert into profiles (id, handle, name) values ($1, $2, $2)",
          [owner, "reader" + n],
        );
        await town.query(
          `insert into books (id, title, created_by, created_at)
           select book, '本', $2, now() - (at * 12 + $3) * interval '1 hour'
           from unnest($1::uuid[]) with ordinality as listed (book, at)`,
          [books, owner, n],
        );
        await town.query(
          "insert into shops (id, owner_id, name, is_open) values ($1, $2, '本屋', true)",
          [id(100 + n), owner],
        );
        await town.query(
          "insert into shop_private (shop_id, shelves) values ($1, $2)",
          [
            id(100 + n),
            JSON.stringify([
              shelf("public", true, books.slice(0, 10)),
              shelf("private", false, books.slice(10, 40)),
            ]),
          ],
        );
      }
      await town.exec("analyze");
      const asking = async (
        visitor: Visitor,
        sql: string,
        params: unknown[] = [],
      ) => {
        await town.exec(
          visitor
            ? `set role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', false);`
            : "set role anon; select set_config('request.jwt.claim.sub', '', false);",
        );
        const plans: string[] = [];
        try {
          const { rows } = await town.query<Record<string, unknown>>(
            sql,
            params,
            {
              onNotice: (notice) => plans.push(notice.message ?? ""),
            },
          );
          return { rows, plans };
        } finally {
          await town.exec("reset role");
        }
      };

      // Someone asks about a book another reader only scanned: signed out,
      // and as a reader with a shop of their own. No shop's shelves are
      // searched one by one. Whether an open shop shows the book is asked of
      // the shops indexes; the asker's own shop is found by its key, or by
      // testing shop_id first, before its shelves are read. Asked with
      // sequential scans off, as PGlite starts, and on, as the hosted
      // database runs.
      await town.exec(`
        load 'auto_explain';
        set auto_explain.log_min_duration = 0;
        set auto_explain.log_nested_statements = on;
        set auto_explain.log_analyze = on;
        set auto_explain.log_level = notice;
      `);
      const scannedOnly = id(2 * 1000 + 50);
      for (const seqscan of ["off", "on"])
        for (const visitor of [null, id(1)]) {
          await town.exec(`set enable_seqscan = ${seqscan}`);
          const { rows, plans } = await asking(
            visitor,
            "select id from books where id = $1",
            [scannedOnly],
          );
          assert.deepEqual(rows, []);
          const lines = plans.join("\n").split("\n");
          /** Each scan of a table, with its own lines up to the next node. */
          const scansOf = (table: string) =>
            lines.flatMap((line, at) => {
              if (!line.includes(` on ${table} `)) return [];
              const below = lines.slice(at + 1);
              const end = below.findIndex((next) =>
                /^\s*(->|InitPlan|SubPlan)/.test(next),
              );
              return [
                [line, ...below.slice(0, end < 0 ? undefined : end)].join("\n"),
              ];
            });
          const asked = `${visitor ? "a reader" : "anon"}, seqscan ${seqscan}`;
          const shops = scansOf("shops");
          assert.ok(
            shops.some((scan) => /^\s*(Index|Recheck) Cond: .*@>/m.test(scan)),
            `${asked}: open shops are searched through an index\n` +
              shops.join("\n"),
          );
          for (const scan of shops)
            assert.doesNotMatch(scan, /^\s*Filter: .*@>/m, asked);
          const own = scansOf("shop_private");
          assert.ok(own.length > 0, `${asked}: the asker's own shop`);
          for (const scan of own)
            assert.match(
              scan,
              /^\s*(Index Cond|Recheck Cond|Filter): \(+shop_id = /m,
              `${asked}\n${scan}`,
            );
        }
      await town.exec("set auto_explain.log_min_duration = -1");

      // The town's newest books (booksFor, src/lib/supabase/town-backend.ts)
      // are read newest first and stop at the 300th readable one, rather
      // than asking about every typed-in book and then sorting. PGlite
      // starts with sequential scans off; the hosted database has them on.
      await town.exec("set enable_seqscan = on");
      for (const visitor of [null, id(1)]) {
        const plan = (
          await asking(
            visitor,
            "explain select id from books order by created_at desc limit 300",
          )
        ).rows
          .map((row) => Object.values(row).join(""))
          .join("\n");
        assert.match(plan, /Index Scan using books_created on books/, plan);
        assert.doesNotMatch(plan, /Sort/, plan);
      }
      await town.close();
    },
  );

  // 注釈モード: two staff members, whom the operator adds in the dashboard,
  // and Chi, who is not staff.
  const NOTE_STAFF = reader(20);
  const NOTE_STAFF2 = reader(21);
  await db.exec(
    `insert into auth.users (id) values ('${NOTE_STAFF}'), ('${NOTE_STAFF2}')`,
  );
  // This database ran its migrations before anyone signed up: no staff yet.
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from private.staff",
      )
    ).rows[0].n,
    0,
  );
  await operator(
    `insert into private.staff (user_id) values ('${NOTE_STAFF}'), ('${NOTE_STAFF2}')`,
  );
  /** Leaves a note as `visitor`; `change` swaps one value of the row for a test. */
  const leaveNote = (
    visitor: Visitor,
    body: string,
    change: Record<string, string> = {},
  ) => {
    const row: Record<string, string> = {
      page: "'/books/solaris/'",
      x: "120",
      y: "640",
      viewport_w: "390",
      viewport_h: "844",
      scroll_y: "300",
      target: "'リンク「本の街へ」'",
      layer: "null",
      anchor: "'main.town-main > a.back-link'",
      anchor_x: "0.5",
      anchor_y: "0.25",
      body: "$1",
      device: "'iPhone Safari'",
      build: "null",
      ...change,
    };
    return as<{
      id: string;
      user_id: string;
      created_at: string;
      removed_at: string | null;
    }>(
      visitor,
      `insert into site_notes (${Object.keys(row).join(", ")})
       values (${Object.values(row).join(", ")})
       returning id, user_id, created_at, removed_at`,
      [body],
    );
  };
  const notesSeenBy = async (visitor: Visitor) =>
    (await as(visitor, "select id from site_notes")).length;
  const canAnnotate = async (visitor: Visitor) =>
    (
      await as<{ ok: boolean }>(visitor, "select public.can_annotate() as ok")
    )[0].ok;
  let staffNote = "";

  await check(
    "staff leave notes as themselves and read only their own",
    async () => {
      assert.equal(await canAnnotate(NOTE_STAFF), true);
      const [note] = await leaveNote(NOTE_STAFF, "戻るの字が小さい");
      staffNote = note.id;
      assert.equal(note.user_id, NOTE_STAFF);
      assert.ok(note.created_at);
      assert.equal(note.removed_at, null);
      assert.equal(await notesSeenBy(NOTE_STAFF), 1);
      // Another staff member neither reads nor takes it back, even with
      // an update that names no row (and so reads nothing to be hidden by).
      assert.equal(await notesSeenBy(NOTE_STAFF2), 0);
      assert.equal(
        await affects(
          NOTE_STAFF2,
          "update site_notes set removed_at = now() where id = $1",
          [staffNote],
        ),
        0,
      );
      await as(NOTE_STAFF2, "update site_notes set removed_at = now()");
      assert.equal(
        (
          await db.query<{ removed_at: string | null }>(
            "select removed_at from site_notes where id = $1",
            [staffNote],
          )
        ).rows[0].removed_at,
        null,
      );
      // Nobody names the writer or the time: both come from the database.
      await refused(
        NOTE_STAFF,
        "insert into site_notes (user_id, page, x, y, viewport_w, viewport_h, scroll_y, body) values ($1, '/', 1, 1, 1, 1, 0, 'x')",
        [NOTE_STAFF2],
        /permission denied/,
      );
      await refused(
        NOTE_STAFF,
        "insert into site_notes (created_at, page, x, y, viewport_w, viewport_h, scroll_y, body) values (now() - interval '2 hours', '/', 1, 1, 1, 1, 0, 'x')",
        [],
        /permission denied/,
      );
    },
  );

  await check("site notes are closed to anyone who is not staff", async () => {
    await refused(null, "select * from site_notes", [], /permission denied/);
    await refused(
      null,
      "select public.can_annotate()",
      [],
      /permission denied/,
    );
    await refused(
      null,
      "insert into site_notes (page, x, y, viewport_w, viewport_h, scroll_y, body) values ('/', 1, 1, 1, 1, 0, 'x')",
      [],
      /permission denied/,
    );
    await refused(null, "select * from private.staff", [], /permission denied/);
    assert.equal(await canAnnotate(CHI), false);
    await refused(
      CHI,
      "insert into site_notes (page, x, y, viewport_w, viewport_h, scroll_y, body) values ('/', 1, 1, 1, 1, 0, 'x')",
      [],
      /row-level security/,
    );
    assert.equal(await notesSeenBy(CHI), 0);
    assert.equal(
      await affects(CHI, "update site_notes set removed_at = now()"),
      0,
    );
    await refused(CHI, "select * from private.staff", [], /permission denied/);
    await refused(
      CHI,
      "insert into private.staff (user_id) values ($1)",
      [CHI],
      /permission denied/,
    );
  });

  await check("a note is only ever taken back or returned", async () => {
    const [taken] = await as<{ removed_at: string }>(
      NOTE_STAFF,
      "update site_notes set removed_at = '2020-01-01' where id = $1 returning removed_at",
      [staffNote],
    );
    // Dated now by the database, whatever time was sent.
    assert.ok(new Date(taken.removed_at).getFullYear() >= 2026);
    const [returned] = await as<{ removed_at: string | null }>(
      NOTE_STAFF,
      "update site_notes set removed_at = null where id = $1 returning removed_at",
      [staffNote],
    );
    assert.equal(returned.removed_at, null);
    await refused(
      NOTE_STAFF,
      "update site_notes set body = 'changed' where id = $1",
      [staffNote],
      /permission denied/,
    );
    await refused(
      NOTE_STAFF,
      "update site_notes set page = '/', removed_at = now() where id = $1",
      [staffNote],
      /permission denied/,
    );
    await refused(
      NOTE_STAFF,
      "delete from site_notes where id = $1",
      [staffNote],
      /permission denied/,
    );
  });

  await check("a note's size is limited", async () => {
    // Empty, untrimmed (the ideographic space too) or longer than 2000.
    for (const body of ["", " x", "x\n", "x　", "あ".repeat(2001)])
      await assert.rejects(
        leaveNote(NOTE_STAFF, body),
        /check constraint/,
        JSON.stringify(body),
      );
    assert.equal((await leaveNote(NOTE_STAFF, "あ".repeat(2000))).length, 1);
    const tooMuch: Record<string, string>[] = [
      { page: "'shop'" },
      { page: "'/" + "a".repeat(500) + "'" },
      { target: "repeat('あ', 301)" },
      { device: "repeat('a', 41)" },
      { layer: "''" },
      { layer: "repeat('あ', 121)" },
      { anchor: "repeat('a', 501)" },
      { anchor_y: "null" },
      { anchor_x: "1.5" },
      { build: "'main'" },
      { x: "-1" },
      { x: "100001" },
      { y: "-1" },
      { y: "10000001" },
      { scroll_y: "-1" },
      { scroll_y: "10000001" },
      { viewport_w: "0" },
      { viewport_w: "20001" },
      { viewport_h: "0" },
      { viewport_h: "20001" },
    ];
    for (const change of tooMuch)
      await assert.rejects(
        leaveNote(NOTE_STAFF, "x", change),
        /check constraint/,
        JSON.stringify(change),
      );
    assert.equal(
      (await leaveNote(NOTE_STAFF, "x", { build: "'d9eb95a'" })).length,
      1,
    );
    assert.equal(
      (
        await leaveNote(NOTE_STAFF, "x", {
          layer: "'Book Townへようこそ'",
          anchor_x: "null",
          anchor_y: "null",
        })
      ).length,
      1,
    );
  });

  await check(
    "the screen asks for a page's own notes, read alike by Postgres",
    async () => {
      const odd = "/shops/a.b(c)+%_[1]$/";
      const pages = [
        "/",
        "/?id=1",
        "/walk/#shop-orbit",
        odd,
        odd + "?id=1",
        odd + "#shop",
        odd + "more/",
        "/shops/aXb(c)+%_[1]$/",
      ];
      for (const page of pages)
        await as(
          NOTE_STAFF,
          "insert into site_notes (page, x, y, viewport_w, viewport_h, scroll_y, body) values ($1, 1, 1, 390, 844, 0, 'ページ')",
          [page],
        );
      const found = async (pathname: string) =>
        (
          await as<{ page: string }>(
            NOTE_STAFF,
            "select distinct page from site_notes where page ~ $1",
            [pagePattern(pathname)],
          )
        )
          .map((row) => row.page)
          .sort();
      assert.deepEqual(await found("/"), ["/", "/?id=1"]);
      assert.deepEqual(await found(odd), [odd, odd + "#shop", odd + "?id=1"]);
      assert.deepEqual(await found("/walk/"), ["/walk/#shop-orbit"]);
    },
  );

  await check("sixty notes an hour, then a pause", async () => {
    for (let n = 0; n < 60; n++) await leaveNote(NOTE_STAFF2, "注釈" + n);
    await assert.rejects(
      leaveNote(NOTE_STAFF2, "もう1つ"),
      /60 site notes an hour/,
    );
    // Taking notes back makes no room: they were still sent.
    assert.equal(
      await affects(NOTE_STAFF2, "update site_notes set removed_at = now()"),
      60,
    );
    await assert.rejects(
      leaveNote(NOTE_STAFF2, "もう1つ"),
      /60 site notes an hour/,
    );
    await operator(
      `update site_notes set created_at = created_at - interval '61 minutes' where user_id = '${NOTE_STAFF2}'`,
    );
    assert.equal((await leaveNote(NOTE_STAFF2, "1時間後")).length, 1);
  });

  await check(
    "a person no longer staff can neither read nor write notes",
    async () => {
      assert.ok((await notesSeenBy(NOTE_STAFF2)) > 0);
      await operator(
        `delete from private.staff where user_id = '${NOTE_STAFF2}'`,
      );
      assert.equal(await canAnnotate(NOTE_STAFF2), false);
      assert.equal(await notesSeenBy(NOTE_STAFF2), 0);
      await assert.rejects(leaveNote(NOTE_STAFF2, "x"), /row-level security/);
      assert.equal(
        await affects(NOTE_STAFF2, "update site_notes set removed_at = now()"),
        0,
      );
    },
  );

  await check(
    "site notes and staff are open only as far as granted",
    async () => {
      const yes = async (sql: string, params: unknown[]) =>
        (await db.query<{ ok: boolean }>(sql, params)).rows[0].ok;
      const table = (role: string, name: string, privilege: string) =>
        yes("select has_table_privilege($1, $2, $3) as ok", [
          role,
          name,
          privilege,
        ]);
      const column = (role: string, name: string, privilege: string) =>
        yes(
          "select has_column_privilege($1, 'public.site_notes', $2, $3) as ok",
          [role, name, privilege],
        );
      const runs = (role: string, fn: string) =>
        yes("select has_function_privilege($1, $2, 'EXECUTE') as ok", [
          role,
          fn,
        ]);
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          assert.equal(
            await table(role, "private.staff", privilege),
            false,
            `${role} ${privilege} private.staff`,
          );
        for (const privilege of ["DELETE", "TRUNCATE"])
          assert.equal(
            await table(role, "public.site_notes", privilege),
            false,
            `${role} ${privilege} site_notes`,
          );
        for (const fn of [
          "private.limit_site_notes()",
          "private.stamp_site_note_removal()",
        ])
          assert.equal(await runs(role, fn), false, role + " " + fn);
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE"])
        assert.equal(
          await table("anon", "public.site_notes", privilege),
          false,
          "anon " + privilege,
        );
      assert.equal(await column("authenticated", "body", "UPDATE"), false);
      assert.equal(await column("authenticated", "removed_at", "UPDATE"), true);
      for (const name of ["user_id", "created_at", "removed_at", "id"])
        assert.equal(
          await column("authenticated", name, "INSERT"),
          false,
          "insert " + name,
        );
      assert.equal(await column("authenticated", "body", "INSERT"), true);
      assert.equal(await runs("anon", "public.can_annotate()"), false);
      assert.equal(await runs("authenticated", "public.can_annotate()"), true);
      assert.equal(
        await yes(
          `select prosecdef and 'search_path=""' = any(proconfig) as ok
           from pg_proc where oid = 'public.can_annotate()'::regprocedure`,
          [],
        ),
        true,
      );
    },
  );

  await check(
    "deleting a staff account removes their notes and their staff row",
    async () => {
      await db.exec(`delete from auth.users where id = '${NOTE_STAFF}'`);
      for (const table of ["site_notes", "private.staff"])
        assert.equal(
          (
            await db.query<{ n: number }>(
              `select count(*)::int as n from ${table} where user_id = $1`,
              [NOTE_STAFF],
            )
          ).rows[0].n,
          0,
          table,
        );
    },
  );

  // My library and the encounters behind it (20261025000000_library.sql).
  // Chi keeps a library; Aki writes the posts and keeps the shop Chi meets
  // books in. Ids made by a device (shelves, encounters) come from lib().
  const lib = (n: number) =>
    "00000000-0000-4000-8000-0000004" + String(n).padStart(5, "0");
  let made = 0;
  const deviceId = () => lib((made += 1));
  /** A book typed in by `visitor` and used nowhere yet. */
  const newBook = async (visitor: string, title = "棚の本") =>
    (
      await as<{ id: string }>(
        visitor,
        "insert into books (title, created_by) values ($1, $2) returning id",
        [title, visitor],
      )
    )[0].id;
  const libraryTables = [
    "library_entries",
    "library_shelves",
    "library_shelf_books",
    "book_encounters",
  ];
  const ENTRY_COLUMNS =
    "user_id, book_id, status, status_at, wanted_at, liked_at, owned, source, batch_id, added_at, removed_at, like_restored";
  const SHELF_COLUMNS =
    "id, user_id, name, note, position, show_wanted, created_at, deleted_at";
  const SHELF_BOOK_COLUMNS = "shelf_id, user_id, book_id, added_at, position";
  const ENCOUNTER_COLUMNS =
    "id, user_id, book_id, kind, via, post_id, shop_id, placement_key, other_reader_id, memo, memo_at, undone_at, created_at";
  /**
   * The statement the API builds for the app's insert of new rows
   * (upsert with ignoreDuplicates): how many of them were new.
   */
  const insertRows = async (
    visitor: string,
    table: string,
    columns: string,
    conflict: string,
    rows: object[],
  ) =>
    (
      await as<{ count: number }>(
        visitor,
        `with saved as (
           insert into ${table} (${columns})
           select ${columns} from json_populate_recordset(null::${table}, $1)
           on conflict (${conflict}) do nothing
           returning 1
         ) select count(*)::int as count from saved`,
        [JSON.stringify(rows)],
      )
    )[0].count;
  const snake = (key: string) =>
    key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
  /** A library row as the app sends it: every column but updated_at. */
  const rowOf = (user: string, entry: LibraryEntry) => ({
    user_id: user,
    ...Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [snake(key), value]),
    ),
  });
  const putEntry = (user: string, bookId: string, part: EntryPart = {}) =>
    insertRows(user, "library_entries", ENTRY_COLUMNS, "user_id, book_id", [
      rowOf(user, entryOf(bookId, part)),
    ]);
  const iso = (value: unknown) =>
    value === null ? null : (value as Date).toISOString();
  /** A row read back as the app's LibraryEntry. */
  const entryFrom = (row: Record<string, unknown>): LibraryEntry => ({
    bookId: row.book_id as string,
    status: row.status as LibraryEntry["status"],
    statusAt: iso(row.status_at),
    wantedAt: iso(row.wanted_at),
    likedAt: iso(row.liked_at),
    owned: row.owned as LibraryEntry["owned"],
    source: row.source as LibraryEntry["source"],
    batchId: row.batch_id as string | null,
    addedAt: iso(row.added_at) as string,
    removedAt: iso(row.removed_at),
    likeRestored: row.like_restored as boolean,
  });
  const rowsOf = (visitor: string, bookId: string) =>
    as(visitor, "select * from library_entries where book_id = $1", [bookId]);
  const shelfRow = (id: string, part: Record<string, unknown> = {}) => ({
    id,
    user_id: CHI,
    name: "SF",
    note: "",
    position: "a0",
    show_wanted: true,
    created_at: "2026-09-01T00:00:00.000Z",
    deleted_at: null,
    ...part,
  });
  const putShelf = (part: Record<string, unknown> = {}, id = deviceId()) =>
    insertRows(
      (part.user_id as string | undefined) ?? CHI,
      "library_shelves",
      SHELF_COLUMNS,
      "id",
      [shelfRow(id, part)],
    ).then(() => id);
  const shelve = (shelfId: string, bookId: string, user = CHI) =>
    insertRows(
      user,
      "library_shelf_books",
      SHELF_BOOK_COLUMNS,
      "shelf_id, book_id",
      [
        {
          shelf_id: shelfId,
          user_id: user,
          book_id: bookId,
          added_at: "2026-09-01T00:00:00.000Z",
          position: null,
        },
      ],
    );
  type EncounterRow = Record<string, string | null> & { id: string };
  /** An encounter as the app sends it: Chi's 読みたい on a book's page unless told otherwise. */
  const encounterRow = (
    part: Record<string, string | null> = {},
  ): EncounterRow => ({
    id: deviceId(),
    user_id: CHI,
    book_id: null,
    kind: "want",
    via: "book",
    post_id: null,
    shop_id: null,
    placement_key: null,
    other_reader_id: null,
    memo: null,
    memo_at: null,
    undone_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...part,
  });
  const meet = (row: Record<string, unknown>, visitor = CHI) =>
    insertRows(visitor, "book_encounters", ENCOUNTER_COLUMNS, "id", [row]);
  /** The database's error for a statement, which must be refused. */
  const refusal = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      const { message, code } = error as { message: string; code?: string };
      return { message, code };
    }
    assert.fail("expected the database to refuse");
  };
  /** Writes as the app that knows the library: it sends x-booktown-library: 1. */
  const withLibraryHeader = async <T>(write: () => Promise<T>, value = "1") => {
    await db.exec(
      `select set_config('request.headers', '${JSON.stringify({ "x-booktown-library": value })}', false)`,
    );
    try {
      return await write();
    } finally {
      await db.exec("select set_config('request.headers', '', false)");
    }
  };
  /** A mark, dated `at` or now, written by `visitor`'s app. */
  const mark = (
    kind: string,
    bookId: string,
    at: string | null = null,
    visitor = CHI,
  ) =>
    as(
      visitor,
      `insert into book_marks (user_id, book_id, kind, created_at)
       values ($1, $2, $3, coalesce($4::timestamptz, now()))`,
      [visitor, bookId, kind, at],
    );
  const unmark = (kind: string, bookId: string, visitor = CHI) =>
    as(
      visitor,
      "delete from book_marks where user_id = $1 and book_id = $2 and kind = $3",
      [visitor, bookId, kind],
    );
  const postAbout = async (
    visitor: string,
    bookId: string | null,
    more: { parent?: string; mode?: string } = {},
  ) =>
    (
      await as<{ id: string }>(
        visitor,
        "insert into posts (author_id, body, book_id, parent_id, reading_mode) values ($1, '出会った本', $2, $3, $4) returning id",
        [visitor, bookId, more.parent ?? null, more.mode ?? null],
      )
    )[0].id;

  await check(
    "a library, its shelves and its encounters are their reader's alone",
    async () => {
      const chis = await newBook(CHI);
      const chis2 = await newBook(CHI);
      const akis = await newBook(AKI);
      await putEntry(CHI, chis);
      await putEntry(CHI, chis2);
      await putEntry(AKI, akis);
      const chiShelf = await putShelf();
      const akiShelf = await putShelf({ user_id: AKI });
      await shelve(chiShelf, chis);
      await shelve(akiShelf, akis, AKI);
      await meet(encounterRow({ book_id: chis }));
      const everything = async () => {
        const rows: unknown[] = [];
        for (const table of libraryTables)
          rows.push(
            (await db.query(`select * from ${table} order by 1, 2, 3`)).rows,
          );
        return rows;
      };
      const before = await everything();
      // Rows of Chi's, which someone signed out and Aki try to write.
      const chisRows: [string, string, string, object][] = [
        [
          "library_entries",
          ENTRY_COLUMNS,
          "user_id, book_id",
          rowOf(CHI, entryOf(akis, {})),
        ],
        ["library_shelves", SHELF_COLUMNS, "id", shelfRow(deviceId())],
        [
          "library_shelf_books",
          SHELF_BOOK_COLUMNS,
          "shelf_id, book_id",
          {
            shelf_id: chiShelf,
            user_id: CHI,
            book_id: chis2,
            added_at: "2026-09-01T00:00:00.000Z",
            position: null,
          },
        ],
        [
          "book_encounters",
          ENCOUNTER_COLUMNS,
          "id",
          encounterRow({ book_id: akis }),
        ],
      ];
      for (const [table, columns, conflict, row] of chisRows) {
        await refused(null, `select * from ${table}`, [], /permission/);
        await refused(
          null,
          `insert into ${table} (${columns})
           select ${columns} from json_populate_record(null::${table}, $1)`,
          [JSON.stringify(row)],
          /permission/,
        );
        assert.equal(
          (await as(AKI, `select * from ${table} where user_id = $1`, [CHI]))
            .length,
          0,
          table,
        );
        await assert.rejects(
          insertRows(AKI, table, columns, conflict, [row]),
          /row-level security/,
          table,
        );
        assert.ok(
          (await as(CHI, `select user_id from ${table}`)).every(
            (row) => row.user_id === CHI,
          ),
          table,
        );
      }
      for (const sql of [
        "update library_entries set status = 'finished' where user_id = $1",
        "update library_shelves set name = '横取り' where user_id = $1",
        "update library_shelf_books set position = 'a1' where user_id = $1",
        "update book_encounters set memo = '横取り' where user_id = $1",
        "delete from library_shelf_books where user_id = $1",
        "delete from book_encounters where user_id = $1",
      ])
        assert.equal(await affects(AKI, sql, [CHI]), 0, sql);
      // Nobody puts a book on another's shelf, or one outside their own
      // library on their own shelf.
      for (const [visitor, shelfId, bookId] of [
        [AKI, chiShelf, akis],
        [AKI, akiShelf, chis],
        [CHI, chiShelf, akis],
      ])
        await assert.rejects(
          shelve(shelfId, bookId, visitor),
          /foreign key/,
          `${visitor} ${bookId}`,
        );
      assert.deepEqual(await everything(), before);
    },
  );

  await check(
    "rows and shelves are never deleted, and a shelf put away keeps its books and their other shelves",
    async () => {
      const kept = await newBook(CHI);
      await putEntry(CHI, kept);
      const sf = await putShelf({ name: "SF" });
      const night = await putShelf({ name: "夜に読む", position: "a1" });
      await shelve(sf, kept);
      await shelve(night, kept);
      await refused(
        CHI,
        "delete from library_entries where book_id = $1",
        [kept],
        /permission/,
      );
      await refused(
        CHI,
        "delete from library_shelves where id = $1",
        [sf],
        /permission/,
      );
      const putAway = (deletedAt: string | null) =>
        affects(
          CHI,
          "update library_shelves set deleted_at = $3 where id = $1 and user_id = $2",
          [sf, CHI, deletedAt],
        );
      const shelvesOfKept = async () =>
        (
          await as<{ shelf_id: string }>(
            CHI,
            "select shelf_id from library_shelf_books where book_id = $1 order by shelf_id",
            [kept],
          )
        ).map((row) => row.shelf_id);
      assert.equal(await putAway("2026-09-05T00:00:00.000Z"), 1);
      assert.deepEqual(await shelvesOfKept(), [sf, night].sort());
      assert.equal(entryFrom((await rowsOf(CHI, kept))[0]).removedAt, null);
      assert.equal(await putAway(null), 1);
      assert.deepEqual(await shelvesOfKept(), [sf, night].sort());
    },
  );

  await check("the library is open only as far as granted", async () => {
    const yes = async (sql: string, params: unknown[]) =>
      (await db.query<{ ok: boolean }>(sql, params)).rows[0].ok;
    const table = (role: string, name: string, privilege: string) =>
      yes("select has_table_privilege($1, $2, $3) as ok", [
        role,
        name,
        privilege,
      ]);
    /** The columns of a table a role may use for a privilege, in order. */
    const columns = async (role: string, name: string, privilege: string) =>
      (
        await db.query<{ name: string }>(
          `select attname as name from pg_attribute
           where attrelid = $2::regclass and attnum > 0 and not attisdropped
             and has_column_privilege($1, attrelid, attnum, $3)
           order by attnum`,
          [role, name, privilege],
        )
      ).rows.map((row) => row.name);
    const list = (names: string) => names.split(", ");
    for (const name of libraryTables) {
      assert.equal(
        await yes(
          "select relrowsecurity as ok from pg_class where oid = $1::regclass",
          [name],
        ),
        true,
        name,
      );
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ])
        assert.equal(
          await table("anon", name, privilege),
          false,
          `anon ${privilege} ${name}`,
        );
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"])
        assert.deepEqual(
          await columns("anon", name, privilege),
          [],
          `anon ${privilege} ${name}`,
        );
      for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"])
        assert.equal(
          await table("authenticated", name, privilege),
          false,
          `${privilege} ${name}`,
        );
      assert.equal(await table("authenticated", name, "SELECT"), true, name);
      // Rows and shelves are only marked; a book's place on a shelf and an
      // encounter taken back without a memo are deleted.
      assert.equal(
        await table("authenticated", name, "DELETE"),
        name === "library_shelf_books" || name === "book_encounters",
        `delete ${name}`,
      );
    }
    for (const [name, privilege, names] of [
      ["library_entries", "INSERT", ENTRY_COLUMNS],
      [
        "library_entries",
        "UPDATE",
        "status, status_at, wanted_at, liked_at, owned, removed_at, like_restored",
      ],
      ["library_shelves", "INSERT", SHELF_COLUMNS],
      [
        "library_shelves",
        "UPDATE",
        "name, note, position, show_wanted, deleted_at",
      ],
      ["library_shelf_books", "INSERT", SHELF_BOOK_COLUMNS],
      ["library_shelf_books", "UPDATE", "position"],
      ["book_encounters", "INSERT", ENCOUNTER_COLUMNS],
      ["book_encounters", "UPDATE", "memo, memo_at, undone_at"],
    ])
      assert.deepEqual(
        await columns("authenticated", name, privilege),
        list(names),
        `${privilege} ${name}`,
      );
    for (const privilege of ["INSERT", "UPDATE"]) {
      const theirs = await columns(
        "authenticated",
        "reader_settings",
        privilege,
      );
      for (const name of list(
        "library_hidden, likes_in_library, wanted_clears_on_status, memo_hint",
      ))
        assert.ok(theirs.includes(name), `${privilege} ${name}`);
      assert.deepEqual(await columns("anon", "reader_settings", privilege), []);
    }
    for (const role of ["anon", "authenticated"])
      for (const fn of [
        "private.check_book_encounter()",
        "private.library_clamp_times()",
        "private.encounter_clamp_times()",
        "private.library_follows_marks()",
        "private.library_backfill()",
      ])
        assert.equal(
          await yes("select has_function_privilege($1, $2, 'EXECUTE') as ok", [
            role,
            fn,
          ]),
          false,
          `${role} ${fn}`,
        );
    // book_is_mine is widened, still called by the books' policy as before.
    for (const role of ["anon", "authenticated"])
      assert.equal(
        await yes("select has_function_privilege($1, $2, 'EXECUTE') as ok", [
          role,
          "private.book_is_mine(uuid)",
        ]),
        true,
      );
    // The copy of marks runs as its owner (an account's deletion reaches it
    // as supabase_auth_admin); the check of an encounter as the reader, so
    // that the posts' and shops' own policies answer it.
    const runsAs = (fn: string) =>
      db
        .query<{ definer: boolean; config: string[] }>(
          "select prosecdef as definer, proconfig as config from pg_proc where oid = $1::regprocedure",
          [fn],
        )
        .then((result) => result.rows[0]);
    for (const [fn, definer] of [
      ["private.library_follows_marks()", true],
      ["private.book_is_mine(uuid)", true],
      ["private.check_book_encounter()", false],
      ["private.library_clamp_times()", false],
      ["private.encounter_clamp_times()", false],
      ["private.library_backfill()", false],
    ] as const)
      assert.deepEqual(
        await runsAs(fn),
        { definer, config: ['search_path=""'] },
        fn,
      );
  });

  await check("the library refuses what no right write sends", async () => {
    // Every source the app knows is taken, those of N19 and N20 too.
    for (const source of ENTRY_SOURCES)
      assert.equal(await putEntry(CHI, await newBook(CHI), { source }), 1);
    const b = await newBook(CHI);
    for (const part of [
      { status: "done" },
      { owned: "maybe" },
      { source: "gift" },
      { source: null },
      { added_at: null },
      { like_restored: null },
    ])
      await assert.rejects(
        insertRows(CHI, "library_entries", ENTRY_COLUMNS, "user_id, book_id", [
          { ...rowOf(CHI, entryOf(b, {})), ...part },
        ]),
        /check constraint|not-null/,
        JSON.stringify(part),
      );
    for (const part of [
      { name: "   " },
      { name: "あ".repeat(41) },
      { note: "あ".repeat(501) },
      { position: "" },
      { position: "a-1" },
      { position: "あ" },
      { position: "a".repeat(65) },
      { show_wanted: null },
    ])
      await assert.rejects(
        putShelf(part),
        /check constraint|not-null/,
        JSON.stringify(part),
      );
    // At the limits, taken: a name of 40 between spaces, a note of 500.
    const edge = await putShelf({
      name: " " + "𠮷".repeat(40) + " ",
      note: "あ".repeat(500),
      position: "Zz09".repeat(16),
    });
    await putEntry(CHI, b);
    await assert.rejects(
      insertRows(
        CHI,
        "library_shelf_books",
        SHELF_BOOK_COLUMNS,
        "shelf_id, book_id",
        [
          {
            shelf_id: edge,
            user_id: CHI,
            book_id: b,
            added_at: "2026-09-01T00:00:00.000Z",
            position: "a b",
          },
        ],
      ),
      /check constraint/,
    );
    for (const part of [
      { kind: "sad" },
      { via: "shelf" },
      { kind: "like" },
      { kind: "love" },
      { memo: "" },
      { memo: "𠮷".repeat(ENCOUNTER_MEMO_MAX_LENGTH + 1) },
      { created_at: null },
    ] as Record<string, string | null>[])
      await assert.rejects(
        meet(encounterRow({ book_id: b, ...part })),
        /check constraint|not-null/,
        JSON.stringify(part),
      );
    assert.equal(
      await meet(
        encounterRow({
          book_id: b,
          memo: "𠮷".repeat(ENCOUNTER_MEMO_MAX_LENGTH),
          memo_at: "2026-09-02T00:00:00.000Z",
        }),
      ),
      1,
    );
  });

  await check(
    "the library takes the statements the app sends, and refuses those it must not send",
    async () => {
      const books = (
        await as<{ id: string }>(
          CHI,
          "insert into books (title, created_by) select '百冊のうち' || n, $1 from generate_series(1, 100) n returning id",
          [CHI],
        )
      ).map((row) => row.id);
      const ids = (some: string[]) => `{${some.join(",")}}`;
      // New rows, inserted ignoring duplicates: sent again, none is new.
      const rows = books.map((id) => rowOf(CHI, entryOf(id, {})));
      for (const expected of [100, 0])
        assert.equal(
          await insertRows(
            CHI,
            "library_entries",
            ENTRY_COLUMNS,
            "user_id, book_id",
            rows,
          ),
          expected,
        );
      // The columns changed, for 100 books at once (in=).
      assert.equal(
        (
          await as(
            CHI,
            `update library_entries set status = 'finished', status_at = $3
             where user_id = $1 and book_id = any ($2::uuid[]) returning book_id`,
            [CHI, ids(books), "2026-09-01T00:00:00.000Z"],
          )
        ).length,
        100,
      );
      // A shelf renamed; books put on it (again: not new) and taken off.
      const trip = await putShelf({ name: "旅" });
      assert.equal(
        await affects(
          CHI,
          "update library_shelves set name = $3 where id = $1 and user_id = $2",
          [trip, CHI, "旅の本"],
        ),
        1,
      );
      for (const [book, expected] of [
        [books[0], 1],
        [books[0], 0],
        [books[1], 1],
      ] as const)
        assert.equal(await shelve(trip, book), expected);
      assert.equal(
        await affects(
          CHI,
          `delete from library_shelf_books
           where user_id = $1 and shelf_id = $2 and book_id = any ($3::uuid[])`,
          [CHI, trip, ids(books.slice(0, 2))],
        ),
        2,
      );
      // A partial upsert (the key and the columns changed) is refused, row
      // or no row: as the API builds it, for the key it may not update; and
      // with only the columns changed, for the source left null, which is
      // checked before the conflict is.
      for (const id of [books[2], await newBook(CHI)]) {
        await refused(
          CHI,
          `insert into library_entries (user_id, book_id, status) values ($1, $2, 'reading')
           on conflict (user_id, book_id) do update
             set user_id = excluded.user_id, book_id = excluded.book_id, status = excluded.status`,
          [CHI, id],
          /permission denied/,
        );
        await refused(
          CHI,
          `insert into library_entries (user_id, book_id, status) values ($1, $2, 'reading')
           on conflict (user_id, book_id) do update set status = excluded.status`,
          [CHI, id],
          /null value in column "source"/,
        );
      }
      // The shelf books' default upsert would update every column it sends,
      // and only position may be: refused, even for a book not yet there.
      await refused(
        CHI,
        `insert into library_shelf_books (${SHELF_BOOK_COLUMNS}) values ($1, $2, $3, now(), null)
         on conflict (shelf_id, book_id) do update
           set shelf_id = excluded.shelf_id, user_id = excluded.user_id,
             book_id = excluded.book_id, added_at = excluded.added_at,
             position = excluded.position`,
        [trip, CHI, books[3]],
        /permission denied/,
      );
    },
  );

  for (const c of LIBRARY_CASES.follow)
    await check(`book_marks_follow: ${c.name}`, async () => {
      const b = await newBook(CHI, "印の本");
      // Set up as the app that knows the library writes: nothing is copied.
      await withLibraryHeader(async () => {
        if (c.entry) await putEntry(CHI, b, c.entry);
        for (const kind of c.marks)
          await mark(kind, b, "2026-08-01T00:00:00.000Z");
        if (c.shelf !== "none") {
          const shelfId = await putShelf({
            deleted_at:
              c.shelf === "deleted" ? "2026-09-02T00:00:00.000Z" : null,
          });
          await shelve(shelfId, b);
        }
        if (c.record)
          await as(
            CHI,
            "insert into reading_entries (user_id, book_id) values ($1, $2)",
            [CHI, b],
          );
        if (c.memo)
          await meet(
            encounterRow({
              book_id: b,
              memo: "なぜ読みたいか",
              memo_at: "2026-09-02T00:00:00.000Z",
              undone_at: "2026-09-03T00:00:00.000Z",
            }),
          );
      });
      const before = await rowsOf(CHI, b);
      const clock = async () =>
        (await db.query<{ at: Date }>("select clock_timestamp() as at")).rows[0]
          .at;
      const start = await clock();
      // The change, by an app that does not know the library.
      if (c.change.op === "insert") await mark(c.change.kind, b, c.change.at);
      else await unmark(c.change.kind, b);
      const end = await clock();
      const after = await rowsOf(CHI, b);
      if (c.expect === "same") {
        assert.deepEqual(after, before, "not even updated_at");
        return;
      }
      if (c.expect === null) {
        assert.deepEqual(after, []);
        return;
      }
      const row = entryFrom(after[0]);
      // "@now" is the database's time, between the two readings of the clock.
      const expect = { ...c.expect };
      for (const field of ["removedAt", "statusAt"] as const)
        if (expect[field] === "@now") {
          const at = Date.parse(row[field] ?? "");
          assert.ok(at >= start.getTime() && at <= end.getTime(), field);
          expect[field] = row[field];
        }
      assert.deepEqual(row, entryOf(b, expect));
    });

  await check(
    "marks written with x-booktown-library: 1 are left alone, and a mark already there fires nothing",
    async () => {
      const kinds = ["wish", "favorite", "library", "finished"];
      const b = await newBook(CHI);
      await putEntry(CHI, b, {
        status: "tsundoku",
        statusAt: "2026-09-01T00:00:00.000Z",
      });
      const before = await rowsOf(CHI, b);
      await withLibraryHeader(async () => {
        for (const kind of kinds) await mark(kind, b);
        for (const kind of kinds) await unmark(kind, b);
      });
      assert.deepEqual(await rowsOf(CHI, b), before, "not even updated_at");
      const none = await newBook(CHI);
      await withLibraryHeader(async () => {
        for (const kind of kinds) await mark(kind, none);
      });
      assert.deepEqual(await rowsOf(CHI, none), []);
      // Any other value is an app that does not know the library.
      const other = await newBook(CHI);
      await withLibraryHeader(
        () => mark("wish", other, "2026-09-03T00:00:00.000Z"),
        "0",
      );
      assert.equal(
        entryFrom((await rowsOf(CHI, other))[0]).wantedAt,
        "2026-09-03T00:00:00.000Z",
      );
      // Marks are upserted ignoring duplicates: one already there inserts
      // nothing, so the trigger does not run and the row stays as it is.
      await as(
        CHI,
        "update library_entries set wanted_at = null where user_id = $1 and book_id = $2",
        [CHI, other],
      );
      const unwanted = await rowsOf(CHI, other);
      await as(
        CHI,
        `insert into book_marks (user_id, book_id, kind) values ($1, $2, 'wish')
         on conflict (user_id, book_id, kind) do nothing`,
        [CHI, other],
      );
      assert.deepEqual(await rowsOf(CHI, other), unwanted);
    },
  );

  await check(
    "a book in a library or met in an encounter is not deleted from under it",
    async () => {
      const kept = await newBook(CHI);
      await putEntry(CHI, kept);
      const met = await newBook(CHI);
      await meet(encounterRow({ book_id: met }));
      await assert.rejects(
        operator(`delete from books where id = '${kept}'`),
        /library_entries_book_id_fkey/,
      );
      await assert.rejects(
        operator(`delete from books where id = '${met}'`),
        /book_encounters_book_id_fkey/,
      );
    },
  );

  await check(
    "a device clock running ahead dates nothing in the future",
    async () => {
      const ahead = "2099-01-01T00:00:00.000Z";
      const b = await newBook(CHI);
      await putEntry(CHI, b, {
        status: "reading",
        statusAt: ahead,
        wantedAt: ahead,
        likedAt: ahead,
        addedAt: ahead,
      });
      const past = async (sql: string, params: unknown[]) =>
        (await as<{ ok: boolean }>(CHI, sql, params))[0].ok;
      const entryInPast = () =>
        past(
          `select added_at <= now() and status_at <= now() and wanted_at <= now()
             and liked_at <= now() as ok
           from library_entries where user_id = $1 and book_id = $2`,
          [CHI, b],
        );
      assert.equal(await entryInPast(), true);
      await as(
        CHI,
        `update library_entries set status_at = $3, wanted_at = $3, liked_at = $3
         where user_id = $1 and book_id = $2`,
        [CHI, b, ahead],
      );
      assert.equal(await entryInPast(), true);
      await as(
        CHI,
        "update library_entries set wanted_at = null where user_id = $1 and book_id = $2",
        [CHI, b],
      );
      assert.equal(entryFrom((await rowsOf(CHI, b))[0]).wantedAt, null);
      const met = encounterRow({
        book_id: b,
        memo: "未来から",
        memo_at: ahead,
        created_at: ahead,
      });
      await meet(met);
      const encounterInPast = () =>
        past(
          "select created_at <= now() and memo_at <= now() as ok from book_encounters where id = $1",
          [met.id],
        );
      assert.equal(await encounterInPast(), true);
      await as(CHI, "update book_encounters set memo_at = $2 where id = $1", [
        met.id,
        ahead,
      ]);
      assert.equal(await encounterInPast(), true);
    },
  );

  await check(
    "an old app's settings leave the library's alone, and hidden shelves keep to their form",
    async () => {
      const LIBRARY =
        "library_hidden, likes_in_library, wanted_clears_on_status, memo_hint";
      // The statements the API builds for the old app's upsert and the new one's.
      const oldUpsert = (visitor: string, value: string) =>
        as(
          visitor,
          `insert into reader_settings (user_id, spoiler_display) values ($1, $2)
           on conflict (user_id) do update
             set user_id = excluded.user_id, spoiler_display = excluded.spoiler_display`,
          [visitor, value],
        );
      const newUpsert = (visitor: string, hidden: string) =>
        as(
          visitor,
          `insert into reader_settings (user_id, spoiler_display, ${LIBRARY})
           values ($1, 'leave_out', $2::text[], false, true, false)
           on conflict (user_id) do update
             set user_id = excluded.user_id, spoiler_display = excluded.spoiler_display,
               library_hidden = excluded.library_hidden,
               likes_in_library = excluded.likes_in_library,
               wanted_clears_on_status = excluded.wanted_clears_on_status,
               memo_hint = excluded.memo_hint`,
          [visitor, hidden],
        );
      const settingsOf = async (visitor: string) =>
        (
          await as(
            visitor,
            `select ${LIBRARY} from reader_settings where user_id = $1`,
            [visitor],
          )
        )[0];
      // Ben has no settings yet: the old app's upsert gives him the defaults.
      await oldUpsert(BEN, "leave_out");
      assert.deepEqual(await settingsOf(BEN), {
        library_hidden: [],
        likes_in_library: true,
        wanted_clears_on_status: false,
        memo_hint: true,
      });
      await newUpsert(BEN, "{finished,a_shelf_not_known_yet}");
      const chosen = {
        library_hidden: ["finished", "a_shelf_not_known_yet"],
        likes_in_library: false,
        wanted_clears_on_status: true,
        memo_hint: false,
      };
      assert.deepEqual(await settingsOf(BEN), chosen);
      await oldUpsert(BEN, "show_all");
      assert.deepEqual(await settingsOf(BEN), chosen);
      // Keys of the form, unknown ones too, up to twenty; nothing else.
      const twenty = Array.from(
        { length: 20 },
        (_, n) => "shelf_" + String.fromCharCode(97 + n),
      );
      for (const taken of [
        "{}",
        `{${twenty.join(",")}}`,
        `{${"a".repeat(32)}}`,
        "{_}",
      ])
        await newUpsert(BEN, taken);
      for (const value of [
        `{${[...twenty, "shelf_z"].join(",")}}`,
        `{${"a".repeat(33)}}`,
        "{Read}",
        '{""}',
        '{"a,b"}',
        '{"a b"}',
        "{NULL}",
        "{read,NULL}",
        "{{read},{wish}}",
        "{読了}",
      ])
        await refused(
          BEN,
          "update reader_settings set library_hidden = $2::text[] where user_id = $1",
          [BEN, value],
          /check constraint/,
        );
      assert.deepEqual((await settingsOf(BEN)).library_hidden, ["_"]);
    },
  );

  await check(
    "a typed-in book is read by whoever keeps it in their library or met it, and only while they do",
    async () => {
      const AKI_ALONE = [false, true, false, false];
      const AKI_AND_CHI = [false, true, false, true];
      const shelved = await newBook(AKI, "まだ誰にも見せない本");
      assert.deepEqual(await readersOf(shelved), AKI_ALONE);
      await putEntry(CHI, shelved);
      assert.deepEqual(await readersOf(shelved), AKI_AND_CHI, "in Chi's");
      const takeOut = (at: string | null) =>
        as(
          CHI,
          "update library_entries set removed_at = $3 where user_id = $1 and book_id = $2",
          [CHI, shelved, at],
        );
      await takeOut("2026-09-05T00:00:00.000Z");
      assert.deepEqual(await readersOf(shelved), AKI_ALONE, "taken out");
      await takeOut(null);
      assert.deepEqual(await readersOf(shelved), AKI_AND_CHI, "back in");
      const met = await newBook(AKI, "まだ誰にも見せない本");
      assert.deepEqual(await readersOf(met), AKI_ALONE);
      const want = encounterRow({
        book_id: met,
        memo: "表紙が気になった",
        memo_at: "2026-09-02T00:00:00.000Z",
      });
      await meet(want);
      assert.deepEqual(await readersOf(met), AKI_AND_CHI, "met");
      await as(
        CHI,
        "update book_encounters set undone_at = now() where id = $1",
        [want.id],
      );
      assert.deepEqual(await readersOf(met), AKI_AND_CHI, "kept for its memo");
    },
  );

  // Chi's own shop, which she meets no book in.
  const [chiShop] = await as<{ id: string }>(
    CHI,
    "insert into shops (owner_id, name, is_open) values ($1, '昼の本屋', true) returning id",
    [CHI],
  );
  for (const c of LIBRARY_CASES.encounter)
    await check(`book_encounters: ${c.name}`, async () => {
      const owner = c.owner === "me" ? CHI : AKI;
      const b = await newBook(owner);
      const row = encounterRow({
        book_id: b,
        kind: c.kind,
        via: c.via,
        other_reader_id: owner,
      });
      if (c.via === "post") {
        if (c.sample) row.post_id = deviceId();
        else if (c.reply) {
          const theirs = await newBook(owner);
          const parent = await postAbout(owner, theirs);
          row.post_id = await postAbout(owner, b, { parent });
          // A reply is met by its own book, never its parent's.
          await assert.rejects(
            meet({ ...row, id: deviceId(), book_id: theirs }),
            /the post's own book/,
          );
        } else row.post_id = await postAbout(owner, c.noBook ? null : b);
      } else if (c.via === "pop") {
        row.shop_id = c.sample
          ? deviceId()
          : owner === CHI
            ? chiShop.id
            : akiShop.id;
        const length = c.placementKeyLength ?? 12;
        row.placement_key = length === 0 ? null : "あ".repeat(length);
      }
      let error: Error | null = await meet(row).then(
        () => null,
        (caught: Error) => caught,
      );
      if (!error && c.memoLength !== undefined)
        error = await as(
          CHI,
          "update book_encounters set memo = $2, memo_at = $3 where id = $1",
          [row.id, "𠮷".repeat(c.memoLength), "2026-09-02T00:00:00.000Z"],
        ).then(
          () => null,
          (caught: Error) => caught,
        );
      if (error)
        assert.match(error.message, /encounter|met is not found/, c.name);
      assert.equal(error === null, c.accept, c.name);
      if (error === null)
        assert.deepEqual(
          await as(
            CHI,
            "select other_reader_id from book_encounters where id = $1",
            [row.id],
          ),
          [{ other_reader_id: c.via === "book" ? null : AKI }],
        );
    });

  await check(
    "a post or a shop the reader cannot see is refused as one that does not exist",
    async () => {
      const b = await newBook(AKI);
      const onPost = (post: string) =>
        refusal(() =>
          meet(
            encounterRow({
              book_id: b,
              kind: "like",
              via: "post",
              post_id: post,
            }),
          ),
        );
      const onPop = (shop: string) =>
        refusal(() =>
          meet(
            encounterRow({
              book_id: b,
              kind: "love",
              via: "pop",
              shop_id: shop,
              placement_key: "s1:i1",
            }),
          ),
        );
      const noPost = await onPost(deviceId());
      assert.deepEqual(noPost, {
        message: "the post met is not found",
        code: "23503",
      });
      const noShop = await onPop(deviceId());
      assert.deepEqual(noShop, {
        message: "the shop met is not found",
        code: "23503",
      });
      // Aki's private note, a post the operator hid, and Ben's closed shop.
      assert.deepEqual(
        await onPost(await postAbout(AKI, b, { mode: "solo" })),
        noPost,
      );
      const hidden = await postAbout(AKI, b);
      await hide("post", hidden);
      assert.deepEqual(await onPost(hidden), noPost);
      await operator(
        `delete from moderation_hides where target_id = '${hidden}'`,
      );
      assert.deepEqual(await onPop(benShop.id), noShop);
      // Aki's post and shop, while Chi has blocked her.
      const shown = await postAbout(AKI, b);
      await as(
        CHI,
        "insert into blocks (blocker_id, blocked_id) values ($1, $2)",
        [CHI, AKI],
      );
      try {
        assert.deepEqual(await onPost(shown), noPost);
        assert.deepEqual(await onPop(akiShop.id), noShop);
      } finally {
        await as(
          CHI,
          "delete from blocks where blocker_id = $1 and blocked_id = $2",
          [CHI, AKI],
        );
      }
      // Seen again, they are met.
      for (const row of [
        encounterRow({ book_id: b, kind: "like", via: "post", post_id: shown }),
        encounterRow({
          book_id: b,
          kind: "love",
          via: "pop",
          shop_id: akiShop.id,
          placement_key: "s1:i1",
        }),
      ])
        assert.equal(await meet(row), 1);
    },
  );

  await check(
    "whose post or shop it was is copied by the database, never taken from the device",
    async () => {
      const b = await newBook(AKI);
      const post = await postAbout(AKI, b);
      const rows = [
        encounterRow({
          book_id: b,
          kind: "want",
          via: "post",
          post_id: post,
          other_reader_id: BEN,
        }),
        encounterRow({
          book_id: b,
          kind: "want",
          via: "pop",
          shop_id: akiShop.id,
          placement_key: "s1:i9",
          other_reader_id: CHI,
        }),
        encounterRow({ book_id: b, other_reader_id: AKI }),
      ];
      for (const row of rows) await meet(row);
      assert.deepEqual(
        await as(
          CHI,
          "select other_reader_id from book_encounters where id = any ($1::uuid[]) order by id",
          [`{${rows.map((row) => row.id).join(",")}}`],
        ),
        [
          { other_reader_id: AKI },
          { other_reader_id: AKI },
          { other_reader_id: null },
        ],
      );
    },
  );

  await check(
    "an encounter is its reader's: not the post's writer's nor the shop's owner's, and only its memo and its taking back change",
    async () => {
      const b = await newBook(AKI);
      const post = await postAbout(AKI, b);
      const liked = encounterRow({
        book_id: b,
        kind: "like",
        via: "post",
        post_id: post,
        memo: "最後の一行",
        memo_at: "2026-09-02T00:00:00.000Z",
      });
      const loved = encounterRow({
        book_id: b,
        kind: "love",
        via: "pop",
        shop_id: akiShop.id,
        placement_key: "s1:i1",
      });
      await meet(liked);
      await meet(loved);
      for (const visitor of [AKI, BEN]) {
        assert.deepEqual(
          await as(
            visitor,
            "select id from book_encounters where user_id = $1 or other_reader_id = $2 or post_id = $3 or shop_id = $4",
            [CHI, AKI, post, akiShop.id],
          ),
          [],
          visitor,
        );
        for (const sql of [
          "update book_encounters set memo = '横取り' where id = $1",
          "update book_encounters set undone_at = now() where id = $1",
          "delete from book_encounters where id = $1",
        ])
          assert.equal(await affects(visitor, sql, [liked.id]), 0, sql);
      }
      assert.equal(
        await affects(
          CHI,
          "update book_encounters set memo = $2, memo_at = now() where id = $1",
          [liked.id, "最後の二行"],
        ),
        1,
      );
      assert.equal(
        await affects(
          CHI,
          "update book_encounters set undone_at = now() where id = $1",
          [liked.id],
        ),
        1,
      );
      for (const [column, value] of [
        ["id", deviceId()],
        ["user_id", CHI],
        ["book_id", b],
        ["kind", "want"],
        ["via", "book"],
        ["post_id", null],
        ["shop_id", null],
        ["placement_key", "s1:i2"],
        ["other_reader_id", null],
        ["created_at", "2026-09-01T00:00:00.000Z"],
      ] as [string, string | null][])
        assert.deepEqual(
          await refusal(() =>
            as(CHI, `update book_encounters set ${column} = $2 where id = $1`, [
              loved.id,
              value,
            ]),
          ),
          {
            message: "permission denied for table book_encounters",
            code: "42501",
          },
          column,
        );
    },
  );

  await check(
    "one encounter of each press, and pressing again brings the same one back",
    async () => {
      const b = await newBook(AKI);
      const post = await postAbout(AKI, b);
      const like = encounterRow({
        book_id: b,
        kind: "like",
        via: "post",
        post_id: post,
        memo: "残しておきたい",
        memo_at: "2026-09-02T00:00:00.000Z",
      });
      const love = encounterRow({
        book_id: b,
        kind: "love",
        via: "pop",
        shop_id: akiShop.id,
        placement_key: "s1:i1",
      });
      const want = encounterRow({ book_id: b });
      for (const row of [like, love, want]) {
        assert.equal(await meet(row), 1);
        // Sent again by the same device: nothing new, nothing refused.
        assert.equal(await meet(row), 0);
      }
      // The same press from another device, or the same POP named the way
      // the walk names it, is a second of the same.
      for (const [row, index] of [
        [{ ...like, id: deviceId() }, "book_encounters_post"],
        [
          { ...love, id: deviceId(), placement_key: "walk:3:2" },
          "book_encounters_pop",
        ],
        [{ ...want, id: deviceId() }, "book_encounters_book"],
      ] as const)
        await assert.rejects(meet(row), new RegExp(index));
      // Another kind of press on the same post is its own.
      assert.equal(await meet({ ...like, id: deviceId(), kind: "want" }), 1);
      // Taken back with a memo, it is kept; pressed again, it comes back.
      const count = async () =>
        (
          await as<{ n: number }>(
            CHI,
            "select count(*)::int as n from book_encounters where post_id = $1 and kind = 'like'",
            [post],
          )
        )[0].n;
      for (const undone of ["2026-09-03T00:00:00.000Z", null])
        assert.equal(
          await affects(
            CHI,
            "update book_encounters set undone_at = $2 where id = $1",
            [like.id, undone],
          ),
          1,
        );
      assert.equal(await count(), 1);
      // Taken back without a memo, it is deleted.
      assert.equal(
        await affects(CHI, "delete from book_encounters where id = $1", [
          love.id,
        ]),
        1,
      );
    },
  );

  await check(
    "a post or a shop gone leaves its encounters and their memos, and whose they were until that account goes too",
    async () => {
      const GONE = lib(90001);
      await db.exec(`insert into auth.users (id) values ('${GONE}')`);
      await as(
        GONE,
        "insert into profiles (id, handle, name) values ($1, 'gone_reader', 'GONE')",
        [GONE],
      );
      const [goneShop] = await as<{ id: string }>(
        GONE,
        "insert into shops (owner_id, name, is_open) values ($1, '閉じる本屋', true) returning id",
        [GONE],
      );
      // Chi's own book, so that no book is left without its maker.
      const b = await newBook(CHI);
      const post = await postAbout(GONE, b);
      const onPost = encounterRow({
        book_id: b,
        kind: "like",
        via: "post",
        post_id: post,
        memo: "言葉が好き",
        memo_at: "2026-09-02T00:00:00.000Z",
      });
      const onPop = encounterRow({
        book_id: b,
        kind: "love",
        via: "pop",
        shop_id: goneShop.id,
        placement_key: "s1:i1",
        memo: "POPが好き",
        memo_at: "2026-09-02T00:00:00.000Z",
      });
      await meet(onPost);
      await meet(onPop);
      const left = () =>
        as(
          CHI,
          `select id, post_id, shop_id, other_reader_id, memo from book_encounters
           where id = any ($1::uuid[]) order by id`,
          [`{${onPost.id},${onPop.id}}`],
        );
      await as(GONE, "delete from posts where id = $1", [post]);
      assert.deepEqual(await left(), [
        {
          id: onPost.id,
          post_id: null,
          shop_id: null,
          other_reader_id: GONE,
          memo: "言葉が好き",
        },
        {
          id: onPop.id,
          post_id: null,
          shop_id: goneShop.id,
          other_reader_id: GONE,
          memo: "POPが好き",
        },
      ]);
      await operator(`delete from auth.users where id = '${GONE}'`);
      assert.deepEqual(await left(), [
        {
          id: onPost.id,
          post_id: null,
          shop_id: null,
          other_reader_id: null,
          memo: "言葉が好き",
        },
        {
          id: onPop.id,
          post_id: null,
          shop_id: null,
          other_reader_id: null,
          memo: "POPが好き",
        },
      ]);
    },
  );

  await check("deleting an account removes everything it owned", async () => {
    // Ben keeps a library too: a mark copied to its row, the row on a shelf,
    // his settings, a record, his nine and encounters.
    const bens = await newBook(AKI, "ベンの棚の本");
    await mark("wish", bens, null, BEN);
    await shelve(await putShelf({ user_id: BEN }), bens, BEN);
    await as(
      BEN,
      `insert into reader_settings (user_id, spoiler_display) values ($1, 'show_all')
       on conflict (user_id) do nothing`,
      [BEN],
    );
    await as(
      BEN,
      "insert into reading_entries (user_id, book_id) values ($1, $2)",
      [BEN, bens],
    );
    await operator(
      `insert into profile_nine (profile_id, position, book_id)
       values ('${BEN}', 9, '${bens}') on conflict do nothing`,
    );
    await meet(encounterRow({ user_id: BEN, book_id: bens }), BEN);
    await meet(
      encounterRow({
        user_id: BEN,
        book_id: bens,
        kind: "like",
        via: "pop",
        shop_id: akiShop.id,
        placement_key: "s1:i1",
        memo: "ベンのメモ",
        memo_at: "2026-09-02T00:00:00.000Z",
      }),
      BEN,
    );
    const kept: [string, string][] = [
      ["library_entries", "user_id"],
      ["library_shelves", "user_id"],
      ["library_shelf_books", "user_id"],
      ["book_encounters", "user_id"],
      ["book_marks", "user_id"],
      ["reader_settings", "user_id"],
      ["reading_entries", "user_id"],
      ["profile_nine", "profile_id"],
    ];
    const owned: [string, string][] = [
      ["profiles", "id"],
      ["shops", "owner_id"],
      ["posts", "author_id"],
      ["posters", "author_id"],
      ["post_reactions", "user_id"],
      ["shop_follows", "follower_id"],
      ["saved_shops", "user_id"],
      ["shop_visits", "user_id"],
      ...kept,
    ];
    const left = async (table: string, column: string) =>
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from ${table} where ${column} = $1`,
          [BEN],
        )
      ).rows[0].n;
    for (const [table, column] of kept)
      assert.ok((await left(table, column)) > 0, "before: " + table);
    // Supabase deletes an account as supabase_auth_admin, who owns auth.users
    // and has no rights in public. The cascades run as each table's owner;
    // the after triggers they fire run at the end of the statement, as
    // supabase_auth_admin.
    await db.exec(`
      create role supabase_auth_admin nologin;
      alter schema auth owner to supabase_auth_admin;
      alter table auth.users owner to supabase_auth_admin;
      set role supabase_auth_admin;
    `);
    try {
      await db.exec(`delete from auth.users where id = '${BEN}'`);
    } finally {
      await db.exec("reset role");
    }
    for (const [table, column] of owned)
      assert.equal(await left(table, column), 0, table);
    // The books Ben typed in stay in the catalog without an owner. The one
    // he only scanned is used nowhere, so nobody reads it any more.
    const orphan = await db.query<{ n: number }>(
      "select count(*)::int as n from books where created_by is null",
    );
    assert.equal(orphan.rows[0].n, 2);
    assert.deepEqual(await readersOf(scanned), [false, false, false, false]);
  });

  await check(
    "shops saved before the public copy existed get one when it arrives",
    async () => {
      const earlier = new PGlite();
      await earlier.exec(supabase);
      const copy = files.indexOf("20261013000000_shop_public_copy.sql");
      for (const file of files.slice(0, copy))
        await earlier.exec(migrate(file));
      await earlier.exec(`
        insert into auth.users (id) values ('${AKI}');
        insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'AKI');
        insert into shops (id, owner_id, name)
          values ('00000000-0000-4000-8000-0000000000f1', '${AKI}', '夜の本屋');
        insert into shop_private (shop_id, shelves)
          values ('00000000-0000-4000-8000-0000000000f1',
            '[{"id":"s1","isPublic":true},{"id":"s2","isPublic":false}]');
      `);
      for (const file of files.slice(copy)) await earlier.exec(migrate(file));
      const shop = await earlier.query<{ public_shelves: { id: string }[] }>(
        "select public_shelves from shops",
      );
      assert.deepEqual(
        shop.rows[0].public_shelves.map((shelf) => shelf.id),
        ["s1"],
      );
      await earlier.close();
    },
  );

  await check(
    "what three reports hid before today is folded, not hidden",
    async () => {
      const earlier = new PGlite();
      await earlier.exec(supabase);
      const today = files.indexOf("20261022000000_safety_defaults.sql");
      for (const file of files.slice(0, today))
        await earlier.exec(migrate(file));
      const post = "00000000-0000-4000-8000-0000000000f2";
      await earlier.exec(`
        insert into auth.users (id, created_at) values
          ('${AKI}', now() - interval '400 days'),
          ('${BEN}', now() - interval '30 days'),
          ('${CHI}', now() - interval '60 days'),
          ('${OLD1}', now() - interval '90 days');
        insert into profiles (id, handle, name, created_at)
          select id, 'p' || substr(id::text, 35), 'P', created_at from auth.users;
        insert into posts (id, author_id, body) values ('${post}', '${AKI}', '昔の投稿');
        insert into reports (reporter_id, target_kind, target_id, reason)
          select id, 'post', '${post}', 'spam' from auth.users where id <> '${AKI}';
      `);
      const anon = async (sql: string) => {
        await earlier.exec(
          "set role anon; select set_config('request.jwt.claim.sub', '', false);",
        );
        try {
          return (await earlier.query(sql)).rows;
        } finally {
          await earlier.exec("reset role");
        }
      };
      assert.equal((await anon("select id from posts")).length, 0);
      for (const file of files.slice(today)) await earlier.exec(migrate(file));
      assert.equal((await anon("select id from posts")).length, 1);
      assert.deepEqual(
        await anon("select target_id, state from moderation_folds"),
        [{ target_id: post, state: "folded" }],
      );
      await earlier.close();
    },
  );

  await check(
    "the first account becomes staff when site notes arrive",
    async () => {
      const earlier = new PGlite();
      await earlier.exec(supabase);
      // Found by its name's end: the date in front may change before it merges.
      const notes = files.findIndex((file) => file.endsWith("_site_notes.sql"));
      assert.ok(notes > 0, "the site notes migration");
      for (const file of files.slice(0, notes))
        await earlier.exec(migrate(file));
      // The oldest account, not the first id: Ben's sorts after Aki's.
      await earlier.exec(`
        insert into auth.users (id, created_at) values
          ('${AKI}', now() - interval '3 days'),
          ('${BEN}', now() - interval '30 days');
      `);
      for (const file of files.slice(notes)) await earlier.exec(migrate(file));
      assert.deepEqual(
        (await earlier.query("select user_id from private.staff")).rows,
        [{ user_id: BEN }],
      );
      await earlier.close();
    },
  );

  await check(
    "a database from before typed-in books were hidden keeps every shop, nine and shown book",
    async () => {
      const earlier = new PGlite();
      await earlier.exec(supabase);
      // Found by its name's end: the date in front may change before it merges.
      const hiding = files.findIndex((file) =>
        file.endsWith("_hide_registered_titles.sql"),
      );
      assert.ok(hiding > 0, "the migration that hides typed-in books");
      for (const file of files.slice(0, hiding))
        await earlier.exec(migrate(file));
      const id = (n: number) =>
        "00000000-0000-4000-8000-0000000003" + String(n).padStart(2, "0");
      const [akiShop, benShop] = [id(1), id(2)];
      // Each of Aki's books is shown one way; the catalog's to everyone.
      const shown = {
        shelf: id(11),
        scene: id(12),
        nine: id(13),
        post: id(14),
        record: id(15),
        poster: id(16),
        reading: id(17),
        catalog: id(18),
      };
      // Aki's, kept to herself: on a private shelf, in a private note and on
      // a draft poster. Ben's: only scanned, and on his closed shop's shelf.
      const [privateShelf, note, draft] = [id(21), id(22), id(23)];
      const [scannedOnly, closedShelf] = [id(24), id(25)];
      const akis = [privateShelf, note, draft];
      const bens = [scannedOnly, closedShelf];
      const owner = (book: string) =>
        book === shown.catalog ? null : bens.includes(book) ? BEN : AKI;
      const books = [...Object.values(shown), ...akis, ...bens]
        .map((book) => {
          const by = owner(book);
          return by
            ? `('${book}', 'title', 'manual', '${by}')`
            : `('${book}', 'title', 'ndl', null)`;
        })
        .join(", ");
      await earlier.exec(`
        insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
        insert into profiles (id, handle, name)
          values ('${AKI}', 'aki', 'AKI'), ('${BEN}', 'ben', 'BEN'), ('${CHI}', 'chi', 'CHI');
        insert into books (id, title, source, created_by) values ${books};
        insert into shops (id, owner_id, name, is_open)
          values ('${akiShop}', '${AKI}', '夜の本屋', true), ('${benShop}', '${BEN}', '準備中', false);
        insert into shop_private (shop_id, shelves, scene) values
          ('${akiShop}', '${JSON.stringify([
            ...JSON.parse(shelvesWith(shown.shelf, true)),
            ...JSON.parse(shelvesWith(privateShelf, false)),
          ])}', '${sceneWith(shown.scene, true)}'),
          ('${benShop}', '${shelvesWith(closedShelf, true)}', null);
        insert into profile_nine (profile_id, position, book_id)
          values ('${AKI}', 1, '${shown.nine}');
        insert into posts (author_id, body, book_id, reading_mode) values
          ('${AKI}', '感想', '${shown.post}', null), ('${AKI}', 'メモ', '${note}', 'solo');
        insert into reading_entries (user_id, book_id, is_public)
          values ('${AKI}', '${shown.record}', true);
        insert into posters (author_id, template, pages, status) values
          ('${AKI}', 'one_book', '${pages(shown.poster)}', 'published'),
          ('${AKI}', 'one_book', '${pages(draft)}', 'draft');
        insert into reading_sessions (user_id, book_id, mode)
          values ('${AKI}', '${shown.reading}', 'together');
      `);
      const read = async (visitor: Visitor, sql: string) => {
        await earlier.exec(
          visitor
            ? `set role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', false);`
            : "set role anon; select set_config('request.jwt.claim.sub', '', false);",
        );
        try {
          return (await earlier.query<{ id: string }>(sql)).rows.map(
            (row) => row.id,
          );
        } finally {
          await earlier.exec("reset role");
        }
      };
      const readable = (visitor: Visitor) =>
        read(visitor, "select id from books order by id");
      const counts = async () => [
        (await read(null, "select id from shops")).length,
        (await read(null, "select profile_id as id from profile_nine")).length,
      ];
      const catalog = () =>
        earlier.query("select * from books order by id").then((r) => r.rows);
      const before = {
        counts: await counts(),
        rows: await catalog(),
        anon: await readable(null),
      };
      assert.equal(before.anon.length, 13, "every book, before");

      for (const file of files.slice(hiding)) await earlier.exec(migrate(file));
      assert.deepEqual(await counts(), before.counts);
      assert.deepEqual(await catalog(), before.rows, "no row was rewritten");
      const everyone = Object.values(shown).sort();
      assert.deepEqual(await readable(null), everyone);
      assert.deepEqual(await readable(CHI), everyone);
      assert.deepEqual(await readable(AKI), [...everyone, ...akis].sort());
      assert.deepEqual(await readable(BEN), [...everyone, ...bens].sort());
      await earlier.close();
    },
  );

  await check(
    "a database from before the library gives each reader theirs from what they did, and leaves shops, likes and books as they were",
    async () => {
      const earlier = new PGlite();
      await earlier.exec(supabase);
      // Found by its name's end: the date in front may change before it merges.
      const library = files.findIndex((file) => file.endsWith("_library.sql"));
      assert.ok(library > 0, "the library migration");
      for (const file of files.slice(0, library))
        await earlier.exec(migrate(file));
      const id = (n: number) =>
        "00000000-0000-4000-8000-0000005" + String(n).padStart(5, "0");
      const at = (time: string | null | undefined) =>
        time ? `'${time}'` : "null";
      // Each case of the shared ones is one reader and one book. Posts,
      // posters and records are dated by the database when written, so
      // their dates are set afterwards.
      const sql: string[] = [];
      const readers = LIBRARY_CASES.backfill.map((c, i) => {
        const reader = id(100 + i);
        const bookId = id(200 + i);
        const nine = c.uses?.find((use) => use.kind === "nine");
        sql.push(
          `insert into auth.users (id) values ('${reader}');`,
          `insert into profiles (id, handle, name, created_at)
             values ('${reader}', 'library_${i}', 'L', ${nine ? at(nine.at) : "now()"});`,
          `insert into books (id, title, source) values ('${bookId}', '本', 'ndl');`,
        );
        for (const mark of c.marks)
          sql.push(
            `insert into book_marks (user_id, book_id, kind, created_at)
               values ('${reader}', '${bookId}', '${mark.kind}', ${at(mark.at)});`,
          );
        for (const [n, time] of c.records.entries()) {
          const record = id(1000 + i * 10 + n);
          sql.push(
            `insert into reading_entries (id, user_id, book_id)
               values ('${record}', '${reader}', '${bookId}');`,
            `update reading_entries set created_at = ${at(time)} where id = '${record}';`,
          );
        }
        for (const session of c.sessions)
          sql.push(
            `insert into reading_sessions (user_id, book_id, mode, started_at, ended_at)
               values ('${reader}', '${bookId}', 'solo', ${at(session.startedAt)}, ${at(session.endedAt)});`,
          );
        // A reading without a book makes nothing.
        sql.push(
          `insert into reading_sessions (user_id, mode, started_at, ended_at)
             values ('${reader}', 'solo', '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z');`,
        );
        for (const [n, use] of (c.uses ?? []).entries()) {
          const used = id(2000 + i * 10 + n);
          if (use.kind === "post")
            sql.push(
              `insert into posts (id, author_id, body, book_id)
                 values ('${used}', '${reader}', '感想', '${bookId}');`,
              `update posts set created_at = ${at(use.at)} where id = '${used}';`,
            );
          else if (use.kind === "poster")
            sql.push(
              `insert into posters (id, author_id, template, pages, status)
                 values ('${used}', '${reader}', 'one_book', '${pages(bookId)}',
                   '${use.draft ? "draft" : "published"}');`,
              `update posters set created_at = ${at(use.at)} where id = '${used}';`,
            );
          else if (use.kind === "nine")
            sql.push(
              `insert into profile_nine (profile_id, position, book_id)
                 values ('${reader}', 1, '${bookId}');`,
            );
          else
            sql.push(
              `insert into shops (id, owner_id, name, created_at)
                 values ('${used}', '${reader}', '本屋', ${at(use.at)});`,
              use.kind === "shelf"
                ? `insert into shop_private (shop_id, shelves)
                     values ('${used}', '${shelvesWith(bookId, !use.private)}');`
                : `insert into shop_private (shop_id, scene)
                     values ('${used}', '${sceneWith(bookId, true)}');`,
            );
        }
        return { name: c.name, reader, bookId, expect: c.expect };
      });
      // A writer whose post and shop another reader likes: likes are not
      // copied. Her shop also names ids that are no book here: a 見本's,
      // and one that is no book at all.
      const [writer, liker] = [id(1), id(2)];
      const [posted, shelved, noBook] = [id(301), id(302), id(399)];
      const [writersPost, writersShop] = [id(311), id(312)];
      sql.push(
        `insert into auth.users (id) values ('${writer}'), ('${liker}');`,
        `insert into profiles (id, handle, name)
           values ('${writer}', 'library_writer', 'W'), ('${liker}', 'library_liker', 'L');`,
        `insert into books (id, title, source)
           values ('${posted}', '本', 'ndl'), ('${shelved}', '本', 'ndl');`,
        `insert into posts (id, author_id, body, book_id)
           values ('${writersPost}', '${writer}', '感想', '${posted}');`,
        `insert into shops (id, owner_id, name, is_open)
           values ('${writersShop}', '${writer}', '本屋', true);`,
        `insert into shop_private (shop_id, shelves, scene) values ('${writersShop}', '${JSON.stringify(
          [
            {
              id: "s1",
              name: "新着",
              isPublic: true,
              items: [
                { id: "i1", bookId: shelved, display: "face" },
                { id: "i2", bookId: "sample-book-1", display: "face" },
                { id: "i3", bookId: noBook, display: "face" },
              ],
            },
            { id: "s2", name: "まだ空の棚", isPublic: false },
          ],
        )}', '${JSON.stringify({
          schemaVersion: 1,
          storeId: "mine",
          objects: [
            { id: "shelf", kind: "furniture", parentId: null },
            { id: "row", kind: "row", parentId: "shelf", isPublic: true },
            {
              id: "b1",
              kind: "book",
              bookId: "sample-book-2",
              parentId: "row",
            },
            { id: "b2", kind: "book", bookId: shelved, parentId: "row" },
          ],
        })}');`,
        `insert into post_reactions (user_id, post_id, kind)
           values ('${liker}', '${writersPost}', 'like'), ('${liker}', '${writersPost}', 'want');`,
        `insert into pop_reactions (user_id, shop_id, placement_key, reaction)
           values ('${liker}', '${writersShop}', 's1:i1', 'like'),
             ('${liker}', '${writersShop}', 's1:i1', 'love'),
             ('${liker}', '${writersShop}', 's1:i1', 'read');`,
      );
      await earlier.exec(sql.join("\n"));
      const snapshot = async () => {
        const out: Record<string, unknown[]> = {};
        for (const table of [
          "shops",
          "shop_private",
          "pop_reactions",
          "post_reactions",
          "books",
          "book_marks",
        ])
          out[table] = (
            await earlier.query(`select * from ${table} t order by t::text`)
          ).rows;
        return out;
      };
      const before = await snapshot();

      for (const file of files.slice(library))
        await earlier.exec(migrate(file));
      assert.deepEqual(await snapshot(), before, "nothing else was rewritten");
      const entries = async (reader: string) =>
        (
          await earlier.query<Record<string, unknown>>(
            "select * from library_entries where user_id = $1 order by book_id",
            [reader],
          )
        ).rows;
      for (const r of readers)
        assert.deepEqual(
          (await entries(r.reader)).map(entryFrom),
          r.expect === null ? [] : [entryOf(r.bookId, r.expect)],
          r.name,
        );
      assert.deepEqual(
        (await entries(writer)).map((row) => row.book_id),
        [posted, shelved],
      );
      assert.deepEqual(await entries(liker), []);
      assert.deepEqual(
        (await earlier.query("select * from book_encounters")).rows,
        [],
      );
      // Run again, it changes nothing, not even a row's updated_at.
      const all = async () =>
        (
          await earlier.query(
            "select * from library_entries order by user_id, book_id",
          )
        ).rows;
      const once = await all();
      await earlier.exec("select private.library_backfill()");
      assert.deepEqual(await all(), once);
      await earlier.close();
    },
  );

  console.log(passed + " database policy checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
