import {
  popReactionKey,
  type Book,
  type Shop,
  type TownState,
  type BookDisplay,
  type PopReaction,
} from "./types";
import {
  addBookPlacement,
  bookPop,
  objectById,
  placementSize,
  placementWidth,
  SHELF_DOODLES,
  relayoutRow,
  setBookPop,
  validateScene,
  worldPolygon,
  type StoreScene,
  type SceneObject,
} from "./store-scene";
import { woodScene } from "./store-scene-adapter";
import {
  SHOP_SIZES,
  pinRow,
  regrow,
  tiersOf,
  type ShopSize,
} from "./growing-shop";
import { bookById } from "./book-name";
import {
  SCENE_BOARD_TITLE_MAX_LENGTH,
  SCENE_POP_MAX_LENGTH,
  SCENE_ROW_TEXT_MAX_LENGTH,
  SCENE_TEXT_MAX_LENGTH,
} from "./types";

export const STORE_TEMPLATES = [
  {
    id: "warm",
    name: "灯りの書店",
    description: "琥珀の灯りと、使い込んだ木の棚。",
    variant: 0,
    wood: "#6a371d",
    paper: "#f2dfb9",
    light: "#ffd293",
    darkness: 0.04,
  },
  {
    id: "study",
    name: "夜の書斎",
    description: "濃い木と、静かに並ぶ背表紙。",
    variant: 1,
    wood: "#38271e",
    paper: "#e7dfcb",
    light: "#dfd9bd",
    darkness: 0.18,
  },
  {
    id: "window",
    name: "窓辺の選書",
    description: "明るい木の棚と、今日の一冊を置く平台。",
    variant: 3,
    wood: "#93633c",
    paper: "#f8eaca",
    light: "#ffe3af",
    darkness: 0,
  },
] as const;
export type TemplateId = (typeof STORE_TEMPLATES)[number]["id"];
export interface SceneBackup {
  storeId: string;
  shop: Shop;
  migratedAt: string;
}
export const placementReactionKey = (scene: StoreScene, p: SceneObject) =>
  JSON.stringify(["scene", scene.storeId, p.id]);

/**
 * Old private items are kept unplaced and private. The old Shop is never
 * mutated. A scene the owner already manages keeps what they arranged
 * (template, rows, placements with their POPs, privacy and order) and
 * follows the shelves for the rest: see followShelves.
 */
export function migrateShopScene(
  shop: Shop,
  books: Book[],
  existing?: StoreScene,
): StoreScene {
  if (existing?.ownerManaged) return followShelves(existing, shop, books);
  let scene = structuredClone(existing ?? woodScene(shop, books, 0));
  scene.ownerManaged = true;
  scene.templateId ??= "warm";
  for (const shelf of shop.shelves)
    for (const item of shelf.items) {
      const id = "placement:" + shop.id + ":" + item.id;
      let p = objectById(scene, id);
      const book = bookById(books, item.bookId);
      if (!book) continue;
      if (!p) {
        scene = addBookPlacement(scene, book, null, id, item.display);
        scene = setBookPop(scene, id, item.pop);
        p = objectById(scene, id)!;
        p.source = { shopId: shop.id, shelfId: shelf.id, itemId: item.id };
      }
      p.isPublic = shelf.isPublic;
    }
  return scene;
}
/** Whether a placement still stands for a book on one of the shelves. */
const shelfKey = (itemId: string, bookId: string) =>
  JSON.stringify([itemId, bookId]);
/**
 * A managed scene follows the shelves (the shelf is where an owner puts a
 * book in the shop). A book taken off a shelf leaves the shop's rows and
 * waits unplaced with its POP and reactions, no longer tied to the shelf,
 * so the owner can still set it out by hand. A book put on a public shelf
 * goes after the books of its shelf, or on a row with no books yet, where
 * it fits; otherwise, and from a private shelf, it waits unplaced. A growing
 * case instead sets out again the tiers its owner did not arrange (regrow).
 * Nothing else the owner arranged changes, and a scene that already follows
 * its shelves comes back equal.
 */
function followShelves(
  existing: StoreScene,
  shop: Shop,
  books: Book[],
): StoreScene {
  let scene = structuredClone(existing);
  const onShelf = new Set(
    shop.shelves.flatMap((shelf) =>
      shelf.items.map((item) => shelfKey(item.id, item.bookId)),
    ),
  );
  const emptied = new Set<string>();
  for (const o of scene.objects)
    if (
      o.kind === "book" &&
      o.source &&
      !onShelf.has(shelfKey(o.source.itemId, o.bookId!))
    ) {
      if (o.parentId) emptied.add(o.parentId);
      o.parentId = null;
      delete o.source;
    }
  for (const rowId of emptied)
    if (objectById(scene, rowId)?.kind === "row")
      scene = relayoutRow(scene, rowId);
  const placedOn = (rowId: string) =>
    scene.objects.filter((o) => o.kind === "book" && o.parentId === rowId);
  /** Sets a placement out after the books of its shelf, if a row has room. */
  const setOut = (id: string, shelfId: string) => {
    const rows = scene.objects.filter((o) => o.kind === "row").map((o) => o.id);
    const ofShelf = rows.filter((rowId) =>
      placedOn(rowId).some((o) => o.source?.shelfId === shelfId),
    );
    const empty = rows.filter((rowId) => placedOn(rowId).length === 0);
    for (const rowId of [...ofShelf.reverse(), ...empty]) {
      const trial = insertPlacement(scene, id, rowId, Infinity);
      if (objectById(trial, id)!.parentId === rowId) {
        scene = trial;
        return;
      }
    }
  };
  for (const shelf of shop.shelves)
    for (const item of shelf.items) {
      const book = bookById(books, item.bookId);
      // Already in the scene, wherever the owner put it.
      if (
        !book ||
        scene.objects.some(
          (o) =>
            o.kind === "book" &&
            o.source?.itemId === item.id &&
            o.bookId === item.bookId,
        )
      )
        continue;
      // The same book waiting unplaced (taken off and put back) is used
      // again, with its POP and reactions.
      const waiting = scene.objects.find(
        (o) =>
          o.kind === "book" &&
          !o.source &&
          !o.parentId &&
          o.bookId === item.bookId,
      );
      let id: string;
      if (waiting) {
        id = waiting.id;
        // Put back on a shelf, it goes back in the shop.
        delete waiting.held;
        if (item.pop && !bookPop(scene, id)?.text)
          scene = setBookPop(scene, id, item.pop);
      } else {
        // A shelf gives a removed book's item id to the next book it takes
        // (counterId), so the plain id may already name an earlier book.
        const plain = "placement:" + shop.id + ":" + item.id;
        const taken = (id: string) =>
          objectById(scene, id) !== undefined ||
          objectById(scene, "pop:" + id) !== undefined;
        id = taken(plain) ? plain + ":" + item.bookId : plain;
        for (let n = 2; taken(id); n++)
          id = plain + ":" + item.bookId + ":" + n;
        scene = addBookPlacement(scene, book, null, id, item.display);
        scene = setBookPop(scene, id, item.pop);
      }
      const p = objectById(scene, id)!;
      p.source = { shopId: shop.id, shelfId: shelf.id, itemId: item.id };
      p.isPublic = shelf.isPublic;
      // A growing case sets its books out again below, all at once.
      if (shelf.isPublic && scene.growth === undefined) setOut(id, shelf.id);
    }
  return regrow(scene, shop, books);
}
/**
 * A decorated shop brought up to its shelves, to be saved: null when it
 * already shows them. `waiting` names the books put on a public shelf that
 * found no room in the rows.
 */
export function sceneForShelves(
  scene: StoreScene,
  shop: Shop,
  books: Book[],
): { scene: StoreScene; waiting: string[] } | null {
  if (!scene.ownerManaged) return null;
  const next = followShelves(scene, shop, books);
  if (JSON.stringify(next) === JSON.stringify(scene)) return null;
  const tied = (o: SceneObject) => JSON.stringify([o.id, o.source?.itemId]);
  const before = new Set(scene.objects.map(tied));
  const waiting = next.objects
    .filter(
      (o) =>
        o.kind === "book" &&
        o.source &&
        o.isPublic &&
        !o.parentId &&
        !before.has(tied(o)),
    )
    .map((o) => o.bookId!);
  return { scene: next, waiting };
}
export function importedPlacementReactions(
  scene: StoreScene,
  state: TownState,
) {
  const result: Record<string, PopReaction[]> = {};
  for (const p of scene.objects.filter((o) => o.kind === "book"))
    if (p.source) {
      const values =
        state.popReactions[
          popReactionKey(p.source.shopId, p.source.shelfId, p.source.itemId)
        ];
      if (values?.length) result[placementReactionKey(scene, p)] = [...values];
    }
  return result;
}
/** Only explicitly public, placed objects enter browsing and POP discovery. */
export function publicStoreScene(scene: StoreScene): StoreScene {
  const hidden = new Set(
    scene.objects
      .filter(
        (o) =>
          o.placed === false ||
          (o.kind === "row" && o.isPublic !== true) ||
          (o.kind === "book" && (o.isPublic === false || !o.parentId)),
      )
      .map((o) => o.id),
  );
  let added = true;
  while (added) {
    added = false;
    for (const o of scene.objects)
      if (o.parentId && hidden.has(o.parentId) && !hidden.has(o.id)) {
        hidden.add(o.id);
        added = true;
      }
  }
  return { ...scene, objects: scene.objects.filter((o) => !hidden.has(o.id)) };
}
export function hasPublicSceneBooks(scene: StoreScene, books: Book[]) {
  const ids = new Set(books.map((b) => b.id));
  return publicStoreScene(scene).objects.some(
    (o) => o.kind === "book" && ids.has(o.bookId!) && worldPolygon(scene, o),
  );
}
export function resolveStoreScene(
  shop: Shop,
  books: Book[],
  variant: number,
  overrides: StoreScene[],
): StoreScene {
  const saved = overrides.find((s) => s.storeId === shop.id);
  const candidate = saved ?? woodScene(shop, books, variant);
  return publicStoreScene(candidate);
}
/** Templates change furniture and palette. Book/POP IDs, rows and explicit privacy survive. */
export function applyStoreTemplate(
  scene: StoreScene,
  id: TemplateId,
  books: Book[],
): StoreScene {
  const template = STORE_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error("Unknown template");
  const oldRows = scene.objects.filter((o) => o.kind === "row");
  const emptyShop: Shop = {
    id: scene.storeId,
    ownerId: "",
    name: objectById(scene, "sign")?.text ?? "私の書店",
    tagline: objectById(scene, "greeting")?.text ?? "",
    description: "",
    theme: "sage",
    followers: 0,
    demo: false,
    shelves: [],
  };
  // A growing case keeps its tiers; an older one its full case.
  const base = woodScene(emptyShop, books, template.variant, {
    tiers: scene.growth === undefined ? "fixed" : tiersOf(scene),
  });
  if (scene.growth !== undefined) base.growth = scene.growth;
  base.ownerManaged = true;
  base.templateId = id;
  base.theme = {
    ...base.theme,
    wood: template.wood,
    paper: template.paper,
    light: template.light,
  };
  base.background.darkness = template.darkness;
  const rows = base.objects.filter((o) => o.kind === "row");
  rows.forEach((row, i) => {
    row.text = oldRows[i]?.text ?? row.text;
    row.isPublic = oldRows[i]?.isPublic ?? true;
    // Chalkboard copy belongs to the shelf, not to the furniture style.
    if (oldRows[i]?.boardTitle !== undefined)
      row.boardTitle = oldRows[i].boardTitle;
    if (oldRows[i]?.doodle !== undefined) row.doodle = oldRows[i].doodle;
    if (oldRows[i]?.pinned) row.pinned = true;
  });
  for (const kind of ["sign", "ownerPop", "stamp"] as const) {
    const original = scene.objects.find((o) => o.kind === kind),
      next = base.objects.find((o) => o.kind === kind);
    if (original && next) {
      next.text = original.text;
      next.stamp = original.stamp;
      next.style = original.style;
    }
  }
  // Books keep the size rule of the furniture they move onto, so a scene
  // saved before a size change still fits its new rows.
  const fit = (p: SceneObject, row: SceneObject) => {
    const book = bookById(books, p.bookId);
    if (book) p.preferredSize = placementSize(book, p.display!, row.bookHeight);
  };
  const last = (rowId: string, objects: SceneObject[]) =>
    Math.max(
      -1,
      ...objects
        .filter((o) => o.kind === "book" && o.parentId === rowId)
        .map((o) => o.order ?? 0),
    );
  // Each book stays on the row with the same number, in its order there, so
  // trying another template and coming back keeps the arrangement. A row the
  // new furniture lacks (the window table) joins the last row, after it.
  const joining: { p: SceneObject; from: number; order: number }[] = [];
  for (const original of scene.objects.filter((o) => o.kind === "book")) {
    const p = structuredClone(original);
    if (
      original.parentId &&
      objectById(scene, original.parentId)?.isPublic !== true
    )
      p.isPublic = false;
    const from = original.parentId
      ? oldRows.findIndex((r) => r.id === original.parentId)
      : -1;
    p.parentId = from >= 0 && from < rows.length ? rows[from].id : null;
    if (p.parentId) fit(p, rows[from]);
    else if (from >= rows.length) joining.push({ p, from, order: p.order! });
    base.objects.push(p);
    const pop = bookPop(scene, p.id);
    if (pop) base.objects.push(structuredClone(pop));
  }
  const end = rows[rows.length - 1];
  joining.sort((a, b) => a.from - b.from || a.order - b.order);
  for (const { p } of joining) {
    p.order = last(end.id, base.objects) + 1;
    p.parentId = end.id;
    fit(p, end);
  }
  // Rows fill one at a time. What a row cannot hold goes on to the next row
  // as public as it, and past the last one waits among the unplaced books.
  let next = base;
  rows.forEach((row, i) => {
    const meant = next.objects
      .filter((o) => o.kind === "book" && o.parentId === row.id)
      .map((o) => o.id);
    next = relayoutRow(next, row.id);
    const onward = rows.slice(i + 1).find((r) => r.isPublic === row.isPublic);
    for (const id of meant) {
      const p = objectById(next, id)!;
      if (p.parentId !== null || !onward) continue;
      p.order = last(onward.id, next.objects) + 1;
      p.parentId = onward.id;
      fit(p, onward);
    }
  });
  return next;
}
export function renameSceneObject(
  scene: StoreScene,
  id: string,
  text: string,
): StoreScene {
  const next = structuredClone(scene),
    o = objectById(next, id);
  if (!o || !["row", "label", "sign", "ownerPop"].includes(o.kind))
    throw new Error("Unknown label");
  o.text = text.slice(
    0,
    o.kind === "row" ? SCENE_ROW_TEXT_MAX_LENGTH : SCENE_TEXT_MAX_LENGTH,
  );
  // A tier the owner named is theirs, with its books.
  return o.kind === "row" ? pinRow(next, id) : next;
}
/** Chalkboard heading and drawing for one shelf row; empty title removes it. */
export function setRowBoard(
  scene: StoreScene,
  rowId: string,
  patch: { boardTitle?: string; doodle?: string },
): StoreScene {
  const next = structuredClone(scene),
    row = objectById(next, rowId);
  if (row?.kind !== "row") throw new Error("Unknown row");
  if (patch.boardTitle !== undefined) {
    const title = patch.boardTitle.slice(0, SCENE_BOARD_TITLE_MAX_LENGTH);
    if (title.trim()) row.boardTitle = title;
    else delete row.boardTitle;
  }
  if (patch.doodle === "") delete row.doodle;
  else if (patch.doodle !== undefined) {
    if (!(SHELF_DOODLES as readonly string[]).includes(patch.doodle))
      throw new Error("Unknown doodle");
    row.doodle = patch.doodle;
  }
  return pinRow(next, rowId);
}
/** The stamps a shop and a POP may carry, by name. */
export const STAMP_CHOICES = [
  { id: "plane", name: "飛行機" },
  { id: "coffee", name: "コーヒー" },
  { id: "leaf", name: "葉っぱ" },
] as const;
/** The drawings a tier's chalkboard may carry, by name. */
export const DOODLE_CHOICES = [
  { id: "travel", name: "旅" },
  { id: "daily", name: "日常" },
  { id: "forest", name: "森" },
  { id: "stars", name: "星" },
  { id: "garden", name: "庭" },
  { id: "city", name: "街" },
  { id: "lamp", name: "灯り" },
] as const;
export function changePlacement(
  scene: StoreScene,
  id: string,
  patch: {
    display?: BookDisplay;
    isPublic?: boolean;
    pop?: string;
    stamp?: string;
  },
  books: Book[],
): StoreScene {
  let next = structuredClone(scene);
  const p = objectById(next, id);
  if (p?.kind !== "book") throw new Error("Unknown placement");
  if (patch.isPublic !== undefined) p.isPublic = patch.isPublic;
  if (patch.display) {
    const book = bookById(books, p.bookId);
    if (!book) throw new Error("Unknown book");
    p.display = patch.display;
    p.preferredSize = {
      h: p.preferredSize!.h,
      w: placementWidth(book, patch.display, p.preferredSize!.h),
    };
    if (p.parentId) next = pinRow(relayoutRow(next, p.parentId), p.parentId);
  }
  if (patch.pop !== undefined)
    next = setBookPop(next, id, patch.pop.slice(0, SCENE_POP_MAX_LENGTH));
  if (patch.stamp !== undefined) {
    if (!["", "plane", "coffee", "leaf"].includes(patch.stamp))
      throw new Error("Unknown stamp");
    if (!bookPop(next, id)) next = setBookPop(next, id, "");
    bookPop(next, id)!.stamp = patch.stamp;
  }
  return next;
}
export function takePlacementOff(scene: StoreScene, id: string): StoreScene {
  const next = structuredClone(scene),
    p = objectById(next, id);
  if (p?.kind !== "book") throw new Error("Unknown placement");
  const old = p.parentId;
  p.parentId = null;
  // It waits until the owner sets it out again.
  p.held = true;
  return old ? pinRow(relayoutRow(next, old), old) : next;
}
export function insertPlacement(
  scene: StoreScene,
  id: string,
  rowId: string,
  index: number,
): StoreScene {
  let next = structuredClone(scene);
  const p = objectById(next, id),
    row = objectById(next, rowId);
  if (p?.kind !== "book" || row?.kind !== "row")
    throw new Error("Unknown placement or row");
  const old = p.parentId;
  const siblings = next.objects
    .filter((o) => o.kind === "book" && o.parentId === rowId && o.id !== id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  siblings.splice(Math.max(0, Math.min(siblings.length, index)), 0, p);
  p.parentId = rowId;
  delete p.held;
  siblings.forEach((o, i) => (o.order = i));
  if (old && old !== rowId) next = pinRow(relayoutRow(next, old), old);
  return pinRow(relayoutRow(next, rowId), rowId);
}
/**
 * A book carried to `index` among the other books of `rowId` (持ち上げて運ぶ,
 * and 動かす from its sheet), or null when there is no room for it. No book
 * is pushed off the shelves: when the tier is full, the books at its end
 * move into the place the carried book left, and failing that the carried
 * book stands as a spine.
 */
export function moveBook(
  scene: StoreScene,
  id: string,
  rowId: string,
  index: number,
  books: Book[],
): StoreScene | null {
  const placed = new Set(
    scene.objects
      .filter((o) => o.kind === "book" && (o.parentId || o.id === id))
      .map((o) => o.id),
  );
  const from = objectById(scene, id);
  if (from?.kind !== "book") throw new Error("Unknown placement");
  const left = from.parentId;
  const at = left
    ? scene.objects.filter(
        (o) =>
          o.kind === "book" &&
          o.parentId === left &&
          (o.order ?? 0) < (from.order ?? 0),
      ).length
    : 0;
  const lost = (s: StoreScene) =>
    s.objects
      .filter((o) => o.kind === "book" && placed.has(o.id) && !o.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tries = [scene];
  if (from.display === "face")
    tries.push(changePlacement(scene, id, { display: "spine" }, books));
  for (const start of tries) {
    let next = insertPlacement(start, id, rowId, index);
    if (!lost(next).length) return next;
    if (!left || left === rowId) continue;
    lost(next).forEach(
      (o, k) => (next = insertPlacement(next, o.id, left, at + k)),
    );
    if (!lost(next).length) return next;
  }
  return null;
}
/**
 * The shop at the size its owner chose: with the books ("auto") or so many
 * tiers. A shop decorated before the shop grew moves to the growing case,
 * its rows' names, books, POPs and reactions with it, and its tiers are set
 * out again by the shop (a tier kept from view stays as it is).
 */
export function setShopSize(
  scene: StoreScene,
  size: ShopSize,
  shop: Shop,
  books: Book[],
): StoreScene {
  if (!SHOP_SIZES.includes(size)) throw new Error("Unknown size");
  const sized = { ...structuredClone(scene), growth: size };
  const next =
    scene.growth === undefined
      ? applyStoreTemplate(
          sized,
          (scene.templateId ?? "warm") as TemplateId,
          books,
        )
      : sized;
  return regrow(next, shop, books, { fresh: true });
}
export function validateOwnedScene(
  scene: StoreScene,
  shop: Shop,
  books: Book[],
) {
  if (scene.storeId !== shop.id || !scene.ownerManaged)
    return ["この書店の店内ではありません"];
  return validateScene(scene, new Set(books.map((b) => b.id)));
}
