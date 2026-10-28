// 見る本: the kinds of book the statistics can be narrowed to, each a few
// of BookTown's 16 genres (private.genres). けにーさん 10-28「小説　漫画
// 実用書？とかで分けよう」; 教養 and エッセイと詩 were added by Claude, and
// the grouping can change (統計_工事向けのまとめ_刷新版 4節).

import { OTHER_GENRE } from "./sums";

export const BOOK_KINDS = [
  { kind: "小説", genres: ["日本の小説", "海外の小説"] },
  { kind: "マンガ", genres: ["マンガ"] },
  { kind: "エッセイと詩", genres: ["エッセイ", "詩と短歌と俳句"] },
  {
    kind: "教養",
    genres: [
      "哲学と宗教と心理",
      "歴史と地理",
      "科学と医学",
      "文学の評論と戯曲",
      "言葉",
    ],
  },
  {
    kind: "実用書",
    genres: ["社会とビジネスと教育", "技術と暮らし", "趣味とスポーツ"],
  },
  { kind: "絵本と写真", genres: ["絵本", "芸術と写真"] },
  { kind: OTHER_GENRE, genres: [OTHER_GENRE] },
] as const;

export type BookKind = (typeof BOOK_KINDS)[number]["kind"];

/** The kind a genre is of; a genre not known (or none) is そのほか. */
export function kindOf(genre: string | null): BookKind {
  return (
    BOOK_KINDS.find((entry) =>
      (entry.genres as readonly string[]).includes(genre ?? ""),
    )?.kind ?? OTHER_GENRE
  );
}
