import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  answerAll,
  catalog,
  diagnostic,
  helpers,
  migrated,
  numbered,
  openbd,
  sru,
} from "./fixtures/bibliography";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";

// Asking the sources more fairly and less (item 4's rest; AUD-015, 016 and
// 129; supabase/migrations/*_bibliography_fetching.sql): what was owed a
// question before the file still is; a reader's many books take turns with
// everyone else's; the library's answer kept answers a book owed a question
// when it is a week old at most, and the book waits its ten minutes all the
// same; the library no longer having a record it had lists the edition at
// two answers and drops its values at three; an edition nobody may see is
// someone's is asked half as often; what is sent takes as long with forty
// thousand rows due as with two thousand; nobody reaches any of it; and
// undoing the file.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_bibliography_fetching.sql"));
assert.ok(FILE, "the fetching migration");
const TEXT = migrationText(FILE);
const JUDGING = FILES.find((file) =>
  file.endsWith("_bibliography_judging.sql"),
)!.replace(/\.sql$/, "");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";
const PEOPLE = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
`;

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const Z = (n: number) => numbered(500 + n);

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

/** A function or view as the file ending so made it, to make it again. */
function made(file: string, name: string): string {
  const text = migrationText(FILES.find((f) => f.endsWith(file))!);
  const start = [
    `create function ${name}(`,
    `create or replace function ${name}(`,
    `create or replace view ${name} as`,
  ]
    .map((head) => text.indexOf(head))
    .find((at) => at >= 0);
  assert.ok(start !== undefined, name);
  const end = text.indexOf(`revoke all on `, start);
  assert.ok(end > start && text.slice(end).includes(name), name);
  return text
    .slice(start, text.indexOf(";\n", end) + 2)
    .replace(/^create function/, "create or replace function");
}

/** The rollback as the header writes it, then what it makes again as the files before made it. */
function rollbackSql(): string {
  return [
    rollbackStatements(TEXT),
    ...[
      "private.bib_ask",
      "private.bib_receive",
      "private.allow_bibliography",
    ].map((name) => made("_bibliography.sql", name)),
    ...[
      "private.bib_send",
      "private.bib_take",
      "private.bib_slow",
      "private.bib_tick",
      "private.book_checked",
      "private.withdraw_bibliography",
      "private.bibliography_review",
    ].map((name) => made("_bibliography_holds.sql", name)),
  ].join("\n");
}

// The library's answer kept goes with a question (AUD-159;
// supabase/migrations/*_bibliography_answer_kept.sql), and its rollback.
const KEPT = FILES.find((file) =>
  file.endsWith("_bibliography_answer_kept.sql"),
);
assert.ok(KEPT && KEPT > FILE!, "the answer kept migration, after this one");
const KEPT_TEXT = migrationText(KEPT);
const keptRollbackSql = () =>
  [
    rollbackStatements(KEPT_TEXT),
    ...["private.bib_reused", "private.bib_receive", "private.bib_send"].map(
      (name) => made("_bibliography_fetching.sql", name),
    ),
  ].join("\n");

/** ISBNs of the town's catalog in the speed check, from first to last, made in SQL. */
const MANY_ISBNS = `
  select d || ((10 - (select sum(substr(d, k, 1)::int * (case when k % 2 = 1 then 1 else 3 end))
      from generate_series(1, 12) k) % 10) % 10)::text as isbn
  from (select '97848' || lpad(i::text, 7, '0') as d from generate_series($1::int, $2::int) i) p`;

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  {
    const db = await migrated(FILE);
    const { rows, register, tick } = helpers(db);
    await db.exec(PEOPLE);
    await check(
      "the move owes a question to what was owed one, changes no edition's place, and drops the copy taken before the books were judged again",
      async () => {
        // Z1 and Z4 answered for Aki, then Ben's book on Z1 owed a question;
        // Z2 and Z3 waiting, never asked.
        await register(AKI, id(1, 1), Z(1), "一の本");
        await register(AKI, id(1, 5), Z(4), "四の本");
        for (let turn = 0; turn < 2; turn++) {
          await tick();
          await answerAll(
            db,
            {
              [Z(1)]: sru({ isbns: [Z(1)], title: "一の本" }),
              [Z(4)]: sru({ isbns: [Z(4)], title: "四の本" }),
            },
            {
              [Z(1)]: openbd({ isbn: Z(1), title: "一の本" }),
              [Z(4)]: openbd({ isbn: Z(4), title: "四の本" }),
            },
          );
        }
        await tick();
        await register(BEN, id(1, 2), Z(1), "一の本");
        await register(AKI, id(1, 3), Z(2), "二の本");
        await register(AKI, id(1, 4), Z(3), "三の本");
        const before = await rows<{
          isbn: string;
          source: string;
          owed: boolean;
          next_at: string;
        }>(
          `select e.isbn, s.source, s.next_at::text,
             private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at) is not null
               as owed
           from private.edition_sources s join editions e on e.id = s.edition_id
           order by 1, 2`,
        );
        assert.ok(before.some((row) => row.owed));
        assert.ok(before.some((row) => !row.owed));
        const copies = (
          await rows<{ copy_name: string }>(
            "select copy_name from keep.copies where label = $1",
            [JUDGING],
          )
        ).map((row) => row.copy_name);
        assert.equal(copies.length, 3);
        await db.exec(TEXT);
        assert.deepEqual(
          await rows(
            `select e.isbn, s.source, s.next_at::text, s.owed
             from private.edition_sources s join editions e on e.id = s.edition_id
             order by 1, 2`,
          ),
          before,
        );
        assert.deepEqual(
          await rows(
            "select count(*)::int as n from keep.copies where label = $1",
            [JUDGING],
          ),
          [{ n: 0 }],
        );
        for (const name of copies)
          assert.deepEqual(
            await rows(
              "select to_regclass('keep.' || quote_ident($1)) as copy",
              [name],
            ),
            [{ copy: null }],
            name,
          );
        assert.deepEqual(await rows("select * from private.bib_pace"), []);
      },
    );
    await db.close();
  }

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
    "the rollback in the header of the answer kept going with a question leaves the database as it was before",
    async () => {
      const db = await migrated(KEPT);
      const before = await catalog(db);
      await db.exec(KEPT_TEXT);
      assert.notDeepEqual(await catalog(db), before);
      await db.exec(keptRollbackSql());
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
    later,
    settle,
    shown,
  } = helpers(db);
  await db.exec(PEOPLE);
  /** The ISBN each question out to the library is about, oldest first. */
  const libraryAsked = async () =>
    (await questions())
      .filter((q) => q.url.startsWith("https://ndlsearch.ndl.go.jp/"))
      .map((q) => decodeURIComponent(q.url).match(/isbn="(\d{13})"/)?.[1]);
  /** The ISBNs of each question out to openBD. */
  const openbdAsked = async () =>
    (await questions())
      .filter((q) => q.url.startsWith("https://api.openbd.jp/"))
      .map((q) => new URL(q.url).searchParams.get("isbn"));
  /** The library's answers kept used again, waiting for the question they go with, by ISBN. */
  const reused = async () =>
    (
      await rows<{ isbn: string }>(
        `select e.isbn from private.edition_sources s join editions e on e.id = s.edition_id
         where s.source = 'ndl' and s.request_id < 0 order by 1`,
      )
    ).map((row) => row.isbn);
  const placed = async (book: string) =>
    (
      await rows<{ ahead: number }>(
        `select extract(epoch from c.placed_at - b.created_at)::float as ahead
         from private.book_checks c join books b on b.id = c.book_id where c.book_id = $1`,
        [book],
      )
    )[0].ahead;
  const pace = async (reader: string) =>
    (
      await rows<{ next_at: string }>(
        "select next_at::text from private.bib_pace where reader = $1",
        [reader],
      )
    )[0]?.next_at ?? null;
  const ndl = (isbnOf: string, title: string) => ({
    [isbnOf]: sru({ isbns: [isbnOf], title }),
  });
  const open = (isbnOf: string, title: string) => ({
    [isbnOf]: openbd({ isbn: isbnOf, title }),
  });

  await check(
    "a reader's books after the first ten are placed twenty seconds apart, so another reader's book goes before them; a book the cache answers and one without an ISBN are placed at once",
    async () => {
      const akis = Array.from({ length: 30 }, (_, i) => id(2, i + 1));
      for (const [i, book] of akis.entries())
        await register(AKI, book, Z(i + 1), `本${i + 1}`);
      const bens = id(2, 31);
      await register(BEN, bens, Z(31), "ベンの本");
      for (const book of akis.slice(0, 10))
        assert.ok((await placed(book)) < 1, book);
      assert.ok((await placed(akis[10])) > 15);
      for (let i = 11; i < 30; i++)
        assert.equal(
          await count(
            `select extract(epoch from b.placed_at - a.placed_at)
             from private.book_checks a, private.book_checks b
             where a.book_id = $1 and b.book_id = $2`,
            [akis[i - 1], akis[i]],
          ),
          20,
          akis[i],
        );
      assert.ok((await placed(bens)) < 1);
      // A catalog book's edition answers Aki's at once, and so does a book
      // without an ISBN: neither waits, nor moves Aki's turn on.
      const turn = await pace(AKI);
      await db.exec(
        `insert into books (id, isbn, title, source) values ('${id(2, 40)}', '${Z(40)}', '目録の本', 'ndl')`,
      );
      await register(AKI, id(2, 41), Z(40), "目録の本");
      await register(AKI, id(2, 42), null, "手帖");
      assert.ok((await placed(id(2, 41))) < 1);
      assert.ok((await placed(id(2, 42))) < 1);
      assert.equal(await pace(AKI), turn);
      // The library is asked about Aki's first ten, then Ben's, then Aki's
      // next, one a tick.
      await later(10);
      const asked: string[] = [];
      for (let turn = 0; turn < 13; turn++) {
        await tick();
        asked.push(...((await libraryAsked()) as string[]));
        await answerAll(db, {}, {});
      }
      // (Aki's book of the catalog's Z40 is placed ten minutes back, as the
      // cache answers it, so its edition is asked first.)
      assert.deepEqual(asked, [
        Z(40),
        ...Array.from({ length: 10 }, (_, i) => Z(i + 1)),
        Z(31),
        Z(11),
      ]);
      await settle();
      // An hour after a reader's last book's turn, it is forgotten.
      await register(AKI, id(2, 43), Z(43), "また一冊");
      await later(59);
      await tick();
      assert.notEqual(await pace(AKI), null);
      await later(2);
      await tick();
      assert.equal(await pace(AKI), null);
      await settle();
    },
  );

  await check(
    "a book owed a question is answered by the library's answer kept when it is a week old at most, with the question sent at the same tick: no question about it goes, it comes with that question's answer, and the book waits its ten minutes as any",
    async () => {
      const akis = id(3, 1);
      const bens = id(3, 2);
      await register(AKI, akis, Z(50), "五十の本");
      await tick();
      await answerAll(db, ndl(Z(50), "五十の本"), open(Z(50), "五十の本"));
      await tick();
      await settle();
      // Ben's book of Z50: Aki's is in private, so nothing answers it yet.
      // Chi's of Z55, after it, is asked about at the same tick.
      await register(BEN, bens, Z(50), "五十の本");
      await register(CHI, id(3, 4), Z(55), "五十五の本");
      await tick();
      assert.deepEqual(await libraryAsked(), [Z(55)]);
      assert.deepEqual(await reused(), [Z(50)]);
      assert.deepEqual(await openbdAsked(), [`${Z(50)},${Z(55)}`]);
      // No answer yet to the question about Z55: Z50's waits with it.
      await tick();
      assert.deepEqual(await reused(), [Z(50)]);
      await answerAll(db, {}, open(Z(50), "五十の本"));
      await tick();
      assert.deepEqual(await reused(), []);
      assert.equal((await kept(Z(50), "ndl")).asked, false);
      await later(9);
      await judge();
      assert.deepEqual(await shown(BEN, [bens]), []);
      await later(1);
      await judge();
      assert.equal(
        ((await shown(BEN, [bens]))[0] as { title: string }).title,
        "五十の本",
      );
      // The operator asking again is asked, not answered from what is kept.
      await settle();
      await rows("select private.refetch_bibliography($1)", [akis]);
      await tick();
      assert.deepEqual(await libraryAsked(), [Z(50)]);
      await answerAll(db, ndl(Z(50), "五十の本"), open(Z(50), "五十の本"));
      await tick();
      await settle();
      // Eight days on, Chi's book is asked about.
      await later(8 * 24 * 60);
      await register(CHI, id(3, 3), Z(50), "五十の本");
      await tick();
      assert.deepEqual(await libraryAsked(), [Z(50)]);
      assert.deepEqual(await reused(), []);
      await settle();
      // In one tick, every book owed whose answer can be used again, in
      // turn, and then a question about the first that cannot.
      for (const n of [51, 52, 53]) {
        await register(AKI, id(3, n), Z(n), `${n}の本`);
        await tick();
        await answerAll(db, ndl(Z(n), `${n}の本`), open(Z(n), `${n}の本`));
        await tick();
      }
      await settle();
      for (const n of [51, 52, 53, 54])
        await register(BEN, id(3, n + 10), Z(n), `${n}の本`);
      await tick();
      assert.deepEqual(await reused(), [Z(51), Z(52), Z(53)]);
      assert.deepEqual(await libraryAsked(), [Z(54)]);
      await answerAll(db, ndl(Z(54), "54の本"), {});
      await tick();
      assert.deepEqual(await reused(), []);
      await settle();
      // With nothing else to ask about at its turn, the last that could be
      // answered from what is kept is asked.
      for (const n of [51, 52])
        await register(CHI, id(3, n + 20), Z(n), `${n}の本`);
      await tick();
      assert.deepEqual(await reused(), [Z(51)]);
      assert.deepEqual(await libraryAsked(), [Z(52)]);
      await settle();
    },
  );

  await check(
    "while the library refuses and while it answers, a book's master comes as long after its turn whether its edition's answer is kept or not, whichever of two books comes first",
    async () => {
      let n = 100;
      /**
       * Rounds of twenty seconds from each of Ben's two books' registration
       * (at the rounds `at`; in one round, the second first when
       * `secondFirst`) to its master's title, the library refusing every
       * question (429) for the first `failing` rounds. Aki registered the
       * first one's ISBN before when `before`. openBD has neither.
       */
      const run = async (
        before: boolean,
        at: [number, number],
        secondFirst: boolean,
        failing: number,
      ) => {
        const isbns = [Z(n), Z(n + 1)];
        const books = [id(6, n), id(6, n + 1)];
        n += 2;
        const records = Object.fromEntries(
          isbns.map((i) => [i, sru({ isbns: [i], title: `${i}の本` })]),
        );
        if (before) {
          await register(AKI, id(7, n), isbns[0], `${isbns[0]}の本`);
          await tick();
          await answerAll(db, { [isbns[0]]: records[isbns[0]] }, {});
          await tick();
          await settle();
        }
        const order = secondFirst ? [1, 0] : [0, 1];
        const shownAt: (number | null)[] = [null, null];
        for (let round = 0; round < 400; round++) {
          for (const k of order)
            if (at[k] === round)
              await register(BEN, books[k], isbns[k], `${isbns[k]}の本`);
          await later(1 / 3);
          await tick();
          for (const q of await questions()) {
            if (!q.url.startsWith("https://ndlsearch.ndl.go.jp/")) {
              const list = new URL(q.url).searchParams.get("isbn")!.split(",");
              await answer(q.id, JSON.stringify(list.map(() => null)));
            } else if (round < failing) {
              await answer(q.id, "Too Many Requests", 429);
            } else {
              const asked = decodeURIComponent(q.url).match(
                /isbn="(\d{13})"/,
              )![1];
              await answer(
                q.id,
                records[asked] ?? diagnostic("Record does not exist"),
              );
            }
          }
          for (const k of [0, 1])
            if (shownAt[k] === null && round >= at[k]) {
              const master = (await shown(BEN, [books[k]]))[0] as
                | { title: string | null }
                | undefined;
              if (master?.title) shownAt[k] = round - at[k];
            }
          if (shownAt.every((rounds) => rounds !== null)) break;
          // Nothing out (or answered and not yet read) and nothing due for a
          // while: on to just before it (not past the library's coming back).
          if (
            round < Math.max(...at) ||
            (await count(
              "select count(*) from private.edition_sources where request_id is not null",
            ))
          )
            continue;
          const wait = (
            await rows<{ wait: number }>(
              `select coalesce(extract(epoch from least(
                 (select min(s.next_at) from private.edition_sources s
                  where s.owed and s.request_id is null),
                 (select min(c.placed_at) + interval '10 minutes' from private.book_checks c
                  where c.book_id = any ($1::uuid[]) and c.judged_at is null)) - now()), 0)::float
                 as wait`,
              [books],
            )
          )[0].wait;
          let skip = Math.floor((wait - 1) / 20);
          if (round < failing) skip = Math.min(skip, failing - round - 1);
          if (skip >= 2) {
            await later(skip / 3);
            round += skip;
          }
        }
        await settle();
        return shownAt;
      };
      const ways: [[number, number], boolean][] = [
        [[0, 0], false],
        [[0, 0], true],
        [[0, 1], false],
        [[1, 0], false],
      ];
      for (const [at, secondFirst] of ways) {
        const way = `${at} ${secondFirst}`;
        const failed = await run(true, at, secondFirst, 40);
        assert.deepEqual(failed, await run(false, at, secondFirst, 40), way);
        // They wait for the library to answer again, after the first
        // question failed and the one ten minutes on.
        for (const rounds of failed)
          assert.ok(rounds !== null && rounds > 40, `${way}: ${rounds}`);
      }
      for (const [at, secondFirst] of ways.slice(0, 3)) {
        const way = `${at} ${secondFirst}`;
        const answered = await run(true, at, secondFirst, 0);
        assert.deepEqual(answered, await run(false, at, secondFirst, 0), way);
        // Ten minutes on, as any answer.
        for (const rounds of answered)
          assert.ok(
            rounds !== null && rounds >= 29 && rounds <= 31,
            `${way}: ${rounds}`,
          );
      }
    },
  );

  await check(
    "the library no longer having a record it had (counted once a day at most): two answers in a row list the edition for the operator, three drop its values as openBD's (a title alone stays), and finding it again starts over",
    async () => {
      const lost = async (isbnOf: string) =>
        (
          await rows<{
            lost: number;
            record: boolean;
            fields: number;
            title: string | null;
          }>(
            `select s.lost, s.record is not null as record,
               (select count(*)::int from jsonb_object_keys(s.fields)) as fields,
               s.fields ->> 'title' as title
             from private.edition_sources s join editions e on e.id = s.edition_id
             where e.isbn = $1 and s.source = 'ndl'`,
            [isbnOf],
          )
        )[0];
      const review = (isbnOf: string) =>
        rows(
          "select why from private.bibliography_review where isbn = $1 and source = 'ndl'",
          [isbnOf],
        );
      // Z60 has openBD's title too; Z61 has the library's alone.
      await register(AKI, id(4, 1), Z(60), "六十の本");
      await register(AKI, id(4, 2), Z(61), "六十一の本");
      for (let turn = 0; turn < 2; turn++) {
        await tick();
        await answerAll(
          db,
          { ...ndl(Z(60), "六十の本"), ...ndl(Z(61), "六十一の本") },
          open(Z(60), "六十の本"),
        );
      }
      await tick();
      await settle();
      /** Both asked again on their schedule; the library has no record now. */
      const again = async () => {
        await due(Z(60));
        await due(Z(61));
        for (let turn = 0; turn < 2; turn++) {
          await tick();
          await answerAll(db, {}, open(Z(60), "六十の本"));
        }
        await tick();
        await settle();
      };
      await again();
      assert.deepEqual(await lost(Z(60)), {
        lost: 1,
        record: true,
        fields: 2,
        title: "六十の本",
      });
      assert.deepEqual(await review(Z(60)), []);
      // Again within the day: not counted.
      await again();
      assert.equal((await lost(Z(60))).lost, 1);
      await later(21 * 60);
      await again();
      assert.deepEqual(await lost(Z(60)), {
        lost: 2,
        record: true,
        fields: 2,
        title: "六十の本",
      });
      assert.deepEqual(await review(Z(60)), [{ why: "gone at the source" }]);
      assert.deepEqual(await review(Z(61)), [{ why: "gone at the source" }]);
      await later(21 * 60);
      await again();
      assert.deepEqual(await lost(Z(60)), {
        lost: 3,
        record: false,
        fields: 0,
        title: null,
      });
      assert.deepEqual(await lost(Z(61)), {
        lost: 3,
        record: false,
        fields: 1,
        title: "六十一の本",
      });
      assert.deepEqual(await review(Z(61)), [{ why: "title kept" }]);
      // Found again.
      await due(Z(60));
      await tick();
      await answerAll(db, ndl(Z(60), "六十の本"), open(Z(60), "六十の本"));
      await tick();
      assert.deepEqual(await lost(Z(60)), {
        lost: 0,
        record: true,
        fields: 2,
        title: "六十の本",
      });
      assert.deepEqual(await review(Z(60)), []);
      await settle();
    },
  );

  await check(
    "an edition nobody may see is someone's is asked again twice as late after an answer, found or not; one with a catalog book or a book in a public place, and a failed question, as before",
    async () => {
      await register(AKI, id(5, 1), Z(70), "七十の本");
      await db.exec(
        `insert into books (id, isbn, title, source) values ('${id(5, 2)}', '${Z(71)}', '目録の本', 'ndl')`,
      );
      await register(AKI, id(5, 3), Z(72), "七十二の本");
      await register(BEN, id(5, 4), Z(73), "七十三の本");
      await as(
        BEN,
        "insert into posts (author_id, body, book_id) values ($1, 'よかった', $2)",
        [BEN, id(5, 4)],
      );
      for (let turn = 0; turn < 4; turn++) {
        await tick();
        for (const q of await questions())
          if (q.url.includes(`isbn%3D%22${Z(72)}%22`))
            await answer(q.id, "<html>busy</html>", 503);
        await answerAll(
          db,
          {
            ...ndl(Z(70), "七十の本"),
            ...ndl(Z(71), "目録の本"),
            ...ndl(Z(73), "七十三の本"),
          },
          { ...open(Z(70), "七十の本"), ...open(Z(71), "目録の本") },
        );
      }
      await tick();
      const wait = async (isbnOf: string, source: "ndl" | "openbd") =>
        (await kept(isbnOf, source)).wait;
      assert.equal(await wait(Z(70), "ndl"), "60 days");
      assert.equal(await wait(Z(70), "openbd"), "60 days");
      assert.equal(await wait(Z(71), "ndl"), "30 days");
      assert.equal(await wait(Z(71), "openbd"), "30 days");
      assert.equal(await wait(Z(73), "ndl"), "30 days");
      // openBD has no Z73: not found, a day.
      assert.equal(await wait(Z(73), "openbd"), "1 day");
      assert.equal(await wait(Z(72), "ndl"), "00:10:00");
      await settle();
    },
  );

  await check(
    "nobody reaches the readers' turns or the new asking through the API",
    async () => {
      const made = [
        "private.bib_wait(private.edition_sources)",
        "private.bib_ask(uuid, boolean, timestamp with time zone)",
        "private.bib_reusable(uuid)",
        "private.bib_reused(uuid, text)",
        "private.bib_with(bigint, boolean)",
        "private.bib_queue(text, integer)",
        "private.bib_send()",
        "private.bib_take(uuid, text, bigint, text, text, text, text, jsonb)",
        "private.bib_receive()",
        "private.bib_slow(text)",
        "private.bib_tick()",
        "private.book_checked()",
        "private.withdraw_bibliography(uuid, text)",
        "private.allow_bibliography(uuid, text)",
      ];
      for (const role of ["anon", "authenticated"]) {
        for (const fn of made)
          assert.equal(
            (
              await rows<{ may: boolean }>(
                "select has_function_privilege($1, $2, 'execute') as may",
                [role, fn],
              )
            )[0].may,
            false,
            `${role}: ${fn}`,
          );
        for (const table of ["private.bib_pace", "private.bibliography_review"])
          assert.equal(
            (
              await rows<{ may: boolean }>(
                "select has_table_privilege($1, $2, 'select, insert, update, delete') as may",
                [role, table],
              )
            )[0].may,
            false,
            `${role}: ${table}`,
          );
      }
      await refused(
        () => as(AKI, "select * from private.bib_pace"),
        /permission denied/,
        "reading the readers' turns",
      );
      // Each runs with no search path of the caller's.
      assert.deepEqual(
        await rows(
          `select p.oid::regprocedure::text as fn from pg_proc p
           where p.oid = any ($1::regprocedure[])
             and not coalesce(p.proconfig, '{}') @> array['search_path=""']`,
          [made],
        ),
        [],
      );
      assert.equal(
        await count(
          "select count(*) from pg_proc p where p.oid = any ($1::regprocedure[])",
          [made],
        ),
        made.length,
      );
    },
  );
  await db.close();

  await check(
    "what is sent takes no longer with forty thousand rows due than with two thousand",
    async () => {
      const big = await migrated();
      const on = helpers(big);
      // Two thousand catalog books, answered long ago and due again; a
      // hundred of them owed a question for a book placed since.
      await on.rows(
        `insert into books (id, isbn, title, source)
         select gen_random_uuid(), isbn, '目録の本', 'ndl' from (${MANY_ISBNS}) x`,
        [1, 2000],
      );
      const answered = `
        update private.edition_sources s set state = 'found', record = 'r', record_id = 'r',
          fields = '{"title": "目録の本"}', answered_at = now() - interval '200 days',
          settled_at = now() - interval '200 days', settled_for = now() - interval '200 days',
          tried_for = now() - interval '200 days', found_for = now() - interval '200 days',
          title_for = now() - interval '200 days', owed = false,
          next_at = now() - make_interval(mins => abs(hashtext(s.edition_id::text)) % 20000)
        where s.state = 'waiting'`;
      const owed = `
        with o as (
          update private.book_checks c set placed_at = now() - interval '1 hour'
          from books b where b.id = c.book_id and b.source = 'ndl'
            and c.placed_at < now() - interval '100 days'
            and abs(hashtext(b.id::text)) % 20 = 0
          returning b.edition_id)
        update private.edition_sources s set owed = true, next_at = now() - interval '1 hour'
        from o where s.edition_id = o.edition_id`;
      await on.rows(
        "update private.book_checks set placed_at = now() - interval '201 days'",
      );
      await on.rows(answered);
      await on.rows(owed);
      const time = async () => {
        await big.exec("analyze");
        const ms: number[] = [];
        for (let k = 0; k < 7; k++) {
          await big.exec("begin");
          const start = performance.now();
          await big.query("select private.bib_send()");
          ms.push(performance.now() - start);
          await big.exec("rollback");
        }
        return ms.sort((a, b) => a - b)[3];
      };
      const small = await time();
      // Thirty-eight thousand more, written straight into the tables.
      await big.exec("set session_replication_role = replica");
      await on.rows(
        `with n as (${MANY_ISBNS}), e as (
           insert into editions (id, isbn, work_id)
           select gen_random_uuid(), n.isbn, gen_random_uuid() from n
           returning id, isbn, work_id)
         insert into books (id, isbn, title, source, edition_id, work_id)
         select gen_random_uuid(), e.isbn, '目録の本', 'ndl', e.id, e.work_id from e`,
        [2001, 40000],
      );
      await on.rows(
        `insert into private.edition_sources (edition_id, source)
         select e.id, v.source from editions e cross join (values ('ndl'), ('openbd')) v (source)
         where e.isbn is not null
           and not exists (select 1 from private.edition_sources x where x.edition_id = e.id)`,
      );
      await on.rows(
        `insert into private.book_checks (book_id, placed_at, checked_at, verdict, judged_at)
         select b.id, now() - interval '201 days', now() - interval '200 days', 'same',
           now() - interval '200 days'
         from books b
         where not exists (select 1 from private.book_checks c where c.book_id = b.id)`,
      );
      await big.exec("set session_replication_role = origin");
      await on.rows(answered);
      await on.rows(owed);
      assert.equal(
        await on.count(
          "select count(*) from private.edition_sources where source = 'ndl' and next_at <= now()",
        ),
        40000,
      );
      const large = await time();
      console.log(
        `bib_send: ${small.toFixed(1)}ms with 2,000 rows due, ${large.toFixed(1)}ms with 40,000`,
      );
      assert.ok(
        large < small * 3 + 20,
        `${large.toFixed(1)}ms with 40,000 rows due, ${small.toFixed(1)}ms with 2,000`,
      );
      await big.close();
    },
  );

  console.log(`${passed} fetching checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
