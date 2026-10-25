import { bookById } from "./book-name";
import { REGISTERED_GENRE } from "./books";
import { townEncounters, usedBooks } from "./library-town";
import { ME_ID, type TownState } from "./types";

// A book taken back in the scanner goes when its scan ends (AUD-055,
// supabase/migrations/*_forget_undone_books.sql). While the scan is open,
// ［元に戻す］ brings it back as it was, so its rows stay; once it ends, a
// book the scan made and left taken back is forgotten, as if never read, so
// it is no longer found as 登録した本 nor offered for the shop. The database
// decides for an account (forget_books); the demo asks the same here.

/** The most books one ask of the database forgets (forget_books). */
export const FORGET_MOST = 200;

/**
 * Of `ids`, the reader's own registered books with an ISBN that scan
 * `batch` brought into the library and that are taken out again, never
 * used, and named by nothing else of theirs.
 */
export function forgettable(
  state: TownState,
  ids: readonly string[],
  batch: string,
): string[] {
  const used = new Set([
    ...usedBooks(state),
    ...state.library,
    ...state.wishlist,
    ...state.favorites,
    ...state.finishedBooks,
    ...state.readingRecords.flatMap((record) =>
      record.readerId === ME_ID ? [record.bookId] : [],
    ),
    ...state.readingSessions.flatMap((session) =>
      session.bookId ? [session.bookId] : [],
    ),
    ...townEncounters(state).map((encounter) => encounter.bookId),
  ]);
  return [...new Set(ids)].filter((id) => {
    const book = bookById(state.books, id);
    const row = state.libraryEntries[id];
    return (
      book !== undefined &&
      book.genre === REGISTERED_GENRE &&
      !book.theirs &&
      Boolean(book.isbn) &&
      row !== undefined &&
      row.batchId === batch &&
      row.removedAt !== null &&
      !row.everUsed &&
      !used.has(id)
    );
  });
}

// Work kept only in this browser (a scene being decorated, a record, a post,
// the demo's walk with its scene) is not in the town nor in the database, so
// a book any of it names is kept: forgetting it would leave that work
// pointing at nothing. It is read as text, so a draft of any kind counts.
const KEPT_IN_BROWSER = /^book-town-.*(-drafts|walk)-v\d+$/;

type KeptStorage = Pick<Storage, "length" | "key" | "getItem">;

/** Of `ids`, those no work kept in this browser names. */
export function notKeptInBrowser(
  ids: readonly string[],
  storage: KeptStorage | null | undefined = browserStorage(),
): string[] {
  if (!ids.length) return [];
  // No storage at all (not a browser) keeps no work; storage that will not
  // be read may: then nothing is forgotten.
  if (storage === undefined) return [...ids];
  if (storage === null) return [];
  try {
    const kept: string[] = [];
    for (let at = 0; at < storage.length; at += 1) {
      const key = storage.key(at);
      if (key && KEPT_IN_BROWSER.test(key))
        kept.push(storage.getItem(key) ?? "");
    }
    return ids.filter((id) => !kept.some((value) => value.includes(id)));
  } catch {
    return [];
  }
}

function browserStorage(): KeptStorage | null | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The town without these books, their library rows and shelf places. */
export function withoutBooks(
  state: TownState,
  ids: readonly string[],
): TownState {
  if (!ids.length) return state;
  const gone = new Set(ids);
  return {
    ...state,
    books: state.books.filter((book) => !gone.has(book.id)),
    libraryEntries: Object.fromEntries(
      Object.entries(state.libraryEntries).filter(([id]) => !gone.has(id)),
    ),
    libraryShelfBooks: state.libraryShelfBooks.filter(
      (book) => !gone.has(book.bookId),
    ),
  };
}
