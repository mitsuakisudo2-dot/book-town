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
  "package.json",
  "pnpm-lock.yaml",
  "vercel.json",
  "next.config.ts",
]) {
  assert.ok(covered(path), `${path} is in CODEOWNERS`);
}
for (const dir of [".github/workflows", "scripts", "supabase/migrations"]) {
  for (const name of readdirSync(dir)) {
    assert.ok(covered(`${dir}/${name}`), `${dir}/${name} is in CODEOWNERS`);
  }
}

const resolve = (from: string, spec: string) => {
  const base = normalize(join(dirname(from), spec));
  for (const path of [base, `${base}.ts`, `${base}.mjs`, `${base}.js`]) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  assert.fail(`${from} imports ${spec}, which was not found`);
};

const run = new Set<string>();
for (const name of readdirSync(".github/workflows")) {
  const text = readFileSync(`.github/workflows/${name}`, "utf8");
  for (const [path] of text.matchAll(/\b(?:scripts|tests)\/[\w./-]+\.(?:mjs|ts|js|sh)\b/g)) {
    assert.ok(existsSync(path), `${name} runs ${path}, which exists`);
    run.add(path);
  }
}
const queue = [...run];
for (let path = queue.shift(); path; path = queue.shift()) {
  const text = readFileSync(path, "utf8");
  for (const [, spec] of text.matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const next = resolve(path, spec);
    if (!run.has(next)) {
      run.add(next);
      queue.push(next);
    }
  }
}
assert.ok(run.has("scripts/catalog-import.ts"), "the catalog import is followed");
assert.ok(run.has("tests/production-journey.mjs"), "the production journey is followed");
for (const path of run) {
  assert.ok(covered(path), `${path} runs on main with keys and is in CODEOWNERS`);
}

console.log(`code owners: ${run.size} files run by workflows are owned`);
