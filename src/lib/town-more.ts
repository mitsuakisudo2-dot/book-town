import {
  FEELINGS,
  ME_ID,
  type Book,
  type Feeling,
  type ReadingRecord,
  type TownState,
} from "./types";
import type { Series } from "./series";

// What the town reads when a page shows it, not with the town (AUD-006):
// another reader's records and 人生の9冊 on their profile's page, a book's
// records on its page, which feelings anyone kept and the books felt with
// one in the search, the books a search finds, and how often each book is
// shelved and talked of, of all time (counts). The
// town reads only a window of others' records and none of their nines
// (supabase/town-backend.ts, TOWN_VIEW_ARGS). What a page read is kept apart
// from the town, never saved, and laid over it for the page (withMore), so
// the town read again, or changed by the reader, keeps it.

/** What a page asks to be read for it. */
export type MoreAsk =
  | { reader: string }
  | { work: string }
  | { felt: true }
  | { feeling: Feeling }
  /** The books a search finds among all the reader may read (find_books). */
  | { search: string }
  /** The town's counts of all time, and the books most shelved and talked of (town_counts). */
  | { counts: true }
  /** The series a book of the ISBN is in, and their volumes' books (series_for_isbn, 管理表 13). */
  | { series: string };

/** One key per ask, to keep and share what was read. */
export function moreKey(ask: MoreAsk): string {
  if ("reader" in ask) return "reader:" + ask.reader;
  if ("work" in ask) return "work:" + ask.work;
  if ("felt" in ask) return "felt:";
  if ("search" in ask) return "search:" + ask.search;
  if ("counts" in ask) return "counts:";
  if ("series" in ask) return "series:" + ask.series;
  return "feeling:" + ask.feeling;
}

/** The ask a key (moreKey) was made from. */
export function askOfKey(key: string): MoreAsk | null {
  const at = key.indexOf(":");
  const [kind, value] = [key.slice(0, at), key.slice(at + 1)];
  if (kind === "reader") return { reader: value };
  if (kind === "work") return { work: value };
  if (kind === "felt") return { felt: true };
  if (kind === "search" && value.trim()) return { search: value };
  if (kind === "counts") return { counts: true };
  if (kind === "series" && value) return { series: value };
  if (kind === "feeling" && FEELINGS.includes(value as Feeling))
    return { feeling: value as Feeling };
  return null;
}

/** Another reader's 人生の9冊, in order, with their notes. */
export interface ReaderNine {
  readerId: string;
  lifeNine: string[];
  nineNotes: Record<string, string>;
}

/**
 * How many public shelves hold a book's work and how many 便り and replies
 * talk of it (reviews: those not replies), by everyone the reader may see,
 * of all time (town_counts). Never shown as a rank.
 */
export interface TownCount {
  shelves: number;
  talk: number;
  reviews: number;
}

/** What the database counted for the town, when the search opened. */
export interface TownCounts {
  /** By book id: the town's books when it was asked, and the books below. */
  books: Record<string, TownCount>;
  /** The books asked of; one without counts above is counted by none. */
  asked: string[];
  /** The works most shelved, the most first, each by a book of it. */
  shelved: CountedWork[];
  /** The works most talked of, the most first, each by a book of it. */
  talked: CountedWork[];
}

/**
 * A work the database counted, by the book it stood it for (the reader's own
 * first), and its work: the page shows it by the town's book of the work.
 */
export interface CountedWork {
  book: string;
  work: string | null;
}

/** What one ask brought, in the town's own shapes. */
export interface TownMore {
  /** Others' records; never the reader's own, which the town has whole. */
  records: ReadingRecord[];
  nines: ReaderNine[];
  /** The books they name that the town may not know. */
  books: Book[];
  /** Which feelings anyone in the town kept, of all time (felt_in_town). */
  felt?: Feeling[];
  counts?: TownCounts;
  /** The series a book is in (series.ts), their volumes' books among `books`. */
  series?: Series[];
}

export const emptyMore = (): TownMore => ({
  records: [],
  nines: [],
  books: [],
});

const time = (record: ReadingRecord) => Date.parse(record.createdAt) || 0;

/**
 * The town with what pages read laid over it: the feelings kept in it,
 * books it does not know,
 * others' records (a record it has without its words takes them from one
 * read with them) and others' nines. Only of readers the town knows and the
 * reader has not blocked, and of books it then knows. The town itself when
 * nothing is added, so a page draws again only when something came.
 */
export function withMore(
  state: TownState,
  more: readonly TownMore[],
): TownState {
  if (!more.length) return state;
  const knownBooks = new Set(state.books.map((book) => book.id));
  const books = [...state.books];
  for (const part of more)
    for (const book of part.books)
      if (!knownBooks.has(book.id)) {
        knownBooks.add(book.id);
        books.push(book);
      }
  const blocked = new Set(state.blocked);
  const readers = new Set(state.readers.map((reader) => reader.id));
  const shown = (readerId: string) =>
    readerId !== ME_ID && readers.has(readerId) && !blocked.has(readerId);

  const records = new Map(
    state.readingRecords.map((record) => [record.id, record]),
  );
  let recordsChanged = false;
  for (const part of more)
    for (const record of part.records) {
      if (!shown(record.readerId) || !knownBooks.has(record.bookId)) continue;
      const had = records.get(record.id);
      if (had && (had.readerId === ME_ID || had.note || !record.note)) continue;
      records.set(record.id, record);
      recordsChanged = true;
    }

  const nines = new Map<string, ReaderNine>();
  for (const part of more)
    for (const nine of part.nines)
      if (shown(nine.readerId)) nines.set(nine.readerId, nine);

  const felt = new Set(state.feltInTown);
  for (const part of more)
    for (const feeling of part.felt ?? []) felt.add(feeling);
  const feltChanged = felt.size !== (state.feltInTown?.length ?? 0);

  if (
    books.length === state.books.length &&
    !recordsChanged &&
    !nines.size &&
    !feltChanged
  )
    return state;
  return {
    ...state,
    books,
    ...(feltChanged
      ? { feltInTown: FEELINGS.filter((feeling) => felt.has(feeling)) }
      : {}),
    readingRecords: recordsChanged
      ? [...records.values()].sort((a, b) => time(a) - time(b))
      : state.readingRecords,
    readers: nines.size
      ? state.readers.map((reader) => {
          const nine = nines.get(reader.id);
          if (!nine) return reader;
          const lifeNine = nine.lifeNine.filter((id) => knownBooks.has(id));
          return {
            ...reader,
            lifeNine,
            nineNotes: Object.fromEntries(
              Object.entries(nine.nineNotes).filter(([id]) =>
                lifeNine.includes(id),
              ),
            ),
          };
        })
      : state.readers,
  };
}
