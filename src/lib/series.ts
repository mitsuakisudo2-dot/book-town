import { normalizeIsbn } from "./books";
import { bookById } from "./book-name";
import type { LibrarySet } from "./library";
import type { Book, NewBook, TownActions, TownState } from "./types";

// シリーズのまとめ登録 (管理表 13): the volumes of the series a book is in,
// as series_for_isbn reads them (docs/機能/本と書誌.md「シリーズと巻」), and
// registering those the reader picks. Only volumes the catalog has are
// listed, each by its own ISBN: none is made up (資料 6章「黙って架空の版を
// 確定登録しない」), and what the catalog does not have of a series is not
// shown as missing. A volume is the reader's when their library has a book of
// its ISBN: the same edition, never another line's (愛蔵版の1巻 is not
// 通常版の1巻, 資料 6章).

/** One volume: its place in its line, and the catalog's book of it. */
export interface SeriesVolume {
  number: number;
  /** How the number is written for it ("3", "上"). */
  shown: string;
  isbn: string;
  /** The catalog's book of it (a row the reader may read). */
  bookId: string;
  /** The catalog's title of it, as read with the series. */
  catalogTitle: string;
}

/** One line of a series (通常版, 愛蔵版…), its volumes in order. */
export interface SeriesLine {
  id: string;
  /** The line's own name, when it has one. */
  name: string | null;
  /** The label the library gives it (叢書・レーベル), when it has one. */
  label: string | null;
  volumes: SeriesVolume[];
}

export interface Series {
  id: string;
  name: string;
  /** Said by the operator only: until then, "the volumes known so far". */
  finished: boolean;
  lines: SeriesLine[];
}

/** A row of series_for_isbn, as the database answers. */
export interface SeriesRow {
  series_id: string;
  series_name: string;
  kind: string;
  finished: boolean;
  line_id: string;
  line_name: string | null;
  line_label: string | null;
  number: number;
  shown: string | null;
  volume_isbn: string | null;
  book_id: string;
  title: string | null;
}

/**
 * The series in series_for_isbn's rows, each line's volumes in order. Only
 * series of volumes: a yearly one (「2026年版」) is one work a year, not
 * volumes to collect. A row without an ISBN or a book is left out.
 */
export function seriesFromRows(rows: readonly SeriesRow[]): Series[] {
  const found = new Map<string, Series>();
  for (const row of rows) {
    if (row.kind !== "volumes") continue;
    const isbn = row.volume_isbn ? normalizeIsbn(row.volume_isbn) : null;
    if (!isbn || !row.book_id || !Number.isInteger(row.number)) continue;
    let series = found.get(row.series_id);
    if (!series) {
      series = {
        id: row.series_id,
        name: row.series_name,
        finished: row.finished,
        lines: [],
      };
      found.set(row.series_id, series);
    }
    let line = series.lines.find((entry) => entry.id === row.line_id);
    if (!line) {
      line = {
        id: row.line_id,
        name: row.line_name || null,
        label: row.line_label || null,
        volumes: [],
      };
      series.lines.push(line);
    }
    if (line.volumes.some((volume) => volume.isbn === isbn)) continue;
    line.volumes.push({
      number: row.number,
      shown: row.shown || String(row.number),
      isbn,
      bookId: row.book_id,
      catalogTitle: row.title ?? "",
    });
  }
  for (const series of found.values())
    for (const line of series.lines)
      line.volumes.sort((a, b) => a.number - b.number);
  // A series of one volume has nothing to collect.
  return [...found.values()].filter((series) =>
    series.lines.some((line) => line.volumes.length > 1),
  );
}

/** The line a book of `isbn` is in, else the first. */
export function lineOf(series: Series, isbn: string | undefined): SeriesLine {
  const code = isbn ? normalizeIsbn(isbn) : null;
  return (
    series.lines.find((line) =>
      line.volumes.some((volume) => volume.isbn === code),
    ) ?? series.lines[0]
  );
}

/**
 * The reader's books by ISBN: those in their library (their own, or the
 * catalog's), for telling which volumes are theirs.
 */
export function libraryByIsbn(
  state: Pick<TownState, "books" | "library">,
): Map<string, Book> {
  const found = new Map<string, Book>();
  for (const id of state.library) {
    const book = bookById(state.books, id);
    const isbn = book?.isbn ? normalizeIsbn(book.isbn) : null;
    if (book && isbn && !found.has(isbn)) found.set(isbn, book);
  }
  return found;
}

/** What registering the picked volumes came to. */
export interface VolumesRegistered {
  /** The library's books they are now, in the order picked. */
  added: string[];
  /** Already in the library (another tab, another device). */
  already: number;
  /** Not taken: the town still loading, or the account unreadable. */
  notSaved: number;
}

/**
 * Registers the volumes, each by its own ISBN as a scan does (registerBook:
 * a book the town has of it, else the reader's own), then gives each new one
 * what the sheet set (`changes`: its status and 所有, as a 連続設定 writes
 * them, sortChanges). A book already in the library keeps what it has. Each
 * goes in by itself, so one not taken leaves the others in.
 */
export function registerVolumes(
  actions: Pick<TownActions, "registerBook" | "changeLibrary">,
  volumes: readonly { volume: SeriesVolume; author: string }[],
  changes: readonly LibrarySet[],
): VolumesRegistered {
  const done: VolumesRegistered = { added: [], already: 0, notSaved: 0 };
  for (const { volume, author } of volumes) {
    const book: NewBook = {
      title: volume.catalogTitle,
      author,
      isbn: volume.isbn,
    };
    // The reader's own registering, by the volume's ISBN (出会った場所:
    // 自分で登録, library.ts MET_PLACES).
    const made = actions.registerBook(book, "isbn");
    if (!made || made.result === "not-saved") done.notSaved += 1;
    else if (made.result === "already") done.already += 1;
    else {
      done.added.push(made.bookId);
      for (const set of changes) actions.changeLibrary([made.bookId], set);
    }
  }
  return done;
}
