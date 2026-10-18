import type { Book, Shop } from "./types";
import { canonical } from "./canonical";
import {
  reachableOnly,
  safeBackgroundUrl,
  validateScene,
  type Rect,
  type SceneKind,
  type SceneObject,
  type StoreScene,
  type StoreTheme,
} from "./store-scene";
import { migrateShopScene, publicStoreScene } from "./store-customization";

// A shop's layout: what the whole shop shares (sign, greeting, stamp, the
// room), a few shelves of its own, and the books not yet put on any. Visitors
// see each public shelf as a v1 StoreScene, made by shelfScene and filtered by
// rules the database is to share (private.public_shelf_scene, next release),
// so a shelf published from here and one derived there will be the same.
// Nothing here is called by a screen yet.

export const LAYOUT_FORMAT = 2 as const;
/** How many shelves the editor offers for now. A provisional choice, not a
 * product limit (the data holds up to HARD_MAX_SHELVES); only the commands
 * look at it. */
export const MAX_SHELVES = 3;
/** The safety limit validateLayout keeps (and the database's layout_problem
 * is to keep). */
export const HARD_MAX_SHELVES = 20;
/** The shared objects and one shelf's, counted as jsonb text. The same as the
 * v1 scene's limit, so every v1 scene can become a first draft. */
export const SHELF_MAX_BYTES = 524_288;
export const LAYOUT_MAX_BYTES = 2_097_152;
export const MAIN_SHELF_ID = "shelf:main" as const;
/** The form published_shelves.id is to take in the database. */
export const SHELF_ID_PATTERN = /^shelf:[A-Za-z0-9_-]{1,64}$/;
export const V1_KINDS: readonly SceneKind[] = [
  "furniture",
  "row",
  "book",
  "bookPop",
  "ownerPop",
  "sign",
  "label",
  "stamp",
];
/** What visitors may see. Widen it only together with the database's list
 * (private.public_kinds(), next release). */
export const PUBLIC_KINDS: readonly string[] = V1_KINDS;

/** "shelf:main" for the shelf a v1 scene became; "shelf:" + uuid for new ones. */
export type ShelfId = `shelf:${string}`;

export interface ShopLayout {
  formatVersion: typeof LAYOUT_FORMAT;
  common: ShopCommon;
  /** 1..HARD_MAX_SHELVES, in the order visitors meet them. */
  shelves: ShelfDoc[];
  /** Books not on any shelf (parentId null) and their POPs. */
  unplaced: SceneObject[];
  /** Shelves put away: their frame and words, never their books. */
  retired?: RetiredShelf[];
}
export interface ShopCommon {
  worldId: string;
  /** wood and paper are the default for shelves without a look of their own. */
  theme: StoreTheme;
  background: StoreScene["background"];
  forbidden: Rect[];
  /** Roots are sign, ownerPop and stamp only. */
  objects: SceneObject[];
}
export interface ShelfDoc {
  id: ShelfId;
  /** An unknown preset still draws: the objects carry their own shape. */
  presetId: string;
  /** Required; only true shows the shelf to visitors. */
  isPublic: boolean;
  /** Up to 24 characters. */
  title?: string;
  /** Up to 500 characters. */
  intro?: string;
  /** #rrggbb colours. Only wood is drawn in this release. */
  look?: { wood?: string; paper?: string; material?: string };
  /** The owner's alone; never published. */
  own?: { snapshotId?: string };
  objects: SceneObject[];
}
export interface RetiredShelf {
  shelf: ShelfDoc;
  retiredAt: string;
}

/** The parts of a shop_private row used here. */
export interface LayoutSource {
  scene: StoreScene | null;
  baseLayout: ShopLayout | null;
  publishedLayout: ShopLayout | null;
}
export type LayoutCheck =
  | { ok: true }
  /** Written by a newer app: open it read-only. */
  | { ok: false; newer: true }
  | { ok: false; newer: false; errors: string[] };

const COMMON_ROOTS: readonly string[] = ["sign", "ownerPop", "stamp"];
const clone = <T>(value: T): T => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const objectsIn = (value: unknown) =>
  listOf(value).filter(
    (o): o is SceneObject => isRecord(o) && typeof o.id === "string",
  );
/** Length as the database counts it (char_length): code points, not UTF-16 units. */
const chars = (text: string) => [...text].length;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const isColor = (value: unknown) =>
  typeof value === "string" && COLOR.test(value);

function shelfOf(L: ShopLayout, shelfId: string): ShelfDoc {
  const shelf = L.shelves.find((s) => s.id === shelfId);
  if (!shelf) throw new Error("Unknown shelf");
  return shelf;
}

/** The slot of an object made before slots existed, read from its fixed ID. */
export function legacySlot(id: string): string | undefined {
  if (id === "main-shelf") return "case";
  if (id === "table") return "table";
  if (id === "table-row") return "table-tier";
  const row = /^row-(\d+)$/.exec(id);
  return row ? "tier-" + row[1] : undefined;
}
export const slotOf = (o: SceneObject): string | undefined =>
  o.slot ?? legacySlot(o.id);

/** Leaves out kinds not allowed, with everything standing on them. The rule
 * the database's private.drop_kinds is to follow. */
export function dropKinds(
  scene: StoreScene,
  allowed: readonly string[],
): StoreScene {
  const objects = objectsIn(scene.objects);
  const dropped = new Set(
    objects.filter((o) => !allowed.includes(o.kind)).map((o) => o.id),
  );
  let added = true;
  while (added) {
    added = false;
    for (const o of objects)
      if (
        !dropped.has(o.id) &&
        typeof o.parentId === "string" &&
        dropped.has(o.parentId)
      ) {
        dropped.add(o.id);
        added = true;
      }
  }
  return { ...scene, objects: objects.filter((o) => !dropped.has(o.id)) };
}

/** The owner's notes and the old shelf's identity stay with the owner. */
export function stripOwnerData(scene: StoreScene): StoreScene {
  return {
    ...scene,
    objects: scene.objects.map((o) => {
      const copy = { ...o };
      delete copy.own;
      delete copy.source;
      return copy;
    }),
  };
}

function compose(
  L: ShopLayout,
  shelf: ShelfDoc,
  storeId: string,
  unplaced: boolean,
): StoreScene {
  const look = isRecord(shelf.look) ? shelf.look : {};
  return clone({
    schemaVersion: 1,
    storeId,
    ownerManaged: true,
    templateId: shelf.presetId,
    shelfId: shelf.id,
    theme: {
      ...L.common.theme,
      ...(typeof look.wood === "string" ? { wood: look.wood } : {}),
      ...(typeof look.paper === "string" ? { paper: look.paper } : {}),
    },
    background: L.common.background,
    forbidden: L.common.forbidden,
    objects: [
      ...L.common.objects,
      ...shelf.objects,
      ...(unplaced ? L.unplaced : []),
    ],
  });
}

/** One shelf as a v1 scene, for the editor and the preview. With unplaced,
 * the shop's drawer of books comes too, so a command can take from it. */
export function shelfScene(
  L: ShopLayout,
  shelfId: ShelfId,
  storeId: string,
  options: { unplaced: boolean },
): StoreScene {
  return compose(L, shelfOf(L, shelfId), storeId, options.unplaced);
}

/** What visitors see of one shelf, or null while it is private. The headings
 * take the shape private.public_shelf_scene is to give them, so both agree. */
export function publicShelfScene(
  L: ShopLayout,
  shelf: ShelfDoc,
  storeId: string,
  position: number,
): StoreScene | null {
  if (shelf.isPublic !== true) return null;
  const scene = stripOwnerData(
    publicStoreScene(
      reachableOnly(dropKinds(compose(L, shelf, storeId, false), PUBLIC_KINDS)),
    ),
  );
  return {
    ...scene,
    shelfIndex: position,
    shelfTitle: shelf.title ?? "",
    shelfIntro: shelf.intro ?? "",
  };
}

/** The public shelves in order; a private shelf leaves no gap in shelfIndex. */
export function publicShelfScenes(
  L: ShopLayout,
  storeId: string,
): StoreScene[] {
  return L.shelves
    .filter((shelf) => shelf.isPublic === true)
    .map((shelf, position) => publicShelfScene(L, shelf, storeId, position)!);
}

/** Whether where an object stands keeps it from visitors: under a row not
 * marked public, under anything put away, or on a broken chain of parents. */
export function containerHides(scene: StoreScene, object: SceneObject) {
  const seen = new Set([object.id]);
  let parentId: unknown = object.parentId;
  while (parentId !== null && parentId !== undefined) {
    const parent =
      typeof parentId === "string"
        ? scene.objects.find((o) => o.id === parentId)
        : undefined;
    if (!parent || seen.has(parent.id)) return true;
    if (
      parent.placed === false ||
      (parent.kind === "row" && parent.isPublic !== true)
    )
      return true;
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return false;
}

/** The object at the top of o's chain, or undefined when the chain breaks. */
function rootIn(byId: Map<string, SceneObject>, o: SceneObject) {
  const seen = new Set([o.id]);
  let current = o;
  while (current.parentId !== null && current.parentId !== undefined) {
    const parent =
      typeof current.parentId === "string"
        ? byId.get(current.parentId)
        : undefined;
    if (!parent || seen.has(parent.id)) return undefined;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

type Box = "common" | "shelf" | "unplaced";
/** Where an object belongs: with the shop when its root is shared, in the
 * drawer when its root is an unplaced book, otherwise on the shelf. */
function boxOf(byId: Map<string, SceneObject>, o: SceneObject): Box {
  const root = rootIn(byId, o);
  if (root && COMMON_ROOTS.includes(root.kind)) return "common";
  if (root?.kind === "book") return "unplaced";
  return "shelf";
}

/** Puts one shelf's edited scene back into the layout. Shared objects return
 * to the shop, books taken off go to the drawer, the rest stays on the shelf.
 * A book that leaves a private row, or a private shelf, is marked private:
 * neither insertPlacement nor relayoutRow changes the mark, so without it the
 * book could later stand in a public row unasked. Only objects come back; the
 * frame (theme, background, forbidden) belongs to the shop and its presets.
 * Throws when a book or POP of the shelf, the shop or the drawer is missing or
 * now names another book or parent: no command of this release removes any. */
export function writeBackShelf(
  L: ShopLayout,
  shelfId: ShelfId,
  edited: StoreScene,
): ShopLayout {
  const shelf = shelfOf(L, shelfId);
  const before = compose(L, shelf, edited.storeId, true);
  const lost = lostKeys(keptKeys(before), edited);
  if (lost.length) throw new Error("Edit would lose " + lost.slice(0, 5));
  const elsewhere = new Set(
    [
      ...L.shelves.filter((s) => s.id !== shelfId).map((s) => s.objects),
      ...(L.retired ?? []).map((r) => r.shelf.objects),
    ].flatMap((objects) => objects.map((o) => o.id)),
  );
  const taken = edited.objects.find((o) => elsewhere.has(o.id));
  if (taken) throw new Error("ID already used: " + taken.id);
  const shared = new Set(L.common.objects.map((o) => o.id));
  const wasOnShelf = new Set(shelf.objects.map((o) => o.id));
  const beforeById = new Map(before.objects.map((o) => [o.id, o]));
  const editedById = new Map(edited.objects.map((o) => [o.id, o]));
  const boxes: Record<Box, SceneObject[]> = {
    common: [],
    shelf: [],
    unplaced: [],
  };
  for (const original of edited.objects) {
    const o = clone(original);
    const box = shared.has(o.id) ? "common" : boxOf(editedById, original);
    const old = beforeById.get(o.id);
    if (
      o.kind === "book" &&
      old &&
      wasOnShelf.has(o.id) &&
      old.parentId !== o.parentId &&
      (containerHides(before, old) || (!shelf.isPublic && box !== "shelf"))
    )
      o.isPublic = false;
    boxes[box].push(o);
  }
  const next = clone(L);
  next.common.objects = boxes.common;
  next.shelves.find((s) => s.id === shelfId)!.objects = boxes.shelf;
  next.unplaced = boxes.unplaced;
  return next;
}

/** A v1 scene as a layout of one public shelf, "shelf:main". Objects are kept
 * as they are, except that an empty parentId becomes null: the screens have
 * always read "" as no parent, and validateLayout refuses it. */
export function layoutFromScene(scene: StoreScene): ShopLayout {
  const objects = clone(scene.objects);
  for (const o of objects) if (o.parentId === "") o.parentId = null;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const boxes: Record<Box, SceneObject[]> = {
    common: [],
    shelf: [],
    unplaced: [],
  };
  for (const o of objects) boxes[boxOf(byId, o)].push(o);
  const preset = scene.templateId ?? "warm";
  return {
    formatVersion: LAYOUT_FORMAT,
    common: {
      worldId: preset,
      theme: clone(scene.theme),
      background: clone(scene.background),
      forbidden: clone(scene.forbidden),
      objects: boxes.common,
    },
    shelves: [
      {
        id: MAIN_SHELF_ID,
        presetId: preset,
        isPublic: true,
        look: { wood: scene.theme.wood, paper: scene.theme.paper },
        objects: boxes.shelf,
      },
    ],
    unplaced: boxes.unplaced,
  };
}

/** A shop known only by its old shelves; their private books stay private and unplaced. */
export function layoutFromLegacyShop(shop: Shop, books: Book[]): ShopLayout {
  return layoutFromScene(migrateShopScene(shop, books));
}

/** Another shop's published scene, read leniently: kinds this app does not
 * know are left out with what stands on them, instead of losing the scene. */
export function readableScene(
  value: unknown,
  storeId: string,
): StoreScene | null {
  if (!isRecord(value) || !Array.isArray(value.objects)) return null;
  try {
    const scene = dropKinds({ ...value, storeId } as StoreScene, V1_KINDS);
    return validateScene(scene).length ? null : scene;
  } catch {
    return null;
  }
}

/** The text the database's ->> gives a value: strings as they are, null as null. */
const textOf = (value: unknown) =>
  value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
const keyOf = (o: SceneObject) =>
  JSON.stringify([
    o.kind,
    textOf(o.id),
    textOf(o.kind === "book" ? o.bookId : o.parentId),
  ]);
function keptObjects(doc: unknown): SceneObject[] {
  if (!isRecord(doc)) return [];
  return [
    ...listOf(doc.objects),
    ...listOf(doc.shelves).flatMap((s) =>
      isRecord(s) ? listOf(s.objects) : [],
    ),
    ...listOf(doc.unplaced),
  ].filter(
    (o): o is SceneObject =>
      isRecord(o) && (o.kind === "book" || o.kind === "bookPop"),
  );
}

/** Each placement with its book, and each POP with its placement: the pairs
 * readers' reactions hang on, read from a v1 scene's objects or a layout's
 * shelves and drawer (the shop's shared part holds no books). The database's
 * private.kept_keys is to give the same set; SQL prints its arrays with
 * spaces, so compare after JSON.stringify(JSON.parse(key)). */
export function keptKeys(
  doc: ShopLayout | StoreScene | null | undefined,
): Set<string> {
  return new Set(keptObjects(doc).map(keyOf));
}

/** What a reader may have reacted to: the v1 scene and the published layout.
 * A placement only ever in a draft was never seen, so it is not protected. */
export function protectedKeys(
  source: Pick<LayoutSource, "scene" | "publishedLayout">,
): Set<string> {
  return new Set([
    ...keptKeys(source.scene),
    ...keptKeys(source.publishedLayout),
  ]);
}

export function lostKeys(
  protect: Set<string>,
  next: ShopLayout | StoreScene,
): string[] {
  const kept = keptKeys(next);
  return [...protect].filter((key) => !kept.has(key));
}

const layoutObjects = (L: ShopLayout | null) =>
  L
    ? [
        L.common.objects,
        ...L.shelves.map((s) => s.objects),
        L.unplaced,
        ...(L.retired ?? []).map((r) => r.shelf.objects),
      ]
    : [];

/** Brings back what a draft lost of the protected pairs, so it can be saved.
 * Lost placements return to the drawer, private; a lost POP returns to its
 * placement. A draft placement that took a protected ID for another book gets
 * a new ID first (its POP follows), so the reactions stay with their book. */
export function repairLost(
  draft: ShopLayout,
  source: LayoutSource,
  newId: () => string = () => "placement:" + crypto.randomUUID(),
): ShopLayout {
  const protect = protectedKeys(source);
  const next = clone(draft);
  const boxes = () => [
    next.common.objects,
    ...next.shelves.map((s) => s.objects),
    next.unplaced,
  ];
  const wanted = new Map<string, string | null>();
  for (const key of protect) {
    const [kind, id, ref] = JSON.parse(key) as [string, string, string | null];
    wanted.set(kind + "\n" + id, ref);
  }
  const conflicts = (o: SceneObject) => {
    const ref = wanted.get(o.kind + "\n" + o.id);
    return (
      ref !== undefined &&
      ref !== textOf(o.kind === "book" ? o.bookId : o.parentId)
    );
  };
  for (const box of boxes())
    for (const o of box)
      if (o.kind === "book" && conflicts(o)) {
        const old = o.id;
        o.id = newId();
        for (const child of box)
          if (child.parentId === old) child.parentId = o.id;
      }
  const used = new Set(boxes().flatMap((box) => box.map((o) => o.id)));
  for (const box of boxes())
    for (const o of box)
      if (o.kind === "bookPop" && conflicts(o)) {
        const old = o.id;
        const named = "pop:" + o.parentId;
        o.id = used.has(named) ? "pop:" + newId() : named;
        used.add(o.id);
        for (const child of box)
          if (child.parentId === old) child.parentId = o.id;
      }
  const lost = lostKeys(protect, next);
  const origin = [
    ...layoutObjects(source.publishedLayout).flat(),
    ...(source.scene?.objects ?? []),
  ];
  const fromOrigin = (key: string) => origin.find((o) => keyOf(o) === key);
  const restored = new Set<string>();
  for (const key of lost.filter((k) => JSON.parse(k)[0] === "book")) {
    const o = fromOrigin(key);
    if (!o) continue;
    next.unplaced.push({ ...clone(o), parentId: null, isPublic: false });
    restored.add(o.id);
  }
  // What still stands on a placement brought back moves to the drawer with it.
  for (const box of boxes().slice(0, -1))
    for (const o of box.filter(
      (o) => typeof o.parentId === "string" && restored.has(o.parentId),
    )) {
      box.splice(box.indexOf(o), 1);
      next.unplaced.push(o);
    }
  for (const key of lost.filter((k) => JSON.parse(k)[0] === "bookPop")) {
    const o = fromOrigin(key);
    if (!o) continue;
    const home =
      boxes().find((box) => box.some((p) => p.id === o.parentId)) ??
      next.unplaced;
    home.push(clone(o));
  }
  return next;
}

/** What the database's hide_published does to a layout (private.with_private):
 * the named shelves, rows and books are marked private, nothing else changes. */
function withPrivate(L: ShopLayout, ids: Set<string>): ShopLayout {
  const next = clone(L);
  const hide = (objects: SceneObject[]) => {
    for (const o of objects)
      if ((o.kind === "row" || o.kind === "book") && ids.has(o.id))
        o.isPublic = false;
  };
  for (const shelf of next.shelves) {
    if (ids.has(shelf.id)) shelf.isPublic = false;
    hide(shelf.objects);
  }
  hide(next.unplaced);
  return next;
}

/** "Back to the published version": the published layout, or before any
 * publishing the first draft. Fixed when saved, so a reused old shelf item ID
 * can never swap in another book. Before any publishing, visitors see the v1
 * scene, and hiding at once (hide_published) can only mark that scene, not the
 * first draft. So the rows and books the scene hides now are hidden in the
 * copy too: going back never shows again what the owner hid. It only hides. */
export function discardDraft(source: LayoutSource): ShopLayout | null {
  if (source.publishedLayout) return clone(source.publishedLayout);
  if (!source.baseLayout) return null;
  const hidden = objectsIn(source.scene?.objects).filter(
    (o) => (o.kind === "row" || o.kind === "book") && o.isPublic === false,
  );
  return withPrivate(source.baseLayout, new Set(hidden.map((o) => o.id)));
}

/** What visitors would see, as one string, to tell whether a draft has
 * unpublished changes. Give it public scenes only. A v1 scene counts as
 * "shelf:main", the first shelf, untitled; one saved before templates existed
 * was drawn as the warm one. The shop's ID and the owner's notes do not count,
 * nor isPublic: everything in a public scene is shown, so the mark adds
 * nothing (an old shelf's book has none, the same book moved over has true). */
export function publicFingerprint(scenes: StoreScene[]): string {
  return canonical(
    scenes.map((scene, i) => ({
      shelfId: scene.shelfId ?? MAIN_SHELF_ID,
      shelfIndex: scene.shelfIndex ?? i,
      shelfTitle: scene.shelfTitle ?? "",
      shelfIntro: scene.shelfIntro ?? "",
      templateId: scene.templateId ?? "warm",
      theme: scene.theme,
      background: scene.background,
      forbidden: scene.forbidden,
      objects: stripOwnerData(scene)
        .objects.map((o) => {
          delete o.isPublic;
          return o;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    })),
  );
}

/** Shelves, rows and books visitors still see in the published version but
 * the draft hides: what to warn about, or to hide at once. */
export function hiddenSincePublished(
  draftScenes: StoreScene[],
  publishedScenes: StoreScene[],
): string[] {
  const shown = (scenes: StoreScene[]) =>
    scenes.flatMap((scene) => [
      scene.shelfId ?? MAIN_SHELF_ID,
      ...scene.objects
        .filter((o) => o.kind === "row" || o.kind === "book")
        .map((o) => o.id),
    ]);
  const still = new Set(shown(draftScenes));
  return [...new Set(shown(publishedScenes))].filter((id) => !still.has(id));
}

/** The number PostgreSQL prints for a JSON number: never in exponent form. */
function numberText(n: number): string {
  const text = JSON.stringify(n);
  const e = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!e) return text;
  const [, sign, lead, fraction = "", power] = e;
  const exponent = Number(power);
  return exponent < 0
    ? sign + "0." + "0".repeat(-exponent - 1) + lead + fraction
    : sign + lead + fraction + "0".repeat(exponent - fraction.length);
}
function utf8Bytes(text: string) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
/** Bytes of the value as jsonb prints it (octet_length(x::jsonb::text)): a
 * space after each ":" and ",", numbers in full. Values JSON.stringify leaves
 * out are left out. The database is to keep the last word on every limit. */
export function jsonbTextBytes(value: unknown): number {
  const size = (v: unknown): number | undefined => {
    if (v === null) return 4;
    switch (typeof v) {
      case "string":
        return utf8Bytes(JSON.stringify(v));
      case "number":
        return numberText(v).length;
      case "boolean":
        return v ? 4 : 5;
      case "object": {
        if (Array.isArray(v)) {
          const items = Array.from(v, (item) => size(item) ?? 4);
          return (
            2 +
            items.reduce((a, b) => a + b, 0) +
            2 * Math.max(0, items.length - 1)
          );
        }
        const entries = Object.entries(v)
          .map(([key, item]) => [key, size(item)] as const)
          .filter(([, n]) => n !== undefined);
        return (
          2 +
          entries.reduce(
            (sum, [key, n]) => sum + utf8Bytes(JSON.stringify(key)) + 2 + n!,
            0,
          ) +
          2 * Math.max(0, entries.length - 1)
        );
      }
      default:
        return undefined;
    }
  };
  return size(value) ?? 0;
}

const UUID = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
/** Allowed text faces for the reserved textStyle: the scenes' serif and the posters' two. */
const TEXT_FONTS: readonly unknown[] = ["serif", "mincho", "gothic"];
const LAYERS: readonly unknown[] = [
  "furniture",
  "books",
  "decor",
  "pop",
  "foreground",
];

/** Text PostgreSQL's jsonb refuses (U+0000, half of a surrogate pair), which
 * would turn a save into a bare 400. Cutting a long text can leave half an emoji. */
function badText(value: unknown): string | null {
  const check = (text: string) => {
    if (text.includes("\u0000")) return "text with U+0000";
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        if ((text.charCodeAt(i + 1) & 0xfc00) !== 0xdc00)
          return "text with half a character";
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff)
        return "text with half a character";
    }
    return null;
  };
  if (typeof value === "string") return check(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = badText(item);
      if (problem) return problem;
    }
  } else if (isRecord(value))
    for (const [key, item] of Object.entries(value)) {
      const problem = check(key) ?? badText(item);
      if (problem) return problem;
    }
  return null;
}

function shelfProblems(shelf: unknown, label: string): string[] {
  if (!isRecord(shelf)) return [label + ": not a shelf"];
  const errors: string[] = [];
  const name = typeof shelf.id === "string" ? shelf.id : label;
  if (typeof shelf.id !== "string" || !SHELF_ID_PATTERN.test(shelf.id))
    errors.push(name + ": invalid shelf ID");
  if (typeof shelf.isPublic !== "boolean")
    errors.push(name + ": invalid visibility");
  if (
    typeof shelf.presetId !== "string" ||
    chars(shelf.presetId) < 1 ||
    chars(shelf.presetId) > 40
  )
    errors.push(name + ": invalid preset");
  if (!Array.isArray(shelf.objects)) errors.push(name + ": invalid objects");
  if (
    shelf.title !== undefined &&
    (typeof shelf.title !== "string" || chars(shelf.title) > 24)
  )
    errors.push(name + ": invalid title");
  if (
    shelf.intro !== undefined &&
    (typeof shelf.intro !== "string" || chars(shelf.intro) > 500)
  )
    errors.push(name + ": invalid intro");
  const look = shelf.look;
  if (
    look !== undefined &&
    (!isRecord(look) ||
      (look.wood !== undefined && !isColor(look.wood)) ||
      (look.paper !== undefined && !isColor(look.paper)) ||
      (look.material !== undefined && typeof look.material !== "string"))
  )
    errors.push(name + ": invalid look");
  if (
    shelf.own !== undefined &&
    (!isRecord(shelf.own) ||
      (shelf.own.snapshotId !== undefined &&
        typeof shelf.own.snapshotId !== "string"))
  )
    errors.push(name + ": invalid own data");
  return errors;
}

/** The reserved fields are not used yet; when present they must be well formed. */
function reservedProblem(o: Record<string, unknown>): string | null {
  const own = o.own,
    style = o.textStyle,
    poster = o.posterRef;
  if (o.slot !== undefined && typeof o.slot !== "string") return "invalid slot";
  if (
    own !== undefined &&
    (!isRecord(own) ||
      ["savedPopId", "copiedAt", "note"].some(
        (k) => own[k] !== undefined && typeof own[k] !== "string",
      ))
  )
    return "invalid own data";
  if (o.layer !== undefined && !LAYERS.includes(o.layer))
    return "invalid layer";
  if (
    style !== undefined &&
    (!isRecord(style) ||
      (style.font !== undefined && !TEXT_FONTS.includes(style.font)) ||
      (style.color !== undefined && !isColor(style.color)) ||
      (style.size !== undefined &&
        !(
          typeof style.size === "number" &&
          Number.isFinite(style.size) &&
          style.size > 0
        )) ||
      (style.align !== undefined &&
        !["start", "center", "end"].includes(style.align as string)) ||
      (style.vertical !== undefined && typeof style.vertical !== "boolean"))
  )
    return "invalid text style";
  if (
    poster !== undefined &&
    (!isRecord(poster) ||
      typeof poster.posterId !== "string" ||
      !UUID.test(poster.posterId))
  )
    return "invalid poster";
  return null;
}

/** Everything the editor must hold before saving. It refuses what the
 * database is to refuse (layout_problem) and, shelf by shelf, what
 * validateScene refuses in a v1 scene: geometry, rows over capacity, unknown
 * books. bookId is only looked up in bookIds when given, never matched
 * against a form. */
export function validateLayout(
  value: unknown,
  options: { bookIds?: Set<string> } = {},
): LayoutCheck {
  const fail = (errors: string[]): LayoutCheck => ({
    ok: false,
    newer: false,
    errors: [...new Set(errors)],
  });
  if (!isRecord(value)) return fail(["not a layout"]);
  if (
    typeof value.formatVersion === "number" &&
    value.formatVersion > LAYOUT_FORMAT
  )
    return { ok: false, newer: true };
  if (value.formatVersion !== LAYOUT_FORMAT) return fail(["format"]);
  const errors: string[] = [];
  const text = badText(value);
  if (text) errors.push(text);
  const common = value.common;
  if (
    !isRecord(common) ||
    typeof common.worldId !== "string" ||
    !isRecord(common.theme) ||
    !isRecord(common.background) ||
    !Array.isArray(common.forbidden) ||
    !Array.isArray(common.objects) ||
    !Array.isArray(value.shelves) ||
    !Array.isArray(value.unplaced) ||
    (value.retired !== undefined && !Array.isArray(value.retired))
  )
    return fail([...errors, "shape"]);
  const theme = common.theme,
    background = common.background;
  if (
    typeof theme.id !== "string" ||
    typeof theme.font !== "string" ||
    !isColor(theme.light) ||
    !isColor(theme.wood) ||
    !isColor(theme.paper)
  )
    errors.push("invalid theme");
  if (
    background.url !== undefined &&
    (typeof background.url !== "string" ||
      safeBackgroundUrl(background.url) !== background.url)
  )
    errors.push("invalid background");
  const shelves = value.shelves,
    retired = listOf(value.retired);
  if (shelves.length < 1 || shelves.length > HARD_MAX_SHELVES)
    errors.push("shelf count");
  const shapes = [
    ...shelves.flatMap((s, i) => shelfProblems(s, "shelf " + (i + 1))),
    ...retired.flatMap((r, i) =>
      isRecord(r) && typeof r.retiredAt === "string"
        ? shelfProblems(r.shelf, "retired " + (i + 1))
        : ["retired " + (i + 1) + ": invalid"],
    ),
  ];
  if (shapes.length) return fail([...errors, ...shapes]);
  const docs = shelves as unknown as ShelfDoc[],
    put = (retired as RetiredShelf[]).map((r) => r.shelf);
  const shelfIds = [...docs, ...put].map((s) => s.id);
  if (new Set(shelfIds).size !== shelfIds.length)
    errors.push("duplicate shelf");
  const boxes: {
    name: string;
    kind: "common" | "shelf" | "unplaced" | "retired";
    objects: unknown[];
  }[] = [
    { name: "common", kind: "common", objects: common.objects },
    ...docs.map((s) => ({
      name: s.id,
      kind: "shelf" as const,
      objects: s.objects,
    })),
    { name: "unplaced", kind: "unplaced", objects: value.unplaced },
    ...put.map((s) => ({
      name: "retired " + s.id,
      kind: "retired" as const,
      objects: s.objects,
    })),
  ];
  const seen = new Set<string>();
  let whole = true;
  for (const box of boxes) {
    const ids = new Set(objectsIn(box.objects).map((o) => o.id));
    for (const o of box.objects) {
      if (
        !isRecord(o) ||
        typeof o.id !== "string" ||
        chars(o.id) < 1 ||
        chars(o.id) > 200 ||
        typeof o.kind !== "string"
      ) {
        errors.push(box.name + ": invalid object");
        whole = false;
        continue;
      }
      const id = o.id;
      if (seen.has(id)) errors.push(id + ": duplicate ID");
      seen.add(id);
      if (!V1_KINDS.includes(o.kind as SceneKind))
        errors.push(id + ": unknown kind");
      // null, or an object in the same box: never "", a number, missing or elsewhere.
      if (o.parentId === null) {
        if (box.kind === "common" && !COMMON_ROOTS.includes(o.kind))
          errors.push(id + ": not shared by the whole shop");
        if (box.kind === "unplaced" && o.kind !== "book")
          errors.push(id + ": only books wait unplaced");
      } else if (typeof o.parentId !== "string" || !ids.has(o.parentId))
        errors.push(id + ": parent outside its place");
      if (box.kind === "retired" && (o.kind === "book" || o.kind === "bookPop"))
        errors.push(id + ": a retired shelf keeps no books");
      const reserved = reservedProblem(o);
      if (reserved) errors.push(id + ": " + reserved);
    }
  }
  if (!whole) return fail(errors);
  const L = value as unknown as ShopLayout;
  const base = jsonbTextBytes(L.common.objects);
  for (const shelf of docs) {
    if (base + jsonbTextBytes(shelf.objects) > SHELF_MAX_BYTES)
      errors.push(shelf.id + ": too large");
    try {
      errors.push(
        ...validateScene(compose(L, shelf, "layout", true), options.bookIds),
      );
    } catch {
      errors.push(shelf.id + ": unreadable");
    }
  }
  if (jsonbTextBytes(value) > LAYOUT_MAX_BYTES) errors.push("too large");
  return errors.length ? fail(errors) : { ok: true };
}
