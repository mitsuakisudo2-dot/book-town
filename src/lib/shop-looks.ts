import { type StoreScene } from "./store-scene";

/**
 * 店内のテーマ（管理表 27、けにーさん 2026-10-27「いろんな店内があって欲しい」）.
 * A look is the room behind the shop and the parts its case is built from:
 * the top, a side post (drawn again, mirrored, for the right), one board
 * per tier and the foot. The case keeps its own shape (growing-shop decides
 * the tiers), so any number of tiers is built from the same four pictures.
 * Covers, POPs and words stay what they are in every look.
 *
 * The wood shop is the look the town began with; it is drawn by walk.css
 * and is not listed here. scene.theme.id names the look ("woodshop" for
 * the wood one), so a visitor sees the owner's look without a new column.
 */
export interface ShopLook {
  id: string;
  name: string;
  /** The room behind the shop, under /themes/<id>/. */
  room: string;
  darkness: number;
  parts: { top: string; post: string; board: string; bottom: string };
  /** Width over height of the top and the foot, drawn across the case. */
  topAspect: number;
  bottomAspect: number;
  /** How far the top and the foot reach past the case, in % of its width. */
  topOver: number;
  bottomOver: number;
  /** A post's width, in % of the case's. */
  postWidth: number;
  /** The paper and ink of the sign and the shelf tags, kept as data. */
  colours: {
    signPaper: string;
    signInk: string;
    signEdge: string;
    tagPaper: string;
    tagInk: string;
  };
}

export const WOOD_LOOK = "woodshop";
const THEMES = "/themes/";
const kit = (id: string, ext: string) => ({
  top: `${THEMES}${id}/top-v1.${ext}`,
  post: `${THEMES}${id}/post-v1.${ext}`,
  board: `${THEMES}${id}/board-v1.${ext}`,
  bottom: `${THEMES}${id}/bottom-v1.${ext}`,
});

export const SHOP_LOOKS: readonly ShopLook[] = [
  {
    id: "seaside",
    name: "海辺の朝",
    room: `${THEMES}seaside/room-v1.webp`,
    darkness: 0,
    parts: kit("seaside", "webp"),
    topAspect: 656 / 53,
    bottomAspect: 660 / 81,
    topOver: 1.5,
    bottomOver: 1.7,
    postWidth: 7.8,
    colours: {
      signPaper: "#f4f6f5",
      signInk: "#2f5f8f",
      signEdge: "#6f95bb",
      tagPaper: "#fbfaf6",
      tagInk: "#2f5f8f",
    },
  },
  {
    id: "white",
    name: "白と金属",
    room: `${THEMES}white/room-v1.webp`,
    darkness: 0,
    parts: kit("white", "svg"),
    topAspect: 600 / 10,
    bottomAspect: 600 / 30,
    topOver: 0.6,
    bottomOver: 0.6,
    postWidth: 2.2,
    colours: {
      signPaper: "#fdfdfc",
      signInk: "#1d1f22",
      signEdge: "#d6d3cc",
      tagPaper: "#ffffff",
      tagInk: "#3a3d42",
    },
  },
];

/** The look a scene wears, or undefined for the wood shop (and any look
 * this version does not know, which falls back to the wood one). */
export const shopLookOf = (scene: Pick<StoreScene, "theme">) =>
  SHOP_LOOKS.find((look) => look.id === scene.theme?.id);

/** The custom properties walk.css builds a look's case and sign from. */
export function lookStyle(look: ShopLook | undefined): Record<string, string> {
  if (!look) return {};
  const url = (src: string) => `url("${src}")`;
  return {
    "--look-top": url(look.parts.top),
    "--look-post": url(look.parts.post),
    "--look-board": url(look.parts.board),
    "--look-bottom": url(look.parts.bottom),
    "--look-top-aspect": String(look.topAspect),
    "--look-bottom-aspect": String(look.bottomAspect),
    "--look-top-over": look.topOver + "%",
    "--look-bottom-over": look.bottomOver + "%",
    "--look-post-width": look.postWidth + "%",
    "--look-sign-paper": look.colours.signPaper,
    "--look-sign-ink": look.colours.signInk,
    "--look-sign-edge": look.colours.signEdge,
    "--look-tag-paper": look.colours.tagPaper,
    "--look-tag-ink": look.colours.tagInk,
  };
}

/** The scene in `look`: only its theme and room change. Books, POPs, tiers,
 * words and what is public stay as they are. */
export function wearLook(scene: StoreScene, look: ShopLook): StoreScene {
  const next = structuredClone(scene);
  next.theme = { ...next.theme, id: look.id };
  next.background = {
    kind: "preset",
    url: look.room,
    blur: 0,
    darkness: look.darkness,
  };
  return next;
}

/** Keeps the look of `from` on `next`, a scene rebuilt from a wood template
 * (a template sets the case and its wood; the look stays the owner's). */
export function keepLook(next: StoreScene, from: StoreScene): StoreScene {
  const look = shopLookOf(from);
  return look ? wearLook(next, look) : next;
}
