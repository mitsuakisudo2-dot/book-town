import { DEFAULT_SHELVES, filterLibrary, liveShelves } from "./library";
import { libraryStateOf, townShopBooks } from "./library-town";
import type { Book, TownState } from "./types";

// Where the books for the reader's own shop are picked from (管理表 103): the
// reader's library first, as they sorted it, then the town's. Nothing here
// reads more than the town the reader already has.

/** A shelf of the reader's library to pick a shop's books from. */
export interface PickSource {
  /** A default shelf's key, or a shelf the reader made's id. */
  key: string;
  label: string;
  /** Its books, in the library's own order for that shelf. */
  ids: string[];
}

const label = (key: string) =>
  DEFAULT_SHELVES.find((shelf) => shelf.key === key)?.label ?? key;

/** Every book in the reader's library, newest first (ライブラリ（全部）). */
export function libraryBookIds(state: TownState): string[] {
  return filterLibrary(
    libraryStateOf(state),
    { showWanted: true },
    townShopBooks(state),
  );
}

/**
 * The shelves of the library a shop's books can come from: 読了, the shelves
 * the reader made (smart ones too) in their order, then the whole library.
 * A shelf with no books is left out, so no empty choice is offered.
 */
export function pickSources(state: TownState): PickSource[] {
  const library = libraryStateOf(state);
  const shop = townShopBooks(state);
  const shelf = (key: string) =>
    filterLibrary(library, { shelf: key, showWanted: true }, shop);
  return [
    { key: "finished", label: label("finished"), ids: shelf("finished") },
    ...liveShelves(state.libraryShelves).map((made) => ({
      key: made.id,
      label: made.name,
      ids: shelf(made.id),
    })),
    {
      key: "all",
      label: label("all"),
      ids: filterLibrary(library, { showWanted: true }, shop),
    },
  ].filter((source) => source.ids.length > 0);
}

/**
 * The books a picker offers before anything is typed, the reader's own
 * first (in the library's order), then the town's (in the town's order).
 */
export function ownFirst(
  shown: readonly Book[],
  own: readonly string[],
): { own: Book[]; town: Book[] } {
  const byId = new Map(shown.map((book) => [book.id, book]));
  const mine = own
    .map((id) => byId.get(id))
    .filter((book): book is Book => Boolean(book))
    .filter((book, index, all) => all.indexOf(book) === index);
  const taken = new Set(mine.map((book) => book.id));
  return { own: mine, town: shown.filter((book) => !taken.has(book.id)) };
}
