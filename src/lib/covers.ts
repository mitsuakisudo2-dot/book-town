"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { openBdQuestions } from "./openbd";

// A book with an ISBN shows its real cover when one of the sources below has
// it, asked in this order; a book none of them has keeps its BookTown
// 装丁カード (the jacket drawn from its title). A new source (Amazon, once
// the town sells enough to use it) is one more entry in COVER_SOURCES.
//
// Covers are shown as the source serves them, never cropped or drawn over.
// Google's are not kept beyond this page: only the answer that a book has no
// cover, and openBD's covers, are remembered by the browser for a while.
//
// A rights holder may ask (a cover removal request, filed as a report about
// the book) for a cover not to be shown. When the operator accepts, the
// database lists the ISBN and source in cover_refusals, and that source is
// simply not asked for that book: the next one is, or it keeps its 装丁カード.
// No image is ever altered or replaced by another.

export type CoverSourceName = "openbd" | "google";

export interface Cover {
  url: string;
  source: CoverSourceName;
  /** The book's own page at the source, which its terms ask to link. */
  link?: string;
}

/** A book's title, by ISBN, for sources that search by words. */
export type CoverNames = Map<string, string>;

export interface CoverSource {
  name: CoverSourceName;
  /** Whether its answers may be remembered past this page. */
  keep: boolean;
  /** Covers for those of `isbns` it has. Throws when it could not be asked. */
  find(
    isbns: string[],
    fetcher: typeof fetch,
    names: CoverNames,
  ): Promise<Map<string, Cover>>;
}

type OpenBdRecord = { summary?: { isbn?: string; cover?: string } } | null;

/** Reads openBD's answer: one record (or null) per ISBN, in the asked order. */
export function openBdCovers(
  isbns: string[],
  records: OpenBdRecord[],
): Map<string, Cover> {
  const found = new Map<string, Cover>();
  records.forEach((record, index) => {
    const url = record?.summary?.cover?.trim();
    const isbn = isbns[index];
    if (isbn && url && /^https:\/\//.test(url))
      found.set(isbn, { url, source: "openbd" });
  });
  return found;
}

const openBd: CoverSource = {
  name: "openbd",
  keep: true,
  async find(isbns, fetcher) {
    const found = new Map<string, Cover>();
    for (const question of openBdQuestions(isbns)) {
      const response = await fetcher(question.url);
      if (!response.ok) throw new Error("openBD " + response.status);
      const records = (await response.json()) as OpenBdRecord[];
      if (!Array.isArray(records)) throw new Error("openBD answer");
      for (const [isbn, cover] of openBdCovers(question.isbns, records))
        found.set(isbn, cover);
    }
    return found;
  },
};

type GoogleVolume = {
  volumeInfo?: {
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
};

const https = (url: string | undefined) =>
  url?.replace(/^http:\/\//, "https://");

/**
 * Reads Google Books' answer for one ISBN: the first volume that carries that
 * very ISBN, with Google's own plain thumbnail (asked without the page curl it
 * can draw on), and the volume's page on Google Books.
 */
export function googleCover(
  isbn: string,
  answer: { items?: GoogleVolume[] },
): Cover | null {
  for (const volume of answer.items ?? []) {
    const info = volume.volumeInfo;
    const same = info?.industryIdentifiers?.some(
      (id) => id.identifier?.replace(/-/g, "") === isbn,
    );
    const thumbnail = https(
      info?.imageLinks?.thumbnail ?? info?.imageLinks?.smallThumbnail,
    );
    if (!same || !thumbnail?.startsWith("https://")) continue;
    const link = https(info?.canonicalVolumeLink ?? info?.infoLink);
    return {
      url: thumbnail.replace(/&edge=curl/g, ""),
      source: "google",
      ...(link?.startsWith("https://") ? { link } : {}),
    };
  }
  return null;
}

const googleKey = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY;

/**
 * The questions Google is asked for one book, first to last. Since early
 * October 2026 Google's field searches (isbn:, intitle:) come back empty, even
 * for volumes it serves, while plain words still find them; so the book's
 * title is asked first, then its ISBN, in case the field search comes back.
 * Only the title: the author as the book was registered ("Chiang,Ted,1967-
 * 公手,成幸,1949-") rarely matches how Google writes it ("テッド・チャン"), and
 * words Google cannot match lose the book. Whichever answers, only a volume
 * carrying that very ISBN is used (googleCover).
 */
export function googleQuestions(isbn: string, title?: string): string[] {
  // Quotes, colons and a leading minus would read as Google's own syntax.
  const words = (title ?? "")
    .replace(/[":]/g, " ")
    .replace(/(^|\s)-+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const fields =
    "&fields=items(volumeInfo(industryIdentifiers,imageLinks,canonicalVolumeLink,infoLink))" +
    (googleKey ? "&key=" + encodeURIComponent(googleKey) : "");
  const ask = (q: string, most: number) =>
    "https://www.googleapis.com/books/v1/volumes?q=" +
    encodeURIComponent(q) +
    "&maxResults=" +
    most +
    fields;
  return [...(words ? [ask(words, 40)] : []), ask("isbn:" + isbn, 3)];
}

const googleBooks: CoverSource = {
  name: "google",
  keep: false,
  async find(isbns, fetcher, names) {
    const found = new Map<string, Cover>();
    // One book per question, two at a time: Google answers no lists of them.
    const queue = [...isbns];
    const ask = async () => {
      for (let isbn = queue.shift(); isbn; isbn = queue.shift()) {
        for (const question of googleQuestions(isbn, names.get(isbn))) {
          const response = await fetcher(question);
          if (!response.ok) throw new Error("Google Books " + response.status);
          const cover = googleCover(isbn, await response.json());
          if (cover) {
            found.set(isbn, cover);
            break;
          }
        }
      }
    };
    await Promise.all([ask(), ask()]);
    return found;
  },
};

/** Where covers are looked for, first to last. */
export const COVER_SOURCES: CoverSource[] = [openBd, googleBooks];

/** Sources not to ask for a book, by ISBN (cover_refusals). */
export type CoverRefusals = Map<string, Set<CoverSourceName>>;

/** The refusals as the list the database gives them. */
export function coverRefusalsFrom(
  rows: { isbn: string; source: string }[],
): CoverRefusals {
  const refused: CoverRefusals = new Map();
  for (const row of rows) {
    if (!COVER_SOURCES.some((source) => source.name === row.source)) continue;
    const sources = refused.get(row.isbn) ?? new Set<CoverSourceName>();
    sources.add(row.source as CoverSourceName);
    refused.set(row.isbn, sources);
  }
  return refused;
}

/**
 * A cover as it may be shown: none when its source is refused for the book,
 * or when the refusals could not be read (then no outside cover is shown on
 * this page, rather than one that was asked to be taken down).
 */
export function shownCover(
  isbn: string,
  cover: Cover | null,
  refusals: CoverRefusals | "unreadable",
): Cover | null {
  if (!cover) return null;
  if (refusals === "unreadable") return null;
  return refusals.get(isbn)?.has(cover.source) ? null : cover;
}

// What is known: a cover, or null when every source said it has none.
const known = new Map<string, Cover | null>();
const waiting = new Set<string>();
const asked = new Set<string>();
const names: CoverNames = new Map();
/** Sources that failed on this page are not asked again until it reloads. */
const resting = new Set<CoverSourceName>();
const listeners = new Set<() => void>();

// v1 and v2 were written while Google was asked in ways it answered nothing
// to (see googleQuestions), so their "no cover" answers are not trusted.
const STORAGE_KEY = "book-town-covers-v3";
const OLD_STORAGE_KEYS = ["book-town-covers-v1", "book-town-covers-v2"];
const DAY = 24 * 60 * 60 * 1000;
/** A found cover is trusted for a month, an absent one checked again in days. */
const KEEP_FOUND = 30 * DAY;
const KEEP_NONE = 3 * DAY;
const KEEP_MOST = 600;

type Kept = Record<string, { at: number; cover: Cover | null }>;

function readKept(): Kept {
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return kept && typeof kept === "object" ? (kept as Kept) : {};
  } catch {
    return {};
  }
}

let restored = false;
function restore() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    for (const key of OLD_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // Nothing to drop.
  }
  const now = Date.now();
  for (const [isbn, entry] of Object.entries(readKept())) {
    const age = now - (entry?.at ?? 0);
    const cover = entry?.cover ?? null;
    const valid =
      cover === null ||
      (cover.source === "openbd" &&
        typeof cover.url === "string" &&
        cover.url.startsWith("https://"));
    if (valid && age >= 0 && age < (cover ? KEEP_FOUND : KEEP_NONE))
      known.set(isbn, cover);
  }
}

function keep(answers: Map<string, Cover | null>) {
  try {
    const kept = readKept();
    const now = Date.now();
    for (const [isbn, cover] of answers)
      if (
        cover === null ||
        COVER_SOURCES.find((s) => s.name === cover.source)?.keep
      )
        kept[isbn] = { at: now, cover };
    const entries = Object.entries(kept)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, KEEP_MOST);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Remembered for this page only.
  }
}

/**
 * Asks the sources, in order, for the covers of `isbns`: each source is asked
 * only for the books the ones before it did not have. A book is settled as
 * having no cover only when every source could be asked.
 */
export async function lookCovers(
  isbns: string[],
  sources: CoverSource[] = COVER_SOURCES,
  fetcher: typeof fetch = (...args) => fetch(...args),
  rest: Set<CoverSourceName> = new Set(),
  refused: CoverRefusals = new Map(),
  names: CoverNames = new Map(),
): Promise<Map<string, Cover | null>> {
  const answers = new Map<string, Cover | null>();
  let missing = [...isbns];
  let complete = true;
  for (const source of sources) {
    if (!missing.length) break;
    if (rest.has(source.name)) {
      complete = false;
      continue;
    }
    // A source refused for a book is passed over for it; the next is asked.
    const asking = missing.filter(
      (isbn) => !refused.get(isbn)?.has(source.name),
    );
    if (!asking.length) continue;
    try {
      const found = await source.find(asking, fetcher, names);
      for (const [isbn, cover] of found) answers.set(isbn, cover);
      missing = missing.filter((isbn) => !found.has(isbn));
    } catch {
      rest.add(source.name);
      complete = false;
    }
  }
  if (complete) for (const isbn of missing) answers.set(isbn, null);
  return answers;
}

// Which covers rights holders asked us not to show. Read once a page, before
// any source is asked, from the loader the town registers (town-session.ts);
// a build without a database has none, so nothing is refused.
let refusalLoader: (() => Promise<{ isbn: string; source: string }[]>) | null =
  null;
let refusals: CoverRefusals | "unreadable" | null = null;
let readingRefusals: Promise<CoverRefusals | "unreadable"> | null = null;

/** Where the refused covers are read from. */
export function setCoverRefusalLoader(
  load: () => Promise<{ isbn: string; source: string }[]>,
) {
  refusalLoader = load;
  refusals = null;
  readingRefusals = null;
}

function readRefusals(): Promise<CoverRefusals | "unreadable"> {
  if (!refusalLoader) return Promise.resolve(new Map());
  readingRefusals ??= refusalLoader()
    .then(coverRefusalsFrom, () => "unreadable" as const)
    .then((read) => {
      refusals = read;
      // A cover remembered from before it was refused is asked for again,
      // so the book can fall back to the next source.
      if (read !== "unreadable")
        for (const [isbn, cover] of known)
          if (cover && !shownCover(isbn, cover, read)) {
            known.delete(isbn);
            asked.delete(isbn);
            request(isbn);
          }
      listeners.forEach((listener) => listener());
      return read;
    });
  return readingRefusals;
}

let flushing: ReturnType<typeof setTimeout> | null = null;
function flush() {
  flushing = null;
  const isbns = [...waiting];
  waiting.clear();
  if (!isbns.length) return;
  void readRefusals().then(async (refused) => {
    if (refused === "unreadable") {
      // Not settled for good: the next page asks again.
      for (const isbn of isbns) known.set(isbn, null);
    } else {
      const answers = await lookCovers(
        isbns,
        COVER_SOURCES,
        undefined,
        resting,
        refused,
        names,
      );
      for (const [isbn, cover] of answers) known.set(isbn, cover);
      keep(answers);
    }
    listeners.forEach((listener) => listener());
  });
}

function request(isbn: string, title?: string) {
  if (title && !names.has(isbn)) names.set(isbn, title);
  restore();
  if (known.has(isbn) || asked.has(isbn)) return;
  asked.add(isbn);
  waiting.add(isbn);
  // The books on one screen are asked together.
  flushing ??= setTimeout(flush, 40);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether an element is on the screen or near it, and once it was, it stays
 * so. A jacket asks for its cover only then (AUD-164): a search of fifty
 * catalog rows asks the sources, Google's shared daily quota among them, for
 * the few a reader can see, and for the rest as they are scrolled to. With
 * no IntersectionObserver, always.
 */
export function useNearScreen(): [
  (element: Element | null) => () => void,
  boolean,
] {
  const [near, setNear] = useState(false);
  const watch = useCallback((element: Element | null) => {
    if (!element) return () => {};
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return () => {};
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [watch, near];
}

/**
 * The real cover of the book with this ISBN, once found; null otherwise. Its
 * title lets Google find it (see googleQuestions). It is asked for when
 * `ask` (a jacket: once near the screen, useNearScreen); a cover found
 * before shows either way.
 */
export function useCover(
  isbn: string | undefined,
  name?: { title: string },
  ask = true,
): Cover | null {
  const title = name?.title;
  useEffect(() => {
    if (!isbn || !ask) return;
    request(isbn, title);
    // Remembered covers wait for the refusals too, even when nothing is asked.
    void readRefusals();
  }, [isbn, title, ask]);
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!isbn) return null;
      restore();
      const cover = known.get(isbn) ?? null;
      if (!cover || !refusalLoader) return cover;
      // Until the refusals are read, a remembered cover waits.
      return refusals ? shownCover(isbn, cover, refusals) : null;
    },
    () => null,
  );
}

// Google asks for its mark beside the books it gave covers for, and once.
// Every Google cover on screen counts itself here, as does every book that
// shows the mark beside itself; the page shows its own mark while covers are
// on screen and no book already shows it.
const onScreen = { covers: 0, marks: 0 };
const creditListeners = new Set<() => void>();
function counting(kind: keyof typeof onScreen): () => void {
  onScreen[kind] += 1;
  creditListeners.forEach((listener) => listener());
  return () => {
    onScreen[kind] -= 1;
    creditListeners.forEach((listener) => listener());
  };
}
export const countGoogleCover = () => counting("covers");
export const countGoogleMark = () => counting("marks");

/** Whether the page should show Google's mark for the covers on it. */
export const useGoogleCoversShown = () =>
  useSyncExternalStore(
    (listener) => {
      creditListeners.add(listener);
      return () => {
        creditListeners.delete(listener);
      };
    },
    () => onScreen.covers > 0 && onScreen.marks === 0,
    () => false,
  );
