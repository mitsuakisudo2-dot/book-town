import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  bibliographyFrom,
  holdFrom,
  type Bibliography,
  type BookHold,
} from "../bibliography";

// The bibliographic master's calls to the database (docs/09「書誌マスタ」).
// public.book_bibliography answers anyone, visitors too, but only for a book
// anyone may see used or the reader's own, and only once it is judged to be
// its ISBN's; any other ID is left out alike.

type Client = SupabaseClient<Database>;

/** How many IDs the database reads in one call (the rest it leaves out). */
export const BIBLIOGRAPHY_BATCH = 200;

/**
 * The masters of these books, by book ID; a book without one is not in the
 * map. Null when the call failed, so that it is asked again later.
 */
export async function askBibliography(
  client: Client,
  ids: readonly string[],
): Promise<Map<string, Bibliography> | null> {
  const { data, error } = await client.rpc("book_bibliography", {
    ids: ids.slice(0, BIBLIOGRAPHY_BATCH),
  });
  if (error || !data) return null;
  const masters = new Map<string, Bibliography>();
  for (const row of data) {
    const master = bibliographyFrom(row);
    if (master) masters.set(row.book_id, master);
  }
  return masters;
}

/** The reader's books held back, oldest first; null when the call failed. */
export async function askHolds(client: Client): Promise<BookHold[] | null> {
  const { data, error } = await client.rpc("book_holds");
  if (error || !data) return null;
  return data.flatMap((row) => holdFrom(row) ?? []);
}

/**
 * The reader says the held book is the ISBN's after all: the master shows
 * for it from now on. False when it was not taken (not theirs, not held, or
 * the call failed).
 */
export async function confirmIsbn(
  client: Client,
  bookId: string,
): Promise<boolean> {
  const { error } = await client.rpc("confirm_book_isbn", { book: bookId });
  return !error;
}
