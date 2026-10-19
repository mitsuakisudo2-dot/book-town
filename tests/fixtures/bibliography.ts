import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
  oneMomentEach,
} from "./pglite-supabase";

// The bibliographic master's tests share these (tests/db-bibliography.test.ts,
// tests/db-holds.test.ts): ISBNs, answers in the shape the sources give them
// (made up: no real record is copied into the repository), a database with
// the migrations, and helpers that act as readers, the tick and pg_net.

const FILES = migrationFiles();

/** A valid ISBN-13 from its first twelve digits. */
export function isbn(first: string): string {
  const sum = [...first].reduce(
    (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return first + ((10 - (sum % 10)) % 10);
}
/** The same book's ISBN-10, as old records write it (978 books only). */
export function isbn10(full: string): string {
  const nine = full.slice(3, 12);
  const sum = [...nine].reduce((t, d, i) => t + Number(d) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return nine + (check === 10 ? "X" : String(check));
}
export const hyphened = (full: string) =>
  `${full.slice(0, 3)}-${full.slice(3, 4)}-${full.slice(4, 6)}-${full.slice(6, 12)}-${full.slice(12)}`;
export const numbered = (n: number) =>
  isbn("97849990" + String(n).padStart(4, "0"));

// Answers in the shape the sources give them ----------------------------------------

export const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Agent = { name: string; reading?: string; about?: string };
export type Ndl = {
  category?: string;
  status?: string;
  bibId?: string;
  isbns: string[];
  title: string;
  plainTitle?: string;
  reading?: string;
  volume?: string;
  /** The volume's reading: 1 for 巻1, ジョウ for 上 (見本). */
  volumeReading?: string;
  /** Other titles (dcndl:alternative), with their readings. */
  alternatives?: { value: string; reading?: string }[];
  /** dcterms:description, as 原タイトル: FAHRENHEIT 451 (見本). */
  descriptions?: string[];
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

export const NS = [
  'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
  'xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:dcterms="http://purl.org/dc/terms/"',
  'xmlns:dcndl="http://ndl.go.jp/dcndl/terms/"',
  'xmlns:foaf="http://xmlns.com/foaf/0.1/"',
].join(" ");

/** One record of the library's SRU answer (recordSchema=dcndl). */
export function ndlRecord(r: Ndl): string {
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
  // Who holds the book: links to other libraries' records (what an onlyBib
  // answer still has), and those records themselves (what it leaves out).
  const held = Array.from({ length: r.holders ?? 0 }, (_, i) => i);
  const holderLinks = held
    .map(
      (i) =>
        `<dcndl:record rdf:resource="https://ndlsearch.ndl.go.jp/books/R100000001-I9${i}#item"/>`,
    )
    .join("");
  const holders = held
    .map(
      (i) =>
        `<dcndl:Item rdf:about="https://ndlsearch.ndl.go.jp/books/R100000001-I9${i}#item"><dcndl:holdingAgent><foaf:Agent><foaf:name>図書館${i}</foaf:name></foaf:Agent></dcndl:holdingAgent></dcndl:Item>`,
    )
    .join("");
  return `<record><recordSchema>info:srw/schema/1/dc-v1.1</recordSchema><recordPacking>xml</recordPacking><recordData>
<rdf:RDF ${NS}>
  <dcndl:BibAdminResource rdf:about="${about}">
    ${text("dcndl:catalogingStatus", r.status === "" ? undefined : (r.status ?? "C7"))}
    <dcndl:bibRecordCategory>${category}</dcndl:bibRecordCategory>
    <dcndl:record rdf:resource="${about}#material"/>
  </dcndl:BibAdminResource>
  <dcndl:BibResource rdf:about="${about}#material">
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/JPNO">99999999</dcterms:identifier>
    ${r.bibId ? `<dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/NDLBibID">${r.bibId}</dcterms:identifier>` : ""}
    <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/TOHANMARCNO">88888888</dcterms:identifier>
    ${r.isbns.map((i) => `<dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">${i}</dcterms:identifier>`).join("")}
    <dcndl:partInformation><rdf:Description><dcterms:title>収めた一編</dcterms:title><dcndl:transcription>オサメタ イッペン</dcndl:transcription></rdf:Description></dcndl:partInformation>
    ${(r.alternatives ?? [{ value: "ANOTHER TITLE" }]).map((a) => described("dcndl:alternative", a.value, a.reading)).join("")}
    ${text("dcterms:title", r.plainTitle ?? r.title)}
    ${described("dc:title", r.title, r.reading)}
    ${r.volume ? described("dcndl:volume", r.volume, r.volumeReading ?? "カン") : ""}
    ${(r.descriptions ?? []).map((d) => text("dcterms:description", d)).join("")}
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
    ${r.publisher ? `<dcterms:publisher><foaf:Agent><foaf:name>${escape(r.publisher)}</foaf:name><dcndl:transcription>カクウ ショボウ</dcndl:transcription><dcndl:location>東京</dcndl:location></foaf:Agent></dcterms:publisher>` : ""}
    ${text("dcterms:date", r.date)}
    ${r.issued ? `<dcterms:issued rdf:datatype="http://purl.org/dc/terms/W3CDTF">${r.issued}</dcterms:issued>` : ""}
    <dcterms:subject><rdf:Description><rdf:value>架空の主題</rdf:value><dcndl:transcription>カクウ ノ シュダイ</dcndl:transcription></rdf:Description></dcterms:subject>
    ${(r.subjects ?? []).map((s) => `<dcterms:subject rdf:resource="${s}"/>`).join("")}
  </dcndl:BibResource>
  <dcndl:BibResource rdf:about="${about}#material">${holderLinks}</dcndl:BibResource>
  ${holders}
</rdf:RDF></recordData><recordPosition>1</recordPosition></record>`;
}

/** The library's SRU answer with these records. */
export const sru = (...records: Ndl[]) =>
  `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.2</version><numberOfRecords>${records.length}</numberOfRecords><records>${records.map(ndlRecord).join("")}</records></searchRetrieveResponse>`;
/** The library's SRU answer with a diagnostic instead. */
export const diagnostic = (message: string) =>
  `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><diagnostics><diagnostic xmlns="http://www.loc.gov/zing/srw/diagnostic/"><uri>info:srw/diagnostic/1/1</uri><details>An error occurred</details><message>${message}</message></diagnostic></diagnostics></searchRetrieveResponse>`;

export type OpenbdPerson = {
  name: string;
  reading?: string;
  roles?: string[];
  note?: string;
};
/** One element of openBD's answer (its summary and the ONIX it is made from). */
export function openbd(o: {
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

export type Visitor = string | null;

export async function migrated(upTo?: string): Promise<PGlite> {
  // What is asked first follows the order the books were placed in, which
  // the checks count on.
  const db = oneMomentEach(new PGlite());
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => (upTo ? file < upTo : true)))
    await db.exec(migrationText(file));
  return db;
}

export function helpers(db: PGlite) {
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
  /** The judging alone, as each tick runs it after reading the answers. */
  const judge = () => rows("select private.bib_judge()");
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
           (s.next_at - s.answered_at)::text as wait, private.bib_owed(s.edition_id, s.settled_for, s.refetch_at) is not null as asked,
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
  /** As if this many minutes had gone by since everything written so far. */
  const later = (minutes: number) =>
    rows(
      `with i as (select make_interval(mins => $1) as i),
         b as (update private.book_checks set placed_at = placed_at - (select i from i))
       update private.edition_sources set
         answered_at = answered_at - (select i from i), found_at = found_at - (select i from i),
         found_sent_at = found_sent_at - (select i from i),
         title_sent_at = title_sent_at - (select i from i),
         title_kept_at = title_kept_at - (select i from i),
         next_at = next_at - (select i from i), settled_at = settled_at - (select i from i),
         refetch_at = refetch_at - (select i from i),
         sent_at = sent_at - (select i from i),
         sent_for = sent_for - (select i from i), tried_for = tried_for - (select i from i),
         settled_for = settled_for - (select i from i),
         found_for = found_for - (select i from i), title_for = title_for - (select i from i)`,
      [minutes],
    ).then(() =>
      // And, from 20261119000000_bibliography_fetching.sql, the readers'
      // turns and when the library last said it no longer had a record.
      db.exec(
        `do $$ begin
           if to_regclass('private.bib_pace') is not null then
             update private.bib_pace set next_at = next_at - make_interval(mins => ${Number(minutes)});
             update private.edition_sources
             set lost_at = lost_at - make_interval(mins => ${Number(minutes)});
           end if;
         end $$`,
      ),
    );
  /**
   * Nothing owed or due: no source is asked anything until a book moves, and
   * no reader's books wait their turn.
   */
  const quiet = () =>
    rows(
      `update private.edition_sources set settled_at = now(), refetch_at = null,
         settled_for = now(), tried_for = now(), next_at = now() + interval '1 day'
       where request_id is null`,
    ).then(() =>
      db.exec(
        `do $$ begin
           if to_regclass('private.bib_pace') is not null then
             update private.edition_sources set owed = false where request_id is null;
             delete from private.bib_pace;
           end if;
         end $$`,
      ),
    );
  /** Every question out goes unanswered past its fifteen minutes; then quiet. */
  const settle = async () => {
    await rows(
      `update private.edition_sources set sent_at = now() - interval '16 minutes'
       where request_id is not null`,
    );
    await rows("select private.bib_receive()");
    await quiet();
  };
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
    judge,
    questions,
    answer,
    kept,
    due,
    age,
    later,
    quiet,
    settle,
    shown,
  };
}

/** Answers every question out: the library from its records, openBD from its elements. */
export async function answerAll(
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
export async function catalog(db: PGlite) {
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
