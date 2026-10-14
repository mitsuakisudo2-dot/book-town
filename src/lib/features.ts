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
import {
  dayOrder,
  isOwnShop,
  isSample,
  pickOfDay,
  publicItems,
} from "./tonight";

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

/**
 * 企画展, the one picker for the carousel, the band and the alley: published
 * posters this reader gets open (not a spoiler kept behind its door, not left
 * out by their setting) with no report cover, newest first. A folded poster
 * is never shown, its title and books included.
 */
export function exhibitionPosters(state: TownState): Poster[] {
  return state.posters
    .filter(
      (poster) =>
        isPublished(poster) &&
        posterSpoilerView(state, poster) === "open" &&
        reviewCoverOf(state, "poster", poster.id, poster.authorId) === null,
    )
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
  const open = state.shops.filter(
    (shop) => !isOwnShop(state, shop) && shownBooks(state, shop).length > 0,
  );
  if (open.length < FEATURE_MIN.shelves) return null;
  const order = [
    ...dayOrder(
      open.filter((shop) => !isSample(shop.id)),
      (shop) => shop.id,
      now,
      "shelves:",
    ),
    ...dayOrder(
      open.filter((shop) => isSample(shop.id)),
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
    .map((item) => state.books.find((book) => book.id === item.bookId)!)
    .filter(
      (book, index, all) =>
        all.findIndex((other) => other.id === book.id) === index,
    )
    .slice(0, count);

/**
 * 感想が面白い本: posts about a book from the last two weeks that this reader
 * gets open, as written: no spoiler kept behind a door, no report cover, no
 * covered words, not a reading memo (solo or together). One per writer, the
 * newest first, none already in the home's 便り. No stars, no counts.
 */
export function reviewsFeature(
  state: TownState,
  now: number,
  shown: ReadonlySet<string> = new Set(),
): ReviewsFeature | null {
  const writers = new Set<string>();
  const posts = state.posts
    .filter(
      (post) =>
        post.parentId === null &&
        post.bookId !== null &&
        post.readingMode === null &&
        post.authorId !== ME_ID &&
        time(post.createdAt) >= now - REVIEW_DAYS * DAY &&
        state.books.some((book) => book.id === post.bookId) &&
        spoilerViewOf(state, post) === "open" &&
        reviewCoverOf(state, "post", post.id, post.authorId) === null &&
        !splitHidden(post.body).some((part) => part.hidden),
    )
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

/**
 * 本屋のPOP: one POP from each shop's public shelves, the day's pick, the
 * shops in the day's order. Titled 本屋のPOP: they are not newest first.
 */
export function popsFeature(
  state: TownState,
  now: number,
  max = 8,
): PopsFeature | null {
  const pops = state.shops
    .filter((shop) => !isOwnShop(state, shop))
    .flatMap((shop) => {
      const written = shop.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) =>
          shelf.items
            .filter((item) => item.pop.trim())
            .flatMap((item) => {
              const book = state.books.find(
                (entry) => entry.id === item.bookId,
              );
              return book ? [{ shop, shelf, item, book }] : [];
            }),
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
