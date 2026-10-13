import type { TownState } from "../types";

export interface BookSignal {
  /** Public shelves the book stands on. */
  shelves: number;
  /** Public posts and replies about it (reading alone stays out). */
  talk: number;
  reviews: number;
  /** 読みたくなった, from the posts about it. */
  wants: number;
}

/** How present each book is in the town: on public shelves, in posts, and in 読みたくなった. */
export function bookSignals(state: TownState): Map<string, BookSignal> {
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  return new Map(
    state.books.map((book) => {
      const shelves = shops.reduce(
        (count, shop) =>
          count +
          shop.shelves.filter(
            (shelf) =>
              shelf.isPublic &&
              shelf.items.some((item) => item.bookId === book.id),
          ).length,
        0,
      );
      const posts = state.posts.filter(
        (post) => post.bookId === book.id && post.readingMode !== "solo",
      );
      const reviews = posts.filter((post) => post.parentId === null).length;
      const wants =
        posts.reduce((sum, post) => sum + post.wants, 0) +
        state.wantedPosts.filter((id) => posts.some((post) => post.id === id))
          .length;
      return [book.id, { shelves, talk: posts.length, reviews, wants }];
    }),
  );
}

/**
 * What a search adds for a book the town already knows, among matches that
 * are about as good. Only what everyone can see counts; it is never shown.
 */
export const searchPresence = (signal: BookSignal | undefined): number =>
  signal ? signal.shelves * 3 + signal.talk + signal.wants : 0;
