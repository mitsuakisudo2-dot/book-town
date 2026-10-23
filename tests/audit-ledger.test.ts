import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRADES,
  HEADER,
  HISTORY,
  LEDGER,
  NOTE_MAX,
  SECTIONS,
  STATES,
  historyLink,
  historySections,
  ledgerRows,
} from "./audit-ledger";

// The ledger is read at the start of every audit and whenever a thread fixes
// a row, so it must say what is left without opening anything else. It grew
// to 216KB when each row's 記録 kept its whole history; that history now
// lives in 経緯.md under the row's number. This holds the shape that keeps the
// ledger short as the rows grow: every number once, each row in its state's
// table, open rows by grade, short notes, counts that match, and history that
// is linked both ways.

const ledger = readFileSync(LEDGER, "utf8");
const history = readFileSync(HISTORY, "utf8");
const rows = ledgerRows(ledger);

// Every number from AUD-001 up is there once: rows are never deleted.
const numbers = rows.map((row) => row.number).sort((a, b) => a - b);
assert.deepEqual(
  numbers,
  numbers.map((_, i) => i + 1),
  "the ledger holds AUD-001 to the last number once each, with none removed",
);

for (const row of rows) {
  assert.ok((GRADES as readonly string[]).includes(row.grade), `${row.id} is graded A to D`);
  assert.ok((STATES as readonly string[]).includes(row.state), `${row.id} has a known state`);
  const section = SECTIONS.find((s) => (s.states as readonly string[]).includes(row.state));
  assert.equal(row.section, section?.title, `${row.id} (${row.state}) sits in its state's table`);
  const length = [...row.note].length;
  assert.ok(
    length <= NOTE_MAX,
    `${row.id}'s 記録 is ${length} characters; keep ${NOTE_MAX} and move the rest to ${HISTORY}`,
  );
  if (row.state === "未解決") {
    assert.ok(row.note, `${row.id} is open and says what is next or what is left`);
  }
}

// The tables come in reading order, each under the ledger's own header.
let at = ledger.indexOf("## 数");
assert.ok(at >= 0, "the ledger starts with its counts");
for (const { title } of SECTIONS) {
  const next = ledger.indexOf(`\n${title}\n`);
  assert.ok(next > at, `${title} follows the table before it`);
  at = next;
}
assert.equal(
  ledger.split(HEADER).length - 1,
  ledger.split("\n|---|---|---|---|---|---|---|---|---|---|\n").length - 1,
  "every table of rows has the ledger's header",
);

// Open rows are read most urgent first; the others in number order.
const order = (list: typeof rows) => list.map((row) => row.id);
for (const { title } of SECTIONS) {
  const list = rows.filter((row) => row.section === title);
  const sorted = [...list].sort(
    (a, b) =>
      (title === SECTIONS[0].title ? GRADES.indexOf(a.grade as never) - GRADES.indexOf(b.grade as never) : 0) ||
      a.number - b.number,
  );
  assert.deepEqual(order(list), order(sorted), `${title} is in its reading order`);
}

// The counts at the top are the rows' own.
for (const state of STATES) {
  const line = ledger.split("\n").find((l) => l.startsWith(`| ${state} |`));
  assert.ok(line, `the counts have a line for ${state}`);
  const cells = line.split("|").slice(2, -1).map((cell) => Number(cell.trim()));
  const counted = GRADES.map((grade) => rows.filter((r) => r.state === state && r.grade === grade).length);
  assert.deepEqual(cells, [...counted, counted.reduce((a, b) => a + b, 0)], `the count of ${state} matches the rows`);
}

// History: one heading per row that has one, in number order, each linked
// from its row, and every link from the ledger lands on a heading.
const sections = historySections(history);
const headed = sections.map(([id]) => id);
const known = new Set(rows.map((row) => row.id));
for (const id of headed) assert.ok(known.has(id), `${HISTORY} has ${id}, which is a row of the ledger`);
assert.deepEqual(
  headed,
  [...headed].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))),
  `${HISTORY} keeps one heading per number, in number order`,
);
assert.equal(new Set(headed).size, headed.length, `${HISTORY} has each number once`);
for (const [id, text] of sections) {
  assert.ok(text, `${HISTORY} has words under ${id}`);
  const row = rows.find((r) => r.id === id);
  assert.ok(row?.note.includes(historyLink(id)), `${id}'s row links to its history`);
}
for (const [, anchor] of ledger.matchAll(/経緯\.md#(aud-\d{3,})/g)) {
  assert.ok(headed.includes(anchor.toUpperCase()), `the link to ${anchor} lands on a heading in ${HISTORY}`);
}

const open = rows.filter((row) => row.state === "未解決").length;
console.log(
  `audit ledger: ${rows.length} rows (${open} open), ${sections.length} with history, ${Buffer.byteLength(ledger)} bytes`,
);
