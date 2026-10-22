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
//   node scripts/watch.mjs keys      which keys in watch.json run out within
//                                    30 days, and within 7 (asks no one; the
//                                    dates are written by hand)
//   node scripts/watch.mjs heartbeat a scheduled watch ran within 2 hours, and
//                                    no watch run is stuck (GitHub's list)
//   node scripts/watch.mjs expect <job>  whether each check of this job told
//                                    GitHub in this run (WATCH_TOLD), as the
//                                    job's output "complete"
//   node scripts/watch.mjs told      every job of this run said "complete"
//                                    (NEEDS)
//   node scripts/watch.mjs report <kind> ok|failed
//                                    tells about a check run elsewhere (the
//                                    production journey, or whether the
//                                    publishing run on main went through)
//
// Right after main is published (the Vercel run on a push to main) or its
// migrations are applied (Deploy database), watch.yml runs the site check and
// the walk once; WATCH_AFTER names that run and its commit in the issue.
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
  publish: "本番の公開が終わりませんでした",
  errors: "読書家の画面でエラーが起きています",
  keys: "鍵の期限が30日以内に切れます",
  "keys-soon": "鍵の期限が7日以内に切れます",
  "keys-unconfirmed": "期限を確かめていない鍵があります",
  // One issue for each step the key was turned away at, so a lost key reads
  // as a lost key, not as the usage or the errors it kept the watch from
  // reading, and a step that still answers (the health, every 15 minutes)
  // does not close the issue of one that does not (the backups, each morning).
  "refused-site": "見張りの鍵が Supabase に断られています（具合）",
  "refused-backups": "見張りの鍵が Supabase に断られています（控えの一覧）",
  "refused-usage": "見張りの鍵が Supabase に断られています（使用量）",
  "refused-errors": "見張りの鍵が Supabase に断られています（画面のエラー）",
  // The watch watching itself: a step that ended red without an issue that
  // says why (a timeout, a setup that broke), and runs that stopped coming.
  watch: "見張りそのものが途中で止まりました",
  "watch-stopped": "見張りが動いていません",
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

/**
 * Which keys run out soon. Supabase's API does not tell a token's expiry, so
 * scripts/watch.json keeps each key's date as written when it was made
 * ("never" for one without). A date is the start of that day in Tokyo, so the
 * warning comes a little early rather than late. A key missing its date or
 * with one that cannot be read fails, so the list is kept right.
 *
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function keysVerdict(keys, now, withinDays) {
  const lines = [];
  let ok = true;
  if (!Array.isArray(keys) || keys.length === 0)
    return { ok: false, lines: ["No keys are listed in scripts/watch.json."] };
  for (const key of keys) {
    const label = `${key?.name} (${key?.secret}, ${key?.environment})`;
    if (key?.expires === "never") {
      lines.push(`${label}: does not expire.`);
      continue;
    }
    // Its own issue says so (unconfirmedVerdict), so a date that comes near
    // for another key still opens the issues above.
    if (key?.expires === "unknown") {
      lines.push(`${label}: the date it expires is not confirmed.`);
      continue;
    }
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(key?.expires))
      ? Date.parse(`${key.expires}T00:00:00+09:00`)
      : NaN;
    // A day that is not in the calendar (02-30) would roll into the next month.
    const real =
      Number.isFinite(at) &&
      new Date(at + 9 * 3_600_000).toISOString().slice(0, 10) === key.expires;
    if (!real) {
      lines.push(`${label}: no date it expires is written.`);
      ok = false;
      continue;
    }
    const days = Math.floor((at - now) / 86_400_000);
    if (days < 0) {
      lines.push(`${label}: expires on ${key.expires}, which has come.`);
      ok = false;
    } else if (days <= withinDays) {
      lines.push(`${label}: expires on ${key.expires}, in ${days} day(s).`);
      ok = false;
    } else lines.push(`${label}: expires on ${key.expires}.`);
  }
  if (!ok)
    lines.push(
      "Make a new one with the same access, put it in the secret, then write its date in scripts/watch.json (docs/09「鍵の期限」).",
    );
  return { ok, lines };
}

/** Whether a page of the site looks like the site: a page with its scripts. */
/**
 * Which keys in scripts/watch.json have a date that nobody has confirmed
 * ("unknown"): a guess must not pass for "never".
 *
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function unconfirmedVerdict(keys) {
  const unknown = (Array.isArray(keys) ? keys : []).filter(
    (key) => key?.expires === "unknown",
  );
  if (unknown.length === 0)
    return { ok: true, lines: ["Every key's date is confirmed."] };
  return {
    ok: false,
    lines: [
      ...unknown.map(
        (key) =>
          `${key.name} (${key.secret}, ${key.environment}): the date it expires is not confirmed.`,
      ),
      'Find the key in the service\'s own list (docs/09「鍵の期限」), then write its date or "never" in scripts/watch.json.',
    ],
  };
}

/** The commit the page says it was built from (layout.tsx), or null. */
export function servedCommit(html) {
  const found =
    /<meta\s+name="booktown-build"\s+content="([0-9a-f]{7,40})"/.exec(
      html ?? "",
    );
  return found ? found[1] : null;
}

/**
 * Whether the site shows the commit just published: that one, or one after
 * it (GitHub's compare says "ahead" when main moved on since). A build from
 * before, or none named, is a failure: the checks would have looked at the
 * old site.
 *
 * @param {string} expected the published commit
 * @param {string | null} served what the home page names
 * @param {string | null} compare GitHub's status of expected...served
 * @returns {string | null} the problem, or null
 */
export function commitVerdict(expected, served, compare) {
  if (!served)
    return "The home page names no build, so which version is shown is unknown.";
  if (expected.startsWith(served) || served.startsWith(expected)) return null;
  if (compare === "ahead") return null;
  return `The site shows ${served.slice(0, 7)}, not ${expected.slice(0, 7)} that was just published${compare ? ` (${compare})` : ""}. If production was rolled back on purpose, this is expected until promote-latest.`;
}

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

/**
 * What each job of watch-run.yml must have told before it ends, one check a
 * group (either name of a group will do: a refused token is told instead of
 * the check it kept from being read). Whether publishing went through is
 * told only by a run that follows publishing.
 */
export function expectedKinds(job, { published = false } = {}) {
  if (job === "site")
    return ["site", "watch-stopped", ...(published ? ["publish"] : [])];
  if (job === "daily")
    return [
      "backups|refused-backups",
      "usage|refused-usage",
      "errors|refused-errors",
      "keys",
      "keys-soon",
      "keys-unconfirmed",
    ];
  if (job === "walk") return ["journey"];
  return [];
}

/**
 * Which of the expected checks this job did not tell, from the lines report()
 * wrote to WATCH_TOLD in this same run ("<kind> ok|failed <how>"). A line is
 * written only once GitHub took the issue (opened, opened again, still open,
 * closed, or nothing to do), so an old issue left open never stands for a
 * failure of this run.
 *
 * @returns {string[]} the groups not told
 */
export function untold(expected, toldText) {
  const told = new Set(
    String(toldText ?? "")
      .split("\n")
      .map((line) => line.split(" ")[0])
      .filter(Boolean),
  );
  return expected.filter(
    (group) => !group.split("|").some((kind) => told.has(kind)),
  );
}

/**
 * Whether every job of the watch told what it found in this run. A job that
 * ended (red, or cut off by a timeout) before each of its checks had told
 * GitHub leaves no "complete" behind: the watch itself broke there.
 *
 * @param {Record<string, { result?: string, outputs?: { complete?: string } }>} needs
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function toldVerdict(needs) {
  const lines = [];
  let ok = true;
  for (const job of ["site", "daily", "walk"]) {
    const result = needs?.[job]?.result;
    if (!result || result === "skipped") continue;
    if (needs[job].outputs?.complete === "yes")
      lines.push(`The ${job} step told every check (${result}).`);
    else {
      ok = false;
      lines.push(
        `The ${job} step ended ${result} before every check was told (a timeout, or a step before the checks broke). The run's log says where.`,
      );
    }
  }
  if (!lines.length) lines.push("No step of the watch ran.");
  return { ok, lines };
}

/** How long the scheduled watch may stay away, and a run may keep going. */
export const HEARTBEAT = { scheduleHours: 2, stuckMinutes: 45 };

/**
 * Whether the watch keeps coming: a scheduled run started within
 * scheduleHours (other than this one; GitHub's every 15 minutes comes every
 * 35 to 50 in practice), and no run has been waiting or going for longer than
 * stuckMinutes.
 *
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function heartbeatVerdict(runs, now, selfId) {
  const others = (runs ?? []).filter(
    (run) => String(run.id) !== String(selfId),
  );
  const lines = [];
  let ok = true;
  const scheduled = others
    .filter((run) => run.event === "schedule")
    .map((run) => Date.parse(run.created_at))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (scheduled === undefined) {
    ok = false;
    lines.push("No scheduled watch run is listed.");
  } else {
    const hours = (now - scheduled) / 3_600_000;
    lines.push(
      `Last scheduled watch: ${iso(scheduled)} (${hours.toFixed(1)} hours ago).`,
    );
    if (hours > HEARTBEAT.scheduleHours) {
      ok = false;
      lines.push(
        `Longer than ${HEARTBEAT.scheduleHours} hours: GitHub may have stopped the schedule (it does after 60 days with no change to the repository), or Actions is down.`,
      );
    }
  }
  for (const run of others) {
    if (
      !["queued", "in_progress", "waiting", "pending", "requested"].includes(
        run.status,
      )
    )
      continue;
    const minutes = (now - Date.parse(run.created_at)) / 60_000;
    if (minutes > HEARTBEAT.stuckMinutes) {
      ok = false;
      lines.push(
        `A watch run has been ${run.status} for ${Math.round(minutes)} minutes: ${run.html_url}`,
      );
    }
  }
  return { ok, lines };
}

/** How long a closed issue is opened again rather than written anew. */
export const REOPEN_HOURS = 24;

/** Whether an issue still open was last written to a day or more ago. */
export function stillDue(issue, now) {
  const at = Date.parse(issue?.updated_at ?? "");
  return Number.isFinite(at) && now - at >= REOPEN_HOURS * 3_600_000;
}

/** A closed issue of this kind, closed within REOPEN_HOURS, or null. */
export function recentlyClosed(closedIssues, kind, now) {
  const found = (closedIssues ?? []).find(
    (issue) =>
      !issue.pull_request &&
      String(issue.body ?? "").includes(marker(kind)) &&
      now - Date.parse(issue.closed_at ?? "") <= REOPEN_HOURS * 3_600_000,
  );
  return found ? found.number : null;
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

// A token Supabase turns away is a failure on main too: what it was to read
// was not read, and that is not the same as all being well.
const isRefusal = (error) => error?.status === 401 || error?.status === 403;
// What each step reads, so the fix names the access it was refused.
const READS = {
  site: "the project's health",
  backups: "the list of backups",
  usage: "the database's size (a read-only query)",
  errors: "the screen errors (a read-only query)",
};
const refusedFix = (step) =>
  `Give the watch's token read access to ${READS[step]}, or make it again with that access, and put it in SUPABASE_WATCH_TOKEN (the environment watch). docs/09「毎日の控えと見張り」「鍵の期限」.`;

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
  let supabase;
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
  const expected = process.env.WATCH_EXPECT_COMMIT ?? "";
  if (/^[0-9a-f]{40}$/.test(expected)) {
    // Asked past any cache, so an old copy is not taken for the new site.
    let served = null;
    try {
      const response = await fetch(
        new URL(`/?watch=${Date.now()}`, config.site),
        { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } },
      );
      served = servedCommit(await response.text());
    } catch (error) {
      problems.push(`The home page could not be read again: ${error.message}`);
    }
    let compare = null;
    if (served && !expected.startsWith(served))
      compare = await compareCommits(expected, served);
    const problem = commitVerdict(expected, served, compare);
    if (problem) problems.push(problem);
    else
      lines.push(
        `The site shows ${served.slice(0, 7)} (published ${expected.slice(0, 7)}).`,
      );
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
      supabase = "answered";
    } catch (error) {
      // A refused token goes to its own issue (main), not to the site's.
      if (isRefusal(error) && process.env.REPORT_ISSUES === "on")
        supabase = error.message;
      else if (isRefusal(error)) lines.push(`::warning::${error.message}`);
      else problems.push(error.message);
    }
  } else if (process.env.REPORT_ISSUES === "on") problems.push(NO_TOKEN);
  else lines.push("::warning::No Supabase token, so Supabase was not asked.");
  return {
    ok: problems.length === 0,
    lines: [...problems, ...lines],
    supabase,
  };
}

/**
 * Opens the step's refused-token issue when Supabase turned the token away
 * there, and closes it once Supabase answers that same step again: another
 * step answering says nothing about what this one may read. Outside main it
 * only prints.
 *
 * @param {"site" | "backups" | "usage" | "errors"} step
 * @param {string | undefined} supabase "answered", the refusal, or undefined
 *   when Supabase was not asked
 */
async function reportRefusal(step, supabase) {
  if (supabase === undefined || process.env.REPORT_ISSUES !== "on") return;
  if (supabase === "answered")
    await report(`refused-${step}`, {
      ok: true,
      lines: [`Supabase answered the watch's token for ${READS[step]}.`],
    });
  else {
    await report(`refused-${step}`, {
      ok: false,
      lines: [supabase, refusedFix(step)],
    });
    process.exitCode = 1;
  }
}

/**
 * The run a check follows, as watch.yml writes it ("Vercel a14ec04" and that
 * run's address), in lines for the issue; none when it follows no run.
 */
export function afterLines(after, runUrl) {
  if (!after || !/^[\w .-]{1,80}$/.test(after)) return [];
  const url =
    runUrl &&
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(runUrl)
      ? runUrl
      : null;
  return [
    `Checked right after ${after}.`,
    ...(url ? [`That run: ${url}`] : []),
  ];
}

/**
 * What the check that ran elsewhere wrote of its failures (the walk writes
 * them to WATCH_DETAILS), for the issue: a few short lines, never the page's
 * words beyond what the check itself printed in the public log.
 */
export async function details(file) {
  if (!file) return [];
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter(Boolean)
      .slice(0, 12)
      .map((line) => line.slice(0, 240));
  } catch {
    return [];
  }
}

/** GitHub's word for how served stands to expected ("ahead"...), or null. */
async function compareCommits(expected, served) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (!token || !repository.includes("/")) return null;
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${repository}/compare/${expected}...${served}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) return null;
    return (await response.json())?.status ?? null;
  } catch {
    return null;
  }
}

async function report(kind, inResult) {
  const after = afterLines(
    process.env.WATCH_AFTER,
    process.env.WATCH_AFTER_RUN,
  );
  const result = { ...inResult, lines: [...after, ...inResult.lines] };
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? `${kind}: ok` : `${kind}: FAILED`);
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (
    process.env.REPORT_ISSUES !== "on" ||
    !token ||
    !repository.includes("/")
  ) {
    await toldLine(kind, result.ok, "unreported");
    return;
  }
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
  // The same failure back within a day opens the issue it had again, so a
  // check that goes up and down writes one issue, not one each time.
  const reopen = plan.open
    ? recentlyClosed(
        await github(
          "GET",
          "/issues?state=closed&creator=" +
            encodeURIComponent("github-actions[bot]") +
            `&since=${new Date(Date.now() - REOPEN_HOURS * 3_600_000).toISOString()}&per_page=100`,
        ),
        kind,
        Date.now(),
      )
    : null;
  if (reopen) {
    await github("POST", `/issues/${reopen}/comments`, {
      body: [
        `@${process.env.GITHUB_REPOSITORY_OWNER ?? repository.split("/")[0]} ${iso(Date.now())} にまた起きました。`,
        "",
        "```",
        ...result.lines,
        "```",
        runUrl ? `\n記録: ${runUrl}` : "",
      ].join("\n"),
    });
    await github("PATCH", `/issues/${reopen}`, { state: "open" });
    console.log(`Reopened issue #${reopen}.`);
  } else if (plan.open) {
    const issue = await github("POST", "/issues", {
      title: `[見張り] ${TITLES[kind]}`,
      body: issueBody(kind, result.lines, {
        owner: process.env.GITHUB_REPOSITORY_OWNER ?? repository.split("/")[0],
        runUrl,
      }),
    });
    console.log(`Opened issue #${issue.number}.`);
  } else if (plan.already) {
    // Still failing: once a day the issue says so again, with what this run
    // found, so a long outage stays in view without a comment every run.
    const issue = open.find((entry) => entry.number === plan.already);
    if (stillDue(issue, Date.now())) {
      await github("POST", `/issues/${plan.already}/comments`, {
        body: [
          `${iso(Date.now())} もまだ続いています。`,
          "",
          "```",
          ...result.lines,
          "```",
          runUrl ? `\n記録: ${runUrl}` : "",
        ].join("\n"),
      });
      console.log(
        `Issue #${plan.already} already says so; told it is still so.`,
      );
    } else console.log(`Issue #${plan.already} already says so.`);
  } else if (plan.close) {
    await github("POST", `/issues/${plan.close}/comments`, {
      body: `${iso(Date.now())} の見張りで戻っていました。${runUrl ? `\n\n記録: ${runUrl}` : ""}`,
    });
    await github("PATCH", `/issues/${plan.close}`, {
      state: "closed",
      state_reason: "completed",
    });
    console.log(`Closed issue #${plan.close}.`);
  }
  await toldLine(
    kind,
    result.ok,
    reopen
      ? "reopened"
      : plan.open
        ? "opened"
        : plan.already
          ? "already"
          : plan.close
            ? "closed"
            : "quiet",
  );
}

/** Notes in WATCH_TOLD that this run told GitHub about this check. */
async function toldLine(kind, ok, how) {
  if (process.env.WATCH_TOLD)
    await appendFile(
      process.env.WATCH_TOLD,
      `${kind} ${ok ? "ok" : "failed"} ${how}\n`,
    );
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
    await report(action, result);
    await reportRefusal("site", result.supabase);
    if (!result.ok) process.exitCode = 1;
    return;
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
    let supabase = "answered";
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
      if (isRefusal(error) && process.env.REPORT_ISSUES === "on") {
        // The check itself was not made, so its own issue stays as it was.
        console.log(`The ${action} were not read: Supabase refused the token.`);
        await reportRefusal(action, error.message);
        return;
      }
      supabase = undefined;
      // A pull request only tries the watch: a refused token there is a
      // warning, not a red check.
      result = isRefusal(error)
        ? {
            ok: true,
            lines: [error.message, refusedFix(action)].map(
              (line) => `::warning::${line}`,
            ),
          }
        : { ok: false, lines: [error.message] };
    }
    await report(action, result);
    await reportRefusal(action, supabase);
    if (!result.ok) process.exitCode = 1;
    return;
  } else if (action === "expect") {
    // The last step of each job (always): says whether every check told.
    let text = "";
    try {
      text = await readFile(process.env.WATCH_TOLD ?? "", "utf8");
    } catch {
      // Nothing was told.
    }
    const missing = untold(
      expectedKinds(kind, { published: Boolean(process.env.WATCH_PUBLISHED) }),
      text,
    );
    console.log(
      missing.length
        ? `Not told in this run: ${missing.join(", ")}.`
        : "Every check of this step told GitHub.",
    );
    if (process.env.GITHUB_OUTPUT)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `complete=${missing.length ? "no" : "yes"}\n`,
      );
    return;
  } else if (action === "heartbeat" || action === "told") {
    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY ?? "";
    if (!token || !repository.includes("/")) {
      console.log(
        `::warning::No GitHub token, so the ${action} was not checked.`,
      );
      return;
    }
    const read = async (route) => {
      const response = await fetch(
        `${GITHUB_API}/repos/${repository}${route}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (!response.ok)
        throw new Error(
          `GitHub answered ${response.status} to GET ${route.split("?")[0]}`,
        );
      return response.json();
    };
    try {
      if (action === "heartbeat") {
        const answer = await read(
          "/actions/workflows/watch.yml/runs?per_page=100",
        );
        result = heartbeatVerdict(
          answer.workflow_runs,
          Date.now(),
          process.env.GITHUB_RUN_ID,
        );
        action = "watch-stopped";
      } else {
        result = toldVerdict(JSON.parse(process.env.NEEDS ?? "{}"));
        action = "watch";
      }
    } catch (error) {
      result = { ok: false, lines: [error.message] };
      action = action === "heartbeat" ? "watch-stopped" : "watch";
    }
  } else if (action === "keys") {
    // Two issues, at 30 days and at 7, so a second mail comes near the end.
    let failed = false;
    for (const [name, days] of [
      ["keys", 30],
      ["keys-soon", 7],
    ]) {
      const verdict = keysVerdict(config.keys, Date.now(), days);
      await report(name, verdict);
      failed ||= !verdict.ok;
    }
    const unconfirmed = unconfirmedVerdict(config.keys);
    await report("keys-unconfirmed", unconfirmed);
    failed ||= !unconfirmed.ok;
    // The dates move on their own, so a pull request only warns: a key near
    // its end must not turn every pull request red.
    if (failed && process.env.REPORT_ISSUES === "on") process.exitCode = 1;
    else if (failed)
      console.log("::warning::A key needs looking after; on main this is red.");
    return;
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
        ...(outcome === "ok" ? [] : await details(process.env.WATCH_DETAILS)),
      ],
    };
    action = kind;
  } else {
    console.error(
      "Usage: node scripts/watch.mjs site|backups|usage|errors|keys|heartbeat|told|expect <job> | report <journey|publish|write> ok|failed",
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
