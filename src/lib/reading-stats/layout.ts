// How the reader arranged the statistics' cards (管理表 19, 刷新版 3節):
// in order, each one 2×2 (half the width, two to a row), 2×4 (the full
// width, low) or 最大 (the full width, the whole card). Long press moves a
// card, sizes it and takes it out; a half-width card taken out leaves an
// empty place (＋) beside its partner, where another card can be put. Kept
// with the account (reader_settings.stats_layout, けにーさん 10-28 11:36Z);
// null there is FIRST_LAYOUT.

/** Every card the app can show, by the key the arrangement keeps. */
export const STAT_CARDS = [
  "year",
  "chart",
  "days",
  "clock",
  "genre",
  "pace",
  "shelf",
  "joy",
  "met",
  "stack",
  "album",
  "shape",
] as const;
export type StatCard = (typeof STAT_CARDS)[number];

export const TILE_SIZES = ["half", "wide", "full"] as const;
/** 2×2, 2×4, 最大. */
export type TileSize = (typeof TILE_SIZES)[number];

/** A card in its place, or (card null, half the width) an empty place. */
export interface Tile {
  card: StatCard | null;
  size: TileSize;
}
export type StatsLayout = Tile[];

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

/** What the database takes (its check): at most this many places. */
export const LAYOUT_PLACES_MAX = 64;

const isCard = (value: unknown): value is StatCard =>
  STAT_CARDS.includes(value as StatCard);
const isSize = (value: unknown): value is TileSize =>
  TILE_SIZES.includes(value as TileSize);

/**
 * An arrangement as kept, made whole: a card this app does not know (from a
 * newer one) or met twice is left out, a place of no known size too. Null
 * for nothing kept, or nothing that is an arrangement: the first one shows.
 */
export function readLayout(value: unknown): StatsLayout | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<StatCard>();
  const tiles: Tile[] = [];
  for (const item of value.slice(0, LAYOUT_PLACES_MAX)) {
    if (typeof item !== "object" || item === null) continue;
    const { card, size } = item as Record<string, unknown>;
    if (!isSize(size)) continue;
    if (card === null) tiles.push({ card: null, size: "half" });
    else if (isCard(card) && !seen.has(card)) {
      seen.add(card);
      tiles.push({ card, size });
    }
  }
  return tidy(tiles);
}

/** The arrangement shown: the reader's, else the first. */
export const layoutOf = (kept: StatsLayout | null) => kept ?? FIRST_LAYOUT;

/**
 * Rows as the screen lays them: two half-width places side by side, any
 * other alone. Each place keeps its index in the arrangement.
 */
export function layoutRows(
  tiles: StatsLayout,
): { tile: Tile; index: number }[][] {
  const rows: { tile: Tile; index: number }[][] = [];
  tiles.forEach((tile, index) => {
    const last = rows[rows.length - 1];
    if (
      tile.size === "half" &&
      last?.length === 1 &&
      last[0].tile.size === "half"
    )
      last.push({ tile, index });
    else rows.push([{ tile, index }]);
  });
  return rows;
}

/**
 * Made whole after a change: a half-width card left alone in its row gets an
 * empty place beside it, and a row of empty places only goes (刷新版 3節
 * 「札が1枚もなく空きだけになった段は消して、下を詰めます」).
 */
export function tidy(tiles: StatsLayout): StatsLayout {
  const rows = layoutRows(tiles.map((tile) => ({ ...tile })));
  const out: Tile[] = [];
  for (const row of rows) {
    if (row.every(({ tile }) => tile.card === null)) continue;
    out.push(...row.map(({ tile }) => tile));
    if (row.length === 1 && row[0].tile.size === "half")
      out.push({ card: null, size: "half" });
  }
  return out.slice(0, LAYOUT_PLACES_MAX);
}

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

export const sameLayout = (a: StatsLayout | null, b: StatsLayout | null) =>
  JSON.stringify(a) === JSON.stringify(b);
