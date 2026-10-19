import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import { books as demoBooks } from "../src/lib/data";
import { databaseSearch, type DatabaseSearch } from "../src/lib/search";
import { keysOf } from "../src/lib/search/keys";
import { bookGrams } from "../src/lib/search/postings";
import { rankBooks } from "../src/lib/search/rank";
import { kanaToRomaji } from "../src/lib/search/romaji";
import { FEELINGS, type Book } from "../src/lib/types";

// The search asked of the database (AUD-006 6b;
// supabase/migrations/*_search_in_database.sql). The pairs each book is
// listed under hold every pair the app lists it under, so every book the
// app's search finds among books the database also finds; it never gives a
// book the reader may not read, gives one book an edition, and finds by ISBN.
// Which feelings anyone kept, and a feeling's records, are what the reader
// may read of the table. The grams follow a book's title, go with it, and
// nobody reads them. Who may call what, and undoing the file.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_search_in_database.sql"));
assert.ok(FILE, "the search migration");
const TEXT = migrationText(FILE);
const BEFORE_FOLD = FILES.find((file) => file.endsWith("_fold_scripts.sql"));
const BEFORE_FELT = FILES.find((file) => file.endsWith("_town_window.sql"));
assert.ok(BEFORE_FOLD && BEFORE_FELT);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const CATALOG = id(2, 1); // from a catalog: anyone reads it
const BEN_LISTED = id(2, 2); // Ben's, in a post anyone reads
const BEN_HIDDEN = id(2, 3); // Ben's, used nowhere: Ben alone
const AKI_OWN = id(2, 4); // Aki's, used nowhere: Aki alone
const BEN_COPY = id(2, 5); // Ben's and Chi's of one ISBN, both posted
const CHI_COPY = id(2, 6);
const ISBN = "9784000000017";

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
  insert into books (id, title, author, source, created_by) values
    ('${CATALOG}', '雨の日の本', '雨野 晴', 'ndl', null),
    ('${BEN_LISTED}', '雨の日の本 続', '雨野 晴', 'manual', '${BEN}'),
    ('${BEN_HIDDEN}', '雨の日の暗号', 'ベン', 'manual', '${BEN}'),
    ('${AKI_OWN}', '雨の日の暗号', 'アキ', 'manual', '${AKI}');
  insert into books (id, title, author, source, created_by, isbn) values
    ('${BEN_COPY}', '雨の日の手紙', '雨野 晴', 'manual', '${BEN}', '${ISBN}'),
    ('${CHI_COPY}', '雨の日の手紙', '雨野 晴', 'manual', '${CHI}', '${ISBN}');
  insert into posts (author_id, body, book_id) values
    ('${BEN}', 'この本', '${BEN_LISTED}'),
    ('${BEN}', 'この本も', '${BEN_COPY}'),
    ('${CHI}', 'この本', '${CHI_COPY}');
  insert into profile_follows (follower_id, followee_id) values ('${AKI}', '${CHI}');
  insert into reading_entries (user_id, book_id, kind, body, feelings, audience, created_at) values
    ('${BEN}', '${BEN_LISTED}', 'finished', '', '{cried,warm}', 'everyone', now() - interval '5 days'),
    ('${BEN}', '${BEN_LISTED}', 'note', '', '{laughed}', 'everyone', now() - interval '4 days'),
    ('${CHI}', '${CHI_COPY}', 'finished', '', '{scared}', 'private', now() - interval '3 days'),
    ('${CHI}', '${CHI_COPY}', 'finished', '', '{quiet,cried}', 'followers', now() - interval '2 days'),
    ('${AKI}', '${AKI_OWN}', 'finished', '', '{again}', 'private', now() - interval '1 day');
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

async function find(
  db: PGlite,
  visitor: Visitor,
  ask: DatabaseSearch,
  limit = 200,
): Promise<string[]> {
  const [{ found }] = await as<{ found: { id: string }[] }>(
    db,
    visitor,
    "select find_books($1::jsonb, $2, $3, $4) as found",
    [JSON.stringify(ask.forms), ask.isbn, ask.isbnStart, limit],
  );
  return found.map((book) => book.id);
}

const asked = (query: string) => {
  const ask = databaseSearch(query);
  assert.ok(ask, query);
  return ask;
};

/** A book as the database keeps it: a title and an author, nothing more. */
const plain = (book: { id: string; title: string; author: string }): Book => ({
  id: book.id,
  title: book.title,
  author: book.author,
  genre: "",
  summary: "",
  color: "",
  ink: "",
  height: 0,
  thickness: 0,
  pattern: 0,
});

/** What the app lists a book under (postingsOf). */
function appGrams(book: Book): Set<string> {
  const keys = keysOf(book);
  return bookGrams([
    ...keys.title.filter(
      (key) => key.kind === "surface" || key.kind === "reading",
    ),
    ...keys.subtitle,
    ...keys.author,
  ]);
}

// Titles and authors as people and catalogs write them.
const WRITTEN: Array<[string, string]> = [
  [
    "あなたの人生の物語（ハヤカワ文庫SF）",
    "テッド・チャン 著 ; 浅倉久志 [ほか]訳",
  ],
  ["罪と罰 上", "ドストエフスキー, 工藤精一郎 訳"],
  ["國語の學び 新装版", "著者E"],
  ["こゝろ", "夏目漱石"],
  ["ヴァイオリンとヴィオラ", "ヴォーン・ウィリアムズ"],
  ["ろうじん と うみ", "ヘミングウェイ"],
  ["コーヒーと ことば: 一杯の時間", "おおの ゆうこ／山田 一郎"],
  ["채식주의자", "한강"],
  ["Война и мир", "Лев Толстой"],
  ["THE CATCHER IN THE RYE", "J. D. Salinger"],
  ["1Q84 BOOK1〈4月-6月〉前編", "村上春樹"],
  ["銀河鉄道の夜 ―宮沢賢治童話集―", "宮沢賢治（作）"],
  ["わたしと小鳥とすずと", "金子みすゞ"],
  ["𠮷野家の本", "髙橋 一"],
  ["本", "ほん"],
  ["ー・ー", "・"],
];

const CORPUS: Book[] = [
  ...demoBooks.map(plain),
  ...WRITTEN.map(([title, author], at) =>
    plain({ id: `written-${at}`, title, author }),
  ),
];

/** A query people might type for a book: parts of it, in other scripts, misspelled. */
function queriesFor(book: Book): string[] {
  const title = Array.from(book.title);
  const loose = keysOf(book).title[0].loose;
  const queries = [
    book.title,
    book.author,
    title.slice(0, 2).join(""),
    title.slice(1, 4).join(""),
    `${book.title} ${book.author}`,
    `${title.slice(0, 2).join("")} ${Array.from(book.author).slice(0, 2).join("")}`,
    kanaToRomaji(loose),
  ];
  if (title.length >= 4) {
    const swapped = [...title];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    queries.push(swapped.join(""));
    queries.push(title.slice(0, -1).join(""));
  }
  return queries.filter((query) => query.trim());
}

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

/** A function as an earlier file made it, made again with create or replace. */
function functionOf(file: string, start: string): string {
  const text = migrationText(file);
  const at = text.indexOf(start);
  assert.ok(at >= 0, start);
  return text
    .slice(at, text.indexOf("$$;", at) + 3)
    .replace(/^create function/, "create or replace function");
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
  // Folded by the function before this file, to compare with after.
  const samples = [...CORPUS.map((book) => book.title), ...WRITTEN.flat()];
  const { rows: foldedBefore } = await db.query<{ key: string }>(
    "select private.fold_book_text(t) as key from unnest($1::text[]) with ordinality u(t, n) order by n",
    [samples],
  );
  await db.exec(SEED);
  await db.exec(migrationText(FILE!));

  await check("fold_book_text folds as before, in its two steps", async () => {
    const { rows } = await db.query<{ key: string }>(
      "select private.fold_book_text(t) as key from unnest($1::text[]) with ordinality u(t, n) order by n",
      [samples],
    );
    assert.deepEqual(rows, foldedBefore);
  });

  await check(
    "the books written before the file have their grams",
    async () => {
      const { rows } = await db.query<{ missing: number }>(
        `select count(*)::int as missing from books b
       where not exists (select 1 from private.book_grams g where g.book_id = b.id)`,
      );
      assert.equal(rows[0].missing, 0);
    },
  );

  await check(
    "a book is listed under every pair the app lists it under",
    async () => {
      const { rows } = await db.query<{ grams: string[] }>(
        `select private.book_grams_of(b ->> 'title', b ->> 'author') as grams
         from jsonb_array_elements($1::jsonb) with ordinality u(b, n)
         order by n`,
        [
          JSON.stringify(
            CORPUS.map(({ title, author }) => ({ title, author })),
          ),
        ],
      );
      CORPUS.forEach((book, at) => {
        const listed = new Set(rows[at].grams);
        const missing = [...appGrams(book)].filter((gram) => !listed.has(gram));
        assert.deepEqual(missing, [], `${book.title} / ${book.author}`);
      });
    },
  );

  // The corpus as books from a catalog, which anyone reads.
  const corpusIds = new Map<string, string>();
  await db.query(
    `insert into books (id, title, author, source)
     select id, title, author, 'ndl'
     from jsonb_to_recordset($1::jsonb) as b(id uuid, title text, author text)`,
    [
      JSON.stringify(
        CORPUS.map((book, at) => {
          const row = id(9, at + 1);
          corpusIds.set(row, book.id);
          return { id: row, title: book.title, author: book.author };
        }),
      ),
    ],
  );

  await check(
    "every book the app's search finds, the database finds",
    async () => {
      let asks = 0;
      for (const book of CORPUS)
        for (const query of queriesFor(book)) {
          const ask = databaseSearch(query);
          if (!ask) continue;
          const app = rankBooks(CORPUS, query, { limit: 1000 }).map(
            ({ match }) => match.book.id,
          );
          if (!app.length) continue;
          const found = new Set(
            (await find(db, null, ask)).flatMap(
              (row) => corpusIds.get(row) ?? [],
            ),
          );
          const missed = app.filter((bookId) => !found.has(bookId));
          assert.deepEqual(missed, [], `「${query}」`);
          asks += 1;
        }
      assert.ok(asks > CORPUS.length * 3, `${asks} queries`);
    },
  );

  await check(
    "it gives only books the reader may read, one an edition",
    async () => {
      for (const visitor of [null, AKI, BEN, CHI]) {
        const readable = new Set(
          (await as<{ id: string }>(db, visitor, "select id from books")).map(
            (row) => row.id,
          ),
        );
        const found = await find(db, visitor, asked("雨の日"));
        assert.ok(
          found.every((book) => readable.has(book)),
          String(visitor),
        );
        assert.equal(new Set(found).size, found.length);
        const copies = found.filter((book) =>
          [BEN_COPY, CHI_COPY].includes(book),
        );
        assert.equal(copies.length, 1, `one 雨の日の手紙 for ${visitor}`);
        const expected = [CATALOG, BEN_LISTED].concat(
          visitor === AKI ? [AKI_OWN] : visitor === BEN ? [BEN_HIDDEN] : [],
        );
        for (const book of expected)
          assert.ok(found.includes(book), `${book} for ${visitor}`);
        if (visitor !== BEN) assert.ok(!found.includes(BEN_HIDDEN));
        if (visitor !== AKI) assert.ok(!found.includes(AKI_OWN));
      }
      // The reader's own copy of an edition before another's.
      assert.ok(
        (await find(db, CHI, asked("雨の日の手紙"))).includes(CHI_COPY),
      );
      assert.ok(
        (await find(db, BEN, asked("雨の日の手紙"))).includes(BEN_COPY),
      );
    },
  );

  await check("a hidden book is not found by its own title", async () => {
    for (const visitor of [null, CHI]) {
      const found = await find(db, visitor, asked("雨の日の暗号"));
      assert.ok(!found.includes(BEN_HIDDEN) && !found.includes(AKI_OWN));
      assert.deepEqual(await find(db, visitor, asked("暗号")), []);
    }
    assert.deepEqual(await find(db, AKI, asked("暗号")), [AKI_OWN]);
  });

  await check("an ISBN finds its books, whole or begun", async () => {
    const whole = await find(db, null, asked("978-4-00-000001-7"));
    assert.equal(whole.length, 1);
    assert.ok([BEN_COPY, CHI_COPY].includes(whole[0]));
    // Begun, as ISBN-13 or as ISBN-10: the edition once, among near titles.
    for (const begun of ["97840000", "400000001"])
      assert.equal(
        (await find(db, null, asked(begun))).filter((book) =>
          [BEN_COPY, CHI_COPY].includes(book),
        ).length,
        1,
        begun,
      );
    assert.deepEqual(await find(db, null, asked("9784999999999")), []);
  });

  await check("it stops at the number asked for", async () => {
    assert.equal((await find(db, null, asked("本"), 3)).length, 3);
    assert.deepEqual(await find(db, null, asked("雨"), 0), []);
  });

  await check("a book's grams follow its title and go with it", async () => {
    const grams = async () =>
      (
        await db.query<{ grams: string[] }>(
          "select grams from private.book_grams where book_id = $1",
          [CATALOG],
        )
      ).rows[0]?.grams;
    await db.query("update books set title = '晴れの日の本' where id = $1", [
      CATALOG,
    ]);
    assert.ok((await grams())!.includes("晴れ"));
    assert.ok(!(await grams())!.includes("雨の"));
    assert.ok((await find(db, null, asked("晴れの日"))).includes(CATALOG));
    await db.query("delete from books where id = $1", [CATALOG]);
    assert.equal(await grams(), undefined);
  });

  await check(
    "which feelings were kept, as the reader may see them",
    async () => {
      for (const visitor of [null, AKI, BEN, CHI]) {
        const seen = await as<{ feelings: string[] }>(
          db,
          visitor,
          "select feelings from reading_entries where kind = 'finished'",
        );
        const kept = new Set(seen.flatMap((row) => row.feelings));
        const [{ felt }] = await as<{ felt: string[] }>(
          db,
          visitor,
          "select felt_in_town() as felt",
        );
        assert.deepEqual(
          felt,
          FEELINGS.filter((feeling) => kept.has(feeling)),
          String(visitor),
        );
      }
    },
  );

  await check("a feeling's records, as the reader may see them", async () => {
    for (const visitor of [null, AKI, BEN, CHI])
      for (const feeling of FEELINGS) {
        const seen = await as<{ id: string }>(
          db,
          visitor,
          `select id from reading_entries
           where kind = 'finished' and feelings @> array[$1]
           order by created_at desc, id desc`,
          [feeling],
        );
        const [{ records }] = await as<{
          records: { id: string; body: string }[];
        }>(db, visitor, "select feeling_records($1, 100) as records", [
          feeling,
        ]);
        assert.deepEqual(
          records.map((row) => row.id),
          seen.map((row) => row.id),
          `${feeling} for ${visitor}`,
        );
        assert.ok(records.every((row) => row.body === ""));
      }
    const [{ one }] = await as<{ one: unknown[] }>(
      db,
      AKI,
      "select feeling_records('cried', 1) as one",
    );
    assert.equal(one.length, 1);
  });

  await check(
    "a feeling kept only where the reader may not look is passed by a page at a time",
    async () => {
      await db.exec(`
        insert into reading_entries (user_id, book_id, kind, body, feelings, audience, created_at)
        select '${BEN}', '${BEN_HIDDEN}', 'finished', '', '{lingering}', 'private',
          now() - g * interval '1 second'
        from generate_series(1, 350) g;
        insert into reading_entries (user_id, book_id, kind, body, feelings, audience, created_at)
        values ('${BEN}', '${BEN_LISTED}', 'finished', '', '{lingering}', 'everyone', now() - interval '30 days');
      `);
      const [{ felt }] = await as<{ felt: string[] }>(
        db,
        CHI,
        "select felt_in_town() as felt",
      );
      assert.ok(felt.includes("lingering"));
      const [{ records }] = await as<{ records: unknown[] }>(
        db,
        CHI,
        "select feeling_records('lingering', 100) as records",
      );
      assert.equal(records.length, 1);
    },
  );

  await check("nobody reads the grams but the functions", async () => {
    for (const visitor of [null, AKI]) {
      let refused = false;
      try {
        await as(db, visitor, "select * from private.book_grams");
      } catch {
        refused = true;
      }
      assert.ok(refused, String(visitor));
    }
    const { rows } = await db.query(
      `select p.proname as name, p.prosecdef as definer,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as everyone
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname in ('find_books', 'feeling_records', 'found_book_ids',
         'felt_page', 'keep_book_grams', 'search_grams', 'fold_book_loose')
       order by 1`,
    );
    assert.deepEqual(rows, [
      {
        name: "feeling_records",
        definer: false,
        anon: true,
        authenticated: true,
        everyone: false,
      },
      {
        name: "felt_page",
        definer: true,
        anon: true,
        authenticated: true,
        everyone: false,
      },
      {
        name: "find_books",
        definer: false,
        anon: true,
        authenticated: true,
        everyone: false,
      },
      {
        name: "fold_book_loose",
        definer: false,
        anon: false,
        authenticated: false,
        everyone: false,
      },
      {
        name: "found_book_ids",
        definer: true,
        anon: true,
        authenticated: true,
        everyone: false,
      },
      {
        name: "keep_book_grams",
        definer: true,
        anon: false,
        authenticated: false,
        everyone: false,
      },
      {
        name: "search_grams",
        definer: false,
        anon: false,
        authenticated: false,
        everyone: false,
      },
    ]);
  });

  await check(
    "undone, the folding and the feelings are as before",
    async () => {
      await db.exec(rollbackSql());
      await db.exec(
        functionOf(
          BEFORE_FOLD!,
          "create or replace function private.fold_book_text(t text)",
        ),
      );
      await db.exec(
        functionOf(BEFORE_FELT!, "create function public.felt_in_town()"),
      );
      await db.exec(
        "drop function private.drop_long_vowels(text); drop function private.fold_book_loose(text);",
      );
      const { rows } = await db.query<{ key: string }>(
        "select private.fold_book_text(t) as key from unnest($1::text[]) with ordinality u(t, n) order by n",
        [samples],
      );
      assert.deepEqual(rows, foldedBefore);
      const [{ felt }] = await as<{ felt: string[] }>(
        db,
        CHI,
        "select felt_in_town() as felt",
      );
      assert.ok(felt.includes("lingering"));
      const { rows: left } = await db.query(
        `select proname as name from pg_proc
       where proname in ('find_books', 'feeling_records', 'found_book_ids',
         'felt_page', 'keep_book_grams', 'search_grams', 'text_pairs',
         'book_grams_of', 'drop_long_vowels', 'fold_book_loose')
       union all
       select relname from pg_class where relname in ('book_grams', 'reading_entries_felt')`,
      );
      assert.deepEqual(left, []);
      // Books are written as before.
      await db.query(
        "insert into books (title, author, source) values ('あとの本', 'X', 'ndl')",
      );
    },
  );

  console.log(`${passed} search checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
