import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.generated";

// A stand-in for Supabase's REST API over tables in memory, enough for the
// town and the walk to read and write through the real backends
// (supabase/town-backend.ts, supabase/walk-backend.ts): filters, order,
// ranges and counts for reads; upsert, update and delete for writes, each one
// statement that is taken whole or not at all, like PostgREST. It keeps a few
// of the database's own rules (a reply's post, a row's book must be there),
// can be cut off from the network (or lose the answers to writes it took),
// and can be told to turn a write away. The reader's own books (my_books)
// are what a `my_books` table in the seed says, with the books they write
// and the copies copy_book makes; with one, a row of theirs that names
// another reader's typed-in book is turned away, as the database does
// (own_books_only). Without one, the database is one before that rule.
// With `versions`, it counts versions of what is saved whole and writes
// those through save_shelves, save_scene, save_nine and save_poster, only
// over the version named (write_versions); without, it is a database from
// before them, with no such columns.

type Row = Record<string, unknown>;

/** Why a statement was turned away, as PostgREST answers it. */
export interface Refusal {
  status: number;
  code: string;
  message: string;
}

export interface FakeWrite {
  table: string;
  op: "upsert" | "update" | "delete" | "rpc";
  rows: Row[];
}

/** The key each table's rows are told apart by, for an upsert without one. */
const PRIMARY: Record<string, string[]> = {
  shop_private: ["shop_id"],
  reader_settings: ["user_id"],
  shop_reactions: ["user_id", "shop_id"],
  shop_visits: ["user_id", "shop_id"],
};

/** What the database fills in for a row written without it. */
const DEFAULTS: Record<string, (at: string) => Row> = {
  books: (at) => ({
    isbn: null,
    publisher: "",
    price: null,
    source: "manual",
    created_at: at,
    updated_at: at,
  }),
  posts: (at) => ({
    book_id: null,
    spoiler: false,
    spoiler_folded: false,
    parent_id: null,
    reading_mode: null,
    created_at: at,
  }),
  post_reactions: (at) => ({ taps: 1, created_at: at }),
  shop_follows: (at) => ({ created_at: at }),
  book_marks: (at) => ({ created_at: at }),
  blocks: (at) => ({ created_at: at }),
  reading_entries: (at) => ({
    kind: "finished",
    body: "",
    feelings: [],
    spoiler: false,
    audience: "private",
    is_public: false,
    created_at: at,
    updated_at: at,
  }),
  library_entries: (at) => ({ updated_at: at }),
  library_shelves: (at) => ({
    note: "",
    show_wanted: false,
    deleted_at: null,
    audience: "private",
    rule: null,
    created_at: at,
    updated_at: at,
  }),
  library_shelf_books: () => ({ position: null }),
  posters: (at) => ({ allow_display: true, created_at: at, updated_at: at }),
  shop_private: (at) => ({
    shelves: [],
    scene_books: [],
    scene: null,
    updated_at: at,
  }),
  shop_reactions: (at) => ({ liked: false, message: "", updated_at: at }),
  saved_shops: (at) => ({ created_at: at }),
};

/** Rows that must point at a row already there: [column, table, its column]. */
const POINTS_AT: Record<string, [string, string, string][]> = {
  posts: [
    ["parent_id", "posts", "id"],
    ["book_id", "books", "id"],
  ],
  post_reactions: [["post_id", "posts", "id"]],
  reading_entries: [["book_id", "books", "id"]],
  library_entries: [["book_id", "books", "id"]],
  shop_follows: [["shop_id", "shops", "id"]],
  shop_reactions: [["shop_id", "shops", "id"]],
  saved_shops: [["shop_id", "shops", "id"]],
};

/** The columns write_versions adds, by table, with what a row begins at. */
const VERSION_COLUMNS: Record<string, string[]> = {
  profiles: ["nine_version"],
  posters: ["version"],
  shop_private: ["shelves_version", "scene_version"],
};

/** The fields of a poster that count toward its version. */
const POSTER_FIELDS = [
  "template",
  "theme",
  "font",
  "pages",
  "spoiler",
  "show_in_timeline",
  "status",
];

/** Two values as jsonb compares them: the same keys and values, any order. */
function sameValue(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value as Row)
              .sort()
              .map((key) => [key, sorted((value as Row)[key])]),
          )
        : value;
  return (
    JSON.stringify(sorted(a ?? null)) === JSON.stringify(sorted(b ?? null))
  );
}

export function fakeSupabase(
  userId: string,
  seed: Record<string, Row[]> = {},
  options: { versions?: boolean } = {},
) {
  const versions = options.versions ?? false;
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [
      table,
      rows.map((row) => {
        const copy = { ...row };
        for (const column of VERSION_COLUMNS[table] ?? [])
          if (versions) copy[column] ??= 0;
          else delete copy[column];
        return copy;
      }),
    ]),
  );
  const writes: FakeWrite[] = [];
  let tick = Date.parse("2026-10-18T00:00:00Z");
  /** A moment after the last one, so rows keep the order they came in. */
  const now = () => new Date((tick += 1000)).toISOString();
  const fake = {
    tables,
    /** Every statement that changed something, in order. */
    writes,
    /** No answer at all: every request fails as a lost connection does. */
    offline: false,
    /** Writes are taken, but their answers are lost on the way back. */
    loseAnswers: false,
    /** Turns a write away: why, or null to take it. */
    refuse: (() => null) as (write: FakeWrite) => Refusal | null,
    client: null as unknown as SupabaseClient<Database>,
  };
  const table = (name: string) => (tables[name] ??= []);

  /**
   * Counts the versions of a row written (write_versions): `was` is the row
   * before, or undefined for one made. A version sent is never taken.
   */
  function count(name: string, row: Row, was: Row | undefined) {
    if (!versions) {
      for (const column of VERSION_COLUMNS[name] ?? []) delete row[column];
      return;
    }
    if (name === "shop_private") {
      row.shelves_version = was
        ? Number(was.shelves_version) +
          Number(!sameValue(row.shelves, was.shelves))
        : Number(!sameValue(row.shelves ?? [], []));
      row.scene_version = was
        ? Number(was.scene_version) + Number(!sameValue(row.scene, was.scene))
        : Number((row.scene ?? null) !== null);
    } else if (name === "posters")
      row.version = was
        ? Number(was.version) +
          Number(
            POSTER_FIELDS.some((field) => !sameValue(row[field], was[field])),
          )
        : 0;
    else if (name === "profiles") row.nine_version = was ? was.nine_version : 0;
  }
  /** One up for the reader's nine (each statement that changed it). */
  const nineChanged = (by: number) => {
    const profile = table("profiles").find((row) => row.id === userId);
    if (versions && profile && by)
      profile.nine_version = Number(profile.nine_version) + by;
  };

  /** The reader's own books, or undefined before the database has them. */
  const myBooks = (): Row[] | undefined => {
    if (!tables.my_books) return undefined;
    const listed = new Set(tables.my_books.map((row) => row.id));
    return [
      ...tables.my_books,
      ...table("books")
        .filter((row) => row.created_by === userId && !listed.has(row.id))
        .map((row) => ({ id: row.id, copied_from: null })),
    ];
  };

  /** Why the rows cannot go in: one names another reader's typed-in book. */
  function othersBook(bookIds: unknown[]): Refusal | null {
    const mine = myBooks();
    if (!mine) return null;
    const own = new Set(mine.map((row) => row.id));
    for (const id of bookIds) {
      const book = table("books").find((row) => row.id === id);
      if (book && book.source === "manual" && !own.has(book.id))
        return {
          status: 400,
          code: "23514",
          message: "a reader's rows name their own books",
        };
    }
    return null;
  }

  /** Why the rows cannot go in: one points at a row that is not there. */
  function missingTarget(name: string, rows: Row[]): Refusal | null {
    for (const row of rows)
      for (const [column, other, key] of POINTS_AT[name] ?? []) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        if (!table(other).some((target) => target[key] === value))
          return {
            status: 409,
            code: "23503",
            message: `insert or update on table "${name}" violates foreign key constraint`,
          };
      }
    return null;
  }

  type Answer = {
    data: unknown;
    error: { message: string; code: string } | null;
    status: number;
    count: number | null;
  };
  const failed = (refusal: Refusal): Answer => ({
    data: null,
    error: { message: refusal.message, code: refusal.code },
    status: refusal.status,
    count: null,
  });
  const lost = (): Answer => ({
    data: null,
    error: { message: "TypeError: Failed to fetch", code: "" },
    status: 0,
    count: null,
  });

  class Query implements PromiseLike<Answer> {
    private filters: ((row: Row) => boolean)[] = [];
    private orders: [string, boolean][] = [];
    private from = 0;
    private size = Infinity;
    private counted = false;
    private head = false;
    private returning = false;
    private columns = "*";
    constructor(
      private name: string,
      private op: "select" | "upsert" | "update" | "delete",
      private payload: Row[] | Row | null = null,
      private options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
    ) {}
    select(
      _columns?: string,
      options: { count?: string; head?: boolean } = {},
    ) {
      if (this.op === "select") {
        this.counted = options.count === "exact";
        this.head = options.head ?? false;
        this.columns = _columns ?? "*";
      } else this.returning = true;
      return this;
    }
    private where(test: (row: Row) => boolean) {
      this.filters.push(test);
      return this;
    }
    eq(column: string, value: unknown) {
      return this.where((row) => row[column] === value);
    }
    neq(column: string, value: unknown) {
      return this.where((row) => row[column] !== value);
    }
    gte(column: string, value: string) {
      return this.where((row) => String(row[column]) >= value);
    }
    gt(column: string, value: string) {
      return this.where((row) => String(row[column]) > value);
    }
    lt(column: string, value: string) {
      return this.where((row) => String(row[column]) < value);
    }
    lte(column: string, value: string) {
      return this.where((row) => String(row[column]) <= value);
    }
    is(column: string, value: unknown) {
      return this.where((row) => (row[column] ?? null) === value);
    }
    not(column: string, _operator: "is", value: unknown) {
      return this.where((row) => (row[column] ?? null) !== value);
    }
    in(column: string, values: unknown[]) {
      return this.where((row) => values.includes(row[column]));
    }
    match(values: Row) {
      return this.where((row) =>
        Object.entries(values).every(([key, value]) => row[key] === value),
      );
    }
    order(column: string, options: { ascending?: boolean } = {}) {
      this.orders.push([column, options.ascending ?? true]);
      return this;
    }
    limit(count: number) {
      this.size = count;
      return this;
    }
    range(start: number, end: number) {
      this.from = start;
      this.size = end - start + 1;
      return this;
    }
    then<A = Answer, B = never>(
      resolve?: ((value: Answer) => A | PromiseLike<A>) | null,
      reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve()
        .then(() => this.answer())
        .then(resolve, reject);
    }
    private matching() {
      return (
        (this.name === "my_books" ? myBooks() : undefined) ?? table(this.name)
      ).filter((row) => this.filters.every((test) => test(row)));
    }
    private answer(): Answer {
      const answer = this.run();
      return fake.loseAnswers && this.op !== "select" && !answer.error
        ? lost()
        : answer;
    }
    private run(): Answer {
      if (fake.offline) return lost();
      if (this.name === "my_books" && !tables.my_books)
        // As postgrest-js answers it: a refused HEAD has no body to read
        // the refusal from.
        return this.head
          ? { data: null, error: null, status: 204, count: null }
          : failed({
              status: 404,
              code: "PGRST202",
              message: "no my_books",
            });
      if (
        this.op === "select" &&
        !versions &&
        /(^|[\s,])(\w+_)?version\b/.test(this.columns)
      )
        return failed({
          status: 400,
          code: "42703",
          message: "column does not exist",
        });
      if (this.op === "select") {
        const rows = this.matching().sort((a, b) => {
          for (const [column, up] of this.orders) {
            const [x, y] = [String(a[column]), String(b[column])];
            if (x !== y) return x < y === up ? -1 : 1;
          }
          return 0;
        });
        return {
          data: this.head
            ? null
            : rows
                .slice(this.from, this.from + Math.min(this.size, 1000))
                .map((row) => ({ ...row })),
          error: null,
          status: 200,
          count: this.counted ? rows.length : null,
        };
      }
      if (this.op === "upsert") {
        const rows = [this.payload as Row | Row[]].flat();
        const write: FakeWrite = { table: this.name, op: "upsert", rows };
        const refusal =
          fake.refuse(write) ??
          missingTarget(this.name, rows) ??
          (this.name === "books"
            ? null
            : othersBook(rows.map((row) => row.book_id)));
        if (refusal) return failed(refusal);
        const keys = this.options.onConflict?.split(",") ??
          PRIMARY[this.name] ?? ["id"];
        const taken: Row[] = [];
        for (const row of rows) {
          const there = table(this.name).find((other) =>
            keys.every((key) => other[key] === row[key]),
          );
          if (there) {
            if (this.options.ignoreDuplicates) continue;
            const was = { ...there };
            Object.assign(there, row);
            count(this.name, there, was);
            taken.push(there);
          } else {
            const fresh = { ...DEFAULTS[this.name]?.(now()), ...row };
            count(this.name, fresh, undefined);
            table(this.name).push(fresh);
            taken.push(fresh);
          }
        }
        writes.push(write);
        return {
          data: this.returning ? taken.map((row) => ({ ...row })) : null,
          error: null,
          status: 201,
          count: null,
        };
      }
      const rows = this.matching();
      const write: FakeWrite = {
        table: this.name,
        op: this.op,
        rows: this.op === "update" ? [this.payload as Row] : rows,
      };
      const refusal =
        fake.refuse(write) ??
        (this.op === "update"
          ? missingTarget(this.name, [this.payload as Row])
          : null);
      if (refusal) return failed(refusal);
      if (this.op === "update")
        for (const row of rows) {
          const was = { ...row };
          Object.assign(row, this.payload);
          count(this.name, row, was);
        }
      else
        tables[this.name] = table(this.name).filter(
          (row) => !rows.includes(row),
        );
      writes.push(write);
      return {
        data: this.returning ? rows.map((row) => ({ ...row })) : null,
        error: null,
        status: this.returning ? 200 : 204,
        count: null,
      };
    }
  }

  const rpc = (
    name: string,
    args: Row,
    options?: { count?: string; head?: boolean },
  ): PromiseLike<Answer> =>
    name === "my_books"
      ? new Query(name, "select").select("*", options)
      : called(name, args);
  const called = (name: string, args: Row): PromiseLike<Answer> =>
    Promise.resolve().then((): Answer => {
      if (fake.offline) return lost();
      if (name === "shop_visitors")
        return { data: [], error: null, status: 200, count: null };
      if (name === "copy_book") {
        const write: FakeWrite = { table: "books", op: "rpc", rows: [args] };
        const refusal = fake.refuse(write);
        if (refusal) return failed(refusal);
        const mine = (tables.my_books ??= []);
        if (!mine.some((row) => row.id === args.copy)) {
          const original = table("books").find(
            (row) => row.id === args.original,
          );
          if (!original)
            return failed({
              status: 404,
              code: "P0002",
              message: "no book has that id",
            });
          table("books").push({ ...original, id: args.copy });
          mine.push({ id: args.copy, copied_from: args.original });
        }
        writes.push(write);
        return { data: null, error: null, status: 204, count: null };
      }
      if (name === "replace_profile_nine") {
        const write: FakeWrite = {
          table: "profile_nine",
          op: "rpc",
          rows: [args],
        };
        const refusal =
          fake.refuse(write) ?? othersBook(args.book_ids as string[]);
        if (refusal) return failed(refusal);
        const ids = args.book_ids as string[];
        const notes = args.notes as string[];
        nineChanged(
          Number(
            table("profile_nine").some((row) => row.profile_id === userId),
          ) + Number(ids.length > 0),
        );
        tables.profile_nine = [
          ...table("profile_nine").filter((row) => row.profile_id !== userId),
          ...ids.map((book_id, index) => ({
            profile_id: userId,
            book_id,
            note: notes[index] ?? "",
            position: index,
          })),
        ];
        writes.push(write);
        return { data: null, error: null, status: 204, count: null };
      }
      if (versions && name in SAVES) {
        const write: FakeWrite = {
          table: SAVES[name],
          op: "rpc",
          rows: [{ name, ...args }],
        };
        const refusal = fake.refuse(write);
        if (refusal) return failed(refusal);
        const answer = saved(name, args);
        if (typeof answer !== "number") return failed(answer);
        writes.push(write);
        return fake.loseAnswers
          ? lost()
          : { data: answer, error: null, status: 200, count: null };
      }
      return failed({ status: 404, code: "PGRST202", message: "no " + name });
    });

  /** The tables the save_ functions write. */
  const SAVES: Record<string, string> = {
    save_shelves: "shop_private",
    save_scene: "shop_private",
    save_nine: "profile_nine",
    save_poster: "posters",
  };
  const changedSince = (what: string): Refusal => ({
    status: 409,
    code: "PT409",
    message: `the ${what} changed since`,
  });
  const notYours: Refusal = {
    status: 403,
    code: "42501",
    message: "new row violates row-level security policy",
  };
  /**
   * Runs a save_ function as the database does: written only over the
   * version named; what is held already is taken as written. Its version,
   * or why it was refused.
   */
  function saved(name: string, args: Row): number | Refusal {
    if (name === "save_shelves" || name === "save_scene") {
      const part = name === "save_shelves" ? "shelves" : "scene";
      const column = part + "_version";
      if (
        !table("shops").some(
          (shop) => shop.id === args.shop && shop.owner_id === userId,
        )
      )
        return notYours;
      let row = table("shop_private").find(
        (other) => other.shop_id === args.shop,
      );
      if (!row) {
        row = {
          ...DEFAULTS.shop_private(now()),
          shop_id: args.shop,
          [part]: args.value,
        };
        count("shop_private", row, undefined);
        table("shop_private").push(row);
        return Number(row[column]);
      }
      if (sameValue(row[part], args.value)) return Number(row[column]);
      if (row[column] !== args.base) return changedSince(part);
      const was = { ...row };
      row[part] = args.value;
      count("shop_private", row, was);
      return Number(row[column]);
    }
    if (name === "save_nine") {
      const profile = table("profiles").find((row) => row.id === userId);
      if (!profile) return notYours;
      const ids = args.book_ids as string[];
      const notes = args.notes as string[];
      const held = table("profile_nine")
        .filter((row) => row.profile_id === userId)
        .sort((a, b) => Number(a.position) - Number(b.position));
      if (
        sameValue(
          held.map((row) => row.book_id),
          ids,
        ) &&
        sameValue(
          held.map((row) => row.note),
          notes,
        )
      )
        return Number(profile.nine_version);
      if (profile.nine_version !== args.base) return changedSince("nine");
      const refusal = othersBook(ids);
      if (refusal) return refusal;
      nineChanged(Number(held.length > 0) + Number(ids.length > 0));
      tables.profile_nine = [
        ...table("profile_nine").filter((row) => row.profile_id !== userId),
        ...ids.map((book_id, index) => ({
          profile_id: userId,
          book_id,
          note: notes[index] ?? "",
          position: index,
        })),
      ];
      return Number(profile.nine_version);
    }
    // save_poster
    const value = args.value as Row;
    const fields = Object.fromEntries(
      POSTER_FIELDS.map((field) => [field, value[field]]),
    );
    const base = args.base ?? null;
    const row = table("posters").find(
      (other) => other.id === args.poster && other.author_id === userId,
    );
    if (!row) {
      if (base !== null) return changedSince("poster");
      if (table("posters").some((other) => other.id === args.poster))
        return {
          status: 409,
          code: "23505",
          message: "duplicate key value violates unique constraint",
        };
      const fresh = {
        ...DEFAULTS.posters(now()),
        id: args.poster,
        author_id: userId,
        ...fields,
      };
      count("posters", fresh, undefined);
      table("posters").push(fresh);
      return 0;
    }
    if (POSTER_FIELDS.every((field) => sameValue(row[field], fields[field])))
      return Number(row.version);
    if (row.version !== (base ?? 0)) return changedSince("poster");
    const was = { ...row };
    Object.assign(row, fields);
    count("posters", row, was);
    return Number(row.version);
  }

  fake.client = {
    from: (name: string) => ({
      select: (
        columns?: string,
        options?: { count?: string; head?: boolean },
      ) => new Query(name, "select").select(columns, options),
      upsert: (
        payload: Row | Row[],
        options?: { onConflict?: string; ignoreDuplicates?: boolean },
      ) => new Query(name, "upsert", payload, options),
      update: (patch: Row) => new Query(name, "update", patch),
      delete: () => new Query(name, "delete"),
    }),
    rpc,
  } as unknown as SupabaseClient<Database>;
  return fake;
}

/** A browser's storage in memory, for what the town keeps on the device. */
export function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}
