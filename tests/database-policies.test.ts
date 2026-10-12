import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

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
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
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
      assert.equal((await as(null, "select * from books")).length, 1);
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
      // Posts have no edit policy, so even the author's update changes nothing.
      assert.equal(
        await affects(AKI, "update posts set body = '書き換え' where id = $1", [
          akiReview.id,
        ]),
        0,
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
      assert.equal((await as(CHI, "select * from reports")).length, 1);
      assert.equal((await as(AKI, "select * from reports")).length, 0);
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
        /row-level security/,
      );
      assert.equal(
        await affects(
          CHI,
          "update reports set status = 'dismissed' where reporter_id = $1",
          [CHI],
        ),
        0,
      );
    },
  );

  await check(
    "three reports or the operator hide a post from all but its author",
    async () => {
      const DAN = "00000000-0000-4000-8000-00000000000d";
      await db.exec(`insert into auth.users (id) values ('${DAN}')`);
      await as(
        DAN,
        "insert into profiles (id, handle, name) values ($1, 'dan', 'DAN')",
        [DAN],
      );
      const seen = async (visitor: Visitor) =>
        (await as(visitor, "select * from posts where id = $1", [akiChat.id]))
          .length;
      const report = (visitor: string) =>
        as(
          visitor,
          "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'post', $2, 'spam')",
          [visitor, akiChat.id],
        );
      // Chi has reported it already; two reports are not enough.
      await report(BEN);
      assert.equal(await seen(null), 1);
      await report(DAN);
      assert.equal(await seen(null), 0);
      assert.equal(await seen(BEN), 0);
      assert.equal(await seen(AKI), 1);
      // The operator looks and dismisses one: the post comes back.
      await db.exec(
        `update reports set status = 'dismissed' where reporter_id = '${DAN}'`,
      );
      assert.equal(await seen(null), 1);

      await db.exec(
        `insert into moderation_hides (target_kind, target_id) values ('post', '${akiChat.id}')`,
      );
      assert.equal(await seen(null), 0);
      assert.equal(await seen(AKI), 1);
      await db.exec("delete from moderation_hides");
      assert.equal(await seen(CHI), 1);

      // Nobody but the operator reads or writes the hides.
      await refused(null, "select * from moderation_hides", [], /permission/);
      await refused(
        BEN,
        "insert into moderation_hides (target_kind, target_id) values ('post', $1)",
        [akiChat.id],
        /permission/,
      );
      // Nor can a report be filed about yourself.
      await refused(
        DAN,
        "insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'profile', $1, 'other')",
        [DAN],
        /row-level security/,
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

  await check("deleting an account removes everything it owned", async () => {
    await db.exec(`delete from auth.users where id = '${BEN}'`);
    for (const table of [
      "profiles",
      "shops",
      "posts",
      "post_reactions",
      "shop_follows",
      "saved_shops",
      "shop_visits",
    ]) {
      const left = await db.query<{ n: number }>(
        `select count(*)::int as n from ${table} where ${
          table === "profiles"
            ? "id"
            : table === "shops"
              ? "owner_id"
              : table === "posts"
                ? "author_id"
                : table === "shop_follows"
                  ? "follower_id"
                  : "user_id"
        } = '${BEN}'`,
      );
      assert.equal(left.rows[0].n, 0, table);
    }
    // The book Ben typed in stays in the catalog without an owner.
    const orphan = await db.query<{ n: number }>(
      "select count(*)::int as n from books where created_by is null",
    );
    assert.equal(orphan.rows[0].n, 1);
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

  console.log(passed + " database policy checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
