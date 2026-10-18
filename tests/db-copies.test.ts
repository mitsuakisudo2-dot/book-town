import assert from "node:assert/strict";
import { ACCOUNT_TABLES } from "./fixtures/account-tables";
import {
  deleteAccounts,
  migratedDatabase,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// The copies a migration takes before it moves existing data, the check that
// rolls the move back when it lost something, and putting a copy back (item
// 3 of the 2026-10-16 plan, supabase/migrations/20261026000000_moving_copies.sql).
// A migration file runs as one transaction, as `supabase db push` sends it.

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const B1 = "00000000-0000-4000-8000-0000000000b1";
const B2 = "00000000-0000-4000-8000-0000000000b2";
const B3 = "00000000-0000-4000-8000-0000000000b3";
const P1 = "00000000-0000-4000-8000-0000000000f1";
const P2 = "00000000-0000-4000-8000-0000000000f2";
const P3 = "00000000-0000-4000-8000-0000000000f3";
const P4 = "00000000-0000-4000-8000-0000000000f4";
const P5 = "00000000-0000-4000-8000-0000000000f5";
const SHOP = "00000000-0000-4000-8000-0000000000c1";
const BEN_SHOP = "00000000-0000-4000-8000-0000000000c2";

const TABLES = [
  "public.books",
  "public.posts",
  "public.post_reactions",
  "public.shops",
  "public.shop_private",
  "public.reports",
];
const COPIED = `array['${TABLES.join("', '")}']::regclass[]`;

/** Comments out, so a word in one never counts as SQL. */
function sqlWithoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Bodies of functions and do blocks ($$ … $$, $tag$ … $tag$) out too, so their
 * own begin and their semicolons never read as statements of the file.
 */
function sqlWithoutBodies(sql: string): string {
  return sql.replace(/\$([A-Za-z_][A-Za-z_0-9]*)?\$[\s\S]*?\$\1\$/g, " $$$$ ");
}

/**
 * A statement of any migration that `supabase db push` refuses: it sends a
 * file without BEGIN, and Postgres takes a bare LOCK only in a transaction
 * block. In a do block the lock holds to the end of the file.
 */
function pushProblems(name: string, text: string): string[] {
  return sqlWithoutBodies(sqlWithoutComments(text))
    .split(";")
    .map((statement) => statement.trim().toUpperCase())
    .filter((head) => /^LOCK\b/.test(head))
    .map(
      (head) =>
        `${name} runs "${head.split(/\s+/).slice(0, 3).join(" ")}" outside a block; put it in a do block`,
    );
}

/**
 * What is wrong with a migration that moves data: it keeps a copy but never
 * checks it, or holds a statement `supabase db push` runs outside the file's
 * transaction, so a failed check could not roll the whole move back.
 */
function movingProblems(name: string, text: string): string[] {
  const sql = sqlWithoutComments(text);
  const keeps = [...sql.matchAll(/(?<!function\s+)private\.keep_copy\s*\(/gi)];
  if (keeps.length === 0) return [];
  const problems: string[] = [];
  const lastKeep = keeps[keeps.length - 1].index ?? 0;
  const checks = [
    ...sql.matchAll(/(?<!function\s+)private\.check_copy\s*\(/gi),
  ];
  if (!checks.some((match) => (match.index ?? 0) > lastKeep))
    problems.push(`${name} keeps a copy but never checks it after the move`);
  for (const statement of sqlWithoutBodies(sql).split(";")) {
    const head = statement.trim().toUpperCase();
    if (
      /^(CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY|REINDEX\b[\s\S]*\bCONCURRENTLY|VACUUM\b|ALTER\s+SYSTEM\b|CLUSTER\b)/.test(
        head,
      )
    )
      problems.push(
        `${name} runs "${head.split(/\s+/).slice(0, 3).join(" ")}" outside its transaction; move it to a file of its own`,
      );
    if (/^(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/.test(head))
      problems.push(
        `${name} ends its own transaction with ${head.split(/\s+/)[0]}`,
      );
  }
  return problems;
}

async function main() {
  const db = await migratedDatabase();
  const rows = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ) => (await db.query<T>(sql, params)).rows;
  // The copies the migrations themselves took (of an empty database here)
  // go first, so these checks start from an empty keep. Those moves have
  // checks of their own (tests/db-works.test.ts). The ones checked in
  // production were dropped by a later migration already.
  const kept = await rows<{ label: string }>(
    "select distinct label from keep.copies order by label",
  );
  for (const gone of ["20261027000000_works", "20261029000000_visibility"])
    assert.ok(!kept.some(({ label }) => label === gone), gone);
  for (const { label } of kept)
    await db.query("select private.drop_copy($1)", [label]);

  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  async function refused(sql: string, reason: RegExp) {
    let error: unknown = null;
    try {
      await db.exec(sql);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, "expected a refusal: " + sql);
    assert.match(error.message, reason);
  }

  // Three readers: Aki with a shop, Ben who typed a book in and posted about
  // it, Chi who replied to him and reported his profile. The 見本's books,
  // which every database has (own_book_rows), are taken out first, so the
  // rows counted are these alone.
  await db.exec(`
    delete from books where private.is_sample_book(id);
    insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
    insert into books (id, isbn, title, source, created_by) values
      ('${B1}', '9784101010014', '坊っちゃん', 'ndl', null),
      ('${B2}', null, 'ベンの手書きの本', 'manual', '${BEN}'),
      ('${B3}', null, 'チーの手書きの本', 'manual', '${CHI}');
    insert into shops (id, owner_id, name, is_open, public_scene) values
      ('${SHOP}', '${AKI}', '軌道書房', true, '{"books": []}'),
      ('${BEN_SHOP}', '${BEN}', 'ベンの店', false, null);
    insert into shop_private (shop_id, shelves) values
      ('${BEN_SHOP}', '[{"name": "ベンだけの棚", "books": []}]');
    insert into posts (id, author_id, body, book_id) values
      ('${P1}', '${AKI}', '面白かった', '${B1}'),
      ('${P2}', '${BEN}', '自分で入れた本', '${B2}'),
      ('${P4}', '${CHI}', 'これも', '${B3}');
    insert into posts (id, author_id, body, parent_id) values
      ('${P3}', '${CHI}', 'いいですね', '${P2}');
    insert into post_reactions (user_id, post_id, kind) values
      ('${CHI}', '${P1}', 'like'), ('${BEN}', '${P1}', 'like'), ('${AKI}', '${P2}', 'like');
    insert into reports (reporter_id, target_kind, target_id, reason) values
      ('${CHI}', 'profile', '${BEN}', 'spam');
  `);

  /** Every row of the copied tables, in key order, to compare whole. */
  async function snapshot(): Promise<Record<string, unknown[]>> {
    const all: Record<string, unknown[]> = {};
    for (const table of TABLES)
      all[table] = await rows(
        `select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`,
      );
    return all;
  }
  const keepTables = async () =>
    (
      await rows<{ name: string }>(
        `select relname as name from pg_class
         where relnamespace = 'keep'::regnamespace and relkind = 'r' order by 1`,
      )
    ).map((row) => row.name);

  const before = await snapshot();
  const stamps = async () =>
    rows<{ id: string; updated_at: string }>(
      "select id, updated_at::text from books order by id",
    );
  const firstStamps = await stamps();

  await check(
    "a move that loses a row is rolled back, copy and all",
    async () => {
      await refused(
        `select private.keep_copy('20990101000000_loses_a_row', ${COPIED});
       delete from posts where id = '${P4}';
       select private.check_copy('20990101000000_loses_a_row');`,
        /the move lost what the copy kept: public\.posts: 1 rows and 0 links lost/,
      );
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await keepTables(), ["copies"]);
    },
  );

  await check("a move that loses a link is rolled back", async () => {
    await refused(
      `select private.keep_copy('20990101000000_loses_a_link', ${COPIED});
       update posts set book_id = null where id = '${P1}';
       select private.check_copy('20990101000000_loses_a_link');`,
      /public\.posts: 0 rows and 1 links lost/,
    );
    assert.deepEqual(await snapshot(), before);
  });

  await check("a move that drops a linked column loses its links", async () => {
    await refused(
      `select private.keep_copy('20990101000000_drops_a_column', ${COPIED});
       alter table posts drop column book_id cascade;
       select private.check_copy('20990101000000_drops_a_column');`,
      /public\.posts: 0 rows and 3 links lost/,
    );
    assert.deepEqual(await snapshot(), before);
  });

  await check(
    "a table named as changing is measured, not refused",
    async () => {
      await db.exec("begin");
      try {
        await db.exec(
          `select private.keep_copy('20990101000000_merges', ${COPIED});
         delete from posts where id = '${P4}';
         select private.check_copy('20990101000000_merges', '{}', array['public.posts']::regclass[]);`,
        );
        const [posts] = await rows<{ checked: Record<string, unknown> }>(
          "select checked from keep.copies where label = '20990101000000_merges' and source = 'public.posts'",
        );
        assert.equal(posts.checked.lost_rows, 1);
        assert.equal(posts.checked.rows_before, 4);
        assert.equal(posts.checked.rows_after, 3);
      } finally {
        await db.exec("rollback");
      }
      // Links allowed to go do not let rows go.
      await refused(
        `select private.keep_copy('20990101000000_relinks', ${COPIED});
         delete from posts where id = '${P4}';
         select private.check_copy('20990101000000_relinks', array['public.posts']::regclass[]);`,
        /public\.posts: 1 rows and 0 links lost/,
      );
      assert.deepEqual(await snapshot(), before);
    },
  );

  // A move that loses nothing goes through, and keeps its copy.
  const LABEL = "20990101000000_new_titles";
  await db.exec(
    `select private.keep_copy('${LABEL}', ${COPIED});
     update books set title = title || '（新版）';
     update shops set name = '軌道書房 本店';
     select private.check_copy('${LABEL}');`,
  );

  await check(
    "a move that loses nothing keeps its copy and what it found",
    async () => {
      const copies = await rows<{
        source: string;
        row_count: number;
        checked: Record<string, number>;
        forget_columns: string[];
      }>(
        "select source, row_count::int, checked, forget_columns from keep.copies where label = $1 order by source",
        [LABEL],
      );
      assert.deepEqual(
        copies.map((c) => [
          c.source,
          c.row_count,
          c.checked.lost_rows,
          c.checked.lost_links,
        ]),
        [
          ["public.books", 3, 0, 0],
          ["public.post_reactions", 3, 0, 0],
          ["public.posts", 4, 0, 0],
          ["public.reports", 1, 0, 0],
          ["public.shop_private", 1, 0, 0],
          ["public.shops", 2, 0, 0],
        ],
      );
      assert.deepEqual(
        copies.find((c) => c.source === "public.books")?.forget_columns,
        ["created_by"],
      );
      assert.equal((await keepTables()).length, 7);
      assert.equal(
        (
          await rows<{ title: string }>(
            "select title from books where id = $1",
            [B1],
          )
        )[0].title,
        "坊っちゃん（新版）",
      );
    },
  );

  await check(
    "restoring puts back what the move changed and keeps what came after",
    async () => {
      // Found wrong later: and a reader has since replied, edited and posted.
      await db.exec(`
      delete from posts where id = '${P2}';
      update posts set body = '書き直した' where id = '${P1}';
      insert into posts (id, author_id, body) values ('${P5}', '${AKI}', 'あとの投稿');
    `);
      const stamped = await stamps();
      const result = await rows<{
        source: string;
        restored: number;
        skipped: number;
      }>(
        `select source, restored::int, skipped::int from private.restore_copy('${LABEL}')`,
      );
      // Parents first: the books before the posts that point at them, and the
      // posts before their reactions.
      const order = result.map((r) => r.source);
      const at = (name: string) => order.indexOf(name);
      assert.equal(order.length, TABLES.length);
      assert.ok(at("public.books") < at("public.posts"));
      assert.ok(at("public.posts") < at("public.post_reactions"));
      assert.ok(result.every((r) => r.skipped === 0));
      const after = await snapshot();
      const newer = (after["public.posts"] as { row: { id: string } }[]).filter(
        (r) => r.row.id === P5,
      );
      assert.equal(newer.length, 1);
      after["public.posts"] = (
        after["public.posts"] as { row: { id: string } }[]
      ).filter((r) => r.row.id !== P5);
      assert.deepEqual(after, before);
      // Its triggers were off: nothing was stamped anew (the move had stamped
      // the books). They are on again.
      assert.notDeepEqual(stamped, firstStamps);
      assert.deepEqual(await stamps(), firstStamps);
      const off = await rows(
        `select tgname from pg_trigger where not tgisinternal and tgenabled <> 'O'`,
      );
      assert.deepEqual(off, []);
    },
  );

  await check(
    "drop_newer also takes away rows added since the copy",
    async () => {
      const result = await rows<{ source: string; removed: number }>(
        `select source, removed::int from private.restore_copy('${LABEL}', null, true)`,
      );
      assert.equal(result.find((r) => r.source === "public.posts")?.removed, 1);
      assert.equal(result.find((r) => r.source === "public.books")?.removed, 0);
      assert.deepEqual(await snapshot(), before);
    },
  );

  await check("only the tables asked for are restored", async () => {
    await db.exec(`
      update books set title = '別の題' where id = '${B1}';
      delete from post_reactions where user_id = '${CHI}';
      alter table books disable trigger books_touch;
    `);
    await rows(
      `select * from private.restore_copy('${LABEL}', array['public.books']::regclass[])`,
    );
    // A trigger someone had turned off stays off.
    assert.deepEqual(
      await rows(
        "select tgenabled from pg_trigger where tgname = 'books_touch'",
      ),
      [{ tgenabled: "D" }],
    );
    await db.exec("alter table books enable trigger books_touch");
    assert.equal(
      (
        await rows<{ title: string }>("select title from books where id = $1", [
          B1,
        ])
      )[0].title,
      "坊っちゃん",
    );
    assert.equal(
      (await rows("select 1 from post_reactions where user_id = $1", [CHI]))
        .length,
      0,
    );
    await refused(
      `select * from private.restore_copy('${LABEL}', array['public.profiles']::regclass[])`,
      /no copy is kept under/,
    );
    await refused(
      `select * from private.restore_copy('${LABEL}', array['public.books', 'public.profiles']::regclass[])`,
      /some of those tables have no copy/,
    );
    await rows(`select * from private.restore_copy('${LABEL}')`);
    assert.deepEqual(await snapshot(), before);
  });

  await check(
    "an account deleted takes everything that went with it out of every copy",
    async () => {
      await deleteAccounts(db, [BEN]);
      // Nothing in any copy names him, in any column, but what the tables
      // themselves keep for the operator (tests/fixtures/account-tables.ts).
      const copies = await rows<{ copy_name: string; source: string }>(
        "select copy_name, source from keep.copies where label = $1",
        [LABEL],
      );
      assert.equal(copies.length, TABLES.length);
      for (const { copy_name, source } of copies) {
        const stays = Object.entries(ACCOUNT_TABLES[source]?.targets ?? {})
          .filter(([, target]) => "stays" in target)
          .map(([column]) => column);
        const named = await rows(
          `select 1 from keep.${JSON.stringify(copy_name)} t
           where (to_jsonb(t) - $2::text[])::text like '%' || $1 || '%'`,
          [BEN, stays],
        );
        assert.equal(named.length, 0, `the copy of ${source} still names Ben`);
      }
      const copyOf = (source: string) =>
        JSON.stringify(copies.find((c) => c.source === source)?.copy_name);
      // What went with him through his rows went too: his shop's private
      // shelves, Chi's reply to his post and Aki's like of it.
      assert.deepEqual(
        await rows(`select shop_id from keep.${copyOf("public.shop_private")}`),
        [],
      );
      assert.deepEqual(
        await rows(`select id from keep.${copyOf("public.posts")} order by id`),
        [{ id: P1 }, { id: P4 }],
      );
      assert.deepEqual(
        await rows(
          `select user_id from keep.${copyOf("public.post_reactions")} order by user_id`,
        ),
        [{ user_id: CHI }],
      );
      // The book he typed in stays in the copy, as in the catalog, unsigned.
      assert.deepEqual(
        await rows(
          `select id, created_by from keep.${copyOf("public.books")} order by id`,
        ),
        [
          { id: B1, created_by: null },
          { id: B2, created_by: null },
          { id: B3, created_by: CHI },
        ],
      );
      // Chi's report about him stays, in the copy as in the table.
      assert.equal(
        (await rows(`select 1 from keep.${copyOf("public.reports")}`)).length,
        1,
      );
    },
  );

  await check(
    "restoring after an account went leaves the account out",
    async () => {
      await db.exec(`delete from posts where id = '${P1}'`);
      const result = await rows<{ source: string; skipped: number }>(
        `select source, skipped::int from private.restore_copy('${LABEL}')`,
      );
      assert.ok(result.every((r) => r.skipped === 0));
      assert.equal(
        (await rows("select 1 from posts where id = $1", [P1])).length,
        1,
      );
      for (const table of TABLES)
        assert.equal(
          (
            await rows(
              `select 1 from ${table} t where to_jsonb(t)::text like '%' || $1 || '%'`,
              [BEN],
            )
          ).length,
          table === "public.reports" ? 1 : 0,
          table,
        );
    },
  );

  await check("a failed restore says which table, never what row", async () => {
    // Another catalog entry took the ISBN while the copy's book was gone.
    await db.exec("begin");
    try {
      await db.exec(`
        delete from posts where book_id = '${B1}';
        delete from books where id = '${B1}';
        insert into books (isbn, title, source) values ('9784101010014', '別の坊っちゃん', 'ndl');
      `);
      let message = "";
      let detail = "";
      try {
        await rows(
          `select * from private.restore_copy('${LABEL}', array['public.books']::regclass[])`,
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
        detail = (error as { detail?: string }).detail ?? "";
      }
      assert.equal(
        message,
        "the copy of public.books could not be put back (23505)",
      );
      assert.doesNotMatch(detail, /9784101010014|坊っちゃん/);
    } finally {
      await db.exec("rollback");
    }
  });

  await check(
    "an account still goes when a copy was dropped by hand",
    async () => {
      await db.exec("begin");
      try {
        const [first] = await rows<{ copy_name: string }>(
          "select copy_name from keep.copies order by copy_name limit 1",
        );
        await db.exec(`drop table keep.${JSON.stringify(first.copy_name)}`);
        await deleteAccounts(db, [CHI]);
        assert.equal(
          (await rows("select 1 from auth.users where id = $1", [CHI])).length,
          0,
        );
      } finally {
        await db.exec("rollback");
      }
    },
  );

  await check(
    "a link whose row is gone since is cleared or left out, as its key says",
    async () => {
      await db.exec("begin");
      try {
        await db.exec(`
          create table public.zz_shelf (id int, owner int, primary key (id, owner));
          create table public.zz_place (
            id int primary key,
            shelf int, owner int,
            next_to int references public.zz_place (id) on delete set null,
            foreign key (shelf, owner) references public.zz_shelf (id, owner) on delete cascade
          );
          create table public.zz_note (
            id int primary key,
            place int references public.zz_place (id) on delete set null
          );
          create table public.zz_tag (
            id int primary key,
            shelf int, owner int,
            foreign key (shelf, owner) references public.zz_shelf (id, owner)
              on delete set null (shelf)
          );
          insert into public.zz_shelf values (1, 1), (2, 1);
          insert into public.zz_place values (10, 1, 1, null), (11, 2, 1, 10), (12, 1, 1, 11);
          insert into public.zz_note values (100, 10), (101, 11);
          insert into public.zz_tag values (1000, 2, 1);
          select private.keep_copy('20990101000000_shelves',
            array['public.zz_shelf', 'public.zz_place', 'public.zz_note', 'public.zz_tag']::regclass[]);
          select private.check_copy('20990101000000_shelves');
          delete from public.zz_place;
          delete from public.zz_tag;
          delete from public.zz_shelf where id = 2;
        `);
        const result = await rows<{
          source: string;
          restored: number;
          skipped: number;
        }>(
          `select source, restored::int, skipped::int from private.restore_copy(
             '20990101000000_shelves',
             array['public.zz_place', 'public.zz_note']::regclass[])`,
        );
        assert.deepEqual(result, [
          { source: "public.zz_place", restored: 2, skipped: 1 },
          { source: "public.zz_note", restored: 2, skipped: 0 },
        ]);
        // Place 11's shelf is gone, so it stays out; place 12 sat next to it
        // and note 101 was on it, and those links clear, as on delete set null.
        assert.deepEqual(
          await rows("select id, next_to from public.zz_place order by id"),
          [
            { id: 10, next_to: null },
            { id: 12, next_to: null },
          ],
        );
        assert.deepEqual(
          await rows("select id, place from public.zz_note order by id"),
          [
            { id: 100, place: 10 },
            { id: 101, place: null },
          ],
        );
        // A key that clears only some of its columns clears only those.
        await rows(
          `select * from private.restore_copy(
             '20990101000000_shelves', array['public.zz_tag']::regclass[])`,
        );
        assert.deepEqual(
          await rows("select id, shelf, owner from public.zz_tag"),
          [{ id: 1000, shelf: null, owner: 1 }],
        );
      } finally {
        await db.exec("rollback");
      }
    },
  );

  await check(
    "a row that goes with a person through too many links is refused",
    async () => {
      await db.exec("begin");
      try {
        await db.exec(`
          create table public.zz_d0 (
            id int primary key,
            owner uuid references auth.users (id) on delete cascade
          );
          insert into public.zz_d0 values (1, '${AKI}');
        `);
        for (let n = 1; n <= 6; n++) {
          await db.exec(`
            create table public.zz_d${n} (
              id int primary key,
              up int references public.zz_d${n - 1} (id) on delete cascade
            );
            insert into public.zz_d${n} values (1, 1);
          `);
        }
        // Five links up to the person are followed.
        await db.exec(
          "select private.keep_copy('20990101000000_deep', array['public.zz_d5']::regclass[])",
        );
        assert.deepEqual(
          await rows(
            'select keep_owners from keep."20990101000000_public_zz_d5"',
          ),
          [{ keep_owners: [AKI] }],
        );
        await refused(
          "select private.keep_copy('20990101000000_deeper', array['public.zz_d6']::regclass[])",
          /public\.zz_d6 goes with its person through more links than a copy follows/,
        );
      } finally {
        await db.exec("rollback");
      }
    },
  );

  await check("nobody reaches the copies through the API", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [schema] = await rows<{ ok: boolean }>(
        "select has_schema_privilege($1, 'keep', 'USAGE') as ok",
        [role],
      );
      assert.equal(schema.ok, false, role);
      for (const fn of [
        "private.keep_copy(text, regclass[])",
        "private.check_copy(text, regclass[], regclass[])",
        "private.copy_owners(regclass, text, integer)",
        "private.restore_copy(text, regclass[], boolean)",
        "private.drop_copy(text)",
        "private.forget_in_copies()",
        "private.copy_columns(regclass, text)",
        "private.copy_key(regclass)",
      ]) {
        const [run] = await rows<{ ok: boolean }>(
          "select has_function_privilege($1, $2, 'EXECUTE') as ok",
          [role, fn],
        );
        assert.equal(run.ok, false, `${role} ${fn}`);
      }
      await db.exec(`set role ${role}`);
      try {
        await refused("select * from keep.copies", /permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  });

  await check(
    "a copy is named after its migration and needs a primary key",
    async () => {
      await refused(
        `select private.keep_copy('works', array['public.books']::regclass[])`,
        /name a copy after its migration/,
      );
      await db.exec("create table public.zz_no_key (note text)");
      try {
        await refused(
          `select private.keep_copy('20990101000000_no_key', array['public.zz_no_key']::regclass[])`,
          /has no primary key/,
        );
      } finally {
        await db.exec("drop table public.zz_no_key");
      }
    },
  );

  await check("dropping a copy takes its tables and its rows", async () => {
    await db.exec(`select private.drop_copy('${LABEL}')`);
    assert.deepEqual(await keepTables(), ["copies"]);
    assert.equal((await rows("select 1 from keep.copies")).length, 0);
    await refused(`select private.drop_copy('${LABEL}')`, /no copy is kept/);
  });

  await check(
    "no migration locks a table where supabase db push refuses it",
    async () => {
      for (const file of migrationFiles())
        assert.deepEqual(pushProblems(file, migrationText(file)), [], file);
      assert.deepEqual(
        pushProblems(
          "x.sql",
          `lock table public.books in access exclusive mode;
         do $$ begin lock table public.posts in exclusive mode; end $$;
         do $do1$ begin lock table public.shops; end $do1$;`,
        ),
        [
          'x.sql runs "LOCK TABLE PUBLIC.BOOKS" outside a block; put it in a do block',
        ],
      );
    },
  );

  await check(
    "every migration that keeps a copy checks it in one transaction",
    async () => {
      for (const file of migrationFiles())
        assert.deepEqual(movingProblems(file, migrationText(file)), [], file);
      // And the rule catches what it is there for.
      assert.deepEqual(
        movingProblems(
          "x.sql",
          `select private.keep_copy('20990101000000_x', array['public.books']::regclass[]);
         update public.books set title = title;`,
        ),
        ["x.sql keeps a copy but never checks it after the move"],
      );
      assert.deepEqual(
        movingProblems(
          "y.sql",
          `-- private.check_copy() in a comment is no check
         select private.keep_copy('20990101000000_y', array['public.books']::regclass[]);
         create index concurrently books_title on public.books (title);
         select private.check_copy('20990101000000_y');
         commit;`,
        ),
        [
          'y.sql runs "CREATE INDEX CONCURRENTLY" outside its transaction; move it to a file of its own',
          "y.sql ends its own transaction with COMMIT",
        ],
      );
      // A function's or a do block's own begin is not the file's.
      assert.deepEqual(
        movingProblems(
          "z.sql",
          `select private.keep_copy('20990101000000_z', array['public.books']::regclass[]);
         create function private.z() returns void language plpgsql as $$
         declare n int; begin n := 1; end; $$;
         do $body$ declare n int; begin commit; end $body$;
         select private.check_copy('20990101000000_z');
         begin;`,
        ),
        ["z.sql ends its own transaction with BEGIN"],
      );
    },
  );

  console.log(`${passed} copy checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
