import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { PGlite } from "@electric-sql/pglite";
import {
  pgliteTarget,
  recordsOf,
  rowsOf,
  type CatalogRow,
} from "../scripts/catalog-import";
import { databaseSearch } from "../src/lib/search";
import {
  answerAll,
  catalog,
  helpers,
  migrated,
  ndlRecord,
  numbered,
  sru,
  type Ndl,
  type Visitor,
} from "./fixtures/bibliography";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";

// The library's catalog (item 5 of the plan;
// supabase/migrations/*_library_catalog.sql, scripts/catalog-import.ts):
// the library's records are read as its answers are; each ISBN becomes one
// catalog row, with its edition and work, and the library's answer kept, so
// nothing is asked about it; anyone finds it and reads its bibliography; a
// reader's book of the ISBN shares its edition and shows the bibliography
// at once; two records of one ISBN are chosen between the same way in any
// order; taking the same again changes nothing; the cap; a batch and a
// deleted record take out only rows no reader uses; a registered book's
// bibliography becomes a catalog row once judged, without the words its
// reader typed; the ISBNs searched for and not found; who may call what;
// and undoing the file.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_library_catalog.sql"));
assert.ok(FILE, "the catalog migration");
const TEXT = migrationText(FILE);
const UNCAPPED = FILES.find((file) => file.endsWith("_catalog_registered_uncapped.sql")) ?? "";
assert.ok(UNCAPPED, "the migration that leaves registered books out of the cap");
const QUALIFIERS = FILES.find((file) => file.endsWith("_authority_qualifiers.sql")) ?? "";
assert.ok(QUALIFIERS, "the migration that leaves out what the authority writes after a name");
const TRADES = FILES.find((file) => file.endsWith("_authority_trades.sql")) ?? "";
assert.ok(TRADES, "the migration that leaves out a trade after a single name");
const CREDITS = FILES.find((file) => file.endsWith("_credit_names.sql")) ?? "";
assert.ok(CREDITS, "the migration that leaves out what a statement writes after a name");
const ROLES = FILES.find((file) => file.endsWith("_credit_roles.sql")) ?? "";
assert.ok(ROLES, "the migration that leaves out ほか in front of a role, and statements in another order");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const PEOPLE = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
`;
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C = (n: number) => numbered(700 + n);

/** The statements of a migration's rollback, as its header writes them. */
function rollbackStatements(text: string): string {
  const head = text.slice(0, text.indexOf("\n\n", text.indexOf("-- Rollback:")));
  return head
    .slice(head.indexOf("-- Rollback:"), head.indexOf("-- and then makes"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
}

/** A function as the file ending so made it, with its revoke and grants, to make it again. */
function made(file: string, name: string): string {
  const text = migrationText(FILES.find((f) => f.endsWith(file))!);
  const start = [`create function ${name}(`, `create or replace function ${name}(`]
    .map((head) => text.indexOf(head))
    .find((at) => at >= 0);
  assert.ok(start !== undefined, name);
  let stop = text.indexOf("\n$$;\n", start) + 5;
  // Its revoke and grants, when they follow it.
  while (/^(revoke|grant) /.test(text.slice(stop))) {
    const next = text.indexOf(";\n", stop) + 2;
    if (!text.slice(stop, next).includes(name)) break;
    stop = next;
  }
  return text.slice(start, stop).replace(/^create function/, "create or replace function");
}

const rollbackSql = () =>
  [
    rollbackStatements(TEXT),
    made("_bibliography_fetching.sql", "private.book_checked"),
    made("_bibliography.sql", "private.edition_asked"),
    made("_bibliography_holds.sql", "public.book_bibliography"),
    made("_bibliography_holds.sql", "private.work_candidates"),
    made("_seen_in_one_question.sql", "private.newest_book_ids"),
    made("_seen_in_one_question.sql", "private.found_book_ids"),
  ].join("\n");

/** A record as OAI-PMH gives it: its header, then the rdf:RDF the SRU answer has. */
function oaiRecord(record: string, sets: string[], ndl: Ndl | null): string {
  const header = `<header${ndl ? "" : ' status="deleted"'}><identifier>oai:ndlsearch.ndl.go.jp:${record}</identifier><datestamp>2026-10-18T00:00:00Z</datestamp>${sets
    .map((set) => `<setSpec>${set}</setSpec>`)
    .join("")}</header>`;
  const rdf = ndl ? /<rdf:RDF[\s\S]*<\/rdf:RDF>/.exec(ndlRecord(ndl))![0] : "";
  return `<record>${header}${ndl ? `<metadata>${rdf}</metadata>` : ""}</record>`;
}
const listRecords = (records: string[], token?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><OAI-PMH><ListRecords>${records.join("")}${
    token ? `<resumptionToken completeListSize="9">${token}</resumptionToken>` : ""
  }</ListRecords></OAI-PMH>`;

/** A catalog row as the importer would send it. */
async function rowsFor(db: PGlite, records: [string, Ndl][]): Promise<CatalogRow[]> {
  return rowsOf(db, recordsOf(listRecords(
    records.map(([record, ndl]) => oaiRecord(record, ["iss-ndl-opac"], ndl)),
  )).records);
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "the library's records are read as its answers: each ISBN of one of its own records, not a deleted one, another provider's, or one without an ISBN",
    async () => {
      const db = await migrated();
      const read = recordsOf(
        listRecords(
          [
            oaiRecord("R100000002-I1", ["iss-ndl-opac"], {
              bibId: "1",
              isbns: [C(1), C(2)],
              title: "架空の上下",
              agents: [{ name: "山田, 一郎" }],
              publisher: "架空書房",
              issued: "2026-09",
            }),
            oaiRecord("R100000002-I2", ["iss-ndl-opac"], null),
            oaiRecord("R100000001-I3", ["iss-other"], {
              isbns: [C(3)],
              title: "ほかの図書館の本",
            }),
            oaiRecord("R100000002-I4", ["iss-ndl-opac-inprocess"], {
              isbns: [],
              title: "ISBN のない本",
            }),
          ],
          "next-page",
        ),
      );
      assert.equal(read.token, "next-page");
      assert.equal(read.size, 9);
      assert.deepEqual(
        read.records.map((r) => [r.id, r.deleted]),
        [
          ["R100000002-I1", false],
          ["R100000002-I2", true],
          ["R100000001-I3", false],
          ["R100000002-I4", false],
        ],
      );
      const rows = await rowsOf(db, read.records);
      assert.deepEqual(
        rows.map((r) => [r.isbn, r.record, r.status, r.isbns, r.fields.title]),
        [
          [C(1), "R100000002-I1", "C7", 2, "架空の上下"],
          [C(2), "R100000002-I1", "C7", 2, "架空の上下"],
        ],
      );
      await db.close();
    },
  );

  const db = await migrated();
  const { rows, as, count, register, tick, later, questions, shown, refused } =
    helpers(db);
  const target = pgliteTarget(db);
  await db.exec(PEOPLE);
  const find = async (visitor: Visitor, query: string) => {
    const ask = databaseSearch(query)!;
    const [{ found }] = await as<{ found: { id: string; title: string }[] }>(
      visitor,
      "select find_books($1::jsonb, $2, $3, $4) as found",
      [JSON.stringify(ask.forms), ask.isbn, ask.isbnStart, 50],
    );
    return found;
  };
  const catalogRow = async (isbnOf: string) =>
    (
      await rows<{ id: string; title: string; author: string; publisher: string }>(
        "select id, title, author, publisher from books where isbn = $1 and source = 'ndl'",
        [isbnOf],
      )
    )[0];

  const first = await rowsFor(db, [
    [
      "R100000002-I10",
      {
        bibId: "10",
        isbns: [C(10)],
        title: "灯台守の目録",
        volume: "上",
        agents: [{ name: "灯野, 守" }],
        publisher: "架空書房",
        issued: "2026-08",
      },
    ],
    ["R100000002-I11", { bibId: "11", isbns: [C(11)], title: "港の目録" }],
  ]);

  await check(
    "each ISBN taken is a catalog row with nobody's name, its edition and work, and the library's answer kept: nothing is asked about it",
    async () => {
      assert.deepEqual(await target.take(first, "trial"), {
        added: 2,
        changed: 0,
        kept: 0,
        refused: 0,
        wrong: 0,
      });
      const row = await catalogRow(C(10));
      assert.deepEqual(
        { ...row, id: undefined },
        { id: undefined, title: "灯台守の目録 上", author: "灯野守", publisher: "架空書房" },
      );
      assert.deepEqual(
        await rows(
          `select b.created_by, b.edition_id is not null as edition, b.work_id is not null as work,
             i.batch, i.record
           from books b join private.catalog_imports i on i.book_id = b.id where b.id = $1`,
          [row.id],
        ),
        [{ created_by: null, edition: true, work: true, batch: "trial", record: "R100000002-I10" }],
      );
      assert.deepEqual(
        await rows(
          `select s.source, s.state = 'found' as found, s.next_at::text as next_at
           from private.edition_sources s join editions e on e.id = s.edition_id
           where e.isbn = $1 order by s.source`,
          [C(10)],
        ),
        [
          { source: "ndl", found: true, next_at: "infinity" },
          { source: "openbd", found: false, next_at: "infinity" },
        ],
      );
      await tick();
      await later(30);
      await tick();
      assert.deepEqual(await questions(), []);
      assert.equal(
        await count("select count(*) from private.catalog_settings where taken = 2"),
        1,
      );
    },
  );

  await check(
    "anyone finds a catalog row by its title, its author or its ISBN, and reads its bibliography",
    async () => {
      const row = await catalogRow(C(10));
      for (const visitor of [null, AKI]) {
        for (const query of ["灯台守の目録", "灯野", C(10)])
          assert.ok(
            (await find(visitor, query)).some((b) => b.id === row.id),
            `${visitor} ${query}`,
          );
        const [bib] = await shown(visitor, [row.id]);
        assert.equal(bib?.title, "灯台守の目録");
      }
    },
  );

  await check(
    "a catalog row is not one of the town's newest books",
    async () => {
      const [{ ids }] = await as<{ ids: string[] }>(
        null,
        "select private.newest_book_ids(1000) as ids",
      );
      const row = await catalogRow(C(10));
      assert.ok(!ids.includes(row.id));
    },
  );

  await check(
    "a reader's book of a catalog ISBN shares its edition and work, shows the library's bibliography at the next tick, and openBD alone is asked",
    async () => {
      const row = await catalogRow(C(10));
      await register(AKI, id(1), C(10), "灯台守の目録", "灯野守");
      assert.deepEqual(
        await rows(
          "select edition_id, work_id from books where id = $1",
          [id(1)],
        ),
        await rows("select edition_id, work_id from books where id = $1", [row.id]),
      );
      await tick();
      const asked = (await questions()).map((q) => new URL(q.url).host);
      assert.deepEqual(asked, ["api.openbd.jp"]);
      const [bib] = await shown(AKI, [id(1)]);
      assert.equal(bib?.title, "灯台守の目録");
      await answerAll(db, {}, {});
      await tick();
    },
  );

  await check(
    "two records of one ISBN: the one kept is the same in either order (finished before in the making, then fewer ISBNs, the later issued)",
    async () => {
      const making = await rowsFor(db, [
        ["R100000002-I21", { bibId: "21", status: "C3", isbns: [C(20)], title: "作成中の版", issued: "2026-10" }],
      ]);
      const finished = await rowsFor(db, [
        ["R100000002-I20", { bibId: "20", isbns: [C(20)], title: "完成した版", issued: "2025-01" }],
      ]);
      const set = await rowsFor(db, [
        ["R100000002-I22", { bibId: "22", isbns: [C(30), C(31)], title: "揃いの版" }],
      ]);
      const volume = await rowsFor(db, [
        ["R100000002-I23", { bibId: "23", isbns: [C(30)], title: "一冊の版" }],
      ]);
      await target.take(making, "trial");
      await target.take(finished, "trial");
      await target.take(finished, "trial");
      await target.take(making, "trial");
      assert.equal((await catalogRow(C(20))).title, "完成した版");
      await target.take(volume, "trial");
      await target.take(set, "trial");
      assert.equal((await catalogRow(C(30))).title, "一冊の版");
      assert.equal((await catalogRow(C(31))).title, "揃いの版");
    },
  );

  await check(
    "taking the same records again changes nothing; a record that changed is taken",
    async () => {
      const before = await rows(
        "select b.id, b.updated_at::text, i.changed_at::text from books b join private.catalog_imports i on i.book_id = b.id order by b.id",
      );
      assert.deepEqual(await target.take(first, "trial"), {
        added: 0,
        changed: 0,
        kept: 2,
        refused: 0,
        wrong: 0,
      });
      assert.deepEqual(
        await rows(
          "select b.id, b.updated_at::text, i.changed_at::text from books b join private.catalog_imports i on i.book_id = b.id order by b.id",
        ),
        before,
      );
      const renamed = await rowsFor(db, [
        ["R100000002-I11", { bibId: "11", isbns: [C(11)], title: "港の目録 新版" }],
      ]);
      assert.equal((await target.take(renamed, "daily")).changed, 1);
      assert.equal((await catalogRow(C(11))).title, "港の目録 新版");
    },
  );

  await check(
    "no more rows come in than the cap; what is wrong is counted, not taken",
    async () => {
      const taken = await count("select taken from private.catalog_settings");
      await rows("update private.catalog_settings set most = $1", [taken + 1]);
      const more = await rowsFor(db, [
        ["R100000002-I40", { bibId: "40", isbns: [C(40)], title: "四十" }],
        ["R100000002-I41", { bibId: "41", isbns: [C(41)], title: "四十一" }],
      ]);
      const wrong = [{ isbn: "1234", record: "R1", status: null, isbns: 1, fields: { title: "x" } }];
      assert.deepEqual(await target.take([...more, ...wrong], "trial"), {
        added: 1,
        changed: 0,
        kept: 0,
        refused: 1,
        wrong: 1,
      });
      await rows("update private.catalog_settings set most = 10000");
    },
  );

  await check(
    "a batch or a record the library deleted takes out only the rows no reader uses",
    async () => {
      const used = await catalogRow(C(11));
      await as(AKI, "insert into posts (author_id, body, book_id) values ($1, '港で読んだ', $2)", [
        AKI,
        used.id,
      ]);
      // One the operator moved to another work: the record of it stays.
      const moved = await catalogRow(C(20));
      await rows(
        `insert into private.work_changes (book_id, from_work, to_work, kind)
         select id, work_id, work_id, 'edited' from books where id = $1`,
        [moved.id],
      );
      const gone = await rowsFor(db, [
        ["R100000002-I50", { bibId: "50", isbns: [C(50)], title: "消える本" }],
      ]);
      await target.take(gone, "files-20261003");
      assert.equal(await target.gone(["R100000002-I50", "R100000002-I11"]), 1);
      assert.equal(await catalogRow(C(50)), undefined);
      assert.ok(await catalogRow(C(11)));
      const left = await count("select count(*) from private.catalog_imports where batch = 'trial'");
      assert.equal(await count("select private.catalog_drop('trial')"), left - 2);
      // The rows Aki's post and the operator's move name stay, and so does
      // every reader's book.
      assert.ok(await catalogRow(C(11)));
      assert.ok(await catalogRow(C(20)));
      assert.equal(await catalogRow(C(10)), undefined);
      assert.ok((await rows("select 1 from books where id = $1", [id(1)])).length);
      assert.equal(
        await count("select taken from private.catalog_settings"),
        await count("select count(*) from private.catalog_imports where batch <> 'registered'"),
      );
    },
  );

  await check(
    "a registered book's bibliography becomes a catalog row once it is judged, found by the bibliography's words, not its reader's",
    async () => {
      const minute = "select private.catalog_promote(200, interval '10 minutes')";
      await register(BEN, id(2), C(60), "ベンの打った題名", "ベンの打った著者");
      await tick();
      await answerAll(db, { [C(60)]: sru({ isbns: [C(60)], title: "図書館の題名", agents: [{ name: "図書, 館" }] }) }, {});
      await tick();
      // Answered, but not yet judged (ten minutes after it was placed): the
      // night's run takes only Aki's, of the trial's row taken out above.
      assert.equal(await count("select private.catalog_promote()"), 1);
      assert.equal(await catalogRow(C(60)), undefined);
      await later(11);
      await tick();
      // Judged: the minute's run takes Ben's.
      assert.equal(await count(minute), 1);
      assert.equal(await count(minute), 0);
      assert.equal(await count("select private.catalog_promote()"), 0);
      assert.equal((await catalogRow(C(10))).title, "灯台守の目録 上");
      const row = await catalogRow(C(60));
      assert.deepEqual(
        { title: row.title, author: row.author },
        { title: "図書館の題名", author: "図書館" },
      );
      assert.deepEqual(
        await rows("select batch, record from private.catalog_imports where book_id = $1", [row.id]),
        [{ batch: "registered", record: null }],
      );
      for (const visitor of [null, AKI]) {
        assert.ok((await find(visitor, "図書館の題名")).some((b) => b.id === row.id));
        assert.deepEqual(await find(visitor, "ベンの打った題名"), []);
        const [bib] = await shown(visitor, [row.id]);
        assert.equal(bib?.title, "図書館の題名");
      }
      assert.ok(!JSON.stringify(await find(null, C(60))).includes("ベン"));
    },
  );

  await check(
    "a registered book comes into the catalog with the cap full, and is not counted against it; the library's records still stop at the cap (AUD-162)",
    async () => {
      const taken = await count("select taken from private.catalog_settings");
      await rows("update private.catalog_settings set most = taken");
      await register(BEN, id(3), C(61), "ベンの二冊目", "ベン");
      await tick();
      await answerAll(db, { [C(61)]: sru({ isbns: [C(61)], title: "満ちた目録の本" }) }, {});
      await tick();
      await later(11);
      await tick();
      assert.equal(await count("select private.catalog_promote(200, interval '10 minutes')"), 1);
      assert.equal((await catalogRow(C(61))).title, "満ちた目録の本");
      assert.equal(await count("select taken from private.catalog_settings"), taken);
      const more = await rowsFor(db, [["R100000002-I62", { bibId: "62", isbns: [C(62)], title: "入らない本" }]]);
      assert.equal((await target.take(more, "daily")).refused, 1);
      assert.equal(await catalogRow(C(62)), undefined);
      // Taking a batch out counts the library's rows alone.
      assert.equal(await count("select private.catalog_drop('none')"), 0);
      assert.equal(await count("select taken from private.catalog_settings"), taken);
      await rows("update private.catalog_settings set most = 10000");
    },
  );

  await check(
    "an ISBN searched for and not found is counted by day, with nothing else; one that is not an ISBN, or is in the catalog, is not",
    async () => {
      for (const visitor of [null, AKI, AKI])
        await as(visitor, "select note_missing_isbn($1)", [C(70)]);
      await as(null, "select note_missing_isbn($1)", ["978123"]);
      await as(null, "select note_missing_isbn($1)", [C(11)]);
      assert.deepEqual(
        await rows("select isbn, times, day = current_date as today from private.missing_isbns"),
        [{ isbn: C(70), times: 3, today: true }],
      );
      await rows("update private.missing_isbns set day = current_date - 91");
      await rows("select private.catalog_nightly()");
      assert.deepEqual(await rows("select * from private.missing_isbns"), []);
    },
  );

  await check(
    "readers and visitors call note_missing_isbn alone; nobody reaches the catalog's tables or its other functions",
    async () => {
      assert.deepEqual(
        await rows(
          `select p.proname as name,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authed,
             p.proconfig as config
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private')
             and (p.proname like 'catalog\\_%' or p.proname = 'note_missing_isbn')
           order by 1`,
        ),
        [
          "catalog_better",
          "catalog_drop",
          "catalog_gone",
          "catalog_nightly",
          "catalog_promote",
          "catalog_take",
          "catalog_used",
          "catalog_words",
          "note_missing_isbn",
        ].map((name) => ({
          name,
          anon: name === "note_missing_isbn",
          authed: name === "note_missing_isbn",
          config: ['search_path=""'],
        })),
      );
      for (const table of ["catalog_imports", "catalog_progress", "catalog_settings", "missing_isbns"])
        for (const visitor of [null, AKI])
          await refused(
            () => as(visitor, `select * from private.${table}`),
            /permission denied/,
            `${visitor} ${table}`,
          );
      assert.deepEqual(
        await rows("select jobname, schedule, command from cron.job where jobname like 'catalog-%' order by 1"),
        [
          { jobname: "catalog-nightly", schedule: "13 19 * * *", command: "select private.catalog_nightly()" },
          {
            jobname: "catalog-promote",
            schedule: "* * * * *",
            command: "select private.catalog_promote(200, interval '10 minutes')",
          },
        ],
      );
    },
  );
  await db.close();

  await check(
    "a search's time does not grow with the catalog: near titles weigh a bounded number of books",
    async () => {
      // Catalog rows that all share pairs with the query, and none holds all
      // of them: every book is a near title.
      const timed = async (rowsIn: number) => {
        const many = await migrated();
        await many.exec(`
          select set_config('private.importing', 'on', false);
          insert into books (isbn, title, author, source)
            select null, '灯台の目録 第' || k || '号', '灯野', 'ndl'
            from generate_series(1, ${rowsIn}) k;
          select set_config('private.importing', '', false);
          analyze;
        `);
        const ask = databaseSearch("灯台の目録の話")!;
        let best = Infinity;
        for (let round = 0; round < 3; round += 1) {
          const started = performance.now();
          const { rows: found } = await many.query<{ n: number }>(
            "select jsonb_array_length(find_books($1::jsonb, null, null, 100)) as n",
            [JSON.stringify(ask.forms)],
          );
          best = Math.min(best, performance.now() - started);
          assert.equal(found[0].n, 100);
        }
        await many.close();
        return best;
      };
      const few = await timed(2500);
      const most = await timed(20000);
      console.log(
        `  a near title among 2,500 and 20,000 catalog rows: ${few.toFixed(0)}ms, ${most.toFixed(0)}ms (PGlite)`,
      );
      assert.ok(most <= few * 2 + 100, `${most.toFixed(0)}ms with 20,000, ${few.toFixed(0)}ms with 2,500`);
    },
  );

  await check(
    "the rollback in the header leaves the database as it was before",
    async () => {
      const db = await migrated(FILE);
      const before = await catalog(db);
      await db.exec(TEXT);
      assert.notDeepEqual(await catalog(db), before);
      await db.exec(rollbackSql());
      assert.deepEqual(await catalog(db), before);
      await db.close();
    },
  );

  await check(
    "the rollback in the header of the uncapped promotion leaves the database as it was before",
    async () => {
      const db = await migrated(UNCAPPED);
      const before = await catalog(db);
      await db.exec(migrationText(UNCAPPED));
      assert.notDeepEqual(await catalog(db), before);
      await db.exec(
        [
          made("_library_catalog.sql", "private.catalog_promote"),
          made("_library_catalog.sql", "private.catalog_drop"),
          made("_library_catalog.sql", "private.catalog_gone"),
          rollbackStatements(migrationText(UNCAPPED)),
        ].join("\n"),
      );
      assert.deepEqual(await catalog(db), before);
      await db.close();
    },
  );

  await check(
    "the names kept before AUD-163 are made again: the answers', the catalog rows', and their readers' books are judged again",
    async () => {
      const db = await migrated(QUALIFIERS);
      const { rows, register } = helpers(db);
      await db.exec(PEOPLE);
      const taken = await rowsFor(db, [
        [
          "R100000002-I80",
          {
            bibId: "80",
            isbns: [C(80)],
            title: "霞の目録",
            agents: [{ name: "藤野, 霞, -2026", reading: "フジノ, カスミ, -2026" }, { name: "海野, 波子" }],
          },
        ],
        ["R100000002-I81", { bibId: "81", isbns: [C(81)], title: "波の目録", agents: [{ name: "海野, 波子" }] }],
      ]);
      await pgliteTarget(db).take(taken, "trial");
      await register(BEN, id(80), C(80), "霞の目録", "藤野霞");
      const author = async (isbnOf: string) =>
        (await rows<{ author: string }>("select author from books where isbn = $1 and source = 'ndl'", [isbnOf]))[0]
          .author;
      assert.equal(await author(C(80)), "藤野, 霞, -2026、海野波子");
      await rows("delete from private.book_rechecks");
      const others = await rows("select * from books where isbn <> $1 order by id", [C(80)]);
      await db.exec(migrationText(QUALIFIERS));
      assert.equal(await author(C(80)), "藤野霞、海野波子");
      assert.deepEqual(
        await rows(
          `select c ->> 'name' as name, c ->> 'reading' as reading
           from private.edition_sources s join books b on b.edition_id = s.edition_id,
             jsonb_array_elements(s.fields -> 'creators') c
           where b.id = $1 and s.source = 'ndl'`,
          [id(80)],
        ),
        [
          { name: "藤野霞", reading: "フジノ カスミ" },
          { name: "海野波子", reading: null },
        ],
      );
      // Ben's book is judged again; the catalog row stays judged.
      assert.deepEqual(await rows("select book_id from private.book_rechecks"), [{ book_id: id(80) }]);
      assert.deepEqual(
        await rows(
          `select c.verdict, c.checked_at is not null as checked from private.book_checks c
           join books b on b.id = c.book_id where b.isbn = $1 and b.source = 'ndl'`,
          [C(80)],
        ),
        [{ verdict: "same", checked: true }],
      );
      // Nothing else changed.
      assert.deepEqual(await rows("select * from books where isbn <> $1 order by id", [C(80)]), others);
      // Copied first, and compared after (check_copy stops the file on a loss).
      assert.deepEqual(await rows("select source from keep.copies where label = $1 order by 1", [
        QUALIFIERS.replace(/^.*\//, "").replace(/\.sql$/, ""),
      ]), [
        { source: "private.book_checks" },
        { source: "private.book_grams" },
        { source: "private.edition_sources" },
        { source: "public.books" },
      ]);
      await db.close();
    },
  );

  await check(
    "the names kept before AUD-167 are made again: years in front of a single name, a trade after one, and their readings",
    async () => {
      // The names as the first rule made them, then 20261125000000.
      const db = await migrated(QUALIFIERS);
      const { rows, register } = helpers(db);
      await db.exec(PEOPLE);
      const taken = await rowsFor(db, [
        [
          "R100000002-I82",
          {
            bibId: "82",
            isbns: [C(82)],
            title: "陽だまりの目録",
            agents: [
              { name: "こもれび, pub. 2026", reading: "コモレビ, pub. 2026" },
              { name: "ひだまり, 漫画家", reading: "ヒダマリ, マンガカ" },
              { name: "KEI, 漫画家", reading: "KEI, マンガカ" },
              { name: "海野, 波子", reading: "ウミノ, ナミコ" },
            ],
          },
        ],
        ["R100000002-I83", { bibId: "83", isbns: [C(83)], title: "波の目録", agents: [{ name: "海野, 波子" }] }],
      ]);
      await pgliteTarget(db).take(taken, "trial");
      await register(BEN, id(82), C(82), "陽だまりの目録", "ひだまり");
      await db.exec(migrationText(QUALIFIERS));
      const author = async (isbnOf: string) =>
        (await rows<{ author: string }>("select author from books where isbn = $1 and source = 'ndl'", [isbnOf]))[0]
          .author;
      const people = () =>
        rows(
          `select c ->> 'name' as name, c ->> 'reading' as reading
           from private.edition_sources s join books b on b.edition_id = s.edition_id,
             jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
           where b.id = $1 and s.source = 'ndl' order by n`,
          [id(82)],
        );
      const otherSources = () =>
        rows(
          `select s::text from private.edition_sources s
           where edition_id <> (select edition_id from books where id = $1) order by 1`,
          [id(82)],
        );
      assert.equal(await author(C(82)), "pub. 2026 こもれび、ひだまり漫画家、漫画家 KEI、海野波子");
      assert.deepEqual(await people(), [
        { name: "pub. 2026 こもれび", reading: "pub. 2026 コモレビ" },
        { name: "ひだまり漫画家", reading: "ヒダマリ マンガカ" },
        { name: "漫画家 KEI", reading: "マンガカ KEI" },
        { name: "海野波子", reading: "ウミノ ナミコ" },
      ]);
      await rows("delete from private.book_rechecks");
      const others = await rows("select * from books where isbn <> $1 order by id", [C(82)]);
      const sources = await otherSources();
      await db.exec(migrationText(TRADES));
      assert.equal(await author(C(82)), "こもれび、ひだまり、KEI、海野波子");
      assert.deepEqual(await people(), [
        { name: "こもれび", reading: "コモレビ" },
        { name: "ひだまり", reading: "ヒダマリ" },
        { name: "KEI", reading: "KEI" },
        { name: "海野波子", reading: "ウミノ ナミコ" },
      ]);
      // Ben's book is judged again; the catalog row stays judged.
      assert.deepEqual(await rows("select book_id from private.book_rechecks"), [{ book_id: id(82) }]);
      assert.deepEqual(
        await rows(
          `select c.verdict, c.checked_at is not null as checked from private.book_checks c
           join books b on b.id = c.book_id where b.isbn = $1 and b.source = 'ndl'`,
          [C(82)],
        ),
        [{ verdict: "same", checked: true }],
      );
      // Nothing else changed.
      assert.deepEqual(await rows("select * from books where isbn <> $1 order by id", [C(82)]), others);
      assert.deepEqual(await otherSources(), sources);
      // Copied first, and compared after (check_copy stops the file on a loss).
      assert.deepEqual(await rows("select source from keep.copies where label = $1 order by 1", [
        TRADES.replace(/^.*\//, "").replace(/\.sql$/, ""),
      ]), [
        { source: "private.book_checks" },
        { source: "private.book_grams" },
        { source: "private.edition_sources" },
        { source: "public.books" },
      ]);
      await db.close();
    },
  );

  await check(
    "the names kept before AUD-168 are made again: a statement's [ほか] and a long role after the heading's name",
    async () => {
      const db = await migrated(CREDITS);
      const { rows, register } = helpers(db);
      await db.exec(PEOPLE);
      const taken = await rowsFor(db, [
        [
          "R100000002-I84",
          {
            bibId: "84",
            isbns: [C(84)],
            title: "木陰の目録",
            agents: [{ name: "海野, 波子" }, { name: "藤野, 霞" }, { name: "こもれび" }],
            credits: ["海野波子 [ほか] 著", "藤野霞 キャラクターデザイン", "こもれび Books 監修"],
          },
        ],
        ["R100000002-I85", { bibId: "85", isbns: [C(85)], title: "波の目録", agents: [{ name: "海野, 波子" }] }],
      ]);
      await pgliteTarget(db).take(taken, "trial");
      await register(BEN, id(84), C(84), "木陰の目録", "海野波子");
      const author = async (isbnOf: string) =>
        (await rows<{ author: string }>("select author from books where isbn = $1 and source = 'ndl'", [isbnOf]))[0]
          .author;
      const people = () =>
        rows(
          `select c ->> 'name' as name, c ->> 'role' as role
           from private.edition_sources s join books b on b.edition_id = s.edition_id,
             jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
           where b.id = $1 and s.source = 'ndl' order by n`,
          [id(84)],
        );
      const otherSources = () =>
        rows(
          `select s::text from private.edition_sources s
           where edition_id <> (select edition_id from books where id = $1) order by 1`,
          [id(84)],
        );
      assert.equal(await author(C(84)), "海野波子 [ほか]、藤野霞 キャラクターデザイン、こもれび Books");
      assert.deepEqual(await people(), [
        { name: "海野波子 [ほか]", role: "著" },
        { name: "藤野霞 キャラクターデザイン", role: null },
        { name: "こもれび Books", role: "監修" },
      ]);
      await rows("delete from private.book_rechecks");
      const others = await rows("select * from books where isbn <> $1 order by id", [C(84)]);
      const sources = await otherSources();
      await db.exec(migrationText(CREDITS));
      assert.equal(await author(C(84)), "海野波子、藤野霞、こもれび Books");
      assert.deepEqual(await people(), [
        { name: "海野波子", role: "著" },
        { name: "藤野霞", role: "キャラクターデザイン" },
        { name: "こもれび Books", role: "監修" },
      ]);
      // Ben's book is judged again; the catalog row stays judged.
      assert.deepEqual(await rows("select book_id from private.book_rechecks"), [{ book_id: id(84) }]);
      assert.deepEqual(
        await rows(
          `select c.verdict, c.checked_at is not null as checked from private.book_checks c
           join books b on b.id = c.book_id where b.isbn = $1 and b.source = 'ndl'`,
          [C(84)],
        ),
        [{ verdict: "same", checked: true }],
      );
      // Nothing else changed.
      assert.deepEqual(await rows("select * from books where isbn <> $1 order by id", [C(84)]), others);
      assert.deepEqual(await otherSources(), sources);
      // Copied first, and compared after (check_copy stops the file on a loss).
      assert.deepEqual(await rows("select source from keep.copies where label = $1 order by 1", [
        CREDITS.replace(/^.*\//, "").replace(/\.sql$/, ""),
      ]), [
        { source: "private.book_checks" },
        { source: "private.book_grams" },
        { source: "private.edition_sources" },
        { source: "public.books" },
      ]);
      await db.close();
    },
  );

  await check(
    "the roles kept before AUD-170 lose ほか in front, and names paired with statements in another order come from the headings",
    async () => {
      const db = await migrated(CREDITS);
      const { rows, register } = helpers(db);
      await db.exec(PEOPLE);
      const taken = await rowsFor(db, [
        ["R100000002-I86", { bibId: "86", isbns: [C(86)], title: "木陰の訳", agents: [{ name: "海野, 波子" }], credits: ["海野波子 他訳"] }],
        ["R100000002-I87", { bibId: "87", isbns: [C(87)], title: "木陰の話", agents: [{ name: "海野, 波子" }], credits: ["海野波子 [ほか述]"] }],
        [
          "R100000002-I88",
          {
            bibId: "88",
            isbns: [C(88)],
            title: "木陰の順",
            agents: [{ name: "海野, 波子" }, { name: "藤野, 霞" }],
            credits: ["藤野霞 著", "海野波子 訳"],
          },
        ],
        ["R100000002-I89", { bibId: "89", isbns: [C(89)], title: "波の訳", agents: [{ name: "海野, 波子" }], credits: ["海野波子 訳"] }],
        // The same person twice is not in another order.
        [
          "R100000002-I90",
          {
            bibId: "90",
            isbns: [C(90)],
            title: "波の絵",
            agents: [{ name: "海野, 波子" }, { name: "海野, 波子" }],
            credits: ["海野波子 著", "海野波子 絵"],
          },
        ],
      ]);
      await pgliteTarget(db).take(taken, "trial");
      await register(BEN, id(88), C(88), "木陰の順", "海野波子");
      const author = async (isbnOf: string) =>
        (await rows<{ author: string }>("select author from books where isbn = $1 and source = 'ndl'", [isbnOf]))[0]
          .author;
      const people = (isbnOf: string) =>
        rows(
          `select c ->> 'name' as name, c ->> 'role' as role
           from private.edition_sources s join books b on b.edition_id = s.edition_id,
             jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
           where b.isbn = $1 and b.source = 'ndl' and s.source = 'ndl' order by n`,
          [isbnOf],
        );
      await db.exec(migrationText(CREDITS));
      assert.deepEqual(await people(C(86)), [{ name: "海野波子", role: "他訳" }]);
      assert.deepEqual(await people(C(87)), [{ name: "海野波子", role: "[ほか述]" }]);
      assert.deepEqual(await people(C(88)), [
        { name: "藤野霞", role: "著" },
        { name: "海野波子", role: "訳" },
      ]);
      assert.equal(await author(C(88)), "藤野霞、海野波子");
      await rows("delete from private.book_rechecks");
      const others = await rows("select * from books where isbn not in ($1, $2) order by id", [C(86), C(88)]);
      const kept = await people(C(89));
      const twice = await people(C(90));
      assert.deepEqual(twice, [
        { name: "海野波子", role: "著" },
        { name: "海野波子", role: "絵" },
      ]);
      await db.exec(migrationText(ROLES));
      assert.deepEqual(await people(C(86)), [{ name: "海野波子", role: "訳" }]);
      assert.deepEqual(await people(C(87)), [{ name: "海野波子", role: "述" }]);
      assert.deepEqual(await people(C(88)), [
        { name: "海野波子", role: null },
        { name: "藤野霞", role: null },
      ]);
      assert.equal(await author(C(88)), "海野波子、藤野霞");
      // Ben's book is judged again; nothing else changed.
      assert.deepEqual(await rows("select book_id from private.book_rechecks"), [{ book_id: id(88) }]);
      assert.deepEqual(await rows("select * from books where isbn not in ($1, $2) order by id", [C(86), C(88)]), others);
      assert.deepEqual(await people(C(89)), kept);
      assert.deepEqual(await people(C(90)), twice);
      assert.deepEqual(await rows("select source from keep.copies where label = $1 order by 1", [
        ROLES.replace(/^.*\//, "").replace(/\.sql$/, ""),
      ]), [
        { source: "private.book_checks" },
        { source: "private.book_grams" },
        { source: "private.edition_sources" },
        { source: "public.books" },
      ]);
      await db.close();
    },
  );

  console.log(`${passed} catalog checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
