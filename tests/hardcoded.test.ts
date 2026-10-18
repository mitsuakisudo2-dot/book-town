import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { jstDay, shortDate, weekOf } from "../src/lib/japan-time";
import { myShopPath, walkPath } from "../src/lib/paths";

// Page addresses, dates and text limits are written once, in paths.ts,
// japan-time.ts and types.ts (管理表 92). These checks keep them from being
// written again in a screen's file.

const root = path.resolve(__dirname, "..");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const sources = readdirSync(path.join(root, "src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
  .map((file) => file.split(path.sep).join("/"));
const text = (file: string) => readFileSync(path.join(root, file), "utf8");

/** Files that still write one (their screens are being changed by another piece of work); the count may only go down. */
function hits(
  pattern: RegExp,
  home: string[],
  allowed: Record<string, number>,
) {
  const found: Record<string, number> = {};
  for (const file of sources) {
    if (home.includes(file)) continue;
    const count = text(file).match(pattern)?.length ?? 0;
    if (count) found[file] = count;
  }
  assert.deepEqual(found, allowed);
}

check("a page's address comes from paths.ts", () => {
  hits(
    /["'`]\/(shops?|profiles?|walk|search|posters?|post|library|my-shop|notifications|leave|reading|login)[/?#"'`]/g,
    ["src/lib/paths.ts"],
    {},
  );
  assert.equal(walkPath(), "/walk/");
  assert.equal(walkPath("mine"), "/walk/#mine");
  assert.equal(myShopPath({ at: "messages" }), "/my-shop/#messages");
});

check(
  "a page's address (timeline, credits, reading list) comes from paths.ts",
  () => {
    const found: Record<string, number> = {};
    for (const file of sources) {
      if (["src/lib/paths.ts", "src/lib/home-tab.ts"].includes(file)) continue;
      // comments may name an address
      const code = text(file)
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      const count =
        code.match(/["'`]\/(timeline|credits|reading-list)\/["'`]/g)?.length ??
        0;
      if (count) found[file] = count;
    }
    // PosterScreen.tsx is written by AUD-003 (#183); the address moves when it is merged
    assert.deepEqual(found, { "src/components/PosterScreen.tsx": 1 });
  },
);

check("a date is read in Japan time, from japan-time.ts", () => {
  hits(
    /toLocale(Date|Time)String|getTimezoneOffset|9 \* 3_?600_?000|9 \* 60 \* 60/g,
    ["src/lib/japan-time.ts"],
    {},
  );
  assert.equal(shortDate("2026-10-18T16:00:00Z"), "2026/10/19");
  assert.equal(weekOf("2026-10-11T15:30:00Z"), "2026-10-12");
  assert.equal(
    jstDay(Date.parse("2026-10-15T00:00:00+09:00")),
    jstDay(Date.parse("2026-10-14T00:00:00+09:00")) + 1,
  );
});

check("a text limit is a name from types.ts, not a number", () => {
  hits(
    /maxLength=\{\d+\}/g,
    [],
    // スキャンの画面 (102 のとき)
    { "src/components/BarcodeRegister.tsx": 3 },
  );
});

console.log(`${passed} hardcoded checks passed`);
