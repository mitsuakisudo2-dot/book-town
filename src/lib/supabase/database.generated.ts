// Generated from the local database: supabase gen types typescript --local
// Regenerate after adding a migration; do not edit by hand. CI checks it.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      book_marks: {
        Row: {
          book_id: string;
          created_at: string;
          kind: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          book_id: string;
          created_at?: string;
          kind: string;
          user_id: string;
        };
        Update: {
          book_id?: string;
          created_at?: string;
          kind?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "book_marks_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "book_marks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      books: {
        Row: {
          author: string;
          created_at: string;
          created_by: string | null;
          id: string;
          isbn: string | null;
          price: number | null;
          publisher: string;
          source: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          author?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          isbn?: string | null;
          price?: number | null;
          publisher?: string;
          source?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          author?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          isbn?: string | null;
          price?: number | null;
          publisher?: string;
          source?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "books_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_hides: {
        Row: {
          created_at: string;
          note: string;
          target_id: string;
          target_kind: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          note?: string;
          target_id: string;
          target_kind: string;
        };
        Update: {
          created_at?: string;
          note?: string;
          target_id?: string;
          target_kind?: string;
        };
        Relationships: [];
      };
      pop_reactions: {
        Row: {
          created_at: string;
          placement_key: string;
          reaction: string;
          shop_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          placement_key: string;
          reaction: string;
          shop_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          placement_key?: string;
          reaction?: string;
          shop_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pop_reactions_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pop_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_reactions: {
        Row: {
          created_at: string;
          kind: string;
          post_id: string;
          taps: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          kind: string;
          post_id: string;
          taps?: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          kind?: string;
          post_id?: string;
          taps?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      poster_books: {
        Row: {
          book_id: string;
          first_page: number;
          poster_id: string;
        };
        ComputedFields: never;
        Insert: {
          book_id: string;
          first_page: number;
          poster_id: string;
        };
        Update: {
          book_id?: string;
          first_page?: number;
          poster_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "poster_books_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "poster_books_poster_id_fkey";
            columns: ["poster_id"];
            isOneToOne: false;
            referencedRelation: "posters";
            referencedColumns: ["id"];
          },
        ];
      };
      posters: {
        Row: {
          allow_display: boolean;
          author_id: string;
          created_at: string;
          font: string;
          id: string;
          pages: Json;
          show_in_timeline: boolean;
          spoiler: boolean;
          status: string;
          template: string;
          theme: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          allow_display?: boolean;
          author_id: string;
          created_at?: string;
          font?: string;
          id?: string;
          pages: Json;
          show_in_timeline?: boolean;
          spoiler?: boolean;
          status?: string;
          template: string;
          theme?: string;
          updated_at?: string;
        };
        Update: {
          allow_display?: boolean;
          author_id?: string;
          created_at?: string;
          font?: string;
          id?: string;
          pages?: Json;
          show_in_timeline?: boolean;
          spoiler?: boolean;
          status?: string;
          template?: string;
          theme?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posters_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          author_id: string;
          body: string;
          book_id: string | null;
          created_at: string;
          id: string;
          parent_id: string | null;
          reading_mode: string | null;
          spoiler: boolean;
          spoiler_folded: boolean;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body: string;
          book_id?: string | null;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          reading_mode?: string | null;
          spoiler?: boolean;
          spoiler_folded?: boolean;
        };
        Update: {
          author_id?: string;
          body?: string;
          book_id?: string | null;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          reading_mode?: string | null;
          spoiler?: boolean;
          spoiler_folded?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_follows: {
        Row: {
          created_at: string;
          followee_id: string;
          follower_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          followee_id: string;
          follower_id: string;
        };
        Update: {
          created_at?: string;
          followee_id?: string;
          follower_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_follows_followee_id_fkey";
            columns: ["followee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_nine: {
        Row: {
          book_id: string;
          note: string;
          position: number;
          profile_id: string;
        };
        ComputedFields: never;
        Insert: {
          book_id: string;
          note?: string;
          position: number;
          profile_id: string;
        };
        Update: {
          book_id?: string;
          note?: string;
          position?: number;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_nine_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_nine_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          bio: string;
          color: string;
          compose_icon: string;
          created_at: string;
          handle: string;
          id: string;
          links: string[];
          name: string;
          reading_visibility: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          bio?: string;
          color?: string;
          compose_icon?: string;
          created_at?: string;
          handle: string;
          id: string;
          links?: string[];
          name: string;
          reading_visibility?: string;
          updated_at?: string;
        };
        Update: {
          bio?: string;
          color?: string;
          compose_icon?: string;
          created_at?: string;
          handle?: string;
          id?: string;
          links?: string[];
          name?: string;
          reading_visibility?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reading_entries: {
        Row: {
          body: string;
          book_id: string;
          created_at: string;
          feelings: string[];
          id: string;
          is_public: boolean;
          kind: string;
          spoiler: boolean;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          book_id: string;
          created_at?: string;
          feelings?: string[];
          id?: string;
          is_public?: boolean;
          kind?: string;
          spoiler?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          book_id?: string;
          created_at?: string;
          feelings?: string[];
          id?: string;
          is_public?: boolean;
          kind?: string;
          spoiler?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reading_entries_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reading_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reading_sessions: {
        Row: {
          book_id: string | null;
          ended_at: string | null;
          id: string;
          mode: string;
          started_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          book_id?: string | null;
          ended_at?: string | null;
          id?: string;
          mode: string;
          started_at?: string;
          user_id: string;
        };
        Update: {
          book_id?: string | null;
          ended_at?: string | null;
          id?: string;
          mode?: string;
          started_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reading_sessions_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reading_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          detail: string;
          id: string;
          reason: string;
          reporter_id: string;
          status: string;
          target_id: string;
          target_kind: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          detail?: string;
          id?: string;
          reason: string;
          reporter_id: string;
          status?: string;
          target_id: string;
          target_kind: string;
        };
        Update: {
          created_at?: string;
          detail?: string;
          id?: string;
          reason?: string;
          reporter_id?: string;
          status?: string;
          target_id?: string;
          target_kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_shops: {
        Row: {
          created_at: string;
          shop_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          shop_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          shop_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_shops_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_shops_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_follows: {
        Row: {
          created_at: string;
          follower_id: string;
          shop_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          follower_id: string;
          shop_id: string;
        };
        Update: {
          created_at?: string;
          follower_id?: string;
          shop_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_follows_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_private: {
        Row: {
          scene: Json | null;
          scene_books: NonNullable<Json>;
          shelves: NonNullable<Json>;
          shop_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          scene?: Json | null;
          scene_books?: never;
          shelves?: NonNullable<Json>;
          shop_id: string;
          updated_at?: string;
        };
        Update: {
          scene?: Json | null;
          scene_books?: never;
          shelves?: NonNullable<Json>;
          shop_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_private_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: true;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_reactions: {
        Row: {
          liked: boolean;
          message: string;
          shop_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          liked?: boolean;
          message?: string;
          shop_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          liked?: boolean;
          message?: string;
          shop_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_reactions_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_visits: {
        Row: {
          shop_id: string;
          user_id: string;
          visited_at: string;
        };
        ComputedFields: never;
        Insert: {
          shop_id: string;
          user_id: string;
          visited_at?: string;
        };
        Update: {
          shop_id?: string;
          user_id?: string;
          visited_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_visits_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_visits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shops: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          is_open: boolean;
          name: string;
          owner_id: string;
          public_scene: Json | null;
          public_scene_books: NonNullable<Json>;
          public_shelves: NonNullable<Json>;
          tagline: string;
          theme: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          is_open?: boolean;
          name: string;
          owner_id: string;
          public_scene?: Json | null;
          public_scene_books?: never;
          public_shelves?: NonNullable<Json>;
          tagline?: string;
          theme?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          is_open?: boolean;
          name?: string;
          owner_id?: string;
          public_scene?: Json | null;
          public_scene_books?: never;
          public_shelves?: NonNullable<Json>;
          tagline?: string;
          theme?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shops_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      spoiler_reports: {
        Row: {
          created_at: string;
          post_id: string;
          reporter_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          post_id: string;
          reporter_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          reporter_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "spoiler_reports_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "spoiler_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      isbn13_valid: { Args: { isbn: string }; Returns: boolean };
      public_scene_of: { Args: { scene: Json; shop: string }; Returns: Json };
      replace_profile_nine: {
        Args: { book_ids: string[]; notes: string[] };
        Returns: undefined;
      };
      shop_visitors: { Args: { days: number }; Returns: number };
      valid_links: { Args: { links: string[] }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
