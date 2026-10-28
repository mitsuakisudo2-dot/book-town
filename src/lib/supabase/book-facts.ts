import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { BookFacts } from "../reading-stats/records";

// The pages and the genre the reading statistics count by (管理表 19):
// public.book_facts answers them for the books its caller may read the
// bibliography of, on book_bibliography's terms; any other ID is left out.

type Client = SupabaseClient<Database>;

/** How many IDs the database reads in one call (the rest it leaves out). */
export const BOOK_FACTS_BATCH = 200;

/**
 * The facts of these books, by book ID; a book the database leaves out is
 * not in the map. Null when the call failed, so that it is asked again.
 */
export async function askBookFacts(
  client: Client,
  ids: readonly string[],
): Promise<Map<string, BookFacts> | null> {
  const { data, error } = await client.rpc("book_facts", {
    ids: ids.slice(0, BOOK_FACTS_BATCH),
  });
  if (error || !data) return null;
  const facts = new Map<string, BookFacts>();
  for (const row of data)
    facts.set(row.book_id, {
      pages:
        typeof row.pages === "number" && row.pages > 0 ? row.pages : null,
      genre: typeof row.genre === "string" && row.genre ? row.genre : null,
    });
  return facts;
}
