import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import { catalog } from "./fixtures/bibliography";
import {
  MESSAGE_LENGTH,
  PLACE_LENGTH,
  STACK_LENGTH,
  scrubText,
} from "../src/lib/screen-errors";
import { SITE_NOTE_LIMITS, deviceLabel } from "../src/lib/site-notes";
import { SCREEN_ERRORS_QUERY, errorsVerdict } from "../scripts/watch.mjs";

// 画面のエラーの記録 (supabase/migrations/*_screen_errors.sql, AUD-032): anyone
// may report an error from their screen, nobody reads the reports through the
// API, the same error on a day is one row with a count, what does not fit is
// dropped quietly, a flood stops at 200 new rows an hour, and old rows go.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_screen_errors.sql"));
assert.ok(FILE, "the screen errors migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";

async function before(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
    await db.exec(migrationText(file));
  await db.exec(`insert into auth.users (id) values ('${AKI}');`);
  return db;
}

async function migrated(): Promise<PGlite> {
  const db = await before();
  await db.exec(TEXT);
  return db;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await migrated();
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
  const report = (
    visitor: string | null,
    kind: string,
    message: string,
    place = "/books/",
    stack = "a.js:1:2",
    build = "917c506",
    device = "iPhone Safari",
  ) =>
    as(visitor, "select public.report_screen_error($1, $2, $3, $4, $5, $6)", [
      kind,
      message,
      place,
      stack,
      build,
      device,
    ]);
  const all = () =>
    rows<{ message: string; times: number; build: string; stack: string }>(
      "select message, times, build, stack from private.screen_errors order by message",
    );
  const clear = () => db.exec("delete from private.screen_errors");

  await check("a visitor and a reader can both report an error", async () => {
    await report(null, "error", "TypeError: x is undefined");
    await report(AKI, "rejection", "JWT expired");
    assert.deepEqual(
      (await all()).map((row) => row.message),
      ["JWT expired", "TypeError: x is undefined"],
    );
  });

  await check(
    "the same error on a day is one row with a count; another page or build is another row",
    async () => {
      for (let i = 0; i < 4; i += 1)
        await report(null, "error", "TypeError: x is undefined");
      await report(null, "error", "TypeError: x is undefined", "/walk/");
      await report(
        null,
        "error",
        "TypeError: x is undefined",
        "/books/",
        "",
        "abcdef1",
      );
      const [first] = await rows<{ times: number }>(
        `select times from private.screen_errors
         where message = 'TypeError: x is undefined' and place = '/books/' and build = '917c506'`,
      );
      assert.equal(first.times, 5);
      assert.equal(
        (
          await rows(
            "select 1 from private.screen_errors where message = 'TypeError: x is undefined'",
          )
        ).length,
        3,
      );
    },
  );

  await check("nobody reads the reports through the API", async () => {
    for (const visitor of [null, AKI]) {
      await refused(
        () => as(visitor, "select * from private.screen_errors"),
        "reading the table",
      );
      await refused(
        () =>
          as(
            visitor,
            "insert into private.screen_errors (day, kind, message, place) values (current_date, 'error', 'x', '/')",
          ),
        "writing the table directly",
      );
    }
  });

  await check("what does not fit is dropped without a word", async () => {
    await clear();
    await report(null, "warning", "not a kind");
    await report(null, "error", "");
    await report(null, "error", "x".repeat(MESSAGE_LENGTH + 1));
    await report(null, "error", "no slash", "books/");
    await report(null, "error", "too far", "/" + "x".repeat(PLACE_LENGTH));
    assert.deepEqual(await all(), []);
    // A long stack or device is cut; a build that is not a commit is left out.
    await report(
      null,
      "error",
      "kept",
      "/",
      Array(100).fill("chunk.js:12:345").join(" "),
      "not a commit",
      "d".repeat(100),
    );
    const [kept] = await rows<{
      stack: string;
      build: string;
      device: string;
    }>("select stack, build, device from private.screen_errors");
    assert.ok(kept.stack.length <= STACK_LENGTH);
    assert.ok(kept.stack.length > STACK_LENGTH - 20);
    assert.match(kept.stack, /^(chunk\.js:12:345 ?)+$/);
    assert.equal(kept.build, "");
    // A device that is not one of the app's labels is left out.
    assert.equal(kept.device, "");
  });

  await check("a flood stops at 200 new rows an hour", async () => {
    await clear();
    for (let i = 0; i < 230; i += 1) await report(null, "error", `flood ${i}`);
    assert.equal((await all()).length, 200);
    // One already kept still counts up.
    await report(null, "error", "flood 0");
    const [zero] = await rows<{ times: number }>(
      "select times from private.screen_errors where message = 'flood 0'",
    );
    assert.equal(zero.times, 2);
    // An hour later there is room again.
    await db.exec(
      "update private.screen_errors set first_at = first_at - interval '61 minutes'",
    );
    await report(null, "error", "after the hour");
    assert.equal((await all()).length, 201);
  });

  await check("rows older than 30 days go", async () => {
    await clear();
    await report(null, "error", "old");
    await db.exec(
      "update private.screen_errors set day = day - 31, first_at = first_at - interval '31 days'",
    );
    await report(null, "error", "new");
    assert.deepEqual(
      (await all()).map((row) => row.message),
      ["new"],
    );
  });

  await check(
    "the database takes out what could name a reader, whatever the sender did",
    async () => {
      await clear();
      const token =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLWhlcmU";
      const raw =
        `Error: aki@example.jp saw 「人間失格」 at https://booktown.page/search/?q=secret#x ` +
        `id 0b9f6c3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f key ${token} ` +
        `sb_secret_abcdefghijkl 1234567 call 090-1234-5678 Key (handle)=(aki) "typed words" 'more'`;
      await report(
        null,
        "error",
        raw,
        "/books/?isbn=9784101006055#top",
        "chunk-1a2b.js:1:23456 https://evil.example/x.js?token=1:2:3 <img> app.js:7:8",
      );
      const [row] = await rows<{
        message: string;
        place: string;
        stack: string;
      }>("select message, place, stack from private.screen_errors");
      for (const kept of [
        "aki@example.jp",
        "人間失格",
        "secret",
        "0b9f6c3e",
        token.slice(0, 20),
        "sb_secret",
        "typed words",
        "more",
        "=(aki)",
        "1234567",
        "090-1234",
      ])
        assert.ok(!row.message.includes(kept), kept);
      assert.equal(row.place, "/books/");
      // Column numbers of a minified script are long, and stay.
      assert.equal(row.stack, "chunk-1a2b.js:1:23456 app.js:7:8");
      // The same steps as the app's: what the app cleaned comes out as it went.
      for (const sample of [
        raw,
        "TypeError: Cannot read properties of undefined (reading 'x')",
        `Unexpected token 'u', "{"title":"ノルウェイの森"... is not valid JSON`,
        "can't open 'ノルウェイの森'",
        "mail aki%40example.jp or aki＠example.jp, token abcdEFGH1234ijklMNOP5678qrst",
        "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED at 978-4-10-100605-5",
        "トークンeyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
        "AuthApiError: Invalid login credentials for x@y.co",
        "  spaced\n  out  ",
      ]) {
        const [{ scrubbed }] = await rows<{ scrubbed: string }>(
          "select private.scrub_screen_text($1) as scrubbed",
          [sample],
        );
        assert.equal(scrubbed, scrubText(sample, 10_000), sample);
        const [{ again }] = await rows<{ again: string }>(
          "select private.scrub_screen_text($1) as again",
          [scrubText(sample)],
        );
        assert.equal(again, scrubText(sample));
      }
      // Nothing left once cleaned, or a page that is no path: dropped.
      await clear();
      await report(null, "error", "   ");
      await report(null, "error", "x", "?q=only");
      assert.deepEqual(await all(), []);
    },
  );

  await check(
    "a flood of one error is one row, and a flood of long ones is refused",
    async () => {
      await clear();
      for (let i = 0; i < 500; i += 1) await report(null, "error", "same");
      const [row] = await rows<{ times: number }>(
        "select times from private.screen_errors",
      );
      assert.equal(row.times, 500);
      await db.exec("update private.screen_errors set times = 999999");
      await report(null, "error", "same");
      await report(null, "error", "same");
      const [capped] = await rows<{ times: number }>(
        "select times from private.screen_errors",
      );
      assert.equal(capped.times, 1000000);
      await report(null, "error", "x".repeat(100_000));
      await report(null, "error", "x", "/" + "y".repeat(100_000));
      assert.equal((await all()).length, 1);
    },
  );

  await check(
    "however long a flood goes on, the table stops at 3,000 rows",
    async () => {
      await clear();
      await db.exec(`
        insert into private.screen_errors (day, kind, message, place, first_at)
        select current_date, 'error', 'old ' || i, '/', now() - interval '2 hours'
        from generate_series(1, 2999) i`);
      await report(null, "error", "the last one");
      await report(null, "error", "one too many");
      const [{ n }] = await rows<{ n: number }>(
        "select count(*)::int as n from private.screen_errors",
      );
      assert.equal(n, 3000);
      // A row already kept still counts up.
      await report(null, "error", "the last one");
      const [last] = await rows<{ times: number }>(
        "select times from private.screen_errors where message = 'the last one'",
      );
      assert.equal(last.times, 2);
      await clear();
    },
  );

  await check(
    "every night rows older than 30 days go, and newer ones stay",
    async () => {
      const jobs = await rows<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'screen-errors'",
      );
      assert.deepEqual(jobs, [
        {
          schedule: "43 18 * * *",
          command: "select private.forget_screen_errors()",
        },
      ]);
      await clear();
      await report(null, "error", "thirty-one days");
      await report(null, "error", "thirty days");
      await report(null, "error", "today");
      await db.exec(
        "update private.screen_errors set day = day - 31 where message = 'thirty-one days'",
      );
      await db.exec(
        "update private.screen_errors set day = day - 30 where message = 'thirty days'",
      );
      await db.exec(jobs[0].command);
      assert.deepEqual(
        (await all()).map((row) => row.message),
        ["thirty days", "today"],
      );
      // Neither the job's function nor the cleaning one is the API's.
      for (const visitor of [null, AKI]) {
        await refused(
          () => as(visitor, "select private.forget_screen_errors()"),
          "running the nightly job",
        );
        await refused(
          () => as(visitor, "select private.scrub_screen_text('x')"),
          "calling the cleaning",
        );
      }
    },
  );

  await check(
    "the rollback, as the header writes it, leaves the database as it was",
    async () => {
      // The rollback is the indented lines of the header, the comment
      // before the file's first blank line.
      const rollback = TEXT.slice(0, TEXT.indexOf("\n\n"))
        .split("\n")
        .filter((line) => line.startsWith("--   "))
        .map((line) => line.slice(5))
        .join("\n");
      assert.match(rollback, /drop table private\.screen_errors/);
      const earlier = await before();
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      await earlier.exec(
        "select public.report_screen_error('error', 'x', '/')",
      );
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      await earlier.close();
    },
  );

  await check("every device label the app makes is kept", async () => {
    const agents = [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      "",
    ];
    for (const agent of agents) {
      const label = deviceLabel(agent, 5);
      const [{ ok }] = await rows<{ ok: boolean }>(
        "select $1 ~ '^[A-Za-z アプリ内]{0,40}$' as ok",
        [label],
      );
      assert.ok(ok, label);
    }
  });

  await check(
    "the morning watch notices a full table and a flood",
    async () => {
      const watch = JSON.parse(readFileSync("scripts/watch.json", "utf8"));
      const limits = {
        perDay: watch.screenErrorsPerDay,
        rowsWarn: watch.screenErrorsRowsWarn,
        perHour: watch.screenErrorsPerHour,
      };
      // The watch's numbers are the migration's.
      assert.match(TEXT, new RegExp(`\\) >= ${limits.perHour} or`));
      const cap = Number(/screen_errors\) >= (\d+) then/.exec(TEXT)?.[1]);
      assert.ok(limits.rowsWarn < cap && limits.rowsWarn >= cap * 0.9);
      const read = async () =>
        errorsVerdict((await rows(SCREEN_ERRORS_QUERY))[0], limits);

      await clear();
      assert.deepEqual(await read(), {
        ok: true,
        lines: ["Screen errors: none in the last day."],
      });

      // Filled two days ago: nothing in the last day, yet nothing new is kept.
      await db.exec(`
        insert into private.screen_errors (day, kind, message, place, first_at, last_at)
        select current_date - 2, 'error', 'old ' || i, '/',
          now() - interval '2 days', now() - interval '2 days'
        from generate_series(1, ${cap}) i`);
      await report(null, "error", "a real one");
      const full = await read();
      assert.equal(full.ok, false);
      assert.equal(full.lines[0], "Screen errors: none in the last day.");
      assert.match(full.lines[1], /nearly full/);

      // A flood reaches the hourly limit; the watch says so even when the
      // kinds alone would pass.
      await clear();
      for (let i = 0; i < 230; i += 1)
        await report(null, "error", `flood ${i}`);
      const [counted] = await rows<{ busiest_hour: number; rows: number }>(
        SCREEN_ERRORS_QUERY,
      );
      assert.equal(counted.rows, 200);
      assert.equal(counted.busiest_hour, 200);
      const flooded = errorsVerdict(counted, { ...limits, perDay: 1000 });
      assert.equal(flooded.ok, false);
      assert.match(flooded.lines[1], /hourly limit/);

      // Spread over the day, the same rows are not a flood.
      await db.exec(`
        update private.screen_errors
        set first_at = now() - (substring(message from 7)::int % 20) * interval '1 hour'`);
      const [spread] = await rows<{ busiest_hour: number }>(
        SCREEN_ERRORS_QUERY,
      );
      assert.ok(
        spread.busiest_hour < limits.perHour,
        String(spread.busiest_hour),
      );
      await clear();
    },
  );

  await check("the limits are the app's", async () => {
    assert.match(TEXT, new RegExp(`between 1 and ${MESSAGE_LENGTH}\\)`));
    assert.match(TEXT, new RegExp(`\\]\\{0,${PLACE_LENGTH - 1}\\}\\$'\\)`));
    assert.match(TEXT, new RegExp(`<= ${STACK_LENGTH}\\)`));
    assert.match(
      TEXT,
      new RegExp(`\\]\\{0,${SITE_NOTE_LIMITS.device}\\}\\$'\\)`),
    );
  });

  console.log(`${passed} screen error database checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
