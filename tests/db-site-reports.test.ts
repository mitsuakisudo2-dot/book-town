import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";
import { catalog } from "./fixtures/bibliography";
import { deviceLabel } from "../src/lib/site-notes";
import { SITE_REPORTS_PAGE } from "../src/lib/supabase/site-reports";
import { SITE_REPORT_MAX_LENGTH } from "../src/lib/types";

// 不具合と要望 (supabase/migrations/*_site_reports.sql, management table 47):
// a signed-in reader sends a report through one function, nobody reads the
// table through the API, only staff read the reports (30 at a time), the
// database takes out what should not be kept, a flood is refused, and rows
// go after 180 days.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_site_reports.sql"));
assert.ok(FILE, "the site reports migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const STAFF = "00000000-0000-4000-8000-00000000000c";

async function before(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => file < FILE!))
    await db.exec(migrationText(file));
  await db.exec(`
    insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${STAFF}');
    insert into public.profiles (id, handle, name) values ('${AKI}', 'aki', 'AKI');
    insert into private.staff (user_id) values ('${STAFF}') on conflict do nothing;`);
  return db;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
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
  async function refused(
    run: () => Promise<unknown>,
    what: string,
    code?: string,
  ) {
    let error: unknown = null;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, "expected a refusal: " + what);
    if (code) assert.equal((error as { code?: string }).code, code, what);
  }
  const send = (
    visitor: string | null,
    body: string,
    kind = "bug",
    page = "/profile/",
    build = "917c506",
    device = "iPhone Safari",
  ) =>
    as(visitor, "select public.send_site_report($1, $2, $3, $4, $5)", [
      kind,
      body,
      page,
      build,
      device,
    ]);
  const all = () =>
    rows<{ body: string; kind: string; page: string; user_id: string }>(
      "select body, kind, page, user_id from private.site_reports order by created_at, body",
    );
  const clear = () => db.exec("delete from private.site_reports");
  const list = (visitor: string, before: string | null = null) =>
    as<{ body: string; handle: string | null; created_at: string }>(
      visitor,
      "select * from public.site_reports($1)",
      [before],
    );

  await check("a signed-in reader sends a report as themself", async () => {
    await send(AKI, "検索で落ちます", "bug", "/search/?q=x#top");
    await send(BEN, "棚に色を", "wish");
    const kept = await all();
    assert.deepEqual(
      kept.map((row) => [row.user_id, row.kind, row.body, row.page]),
      [
        [AKI, "bug", "検索で落ちます", "/search/"],
        [BEN, "wish", "棚に色を", "/profile/"],
      ],
    );
  });

  await check("a visitor cannot send", async () => {
    await refused(() => send(null, "x"), "a visitor sending");
  });

  await check("nobody reads or writes the table through the API", async () => {
    for (const visitor of [null, AKI, STAFF]) {
      await refused(
        () => as(visitor, "select * from private.site_reports"),
        "reading the table",
      );
      await refused(
        () =>
          as(
            visitor,
            `insert into private.site_reports (user_id, kind, body) values ('${AKI}', 'bug', 'x')`,
          ),
        "writing the table directly",
      );
    }
    for (const fn of [
      "select private.forget_site_reports()",
      "select private.scrub_report_text('x')",
    ])
      for (const visitor of [null, AKI])
        await refused(() => as(visitor, fn), fn);
  });

  await check(
    "only staff read the reports, the newest first, 30 at a time",
    async () => {
      // A reader, even one who sent some, sees nothing and learns nothing.
      assert.deepEqual(await list(AKI), []);
      await refused(
        () => as(null, "select * from public.site_reports(null)"),
        "a visitor reading",
      );
      const shown = await list(STAFF);
      assert.deepEqual(
        shown.map((row) => [row.body, row.handle]),
        [
          ["棚に色を", null],
          ["検索で落ちます", "aki"],
        ],
      );
      await clear();
      await db.exec(`
        insert into private.site_reports (user_id, kind, body, created_at)
        select '${AKI}', 'bug', 'r' || i, now() - make_interval(mins => i)
        from generate_series(1, 45) i`);
      const first = await list(STAFF);
      assert.equal(first.length, SITE_REPORTS_PAGE);
      assert.equal(first[0].body, "r1");
      const next = await list(STAFF, first.at(-1)!.created_at);
      assert.equal(next.length, 15);
      assert.equal(next[0].body, "r31");
      await clear();
    },
  );

  await check(
    "what does not fit is refused, so the reader keeps it",
    async () => {
      await refused(() => send(AKI, "x", "spam"), "an unknown kind", "22023");
      await refused(() => send(AKI, "   　\n"), "nothing written", "22023");
      await refused(
        () => send(AKI, "x".repeat(SITE_REPORT_MAX_LENGTH + 1)),
        "too long",
        "22023",
      );
      assert.deepEqual(await all(), []);
      // A page that is no path of the site's, a build that is no commit and a
      // device that is no label of the app's are left out, the report kept.
      await send(AKI, "kept", "other", "javascript:alert(1)", "nope", "<b>");
      const [row] = await rows<{ page: string; build: string; device: string }>(
        "select page, build, device from private.site_reports",
      );
      assert.deepEqual(row, { page: "", build: "", device: "" });
      await clear();
    },
  );

  await check(
    "the database takes out keys, emails, phone and card numbers before keeping",
    async () => {
      const token =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLWhlcmU";
      await send(
        AKI,
        `連絡は aki@example.jp か ａｋｉ＠example.jp、電話 090-1234-5678 / ０９０１２３４５６７８ / +81 90 1234 5678。` +
          `カード 4111 1111 1111 1111 と 4111111111111111。鍵 ${token} sb_secret_abcdefghijkl ` +
          `abcdEFGH1234ijklMNOP5678qrst。https://booktown.page/login/?code=123#access_token=x ` +
          `ISBN 9784062748681（978-4-06-274868-1）が 2026-10-18 に 3冊 登録できない`,
      );
      const [{ body }] = await all();
      for (const gone of [
        "aki@",
        "example.jp",
        "090",
        "1234-5678",
        "4111",
        token.slice(0, 20),
        "sb_secret",
        "abcdEFGH",
        "code=123",
        "access_token",
      ])
        assert.ok(!body.includes(gone), gone);
      for (const stays of [
        "9784062748681",
        "978-4-06-274868-1",
        "2026-10-18",
        "3冊",
        "https://booktown.page/login/",
        "(メールアドレス)",
        "(番号)",
        "(鍵)",
      ])
        assert.ok(body.includes(stays), stays);
      await clear();
    },
  );

  await check("one reader sends at most 10 an hour and 30 a day", async () => {
    for (let i = 0; i < 10; i += 1) await send(AKI, "hour " + i);
    await refused(() => send(AKI, "eleventh"), "the eleventh", "23514");
    // Someone else is not held up by it.
    await send(BEN, "ben");
    await db.exec(
      `update private.site_reports set created_at = now() - interval '2 hours' where user_id = '${AKI}'`,
    );
    for (let i = 0; i < 10; i += 1) await send(AKI, "later " + i);
    await db.exec(
      `update private.site_reports set created_at = now() - interval '3 hours' where user_id = '${AKI}' and body like 'later%'`,
    );
    for (let i = 0; i < 10; i += 1) await send(AKI, "evening " + i);
    await db.exec(
      `update private.site_reports set created_at = now() - interval '4 hours' where user_id = '${AKI}' and body like 'evening%'`,
    );
    await refused(() => send(AKI, "the 31st"), "the 31st in a day", "23514");
    await clear();
  });

  await check(
    "everyone together adds at most 300 an hour and 5,000 in all",
    async () => {
      await db.exec(`
        insert into private.site_reports (user_id, kind, body)
        select '${BEN}', 'bug', 'flood ' || i from generate_series(1, 300) i`);
      await refused(() => send(AKI, "one more"), "past 300 an hour", "23514");
      await db.exec(
        "update private.site_reports set created_at = now() - interval '2 hours'",
      );
      await send(AKI, "an hour later");
      await db.exec(`
        insert into private.site_reports (user_id, kind, body, created_at)
        select '${BEN}', 'bug', 'old ' || i, now() - interval '2 days'
        from generate_series(1, 4699) i`);
      await refused(() => send(AKI, "past 5,000"), "past 5,000", "23514");
      const [{ n }] = await rows<{ n: number }>(
        "select count(*)::int as n from private.site_reports",
      );
      assert.equal(n, 5000);
      await clear();
    },
  );

  await check(
    "every night, and on each send, rows older than 180 days go",
    async () => {
      const jobs = await rows<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'site-reports'",
      );
      assert.deepEqual(jobs, [
        {
          schedule: "47 18 * * *",
          command: "select private.forget_site_reports()",
        },
      ]);
      await db.exec(`
        insert into private.site_reports (user_id, kind, body, created_at) values
          ('${AKI}', 'bug', '181 days', now() - interval '181 days'),
          ('${AKI}', 'bug', '179 days', now() - interval '179 days')`);
      await db.exec(jobs[0].command);
      assert.deepEqual(
        (await all()).map((row) => row.body),
        ["179 days"],
      );
      await db.exec(
        "update private.site_reports set created_at = now() - interval '181 days'",
      );
      await send(BEN, "today");
      assert.deepEqual(
        (await all()).map((row) => row.body),
        ["today"],
      );
      await clear();
    },
  );

  await check("a deleted account takes its reports along", async () => {
    await send(AKI, "aki");
    await send(BEN, "ben");
    await db.exec(`delete from auth.users where id = '${AKI}'`);
    assert.deepEqual(
      (await all()).map((row) => row.body),
      ["ben"],
    );
    await clear();
  });

  await check("every device label the app makes is kept", async () => {
    for (const agent of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:131.0) Gecko/20100101 Firefox/131.0",
    ]) {
      const label = deviceLabel(agent, 5);
      await send(BEN, "device", "bug", "/", "", label);
      const [row] = await rows<{ device: string }>(
        "select device from private.site_reports",
      );
      assert.equal(row.device, label);
      await clear();
    }
  });

  await check(
    "the rollback, as the header writes it, leaves the database as it was",
    async () => {
      const rollback = TEXT.slice(0, TEXT.indexOf("\n\n"))
        .split("\n")
        .filter((line) => line.startsWith("--   "))
        .map((line) => line.slice(5))
        .join("\n");
      assert.match(rollback, /drop table private\.site_reports/);
      const earlier = await before();
      const was = await catalog(earlier);
      await earlier.exec(TEXT);
      await earlier.exec(`
        insert into private.site_reports (user_id, kind, body) values ('${BEN}', 'bug', 'x')`);
      await earlier.exec(rollback);
      assert.deepEqual(await catalog(earlier), was);
      await earlier.close();
    },
  );

  await db.close();
  console.log(`${passed} site report checks passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
