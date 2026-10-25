import {
  addBookPlacement,
  objectById,
  placementSize,
  rect,
  relayoutRow,
  type Rect,
  type StoreScene,
} from "./store-scene";
import { bookById } from "./book-name";
import type { Book } from "./types";

// A reader's shop grows with its books (管理表 27・28, decided 2026-10-25 in
// /mnt/project-files/booktown/27-28_育つ書店の試作/決まったこと_2026-10-25.md):
// one book stands on a reading stand, two or more stand on one tier, and the
// same case grows down a tier at a time, up to four. The numbers here are the
// first ones to try ("細かいところはあとで"), not settled.

/** The most tiers one case grows to. */
export const GROW_MAX_TIERS = 4;
/** A tier takes about this many books before the case grows another. */
export const TIER_BOOKS = 10;
/** A tier with this many books or fewer shows all of them by their covers. */
export const ALL_COVERS = 4;
/** On a fuller tier, about this many books show their covers. */
export const TIER_COVERS = 3;

/** Where the case stands: under the sign, above the floor POP. */
const AREA = { x: 0.008, y: 0.185, w: 0.972, h: 0.6207 };
/** Rows start this far into a case, leaving room for the chalkboard. */
export const GROW_GUTTER = 0.2058;
const ROW_W = 0.72428;
/** Top rail and bottom edge, and the board under each tier (canvas units). */
const RAIL = 0.0105;
const BOARD = 0.024;
/** A tier's height while the case has three tiers or fewer, and with four. */
const TALL_ROW = 0.17;
const SHORT_ROW = 0.128;
/** How much of a tier a book's height takes. */
const BOOK_OF_ROW = 0.86;
/** Covers on a tier of a few books shrink to this much of the tier at most. */
const COVER_STEPS = [1, 0.93, 0.86, 0.8, 0.74];
const STAND = {
  furniture: rect(0.2, 0.27, 0.6, 0.47),
  row: rect(0.12, 0.04, 0.76, 0.72),
  bookHeight: 0.29,
};

/** The tiers a case needs for a number of books: 0 is the reading stand. */
export function tiersFor(books: number) {
  if (books === 1) return 0;
  return Math.min(GROW_MAX_TIERS, Math.max(1, Math.ceil(books / TIER_BOOKS)));
}

/** A case of `tiers` tiers (0 is the stand): the furniture and its rows. */
export function growingFrame(tiers: number): {
  furniture: Rect;
  furnitureType: "shelf" | "stand";
  rows: { rect: Rect; bookHeight: number }[];
} {
  if (tiers <= 0)
    return {
      furniture: { ...STAND.furniture },
      furnitureType: "stand",
      rows: [{ rect: { ...STAND.row }, bookHeight: STAND.bookHeight }],
    };
  const t = Math.min(GROW_MAX_TIERS, tiers);
  const rowH = t <= 3 ? TALL_ROW : SHORT_ROW;
  const h = 2 * RAIL + t * (rowH + BOARD);
  // A short case stands a little above the middle of the space it has.
  const y = AREA.y + Math.max(0, AREA.h - h) * 0.32;
  return {
    furniture: rect(AREA.x, y, AREA.w, h),
    furnitureType: "shelf",
    rows: Array.from({ length: t }, (_, i) => ({
      rect: rect(GROW_GUTTER, (RAIL + i * (rowH + BOARD)) / h, ROW_W, rowH / h),
      bookHeight: rowH * BOOK_OF_ROW,
    })),
  };
}

/** The furniture rows, top to bottom. */
const rowsOf = (scene: StoreScene, furnitureId: string) =>
  scene.objects
    .filter((o) => o.kind === "row" && o.parentId === furnitureId)
    .sort((a, b) => a.rect.y - b.rect.y);

/** How many tiers a growing case has now (0 is the stand). */
export function tiersOf(scene: StoreScene, furnitureId = "main-shelf") {
  const furniture = objectById(scene, furnitureId);
  if (furniture?.furnitureType === "stand") return 0;
  return rowsOf(scene, furnitureId).length;
}

/**
 * The case reshaped to `tiers` tiers, keeping every row it has and adding new
 * ones below with the look of the first. Books keep their order and their
 * face or spine; their size follows the new tiers. Only growing is asked of
 * it: a case never loses a row here, so no book is taken off a tier.
 */
export function growCase(
  scene: StoreScene,
  tiers: number,
  books: Book[],
  furnitureId = "main-shelf",
): StoreScene {
  const next = structuredClone(scene);
  const furniture = objectById(next, furnitureId);
  if (furniture?.kind !== "furniture") throw new Error("Unknown furniture");
  const rows = rowsOf(next, furnitureId);
  if (tiers < tiersOf(scene, furnitureId)) throw new Error("A case only grows");
  const frame = growingFrame(tiers);
  furniture.rect = frame.furniture;
  furniture.furnitureType = frame.furnitureType;
  const model = rows[0];
  frame.rows.forEach((shape, i) => {
    let row = rows[i];
    if (!row) {
      let id = "row-" + i;
      for (let n = 2; objectById(next, id); n++) id = "row-" + i + "-" + n;
      row = {
        id,
        kind: "row",
        parentId: furnitureId,
        rect: shape.rect,
        z: model?.z ?? 2,
        gap: model?.gap ?? 0.012,
        mode: "mixed",
        isPublic: model?.isPublic ?? true,
        ...(model?.text ? { text: model.text } : {}),
      };
      next.objects.push(row);
    }
    row.rect = shape.rect;
    row.bookHeight = shape.bookHeight;
    // The stand shows one cover; a tier mixes covers and spines.
    if (frame.furnitureType === "shelf" && row.mode === "face" && i === 0)
      row.mode = "mixed";
    if (frame.furnitureType === "stand") row.mode = "face";
    for (const p of next.objects)
      if (p.kind === "book" && p.parentId === row.id) {
        const book = bookById(books, p.bookId);
        if (book)
          p.preferredSize = placementSize(book, p.display!, shape.bookHeight);
      }
  });
  let out = next;
  for (const row of rowsOf(out, furnitureId)) out = relayoutRow(out, row.id);
  return out;
}

export interface TierEntry {
  /** The placement ID the book takes. */
  id: string;
  book: Book;
  /** The owner chose to show its cover. */
  face: boolean;
  /** It has POP words, so it is a good cover to show. */
  pop: boolean;
}

/**
 * Sets one tier's books out on an empty row: a few books all by their covers
 * (a little smaller if need be) and centred; a fuller tier with about three
 * covers, books with POP words first, and the rest by their spines. The
 * owner's own covers stay covers while they fit. What still does not fit
 * waits unplaced, as on any row. Returns the IDs set out, in order.
 */
export function setOutTier(
  scene: StoreScene,
  rowId: string,
  entries: TierEntry[],
): StoreScene {
  const row = objectById(scene, rowId);
  if (row?.kind !== "row") throw new Error("Unknown row");
  const base = row.bookHeight ?? 0.115;
  const few = entries.length <= ALL_COVERS;
  const picked = few
    ? entries
    : [
        ...entries.filter((e) => e.face),
        ...entries.filter((e) => !e.face && e.pop),
        ...entries.filter((e) => !e.face && !e.pop),
      ].slice(0, Math.max(TIER_COVERS, entries.filter((e) => e.face).length));
  const lay = (covers: Set<string>, height: number) => {
    let trial = structuredClone(scene);
    const shaped = objectById(trial, rowId)!;
    shaped.bookHeight = height;
    shaped.align = "center";
    // Covers first, the one with POP words last among them so its card
    // meets the spines; then the spines in the shelf's order.
    const faces = entries.filter((e) => covers.has(e.id));
    const lead = faces.find((e) => e.pop) ?? faces[0];
    const ordered = [
      ...faces.filter((e) => e !== lead),
      ...(lead ? [lead] : []),
      ...entries.filter((e) => !covers.has(e.id)),
    ];
    ordered.forEach((e, n) => {
      trial = addBookPlacement(
        trial,
        e.book,
        rowId,
        e.id,
        covers.has(e.id) ? "face" : "spine",
        n,
      );
    });
    const all = ordered.every((e) => objectById(trial, e.id)!.parentId);
    return { trial, all };
  };
  let covers = picked.map((e) => e.id);
  for (;;) {
    const set = new Set(covers);
    const steps = few && covers.length === entries.length ? COVER_STEPS : [1];
    for (const k of steps) {
      const { trial, all } = lay(set, base * k);
      if (all) return trial;
    }
    // One cover fewer, the last chosen first; with none left, what does not
    // fit waits unplaced.
    if (!covers.length) return lay(set, base).trial;
    covers = covers.slice(0, -1);
  }
}

/**
 * The books of a shop's shelves dealt to tiers. Each public shelf starts on a
 * tier of its own, up to four, so its chalkboard names only its books; a
 * shelf with many books takes more tiers, and its books are shared evenly
 * among them.
 */
export function dealToTiers<T>(groups: T[][]): T[][] {
  const groupsWith = groups.filter((g) => g.length);
  const count = groupsWith.reduce((n, g) => n + g.length, 0);
  const tiers = Math.min(
    GROW_MAX_TIERS,
    Math.max(1, tiersFor(count), groupsWith.length),
  );
  if (groupsWith.length > tiers || count <= 1)
    return evenly(groupsWith.flat(), tiers);
  const shares = groupsWith.map(() => 1);
  for (let left = tiers - groupsWith.length; left > 0; left--) {
    // The group with the most books per tier takes the next tier.
    let best = 0;
    groupsWith.forEach((g, i) => {
      if (g.length / shares[i] > groupsWith[best].length / shares[best])
        best = i;
    });
    if (groupsWith[best].length <= shares[best]) break;
    shares[best]++;
  }
  return groupsWith.flatMap((g, i) => evenly(g, shares[i]));
}
function evenly<T>(items: T[], tiers: number): T[][] {
  const out: T[][] = [];
  let k = 0;
  for (let t = 0; t < tiers; t++) {
    const take = Math.ceil((items.length - k) / (tiers - t));
    out.push(items.slice(k, k + take));
    k += take;
  }
  return out;
}
