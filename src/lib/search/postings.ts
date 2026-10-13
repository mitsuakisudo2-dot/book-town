import type { Book } from "../types";
import { hasKanji } from "./fold";
import { gramsOf, keysOf } from "./keys";

// Which books share enough pairs of characters with a query to be worth
// scoring. A title or name that holds the query shares all of its pairs, and
// a near title at least a quarter of the query's, so neither is skipped. The
// first character counts as one more: two letters swapped in a short query
// (そりらす for そらりす) can leave no pair in common, but never the start.

export interface Postings {
  books: readonly Book[];
  lists: Map<string, number[]>;
}

const built = new WeakMap<readonly Book[], Postings>();

/** Pairs, single kanji and first characters of a text: what a book is listed under. */
export function bookGrams(texts: Iterable<{ key: string; loose: string }>) {
  const grams = new Set<string>();
  for (const { key, loose } of texts) {
    for (const gram of gramsOf(loose)) grams.add(gram);
    for (const gram of gramsOf(key)) grams.add(gram);
    const chars = Array.from(key);
    if (chars.length) grams.add("^" + chars[0]);
    for (const char of chars)
      if (char >= "\u3400" && hasKanji(char)) grams.add(char);
  }
  return grams;
}

export function postingsOf(books: readonly Book[]): Postings {
  const cached = built.get(books);
  if (cached) return cached;
  const lists = new Map<string, number[]>();
  books.forEach((book, at) => {
    const keys = keysOf(book);
    // A base title or a mix of written and read runs has no pair that the
    // whole title or its reading lacks.
    const title = keys.title.filter(
      (key) => key.kind === "surface" || key.kind === "reading",
    );
    for (const gram of bookGrams([
      ...title,
      ...keys.subtitle,
      ...keys.author,
    ])) {
      const list = lists.get(gram);
      if (list) list.push(at);
      else lists.set(gram, [at]);
    }
  });
  const postings = { books, lists };
  built.set(books, postings);
  return postings;
}

/**
 * Builds a list's index while the page is idle, so the first letter typed does
 * not wait for it (a few hundred ms on a slow phone). Returns a cancel.
 */
export function prepareSearch(books: readonly Book[]): () => void {
  if (typeof window === "undefined" || !books.length || built.has(books))
    return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => postingsOf(books), {
      timeout: 2000,
    });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(() => postingsOf(books), 300);
  return () => clearTimeout(timer);
}

export interface QueryGrams {
  grams: Set<string>;
  /** How many a book must share. */
  need: number;
}

/** What one form of a query looks for, and how much of it is enough. */
export function queryGrams(key: string, loose: string): QueryGrams {
  const chars = Array.from(key);
  if (chars.length === 1) return { grams: new Set([key, "^" + key]), need: 1 };
  const byLoose = gramsOf(loose);
  const byKey = gramsOf(key);
  const grams = new Set([...byLoose, ...byKey, "^" + chars[0]]);
  return {
    grams,
    need: Math.max(1, Math.ceil(Math.min(byLoose.size, byKey.size) / 4)),
  };
}

/** Books sharing enough with any one form of the query, in the order given. */
export function candidates(postings: Postings, forms: QueryGrams[]): Book[] {
  const kept = new Set<number>();
  for (const form of forms) {
    const shared = new Map<number, number>();
    for (const gram of form.grams)
      for (const at of postings.lists.get(gram) ?? [])
        shared.set(at, (shared.get(at) ?? 0) + 1);
    for (const [at, count] of shared) if (count >= form.need) kept.add(at);
  }
  return [...kept].sort((a, b) => a - b).map((at) => postings.books[at]);
}
