/**
 * The Supabase project this build talks to, filled in at build time. Both values
 * are public by design: the database's row level security decides what they may
 * do. Without them the app stays the local demo, saved only in this browser.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// The anon key is the older name for the same public key (Vercel's Supabase
// integration still sets it), so either works.
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
export const supabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);
