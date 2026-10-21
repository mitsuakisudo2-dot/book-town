// Watches production from GitHub Actions, where the Supabase token is kept.
// .github/workflows/watch.yml runs it; scripts/watch.json says what to watch.
//
//   node scripts/watch.mjs site      the site's pages open, their scripts load,
//                                    and Supabase says its database, login and
//                                    API are healthy (tried twice before failing)
//   node scripts/watch.mjs backups   the newest daily backup is recent enough
//                                    (only once the plan in watch.json has them)
//   node scripts/watch.mjs usage     how much of the plan's database and file
//                                    space is used
//   node scripts/watch.mjs errors    how many errors readers' screens sent in
//                                    the last day (private.screen_errors), and
//                                    whether the table stopped taking them
//   node scripts/watch.mjs report <kind> ok|failed
//                                    tells about a check run elsewhere (the
//                                    production journey)
//
// When REPORT_ISSUES is "on", a failure opens one issue that mentions the
// repository's owner, so GitHub sends them an email; while it stays open the
// same failure adds nothing, and the next passing run closes it. The logs and
// the issues are public, like the repository: only times, sizes, page
// addresses and states are printed, never a row, a count of readers, or the
// token.

import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests point these at stand-ins.
const SUPABASE_API =
  process.env.SUPABASE_API_URL ?? "https://api.supabase.com/v1";
const GITHUB_API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MB = 1024 * 1024;

/** What each kind of check is called in the issue it opens. */
export const TITLES = {
  site: "本番のページが開けません",
  backups: "毎日の控えが止まっています",
  usage: "Supabase の使用量が上限に近づいています",
  journey: "本番の通しが失敗しました",
  errors: "読書家の画面でエラーが起きています",
  // Opened and closed at once by a run by hand (check: write), to show the
  // watch on main may still write issues. Nothing is wrong.
  write: "見張りが issue を書けるかの確かめ（すぐ閉じます。対応は要りません）",
};

const marker = (kind) => `<!-- watch:${kind} -->`;

/** A time as one short UTC line. */
const iso = (time) => new Date(time).toISOString().replace(/\.\d+Z$/, "Z");

/**
 * Whether the backups are as fresh as they should be. Plans without daily
 * backups pass with a note; point-in-time recovery stands in for them.
 *
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function backupVerdict(answer, now, { plan, maxHours }) {
  const expected = plan !== "free";
  if (answer?.pitr_enabled)
    return { ok: true, lines: ["Point-in-time recovery is on."] };
  const done = (answer?.backups ?? [])
    .filter((backup) => backup?.status === "COMPLETED" && backup.inserted_at)
    .map((backup) => Date.parse(backup.inserted_at))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a);
  if (!done.length)
    return expected
      ? {
          ok: false,
          lines: [
            `No completed backup, though the ${plan} plan makes one daily.`,
          ],
        }
      : {
          ok: true,
          lines: [
            `No daily backups: the plan in scripts/watch.json is ${plan}. Change it to the new plan once the project has one.`,
          ],
        };
  const hours = (now - done[0]) / 3_600_000;
  const lines = [
    `Newest backup: ${iso(done[0])} (${hours.toFixed(1)} hours ago), ${done.length} kept.`,
  ];
  if (!expected) {
    lines.push(
      `::warning::Backups are being made, but scripts/watch.json still says ${plan}; change it so a stopped backup is noticed.`,
    );
    return { ok: true, lines };
  }
  if (hours > maxHours) {
    lines.push(`Older than ${maxHours} hours.`);
    return { ok: false, lines };
  }
  return { ok: true, lines };
}

/**
 * The database and file space used, against what the plan includes.
 *
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function usageVerdict(row, included, warnPercent) {
  const parts = [
    ["Database", Number(row?.database_bytes ?? NaN), included.databaseMB],
    ["Files", Number(row?.storage_bytes ?? NaN), included.storageMB],
  ];
  const lines = [];
  let ok = true;
  for (const [name, bytes, limitMB] of parts) {
    if (!Number.isFinite(bytes)) {
      lines.push(`${name}: not reported.`);
      ok = false;
      continue;
    }
    const percent = (bytes / MB / limitMB) * 100;
    lines.push(
      `${name}: ${(bytes / MB).toFixed(1)} MB of ${limitMB} MB (${percent.toFixed(1)}%).`,
    );
    if (percent >= warnPercent) {
      lines.push(`${name} is past ${warnPercent}%.`);
      ok = false;
    }
  }
  return { ok, lines };
}

/**
 * How many errors readers' screens sent in the last day: kinds (rows) and
 * times, numbers only. The words are read with a select, never printed here.
 * Also whether the table stopped taking new errors: it takes at most so many
 * new rows an hour and so many in all (the migration's limits), and past them
 * it drops new errors without a word, so a quiet day can mean a full table.
 *
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function errorsVerdict(row, { perDay, rowsWarn, perHour }) {
  const kinds = Number(row?.kinds ?? NaN);
  const times = Number(row?.times ?? NaN);
  const rows = Number(row?.rows ?? NaN);
  const busiestHour = Number(row?.busiest_hour ?? NaN);
  if (![kinds, times, rows, busiestHour].every(Number.isFinite))
    return { ok: false, lines: ["Screen errors: not reported."] };
  const lines = [
    kinds === 0
      ? "Screen errors: none in the last day."
      : `Screen errors: ${kinds} kind(s), ${times} time(s) in the last day.`,
  ];
  let ok = kinds < perDay;
  if (rows >= rowsWarn) {
    ok = false;
    lines.push(
      "The screen error table is nearly full, so new errors may be dropped until old rows are deleted.",
    );
  }
  if (busiestHour >= perHour) {
    ok = false;
    lines.push(
      "The screen error table reached its hourly limit in the last day, so some errors were dropped.",
    );
  }
  if (!ok)
    lines.push(
      "Read them with the select in docs/09「画面のエラーの記録」 (the words stay out of this log).",
    );
  return { ok, lines };
}

/**
 * What errorsVerdict reads: the last day's kinds and times, every row in the
 * table, and the most new rows in any one hour of the last day, counted as the
 * report counts them (by first_at, an hour back from each).
 */
export const SCREEN_ERRORS_QUERY =
  "select count(*) filter (where e.last_at > now() - interval '1 day')::int as kinds, " +
  "coalesce(sum(e.times) filter (where e.last_at > now() - interval '1 day'), 0)::int as times, " +
  "count(*)::int as rows, " +
  "coalesce((select max(h.n) from (select count(*) over (order by f.first_at " +
  "range between interval '1 hour' preceding and current row) as n " +
  "from private.screen_errors f where f.first_at > now() - interval '1 day') h), 0)::int as busiest_hour " +
  "from private.screen_errors e";

/** Whether a page of the site looks like the site: a page with its scripts. */
export function pageVerdict(route, status, html) {
  if (status !== 200) return `${route} answered ${status}.`;
  if (!/<main[\s>]|\/_next\/static\//.test(html))
    return `${route} came back without the site's page.`;
  return null;
}

/** The first of the page's own scripts, to see that the build's files load. */
export function firstScript(html) {
  const found = /<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/.exec(
    html ?? "",
  );
  return found ? found[1] : null;
}

/**
 * What to do with the issues: open one for a new failure, close the open one
 * once the check passes, and otherwise leave them.
 *
 * @returns {{ open?: true, close?: number, already?: number }}
 */
export function issuePlan(openIssues, kind, ok) {
  const found = (openIssues ?? []).find((issue) =>
    String(issue.body ?? "").includes(marker(kind)),
  );
  if (ok) return found ? { close: found.number } : {};
  return found ? { already: found.number } : { open: true };
}

/** The issue a failure opens. */
export function issueBody(kind, lines, { owner, runUrl }) {
  return [
    `@${owner} ${TITLES[kind]}。`,
    "",
    "```",
    ...lines,
    "```",
    "",
    runUrl ? `記録: ${runUrl}` : "",
    "次に通った見張りがこの issue を閉じます。戻し方は docs/09「毎日の控えと見張り」。",
    "",
    marker(kind),
  ].join("\n");
}

async function settings() {
  const config = JSON.parse(
    await readFile(path.join(root, "scripts/watch.json"), "utf8"),
  );
  // Tests point the site at a stand-in.
  return { ...config, site: process.env.WATCH_SITE ?? config.site };
}

// On main the watch must ask Supabase: a missing token is a failure there,
// not a quiet warning, so a lost key is noticed (watch-run.yml).
const NO_TOKEN =
  "SUPABASE_WATCH_TOKEN (the environment watch) or SUPABASE_PROJECT_ID is not set, so Supabase was not asked.";

function supabase() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const project = process.env.SUPABASE_PROJECT_ID;
  if (!token || !project) return null;
  return async (method, route, body) => {
    const response = await fetch(
      `${SUPABASE_API}/projects/${encodeURIComponent(project)}${route}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body && JSON.stringify(body),
      },
    );
    const text = await response.text();
    if (!response.ok)
      throw Object.assign(
        new Error(
          `Supabase answered ${response.status} to ${method} ${route.split("?")[0]}: ` +
            text.split(token).join("***").slice(0, 300),
        ),
        { status: response.status },
      );
    return text ? JSON.parse(text) : null;
  };
}

async function checkSite(config, call) {
  const problems = [];
  const lines = [];
  let home = "";
  for (const route of config.pages) {
    try {
      const response = await fetch(new URL(route, config.site), {
        redirect: "follow",
      });
      const html = await response.text();
      if (route === "/") home = html;
      const problem = pageVerdict(route, response.status, html);
      if (problem) problems.push(problem);
      else lines.push(`${route} opens.`);
    } catch (error) {
      problems.push(`${route} could not be reached: ${error.message}`);
    }
  }
  const script = firstScript(home);
  if (home && !script)
    problems.push("The home page names none of its scripts.");
  if (script) {
    try {
      const response = await fetch(new URL(script, config.site));
      await response.arrayBuffer();
      if (response.status !== 200)
        problems.push(`The home page's script answered ${response.status}.`);
      else lines.push("The home page's script loads.");
    } catch (error) {
      problems.push(
        `The home page's script could not be reached: ${error.message}`,
      );
    }
  }
  if (call) {
    try {
      const services = await call(
        "GET",
        "/health?services=db&services=auth&services=rest",
      );
      for (const service of services ?? []) {
        if (service.healthy) lines.push(`Supabase ${service.name} is healthy.`);
        else
          problems.push(
            `Supabase ${service.name} is ${service.status ?? "not healthy"}.`,
          );
      }
    } catch (error) {
      // A token that may not read the health is the owner's to widen, not an
      // outage, so it does not open an issue every fifteen minutes.
      if (error.status === 401 || error.status === 403)
        lines.push(`::warning::${error.message}`);
      else problems.push(error.message);
    }
  } else if (process.env.REPORT_ISSUES === "on") problems.push(NO_TOKEN);
  else lines.push("::warning::No Supabase token, so Supabase was not asked.");
  return { ok: problems.length === 0, lines: [...problems, ...lines] };
}

async function report(kind, result) {
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? `${kind}: ok` : `${kind}: FAILED`);
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (process.env.REPORT_ISSUES !== "on" || !token || !repository.includes("/"))
    return;
  const github = async (method, route, body) => {
    const response = await fetch(`${GITHUB_API}/repos/${repository}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body && JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `GitHub answered ${response.status} to ${method} ${route.split("?")[0]}`,
      );
    return text ? JSON.parse(text) : null;
  };
  const open = await github(
    "GET",
    "/issues?state=open&creator=" +
      encodeURIComponent("github-actions[bot]") +
      "&per_page=100",
  );
  const plan = issuePlan(open, kind, result.ok);
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "";
  if (plan.open) {
    const issue = await github("POST", "/issues", {
      title: `[見張り] ${TITLES[kind]}`,
      body: issueBody(kind, result.lines, {
        owner: process.env.GITHUB_REPOSITORY_OWNER ?? repository.split("/")[0],
        runUrl,
      }),
    });
    console.log(`Opened issue #${issue.number}.`);
  } else if (plan.already)
    console.log(`Issue #${plan.already} already says so.`);
  else if (plan.close) {
    await github("POST", `/issues/${plan.close}/comments`, {
      body: `${iso(Date.now())} の見張りで戻っていました。${runUrl ? `\n\n記録: ${runUrl}` : ""}`,
    });
    await github("PATCH", `/issues/${plan.close}`, {
      state: "closed",
      state_reason: "completed",
    });
    console.log(`Closed issue #${plan.close}.`);
  }
}

async function main(action, kind, outcome) {
  const config = await settings();
  const call = supabase();
  let result;
  if (action === "site") {
    result = await checkSite(config, call);
    const retry = Number(process.env.WATCH_RETRY_SECONDS ?? 60) * 1000;
    if (!result.ok) {
      console.log(
        `Not right the first time; trying again in ${retry / 1000}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, retry));
      result = await checkSite(config, call);
    }
  } else if (
    action === "backups" ||
    action === "usage" ||
    action === "errors"
  ) {
    if (!call && process.env.REPORT_ISSUES === "on") {
      await report(action, { ok: false, lines: [NO_TOKEN] });
      process.exitCode = 1;
      return;
    }
    if (!call) {
      console.log(
        `::warning::SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_ID is not set, so the ${action} were not checked.`,
      );
      return;
    }
    try {
      if (action === "errors") {
        let rows;
        try {
          rows = await call("POST", "/database/query/read-only", {
            query: SCREEN_ERRORS_QUERY,
          });
        } catch (error) {
          // Before the table's migration is on main there is nothing to count.
          if (/screen_errors.*does not exist/.test(error.message)) rows = null;
          else throw error;
        }
        result = rows
          ? errorsVerdict(rows[0], {
              perDay: config.screenErrorsPerDay,
              rowsWarn: config.screenErrorsRowsWarn,
              perHour: config.screenErrorsPerHour,
            })
          : { ok: true, lines: ["Screen errors: not recorded yet."] };
        if (process.env.GITHUB_STEP_SUMMARY)
          await appendFile(
            process.env.GITHUB_STEP_SUMMARY,
            `### Screen errors (${iso(Date.now())})\n\n- ${result.lines.join("\n- ")}\n`,
          );
      } else if (action === "backups")
        result = backupVerdict(
          await call("GET", "/database/backups"),
          Date.now(),
          { plan: config.plan, maxHours: config.backupMaxHours },
        );
      else {
        const rows = await call("POST", "/database/query/read-only", {
          query:
            "select pg_catalog.pg_database_size(pg_catalog.current_database()) as database_bytes, " +
            "(select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o) as storage_bytes",
        });
        const included = config.included[config.plan] ?? config.included.free;
        result = usageVerdict(rows?.[0], included, config.usageWarnPercent);
        if (process.env.GITHUB_STEP_SUMMARY) {
          await appendFile(
            process.env.GITHUB_STEP_SUMMARY,
            `### Supabase usage (${iso(Date.now())}, ${config.plan})\n\n` +
              result.lines.map((line) => `- ${line}`).join("\n") +
              "\n",
          );
        }
      }
    } catch (error) {
      const refused = error.status === 401 || error.status === 403;
      const lines = [error.message];
      if (refused)
        lines.push(
          `The token may not read the ${action}. Give the watch's token (SUPABASE_WATCH_TOKEN, the environment watch) Backups and Database read access (docs/09「毎日の控えと見張り」).`,
        );
      // A pull request only tries the watch, and a free plan has no backups
      // to miss: a refused token there is a warning, not a red check.
      const quiet =
        refused &&
        (process.env.REPORT_ISSUES !== "on" ||
          (action === "backups" && config.plan === "free"));
      result = quiet
        ? { ok: true, lines: lines.map((line) => `::warning::${line}`) }
        : { ok: false, lines };
    }
  } else if (
    action === "report" &&
    kind in TITLES &&
    /^(ok|failed)$/.test(outcome)
  ) {
    result = {
      ok: outcome === "ok",
      lines: [
        outcome === "ok"
          ? `The ${kind} passed.`
          : `The ${kind} failed; the run's log says where.`,
      ],
    };
    action = kind;
  } else {
    console.error(
      "Usage: node scripts/watch.mjs site|backups|usage|errors | report <site|backups|usage|journey|write> ok|failed",
    );
    process.exit(2);
  }
  await report(action, result);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2], process.argv[3], process.argv[4]).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
