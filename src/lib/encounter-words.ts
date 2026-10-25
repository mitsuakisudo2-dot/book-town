import type { Encounter } from "./library";
import { findReader } from "./social";
import type { TownState } from "./types";
import { counted, NAMES } from "./words";

/**
 * The words of the book page's 「この本との出会い」 (管理表9). Only that
 * section reads them, so they stay out of words.ts, which every page reads.
 */
export const ENCOUNTER_WORDS = {
  heading: "この本との出会い",
  eyebrow: "WHERE YOU MET",
  note: "あなただけに見える記録です。消しても、いいねや読みたいはそのまま残ります。",
  forget: "消す",
  forgotten: "出会いの記録を消しました",
  undo: "元に戻す",
  restored: "出会いの記録を戻しました",
  /** Under a POP or for a shop met: the way into the shop. */
  visit: (shop: string) => `「${shop}」をたずねる`,
  /** The memo of one encounter (押したときのメモ). */
  memoWrite: "メモを書く",
  memoEdit: "メモを直す",
  memoTitle: "出会いのメモ",
  memoLabel: "なぜ気になったか、ひとこと",
  memoNote: "あなただけに見えます。この本のページの「この本との出会い」で読み返せます。",
  memoSave: "残す",
  memoErase: "メモを消す",
  memoSaved: "メモを残しました",
  memoErased: "メモを消しました",
  memoTooLong: (max: number) => `${counted(max, "字")}までです`,
} as const;

const DID: Record<Encounter["kind"], string> = {
  like: "いいね",
  love: "私も好き！",
  want: "読みたくなった",
};

/**
 * Where and from whom, in one line: 「みどりさんの便りでいいね」.
 * `who` is the post's writer and `shop` the shop's name, when still known.
 */
export function encounterLine(
  c: Pick<Encounter, "kind" | "via">,
  { who, shop }: { who?: string; shop?: string },
): string {
  const did = DID[c.kind];
  switch (c.via) {
    case "post":
      return who
        ? `${who}さんの${NAMES.letter}で${did}`
        : `${NAMES.letter}で${did}`;
    case "pop":
      return shop ? `「${shop}」のPOPで${did}` : `${NAMES.shop}のPOPで${did}`;
    case "shop":
      return shop
        ? `「${shop}」で読みたいにした`
        : `${NAMES.shop}で読みたいにした`;
    case "book":
      return "本のページで読みたいにした";
  }
}

/** An encounter's line with the names the town knows now. */
export function encounterLineIn(state: TownState, c: Encounter): string {
  const post = c.postId ? state.posts.find((p) => p.id === c.postId) : undefined;
  const whoId = post?.authorId ?? c.otherReaderId;
  return encounterLine(c, {
    who: whoId ? findReader(state, whoId)?.name : undefined,
    shop: c.shopId
      ? state.shops.find((s) => s.id === c.shopId)?.name
      : undefined,
  });
}
