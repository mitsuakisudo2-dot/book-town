// What Deploy database (.github/workflows/deploy-database.yml) is about to
// apply, read against production's own history rather than against a pull
// request (docs/09「データベースへの反映」).
//
//   plan     reads the versions production has applied (the management API's
//            read-only SQL, with the environment production-read's token),
//            refuses a history that does not match the files, and lists every
//            file production has not applied yet: its name, the sha256 of
//            its text and the operations in it that can lose data. The list
//            goes to the run's summary, where the owner reads it before
//            approving, and to GITHUB_OUTPUT for the job that applies it.
//   same     after approval, before anything runs: the files
//            `supabase db push --dry-run` would apply (its output on stdin)
//            and the text of each must be what plan listed. Anything else
//            stops the run with nothing applied.
//   applied  after the push: production's history holds every listed file.
//
// Nothing here writes to the database. The log is public: it shows file
// names, fingerprints and the kinds of operation, never a row.

import { createHash } from "node:crypto";
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API = process.env.SUPABASE_API_URL ?? "https://api.supabase.com/v1";
const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const dir = path.join(root, "supabase", "migrations");

const NAME = /^(\d{14})_[^/\s]+\.sql$/;

/** Operations that can lose what readers saved (docs/09, 3.5 of the plan). */
const RISKY = [
  ["drop table", /\bdrop\s+table\b/i],
  ["drop column", /\bdrop\s+column\b/i],
  ["truncate", /\btruncate\b/i],
  ["delete from", /\bdelete\s+from\b/i],
  ["update without where", null],
  ["on delete cascade", /\bon\s+delete\s+cascade\b/i],
  ["drop schema", /\bdrop\s+schema\b/i],
  // A kept copy dropped cannot write a move back (DBの変え方.md).
  ["drop_copy", /\bdrop_copy\s*\(/i],
];

const withoutComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** The kinds of risky operation in a migration's text, each once. */
export function risky(sql) {
  const text = withoutComments(sql);
  const found = [];
  for (const [label, pattern] of RISKY) {
    if (pattern) {
      if (pattern.test(text)) found.push(label);
      continue;
    }
    // An update statement up to its end with no where in it. Statements
    // inside a function body are counted too: better shown than missed.
    const updates = text.match(
      /\bupdate\s+[\w."]+\s+(?:as\s+\w+\s+)?set\b[^;]*/gi,
    );
    if (updates?.some((statement) => !/\bwhere\b/i.test(statement)))
      found.push(label);
  }
  return found;
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * The files production has not applied, or why the history and the files
 * do not fit together.
 */
export function compare(files, applied) {
  const problems = [];
  const versions = new Map();
  for (const name of files) {
    const version = name.match(NAME)?.[1];
    if (!version) {
      problems.push(`${name} does not start with a 14-digit version.`);
      continue;
    }
    if (versions.has(version))
      problems.push(
        `${versions.get(version)} and ${name} share version ${version}.`,
      );
    else versions.set(version, name);
  }
  const done = new Set(applied);
  for (const version of done)
    if (!versions.has(version))
      problems.push(
        `Production has applied ${version}, which no file here has.`,
      );
  const newest = [...done].sort().at(-1) ?? "";
  const pending = [...versions]
    .filter(([version]) => !done.has(version))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, name]) => name);
  for (const name of pending)
    if (name.slice(0, 14) < newest)
      problems.push(
        `${name} is older than ${newest}, the newest production has applied, and was never applied.`,
      );
  return { problems, pending };
}

/** The migration files `supabase db push --dry-run` says it would apply. */
export function dryRunFiles(output) {
  return [...output.matchAll(/(\d{14}_[^\s/]+\.sql)/g)].map(
    (match) => match[1],
  );
}

/** Why what is about to run is not what was shown, or nothing. */
export function sameAsShown(shown, about) {
  const names = (list) => list.map((entry) => entry.name).join("\n");
  if (names(shown) !== names(about))
    return `The files about to be applied are not the ones shown before approval.\nShown:\n${names(shown) || "(none)"}\nAbout to apply:\n${names(about) || "(none)"}`;
  const changed = about.filter(
    (entry, index) => entry.sha256 !== shown[index].sha256,
  );
  if (changed.length)
    return `The text of ${changed.map((entry) => entry.name).join(", ")} changed after it was shown.`;
  return "";
}

async function files() {
  return (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
}

async function entry(name) {
  const text = await readFile(path.join(dir, name), "utf8");
  return { name, sha256: sha256(text), risky: risky(text) };
}

async function appliedVersions() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const project = process.env.SUPABASE_PROJECT_ID;
  if (!token || !project)
    throw new Error(
      "SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are needed.",
    );
  const response = await fetch(
    `${API}/projects/${encodeURIComponent(project)}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query:
          "select version from supabase_migrations.schema_migrations order by version",
      }),
    },
  );
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `Supabase answered ${response.status} when asked for the applied migrations.`,
    );
  return JSON.parse(text).map((row) => String(row.version));
}

const output = (key, value) =>
  process.env.GITHUB_OUTPUT
    ? appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
    : console.log(`${key}=${value}`);
const summary = (lines) =>
  process.env.GITHUB_STEP_SUMMARY
    ? appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n")
    : Promise.resolve();

async function plan() {
  const { problems, pending } = compare(await files(), await appliedVersions());
  if (problems.length) {
    for (const problem of problems) console.log(`::error::${problem}`);
    await summary([
      "## The history does not fit",
      "",
      ...problems.map((p) => `- ${p}`),
    ]);
    process.exit(1);
  }
  const entries = await Promise.all(pending.map(entry));
  const lines = entries.length
    ? [
        "## Migrations production has not applied",
        "",
        "| File | sha256 | Can lose data |",
        "|---|---|---|",
        ...entries.map(
          (e) =>
            `| ${e.name} | ${e.sha256.slice(0, 16)} | ${e.risky.join(", ") || "none found"} |`,
        ),
        "",
        '"none found" is not a proof of safety: read each file before approving.',
      ]
    : ["Production has applied every migration here. Nothing to approve."];
  for (const line of lines) console.log(line);
  await summary(lines);
  await output("count", String(entries.length));
  await output(
    "plan",
    JSON.stringify(entries.map(({ name, sha256 }) => ({ name, sha256 }))),
  );
}

async function same() {
  const shown = JSON.parse(process.env.PLAN ?? "[]");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const about = await Promise.all(dryRunFiles(input).map(entry));
  const problem = sameAsShown(shown, about);
  if (problem) {
    console.log(`::error::${problem.split("\n")[0]}`);
    console.log(problem);
    process.exit(1);
  }
  console.log(
    `The ${about.length} file(s) about to be applied are the ones shown.`,
  );
}

async function applied() {
  const shown = JSON.parse(process.env.PLAN ?? "[]");
  const done = new Set(await appliedVersions());
  const missing = shown.filter(({ name }) => !done.has(name.slice(0, 14)));
  if (missing.length) {
    const message = `Production's history does not hold ${missing.map((e) => e.name).join(", ")}. Check the database itself before applying again (docs/09).`;
    console.log(`::error::${message}`);
    await summary([`- ${message}`]);
    process.exit(1);
  }
  const line = `Production's history now holds all ${shown.length} file(s).`;
  console.log(line);
  await summary(["", line]);
}

const MODES = { plan, same, applied };
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const run = MODES[process.argv[2]];
  if (!run) {
    console.error("Usage: node scripts/migration-plan.mjs plan|same|applied");
    process.exit(2);
  }
  run().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exit(1);
  });
}
