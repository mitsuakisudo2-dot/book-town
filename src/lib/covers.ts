"use client";

import { useEffect, useSyncExternalStore } from "react";

// A book with an ISBN shows its real cover when one of the sources below has
// it, asked in this order; a book none of them has keeps its BookTown
// 装丁カード (the jacket drawn from its title). A new source (Amazon, once
// the town sells enough to use it) is one more entry in COVER_SOURCES.
//
// Covers are shown as the source serves them, never cropped or drawn over.
// Google's are not kept beyond this page: only the answer that a book has no
// cover, and openBD's covers, are remembered by the browser for a while.

export type CoverSourceName = "openbd" | "google";

export interface Cover {
  url: string;
  source: CoverSourceName;
  /** The book's own page at the source, which its terms ask to link. */
  link?: string;
}

export interface CoverSource {
  name: CoverSourceName;
  /** Whether its answers may be remembered past this page. */
  keep: boolean;
  /** Covers for those of `isbns` it has. Throws when it could not be asked. */
  find(isbns: string[], fetcher: typeof fetch): Promise<Map<string, Cover>>;
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
    for (let start = 0; start < isbns.length; start += 100) {
      const batch = isbns.slice(start, start + 100);
      const response = await fetcher(
        "https://api.openbd.jp/v1/get?isbn=" + batch.join(","),
      );
      if (!response.ok) throw new Error("openBD " + response.status);
      const records = (await response.json()) as OpenBdRecord[];
      if (!Array.isArray(records)) throw new Error("openBD answer");
      for (const [isbn, cover] of openBdCovers(batch, records))
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

const googleBooks: CoverSource = {
  name: "google",
  keep: false,
  async find(isbns, fetcher) {
    const found = new Map<string, Cover>();
    // One ISBN per question, two at a time: Google answers no lists of them.
    const queue = [...isbns];
    const ask = async () => {
      for (let isbn = queue.shift(); isbn; isbn = queue.shift()) {
        const response = await fetcher(
          "https://www.googleapis.com/books/v1/volumes?q=isbn:" +
            isbn +
            "&maxResults=3&fields=items(volumeInfo(industryIdentifiers,imageLinks,canonicalVolumeLink,infoLink))" +
            (googleKey ? "&key=" + encodeURIComponent(googleKey) : ""),
        );
        if (!response.ok) throw new Error("Google Books " + response.status);
        const cover = googleCover(isbn, await response.json());
        if (cover) found.set(isbn, cover);
      }
    };
    await Promise.all([ask(), ask()]);
    return found;
  },
};

/** Where covers are looked for, first to last. */
export const COVER_SOURCES: CoverSource[] = [openBd, googleBooks];

// What is known: a cover, or null when every source said it has none.
const known = new Map<string, Cover | null>();
const waiting = new Set<string>();
const asked = new Set<string>();
/** Sources that failed on this page are not asked again until it reloads. */
const resting = new Set<CoverSourceName>();
const listeners = new Set<() => void>();

const STORAGE_KEY = "book-town-covers-v1";
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
    try {
      const found = await source.find(missing, fetcher);
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

let flushing: ReturnType<typeof setTimeout> | null = null;
function flush() {
  flushing = null;
  const isbns = [...waiting];
  waiting.clear();
  if (!isbns.length) return;
  void lookCovers(isbns, COVER_SOURCES, undefined, resting).then((answers) => {
    for (const [isbn, cover] of answers) known.set(isbn, cover);
    keep(answers);
    listeners.forEach((listener) => listener());
  });
}

function request(isbn: string) {
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

/** The real cover of the book with this ISBN, once found; null otherwise. */
export function useCover(isbn: string | undefined): Cover | null {
  useEffect(() => {
    if (isbn) request(isbn);
  }, [isbn]);
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!isbn) return null;
      restore();
      return known.get(isbn) ?? null;
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
