"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AccountState } from "./account";
import { useAccountState } from "./account-session";
import type { Bibliography, BookHold } from "./bibliography";
import { bookKind } from "./samples";
import { getSupabase } from "./supabase/client";
import {
  askBibliography,
  askHolds,
  BIBLIOGRAPHY_BATCH,
} from "./supabase/bibliography";

// The bibliographic master of the books on screen, asked of the database
// once per account and page load and kept here. A book of the demo, a 見本 or
// one only in this browser has none, and nothing is asked for it. The books
// a screen asks for in one moment go together in one call.
//
// A book with no master yet (registered under ten minutes ago, its sources
// not answered, no ISBN) is asked again when a screen opens it a minute or
// more later; one the reader fixes is forgotten (forgetBibliography).

/** Whose answers these are: the reader's ID, "visitor", or null to wait. */
function ownerOf(account: AccountState): string | null {
  switch (account.status) {
    case "demo":
      return null;
    case "loading":
      return account.pending?.id ?? null;
    case "signed-out":
      return "visitor";
    default:
      return account.user.id;
  }
}

/** How long a book without a master waits before it is asked again. */
const ASK_AGAIN_MS = 60_000;

interface Known {
  master: Bibliography | null;
  at: number;
}

let owner: string | null = null;
let known = new Map<string, Known>();
const asking = new Set<string>();
let waiting = new Set<string>();
let sending = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const tell = () => listeners.forEach((listener) => listener());

function startOver(next: string | null) {
  owner = next;
  known = new Map();
  asking.clear();
  waiting = new Set();
  tell();
}

async function send() {
  sending = false;
  const asker = owner;
  const client = getSupabase();
  const ids = [...waiting];
  waiting = new Set();
  if (!client || !asker) return;
  ids.forEach((id) => asking.add(id));
  for (let start = 0; start < ids.length; start += BIBLIOGRAPHY_BATCH) {
    const batch = ids.slice(start, start + BIBLIOGRAPHY_BATCH);
    const masters = await askBibliography(client, batch);
    // Someone else signed in meanwhile: their own answers are under way.
    if (owner !== asker) return;
    batch.forEach((id) => asking.delete(id));
    // A failed call leaves the books unknown, to be asked again.
    if (!masters) continue;
    const at = Date.now();
    for (const id of batch) known.set(id, { master: masters.get(id) ?? null, at });
    tell();
  }
}

function ask(bookId: string, asker: string) {
  if (owner !== asker) startOver(asker);
  const answer = known.get(bookId);
  if (answer && (answer.master || Date.now() - answer.at < ASK_AGAIN_MS)) return;
  if (asking.has(bookId) || waiting.has(bookId)) return;
  waiting.add(bookId);
  if (sending) return;
  sending = true;
  queueMicrotask(() => void send());
}

/** Asks again for this book's master: its reader changed it, or said it is right. */
export function forgetBibliography(bookId: string) {
  known.delete(bookId);
  tell();
  if (owner) ask(bookId, owner);
}

/**
 * The master of this book, or null while it is asked and when it has none
 * (the screen then shows what its reader typed).
 */
export function useBibliography(bookId: string): Bibliography | null {
  const asker = ownerOf(useAccountState());
  const wanted = asker !== null && bookKind(bookId) === "database";
  const master = useSyncExternalStore(
    subscribe,
    () => (wanted && owner === asker ? (known.get(bookId)?.master ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (wanted && asker) ask(bookId, asker);
  }, [wanted, asker, bookId]);
  return master;
}

// The reader's own books held back (「食い違いの判定と保留」), asked once per
// account and page load. A visitor and the demo have none. A call that fails
// leaves the list empty until the next page load.

const NO_HOLDS: BookHold[] = [];
let holds: { reader: string; list: BookHold[] | null } | null = null;

/** The reader's books held back, oldest first. */
export function useBookHolds(): BookHold[] {
  const asker = ownerOf(useAccountState());
  const reader = asker === "visitor" ? null : asker;
  const list = useSyncExternalStore(
    subscribe,
    () =>
      reader && holds?.reader === reader ? (holds.list ?? NO_HOLDS) : NO_HOLDS,
    () => NO_HOLDS,
  );
  useEffect(() => {
    if (!reader || holds?.reader === reader) return;
    const client = getSupabase();
    if (!client) return;
    const asking: typeof holds = { reader, list: null };
    holds = asking;
    void askHolds(client).then((answer) => {
      // Someone else signed in meanwhile: their own question is under way.
      if (holds !== asking) return;
      holds = { reader, list: answer ?? [] };
      tell();
    });
  }, [reader]);
  return list;
}

/** The hold on this book of the reader's, if it is held. */
export function useBookHold(bookId: string): BookHold | null {
  return useBookHolds().find((hold) => hold.bookId === bookId) ?? null;
}

/** Takes the book off the list: its reader answered the hold. */
export function forgetHold(bookId: string) {
  if (!holds?.list) return;
  holds = {
    reader: holds.reader,
    list: holds.list.filter((hold) => hold.bookId !== bookId),
  };
  tell();
}
