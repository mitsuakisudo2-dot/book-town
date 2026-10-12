/**
 * Types for the tables the app reads and writes, in the shape the Supabase
 * client expects, matching supabase/migrations. Tables are added here as the app
 * starts to use them. Rows are type aliases, not interfaces, so the client can
 * treat them as plain records.
 */
export type ProfileRow = {
  id: string;
  handle: string;
  name: string;
  bio: string;
  color: string;
  links: string[];
  compose_icon: "pen" | "typewriter" | "quill";
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = Pick<ProfileRow, "id" | "handle" | "name"> &
  Partial<Pick<ProfileRow, "bio" | "color" | "links" | "compose_icon">>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: Partial<Omit<ProfileRow, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_blocked_with: { Args: { other: string }; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
