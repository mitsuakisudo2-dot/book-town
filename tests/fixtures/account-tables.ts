// What deleting an account does to each table, and whether a person someone
// blocked can still read its rows. Every table the migrations make is listed
// here; pnpm test:db stops when one is missing, when a link to a person is
// deleted differently from what this says, or when a policy no longer asks
// what it says it asks (tests/account-tables.test.ts). The deletion itself is
// checked against every column at once in tests/database-policies.test.ts.
//
// Adding a table: give it a line here, and give the deleted reader in
// "deleting an account removes everything it owned" a row in it.

/**
 * A column that always names a person (auth.users or public.profiles):
 * - delete: the row goes with that person's account (on delete cascade).
 * - forget: the row stays and the column becomes null (on delete set null).
 */
export type PersonLink = "delete" | "forget";

/**
 * Who may read the rows that belong to someone, and so whether a block hides
 * them:
 * - own: only the people the row is about (its policies ask auth.uid()).
 * - blocks: everyone, minus the people blocked either way (is_blocked_with).
 * - via: read through another table's rows, so that table's rule applies.
 * - nobody: no reader at all through the API (the operator and the database).
 * - open: everyone, blocked or not, for the reason given.
 */
export type Readers =
  "own" | "blocks" | "nobody" | { via: string } | { open: string };

export type AccountTable = {
  people: Record<string, PersonLink>;
  /**
   * Columns that name a person only for some rows (a report's target_id when
   * its kind is profile), with what happens to them: gone with the person
   * (another column of the same row takes the row along), or kept and why.
   */
  targets?: Record<string, { goes: string } | { stays: string }>;
  /** uuid columns with no foreign key that never name a person. */
  notPeople?: string[];
  readers: Readers;
};

export const ACCOUNT_TABLES: Record<string, AccountTable> = {
  "public.blocks": {
    people: { blocker_id: "delete", blocked_id: "delete" },
    readers: "own",
  },
  "public.book_encounters": {
    people: { user_id: "delete", other_reader_id: "forget" },
    readers: "own",
  },
  "public.book_marks": { people: { user_id: "delete" }, readers: "own" },
  "public.books": {
    people: { created_by: "forget" },
    readers: {
      open: "a book is a catalog entry, not a person's; who typed it in is a column nobody may read",
    },
  },
  "public.cover_refusals": {
    people: {},
    readers: {
      open: "the operator's list of covers not shown; it names nobody",
    },
  },
  "public.library_entries": {
    people: { user_id: "delete" },
    notPeople: ["batch_id"],
    readers: "own",
  },
  "public.library_shelf_books": {
    people: { user_id: "delete" },
    readers: "own",
  },
  "public.library_shelves": { people: { user_id: "delete" }, readers: "own" },
  "public.moderation_folds": {
    people: { owner_id: "delete" },
    targets: {
      target_id: {
        goes: "a folded profile's owner_id is that person, so the row goes with them",
      },
    },
    readers: {
      open: "only the mark that something is folded, never what was reported or by whom",
    },
  },
  "public.moderation_hides": {
    people: {},
    targets: {
      target_id: {
        stays:
          "the operator's record of what they hid; reports and hides stay for the operator (safety_defaults)",
      },
    },
    readers: "nobody",
  },
  "public.pop_reactions": {
    people: { user_id: "delete" },
    readers: {
      open: "the shop's owner sees reactions from people they blocked too (decide in plan item 43)",
    },
  },
  "public.post_reactions": {
    people: { user_id: "delete" },
    readers: {
      open: "a post's writer sees reactions from people they blocked too (decide in plan item 43)",
    },
  },
  "public.poster_books": { people: {}, readers: { via: "public.posters" } },
  "public.posters": { people: { author_id: "delete" }, readers: "blocks" },
  "public.posts": { people: { author_id: "delete" }, readers: "blocks" },
  "public.profile_follows": {
    people: { follower_id: "delete", followee_id: "delete" },
    // A block ends the follow both ways (end_follows_on_block).
    readers: "own",
  },
  "public.profile_nine": {
    people: { profile_id: "delete" },
    readers: {
      open: "a known gap: shown to people its reader blocked, unlike posts (decide in plan item 43)",
    },
  },
  "public.profiles": {
    people: { id: "delete" },
    readers: {
      open: "left visible on purpose, so whoever blocked someone can still find them in their list to unblock (docs/09)",
    },
  },
  "public.reader_settings": { people: { user_id: "delete" }, readers: "own" },
  "public.reading_entries": {
    people: { user_id: "delete" },
    readers: "blocks",
  },
  "public.reading_sessions": {
    people: { user_id: "delete" },
    readers: "blocks",
  },
  "public.reports": {
    people: { reporter_id: "delete" },
    targets: {
      target_id: {
        stays:
          "a report about someone stays for the operator after they leave, as one about a post taken down does (safety_defaults)",
      },
    },
    readers: "own",
  },
  "public.saved_shops": { people: { user_id: "delete" }, readers: "own" },
  "public.shop_follows": {
    people: { follower_id: "delete" },
    // Its owner sees who follows the shop; a block ends the follow.
    readers: "own",
  },
  "public.shop_private": { people: {}, readers: "own" },
  "public.shop_reactions": { people: { user_id: "delete" }, readers: "blocks" },
  "public.shop_visits": { people: { user_id: "delete" }, readers: "own" },
  "public.shops": { people: { owner_id: "delete" }, readers: "blocks" },
  "public.site_notes": { people: { user_id: "delete" }, readers: "own" },
  "public.spoiler_reports": {
    people: { reporter_id: "delete" },
    readers: "own",
  },
  // Works and their editions, one an ISBN or a book without one (works,
  // edition_ids); they name no one.
  "public.editions": { people: {}, readers: "nobody" },
  "public.works": { people: {}, readers: "nobody" },
  "private.staff": { people: { user_id: "delete" }, readers: "nobody" },
  // The operator's joins, how books changed works, and the works the
  // operator found to be different (works); they name no one.
  "private.work_changes": { people: {}, readers: "nobody" },
  "private.work_joins": {
    people: {},
    // Works' and editions' ids, kept so a join can be undone exactly.
    notPeople: ["led_here", "editions"],
    readers: "nobody",
  },
  "private.works_apart": { people: {}, readers: "nobody" },
  // The bibliographic master (bibliography): what each source said about an
  // edition, the operator's corrections, when each book was placed in its
  // edition, and the operator's list of what to look at. They name no one.
  "private.edition_sources": { people: {}, readers: "nobody" },
  "private.edition_fixes": { people: {}, readers: "nobody" },
  "private.book_checks": { people: {}, readers: "nobody" },
  // Books to compare again that an answer could not mark (bibliography_holds).
  "private.book_rechecks": {
    people: {},
    // A book's id, with no reference (making one would wait on the book's row).
    notPeople: ["book_id"],
    readers: "nobody",
  },
  "private.bibliography_review": {
    people: {},
    // A book of the edition, for the operator's tools.
    notPeople: ["a_book"],
    readers: "nobody",
  },
  // Which book each reader's copy was made from (own_book_rows); it names
  // books only, whose a copy is being the copy's created_by.
  "private.book_copies": { people: {}, readers: "nobody" },
  // How many came to each shop last week, a number only, which the owner
  // reads through shop_visitors() (shop_visitors_weekly); it goes with the
  // shop.
  "private.shop_visitor_weeks": { people: {}, readers: "nobody" },
  // Errors heard on readers' screens, with what could name a reader taken out
  // (screen_errors); they name no one.
  "private.screen_errors": { people: {}, readers: "nobody" },
  // What readers tell the operator (site_reports); only staff read them,
  // through site_reports(), which is the operator's own reading.
  "private.site_reports": { people: { user_id: "delete" }, readers: "nobody" },
  // The pairs of characters each book's title and author fold to, for the
  // search (search_in_database); it goes with its book, and only the search
  // functions read it.
  "private.book_grams": { people: {}, readers: "nobody" },
  // How many public shelves hold each work and how many 便り talk of it
  // (counts_in_database): no person's column; triggers keep it as rows go,
  // and only the counting functions read it.
  "private.work_counts": { people: {}, readers: "nobody" },
  // A copy's own rows are cleared by forget_in_copies (moving_copies).
  "keep.copies": { people: {}, readers: "nobody" },
};

/**
 * Where the tables above live: every schema but Postgres's own, auth, and
 * pg_net's and pg_cron's (net, cron), so a table in a new schema has to be
 * listed too. A condition on pg_namespace n.
 */
export const ACCOUNT_SCHEMAS_SQL =
  "n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'net', 'cron') and n.nspname not like 'pg\\_%'";
