// The statistics' arrangement as the town keeps it (reader_settings.
// stats_layout, 管理表 19): read back made whole. Every page's town reads
// this when it loads, so it holds only that; how a long press changes the
// arrangement is layout.ts, which only the statistics read.

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
