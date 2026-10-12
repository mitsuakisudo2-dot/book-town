/**
 * The database's types, generated from supabase/migrations into
 * database.generated.ts, and the row shapes the app names often.
 */
import type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.generated";

export type { Database, Tables, TablesInsert, TablesUpdate };

export type ProfileRow = Tables<"profiles">;
export type ProfileInsert = TablesInsert<"profiles">;
