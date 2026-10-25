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
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";

// Series and volumes (item 6 of the plan; supabase/migrations/*_series.sql).
// けにーさん's conditions (2026-10-24 07:21Z): a volume's number belongs to
// an edition in a line (通常版, 愛蔵版), never to a work, so lines are never
// counted together; the rules put together only what is plain, and nothing
// a person added or took out is lost when they run again; running again
// gives the same series, with the same ids; a run is written down before it
// is applied, applied all or nothing, and undone; and none of it moves
// anything a reader keeps (their books, marks, library).

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_series.sql"));
assert.ok(FILE, "the series migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const PEOPLE = `
  insert into auth.users (id) values ('${AKI}');
  insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ');
`;
const C = (n: number) => numbered(900 + n);
const BOOK = (n: number) => `95000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const GIANT = { name: "巨人, 架空", about: "http://id.ndl.go.jp/auth/entity/00000001" };
const WIZARD = { name: "魔法, 使い", about: "http://id.ndl.go.jp/auth/entity/00000002" };
const NOVELIST = { name: "夜野, 書子", about: "http://id.ndl.go.jp/auth/entity/00000003" };
const WRITER = { name: "翻訳, 原作者", about: "http://id.ndl.go.jp/auth/entity/00000004" };
const TRANSLATOR = { name: "訳野, 訳子", about: "http://id.ndl.go.jp/auth/entity/00000005" };
const LABEL = [{ value: "架空コミックス" }];

/** A record of the library's, as the catalog takes it. */
const record = (n: number, ndl: Omit<Ndl, "isbns" | "bibId">): [string, Ndl] => [
  `R100000002-I${n}`,
  { bibId: String(n), isbns: [C(n)], publisher: "架空書房", ...ndl },
];

// 1-3: 架空の巨人, a plain series. 4: its 愛蔵版 1 (other edition words).
// 5: its 続 (not plainly a volume). 6-7: 夜の図書館 上 and 下. 8-9: 架空年鑑
// 2025年版 and 2026年版 (yearly). 10-11: one person's books under one
// label, with different titles (ハリー・ポッター型). 12-13: 1 and 2 with a
// translator on the second only. 14-15: volumes with nobody named. 16: one
// volume alone. 17: 架空の巨人 4, written 第4巻 (comes later). 18: 架空の巨人
// 3 again, another ISBN (a number twice, comes later).
const RECORDS: [string, Ndl][] = [
  record(1, { title: "架空の巨人", volume: "1", agents: [GIANT], series: LABEL }),
  record(2, { title: "架空の巨人", volume: "2", agents: [GIANT], series: LABEL }),
  record(3, { title: "架空の巨人", volume: "[3]", agents: [GIANT], series: LABEL }),
  record(4, {
    title: "架空の巨人",
    volume: "1",
    edition: "愛蔵版",
    agents: [GIANT],
    series: LABEL,
  }),
  record(5, { title: "架空の巨人", volume: "続", agents: [GIANT], series: LABEL }),
  record(6, { title: "夜の図書館", volume: "上", agents: [NOVELIST] }),
  record(7, { title: "夜の図書館", volume: "下", agents: [NOVELIST] }),
  record(8, { title: "架空年鑑", volume: "2025年版", agents: [NOVELIST] }),
  record(9, { title: "架空年鑑", volume: "2026年版", agents: [NOVELIST] }),
  record(10, { title: "魔法の石", agents: [WIZARD], series: [{ value: "魔法の叢書" }] }),
  record(11, { title: "魔法の部屋", agents: [WIZARD], series: [{ value: "魔法の叢書" }] }),
  record(12, { title: "訳された話", volume: "1", agents: [WRITER] }),
  record(13, { title: "訳された話", volume: "2", agents: [WRITER, TRANSLATOR] }),
  record(14, { title: "名のない本", volume: "1" }),
  record(15, { title: "名のない本", volume: "2" }),
  record(16, { title: "一冊きり", volume: "1", agents: [NOVELIST] }),
];
const LATER: [string, Ndl][] = [
  record(17, { title: "架空の巨人", volume: "第4巻", agents: [GIANT], series: LABEL }),
];
const TWICE: [string, Ndl][] = [
  record(18, { title: "架空の巨人", volume: "3", agents: [GIANT], series: LABEL }),
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

const SERIES_TABLES = new Set([
  "public.series",
  "public.series_lines",
  "public.series_volumes",
  "private.series_runs",
  "private.series_steps",
  "private.series_kept_out",
  "private.series_decisions",
  "private.series_keys",
  "private.series_stale",
  "private.series_last_out",
]);

/** Every other table's rows, to show the series change nothing else. */
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
    .filter((t) => !SERIES_TABLES.has(t) && !SERIES_TABLES.has("public." + t));
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
  await db.exec(PEOPLE);

  const edition = async (n: number) =>
    (await rows<{ id: string }>("select id from editions where isbn = $1", [C(n)]))[0].id;
  const plan = async (mode = "full") =>
    (await rows<{ id: string }>("select private.series_plan($1) as id", [mode]))[0].id;
  const apply = (run: string) => rows("select private.series_apply($1)", [run]);
  const undo = async (run: string) =>
    (await rows<{ r: { undone: number; kept: number } }>("select private.series_undo($1) as r", [
      run,
    ]))[0].r;
  const steps = (run: string) =>
    rows<{ op: string; edition_id: string | null; series_id: string | null }>(
      "select op, edition_id, series_id from private.series_steps where run_id = $1 order by seq",
      [run],
    );
  const volumes = () =>
    rows<{ series_id: string; edition_id: string; line_id: string; number: number; shown: string; decided: string }>(
      `select series_id, edition_id, line_id, number, shown, decided from series_volumes
       order by series_id, line_id, number, edition_id`,
    );
  const seriesOf = async (n: number) =>
    (
      await rows<{ s: string | null }>(
        "select private.series_now(series_id) as s from series_volumes where edition_id = $1",
        [await edition(n)],
      )
    ).map((r) => r.s);
  const read = (visitor: string | null, n: number) =>
    as<{ series_id: string; series_name: string; kind: string; finished: boolean; line_id: string; line_label: string | null; number: number; shown: string; volume_isbn: string; book_id: string; title: string }>(
      visitor,
      "select * from series_for_isbn($1)",
      [C(n)],
    );

  await check(
    "a volume is read only when it is plainly one: 3, 第3巻, [3], Vol. 3, 上 中 下, a year's edition; not 続, 別巻, 1-2, or words",
    async () => {
      const cases: [string, string | null, number | null, string | null][] = [
        ["3", "volumes", 3, "3"],
        ["第3巻", "volumes", 3, "3"],
        ["[3]", "volumes", 3, "3"],
        ["Vol. 3", "volumes", 3, "3"],
        ["巻3", "volumes", 3, "3"],
        ["03", "volumes", 3, "3"],
        ["三", "volumes", 3, "3"],
        ["上", "volumes", 1, "上"],
        ["中巻", "volumes", 2, "中"],
        ["下", "volumes", 3, "下"],
        ["2026年版", "yearly", 2026, "2026年版"],
        ["2026年度", "yearly", 2026, "2026年度"],
        ["続", null, null, null],
        ["別巻1", null, null, null],
        ["1-2", null, null, null],
        ["上下", null, null, null],
        ["総集編", null, null, null],
        ["泥棒かささぎ編", null, null, null],
        ["", null, null, null],
      ];
      for (const [volume, kind, number, shown] of cases) {
        const [got] = await rows("select * from private.series_number($1)", [volume]);
        assert.deepEqual(got, { kind, number, shown }, volume);
      }
    },
  );

  await check(
    "the file plans the first full run and does not apply it; nothing runs at night until a full run is applied",
    async () => {
      assert.match(TEXT, /select private\.series_plan\('full'\);\s*$/);
      const runs = await rows<{ mode: string; applied_at: string | null }>(
        "select mode, applied_at from private.series_runs",
      );
      assert.deepEqual(runs, [{ mode: "full", applied_at: null }]);
      await take(db, RECORDS, "trial");
      assert.deepEqual(await rows("select private.series_nightly() as r"), [{ r: null }]);
      assert.equal(await count("select count(*) from series"), 0);
      const jobs = await rows<{ schedule: string }>(
        "select schedule from cron.job where jobname = 'series-nightly'",
      );
      assert.deepEqual(jobs, [{ schedule: "43 19 * * *" }]);
    },
  );

  // A reader's own book of 架空の巨人 1, read and in their library.
  await as(AKI, "insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, $4, $5)", [
    BOOK(1),
    C(1),
    "架空の巨人 1",
    "架空巨人",
    AKI,
  ]);
  await rows(
    `insert into library_entries (user_id, book_id, status, status_at, source)
     values ($1, $2, 'finished', now(), 'isbn')`,
    [AKI, BOOK(1)],
  );
  await rows("insert into book_marks (user_id, book_id, kind) values ($1, $2, 'finished')", [
    AKI,
    BOOK(1),
  ]);
  const before = await everythingElse(db);
  const readerBooks = await rows(
    "select id, edition_id, work_id, title, updated_at from books where created_by is not null",
  );

  let first = "";
  await check(
    "the rules put together only what is plain: the same title, people, publisher, label and edition words, every number once",
    async () => {
      first = await plan();
      assert.deepEqual(await volumes(), [], "planned, nothing applied");
      const counts = (await rows<{ counts: Record<string, number> }>(
        "select counts from private.series_runs where id = $1",
        [first],
      ))[0].counts;
      assert.equal(counts.series, 3);
      assert.equal(counts.add, 7);
      await apply(first);
      const giant = await seriesOf(1);
      assert.equal(giant.length, 1);
      assert.deepEqual(await seriesOf(2), giant);
      assert.deepEqual(await seriesOf(3), giant);
      // Another edition's words, 続, a translator on one, nobody named, one alone:
      // none of them.
      for (const n of [4, 5, 10, 11, 12, 13, 14, 15, 16])
        assert.deepEqual(await seriesOf(n), [], String(n));
      const night = await read(null, 6);
      assert.deepEqual(
        night.map((v) => [v.number, v.shown, v.kind, v.series_name]),
        [
          [1, "上", "volumes", "夜の図書館"],
          [2, "下", "volumes", "夜の図書館"],
        ],
        "下 is 2 without 中",
      );
      const year = await read(null, 9);
      assert.deepEqual(
        year.map((v) => [v.number, v.shown, v.kind]),
        [
          [2025, "2025年版", "yearly"],
          [2026, "2026年版", "yearly"],
        ],
      );
      const g = await read(null, 2);
      assert.deepEqual(
        g.map((v) => [v.number, v.shown, v.line_label, v.finished]),
        [
          [1, "1", "架空コミックス", false],
          [2, "2", "架空コミックス", false],
          [3, "3", "架空コミックス", false],
        ],
      );
      // The catalog row of each volume, to open and register.
      const [catalogRow] = await rows<{ id: string; title: string }>(
        "select id, title from books where isbn = $1 and source = 'ndl'",
        [C(3)],
      );
      assert.deepEqual([g[2].book_id, g[2].title, g[2].volume_isbn], [catalogRow.id, catalogRow.title, C(3)]);
    },
  );

  await check("nothing a reader keeps, nor any other table, changed", async () => {
    assert.deepEqual(await everythingElse(db), before);
  });

  await check("planning again with nothing new plans nothing, and every id stays", async () => {
    const was = await volumes();
    const again = await plan();
    assert.deepEqual(await steps(again), []);
    await apply(again);
    assert.deepEqual(await volumes(), was);
  });

  await check(
    "what is not plain is a candidate: other edition words, a volume not plainly one, people that differ or nobody, one person's label",
    async () => {
      const found = await rows<{ reason: string; editions: string[] }>(
        "select reason, editions from private.series_candidates() order by reason, editions[1]",
      );
      const byReason = (reason: string) =>
        found.filter((c) => c.reason === reason).map((c) => [...c.editions].sort());
      const sorted = async (...ns: number[]) => (await Promise.all(ns.map(edition))).sort();
      assert.deepEqual(byReason("unclear"), [await sorted(1, 2, 3, 4)]);
      assert.deepEqual(byReason("volume"), [await sorted(5)]);
      const people = byReason("people").map((e) => JSON.stringify(e));
      assert.ok(people.includes(JSON.stringify(await sorted(12, 13))), "a translator on one");
      assert.ok(people.includes(JSON.stringify(await sorted(14, 15))), "nobody named");
      assert.deepEqual(byReason("label"), [await sorted(10, 11)]);
    },
  );

  let giant = "";
  let aizou = "";
  await check(
    "lines are numbered apart: 愛蔵版 1 and 通常版 1 are both 1, in lines of their own, and a reader's mark stays on their own book's edition",
    async () => {
      giant = (await seriesOf(1))[0]!;
      const [{ id }] = await rows<{ id: string }>(
        "select private.series_add_line($1, '愛蔵版') as id",
        [giant],
      );
      aizou = id;
      await rows("select private.series_place($1, $2, 1, null, $3)", [await edition(4), giant, aizou]);
      const lines = await read(AKI, 1);
      const ones = lines.filter((v) => v.number === 1);
      assert.equal(ones.length, 2);
      assert.notEqual(ones[0].line_id, ones[1].line_id);
      assert.deepEqual(
        new Set(ones.map((v) => v.volume_isbn)),
        new Set([C(1), C(4)]),
      );
      // The reader read their book of 1, whose edition is 通常版 1's, not 愛蔵版 1's.
      const [{ ed }] = await rows<{ ed: string }>("select edition_id as ed from books where id = $1", [
        BOOK(1),
      ]);
      assert.equal(ed, await edition(1));
      assert.notEqual(ed, await edition(4));
      assert.deepEqual(await everythingElse(db), before);
    },
  );

  await check(
    "what a person did is kept when the rules run again: an edition placed by hand stays, one taken out is never put back",
    async () => {
      // 一冊きり 1 placed by hand as 架空の巨人 9 (the rules would not); 3 taken out.
      await rows("select private.series_place($1, $2, 9)", [await edition(16), giant]);
      await rows("select private.series_take_out($1, $2)", [await edition(3), giant]);
      const was = await volumes();
      const again = await plan();
      assert.deepEqual(await steps(again), [], "nothing to change");
      await apply(again);
      assert.deepEqual(await volumes(), was);
      assert.deepEqual(await seriesOf(3), []);
      assert.deepEqual(await seriesOf(16), [giant]);
      const decided = await rows<{ decided: string }>(
        "select decided from series_volumes where edition_id = $1",
        [await edition(16)],
      );
      assert.deepEqual(decided, [{ decided: "human" }]);
      // Placing it back by hand undoes the taking out.
      await rows("select private.series_place($1, $2, 3)", [await edition(3), giant]);
      assert.deepEqual(await seriesOf(3), [giant]);
    },
  );

  let nightly = "";
  await check(
    "each night a new volume goes into the series it belongs to, with the same id, as a run written down",
    async () => {
      await take(db, LATER, "later");
      const [{ r }] = await rows<{ r: string }>("select private.series_nightly() as r");
      assert.ok(r);
      nightly = r;
      assert.deepEqual(await seriesOf(17), [giant]);
      const [v] = await rows<{ number: number; shown: string; decided: string }>(
        "select number, shown, decided from series_volumes where edition_id = $1",
        [await edition(17)],
      );
      assert.deepEqual(v, { number: 4, shown: "4", decided: "auto" });
      assert.deepEqual(await rows("select private.series_nightly() as r"), [{ r: null }], "nothing new: no run kept");
    },
  );

  await check(
    "undoing the latest run takes back what it did, and leaves alone what a person changed since",
    async () => {
      const lastFull = (
        await rows<{ id: string }>(
          "select id from private.series_runs where mode = 'full' and applied_at is not null order by applied_at desc limit 1",
        )
      )[0].id;
      await refused(() => undo(lastFull), /undo the later runs first/, "an older run");
      assert.deepEqual(await undo(nightly), { undone: 1, kept: 0 });
      assert.deepEqual(await seriesOf(17), []);
      // Again, then a person moves it before the undo: it stays theirs.
      const [{ r }] = await rows<{ r: string }>("select private.series_nightly() as r");
      await rows("select private.series_place($1, $2, 40)", [await edition(17), giant]);
      assert.deepEqual(await undo(r), { undone: 0, kept: 1 });
      const [v] = await rows<{ number: number; decided: string }>(
        "select number, decided from series_volumes where edition_id = $1",
        [await edition(17)],
      );
      assert.deepEqual(v, { number: 40, decided: "human" });
      await refused(() => undo(r), /no applied run to undo/, "twice");
    },
  );

  await check(
    "a plan is applied all or nothing: if a person changed an edition it moves since, nothing changes",
    async () => {
      await take(db, TWICE, "twice");
      // 18 makes 3 twice in 架空の巨人, so the plan would take the rules' volumes out.
      const run = await plan();
      const planned = await steps(run);
      assert.ok(planned.some((s) => s.op === "remove"));
      const was = await volumes();
      const removed = planned.find((s) => s.op === "remove")!;
      await rows("select private.series_place($1, $2, 77)", [removed.edition_id, giant]);
      const placed = await volumes();
      await refused(() => apply(run), /no longer match; plan again/, "stale");
      assert.deepEqual(await volumes(), placed);
      assert.notDeepEqual(placed, was);
    },
  );

  await check(
    "a number twice makes the rules take their volumes out, never the person's, and undoing puts them back",
    async () => {
      const run = await plan();
      const removed = (await steps(run)).filter((s) => s.op === "remove").length;
      assert.ok(removed >= 1);
      const human = (await volumes()).filter((v) => v.decided === "human");
      await apply(run);
      assert.deepEqual(
        (await volumes()).filter((v) => v.decided === "human"),
        human,
        "the person's volumes stay",
      );
      assert.deepEqual(await seriesOf(2), [], "the rules' 2 is out");
      assert.equal((await undo(run)).undone, removed);
      assert.deepEqual(await seriesOf(2), [giant]);
    },
  );

  await check(
    "two series the rules made, planned again as one, keep the id of the one with more of it (the older, when as many); the other points to it, and undoing parts them",
    async () => {
      // As if older rules had put 夜の図書館 下 in a series of its own.
      const [{ s }] = await rows<{ s: string }>(
        `with r as (insert into private.series_runs (mode, rule, applied_at) values ('full', 'old', now()) returning id),
           x as (insert into series (name, kind, made_by) values ('夜の図書館 下', 'volumes', 'auto') returning id),
           l as (insert into series_lines (series_id) select id from x returning id, series_id)
         select x.id as s from x`,
      );
      // The older rules' run is the latest applied; 下 moves there.
      const [{ l }] = await rows<{ l: string }>("select id as l from series_lines where series_id = $1", [s]);
      const [{ r }] = await rows<{ r: string }>(
        "select id as r from private.series_runs where rule = 'old'",
      );
      const night = (await seriesOf(6))[0]!;
      await rows(
        "update series_volumes set series_id = $1, line_id = $2, run_id = $3 where edition_id = $4",
        [s, l, r, await edition(7)],
      );
      // One each: the older one (夜の図書館's) stays, by age.
      const run = await plan();
      const ops = (await steps(run)).map((x) => x.op);
      assert.deepEqual(ops.filter((o) => o === "move" || o === "retire"), ["move", "retire"]);
      await apply(run);
      assert.deepEqual(await seriesOf(7), [night]);
      const [{ m }] = await rows<{ m: string }>("select merged_into as m from series where id = $1", [s]);
      assert.equal(m, night);
      assert.equal((await rows<{ n: string }>("select private.series_now($1) as n", [s]))[0].n, night);
      await undo(run);
      const [{ m: after }] = await rows<{ m: string | null }>(
        "select merged_into as m from series where id = $1",
        [s],
      );
      assert.equal(after, null);
      assert.deepEqual(await seriesOf(7), [s]);
    },
  );

  await check("joining two series by hand moves their lines and volumes, as the person's", async () => {
    const night = (await seriesOf(6))[0]!;
    const other = (await seriesOf(7))[0]!;
    await rows("select private.series_join($1, $2)", [night, other]);
    assert.deepEqual(await seriesOf(7), [night]);
    const [{ decided }] = await rows<{ decided: string }>(
      "select decided from series_volumes where edition_id = $1",
      [await edition(7)],
    );
    assert.equal(decided, "human");
    assert.equal(await count("select count(*) from series_lines where series_id = $1", [other]), 0);
    await refused(
      () => rows("select private.series_join($1, $1)", [night]),
      /the same series/,
      "itself",
    );
  });

  await check(
    "a series the rules emptied keeps its id when its volumes come back",
    async () => {
      // 3 twice: the rules take 架空の巨人's 1 and 2 out; then the extra 3 is fixed to 5.
      await apply(await plan());
      assert.deepEqual(await seriesOf(2), []);
      await rows(
        `insert into private.edition_fixes (edition_id, field, value) values ($1, 'volume', '"5"')`,
        [await edition(18)],
      );
      const run = await plan();
      await apply(run);
      assert.deepEqual(await seriesOf(1), [giant]);
      assert.deepEqual(await seriesOf(2), [giant]);
      assert.deepEqual(await seriesOf(18), [giant]);
    },
  );

  await check(
    "after a person joins series, a run from before is not applied, undoing an older run leaves the joined volumes alone, and what a person took out stays out",
    async () => {
      // Two series made by hand, then joined.
      const [{ a }] = await rows<{ a: string }>("select private.series_make('甲') as a");
      const [{ b }] = await rows<{ b: string }>("select private.series_make('乙') as b");
      await rows("select private.series_place($1, $2, 1)", [await edition(14), b]);
      await rows("select private.series_take_out($1, $2)", [await edition(14), a]);
      await rows("select private.series_join($1, $2)", [a, b]);
      assert.deepEqual(await seriesOf(14), [], "taken out of the one that stays, it stays out");
      // A run planned, then a join of a series it adds to: refused, nothing applied.
      await take(
        db,
        [
          record(23, { title: "昼の図書館", volume: "1", agents: [NOVELIST] }),
          record(24, { title: "昼の図書館", volume: "2", agents: [NOVELIST] }),
        ],
        "noon",
      );
      const first = await plan();
      await apply(first);
      const noon = (await seriesOf(23))[0]!;
      await rows("select private.series_take_out($1, $2)", [await edition(24), noon]);
      await rows("select private.series_place($1, $2, 2)", [await edition(24), noon]);
      await rows("select private.series_join($1, $2)", [a, noon]);
      const was = await volumes();
      assert.deepEqual(await undo(first), { undone: 0, kept: 2 });
      assert.deepEqual(await volumes(), was);
    },
  );

  await check(
    "what the rules read is kept and read again when the bibliography changes; a night's run reads only the titles of what is new",
    async () => {
      const keyOf = async (n: number) =>
        (
          await rows<{ number: number | null; kind: string | null }>(
            "select number, kind from private.series_keys where edition_id = $1",
            [await edition(n)],
          )
        )[0];
      assert.deepEqual(await keyOf(16), { number: 1, kind: "volumes" });
      // The operator corrects 一冊きり's volume: read again within the minute's job.
      await rows(
        `insert into private.edition_fixes (edition_id, field, value) values ($1, 'volume', '"続"')`,
        [await edition(16)],
      );
      assert.equal(await count("select count(*) from private.series_stale where edition_id = $1", [await edition(16)]), 1);
      await rows("select private.series_read(500)");
      assert.deepEqual(await keyOf(16), { number: null, kind: null });
      // 朝の図書館 上 and 下 come one night, 中 the next.
      await take(
        db,
        [
          record(20, { title: "朝の図書館", volume: "上", agents: [NOVELIST] }),
          record(21, { title: "朝の図書館", volume: "下", agents: [NOVELIST] }),
        ],
        "night",
      );
      const [{ r }] = await rows<{ r: string }>("select private.series_nightly() as r");
      const [{ counts }] = await rows<{ counts: Record<string, number> }>(
        "select counts from private.series_runs where id = $1",
        [r],
      );
      // Its title's editions, and those of titles read in the ten minutes before
      // the last run (昼の図書館), not every title.
      assert.deepEqual([counts.seen, counts.series, counts.add], [4, 1, 2]);
      assert.ok(
        counts.seen < (await count("select count(*) from private.series_keys where kind is not null")),
      );
      await take(db, [record(22, { title: "朝の図書館", volume: "中", agents: [NOVELIST] })], "night");
      // 中 makes 下 3: a night's run changes nothing, the next full one does.
      assert.deepEqual(await rows("select private.series_nightly() as r"), [{ r: null }]);
      const full = await plan();
      const morning = await Promise.all([20, 21, 22].map(edition));
      assert.deepEqual(
        (await steps(full))
          .filter((x) => morning.includes(x.edition_id!))
          .map((x) => [x.op, x.edition_id]),
        [
          ["add", await edition(22)],
          ["move", await edition(21)],
        ],
      );
      await apply(full);
      assert.deepEqual(
        (await read(null, 20)).map((v) => [v.number, v.shown]),
        [
          [1, "上"],
          [2, "中"],
          [3, "下"],
        ],
      );
    },
  );

  await check("the operator says when a series is done; the bibliography never does", async () => {
    assert.equal((await read(null, 1))[0].finished, false);
    await rows("select private.series_finish($1, true)", [giant]);
    assert.equal((await read(null, 1))[0].finished, true);
    await rows("select private.series_finish($1, false)", [giant]);
    assert.equal((await read(null, 1))[0].finished, false);
  });

  await check(
    "anyone reads a series by an ISBN, of editions with a catalog row only; nobody reaches the tables or the tools",
    async () => {
      assert.ok((await read(null, 1)).length > 0);
      assert.ok((await read(AKI, 1)).length > 0);
      assert.deepEqual(await read(null, 99), []);
      for (const visitor of [null, AKI]) {
        for (const table of ["series", "series_lines", "series_volumes"])
          await refused(() => as(visitor, `select * from ${table}`), /permission denied/, table);
        for (const call of [
          "select private.series_plan('full')",
          "select private.series_candidates()",
          "select * from private.bib_providers",
        ])
          await refused(() => as(visitor, call), /permission denied/, call);
      }
    },
  );

  await check(
    "the sources are a table: the master takes the library's first, and a source not in it is refused",
    async () => {
      assert.deepEqual(
        await rows("select source, rank from private.bib_providers order by rank"),
        [
          { source: "ndl", rank: 1 },
          { source: "openbd", rank: 2 },
        ],
      );
      await refused(
        () =>
          rows("insert into private.edition_sources (edition_id, source) values ($1, 'amazon')", [
            BOOK(1),
          ]),
        /foreign key|violates/,
        "amazon",
      );
    },
  );

  await check("nothing a reader keeps changed through all of it", async () => {
    // More catalog rows came since, so the books are compared reader by reader.
    const now = await everythingElse(db);
    for (const t of ["public.library_entries", "public.book_marks", "public.profiles"])
      assert.equal(now[t], before[t], t);
    assert.deepEqual(
      await rows("select id, edition_id, work_id, title, updated_at from books where created_by is not null"),
      readerBooks,
    );
  });

  await check("the rollback in the file's head undoes it", async () => {
    const was = await migrated(FILE);
    // Up to this file, not the later ones (people), which the head does not undo.
    const undone = await migrated(FILES[FILES.indexOf(FILE!) + 1]);
    const head = TEXT.slice(TEXT.indexOf("-- Rollback:"), TEXT.indexOf("\n\n", TEXT.indexOf("-- Rollback:")));
    const statements = head
      .split("\n")
      .filter((line) => line.startsWith("--   "))
      .map((line) => line.slice(5))
      .join("\n");
    const holds = migrationText(FILES.find((f) => f.endsWith("_bibliography_holds.sql"))!);
    const start = holds.indexOf("create or replace function private.edition_bibliography(");
    const stop = holds.indexOf(";\n", holds.indexOf("revoke all on function private.edition_bibliography", start)) + 2;
    await undone.exec(holds.slice(start, stop));
    await undone.exec(statements);
    assert.deepEqual(await catalog(undone), await catalog(was));
  });

  console.log(`${passed} series checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
