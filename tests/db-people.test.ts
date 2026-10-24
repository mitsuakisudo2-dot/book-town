import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { pgliteTarget, recordsOf, rowsOf } from "../scripts/catalog-import";
import {
  catalog,
  helpers,
  migrated,
  ndlRecord,
  numbered,
  type Ndl,
} from "./fixtures/bibliography";
import {
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// People and genres (item 7 of the plan; supabase/migrations/*_people.sql).
// The completion conditions: one person under other names (what is not
// plain stays a candidate); the genre and the year are kept; the author
// readers typed is kept as it was. And nothing a reader keeps changes.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_people.sql"));
assert.ok(FILE, "the people migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const READERS = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}');
  insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
`;
const C = (n: number) => numbered(700 + n);
const BOOK = (n: number) =>
  `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NDC = (n: string) => `http://id.ndl.go.jp/class/ndc10/${n}`;

const TARO = {
  name: "架空, 太郎, 1950-",
  about: "http://id.ndl.go.jp/auth/entity/00000101",
  reading: "カクウ, タロウ",
};
const ATSUSHI_1 = {
  name: "中島, 敦, 1909-1942",
  about: "http://id.ndl.go.jp/auth/entity/00000102",
};
const ATSUSHI_2 = {
  name: "中島, 敦, 1964-",
  about: "http://id.ndl.go.jp/auth/entity/00000103",
};
const HANAKO = {
  name: "訳野, 花子",
  about: "http://id.ndl.go.jp/auth/entity/00000104",
};
const KAORU = {
  name: "栗野, 薫",
  about: "http://id.ndl.go.jp/auth/entity/00000105",
};
const AZUSA = {
  name: "中野, 梓",
  about: "http://id.ndl.go.jp/auth/entity/00000106",
};

const record = (
  n: number,
  ndl: Omit<Ndl, "isbns" | "bibId">,
): [string, Ndl] => [
  `R100000002-I${n}`,
  { bibId: String(n), isbns: [C(n)], publisher: "架空書房", ...ndl },
];

// 1-2: 架空太郎, printed two ways. 3: a translation, with 訳野花子. 4-5: two
// people named 中島敦. 6: 中島敦 without an authority (which one?). 7: 架空太郎
// without an authority. 8: 栗野薫 and 9: 中野梓, one person's two names.
// 10: a manga. 11: no NDC.
const RECORDS: [string, Ndl][] = [
  record(1, {
    title: "架空の町",
    agents: [TARO],
    credits: ["架空・太郎 著"],
    subjects: [NDC("913.6")],
    issued: "2014",
  }),
  record(2, {
    title: "架空の海",
    agents: [TARO],
    credits: ["架空太郎 著"],
    subjects: [NDC("913.6")],
    issued: "2020-06",
  }),
  record(3, {
    title: "訳された町",
    agents: [TARO, HANAKO],
    credits: ["架空太郎 著", "訳野花子 訳"],
    subjects: [NDC("933.7")],
  }),
  record(4, {
    title: "山月の記",
    agents: [ATSUSHI_1],
    subjects: [NDC("913.6")],
  }),
  record(5, { title: "経営の話", agents: [ATSUSHI_2], subjects: [NDC("336")] }),
  record(6, { title: "敦の本", agents: [{ name: "中島, 敦" }] }),
  record(7, { title: "名前だけの本", agents: [{ name: "架空, 太郎" }] }),
  record(8, { title: "小説の本", agents: [KAORU], subjects: [NDC("913.6")] }),
  record(9, { title: "評論の本", agents: [AZUSA], subjects: [NDC("910.26")] }),
  record(10, {
    title: "架空マンガ",
    agents: [TARO],
    credits: ["架空太郎 漫画"],
    subjects: [NDC("726.1")],
  }),
  record(11, { title: "分類のない本", agents: [TARO] }),
];

const listRecords = (records: [string, Ndl][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><OAI-PMH><ListRecords>${records
    .map(
      ([id, ndl]) =>
        `<record><header><identifier>oai:ndlsearch.ndl.go.jp:${id}</identifier><datestamp>2026-10-18T00:00:00Z</datestamp><setSpec>iss-ndl-opac</setSpec></header><metadata>${
          /<rdf:RDF[\s\S]*<\/rdf:RDF>/.exec(ndlRecord(ndl))![0]
        }</metadata></record>`,
    )
    .join("")}</ListRecords></OAI-PMH>`;

async function take(db: PGlite, records: [string, Ndl][], batch: string) {
  const rows = await rowsOf(db, recordsOf(listRecords(records)).records);
  await pgliteTarget(db).take(rows, batch);
}

const PEOPLE_TABLES = new Set([
  "people",
  "edition_people",
  "person_links",
  "edition_facts",
  "private.people_placed",
  "private.people_decisions",
  "private.people_stale",
  "private.genres",
  "private.genre_ndc",
  "private.work_genre_fixed",
]);

/** Every other table's rows, to show the people change nothing else. */
async function everythingElse(db: PGlite): Promise<Record<string, string>> {
  const tables = (
    await db.query<{ t: string }>(
      `select c.oid::regclass::text as t from pg_class c
       where c.relkind = 'r' and c.relnamespace in
         ('public'::regnamespace, 'private'::regnamespace, 'keep'::regnamespace)
       order by 1`,
    )
  ).rows
    .map((r) => r.t)
    .filter((t) => !PEOPLE_TABLES.has(t));
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [row] = (
      await db.query<{ h: string }>(
        `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${t} x`,
      )
    ).rows;
    out[t] = row.h;
  }
  return out;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await migrated();
  const { rows, as, count, refused } = helpers(db);
  await db.exec(READERS);

  const edition = async (n: number) =>
    (
      await rows<{ id: string }>("select id from editions where isbn = $1", [
        C(n),
      ])
    )[0].id;
  const read = () => rows("select private.people_read(100000)");
  type Credit = {
    seq: number;
    name: string;
    role: string | null;
    roles: string[];
    person_id: string | null;
    source: string;
  };
  const credits = async (n: number) =>
    rows<Credit>(
      "select seq, name, role, roles, person_id, source from edition_people where edition_id = $1 order by seq",
      [await edition(n)],
    );
  const personOf = async (n: number, seq = 1) =>
    (await credits(n))[seq - 1].person_id;
  const person = async (id: string | null) =>
    (
      await rows<{
        name: string;
        name_reading: string | null;
        authority: string | null;
      }>("select name, name_reading, authority from people where id = $1", [id])
    )[0];
  const forIsbn = (visitor: string | null, n: number) =>
    as<{
      seq: number;
      name: string;
      roles: string[];
      person_id: string | null;
      person_name: string | null;
      other_people: { person_id: string; name: string }[];
    }>(visitor, "select * from people_for_isbn($1)", [C(n)]);
  const booksOf = (visitor: string | null, id: string) =>
    as<{
      title: string;
      isbn: string;
      issued: string | null;
      roles: string[];
      printed_name: string;
    }>(
      visitor,
      "select title, isbn, issued, roles, printed_name from books_of_person($1)",
      [id],
    );

  await check(
    "a role's kinds: 著, 訳, 編, 絵, 原作, 監修, 写真, its own words kept, and openBD's codes",
    async () => {
      const cases: [string | null, string[]][] = [
        ["著", ["著"]],
        ["[著]", ["著"]],
        ["共著", ["著"]],
        ["編著", ["著", "編"]],
        ["編・著", ["著", "編"]],
        ["訳", ["訳"]],
        ["監訳", ["訳"]],
        ["翻訳", ["訳"]],
        ["編訳", ["編", "訳"]],
        ["原作", ["原作"]],
        ["原著", ["原作"]],
        ["監修", ["監修"]],
        ["日本語版監修", ["監修"]],
        ["編集", ["編"]],
        ["編曲", ["その他"]],
        ["副主编", ["編"]],
        ["漫画", ["絵"]],
        ["作画", ["絵"]],
        ["作・絵", ["絵", "著"]],
        ["企画・構成・作画", ["絵"]],
        ["企画", ["その他"]],
        ["さく・え", ["絵", "著"]],
        ["写真・文", ["写真", "著"]],
        ["［撮影］", ["写真"]],
        ["A01,B06", ["著", "訳"]],
        ["聞き手", ["その他"]],
        ["", []],
        [null, []],
      ];
      for (const [role, kinds] of cases) {
        const [got] = await rows<{ k: string[] }>(
          "select private.people_roles($1) as k",
          [role],
        );
        assert.deepEqual([...got.k].sort(), [...kinds].sort(), String(role));
      }
    },
  );

  await check(
    "a genre from the NDC: 726.1 マンガ before 7, 913 日本の小説, 933 海外の小説, and none for what no pattern takes",
    async () => {
      const cases: [string, string | null][] = [
        ["726.1", "マンガ"],
        ["726.101", "マンガ"],
        ["726.6", "絵本"],
        ["726.5", "芸術と写真"],
        ["913.6", "日本の小説"],
        ["933.7", "海外の小説"],
        ["914.6", "エッセイ"],
        ["911.168", "詩と短歌と俳句"],
        ["910.26", "文学の評論と戯曲"],
        ["902.3", "文学の評論と戯曲"],
        ["780", "趣味とスポーツ"],
        ["673", "社会とビジネスと教育"],
        ["686", "技術と暮らし"],
        ["007.64", "技術と暮らし"],
        ["031", "そのほか"],
        ["291.09", "歴史と地理"],
        ["336", "社会とビジネスと教育"],
        ["493", "科学と医学"],
        ["596", "技術と暮らし"],
        ["159", "哲学と宗教と心理"],
        ["830", "言葉"],
        ["K913", null],
      ];
      for (const [ndc, genre] of cases) {
        const [got] = await rows<{ g: string | null }>(
          "select private.ndc_genre($1) as g",
          [ndc],
        );
        assert.equal(got.g, genre, ndc);
      }
    },
  );

  await check(
    "the file reads every edition there is, and a minute's job reads what changes",
    async () => {
      assert.match(TEXT, /select private\.people_read\(1000000\);\s*$/);
      const jobs = await rows<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'people-read'",
      );
      assert.deepEqual(jobs, [
        { schedule: "* * * * *", command: "select private.people_read(2000)" },
      ]);
    },
  );

  // A reader's own book of 架空の町, and a book of their own without an ISBN.
  await as(
    AKI,
    "insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, $4, $5)",
    [BOOK(1), C(1), "架空の町", "かくう太郎", AKI],
  );
  await as(
    AKI,
    "insert into books (id, title, author, created_by) values ($1, $2, $3, $4)",
    [BOOK(2), "手書きの本", "山田一郎、田中花子", AKI],
  );
  await rows(
    `insert into library_entries (user_id, book_id, status, status_at, source)
     values ($1, $2, 'finished', now(), 'isbn')`,
    [AKI, BOOK(1)],
  );
  const readerBooks = await rows(
    "select id, isbn, edition_id, work_id, title, author, updated_at from books where created_by is not null order by id",
  );
  await take(db, RECORDS, "trial");
  const before = await everythingElse(db);
  await read();
  const afterRead = await everythingElse(db);

  await check(
    "one authority is one person, whatever the book prints; the name shown is the heading's, without its years",
    async () => {
      const one = await personOf(1);
      assert.ok(one);
      assert.equal(await personOf(2), one);
      assert.equal(await personOf(3, 1), one);
      assert.deepEqual(await person(one), {
        name: "架空太郎",
        name_reading: "カクウ タロウ",
        authority: TARO.about,
      });
      assert.deepEqual(
        (await credits(1)).map((c) => [c.name, c.role, c.roles, c.source]),
        [["架空・太郎", "著", ["著"], "bibliography"]],
        "the book's own name and role stay on the book",
      );
      assert.deepEqual(
        (await credits(3)).map((c) => [c.name, c.roles]),
        [
          ["架空太郎", ["著"]],
          ["訳野花子", ["訳"]],
        ],
      );
      assert.equal(
        await count("select count(*) from people where authority = $1", [
          TARO.about,
        ]),
        1,
      );
    },
  );

  await check(
    "the same name under two authorities is two people (中島敦 and 中島敦)",
    async () => {
      const a = await personOf(4);
      const b = await personOf(5);
      assert.ok(a && b);
      assert.notEqual(a, b);
      assert.equal((await person(a)).name, "中島敦");
      assert.equal((await person(b)).name, "中島敦");
    },
  );

  await check(
    "a name without an authority is a name only, and a candidate for the people of that name",
    async () => {
      assert.equal(await personOf(6), null);
      assert.equal(await personOf(7), null);
      const found = await rows<{
        reason: string;
        edition_id: string;
        name: string;
        people: string[];
      }>(
        "select reason, edition_id, name, people from private.people_candidates() order by name",
      );
      assert.deepEqual(
        found.map((c) => [c.reason, c.name, c.people.length]),
        [
          ["several", "中島敦", 2],
          ["one", "架空太郎", 1],
        ],
      );
      assert.equal(found[1].edition_id, await edition(7));
      assert.deepEqual(found[1].people, [await personOf(1)]);
    },
  );

  await check(
    "a book without an ISBN keeps its reader's words, as names only that nothing compares or shows",
    async () => {
      const [own] = await rows<{ edition_id: string }>(
        "select edition_id from books where id = $1",
        [BOOK(2)],
      );
      const typed = await rows<Credit>(
        "select seq, name, role, roles, person_id, source from edition_people where edition_id = $1 order by seq",
        [own.edition_id],
      );
      assert.deepEqual(
        typed.map((c) => [c.name, c.person_id, c.source]),
        [
          ["山田一郎", null, "typed"],
          ["田中花子", null, "typed"],
        ],
      );
      // The reader changes it: gone at once, and read again.
      await as(AKI, "update books set author = '山田一郎' where id = $1", [
        BOOK(2),
      ]);
      assert.equal(
        await count(
          "select count(*) from edition_people where edition_id = $1",
          [own.edition_id],
        ),
        0,
      );
      await read();
      assert.deepEqual(
        (
          await rows<{ name: string }>(
            "select name from edition_people where edition_id = $1",
            [own.edition_id],
          )
        ).map((r) => r.name),
        ["山田一郎"],
      );
      // A reader's book with an ISBN no source knows: nothing, and never their words.
      await as(
        BEN,
        "insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, $4, $5)",
        [BOOK(3), C(99), "だれも知らない本", "ベンの書いた名前", BEN],
      );
      await read();
      assert.equal(
        await count(
          "select count(*) from edition_people where name = 'ベンの書いた名前'",
        ),
        0,
      );
      assert.deepEqual(await forIsbn(null, 99), []);
      // The book goes (its account deleted, or the reader deletes it): its words go at once.
      await rows("delete from books where id = $1", [BOOK(2)]);
      assert.equal(
        await count(
          "select count(*) from edition_people where name = '山田一郎'",
        ),
        0,
      );
    },
  );

  await check(
    "the genre of an edition and its work, and the year as the bibliography has it",
    async () => {
      const genres = await rows<{
        isbn: string;
        ndc: string | null;
        genre: string | null;
      }>(
        `select e.isbn, f.ndc, private.ndc_genre(f.ndc) as genre
       from edition_facts f join editions e on e.id = f.edition_id order by e.isbn`,
      );
      const of = (n: number) => genres.find((g) => g.isbn === C(n));
      assert.equal(of(1)?.genre, "日本の小説");
      assert.equal(of(3)?.genre, "海外の小説");
      assert.equal(of(10)?.genre, "マンガ");
      assert.equal(of(11), undefined, "no NDC nor year, nothing kept");
      const [work] = await rows<{ work_id: string }>(
        "select work_id from editions where isbn = $1",
        [C(10)],
      );
      assert.deepEqual(
        await rows("select private.work_genre($1) as g", [work.work_id]),
        [{ g: "マンガ" }],
      );
      await rows("select private.genre_fix($1, '絵本')", [work.work_id]);
      assert.deepEqual(
        await rows("select private.work_genre($1) as g", [work.work_id]),
        [{ g: "絵本" }],
      );
      await rows("select private.genre_fix($1, null)", [work.work_id]);
      assert.deepEqual(
        await rows("select private.work_genre($1) as g", [work.work_id]),
        [{ g: "マンガ" }],
      );
      await refused(
        () =>
          rows("select private.genre_fix($1, '架空のジャンル')", [
            work.work_id,
          ]),
        /foreign key/,
        "not a genre",
      );
      const books = await booksOf(null, (await personOf(1))!);
      assert.deepEqual(
        books.map((b) => [b.title, b.issued]),
        [
          ["架空の海", "2020-06"],
          ["架空の町", "2014"],
          ["分類のない本", null],
          ["架空マンガ", null],
          ["訳された町", null],
        ],
        "newest first",
      );
      assert.deepEqual(books.find((b) => b.title === "架空マンガ")?.roles, [
        "絵",
      ]);
    },
  );

  await check(
    "the operator places a name on a person, or leaves it a name only, and reading again keeps it",
    async () => {
      const taro = (await personOf(1))!;
      await rows("select private.people_place($1, '架空太郎', $2)", [
        await edition(7),
        taro,
      ]);
      assert.equal(await personOf(7), taro);
      assert.deepEqual(
        await rows("select name from private.people_candidates()"),
        [{ name: "中島敦" }],
      );
      // Leaving the authority's person off a book.
      await rows("select private.people_place($1, '架空太郎', null)", [
        await edition(11),
      ]);
      assert.equal(await personOf(11), null);
      await rows(
        "insert into private.people_stale (edition_id) values ($1), ($2)",
        [await edition(7), await edition(11)],
      );
      await read();
      assert.equal(await personOf(7), taro);
      assert.equal(await personOf(11), null);
      await rows("select private.people_unplace($1, '架空太郎')", [
        await edition(11),
      ]);
      assert.equal(await personOf(11), taro);
      const seven = await edition(7);
      await refused(
        () =>
          rows("select private.people_place($1, '別の名前', $2)", [
            seven,
            taro,
          ]),
        /no such name/,
        "a name the edition does not have",
      );
    },
  );

  await check(
    "a change to the bibliography is read again: the minute's job makes the people of the edition anew",
    async () => {
      // As the operator's fix of the edition's people.
      await rows(
        "insert into private.edition_fixes (edition_id, field, value, note) values ($1, 'creators', $2::jsonb, '直し')",
        [
          await edition(5),
          JSON.stringify([
            { name: "中島敦", authority: ATSUSHI_2.about, role: "著" },
            { name: "経営花子", role: "編" },
          ]),
        ],
      );
      assert.equal(
        await count(
          "select count(*) from private.people_stale where edition_id = $1",
          [await edition(5)],
        ),
        1,
      );
      await read();
      assert.deepEqual(
        (await credits(5)).map((c) => [c.name, c.roles, c.person_id !== null]),
        [
          ["中島敦", ["著"], true],
          ["経営花子", ["編"], false],
        ],
      );
    },
  );

  await check(
    "two names of one person are linked and stay two (案 A); two ids of one person are joined",
    async () => {
      const kaoru = (await personOf(8))!;
      const azusa = (await personOf(9))!;
      await rows("select private.people_link($1, $2)", [azusa, kaoru]);
      await rows("select private.people_link($1, $2)", [kaoru, azusa]);
      assert.equal(await count("select count(*) from person_links"), 1);
      const seen = await forIsbn(null, 8);
      assert.deepEqual(
        seen.map((s) => [s.name, s.person_id, s.other_people]),
        [["栗野薫", kaoru, [{ person_id: azusa, name: "中野梓" }]]],
      );
      assert.deepEqual(
        (await booksOf(null, kaoru)).map((b) => b.title),
        ["小説の本"],
        "each name keeps its books",
      );
      await refused(
        () => rows("select private.people_link($1, $1)", [kaoru]),
        /two people/,
        "oneself",
      );
      await rows("select private.people_unlink($1, $2)", [kaoru, azusa]);
      assert.equal(await count("select count(*) from person_links"), 0);
      await rows("select private.people_link($1, $2)", [kaoru, azusa]);

      // The library has two ids of 中島敦 who are one (made up): joined.
      const a = (await personOf(4))!;
      const b = (await personOf(5))!;
      await rows("select private.people_join($1, $2)", [a, b]);
      assert.equal(await personOf(5), a);
      assert.deepEqual((await booksOf(null, b)).map((x) => x.title).sort(), [
        "山月の記",
        "経営の話",
      ]);
      await rows("insert into private.people_stale (edition_id) values ($1)", [
        await edition(5),
      ]);
      await read();
      assert.equal(
        await personOf(5),
        a,
        "reading again finds the one it was joined into",
      );
      // A link goes along with a join.
      await rows("select private.people_join($1, $2)", [kaoru, azusa]);
      assert.equal(
        await count("select count(*) from person_links"),
        0,
        "no link to oneself",
      );
      await refused(
        () => rows("select private.people_join($1, $1)", [a]),
        /two people/,
        "oneself",
      );
    },
  );

  await check(
    "the operator names a person, and the heading no longer renames them",
    async () => {
      const taro = (await personOf(1))!;
      await rows(
        "select private.people_name($1, '架空 太郎', 'カクウ タロウ')",
        [taro],
      );
      await rows(
        "insert into private.people_stale (edition_id) select id from editions",
      );
      await read();
      assert.equal((await person(taro)).name, "架空 太郎");
    },
  );

  await check(
    "typed authors follow their book: kept as long as the book is (a deleted account leaves its books, unowned), and no longer",
    async () => {
      await as(
        BEN,
        "insert into books (id, title, author, created_by) values ($1, $2, $3, $4)",
        [BOOK(4), "ベンの手書きの本", "ベンの打った著者", BEN],
      );
      await read();
      assert.equal(
        await count(
          "select count(*) from edition_people where name = 'ベンの打った著者'",
        ),
        1,
      );
      await deleteAccounts(db, [BEN]);
      const kept = await count("select count(*) from books where id = $1", [
        BOOK(4),
      ]);
      assert.equal(
        await count(
          "select count(*) from edition_people where name = 'ベンの打った著者'",
        ),
        kept,
      );
      await rows("delete from books where id = $1", [BOOK(4)]);
      assert.equal(
        await count(
          "select count(*) from edition_people where name = 'ベンの打った著者'",
        ),
        0,
      );
    },
  );

  await check(
    "anyone reads the people of an edition with a catalog row; nobody reaches the tables or the tools",
    async () => {
      for (const visitor of [null, AKI]) {
        assert.deepEqual(
          (await forIsbn(visitor, 3)).map((s) => [
            s.name,
            s.roles,
            s.person_name,
          ]),
          [
            ["架空太郎", ["著"], "架空 太郎"],
            ["訳野花子", ["訳"], "訳野花子"],
          ],
        );
        for (const table of [
          "people",
          "edition_people",
          "person_links",
          "edition_facts",
        ])
          await refused(
            () => as(visitor, `select * from ${table}`),
            /permission denied/,
            table,
          );
        for (const call of [
          "select private.people_read(1)",
          "select private.people_candidates()",
          "select private.people_make('x')",
          "select private.work_genre(gen_random_uuid())",
        ])
          await refused(() => as(visitor, call), /permission denied/, call);
      }
    },
  );

  await check(
    "reading every edition changed no other table, nor anything a reader keeps",
    async () => {
      assert.deepEqual(afterRead, before);
      const books = await rows(
        "select id, isbn, edition_id, work_id, title, author, updated_at from books where id = $1",
        [BOOK(1)],
      );
      assert.deepEqual(
        books,
        readerBooks.filter((b) => (b as { id: string }).id === BOOK(1)),
      );
    },
  );

  await check("the rollback in the file's head undoes it", async () => {
    const was = await migrated(FILE);
    const next = FILES[FILES.indexOf(FILE!) + 1];
    const undone = await migrated(next);
    const head = TEXT.slice(
      TEXT.indexOf("-- Rollback:"),
      TEXT.indexOf("\n\n", TEXT.indexOf("-- Rollback:")),
    );
    const statements = head
      .split("\n")
      .filter((line) => line.startsWith("--   "))
      .map((line) => line.slice(5))
      .join("\n");
    await undone.exec(statements);
    assert.deepEqual(await catalog(undone), await catalog(was));
  });

  console.log(`${passed} people checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
