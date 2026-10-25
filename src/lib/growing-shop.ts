import {
  bookPop,
  objectById,
  placementSize,
  rect,
  relayoutRow,
  type Rect,
  type SceneObject,
  type StoreScene,
} from "./store-scene";
import { bookById } from "./book-name";
import type { Book, Shelf, Shop } from "./types";

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

/** The case a reader's shop grows in. */
export const CASE_ID = "main-shelf";
/** The sizes an owner can choose: with the books, or so many tiers. */
export type ShopSize = "auto" | 1 | 2 | 3 | 4;
export const SHOP_SIZES: readonly ShopSize[] = ["auto", 1, 2, 3, 4];
/** A case goes back a tier only once it has this many books fewer than the
 * tier needs, so it does not grow and shrink at the boundary. */
const SHRINK_SLACK = 2;
/** The words of the growing shop, in the editor and in the toast. */
export const GROW = {
  size: "店の大きさ",
  auto: "本に合わせる",
  autoHint: "本が増えると、同じ棚の下へ段が増えます（4段まで）。",
  keptHint: (tiers: string) =>
    `本が増えても${tiers}のままです。入りきらない本は、表紙から背表紙に変えて並べ、それでも入らない本は「まだ並べていない本」で待ちます。`,
  oldCase:
    "いまの店は、前の形の棚です。大きさを選ぶと、本に合わせて育つ棚に変わります。並べた本とPOPはそのまま残ります。",
  pinned:
    "この段は、あなたが並べた形のまま残します。新しい本は、ほかの段に並びます。",
  unpin: "本に合わせて並べ直す",
  pinnedMark: "手を加えた段",
  chosen: (size: string) => `店の大きさを「${size}」にしました。`,
  grew: (tiers: string) => `店が少し広がりました（${tiers}）。`,
  keep: (tiers: string) => `${tiers}のままにする`,
} as const;
/** The drawing each tier's chalkboard starts with. */
export const DEFAULT_DOODLES = ["travel", "daily", "forest", "stars"];

/** The furniture rows, top to bottom. */
const rowsOf = (scene: StoreScene, furnitureId: string) =>
  scene.objects
    .filter((o) => o.kind === "row" && o.parentId === furnitureId)
    .sort((a, b) => a.rect.y - b.rect.y);

/** How many tiers a growing case has now (0 is the stand). */
export function tiersOf(scene: StoreScene, furnitureId = CASE_ID) {
  const furniture = objectById(scene, furnitureId);
  if (furniture?.furnitureType === "stand") return 0;
  return rowsOf(scene, furnitureId).length;
}

/**
 * The case reshaped to `tiers` tiers, keeping the rows it has in their order
 * and adding new ones below with the look of the first. Rows past `tiers`
 * go; books still on them wait for the owner. A tier the owner arranged keeps
 * its books; they change size only when the tier's height changes.
 */
function shapeCase(
  scene: StoreScene,
  tiers: number,
  books: Book[],
  rearranged: Set<string>,
): StoreScene {
  const next = structuredClone(scene);
  const furniture = objectById(next, CASE_ID);
  if (furniture?.kind !== "furniture") throw new Error("Unknown furniture");
  const rows = rowsOf(next, CASE_ID);
  const frame = growingFrame(tiers);
  const heightOf = (r: Rect, f: Rect) => r.h * f.h;
  const was = rows.map((row) => heightOf(row.rect, furniture.rect));
  const gone = new Set(rows.slice(frame.rows.length).map((r) => r.id));
  next.objects = next.objects.filter((o) => !gone.has(o.id));
  // Books still on a tier that goes wait for the owner, as if taken off.
  for (const p of next.objects)
    if (p.kind === "book" && p.parentId && gone.has(p.parentId)) {
      p.parentId = null;
      p.held = true;
    }
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
        parentId: CASE_ID,
        rect: shape.rect,
        z: model?.z ?? 2,
        gap: model?.gap ?? 0.012,
        mode: "mixed",
        isPublic: true,
      };
      // Rows of the case stay together, before the table's, in their order.
      const after = Math.max(
        next.objects.indexOf(furniture),
        ...next.objects.map((o, k) =>
          o.kind === "row" && o.parentId === CASE_ID ? k : -1,
        ),
      );
      next.objects.splice(after + 1, 0, row);
    }
    // The stand shows one cover; a tier mixes covers and spines.
    row.mode = frame.furnitureType === "stand" ? "face" : "mixed";
    row.rect = shape.rect;
    if (rearranged.has(row.id) || was[i] === undefined) {
      row.bookHeight = shape.bookHeight;
      return;
    }
    // An arranged tier of a new height: its books keep their share of it.
    const now = heightOf(shape.rect, frame.furniture);
    if (Math.abs(now - was[i]) < 1e-9) return;
    row.bookHeight = (row.bookHeight ?? shape.bookHeight) * (now / was[i]);
    for (const p of next.objects)
      if (p.kind === "book" && p.parentId === row.id) {
        const book = bookById(books, p.bookId);
        if (book)
          p.preferredSize = placementSize(book, p.display!, row.bookHeight);
      }
  });
  let out = next;
  for (const row of rowsOf(out, CASE_ID)) out = relayoutRow(out, row.id);
  return out;
}

/** Whether the owner arranged this tier: it keeps what they set out. A tier
 * kept from view is the owner's too. */
const arranged = (row: SceneObject) =>
  row.pinned === true || row.isPublic !== true;

/** The tiers a case wants for `count` books from `shelves` shelves. */
function tiersWanted(count: number, shelves: number) {
  if (count === 1) return 0;
  return Math.min(GROW_MAX_TIERS, Math.max(1, tiersFor(count), shelves));
}

/**
 * A growing case set out again around what its owner arranged. The tiers the
 * owner arranged keep their books as they are; every other tier is the
 * shop's to set out, and takes the books of the public shelves that are not
 * on an arranged tier, nor taken off by the owner (`held`), shelf by shelf as
 * a new shop would. With `growth: "auto"` the case takes the tiers its books
 * need, up to four, and goes back a tier only past the slack; with a number
 * it keeps that many, and what those cannot hold waits unplaced. `fresh`
 * leaves out the slack (the owner chose the size just now); `tiers` asks for
 * so many tiers whatever the growth. The same scene comes back equal.
 */
export function regrow(
  scene: StoreScene,
  shop: Shop,
  books: Book[],
  { fresh = false, tiers: asked }: { fresh?: boolean; tiers?: number } = {},
): StoreScene {
  if (scene.growth === undefined) return scene;
  let next = structuredClone(scene);
  if (objectById(next, CASE_ID)?.kind !== "furniture") return next;
  const size = next.growth;
  let rows = rowsOf(next, CASE_ID);
  // A size chosen below an arranged tier lets that tier go to the shop.
  if (typeof size === "number")
    rows.slice(size).forEach((row) => delete row.pinned);
  const kept = new Set(rows.filter(arranged).map((r) => r.id));
  const onCase = new Set(rows.map((r) => r.id));
  const shelves = shop.shelves.filter((s) => s.isPublic);
  const where = new Map<string, [number, number, Shelf]>();
  shelves.forEach((shelf, i) =>
    shelf.items.forEach((item, j) => where.set(item.id, [i, j, shelf])),
  );
  const rowIndex = (id: string | null) => rows.findIndex((r) => r.id === id);
  const placements = next.objects.filter((o) => o.kind === "book");
  const free = placements.filter((p) =>
    p.parentId
      ? onCase.has(p.parentId) && !kept.has(p.parentId)
      : !p.held &&
        p.isPublic !== false &&
        p.source !== undefined &&
        where.get(p.source.itemId)?.[2].id === p.source.shelfId,
  );
  const fromShelf = (p: SceneObject) =>
    p.source && where.get(p.source.itemId)?.[2].id === p.source.shelfId
      ? where.get(p.source.itemId)
      : undefined;
  // Books of the shelves in the shelves' order, then the owner's own picks
  // in the order they stood.
  const shelved = free.filter(fromShelf).sort((a, b) => {
    const [ai, aj] = fromShelf(a)!,
      [bi, bj] = fromShelf(b)!;
    return ai - bi || aj - bj;
  });
  const picked = free
    .filter((p) => !fromShelf(p))
    .sort(
      (a, b) =>
        rowIndex(a.parentId) - rowIndex(b.parentId) ||
        (a.order ?? 0) - (b.order ?? 0),
    );
  const groups = shelves
    .map((shelf) => shelved.filter((p) => fromShelf(p)![2] === shelf))
    .concat([picked])
    .filter((g) => g.length);
  const keptCount = placements.filter(
    (p) => p.parentId && kept.has(p.parentId),
  ).length;
  const count = keptCount + free.length;
  const lastKept = Math.max(
    -1,
    ...rows.map((r, i) => (kept.has(r.id) ? i : -1)),
  );
  let tiers: number;
  if (asked !== undefined) tiers = asked;
  else if (typeof size === "number") tiers = size;
  else {
    const now = tiersOf(next);
    const need = tiersWanted(count, groups.length);
    if (fresh || !rows.length || need >= now) tiers = need;
    else {
      const loose = tiersWanted(count + SHRINK_SLACK, groups.length);
      tiers = loose < now ? loose : now;
    }
    // Arranged tiers stay, and the books of the shelves get one of their own.
    tiers = Math.min(
      GROW_MAX_TIERS,
      Math.max(
        tiers,
        lastKept + 1,
        kept.size ? kept.size + (free.length ? 1 : 0) : 0,
      ),
    );
  }
  if (kept.size) tiers = Math.max(tiers, 1);
  for (const p of free) p.parentId = null;
  const rearranged = new Set(
    rows.filter((r) => !kept.has(r.id)).map((r) => r.id),
  );
  next = shapeCase(next, tiers, books, rearranged);
  rows = rowsOf(next, CASE_ID);
  const open = rows.filter((r) => !kept.has(r.id));
  if (!open.length) return next;
  const dealt = dealToTiers(groups, open.length);
  const stand = objectById(next, CASE_ID)!.furnitureType === "stand";
  open.forEach((row, n) => {
    const entries = dealt[n] ?? [];
    const first = entries[0] && fromShelf(entries[0]);
    const i = rows.indexOf(row);
    const r = objectById(next, row.id)!;
    // Only tiers with books carry a shelf name; a tier that continues the
    // shelf above shares its chalkboard (StoreCanvas).
    if (first && !stand) {
      const shelf = first[2];
      setField(r, "text", shelf.name);
      setField(r, "doodle", shelf.board?.doodle || DEFAULT_DOODLES[i]);
      setField(r, "boardTitle", shelf.board?.title);
    } else if (!entries.length || stand) {
      setField(r, "text", undefined);
      setField(r, "doodle", undefined);
      setField(r, "boardTitle", undefined);
    }
    next = setOutTier(
      next,
      row.id,
      entries.map((p) => {
        const at = fromShelf(p);
        const item = at && shelves[at[0]].items[at[1]];
        return {
          id: p.id,
          book: bookById(books, p.bookId)!,
          face: item ? item.display === "face" : p.display === "face",
          pop: Boolean(bookPop(next, p.id)?.text?.trim()),
        };
      }),
    );
  });
  return next;
}
/** Sets or clears a field only when it changes, so a scene that comes back
 * the same reads the same. */
function setField<K extends "text" | "doodle" | "boardTitle">(
  o: SceneObject,
  key: K,
  value: SceneObject[K],
) {
  if (value === undefined || value === "") {
    if (key in o) delete o[key];
  } else if (o[key] !== value) o[key] = value;
}

/** A row the owner arranged: the shop no longer sets it out (only a growing
 * case keeps the mark). */
export function pinRow(scene: StoreScene, rowId: string | null | undefined) {
  if (scene.growth === undefined || !rowId) return scene;
  const row = objectById(scene, rowId);
  if (row?.kind !== "row" || row.parentId !== CASE_ID || row.pinned)
    return scene;
  const next = structuredClone(scene);
  objectById(next, rowId)!.pinned = true;
  return next;
}
/** The tier given back to the shop to set out with its books. */
export function unpinRow(scene: StoreScene, rowId: string) {
  const next = structuredClone(scene);
  const row = objectById(next, rowId);
  if (row?.kind !== "row") throw new Error("Unknown row");
  delete row.pinned;
  // A tier kept from view goes back on view with it.
  row.isPublic = true;
  return next;
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
 * Sets one tier's books (placements already in the scene, off every row) out
 * on an empty row: a few books all by their covers
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
      const p = objectById(trial, e.id)!;
      p.parentId = rowId;
      p.display = covers.has(e.id) ? "face" : "spine";
      p.order = n;
      p.preferredSize = placementSize(e.book, p.display, height);
    });
    trial = relayoutRow(trial, rowId);
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
 * among them. `asked` deals to so many tiers instead; tiers left over stay
 * empty.
 */
export function dealToTiers<T>(groups: T[][], asked?: number): T[][] {
  const groupsWith = groups.filter((g) => g.length);
  const count = groupsWith.reduce((n, g) => n + g.length, 0);
  const tiers =
    asked ??
    Math.min(GROW_MAX_TIERS, Math.max(1, tiersFor(count), groupsWith.length));
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
  const dealt = groupsWith.flatMap((g, i) => evenly(g, shares[i]));
  while (dealt.length < tiers) dealt.push([]);
  return dealt;
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
