import assert from "node:assert/strict";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";
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

// Judging registrations against the bibliographic master, and holding back
// the ones that are clearly another book (item 4 of the 2026-10-16 plan; the
// owner's review of 2026-10-16 22:36Z, 「食い違いの扱い」;
// supabase/migrations/*_bibliography_holds.sql): how a reader's entry is
// compared, when, what a verdict changes (the work, the master shown, the
// counts, the candidates), the reader's answer, the operator's list and
// tools, asking a slow source, who may call what, and undoing it.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const HOLDS_FILE = FILES.find((file) =>
  file.endsWith("_bibliography_holds.sql"),
);
assert.ok(HOLDS_FILE, "the holds migration");
const HOLDS = HOLDS_FILE;
const TEXT = migrationText(HOLDS);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CHI = "00000000-0000-4000-8000-00000000000c";

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const X = (n: number) => numbered(200 + n);

/**
 * The rollback as the header writes it: the indented lines of its first
 * comment, then the functions and the view as the files before made them.
 */
function rollbackSql(): string {
  const statements = TEXT.slice(0, TEXT.indexOf("\n\n"))
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
  const remade = [
    ...[
      "bib_send",
      "bib_tick",
      "book_checked",
      "withdraw_bibliography",
      "bib_take",
      "edition_bibliography",
    ].map((name) =>
      from(
        "_bibliography.sql",
        `create function private.${name}(`,
        `revoke all on function private.${name}(`,
      ),
    ),
    from(
      "_bibliography.sql",
      "create function public.book_bibliography(",
      "grant execute on function public.book_bibliography(",
    ),
    from(
      "_works.sql",
      "create function private.work_candidates(",
      "revoke all on function private.work_candidates(",
    ),
    from(
      "_works.sql",
      "create function private.keep_apart(",
      "revoke all on function private.keep_apart(",
    ),
  ].map((text) =>
    text.replace("create function", "create or replace function"),
  );
  const view = from(
    "_bibliography.sql",
    "create view private.bibliography_review",
    "revoke all on private.bibliography_review",
  );
  const editions = migrationText(
    FILES.find((f) => f.endsWith("_edition_ids.sql"))!,
  );
  const joinStart = editions.indexOf(
    "create or replace function private.join_works(",
  );
  const join = editions.slice(
    joinStart,
    editions.indexOf(
      "$$;\n",
      editions.indexOf("return query select made, n;", joinStart),
    ) + 4,
  );
  return [statements, ...remade, join, view].join("\n");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  // Comparing -----------------------------------------------------------------------

  {
    const db = await migrated();
    const { rows } = helpers(db);
    type Master = {
      title: string;
      subtitle?: string;
      volume?: string;
      reading?: string;
      creators?: { name: string; reading?: string; heading?: string }[];
    };
    const verdict = async (title: string, author: string, m: Master) =>
      (
        await rows<{ v: string }>(
          "select private.bib_verdict($1, $2, $3, $4, $5, $6, $7::jsonb) as v",
          [
            title,
            author,
            m.title,
            m.subtitle ?? null,
            m.volume ?? null,
            m.reading ?? null,
            m.creators ? JSON.stringify(m.creators) : null,
          ],
        )
      )[0].v;
    const LIBRARY = {
      title: "架空の図書館",
      subtitle: "夜の章",
      reading: "カクウ ノ トショカン",
      creators: [
        {
          name: "山田一郎",
          reading: "ヤマダ, イチロウ",
          heading: "山田, 一郎, 1950-",
        },
      ],
    };

    await check(
      "the same: the master's title, with its subtitle or its volume, however it is written",
      async () => {
        for (const typed of [
          "架空の図書館",
          "架空の図書館 夜の章",
          "架空の図書館：夜の章",
        ])
          assert.equal(await verdict(typed, "", LIBRARY), "same", typed);
        assert.equal(
          await verdict("ｶﾌｶの城", "", { title: "カフカの城" }),
          "same",
        );
        assert.equal(
          await verdict("進撃の巨人（1）", "", {
            title: "進撃の巨人",
            volume: "1",
          }),
          "same",
        );
        assert.equal(await verdict("こゝろ", "", { title: "こころ" }), "same");
        assert.equal(
          await verdict("ABC殺人事件", "", { title: "ＡＢＣ殺人事件" }),
          "same",
        );
        // A script the folding drops is compared as it is written.
        assert.equal(
          await verdict("채식주의자", "", { title: "채식주의자" }),
          "same",
        );
        // The same volume written another way (the owner, 2026-10-17 04:15Z:
        // a way of writing is not another volume).
        const shingeki = { title: "進撃の巨人", volume: "1" };
        for (const [typed, master] of [
          ["進撃の巨人 第1巻", shingeki],
          ["進撃の巨人（１）", { title: "進撃の巨人", volume: "第1巻" }],
          ["進撃の巨人 01", shingeki],
          ["ノルウェイの森 1", { title: "ノルウェイの森", volume: "上" }],
          ["ノルウェイの森（下）", { title: "ノルウェイの森", volume: "2" }],
          ["銀河英雄伝説 二", { title: "銀河英雄伝説", volume: "2" }],
          ["銀河英雄伝説 第十二巻", { title: "銀河英雄伝説", volume: "12" }],
          ["架空の物語 Vol.3", { title: "架空の物語", volume: "3" }],
          ["しんげきのきょじん 1", { ...shingeki, reading: "シンゲキ ノ キョジン" }],
          ["ゴルゴ13", { title: "ゴルゴ13", volume: "2" }],
        ] as const)
          assert.equal(await verdict(typed, "", master), "same", typed);
      },
    );

    await check(
      "close: one title inside the other, the title's reading, or an author of the master's",
      async () => {
        assert.equal(
          await verdict("架空の図書館（新装版）", "", LIBRARY),
          "close",
        );
        assert.equal(await verdict("図書館", "", LIBRARY), "close");
        assert.equal(
          await verdict("華氏451度", "", {
            title: "華氏451度",
            subtitle: "新訳版",
          }),
          "same",
        );
        assert.equal(
          await verdict("華氏451度 新訳版", "", { title: "華氏451度" }),
          "close",
        );
        assert.equal(await verdict("かくうのとしょかん", "", LIBRARY), "close");
        // A volume not typed is the title; one the master does not tell, close.
        assert.equal(
          await verdict("進撃の巨人", "", { title: "進撃の巨人", volume: "1" }),
          "same",
        );
        assert.equal(
          await verdict("架空の図書館 2026年版", "", LIBRARY),
          "close",
        );
        assert.equal(
          await verdict("ノルウェイの森 上", "", {
            title: "ノルウェイの森",
            volume: "上",
          }),
          "same",
        );
        assert.equal(
          await verdict("1Q84 BOOK1", "", { title: "1Q84", volume: "BOOK1" }),
          "same",
        );
        // Numbers that are not clearly a volume, or a master that tells
        // none: the rest decides.
        assert.equal(
          await verdict("進撃の巨人 2", "", { title: "進撃の巨人" }),
          "close",
        );
        assert.equal(
          await verdict("架空の図書館 2026", "", {
            title: "架空の図書館",
            volume: "上",
          }),
          "close",
        );
        assert.equal(
          await verdict("進撃の巨人 2 (講談社コミックス)", "", {
            title: "進撃の巨人",
            volume: "1",
          }),
          "close",
        );
        // A script the folding drops, with a number: the whole of it.
        assert.equal(
          await verdict("Война и мир 1", "", { title: "Война и мир" }),
          "close",
        );
        // Titles apart, an author agreeing: by name, by reading, by the
        // authority's form without its years.
        assert.equal(
          await verdict("ちがう題", "山田 一郎 著", LIBRARY),
          "close",
        );
        assert.equal(
          await verdict("ちがう題", "ヤマダ イチロウ", LIBRARY),
          "close",
        );
        assert.equal(
          await verdict("Fahrenheit 451", "Ray Bradbury", {
            title: "華氏451度",
            creators: [
              {
                name: "レイ・ブラッドベリ",
                reading: "ブラッドベリ, レイ",
                heading: "Bradbury, Ray, 1920-2012",
              },
            ],
          }),
          "close",
        );
        assert.equal(
          await verdict("Ein anderes Buch", "Bradbury, Ray", {
            title: "華氏451度",
            creators: [
              {
                name: "レイ・ブラッドベリ",
                heading: "Bradbury, Ray, 1920-2012",
              },
            ],
          }),
          "close",
        );
        assert.equal(
          await verdict("다른 책", "한강", {
            title: "채식주의자",
            creators: [{ name: "한강" }],
          }),
          "close",
        );
      },
    );

    await check(
      "apart: no title inside the other and no author agreeing (with no author typed, the title alone decides), or another volume whatever agrees; none with no letter in the title",
      async () => {
        assert.equal(
          await verdict("ハリポタ1", "", {
            title: "ハリー・ポッターと賢者の石",
          }),
          "apart",
        );
        assert.equal(await verdict("まったく別の本", "", LIBRARY), "apart");
        assert.equal(
          await verdict("まったく別の本", "村上龍", LIBRARY),
          "apart",
        );
        // One letter is too little to be inside anything.
        assert.equal(await verdict("本", "", { title: "本の雑誌" }), "apart");
        // No letter in the title: nothing to compare, unless an author agrees.
        assert.equal(await verdict("！？", "", { title: "本の雑誌" }), "none");
        assert.equal(await verdict("！？", "山田一郎", LIBRARY), "close");
        // Another volume of the work: one work is one volume, so its number
        // (or 上・中・下) decides where the master tells its volume.
        const shingeki = {
          title: "進撃の巨人",
          volume: "1",
          creators: [{ name: "諫山創" }],
        };
        assert.equal(await verdict("進撃の巨人 2", "", shingeki), "apart");
        for (const [typed, master] of [
          ["ノルウェイの森 2", { title: "ノルウェイの森", volume: "上" }],
          ["ノルウェイの森 下", { title: "ノルウェイの森", volume: "1" }],
          ["銀河英雄伝説 二", { title: "銀河英雄伝説", volume: "1" }],
          ["ゴルゴ13 2", { title: "ゴルゴ13", volume: "1" }],
          ["しんげきのきょじん 2", { ...shingeki, reading: "シンゲキ ノ キョジン" }],
        ] as const)
          assert.equal(await verdict(typed, "", master), "apart", typed);
        assert.equal(
          await verdict("Анна Каренина 1", "", { title: "Война и мир 1" }),
          "apart",
        );
        assert.equal(
          await verdict("進撃の巨人（２）", "諫山創", shingeki),
          "apart",
        );
        assert.equal(
          await verdict("ノルウェイの森 下", "村上春樹", {
            title: "ノルウェイの森",
            volume: "上",
            creators: [{ name: "村上春樹" }],
          }),
          "apart",
        );
        assert.equal(
          await verdict("ONE PIECE 12", "", { title: "ONE PIECE 1" }),
          "apart",
        );
        assert.equal(
          await verdict("1Q84 BOOK2", "", { title: "1Q84", volume: "BOOK1" }),
          "apart",
        );
        assert.equal(
          await verdict("菜食主義者", "", { title: "채식주의자" }),
          "apart",
        );
        // An author line that names someone else entirely.
        assert.equal(
          await verdict("まったく別の本", "村上春樹", {
            title: "架空の図書館",
            creators: [{ name: "村上龍" }],
          }),
          "apart",
        );
      },
    );
    await db.close();
  }

  // When, and what a verdict changes ---------------------------------------------------

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
    later,
    quiet,
    settle,
    shown,
  } = helpers(db);
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}');
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
  `);

  const LIBRARY_X1 = sru({
    isbns: [X(1)],
    title: "架空の図書館",
    reading: "カクウ ノ トショカン",
    agents: [{ name: "山田, 一郎" }],
    publisher: "架空書房",
  });
  const OPENBD_X1 = openbd({
    isbn: X(1),
    title: "架空の図書館",
    people: [{ name: "山田 一郎" }],
    publisher: "架空書房",
  });
  /** Answers every question out: X1 as above, the rest as given, and openBD's too. */
  const answerWith = (
    library: Record<string, string> = {},
    open: Record<string, unknown> = {},
  ) =>
    answerAll(
      db,
      { [X(1)]: LIBRARY_X1, ...library },
      { [X(1)]: OPENBD_X1, ...open },
    );
  /** A tick, the answers to what it asked, and the tick that reads them. */
  const round = async (
    library: Record<string, string> = {},
    open: Record<string, unknown> = {},
  ) => {
    await tick();
    await answerWith(library, open);
    await tick();
  };
  const check_ = async (book: string) =>
    (
      await rows<{
        verdict: string | null;
        judged: boolean;
        checked: boolean;
        confirmed: boolean;
        held: boolean;
        in_edition_work: boolean;
        counts: boolean;
        judged_at: string | null;
      }>(
        `select c.verdict, c.judged_at is not null as judged, c.checked_at is not null as checked,
           c.confirmed_at is not null as confirmed, c.held_work is not null as held,
           b.work_id = e.work_id as in_edition_work,
           private.book_counts_in_work(b.id) as counts, c.judged_at::text
         from private.book_checks c join books b on b.id = c.book_id
         join editions e on e.id = b.edition_id
         where c.book_id = $1`,
        [book],
      )
    )[0];
  const moves = (book: string) =>
    rows<{ kind: string; to_held: boolean }>(
      `select w.kind, w.to_work = c.held_work as to_held
       from private.work_changes w join private.book_checks c on c.book_id = w.book_id
       where w.book_id = $1 and w.kind in ('hold', 'unhold') order by w.changed_at, w.id`,
      [book],
    );
  const holds = (visitor: string | null) =>
    as<{ book_id: string; title: string; creators: unknown; held_at: string }>(
      visitor,
      "select book_id, held_at::text as held_at, title, creators from book_holds()",
    );
  const post = (author: string, book: string) =>
    as(
      author,
      "insert into posts (author_id, body, book_id) values ($1, 'よかった', $2)",
      [author, book],
    );

  const akis = id(1, 1);
  const bens = id(1, 2);
  const chis = id(1, 3);

  await check(
    "a book is judged ten minutes after it is placed, from what the sources answered since, whether its ISBN was registered before or not; until then it neither shows the master nor counts",
    async () => {
      // Aki registers X1, answered long ago (before her book), and Ben X2,
      // which nobody had; both at once.
      await register(BEN, id(9, 1), X(1), "架空の図書館");
      await round();
      await later(60);
      await tick();
      assert.equal((await check_(id(9, 1))).verdict, "same");
      await settle();
      await register(AKI, akis, X(1), "架空の図書館");
      await register(BEN, bens, X(2), "夜の本");
      await round({ [X(2)]: sru({ isbns: [X(2)], title: "夜の本" }) });
      await round({ [X(2)]: sru({ isbns: [X(2)], title: "夜の本" }) });
      await later(9);
      await tick();
      for (const book of [akis, bens]) {
        const now = await check_(book);
        assert.equal(now.verdict, null, book);
        assert.equal(now.counts, false, book);
      }
      assert.deepEqual(await shown(AKI, [akis]), []);
      await later(1);
      await tick();
      for (const book of [akis, bens]) {
        const now = await check_(book);
        assert.equal(now.verdict, "same", book);
        assert.equal(now.counts, true, book);
        assert.equal(now.in_edition_work, true, book);
      }
      assert.equal((await shown(AKI, [akis]))[0].title, "架空の図書館");
      await settle();
    },
  );

  await check(
    "a book clearly another is held: in a work of its own, shown nowhere with the master, its reader told; nobody else learns of it",
    async () => {
      await register(CHI, chis, X(1), "まったく別の本");
      await post(CHI, chis);
      await round();
      await later(11);
      await tick();
      const held = await check_(chis);
      assert.equal(held.verdict, "apart");
      assert.equal(held.held, true);
      assert.equal(held.in_edition_work, false);
      assert.equal(held.counts, false);
      assert.deepEqual(await moves(chis), [{ kind: "hold", to_held: true }]);
      // Nobody is shown the master for it: not Chi, not a visitor of her post.
      for (const visitor of [CHI, AKI, null])
        assert.deepEqual(await shown(visitor, [chis]), [], String(visitor));
      // Chi is told, with the master's title as her book sees it; nobody else.
      const told = await holds(CHI);
      assert.deepEqual(
        told.map((h) => [h.book_id, h.title]),
        [[chis, "架空の図書館"]],
      );
      assert.equal(told[0].held_at, held.judged_at);
      assert.deepEqual(await holds(AKI), []);
      await refused(
        () => holds(null),
        /permission denied/,
        "a visitor asking for holds",
      );
      // Judged again with nothing changed, it stays as it is: same work,
      // same time.
      await rows(
        "update private.book_checks set checked_at = null where book_id = $1",
        [chis],
      );
      await judge();
      assert.deepEqual(await check_(chis), held);
      assert.equal((await moves(chis)).length, 1);
    },
  );

  await check(
    "the reader says it is the ISBN's: back in its edition's work, the master shows, and it is not judged again until it is placed again; nobody else can say it",
    async () => {
      await refused(
        () => as(AKI, "select confirm_book_isbn($1)", [chis]),
        /no book of yours is held with that id/,
        "another reader",
      );
      await refused(
        () => as(CHI, "select confirm_book_isbn($1)", [id(9, 9)]),
        /no book of yours is held with that id/,
        "a book that is not there",
      );
      await refused(
        () => as(AKI, "select confirm_book_isbn($1)", [akis]),
        /no book of yours is held with that id/,
        "a book of hers not held",
      );
      await refused(
        () => as(null, "select confirm_book_isbn($1)", [chis]),
        /permission denied/,
        "a visitor",
      );
      await as(CHI, "select confirm_book_isbn($1)", [chis]);
      const back = await check_(chis);
      assert.equal(back.confirmed, true);
      assert.equal(back.held, false);
      assert.equal(back.in_edition_work, true);
      assert.equal(back.counts, true);
      assert.deepEqual(
        (await moves(chis)).map((m) => m.kind),
        ["hold", "unhold"],
      );
      assert.equal((await shown(null, [chis]))[0].title, "架空の図書館");
      assert.deepEqual(await holds(CHI), []);
      await refused(
        () => as(CHI, "select confirm_book_isbn($1)", [chis]),
        /no book of yours is held with that id/,
        "saying it twice",
      );
      // The sources' answers judge it no more.
      await rows("select private.refetch_bibliography($1)", [chis]);
      await round();
      assert.deepEqual(await check_(chis), back);
      // Her edits do (the owner, 2026-10-17 03:22Z: 確かめ直す): what she
      // said was about what the book said then. Held again, she is told
      // again, and says it again.
      await as(CHI, "update books set title = 'もっと別の本' where id = $1", [
        chis,
      ]);
      assert.equal((await check_(chis)).confirmed, false);
      await tick();
      const again = await check_(chis);
      assert.equal(again.held, true);
      assert.deepEqual(
        (await holds(CHI)).map((h) => h.book_id),
        [chis],
      );
      await as(CHI, "select confirm_book_isbn($1)", [chis]);
      assert.equal((await check_(chis)).confirmed, true);
      assert.equal((await check_(chis)).in_edition_work, true);
      // Placed again, it starts over.
      await as(CHI, "update books set isbn = $2 where id = $1", [chis, X(3)]);
      const moved = await check_(chis);
      assert.equal(moved.verdict, null);
      assert.equal(moved.confirmed, false);
      assert.equal(moved.held, false);
      assert.equal(moved.in_edition_work, true);
      await settle();
    },
  );

  await check(
    "the reader's edits judge a book again: a held one fixed goes back, one edited into another book is held anew and told again",
    async () => {
      const book = id(1, 4);
      await register(CHI, book, X(1), "ちがう本");
      await round();
      await later(11);
      await tick();
      const first = await check_(book);
      assert.equal(first.held, true);
      await as(
        CHI,
        "update books set title = '架空の図書館（文庫）' where id = $1",
        [book],
      );
      await tick();
      const fixed = await check_(book);
      assert.equal(fixed.verdict, "close");
      assert.equal(fixed.in_edition_work, true);
      assert.notEqual(fixed.judged_at, first.judged_at);
      assert.deepEqual(await holds(CHI), []);
      await as(CHI, "update books set title = 'まるで別の本' where id = $1", [
        book,
      ]);
      await tick();
      const again = await check_(book);
      assert.equal(again.held, true);
      assert.equal(again.in_edition_work, false);
      assert.deepEqual(
        (await moves(book)).map((m) => m.kind),
        ["hold", "unhold", "hold"],
      );
      // Held again, in the work it was held in before, empty since.
      assert.equal(
        await count(
          "select count(distinct to_work) from private.work_changes where book_id = $1 and kind = 'hold'",
          [book],
        ),
        1,
      );
      assert.deepEqual(
        (await holds(CHI)).map((h) => h.book_id),
        [book],
      );
      // An author agreeing is enough.
      await as(CHI, "update books set author = '山田一郎' where id = $1", [
        book,
      ]);
      await tick();
      assert.equal((await check_(book)).verdict, "close");
      assert.equal((await check_(book)).in_edition_work, true);
      await settle();
    },
  );

  await check(
    "a master with no title: none once both sources have answered since the book was placed, or a day on; judged again when a title comes",
    async () => {
      const nothing = id(1, 5);
      const failing = id(1, 6);
      await register(AKI, nothing, X(5), "どこにもない本");
      await register(AKI, failing, X(6), "答えのない本");
      // The library has neither; openBD has neither; the library fails for
      // X6 every time.
      const answerNone = async () => {
        for (const q of await questions())
          await answer(
            q.id,
            q.url.includes(X(6)) && q.url.startsWith("https://ndlsearch")
              ? "<html>busy</html>"
              : q.url.startsWith("https://ndlsearch")
                ? diagnostic("Record does not exist")
                : JSON.stringify(
                    (new URL(q.url).searchParams.get("isbn") ?? "")
                      .split(",")
                      .map(() => null),
                  ),
            q.url.includes(X(6)) && q.url.startsWith("https://ndlsearch")
              ? 503
              : 200,
          );
      };
      for (let turn = 0; turn < 3; turn++) {
        await tick();
        await answerNone();
      }
      await tick();
      await later(11);
      await tick();
      assert.equal((await check_(nothing)).verdict, "none");
      assert.equal((await check_(nothing)).counts, true);
      assert.equal((await check_(failing)).verdict, null);
      assert.equal((await check_(failing)).checked, true);
      assert.equal((await check_(failing)).counts, false);
      assert.deepEqual(await shown(AKI, [nothing, failing]), []);
      await later(24 * 60);
      await quiet();
      await tick();
      assert.equal((await check_(failing)).verdict, "none");
      assert.equal((await check_(failing)).counts, true);
      // The library has X5 after all.
      await rows("select private.refetch_bibliography($1)", [nothing]);
      await round({ [X(5)]: sru({ isbns: [X(5)], title: "どこにもない本" }) });
      assert.equal((await check_(nothing)).verdict, "same");
      assert.equal((await shown(AKI, [nothing]))[0].title, "どこにもない本");
      await settle();
    },
  );

  await check(
    "what a book sees changing judges it again: the operator's correction, a source's new answer; only a different verdict shows",
    async () => {
      // (Whatever an answer before marked to compare again, compared.)
      await tick();
      const before = await check_(akis);
      assert.equal(before.verdict, "same");
      assert.equal(before.checked, true);
      // The same answer again changes nothing that shows.
      await rows("select private.refetch_bibliography($1)", [akis]);
      await round();
      assert.deepEqual(await check_(akis), before);
      // A correction to a title nobody typed holds the books of X1 that do
      // not agree with it (with no author typed, the title alone decides),
      // and taking it back puts them back. (The operator corrects only an
      // edition with a book in a public place.)
      await post(AKI, akis);
      await rows(
        "select private.fix_bibliography($1, 'title', '\"夜明けの書\"')",
        [akis],
      );
      await tick();
      const fixed = await check_(akis);
      assert.equal(fixed.verdict, "apart");
      assert.equal(fixed.held, true);
      assert.notEqual(fixed.judged_at, before.judged_at);
      assert.equal((await check_(id(9, 1))).held, true);
      await rows("select private.unfix_bibliography($1, 'title')", [akis]);
      await tick();
      for (const book of [akis, id(9, 1)]) {
        const back = await check_(book);
        assert.equal(back.verdict, "same", book);
        assert.equal(back.held, false, book);
        assert.equal(back.in_edition_work, true, book);
      }
      assert.deepEqual(
        (await moves(akis)).map((m) => m.kind),
        ["hold", "unhold"],
      );
      // A source withdrawn marks the edition's books to be judged again from
      // what is left (openBD's title), and allowed back, again.
      await rows("select private.withdraw_bibliography($1, 'ndl')", [akis]);
      assert.equal((await check_(akis)).checked, false);
      await tick();
      assert.equal((await check_(akis)).verdict, "same");
      await rows("select private.allow_bibliography($1, 'ndl')", [akis]);
      assert.equal((await check_(akis)).checked, false);
      await round();
      assert.equal((await check_(akis)).verdict, "same");
      await settle();
    },
  );

  await check(
    "held books stay out of the work candidates, and the operator lists them and does not join their works",
    async () => {
      // Ben's 夜の本 on X1 is held; Chi's 夜の本 on X7 is not: the same title
      // and author, in two works, both in public places.
      const bensHeld = id(1, 7);
      const chisNight = id(1, 8);
      await register(BEN, bensHeld, X(1), "夜の本", "海野波子");
      await register(CHI, chisNight, X(7), "夜の本", "海野波子");
      await post(BEN, bensHeld);
      await post(CHI, chisNight);
      // The library is asked about one edition a turn: two rounds.
      const library = {
        [X(7)]: sru({
          isbns: [X(7)],
          title: "夜の本",
          agents: [{ name: "海野, 波子" }],
        }),
      };
      await round(library);
      await round(library);
      await later(11);
      await tick();
      assert.equal((await check_(bensHeld)).held, true);
      assert.equal((await check_(chisNight)).verdict, "same");
      const candidates = await rows<{ book_a: string; book_b: string }>(
        "select book_a, book_b from private.work_candidates()",
      );
      assert.ok(
        !candidates.some((c) => [c.book_a, c.book_b].includes(bensHeld)),
        "a held book is no candidate",
      );
      assert.deepEqual(
        await rows(
          `select why, listed, a_book, title, author, master_title,
             master_creators -> 0 ->> 'name' as master_author, held_at is not null as held
           from private.bibliography_review where why = 'held' and a_book = $1`,
          [bensHeld],
        ),
        [
          {
            why: "held",
            listed: true,
            a_book: bensHeld,
            title: "夜の本",
            author: "海野波子",
            master_title: "架空の図書館",
            master_author: "山田一郎",
            held: true,
          },
        ],
      );
      await refused(
        () =>
          rows("select * from private.join_works($1, $2)", [
            chisNight,
            bensHeld,
          ]),
        /a held book/,
        "joining a held book's work",
      );
      await refused(
        () =>
          rows("select * from private.join_works($1, $2)", [
            bensHeld,
            chisNight,
          ]),
        /a held book/,
        "joining into a held book's work",
      );
      await refused(
        () => rows("select private.part_books($1::uuid[])", [[bensHeld]]),
        /nothing to part/,
        "parting a held book",
      );
      // Said to be the ISBN's, it is a candidate again, with its edition's
      // work.
      await as(BEN, "select confirm_book_isbn($1)", [bensHeld]);
      assert.ok(
        (
          await rows<{ book_a: string; book_b: string }>(
            "select book_a, book_b from private.work_candidates()",
          )
        ).some((c) => [c.book_a, c.book_b].includes(bensHeld)),
      );
      await settle();
    },
  );

  await check(
    "the operator puts a held book back when its reader cannot answer, as the reader's answer would",
    async () => {
      const gone = id(1, 12);
      await register(AKI, gone, X(1), "まるで違う題");
      await round();
      await later(11);
      await tick();
      assert.equal((await check_(gone)).held, true);
      await rows("select private.release_hold($1)", [gone]);
      const back = await check_(gone);
      assert.equal(back.held, false);
      assert.equal(back.confirmed, true);
      assert.equal(back.in_edition_work, true);
      assert.equal(back.counts, true);
      assert.deepEqual(
        (await moves(gone)).map((m) => m.kind),
        ["hold", "unhold"],
      );
      for (const book of [gone, akis, id(9, 9)])
        await refused(
          () => rows("select private.release_hold($1)", [book]),
          /no book is held with that id/,
          book,
        );
      await settle();
    },
  );

  await check(
    "a source slow to answer is asked nothing more until it answers, and the library is waited on for a minute",
    async () => {
      await quiet();
      await register(AKI, id(1, 9), X(9), "九の本");
      await register(AKI, id(1, 10), X(10), "十の本");
      await tick();
      const first = await questions();
      const library = first.filter((q) =>
        q.url.startsWith("https://ndlsearch"),
      );
      assert.equal(library.length, 1);
      assert.equal(
        await count(
          "select timeout_milliseconds from net.http_request_queue where id = $1",
          [library[0].id],
        ),
        60000,
      );
      // Half a minute on with no answer: nothing more to the library.
      await rows(
        "update private.edition_sources set sent_at = now() - interval '31 seconds' where request_id = $1",
        [library[0].id],
      );
      await tick();
      assert.equal(
        (await questions()).filter((q) => q.url.startsWith("https://ndlsearch"))
          .length,
        1,
      );
      // Answered, the next goes.
      await answer(library[0].id, diagnostic("Record does not exist"));
      await tick();
      const next = (await questions()).filter((q) =>
        q.url.startsWith("https://ndlsearch"),
      );
      assert.equal(next.length, 1);
      assert.notEqual(next[0].id, library[0].id);
      await settle();
    },
  );

  const sees = async (book: string) =>
    (
      await rows<{ title: string | null }>(
        `select (private.edition_bibliography(b.edition_id, c.placed_at)).title
         from books b join private.book_checks c on c.book_id = b.id where b.id = $1`,
        [book],
      )
    )[0].title;
  const asking = async (source: "ndl" | "openbd") =>
    (await questions())
      .filter((q) =>
        q.url.startsWith(
          source === "ndl" ? "https://ndlsearch" : "https://api.openbd.jp/",
        ),
      )
      .map((q) =>
        source === "ndl"
          ? decodeURIComponent(q.url).match(/isbn="(\d{13})"/)?.[1]
          : new URL(q.url).searchParams.get("isbn"),
      );

  await check(
    "a book placed while an earlier book of its ISBN waits, in private, is asked about at its own turn, after the books placed before it; the earlier question does not answer it",
    async () => {
      await settle();
      const bens40 = id(4, 1);
      const akis41 = id(4, 2);
      const chis40 = id(4, 3);
      const forty = {
        [X(40)]: sru({ isbns: [X(40)], title: "四十の本" }),
        [X(41)]: sru({ isbns: [X(41)], title: "四十一の本" }),
      };
      const fortyOpen = {
        [X(40)]: openbd({ isbn: X(40), title: "四十の本" }),
        [X(41)]: openbd({ isbn: X(41), title: "四十一の本" }),
      };
      await register(BEN, bens40, X(40), "四十の本");
      await tick();
      assert.deepEqual(await asking("ndl"), [X(40)]);
      // While Ben's questions are out, Aki registers X41, which nobody had,
      // and then Chi X40.
      await register(AKI, akis41, X(41), "四十一の本");
      await register(CHI, chis40, X(40), "四十の本");
      await answerAll(db, forty, fortyOpen);
      await tick();
      // Ben's answers are his: Chi's copy sees nothing of them, and the
      // library is asked about Aki's X41 before Chi's X40, as if nobody had
      // X40.
      assert.equal(await sees(bens40), "四十の本");
      assert.equal(await sees(chis40), null);
      assert.deepEqual(await asking("ndl"), [X(41)]);
      assert.deepEqual(await asking("openbd"), [`${X(41)},${X(40)}`]);
      await answerAll(db, forty, fortyOpen);
      await tick();
      assert.deepEqual(await asking("ndl"), [X(40)]);
      await answerAll(db, forty, fortyOpen);
      await tick();
      assert.equal(await sees(chis40), "四十の本");
      await later(11);
      await tick();
      for (const book of [bens40, akis41, chis40])
        assert.equal((await check_(book)).verdict, "same", book);
      await settle();
    },
  );

  await check(
    "a book on an ISBN answered before, in private, waits for its own answers: no verdict ten minutes on until they come; a source answering that it has nothing ends the wait",
    async () => {
      const bens42 = id(4, 4);
      const akis42 = id(4, 5);
      const akis43 = id(4, 6);
      await register(BEN, bens42, X(42), "四十二の本");
      await round(
        { [X(42)]: sru({ isbns: [X(42)], title: "四十二の本" }) },
        { [X(42)]: openbd({ isbn: X(42), title: "四十二の本" }) },
      );
      await settle();
      await register(AKI, akis42, X(42), "四十二の本");
      await register(AKI, akis43, X(43), "どこにもない本");
      await tick();
      await later(11);
      await tick();
      for (const book of [akis42, akis43]) {
        const waiting = await check_(book);
        assert.equal(waiting.verdict, null, book);
        assert.equal(waiting.checked, true, book);
        assert.equal(waiting.counts, false, book);
      }
      // The answers come after the ten minutes: X42 found, X43 nowhere.
      const nowhere = async () => {
        for (const q of await questions())
          await answer(
            q.id,
            q.url.startsWith("https://ndlsearch")
              ? q.url.includes(X(42))
                ? sru({ isbns: [X(42)], title: "四十二の本" })
                : diagnostic("Record does not exist")
              : JSON.stringify(
                  (new URL(q.url).searchParams.get("isbn") ?? "")
                    .split(",")
                    .map((isbn) =>
                      isbn === X(42)
                        ? openbd({ isbn: X(42), title: "四十二の本" })
                        : null,
                    ),
                ),
          );
      };
      for (let turn = 0; turn < 3; turn++) {
        await nowhere();
        await tick();
      }
      assert.equal((await check_(akis42)).verdict, "same");
      assert.equal((await check_(akis43)).verdict, "none");
      assert.equal((await check_(akis43)).counts, true);
      await settle();
    },
  );

  await check(
    "a held book: held_at is when it was held, the operator does not keep its work apart, a held work needs a verdict apart, and an edited ISBN takes it to its new edition's work",
    async () => {
      const book = id(4, 7);
      await register(CHI, book, X(44), "まったく別の本");
      await round(
        { [X(44)]: sru({ isbns: [X(44)], title: "四十四の本" }) },
        { [X(44)]: openbd({ isbn: X(44), title: "四十四の本" }) },
      );
      await later(11);
      await tick();
      assert.equal((await check_(book)).held, true);
      // Compared again later, still apart: told when it was held.
      await rows(
        `update private.book_checks set checked_at = null,
           judged_at = judged_at - interval '1 hour' where book_id = $1`,
        [book],
      );
      await judge();
      const [told] = await holds(CHI);
      const [when] = await rows<{ judged_at: string; checked_at: string }>(
        "select judged_at::text, checked_at::text from private.book_checks where book_id = $1",
        [book],
      );
      assert.equal(told.held_at, when.judged_at);
      assert.notEqual(told.held_at, when.checked_at);
      await refused(
        () => rows("select private.keep_apart($1, $2)", [book, akis]),
        /a held book/,
        "keeping a held book's work apart",
      );
      await refused(
        () =>
          rows(
            "update private.book_checks set verdict = null where book_id = $1",
            [book],
          ),
        /check constraint/,
        "a held work with no verdict",
      );
      await as(CHI, "update books set isbn = $2 where id = $1", [book, X(45)]);
      const moved = await check_(book);
      assert.equal(moved.held, false);
      assert.equal(moved.in_edition_work, true);
      assert.equal(moved.verdict, null);
      assert.deepEqual(await holds(CHI), []);
      await settle();
    },
  );

  await check(
    "an answer the same as before compares again only the books it shows something new; a book the tick could not mark is compared on the next",
    async () => {
      const stamp = async (book: string) =>
        (
          await rows<{ at: string }>(
            "select checked_at::text as at from private.book_checks where book_id = $1",
            [book],
          )
        )[0].at;
      await tick();
      const was = await stamp(akis);
      await rows("select private.refetch_bibliography($1)", [akis]);
      await round();
      assert.equal(await stamp(akis), was);
      await rows("insert into private.book_rechecks (book_id) values ($1)", [
        akis,
      ]);
      await tick();
      assert.notEqual(await stamp(akis), was);
      assert.equal(await count("select count(*) from private.book_rechecks"), 0);
      await settle();
    },
  );

  await check(
    "a book without an ISBN left with no verdict (registered while the file was applied) is none on the next tick",
    async () => {
      const plain = id(4, 8);
      await register(AKI, plain, null, "手帖");
      await rows(
        `update private.book_checks set checked_at = null, verdict = null, judged_at = null
         where book_id = $1`,
        [plain],
      );
      await later(11);
      await tick();
      assert.equal((await check_(plain)).verdict, "none");
      assert.equal((await check_(plain)).counts, true);
    },
  );

  await check(
    "editions due at the same time with nothing owed are asked about in the order of their ids",
    async () => {
      const together = [X(9), X(10), X(11)];
      await register(AKI, id(1, 11), X(11), "十一の本");
      await settle();
      // As if their answers had been read together, alike: due again at one time.
      await rows(
        `update private.edition_sources s set settled_at = now(), refetch_at = null,
           settled_for = now(), tried_for = now(), next_at = now() - interval '1 minute',
           state = 'found', status = null
         from editions e where e.id = s.edition_id and e.isbn = any ($1::text[])`,
        [together],
      );
      for (let turn = 0; turn < 3; turn++) await tick();
      const byId = (
        await rows<{ isbn: string }>(
          "select isbn from editions where isbn = any ($1::text[]) order by id",
          [together],
        )
      ).map((e) => e.isbn);
      const out = await questions();
      assert.deepEqual(
        out
          .filter((q) => q.url.startsWith("https://ndlsearch"))
          .map((q) => decodeURIComponent(q.url).match(/isbn="(\d{13})"/)?.[1]),
        byId,
      );
      assert.deepEqual(
        out
          .filter((q) => q.url.startsWith("https://api.openbd.jp/"))
          .map((q) => new URL(q.url).searchParams.get("isbn")?.split(",")),
        [byId],
      );
      await settle();
    },
  );

  await check(
    "readers reach book_holds and confirm_book_isbn signed in, and nothing else of this file",
    async () => {
      const made = [
        ...TEXT.matchAll(
          /^create (?:or replace )?function (private|public)\.(\w+)\(/gm,
        ),
      ];
      assert.ok(made.length >= 10);
      for (const [, schema, name] of made) {
        const reach = await rows<{ anon: boolean; signed: boolean }>(
          `select has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as signed
           from pg_proc p where p.proname = $1 and p.pronamespace = $2::regnamespace`,
          [name, schema],
        );
        assert.equal(reach.length, 1, name);
        const expected =
          name === "book_bibliography"
            ? { anon: true, signed: true }
            : name === "book_holds" || name === "confirm_book_isbn"
              ? { anon: false, signed: true }
              : { anon: false, signed: false };
        assert.deepEqual(reach[0], expected, `${schema}.${name}`);
      }
      assert.equal(
        await count(
          `select count(*) from information_schema.role_table_grants
           where table_schema = 'private' and table_name = 'bibliography_review'
             and grantee in ('anon', 'authenticated')`,
        ),
        0,
      );
    },
  );
  await db.close();

  // The move and undoing it ----------------------------------------------------------

  await check(
    "the move changes no book; books without an ISBN are none at once, the others wait their turn",
    async () => {
      const earlier = await migrated(HOLDS);
      const on = helpers(earlier);
      await earlier.exec(`
        insert into auth.users (id) values ('${AKI}');
        insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ');
        insert into books (id, isbn, title, created_by) values
          ('${id(5, 1)}', '${X(1)}', '一冊目', '${AKI}'),
          ('${id(5, 2)}', null, '手帖', '${AKI}');
      `);
      const books = () =>
        on.rows("select to_jsonb(b) as row from books b order by id");
      const was = await books();
      await earlier.exec(TEXT);
      assert.deepEqual(await books(), was);
      assert.deepEqual(
        await on.rows(
          `select book_id, verdict, checked_at is not null as checked, judged_at is not null as judged,
             confirmed_at, held_work from private.book_checks order by book_id`,
        ),
        [
          {
            book_id: id(5, 1),
            verdict: null,
            checked: false,
            judged: false,
            confirmed_at: null,
            held_work: null,
          },
          {
            book_id: id(5, 2),
            verdict: "none",
            checked: true,
            judged: true,
            confirmed_at: null,
            held_work: null,
          },
        ],
      );
      await earlier.close();
    },
  );

  await check(
    "the rollback in the header leaves the database as it was before, a held book back in its edition's work",
    async () => {
      const earlier = await migrated(HOLDS);
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      assert.notDeepEqual(await catalog(earlier), was);
      const before = helpers(earlier);
      await earlier.exec(`
        insert into auth.users (id) values ('${AKI}');
        insert into profiles (id, handle, name) values ('${AKI}', 'aki', 'アキ');
      `);
      const held = id(6, 1);
      await before.register(AKI, held, X(30), "まったく別の本");
      await before.tick();
      await answerAll(
        earlier,
        { [X(30)]: sru({ isbns: [X(30)], title: "架空の図書館" }) },
        { [X(30)]: openbd({ isbn: X(30), title: "架空の図書館" }) },
      );
      await before.tick();
      await before.later(11);
      await before.tick();
      const where = () =>
        before.rows<{ home: boolean }>(
          `select b.work_id = e.work_id as home from books b
           join editions e on e.id = b.edition_id where b.id = $1`,
          [held],
        );
      assert.deepEqual(await where(), [{ home: false }]);
      const rollback = rollbackSql();
      assert.match(rollback, /drop function public\.book_holds\(\)/);
      await earlier.exec(rollback);
      // The moves written down stay, holds among them, so their kinds stay
      // allowed: the one difference.
      const kinds = "private.work_changes.work_changes_kind_check";
      const without = (all: Awaited<ReturnType<typeof catalog>>) =>
        all.filter((row) => row.name !== kinds);
      assert.deepEqual(without(await catalog(earlier)), without(was));
      assert.deepEqual(await where(), [{ home: true }]);
      assert.deepEqual(
        (
          await before.rows<{ kind: string }>(
            "select kind from private.work_changes where book_id = $1 order by changed_at, id",
            [held],
          )
        ).map((row) => row.kind),
        ["hold", "unhold"],
      );
      // The tick as it was runs, and the file runs again.
      await before.tick();
      await earlier.exec(TEXT);
      await earlier.close();
    },
  );

  console.log(`${passed} holds checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
