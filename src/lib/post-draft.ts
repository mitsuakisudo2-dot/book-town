"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createKeptDraftStore, keptText, useKeptDraft } from "./kept-draft";
import { POST_MAX_LENGTH } from "./types";

export const POST_DRAFT_KEY = "book-town-post-drafts-v1";
export type PostDraft = {
  body: string;
  bookId: string | null;
  spoiler: boolean;
};
export const EMPTY_POST_DRAFT: PostDraft = {
  body: "",
  bookId: null,
  spoiler: false,
};
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * What a draft is being written for: a new post, a review of a book, a reply
 * to a post, or a line jotted while reading (by reading session).
 */
const POST_DRAFT_KEYS = /^(new-post|review:.+|reply:.+|reading:.+)$/;
const READING = "reading:";

/** A draft read back from storage, if it is still the shape a composer makes. */
function readPostDraft(value: unknown): PostDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<PostDraft>;
  if (
    !keptText(draft.body, POST_MAX_LENGTH) ||
    !(draft.bookId === null || typeof draft.bookId === "string") ||
    typeof draft.spoiler !== "boolean"
  )
    return null;
  return { body: draft.body, bookId: draft.bookId, spoiler: draft.spoiler };
}

/** Drafts have their own storage boundary, separate from the existing town data. */
export function createPostDraftStore(storage: () => DraftStorage) {
  const store = createKeptDraftStore<PostDraft>(
    {
      storageKey: POST_DRAFT_KEY,
      keyPattern: POST_DRAFT_KEYS,
      read: readPostDraft,
      // The spoiler mark alone is kept too, so it can be set before writing.
      isEmpty: (draft) => !draft.body && !draft.bookId && !draft.spoiler,
      limit: 50,
    },
    storage,
  );
  return {
    ...store,
    update(key: string, patch: Partial<PostDraft>) {
      store.set(key, { ...(store.get(key) ?? EMPTY_POST_DRAFT), ...patch });
    },
    /**
     * Moves the words of one draft into another with nothing written yet (a
     * line from reading into the review of the book). False, and nothing
     * moved, when there is nothing to move or the other holds words of its own.
     */
    carry(from: string, to: string): boolean {
      const moving = store.get(from);
      const there = store.get(to);
      if (!moving?.body.trim() || there?.body.trim()) return false;
      store.set(to, {
        body: moving.body,
        bookId: there?.bookId ?? null,
        spoiler: moving.spoiler,
      });
      store.clear(from);
      return true;
    },
  };
}

const postDraftStore = createPostDraftStore(() => window.localStorage);

/** The draft of one composer; a null key keeps nothing. */
export function usePostDraft(key: string | null) {
  const { draft, saved, loaded, clear } = useKeptDraft(postDraftStore, key);
  return {
    draft: draft ?? EMPTY_POST_DRAFT,
    /** Whether words or a book are kept for this composer. */
    kept: draft !== null && (draft.body !== "" || draft.bookId !== null),
    saved,
    loaded,
    update: (patch: Partial<PostDraft>) => {
      if (key !== null) postDraftStore.update(key, patch);
    },
    clear,
  };
}

/** The draft key of the line written during a reading session. */
export const readingDraftKey = (sessionId: string) => READING + sessionId;

/** Moves a draft's words into another composer's empty draft (see carry). */
export const carryPostDraft = (from: string, to: string) =>
  postDraftStore.carry(from, to);

export const clearPostDraft = (key: string) => postDraftStore.clear(key);

/** Lines written while reading and not sent yet, by reading session. */
export function useReadingDrafts(): { sessionId: string; draft: PostDraft }[] {
  const snapshot = useSyncExternalStore(
    postDraftStore.subscribe,
    postDraftStore.getSnapshot,
    postDraftStore.getServerSnapshot,
  );
  useEffect(() => postDraftStore.initialize(), []);
  return Object.entries(snapshot.drafts).flatMap(([key, draft]) =>
    key.startsWith(READING)
      ? [{ sessionId: key.slice(READING.length), draft }]
      : [],
  );
}
