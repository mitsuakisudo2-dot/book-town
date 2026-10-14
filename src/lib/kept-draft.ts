"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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
  /**
   * Keys from before this store's keys began with their owner (draftOwner)
   * and ":". They are never shown as they are: the first owner to use the
   * store takes them (see claim).
   */
  unowned?: RegExp;
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
  /**
   * Gives the work kept before keys had owners to `owner`, under its key
   * after `owner:`, and takes it out of storage, so it is given once. Work
   * the owner keeps under the same key already stays, and the old entry is
   * dropped. Done the first time an owner reads or writes the store.
   */
  claim(owner: string): void;
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
  let claimed = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const belongs = (key: string) =>
    options.keyPattern.test(key) && !options.unowned?.test(key);

  /** The entries in storage now, by key; throws when it cannot be read. */
  function stored(): Record<string, unknown> {
    const raw = storage().getItem(options.storageKey);
    const data = raw ? JSON.parse(raw) : null;
    return data?.version === 1 && data.drafts && typeof data.drafts === "object"
      ? data.drafts
      : {};
  }

  /** The work read back under `key`, if it belongs here and has something. */
  function readBack(key: string, value: unknown): T | null {
    if (!belongs(key)) return null;
    const draft = options.read(value);
    return draft !== null && !options.isEmpty?.(draft) ? draft : null;
  }

  function readAll(entries: Record<string, unknown>) {
    const drafts: Record<string, T> = {};
    for (const [key, value] of Object.entries(entries)) {
      const draft = readBack(key, value);
      if (draft !== null) drafts[key] = draft;
    }
    return drafts;
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    let drafts: Record<string, T> = {};
    let saved = true;
    try {
      drafts = readAll(stored());
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

  /** Past the limit, the least recently written go first. */
  function trim(drafts: Record<string, T>) {
    const keys = Object.keys(drafts);
    for (const old of keys.slice(0, Math.max(0, keys.length - limit)))
      delete drafts[old];
    return drafts;
  }

  function claim(owner: string) {
    initialize();
    if (!options.unowned || claimed) return;
    claimed = true;
    // Read again: another tab may have kept work, or taken the old entries,
    // since this one opened. Nothing is written here before a claim, so
    // what storage holds now is the latest.
    let entries: Record<string, unknown>;
    try {
      entries = stored();
    } catch {
      return;
    }
    const there = readAll(entries);
    const unowned = Object.keys(entries).filter((key) =>
      options.unowned!.test(key),
    );
    const taken: Record<string, T> = {};
    for (const key of unowned) {
      const mine = owner + ":" + key;
      if (mine in there) continue;
      const draft = readBack(mine, entries[key]);
      if (draft !== null) taken[mine] = draft;
    }
    // Older than anything kept by owner, they are first to go past the limit.
    const drafts = trim({ ...taken, ...there });
    // Should the browser not store this, the old entries stay in storage
    // for the next time.
    if (unowned.length) write(drafts);
    else {
      snapshot = { ...snapshot, drafts };
      emit();
    }
  }

  /** A store's first reader or writer with an owner claims the old work. */
  function claimFor(key: string) {
    if (options.unowned && belongs(key)) claim(key.slice(0, key.indexOf(":")));
  }

  function set(key: string, value: T | null) {
    initialize();
    if (!belongs(key)) return;
    claimFor(key);
    const drafts = { ...snapshot.drafts };
    const had = key in drafts;
    delete drafts[key];
    if (value === null || options.isEmpty?.(value)) {
      if (had) write(drafts);
      return;
    }
    // Most recently written last, so the oldest goes first past the limit.
    drafts[key] = value;
    write(trim(drafts));
  }

  return {
    initialize,
    get(key) {
      initialize();
      claimFor(key);
      return snapshot.drafts[key] ?? null;
    },
    set,
    clear: (key) => set(key, null),
    claim,
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

/**
 * The work in hand for one key of a store whose keys begin with their owner
 * and ":" (see draftOwner). While the owner is not known yet (a null key)
 * nothing is kept or shown, but the screen still works: what is done
 * meanwhile stays on it, and is kept for the owner once known, unless they
 * keep work under the same key already. `kept` is what this browser keeps.
 */
export function useOwnedDraft<T>(store: KeptDraftStore<T>, key: string | null) {
  const owned = useKeptDraft(store, key);
  const [loose, setLoose] = useState<T | null>(null);
  const owner = key === null ? null : key.slice(0, key.indexOf(":"));
  useEffect(() => {
    if (owner !== null) store.claim(owner);
  }, [store, owner]);
  useEffect(() => {
    if (key === null || loose === null) return;
    if (store.get(key) === null) store.set(key, loose);
    setLoose(null);
  }, [store, key, loose]);
  return {
    draft: key === null ? loose : (owned.draft ?? loose),
    kept: owned.draft,
    saved: owned.saved,
    /** Storage has been read for a known owner. */
    loaded: key !== null && owned.loaded,
    set: (value: T | null) =>
      key === null ? setLoose(value) : owned.set(value),
    clear: () => (key === null ? setLoose(null) : owned.clear()),
  };
}

/**
 * A visitor's work, handed to the account they sign in to, in a store whose
 * keys begin with their owner and ":". Work the account already keeps under
 * the same key is not replaced; the visitor's then stays where it was, for
 * the next time no one is signed in.
 */
export function handOverDrafts<T>(store: KeptDraftStore<T>, owner: string) {
  store.claim(owner);
  const visitor = "visitor:";
  for (const [key, work] of Object.entries(store.getSnapshot().drafts)) {
    if (!key.startsWith(visitor)) continue;
    const mine = owner + ":" + key.slice(visitor.length);
    if (store.get(mine) !== null) continue;
    store.set(mine, work);
    store.clear(key);
  }
}

/**
 * Whether a notice says a save was turned away or put off and the work kept:
 * a draft's say 残しています, the scanner's (books kept on the device to
 * register later) 控えました, まだ保存できません or 終わったら登録します, and
 * none that tells of something done says any of these. The toast shows these
 * with a leaf, not the tick of a save.
 */
export const isKeptNotice = (message: string) =>
  /残しています|控えました|まだ保存できません|終わったら登録します/.test(
    message,
  );

/** A string read back from storage, if it fits the limit (in characters). */
export const keptText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && [...value].length <= limit;

/** A list of ids read back from storage, if it fits the limit. */
export const keptIds = (value: unknown, limit: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((id) => typeof id === "string" && id.length > 0);
