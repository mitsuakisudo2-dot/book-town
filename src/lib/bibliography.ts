// The bibliographic master as the app reads it: what public.book_bibliography
// gives for a book (docs/09「書誌マスタ」). Each field is the operator's
// correction, the library's (国立国会図書館) or openBD's, the first that has
// one. The database gives it only for a book anyone may see used, or the
// reader's own, once it is judged to be the ISBN's (「食い違いの判定と保留」),
// so a book without one shows what its reader typed, as before.
//
// How it reads on screen (title with its volume, the people and what they
// did, the publisher and the date) is src/lib/book-name.ts's.

/** A person of the master's, in the order the book names them (docs/09「著者の形」). */
export interface BibliographyPerson {
  /** As printed on the book, without years: "John Doe", "山田一郎". */
  name: string;
  /** What they did, as the source wrote it: 著, 訳, [著], or openBD's codes ("A01,B06"). */
  role?: string;
}

/** A series the edition is in: a 文庫, a 叢書, a magazine's run. */
export interface BibliographySeries {
  name: string;
  number?: string;
}

export interface Bibliography {
  title: string;
  subtitle?: string;
  /** The volume as the source wrote it: "2", "下", "no.1". */
  volume?: string;
  /** 新訳版, 増補改訂版… */
  edition?: string;
  series: BibliographySeries[];
  creators: BibliographyPerson[];
  publisher?: string;
  /** The year, or the year and month: "2014", "2014-06". */
  issued?: string;
  /** Where what the screen shows came from, the library first (a credit beside it). */
  from: BibliographySource[];
}

/** The sources a master's fields come from (an operator's correction aside). */
export type BibliographySource = "ndl" | "openbd";

/** The sources by name, as a credit says them (the credits page has the rest). */
export const SOURCE_NAMES: Record<BibliographySource, string> = {
  ndl: "国立国会図書館",
  openbd: "openBD",
};

/** The fields a screen shows, whose sources it names. */
const SHOWN = [
  "title",
  "subtitle",
  "volume",
  "edition",
  "series",
  "creators",
  "publisher",
  "issued",
];

/** A row of public.book_bibliography, as the database sends it. */
export interface BibliographyRow {
  book_id: string;
  title: string | null;
  subtitle: string | null;
  volume: string | null;
  edition: string | null;
  series: unknown;
  creators: unknown;
  publisher: string | null;
  issued: string | null;
  /** Where each field came from: { title: "ndl", publisher: "openbd", … }. */
  sources: unknown;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const objects = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];

/**
 * The master of one book, from its row; null for a row with no title (the
 * database leaves those out, so this is only for a row that is not one of
 * its own).
 */
export function bibliographyFrom(row: BibliographyRow): Bibliography | null {
  const title = text(row.title);
  if (!title) return null;
  const subtitle = text(row.subtitle);
  const volume = text(row.volume);
  const edition = text(row.edition);
  const publisher = text(row.publisher);
  const issued = text(row.issued);
  const sources =
    typeof row.sources === "object" && row.sources !== null
      ? (row.sources as Record<string, unknown>)
      : {};
  const named = new Set(SHOWN.map((field) => sources[field]));
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(volume ? { volume } : {}),
    ...(edition ? { edition } : {}),
    series: objects(row.series).flatMap((item) => {
      const name = text(item.name);
      const number = text(item.number);
      return name ? [{ name, ...(number ? { number } : {}) }] : [];
    }),
    creators: objects(row.creators).flatMap((item) => {
      const name = text(item.name);
      const role = text(item.role);
      return name ? [{ name, ...(role ? { role } : {}) }] : [];
    }),
    ...(publisher ? { publisher } : {}),
    ...(issued && /^[0-9]{4}(-[0-9]{2})?$/.test(issued) ? { issued } : {}),
    from: (["ndl", "openbd"] as const).filter((source) => named.has(source)),
  };
}
