"use client";

import { useEffect, useSyncExternalStore } from "react";

// Work in progress (a record, a report, a shop being opened, the scene being
// decorated) is kept in this browser while it is written, so closing a
// dialog, a slip of 戻る, a reload or the phone dropping the tab does not lose
// it. Each kind of work has its own store and storage key; the screen clears
// its entry once the work is kept for real or the reader throws it away.

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface KeptDraftOptions<T> {
  /** The browser storage key, one per kind of work. */
  storageKey: string;
  /** The entry keys that belong to this store; others read back are dropped. */
  keyPattern: RegExp;
  /** The entry read back from storage, if it is still a shape the screen makes. */
  read: (value: unknown) => T | null;
  /** Work with nothing in it is not kept (its entry is removed instead). */
  isEmpty?: (value: T) => boolean;
  /** The most entries kept; the least recently written go first. */
  limit?: number;
}

export type KeptDraftSnapshot<T> = {
  drafts: Record<string, T>;
  /** False when the browser would not store the latest change. */
  saved: boolean;
  /** True once storage has been read (never on the server's first render). */
  loaded: boolean;
};

export interface KeptDraftStore<T> {
  initialize(): void;
  get(key: string): T | null;
  set(key: string, value: T | null): void;
  clear(key: string): void;
  getSnapshot(): KeptDraftSnapshot<T>;
  getServerSnapshot(): KeptDraftSnapshot<T>;
  subscribe(listener: () => void): () => void;
}

export function createKeptDraftStore<T>(
  options: KeptDraftOptions<T>,
  storage: () => DraftStorage = () => window.localStorage,
): KeptDraftStore<T> {
  const limit = options.limit ?? 30;
  const server: KeptDraftSnapshot<T> = {
    drafts: {},
    saved: true,
    loaded: false,
  };
  let snapshot = server;
  let initialized = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  function initialize() {
    if (initialized) return;
    initialized = true;
    const drafts: Record<string, T> = {};
    let saved = true;
    try {
      const raw = storage().getItem(options.storageKey);
      const data = raw ? JSON.parse(raw) : null;
      if (
        data?.version === 1 &&
        data.drafts &&
        typeof data.drafts === "object"
      ) {
        for (const [key, value] of Object.entries(data.drafts)) {
          if (!options.keyPattern.test(key)) continue;
          const draft = options.read(value);
          if (draft !== null && !options.isEmpty?.(draft)) drafts[key] = draft;
        }
      }
    } catch {
      saved = false;
    }
    snapshot = { drafts, saved, loaded: true };
    emit();
  }

  function write(drafts: Record<string, T>) {
    let saved = true;
    try {
      if (Object.keys(drafts).length) {
        storage().setItem(
          options.storageKey,
          JSON.stringify({ version: 1, drafts }),
        );
      } else storage().removeItem(options.storageKey);
    } catch {
      // Keep the work in memory even when browser storage is full or disabled.
      saved = false;
    }
    snapshot = { drafts, saved, loaded: true };
    emit();
  }

  function set(key: string, value: T | null) {
    initialize();
    if (!options.keyPattern.test(key)) return;
    const drafts = { ...snapshot.drafts };
    const had = key in drafts;
    delete drafts[key];
    if (value === null || options.isEmpty?.(value)) {
      if (had) write(drafts);
      return;
    }
    // Most recently written last, so the oldest goes first past the limit.
    drafts[key] = value;
    const keys = Object.keys(drafts);
    for (const old of keys.slice(0, Math.max(0, keys.length - limit)))
      delete drafts[old];
    write(drafts);
  }

  return {
    initialize,
    get(key) {
      initialize();
      return snapshot.drafts[key] ?? null;
    },
    set,
    clear: (key) => set(key, null),
    getSnapshot: () => snapshot,
    getServerSnapshot: () => server,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The kept work for one key, read during render. `draft` is null until the
 * browser's storage is read after mount, so the first render matches the
 * static page; screens show their saved state until then. A null key keeps
 * nothing (for a screen that has nothing open).
 */
export function useKeptDraft<T>(store: KeptDraftStore<T>, key: string | null) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  useEffect(() => store.initialize(), [store]);
  return {
    draft: key === null ? null : (snapshot.drafts[key] ?? null),
    saved: snapshot.saved,
    loaded: snapshot.loaded,
    set: (value: T | null) => {
      if (key !== null) store.set(key, value);
    },
    clear: () => {
      if (key !== null) store.clear(key);
    },
  };
}

/** A string read back from storage, if it fits the limit (in characters). */
export const keptText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && [...value].length <= limit;

/** A list of ids read back from storage, if it fits the limit. */
export const keptIds = (value: unknown, limit: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((id) => typeof id === "string" && id.length > 0);
