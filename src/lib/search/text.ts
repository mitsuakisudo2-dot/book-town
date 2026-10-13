import { hasKanji, kanaFold, searchFold, strictFold } from "./fold";
import { romajiToKana } from "./romaji";

// Names, @IDs, shop names and tags are found the way books are: folded alike
// (hiragana and katakana, full and half width, long vowels, old kanji), with
// romaji read as kana. Each field is matched on its own, as if a separator
// stood between them, so a query never runs from one field into the next.

/** How a short text matches: a higher number is a closer match; none is 0. */
export const TEXT_MATCH = { none: 0, within: 1, start: 2, exact: 3 } as const;

/**
 * Added to a match that also holds as written, long vowels and は/わ kept:
 * ゆき before ゆうき for 「ゆき」, and かんな before かなこ for "kan". Less
 * than one step, so it only orders matches of the same kind.
 */
const AS_WRITTEN = 0.5;

interface Form {
  key: string;
  /** The same text with long vowels and は/わ kept (kanaFold). */
  written: string;
  size: number;
  kanji: boolean;
  /** Romaji still being typed ("nag"): it may only begin a field. */
  startOnly: boolean;
  /** For romaji ending in n: the kana that may come next (な, の, ん…). */
  next?: string;
}

function formsOf(text: string): Form[] {
  const forms: Form[] = [];
  const add = (raw: string, startOnly: boolean, next?: string) => {
    const key = searchFold(raw);
    if (key && !forms.some((form) => form.key === key))
      forms.push({
        key,
        written: kanaFold(raw),
        size: Array.from(key).length,
        kanji: hasKanji(key),
        startOnly,
        ...(next ? { next } : {}),
      });
  };
  add(text, false);
  const romaji = romajiToKana(text);
  if (romaji?.kana) add(romaji.kana, Boolean(romaji.tail));
  // As in the book search, a last n is ん, or the start of な, の or に still
  // being typed: "an" is あん, and also あ before an n-row kana (あなた).
  if (romaji && !romaji.tail && /[^n']n$/i.test(text)) {
    const before = romajiToKana(text.slice(0, -1));
    if (before?.kana && !before.tail) add(before.kana, true, "なにぬねのん");
  }
  return forms;
}

export interface TextQuery {
  /** The whole query, spaces left out: as typed, and as kana when it is romaji. */
  whole: Form[];
  /** Each word of a query of several words, the same way. */
  words: Form[][];
}

/** A query read once, for matching many texts. Null when nothing searchable was typed. */
export function readTextQuery(raw: string): TextQuery | null {
  const text = (raw ?? "").normalize("NFKC").trim().slice(0, 100);
  const whole = formsOf(text);
  if (!whole.length) return null;
  const words = text.split(/\s+/).filter(Boolean);
  return {
    whole,
    words:
      words.length > 1
        ? words.map(formsOf).filter((forms) => forms.length)
        : [],
  };
}

/** Whether the text goes on with a kana the romaji's last n may begin. */
function nextFits(form: Form, key: string): boolean {
  if (!form.next) return true;
  const after = key.charAt(form.key.length);
  return after !== "" && form.next.includes(after);
}

/** A field read for matching: folded, and as written. */
interface Field {
  key: string;
  written: string;
}

/**
 * Like the book search: the same text, the start of it, or (from two
 * characters, or one kanji) anywhere in it. A match that also holds as
 * written comes first among its kind; romaji still being typed never does.
 */
function relate(form: Form, field: Field): number {
  const { key, written } = field;
  if (!key) return TEXT_MATCH.none;
  const level =
    key === form.key && !form.startOnly
      ? TEXT_MATCH.exact
      : key.startsWith(form.key) && nextFits(form, key)
        ? TEXT_MATCH.start
        : !form.startOnly &&
            (form.size >= 2 || form.kanji) &&
            key.includes(form.key)
          ? TEXT_MATCH.within
          : TEXT_MATCH.none;
  if (!level || form.startOnly || !form.written) return level;
  const holds =
    level === TEXT_MATCH.exact
      ? written === form.written
      : level === TEXT_MATCH.start
        ? written.startsWith(form.written)
        : written.includes(form.written);
  return holds ? level + AS_WRITTEN : level;
}

/**
 * How closely any of the fields matches the query, for ordering: TEXT_MATCH,
 * plus AS_WRITTEN when the match also holds as written. A query of several
 * words also matches (as within) when each word is found in one of the fields.
 */
export function textRank(
  query: TextQuery | null,
  fields: readonly (string | null | undefined)[],
): number {
  if (!query) return TEXT_MATCH.none;
  const read = fields
    .map((field) => ({
      key: searchFold(field ?? ""),
      written: kanaFold(field ?? ""),
    }))
    .filter((field) => field.key);
  let best: number = TEXT_MATCH.none;
  for (const form of query.whole)
    for (const field of read) best = Math.max(best, relate(form, field));
  if (best || !query.words.length) return best;
  const every = query.words.every((forms) =>
    forms.some((form) => read.some((field) => relate(form, field))),
  );
  return every ? TEXT_MATCH.within : TEXT_MATCH.none;
}

/** How closely any of the fields matches the query: one of TEXT_MATCH. */
export const textMatch = (
  query: TextQuery | null,
  fields: readonly (string | null | undefined)[],
): number => Math.floor(textRank(query, fields));

/** Whether a typed query finds any of the fields. */
export const textMatches = (
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean => textMatch(readTextQuery(query), fields) > TEXT_MATCH.none;

/**
 * One word however it was written: hiragana or katakana, full or half width,
 * capitals, old kanji and the long-vowel mark aside (#ホラー is #ほら, #ＳＦ is
 * #sf). Unlike a search, it keeps は and へ and every other kana, so #へび is
 * not #えび. A word of marks alone (ー・) is kept as written.
 */
export const textKey = (text: string): string =>
  strictFold(text).replace(/ー/g, "") || text.toLowerCase();

/** Whether two words are one written another way (textKey): #ミステリー is #みすてり. */
export const sameText = (a: string, b: string): boolean =>
  textKey(a) === textKey(b);

/** Keeps what matches, closest first; equals keep the order they came in. */
export function byMatch<T>(list: readonly T[], score: (item: T) => number) {
  return list
    .map((item, at) => ({ item, at, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((entry) => entry.item);
}
