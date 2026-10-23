import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// A feature's 正本 under docs/機能/ may end with 「コードとテスト」: where to
// start looking for the code and tests of a change (けにーさん 10-22). It
// is a way in, not the whole reach of a change, and says so. This holds only
// what a machine can: every path it names is there, and the warning is kept.
// Whether every file a change touches is listed is not held, on purpose.

const DIR = "docs/機能";
const HEADING = "## コードとテスト";
const WARNING = "影響範囲の完全性を保証しません";
// A path in backquotes, from one of the repository's code folders.
const PATH = /`((?:src|tests|scripts|supabase|public)\/[^`\s]+\.[a-z]+)`/g;

const maps = readdirSync(DIR)
  .filter((name) => name.endsWith(".md"))
  .map((name) => path.join(DIR, name))
  .map((file) => ({ file, text: readFileSync(file, "utf8") }))
  .filter(({ text }) => text.includes(`\n${HEADING}\n`));

assert.ok(maps.length > 0, `some ${DIR} file has ${HEADING}`);

for (const { file, text } of maps) {
  const start = text.indexOf(`\n${HEADING}\n`);
  const next = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, next < 0 ? undefined : next);
  assert.ok(
    section.includes(WARNING),
    `${file}「コードとテスト」says it is a way in, not the whole reach of a change`,
  );
  const paths = [...section.matchAll(PATH)].map((match) => match[1]);
  assert.ok(paths.length > 0, `${file}「コードとテスト」names files`);
  for (const named of new Set(paths))
    assert.ok(
      existsSync(named),
      `${file}「コードとテスト」names ${named}, which is not there`,
    );
}

console.log(`feature maps: ${maps.length} checked`);
