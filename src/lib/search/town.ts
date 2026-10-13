import { findReader } from "../social";
import type { Book, Reader, Shop, TownState } from "../types";
import { searchBooks } from "./rank";
import { byMatch, readTextQuery, textMatch, TEXT_MATCH } from "./text";

// Readers and shops found by what is typed, the same way books are.

/** The books on a shop's public shelves; private shelves never count. */
export function publicStock(state: TownState, shop: Shop): Book[] {
  return shop.shelves
    .filter((shelf) => shelf.isPublic)
    .flatMap((shelf) =>
      shelf.items.map((item) =>
        state.books.find((book) => book.id === item.bookId),
      ),
    )
    .filter((book): book is Book => Boolean(book));
}

/**
 * Readers whose name or @ID matches, closest first. A query that begins with
 * @ looks at @IDs only.
 */
export function findReaders(state: TownState, raw: string): Reader[] {
  const text = (raw ?? "").normalize("NFKC").trim();
  const byHandle = text.startsWith("@");
  const query = readTextQuery(byHandle ? text.slice(1) : text);
  if (!query) return [];
  return byMatch([state.me, ...state.readers], (reader) =>
    textMatch(query, byHandle ? [reader.handle] : [reader.name, reader.handle]),
  );
}

/**
 * How well each shop matches: by its name, its words or its owner's name
 * (closest first), or by a book on a public shelf that the book search finds.
 * Null when nothing searchable was typed.
 */
export function shopMatcher(
  state: TownState,
  raw: string,
): ((shop: Shop) => number) | null {
  const query = readTextQuery(raw);
  if (!query) return null;
  const stocked = new Set(
    searchBooks(state.books, raw, { limit: state.books.length })
      .filter((match) => !match.near)
      .map((match) => match.book.id),
  );
  return (shop) => {
    const own = textMatch(query, [
      shop.name,
      shop.description,
      findReader(state, shop.ownerId)?.name,
    ]);
    if (own) return own + 1;
    return publicStock(state, shop).some((book) => stocked.has(book.id))
      ? TEXT_MATCH.within
      : TEXT_MATCH.none;
  };
}

/** The shops of the town (the reader's own too) that match, closest first. */
export function findShops(state: TownState, raw: string): Shop[] {
  const match = shopMatcher(state, raw);
  if (!match) return [];
  return byMatch(
    [...state.shops, ...(state.ownShop ? [state.ownShop] : [])],
    match,
  );
}
