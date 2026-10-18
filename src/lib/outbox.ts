"use client";

import { useSyncExternalStore } from "react";
import type { KeptWrite, KeptWrites, Outbox } from "./supabase/sync";

// The outbox (送り待ちの箱): what the signed-in reader changed that the
// database has not taken yet, kept on their own device while it waits, as
// the scan journal keeps books (library-journal.ts). Every change is kept the
// moment it is made, and let go once the database takes it. A page closed,
// a tab lost or a sign-in ended before the changes went out leaves them
// here, and the next page that reads this reader's town sends them first
// (supabase/sync.ts).
//
// One key per reader and per thing saved (the town, the walk), each holding
// what every page kept, by page. Every change reads the key again and writes
// it back, so two tabs never write over each other's changes. What waited
// longer than a week is let go, as the scan journal does. A change to the
// shape of a write takes a new version of the key (-v3:), so a page never
// sends what an older version kept in a shape it no longer makes, and an
// older page, which lets go of what it cannot read whenever it writes the
// key back, never meets a write it does not know.

export const OUTBOX_KEY = "book-town-outbox-v2:";
/**
 * The town's key before a reader's copies of others' books were written
 * (copy-books, own-books.ts). What waits there is in shapes this version
 * still sends: a page sends it with the rest, and lets it go there.
 */
export const OUTBOX_KEY_BEFORE = "book-town-outbox-v1:";
export const WALK_OUTBOX_KEY = "book-town-walk-outbox-v1:";
/** Every key an outbox is kept under, then the reader's id. */
export const OUTBOX_KEYS = [OUTBOX_KEY, OUTBOX_KEY_BEFORE, WALK_OUTBOX_KEY];
/** Changes kept longer than this are let go. */
export const OUTBOX_DAYS = 7;
const DAY_MS = 86_400_000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What a key holds, as far as it is well formed and recent enough. */
export function readOutbox<W>(
  raw: string | null,
  now: number,
  valid: (write: unknown) => write is W,
): KeptWrites<W>[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): KeptWrites<W>[] => {
    if (
      !record(entry) ||
      typeof entry.page !== "string" ||
      typeof entry.at !== "string" ||
      !Array.isArray(entry.writes)
    )
      return [];
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || now - at > OUTBOX_DAYS * DAY_MS) return [];
    const writes = entry.writes.flatMap((kept): KeptWrite<W>[] => {
      if (!record(kept) || !valid(kept.write)) return [];
      return typeof kept.was === "string" && typeof kept.to === "string"
        ? [{ write: kept.write, was: kept.was, to: kept.to }]
        : [{ write: kept.write }];
    });
    return writes.length ? [{ page: entry.page, at: entry.at, writes }] : [];
  });
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** The browser's storage, or null where there is none to reach. */
function browserStorage(): globalThis.Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The outbox under `key` (OUTBOX_KEY or WALK_OUTBOX_KEY, then the reader's
 * id). `valid` tells a write as it was kept; anything else read back is let
 * go. Without storage it keeps nothing, and says so. What older pages kept
 * under `before` (an earlier version's key) is left to be sent as well, and
 * let go there once it is.
 */
export function deviceOutbox<W>(
  key: string,
  valid: (write: unknown) => write is W,
  storage: Storage | null = browserStorage(),
  now: () => number = Date.now,
  before?: string,
): Outbox<W> {
  // Whether this page has anything under the key, so a page with nothing
  // waiting does not read the key at every change.
  const mine = new Set<string>();
  const readAt = (from: Storage, at: string) =>
    readOutbox(from.getItem(at), now(), valid);
  const read = (from: Storage) => readAt(from, key);
  const writeAt = (to: Storage, at: string, entries: KeptWrites<W>[]) => {
    if (entries.length) to.setItem(at, JSON.stringify(entries));
    else to.removeItem(at);
    changed();
  };
  const write = (to: Storage, entries: KeptWrites<W>[]) =>
    writeAt(to, key, entries);
  return {
    keep(page, writes) {
      if (!storage) return false;
      if (!writes.length && !mine.has(page)) return true;
      try {
        const others = read(storage).filter((entry) => entry.page !== page);
        const at = new Date(now()).toISOString();
        write(
          storage,
          writes.length ? [...others, { page, at, writes }] : others,
        );
        if (writes.length) mine.add(page);
        else mine.delete(page);
        return true;
      } catch {
        // Storage full or turned off: the changes wait in memory only.
        return false;
      }
    },
    left(page) {
      if (!storage) return [];
      try {
        return [
          ...(before ? readAt(storage, before) : []),
          ...read(storage).filter((entry) => entry.page !== page),
        ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      } catch {
        return [];
      }
    },
    drop(page) {
      if (!storage) return;
      try {
        for (const at of before ? [key, before] : [key]) {
          const entries = readAt(storage, at);
          if (entries.some((entry) => entry.page === page))
            writeAt(
              storage,
              at,
              entries.filter((entry) => entry.page !== page),
            );
        }
      } catch {
        // Kept a while longer: sent again, it is taken once.
      }
    },
  };
}

const anything = (write: unknown): write is unknown => write !== undefined;

/** Whether changes of `userId`'s still wait on this device, for the town or the walk. */
export function outboxWaiting(
  userId: string,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return OUTBOX_KEYS.some(
      (key) =>
        readOutbox(storage.getItem(key + userId), Date.now(), anything).length >
        0,
    );
  } catch {
    return false;
  }
}

/**
 * Whether anyone's changes still wait on this device. A pressed ログアウト
 * lets them go, so they tell of a sign-in that ended by itself, even one
 * that ended before the page opened.
 */
export function anyOutboxWaiting(
  storage: Pick<
    globalThis.Storage,
    "length" | "key" | "getItem"
  > | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (
        key &&
        OUTBOX_KEYS.some((prefix) => key.startsWith(prefix)) &&
        readOutbox(storage.getItem(key), Date.now(), anything).length > 0
      )
        return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Lets go of what waits for `userId` on this device (a pressed ログアウト). */
export function forgetOutboxes(
  userId: string,
  storage: Storage | null = browserStorage(),
) {
  if (!storage) return;
  for (const key of OUTBOX_KEYS)
    try {
      storage.removeItem(key + userId);
    } catch {
      // Storage that cannot be reached keeps nothing to let go of.
    }
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab's changes reach this one by the storage event.
  const heard = ({ key }: StorageEvent) => {
    if (key === null || OUTBOX_KEYS.some((prefix) => key.startsWith(prefix)))
      listener();
  };
  window.addEventListener("storage", heard);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", heard);
  };
}

/** Whether changes of `userId`'s still wait on this device (outboxWaiting). */
export function useOutboxWaiting(userId: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? outboxWaiting(userId) : false),
    () => false,
  );
}

/** Whether anyone's changes still wait on this device, while `asked`. */
export function useAnyOutboxWaiting(asked: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => asked && anyOutboxWaiting(),
    () => false,
  );
}
