"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  POSTER_FONTS,
  POSTER_LIMITS,
  POSTER_TEMPLATES,
  POSTER_THEMES,
  type PosterDraft,
  type PosterPage,
} from "./posters";

// A poster being made is kept in this browser while it is made, so a closed
// tab or a slip of the 戻る button does not lose it. Cleared once it is kept
// for real (put up, or left as a draft in the town).

export const POSTER_DRAFT_KEY = "book-town-poster-drafts-v1";

/** What the editor is in the middle of; whether it is put up is chosen last. */
export type PosterWork = Omit<PosterDraft, "status">;
export type KeptPosterWork = PosterWork & {
  /** When it was last changed, to tell it from a poster changed since. */
  at: string;
};
type Snapshot = { drafts: Record<string, KeptPosterWork>; saved: boolean };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const initial: Snapshot = { drafts: {}, saved: true };

/** Which poster the work belongs to: a new one, one about a book, or one being changed. */
export const posterWorkKey = (options: {
  posterId?: string;
  bookId?: string;
}): string =>
  options.posterId
    ? "poster:" + options.posterId
    : options.bookId
      ? "book:" + options.bookId
      : "new";

const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && [...value].length <= limit;

/**
 * Work read back from storage, if it is still the shape the editor makes.
 * Its books are checked against the town later: the town may still be loading.
 */
function readWork(value: unknown): KeptPosterWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<KeptPosterWork>;
  if (
    !POSTER_TEMPLATES.includes(work.template as never) ||
    !POSTER_THEMES.includes(work.theme as never) ||
    !POSTER_FONTS.includes(work.font as never) ||
    typeof work.spoiler !== "boolean" ||
    typeof work.inTimeline !== "boolean" ||
    typeof work.at !== "string" ||
    !Array.isArray(work.pages) ||
    !work.pages.length ||
    work.pages.length > POSTER_LIMITS.pages
  )
    return null;
  const pages: PosterPage[] = [];
  for (const page of work.pages as unknown[]) {
    const entry = page as Partial<PosterPage> | null;
    if (
      !entry ||
      !text(entry.heading, POSTER_LIMITS.heading) ||
      !text(entry.text, POSTER_LIMITS.text) ||
      !Array.isArray(entry.bookIds) ||
      entry.bookIds.length > POSTER_LIMITS.booksPerPage ||
      !entry.bookIds.every((id) => typeof id === "string")
    )
      return null;
    pages.push({
      heading: entry.heading,
      text: entry.text,
      bookIds: [...entry.bookIds],
    });
  }
  return {
    template: work.template!,
    theme: work.theme!,
    font: work.font!,
    spoiler: work.spoiler,
    inTimeline: work.inTimeline,
    pages,
    at: work.at,
  };
}

export function createPosterDraftStore(storage: () => DraftStorage) {
  let snapshot = initial;
  let initialized = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const raw = storage().getItem(POSTER_DRAFT_KEY);
      const data = raw ? JSON.parse(raw) : null;
      const drafts: Record<string, KeptPosterWork> = {};
      if (
        data?.version === 1 &&
        data.drafts &&
        typeof data.drafts === "object"
      ) {
        for (const [key, value] of Object.entries(data.drafts)) {
          if (!/^(new|book:.+|poster:.+)$/.test(key)) continue;
          const work = readWork(value);
          if (work) drafts[key] = work;
        }
      }
      snapshot = { drafts, saved: true };
    } catch {
      snapshot = { drafts: {}, saved: false };
    }
    emit();
  }

  function write(drafts: Record<string, KeptPosterWork>) {
    let saved = true;
    try {
      if (Object.keys(drafts).length)
        storage().setItem(
          POSTER_DRAFT_KEY,
          JSON.stringify({ version: 1, drafts }),
        );
      else storage().removeItem(POSTER_DRAFT_KEY);
    } catch {
      // The work stays in memory even when browser storage is full or off.
      saved = false;
    }
    snapshot = { drafts, saved };
    emit();
  }

  function keep(key: string, work: PosterWork) {
    initialize();
    write({
      ...snapshot.drafts,
      [key]: { ...work, at: new Date().toISOString() },
    });
  }

  function clear(key: string) {
    initialize();
    if (!(key in snapshot.drafts)) return;
    const drafts = { ...snapshot.drafts };
    delete drafts[key];
    write(drafts);
  }

  return {
    initialize,
    keep,
    clear,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const posterDraftStore = createPosterDraftStore(() => window.localStorage);

/** The work kept under `key`, and how to keep or let go of it. */
export function usePosterDraft(key: string) {
  const snapshot = useSyncExternalStore(
    posterDraftStore.subscribe,
    posterDraftStore.getSnapshot,
    posterDraftStore.getServerSnapshot,
  );
  useEffect(() => posterDraftStore.initialize(), []);
  return {
    kept: snapshot.drafts[key] ?? null,
    saved: snapshot.saved,
    keep: (work: PosterWork) => posterDraftStore.keep(key, work),
    clear: () => posterDraftStore.clear(key),
  };
}
