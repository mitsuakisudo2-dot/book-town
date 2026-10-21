// Takes the National Diet Library's records of books with an ISBN into the
// catalog (item 5 of the plan; supabase/migrations/*_library_catalog.sql,
// docs/09「図書館の目録」). .github/workflows/catalog-import.yml runs it.
//
//   tsx scripts/catalog-import.ts trial [--most 10000] [--from 2026-07-01]
//       the newest books (the records in the making, then the finished
//       ones) from a day on, until --most ISBNs were sent
//   tsx scripts/catalog-import.ts daily
//       each day's changes since the last run (OAI-PMH ListRecords), the
//       records deleted too
//   tsx scripts/catalog-import.ts files [--hours 5]
//       the month's all-records files, one after another from where the
//       last run stopped, for at most --hours
//
// Each record is read with the database's own private.ndl_answer, in a
// PGlite with every migration applied, so what the catalog holds is read
// exactly as the library's answers to the registrations are. Only the
// fields it reads are sent (catalog_api.take), a thousand ISBNs at a time,
// through psql to the database's session pooler, logged in as the role
// catalog_import, which can do this and nothing else.
//
// The library: one request at a time, none at once (its rules ask for no
// parallel access), named as BookTown, waiting a second between them and
// longer when it is busy. Its records are CC BY compatible (the credits page
// says where they come from).
//
// The repository and its Actions logs are public, and the ISBNs taken
// include those of books readers registered privately: only counts, days and
// file numbers are printed, never an ISBN, a title or a row, and a database
// error is printed terse, its digits run hidden.

import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDatabase } from "../tests/fixtures/pglite-supabase";

const OAI = "https://ndlsearch.ndl.go.jp/api/oaipmh";
const FILES = "https://ndlsearch.ndl.go.jp/files/oaipmhAllData/xmlList.txt";
const AGENT = "BookTown (+https://booktown.page)";
/** The library's own records: its catalogue, finished and in the making. */
export const LIBRARY_SETS = ["iss-ndl-opac", "iss-ndl-opac-inprocess"];
const SEND = 1000;
/** A day of changes larger than this is a bulk update: the files are for it. */
const BULK = 100_000;

export type LibraryRecord = {
  /** The OAI identifier's last part, R100000002-I…. */
  id: string;
  deleted: boolean;
  sets: string[];
  /** The record's rdf:RDF, as the SRU's recordData holds it. */
  rdf: string | null;
};

export type CatalogRow = {
  isbn: string;
  record: string;
  status: string | null;
  isbns: number;
  fields: Record<string, unknown>;
};

/** The records of one ListRecords answer (or one all-records file). */
export function recordsOf(xml: string): {
  records: LibraryRecord[];
  token: string | null;
  size: number | null;
} {
  const records: LibraryRecord[] = [];
  for (const part of xml.split("<record>").slice(1)) {
    const header = part.slice(0, part.indexOf("</header>") + 1);
    const id = /<identifier>[^<]*:([^:<]+)<\/identifier>/.exec(header)?.[1];
    if (!id) continue;
    const sets = [...header.matchAll(/<setSpec>([^<]*)<\/setSpec>/g)].map((m) => m[1]);
    const deleted = /<header[^>]*status="deleted"/.test(part);
    const rdf = deleted ? null : (/<rdf:RDF[\s\S]*<\/rdf:RDF>/.exec(part)?.[0] ?? null);
    records.push({ id, deleted, sets, rdf });
  }
  const token = /<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/.exec(xml)?.[1] ?? null;
  const size = /<resumptionToken[^>]*completeListSize="(\d+)"/.exec(xml)?.[1];
  return { records, token, size: size ? Number(size) : null };
}

/** Whether a record is one of the library's own (the sets the master asks). */
export const isLibrarys = (record: LibraryRecord) =>
  record.sets.some((set) => LIBRARY_SETS.includes(set));

/** The ISBNs a record gives for itself (not a series' ISBN). */
export function isbnsOf(rdf: string): string[] {
  return [
    ...rdf.matchAll(
      /<dcterms:identifier rdf:datatype="http:\/\/ndl\.go\.jp\/dcndl\/terms\/ISBN">([^<]*)<\/dcterms:identifier>/g,
    ),
  ].map((m) => m[1]);
}

/** A record in the envelope of an SRU answer, as private.ndl_answer reads. */
export const asAnswer = (rdf: string) =>
  '<?xml version="1.0" encoding="UTF-8"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">' +
  "<version>1.2</version><numberOfRecords>1</numberOfRecords><records><record>" +
  "<recordSchema>info:srw/schema/1/dc-v1.1</recordSchema><recordPacking>xml</recordPacking>" +
  `<recordData>${rdf}</recordData><recordPosition>1</recordPosition></record></records>` +
  "</searchRetrieveResponse>";

/**
 * The catalog rows of records: one for each ISBN a library record gives
 * for itself that private.ndl_answer finds in it.
 */
export async function rowsOf(db: PGlite, records: LibraryRecord[]): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (const record of records) {
    if (record.deleted || !record.rdf || !isLibrarys(record)) continue;
    const raw = isbnsOf(record.rdf);
    if (raw.length === 0) continue;
    const found = await db.query<{
      isbn: string;
      status: string | null;
      fields: Record<string, unknown>;
    }>(
      `select k.isbn, a.status, a.fields
       from (select distinct private.isbn13(v) as isbn from unnest($2::text[]) v) k
       cross join lateral private.ndl_answer($1, k.isbn) a
       where k.isbn is not null and a.state = 'found'
       order by k.isbn`,
      [asAnswer(record.rdf), raw],
    );
    for (const row of found.rows) {
      rows.push({
        isbn: row.isbn,
        record: record.id,
        status: row.status,
        isbns: raw.length,
        fields: row.fields,
      });
    }
  }
  return rows;
}

/** Where the rows go: the database, or (for the tests) a PGlite. */
export type Target = {
  take(rows: CatalogRow[], batch: string): Promise<Record<string, number>>;
  gone(records: string[]): Promise<number>;
  mark(name: string): Promise<string | null>;
  setMark(name: string, mark: string): Promise<void>;
};

const counted = (value: unknown): Record<string, number> =>
  typeof value === "string" ? JSON.parse(value) : (value as Record<string, number>);

export function pgliteTarget(db: PGlite): Target {
  return {
    async take(rows, batch) {
      const r = await db.query<{ r: unknown }>("select private.catalog_take($1::jsonb, $2) r", [
        JSON.stringify(rows),
        batch,
      ]);
      return counted(r.rows[0].r);
    },
    async gone(records) {
      const r = await db.query<{ n: number }>("select private.catalog_gone($1::text[]) n", [
        records,
      ]);
      return r.rows[0].n;
    },
    async mark(name) {
      const r = await db.query<{ mark: string }>(
        "select mark from private.catalog_progress where name = $1",
        [name],
      );
      return r.rows[0]?.mark ?? null;
    },
    async setMark(name, mark) {
      await db.query(
        `insert into private.catalog_progress (name, mark) values ($1, $2)
         on conflict (name) do update set mark = excluded.mark, updated_at = now()`,
        [name, mark],
      );
    },
  };
}

/** What psql prints for an error, without anything that could be a row. */
const hidden = (text: string) =>
  text
    .split("\n")
    .filter((line) => /^(psql:|ERROR|FATAL)/.test(line))
    .map((line) => line.replace(/\d{5,}/g, "…").slice(0, 200))
    .join("\n");

/** Runs one statement through psql and answers what it printed. */
function psql(url: string, sql: string): Promise<string> {
  return new Promise((done, fail) => {
    const run = spawn(
      "psql",
      [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", "-v", "SHOW_CONTEXT=never"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    run.stdout.on("data", (d) => (out += d));
    run.stderr.on("data", (d) => (err += d));
    run.on("close", (code) =>
      code === 0 ? done(out.trim()) : fail(new Error(hidden(err) || `psql stopped (${code})`)),
    );
    run.stdin.end(`\\set VERBOSITY terse\n\\set SHOW_CONTEXT never\n${sql}\n`);
  });
}

/** A literal no row can end early: dollar quoting with a tag the text lacks. */
function quoted(text: string): string {
  let tag = "c";
  while (text.includes(`$${tag}$`)) tag += "c";
  return `$${tag}$${text}$${tag}$`;
}

/**
 * The rows through catalog_api, as the role catalog_import (docs/09
 * 「本番の設定」): run sends one statement and answers what psql -t -A
 * prints for it.
 */
export function sqlTarget(run: (sql: string) => Promise<string>): Target {
  return {
    async take(rows, batch) {
      return counted(await run(`select catalog_api.take(${quoted(JSON.stringify(rows))}::jsonb, ${quoted(batch)});`));
    },
    async gone(records) {
      return Number(
        await run(
          `select catalog_api.gone(array(select jsonb_array_elements_text(${quoted(JSON.stringify(records))}::jsonb)));`,
        ),
      );
    },
    async mark(name) {
      const out = await run(`select catalog_api.mark(${quoted(name)});`);
      return out === "" ? null : out;
    },
    async setMark(name, mark) {
      await run(`select catalog_api.set_mark(${quoted(name)}, ${quoted(mark)});`);
    },
  };
}

export const psqlTarget = (url: string): Target => sqlTarget((sql) => psql(url, sql));

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Asks the library, one request at a time, again when it is busy. */
export async function ask(url: string, tries = 6): Promise<Response> {
  let wait = 5_000;
  for (let n = 1; ; n++) {
    await pause(1_000);
    try {
      const answer = await fetch(url, {
        headers: { "User-Agent": AGENT },
        signal: AbortSignal.timeout(120_000),
      });
      if (answer.ok) return answer;
      if (n >= tries || (answer.status < 500 && answer.status !== 429)) {
        throw new Error(`the library answered ${answer.status}`);
      }
    } catch (error) {
      if (n >= tries) throw error;
    }
    await pause(wait);
    wait *= 2;
  }
}

/** Each ListRecords answer of one set from a day on (until a day, if given). */
export async function* changes(set: string, from: string, until?: string) {
  let url =
    `${OAI}?verb=ListRecords&metadataPrefix=dcndl&set=${set}&from=${from}` +
    (until ? `&until=${until}` : "");
  for (;;) {
    const answer = await ask(url);
    const xml = await answer.text();
    if (xml.includes('code="noRecordsMatch"')) return;
    const page = recordsOf(xml);
    yield page;
    if (!page.token) return;
    url = `${OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(page.token)}`;
  }
}

type Tally = Record<string, number>;
const add = (tally: Tally, more: Record<string, number>) => {
  for (const [key, n] of Object.entries(more)) tally[key] = (tally[key] ?? 0) + n;
};
const said = (what: string, tally: Tally) =>
  console.log(`${what}: ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ")}`);

/** Sends rows a thousand at a time. */
async function send(target: Target, rows: CatalogRow[], batch: string, tally: Tally) {
  for (let i = 0; i < rows.length; i += SEND) {
    add(tally, await target.take(rows.slice(i, i + SEND), batch));
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** The newest books from a day on, until `most` ISBNs were sent. */
export async function trial(db: PGlite, target: Target, most: number, from: string) {
  const tally: Tally = { sent: 0 };
  for (const set of ["iss-ndl-opac-inprocess", "iss-ndl-opac-national"]) {
    for await (const page of changes(set, from)) {
      const rows = (await rowsOf(db, page.records)).slice(0, most - tally.sent);
      await send(target, rows, "trial", tally);
      tally.sent += rows.length;
      if (tally.sent >= most) break;
    }
    if (tally.sent >= most) break;
  }
  said("trial", tally);
}

/** Each day's changes since the last run, for the library's two sets. */
export async function daily(db: PGlite, target: Target) {
  const started = today();
  for (const set of LIBRARY_SETS) {
    const name = `oai-${set}`;
    const from = (await target.mark(name)) ?? dayBefore(started, 2);
    const tally: Tally = { sent: 0, deleted: 0, gone: 0 };
    let checked = false;
    for await (const page of changes(set, from)) {
      if (!checked && (page.size ?? 0) > BULK) {
        console.log(`${set}: ${page.size} changes since ${from}, a bulk update; take the files instead`);
        return;
      }
      checked = true;
      const rows = await rowsOf(db, page.records);
      await send(target, rows, "oai", tally);
      tally.sent += rows.length;
      const gone = page.records.filter((r) => r.deleted && isLibrarys(r)).map((r) => r.id);
      if (gone.length > 0) {
        tally.deleted += gone.length;
        tally.gone += await target.gone(gone);
      }
    }
    // The next run starts a day back: a change stamped late is not missed.
    await target.setMark(name, dayBefore(started, 1));
    said(`${set} since ${from}`, tally);
  }
}

/** The month's files, from where the last run stopped, for `hours` at most. */
export async function files(db: PGlite, target: Target, hours: number) {
  const list = (await (await ask(FILES)).text()).split("\n").map((l) => l.trim()).filter(Boolean);
  const cut = /dcndl_all_(\d{8})_/.exec(list[0] ?? "")?.[1];
  if (!cut) throw new Error("the list of files has no date");
  const name = `files-${cut}`;
  const batch = `files-${cut}`;
  let next = Number((await target.mark(name)) ?? 0);
  const end = Date.now() + hours * 3_600_000;
  const tally: Tally = { files: 0, sent: 0 };
  while (next < list.length && Date.now() < end) {
    const xml = gunzipSync(Buffer.from(await (await ask(list[next])).arrayBuffer())).toString("utf8");
    const rows = await rowsOf(db, recordsOf(xml).records);
    await send(target, rows, batch, tally);
    tally.sent += rows.length;
    tally.files += 1;
    next += 1;
    await target.setMark(name, String(next));
    if (tally.files % 100 === 0) said(`files ${next}/${list.length}`, tally);
  }
  said(`files ${next}/${list.length}`, tally);
}

/**
 * The database's session pooler, as .github/workflows/deploy-database.yml
 * finds it, logged in as catalog_import (the environment catalog's password).
 */
async function poolerTarget(): Promise<Target> {
  const project = process.env.SUPABASE_PROJECT_ID;
  const password = process.env.CATALOG_DB_PASSWORD;
  if (!project || !password) throw new Error("SUPABASE_PROJECT_ID and CATALOG_DB_PASSWORD are needed");
  const region = process.env.SUPABASE_REGION ?? "ap-northeast-1";
  // The project's own cluster says why it refused (a password, say); the
  // other only that it has no such project. Both are told.
  const refused: string[] = [];
  for (const cluster of ["aws-0", "aws-1"]) {
    const url = `postgresql://catalog_import.${project}:${encodeURIComponent(password)}@${cluster}-${region}.pooler.supabase.com:5432/postgres`;
    try {
      await psql(url, "select 1;");
      return psqlTarget(url);
    } catch (error) {
      refused.push(`${cluster}: ${(error as Error).message}`);
    }
  }
  throw new Error(`the database's pooler refused the login\n${refused.join("\n")}`);
}

function option(args: string[], name: string, otherwise: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : otherwise;
}

async function main(args: string[]) {
  const mode = args[0];
  if (!["trial", "daily", "files"].includes(mode)) {
    throw new Error("say trial, daily or files");
  }
  const target = process.env.CATALOG_DATABASE_URL
    ? psqlTarget(process.env.CATALOG_DATABASE_URL)
    : await poolerTarget();
  const db = await migratedDatabase();
  if (mode === "trial") {
    const most = Number(option(args, "most", "10000"));
    await trial(db, target, most, option(args, "from", dayBefore(today(), 90)));
  } else if (mode === "daily") {
    await daily(db, target);
  } else {
    await files(db, target, Number(option(args, "hours", "5")));
  }
}

if (process.argv[1]?.endsWith("catalog-import.ts")) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error: Error) => {
      console.error(String(error.message).replace(/\d{5,}/g, "…").slice(0, 300));
      process.exit(1);
    },
  );
}
