import {
  ME_ID,
  type Book,
  type Post,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownState,
} from "./types";
import { reviewCoverOf, spoilerViewOf } from "./social";
import { isPublished, posterSpoilerView, type Poster } from "./posters";
import { splitHidden } from "./hidden-words";
import { bookById } from "./book-name";
import { isSampleId } from "./record-kind";
import { dayOrder, isOwnShop, pickOfDay, publicItems } from "./tonight";

// The 特集 bands of the home: each reads only what anyone may see (public
// shelves, open posters and posts), is drawn only when it has enough to be
// worth a band, and is never ordered by counts.

const DAY = 24 * 60 * 60 * 1000;

/** The fewest items a band is drawn with; below it, the band is skipped. */
export const FEATURE_MIN = {
  exhibition: 2,
  shelves: 3,
  reviews: 3,
  pops: 3,
} as const;

/** How far back 感想が面白い本 looks, and how many it shows. */
export const REVIEW_DAYS = 14;
export const REVIEWS_MAX = 8;

export type ExhibitionFeature = { kind: "exhibition"; posters: Poster[] };
export type ShelvesFeature = { kind: "shelves"; shops: Shop[] };
export type ReviewsFeature = { kind: "reviews"; posts: Post[] };
export type PopPick = { shop: Shop; shelf: Shelf; item: ShelfItem; book: Book };
export type PopsFeature = { kind: "pops"; pops: PopPick[] };
export type Feature =
  ExhibitionFeature | ShelvesFeature | ReviewsFeature | PopsFeature;

const time = (at: string) => Date.parse(at) || 0;

// Each 特集 has one test of what it may show, used both to choose and, while
// the home holds a choice still, to check it again against the town as it is
// now: a tile that fails it (folded, reported, asked about as a spoiler,
// taken down, moved to a private shelf) is dropped, never shown as it was.

/**
 * Whether a poster may be a 企画展 for this reader: published, put on the
 * timeline by its maker (「タイムラインにも出す」), not the reader's own, open
 * for them (not a spoiler kept behind its door, not left out by their
 * setting) and with no report cover. A folded poster is never shown, its
 * title and books included.
 */
export const isOpenPoster = (state: TownState, poster: Poster): boolean =>
  isPublished(poster) &&
  poster.inTimeline &&
  poster.authorId !== ME_ID &&
  posterSpoilerView(state, poster) === "open" &&
  reviewCoverOf(state, "poster", poster.id, poster.authorId) === null;

/**
 * 企画展, the one picker for the carousel, the band and the alley: the posters
 * this reader may be shown (isOpenPoster), newest first.
 */
export function exhibitionPosters(state: TownState): Poster[] {
  return state.posters
    .filter((poster) => isOpenPoster(state, poster))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

/** The 企画展 slide of the carousel: the newest open poster. */
export const exhibitionPick = (state: TownState): Poster | null =>
  exhibitionPosters(state)[0] ?? null;

/** A 企画展 band: open posters not already on the page. */
export function exhibitionFeature(
  state: TownState,
  shown: ReadonlySet<string> = new Set(),
  max = 6,
): ExhibitionFeature | null {
  const posters = exhibitionPosters(state)
    .filter((poster) => !shown.has(poster.id))
    .slice(0, max);
  return posters.length >= FEATURE_MIN.exhibition
    ? { kind: "exhibition", posters }
    : null;
}

/** The books of a shop's public shelves that the town knows. */
const shownBooks = (state: TownState, shop: Shop) =>
  publicItems(shop).filter((item) =>
    state.books.some((book) => book.id === item.bookId),
  );

/** Whether a shop may be in 本棚をのぞく: another reader's, with books on its public shelves. */
export const isOpenShop = (state: TownState, shop: Shop): boolean =>
  !isOwnShop(state, shop) && shownBooks(state, shop).length > 0;

/**
 * 本棚をのぞく: other readers' shops with books on their public shelves,
 * real shops before 見本, in the day's order (`turn` moves on to another
 * set, as the alley needs).
 */
export function shelvesFeature(
  state: TownState,
  now: number,
  turn = 0,
  max = 6,
): ShelvesFeature | null {
  const open = state.shops.filter((shop) => isOpenShop(state, shop));
  if (open.length < FEATURE_MIN.shelves) return null;
  const order = [
    ...dayOrder(
      open.filter((shop) => !isSampleId(shop.id)),
      (shop) => shop.id,
      now,
      "shelves:",
    ),
    ...dayOrder(
      open.filter((shop) => isSampleId(shop.id)),
      (shop) => shop.id,
      now,
      "shelves:",
    ),
  ];
  const from = (turn * Math.min(max, order.length)) % order.length;
  const shops = [...order.slice(from), ...order.slice(0, from)].slice(0, max);
  return { kind: "shelves", shops };
}

/** Up to `count` covers of a shop's public shelves, for its card. */
export const shopCovers = (state: TownState, shop: Shop, count = 4): Book[] =>
  shownBooks(state, shop)
    .map((item) => bookById(state.books, item.bookId)!)
    .filter(
      (book, index, all) =>
        all.findIndex((other) => other.id === book.id) === index,
    )
    .slice(0, count);

/**
 * Whether a post may be in 感想が面白い本 at `now`: another reader's, about a
 * book the town knows, from the last two weeks, and open for this reader as
 * written: no spoiler kept behind a door (marked, or asked about by them), no
 * report cover, no covered words, not a reply or a reading memo (solo or
 * together).
 */
export const isOpenReview = (
  state: TownState,
  post: Post,
  now: number,
): boolean =>
  post.parentId === null &&
  post.bookId !== null &&
  post.readingMode === null &&
  post.authorId !== ME_ID &&
  time(post.createdAt) >= now - REVIEW_DAYS * DAY &&
  state.books.some((book) => book.id === post.bookId) &&
  spoilerViewOf(state, post) === "open" &&
  reviewCoverOf(state, "post", post.id, post.authorId) === null &&
  !splitHidden(post.body).some((part) => part.hidden);

/**
 * 感想が面白い本: posts this reader may be shown (isOpenReview), one per
 * writer, the newest first, none already in the home's 便り. No stars, no
 * counts.
 */
export function reviewsFeature(
  state: TownState,
  now: number,
  shown: ReadonlySet<string> = new Set(),
): ReviewsFeature | null {
  const writers = new Set<string>();
  const posts = state.posts
    .filter((post) => isOpenReview(state, post, now))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))
    .filter((post) => {
      if (writers.has(post.authorId)) return false;
      writers.add(post.authorId);
      return !shown.has(post.id);
    })
    .slice(0, REVIEWS_MAX);
  return posts.length >= FEATURE_MIN.reviews
    ? { kind: "reviews", posts }
    : null;
}

/** Where a book sits on a shop's shelf: what a held POP or お題 keeps. */
export type PlaceRef = { shopId: string; shelfId: string; itemId: string };

export const placeOf = ({ shop, shelf, item }: PopPick): PlaceRef => ({
  shopId: shop.id,
  shelfId: shelf.id,
  itemId: item.id,
});

/** Every book on a shop's shelves the town knows, with where it sits. */
const placed = (state: TownState, shop: Shop): PopPick[] =>
  shop.shelves.flatMap((shelf) =>
    shelf.items.flatMap((item) => {
      const book = bookById(state.books, item.bookId);
      return book ? [{ shop, shelf, item, book }] : [];
    }),
  );

/**
 * A place read again from the town: the shop, shelf and book as they are
 * now, or null once the book has left that shelf (or the shop, the town).
 */
export function pickAt(state: TownState, place: PlaceRef): PopPick | null {
  const shop = state.shops.find((entry) => entry.id === place.shopId);
  const shelf = shop?.shelves.find((entry) => entry.id === place.shelfId);
  const item = shelf?.items.find((entry) => entry.id === place.itemId);
  const book = item && bookById(state.books, item.bookId);
  return shop && shelf && item && book ? { shop, shelf, item, book } : null;
}

/** Whether a POP may be in 本屋のPOP: on another reader's public shelf, with words. */
export const isOpenPop = (state: TownState, pick: PopPick): boolean =>
  !isOwnShop(state, pick.shop) &&
  pick.shelf.isPublic &&
  pick.item.pop.trim() !== "";

/**
 * 本屋のPOP: one POP from each shop's public shelves, the day's pick, the
 * shops in the day's order. Titled 本屋のPOP: they are not newest first.
 */
export function popsFeature(
  state: TownState,
  now: number,
  max = 8,
): PopsFeature | null {
  const pops = state.shops.flatMap((shop) => {
    const written = placed(state, shop).filter((pick) =>
      isOpenPop(state, pick),
    );
    const pick = pickOfDay(written, (pop) => pop.item.id, now, shop.id);
    return pick ? [pick] : [];
  });
  const ordered = dayOrder(pops, (pop) => pop.shop.id, now, "pops:").slice(
    0,
    max,
  );
  return ordered.length >= FEATURE_MIN.pops
    ? { kind: "pops", pops: ordered }
    : null;
}

/** How many books the 見本 掲示板's お題 shows. */
export const BOARD_PICKS = 4;

/**
 * Whether a book may be pinned to the 見本 掲示板's お題: on a public shelf
 * of a 見本 shop that is not the reader's own.
 */
export const isBoardPick = (state: TownState, pick: PopPick): boolean =>
  isSampleId(pick.shop.id) &&
  !isOwnShop(state, pick.shop) &&
  pick.shelf.isPublic;

/**
 * The 見本 掲示板's お題: one book from each 見本 shop's public shelves, the
 * day's pick, the shops in the day's order. Only 見本 shops: the board is a
 * sample until the first real お題, and invents nobody's choice.
 */
export function boardPicks(
  state: TownState,
  now: number,
  count = BOARD_PICKS,
): PopPick[] {
  const picks = state.shops.flatMap((shop) => {
    const open = placed(state, shop).filter((pick) => isBoardPick(state, pick));
    const pick = pickOfDay(open, (entry) => entry.item.id, now, "board:");
    return pick ? [pick] : [];
  });
  return dayOrder(picks, (pick) => pick.shop.id, now, "board:").slice(0, count);
}
