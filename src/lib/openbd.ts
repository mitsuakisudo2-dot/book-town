// What openBD (https://openbd.jp) knows of a book, by its ISBN: the title,
// author, publisher and list price used to register it. covers.ts asks the
// same questions (openBdQuestions) for covers.
//
// openBD takes up to 100 ISBNs in one question. A question it does not answer
// within four seconds is given up, so a reader is never left waiting on it:
// what was not found can always be typed by hand.

/** How many ISBNs openBD is asked about at once. */
export const OPENBD_BATCH = 100;
/** How long one question to openBD may take before it is given up. */
export const OPENBD_TIMEOUT_MS = 4000;

/** A book as openBD has it, ready to register. */
export interface OpenBdBook {
  isbn: string;
  title: string;
  /** The author as openBD writes it, less a trailing ／著. May be empty. */
  author: string;
  /** May be empty. */
  publisher: string;
  /** List price in yen, tax included, when openBD has one. */
  price?: number;
}

type OpenBdRecord = {
  summary?: { title?: string; author?: string; publisher?: string };
  onix?: {
    ProductSupply?: {
      SupplyDetail?: { Price?: Array<{ PriceAmount?: string }> };
    };
  };
} | null;

/** The questions to ask openBD about `isbns`: 100 ISBNs at a time. */
export function openBdQuestions(
  isbns: string[],
): { url: string; isbns: string[] }[] {
  const questions: { url: string; isbns: string[] }[] = [];
  for (let start = 0; start < isbns.length; start += OPENBD_BATCH) {
    const batch = isbns.slice(start, start + OPENBD_BATCH);
    questions.push({
      url: "https://api.openbd.jp/v1/get?isbn=" + batch.join(","),
      isbns: batch,
    });
  }
  return questions;
}

/** Reads openBD's answer: one record (or null) per ISBN, in the asked order. */
export function openBdBooks(
  isbns: string[],
  records: unknown[],
): Map<string, OpenBdBook> {
  const found = new Map<string, OpenBdBook>();
  (records as OpenBdRecord[]).forEach((record, index) => {
    const isbn = isbns[index];
    const title = record?.summary?.title?.trim();
    if (!isbn || !title) return;
    // openBD lists the price before tax; the app shows prices with tax included.
    const net = Number(
      record?.onix?.ProductSupply?.SupplyDetail?.Price?.[0]?.PriceAmount,
    );
    found.set(isbn, {
      isbn,
      title,
      author: (record?.summary?.author ?? "").replace(/／著.*$/, "").trim(),
      publisher: (record?.summary?.publisher ?? "").trim(),
      ...(Number.isFinite(net) && net > 0
        ? { price: Math.floor(net * 1.1) }
        : {}),
    });
  });
  return found;
}

/**
 * The books openBD has among `isbns`. Throws when openBD could not be asked,
 * or did not answer a question within four seconds.
 */
export async function lookUpBooks(
  isbns: string[],
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<Map<string, OpenBdBook>> {
  const found = new Map<string, OpenBdBook>();
  for (const question of openBdQuestions([...new Set(isbns)])) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), OPENBD_TIMEOUT_MS);
    try {
      const response = await fetcher(question.url, { signal: stop.signal });
      if (!response.ok) throw new Error("openBD " + response.status);
      const records: unknown = await response.json();
      if (!Array.isArray(records)) throw new Error("openBD answer");
      for (const [isbn, book] of openBdBooks(question.isbns, records))
        found.set(isbn, book);
    } finally {
      clearTimeout(timer);
    }
  }
  return found;
}

/**
 * The book with this ISBN, or null when openBD does not have it, could not be
 * asked, or was too slow: the title is then typed by hand.
 */
export async function lookUpBook(
  isbn: string,
  fetcher?: typeof fetch,
): Promise<OpenBdBook | null> {
  try {
    return (await lookUpBooks([isbn], fetcher)).get(isbn) ?? null;
  } catch {
    return null;
  }
}
