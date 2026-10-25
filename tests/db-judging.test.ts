import assert from "node:assert/strict";
import { romajiToKana } from "../src/lib/search/romaji";
import { titleVolume } from "../src/lib/search/title";
import { volumeMark } from "../src/lib/search/volume";
import {
  answerAll,
  catalog,
  helpers,
  migrated,
  numbered,
  openbd,
  sru,
  type Ndl,
} from "./fixtures/bibliography";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";
import {
  TITLE_VOLUMES,
  VOLUME_FIELDS,
  VOLUME_READINGS,
  VOLUME_WORDS,
} from "./fixtures/volumes";

// Judging again, more carefully (item 4's rest; AUD-013, 014, 087, 088, 092;
// supabase/migrations/*_bibliography_judging.sql): volumes read alike by
// the app and the database, on the same examples; the examples the plan set
// (ONE PIECE 2 on volume 1's ISBN held, 1Q84 BOOK2 and 第2部 held, openBD's
// One piece 巻1 for ONE PIECE 1 not held, Norwegian Wood by Haruki Murakami
// on the Japanese edition not held, 海辺のカフカ on ノルウェイの森's ISBN
// held), in the shapes the library and openBD answer; a held book staying in
// its work; the books there are judged again after a copy, told as books
// registered before; and undoing the file.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_bibliography_judging.sql"));
assert.ok(FILE, "the judging migration");
const TEXT = migrationText(FILE);
const LABEL = FILE.replace(/\.sql$/, "");

const AKI = "00000000-0000-4000-8000-00000000000a";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const X = (n: number) => numbered(300 + n);

// The library's records as the shared folder's 書誌の見本 have them (the
// parts the judging reads), and openBD's title for ONE PIECE 1.
const ONE_PIECE_1: Ndl = {
  isbns: [X(1)],
  title: "One piece",
  reading: "One piece",
  plainTitle: "One piece. 巻1",
  volume: "巻1",
  volumeReading: "1",
  alternatives: [
    {
      value: "Romance dawn : 冒険の夜明け",
      reading: "Romance dawn : ボウケン ノ ヨアケ",
    },
  ],
  agents: [
    { name: "尾田, 栄一郎, 1975-", reading: "オダ, エイイチロウ, 1975-" },
  ],
  credits: ["尾田栄一郎 著"],
};
const NORWEGIAN_WOOD_1: Ndl = {
  isbns: [X(2)],
  title: "ノルウェイの森",
  reading: "ノルウェイ ノ モリ",
  plainTitle: "ノルウェイの森. 上",
  volume: "上",
  volumeReading: "ジョウ",
  alternatives: [],
  series: [{ value: "講談社文庫", reading: "コウダンシャ ブンコ" }],
  agents: [{ name: "村上, 春樹, 1949-", reading: "ムラカミ, ハルキ, 1949-" }],
  credits: ["村上春樹 [著]"],
};
const FAHRENHEIT_451: Ndl = {
  isbns: [X(3)],
  title: "華氏451度",
  reading: "カシ ヨンヒャクゴジュウイチド",
  alternatives: [{ value: "FAHRENHEIT 451" }],
  descriptions: ["原タイトル: FAHRENHEIT 451"],
  edition: "新訳版",
  agents: [
    { name: "Bradbury, Ray, 1920-2012" },
    { name: "伊藤, 典夫, 1942-", reading: "イトウ, ノリオ, 1942-" },
  ],
  credits: ["レイ・ブラッドベリ 著", "伊藤典夫 訳"],
};
const Q84_1: Ndl = {
  isbns: [X(4)],
  title: "1Q84",
  reading: "イチキュウハチヨン",
  volume: "BOOK 1",
  volumeReading: "BOOK 1",
  alternatives: [],
  agents: [{ name: "村上, 春樹, 1949-", reading: "ムラカミ, ハルキ, 1949-" }],
  credits: ["村上春樹 著"],
};
const NEJIMAKI_1: Ndl = {
  isbns: [X(6)],
  title: "ねじまき鳥クロニクル",
  reading: "ネジマキドリ クロニクル",
  volume: "第1部 泥棒かささぎ編",
  volumeReading: "ダイ1ブ ドロボウ カササギ ヘン",
  alternatives: [],
  agents: [{ name: "村上, 春樹, 1949-", reading: "ムラカミ, ハルキ, 1949-" }],
  credits: ["村上春樹 著"],
};
const LIBRARY: Record<string, string> = {
  [X(1)]: sru(ONE_PIECE_1),
  [X(2)]: sru(NORWEGIAN_WOOD_1),
  [X(3)]: sru(FAHRENHEIT_451),
  [X(4)]: sru(Q84_1),
  [X(6)]: sru(NEJIMAKI_1),
};
// openBD alone has X5: its ONE PIECE 1, titled as openBD titles it.
const OPENBD: Record<string, unknown> = {
  [X(5)]: openbd({
    isbn: X(5),
    title: "One piece 巻1",
    people: [{ name: "尾田 栄一郎", roles: ["A01"] }],
  }),
};

/** The rollback as the header writes it, then the functions as the files before made them. */
function rollbackSql(): string {
  const head = TEXT.slice(0, TEXT.indexOf("\n\n"));
  const statements = head
    .slice(head.indexOf("-- Rollback:"), head.indexOf("-- and then makes"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
  const from = (file: string, head: string, end: string) => {
    const text = migrationText(FILES.find((f) => f.endsWith(file))!);
    const start = text.indexOf(head);
    const stop = text.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, head);
    return text.slice(start, text.indexOf(";\n", stop) + 2);
  };
  const holds = (name: string, end = "revoke all on function") =>
    from(
      "_bibliography_holds.sql",
      `create function ${name}(`,
      `${end} ${name}(`,
    );
  return [
    statements,
    ...[
      holds("private.bib_number"),
      holds("private.bib_volume"),
      holds("private.bib_verdict"),
      holds("private.bib_judge"),
      holds("public.confirm_book_isbn", "grant execute on function"),
      holds("private.release_hold"),
      holds("public.book_holds", "grant execute on function"),
      from(
        "_bibliography.sql",
        "create function private.ndl_answer(",
        "revoke all on function private.ndl_answer(",
      ),
    ].map((text) =>
      text.replace("create function", "create or replace function"),
    ),
  ].join("\n");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await migrated();
  const { rows, as, register, tick, later } = helpers(db);

  await check(
    "volumes read alike in the app and the database, on the same examples (the library's 巻1 and ジョウ, openBD's One piece 巻1 among them)",
    async () => {
      for (const [text, rest, mark] of TITLE_VOLUMES) {
        assert.deepEqual(
          (({ rest, mark }) => ({ rest, mark }))(titleVolume(text)),
          { rest, mark },
          "app: " + text,
        );
        const [read] = await rows<{ rest: string; mark: string | null }>(
          "select * from private.bib_title_volume($1)",
          [text],
        );
        assert.deepEqual(
          { rest: read.rest, mark: read.mark ?? "" },
          { rest, mark },
          "database: " + text,
        );
      }
      for (const [word, mark] of VOLUME_WORDS) {
        assert.equal(volumeMark(word), mark, "app: " + word);
        const [read] = await rows<{
          before: string | null;
          mark: string | null;
        }>("select * from private.bib_volume_end($1)", [word]);
        assert.equal(
          read.mark !== null && read.before === "" ? read.mark : null,
          mark,
          "database: " + word,
        );
      }
      for (const [volume, mark] of VOLUME_FIELDS)
        assert.equal(
          (
            await rows<{ mark: string | null }>(
              "select private.bib_volume_start($1) as mark",
              [volume],
            )
          )[0].mark,
          mark,
          volume,
        );
      for (const [reading, mark] of VOLUME_READINGS)
        assert.equal(
          (
            await rows<{ mark: string | null }>(
              "select private.bib_volume_heard($1) as mark",
              [reading],
            )
          )[0].mark,
          mark,
          reading,
        );
    },
  );

  await check(
    "romaji reads as kana in the database as in the app",
    async () => {
      for (const word of [
        "haruki",
        "murakami",
        "Haruki Murakami",
        "noruwei no mori",
        "Ōe",
        "Kenzaburō",
        "kyouto",
        "shinbun",
        "shimbun",
        "tenpura",
        "kan'i",
        "jun’ichirou",
        "konnichiwa",
        "sakka",
        "matcha",
        "ninja",
        "chiisana",
        "tsubasa",
        "wan piisu",
        "fahrenheit",
        "norwegian",
        "SF",
        "1Q84",
        "n",
        "nn",
        "xyz",
        "aiueo",
        "",
      ]) {
        const app = romajiToKana(word);
        const [read] = await rows<{ kana: string | null }>(
          "select private.bib_romaji($1) as kana",
          [word],
        );
        assert.equal(read.kana, app && app.tail === "" ? app.kana : null, word);
      }
      // Each person either way round, folded as the creators' readings are
      // (Jay Rubin is not romaji).
      const [named] = await rows<{ names: string[]; folded: string[] }>(
        `select private.bib_romaji_names($1) as names,
         array(select private.fold_book_text(u.n)
           from unnest($2::text[]) with ordinality u (n, i) order by u.i) as folded`,
        [
          "Haruki Murakami; Murakami, Haruki / Jay Rubin",
          [
            "はるきむらかみ",
            "むらかみはるき",
            "むらかみはるき",
            "はるきむらかみ",
          ],
        ],
      );
      assert.deepEqual(named.names, named.folded);
    },
  );

  // The plan's examples, registered and judged as readers' books are: each
  // by a reader of its own, Aki the first, as a reader keeps one book of an
  // ISBN (AUD-010).
  const EXAMPLES: Array<
    [isbn: string, title: string, author: string, verdict: string]
  > = [
    // ONE PIECE 1 (the library: One piece, 巻1).
    [X(1), "ONE PIECE 2", "", "apart"],
    [X(1), "ONE PIECE 2", "尾田栄一郎", "apart"],
    [X(1), "ONE PIECE 1", "", "same"],
    [X(1), "ワンピース 1", "尾田栄一郎", "close"],
    [X(1), "ワンピース 2", "尾田栄一郎", "close"],
    [X(1), "冒険の夜明け", "", "close"],
    // openBD alone: One piece 巻1.
    [X(5), "ONE PIECE 1", "", "same"],
    [X(5), "ONE PIECE 2", "", "apart"],
    // ノルウェイの森 上.
    [X(2), "Norwegian Wood", "Haruki Murakami", "close"],
    [X(2), "Norwegian Wood", "Murakami, Haruki", "close"],
    [X(2), "Noruwei no mori", "", "close"],
    [X(2), "海辺のカフカ", "村上春樹", "apart"],
    [X(2), "ノルウェイの森 下", "", "apart"],
    [X(2), "ノルウェイの森 前編", "", "same"],
    [X(2), "ノルウェイの森 1", "村上春樹", "same"],
    // 華氏451度 (原タイトル: FAHRENHEIT 451).
    [X(3), "Fahrenheit 451", "", "close"],
    [X(3), "華氏451度 新訳版", "レイ・ブラッドベリ", "close"],
    // 1Q84 BOOK 1, ねじまき鳥クロニクル 第1部.
    [X(4), "1Q84 BOOK2", "", "apart"],
    [X(4), "1Q84 BOOK 1", "", "same"],
    [X(4), "1Q84 2", "村上春樹", "apart"],
    [X(6), "ねじまき鳥クロニクル 第2部", "", "apart"],
    [X(6), "ねじまき鳥クロニクル 第1部", "", "same"],
  ];
  const book = (n: number) => id(1, n);
  const reader = (n: number) => (n === 0 ? AKI : id(5, n));
  for (const n of EXAMPLES.keys()) {
    await db.query("insert into auth.users (id) values ($1)", [reader(n)]);
    await db.query(
      "insert into profiles (id, handle, name) values ($1, $2, $3)",
      n === 0 ? [AKI, "aki", "アキ"] : [reader(n), `reader${n}`, `読者${n}`],
    );
  }
  for (const [n, [isbn, title, author]] of EXAMPLES.entries())
    await register(reader(n), book(n + 1), isbn, title, author);
  // The library is asked about one edition a turn; a reader's books after
  // the first ten are placed twenty seconds apart
  // (20261119000000_bibliography_fetching.sql), a minute a turn here.
  for (let turn = 0; turn < 8; turn++) {
    await tick();
    await answerAll(db, LIBRARY, OPENBD);
    await later(1);
  }
  await tick();
  await later(11);
  await tick();
  const verdicts = await rows<{
    book_id: string;
    verdict: string;
    held: boolean;
  }>(
    `select book_id, verdict, held_work is not null as held
     from private.book_checks order by book_id`,
  );

  await check(
    "the plan's examples, as the sources write them: another volume held whoever wrote it, an English title or a romaji name not, another book of the same writer held",
    async () => {
      for (const [n, [isbn, title, author, verdict]] of EXAMPLES.entries()) {
        const got = verdicts.find((row) => row.book_id === book(n + 1));
        assert.equal(got?.verdict, verdict, `${isbn} ${title} / ${author}`);
        assert.equal(got?.held, verdict === "apart", title);
      }
    },
  );

  await check(
    "a held book stays in its edition's work, and its reader is told when it was placed",
    async () => {
      const held = book(1);
      assert.deepEqual(
        await rows(
          `select b.work_id = e.work_id as home, c.held_work = b.work_id as marked
           from books b join editions e on e.id = b.edition_id
           join private.book_checks c on c.book_id = b.id where b.id = $1`,
          [held],
        ),
        [{ home: true, marked: true }],
      );
      const told = await as<{
        book_id: string;
        placed_at: string;
        held_at: string;
      }>(
        AKI,
        "select book_id, placed_at::text, held_at::text from book_holds() where book_id = $1",
        [held],
      );
      const [kept] = await rows<{ placed_at: string }>(
        "select placed_at::text from private.book_checks where book_id = $1",
        [held],
      );
      assert.equal(told[0].placed_at, kept.placed_at);
      assert.ok(told[0].held_at > told[0].placed_at);
    },
  );

  await check(
    "nobody but the database reads the new functions; book_holds for a reader signed in only",
    async () => {
      for (const name of [
        "private.bib_volume_end(text)",
        "private.bib_title_volume(text)",
        "private.bib_volume_start(text)",
        "private.bib_volume_heard(text)",
        "private.bib_romaji(text)",
        "private.bib_romaji_names(text)",
        "private.bib_scripts(text)",
        "private.bib_overlap(text, text)",
        "private.ndl_more(xml)",
        "private.bib_compared(uuid, timestamptz, jsonb)",
        "private.bib_verdict(text, text, text, text, text, text, jsonb, jsonb, text)",
      ])
        for (const role of ["anon", "authenticated"])
          assert.deepEqual(
            await rows<{ can: boolean }>(
              "select has_function_privilege($1, $2, 'execute') as can",
              [role, name],
            ),
            [{ can: false }],
            `${role} ${name}`,
          );
      assert.deepEqual(
        await rows(
          `select has_function_privilege('anon', 'public.book_holds()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.book_holds()', 'execute') as reader`,
        ),
        [{ anon: false, reader: true }],
      );
    },
  );
  await db.close();

  await check(
    "the books there are judged again after a copy: a verdict that changes is told as a book registered before, a held book goes back to its work, and the rollback brings the verdicts back",
    async () => {
      const earlier = await migrated(FILE);
      const was = await catalog(earlier);
      const on = helpers(earlier);
      await earlier.exec(`
        insert into auth.users (id) values ('${AKI}');
        insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ');
      `);
      const kafka = id(2, 1);
      const piece = id(2, 2);
      const wood = id(2, 3);
      const sure = id(2, 4);
      const notebook = id(2, 5);
      await on.register(AKI, kafka, X(2), "海辺のカフカ", "村上春樹");
      await on.register(AKI, piece, X(1), "ONE PIECE 2");
      await on.register(AKI, wood, X(2), "Norwegian Wood", "Haruki Murakami");
      await on.register(AKI, sure, X(1), "別の本");
      await on.register(AKI, notebook, null, "手帖");
      for (let turn = 0; turn < 4; turn++) {
        await on.tick();
        await answerAll(earlier, LIBRARY, OPENBD);
      }
      await on.tick();
      await on.later(11);
      await on.tick();
      const checks = () =>
        on.rows<{
          book_id: string;
          verdict: string;
          held: boolean;
          checked: boolean;
          confirmed: boolean;
          home: boolean;
        }>(
          `select c.book_id, c.verdict, c.held_work is not null as held,
             c.checked_at is not null as checked, c.confirmed_at is not null as confirmed,
             b.work_id = e.work_id as home
           from private.book_checks c join books b on b.id = c.book_id
           join editions e on e.id = b.edition_id
           where c.book_id = any ($1) order by c.book_id`,
          [[kafka, piece, wood, sure, notebook]],
        );
      // As judged before this file: 海辺のカフカ close (its writer agreed),
      // ONE PIECE 2 close (巻1 not read), Norwegian Wood held in a work of
      // its own; 別の本 said to be the ISBN's.
      await on.as(AKI, "select confirm_book_isbn($1)", [sure]);
      const before = await checks();
      assert.deepEqual(
        before.map((c) => [c.verdict, c.held, c.home]),
        [
          ["close", false, true],
          ["close", false, true],
          ["apart", true, false],
          ["apart", false, true],
          ["none", false, true],
        ],
      );
      await on.later(3 * 24 * 60);
      const sizes = await on.rows(
        `select 'private.book_checks' as source, count(*)::int as n from private.book_checks
         union all select 'private.edition_sources', count(*)::int from private.edition_sources
         union all select 'public.books', count(*)::int from books
         order by source`,
      );
      await earlier.exec(TEXT);
      // Copied first, under the file's name.
      assert.deepEqual(
        await on.rows(
          "select source, row_count::int as n from keep.copies where label = $1 order by source",
          [LABEL],
        ),
        sizes,
      );
      // The held book is back in its work, still held, written down; the
      // books with an ISBN not confirmed wait to be judged again.
      const marked = await checks();
      assert.deepEqual(
        marked.map((c) => [c.verdict, c.held, c.home, c.checked]),
        [
          ["close", false, true, false],
          ["close", false, true, false],
          ["apart", true, true, false],
          ["apart", false, true, true],
          ["none", false, true, true],
        ],
      );
      assert.deepEqual(
        await on.rows(
          "select kind from private.work_changes where book_id = $1 order by changed_at, id",
          [wood],
        ),
        [{ kind: "hold" }, { kind: "unhold" }],
      );
      // The kept records read again: the library's other titles, its
      // reading of the volume.
      assert.deepEqual(
        await on.rows(
          `select s.fields -> 'volume_reading' as reading, s.fields -> 'alternatives' as others
           from private.edition_sources s join editions e on e.id = s.edition_id
           where e.isbn = $1 and s.source = 'ndl'`,
          [X(1)],
        ),
        [
          {
            reading: "1",
            others: [
              "Romance dawn : 冒険の夜明け",
              "Romance dawn : ボウケン ノ ヨアケ",
            ],
          },
        ],
      );
      await on.tick();
      const after = await checks();
      assert.deepEqual(
        after.map((c) => [c.verdict, c.held, c.home]),
        [
          ["apart", true, true],
          ["apart", true, true],
          ["close", false, true],
          ["apart", false, true],
          ["none", false, true],
        ],
      );
      // Told as books registered before: held days after they were placed.
      const told = await on.as<{ book_id: string; late: boolean }>(
        AKI,
        `select book_id, held_at - placed_at > interval '1 day' as late
         from book_holds() order by book_id`,
      );
      assert.deepEqual(told, [
        { book_id: kafka, late: true },
        { book_id: piece, late: true },
      ]);

      // Undone: the functions as they were, and the verdicts from the copy.
      await earlier.exec(rollbackSql());
      assert.deepEqual(await catalog(earlier), was);
      assert.deepEqual(
        (await checks()).map((c) => [c.verdict, c.held, c.confirmed]),
        before.map((c) => [c.verdict, c.held, c.confirmed]),
      );
      assert.deepEqual(
        await on.rows(
          `select count(*)::int as n from private.edition_sources
           where fields ? 'alternatives' or fields ? 'volume_reading'`,
        ),
        [{ n: 0 }],
      );
      // The tick as it was runs.
      await on.tick();
      await earlier.close();
    },
  );

  console.log(`${passed} judging checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
