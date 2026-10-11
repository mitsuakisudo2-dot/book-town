"use client";

import { useEffect, useSyncExternalStore } from "react";
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
type Snapshot = { drafts: Record<string, PostDraft>; saved: boolean };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const initial: Snapshot = { drafts: {}, saved: true };

/** Drafts have their own storage boundary, separate from the existing town data. */
export function createPostDraftStore(storage: () => DraftStorage) {
  let snapshot = initial;
  let initialized = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const raw = storage().getItem(POST_DRAFT_KEY);
      const data = raw ? JSON.parse(raw) : null;
      const drafts: Record<string, PostDraft> = {};
      if (
        data?.version === 1 &&
        data.drafts &&
        typeof data.drafts === "object"
      ) {
        for (const [key, value] of Object.entries(data.drafts)) {
          if (!/^(new-post|review:.+|reply:.+)$/.test(key)) continue;
          if (!value || typeof value !== "object") continue;
          const draft = value as Partial<PostDraft>;
          if (
            typeof draft.body !== "string" ||
            draft.body.length > POST_MAX_LENGTH ||
            !(draft.bookId === null || typeof draft.bookId === "string") ||
            typeof draft.spoiler !== "boolean"
          )
            continue;
          drafts[key] = draft as PostDraft;
        }
      }
      snapshot = { drafts, saved: true };
    } catch {
      snapshot = { drafts: {}, saved: false };
    }
    emit();
  }

  function update(key: string, patch: Partial<PostDraft>) {
    initialize();
    const draft = { ...(snapshot.drafts[key] ?? EMPTY_POST_DRAFT), ...patch };
    const drafts = { ...snapshot.drafts };
    if (draft.body || draft.bookId) drafts[key] = draft;
    else delete drafts[key];
    let saved = true;
    try {
      if (Object.keys(drafts).length) {
        storage().setItem(
          POST_DRAFT_KEY,
          JSON.stringify({ version: 1, drafts }),
        );
      } else storage().removeItem(POST_DRAFT_KEY);
    } catch {
      // Retain the in-memory draft even when browser storage is full or disabled.
      saved = false;
    }
    snapshot = { drafts, saved };
    emit();
  }

  return {
    initialize,
    update,
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

const postDraftStore = createPostDraftStore(() => window.localStorage);

export function usePostDraft(key: string) {
  const snapshot = useSyncExternalStore(
    postDraftStore.subscribe,
    postDraftStore.getSnapshot,
    postDraftStore.getServerSnapshot,
  );
  useEffect(() => postDraftStore.initialize(), []);
  return {
    draft: snapshot.drafts[key] ?? EMPTY_POST_DRAFT,
    saved: snapshot.saved,
    update: (patch: Partial<PostDraft>) => postDraftStore.update(key, patch),
  };
}
