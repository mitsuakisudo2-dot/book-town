import { rect, type SceneObject } from "./store-scene";
import { SHELF_GUTTER, WALK_LAYOUT } from "./store-scene-adapter";
import type { ShelfId } from "./shop-layout";

// STORE_TEMPLATES (store-customization) set shape, colour, light and darkness
// together. With several shelves in one shop these come apart: each shelf has
// its preset (furniture and wood colour), the shop has one world (its light and
// how dark the room is). warm and study build the same rows today, so the wood
// colour is what tells their shelves apart.
// The values match STORE_TEMPLATES until those are replaced (a test keeps them so).

export const SHELF_PRESETS = [
  {
    id: "warm",
    name: "灯りの本屋",
    variant: 0,
    wood: "#6a371d",
    paper: "#f2dfb9",
    slots: ["case", "tier-0", "tier-1", "tier-2"],
  },
  {
    id: "study",
    name: "夜の書斎",
    variant: 1,
    wood: "#38271e",
    paper: "#e7dfcb",
    slots: ["case", "tier-0", "tier-1", "tier-2"],
  },
  {
    id: "window",
    name: "窓辺の選書",
    variant: 3,
    wood: "#93633c",
    paper: "#f8eaca",
    slots: ["case", "tier-0", "tier-1", "tier-2", "table", "table-tier"],
  },
] as const;
export type ShelfPresetId = (typeof SHELF_PRESETS)[number]["id"];

export const SHOP_WORLDS = [
  { id: "warm", light: "#ffd293", darkness: 0.04 },
  { id: "study", light: "#dfd9bd", darkness: 0.18 },
  { id: "window", light: "#ffe3af", darkness: 0 },
] as const;
export type ShopWorldId = (typeof SHOP_WORLDS)[number]["id"];

/** A preset's furniture and rows for one shelf, with IDs "<shelfId>/<slot>".
 * The geometry is woodScene's (store-scene-adapter), which stays as it is
 * because the screens draw with it; a test keeps the two the same. */
export function presetSkeleton(
  presetId: ShelfPresetId,
  shelfId: ShelfId,
): SceneObject[] {
  const preset = SHELF_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error("Unknown preset");
  const L = WALK_LAYOUT,
    caseId = shelfId + "/case";
  const parts: SceneObject[] = [
    {
      id: caseId,
      kind: "furniture",
      parentId: null,
      rect: { ...L.furniture },
      z: 1,
      furnitureType: "shelf",
      slot: "case",
    },
    ...L.tiers.map((t, i): SceneObject => ({
      id: shelfId + "/tier-" + i,
      kind: "row",
      parentId: caseId,
      rect: rect(SHELF_GUTTER, t.y, t.w, t.h),
      z: 2,
      bookHeight: t.bookHeight,
      gap: 0.012,
      mode: "mixed",
      isPublic: true,
      slot: "tier-" + i,
    })),
  ];
  if ((preset.slots as readonly string[]).includes("table"))
    parts.push(
      {
        id: shelfId + "/table",
        kind: "furniture",
        parentId: null,
        rect: { ...L.table },
        z: 3,
        furnitureType: "table",
        slot: "table",
      },
      {
        id: shelfId + "/table-tier",
        kind: "row",
        parentId: shelfId + "/table",
        rect: rect(0.05, 0, 0.9, 0.8),
        z: 3,
        text: "今日、手に取りたい本",
        bookHeight: 0.105,
        gap: 0.012,
        mode: "face",
        isPublic: true,
        slot: "table-tier",
      },
    );
  return parts;
}
