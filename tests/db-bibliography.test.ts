import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// The bibliographic master (item 4 of the 2026-10-16 plan, the owner's review
// of 2026-10-16 22:36Z, supabase/migrations/*_bibliography.sql): what the
// move adds, what is asked and when, how the library's and openBD's answers
// are read and kept, what the master shows, who may read it and from when,
// the operator's tools, and undoing it. The answers here are made up in the
// shape the real ones have (the samples in the shared folder, 2026-10-17):
// no real record is copied into the repository.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const BIB_FILE = FILES.find((file) => file.endsWith("_bibliography.sql"));
assert.ok(BIB_FILE, "the bibliography migration");
const BIB = BIB_FILE;
const TEXT = migrationText(BIB);
const EDITION_COPY = "20261031000000_edition_ids";

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A valid ISBN-13 from its first twelve digits. */
function isbn(first: string): string {
  const sum = [...first].reduce(
    (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return first + ((10 - (sum % 10)) % 10);
}
/** The same book's ISBN-10, as old records write it (978 books only). */
function isbn10(full: string): string {
  const nine = full.slice(3, 12);
  const sum = [...nine].reduce((t, d, i) => t + Number(d) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return nine + (check === 10 ? "X" : String(check));
}
const hyphened = (full: string) =>
  `${full.slice(0, 3)}-${full.slice(3, 4)}-${full.slice(4, 6)}-${full.slice(6, 12)}-${full.slice(12)}`;
const numbered = (n: number) => isbn("97849990" + String(n).padStart(4, "0"));

const X1 = numbered(1);
const X2 = numbered(2);
const X3 = numbered(3);

// Answers in the shape the sources give them ----------------------------------------

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Agent = { name: string; reading?: string; about?: string };
type Ndl = {
  category?: string;
  status?: string;
  bibId?: string;
  isbns: string[];
  title: string;
  plainTitle?: string;
  reading?: string;
  volume?: string;
  edition?: string;
  series?: { value: string; reading?: string }[];
  agents?: Agent[];
  credits?: string[];
  publisher?: string;
  date?: string;
  issued?: string;
  subjects?: string[];
  holders?: number;
};

const NS = [
  'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
  'xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:dcterms="http://purl.org/dc/terms/"',
  'xmlns:dcndl="http://ndl.go.jp/dcndl/terms/"',
  'xmlns:foaf="http://xmlns.com/foaf/0.1/"',
].join(" ");

/** One record of the library's SRU answer (recordSchema=dcndl). */
function ndlRecord(r: Ndl): string {
  const category = r.category ?? "R100000002";
  const about = `https://ndlsearch.ndl.go.jp/books/${category}-I${r.bibId ?? "0"}`;
  const text = (tag: string, value?: string) =>
    value === undefined ? "" : `<${tag}>${escape(value)}</${tag}>`;
  const described = (tag: string, value: string, reading?: string) =>
    `<${tag}><rdf:Description><rdf:value>${escape(value)}</rdf:value>${
      reading === undefined
        ? ""
        : `<dcndl:transcription>${escape(reading)}</dcndl:transcription>`
    }</rdf:Description></${tag}>`;
  const holders = Array.from(
    { length: r.holders ?? 0 },
    (_, i) =>
      `<dcndl:Item rdf:about="${about}-${i}#item"><dcndl:holdingAgent><foaf:Agent><foaf:name>図書館${i}</foaf:name></foaf:Agent></dcndl:holdingAgent></dcndl:Item>`,
  ).join("");
  return `<record><recordSchema>info:srw/schema/1/dc-v1.1</recordSchema><recordPacking>xml</recordPacking><recordData>
<rdf:RDF ${NS}>
  <dcndl:BibAdminResource rdf:about="${about}">
    ${text("dcndl:catalogingStatus", r.status === "" ? undefined : (r.status ?? "C7"))}
    <dcndl:bibRecordCategory>${category}</dcndl:bibRecordCategory>
    <dcndl:record rdf:resource="${about}#material"/>
  </dcndl:BibAdminResource>
  <dcndl:BibResource rdf:about="${about}#material">
    ${r.bibId ? `<dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/NDLBibID">${r.bibId}</dcterms:identifier>` : ""}
    ${r.isbns.map((i) => `<dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">${i}</dcterms:identifier>`).join("")}
    ${text("dcterms:title", r.plainTitle ?? r.title)}
    ${described("dc:title", r.title, r.reading)}
    ${r.volume ? described("dcndl:volume", r.volume) : ""}
    ${(r.series ?? []).map((s) => described("dcndl:seriesTitle", s.value, s.reading)).join("")}
    ${text("dcndl:edition", r.edition)}
    ${(r.agents ?? [])
      .map(
        (a) =>
          `<dcterms:creator><foaf:Agent${a.about ? ` rdf:about="${a.about}"` : ""}><foaf:name>${escape(a.name)}</foaf:name>${
            a.reading
              ? `<dcndl:transcription>${escape(a.reading)}</dcndl:transcription>`
              : ""
          }</foaf:Agent></dcterms:creator>`,
      )
      .join("")}
    ${(r.credits ?? []).map((c) => text("dc:creator", c)).join("")}
    ${r.publisher ? `<dcterms:publisher><foaf:Agent><foaf:name>${escape(r.publisher)}</foaf:name></foaf:Agent></dcterms:publisher>` : ""}
    ${text("dcterms:date", r.date)}
    ${r.issued ? `<dcterms:issued rdf:datatype="http://purl.org/dc/terms/W3CDTF">${r.issued}</dcterms:issued>` : ""}
    ${(r.subjects ?? []).map((s) => `<dcterms:subject rdf:resource="${s}"/>`).join("")}
  </dcndl:BibResource>
  <dcndl:BibResource rdf:about="${about}#material"><dcndl:record rdf:resource="${about}#item"/></dcndl:BibResource>
  ${holders}
</rdf:RDF></recordData><recordPosition>1</recordPosition></record>`;
}

/** The library's SRU answer with these records. */
const sru = (...records: Ndl[]) =>
  `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.2</version><numberOfRecords>${records.length}</numberOfRecords><records>${records.map(ndlRecord).join("")}</records></searchRetrieveResponse>`;
/** The library's SRU answer with a diagnostic instead. */
const diagnostic = (message: string) =>
  `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><diagnostics><diagnostic xmlns="http://www.loc.gov/zing/srw/diagnostic/"><uri>info:srw/diagnostic/1/1</uri><details>An error occurred</details><message>${message}</message></diagnostic></diagnostics></searchRetrieveResponse>`;

type OpenbdPerson = {
  name: string;
  reading?: string;
  roles?: string[];
  note?: string;
};
/** One element of openBD's answer (its summary and the ONIX it is made from). */
function openbd(o: {
  isbn: string;
  title: string;
  reading?: string;
  subtitle?: string;
  titleAsList?: boolean;
  series?: string;
  number?: string;
  people?: OpenbdPerson[];
  author?: string;
  publisher?: string;
  pubdate?: string;
}) {
  const element = {
    TitleElementLevel: "01",
    TitleText: { collationkey: o.reading ?? "", content: o.title },
    ...(o.subtitle ? { Subtitle: { content: o.subtitle } } : {}),
  };
  return {
    summary: {
      isbn: o.isbn,
      title: o.title,
      volume: o.number ?? "",
      series: o.series ?? "",
      publisher: o.publisher ?? "",
      pubdate: o.pubdate ?? "",
      cover: `https://cover.openbd.jp/${o.isbn}.jpg`,
      author: o.author ?? "",
    },
    onix: {
      RecordReference: o.isbn,
      DescriptiveDetail: {
        TitleDetail: {
          TitleType: "01",
          TitleElement: o.titleAsList ? [element] : element,
        },
        Contributor: (o.people ?? []).map((p, i) => ({
          SequenceNumber: String(i + 1),
          ContributorRole: p.roles ?? [],
          PersonName: { content: p.name, collationkey: p.reading ?? "" },
          ...(p.note ? { BiographicalNote: p.note } : {}),
        })),
        ...(o.series
          ? {
              Collection: {
                CollectionType: "10",
                TitleDetail: {
                  TitleType: "01",
                  TitleElement: [
                    {
                      TitleElementLevel: "02",
                      PartNumber: o.number ?? "",
                      TitleText: { collationkey: "", content: o.series },
                    },
                  ],
                },
              },
            }
          : {}),
      },
      CollateralDetail: {
        TextContent: [{ TextType: "03", Text: "出版社が書いた内容の紹介" }],
      },
      PublishingDetail: {
        Imprint: { ImprintName: o.publisher ?? "" },
        PublishingDate: o.pubdate
          ? [{ PublishingDateRole: "11", Date: o.pubdate }]
          : [],
      },
    },
    hanmoto: { datecreated: "2026-01-01 00:00:00" },
  };
}

// The database -------------------------------------------------------------------------

type Visitor = string | null;

async function migrated(upTo?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => (upTo ? file < upTo : true)))
    await db.exec(migrationText(file));
  return db;
}

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
  async function refused(
    run: () => Promise<unknown>,
    reason: RegExp,
    what: string,
  ) {
    let error: unknown = null;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, "expected a refusal: " + what);
    assert.match(error.message, reason, what);
  }
  const count = async (sql: string, params: unknown[] = []) =>
    (await rows<{ n: number }>(`select (${sql})::int as n`, params))[0].n;
  /** Registers a book as its reader does. */
  const register = (
    reader: string,
    book: string,
    isbnOf: string | null,
    title: string,
    author = "",
  ) =>
    as(
      reader,
      "insert into books (id, isbn, title, author, created_by) values ($1, $2, $3, $4, $5)",
      [book, isbnOf, title, author, reader],
    );
  const tick = () => rows("select private.bib_tick()");
  /** The questions out that no answer has come back for, oldest first. */
  const questions = () =>
    rows<{ id: number; url: string; headers: Record<string, string> }>(
      `select q.id::int as id, q.url, q.headers from net.http_request_queue q
       where not exists (select 1 from net._http_response h where h.id = q.id)
         and exists (select 1 from private.edition_sources s where s.request_id = q.id)
       order by q.id`,
    );
  /** Answers a question as pg_net would write the answer down. */
  const answer = (
    question: number,
    content: string,
    status = 200,
    failure: { timed_out?: boolean; error_msg?: string } = {},
  ) =>
    rows(
      `insert into net._http_response (id, status_code, content, timed_out, error_msg)
       values ($1, $2, $3, $4, $5)`,
      [
        question,
        status,
        content,
        failure.timed_out ?? false,
        failure.error_msg ?? null,
      ],
    );
  /** What is kept about an ISBN's edition from a source. */
  const kept = async (isbnOf: string, source: "ndl" | "openbd") =>
    (
      await rows<{
        state: string;
        record: string | null;
        record_id: string | null;
        status: string | null;
        fields: Record<string, unknown>;
        misses: number;
        failures: number;
        wait: string | null;
        asked: boolean;
        out: boolean;
        title_kept: boolean;
      }>(
        `select s.state, s.record, s.record_id, s.status, s.fields, s.misses, s.failures,
           (s.next_at - s.answered_at)::text as wait, s.asked_at is not null as asked,
           s.request_id is not null as out, s.title_kept_at is not null as title_kept
         from private.edition_sources s join editions e on e.id = s.edition_id
         where e.isbn = $1 and s.source = $2`,
        [isbnOf, source],
      )
    )[0];
  /** Makes an ISBN's edition due again from both sources. */
  const due = (isbnOf: string) =>
    rows(
      `update private.edition_sources s set next_at = now() - interval '1 second'
       from editions e where e.id = s.edition_id and e.isbn = $1`,
      [isbnOf],
    );
  /** As if the book had been in its edition for this many minutes more. */
  const age = (book: string, minutes: number) =>
    rows(
      `update private.book_checks set placed_at = placed_at - make_interval(mins => $2)
       where book_id = $1`,
      [book, minutes],
    );
  const shown = (visitor: Visitor, ids: string[]) =>
    as<Record<string, unknown>>(
      visitor,
      "select * from book_bibliography($1::uuid[]) order by book_id",
      [ids],
    );
  return {
    rows,
    as,
    refused,
    count,
    register,
    tick,
    questions,
    answer,
    kept,
    due,
    age,
    shown,
  };
}

/** Answers every question out: the library from its records, openBD from its elements. */
async function answerAll(
  db: PGlite,
  ndl: Record<string, string>,
  open: Record<string, unknown>,
  unanswered: string[] = [],
) {
  const { questions, answer } = helpers(db);
  for (const q of await questions()) {
    if (q.url.startsWith("https://ndlsearch.ndl.go.jp/")) {
      const asked = decodeURIComponent(q.url).match(/isbn="(\d{13})"/)?.[1];
      assert.ok(asked, q.url);
      if (unanswered.includes(asked)) continue;
      await answer(q.id, ndl[asked] ?? diagnostic("Record does not exist"));
    } else {
      const list = new URL(q.url).searchParams.get("isbn")!.split(",");
      await answer(q.id, JSON.stringify(list.map((i) => open[i] ?? null)));
    }
  }
}

/**
 * Everything a migration makes or changes in public and private, by name, as
 * tests/db-works.test.ts compares its rollback; and pg_cron's jobs.
 */
async function catalog(db: PGlite) {
  return (
    await db.query<{ kind: string; name: string; detail: string }>(
      `select 'function' as kind, p.oid::regprocedure::text as name,
              md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') as detail
       from pg_proc p
       where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       union all
       select 'relation', c.oid::regclass::text,
              c.relkind::text || ' ' || coalesce(c.relacl::text, '') || ' ' || c.relrowsecurity::text
       from pg_class c
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
       union all
       select 'column', a.attrelid::regclass::text || '.' || a.attname,
              format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' '
                || coalesce(a.attacl::text, '')
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
         and a.attnum > 0 and not a.attisdropped
       union all
       select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
              pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text
       from pg_trigger t where not t.tgisinternal
       union all
       select 'policy', p.polrelid::regclass::text || '.' || p.polname, ''
       from pg_policy p
       union all
       select 'constraint', c.conrelid::regclass::text || '.' || c.conname,
              pg_get_constraintdef(c.oid)
       from pg_constraint c
       where c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
       union all
       select 'job', j.jobname, j.schedule || ' ' || j.command from cron.job j
       order by 1, 2, 3`,
    )
  ).rows;
}

/** The rollback as the header writes it: the indented lines of its first comment. */
function rollbackSql(): string {
  return TEXT.slice(0, TEXT.indexOf("\n\n"))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
}

/** Every row of every table in public, as JSON. */
async function publicRows(db: PGlite): Promise<Record<string, string[]>> {
  const tables = (
    await db.query<{ name: string }>(
      `select quote_ident(c.relname) as name from pg_class c
       where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace order by 1`,
    )
  ).rows;
  const all: Record<string, string[]> = {};
  for (const { name } of tables)
    all[name] = (
      await db.query<{ row: string }>(
        `select to_jsonb(t)::text as row from public.${name} t order by 1`,
      )
    ).rows.map((row) => row.row);
  return all;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // The move ---------------------------------------------------------------------

  await check(
    "the move changes no book, asks about every edition with an ISBN, and drops the edition ids' copy",
    async () => {
      const db = await migrated(BIB);
      const { rows, count } = helpers(db);
      await db.exec(`
        insert into auth.users (id) values ('${AKI}');
        insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ');
        insert into books (id, isbn, title, created_by, created_at) values
          ('${id(1, 1)}', '${X1}', '一冊目', '${AKI}', '2026-10-01'),
          ('${id(1, 2)}', '${X1}', '一冊目', null, '2026-10-02'),
          ('${id(1, 3)}', null, '手帖', '${AKI}', '2026-10-03');
      `);
      // As production had it: the copy the edition ids took.
      assert.equal(
        await count("select count(*) from keep.copies where label = $1", [
          EDITION_COPY,
        ]),
        1,
      );
      const before = await publicRows(db);
      await db.exec(TEXT);
      assert.deepEqual(await publicRows(db), before);
      assert.deepEqual(
        await rows(
          `select b.id, c.placed_at = b.created_at as same from books b
           join private.book_checks c on c.book_id = b.id order by b.id`,
        ),
        [
          { id: id(1, 1), same: true },
          { id: id(1, 2), same: true },
          { id: id(1, 3), same: true },
        ],
      );
      assert.deepEqual(
        await rows(
          `select e.isbn, s.source, s.state, s.fields, s.next_at <= now() as due
           from private.edition_sources s join editions e on e.id = s.edition_id
           order by e.isbn, s.source`,
        ),
        [
          { isbn: X1, source: "ndl", state: "waiting", fields: {}, due: true },
          {
            isbn: X1,
            source: "openbd",
            state: "waiting",
            fields: {},
            due: true,
          },
        ],
      );
      assert.deepEqual(
        await rows(
          "select jobname, schedule, command from cron.job order by 1",
        ),
        [
          {
            jobname: "bibliography",
            schedule: "* * * * *",
            command: "select private.bib_tick()",
          },
          {
            jobname: "cron-history",
            schedule: "17 3 * * *",
            command:
              "delete from cron.job_run_details where end_time < now() - interval '7 days'",
          },
        ],
      );
      assert.equal(
        await count("select count(*) from keep.copies where label = $1", [
          EDITION_COPY,
        ]),
        0,
      );
      await db.close();
    },
  );

  await check(
    "the rollback in the header leaves the database as it was before",
    async () => {
      const db = await migrated(BIB);
      const before = await catalog(db);
      await db.exec(TEXT);
      assert.notDeepEqual(await catalog(db), before);
      await db.exec(rollbackSql());
      assert.deepEqual(await catalog(db), before);
      await db.close();
    },
  );

  const db = await migrated();
  const {
    rows,
    as,
    refused,
    count,
    register,
    tick,
    questions,
    answer,
    kept,
    due,
    age,
    shown,
  } = helpers(db);
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
  `);

  // New books ------------------------------------------------------------------------

  await check(
    "a new edition with an ISBN is asked about, a book without one is not, and a book's place is written down when it is registered and when its ISBN moves it",
    async () => {
      await register(AKI, id(2, 1), X1, "架空の図書館");
      await register(BEN, id(2, 2), X1, "架空の図書館");
      await register(AKI, id(2, 3), null, "手帖");
      assert.deepEqual(
        await rows(
          `select e.isbn, s.source, s.state from private.edition_sources s
           join editions e on e.id = s.edition_id order by 1, 2`,
        ),
        [
          { isbn: X1, source: "ndl", state: "waiting" },
          { isbn: X1, source: "openbd", state: "waiting" },
        ],
      );
      assert.equal(
        await count(
          `select count(*) from private.book_checks
           where book_id = any ($1::uuid[]) and placed_at > now() - interval '1 minute'`,
          [[id(2, 1), id(2, 2), id(2, 3)]],
        ),
        3,
      );
      // A title edited keeps the place; an ISBN edited moves the book, and
      // its place is new.
      await age(id(2, 2), 60);
      await as(
        BEN,
        "update books set title = '架空の図書館（文庫）' where id = $1",
        [id(2, 2)],
      );
      assert.equal(
        await count(
          "select count(*) from private.book_checks where book_id = $1 and placed_at < now() - interval '59 minutes'",
          [id(2, 2)],
        ),
        1,
      );
      await as(BEN, "update books set isbn = $2 where id = $1", [id(2, 2), X2]);
      assert.equal(
        await count(
          "select count(*) from private.book_checks where book_id = $1 and placed_at > now() - interval '1 minute'",
          [id(2, 2)],
        ),
        1,
      );
      assert.equal(
        await count(
          `select count(*) from private.edition_sources s join editions e on e.id = s.edition_id
           where e.isbn = $1`,
          [X2],
        ),
        2,
      );
    },
  );

  // Asking ---------------------------------------------------------------------------------

  await check(
    "a turn asks the library about one edition and openBD about the rest in one question, and asks nothing again while a question is out",
    async () => {
      await tick();
      const out = await questions();
      assert.equal(out.length, 2);
      const [library, open] = out;
      // X1 came first, so the library is asked about it.
      assert.equal(
        library.url,
        "https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2" +
          "&recordSchema=dcndl&recordPacking=xml&onlyBib=true&maximumRecords=20" +
          `&query=isbn%3D%22${X1}%22%20AND%20dpid%3D%22iss-ndl-opac%20iss-ndl-opac-inprocess%22`,
      );
      assert.equal(
        new URL(library.url).searchParams.get("query"),
        `isbn="${X1}" AND dpid="iss-ndl-opac iss-ndl-opac-inprocess"`,
      );
      assert.equal(
        new URL(open.url).searchParams.get("isbn"),
        [X1, X2].sort().join(","),
      );
      for (const q of out)
        assert.deepEqual(q.headers, {
          "User-Agent": "BookTown (+https://booktown.page)",
        });
      // Next turn: the library about X2; openBD's question is still out.
      await tick();
      const next = await questions();
      assert.equal(next.length, 3);
      assert.match(next[2].url, new RegExp(`isbn%3D%22${X2}%22`));
      await tick();
      assert.equal((await questions()).length, 3);
    },
  );

  // Reading the answers ------------------------------------------------------------

  const ndl = (content: string, isbnOf: string) =>
    rows<{
      state: string;
      record: string | null;
      record_id: string | null;
      status: string | null;
      fields: Record<string, unknown> | null;
    }>("select * from private.ndl_answer($1, $2)", [content, isbnOf]).then(
      (found) => found[0],
    );
  const fromOpenbd = (element: unknown, isbnOf: string) =>
    rows<{
      state: string;
      record: string | null;
      fields: Record<string, unknown> | null;
    }>("select * from private.openbd_answer($1::jsonb, $2)", [
      JSON.stringify(element),
      isbnOf,
    ]).then((found) => found[0]);

  await check(
    "the library's answer is read for its own record of the ISBN: title, reading, subtitle, volume, edition, series, people with their roles, publisher, date and NDC",
    async () => {
      const answer = await ndl(
        sru({
          bibId: "000000001",
          isbns: [hyphened(X1)],
          title: "架空の図書館 : 夜の章 = The imaginary library",
          plainTitle: "架空の図書館. 上 : 夜の章",
          reading: "カクウ ノ トショカン : ヨル ノ ショウ",
          volume: "上",
          edition: "新装版",
          series: [
            { value: "空想文庫 ; 12", reading: "クウソウ ブンコ ; 12" },
            { value: "夜の叢書" },
          ],
          agents: [
            {
              name: "Doe, Jane, 1950-",
              about: "http://id.ndl.go.jp/auth/entity/00000001",
            },
            {
              name: "山田, 一郎, 1970-",
              reading: "ヤマダ, イチロウ, 1970-",
              about: "http://id.ndl.go.jp/auth/entity/00000002",
            },
          ],
          credits: ["ジェーン・ドウ 著", "山田一郎 訳"],
          publisher: "架空書房 & 夜社",
          date: "2014.6",
          issued: "2014",
          subjects: [
            "http://id.ndl.go.jp/class/ndlc/KS1",
            "http://id.ndl.go.jp/class/ndc9/933.6",
            "http://id.ndl.go.jp/class/ndc10/933.7",
          ],
          holders: 3,
        }),
        X1,
      );
      assert.equal(answer.state, "found");
      assert.equal(answer.record_id, "000000001");
      assert.equal(answer.status, "C7");
      assert.deepEqual(answer.fields, {
        title: "架空の図書館",
        title_reading: "カクウ ノ トショカン",
        subtitle: "夜の章",
        volume: "上",
        edition: "新装版",
        series: [
          { name: "空想文庫", number: "12", reading: "クウソウ ブンコ" },
          { name: "夜の叢書" },
        ],
        creators: [
          {
            name: "ジェーン・ドウ",
            role: "著",
            heading: "Doe, Jane, 1950-",
            authority: "http://id.ndl.go.jp/auth/entity/00000001",
          },
          {
            name: "山田一郎",
            role: "訳",
            heading: "山田, 一郎, 1970-",
            reading: "ヤマダ, イチロウ, 1970-",
            authority: "http://id.ndl.go.jp/auth/entity/00000002",
          },
        ],
        credits: ["ジェーン・ドウ 著", "山田一郎 訳"],
        publisher: "架空書房 & 夜社",
        issued: "2014-06",
        ndc: "933.7",
      });
      // The record is kept as it came, but for the libraries that hold it.
      assert.match(answer.record ?? "", /^<dcndl:BibResource /);
      assert.match(answer.record ?? "", /架空書房 &amp; 夜社/);
      assert.doesNotMatch(answer.record ?? "", /holdingAgent|図書館0/);

      // Several people under one statement, the statement's ways of writing
      // a role, and statements that do not match the people.
      const named = async (credits: string[], agents: number) =>
        (
          await ndl(
            sru({
              isbns: [X1],
              title: "本",
              credits,
              agents: Array.from({ length: agents }, (_, i) => ({
                name: `人, ${i}`,
              })),
            }),
            X1,
          )
        ).fields?.creators;
      assert.deepEqual(await named(["甲, 乙, 丙 編著"], 3), [
        { name: "甲", role: "編著", heading: "人, 0" },
        { name: "乙", role: "編著", heading: "人, 1" },
        { name: "丙", role: "編著", heading: "人, 2" },
      ]);
      assert.deepEqual(await named(["尾根太郎∥著", "谷花子 [著]"], 2), [
        { name: "尾根太郎", role: "著", heading: "人, 0" },
        { name: "谷花子", role: "[著]", heading: "人, 1" },
      ]);
      assert.deepEqual(await named(["John Smith", "甲 著"], 2), [
        { name: "John Smith", heading: "人, 0" },
        { name: "甲", role: "著", heading: "人, 1" },
      ]);
      assert.deepEqual(await named(["甲, 乙 著"], 3), [
        { heading: "人, 0" },
        { heading: "人, 1" },
        { heading: "人, 2" },
      ]);

      // A date the library writes as a year only, or in full-width digits;
      // the title from dcterms:title when dc:title has none.
      const dated = await ndl(
        sru({
          isbns: [X1],
          title: "",
          plainTitle: "題だけの本",
          issued: "1997",
        }),
        X1,
      );
      assert.deepEqual(dated.fields, { title: "題だけの本", issued: "1997" });
      assert.equal(
        (
          await ndl(
            sru({ isbns: [X1], title: "本", date: "１９９７．１２" }),
            X1,
          )
        ).fields?.issued,
        "1997-12",
      );
    },
  );

  await check(
    "of the library's records only its own count, a finished one before one in the making and a volume before its set, by the ISBN however it is written",
    async () => {
      const other = {
        category: "R100000001",
        bibId: "9",
        isbns: [X1],
        title: "ほかの図書館の題",
      };
      assert.equal((await ndl(sru(other), X1)).state, "missing");
      assert.equal(
        (await ndl(sru(other, { isbns: [isbn10(X1)], title: "自前の題" }), X1))
          .fields?.title,
        "自前の題",
      );
      const making = { status: "C3", isbns: [X1], title: "作成中" };
      const finished = { isbns: [hyphened(X1)], title: "完成" };
      const set = { isbns: [X1, X2], title: "全集" };
      assert.equal(
        (await ndl(sru(making, finished), X1)).fields?.title,
        "完成",
      );
      const inMaking = await ndl(sru(making), X1);
      assert.equal(inMaking.state, "found");
      assert.equal(inMaking.status, "C3");
      assert.equal(
        (await ndl(sru(set, { isbns: [X1], title: "一巻" }), X1)).fields?.title,
        "一巻",
      );
      assert.equal(
        (await ndl(sru({ isbns: [X2], title: "別の本" }), X1)).state,
        "missing",
      );
    },
  );

  await check(
    "the library saying it has no record is missing; any other trouble is failed",
    async () => {
      assert.equal(
        (await ndl(diagnostic("Record does not exist"), X1)).state,
        "missing",
      );
      assert.equal(
        (await ndl(diagnostic("Unsupported query"), X1)).state,
        "failed",
      );
      assert.equal((await ndl("<html>busy</html>", X1)).state, "failed");
      assert.equal((await ndl("not xml at all", X1)).state, "failed");
      assert.equal((await ndl("", X1)).state, "failed");
    },
  );

  await check(
    "openBD's answer is read for the parts the master uses, and what the publisher wrote is not kept",
    async () => {
      const element = openbd({
        isbn: X2,
        title: "架空の図書館",
        reading: "カクウノトショカン",
        subtitle: "夜の章",
        series: "空想文庫",
        number: "12",
        people: [
          {
            name: "山田　一郎",
            reading: "ヤマダ イチロウ",
            roles: ["A01", "B06"],
            note: "1970年生まれ。著書に『架空の旅』。",
          },
          { name: "谷 花子" },
        ],
        author: "山田一郎／著 谷花子／絵",
        publisher: "架空書房",
        pubdate: "20260916",
      });
      const read = await fromOpenbd(element, X2);
      assert.equal(read.state, "found");
      assert.deepEqual(read.fields, {
        title: "架空の図書館",
        title_reading: "カクウノトショカン",
        subtitle: "夜の章",
        series: [{ name: "空想文庫", number: "12" }],
        creators: [
          { name: "山田 一郎", reading: "ヤマダ イチロウ", role: "A01,B06" },
          { name: "谷 花子" },
        ],
        credits: ["山田一郎／著 谷花子／絵"],
        publisher: "架空書房",
        issued: "2026-09",
      });
      const record = JSON.parse(read.record ?? "{}");
      assert.deepEqual(Object.keys(record).sort(), [
        "Collection",
        "Contributor",
        "PublishingDetail",
        "TitleDetail",
        "summary",
      ]);
      assert.doesNotMatch(
        read.record ?? "",
        /1970年生まれ|内容の紹介|cover\.openbd/,
      );
      assert.equal(record.Contributor[0].PersonName.content, "山田　一郎");
      // A title element as a list, and a date of a year and month.
      assert.deepEqual(
        (
          await fromOpenbd(
            openbd({
              isbn: X2,
              title: "題",
              titleAsList: true,
              pubdate: "201406",
            }),
            X2,
          )
        ).fields,
        { title: "題", issued: "2014-06" },
      );
      assert.equal((await fromOpenbd(null, X2)).state, "missing");
      assert.equal(
        (await fromOpenbd(openbd({ isbn: X1, title: "別の本" }), X2)).state,
        "failed",
      );
    },
  );

  // Keeping the answers --------------------------------------------------------------

  const LIBRARY_X1 = sru({
    bibId: "000000011",
    isbns: [hyphened(X1)],
    title: "架空の図書館",
    reading: "カクウ ノ トショカン",
    agents: [{ name: "山田, 一郎" }],
    credits: ["山田一郎 著"],
    publisher: "架空書房",
    date: "2001.4",
  });
  const OPENBD_X1 = openbd({
    isbn: X1,
    title: "架空の図書館（新装版）",
    people: [{ name: "山田 一郎" }],
    publisher: "架空書房",
    pubdate: "200104",
    series: "空想文庫",
  });
  const OPENBD_X2 = openbd({ isbn: X2, title: "夜の本", pubdate: "202609" });

  await check(
    "the answers that come back are kept and their questions closed; one that never comes back fails",
    async () => {
      await answerAll(
        db,
        { [X1]: LIBRARY_X1 },
        { [X1]: OPENBD_X1, [X2]: OPENBD_X2 },
        [X2],
      );
      await tick();
      const library = await kept(X1, "ndl");
      assert.equal(library.state, "found");
      assert.equal(library.record_id, "000000011");
      assert.equal(library.out, false);
      assert.equal((library.fields as { title: string }).title, "架空の図書館");
      // A finished record of a book out more than a year ago: twice a year.
      assert.equal(library.wait, "180 days");
      const open1 = await kept(X1, "openbd");
      assert.equal(open1.state, "found");
      assert.equal(open1.wait, "30 days");
      assert.equal(
        (open1.fields as { title: string }).title,
        "架空の図書館（新装版）",
      );
      assert.equal((await kept(X2, "openbd")).state, "found");
      // pg_net's copies of the answers read are gone.
      assert.equal(await count("select count(*) from net._http_response"), 0);
      // The library's question about X2 never came back.
      await rows(
        "update private.edition_sources set sent_at = now() - interval '16 minutes' where request_id is not null",
      );
      await tick();
      const lost = await kept(X2, "ndl");
      assert.equal(lost.state, "failed");
      assert.equal(lost.failures, 1);
      assert.equal(lost.wait, "00:10:00");
    },
  );

  await check(
    "a new answer replaces what a source said, a field it dropped goes for that source alone, a title is never lost from the master, not found keeps the library's and drops openBD's, and failed keeps both",
    async () => {
      const edition = (
        await rows<{ id: string }>("select id from editions where isbn = $1", [
          X1,
        ])
      )[0].id;
      const take = (
        source: string,
        state: string,
        fields: Record<string, unknown> | null = null,
        status: string | null = null,
      ) =>
        rows("select private.bib_take($1, $2, $3, $4, null, $5, $6::jsonb)", [
          edition,
          source,
          state,
          fields ? "<record/>" : null,
          status,
          fields ? JSON.stringify(fields) : null,
        ]);
      const master = async () =>
        (
          await rows<Record<string, unknown>>(
            "select * from private.edition_bibliography($1)",
            [edition],
          )
        )[0];
      // The library no longer gives the publisher: openBD's shows.
      await take("ndl", "found", { title: "架空の図書館", issued: "2001-04" });
      assert.equal((await master()).publisher, "架空書房");
      assert.deepEqual((await master()).sources, {
        title: "ndl",
        issued: "ndl",
        series: "openbd",
        creators: "openbd",
        publisher: "openbd",
      });
      // Neither gives a title now: the library's stays, and is listed.
      await take("openbd", "found", { publisher: "架空書房" });
      await take("ndl", "found", { issued: "2001-04" });
      assert.equal((await master()).title, "架空の図書館");
      assert.equal((await kept(X1, "ndl")).title_kept, true);
      assert.deepEqual(
        await rows(
          "select isbn, source, why from private.bibliography_review order by 1, 2",
        ),
        [{ isbn: X1, source: "ndl", why: "title kept" }],
      );
      // When openBD gives one again, the library's own answer decides.
      await take("openbd", "found", { title: "架空の図書館（新装版）" });
      await take("ndl", "found", { issued: "2001-04" });
      assert.equal((await kept(X1, "ndl")).title_kept, false);
      assert.equal((await master()).title, "架空の図書館（新装版）");
      await take("ndl", "found", { title: "架空の図書館", issued: "2001-04" });
      // Not found: the library's stays, openBD's goes.
      await take("ndl", "missing");
      await take("openbd", "missing");
      const after = await kept(X1, "ndl");
      assert.equal(after.state, "missing");
      assert.equal((after.fields as { title: string }).title, "架空の図書館");
      assert.equal(after.misses, 1);
      assert.equal(after.wait, "1 day");
      const gone = await kept(X1, "openbd");
      assert.deepEqual(gone.fields, {});
      assert.equal(gone.record, null);
      // Failed: everything stays.
      await take("ndl", "failed");
      assert.equal((await kept(X1, "ndl")).misses, 1);
      assert.equal((await master()).title, "架空の図書館");
      // How long until it is asked again.
      const waits: [
        string,
        string,
        Record<string, unknown> | null,
        string | null,
        string,
      ][] = [
        ["ndl", "missing", null, null, "7 days"],
        ["ndl", "missing", null, null, "30 days"],
        ["ndl", "missing", null, null, "90 days"],
        ["ndl", "missing", null, null, "90 days"],
        ["ndl", "failed", null, null, "00:10:00"],
        ["ndl", "failed", null, null, "01:00:00"],
        ["ndl", "failed", null, null, "06:00:00"],
        ["ndl", "failed", null, null, "1 day"],
        [
          "ndl",
          "found",
          {
            title: "t",
            creators: [{ name: "n" }],
            publisher: "p",
            issued: "2001",
          },
          "C3",
          "7 days",
        ],
        [
          "ndl",
          "found",
          {
            title: "t",
            creators: [{ name: "n" }],
            publisher: "p",
            issued: "2001",
          },
          "C7",
          "180 days",
        ],
        [
          "ndl",
          "found",
          { title: "t", publisher: "p", issued: "2001" },
          "C7",
          "30 days",
        ],
        [
          "ndl",
          "found",
          {
            title: "t",
            creators: [{ name: "n" }],
            publisher: "p",
            issued: new Date().toISOString().slice(0, 7),
          },
          "C7",
          "30 days",
        ],
        ["openbd", "found", { title: "t" }, null, "30 days"],
      ];
      for (const [source, state, fields, status, wait] of waits) {
        await take(source, state, fields, status);
        assert.equal(
          (await kept(X1, source as "ndl" | "openbd")).wait,
          wait,
          `${source} ${state} ${status ?? ""}`,
        );
      }
      await take("ndl", "found", {
        title: "架空の図書館",
        issued: "2001-04",
        publisher: "架空書房",
      });
      await take("openbd", "found", {
        title: "架空の図書館（新装版）",
        series: [{ name: "空想文庫" }],
        creators: [{ name: "山田 一郎" }],
        publisher: "架空書房",
        issued: "2001-04",
      });
    },
  );

  await check(
    "an answer that is not the source's, an error or a timeout fails, and is asked again",
    async () => {
      for (const [content, status, failure] of [
        [diagnostic("Unsupported query"), 200, {}],
        ["<html>Service Unavailable</html>", 503, {}],
        ["", 200, { timed_out: true }],
        ["", 200, { error_msg: "Couldn't resolve host name" }],
      ] as const) {
        await due(X2);
        await tick();
        const q = (await questions()).find(
          (x) =>
            x.url.startsWith("https://ndlsearch.ndl.go.jp/") &&
            x.url.includes(X2),
        );
        assert.ok(q, "a question to the library about X2");
        await answer(q.id, content, status, failure);
        const before = (await kept(X2, "ndl")).failures;
        await tick();
        const now = await kept(X2, "ndl");
        assert.equal(now.state, "failed");
        assert.equal(now.failures, before + 1);
      }
      // openBD's answer that is not a list fails every edition asked in it.
      await due(X2);
      await rows(
        "update private.edition_sources set next_at = now() + interval '1 day' where source = 'ndl'",
      );
      await tick();
      const q = (await questions()).find((x) =>
        x.url.startsWith("https://api.openbd.jp/"),
      );
      assert.ok(q);
      await answer(q.id, '{"error": "busy"}');
      await tick();
      assert.equal((await kept(X2, "openbd")).state, "failed");
      // Its title from before stays.
      assert.equal(
        ((await kept(X2, "openbd")).fields as { title: string }).title,
        "夜の本",
      );
    },
  );

  // What the master shows, and to whom -----------------------------------------------

  await check(
    "the operator's correction shows over both sources, field by field; JSON null shows nothing; taking it back shows the sources again",
    async () => {
      const book = id(2, 1);
      const edition = (
        await rows<{ id: string }>(
          "select edition_id as id from books where id = $1",
          [book],
        )
      )[0].id;
      const master = async () =>
        (
          await rows<Record<string, unknown>>(
            "select * from private.edition_bibliography($1)",
            [edition],
          )
        )[0];
      await rows(
        "select private.fix_bibliography($1, 'title', '\"架空の図書館 新装版\"', '表紙の題')",
        [book],
      );
      await rows("select private.fix_bibliography($1, 'publisher', 'null')", [
        book,
      ]);
      await rows("select private.fix_bibliography($1, 'creators', $2::jsonb)", [
        book,
        JSON.stringify([{ name: "山田一郎", role: "著" }]),
      ]);
      const fixed = await master();
      assert.equal(fixed.title, "架空の図書館 新装版");
      assert.equal(fixed.publisher, null);
      assert.deepEqual(fixed.creators, [{ name: "山田一郎", role: "著" }]);
      assert.equal(fixed.issued, "2001-04");
      assert.deepEqual(fixed.sources, {
        title: "fix",
        creators: "fix",
        issued: "ndl",
        series: "openbd",
      });
      for (const [field, value] of [
        ["title", '""'],
        ["title", "12"],
        ["series", "[]"],
        ["creators", '[{"role": "著"}]'],
        ["credits", '[{"name": "x"}]'],
        ["issued", '"2001年"'],
        ["cover", '"x"'],
      ])
        await refused(
          () =>
            rows("select private.fix_bibliography($1, $2, $3::jsonb)", [
              book,
              field,
              value,
            ]),
          /not a value for|edition_fixes_field_check/,
          `${field} ${value}`,
        );
      await refused(
        () =>
          rows("select private.fix_bibliography($1, 'title', '\"x\"')", [
            id(9, 9),
          ]),
        /no book/,
        "a book that is not there",
      );
      await rows("select private.unfix_bibliography($1, 'publisher')", [book]);
      await rows("select private.unfix_bibliography($1, 'creators')", [book]);
      assert.equal((await master()).publisher, "架空書房");
      await refused(
        () =>
          rows("select private.unfix_bibliography($1, 'publisher')", [book]),
        /no correction of publisher/,
        "taking back a correction twice",
      );
      await rows("select private.unfix_bibliography($1, 'title')", [book]);
      assert.equal((await master()).title, "架空の図書館");
      // A book without an ISBN has no sources, but may be corrected.
      await rows(
        "select private.fix_bibliography($1, 'title', '\"手帖（直した）\"')",
        [id(2, 3)],
      );
      assert.equal(
        (
          await rows<{ title: string }>(
            "select d.title from books b cross join private.edition_bibliography(b.edition_id) d where b.id = $1",
            [id(2, 3)],
          )
        )[0].title,
        "手帖（直した）",
      );
      await rows("select private.unfix_bibliography($1, 'title')", [id(2, 3)]);
    },
  );

  await check(
    "a reader reads the master for books in public places and their own, not before a book has been in its edition ten minutes, whether that edition is old or new",
    async () => {
      // Ben's own copy of X1, registered and placed long ago, on no public page.
      const bens = id(2, 2);
      await as(BEN, "update books set isbn = $2 where id = $1", [bens, X1]);
      await age(bens, 60);
      await age(id(2, 1), 60);
      // Ben reads it; Aki and visitors do not.
      assert.equal((await shown(BEN, [bens])).length, 1);
      assert.deepEqual(await shown(AKI, [bens]), []);
      assert.deepEqual(await shown(null, [bens]), []);
      // Aki's copy of X1 is hers, and a post makes it public.
      const akis = id(2, 1);
      assert.equal((await shown(AKI, [akis]))[0].title, "架空の図書館");
      assert.deepEqual(await shown(null, [akis]), []);
      await as(
        AKI,
        "insert into posts (author_id, body, book_id) values ($1, '面白かった', $2)",
        [AKI, akis],
      );
      const seen = await shown(null, [akis]);
      assert.equal(seen.length, 1);
      assert.deepEqual(Object.keys(seen[0]).sort(), [
        "book_id",
        "creators",
        "credits",
        "edition",
        "issued",
        "ndc",
        "publisher",
        "series",
        "sources",
        "subtitle",
        "title",
        "title_reading",
        "volume",
      ]);
      assert.equal(seen[0].title, "架空の図書館");
      assert.equal(seen[0].publisher, "架空書房");
      // Chi registers X1, which others had, and X3, which nobody had: for
      // ten minutes neither shows, whoever asks, and then both do.
      const old = id(2, 4);
      const fresh = id(2, 5);
      await register(CHI, old, X1, "かくうのとしょかん");
      await register(CHI, fresh, X3, "まだない本");
      await as(
        CHI,
        "insert into posts (author_id, body, book_id) values ($1, 'これから', $2), ($1, 'これも', $3)",
        [CHI, old, fresh],
      );
      await rows(
        "update private.edition_sources set next_at = now() + interval '1 day' where request_id is null",
      );
      await rows(
        "update private.edition_sources s set next_at = now() from editions e where e.id = s.edition_id and e.isbn = $1",
        [X3],
      );
      await tick();
      await answerAll(
        db,
        { [X3]: sru({ isbns: [X3], title: "まだない本の正しい題" }) },
        {},
      );
      await tick();
      for (const visitor of [CHI, AKI, null])
        assert.deepEqual(
          await shown(visitor, [old, fresh]),
          [],
          String(visitor),
        );
      await age(old, 9);
      await age(fresh, 9);
      assert.deepEqual(await shown(CHI, [old, fresh]), []);
      await age(old, 2);
      await age(fresh, 2);
      assert.deepEqual(
        (await shown(CHI, [old, fresh])).map((row) => [row.book_id, row.title]),
        [
          [old, "架空の図書館"],
          [fresh, "まだない本の正しい題"],
        ],
      );
      // Moved by an edited ISBN, a book waits its ten minutes again.
      await as(CHI, "update books set isbn = $2 where id = $1", [old, X3]);
      assert.deepEqual(await shown(CHI, [old]), []);
      // A book the master has nothing for is not listed; at most 200 are asked.
      await age(id(2, 3), 60);
      assert.deepEqual(await shown(AKI, [id(2, 3)]), []);
      const many = Array.from({ length: 199 }, (_, i) => id(8, i));
      assert.equal((await shown(null, [...many, akis])).length, 1);
      assert.equal((await shown(null, [...many, id(8, 999), akis])).length, 0);
    },
  );

  await check(
    "nobody reaches the master's tables, its asking or the operator's tools through the API",
    async () => {
      for (const visitor of [null, AKI]) {
        for (const table of [
          "private.edition_sources",
          "private.edition_fixes",
          "private.book_checks",
          "private.bibliography_review",
        ])
          await refused(
            () => as(visitor, `select * from ${table}`),
            /permission denied/,
            `${visitor} reads ${table}`,
          );
        for (const call of [
          "select private.bib_tick()",
          "select private.bib_send()",
          "select private.bib_receive()",
          `select private.fix_bibliography('${id(2, 1)}', 'title', '"x"')`,
          `select private.refetch_bibliography('${id(2, 1)}')`,
          `select private.withdraw_bibliography('${id(2, 1)}', 'openbd')`,
          `select * from private.edition_bibliography('${id(2, 1)}')`,
          `select * from private.ndl_answer('', '${X1}')`,
        ])
          await refused(
            () => as(visitor, call),
            /permission denied/,
            `${visitor}: ${call}`,
          );
      }
      const granted = await rows<{ role: string; ok: boolean }>(
        `select r.role, has_function_privilege(r.role, p.oid, 'execute') as ok
         from (values ('anon'), ('authenticated')) r (role)
         cross join pg_proc p
         where p.pronamespace = 'private'::regnamespace
           and p.proname in ('bib_tick', 'bib_send', 'bib_receive', 'bib_take', 'bib_next',
             'edition_bibliography', 'ndl_answer', 'openbd_answer', 'isbn13', 'fix_bibliography',
             'unfix_bibliography', 'refetch_bibliography', 'withdraw_bibliography',
             'allow_bibliography', 'edition_asked', 'book_checked', 'bib_edition_of')
           and has_function_privilege(r.role, p.oid, 'execute')`,
      );
      assert.deepEqual(granted, []);
    },
  );

  await check(
    "the operator asks again first, withdraws a source's data so it is not asked again (an answer on its way is not kept), and allows it back",
    async () => {
      const book = id(2, 1);
      await rows(
        "update private.edition_sources set next_at = now() + interval '1 day' where request_id is null",
      );
      await rows("select private.refetch_bibliography($1)", [book]);
      assert.equal((await kept(X1, "ndl")).asked, true);
      await tick();
      const asked = await questions();
      assert.ok(asked.some((q) => q.url.includes(`isbn%3D%22${X1}%22`)));
      const open = asked.find((q) =>
        q.url.startsWith("https://api.openbd.jp/"),
      );
      assert.ok(open && open.url.includes(X1));
      // openBD is withdrawn while its question is out: the answer is dropped.
      await rows("select private.withdraw_bibliography($1, 'openbd')", [book]);
      await answerAll(db, { [X1]: LIBRARY_X1 }, { [X1]: OPENBD_X1 });
      await tick();
      const withdrawn = await kept(X1, "openbd");
      assert.equal(withdrawn.state, "withdrawn");
      assert.deepEqual(withdrawn.fields, {});
      assert.equal(withdrawn.out, false);
      assert.equal((await kept(X1, "ndl")).asked, false);
      await rows(
        "update private.edition_sources set next_at = now() - interval '1 second' where state = 'withdrawn'",
      );
      await tick();
      assert.ok(
        !(await questions()).some(
          (q) =>
            q.url.startsWith("https://api.openbd.jp/") && q.url.includes(X1),
        ),
      );
      await refused(
        () => rows("select private.allow_bibliography($1, 'ndl')", [book]),
        /was not withdrawn/,
        "allowing a source that was not withdrawn",
      );
      await rows("select private.allow_bibliography($1, 'openbd')", [book]);
      assert.equal((await kept(X1, "openbd")).state, "waiting");
      await refused(
        () => rows("select private.refetch_bibliography($1)", [id(2, 3)]),
        /nothing to ask about/,
        "a book without an ISBN",
      );
    },
  );

  await check(
    "an edition whose books are all gone is not asked about",
    async () => {
      await register(AKI, id(2, 6), numbered(6), "消える本");
      await rows("delete from books where id = $1", [id(2, 6)]);
      await rows(
        "update private.edition_sources set next_at = now() + interval '1 day' where request_id is null",
      );
      await rows(
        "update private.edition_sources s set next_at = now() from editions e where e.id = s.edition_id and e.isbn = $1",
        [numbered(6)],
      );
      await tick();
      assert.ok(!(await questions()).some((q) => q.url.includes(numbered(6))));
      assert.equal((await kept(numbered(6), "ndl")).state, "waiting");
    },
  );
  await db.close();
  console.log(`${passed} bibliography checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
