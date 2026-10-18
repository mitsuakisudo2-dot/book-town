import { bookById } from "./book-name";
import { createRegisteredBook } from "./books";
import type { Book, TownState } from "./types";

// A reader's rows name only books of their own (AUD-001; けにー 10-18
// 00:28Z; supabase/migrations/*_own_books_only.sql): their own registrations,
// the catalog's rows and the 見本's books. A book another reader typed in
// (Book.theirs) is shown as theirs, on their shelf, post or page; the first
// time the reader uses it, the reader is given their own copy of it
// (Book.copyOf), in the same edition, which the database makes under the id
// the town gives it here (copy_book). What its typist later edits reaches
// only the typist's own rows. A book with an ISBN stands for the reader's
// own of that ISBN when they have one, and no copy is made.
//
// The reader's own lists (読みたい, the library, 読了…) are asked about
// another reader's book through mine(), which names the reader's book for it.

type Town = { books: readonly Book[]; library: readonly string[] };

const standIns = new WeakMap<
  readonly Book[],
  WeakMap<readonly string[], Map<string, Book>>
>();

/**
 * For each book another reader typed in, the reader's book standing for it:
 * their copy of it (while its ISBN is the book's), else their own (or the
 * catalog's) of its ISBN, one in their library first.
 */
function standInsOf({ books, library }: Town): Map<string, Book> {
  const byLibrary = standIns.get(books)?.get(library);
  if (byLibrary) return byLibrary;
  const found = new Map<string, Book>();
  if (books.some((book) => book.theirs)) {
    const inLibrary = new Set(library);
    const byId = new Map(books.map((book) => [book.id, book]));
    const byIsbn = new Map<string, Book>();
    for (const book of books) {
      if (book.theirs) continue;
      const original = book.copyOf ? byId.get(book.copyOf) : undefined;
      if (original?.theirs && original.isbn === book.isbn)
        if (!found.has(original.id) || inLibrary.has(book.id))
          found.set(original.id, book);
      if (!book.isbn) continue;
      const had = byIsbn.get(book.isbn);
      if (!had || (!inLibrary.has(had.id) && inLibrary.has(book.id)))
        byIsbn.set(book.isbn, book);
    }
    for (const book of books)
      if (book.theirs && !found.has(book.id) && book.isbn) {
        const own = byIsbn.get(book.isbn);
        if (own) found.set(book.id, own);
      }
  }
  const kept = standIns.get(books) ?? new WeakMap();
  kept.set(library, found);
  standIns.set(books, kept);
  return found;
}

/**
 * The reader's book for `id`: the book itself, unless another reader typed
 * it in; then the reader's copy of it, or their own of its ISBN. Undefined
 * for one of another reader's that they have nothing of yet, or a book the
 * town lacks.
 */
export function myBookOf(
  town: Town,
  id: string | null | undefined,
): Book | undefined {
  const book = bookById(town.books, id);
  if (!book?.theirs) return book;
  return standInsOf(town).get(book.id);
}

/**
 * The id the reader's own rows name `id` by: their book for it (myBookOf),
 * or `id` itself while they have none. Ask the reader's lists with this.
 */
export const mine = (town: Town, id: string): string =>
  myBookOf(town, id)?.id ?? id;

/**
 * Whether the list holds the reader's book for `id` (mine): asked of
 * another reader's book, the reader's copy of it answers.
 */
export const holds = (
  town: Town,
  list: readonly string[],
  id: string | null | undefined,
): boolean => Boolean(id) && list.includes(mine(town, id as string));

/**
 * The books the reader's rows will name for `ids`: each the book itself, or
 * for another reader's, the reader's book for it, a copy of it made now when
 * they have none (newId gives its id). The town comes back with the copies
 * among its books, or as it was when none was made.
 */
export function owning<T extends string | null | undefined>(
  state: TownState,
  ids: readonly T[],
  newId: (taken: string[], isbn: string | null) => string,
): { state: TownState; ids: T[] } {
  let books = state.books;
  const named = ids.map((id) => {
    if (!id) return id;
    const town = { books, library: state.library };
    const book = bookById(books, id);
    if (!book?.theirs) return id;
    const own = myBookOf(town, id);
    if (own) return own.id as T;
    // Drawn as the database's row of it will be drawn once read back.
    const copy: Book = {
      ...createRegisteredBook(
        newId(
          books.map((entry) => entry.id),
          book.isbn ?? null,
        ),
        {
          title: book.title,
          author: book.author,
          ...(book.isbn ? { isbn: book.isbn } : {}),
          ...(book.price ? { price: book.price } : {}),
        },
      ),
      ...(book.workId ? { workId: book.workId } : {}),
      copyOf: book.id,
    };
    books = [...books, copy];
    return copy.id as T;
  });
  return {
    state: books === state.books ? state : { ...state, books },
    ids: named,
  };
}

const twinless = new WeakMap<readonly Book[], readonly Book[]>();
// Whether a book stands for another's does not ask the library (only which
// of two does), so one empty list keeps the answers for every town.
const NO_LIBRARY: readonly string[] = [];

/**
 * The books, but another reader's that the reader has a book for (myBookOf):
 * found, listed or picked, the same book is there once, as the reader's own.
 */
export function withoutTwins(books: readonly Book[]): readonly Book[] {
  const known = twinless.get(books);
  if (known) return known;
  const left = books.some((book) => book.theirs)
    ? books.filter(
        (book) =>
          !book.theirs ||
          standInsOf({ books, library: NO_LIBRARY }).get(book.id) === undefined,
      )
    : books;
  twinless.set(books, left);
  return left;
}
