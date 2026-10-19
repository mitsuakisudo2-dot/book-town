// Ways volumes are written, with how they read (src/lib/search/volume.ts,
// src/lib/search/title.ts titleVolume, and the database's
// private.bib_title_volume, private.bib_volume_start and
// private.bib_volume_heard). The app and the database are checked against
// the same rows (tests/db-judging.test.ts), so they cannot read one title two
// ways (AUD-087). Rows marked 見本 are as the library and openBD wrote them
// (the shared folder's 書誌の見本, 2026-10-17).

/** A title as a reader or a source writes it: the title before its edition and volume, and the volume's mark ("" for none). */
export const TITLE_VOLUMES: Array<[text: string, rest: string, mark: string]> =
  [
    // 見本: openBD's titles, and the library's dcterms:title.
    ["One piece 巻1", "One piece", "1"],
    ["One piece. 巻1", "One piece", "1"],
    ["ノルウェイの森. 上", "ノルウェイの森", "上"],
    ["ノルウェイの森. 下", "ノルウェイの森", "下"],
    // Figures, after a space, a bracket or a kana or kanji.
    ["ONE PIECE 2", "ONE PIECE", "2"],
    ["ONE PIECE 12", "ONE PIECE", "12"],
    ["進撃の巨人 01", "進撃の巨人", "1"],
    ["進撃の巨人（２）", "進撃の巨人", "2"],
    ["進撃の巨人2", "進撃の巨人", "2"],
    ["ハリポタ1", "ハリポタ", "1"],
    ["ゴルゴ13", "ゴルゴ", "13"],
    ["ゴルゴ13 2", "ゴルゴ13", "2"],
    ["Война и мир 1", "Война и мир", "1"],
    ["소년이 온다 2", "소년이 온다", "2"],
    ["Facebook 2", "Facebook", "2"],
    // 巻・部・集・編 before or after the number, 第, and the Latin words.
    ["進撃の巨人 第1巻", "進撃の巨人", "1"],
    ["進撃の巨人 2巻", "進撃の巨人", "2"],
    ["進撃の巨人 二十三巻", "進撃の巨人", "23"],
    ["銀河英雄伝説 第十二巻", "銀河英雄伝説", "12"],
    ["ねじまき鳥クロニクル 第2部", "ねじまき鳥クロニクル", "2"],
    ["架空の詩 第3集", "架空の詩", "3"],
    ["1Q84 BOOK2", "1Q84", "2"],
    ["1Q84 BOOK 1", "1Q84", "1"],
    ["架空の物語 Vol.3", "架空の物語", "3"],
    ["架空の物語 vol 4", "架空の物語", "4"],
    ["架空の物語 Part II", "架空の物語", "2"],
    ["架空の物語 #5", "架空の物語", "5"],
    // Kanji and Roman numerals, after a space or a bracket.
    ["銀河英雄伝説 二", "銀河英雄伝説", "2"],
    ["Rocky IV", "Rocky", "4"],
    // 上・中・下, 前編・後編.
    ["罪と罰（下）", "罪と罰", "下"],
    ["罪と罰 上 (新潮文庫)", "罪と罰", "上"],
    ["罪と罰 上巻", "罪と罰", "上"],
    ["罪と罰上巻", "罪と罰", "上"],
    ["架空の物語 前編", "架空の物語", "上"],
    ["架空の物語後篇", "架空の物語", "下"],
    ["架空の物語 中編", "架空の物語", "中"],
    // No volume at the end.
    ["1Q84", "1Q84", ""],
    ["1984", "1984", ""],
    ["華氏451度", "華氏451度", ""],
    ["華氏451度 新訳版", "華氏451度", ""],
    ["あなたの人生の物語（ハヤカワ文庫SF）", "あなたの人生の物語", ""],
    ["天下", "天下", ""],
    ["世界の一部", "世界の一部", ""],
    ["天下一", "天下一", ""],
    ["Notebook2", "Notebook2", ""],
    ["Matrix", "Matrix", ""],
    ["MATRIX", "MATRIX", ""],
    ["架空の図書館 2026", "架空の図書館 2026", ""],
    ["架空の図書館 2026年版", "架空の図書館 2026年版", ""],
    ["罪と罰 上下巻", "罪と罰 上下巻", ""],
    [
      "ねじまき鳥クロニクル 第1部 泥棒かささぎ編",
      "ねじまき鳥クロニクル 第1部 泥棒かささぎ編",
      "",
    ],
    // A volume with nothing before it is the whole title.
    ["第2巻", "第2巻", ""],
    ["上", "上", ""],
  ];

/** A word that is a volume and nothing else, and its mark (null: not a volume). */
export const VOLUME_WORDS: Array<[word: string, mark: string | null]> = [
  ["上", "上"],
  ["下巻", "下"],
  ["後編", "下"],
  ["第2巻", "2"],
  ["巻1", "1"],
  ["2巻", "2"],
  ["十二巻", "12"],
  ["BOOK 3", "3"],
  ["vol.5", "5"],
  ["IV", "4"],
  ["2", "2"],
  ["2026", null],
  ["新装版", null],
  ["天下", null],
];

/** The master's volume as a source writes it, read from its start (the database only). */
export const VOLUME_FIELDS: Array<[volume: string, mark: string | null]> = [
  // 見本: the library's dcndl:volume.
  ["巻1", "1"],
  ["上", "上"],
  ["下", "下"],
  ["1", "1"],
  ["12", "12"],
  ["第2巻", "2"],
  ["第1部 泥棒かささぎ編", "1"],
  ["BOOK1 4月-6月", "1"],
  ["BOOK 2", "2"],
  ["上巻", "上"],
  ["前編", "上"],
  ["後篇", "下"],
  ["2 (完結)", "2"],
  ["IV", "4"],
  ["二", "2"],
  ["2000", null],
  ["別巻", null],
  ["1A", null],
  ["", null],
];

/** The library's reading of a volume (dcndl:transcription), when its volume reads as none (the database only). */
export const VOLUME_READINGS: Array<[reading: string, mark: string | null]> = [
  // 見本.
  ["1", "1"],
  ["ジョウ", "上"],
  ["ゲ", "下"],
  ["チュウ", "中"],
  ["ダイ2カン", "2"],
  ["ゼンペン", "上"],
  ["コウヘン", "下"],
  ["カン", null],
  ["", null],
];
