// How the reader arranged the statistics' cards (管理表 19, 刷新版 3節):
// in order, each one 2×2 (half the width, two to a row), 2×4 (the full
// width, low) or 最大 (the full width, the whole card). Long press moves a
// card, sizes it and takes it out; a half-width card taken out leaves an
// empty place (＋) beside its partner, where another card can be put. Kept
// with the account (reader_settings.stats_layout, けにーさん 10-28 11:36Z);
// null there is FIRST_LAYOUT.

import {
  layoutRows,
  STAT_CARDS,
  tidy,
  type StatCard,
  type StatsLayout,
  type Tile,
  type TileSize,
} from "./kept-layout";

export * from "./kept-layout";

/** The first arrangement: the twelve けにーさん chose 10-28 09:05Z. */
export const FIRST_LAYOUT: StatsLayout = [
  { card: "year", size: "full" },
  { card: "chart", size: "full" },
  { card: "days", size: "half" },
  { card: "clock", size: "half" },
  { card: "genre", size: "half" },
  { card: "pace", size: "half" },
  { card: "shelf", size: "half" },
  { card: "joy", size: "half" },
  { card: "met", size: "half" },
  { card: "stack", size: "half" },
  { card: "album", size: "wide" },
  { card: "shape", size: "full" },
];

/** The arrangement shown: the reader's, else the first. */
export const layoutOf = (kept: StatsLayout | null) => kept ?? FIRST_LAYOUT;

/** Taken out (the − on a lifted card): a half-width one leaves its place empty. */
export function takeOut(tiles: StatsLayout, index: number): StatsLayout {
  const tile = tiles[index];
  if (!tile || tile.card === null) return tiles;
  return tidy(
    tile.size === "half"
      ? tiles.map((other, at) =>
          at === index ? { card: null, size: "half" } : other,
        )
      : tiles.filter((_, at) => at !== index),
  );
}

/** Its size changed; it keeps its place. */
export function resize(
  tiles: StatsLayout,
  index: number,
  size: TileSize,
): StatsLayout {
  const tile = tiles[index];
  if (!tile || tile.card === null || tile.size === size) return tiles;
  return tidy(
    tiles.map((other, at) => (at === index ? { ...other, size } : other)),
  );
}

/** A card put in an empty place (＋), half the width. */
export function putIn(
  tiles: StatsLayout,
  index: number,
  card: StatCard,
): StatsLayout {
  if (tiles[index]?.card !== null || tiles.some((tile) => tile.card === card))
    return tiles;
  return tidy(
    tiles.map((other, at) => (at === index ? { card, size: "half" } : other)),
  );
}

/** A card added from 「欄を足す」: at the end, half the width. */
export function addCard(tiles: StatsLayout, card: StatCard): StatsLayout {
  if (tiles.some((tile) => tile.card === card)) return tiles;
  const empty = tiles.findIndex((tile) => tile.card === null);
  if (empty >= 0) return putIn(tiles, empty, card);
  return tidy([...tiles, { card, size: "half" }]);
}

/**
 * Carried to `to` (an index of the arrangement as it is now), its size kept
 * (けにーさん「場所を変えた時サイズを変更させないで」). A half-width card
 * dropped on another half-width place trades places with it, an empty one
 * too. A full-width one goes before the row `to` is in, so a row of two
 * moves down whole (and back).
 */
export function move(
  tiles: StatsLayout,
  from: number,
  to: number,
): StatsLayout {
  const tile = tiles[from];
  if (!tile || tile.card === null || from === to || !tiles[to]) return tiles;
  if (tile.size === "half" && tiles[to].size === "half") {
    const next = [...tiles];
    next[from] = tiles[to];
    next[to] = tile;
    return tidy(next);
  }
  // Out of its place (a half-width one leaves it empty, so its partner
  // stays put), then in as a row of its own before the row `to` is in, or
  // after it when carried down.
  const rest =
    tile.size === "half"
      ? tiles.map((other, at) =>
          at === from ? { card: null, size: "half" as const } : other,
        )
      : tiles.filter((_, at) => at !== from);
  const target = tile.size !== "half" && to > from ? to - 1 : to;
  const row = layoutRows(rest).find((places) =>
    places.some(({ index }) => index === target),
  );
  if (!row) return tiles;
  const at = to > from ? row[row.length - 1].index + 1 : row[0].index;
  // A half-width one comes with an empty place, so the rows after keep theirs.
  const placed: Tile[] =
    tile.size === "half" ? [tile, { card: null, size: "half" }] : [tile];
  return tidy([...rest.slice(0, at), ...placed, ...rest.slice(at)]);
}

/** Cards this app shows that are not in the arrangement: what ＋ offers. */
export const cardsLeft = (tiles: StatsLayout): StatCard[] =>
  STAT_CARDS.filter((card) => !tiles.some((tile) => tile.card === card));
