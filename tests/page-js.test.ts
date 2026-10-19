import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pageSizes } from "../scripts/perf/page-js.mjs";

// How much JS each page reads before it runs, compressed as Vercel sends it
// (brotli), against tests/page-js-baseline.json (AUD-045, AUD-048), and how
// much CSS, against tests/page-css-baseline.json (管理表106: a screen's own
// CSS comes with the screen, screen-styles.ts). Run after the build with the
// stand-in Supabase (CI's speed job):
//
//   NEXT_PUBLIC_SUPABASE_URL=https://test-project.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test pnpm build
//   pnpm test:page-js
//
// A page over its line by more than its slack fails: a screen's code or CSS
// that came back onto every page, or a library read at once that could wait.
// Smaller is said, and the lines are lowered with
//   node scripts/perf/page-js.mjs out --baseline > tests/page-js-baseline.json
//   node scripts/perf/page-js.mjs out --css --baseline > tests/page-css-baseline.json

const root = path.resolve(__dirname, "..");
const out = path.join(root, "out");

assert.ok(
  existsSync(path.join(out, "index.html")),
  "build the site first (out/ is missing)",
);

for (const [kind, name, slack] of [
  ["js", "JS", 2],
  ["css", "CSS", 1],
] as const) {
  const baseline: Record<string, number> = JSON.parse(
    readFileSync(path.join(root, `tests/page-${kind}-baseline.json`), "utf8"),
  );
  const sizes: Record<string, { gz: number; br: number }> = pageSizes(
    out,
    kind,
  );

  const over: string[] = [];
  const under: string[] = [];
  for (const [page, { br }] of Object.entries(sizes)) {
    const line = baseline[page];
    if (line === undefined) {
      over.push(`${page}: ${br}KB, a page with no line in the baseline`);
      continue;
    }
    if (br > line + slack) over.push(`${page}: ${br}KB, its line ${line}KB`);
    else if (br < line - slack)
      under.push(`${page}: ${br}KB, its line ${line}KB`);
    console.log(`${String(br).padStart(4)}KB ${name} (line ${line}KB) ${page}`);
  }
  for (const page of Object.keys(baseline))
    if (!(page in sizes)) under.push(`${page}: no longer built`);
  if (under.length)
    console.log(
      `Less ${name} than the baseline; lower its lines:\n  ` +
        under.join("\n  "),
    );
  assert.deepEqual(over, [], `pages read more ${name} than their line`);
  console.log(`page ${name} ok (${Object.keys(sizes).length} pages)`);
}
