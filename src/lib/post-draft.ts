"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  createKeptDraftStore,
  handOverDrafts,
  keptText,
  useOwnedDraft,
} from "./kept-draft";
import { DRAFT_OWNER } from "./draft-owner";
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
 * to a post, or a line jotted while reading (by reading session). Keys begin
 * with whose draft it is (draftOwner); before they did, a browser kept one
 * set of drafts for everyone, and the first owner to come takes those.
 */
const FOR = "(new-post|review:.+|reply:.+|reading:.+)";
const POST_DRAFT_KEYS = new RegExp("^" + DRAFT_OWNER + ":" + FOR + "$");
const UNOWNED_POST_DRAFT_KEYS = new RegExp("^" + FOR + "$");
const READING = "reading:";

/** The draft of a reply to a post, a review of a book, or a new post. */
export const postDraftKey = (
  owner: string,
  options: { parentId?: string; bookId?: string } = {},
) =>
  owner +
  ":" +
  (options.parentId
    ? "reply:" + options.parentId
    : options.bookId
      ? "review:" + options.bookId
      : "new-post");

/** The draft key of the line written during a reading session. */
export const readingDraftKey = (owner: string, sessionId: string) =>
  owner + ":" + READING + sessionId;

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

/** Words after others, on a new line; null when too long for one post. */
function joinWords(before: string, after: string): string | null {
  const body = before.trim() ? before.trimEnd() + "\n" + after.trim() : after;
  return [...body].length > POST_MAX_LENGTH ? null : body;
}

/**
 * A draft written before its owner was known, after what the owner kept for
 * the same composer (see keepForOwner); null when the two are too long for
 * one post.
 */
export function joinPostDrafts(
  kept: PostDraft,
  work: PostDraft,
): PostDraft | null {
  const body =
    !work.body.trim() || work.body.trim() === kept.body.trim()
      ? kept.body
      : joinWords(kept.body, work.body);
  if (body === null) return null;
  const joined = {
    body,
    bookId: kept.bookId ?? work.bookId,
    // A spoiler mark on either marks the whole, as when a line is carried.
    spoiler: kept.spoiler || work.spoiler,
  };
  return joined.body === kept.body &&
    joined.bookId === kept.bookId &&
    joined.spoiler === kept.spoiler
    ? kept
    : joined;
}

/** Drafts have their own storage boundary, separate from the existing town data. */
export function createPostDraftStore(storage: () => DraftStorage) {
  const store = createKeptDraftStore<PostDraft>(
    {
      storageKey: POST_DRAFT_KEY,
      keyPattern: POST_DRAFT_KEYS,
      unowned: UNOWNED_POST_DRAFT_KEYS,
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
     * Moves the words of one draft into another (a line from reading into
     * the review of the book): into one with nothing written yet, or, when
     * `append`, after the words already there. False, and nothing moved,
     * when there is nothing to move, the other holds words and `append` is
     * not set, or both together would be too long for a post.
     */
    carry(from: string, to: string, append = false): boolean {
      const moving = store.get(from);
      const there = store.get(to);
      if (!moving?.body.trim()) return false;
      const before = there?.body.trim() ? there.body : "";
      if (before && !append) return false;
      const body = joinWords(before, moving.body);
      if (body === null) return false;
      store.set(to, {
        body,
        bookId: there?.bookId ?? null,
        // A line marked as a spoiler marks what it joins.
        spoiler: moving.spoiler || Boolean(before && there?.spoiler),
      });
      store.clear(from);
      return true;
    },
  };
}

const postDraftStore = createPostDraftStore(() => window.localStorage);

/**
 * The draft of one composer. A null key (the owner is not known yet) keeps
 * nothing: the words stay on the screen until the owner is known, and then
 * go after what the owner kept for the composer (joinPostDrafts).
 */
export function usePostDraft(key: string | null) {
  const { draft, kept, saved, loaded, inHand, set, clear } = useOwnedDraft(
    postDraftStore,
    key,
    joinPostDrafts,
  );
  const words = draft ?? EMPTY_POST_DRAFT;
  return {
    draft: words,
    /** Whether words or a book are kept in this browser for this composer. */
    kept: kept !== null && (kept.body !== "" || kept.bookId !== null),
    saved,
    loaded,
    update: (patch: Partial<PostDraft>) => {
      if (key !== null && !inHand) postDraftStore.update(key, patch);
      else set({ ...words, ...patch });
    },
    clear,
  };
}

/** Moves a draft's words into another composer's empty draft (see carry). */
export const carryPostDraft = (from: string, to: string) =>
  postDraftStore.carry(from, to);

/** Adds a draft's words after another composer's words (see carry). */
export const appendPostDraft = (from: string, to: string) =>
  postDraftStore.carry(from, to, true);

export const clearPostDraft = (key: string) => postDraftStore.clear(key);

/**
 * Puts words that were sent back into a composer's draft, after the words
 * already there (joinPostDrafts): a post the database turned away. False,
 * and nothing kept, when both would be too long for one post or the browser
 * cannot keep them.
 */
export function returnPostWords(
  key: string,
  words: PostDraft,
  store: ReturnType<typeof createPostDraftStore> = postDraftStore,
): boolean {
  try {
    const kept = store.get(key);
    const joined = kept ? joinPostDrafts(kept, words) : words;
    if (!joined) return false;
    store.set(key, joined);
    return store.getSnapshot().saved && store.get(key) !== null;
  } catch {
    return false;
  }
}

/** A visitor's drafts, handed to the account they sign in to. */
export const adoptVisitorPosts = (
  owner: string,
  store: ReturnType<typeof createPostDraftStore> = postDraftStore,
) => handOverDrafts(store, owner);

/** The owner's lines written while reading and not sent, by reading session. */
export function useReadingDrafts(
  owner: string | null,
): { sessionId: string; draft: PostDraft }[] {
  const snapshot = useSyncExternalStore(
    postDraftStore.subscribe,
    postDraftStore.getSnapshot,
    postDraftStore.getServerSnapshot,
  );
  useEffect(() => {
    if (owner !== null) postDraftStore.claim(owner);
    else postDraftStore.initialize();
  }, [owner]);
  if (owner === null) return [];
  const mine = owner + ":" + READING;
  return Object.entries(snapshot.drafts).flatMap(([key, draft]) =>
    key.startsWith(mine) ? [{ sessionId: key.slice(mine.length), draft }] : [],
  );
}
