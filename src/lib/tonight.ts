import { ME_ID, type Shop, type ShelfItem, type TownState } from "./types";
import { isDatabaseId } from "./paths";

// What the home shows "today": one shop a night, the day's POPs. Chosen by
// the day in Japan over the shops' ids, so it holds all day for everyone and
// moves on the next; never by followers, likes or any other count.

const DAY = 24 * 60 * 60 * 1000;
/** Japan has no summer time: JST is always UTC+9. */
const JST = 9 * 60 * 60 * 1000;

/** The day in Japan that `now` falls on, counted from 1970-01-01. */
export const jstDay = (now: number): number => Math.floor((now + JST) / DAY);

/** A stable number for a text (FNV-1a), to order ids without counts. */
export function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * `items` in the day's order: a fixed order made from their ids (and
 * `salt`), turned by one place each day. Within a day it never changes.
 */
export function dayOrder<T>(
  items: T[],
  idOf: (item: T) => string,
  now: number,
  salt = "",
): T[] {
  if (!items.length) return [];
  const order = [...items].sort(
    (a, b) =>
      hashOf(salt + idOf(a)) - hashOf(salt + idOf(b)) ||
      idOf(a).localeCompare(idOf(b)),
  );
  const turn = jstDay(now) % order.length;
  return [...order.slice(turn), ...order.slice(0, turn)];
}

/** The day's one pick of `items`: each in turn, one a day. */
export const pickOfDay = <T>(
  items: T[],
  idOf: (item: T) => string,
  now: number,
  salt = "",
): T | null => dayOrder(items, idOf, now, salt)[0] ?? null;

/** The books a shop shows anyone: those on its public shelves. */
export const publicItems = (shop: Shop): ShelfItem[] =>
  shop.shelves
    .filter((shelf) => shelf.isPublic)
    .flatMap((shelf) => shelf.items);

/** The reader's own shop, which the home never recommends to them. */
export const isOwnShop = (
  state: Pick<TownState, "ownShop">,
  shop: Shop,
): boolean => shop.ownerId === ME_ID || shop.id === state.ownShop?.id;

/** A 見本 (sample) record: one that is not in the database. */
export const isSample = (id: string): boolean => !isDatabaseId(id);

/**
 * Real shops first, 見本 after: a town with real shops recommends them, and
 * falls back to the samples only when it has none.
 */
export function realFirst<T>(items: T[], idOf: (item: T) => string): T[] {
  const real = items.filter((item) => !isSample(idOf(item)));
  return real.length ? real : items;
}

/** How many books on public shelves make a shop worth a night. */
export const TONIGHT_MIN_BOOKS = 3;

/**
 * Whether a shop may be 今夜の一軒: not the reader's own, with at least three
 * books on its public shelves. Checked again while the slide is held.
 */
export const isTonightShop = (
  state: Pick<TownState, "ownShop" | "books">,
  shop: Shop,
): boolean =>
  !isOwnShop(state, shop) &&
  publicItems(shop).filter((item) =>
    state.books.some((book) => book.id === item.bookId),
  ).length >= TONIGHT_MIN_BOOKS;

/** 今夜の一軒: one of the shops that may be (isTonightShop), chosen for the day. */
export function tonightsShop(state: TownState, now: number): Shop | null {
  const open = state.shops.filter((shop) => isTonightShop(state, shop));
  return pickOfDay(
    realFirst(open, (shop) => shop.id),
    (shop) => shop.id,
    now,
    "tonight:",
  );
}
