import { normalizeIsbn } from "../books";
import type { Book } from "../types";
import {
  dropLongVowels,
  hasKanji,
  kanaFold,
  searchFold,
  strictFold,
} from "./fold";
import {
  charsOf,
  gramsOf,
  keysOf,
  romajiOf,
  type BookKeys,
  type Key,
} from "./keys";
import {
  candidates,
  postingsOf,
  queryGrams,
  type QueryGrams,
} from "./postings";
import { romajiToKana } from "./romaji";
import { isSoftTerm } from "./title";
import { sameVolume, volumeMark } from "./volume";

// Finding books for a query and putting them in order (docs: search design
// §5–6). Every match has a class; a higher class always comes first. Within a
// class, a title spelled as typed comes before one that only matches once long
// vowels or は/わ are folded (おじいさん before おじさん), then the closer match.

export const MATCH = {
  isbn: 9,
  title: 8,
  titleStart: 7,
  titleWithin: 6,
  author: 5,
  everyWord: 4,
  titleTypo: 3,
  other: 2,
  nearTitle: 1,
  nearAuthor: 0,
} as const;

export interface BookMatch {
  book: Book;
  /** One of MATCH. */
  rank: number;
  /** Only close in spelling: shown apart, under 「近い題名の本」. */
  near: boolean;
  /** Found through the title's reading, so the reading can be shown with it. */
  byReading: boolean;
}

export interface SearchOptions {
  /** How present a book is in the town; nudges near-equal matches, never shown. */
  presence?: (bookId: string) => number;
  /** The reader's own books, first among equals (pickers). */
  own?: ReadonlySet<string>;
  limit?: number;
  /**
   * The ids of the books a genre alone finds (a genre chip such as 登録した本);
   * any other is found only by its title, author or ISBN. Every book when absent.
   */
  genreFinds?: ReadonlySet<string>;
  /** Score every book instead of those the gram index keeps (tests compare the two). */
  unpruned?: boolean;
}

/** Enter in a picker takes the first book only when it is this sure. */
export const strongMatch = (match: BookMatch) => match.rank >= MATCH.titleStart;

/**
 * The book Enter takes in a picker: the first, only when it is surely the one
 * meant (a title that begins so, or the one book found). Never a near title.
 */
export function surePick(
  books: readonly Book[],
  query: string,
  options: SearchOptions = {},
): Book | null {
  const now = searchBooks(books, query, { ...options, limit: 2 });
  const first = now[0];
  return first && (strongMatch(first) || (now.length === 1 && !first.near))
    ? first.book
    : null;
}

/** The quiet heading near matches stand under, named for what was close. */
export function nearHeading(near: readonly BookMatch[]): string {
  const authors = near.filter((match) => match.rank === MATCH.nearAuthor);
  if (!authors.length) return "近い題名の本";
  return authors.length === near.length
    ? "著者名が近い本"
    : "題名や著者名が近い本";
}

interface Form {
  kind: "typed" | "romaji" | "ruby";
  key: string;
  size: number;
  loose: string;
  grams: Set<string>;
  strict?: string;
  romaji?: string;
  chars?: string[];
  kanji: boolean;
  /** Romaji still being typed: it may only begin a title. */
  startOnly: boolean;
  /** For romaji ending in n: the kana that may come next (な, の, ん…). */
  next?: string;
}

function makeForm(
  kind: Form["kind"],
  text: string,
  strict?: string,
  startOnly = false,
  next?: string,
): Form {
  const loose = kanaFold(text);
  const key = dropLongVowels(loose);
  return {
    kind,
    key,
    size: Array.from(key).length,
    loose,
    grams: gramsOf(loose),
    ...(strict === undefined ? {} : { strict }),
    kanji: hasKanji(key),
    startOnly,
    ...(next ? { next } : {}),
  };
}

/** The text as typed, and as kana when it is romaji. */
function formsOf(text: string): Form[] {
  const forms: Form[] = [];
  const typed = makeForm("typed", text, strictFold(text));
  if (typed.key) forms.push(typed);
  const romaji = romajiToKana(text);
  if (romaji?.kana) {
    const read = makeForm(
      "romaji",
      romaji.kana,
      strictFold(romaji.kana),
      !!romaji.tail,
    );
    if (read.key) forms.push(read);
  }
  // A last n is ん, or the start of な, の or に still being typed: "mien" is
  // みえん, and also みえ before an n-row kana (見えない都市).
  const trimmed = text.trim();
  if (romaji && !romaji.tail && /[^n']n$/i.test(trimmed)) {
    const before = romajiToKana(trimmed.slice(0, -1));
    if (before?.kana && !before.tail) {
      const read = makeForm(
        "romaji",
        before.kana,
        undefined,
        true,
        "なにぬねのん",
      );
      if (read.key) forms.push(read);
    }
  }
  return forms;
}

/** The query read with this book's readings: あなたのいのちの物語 → …のものがたり. */
function rubyForm(typed: Form | undefined, keys: BookKeys): Form | null {
  if (!typed?.kanji || typed.kind !== "typed" || !keys.ruby.length) return null;
  let read = typed.loose;
  for (const [written, reading] of keys.ruby)
    if (read.includes(written)) read = read.split(written).join(reading);
  if (read === typed.loose) return null;
  const form = makeForm("ruby", read);
  return form.key && form.key !== typed.key ? form : null;
}

interface Hit {
  rank: number;
  /** 2 spelled exactly as typed, 1 with long vowels as typed, 0 only once folded. */
  spelling: number;
  score: number;
  /** Shared pairs of characters, for near matches. */
  dice?: number;
  /** Found through the title's reading or a mix of reading and writing. */
  byReading: boolean;
}

/** Of two hits for one book, the higher class, then the truer spelling, then the closer. */
const better = (a: Hit | null, b: Hit | null) =>
  !a ||
  (b && (b.rank - a.rank || b.spelling - a.spelling || b.score - a.score) > 0)
    ? b
    : a;

/** Typos allowed for a query this long: none below 4 characters, 2 from 10. */
const allowance = (size: number) => (size >= 10 ? 2 : size >= 4 ? 1 : 0);

/**
 * Edits (add, drop, change, or swap two neighbours) from the query to the
 * key or to its start; anything above `most` is reported as most + 1.
 */
function typoDistance(query: string[], key: string[], most: number): number {
  const target = key.slice(0, query.length + most);
  let older: number[] = [];
  let previous = target.map((_, j) => j).concat(target.length);
  for (let i = 1; i <= query.length; i++) {
    const row = [i];
    for (let j = 1; j <= target.length; j++) {
      let cost = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (query[i - 1] === target[j - 1] ? 0 : 1),
      );
      if (
        i > 1 &&
        j > 1 &&
        query[i - 1] === target[j - 2] &&
        query[i - 2] === target[j - 1]
      )
        cost = Math.min(cost, older[j - 2] + 1);
      row.push(cost);
    }
    if (Math.min(...row) > most && Math.min(...previous) > most)
      return most + 1;
    older = previous;
    previous = row;
  }
  return Math.min(...previous);
}

function commonSubsequence(a: string, b: string): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = [0];
    for (let j = 1; j <= b.length; j++)
      row.push(
        a[i - 1] === b[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], row[j - 1]),
      );
    previous = row;
  }
  return previous[b.length];
}

function commonStart(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

interface Classes {
  exact: number;
  start: number;
  within: number;
  typo: number;
  near: number;
}
const TITLE: Classes = {
  exact: MATCH.title,
  start: MATCH.titleStart,
  within: MATCH.titleWithin,
  typo: MATCH.titleTypo,
  near: MATCH.nearTitle,
};
const AUTHOR: Classes = {
  exact: MATCH.author,
  start: MATCH.author,
  within: MATCH.everyWord,
  typo: MATCH.other,
  near: MATCH.nearAuthor,
};
const SUBTITLE: Classes = {
  exact: MATCH.other,
  start: MATCH.other,
  within: MATCH.other,
  typo: -1,
  near: -1,
};

type Relation = (key: string, typed: string) => boolean;
const equals: Relation = (key, typed) => key === typed;
const begins: Relation = (key, typed) => key.startsWith(typed);
const holds: Relation = (key, typed) => key.includes(typed);

/**
 * How truly the key spells the query, for the relation that matched: as
 * written (はな is not わな), or with the long vowels typed (おじいさん is not
 * おじさん), which readings show too. Romaji still being typed is unsure.
 */
function spellingOf(form: Form, key: Key, relation: Relation): number {
  if (form.startOnly) return 0;
  if (
    form.strict !== undefined &&
    key.strict !== undefined &&
    relation(key.strict, form.strict)
  )
    return 2;
  return relation(key.loose, form.loose) ? 1 : 0;
}

/** Whether the key goes on with a kana the romaji's last n may begin. */
function nextFits(form: Form, key: Key): boolean {
  if (!form.next) return true;
  const after = key.key.charAt(form.key.length);
  return after !== "" && form.next.includes(after);
}

function matchKeys(forms: Form[], keys: Key[], classes: Classes): Hit | null {
  let best: Hit | null = null;
  for (const form of forms)
    for (const key of keys) {
      const read = key.kind === "reading" || key.kind === "mixed";
      // Only a title's reading is shown beside a match.
      const byReading = read && classes === TITLE;
      const ratio = form.size / key.size;
      let hit: Hit | null = null;
      // A query read with the book's readings only brings near titles closer.
      if (form.kind === "ruby") hit = nearHit(form, key, classes, byReading);
      else if (key.key === form.key && !form.startOnly)
        hit = {
          rank: classes.exact,
          spelling: spellingOf(form, key, equals),
          score: 1,
          byReading,
        };
      else if (key.key.startsWith(form.key) && nextFits(form, key))
        hit = {
          rank: classes.start,
          spelling: spellingOf(form, key, begins),
          score: ratio,
          byReading,
        };
      else if (form.startOnly) continue;
      else if (
        classes.within >= 0 &&
        (form.size >= 2 || form.kanji) &&
        key.key.includes(form.key)
      )
        hit = {
          rank: classes.within,
          spelling: spellingOf(form, key, holds),
          score: ratio,
          byReading,
        };
      else
        hit =
          typoHit(form, key, classes, read, byReading) ??
          nearHit(form, key, classes, byReading);
      best = better(best, hit);
    }
  return best;
}

function typoHit(
  form: Form,
  key: Key,
  classes: Classes,
  read: boolean,
  byReading: boolean,
): Hit | null {
  const most = allowance(form.size);
  // Typos compare like with like: a query with kanji only with what was written.
  if (
    !most ||
    classes.typo < 0 ||
    (form.kanji && read) ||
    key.size < form.size - most
  )
    return null;
  const edits = typoDistance(charsOf(form), charsOf(key), most);
  return edits <= most
    ? {
        rank: classes.typo,
        spelling: 0,
        score: 0.97 * (1 - edits / form.size),
        byReading,
      }
    : null;
}

function nearHit(
  form: Form,
  key: Key,
  classes: Classes,
  byReading: boolean,
): Hit | null {
  if (classes.near < 0 || form.size < 2) return null;
  let shared = 0;
  for (const gram of form.grams) if (key.grams.has(gram)) shared++;
  const dice = (2 * shared) / (form.grams.size + key.grams.size);
  if (shared < 2 || dice < 0.4) return null;
  // The letters both spell, in romaji, and how much of the start they share.
  const a = romajiOf(form);
  const b = romajiOf(key);
  const letters = (2 * commonSubsequence(a, b)) / (a.length + b.length);
  const start = Math.min(commonStart(form.key, key.key), 4) / 4;
  return {
    rank: classes.near,
    spelling: 0,
    score: 0.5 * dice + 0.5 * letters + 0.1 * start,
    dice,
    byReading,
  };
}

interface Query {
  forms: Form[];
  /** The query folded, and its length. */
  key: string;
  size: number;
  /** Each word of a query of several words. */
  words: Form[][];
  /** Edition and volume words asked for after the title. */
  soft: string[];
  pruning: QueryGrams[];
}

function readQuery(raw: string): Query | null {
  const typed = raw.normalize("NFKC").trim().slice(0, 100);
  const all = typed.split(/\s+/).filter(Boolean);
  const soft = all.filter((word, i) => i > 0 && isSoftTerm(word));
  const words = all.filter((word, i) => !(i > 0 && isSoftTerm(word)));
  const forms = formsOf(words.join(" "));
  if (!forms.length) return null;
  const byWord = words.length > 1 ? words.map(formsOf) : [];
  const key = searchFold(words.join(""));
  return {
    forms,
    key,
    size: Array.from(key).length,
    words: byWord,
    soft,
    pruning: [...forms, ...byWord.flat()].map((form) =>
      queryGrams(form.key, form.loose),
    ),
  };
}

const genreMatch = (query: Query, genre: string) =>
  Boolean(genre) &&
  (genre === query.key || (query.size >= 2 && genre.includes(query.key)));

// An ISBN as people type it: with an ISBN label, with hyphens, minus signs or
// the long-vowel bar a Japanese keyboard types for "-", in full or half width.
const ISBN_LABEL = /^isbn(?:[-‐]?1[03])?\s*[:：]?\s*/i;
const ISBN_DASHES = /[\s\-‐‑‒–—―−ーｰ－]/g;
const isbnTyped = (query: string) =>
  query
    .normalize("NFKC")
    .trim()
    .replace(ISBN_LABEL, "")
    .replace(ISBN_DASHES, "")
    .toUpperCase();

/**
 * What the database is asked for a query (find_books): the pairs each form
 * looks for and how many are enough, as the books here are pruned with, or
 * the ISBN typed whole or begun. Null when nothing searchable was typed.
 */
export interface DatabaseSearch {
  forms: Array<{ grams: string[]; need: number }>;
  isbn: string | null;
  isbnStart: string | null;
}

export function databaseSearch(query: string): DatabaseSearch | null {
  const digits = isbnTyped(query);
  if (/^(97[89])?\d{9}[\dX]$/.test(digits))
    return {
      forms: [],
      isbn: normalizeIsbn(digits) ?? digits,
      isbnStart: null,
    };
  const read = readQuery(query);
  if (!read) return null;
  return {
    forms: read.pruning.map(({ grams, need }) => ({ grams: [...grams], need })),
    isbn: null,
    isbnStart: /^\d{5,12}$/.test(digits) ? digits : null,
  };
}

/** Whether a book's ISBN begins with digits still being typed (as ISBN-13, or as ISBN-10). */
function isbnBegins(book: Book, digits: string): boolean {
  const isbn = book.isbn ? normalizeIsbn(book.isbn) : null;
  if (!isbn) return false;
  return (
    isbn.startsWith(digits) ||
    (isbn.startsWith("978") && digits.length <= 9 && isbn.startsWith(digits, 3))
  );
}

function scoreBook(query: Query, keys: BookKeys, byGenre = true): Hit | null {
  const ruby = rubyForm(query.forms[0], keys);
  const forms = ruby ? [...query.forms, ruby] : query.forms;
  let best = better(
    better(
      matchKeys(forms, keys.title, TITLE),
      matchKeys(forms, keys.author, AUTHOR),
    ),
    matchKeys(forms, keys.subtitle, SUBTITLE),
  );
  // Genres are local: they keep the genre buttons working.
  if (byGenre && genreMatch(query, keys.genre))
    best = better(best, {
      rank: MATCH.other,
      spelling: 0,
      score: query.size / Array.from(keys.genre).length,
      byReading: false,
    });
  if (query.words.length) {
    const all = [...keys.title, ...keys.author, ...keys.subtitle];
    const found = query.words.every((word) =>
      word.some((form) => all.some((key) => key.key.includes(form.key))),
    );
    if (found)
      best = better(best, {
        rank: MATCH.everyWord,
        spelling: 0,
        score: Math.min(1, query.size / Math.max(1, keys.title[0].size)),
        byReading: false,
      });
  }
  return best;
}

/** Whether the book is the edition or volume a soft word asks for (文庫, 下). */
function softMatch(soft: string[], keys: BookKeys): boolean {
  return soft.some((word) => {
    const mark = volumeMark(word);
    return mark !== null
      ? keys.parts.mark !== "" && sameVolume(mark, keys.parts.mark)
      : keys.parts.edition.includes(word);
  });
}

/** A small step for presence: 0–3, so one shelf counts and many do not count much more. */
const presenceStep = (presence: number) =>
  Math.min(3, Math.floor(Math.log2(1 + Math.max(0, presence))));

/** Books for a query, best first: the matches, then the near titles (`near`). */
export const searchBooks = (
  books: readonly Book[],
  query: string,
  options: SearchOptions = {},
): BookMatch[] => rankBooks(books, query, options).map(({ match }) => match);

/** searchBooks with how close each match is within its class (for tests; never shown). */
export function rankBooks(
  books: readonly Book[],
  query: string,
  options: SearchOptions = {},
): Array<{ match: BookMatch; order: number }> {
  const limit = options.limit ?? 50;
  const digits = isbnTyped(query);
  if (/^(97[89])?\d{9}[\dX]$/.test(digits)) {
    const isbn = normalizeIsbn(digits) ?? digits;
    return books
      .filter((book) => book.isbn && normalizeIsbn(book.isbn) === isbn)
      .slice(0, limit)
      .map((book) => ({
        match: { book, rank: MATCH.isbn, near: false, byReading: false },
        order: 1,
      }));
  }
  const read = readQuery(query);
  if (!read) return [];
  const pool = new Set(
    options.unpruned ? books : candidates(postingsOf(books), read.pruning),
  );
  const genreFinds = (book: Book) => options.genreFinds?.has(book.id) ?? true;
  let byGenre = false;
  let genreAsked = false;
  for (const book of books) {
    const genre = keysOf(book).genre;
    if (!genreMatch(read, genre) || !genreFinds(book)) continue;
    pool.add(book);
    byGenre = true;
    genreAsked ||= genre === read.key;
  }
  // An ISBN still being typed keeps its book in sight.
  const isbnStart = /^\d{5,12}$/.test(digits) ? digits : "";
  if (isbnStart)
    for (const book of books) if (isbnBegins(book, isbnStart)) pool.add(book);

  const scored: Array<{ book: Book; keys: BookKeys; hit: Hit; order: number }> =
    [];
  for (const book of pool) {
    const keys = keysOf(book);
    let hit = scoreBook(read, keys, genreFinds(book));
    // Ranked with titles that hold the query: not sure enough for Enter.
    if (isbnStart && isbnBegins(book, isbnStart))
      hit = better(hit, {
        rank: MATCH.titleWithin,
        spelling: 2,
        score: isbnStart.length / 13,
        byReading: false,
      });
    if (!hit) continue;
    const order =
      hit.score +
      (softMatch(read.soft, keys) ? 0.02 : 0) +
      (0.04 * presenceStep(options.presence?.(book.id) ?? 0)) / 3;
    scored.push({ book, keys, hit, order });
  }

  // Near titles only while they are close, and closer still beside real
  // matches or a genre; none at all when the query names a genre (a chip).
  const sure =
    byGenre || scored.some((entry) => entry.hit.rank >= MATCH.everyWord);
  const closest = Math.max(
    0,
    ...scored
      .filter((entry) => entry.hit.rank <= MATCH.nearTitle)
      .map((entry) => entry.hit.dice ?? 0),
  );
  const shown = scored.filter(({ hit }) => {
    if (hit.rank > MATCH.nearTitle) return true;
    if (genreAsked) return false;
    const dice = hit.dice ?? 0;
    const floor = sure || hit.rank === MATCH.nearAuthor ? 0.6 : 0.4;
    return dice >= floor && dice >= closest - 0.3;
  });

  const own = options.own;
  const length = (text: string) => Array.from(text).length;
  shown.sort(
    (a, b) =>
      b.hit.rank - a.hit.rank ||
      b.hit.spelling - a.hit.spelling ||
      b.order - a.order ||
      length(a.keys.parts.base) - length(b.keys.parts.base) ||
      a.keys.parts.volume - b.keys.parts.volume ||
      Number(b.keys.backed) - Number(a.keys.backed) ||
      Number(own?.has(b.book.id) ?? 0) - Number(own?.has(a.book.id) ?? 0) ||
      a.keys.sortKey.localeCompare(b.keys.sortKey, "ja") ||
      (a.book.id < b.book.id ? -1 : a.book.id > b.book.id ? 1 : 0),
  );
  return shown.slice(0, limit).map(({ book, hit, order }) => ({
    match: {
      book,
      rank: hit.rank,
      near: hit.rank <= MATCH.nearTitle,
      byReading: hit.byReading && Boolean(book.titleReading),
    },
    order,
  }));
}
