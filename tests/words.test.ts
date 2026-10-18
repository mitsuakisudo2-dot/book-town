import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  AGAIN,
  counted,
  failure,
  KEPT,
  NAMES,
  nth,
  outOf,
  someCount,
  TABS,
  whenSome,
  WHILE_OFFLINE,
} from "../src/lib/words";

// Counts and failure notices read the same everywhere because every screen
// asks src/lib/words.ts for them. These checks keep it that way: no "${n}冊"
// written in place, no count of people that could show a 0, and no
// "もう一度お試しください" or "…できませんでした" outside a Failure.

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

/** The app's own code, less this file's subject and the sample town's words. */
const sources = readdirSync(path.join(root, "src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
  .filter((file) => file !== "src/lib/words.ts" && file !== "src/lib/data.ts")
  .sort();

/** Code without its comments, so that a comment may name what it explains. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Where `pattern` (a /g pattern, which may span lines) matches, as "file:line". */
const where = (pattern: RegExp, keep: (line: string) => boolean = () => true) =>
  sources.flatMap((file) => {
    const text = code(read(file));
    const lines = text.split("\n");
    return [...text.matchAll(pattern)]
      .map((match) => text.slice(0, match.index).split("\n").length)
      .filter((line) => keep(lines[line - 1]))
      .map((line) => `${file}:${line}`);
  });

const UNITS = "冊|人|件|軒|回|枚|個|ページ|段|文字|字|分|時間";

check("a count, a place in a row, and how many of the most", () => {
  assert.equal(counted(3, "冊"), "3冊");
  assert.equal(counted(0, "冊"), "0冊");
  assert.equal(nth(2, "ページ"), "2ページ目");
  assert.equal(outOf(3, 9, "冊"), "3 / 9 冊");
});

check("a 0 is never said where the count may be none", () => {
  assert.equal(someCount(5, "人"), "5人");
  for (const none of [0, -1, Number.NaN]) {
    assert.equal(someCount(none, "人"), null);
    assert.equal(
      whenSome(none, "人", (c) => `${c}がフォロー`),
      null,
    );
  }
  assert.equal(
    whenSome(2, "人", (c) => `${c}がフォロー`),
    "2人がフォロー",
  );
});

check("a failure says what happened, what is kept, and what to do", () => {
  assert.equal(
    failure({
      what: "開店できませんでした",
      kept: KEPT.draft,
      next: AGAIN.later,
    }),
    "開店できませんでした。書きかけは残しています。少し時間をおいて、もう一度お試しください。",
  );
  assert.equal(
    failure({ what: "保存できませんでした" }, ""),
    "保存できませんでした",
  );
  assert.equal(
    failure({ next: AGAIN.later }),
    "少し時間をおいて、もう一度お試しください。",
  );
  assert.equal(
    failure(WHILE_OFFLINE),
    "つながらないため、まだ保存できていません。つながりしだい保存します。",
  );
});

check("no count written in place (use counted, nth or whenSome)", () => {
  assert.deepEqual(where(new RegExp(`\\{[^{}\`]+\\}\\s*(${UNITS})`, "g")), []);
  assert.deepEqual(where(new RegExp(`\\+\\s*["'](${UNITS})`, "g")), []);
});

check("a count of people only through someCount or whenSome", () => {
  assert.deepEqual(where(/\b(counted|outOf)\([^;]*?"人"\)/g), []);
});

check("asking to try again only through AGAIN", () => {
  assert.deepEqual(where(/もう一度(お試し|押して)ください/g), []);
});

check("what did not work is said only as a Failure's what", () => {
  assert.deepEqual(
    where(
      /(でき|られ|せ|め|れ|け|え)ませんでした|つながりませんでした/g,
      (line) => !/\bwhat:/.test(line),
    ),
    [],
  );
});

check(
  "the tabs are named only through TABS, and the library says its tab's name",
  () => {
    assert.deepEqual(Object.values(TABS), [
      "ホーム",
      "検索",
      "書店めぐり",
      "ライブラリ",
      "記録",
      "読書中",
      "わたし",
    ]);
    // A tab's label, or the library's heading, written in place would not
    // change with TABS (管理表 48).
    assert.deepEqual(
      where(/label: "[^"]*",\s*section: "|<h1>(ライブラリ|本棚)<\/h1>/g),
      [],
    );
  },
);

check("each thing is said by one name (管理表 90)", () => {
  assert.equal(NAMES.shop, "書店");
  assert.equal(NAMES.service, "BookTown");
  // A shop is a 書店; the short writing of the 2nd name and the service's
  // name in another spelling are not said.
  assert.deepEqual(where(/本屋|つぶやき|Book Town/g), []);
  // 便り may yet change (けにー 10-16「統一しといたら変える時も楽」): it is
  // said only through NAMES.letter.
  assert.deepEqual(where(/便り/g), []);
  // A book is put in the ライブラリ, not a 本棚 (AUD-057).
  assert.deepEqual(where(/本棚(に登録|から外)|あなたの本棚/g), []);
  // 投稿 is only the doing of it (投稿する, 投稿しました, the button that
  // does it), never the name of what was written: that is NAMES.letter.
  // (offlineFor says it as a doing: まだ投稿できていません.)
  assert.deepEqual(
    where(/投稿(?!し|す|ボタン)/g, (line) => !/offlineFor\(/.test(line)),
    [],
  );
});

console.log(`${passed} words checks passed`);
