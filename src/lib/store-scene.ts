import type { Book, BookDisplay, Shop } from "./types";

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
};
export type SceneKind =
  | "furniture"
  | "row"
  | "book"
  | "bookPop"
  | "ownerPop"
  | "sign"
  | "label"
  | "stamp";
export interface SceneObject {
  id: string;
  kind: SceneKind;
  parentId: string | null;
  rect: Rect;
  z: number;
  placed?: boolean;
  style?: { color?: string; material?: string; font?: string };
  text?: string;
  stamp?: string;
  furnitureType?: "shelf" | "table" | "stand";
  bookId?: string;
  display?: BookDisplay;
  order?: number;
  /** Book dimensions in canvas units, independent of furniture resizing. */
  preferredSize?: { w: number; h: number };
  bookHeight?: number;
  gap?: number;
  mode?: "face" | "spine" | "mixed";
  /** Optional chalkboard heading and line drawing for a row (shelf sign). */
  boardTitle?: string;
  doodle?: string;
  isPublic?: boolean;
  /** Compatibility identity; never changed when a placement is moved. */
  source?: { shopId: string; shelfId: string; itemId: string };
  /** The part this object plays in a shelf preset: "case", "tier-0"..,
   * "table", "table-tier". Older objects have none; legacySlot (shop-layout)
   * reads it from their ID. */
  slot?: string;
  /** The owner's own notes. Never published: stripOwnerData drops them. */
  own?: { savedPopId?: string; copiedAt?: string; note?: string };
  // Reserved for later releases: not drawn or edited yet, only checked
  // when present.
  layer?: "furniture" | "books" | "decor" | "pop" | "foreground";
  textStyle?: {
    font?: string;
    color?: string;
    size?: number;
    align?: "start" | "center" | "end";
    vertical?: boolean;
  };
  /** A poster shown on a shelf is referenced, never copied. */
  posterRef?: { posterId: string };
}
export interface StoreTheme {
  id: string;
  light: string;
  wood: string;
  paper: string;
  font: string;
}
export interface StoreScene {
  schemaVersion: 1;
  storeId: string;
  /** A managed scene is the source of truth for the immersive store only. */
  ownerManaged?: boolean;
  templateId?: string;
  theme: StoreTheme;
  background: {
    kind: "preset" | "uploaded";
    url?: string;
    blur: number;
    darkness: number;
  };
  forbidden: Rect[];
  objects: SceneObject[];
  /** Headings of one published shelf (shop-layout). Older readers ignore them.
   * shelfIndex counts public shelves only, so a private shelf leaves no gap. */
  shelfId?: string;
  shelfIndex?: number;
  shelfTitle?: string;
  shelfIntro?: string;
}
export type BookPlacement = SceneObject & {
  kind: "book";
  bookId: string;
  display: BookDisplay;
  order: number;
  preferredSize: { w: number; h: number };
};
export interface StoreTemplate {
  id: string;
  name: string;
  theme: StoreTheme;
  forbidden: Rect[];
  objects: SceneObject[];
}
export const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
): Rect => ({ x, y, w, h, rotation });
export const SHELF_DOODLES = [
  "travel",
  "daily",
  "forest",
  "stars",
  "garden",
  "city",
  "lamp",
] as const;
/** Face-out proportions vary per book; the same book always keeps its shape. */
export const FACE_ASPECTS = [0.72, 0.66, 0.74, 0.69];
/** One physical size rule shared by placing, restyling and display changes. */
export function placementWidth(book: Book, display: BookDisplay, h: number) {
  return (
    ((h * 16) / 9) *
    (display === "face"
      ? FACE_ASPECTS[Math.abs(book.pattern) % FACE_ASPECTS.length]
      : Math.max(0.135, book.thickness / 210))
  );
}
export function placementSize(
  book: Book,
  display: BookDisplay,
  bookHeight = 0.115,
) {
  const h =
    bookHeight *
    Math.min(1.06, Math.max(0.93, 0.4 + (0.6 * book.height) / 190));
  return { w: placementWidth(book, display, h), h };
}
/** Spines stand shoulder to shoulder; the row gap separates face-outs. */
export const SPINE_GAP = 0.0012;
export const objectById = (scene: StoreScene, id: string) =>
  scene.objects.find((o) => o.id === id);
export const bookPop = (scene: StoreScene, id: string) =>
  scene.objects.find((o) => o.kind === "bookPop" && o.parentId === id);
export const unplacedBooks = (scene: StoreScene) =>
  scene.objects.filter((o) => o.kind === "book" && o.parentId === null);
/** Only the town's own theme pictures stand behind a shop. A scene saved from
 * elsewhere could name any address, and every passer-by's browser would fetch it. */
export const safeBackgroundUrl = (url: string | undefined) =>
  url && /^\/themes\/[\w-]+\/[\w.-]+$/.test(url) && !url.includes("..")
    ? url
    : undefined;
/** Keeps only what can be reached from a root (no parentId, or null). An object
 * whose parent is missing, empty, a number or part of a loop goes, with all it
 * holds, so broken data can never hang a private book on nothing. The rule the
 * database's private.reachable is to follow. */
export function reachableOnly(scene: StoreScene): StoreScene {
  const objects = (Array.isArray(scene.objects) ? scene.objects : []).filter(
    (o) =>
      typeof o === "object" &&
      o !== null &&
      !Array.isArray(o) &&
      typeof o.id === "string",
  );
  const kept = new Set(
    objects
      .filter((o) => o.parentId === null || o.parentId === undefined)
      .map((o) => o.id),
  );
  let added = true;
  while (added) {
    added = false;
    for (const o of objects)
      if (
        !kept.has(o.id) &&
        typeof o.parentId === "string" &&
        kept.has(o.parentId)
      ) {
        kept.add(o.id);
        added = true;
      }
  }
  return { ...scene, objects: objects.filter((o) => kept.has(o.id)) };
}
export function furnitureBooks(scene: StoreScene, furnitureId: string) {
  return scene.objects
    .filter((o) => o.kind === "row" && o.parentId === furnitureId)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .flatMap((row) =>
      scene.objects
        .filter((o) => o.kind === "book" && o.parentId === row.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    );
}

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function localMatrix(r: Rect, aspect = 9 / 16): Matrix {
  // Each parent has its own physical aspect ratio; nested angles match CSS.
  const a = (r.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [
    r.w * c,
    r.w * s * aspect,
    (-r.h * s) / aspect,
    r.h * c,
    r.x + r.w / 2 - (r.w * c) / 2 + (r.h * s) / (2 * aspect),
    r.y + r.h / 2 - (r.w * s * aspect) / 2 - (r.h * c) / 2,
  ];
}
export function worldPolygon(
  scene: StoreScene,
  object: SceneObject,
): Point[] | null {
  const path: SceneObject[] = [],
    seen = new Set<string>();
  let current: SceneObject | undefined = object;
  while (current) {
    if (
      seen.has(current.id) ||
      current.placed === false ||
      (current.kind === "book" && !current.parentId)
    )
      return null;
    seen.add(current.id);
    path.unshift(current);
    if (!current.parentId) break;
    current = objectById(scene, current.parentId);
    if (!current) return null;
  }
  const m = path.reduce(
    (matrix, entry) =>
      multiply(
        matrix,
        localMatrix(
          entry.rect,
          Math.hypot((matrix[0] * 9) / 16, matrix[1]) /
            Math.hypot((matrix[2] * 9) / 16, matrix[3]),
        ),
      ),
    identity,
  );
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ].map((p) => ({
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  }));
}
export function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return rect(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
}
function overlaps(a: Point[], b: Point[]) {
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length],
        axis = { x: -(q.y - p.y), y: q.x - p.x };
      const aa = a.map((v) => v.x * axis.x + v.y * axis.y),
        bb = b.map((v) => v.x * axis.x + v.y * axis.y);
      if (
        Math.max(...aa) <= Math.min(...bb) + 1e-9 ||
        Math.max(...bb) <= Math.min(...aa) + 1e-9
      )
        return false;
    }
  return true;
}
function contains(polygon: Point[], point: Point) {
  const crosses = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return (q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x);
  });
  return crosses.every((c) => c >= -1e-8) || crosses.every((c) => c <= 1e-8);
}
export function validateScene(
  scene: StoreScene,
  bookIds?: Set<string>,
): string[] {
  const errors: string[] = [];
  if (
    !scene ||
    scene.schemaVersion !== 1 ||
    typeof scene.storeId !== "string" ||
    !scene.storeId ||
    !Array.isArray(scene.objects) ||
    !Array.isArray(scene.forbidden) ||
    !scene.theme ||
    !scene.background
  )
    return ["invalid scene envelope"];
  if (
    scene.ownerManaged !== undefined &&
    typeof scene.ownerManaged !== "boolean"
  )
    errors.push("invalid managed state");
  if (scene.templateId !== undefined && typeof scene.templateId !== "string")
    errors.push("invalid template");
  const validRect = (r: Rect) =>
    r &&
    [r.x, r.y, r.w, r.h, r.rotation].every(Number.isFinite) &&
    r.w > 0 &&
    r.h > 0;
  if (
    !scene.forbidden.every(validRect) ||
    !scene.objects.every(
      (o) =>
        o &&
        typeof o.id === "string" &&
        validRect(o.rect) &&
        Number.isFinite(o.z),
    )
  )
    return ["invalid object geometry"];
  const ids = new Set<string>();
  const kinds: SceneKind[] = [
    "furniture",
    "row",
    "book",
    "bookPop",
    "ownerPop",
    "sign",
    "label",
    "stamp",
  ];
  for (const o of scene.objects) {
    if (!o || typeof o.id !== "string" || ids.has(o.id)) {
      errors.push("duplicate or invalid ID");
      continue;
    }
    ids.add(o.id);
    if (o.isPublic !== undefined && typeof o.isPublic !== "boolean")
      errors.push(o.id + ": invalid visibility");
    if (o.placed !== undefined && typeof o.placed !== "boolean")
      errors.push(o.id + ": invalid placement visibility");
    if (o.text !== undefined && typeof o.text !== "string")
      errors.push(o.id + ": invalid text");
    if (
      (o.boardTitle !== undefined &&
        (typeof o.boardTitle !== "string" || o.boardTitle.length > 24)) ||
      (o.doodle !== undefined &&
        !(SHELF_DOODLES as readonly string[]).includes(o.doodle))
    )
      errors.push(o.id + ": invalid board");
    if (!kinds.includes(o.kind)) {
      errors.push(o.id + ": invalid kind");
      continue;
    }
    const parent = o.parentId ? objectById(scene, o.parentId) : undefined;
    if (o.parentId !== null && typeof o.parentId !== "string")
      errors.push(o.id + ": invalid parent");
    if (o.parentId && !parent) errors.push(o.id + ": missing parent");
    if (o.kind === "furniture" && o.parentId)
      errors.push(o.id + ": furniture must be root");
    if (o.kind === "row" && parent?.kind !== "furniture")
      errors.push(o.id + ": row needs furniture");
    if (o.kind === "book") {
      if (o.parentId && parent?.kind !== "row")
        errors.push(o.id + ": book needs row or unplaced");
      if (
        !o.bookId ||
        (bookIds && !bookIds.has(o.bookId)) ||
        !["face", "spine"].includes(o.display ?? "") ||
        !Number.isFinite(o.order) ||
        !o.preferredSize ||
        o.preferredSize.w <= 0 ||
        o.preferredSize.h <= 0 ||
        !Object.values(o.preferredSize).every(Number.isFinite)
      )
        errors.push(o.id + ": invalid book");
    }
    if (o.kind === "bookPop" && parent?.kind !== "book")
      errors.push(o.id + ": POP needs placement");
    const seen = new Set([o.id]);
    let p = parent;
    while (p) {
      if (seen.has(p.id)) {
        errors.push(o.id + ": cyclic parent");
        break;
      }
      seen.add(p.id);
      p = p.parentId ? objectById(scene, p.parentId) : undefined;
    }
    const polygon = worldPolygon(scene, o);
    if (!polygon) continue;
    if (
      polygon.some(
        (p) => p.x < -1e-8 || p.y < -1e-8 || p.x > 1 + 1e-8 || p.y > 1 + 1e-8,
      )
    )
      errors.push(o.id + ": outside canvas");
    if (
      o.kind !== "furniture" &&
      scene.forbidden.some((r) =>
        overlaps(polygon, [
          { x: r.x, y: r.y },
          { x: r.x + r.w, y: r.y },
          { x: r.x + r.w, y: r.y + r.h },
          { x: r.x, y: r.y + r.h },
        ]),
      )
    )
      errors.push(o.id + ": forbidden region");
    if ((o.kind === "book" || o.kind === "row") && parent) {
      const area = worldPolygon(scene, parent);
      if (area && polygon.some((p) => !contains(area, p)))
        errors.push(
          o.id + (o.kind === "row" ? ": outside furniture" : ": outside row"),
        );
    }
  }
  const books = scene.objects.filter((o) => o.kind === "book" && o.parentId);
  for (let i = 0; i < books.length; i++)
    for (let j = i + 1; j < books.length; j++)
      if (books[i].parentId === books[j].parentId) {
        const a = worldPolygon(scene, books[i]),
          b = worldPolygon(scene, books[j]);
        if (a && b && overlaps(a, b))
          errors.push(books[j].id + ": row over capacity");
      }
  return errors;
}
const clone = (scene: StoreScene): StoreScene => structuredClone(scene);
export function relayoutRow(scene: StoreScene, rowId: string): StoreScene {
  const next = clone(scene),
    row = objectById(next, rowId);
  if (row?.kind !== "row") throw new Error("Unknown row");
  const area = worldPolygon(next, row);
  if (!area) throw new Error("Invalid row parent");
  const bounds = {
      w:
        (Math.hypot(((area[1].x - area[0].x) * 9) / 16, area[1].y - area[0].y) *
          16) /
        9,
      h: Math.hypot(((area[3].x - area[0].x) * 9) / 16, area[3].y - area[0].y),
    },
    gap = row.gap ?? 0.004;
  let x = gap,
    previous: SceneObject | undefined;
  for (const book of next.objects
    .filter((o) => o.kind === "book" && o.parentId === rowId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const size = book.preferredSize!;
    const left =
      previous?.display === "spine" && book.display === "spine"
        ? x - gap + Math.min(gap, SPINE_GAP)
        : x;
    if (left + size.w > bounds.w + 1e-8 || size.h > bounds.h + 1e-8) {
      book.parentId = null;
      continue;
    }
    book.rect = rect(
      left / bounds.w,
      1 - size.h / bounds.h,
      size.w / bounds.w,
      size.h / bounds.h,
    );
    x = left + size.w + gap;
    previous = book;
  }
  return next;
}
export function addBookPlacement(
  scene: StoreScene,
  book: Book,
  rowId: string | null,
  id: string,
  display: BookDisplay,
  order = 0,
): StoreScene {
  if (objectById(scene, id)) throw new Error("Duplicate placement");
  const row = rowId ? objectById(scene, rowId) : undefined;
  if (rowId && row?.kind !== "row") throw new Error("Unknown row");
  const { w, h } = placementSize(book, display, row?.bookHeight);
  const next = clone(scene);
  next.objects.push({
    id,
    kind: "book",
    parentId: rowId,
    rect: rect(0, 0, w, h),
    z: 3,
    bookId: book.id,
    display,
    order,
    preferredSize: { w, h },
  });
  return rowId ? relayoutRow(next, rowId) : next;
}
export function setBookPop(
  scene: StoreScene,
  placementId: string,
  text: string,
): StoreScene {
  const placement = objectById(scene, placementId);
  if (placement?.kind !== "book") throw new Error("Unknown placement");
  const next = clone(scene),
    pop = bookPop(next, placementId);
  if (pop) pop.text = text;
  else
    next.objects.push({
      id: "pop:" + placementId,
      kind: "bookPop",
      parentId: placementId,
      rect: rect(0.025, 0.65, 0.95, 0.35),
      z: 5,
      text,
    });
  return next;
}
export function moveFurniture(
  scene: StoreScene,
  id: string,
  x: number,
  y: number,
  rotation?: number,
): StoreScene {
  const next = clone(scene),
    object = objectById(next, id);
  if (object?.kind !== "furniture") throw new Error("Unknown furniture");
  object.rect = {
    ...object.rect,
    x,
    y,
    rotation: rotation ?? object.rect.rotation,
  };
  return next;
}
export function resizeFurniture(
  scene: StoreScene,
  id: string,
  w: number,
  h: number,
): StoreScene {
  let next = clone(scene);
  const object = objectById(next, id);
  if (object?.kind !== "furniture" || w <= 0 || h <= 0)
    throw new Error("Invalid furniture size");
  object.rect = { ...object.rect, w, h };
  for (const row of next.objects.filter(
    (o) => o.kind === "row" && o.parentId === id,
  ))
    next = relayoutRow(next, row.id);
  return next;
}
export function deleteFurniture(scene: StoreScene, id: string): StoreScene {
  const next = clone(scene);
  if (objectById(next, id)?.kind !== "furniture")
    throw new Error("Unknown furniture");
  const rows = new Set(
    next.objects
      .filter((o) => o.kind === "row" && o.parentId === id)
      .map((o) => o.id),
  );
  for (const o of next.objects) {
    if (o.kind === "book" && o.parentId && rows.has(o.parentId))
      o.parentId = null;
    else if (o.parentId === id && o.kind !== "row") {
      o.parentId = null;
      o.placed = false;
    }
  }
  next.objects = next.objects.filter((o) => o.id !== id && !rows.has(o.id));
  return next;
}
export function placeBook(
  scene: StoreScene,
  id: string,
  rowId: string,
  order: number,
): StoreScene {
  const next = clone(scene),
    book = objectById(next, id);
  if (book?.kind !== "book" || objectById(next, rowId)?.kind !== "row")
    throw new Error("Invalid placement");
  const oldRow = book.parentId;
  book.parentId = rowId;
  book.order = order;
  return relayoutRow(
    oldRow && oldRow !== rowId ? relayoutRow(next, oldRow) : next,
    rowId,
  );
}
/** Data command for the future editor; mixed retains each book's display choice. */
export function setRowStyle(
  scene: StoreScene,
  rowId: string,
  patch: {
    mode?: "face" | "spine" | "mixed";
    bookHeight?: number;
    gap?: number;
  },
  books: Book[],
): StoreScene {
  const next = clone(scene),
    row = objectById(next, rowId);
  if (
    row?.kind !== "row" ||
    (patch.bookHeight !== undefined &&
      (!Number.isFinite(patch.bookHeight) || patch.bookHeight <= 0)) ||
    (patch.gap !== undefined && (!Number.isFinite(patch.gap) || patch.gap < 0))
  )
    throw new Error("Invalid row style");
  Object.assign(row, patch);
  for (const p of next.objects.filter(
    (o) => o.kind === "book" && o.parentId === rowId,
  )) {
    const book = books.find((b) => b.id === p.bookId);
    if (!book) throw new Error("Unknown Book");
    if (row.mode && row.mode !== "mixed") p.display = row.mode;
    p.preferredSize = placementSize(book, p.display!, row.bookHeight);
  }
  return relayoutRow(next, rowId);
}
export function sceneToJson(scene: StoreScene): string {
  const errors = validateScene(scene);
  if (errors.length) throw new Error(errors.join(", "));
  return JSON.stringify(scene);
}
export function sceneFromJson(raw: string): StoreScene {
  const scene = JSON.parse(raw) as StoreScene;
  const errors = validateScene(scene);
  if (errors.length) throw new Error(errors.join(", "));
  return scene;
}
export type LegacyShop = Shop;
