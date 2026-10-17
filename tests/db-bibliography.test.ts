import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  MIGRATIONS,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import {
  answerAll,
  catalog,
  diagnostic,
  helpers,
  hyphened,
  isbn10,
  migrated,
  numbered,
  openbd,
  sru,
} from "./fixtures/bibliography";

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

const X1 = numbered(1);
const X2 = numbered(2);
const X3 = numbered(3);

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

type Check = (name: string, run: () => Promise<void>) => Promise<void>;

/**
 * The order things are asked in, an ask while a question is out, answers
 * that come back odd or late, the operator's list and when the library is
 * asked again: on a database of their own.
 */
async function edgeChecks(check: Check) {
  const db = await migrated();
  const {
    rows,
    as,
    refused,
    register,
    tick,
    judge,
    questions,
    answer,
    kept,
    due,
    later,
    settle,
    shown,
  } = helpers(db);
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
  `);
  const Y = (n: number) => numbered(100 + n);
  const editionOf = async (isbnOf: string) =>
    (
      await rows<{ id: string }>("select id from editions where isbn = $1", [
        isbnOf,
      ])
    )[0].id;
  /** The ISBN each question out to the library is about, oldest first. */
  const libraryAsked = async () =>
    (await questions())
      .filter((q) => q.url.startsWith("https://ndlsearch.ndl.go.jp/"))
      .map((q) => decodeURIComponent(q.url).match(/isbn="(\d{13})"/)?.[1]);
  /** The ISBNs of each question out to openBD, in the order asked. */
  const openbdAsked = async () =>
    (await questions())
      .filter((q) => q.url.startsWith("https://api.openbd.jp/"))
      .map((q) => new URL(q.url).searchParams.get("isbn")?.split(","));

  await check(
    "what is owed a question goes first, oldest first, whether its edition is new, old or there before this file; then the library's records in the making, those not found, and the rest",
    async () => {
      for (const n of [1, 2, 3, 4, 5])
        await register(AKI, id(3, n), Y(n), `本${n}`);
      // As if they had been answered before: Y1 and Y5 found, Y2 not found,
      // Y3 in the making at the library. Y4 was there before this file, never
      // asked about: its book is owed a question from when it was registered.
      // Each fell due a while ago.
      await rows(
        `update private.edition_sources s set state = v.state,
           settled_at = case when v.state <> 'waiting' then now() end,
           settled_for = case when v.state <> 'waiting' then now() end,
           tried_for = case when v.state <> 'waiting' then now() end,
           status = case when s.source = 'ndl' then v.status end, next_at = now() - v.ago
         from editions e, (values ($1, 'found', null, interval '3 days'),
           ($2, 'missing', null, interval '2 days'), ($3, 'found', 'C3', interval '1 day'),
           ($4, 'waiting', null, interval '1 hour'), ($5, 'found', null, interval '4 days'))
           v (isbn, state, status, ago)
         where e.id = s.edition_id and e.isbn = v.isbn`,
        [Y(1), Y(2), Y(3), Y(4), Y(5)],
      );
      // Then Aki registers Y6, which nobody had; Ben, Y5, which Aki had; and
      // Aki, Y7.
      await register(AKI, id(3, 6), Y(6), "本6");
      await register(BEN, id(3, 15), Y(5), "本5");
      await register(AKI, id(3, 7), Y(7), "本7");
      for (let turn = 0; turn < 7; turn++) await tick();
      assert.deepEqual(await libraryAsked(), [
        Y(4),
        Y(6),
        Y(5),
        Y(7),
        Y(3),
        Y(2),
        Y(1),
      ]);
      assert.deepEqual(await openbdAsked(), [
        [Y(4), Y(6), Y(5), Y(7), Y(2), Y(1), Y(3)],
      ]);
      await settle();
    },
  );

  /** Every question out answered: the library and openBD found what they were asked. */
  const answerFound = async () => {
    const asked = [
      ...((await libraryAsked()) as string[]),
      ...((await openbdAsked()).flat() as string[]),
    ];
    await answerAll(
      db,
      Object.fromEntries(asked.map((i) => [i, sru({ isbns: [i], title: i })])),
      Object.fromEntries(asked.map((i) => [i, openbd({ isbn: i, title: i })])),
    );
  };

  await check(
    "a book that leaves its edition takes what it was owed with it: back again, it waits its turn as in an edition nobody had",
    async () => {
      // Aki has Y12, answered; nobody has Y11.
      await register(AKI, id(3, 12), Y(12), "本12");
      await tick();
      await answerFound();
      await tick();
      await settle();
      for (const [bens, there, away, others] of [
        [id(3, 21), Y(11), Y(13), [Y(14), Y(15)]],
        [id(3, 22), Y(12), Y(16), [Y(17), Y(18)]],
      ] as const) {
        // Ben registers it and moves it away before anything is asked, then
        // registers two more, then moves it back (the edition he moved it to
        // is left with no book, and is not asked about).
        await register(BEN, bens, there, "行き来する本");
        await as(BEN, "update books set isbn = $2 where id = $1", [bens, away]);
        for (const i of others)
          await register(BEN, id(4, Number(i.slice(8, 12))), i, "ほかの本");
        await as(BEN, "update books set isbn = $2 where id = $1", [
          bens,
          there,
        ]);
        for (let turn = 0; turn < 3; turn++) await tick();
        assert.deepEqual(await libraryAsked(), [...others, there], there);
        await settle();
      }
    },
  );

  await check(
    "books registered together are asked about in an order nothing in their editions' past decides",
    async () => {
      const together = [Y(1), Y(19), Y(20), Y(21)];
      await as(
        BEN,
        `insert into books (id, isbn, title, created_by)
         select gen_random_uuid(), i, '一緒の本', $2 from unnest($1::text[]) i`,
        [together, BEN],
      );
      for (let turn = 0; turn < 4; turn++) await tick();
      assert.deepEqual(
        await libraryAsked(),
        (
          await rows<{ isbn: string }>(
            "select isbn from editions where isbn = any ($1::text[]) order by id",
            [together],
          )
        ).map((e) => e.isbn),
      );
      await settle();
    },
  );

  await check(
    "how long to wait after an answer counts from the book's placement, and a question sent before it does not count",
    async () => {
      // Y2 was not found three times, Y3 failed three times.
      await rows(
        `update private.edition_sources s set misses = 3, failures = 3
         from editions e where e.id = s.edition_id and e.isbn = any ($1::text[])`,
        [[Y(2), Y(3)]],
      );
      await register(BEN, id(3, 32), Y(2), "本2");
      await register(BEN, id(3, 33), Y(3), "本3");
      await tick();
      await tick();
      for (const q of await questions())
        await answer(
          q.id,
          q.url.includes(Y(3))
            ? "<html>busy</html>"
            : diagnostic("Record does not exist"),
          q.url.includes(Y(3)) ? 503 : 200,
        );
      await tick();
      const two = await kept(Y(2), "ndl");
      assert.equal(two.misses, 1);
      assert.equal(two.wait, "1 day");
      const three = await kept(Y(3), "ndl");
      assert.equal(three.failures, 1);
      assert.equal(three.wait, "00:10:00");
      await settle();
      // Aki's question about Y22 is out when Ben registers it; it fails, and
      // Ben's goes at once, counting from nothing.
      await register(AKI, id(3, 40), Y(22), "本22");
      await tick();
      await register(BEN, id(3, 41), Y(22), "本22");
      const [q] = (await questions()).filter((x) =>
        x.url.startsWith("https://ndlsearch.ndl.go.jp/"),
      );
      await answer(q.id, "<html>busy</html>", 503);
      await tick();
      assert.equal((await kept(Y(22), "ndl")).failures, 0);
      assert.deepEqual(await libraryAsked(), [Y(22)]);
      await settle();
    },
  );

  const EIGHT = Y(8);
  const answerEight = () =>
    answerAll(
      db,
      { [EIGHT]: sru({ isbns: [EIGHT], title: "八冊目" }) },
      { [EIGHT]: openbd({ isbn: EIGHT, title: "八冊目" }) },
    );

  await check(
    "a book placed while a question is out, and the operator asking again then, get another question once it is answered",
    async () => {
      await register(AKI, id(3, 8), EIGHT, "八冊目");
      await tick();
      assert.deepEqual(await libraryAsked(), [EIGHT]);
      await register(BEN, id(3, 18), EIGHT, "八冊目");
      assert.equal((await kept(EIGHT, "ndl")).asked, true);
      await answerEight();
      await tick();
      // The answer settles Aki's ask, not Ben's: the next question goes in
      // the same turn, and only its answer shows on Ben's book.
      const library = await kept(EIGHT, "ndl");
      assert.equal(library.state, "found");
      assert.equal(library.asked, true);
      assert.deepEqual(await libraryAsked(), [EIGHT]);
      assert.deepEqual(await openbdAsked(), [[EIGHT]]);
      await later(11);
      await judge();
      assert.equal((await shown(AKI, [id(3, 8)])).length, 1);
      assert.deepEqual(await shown(BEN, [id(3, 18)]), []);
      await answerEight();
      await tick();
      assert.equal((await kept(EIGHT, "ndl")).asked, false);
      assert.deepEqual(await questions(), []);
      assert.equal((await shown(BEN, [id(3, 18)])).length, 1);
      // The operator asks again, and again while that question is out.
      await rows("select private.refetch_bibliography($1)", [id(3, 8)]);
      await tick();
      assert.deepEqual(await libraryAsked(), [EIGHT]);
      await rows("select private.refetch_bibliography($1)", [id(3, 8)]);
      await answerEight();
      await tick();
      assert.deepEqual(await libraryAsked(), [EIGHT]);
      await answerEight();
      await tick();
      assert.deepEqual(await questions(), []);
    },
  );

  await check(
    "only the answer to the question out is kept, and a question is waited for fifteen minutes",
    async () => {
      await due(EIGHT);
      await tick();
      const [q] = (await questions()).filter((x) =>
        x.url.startsWith("https://ndlsearch.ndl.go.jp/"),
      );
      await rows(
        "select private.bib_take($1, 'ndl', $2, 'missing', null, null, null, null)",
        [await editionOf(EIGHT), q.id + 1000],
      );
      let library = await kept(EIGHT, "ndl");
      assert.equal(library.state, "found");
      assert.equal(library.out, true);
      await rows(
        "update private.edition_sources set sent_at = now() - interval '14 minutes' where request_id is not null",
      );
      await rows("select private.bib_receive()");
      assert.equal((await kept(EIGHT, "ndl")).out, true);
      await rows(
        "update private.edition_sources set sent_at = now() - interval '16 minutes' where request_id is not null",
      );
      await rows("select private.bib_receive()");
      library = await kept(EIGHT, "ndl");
      assert.equal(library.state, "failed");
      assert.equal(library.out, false);
      assert.equal(
        (library.fields as { title: string }).title,
        "八冊目",
        "what was found stays",
      );
      await settle();
    },
  );

  const [NINE, TEN] = [Y(9), Y(10)];
  /** Asks openBD alone about Y9 and Y10, and answers with what body makes of them. */
  const openbdRound = async (
    body: (asked: string[]) => unknown,
    meanwhile?: () => Promise<unknown>,
  ) => {
    await rows(
      "update private.edition_sources set next_at = now() + interval '1 day' where source = 'ndl' and request_id is null",
    );
    for (const i of [NINE, TEN])
      await rows(
        `update private.edition_sources s set next_at = now() - interval '1 second'
         from editions e where e.id = s.edition_id and e.isbn = $1 and s.source = 'openbd'`,
        [i],
      );
    await tick();
    const q = (await questions()).find((x) =>
      x.url.startsWith("https://api.openbd.jp/"),
    );
    assert.ok(q, "a question to openBD");
    const asked = new URL(q.url).searchParams.get("isbn")?.split(",") ?? [];
    assert.deepEqual([...asked].sort(), [NINE, TEN]);
    await answer(q.id, JSON.stringify(body(asked)));
    await meanwhile?.();
    await tick();
  };
  const found = (i: string) =>
    openbd({ isbn: i, title: i === NINE ? "九冊目" : "十冊目" });

  await check(
    "openBD's answer of the wrong length fails every edition asked in it and keeps what they had; its null for an edition is not found, which keeps a title the master has from openBD alone",
    async () => {
      await register(AKI, id(3, 9), NINE, "本9");
      await register(AKI, id(3, 10), TEN, "本10");
      await openbdRound((asked) => asked.map(found));
      assert.equal((await kept(NINE, "openbd")).state, "found");
      for (const body of [[], (asked: string[]) => [found(asked[0])]]) {
        await openbdRound(typeof body === "function" ? body : () => body);
        for (const i of [NINE, TEN]) {
          const open = await kept(i, "openbd");
          assert.equal(open.state, "failed");
          assert.ok((open.fields as { title?: string }).title);
        }
      }
      // The library has a title for Y10 and none for Y9.
      await rows(
        "select private.bib_take($1, 'ndl', null, 'found', '<record/>', null, null, $2::jsonb)",
        [await editionOf(TEN), JSON.stringify({ title: "十冊目（図書館）" })],
      );
      await openbdRound((asked) => asked.map(() => null));
      const nine = await kept(NINE, "openbd");
      assert.equal(nine.state, "missing");
      assert.deepEqual(nine.fields, { title: "九冊目" });
      assert.equal(nine.title_kept, true);
      assert.equal(nine.record, null);
      const ten = await kept(TEN, "openbd");
      assert.equal(ten.state, "missing");
      assert.deepEqual(ten.fields, {});
      assert.deepEqual(
        await rows(
          "select isbn, source, why from private.bibliography_review where isbn = any ($1::text[])",
          [[NINE, TEN]],
        ),
        [{ isbn: NINE, source: "openbd", why: "title kept" }],
      );
    },
  );

  await check(
    "an answer that cannot be read fails only its own edition, and the turn goes on",
    async () => {
      await db.exec(`
        alter function private.openbd_answer(jsonb, text) rename to openbd_answer_read;
        create function private.openbd_answer(element jsonb, isbn text,
          out state text, out record text, out fields jsonb)
        language plpgsql set search_path = '' as $$
        begin
          if element ? 'unreadable' then
            raise exception 'an answer that cannot be read';
          end if;
          select * into state, record, fields from private.openbd_answer_read(element, isbn);
        end;
        $$;
      `);
      try {
        await openbdRound(
          (asked) =>
            asked.map((i) => (i === NINE ? { unreadable: true } : found(i))),
          () =>
            rows(
              `update private.edition_sources s set next_at = now() - interval '1 second'
               from editions e where e.id = s.edition_id and e.isbn = $1 and s.source = 'ndl'`,
              [EIGHT],
            ),
        );
        const nine = await kept(NINE, "openbd");
        assert.equal(nine.state, "failed");
        assert.deepEqual(nine.fields, { title: "九冊目" });
        assert.equal((await kept(TEN, "openbd")).state, "found");
        // The turn that read it went on to ask.
        assert.deepEqual(await libraryAsked(), [EIGHT]);
      } finally {
        await db.exec(`
          drop function private.openbd_answer(jsonb, text);
          alter function private.openbd_answer_read(jsonb, text) rename to openbd_answer;
        `);
      }
      await settle();
    },
  );

  await check(
    "the operator's list has a source that failed four times in a row, whether one of its books is in a public place and one of them, until it is found",
    async () => {
      const edition = await editionOf(TEN);
      const take = (state: string) =>
        rows(
          "select private.bib_take($1, 'ndl', null, $2, '<record/>', null, null, $3::jsonb)",
          [edition, state, JSON.stringify({ title: "十冊目（図書館）" })],
        );
      const listed = () =>
        rows(
          "select isbn, why, listed, a_book from private.bibliography_review where isbn = $1 and source = 'ndl'",
          [TEN],
        );
      for (let i = 0; i < 3; i++) await take("failed");
      assert.deepEqual(await listed(), []);
      await take("failed");
      assert.deepEqual(await listed(), [
        { isbn: TEN, why: "failing", listed: false, a_book: id(3, 10) },
      ]);
      // Not in a public place: not corrected, nor withdrawn.
      await refused(
        () =>
          rows("select private.withdraw_bibliography($1, 'ndl')", [id(3, 10)]),
        /none of the edition's books is in a public place/,
        "withdrawing on an edition only registered privately",
      );
      const [post] = await as<{ id: string }>(
        AKI,
        "insert into posts (author_id, body, book_id) values ($1, '読んだ', $2) returning id",
        [AKI, id(3, 10)],
      );
      assert.equal((await listed())[0]?.listed, true);
      await take("found");
      assert.deepEqual(await listed(), []);
      await as(AKI, "delete from posts where id = $1", [post.id]);
    },
  );

  await check(
    "the library's finished record is asked about each month while the book came out within a year, by its month or its year, and twice a year after",
    async () => {
      assert.deepEqual(
        await rows(
          `select v.k, (private.bib_next('ndl', 'found', 0::smallint, 0::smallint, 'C7',
             jsonb_build_object('title', 't', 'creators', '[{"name": "n"}]'::jsonb,
               'publisher', 'p', 'issued', v.issued)) - now())::text as wait
           from (values (1, to_char(now() - interval '11 months', 'YYYY-MM')),
             (2, to_char(now() - interval '13 months', 'YYYY-MM')),
             (3, to_char(now() - interval '1 year', 'YYYY')),
             (4, to_char(now() - interval '2 years', 'YYYY'))) v (k, issued)
           order by v.k`,
        ),
        [
          { k: 1, wait: "30 days" },
          { k: 2, wait: "180 days" },
          { k: 3, wait: "30 days" },
          { k: 4, wait: "180 days" },
        ],
      );
    },
  );
  await db.close();
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
            schedule: "20 seconds",
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
    judge,
    questions,
    answer,
    kept,
    due,
    age,
    later,
    settle,
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
            reading: "ヤマダ イチロウ",
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
      assert.doesNotMatch(
        answer.record ?? "",
        /holdingAgent|図書館0|R100000001/,
      );

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
      // When they do not match, each person's name comes from the heading.
      assert.deepEqual(await named(["甲, 乙 著"], 3), [
        { name: "人0", heading: "人, 0" },
        { name: "人1", heading: "人, 1" },
        { name: "人2", heading: "人, 2" },
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
      // No element at all (an answer shorter than the question) is not
      // "missing".
      assert.equal(
        (
          await rows<{ state: string }>(
            "select state from private.openbd_answer(null, $1)",
            [X2],
          )
        )[0].state,
        "failed",
      );
      // People written as a name authority writes them get the name books
      // print; a person that is not an object, and an order that is not a
      // number, are let be.
      const odd = openbd({
        isbn: X2,
        title: "題",
        people: [
          { name: "Doe, Jane, 1950-" },
          { name: "山田, 一郎, 1970-", reading: "ヤマダ, イチロウ, 1970-" },
        ],
      }) as { onix: { DescriptiveDetail: { Contributor: unknown[] } } };
      const people = odd.onix.DescriptiveDetail.Contributor as Record<
        string,
        unknown
      >[];
      people[0].SequenceNumber = "2";
      people[1].SequenceNumber = "1a";
      odd.onix.DescriptiveDetail.Contributor.push("著者紹介");
      assert.deepEqual((await fromOpenbd(odd, X2)).fields?.creators, [
        { name: "Jane Doe", heading: "Doe, Jane, 1950-" },
        {
          name: "山田一郎",
          heading: "山田, 一郎, 1970-",
          reading: "ヤマダ イチロウ",
        },
      ]);
      const person = async (raw: string, apart = "") =>
        (
          await rows<{ name: string | null }>(
            "select private.bib_person($1, $2) as name",
            [raw, apart],
          )
        )[0].name;
      assert.equal(await person("Doe,John,1920-2012"), "John Doe");
      assert.equal(await person("海野, 波子, 1901-1999"), "海野波子");
      assert.equal(await person("ウミノ, ナミコ", " "), "ウミノ ナミコ");
      assert.equal(await person("海野 波子"), "海野 波子");
      assert.equal(await person("Doe, John, Jr."), "Doe, John, Jr.");
      assert.equal(await person("架空書房編集部"), "架空書房編集部");
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
      await later(16);
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
        rows(
          "select private.bib_take($1, $2, null, $3, $4, null, $5, $6::jsonb)",
          [
            edition,
            source,
            state,
            fields ? "<record/>" : null,
            status,
            fields ? JSON.stringify(fields) : null,
          ],
        );
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
          "select isbn, source, why from private.bibliography_review where why <> 'held' order by 1, 2",
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
    "the operator's correction shows over both sources, field by field, only on an edition in a public place; JSON null shows nothing; taking it back shows the sources again",
    async () => {
      const book = id(2, 1);
      // A post makes Aki's books public for this check (taken down at its end).
      const shared = async (reader: string, of: string) =>
        (
          await as<{ id: string }>(
            reader,
            "insert into posts (author_id, body, book_id) values ($1, '読んだ', $2) returning id",
            [reader, of],
          )
        )[0].id;
      await refused(
        () =>
          rows("select private.fix_bibliography($1, 'title', '\"x\"')", [book]),
        /none of the edition's books is in a public place/,
        "an edition only registered privately",
      );
      const posts = [await shared(AKI, book), await shared(AKI, id(2, 3))];
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
      await as(AKI, "delete from posts where id = any ($1::uuid[])", [posts]);
    },
  );

  await check(
    "a reader reads the master for books in public places and their own, from what the sources answered after the book was placed and ten minutes on, whether its edition is old or new",
    async () => {
      await settle();
      // Ben moves his copy to X1, whose edition the sources answered about
      // before: that was before his book was placed, so it shows him nothing
      // until a question sent since is answered, and not for ten minutes.
      const bens = id(2, 2);
      await as(BEN, "update books set isbn = $2 where id = $1", [bens, X1]);
      await later(60);
      assert.deepEqual(await shown(BEN, [bens]), []);
      assert.equal((await kept(X1, "ndl")).asked, true);
      await tick();
      await answerAll(db, { [X1]: LIBRARY_X1 }, { [X1]: OPENBD_X1 });
      await tick();
      assert.equal((await shown(BEN, [bens])).length, 1);
      // Nor before ten minutes: Ben moves it to X2 and back.
      await as(BEN, "update books set isbn = $2 where id = $1", [bens, X2]);
      await as(BEN, "update books set isbn = $2 where id = $1", [bens, X1]);
      await tick();
      await answerAll(db, { [X1]: LIBRARY_X1 }, { [X1]: OPENBD_X1 });
      await tick();
      assert.deepEqual(await shown(BEN, [bens]), []);
      await later(9);
      await judge();
      assert.deepEqual(await shown(BEN, [bens]), []);
      await later(1);
      await judge();
      assert.equal((await shown(BEN, [bens])).length, 1);
      // Aki and visitors do not read it: it is Ben's, on no public page.
      assert.deepEqual(await shown(AKI, [bens]), []);
      assert.deepEqual(await shown(null, [bens]), []);
      // Chi registers X1, which others had in private, and X3, which nobody
      // had. Both are asked about in the order placed; what the sources said
      // about X1 before does not show for Chi's copy, even ten minutes on:
      // neither shows, whoever asks, until both are answered, and then both do.
      const old = id(2, 4);
      const fresh = id(2, 5);
      await settle();
      await register(CHI, old, X1, "かくうのとしょかん");
      await register(CHI, fresh, X3, "まだない本");
      await as(
        CHI,
        "insert into posts (author_id, body, book_id) values ($1, 'これから', $2), ($1, 'これも', $3)",
        [CHI, old, fresh],
      );
      await later(11);
      for (const visitor of [CHI, AKI, null])
        assert.deepEqual(
          await shown(visitor, [old, fresh]),
          [],
          String(visitor),
        );
      await tick();
      const asked = await questions();
      assert.match(asked[0].url, new RegExp(`isbn%3D%22${X1}%22`));
      assert.equal(
        new URL(asked[1].url).searchParams.get("isbn"),
        `${X1},${X3}`,
      );
      await tick();
      await answerAll(
        db,
        {
          [X1]: LIBRARY_X1,
          [X3]: sru({ isbns: [X3], title: "まだない本の正しい題" }),
        },
        { [X1]: OPENBD_X1 },
      );
      await tick();
      for (const visitor of [CHI, AKI, null])
        assert.deepEqual(
          (await shown(visitor, [old, fresh])).map((row) => [
            row.book_id,
            row.title,
          ]),
          [
            [old, "架空の図書館"],
            [fresh, "まだない本の正しい題"],
          ],
          String(visitor),
        );
      // Moved by an edited ISBN, a book waits again.
      await as(CHI, "update books set isbn = $2 where id = $1", [old, X3]);
      assert.deepEqual(await shown(CHI, [old]), []);
      // Aki's copy of X1, placed long before, is hers, and a post makes it
      // public.
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
      // Once anyone may see that X1 is someone's, what the sources said
      // answers a copy placed after, as the cache: Ben's new copy is asked
      // nothing, and shows the master ten minutes on.
      await settle();
      const cached = id(2, 7);
      await register(BEN, cached, X1, "架空の図書館");
      await tick();
      assert.deepEqual(
        (await questions()).filter((q) => q.url.includes(X1)),
        [],
      );
      await later(11);
      await judge();
      assert.equal((await shown(BEN, [cached]))[0].title, "架空の図書館");
      // A book the master has nothing for is not listed; at most 200 are asked.
      await age(id(2, 3), 60);
      assert.deepEqual(await shown(AKI, [id(2, 3)]), []);
      const many = Array.from({ length: 199 }, (_, i) => id(8, i));
      assert.equal((await shown(null, [...many, akis])).length, 1);
      assert.equal((await shown(null, [...many, id(8, 999), akis])).length, 0);
      await settle();
    },
  );

  await check(
    "nobody reaches the master's tables, its asking or the operator's tools through the API, nor pg_net's tables",
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
            /permission denied for (table|view)/,
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
            /permission denied for function/,
            `${visitor}: ${call}`,
          );
      }
      // Of every function the file makes, the API's roles run only the read.
      const made = [
        ...TEXT.matchAll(/^create function (private|public)\.(\w+)\(/gm),
      ].map((m) => `${m[1]}.${m[2]}`);
      assert.ok(made.length > 25, "the functions the file makes");
      assert.equal(
        await count(
          `select count(*) from pg_proc p
           where p.pronamespace::regnamespace::text || '.' || p.proname = any ($1::text[])`,
          [made],
        ),
        made.length,
      );
      assert.deepEqual(
        await rows(
          `select r.role, p.proname from (values ('anon'), ('authenticated')) r (role)
           cross join pg_proc p
           where p.pronamespace::regnamespace::text || '.' || p.proname = any ($1::text[])
             and has_function_privilege(r.role, p.oid, 'execute')
           order by 1, 2`,
          [made],
        ),
        [
          { role: "anon", proname: "book_bibliography" },
          { role: "authenticated", proname: "book_bibliography" },
        ],
      );
      // Supabase opens pg_net's tables, which hold the ISBNs asked about, to
      // every role, and that cannot be taken back; the API serves only public
      // and graphql_public (here, and so in production), so they stay out of
      // its reach. Never add net to these.
      const api = readFileSync(join(MIGRATIONS, "..", "config.toml"), "utf8")
        .split(/^\[/m)
        .find((part) => part.startsWith("api]"));
      assert.match(api ?? "", /^schemas = \["public", "graphql_public"\]$/m);
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
  await edgeChecks(check);
  console.log(`${passed} bibliography checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
