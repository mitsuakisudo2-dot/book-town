import { findReader } from "../social";
import type { Book, Reader, Shop, TownState } from "../types";
import { searchBooks } from "./rank";
import { romajiToKana } from "./romaji";
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

/** A query that begins with @ asks for an @ID: what follows the @, or null. */
function idAsked(raw: string): string | null {
  const text = (raw ?? "").normalize("NFKC").trim();
  return text.startsWith("@") ? text.slice(1) : null;
}

/**
 * A reader's @ID, and the ID read as kana when it is romaji: @nagi is also
 * なぎ, so a name typed in kana and not yet turned into kanji (凪) finds them.
 */
function idForms(reader: Reader | undefined): string[] {
  if (!reader?.handle) return [];
  const read = romajiToKana(reader.handle);
  return read?.kana && !read.tail
    ? [reader.handle, read.kana]
    : [reader.handle];
}

/**
 * Readers whose name or @ID matches, closest first. A query that begins with
 * @ looks at @IDs only, as written.
 */
export function findReaders(state: TownState, raw: string): Reader[] {
  const id = idAsked(raw);
  const query = readTextQuery(id ?? raw);
  if (!query) return [];
  return byMatch([state.me, ...state.readers], (reader) =>
    textMatch(
      query,
      id === null ? [reader.name, ...idForms(reader)] : [reader.handle],
    ),
  );
}

// A shop's own name comes first, then its owner, then its words, the way a
// book's title comes before its author: each class above every match of the
// next. One class spans TEXT_MATCH.within to TEXT_MATCH.exact.
const CLASS = TEXT_MATCH.exact;
/** Each word of the query found in a different part of the shop. */
const ACROSS = 2;
/** Only a book on a public shelf matches. */
const STOCKED = 1;

/**
 * How well each shop matches: by its name, then its owner's name or @ID,
 * then its words (closest first within each), or by a book on a public shelf
 * that the book search finds. A query that begins with @ looks at the
 * owner's @ID only, as the readers found with it do. Null when nothing
 * searchable was typed.
 */
export function shopMatcher(
  state: TownState,
  raw: string,
): ((shop: Shop) => number) | null {
  const id = idAsked(raw);
  const query = readTextQuery(id ?? raw);
  if (!query) return null;
  if (id !== null)
    return (shop) =>
      textMatch(query, [findReader(state, shop.ownerId)?.handle]);
  const stocked = new Set(
    searchBooks(state.books, raw, { limit: state.books.length })
      .filter((match) => !match.near)
      .map((match) => match.book.id),
  );
  return (shop) => {
    const owner = findReader(state, shop.ownerId);
    const classes = [
      [shop.name],
      [owner?.name, ...idForms(owner)],
      [shop.description],
    ];
    for (const [at, fields] of classes.entries()) {
      const found = textMatch(query, fields);
      if (found) return CLASS * (classes.length - at) + found;
    }
    if (textMatch(query, classes.flat())) return ACROSS;
    return publicStock(state, shop).some((book) => stocked.has(book.id))
      ? STOCKED
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
