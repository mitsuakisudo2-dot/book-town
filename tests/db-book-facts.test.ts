import assert from "node:assert/strict";
import {
  answerAll,
  catalog,
  helpers,
  migrated,
  numbered,
  openbd,
  sru,
} from "./fixtures/bibliography";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";

// A book's pages and genre for the reading statistics (management table 19;
// supabase/migrations/*_book_facts.sql): given on the terms the book's
// bibliography is, read from what is kept, the same for every reader.

const FILES = migrationFiles();
const FILE = FILES.find((file) => file.endsWith("_book_facts.sql"));
assert.ok(FILE, "the book facts migration");

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const BOOK = (n: number) =>
  `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NDC = (n: string) => `http://id.ndl.go.jp/class/ndc10/${n}`;
const X = (n: number) => numbered(900 + n);

let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  const db = await migrated();
  const { rows, as, register, tick, later, judge } = helpers(db);
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン');
  `);

  type Fact = { book_id: string; pages: number | null; genre: string | null };
  const facts = (visitor: string | null, ids: string[]) =>
    as<Fact>(visitor, "select * from book_facts($1::uuid[]) order by book_id", [
      ids,
    ]);

  await register(AKI, BOOK(1), X(1), "小説の本");
  await register(AKI, BOOK(2), X(2), "厚さの分からない本");
  await register(AKI, BOOK(3), X(3), "マンガの本");
  await register(AKI, BOOK(4), X(4), "まだ答えのない本");
  // The library is asked a book at a time (a reader's turns): answer until all are.
  for (let round = 0; round < 6; round++) {
    await tick();
    await answerAll(
      db,
      {
        [X(1)]: sru({
          isbns: [X(1)],
          title: "小説の本",
          extent: "302p ; 15cm",
          subjects: [NDC("913.6")],
        }),
        [X(2)]: sru({
          isbns: [X(2)],
          title: "厚さの分からない本",
          extent: "1冊 ; 21cm",
        }),
        [X(3)]: sru({
          isbns: [X(3)],
          title: "マンガの本",
          extent: "１９２ｐ ; １８ｃｍ",
          subjects: [NDC("726.1")],
        }),
      },
      {
        [X(1)]: openbd({ isbn: X(1), title: "小説の本" }),
        [X(2)]: openbd({ isbn: X(2), title: "厚さの分からない本" }),
        [X(3)]: openbd({ isbn: X(3), title: "マンガの本" }),
      },
      [X(4)],
    );
    await later(1);
  }
  await tick();
  await later(11);
  await judge();

  await check(
    "a reader's own books: the library's pages, and the genre of their NDC",
    async () => {
      assert.deepEqual(await facts(AKI, [BOOK(1), BOOK(2), BOOK(3), BOOK(4)]), [
        { book_id: BOOK(1), pages: 302, genre: "日本の小説" },
        { book_id: BOOK(2), pages: null, genre: null },
        { book_id: BOOK(3), pages: 192, genre: "マンガ" },
      ]);
    },
  );

  await check(
    "another reader's book typed in, and anyone not signed in, get nothing",
    async () => {
      assert.deepEqual(await facts(BEN, [BOOK(1)]), []);
      assert.deepEqual(await facts(null, [BOOK(1)]), []);
    },
  );

  await check("the operator's genre for the work comes first", async () => {
    await rows(
      `insert into private.work_genre_fixed (work_id, genre)
       select work_id, '海外の小説' from books where id = $1`,
      [BOOK(1)],
    );
    assert.equal((await facts(AKI, [BOOK(1)]))[0].genre, "海外の小説");
  });

  await check("pages written oddly are not given", async () => {
    await rows(
      `update private.edition_sources s set fields = jsonb_set(s.fields, '{pages}', '0')
       from books b where b.edition_id = s.edition_id and b.id = $1 and s.source = 'ndl'`,
      [BOOK(3)],
    );
    assert.equal((await facts(AKI, [BOOK(3)]))[0].pages, null);
    await rows(
      `update private.edition_sources s set fields = jsonb_set(s.fields, '{pages}', '"192"')
       from books b where b.edition_id = s.edition_id and b.id = $1 and s.source = 'ndl'`,
      [BOOK(3)],
    );
    assert.equal((await facts(AKI, [BOOK(3)]))[0].pages, null);
  });

  await check(
    "only book_facts is opened; what it reads stays closed",
    async () => {
      for (const role of ["anon", "authenticated"]) {
        assert.deepEqual(
          await rows(
            "select has_function_privilege($1, 'public.book_facts(uuid[])', 'execute') as can",
            [role],
          ),
          [{ can: true }],
        );
        assert.deepEqual(
          await rows(
            "select has_function_privilege($1, 'private.edition_pages(uuid, timestamptz)', 'execute') as can",
            [role],
          ),
          [{ can: false }],
        );
      }
    },
  );

  await check(
    "the rollback in the header leaves the database as it was before",
    async () => {
      const after = await migrated(FILES[FILES.indexOf(FILE!) + 1]);
      const before = await migrated(FILE);
      const rollback = migrationText(FILE!)
        .split("-- Rollback")[1]
        .split("\n")
        .filter((line) => line.startsWith("--   "))
        .map((line) => line.slice(5))
        .join("\n");
      await after.exec(rollback);
      assert.deepEqual(await catalog(after), await catalog(before));
    },
  );

  console.log(`db book facts: ${passed} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
