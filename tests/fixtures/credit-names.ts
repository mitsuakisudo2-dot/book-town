// How a person of the library's answers is named when the book's statement
// of who made it (dc:creator) names as many people as the authority does:
// private.ndl_credit and private.ndl_named (tests/db-bibliography.test.ts,
// tests/db-catalog.test.ts), AUD-168 and AUD-170. The names are made up; the ways they
// are written are the library's.

/** The authority's heading, the book's statement, and the name and role the master gives. */
export const CREDIT_NAMES: Array<
  [heading: string, credit: string, name: string, role: string | null]
> = [
  ["海野, 波子", "海野波子 著", "海野波子", "著"],
  // There are others: not in the name nor the role.
  ["海野, 波子", "海野波子 [ほか] 著", "海野波子", "著"],
  ["海野, 波子", "海野波子 [ほか]著", "海野波子", "著"],
  ["海野, 波子", "海野波子 [ほか]", "海野波子", null],
  ["海野, 波子", "海野波子 [他][著]", "海野波子", "[著]"],
  ["海野, 波子", "海野波子 ほか著", "海野波子", "著"],
  ["海野, 波子", "海野波子 ほか 写真", "海野波子", "写真"],
  ["海野, 波子", "海野波子ほか著", "海野波子", "著"],
  ["海野, 波子", "海野波子 他訳", "海野波子", "訳"],
  ["海野, 波子", "海野波子 他企画・編集", "海野波子", "企画・編集"],
  ["海野, 波子", "海野波子 [ほか述]", "海野波子", "述"],
  ["海野, 波子", "海野波子 [他著]", "海野波子", "著"],
  // A name the book writes with other letters than the heading.
  ["海野, 浪子", "海野波子 ほか 著", "海野波子", "著"],
  ["海野, 浪子", "海野波子 [ほか] 著", "海野波子", "著"],
  ["海野, 浪子", "海野波子 他訳", "海野波子", "訳"],
  // A role longer than ndl_credit takes off.
  [
    "海野, 波子",
    "海野波子 キャラクターデザイン",
    "海野波子",
    "キャラクターデザイン",
  ],
  [
    "海野, 波子",
    "海野波子 著・撮影・編集・デザイン",
    "海野波子",
    "著・撮影・編集・デザイン",
  ],
  ["海野, 波子", "海野波子 脚色 構成", "海野波子", "脚色 構成"],
  // The book's own name, as it puts it.
  ["Doe, Jane", "ジェーン・ドウ 著", "ジェーン・ドウ", "著"],
  [
    "こもれび書房",
    "こもれび書房 (出版部) 編集",
    "こもれび書房 (出版部)",
    "編集",
  ],
  ["こもれび", "こもれび Books 監修", "こもれび Books", "監修"],
];
