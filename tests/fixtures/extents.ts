// How the library's size and pages (dcterms:extent) are read: the pages and
// the height in mm private.ndl_extent gives (tests/db-bibliography.test.ts).
// The ways they are written are the library's; the numbers are made up.

/** The words, and the pages and height they give (null: none). */
export const EXTENTS: Array<
  [extent: string, pages: number | null, heightMm: number | null]
> = [
  ["302p ; 15cm", 302, 150],
  ["207p ; 18cm", 207, 180],
  // Full-width, as some records have it.
  ["２０７ｐ ; １８ｃｍ", 207, 180],
  ["18cm", null, 180],
  ["1冊 ; 21cm", null, 210],
  ["2冊 ; 26-30cm", null, null],
  ["1冊 (頁付なし) ; 19cm", null, 190],
  ["254 p. : ill. ; 21 cm.", 254, 210],
  ["312 pages : illustrations ; 24 cm", 312, 240],
  ["xxii, 418 p. : ill., ports. ; 23 cm.", 418, 230],
  ["12, 18, 302p ; 22cm", 302, 220],
  ["160p 図版12枚 ; 19cm", 160, 190],
  ["96p ; 19×26cm", 96, 190],
  ["1冊 ; 15 × 21 cm", null, 150],
  ["xiii, 300 p. col. illus. 24 cm.", 300, 240],
  ["17.5cm", null, 175],
  ["126p ; 21cm + CD-ROM1枚 (12cm)", 126, 210],
  ["88p ; 26cm + 解答解説 (32p ; 26cm)", 88, 260],
  ["1 volume (unpaged) : colour illustrations ; 27 cm", null, 270],
  // p in a word is not pages.
  ["1 portfolio (12 plates) ; 45 cm", null, 450],
  ["0×0mm", null, null],
  ["録音ディスク 1枚 : CD ; 12cm", null, 120],
  ["冊", null, null],
];
