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
    for (const id of batch)
      known.set(id, { master: masters.get(id) ?? null, at });
    tell();
  }
}

function ask(bookId: string, asker: string) {
  if (owner !== asker) startOver(asker);
  const answer = known.get(bookId);
  if (answer && (answer.master || Date.now() - answer.at < ASK_AGAIN_MS))
    return;
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
    () =>
      wanted && owner === asker ? (known.get(bookId)?.master ?? null) : null,
    () => null,
  );
  useEffect(() => {
    if (wanted && asker) ask(bookId, asker);
  }, [wanted, asker, bookId]);
  return master;
}

// The reader's own books held back (「食い違いの判定と保留」), asked once per
// account and page load, and again whenever お知らせ opens (a book can be held
// while the page stays open). A visitor and the demo have none. A call that
// fails keeps what was known.

const NO_HOLDS: BookHold[] = [];
let holds: { reader: string; list: BookHold[] | null; at: number } | null =
  null;
let holdsAsked: { reader: string } | null = null;
/** Books whose fix the account took, and when: the database judges them again. */
const answered = new Map<string, number>();

/** How long after one answer お知らせ asks again: not twice for one opening. */
const HOLDS_FRESH_MS = 5_000;
/**
 * How long a fixed book is left out of a new answer: an ISBN fixed lets the
 * hold go at once, a title or author fixed when the book is next judged
 * (every 20 seconds or so). Still held after this, it is told again.
 */
const ANSWERED_MS = 3 * 60_000;

function askHoldsOf(reader: string) {
  const client = getSupabase();
  if (!client) return;
  const asking = { reader };
  holdsAsked = asking;
  void askHolds(client).then((answer) => {
    // Someone else signed in meanwhile, or a newer question is under way.
    if (holdsAsked !== asking) return;
    holdsAsked = null;
    const now = Date.now();
    const fresh = answer?.filter(
      (hold) => now - (answered.get(hold.bookId) ?? -Infinity) >= ANSWERED_MS,
    );
    holds = {
      reader,
      list: fresh ?? (holds?.reader === reader ? holds.list : []),
      at: now,
    };
    tell();
  });
}

/**
 * The reader's books held back, oldest first. `fresh` (お知らせ) asks the
 * database again when it opens.
 */
export function useBookHolds(fresh = false): BookHold[] {
  const asker = ownerOf(useAccountState());
  const reader = asker === "visitor" ? null : asker;
  const list = useSyncExternalStore(
    subscribe,
    () =>
      reader && holds?.reader === reader ? (holds.list ?? NO_HOLDS) : NO_HOLDS,
    () => NO_HOLDS,
  );
  useEffect(() => {
    if (!reader || holdsAsked?.reader === reader) return;
    if (holds?.reader !== reader) {
      holds = { reader, list: null, at: 0 };
      askHoldsOf(reader);
    } else if (fresh && Date.now() - holds.at >= HOLDS_FRESH_MS)
      askHoldsOf(reader);
  }, [reader, fresh]);
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
    ...holds,
    list: holds.list.filter((hold) => hold.bookId !== bookId),
  };
  tell();
}

/**
 * The reader fixed a held book: it goes from the screen at once, and comes
 * back if the account turns the fix away (`saved` false; the town then goes
 * back to the book as saved). Taken, it stays out of new answers while the
 * database judges it again.
 */
export function settleHold(bookId: string, saved: Promise<boolean>) {
  const reader = holds?.reader;
  const hold = holds?.list?.find((one) => one.bookId === bookId);
  if (!hold) return;
  answered.set(bookId, Date.now());
  forgetHold(bookId);
  void saved.then((taken) => {
    if (taken) return void answered.set(bookId, Date.now());
    answered.delete(bookId);
    const list = holds?.reader === reader ? holds?.list : null;
    if (!holds || !list || list.some((one) => one.bookId === bookId)) return;
    holds = {
      ...holds,
      list: [...list, hold].sort((a, b) => a.heldAt.localeCompare(b.heldAt)),
    };
    tell();
  });
}
