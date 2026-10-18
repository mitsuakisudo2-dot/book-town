import { bookKind } from "./samples";
import { isPublished, posterBookIds } from "./posters";
import { ME_ID, type Book, type TownState } from "./types";
import { shownToOthers } from "./visibility";
import { withoutTwins } from "./own-books";

// A list of the town's books shown before anything is typed (棚の隅の本, a
// picker's first books, the 見本's shelves in the walk), or found by a genre
// chip, shows only books used where everyone can see them, the 見本's, and the
// reader's own. Any other book of the catalog waits until its title, author or
// ISBN is searched.
// The database keeps the same rule for books typed in by hand: another
// reader's that is not used where everyone can see it never reaches the town
// (private.book_is_listed and book_is_mine, in supabase/migrations).

/** Books the reader keeps, reads, made or shelved, private ones too. */
function ownBookIds(state: TownState): (string | null)[] {
  return [
    ...state.library,
    ...state.wishlist,
    ...state.favorites,
    ...state.finishedBooks,
    ...state.me.lifeNine,
    ...state.readingSessions.map((session) => session.bookId),
    ...(state.ownShop?.shelves ?? []).flatMap((shelf) =>
      shelf.items.map((item) => item.bookId),
    ),
    ...(state.ownShop?.sceneBookIds ?? []),
    ...state.posts
      .filter((post) => post.authorId === ME_ID)
      .map((post) => post.bookId),
    ...state.readingRecords
      .filter((record) => record.readerId === ME_ID)
      .map((record) => record.bookId),
    ...state.posters
      .filter((poster) => poster.authorId === ME_ID)
      .flatMap(posterBookIds),
  ];
}

/**
 * Books others can see used: on a public shelf or in a shop's public store
 * scene, in a post or a public record, among someone's 人生の9冊, on a poster
 * put up, or read together right now.
 */
function publicBookIds(state: TownState): (string | null)[] {
  return [
    ...state.shops.flatMap((shop) =>
      shop.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) => shelf.items.map((item) => item.bookId)),
    ),
    ...state.shops.flatMap((shop) => shop.sceneBookIds ?? []),
    ...state.posts
      .filter((post) => post.readingMode !== "solo")
      .map((post) => post.bookId),
    ...state.readingRecords
      .filter((record) => shownToOthers(record.audience))
      .map((record) => record.bookId),
    ...state.readers.flatMap((reader) => reader.lifeNine),
    ...state.posters.filter(isPublished).flatMap(posterBookIds),
    ...state.readingNow.map((entry) => entry.bookId),
  ];
}

/**
 * The town's books a list may show before anything is typed, in the town's
 * order. A book not from the database is the 見本's, or was typed in this
 * browser (the demo has no other readers), so it always stays. A book
 * another reader typed in is left out where the reader has their own of it
 * (withoutTwins).
 */
export function booksBeforeSearch(state: TownState): Book[] {
  const used = new Set([...ownBookIds(state), ...publicBookIds(state)]);
  return withoutTwins(state.books).filter(
    (book) => bookKind(book.id) !== "database" || used.has(book.id),
  );
}
