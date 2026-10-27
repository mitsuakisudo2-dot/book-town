import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  clearOfJapanMidnight,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import { catalog } from "./fixtures/bibliography";
import {
  STUMBLES_PER_SEND,
  STUMBLE_FEATURES,
  STUMBLE_RESULTS,
} from "../src/lib/stumbles";

// 機能ごとのつまずきを数える (supabase/migrations/*_stumble_counts.sql, 管理表
// 110): only a signed-in reader may send counts, the function has no place
// for anything but a feature, a result and a number, a day is at most 20
// rows however many send, nobody reads the table through the API, the sums
// hide a cell tried fewer than 20 times, and rows go after 90 days.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_stumble_counts.sql"));
assert.ok(FILE, "the stumble counts migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";

async function before(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
    await db.exec(migrationText(file));
  await db.exec(`insert into auth.users (id) values ('${AKI}'), ('${BEN}');`);
  return db;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    // Most checks send twice and expect the same day in Japan.
    await clearOfJapanMidnight();
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await before();
  await db.exec(TEXT);
  async function rows<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }
  async function as<T = Record<string, unknown>>(
    visitor: string | null,
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
  async function refused(run: () => Promise<unknown>, what: string) {
    let error: unknown = null;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, "expected a refusal: " + what);
  }
  const send = (
    visitor: string | null,
    features: unknown,
    results: unknown,
    times: unknown,
  ) =>
    as(visitor, "select public.count_stumbles($1, $2, $3)", [
      features,
      results,
      times,
    ]);
  const all = () =>
    rows<{ feature: string; result: string; times: number }>(
      "select feature, result, times from private.stumbles order by feature, result",
    );
  const clear = () => db.exec("delete from private.stumbles");

  await check("the database's lists are the app's", async () => {
    for (const feature of STUMBLE_FEATURES)
      assert.ok(TEXT.includes(`'${feature}'`), feature);
    for (const result of STUMBLE_RESULTS)
      assert.ok(TEXT.includes(`'${result}'`), result);
    assert.match(TEXT, new RegExp(`least\\(c\\.n, ${STUMBLES_PER_SEND}\\)`));
    assert.equal(STUMBLE_FEATURES.length * STUMBLE_RESULTS.length, 20);
  });

  await check(
    "a signed-in reader's counts are added to the day's rows",
    async () => {
      await send(
        AKI,
        ["search", "search", "register"],
        ["ok", "not_found", "ok"],
        [3, 1, 2],
      );
      await send(BEN, ["search"], ["ok"], [4]);
      assert.deepEqual(await all(), [
        { feature: "register", result: "ok", times: 2 },
        { feature: "search", result: "not_found", times: 1 },
        { feature: "search", result: "ok", times: 7 },
      ]);
      // Only the day, the feature, the result and the count are kept.
      const columns = await rows<{ column_name: string }>(
        `select column_name from information_schema.columns
       where table_schema = 'private' and table_name = 'stumbles' order by ordinal_position`,
      );
      assert.deepEqual(
        columns.map((column) => column.column_name),
        ["day", "feature", "result", "times"],
      );
      // And the function takes nothing else.
      const [fn] = await rows<{ args: string }>(
        `select pg_get_function_arguments('public.count_stumbles(text[], text[], integer[])'::regprocedure) as args`,
      );
      assert.equal(fn.args, "features text[], results text[], times integer[]");
    },
  );

  await check("a visitor not signed in cannot send", async () => {
    await clear();
    await refused(
      () => send(null, ["search"], ["ok"], [1]),
      "a visitor sending counts",
    );
    assert.deepEqual(await all(), []);
  });

  await check("nobody reads or writes the table through the API", async () => {
    for (const visitor of [null, AKI]) {
      await refused(
        () => as(visitor, "select * from private.stumbles"),
        "reading the table",
      );
      await refused(
        () =>
          as(
            visitor,
            "insert into private.stumbles (day, feature, result, times) values (current_date, 'search', 'ok', 1)",
          ),
        "writing the table directly",
      );
      await refused(
        () => as(visitor, "select * from private.stumble_totals('week')"),
        "reading the sums",
      );
      await refused(
        () => as(visitor, "select private.forget_stumbles()"),
        "running the nightly job",
      );
    }
  });

  await check("what does not fit is dropped without a word", async () => {
    await clear();
    // Not one of the lists, uneven lists, none, too many, nothing to add.
    await send(AKI, ["login"], ["ok"], [1]);
    await send(AKI, ["search"], ["typed words"], [1]);
    await send(AKI, ["search", "barcode"], ["ok"], [1, 1]);
    await send(AKI, ["search"], ["ok"], [1, 2]);
    await send(AKI, [], [], []);
    await send(AKI, null, null, null);
    await send(
      AKI,
      Array(21).fill("search"),
      Array(21).fill("ok"),
      Array(21).fill(1),
    );
    await send(AKI, ["search"], ["ok"], [0]);
    await send(AKI, ["search"], ["ok"], [-5]);
    assert.deepEqual(await all(), []);
    // A good cell next to a bad one still counts.
    await send(AKI, ["search", "nine"], ["ok", "ok"], [1, 1]);
    assert.deepEqual(await all(), [
      { feature: "search", result: "ok", times: 1 },
    ]);
  });

  await check(
    "one call adds at most 100 to a row, and a row stops at a hundred million",
    async () => {
      await clear();
      await send(AKI, ["shelf"], ["refused"], [1_000_000]);
      await send(AKI, ["shelf", "shelf"], ["ok", "ok"], [90, 90]);
      assert.deepEqual(await all(), [
        { feature: "shelf", result: "ok", times: 180 },
        { feature: "shelf", result: "refused", times: 100 },
      ]);
      await db.exec("update private.stumbles set times = 99999990");
      await send(AKI, ["shelf"], ["ok"], [100]);
      const [capped] = await rows<{ times: number }>(
        "select times from private.stumbles where result = 'ok'",
      );
      assert.equal(capped.times, 100_000_000);
    },
  );

  await check(
    "a day is at most 20 rows, however many readers send",
    async () => {
      await clear();
      const features = STUMBLE_FEATURES.flatMap((feature) =>
        STUMBLE_RESULTS.map(() => feature),
      );
      const results = STUMBLE_FEATURES.flatMap(() => [...STUMBLE_RESULTS]);
      for (let i = 0; i < 30; i += 1)
        await send(
          i % 2 ? AKI : BEN,
          features,
          results,
          features.map(() => 1),
        );
      const kept = await all();
      assert.equal(kept.length, 20);
      assert.ok(kept.every((row) => row.times === 30));
    },
  );

  await check(
    "the sums are by week or month, and hide a cell tried fewer than 20 times",
    async () => {
      await clear();
      // A Wednesday and the Monday before it are one week; the week before is
      // another.
      await db.exec(`
      insert into private.stumbles (day, feature, result, times) values
        ('2026-10-21', 'search', 'ok', 30),
        ('2026-10-19', 'search', 'not_found', 10),
        ('2026-10-19', 'search', 'offline', 3),
        ('2026-10-20', 'search', 'refused', 2),
        ('2026-10-21', 'barcode', 'ok', 12),
        ('2026-10-18', 'barcode', 'ok', 7),
        ('2026-10-14', 'register', 'ok', 40)`);
      type Sum = {
        starts: string;
        feature: string;
        tries: number | null;
        ok: number | null;
        not_found: number | null;
        failed: number | null;
        failed_share: string | null;
        under_20: boolean;
      };
      const sums = (period: string) =>
        rows<Sum>(
          `select starts::text as starts, feature, tries::int as tries, ok::int as ok,
           not_found::int as not_found, failed::int as failed,
           failed_share::text as failed_share, under_20
         from private.stumble_totals($1)`,
          [period],
        );
      assert.deepEqual(await sums("week"), [
        {
          starts: "2026-10-19",
          feature: "barcode",
          tries: null,
          ok: null,
          not_found: null,
          failed: null,
          failed_share: null,
          under_20: true,
        },
        {
          starts: "2026-10-19",
          feature: "search",
          tries: 45,
          ok: 30,
          not_found: 10,
          failed: 5,
          // 見つからない is no failure: 5 of the 35 that were not.
          failed_share: "0.143",
          under_20: false,
        },
        {
          starts: "2026-10-12",
          feature: "barcode",
          tries: null,
          ok: null,
          not_found: null,
          failed: null,
          failed_share: null,
          under_20: true,
        },
        {
          starts: "2026-10-12",
          feature: "register",
          tries: 40,
          ok: 40,
          not_found: 0,
          failed: 0,
          failed_share: "0.000",
          under_20: false,
        },
      ]);
      const month = await sums("month");
      assert.deepEqual(
        month.map((sum) => [sum.starts, sum.feature, sum.tries]),
        [
          ["2026-10-01", "barcode", null],
          ["2026-10-01", "register", 40],
          ["2026-10-01", "search", 45],
        ],
      );
      // 19 and 20 tries: the line is at 20.
      await clear();
      await db.exec(`
      insert into private.stumbles (day, feature, result, times) values
        ('2026-10-21', 'shelf', 'ok', 19), ('2026-10-21', 'search', 'ok', 20)`);
      assert.deepEqual(
        (await sums("week")).map((sum) => [
          sum.feature,
          sum.tries,
          sum.under_20,
        ]),
        [
          ["search", 20, false],
          ["shelf", null, true],
        ],
      );
    },
  );

  await check("rows older than 90 days go when anyone sends", async () => {
    await clear();
    await send(AKI, ["search"], ["ok"], [1]);
    await db.exec("update private.stumbles set day = day - 91");
    await send(AKI, ["barcode"], ["ok"], [1]);
    assert.deepEqual(await all(), [
      { feature: "barcode", result: "ok", times: 1 },
    ]);
  });

  await check(
    "every night rows older than 90 days go, and newer ones stay",
    async () => {
      const jobs = await rows<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'stumbles'",
      );
      assert.deepEqual(jobs, [
        {
          schedule: "47 18 * * *",
          command: "select private.forget_stumbles()",
        },
      ]);
      await clear();
      await send(
        AKI,
        ["search", "barcode", "shelf"],
        ["ok", "ok", "ok"],
        [1, 1, 1],
      );
      await db.exec(
        "update private.stumbles set day = day - 91 where feature = 'search'",
      );
      await db.exec(
        "update private.stumbles set day = day - 90 where feature = 'barcode'",
      );
      await db.exec(jobs[0].command);
      assert.deepEqual(
        (await all()).map((row) => row.feature),
        ["barcode", "shelf"],
      );
    },
  );

  await check(
    "the rollback, as the header writes it, leaves the database as it was",
    async () => {
      // The rollback is the indented lines of the header, the comment before
      // the file's first blank line.
      const rollback = TEXT.slice(0, TEXT.indexOf("\n\n"))
        .split("\n")
        .filter((line) => line.startsWith("--   "))
        .map((line) => line.slice(5))
        .join("\n");
      assert.match(rollback, /drop table private\.stumbles/);
      const earlier = await before();
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      await earlier.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub', '${AKI}', false);
       select public.count_stumbles(array['search'], array['ok'], array[1]);
       reset role;`,
      );
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      await earlier.close();
    },
  );

  console.log(`${passed} checks passed`);
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
