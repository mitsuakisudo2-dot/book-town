import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// The town's counts kept by the database (AUD-006 6c;
// supabase/migrations/*_counts_in_database.sql). What the table keeps for
// each work is what counting every row would give, whatever was written:
// 便り and replies (not reading alone), public shelves of open shops, a
// book moved to another work, what the operator hid or a report holds. The
// counts a reader is answered are what they could count of the rows they
// may read, so a block takes out the other person's part; only books they
// may read are answered, and the works most shelved and talked of each come
// with a book they may read, their own first. Nobody reads the table, who
// may call what, and undoing the file.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_counts_in_database.sql"));
assert.ok(FILE, "the counts migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const DAN = "00000000-0000-4000-8000-00000000000d";
const PEOPLE = [AKI, BEN, CHI, DAN];

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const RAIN = id(2, 1); // from a catalog
const SNOW = id(2, 2); // from a catalog
const BEN_RAIN = id(2, 3); // Ben's registration of RAIN's ISBN: one work
const CHI_SECRET = id(2, 4); // Chi's, used nowhere
const WIND = id(2, 5); // from a catalog, kept for the shelves
const RAIN_ISBN = "9784000000017";

const AKI_SHOP = id(3, 1);
const BEN_SHOP = id(3, 2);
const DAN_SHOP = id(3, 3);

const shelf = (name: string, books: string[], isPublic = true) => ({
  id: name,
  name,
  isPublic,
  items: books.map((book, at) => ({
    id: `${name}-${at}`,
    bookId: book,
    pop: "",
  })),
});
const shelves = (...list: ReturnType<typeof shelf>[]) => JSON.stringify(list);

const SEED = `
  insert into auth.users (id) values ${PEOPLE.map((p) => `('${p}')`).join(", ")};
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'),
    ('${CHI}', 'chi', 'チー'), ('${DAN}', 'dan', 'ダン');
  insert into books (id, title, author, source, isbn, created_by) values
    ('${RAIN}', '雨の本', '雨野', 'ndl', '${RAIN_ISBN}', null),
    ('${SNOW}', '雪の本', '雪野', 'ndl', null, null),
    ('${WIND}', '風の本', '風野', 'ndl', null, null);
  insert into books (id, title, author, source, isbn, created_by) values
    ('${BEN_RAIN}', '雨の本', '雨野', 'manual', '${RAIN_ISBN}', '${BEN}'),
    ('${CHI_SECRET}', '秘密の本', 'チー', 'manual', null, '${CHI}');
  insert into posts (author_id, body, book_id, created_at) values
    ('${AKI}', '雨の本はいい', '${RAIN}', now() - interval '3 days'),
    ('${BEN}', 'わたしの雨の本', '${BEN_RAIN}', now() - interval '2 days'),
    ('${CHI}', '雪の本', '${SNOW}', now() - interval '1 day');
  insert into posts (author_id, body, book_id, reading_mode) values
    ('${DAN}', 'ひとりで読む', '${SNOW}', 'solo');
  insert into shops (id, owner_id, name, is_open) values
    ('${AKI_SHOP}', '${AKI}', 'アキの本屋', true),
    ('${BEN_SHOP}', '${BEN}', 'ベンの本屋', true),
    ('${DAN_SHOP}', '${DAN}', 'ダンの本屋', false);
  insert into shop_private (shop_id, shelves) values
    ('${AKI_SHOP}', '${shelves(shelf("a1", [RAIN, SNOW]), shelf("a2", [RAIN]), shelf("a3", [WIND], false))}'),
    ('${BEN_SHOP}', '${shelves(shelf("b1", [BEN_RAIN, RAIN]), shelf("b2", [WIND]))}'),
    ('${DAN_SHOP}', '${shelves(shelf("d1", [WIND]))}');
`;

type Visitor = string | null;

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

type Count = { shelves: number; talk: number; reviews: number };

/** The functions of the counts, for their rights and for what undoing leaves. */
const NAMES = [
  "town_counts",
  "counts_of",
  "top_works",
  "work_faces",
  "shelf_works",
  "post_counted",
  "shop_shown",
  "add_counts",
  "add_posts",
  "add_shops",
  "book_part",
  "target_part",
  "count_posts",
  "count_shops",
  "count_book",
  "count_moderation",
  "tally_all",
  "recount_all",
]
  .map((name) => `'${name}'`)
  .join(", ");

/** What the table keeps, by work. */
async function kept(db: PGlite): Promise<Map<string, Count>> {
  const { rows } = await db.query<Count & { work_id: string }>(
    `select work_id, shelves, talk, reviews from private.work_counts
     where shelves <> 0 or talk <> 0 or reviews <> 0`,
  );
  return new Map(
    rows.map(({ work_id, ...count }) => [work_id, count] as const),
  );
}

/** Every work counted again from every row, as the database counts it. */
async function counted(db: PGlite): Promise<Map<string, Count>> {
  const { rows } = await db.query<Count & { work_id: string }>(
    `select t.work_id, t.shelves, t.talk, t.reviews from private.tally_all() t
     where t.shelves > 0 or t.talk > 0`,
  );
  return new Map(
    rows.map(({ work_id, ...count }) => [work_id, count] as const),
  );
}

const sorted = (map: Map<string, Count>) =>
  [...map].sort(([a], [b]) => a.localeCompare(b));

async function workOf(db: PGlite, book: string): Promise<string> {
  const { rows } = await db.query<{ work_id: string }>(
    "select work_id from books where id = $1",
    [book],
  );
  return rows[0].work_id;
}

/**
 * What a reader could count of the rows they may read, as the app counts a
 * town (src/lib/search/presence.ts): by work, 便り and replies not read
 * alone, public shelves of the shops they may see that are open.
 */
async function byHand(
  db: PGlite,
  visitor: Visitor,
  books: string[],
): Promise<Map<string, Count>> {
  const works = await as<{ id: string; work_id: string }>(
    db,
    visitor,
    "select id, work_id from books",
  );
  const workOfBook = new Map(works.map((row) => [row.id, row.work_id]));
  const posts = await as<{
    book_id: string | null;
    parent_id: string | null;
    reading_mode: string | null;
    author_id: string;
  }>(
    db,
    visitor,
    "select book_id, parent_id, reading_mode, author_id from posts",
  );
  const shops = await as<{ public_shelves: ReturnType<typeof shelf>[] }>(
    db,
    visitor,
    "select public_shelves from shops where is_open",
  );
  // The work of a book the reader may not read is still its work: the
  // database knows it, as the app knows a book's work from its 便り.
  const { rows: all } = await db.query<{ id: string; work_id: string }>(
    "select id, work_id from books",
  );
  const workOfAny = new Map(all.map((row) => [row.id, row.work_id]));
  const answer = new Map<string, Count>();
  for (const book of books) {
    const work = workOfBook.get(book);
    if (!work) continue;
    const said = posts.filter(
      (post) =>
        post.book_id !== null &&
        post.reading_mode !== "solo" &&
        workOfAny.get(post.book_id) === work,
    );
    const count = {
      shelves: shops.reduce(
        (sum, shop) =>
          sum +
          shop.public_shelves.filter((held) =>
            held.items.some((item) => workOfAny.get(item.bookId) === work),
          ).length,
        0,
      ),
      talk: said.length,
      reviews: said.filter((post) => post.parent_id === null).length,
    };
    if (count.shelves || count.talk) answer.set(book, count);
  }
  return answer;
}

type Answer = {
  counts: Array<Count & { book: string }>;
  shelved: Array<Count & { book: { id: string } }>;
  talked: Array<Count & { book: { id: string } }>;
};

async function townCounts(
  db: PGlite,
  visitor: Visitor,
  books: string[],
  top = 6,
): Promise<Answer> {
  const [{ answer }] = await as<{ answer: Answer }>(
    db,
    visitor,
    "select town_counts($1::uuid[], $2) as answer",
    [books, top],
  );
  return answer;
}

const asMap = (answer: Answer) =>
  new Map(answer.counts.map(({ book, ...count }) => [book, count] as const));

/** The first undo statements of the first comment, lines starting "--   ". */
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

const EVERY = [RAIN, SNOW, WIND, BEN_RAIN, CHI_SECRET];

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
  await db.exec(TEXT);
  for (const file of FILES.filter((file) => file > FILE!))
    await db.exec(migrationText(file));

  await check("what was written before the file is counted", async () => {
    const rain = await workOf(db, RAIN);
    assert.equal(await workOf(db, BEN_RAIN), rain, "one ISBN, one work");
    const snow = await workOf(db, SNOW);
    const wind = await workOf(db, WIND);
    assert.deepEqual(
      sorted(await kept(db)),
      sorted(
        new Map([
          // a1, a2 and b1 (a shelf once, though it holds two of the work);
          // the 便り of Aki and Ben.
          [rain, { shelves: 3, talk: 2, reviews: 2 }],
          // a1; Chi's 便り, not Dan's read alone.
          [snow, { shelves: 1, talk: 1, reviews: 1 }],
          // b2: not a3 (private), not d1 (a closed shop).
          [wind, { shelves: 1, talk: 0, reviews: 0 }],
        ]),
      ),
    );
    assert.deepEqual(sorted(await kept(db)), sorted(await counted(db)));
  });

  await check(
    "each reader is answered what they could count of what they may read",
    async () => {
      for (const visitor of [null, ...PEOPLE])
        assert.deepEqual(
          sorted(asMap(await townCounts(db, visitor, EVERY))),
          sorted(await byHand(db, visitor, EVERY)),
          String(visitor),
        );
    },
  );

  await check("a book the reader may not read is not answered", async () => {
    await db.exec(`
      insert into posts (author_id, body, book_id) values
        ('${CHI}', 'ひみつ', '${CHI_SECRET}');
    `);
    // Chi's 便り makes the book one anyone may read; before it, only Chi.
    const { rows } = await db.query<{ id: string }>(
      `insert into books (title, author, source, created_by) values
         ('だれも知らない本', 'チー', 'manual', '${CHI}') returning id`,
    );
    const hidden = rows[0].id;
    for (const visitor of [null, AKI, BEN]) {
      const answer = await townCounts(db, visitor, [hidden, CHI_SECRET]);
      assert.deepEqual(
        answer.counts.map((count) => count.book),
        [CHI_SECRET],
        String(visitor),
      );
    }
    await db.exec(`delete from posts where book_id = '${CHI_SECRET}'`);
    assert.deepEqual(
      (await townCounts(db, AKI, [CHI_SECRET])).counts,
      [],
      "used nowhere again",
    );
    await db.exec(`delete from books where id = '${hidden}'`);
  });

  await check(
    "the table follows 便り, shelves, shops, works and the operator",
    async () => {
      const same = async (what: string) =>
        assert.deepEqual(
          sorted(await kept(db)),
          sorted(await counted(db)),
          what,
        );
      const rain = await workOf(db, RAIN);
      const of = async (work: string) => (await kept(db)).get(work);

      const { rows: written } = await db.query<{ id: string }>(
        `insert into posts (author_id, body, book_id) values
           ('${DAN}', 'わたしも', '${RAIN}') returning id`,
      );
      const dans = written[0].id;
      await db.query(
        `insert into posts (author_id, body, parent_id) values
           ('${AKI}', 'ですよね', '${dans}')`,
      );
      await same("a 便り and a reply without a book");
      assert.equal((await of(rain))?.talk, 3, "the reply has no book");
      await db.query(
        `insert into posts (author_id, body, book_id, parent_id) values
           ('${AKI}', 'この本の', '${RAIN}', '${dans}')`,
      );
      await same("a reply about the book");
      assert.deepEqual(await of(rain), { shelves: 3, talk: 4, reviews: 3 });

      await db.query(`update posts set spoiler = true where id = '${dans}'`);
      await same("marked as a spoiler");
      await db.query(
        `update posts set book_id = '${SNOW}' where id = '${dans}'`,
      );
      await same("moved to another book");
      await db.query(`delete from posts where id = '${dans}'`);
      await same("taken back, its replies with it");

      await db.query(
        `update shop_private set shelves = $1 where shop_id = '${AKI_SHOP}'`,
        [shelves(shelf("a1", [SNOW]), shelf("a3", [WIND, RAIN]))],
      );
      await same("shelves changed, one made public");
      await db.query(
        `update shops set is_open = true where id = '${DAN_SHOP}'`,
      );
      await same("a shop opened");
      await db.query(
        `update shops set is_open = false where id = '${BEN_SHOP}'`,
      );
      await same("a shop closed");
      await db.query(
        `update shops set is_open = true where id = '${BEN_SHOP}'`,
      );

      await db.query(
        `insert into moderation_hides (target_kind, target_id) values
           ('profile', '${BEN}')`,
      );
      await same("a person hidden");
      await db.query(`delete from moderation_hides where target_id = '${BEN}'`);
      await same("shown again");
      const { rows: chis } = await db.query<{ id: string }>(
        `select id from posts where author_id = '${CHI}' limit 1`,
      );
      await db.query(
        `insert into moderation_folds (target_kind, target_id, state, owner_id)
         values ('post', '${chis[0].id}', 'held', '${CHI}')`,
      );
      await same("a 便り a report holds");
      await db.query(
        `update moderation_folds set state = 'folded' where target_id = '${chis[0].id}'`,
      );
      await same("only folded");
      await db.query(
        `insert into moderation_hides (target_kind, target_id) values
           ('shop', '${AKI_SHOP}')`,
      );
      await same("a shop hidden");
      await db.query(
        `delete from moderation_hides where target_id = '${AKI_SHOP}'`,
      );
      await same("the shop shown again");

      // The operator sets Ben's book apart into a work of its own.
      const { rows: made } = await db.query<{ id: string }>(
        "insert into works default values returning id",
      );
      await db.query(
        `update books set work_id = '${made[0].id}' where id = '${BEN_RAIN}'`,
      );
      await same("a book moved to another work");
      await db.query(
        `update books set work_id = '${rain}' where id = '${BEN_RAIN}'`,
      );
      await same("and back");
      await db.query(`delete from works where id = '${made[0].id}'`);
      await same("the work let go");
    },
  );

  await check("a block takes out the other person's part", async () => {
    await db.exec(
      `insert into blocks (blocker_id, blocked_id) values ('${BEN}', '${AKI}')`,
    );
    for (const visitor of [AKI, BEN, CHI])
      assert.deepEqual(
        sorted(asMap(await townCounts(db, visitor, EVERY))),
        sorted(await byHand(db, visitor, EVERY)),
        visitor,
      );
    const forAki = asMap(await townCounts(db, AKI, [RAIN]));
    const forChi = asMap(await townCounts(db, CHI, [RAIN]));
    assert.ok(
      (forAki.get(RAIN)?.shelves ?? 0) < (forChi.get(RAIN)?.shelves ?? 0),
      "Ben's shelves are not in Aki's count",
    );
    await db.exec(`delete from blocks`);
  });

  await check(
    "the most shelved and talked of come with a book the reader may read",
    async () => {
      for (const visitor of [null, AKI, BEN, CHI]) {
        const answer = await townCounts(db, visitor, []);
        const counts = await byHand(db, visitor, EVERY);
        const shelved = answer.shelved.map((entry) => entry.shelves);
        assert.deepEqual(
          shelved,
          [...shelved].sort((a, b) => b - a),
          "most first",
        );
        assert.ok(answer.shelved.length > 0 && answer.talked.length > 0);
        const readable = new Set(
          (await as<{ id: string }>(db, visitor, "select id from books")).map(
            (row) => row.id,
          ),
        );
        for (const entry of [...answer.shelved, ...answer.talked]) {
          assert.ok(readable.has(entry.book.id), entry.book.id);
          const { book, ...count } = entry;
          const expected = [...counts].find(([counted]) => counted === book.id);
          if (expected) assert.deepEqual(count, expected[1]);
        }
        const works = answer.shelved.map((entry) => entry.book.id);
        assert.equal(new Set(works).size, works.length, "a work once");
      }
      // Ben's own registration stands for the work for Ben; the catalog's
      // for anyone else.
      const rain = (answer: Answer) =>
        answer.shelved.find((entry) => [RAIN, BEN_RAIN].includes(entry.book.id))
          ?.book.id;
      assert.equal(rain(await townCounts(db, BEN, [])), BEN_RAIN);
      assert.equal(rain(await townCounts(db, AKI, [])), RAIN);
      assert.equal(rain(await townCounts(db, null, [])), RAIN);
      assert.equal((await townCounts(db, null, [], 1)).shelved.length, 1);
      assert.ok((await townCounts(db, null, [], 1000)).shelved.length <= 20);
      assert.deepEqual((await townCounts(db, null, [], -5)).shelved, []);
      // The book's row as find_books gives it, no more.
      const [entry] = (await townCounts(db, null, [], 1)).shelved;
      assert.deepEqual(Object.keys(entry.book).sort(), [
        "author",
        "created_at",
        "id",
        "isbn",
        "price",
        "publisher",
        "source",
        "title",
        "updated_at",
        "work_id",
      ]);
    },
  );

  await check("many rows written at once are counted alike", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into posts (author_id, body, book_id, reading_mode)
       select (array['${AKI}', '${BEN}', '${CHI}', '${DAN}']::uuid[])[1 + n % 4],
         'たくさん', (array['${RAIN}', '${SNOW}', '${WIND}']::uuid[])[1 + n % 3],
         case when n % 5 = 0 then 'solo' end
       from generate_series(1, 120) n returning id`,
    );
    assert.equal(rows.length, 120);
    assert.deepEqual(sorted(await kept(db)), sorted(await counted(db)));
    await db.exec(`delete from posts where body = 'たくさん'`);
    assert.deepEqual(sorted(await kept(db)), sorted(await counted(db)));
    // A person's account goes, and all they wrote and shelved with it.
    await db.exec(`delete from auth.users where id = '${DAN}'`);
    await db.exec(`delete from profiles where id = '${DAN}'`);
    assert.deepEqual(sorted(await kept(db)), sorted(await counted(db)));
  });

  await check(
    "the night's recount sets what drifted, and runs every night",
    async () => {
      const work = await workOf(db, RAIN);
      await db.exec(`
        update private.work_counts set talk = talk + 5, shelves = -2
        where work_id = '${work}';
        insert into private.work_counts (work_id, talk)
        select id, 3 from works
        where id not in (select work_id from private.work_counts) limit 1;`);
      assert.notDeepEqual(sorted(await kept(db)), sorted(await counted(db)));
      // Read, a count below 0 is 0.
      const [{ answer }] = await as<{
        answer: { counts: { shelves: number }[] };
      }>(db, AKI, "select town_counts(array[$1]::uuid[], 0) as answer", [RAIN]);
      assert.ok(answer.counts.every((count) => count.shelves >= 0));
      await db.exec("select private.recount_all()");
      assert.deepEqual(sorted(await kept(db)), sorted(await counted(db)));
      const { rows } = await db.query(
        "select schedule, command from cron.job where jobname = 'work-counts'",
      );
      assert.deepEqual(rows, [
        { schedule: "30 18 * * *", command: "select private.recount_all()" },
      ]);
    },
  );

  await check("nobody reads the table but the functions", async () => {
    for (const visitor of [null, AKI]) {
      let refused = false;
      try {
        await as(db, visitor, "select * from private.work_counts");
      } catch {
        refused = true;
      }
      assert.ok(refused, String(visitor));
      for (const sql of [
        "select private.recount_all()",
        "select private.tally_all()",
        `select private.add_counts(array['${await workOf(db, RAIN)}']::uuid[], '{1}', '{1}', '{1}')`,
      ]) {
        let stopped = false;
        try {
          await as(db, visitor, sql);
        } catch {
          stopped = true;
        }
        assert.ok(stopped, sql);
      }
    }
    const { rows } = await db.query(
      `select p.proname as name, p.prosecdef as definer,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as everyone
       from pg_proc p
       where p.proname in (${NAMES})
       order by 1`,
    );
    const shut = (name: string, definer = true) => ({
      name,
      definer,
      anon: false,
      authenticated: false,
      everyone: false,
    });
    const open = (name: string, definer = true) => ({
      name,
      definer,
      anon: true,
      authenticated: true,
      everyone: false,
    });
    assert.deepEqual(rows, [
      shut("add_counts"),
      shut("add_posts"),
      shut("add_shops"),
      shut("book_part"),
      shut("count_book"),
      shut("count_moderation"),
      shut("count_posts"),
      shut("count_shops"),
      open("counts_of"),
      shut("post_counted"),
      shut("recount_all"),
      shut("shelf_works"),
      shut("shop_shown"),
      shut("tally_all"),
      shut("target_part"),
      open("top_works"),
      open("town_counts", false),
      open("work_faces"),
    ]);
  });

  await check(
    "undone, nothing is left and rows are written as before",
    async () => {
      await db.exec(rollbackSql());
      const { rows: left } = await db.query(
        `select proname as name from pg_proc
       where proname in (${NAMES})
       union all
       select relname from pg_class where relname like 'work_counts%'
       union all
       select tgname from pg_trigger where tgname in ('posts_count_came',
         'posts_count_changed', 'posts_count_gone', 'shops_count_came',
         'shops_count_changed', 'shops_count_gone', 'books_count_moved',
         'books_count_gone', 'moderation_hides_count', 'moderation_folds_count')
       union all
       select jobname from cron.job where jobname = 'work-counts'`,
      );
      assert.deepEqual(left, []);
      await db.query(
        `insert into posts (author_id, body, book_id) values
         ('${AKI}', 'あとで', '${RAIN}')`,
      );
      await db.query(
        `update shop_private set shelves = '[]' where shop_id = '${AKI_SHOP}'`,
      );
      await db.query(`delete from posts where author_id = '${AKI}'`);
    },
  );

  console.log(`${passed} count checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
