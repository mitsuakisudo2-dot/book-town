import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Code that runs with production keys on main must need the owner's review
// (.github/CODEOWNERS). This follows every file a workflow runs, and the local
// files those import, and fails when one of them sits outside CODEOWNERS.

const owner = "@mitsuakisudo2-dot";
const owned = readFileSync(".github/CODEOWNERS", "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const [pattern, ...owners] = line.split(/\s+/);
    assert.deepEqual(owners, [owner], `${pattern} is owned by ${owner} alone`);
    assert.ok(pattern.startsWith("/"), `${pattern} is anchored at the root`);
    return pattern.slice(1);
  });

const covered = (path: string) =>
  owned.some((pattern) =>
    pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern,
  );

for (const path of [
  ".github/CODEOWNERS",
  "tests/code-owners.test.ts",
  "tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
  "vercel.json",
  "next.config.ts",
  "CLAUDE.md",
  "AGENTS.md",
  "docs/理念.md",
  "docs/開発と運用/権限と鍵.md",
  "docs/開発と運用/本番への反映.md",
  "docs/開発と運用/DBの変え方.md",
  "docs/機能/公開範囲.md",
  "docs/機能/本と書誌.md",
  "docs/開発と運用/外部サービス.md",
  "docs/機能/通報と安全.md",
  "docs/機能/本棚とライブラリ.md",
  "docs/機能/書店と書店めぐり.md",
]) {
  assert.ok(covered(path), `${path} is in CODEOWNERS`);
}
for (const dir of [".github/workflows", "scripts", "supabase/migrations"]) {
  for (const name of readdirSync(dir)) {
    assert.ok(covered(`${dir}/${name}`), `${dir}/${name} is in CODEOWNERS`);
  }
}

const code = /\.(?:mjs|cjs|js|mts|cts|ts|tsx|json|sh|py)$/;
const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

// Every way a followed file can pull in another: relative and "@/" imports
// (tsx reads tsconfig.json's paths), bare and dynamic imports, require, and a
// path written out for a child process to run.
const resolve = (from: string, spec: string) => {
  const base = spec.startsWith("@/")
    ? join("src", spec.slice(2))
    : normalize(join(dirname(from), spec));
  for (const path of [
    base,
    ...[".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", ".json"].flatMap((ext) => [
      `${base}${ext}`,
      join(base, `index${ext}`),
    ]),
  ]) {
    if (isFile(path)) return path;
  }
  assert.fail(`${from} imports ${spec}, which was not found`);
};
const written = (text: string) =>
  [...text.matchAll(/[\w@.-][\w@./-]*\.(?:mjs|cjs|js|mts|cts|ts|tsx|sh|py)\b/g)]
    .map(([path]) => normalize(path.replace(/^\.\//, "")))
    .filter((path) => !path.startsWith("..") && isFile(path));

// A workflow that holds a key or may write with GITHUB_TOKEN is followed whole:
// the files it names, and the package.json scripts it runs with pnpm.
const scripts: Record<string, string> = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const run = new Set<string>();
const followed: string[] = [];
for (const name of readdirSync(".github/workflows")) {
  // Comment lines name files the workflow does not run.
  const text = readFileSync(`.github/workflows/${name}`, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  if (!/secrets\.|:\s*write\b/.test(text)) continue;
  followed.push(name);
  const named = [...written(text)];
  for (const [, script] of text.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
    if (scripts[script]) named.push(...written(scripts[script]));
  }
  for (const path of named) run.add(path);
}
assert.ok(followed.includes("vercel.yml"), "workflows with keys are followed");
assert.ok(!followed.includes("ci.yml"), "ci.yml holds no key and only reads");

const queue = [...run];
for (let path = queue.shift(); path; path = queue.shift()) {
  if (!code.test(path) || path.endsWith(".json")) continue;
  const text = readFileSync(path, "utf8");
  // A path for a child process is a string; a path in a comment is not run.
  const strings = [...text.matchAll(/(["'`])([^"'`\n]*)\1/g)].map(([, , inner]) => inner);
  const specs = [
    ...text.matchAll(/(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*["']((?:\.{1,2}|@)\/[^"']+)["']/g),
  ].map(([, spec]) => resolve(path, spec));
  for (const next of [...specs, ...strings.flatMap(written)]) {
    if (!run.has(next)) {
      run.add(next);
      queue.push(next);
    }
  }
}
for (const path of [
  "scripts/catalog-import.ts",
  "tests/fixtures/pglite-supabase.ts",
  "tests/production-journey.mjs",
]) {
  assert.ok(run.has(path), `${path} is followed`);
}
for (const path of run) {
  assert.ok(covered(path), `${path} runs on main with keys and is in CODEOWNERS`);
}

// The tests that keep the database's rules (who may see which rows, row level
// security, what leaving removes) need the owner's review as well, so a change
// that weakens one is not merged on CI alone (AUD-181). They are what test:db
// runs, every tests/db-*.test.ts among them, and the files under tests/ those
// read. Claude's own session settings (.claude/) are owned the same way.
const guards = written(scripts["test:db"]);
for (const name of readdirSync("tests")) {
  if (/^db-.*\.test\.ts$/.test(name)) {
    assert.ok(guards.includes(`tests/${name}`), `tests/${name} runs in test:db`);
  }
}
const guarded = new Set(guards);
const guardQueue = [...guards];
for (let path = guardQueue.shift(); path; path = guardQueue.shift()) {
  if (path.endsWith(".json")) continue;
  const text = readFileSync(path, "utf8");
  // Imports, and the json files a fixture reads beside itself.
  const specs = [
    ...text.matchAll(/(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*["']((?:\.{1,2}|@)\/[^"']+)["']/g),
  ].map(([, spec]) => resolve(path, spec));
  const read = [...text.matchAll(/["']([\w./-]+\.json)["']/g)]
    .flatMap(([, name]) => [normalize(join(dirname(path), name)), normalize(name)])
    .filter(isFile);
  for (const next of [...specs, ...read]) {
    if (next.startsWith("tests/") && !guarded.has(next)) {
      guarded.add(next);
      guardQueue.push(next);
    }
  }
}
for (const path of [
  "tests/database-policies.test.ts",
  "tests/db-who-sees-books.test.ts",
  "tests/fixtures/account-tables.ts",
  "tests/fixtures/library-cases.json",
]) {
  assert.ok(guarded.has(path), `${path} keeps the database's rules`);
}
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? files(path) : [path];
  });
for (const path of [...guarded, ...files(".claude")]) {
  assert.ok(covered(path), `${path} keeps BookTown safe and is in CODEOWNERS`);
}

// CLAUDE.md says when to read which document and what never to do; the facts
// live in one document each (docs/README.md). It grew to 21,000 bytes by
// copying them, and the copies drifted apart, so its size is held here.
const claudeBytes = readFileSync("CLAUDE.md").length;
assert.ok(
  claudeBytes <= 8000,
  `CLAUDE.md is ${claudeBytes} bytes; put the facts in their document and point there`,
);

console.log(
  `code owners: ${run.size} files run by workflows and ${guarded.size} database tests are owned`,
);
