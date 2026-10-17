import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  supabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "./config";

let client: SupabaseClient<Database> | null = null;

/** The browser's one Supabase client, or null when this build has no project. */
export function getSupabase(): SupabaseClient<Database> | null {
  if (!supabaseConfigured || typeof window === "undefined") return null;
  client ??= createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The email carries a code to type in and a link back to the site; the
      // link's session arrives after the # in the address and is read here.
      detectSessionInUrl: true,
    },
    // This app writes the reader's library rows itself, so the database
    // leaves them alone when its marks change (book_marks_follow, which
    // copies the marks of an app from before the library).
    global: { headers: { "x-booktown-library": "1" } },
  });
  return client;
}
