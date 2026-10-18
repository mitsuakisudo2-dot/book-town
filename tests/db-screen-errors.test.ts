import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import {
  MESSAGE_LENGTH,
  PLACE_LENGTH,
  STACK_LENGTH,
} from "../src/lib/screen-errors";
import { SITE_NOTE_LIMITS } from "../src/lib/site-notes";

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

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
    await db.exec(migrationText(file));
  await db.exec(`insert into auth.users (id) values ('${AKI}');`);
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
      "s".repeat(STACK_LENGTH + 50),
      "not a commit",
      "d".repeat(100),
    );
    const [kept] = await rows<{
      stack: string;
      build: string;
      device: string;
    }>("select stack, build, device from private.screen_errors");
    assert.equal(kept.stack.length, STACK_LENGTH);
    assert.equal(kept.build, "");
    assert.equal(kept.device.length, SITE_NOTE_LIMITS.device);
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

  await check("the limits are the app's", async () => {
    assert.match(TEXT, new RegExp(`between 1 and ${MESSAGE_LENGTH}\\)`));
    assert.match(TEXT, new RegExp(`between 1 and ${PLACE_LENGTH} and`));
    assert.match(TEXT, new RegExp(`<= ${STACK_LENGTH}\\)`));
    assert.match(TEXT, new RegExp(`<= ${SITE_NOTE_LIMITS.device}\\)`));
  });

  console.log(`${passed} screen error database checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
