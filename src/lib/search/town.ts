import { findReader, wordsFolded } from "../social";
import { booksById } from "../book-name";
import type { Book, Reader, Shop, TownState } from "../types";
import { searchBooks } from "./rank";
import { romajiToKana } from "./romaji";
import { byMatch, readTextQuery, textRank, TEXT_MATCH } from "./text";

// Readers and shops found by what is typed, the same way books are.

/** The books on a shop's public shelves; private shelves never count. */
export function publicStock(state: TownState, shop: Shop): Book[] {
  return booksById(
    state.books,
    shop.shelves
      .filter((shelf) => shelf.isPublic)
      .flatMap((shelf) => shelf.items.map((item) => item.bookId)),
  );
}

/**
 * A query that begins with @ asks for an @ID: what follows the @, lowercased
 * (＠ＳＵＭＩ is sumi), or null.
 */
function idAsked(raw: string): string | null {
  const text = (raw ?? "").normalize("NFKC").trim();
  return text.startsWith("@") ? text.slice(1).trim().toLowerCase() : null;
}

/**
 * How an @ID matches one asked with @: compared as written, so @mio2 is not
 * @mio_2. The whole ID, its start, or (from two characters) inside it.
 */
function idMatch(typed: string, handle: string | undefined): number {
  const id = handle?.toLowerCase();
  if (!id) return TEXT_MATCH.none;
  if (id === typed) return TEXT_MATCH.exact;
  if (id.startsWith(typed)) return TEXT_MATCH.start;
  return typed.length >= 2 && id.includes(typed)
    ? TEXT_MATCH.within
    : TEXT_MATCH.none;
}

/**
 * A reader's @ID, and the ID read as kana when it is romaji: @nagi is also
 * なぎ, so a name typed in kana and not yet turned into kanji (凪) finds them.
 * Read as names are spelled too: an n before i or y after a vowel is ん
 * (@shinya is しんや, @kenichi is けんいち), and a last oh is a long o
 * (@satoh is さとう).
 */
function idForms(reader: Reader | undefined): string[] {
  if (!reader?.handle) return [];
  const forms = [reader.handle];
  const asName = reader.handle
    .replace(/([aiueo])n(?=[iy])/gi, "$1n'")
    .replace(/oh$/i, "o");
  for (const spelling of [reader.handle, asName]) {
    const read = romajiToKana(spelling);
    if (read?.kana && !read.tail && !forms.includes(read.kana))
      forms.push(read.kana);
  }
  return forms;
}

/**
 * Readers whose name or @ID matches, closest first. A query that begins with
 * @ looks at @IDs only, as written.
 */
export function findReaders(state: TownState, raw: string): Reader[] {
  const readers = [state.me, ...state.readers];
  const id = idAsked(raw);
  if (id !== null)
    return id ? byMatch(readers, (reader) => idMatch(id, reader.handle)) : [];
  const query = readTextQuery(raw);
  if (!query) return [];
  return byMatch(readers, (reader) =>
    textRank(query, [reader.name, ...idForms(reader)]),
  );
}

// A shop's own name comes first, then its owner, then its words, the way a
// book's title comes before its author: each class above every match of the
// next. One class spans TEXT_MATCH.within to TEXT_MATCH.exact and a half
// (textRank), less than CLASS.
const CLASS = TEXT_MATCH.exact;
/** Each word of the query found in a different part of the shop. */
const ACROSS = 2;
/** Only a book on a public shelf matches. */
const STOCKED = 1;

/**
 * How well each shop matches: by its name, then its owner's name or @ID,
 * then its words unless reports folded them (closest first within each), or
 * by a book on a public shelf that the book search finds. A query that
 * begins with @ looks at the owner's @ID only, as the readers found with it
 * do. Null when nothing searchable was typed.
 */
export function shopMatcher(
  state: TownState,
  raw: string,
): ((shop: Shop) => number) | null {
  const id = idAsked(raw);
  if (id !== null)
    return id
      ? (shop) => idMatch(id, findReader(state, shop.ownerId)?.handle)
      : null;
  const query = readTextQuery(raw);
  if (!query) return null;
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
      // Words folded by reports are not searched, as they are not shown.
      [wordsFolded(state, "shop", shop.id) ? null : shop.description],
    ];
    for (const [at, fields] of classes.entries()) {
      const found = textRank(query, fields);
      if (found) return CLASS * (classes.length - at) + found;
    }
    if (textRank(query, classes.flat())) return ACROSS;
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
