import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { HISTORY, LEDGER, historySections, ledgerRows } from "./audit-ledger";

// Run by hand when the ledger is reorganised, against the version before it:
//   tsx tests/audit-ledger-kept.ts origin/main
// Every row is still there with the same number, grade, title and state, and
// every word of every old 記録 and history is still in the row's 記録 or under
// its number in 経緯.md. Moving words is allowed; losing them is not.

const ref = process.argv[2];
assert.ok(ref, "give the version to compare with, such as origin/main");

const show = (file: string) => {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
};

const before = ledgerRows(show(LEDGER));
const after = new Map(ledgerRows(readFileSync(LEDGER, "utf8")).map((row) => [row.id, row]));
const historyAfter = new Map(historySections(readFileSync(HISTORY, "utf8")));
const historyBefore = historySections(show(HISTORY));

assert.ok(before.length > 0, `${ref} has rows in ${LEDGER}`);
assert.equal(after.size, before.length, `${ref} had ${before.length} rows and each one is still there once`);

let moved = 0;
for (const old of before) {
  const row = after.get(old.id);
  assert.ok(row, `${old.id} is still in the ledger`);
  assert.deepEqual(row.cells.slice(0, 9), old.cells.slice(0, 9), `${old.id} keeps its columns but 記録`);
  const kept = `${row.note}\n${historyAfter.get(old.id) ?? ""}`;
  assert.ok(kept.includes(old.note), `${old.id}'s 記録 is word for word in its row or its history`);
  if (!row.note.includes(old.note)) moved++;
}
for (const [id, text] of historyBefore) {
  assert.ok(historyAfter.get(id)?.includes(text), `${id}'s history in ${ref} is all still there`);
}

console.log(
  `audit ledger kept: ${before.length} rows and ${historyBefore.length} histories of ${ref} are all there, ${moved} notes moved to ${HISTORY}`,
);
