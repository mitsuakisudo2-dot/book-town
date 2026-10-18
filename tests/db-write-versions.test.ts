import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// What a reader saves whole is written only over the version it began from
// (AUD-003; supabase/migrations/*_write_versions.sql; docs/09「版を確かめて書く」):
// their shop's shelves, its store scene, 人生の9冊 and each poster. A device
// that began from an older version is refused (PT409) and writes nothing; the
// same thing sent again, its answer lost, is taken as written; the old ways
// of writing still work and still count; nobody writes a version themselves;
// and the header's rollback undoes it.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_write_versions.sql"));
assert.ok(FILE, "the write versions migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const AKI_BOOK = id(1, 1);
const AKI_OTHER = id(1, 2);
const BEN_BOOK = id(1, 3);
const AKI_SHOP = id(2, 1);
const BEN_SHOP = id(2, 2);
const AKI_POSTER = id(3, 1);
const NEW_POSTER = id(3, 2);

const shelves = (name: string, books: string[] = []) =>
  JSON.stringify([
    {
      id: "s1",
      name,
      isPublic: true,
      items: books.map((bookId) => ({ bookId })),
    },
  ]);
const scene = (bookId: string) =>
  JSON.stringify({ objects: [{ kind: "book", bookId }] });
const words = (text: string) => [{ blocks: [{ type: "text", text }] }];
const poster = (text: string, more: Record<string, unknown> = {}) =>
  JSON.stringify({
    template: "text",
    theme: "kinari",
    font: "mincho",
    pages: words(text),
    spoiler: false,
    show_in_timeline: false,
    status: "published",
    ...more,
  });

// Aki has a shop with shelves, a nine and a poster made before this file;
// Ben has a shop that has never been saved.
const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
  insert into books (id, title, author, source, created_by) values
    ('${AKI_BOOK}', 'アキの本', 'アキ', 'manual', '${AKI}'),
    ('${AKI_OTHER}', 'アキのもう一冊', 'アキ', 'manual', '${AKI}'),
    ('${BEN_BOOK}', 'ベンの本', 'ベン', 'manual', '${BEN}');
  insert into shops (id, owner_id, name) values
    ('${AKI_SHOP}', '${AKI}', 'アキの店'), ('${BEN_SHOP}', '${BEN}', 'ベンの店');
  insert into shop_private (shop_id, shelves) values
    ('${AKI_SHOP}', '${shelves("雨の日に", [AKI_BOOK])}');
  insert into profile_nine (profile_id, position, book_id, note) values
    ('${AKI}', 1, '${AKI_BOOK}', 'はじめの一冊');
  insert into posters (id, author_id, template, pages) values
    ('${AKI_POSTER}', '${AKI}', 'text', '${JSON.stringify(words("はじめに"))}');
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
  /** The SQLSTATE a call is refused with. */
  async function refusal(run: () => Promise<unknown>, what: string) {
    try {
      await run();
    } catch (caught) {
      return (caught as { code?: string }).code;
    }
    assert.fail("expected a refusal: " + what);
  }
  /** Calls one of the save functions as a reader and answers its version. */
  async function save(
    visitor: Visitor,
    fn: string,
    args: unknown[],
  ): Promise<number> {
    const marks = args.map((_, n) => `$${n + 1}`).join(", ");
    const [row] = await as<{ version: string | number }>(
      visitor,
      `select public.${fn}(${marks}) as version`,
      args,
    );
    return Number(row.version);
  }
  const shop = async (shopId: string) =>
    (
      await rows<{
        shelves: unknown;
        scene: unknown;
        shelves_version: string | number;
        scene_version: string | number;
        public_shelves: unknown;
      }>(
        `select sp.shelves, sp.scene, sp.shelves_version, sp.scene_version,
           s.public_shelves
         from shop_private sp join shops s on s.id = sp.shop_id
         where sp.shop_id = $1`,
        [shopId],
      )
    ).map((row) => ({
      ...row,
      shelves_version: Number(row.shelves_version),
      scene_version: Number(row.scene_version),
    }))[0];
  const nine = async (reader: string) => ({
    version: Number(
      (
        await rows<{ nine_version: string | number }>(
          "select nine_version from profiles where id = $1",
          [reader],
        )
      )[0].nine_version,
    ),
    books: (
      await rows<{ book_id: string; note: string }>(
        "select book_id, note from profile_nine where profile_id = $1 order by position",
        [reader],
      )
    ).map((row) => [row.book_id, row.note]),
  });
  const posterRow = async (posterId: string) =>
    (
      await rows<{ version: string | number; pages: unknown; theme: string }>(
        "select version, pages, theme from posters where id = $1",
        [posterId],
      )
    ).map((row) => ({ ...row, version: Number(row.version) }))[0];
  return { rows, as, refusal, save, shop, nine, posterRow };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await before();
  const { rows, as, refusal, save, shop, nine, posterRow } = helpers(db);
  const rowsOf = async () =>
    rows<{ row: string }>(
      `select 'shop_private ' || (to_jsonb(sp) - 'updated_at')::text as row from shop_private sp
       union all select 'posters ' || (to_jsonb(p) - 'updated_at')::text from posters p
       union all select 'profiles ' || (to_jsonb(p) - 'updated_at')::text from profiles p
       union all select 'profile_nine ' || to_jsonb(n)::text from profile_nine n
       order by 1`,
    );
  const was = await rowsOf();
  await db.exec(TEXT);

  await check(
    "every thing saved before begins at version 0, and no row changed",
    async () => {
      assert.equal((await shop(AKI_SHOP)).shelves_version, 0);
      assert.equal((await shop(AKI_SHOP)).scene_version, 0);
      assert.equal((await nine(AKI)).version, 0);
      assert.equal((await posterRow(AKI_POSTER)).version, 0);
      const now = await rows<{ row: string }>(
        `select 'shop_private ' || (to_jsonb(sp) - 'updated_at' - 'shelves_version'
             - 'scene_version')::text as row from shop_private sp
         union all select 'posters ' || (to_jsonb(p) - 'updated_at' - 'version')::text
           from posters p
         union all select 'profiles ' || (to_jsonb(p) - 'updated_at' - 'nine_version')::text
           from profiles p
         union all select 'profile_nine ' || to_jsonb(n)::text from profile_nine n
         order by 1`,
      );
      assert.deepEqual(now, was);
      assert.deepEqual(
        await rows(
          "select label from keep.copies where label = '20261106000000_own_books_only'",
        ),
        [],
        "the copy the last move kept is let go",
      );
    },
  );

  await check(
    "the shelves are written over the version they began from, and only that",
    async () => {
      const first = shelves("晴れの日に", [AKI_BOOK]);
      assert.equal(await save(AKI, "save_shelves", [AKI_SHOP, first, 0]), 1);
      assert.deepEqual((await shop(AKI_SHOP)).shelves, JSON.parse(first));
      // The public copy follows, as for any write of the shelves.
      assert.deepEqual(
        (await shop(AKI_SHOP)).public_shelves,
        JSON.parse(first),
      );
      // Sent again, its answer lost: taken as written, nothing more counted.
      assert.equal(await save(AKI, "save_shelves", [AKI_SHOP, first, 0]), 1);
      // Another device that began from version 0 is refused, and nothing changes.
      assert.equal(
        await refusal(
          () => save(AKI, "save_shelves", [AKI_SHOP, shelves("古い棚"), 0]),
          "shelves over an older version",
        ),
        "PT409",
      );
      assert.deepEqual((await shop(AKI_SHOP)).shelves, JSON.parse(first));
      assert.equal((await shop(AKI_SHOP)).shelves_version, 1);
      // Read again, it writes over the version it now knows.
      assert.equal(
        await save(AKI, "save_shelves", [
          AKI_SHOP,
          shelves("晴れの日に", [AKI_BOOK, AKI_OTHER]),
          1,
        ]),
        2,
      );
      // With no base at all (null), only what is held already is taken.
      assert.equal(
        await refusal(
          () =>
            save(AKI, "save_shelves", [
              AKI_SHOP,
              shelves("何も知らない"),
              null,
            ]),
          "shelves with no base",
        ),
        "PT409",
      );
      // The scene's version is its own.
      assert.equal((await shop(AKI_SHOP)).scene_version, 0);
    },
  );

  await check(
    "a shop with no private row is at version 0, and the row made for it is a change",
    async () => {
      const first = shelves("ベンの棚", [BEN_BOOK]);
      assert.equal(await save(BEN, "save_shelves", [BEN_SHOP, first, 0]), 1);
      assert.equal(await save(BEN, "save_shelves", [BEN_SHOP, first, 0]), 1);
      // Another device that found no row either is refused.
      assert.equal(
        await refusal(
          () => save(BEN, "save_shelves", [BEN_SHOP, shelves("もう一台"), 0]),
          "shelves over a row made meanwhile",
        ),
        "PT409",
      );
      assert.equal(await save(BEN, "save_shelves", [BEN_SHOP, "[]", 1]), 2);
      assert.deepEqual((await shop(BEN_SHOP)).shelves, []);
      assert.equal((await shop(BEN_SHOP)).scene_version, 0);
    },
  );

  await check(
    "the store scene is written over its version; null takes it down",
    async () => {
      assert.equal(
        await save(AKI, "save_scene", [AKI_SHOP, scene(AKI_BOOK), 0]),
        1,
      );
      assert.equal(
        await save(AKI, "save_scene", [AKI_SHOP, scene(AKI_BOOK), 0]),
        1,
      );
      assert.equal(
        await refusal(
          () => save(AKI, "save_scene", [AKI_SHOP, scene(AKI_OTHER), 0]),
          "a scene over an older version",
        ),
        "PT409",
      );
      assert.deepEqual(
        (await shop(AKI_SHOP)).scene,
        JSON.parse(scene(AKI_BOOK)),
      );
      assert.equal(await save(AKI, "save_scene", [AKI_SHOP, null, 1]), 2);
      assert.equal((await shop(AKI_SHOP)).scene, null);
      // Taken down again, its answer lost.
      assert.equal(await save(AKI, "save_scene", [AKI_SHOP, null, 1]), 2);
      assert.equal((await shop(AKI_SHOP)).shelves_version, 2);
      // A shop with no private row yet, by its scene first.
      await db.query("delete from shop_private where shop_id = $1", [BEN_SHOP]);
      assert.equal(
        await save(BEN, "save_scene", [BEN_SHOP, scene(BEN_BOOK), 0]),
        1,
      );
      assert.equal((await shop(BEN_SHOP)).shelves_version, 0);
      // Shelves saved by a device that found no row are not refused for it.
      assert.equal(
        await save(BEN, "save_shelves", [BEN_SHOP, shelves("ベンの棚"), 0]),
        1,
      );
    },
  );

  await check(
    "人生の9冊 is written over its version, kept on the profile",
    async () => {
      // A version only goes up; how far is the database's (taking the old
      // nine out and putting the new one in counts twice).
      const pair = [
        [AKI_BOOK, AKI_OTHER],
        ["はじめの一冊", "二冊目"],
      ];
      const first = await save(AKI, "save_nine", [...pair, 0]);
      assert.ok(first > 0);
      assert.equal((await nine(AKI)).version, first);
      assert.deepEqual((await nine(AKI)).books, [
        [AKI_BOOK, "はじめの一冊"],
        [AKI_OTHER, "二冊目"],
      ]);
      assert.equal(await save(AKI, "save_nine", [...pair, 0]), first);
      assert.equal(
        await refusal(
          () => save(AKI, "save_nine", [[AKI_OTHER], ["古いほう"], 0]),
          "a nine over an older version",
        ),
        "PT409",
      );
      assert.equal((await nine(AKI)).books.length, 2);
      assert.equal((await nine(AKI)).version, first);
      // A changed note is a change; emptied, it is still a nine at a version.
      const noted = await save(AKI, "save_nine", [
        [AKI_BOOK, AKI_OTHER],
        ["はじめの一冊", "書き直した"],
        first,
      ]);
      assert.ok(noted > first);
      const emptied = await save(AKI, "save_nine", [[], [], noted]);
      assert.ok(emptied > noted);
      assert.deepEqual((await nine(AKI)).books, []);
      assert.equal(await save(AKI, "save_nine", [[], [], noted]), emptied);
      // The checks of replace_profile_nine still hold.
      assert.equal(
        await refusal(
          () => save(AKI, "save_nine", [[AKI_BOOK], [], emptied]),
          "a book without its note",
        ),
        "22023",
      );
      assert.equal(
        await refusal(
          () => save(AKI, "save_nine", [[BEN_BOOK], ["ベンの本"], emptied]),
          "someone else's book",
        ),
        "23514",
      );
      assert.equal((await nine(AKI)).version, emptied);
    },
  );

  await check(
    "a poster is made with no base, and written over its version after",
    async () => {
      const made = poster("新しいポスター");
      assert.equal(await save(AKI, "save_poster", [NEW_POSTER, made, null]), 0);
      // Made again, its answer lost.
      assert.equal(await save(AKI, "save_poster", [NEW_POSTER, made, null]), 0);
      assert.equal(
        await save(AKI, "save_poster", [
          NEW_POSTER,
          poster("新しいポスター", { theme: "navy" }),
          0,
        ]),
        1,
      );
      assert.equal(
        await refusal(
          () => save(AKI, "save_poster", [NEW_POSTER, poster("古いほう"), 0]),
          "a poster over an older version",
        ),
        "PT409",
      );
      assert.equal((await posterRow(NEW_POSTER)).theme, "navy");
      // One made before this file is at version 0.
      assert.equal(
        await save(AKI, "save_poster", [
          AKI_POSTER,
          poster("はじめに、の続き"),
          0,
        ]),
        1,
      );
      // Taken down on another device, a save that knew it was saved is refused.
      await as(AKI, "delete from posters where id = $1", [NEW_POSTER]);
      assert.equal(
        await refusal(
          () => save(AKI, "save_poster", [NEW_POSTER, poster("まだある"), 1]),
          "a poster taken down",
        ),
        "PT409",
      );
      assert.equal(await posterRow(NEW_POSTER), undefined);
      // The checks of a poster still hold.
      assert.equal(
        await refusal(
          () =>
            save(AKI, "save_poster", [
              AKI_POSTER,
              poster("x", { theme: "neon" }),
              1,
            ]),
          "a theme that is not offered",
        ),
        "23514",
      );
    },
  );

  await check(
    "the old ways of writing still work and still count a version",
    async () => {
      const shelvesAt = (await shop(AKI_SHOP)).shelves_version;
      await as(
        AKI,
        `insert into shop_private (shop_id, shelves) values ($1, $2)
         on conflict (shop_id) do update set shelves = excluded.shelves`,
        [AKI_SHOP, shelves("古いアプリの棚")],
      );
      assert.equal((await shop(AKI_SHOP)).shelves_version, shelvesAt + 1);
      const sceneAt = (await shop(AKI_SHOP)).scene_version;
      await as(AKI, "update shop_private set scene = $2 where shop_id = $1", [
        AKI_SHOP,
        scene(AKI_OTHER),
      ]);
      assert.equal((await shop(AKI_SHOP)).scene_version, sceneAt + 1);
      // Written the same again, nothing is counted.
      await as(AKI, "update shop_private set scene = $2 where shop_id = $1", [
        AKI_SHOP,
        scene(AKI_OTHER),
      ]);
      assert.equal((await shop(AKI_SHOP)).scene_version, sceneAt + 1);

      const nineAt = (await nine(AKI)).version;
      await as(AKI, "select public.replace_profile_nine($1, $2)", [
        [AKI_BOOK],
        ["古いアプリから"],
      ]);
      const oldWay = (await nine(AKI)).version;
      assert.ok(oldWay > nineAt);
      // Sent again (its answer lost), the same nine writes nothing.
      await as(AKI, "select public.replace_profile_nine($1, $2)", [
        [AKI_BOOK],
        ["古いアプリから"],
      ]);
      assert.equal((await nine(AKI)).version, oldWay);
      assert.equal(
        await save(AKI, "save_nine", [[AKI_BOOK], ["古いアプリから"], nineAt]),
        oldWay,
      );
      // A newer device that began before it is refused.
      assert.equal(
        await refusal(
          () => save(AKI, "save_nine", [[AKI_OTHER], ["新しいほう"], nineAt]),
          "a nine over what an old app wrote",
        ),
        "PT409",
      );

      const posterAt = (await posterRow(AKI_POSTER)).version;
      await as(AKI, "update posters set theme = 'sumi' where id = $1", [
        AKI_POSTER,
      ]);
      assert.equal((await posterRow(AKI_POSTER)).version, posterAt + 1);
      // Whether others may hang it is not what the app writes, and not counted.
      await as(AKI, "update posters set allow_display = false where id = $1", [
        AKI_POSTER,
      ]);
      assert.equal((await posterRow(AKI_POSTER)).version, posterAt + 1);

      // A nine's row changed in place counts too.
      const inPlace = (await nine(AKI)).version;
      await rows(
        "update profile_nine set note = 'その場で' where profile_id = $1",
        [AKI],
      );
      assert.equal((await nine(AKI)).version, inPlace + 1);
    },
  );

  await check("nobody writes a version themselves", async () => {
    const at = await shop(AKI_SHOP);
    await as(
      AKI,
      "update shop_private set shelves_version = 99, scene_version = 99 where shop_id = $1",
      [AKI_SHOP],
    ).catch(() => undefined);
    assert.equal((await shop(AKI_SHOP)).shelves_version, at.shelves_version);
    assert.equal((await shop(AKI_SHOP)).scene_version, at.scene_version);

    const nineAt = (await nine(AKI)).version;
    await as(AKI, "update profiles set nine_version = 99 where id = $1", [AKI]);
    assert.equal((await nine(AKI)).version, nineAt);
    // Their own edit of the profile leaves it as it is.
    await as(AKI, "update profiles set name = 'アキ2' where id = $1", [AKI]);
    assert.equal((await nine(AKI)).version, nineAt);

    assert.equal(
      await refusal(
        () =>
          as(AKI, "update posters set version = 99 where id = $1", [
            AKI_POSTER,
          ]),
        "a poster's version written by hand",
      ),
      "42501",
    );
    await as(
      AKI,
      `insert into posters (id, author_id, template, pages, version)
       values ($1, $2, 'text', $3, 99)`,
      [id(3, 9), AKI, JSON.stringify(words("手で"))],
    );
    assert.equal((await posterRow(id(3, 9))).version, 0);
  });

  await check(
    "only the reader writes their own, and only once signed in",
    async () => {
      const at = await shop(AKI_SHOP);
      assert.equal(
        await refusal(
          () =>
            save(BEN, "save_shelves", [
              AKI_SHOP,
              shelves("ベンが書く"),
              at.shelves_version,
            ]),
          "someone else's shelves",
        ),
        "42501",
      );
      assert.equal(
        await refusal(
          () => save(BEN, "save_scene", [AKI_SHOP, null, at.scene_version]),
          "someone else's scene",
        ),
        "42501",
      );
      assert.deepEqual(await shop(AKI_SHOP), at);
      // Ben's save of Aki's poster makes nothing of Aki's.
      const posterAt = await posterRow(AKI_POSTER);
      assert.equal(
        await refusal(
          () => save(BEN, "save_poster", [AKI_POSTER, poster("ベン"), null]),
          "someone else's poster, as new",
        ),
        "42501",
      );
      assert.equal(
        await refusal(
          () =>
            save(BEN, "save_poster", [
              AKI_POSTER,
              poster("ベン"),
              posterAt.version,
            ]),
          "someone else's poster",
        ),
        "PT409",
      );
      assert.deepEqual(await posterRow(AKI_POSTER), posterAt);
      for (const [fn, args] of [
        ["save_shelves", [AKI_SHOP, "[]", 0]],
        ["save_scene", [AKI_SHOP, null, 0]],
        ["save_nine", [[], [], 0]],
        ["save_poster", [id(3, 8), poster("x"), null]],
      ] as const)
        assert.equal(
          await refusal(() => save(null, fn, [...args]), fn + " signed out"),
          "42501",
        );
      // Signed out, none can even be called; what counts is nobody's to call.
      const callable = await rows<{
        fn: string;
        anon: boolean;
        reader: boolean;
      }>(
        `select p.oid::regprocedure::text as fn,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as reader
         from pg_proc p
         where p.proname in ('save_shelves', 'save_scene', 'save_nine',
           'save_poster', 'holds_nine', 'count_shop_versions',
           'count_poster_version', 'count_nine_version', 'keep_nine_version')
         order by 1`,
      );
      assert.deepEqual(
        callable.map((row) => [row.fn, row.anon, row.reader]),
        [
          ["private.count_nine_version()", false, false],
          ["private.count_poster_version()", false, false],
          ["private.count_shop_versions()", false, false],
          ["private.holds_nine(uuid,uuid[],text[])", false, true],
          ["private.keep_nine_version()", false, false],
          ["save_nine(uuid[],text[],bigint)", false, true],
          ["save_poster(uuid,jsonb,bigint)", false, true],
          ["save_scene(uuid,jsonb,bigint)", false, true],
          ["save_shelves(uuid,jsonb,bigint)", false, true],
        ],
      );
    },
  );

  await check(
    "deleting an account still takes its nine, shop and posters",
    async () => {
      await deleteAccounts(db, [AKI]);
      assert.deepEqual(
        await rows(
          `select 1 from profile_nine where profile_id = $1
           union all select 1 from posters where author_id = $1
           union all select 1 from shops where owner_id = $1
           union all select 1 from profiles where id = $1`,
          [AKI],
        ),
        [],
      );
      assert.equal((await nine(BEN)).version, 0);
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
             select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '')
                 || ' ' || md5(btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')))
             from pg_proc p
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
      assert.ok(start >= 0, "the header's rollback");
      const rollback: string[] = [];
      for (const line of header.slice(start + 1)) {
        if (!line.startsWith("--   ")) break;
        rollback.push(line.slice(3));
      }
      const sql = rollback.join("\n");
      assert.match(sql, /drop column nine_version/);
      await earlier.exec(sql);
      assert.deepEqual(await catalog(), was);
      // The old ways of writing work as before.
      await earlier.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub', '${AKI}', false);`,
      );
      await earlier.query("select public.replace_profile_nine($1, $2)", [
        [AKI_OTHER],
        ["戻したあと"],
      ]);
      await earlier.query(
        "update shop_private set shelves = '[]' where shop_id = $1",
        [AKI_SHOP],
      );
      await earlier.exec("reset role");
      await earlier.close();
    },
  );

  console.log(`${passed} write version checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
