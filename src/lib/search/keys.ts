import type { Book } from "../types";
import {
  dropLongVowels,
  hasKanji,
  isKana,
  kanaFold,
  searchFold,
  strictFold,
} from "./fold";
import { kanaToRomaji } from "./romaji";
import { splitAuthors, splitTitle, type TitleParts } from "./title";

// What a book can be found by, worked out once per book and kept beside it.

export type KeyKind = "surface" | "base" | "reading" | "mixed" | "subtitle";

export interface Key {
  kind: KeyKind;
  /** searchFold: compared for equality, start and containment. */
  key: string;
  /** Characters in key. */
  size: number;
  /** strictFold of what was written or read; a mix of the two has none. */
  strict?: string;
  /** kanaFold, long vowels kept: its pairs of characters are counted for near titles. */
  loose: string;
  grams: Set<string>;
  /** The loose form in romaji, made when first needed. */
  romaji?: string;
  chars?: string[];
}

export interface BookKeys {
  title: Key[];
  subtitle: Key[];
  author: Key[];
  /** Each kanji run of the title with its reading: 人生 → じんせい. */
  ruby: Array<[string, string]>;
  genre: string;
  parts: TitleParts;
  /** For ordering equals: the reading when known, else the title. */
  sortKey: string;
  /** From a catalog: an ISBN, or a reading openBD or the library gave. */
  backed: boolean;
}

/** Each pair of neighbouring characters; a one-character text is its own gram. */
export function gramsOf(text: string): Set<string> {
  const chars = Array.from(text);
  const grams = new Set<string>();
  if (chars.length === 1) grams.add(chars[0]);
  for (let i = 0; i + 1 < chars.length; i++) grams.add(chars[i] + chars[i + 1]);
  return grams;
}

export function makeKey(raw: string, kind: KeyKind, written = false): Key {
  const key = foldedKey(kanaFold(raw), kind);
  if (written) key.strict = strictFold(raw);
  return key;
}

/** A key from text kanaFold has already folded. */
function foldedKey(loose: string, kind: KeyKind): Key {
  const key = dropLongVowels(loose);
  return {
    kind,
    key,
    size: Array.from(key).length,
    loose,
    grams: gramsOf(loose),
  };
}

/**
 * A reading as one run, and also word by word when that keeps a vowel the run
 * would lose: ロウジン ト ウミ is ろじんとみ as one run (と+う reads as a long
 * vowel), so うみ alone is found by ろじんとうみ.
 */
function readingKeys(reading: string): Key[] {
  const whole = makeKey(reading, "reading", true);
  const key = reading
    .split(/[\s,，、・]+/)
    .map((word) => searchFold(word))
    .join("");
  if (key === whole.key) return [whole];
  return [whole, { ...whole, key, size: Array.from(key).length }];
}

export const romajiOf = (key: { loose: string; romaji?: string }) =>
  (key.romaji ??= kanaToRomaji(key.loose));

/** The characters of the key, split when first needed. */
export const charsOf = (key: { key: string; chars?: string[] }) =>
  (key.chars ??= Array.from(key.key));

/**
 * The reading of each non-kana run of a folded title, anchored on its kana:
 * あなたの人生の物語 + あなたのじんせいのものがたり → 人生 じんせい, 物語 ものがたり.
 * A run of n characters takes n to 4n+2 kana. Null when they cannot line up.
 */
export function align(
  title: string,
  reading: string,
): Array<[string, string]> | null {
  const runs: Array<{ kana: boolean; text: string }> = [];
  for (const char of title) {
    const kana = isKana(char);
    const last = runs[runs.length - 1];
    if (last && last.kana === kana) last.text += char;
    else runs.push({ kana, text: char });
  }
  if (!runs.some((run) => !run.kana)) return null;
  const chars = Array.from(reading);
  const taken: string[] = [];
  // Shortest readings first; a place already found to lead nowhere is not tried twice.
  const deadEnds = new Set<number>();
  const walk = (at: number, from: number): boolean => {
    if (at === runs.length) return from === chars.length;
    const place = at * (chars.length + 1) + from;
    if (deadEnds.has(place)) return false;
    const run = runs[at];
    const size = Array.from(run.text).length;
    const [least, most] = run.kana ? [size, size] : [size, 4 * size + 2];
    for (
      let take = least;
      take <= most && from + take <= chars.length;
      take++
    ) {
      const part = chars.slice(from, from + take).join("");
      if (run.kana && part !== run.text) break;
      if (walk(at + 1, from + take)) {
        taken[at] = part;
        return true;
      }
    }
    deadEnds.add(place);
    return false;
  };
  return walk(0, 0) ? runs.map((run, i) => [run.text, taken[i]]) : null;
}

const CATALOG_SOURCES = new Set(["openbd", "ndl"]);
const known = new WeakMap<Book, BookKeys>();

export function keysOf(book: Book): BookKeys {
  const cached = known.get(book);
  if (cached) return cached;
  const parts = splitTitle(book.title);
  const surface = makeKey(book.title, "surface", true);
  const title = [surface];
  if (parts.base && searchFold(parts.base) !== surface.key)
    title.push(makeKey(parts.base, "base", true));
  const baseKey = searchFold(parts.base);
  // A title written only in kana, Latin letters or digits is its own reading.
  const reading =
    book.titleReading?.text ?? (hasKanji(parts.base) ? undefined : parts.base);
  const ruby: Array<[string, string]> = [];
  if (reading) {
    for (const key of readingKeys(reading))
      if (key.key !== baseKey && key.key !== surface.key) title.push(key);
    const pairs = align(kanaFold(parts.base), kanaFold(reading));
    if (pairs) {
      for (const [written, read] of pairs)
        if (written !== read) ruby.push([written, read]);
      // Longer runs are read first when a query is read with them.
      ruby.sort((a, b) => b[0].length - a[0].length);
      // Each mix of written and read runs (人生 as written, 物語 as read), up to four runs.
      const runs = pairs
        .map(([written, read], i) => (written === read ? -1 : i))
        .filter((i) => i >= 0)
        .slice(0, 4);
      for (let mask = 1; mask < (1 << runs.length) - 1; mask++)
        title.push(
          foldedKey(
            pairs
              .map(([written, read], i) => {
                const run = runs.indexOf(i);
                return run >= 0 && mask & (1 << run) ? read : written;
              })
              .join(""),
            "mixed",
          ),
        );
    }
  }
  const subtitle = [book.subtitle, parts.subtitle]
    .filter((text): text is string => Boolean(text))
    .map((text) => makeKey(text, "subtitle"));
  const author = splitAuthors(book.author).map((name) =>
    makeKey(name, "surface", true),
  );
  // A reading written 「家, 名」 is found in either order.
  for (const name of book.authorReading?.text.split(/[／/;；]/) ?? []) {
    author.push(...readingKeys(name));
    const [family, given] = name.split(/[,，]/);
    if (given) author.push(...readingKeys(given + " " + family));
  }
  const keys: BookKeys = {
    title,
    subtitle,
    author,
    ruby,
    genre: searchFold(book.genre ?? ""),
    parts,
    sortKey: book.titleReading
      ? searchFold(book.titleReading.text)
      : surface.key,
    backed:
      Boolean(book.isbn) ||
      CATALOG_SOURCES.has(book.titleReading?.source ?? ""),
  };
  known.set(book, keys);
  return keys;
}
