"use client";

import { useSyncExternalStore } from "react";
import { DRAFT_OWNER } from "./draft-owner";
import { textHash } from "./canonical";
import {
  createKeptDraftStore,
  handOverDrafts,
  useOwnedDraft,
  type KeptDraftOptions,
  type KeptDraftStore,
} from "./kept-draft";
import {
  POSTER_FONTS,
  POSTER_LIMITS,
  POSTER_TEMPLATES,
  POSTER_THEMES,
  type Poster,
  type PosterDraft,
  type PosterPage,
} from "./posters";
import type { Write } from "./town-remote";
import type { PersistenceStatus } from "./types";

// A poster being made is kept in this browser while it is made, so a closed
// tab or a slip of the 戻る button does not lose it. Cleared once it is kept
// for real (put up, or left as a draft in the town, and the account has it),
// or thrown away.

export const POSTER_DRAFT_KEY = "book-town-poster-drafts-v1";

/** What the editor is in the middle of; whether it is put up is chosen last. */
export type PosterWork = Omit<PosterDraft, "status">;
export type KeptPosterWork = PosterWork & {
  /** When it was last changed. */
  at: string;
  /** For a poster being changed: the mark of the poster it began from. */
  from?: string;
};

/**
 * Which poster the work belongs to, for its maker (see draftOwner): a new
 * one, one about a book, or one being changed.
 */
export const posterWorkKey = (options: {
  owner: string;
  posterId?: string;
  bookId?: string;
}): string =>
  options.owner +
  ":" +
  (options.posterId
    ? "poster:" + options.posterId
    : options.bookId
      ? "book:" + options.bookId
      : "new");

/** Which poster a key's work belongs to, as posterWorkKey was told. */
export function posterWorkFor(key: string): {
  posterId?: string;
  bookId?: string;
} {
  const work = key.slice(key.indexOf(":") + 1);
  if (work.startsWith("poster:")) return { posterId: work.slice(7) };
  if (work.startsWith("book:")) return { bookId: work.slice(5) };
  return {};
}

/**
 * A short mark of what a poster says and how it looks. Work on a poster keeps
 * the mark of the version it began from, so a version changed since (on
 * another device) is told apart. Times cannot tell: the database stamps a
 * poster by its own clock, and the work is stamped by this device's.
 */
export function posterMark(work: PosterWork): string {
  const value = JSON.stringify([
    work.template,
    work.theme,
    work.font,
    work.spoiler,
    work.inTimeline,
    work.pages.map((page) => [page.heading, page.text, page.bookIds]),
  ]);
  return textHash(value).toString(36);
}

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
    (work.from !== undefined && typeof work.from !== "string") ||
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
    ...(work.from ? { from: work.from } : {}),
  };
}

const WORK = "(new|book:.+|poster:.+)";

export const POSTER_DRAFT_OPTIONS: KeptDraftOptions<KeptPosterWork> = {
  storageKey: POSTER_DRAFT_KEY,
  keyPattern: new RegExp("^" + DRAFT_OWNER + ":" + WORK + "$"),
  // Kept for everyone in this browser before keys began with their owner.
  unowned: new RegExp("^" + WORK + "$"),
  read: readWork,
  // Work is let go only when the poster is kept for real or thrown away.
  limit: Infinity,
};

export const posterDrafts = createKeptDraftStore(POSTER_DRAFT_OPTIONS);

/** A visitor's poster work, handed to the account they sign in to. */
export const adoptVisitorPosters = (owner: string, store = posterDrafts) =>
  handOverDrafts(store, owner);

/**
 * The work in hand under `key`, what this browser keeps of it, and how to
 * keep or let go of it; `all` is every piece of work its maker keeps here,
 * by key. A null key (the maker is not known yet) keeps and shows nothing;
 * the editor waits for the maker meanwhile.
 */
export function usePosterDraft(key: string | null) {
  const { draft, kept, saved, set, clear } = useOwnedDraft(posterDrafts, key);
  const snapshot = useSyncExternalStore(
    posterDrafts.subscribe,
    posterDrafts.getSnapshot,
    posterDrafts.getServerSnapshot,
  );
  const mine = key === null ? null : key.slice(0, key.indexOf(":") + 1);
  return {
    work: draft,
    kept,
    all: Object.fromEntries(
      Object.entries(snapshot.drafts).filter(
        ([entry]) => mine !== null && entry.startsWith(mine),
      ),
    ),
    saved,
    /** Keeps the work; `from` marks the poster it began from. */
    keep: (work: PosterWork, from?: string) => set(stampedWork(work, from)),
    clear,
  };
}

/** Work as it is kept: stamped now, with the poster it began from. */
export function stampedWork(work: PosterWork, from?: string): KeptPosterWork {
  const stamped: KeptPosterWork = { ...work, at: new Date().toISOString() };
  if (from) stamped.from = from;
  else delete stamped.from;
  return stamped;
}

/**
 * How kept work on one of the reader's posters stands against the poster
 * as saved now (`savedMark`, its posterMark): still to be saved ("fresh"),
 * begun before another version was saved over it ("stale"), or the very
 * poster saved now ("saved", nothing left to keep).
 */
export function posterWorkState(
  work: KeptPosterWork,
  savedMark: string,
): "fresh" | "stale" | "saved" {
  if (posterMark(work) === savedMark) return "saved";
  return work.from === savedMark ? "fresh" : "stale";
}

/** The town as far as a poster's save is heard from it (store.ts). */
export interface PosterSaves {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { posters: Poster[] };
  getPersistenceSnapshot(): PersistenceStatus;
  /** Which town is shown; another one since (signed out) tells nothing. */
  getGeneration?(): number;
  /** What last did not reach the database. */
  getMissedSnapshot?(): { elsewhere: Write[] } | null;
}

/** Whether a save of `posterId` was not sent, changed on another device. */
const changedElsewhere = (saves: PosterSaves, posterId: string) =>
  (saves.getMissedSnapshot?.()?.elsewhere ?? []).some(
    (write) =>
      (write.kind === "update-poster" && write.id === posterId) ||
      (write.kind === "posters" &&
        write.rows.some((row) => row.id === posterId)),
  );

/**
 * An account takes a poster in the background, after the editor has moved
 * on. The work sent stays kept under `key` (the poster's own, posterWorkKey)
 * until the account has the very poster `posterId` sent, and is let go then.
 * Turned away, or not sent because the poster was changed on another device,
 * it stays kept, to be opened again; work begun since the save is never let
 * go here. Begun over the save that was turned away, it goes on from the
 * poster the account has.
 */
export function keepPosterUntilSaved(
  store: KeptDraftStore<KeptPosterWork>,
  key: string,
  posterId: string,
  saves: PosterSaves,
) {
  const sent = store.get(key);
  if (!sent) return;
  const mark = posterMark(sent);
  const generation = saves.getGeneration?.();
  let settled = false;
  let stop = () => {};
  const settle = () => {
    if (settled) return;
    const status = saves.getPersistenceSnapshot();
    // Still on its way, or waiting out network trouble.
    if (status !== "saved" && status !== "recovered") return;
    settled = true;
    stop();
    // Another town shown since (signed out meanwhile): the save may yet be
    // sent from the account's outbox, so the work stays.
    if (saves.getGeneration?.() !== generation) return;
    const held = saves
      .getSnapshot()
      .posters.find((poster) => poster.id === posterId);
    const work = store.get(key);
    if (!held || work === null) return;
    // Saved, though something else in the round may not have been.
    if (posterMark(held) === mark && posterMark(work) === mark)
      return store.clear(key);
    // Begun over the version sent, which was turned away: the account has
    // its poster as before, and the work goes on from that.
    if (
      work.from === mark &&
      posterMark(held) !== mark &&
      !changedElsewhere(saves, posterId)
    )
      store.set(key, { ...work, from: posterMark(held) });
  };
  stop = saves.subscribe(settle);
  settle();
}
