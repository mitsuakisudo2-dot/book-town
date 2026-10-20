import type { Bibliography } from "./bibliography";
import type { Book } from "./types";

// How a book is named on screen, in one place. Every screen reads a book's
// title and author through these, and finds a book by its ID or ISBN with
// bookById / bookByIsbn, so that when the name comes from somewhere else
// (the edition's bibliographic record, a volume number, more than one
// author), only this file changes. tests/book-name.test.ts keeps screens
// from reading `.title` / `.author` or quoting 『』 by hand again.
//
// Data that is saved or searched (registering, editing, the search index,
// the database rows) works on the book's own fields, not on these.

/** What a name is made from: a book, or the bits of one a draft carries. */
export type Named = Pick<Book, "title" | "author">;

/** The book's title as a reader sees it. */
export const bookTitle = (book: Pick<Book, "title">): string => book.title;

/** The title in 『』, as it sits inside a sentence. */
export const quotedTitle = (book: Pick<Book, "title">): string =>
  quote(bookTitle(book));

/** A title already worded, in 『』 (for a title kept as text, not a book). */
export const quote = (title: string): string => `『${title}』`;

/** The book's author as a reader sees it. */
export const bookAuthor = (book: Pick<Book, "author">): string =>
  authorWords(book.author);

/** A life's years at the end of a catalogue heading: ",1947-", ",1894-1961". */
const YEARS = /\s*,?\s*[0-9]{3,4}\??\s*-\s*([0-9]{3,4}\??)?\s*$/;
/** A second part that is years, not a given name: "-2026", "pub. 2021", "1962-L". */
const DATED = /^(pub\.\s*)?-?[0-9]{2,4}[0-9.?]*(\s*-\s*[0-9]{0,4}\??)?[A-Z]?$/;
/** What stays after a romaji name: "John Doe Jr.". */
const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV)$/;

/**
 * One person of a catalogue heading as the master names them, the way
 * private.bib_person does (the same examples, tests/fixtures/authority-names.ts):
 * no years, a romaji name given name first, a Japanese one joined, and
 * nothing of what the authority writes after the given name ("弁護士",
 * "-2026", "pub. 2021"). None when it is not a heading.
 */
function headed(person: string): string | undefined {
  if (!person.includes(",")) return undefined;
  const parts = person
    .replace(YEARS, "")
    .split(",")
    .map((part) => part.trim());
  const [family, given = "", ...rest] = parts;
  if (!family) return undefined;
  if (parts.length < 2) return family;
  if (DATED.test(given)) return family;
  if (!given) return undefined;
  if (!/[A-Za-z]/.test(family + given)) return family + given;
  // The catalogue runs a given name and its initial together
  // ("JamesP."); the initial gets its space back.
  return [
    given.replace(/([a-z])([A-Z]\.?)$/, "$1 $2"),
    family,
    rest.find((part) => SUFFIX.test(part)),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * An author written the way a library catalogue heads it ("King,Stephen,1947-
 * 小尾,芙佐,1932-"), in the shape the bibliographic master names people
 * (docs/09「著者の形」, private.bib_person): people one after another with
 * "、". A word without a comma belongs to the person before it when that
 * one already has what comes after the name ("海野,波子,1950- 東洋史",
 * "こもれび,pub. 2026"). Anything else is the author as written.
 */
export function authorWords(author: string): string {
  const people: string[] = [];
  for (const word of author.trim().split(/\s+/)) {
    const last = people.at(-1);
    if (last !== undefined && !word.includes(",") && /,.*,|,pub\.$/.test(last))
      people[people.length - 1] = `${last} ${word}`;
    else people.push(word);
  }
  const names = people.map(headed);
  if (!names.every(Boolean)) return author;
  return names.join("、");
}

// The bibliographic master's name for a book (src/lib/bibliography.ts),
// where a screen shows it: the book's page. What the reader typed stays
// theirs on their own shelf.

/** The master's title with its volume: "進撃の巨人 2", "ノルウェイの森 下". */
export function masterTitle(
  bib: Pick<Bibliography, "title" | "volume">,
): string {
  const volume = bib.volume;
  if (!volume) return bib.title;
  // openBD's title may carry the volume already ("進撃の巨人(2)", "… 2"),
  // set apart from the title's own last word ("2001" is not volume 1).
  const escaped = volume
    .normalize("NFKC")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(])${escaped}\\)?$`).test(
    bib.title.normalize("NFKC"),
  )
    ? bib.title
    : `${bib.title} ${volume}`;
}

/** The line under the title: the subtitle and the edition (新訳版), if any. */
export const masterSubtitle = (
  bib: Pick<Bibliography, "subtitle" | "edition">,
): string | undefined =>
  [bib.subtitle, bib.edition].filter(Boolean).join(" ") || undefined;

/** openBD's ONIX role codes this names (the rest go unnamed). */
const ONIX_ROLES: Record<string, string> = {
  A01: "著",
  A12: "絵",
  A38: "原作",
  B01: "編",
  B06: "訳",
};

/** What a person did, as a word: 著, 訳, 他訳; nothing when the source says nothing. */
function roleWord(role: string | undefined): string {
  if (!role) return "";
  if (/^[A-Z][0-9]{2}(,[A-Z][0-9]{2})*$/.test(role))
    return (
      role
        .split(",")
        .map((code) => ONIX_ROLES[code])
        .find(Boolean) ?? ""
    );
  return role.replace(/[[\]［］]/g, "").trim();
}

/**
 * The people of the master, in the book's order, a part for each thing they
 * did: ["宮沢賢治"], ["ジェーン・ドウ、山田花子"]. What they did is said when
 * it is not all 著: ["ジェーン・ドウ 著", "山田一郎 訳"], one role after the
 * names that share it. None when the master names no one.
 */
export function masterAuthorParts(
  bib: Pick<Bibliography, "creators">,
): string[] {
  const people = bib.creators.map((person) => ({
    name: person.name,
    role: roleWord(person.role),
  }));
  if (!people.length) return [];
  if (people.every((person) => person.role === "" || person.role === "著"))
    return [people.map((person) => person.name).join("、")];
  const groups: { role: string; names: string[] }[] = [];
  for (const person of people) {
    const last = groups.at(-1);
    if (last && last.role === person.role) last.names.push(person.name);
    else groups.push({ role: person.role, names: [person.name] });
  }
  return groups.map(
    // A no-break space: the role stays on the line of its last name.
    ({ role, names }) => names.join("、") + (role ? "\u00a0" + role : ""),
  );
}

/** The same in a line: "ジェーン・ドウ 著／山田一郎 訳". */
export const masterAuthor = (bib: Pick<Bibliography, "creators">): string =>
  masterAuthorParts(bib).join("／");

/** "2014年6月" for "2014-06", "2014年" for "2014". */
const issuedWords = (issued: string): string => {
  const [year, month] = issued.split("-");
  return month ? `${year}年${Number(month)}月` : `${year}年`;
};

/** Who published it, in which series, and when: 早川書房, ハヤカワ文庫SF, 2003年9月. */
export const masterPublicationParts = (
  bib: Pick<Bibliography, "publisher" | "series" | "issued">,
): string[] =>
  [
    bib.publisher,
    bib.series[0]?.name,
    bib.issued && issuedWords(bib.issued),
  ].filter((part): part is string => Boolean(part));

/** The same in a line: "早川書房・ハヤカワ文庫SF・2003年9月". */
export const masterPublication = (
  bib: Pick<Bibliography, "publisher" | "series" | "issued">,
): string | undefined => masterPublicationParts(bib).join("・") || undefined;

/**
 * The book as its page shows it: named by the master, where it has one, so
 * that the 装丁カード, the cover's lookup and the shop links read as the
 * heading does. The people go by name only ("ジェーン・ドウ、山田一郎").
 */
export function bookNamedBy<T extends Named>(
  book: T,
  master: Bibliography | null,
): T {
  if (!master) return book;
  const names = master.creators.map((person) => person.name).join("、");
  return { ...book, title: masterTitle(master), author: names || book.author };
}

/** What a book's page heads it with: the master's, where it has one. */
export interface BookHeading {
  title: string;
  /** The subtitle and the edition. */
  subtitle?: string;
  /** The people, a part for each role ("ジェーン・ドウ 著", "山田一郎 訳"). */
  author: string[];
  /** The publisher, the series and the date. */
  publication: string[];
}

/**
 * The heading of a book's page: the master's title, people and publication
 * once there is one, else what the reader typed, as before.
 */
export function bookHeading(
  book: Named,
  master: Bibliography | null,
): BookHeading {
  const typed = bookAuthor(book);
  if (!master)
    return {
      title: bookTitle(book),
      author: typed ? [typed] : [],
      publication: [],
    };
  const people = masterAuthorParts(master);
  return {
    title: masterTitle(master),
    subtitle: masterSubtitle(master),
    author: people.length ? people : typed ? [typed] : [],
    publication: masterPublicationParts(master),
  };
}

/** The book with this ID, if the town has it. */
export function bookById<T extends Pick<Book, "id">>(
  books: readonly T[],
  id: string | null | undefined,
): T | undefined {
  if (!id) return undefined;
  return books.find((book) => book.id === id);
}

/** The books with these IDs, in order, leaving out any the town lacks. */
export const booksById = <T extends Pick<Book, "id">>(
  books: readonly T[],
  ids: readonly (string | null | undefined)[],
): T[] =>
  ids
    .map((id) => bookById(books, id))
    .filter((book): book is T => Boolean(book));

/**
 * A book with this ISBN, if the town has one the reader may take as it is:
 * one another reader typed in is theirs (own-books.ts), its words theirs too,
 * so it is never taken, nor what it says filled in.
 */
export function bookByIsbn<T extends Pick<Book, "isbn" | "theirs">>(
  books: readonly T[],
  isbn: string | null | undefined,
): T | undefined {
  if (!isbn) return undefined;
  return books.find((book) => book.isbn === isbn && !book.theirs);
}

/**
 * Every book with this ISBN, another reader's too: for what the ISBN itself
 * tells (its edition's work), never to take one or fill in its words
 * (bookByIsbn).
 */
export function booksOfIsbn<T extends Pick<Book, "isbn">>(
  books: readonly T[],
  isbn: string | null | undefined,
): T[] {
  if (!isbn) return [];
  return books.filter((book) => book.isbn === isbn);
}

/** The title of the book with this ID, if the town has it. */
export const titleById = (
  books: readonly Book[],
  id: string | null | undefined,
): string | undefined => {
  const book = bookById(books, id);
  return book && bookTitle(book);
};
