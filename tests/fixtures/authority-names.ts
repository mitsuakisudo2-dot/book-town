// How a person of the library's name authority is named in the
// bibliographic master: the database's private.bib_person
// (tests/db-bibliography.test.ts) and the app's authorWords
// (src/lib/book-name.ts, tests/book-name.test.ts) are checked against the
// same rows, so the two cannot name one person two ways (AUD-163). The
// names are made up; the ways they are written are the library's.

/** A heading as the authority writes it, the name it gives, and whether the app reads it the catalogue's way too. */
export const AUTHORITY_NAMES: Array<
  [heading: string, name: string, app?: false]
> = [
  ["海野, 波子", "海野波子"],
  ["海野, 波子, 1901-1999", "海野波子"],
  ["Doe,John,1920-2012", "John Doe"],
  ["Doe, Jane, 1950-", "Jane Doe"],
  // The years after a single name.
  ["海野, 1950-", "海野"],
  ["海野, 794-864", "海野"],
  // A death year alone, the years of the work, or a trade or a field after
  // the given name.
  ["藤野, 霞, -2026", "藤野霞"],
  ["こもれび, pub. 2026", "こもれび"],
  ["こもれび, pub.2021", "こもれび"],
  ["こもれび, -2026", "こもれび"],
  ["Sumner, Clara, pub. 2021", "Clara Sumner"],
  ["海野, 波子, 弁護士", "海野波子"],
  ["海野, 波子, 料理研究家", "海野波子"],
  ["海野, 波子, 1950- 東洋史", "海野波子"],
  ["海野, 波子, 1950- pub. 2020", "海野波子"],
  ["Doe, John, 1962-L", "John Doe"],
  ["架空, 賢人, 551?-479B. C", "架空賢人"],
  ["海野, 波子, 漫画家, 1970-", "海野波子"],
  // A trade or a field after a single name (AUD-167), and a given name
  // that only looks like one.
  ["こもれび, 漫画家", "こもれび"],
  ["Kei, イラストレーター", "Kei"],
  ["こもれび, ブックデザイナー", "こもれび"],
  ["こもれび, 漫画家, pub. 2026", "こもれび"],
  ["海野, 太郎冠者", "海野太郎冠者"],
  ["Pan, Peter", "Peter Pan"],
  // What stays after a romaji name.
  ["Doe, John, Jr.", "John Doe Jr."],
  ["Doe, John, III", "John Doe III"],
  // Not a heading: as written.
  ["海野 波子", "海野 波子"],
  ["架空書房編集部", "架空書房編集部"],
  // A space inside a part is the authority's, not a second person.
  ["松本, 波四郎 10代目", "松本波四郎 10代目", false],
];

/**
 * The readings of the trades private.bib_trade knows besides the app's
 * TRADES (src/lib/book-name.ts), which reads no readings: the database
 * knows these and TRADES, no more (AUD-169).
 */
export const TRADE_READINGS = (
  "マンガカ マンガゲンサクシャ サッカ ショウセツカ エホンサッカ ドウワサッカ " +
  "ホウソウサッカ シャシンカ セイユウ ハイユウ ジョユウ ホンヤクカ ホンヤクシャ " +
  "シジン ヒョウロンカ リョウリケンキュウカ リョウリカ サッキョクカ サクシカ " +
  "キャクホンカ ベンゴシ マンガ ショウセツ ドウワ エホン シャシン キョウシ " +
  "ソウリョ ジツギョウカ ケイエイシャ ケンキュウシャ ヘンシュウシャ ラクゴカ " +
  "オンガクカ ケンチクカ ウラナイシ ビヨウカ チョジュツカ ブンピツカ ズイヒツカ " +
  "ケンキュウカ キョウイクシャ エイガカントク"
).split(" ");
