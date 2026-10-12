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
      // Sign-in uses a code typed from the email, never a link back to the site.
      detectSessionInUrl: false,
    },
  });
  return client;
}
