import { isSampleId } from "../record-kind";
import type { TownCounts } from "../town-more";
import type { TownState } from "../types";
import { booksOfWork } from "../works";

export interface BookSignal {
  /** Public shelves the book stands on. */
  shelves: number;
  /** Public posts and replies about it (reading alone stays out). */
  talk: number;
  reviews: number;
  /** 読みたくなった, from the posts about it. */
  wants: number;
}

/**
 * How present each book is in the town: on public shelves, in posts, and in
 * 読みたくなった, of any book of its work (booksOfWork).
 *
 * With the database's counts (town_counts, of all time), the shelves and
 * posts of the books it was asked of are its, and the town adds only the
 * 見本's, which it alone keeps: the town holds only the newest 便り. A book
 * it was not asked of (one come since) is counted by the town, as before.
 * 読みたくなった is the town's either way: only a 便り's writer is told how
 * many wanted to read from it.
 */
export function bookSignals(
  state: TownState,
  counted?: TownCounts,
): Map<string, BookSignal> {
  const allShops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const sampleShops = allShops.filter((shop) => isSampleId(shop.id));
  const asked = new Set(counted?.asked);
  return new Map(
    state.books.map((book) => {
      const kept = counted?.books[book.id];
      const byDatabase = kept !== undefined || asked.has(book.id);
      const work = booksOfWork(state.books, book.id);
      const shops = byDatabase ? sampleShops : allShops;
      const shelves = shops.reduce(
        (count, shop) =>
          count +
          shop.shelves.filter(
            (shelf) =>
              shelf.isPublic &&
              shelf.items.some((item) => work.has(item.bookId)),
          ).length,
        0,
      );
      const posts = state.posts.filter(
        (post) =>
          post.bookId !== null &&
          work.has(post.bookId) &&
          post.readingMode !== "solo",
      );
      const told = byDatabase
        ? posts.filter((post) => isSampleId(post.id))
        : posts;
      const reviews = told.filter((post) => post.parentId === null).length;
      const wants =
        posts.reduce((sum, post) => sum + post.wants, 0) +
        state.wantedPosts.filter((id) => posts.some((post) => post.id === id))
          .length;
      return [
        book.id,
        {
          shelves: shelves + (kept?.shelves ?? 0),
          talk: told.length + (kept?.talk ?? 0),
          reviews: reviews + (kept?.reviews ?? 0),
          wants,
        },
      ];
    }),
  );
}

/**
 * What a search adds for a book the town already knows, among matches that
 * are about as good. Only what everyone can see counts; it is never shown.
 */
export const searchPresence = (signal: BookSignal | undefined): number =>
  signal ? signal.shelves * 3 + signal.talk + signal.wants : 0;
