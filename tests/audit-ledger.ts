import assert from "node:assert/strict";

// The audit ledger (docs/監査/台帳.md) and its history (docs/監査/経緯.md),
// read as rows and sections so that tests/audit-ledger.test.ts can hold their
// shape and tests/audit-ledger-kept.ts can prove a reorganisation lost nothing.

export const LEDGER = "docs/監査/台帳.md";
export const HISTORY = "docs/監査/経緯.md";

/**
 * How an open row's 記録 starts: what to do next (次), what is left (残り),
 * or that nobody has touched the baseline's proposal yet.
 */
export const OPEN_NOTE = /^(次：|残り：|基準点の案のまま（手つかず）)/;

/** Longest 記録 a row may keep; the rest goes under its number in 経緯.md. */
export const NOTE_MAX = 300;

export const GRADES = ["A", "B", "C", "D"] as const;
export const STATES = ["未解決", "直した", "再確認済み", "見送り"] as const;

/** The ledger's tables in reading order, and the states each one holds. */
export const SECTIONS = [
  { title: "## 未解決", states: ["未解決"] },
  { title: "## 直した（再確認待ち・まだ終わっていない）", states: ["直した"] },
  { title: "## 再確認済み・見送り", states: ["再確認済み", "見送り"] },
] as const;

export const HEADER =
  "| 番号 | 重要度 | 分野 | 題 | 見つけた日 | 原因 | 状態 | 再発 | 管理表 | 記録 |";

export type Row = {
  id: string;
  number: number;
  grade: string;
  state: string;
  cells: string[];
  note: string;
  section: string;
};

/** Every AUD row of the ledger, with the ## section it sits under. */
export function ledgerRows(text: string): Row[] {
  const rows: Row[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) section = line;
    if (!line.startsWith("| AUD-")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 10, `${cells[0]} has the ten columns of the ledger`);
    const id = cells[0];
    assert.match(id, /^AUD-\d{3,}$/, `${id} is numbered AUD-001 and up`);
    rows.push({
      id,
      number: Number(id.slice(4)),
      grade: cells[1],
      state: cells[6],
      cells,
      note: cells[9],
      section,
    });
  }
  return rows;
}

/** The text under each "## AUD-…" heading of 経緯.md, in file order. */
export function historySections(text: string): [string, string][] {
  const parts = text.split(/^## (AUD-\d{3,})\n/m);
  const sections: [string, string][] = [];
  for (let i = 1; i < parts.length; i += 2) sections.push([parts[i], parts[i + 1].trim()]);
  return sections;
}

/** The anchor GitHub gives "## AUD-006": #aud-006. */
export const historyLink = (id: string) => `経緯.md#${id.toLowerCase()}`;
