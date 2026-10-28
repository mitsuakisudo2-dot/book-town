"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AccountState } from "../account";
import { useAccountState } from "../account-session";
import { bookKind } from "../samples";
import { getSupabase } from "../supabase/client";
import { askBookFacts, BOOK_FACTS_BATCH } from "../supabase/book-facts";
import type { Book } from "../types";
import type { BookFacts, FactsOf } from "./records";

// The pages and genre of the books the statistics count (管理表 19), asked
// of the database once per account and page load and kept here, as the
// bibliography is (bibliography-session.ts). Only a book of the database is
// asked. A book of the demo is counted as thick as its spine is drawn (a
// spine of 34 drawn as 340 pages), in the genre its own stands for; a book
// only in this browser has neither.

/** The demo's genres, as BookTown's 16 (private.genres) would have them. */
const SAMPLE_GENRES: Record<string, string> = {
  日本文学: "日本の小説",
  海外文学: "海外の小説",
  SF: "海外の小説",
  ファンタジー: "海外の小説",
  "哲学・思想": "哲学と宗教と心理",
  エッセイ: "エッセイ",
};

/** The demo's books, as many pages as a tenth of a millimetre of their spines. */
const SAMPLE_PAGES_PER_MM = 10;

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

/** How long a book the database left out waits before it is asked again. */
const ASK_AGAIN_MS = 60_000;

let owner: string | null = null;
let known = new Map<string, { facts: BookFacts | null; at: number }>();
const asking = new Set<string>();
let waiting = new Set<string>();
let sending = false;
/** Changes with every answer, so the screen counts again. */
let answers = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const tell = () => {
  answers += 1;
  listeners.forEach((listener) => listener());
};

async function send() {
  sending = false;
  const asker = owner;
  const client = getSupabase();
  const ids = [...waiting];
  waiting = new Set();
  if (!client || !asker) return;
  ids.forEach((id) => asking.add(id));
  for (let start = 0; start < ids.length; start += BOOK_FACTS_BATCH) {
    const batch = ids.slice(start, start + BOOK_FACTS_BATCH);
    const facts = await askBookFacts(client, batch);
    // Someone else signed in meanwhile: their own answers are under way.
    if (owner !== asker) return;
    batch.forEach((id) => asking.delete(id));
    // A failed call leaves the books unknown, to be asked again.
    if (!facts) continue;
    const at = Date.now();
    for (const id of batch) known.set(id, { facts: facts.get(id) ?? null, at });
    tell();
  }
}

function ask(ids: readonly string[], asker: string) {
  if (owner !== asker) {
    owner = asker;
    known = new Map();
    asking.clear();
    waiting = new Set();
  }
  const now = Date.now();
  for (const id of ids) {
    const answer = known.get(id);
    if (answer && (answer.facts || now - answer.at < ASK_AGAIN_MS)) continue;
    if (asking.has(id) || waiting.has(id)) continue;
    waiting.add(id);
  }
  if (sending || !waiting.size) return;
  sending = true;
  queueMicrotask(() => void send());
}

/**
 * The facts of the reader's books, as the statistics read them: the
 * database's when it has answered, else what the book itself says.
 */
export function useBookFacts(books: Book[], ids: readonly string[]): FactsOf {
  const asker = ownerOf(useAccountState());
  const asked = useMemo(
    () => [...new Set(ids)].filter((id) => bookKind(id) === "database").sort(),
    [ids],
  );
  const version = useSyncExternalStore(
    subscribe,
    () => answers,
    () => 0,
  );
  const key = asked.join(",");
  useEffect(() => {
    if (asker && asked.length) ask(asked, asker);
    // The ids, by what is in them: a new list of the same books asks nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asker, key]);
  return useMemo(() => {
    const byId = new Map(books.map((book) => [book.id, book]));
    const mine = owner === asker;
    void version;
    return (bookId: string) => {
      const answer = mine ? known.get(bookId)?.facts : undefined;
      if (answer) return answer;
      const book = byId.get(bookId);
      const genre = SAMPLE_GENRES[book?.genre ?? ""] ?? null;
      return book && genre
        ? { pages: Math.round(book.thickness * SAMPLE_PAGES_PER_MM), genre }
        : undefined;
    };
  }, [books, asker, version]);
}
