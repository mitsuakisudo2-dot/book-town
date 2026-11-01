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
  TAB_TAPS_PER_SEND,
  TAB_TAP_MODES,
  TAB_TAP_TABS,
} from "../src/lib/tab-taps";

// タブが押された回数を数える (supabase/migrations/*_tab_taps.sql, けにーさん
// 11-01): only a signed-in reader may send, the function has no place for
// anything but a mode, a tab and a number, a day is at most 18 rows however
// many send, nobody reads the table through the API, and rows go after 90
// days.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_tab_taps.sql"));
assert.ok(FILE, "the tab taps migration");
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
    modes: unknown,
    tabs: unknown,
    times: unknown,
  ) =>
    as(visitor, "select public.count_tab_taps($1, $2, $3)", [
      modes,
      tabs,
      times,
    ]);
  const all = () =>
    rows<{ mode: string; tab: string; times: number }>(
      "select mode, tab, times from private.tab_taps order by mode, tab",
    );
  const clear = () => db.exec("delete from private.tab_taps");

  await check("the database's lists are the app's", async () => {
    for (const tab of TAB_TAP_TABS) assert.ok(TEXT.includes(`'${tab}'`), tab);
    for (const mode of TAB_TAP_MODES)
      assert.ok(TEXT.includes(`'${mode}'`), mode);
    assert.match(TEXT, new RegExp(`least\\(c\\.n, ${TAB_TAPS_PER_SEND}\\)`));
    assert.match(
      TEXT,
      new RegExp(
        `between 1 and ${TAB_TAP_MODES.length * TAB_TAP_TABS.length}\\b`,
      ),
    );
  });

  await check(
    "a signed-in reader's taps are added to the day's rows",
    async () => {
      await send(
        AKI,
        ["town", "town", "manage"],
        ["home", "walk", "home"],
        [3, 1, 2],
      );
      await send(BEN, ["town"], ["home"], [4]);
      assert.deepEqual(await all(), [
        { mode: "manage", tab: "home", times: 2 },
        { mode: "town", tab: "home", times: 7 },
        { mode: "town", tab: "walk", times: 1 },
      ]);
      // Only the day, the mode, the tab and the count are kept.
      const columns = await rows<{ column_name: string }>(
        `select column_name from information_schema.columns
       where table_schema = 'private' and table_name = 'tab_taps' order by ordinal_position`,
      );
      assert.deepEqual(
        columns.map((column) => column.column_name),
        ["day", "mode", "tab", "times"],
      );
      const [fn] = await rows<{ args: string }>(
        `select pg_get_function_arguments('public.count_tab_taps(text[], text[], integer[])'::regprocedure) as args`,
      );
      assert.equal(fn.args, "modes text[], tabs text[], times integer[]");
    },
  );

  await check("a visitor not signed in cannot send", async () => {
    await clear();
    await refused(
      () => send(null, ["town"], ["home"], [1]),
      "a visitor sending taps",
    );
    assert.deepEqual(await all(), []);
  });

  await check("nobody reads or writes the table through the API", async () => {
    for (const visitor of [null, AKI]) {
      await refused(
        () => as(visitor, "select * from private.tab_taps"),
        "reading the table",
      );
      await refused(
        () =>
          as(
            visitor,
            "insert into private.tab_taps (day, mode, tab, times) values (current_date, 'town', 'home', 1)",
          ),
        "writing the table directly",
      );
      await refused(
        () => as(visitor, "select private.forget_tab_taps()"),
        "running the nightly job",
      );
    }
  });

  await check("what does not fit is dropped without a word", async () => {
    await clear();
    await send(AKI, ["town"], ["settings"], [1]);
    await send(AKI, ["night"], ["home"], [1]);
    await send(AKI, ["town", "town"], ["home"], [1, 1]);
    await send(AKI, ["town"], ["home"], [1, 2]);
    await send(AKI, [], [], []);
    await send(AKI, null, null, null);
    await send(
      AKI,
      Array(19).fill("town"),
      Array(19).fill("home"),
      Array(19).fill(1),
    );
    await send(AKI, ["town"], ["home"], [0]);
    await send(AKI, ["town"], ["home"], [-5]);
    assert.deepEqual(await all(), []);
    // A good cell next to a bad one still counts.
    await send(AKI, ["town", "town"], ["home", "/shop/123"], [1, 1]);
    assert.deepEqual(await all(), [{ mode: "town", tab: "home", times: 1 }]);
  });

  await check(
    "one call adds at most 200 to a row, and a row stops at a hundred million",
    async () => {
      await clear();
      await send(AKI, ["town"], ["search"], [1_000_000]);
      await send(AKI, ["town", "town"], ["walk", "walk"], [150, 150]);
      assert.deepEqual(await all(), [
        { mode: "town", tab: "search", times: 200 },
        { mode: "town", tab: "walk", times: 200 },
      ]);
      await db.exec("update private.tab_taps set times = 99999990");
      await send(AKI, ["town"], ["walk"], [100]);
      const [capped] = await rows<{ times: number }>(
        "select times from private.tab_taps where tab = 'walk'",
      );
      assert.equal(capped.times, 100_000_000);
    },
  );

  await check(
    "a day is at most 18 rows, however many readers send",
    async () => {
      await clear();
      const modes = TAB_TAP_MODES.flatMap((mode) =>
        TAB_TAP_TABS.map(() => mode),
      );
      const tabs = TAB_TAP_MODES.flatMap(() => [...TAB_TAP_TABS]);
      for (let i = 0; i < 30; i += 1)
        await send(
          i % 2 ? AKI : BEN,
          modes,
          tabs,
          tabs.map(() => 1),
        );
      const kept = await all();
      assert.equal(kept.length, 18);
      assert.ok(kept.every((row) => row.times === 30));
    },
  );

  await check("rows older than 90 days go when anyone sends", async () => {
    await clear();
    await send(AKI, ["town"], ["home"], [1]);
    await db.exec("update private.tab_taps set day = day - 91");
    await send(AKI, ["town"], ["walk"], [1]);
    assert.deepEqual(await all(), [{ mode: "town", tab: "walk", times: 1 }]);
  });

  await check(
    "every night rows older than 90 days go, and newer ones stay",
    async () => {
      const jobs = await rows<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'tab-taps'",
      );
      assert.deepEqual(jobs, [
        {
          schedule: "49 18 * * *",
          command: "select private.forget_tab_taps()",
        },
      ]);
      await clear();
      await send(
        AKI,
        ["town", "town", "town"],
        ["home", "walk", "search"],
        [1, 1, 1],
      );
      await db.exec(
        "update private.tab_taps set day = day - 91 where tab = 'home'",
      );
      await db.exec(
        "update private.tab_taps set day = day - 90 where tab = 'walk'",
      );
      await db.exec(jobs[0].command);
      assert.deepEqual(
        (await all()).map((row) => row.tab),
        ["search", "walk"],
      );
    },
  );

  await check(
    "the rollback, as the header writes it, leaves the database as it was",
    async () => {
      const rollback = TEXT.slice(0, TEXT.indexOf("\n\n"))
        .split("\n")
        .filter((line) => line.startsWith("--   "))
        .map((line) => line.slice(5))
        .join("\n");
      assert.match(rollback, /drop table private\.tab_taps/);
      const earlier = await before();
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      await earlier.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub', '${AKI}', false);
       select public.count_tab_taps(array['town'], array['home'], array[1]);
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
