import { hasKanji, searchFold } from "./fold";
import { romajiToKana } from "./romaji";

// Names, @IDs, shop names and tags are found the way books are: folded alike
// (hiragana and katakana, full and half width, long vowels, old kanji), with
// romaji read as kana. Each field is matched on its own, as if a separator
// stood between them, so a query never runs from one field into the next.

/** How a short text matches: a higher number is a closer match; none is 0. */
export const TEXT_MATCH = { none: 0, within: 1, start: 2, exact: 3 } as const;

interface Form {
  key: string;
  size: number;
  kanji: boolean;
  /** Romaji still being typed ("nag"): it may only begin a field. */
  startOnly: boolean;
}

function formsOf(text: string): Form[] {
  const forms: Form[] = [];
  const add = (raw: string, startOnly: boolean) => {
    const key = searchFold(raw);
    if (key && !forms.some((form) => form.key === key))
      forms.push({
        key,
        size: Array.from(key).length,
        kanji: hasKanji(key),
        startOnly,
      });
  };
  add(text, false);
  const romaji = romajiToKana(text);
  if (romaji?.kana) add(romaji.kana, Boolean(romaji.tail));
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

/**
 * Like the book search: the same text, the start of it, or (from two
 * characters, or one kanji) anywhere in it.
 */
function relate(form: Form, key: string): number {
  if (!key) return TEXT_MATCH.none;
  if (key === form.key && !form.startOnly) return TEXT_MATCH.exact;
  if (key.startsWith(form.key)) return TEXT_MATCH.start;
  if (
    !form.startOnly &&
    (form.size >= 2 || form.kanji) &&
    key.includes(form.key)
  )
    return TEXT_MATCH.within;
  return TEXT_MATCH.none;
}

/**
 * How closely any of the fields matches the query (TEXT_MATCH). A query of
 * several words also matches when each word is found in one of the fields.
 */
export function textMatch(
  query: TextQuery | null,
  fields: readonly (string | null | undefined)[],
): number {
  if (!query) return TEXT_MATCH.none;
  const keys = fields.map((field) => searchFold(field ?? "")).filter(Boolean);
  let best: number = TEXT_MATCH.none;
  for (const form of query.whole)
    for (const key of keys) best = Math.max(best, relate(form, key));
  if (best || !query.words.length) return best;
  const every = query.words.every((forms) =>
    forms.some((form) => keys.some((key) => relate(form, key))),
  );
  return every ? TEXT_MATCH.within : TEXT_MATCH.none;
}

/** Whether a typed query finds any of the fields. */
export const textMatches = (
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean => textMatch(readTextQuery(query), fields) > TEXT_MATCH.none;

/** Whether two words are the same once folded: #ホラー is #ほらー, #ＳＦ is #sf. */
export const sameText = (a: string, b: string): boolean => {
  const key = searchFold(a);
  return key ? key === searchFold(b) : a.toLowerCase() === b.toLowerCase();
};

/** Keeps what matches, closest first; equals keep the order they came in. */
export function byMatch<T>(list: readonly T[], score: (item: T) => number) {
  return list
    .map((item, at) => ({ item, at, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((entry) => entry.item);
}
