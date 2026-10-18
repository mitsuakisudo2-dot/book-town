import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Tables } from "../src/lib/supabase/database.types";
import {
  arrivedFromRows,
  bookFromRow,
  cleanShelves,
  emptyTown,
  placementKey,
  planWrites,
  referencedBookIds,
  townFromRows,
  type BookRow,
  type RemoteIds,
  type RemoteRows,
  type ShopRow,
  type Write,
} from "../src/lib/town-remote";
import { demoBooks, demoPosters, demoPosts, demoShops } from "../src/lib/data";
import { createRegisteredBook } from "../src/lib/books";
import type { Poster } from "../src/lib/posters";
import { isSampleBook, sampleBookRowId, withSamples } from "../src/lib/samples";
import {
  all,
  allRows,
  backgroundSync,
  RowsChangedError,
  TownSyncError,
  type Outcome,
  type Pageable,
} from "../src/lib/supabase/sync";
import {
  accountTownBackend,
  loadPublicTown,
  loadTown,
  visitorTownBackend,
} from "../src/lib/supabase/town-backend";
import { loadWalkRows } from "../src/lib/supabase/walk-backend";
import { emptyArrived, takeIn, type Arrived } from "../src/lib/arrived";
import { createLetterReads } from "../src/lib/arrivals";
import { createTownStore, townSettled } from "../src/lib/store";
import { counterId, type TownBackend } from "../src/lib/town-backend";
import {
  ME_ID,
  OWN_SHOP_ID,
  popReactionKey,
  type TownState,
} from "../src/lib/types";
import { cleanVisibilities } from "../src/lib/visibility";
import { sameWork, workOf } from "../src/lib/works";

// Checks, without a database, how the signed-in town is built from rows and
// what is written back. Everything runs inside main() because tsx compiles this
// file as CommonJS.

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const AKI_SHOP = "00000000-0000-4000-8000-0000000000a5";
const BEN_SHOP = "00000000-0000-4000-8000-0000000000b5";
const BOOK = "00000000-0000-4000-8000-000000000b01";
const OTHER_BOOK = "00000000-0000-4000-8000-000000000b02";
const WORK = "00000000-0000-4000-8000-000000000a01";
const ids: RemoteIds = { userId: AKI, shopId: AKI_SHOP };
const at = "2026-10-12T09:00:00Z";

const profile = (id: string, handle: string): Tables<"profiles"> => ({
  id,
  handle,
  name: handle.toUpperCase(),
  bio: "",
  color: "#768281",
  links: [],
  compose_icon: "pen",
  reading_visibility: "private",
  nine_version: 0,
  created_at: at,
  updated_at: at,
});

/** A book row; the database gives each book a work, its own unless joined. */
const book = (id: string, work = "w" + id.slice(1)): BookRow => ({
  id,
  isbn: null,
  title: "華氏451度",
  author: "レイ・ブラッドベリ",
  publisher: "",
  price: null,
  source: "manual",
  work_id: work,
  created_at: at,
  updated_at: at,
});

const shelf = (id: string, isPublic: boolean, bookId = BOOK) => ({
  id,
  name: isPublic ? "旅" : "秘密の棚",
  capacity: 20,
  isPublic,
  items: [{ id: id + "-item", bookId, display: "spine", pop: "好き" }],
});

const shop = (
  id: string,
  owner: string,
  extra: Partial<ShopRow> = {},
): ShopRow => ({
  id,
  owner_id: owner,
  name: owner === AKI ? "夜の本屋" : "朝の本屋",
  description: "",
  tagline: "",
  theme: "sage",
  is_open: true,
  public_shelves: [],
  public_scene_books: [],
  ...extra,
});

const post = (
  id: string,
  author: string,
  extra: Partial<Tables<"posts">> = {},
): Tables<"posts"> => ({
  id,
  author_id: author,
  body: "炎の色が忘れられない。",
  book_id: null,
  spoiler: false,
  spoiler_folded: false,
  parent_id: null,
  reading_mode: null,
  created_at: at,
  ...extra,
});

function rows(extra: Partial<RemoteRows> = {}): RemoteRows {
  return {
    profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
    nine: [],
    books: [book(BOOK), book(OTHER_BOOK)],
    shops: [],
    ownShelves: [],
    ownSceneBooks: [],
    ownShopFollowers: 0,
    ownShopVisitors: null,
    shopMessages: [],
    follows: [],
    blocks: [],
    marks: [],
    posts: [],
    postReactions: [],
    spoilerReports: [],
    popReactions: [],
    sessions: [],
    records: [],
    posters: [],
    seenNotifications: [],
    folds: [],
    myReports: [],
    readerSettings: null,
    ...extra,
  };
}

const posterRow = (
  id: string,
  author: string,
  extra: Partial<Tables<"posters">> = {},
): Tables<"posters"> => ({
  id,
  author_id: author,
  template: "lineup",
  theme: "navy",
  font: "mincho",
  pages: [
    {
      blocks: [
        { type: "heading", text: "夜の本" },
        { type: "books", book_ids: [BOOK, OTHER_BOOK] },
        { type: "text", text: "眠れない夜に。" },
      ],
    },
  ],
  spoiler: false,
  show_in_timeline: true,
  allow_display: true,
  status: "published",
  version: 0,
  created_at: at,
  updated_at: at,
  ...extra,
});

const kinds = (writes: Write[]) =>
  writes.map((write) =>
    write.kind === "add" || write.kind === "remove"
      ? write.kind + ":" + write.table
      : write.kind,
  );

type AnyRow = Record<string, unknown>;

interface FakeQuery extends PromiseLike<Outcome<AnyRow[]>> {
  eq(column: string, value: unknown): FakeQuery;
  neq(column: string, value: unknown): FakeQuery;
  gte(column: string, value: string): FakeQuery;
  lt(column: string, value: string): FakeQuery;
  lte(column: string, value: string): FakeQuery;
  is(column: string, value: unknown): FakeQuery;
  not(column: string, operator: "is", value: null): FakeQuery;
  in(column: string, values: unknown[]): FakeQuery;
  order(column: string, options?: { ascending?: boolean }): FakeQuery;
  limit(count: number): FakeQuery;
  range(from: number, to: number): FakeQuery;
}

/**
 * Stands in for the Supabase client's reads: filters, order, limit and range
 * over rows in memory, at most `cap` rows an answer, and the count when asked,
 * like the server. `between` runs after each answer, so a check can change the
 * rows while they are being read.
 */
function fakeReads(
  tables: Record<string, AnyRow[]>,
  options: {
    cap?: number;
    between?: (table: string, from: number) => void;
  } = {},
) {
  const cap = options.cap ?? 1000;
  const asked: {
    table: string;
    from: number;
    ids?: number;
    /** The filters, as PostgREST would read them: "author_id=in.2". */
    filters: string[];
  }[] = [];
  const select = (table: string, counted: boolean): FakeQuery => {
    let rows = [...(tables[table] ?? [])];
    const orders: [string, boolean][] = [];
    const filters: string[] = [];
    let from = 0;
    let size = Infinity;
    let ids: number | undefined;
    const answer = (): Outcome<AnyRow[]> => {
      if (size !== Infinity) filters.push("limit=" + size);
      asked.push({ table, from, ids, filters });
      const sorted = [...rows].sort((a, b) => {
        for (const [column, up] of orders) {
          const [x, y] = [String(a[column]), String(b[column])];
          if (x !== y) return x < y === up ? -1 : 1;
        }
        return 0;
      });
      const outcome = {
        data: sorted.slice(from, from + Math.min(size, cap)),
        error: null,
        status: 200,
        count: counted ? rows.length : null,
      };
      options.between?.(table, from);
      return outcome;
    };
    const query: FakeQuery = {
      eq(column, value) {
        filters.push(`${column}=eq.${value}`);
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      neq(column, value) {
        filters.push(`${column}=neq.${value}`);
        rows = rows.filter((row) => row[column] !== value);
        return query;
      },
      gte(column, value) {
        filters.push(`${column}=gte.${value}`);
        rows = rows.filter((row) => String(row[column]) >= value);
        return query;
      },
      lt(column, value) {
        filters.push(`${column}=lt.${value}`);
        rows = rows.filter((row) => String(row[column]) < value);
        return query;
      },
      lte(column, value) {
        filters.push(`${column}=lte.${value}`);
        rows = rows.filter((row) => String(row[column]) <= value);
        return query;
      },
      is(column, value) {
        filters.push(`${column}=is.${value}`);
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      not(column, operator, value) {
        filters.push(`${column}=not.${operator}.${value}`);
        rows = rows.filter((row) => row[column] !== value);
        return query;
      },
      in(column, values) {
        ids = values.length;
        filters.push(`${column}=in.${values.length}`);
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      order(column, order = {}) {
        orders.push([column, order.ascending ?? true]);
        filters.push(
          `order=${column}.${order.ascending === false ? "desc" : "asc"}`,
        );
        return query;
      },
      limit(count) {
        size = count;
        return query;
      },
      range(start, end) {
        from = start;
        size = end - start + 1;
        return query;
      },
      then(resolve, reject) {
        return Promise.resolve().then(answer).then(resolve, reject);
      },
    };
    return query;
  };
  const client = {
    from: (table: string) => ({
      select: (_columns?: string, options: { count?: string } = {}) =>
        select(table, options.count === "exact"),
    }),
    // A function returning rows, as a table of its name. A database
    // before town_view (the town is read table by table) has neither.
    rpc: (name: string, _args?: unknown, options: { count?: string } = {}) =>
      (name === "town_view" || name === "town_books") && !(name in tables)
        ? Promise.resolve({
            data: null,
            error: { message: "no " + name, code: "PGRST202" },
            status: 404,
          })
        : select(name, options.count === "exact"),
  };
  return {
    asked,
    /** One table's select, for allRows. */
    pages: (table: string) => (count?: "exact") =>
      select(table, count === "exact"),
    client: client as unknown as Parameters<typeof loadTown>[0],
  };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check("the signed-in person and their shop get the usual ids", () => {
    const town = townFromRows(
      rows({
        shops: [
          shop(AKI_SHOP, AKI, { is_open: false }),
          shop(BEN_SHOP, BEN, {
            public_shelves: [shelf("s1", true, OTHER_BOOK)],
          }),
        ],
        ownShelves: [shelf("s1", true), shelf("s2", false)],
        ownShopFollowers: 3,
      }),
      ids,
    );
    assert.equal(town.me.id, ME_ID);
    assert.equal(town.me.handle, "aki");
    assert.equal(town.ownShop?.id, OWN_SHOP_ID);
    assert.equal(town.ownShop?.ownerId, ME_ID);
    assert.equal(town.ownShop?.followers, 3);
    assert.deepEqual(
      town.ownShop?.shelves.map((entry) => entry.isPublic),
      [true, false],
    );
    assert.deepEqual(
      town.shops.map((entry) => [entry.id, entry.ownerId, entry.demo]),
      [[BEN_SHOP, BEN, false]],
    );
    assert.deepEqual(
      town.readers.map((reader) => reader.id),
      [BEN],
    );
  });

  await check("closed shops and shops of unknown owners stay out", () => {
    const town = townFromRows(
      rows({
        shops: [
          shop(BEN_SHOP, BEN, { is_open: false }),
          shop("00000000-0000-4000-8000-0000000000c5", "nobody"),
        ],
      }),
      ids,
    );
    assert.deepEqual(town.shops, []);
  });

  await check("only the owner learns how many follow a shop", () => {
    const town = townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN)],
        follows: [{ shop_id: BEN_SHOP }],
        ownShopFollowers: 7,
      }),
      ids,
    );
    assert.deepEqual(town.following, [BEN_SHOP]);
    assert.equal(town.shops[0].followers, 0);
  });

  await check(
    "the owner hears how many stopped by, only when someone did",
    () => {
      const visited = (count: number) =>
        townFromRows(
          rows({
            shops: [shop(AKI_SHOP, AKI), shop(BEN_SHOP, BEN)],
            ownShopVisitors: { count, at },
          }),
          ids,
        );
      assert.deepEqual(visited(2).ownShop?.weekVisitors, { count: 2, at });
      assert.equal(visited(2).shops[0].weekVisitors, undefined);
      assert.equal("weekVisitors" in (visited(0).ownShop ?? {}), false);
    },
  );

  await check("other people's books carry no summary of their own", () => {
    // A reader's own registered books are the ones in their 登録 list; who
    // typed a book in is not something the database tells anyone.
    const town = townFromRows(
      rows({
        marks: [
          { user_id: AKI, book_id: BOOK, kind: "library", created_at: at },
          { user_id: AKI, book_id: OTHER_BOOK, kind: "wish", created_at: at },
        ],
      }),
      ids,
    );
    const mine = town.books.find((entry) => entry.id === BOOK);
    const theirs = town.books.find((entry) => entry.id === OTHER_BOOK);
    assert.notEqual(mine?.summary, theirs?.summary);
    assert.match(theirs?.summary ?? "", /あらすじは登録されていません/);
  });

  await check("books carry the work the database put them in", () => {
    // Two registrations of one ISBN share their edition's work; the 見本 and
    // the demo's books have none, so each is its own work.
    const SAME = "00000000-0000-4000-8000-000000000b03";
    const town = townFromRows(
      rows({
        books: [
          { ...book(BOOK, WORK), isbn: "9784150119553" },
          { ...book(SAME, WORK), isbn: "9784150119553" },
          book(OTHER_BOOK),
          { ...book(sampleBookRowId(demoBooks[0].id), WORK) },
        ],
      }),
      ids,
    );
    const byId = (id: string) => town.books.find((entry) => entry.id === id)!;
    assert.equal(byId(BOOK).workId, WORK);
    assert.ok(sameWork(byId(BOOK), byId(SAME)));
    assert.ok(!sameWork(byId(BOOK), byId(OTHER_BOOK)));
    assert.equal(byId(demoBooks[0].id).workId, undefined);
    assert.equal(workOf(byId(demoBooks[0].id)), demoBooks[0].id);
  });

  await check("posts: own ones are 'me', counts only on own posts", () => {
    const reply = post("00000000-0000-4000-8000-0000000000e2", BEN, {
      parent_id: "00000000-0000-4000-8000-0000000000e1",
      created_at: "2026-10-12T10:00:00Z",
    });
    const town = townFromRows(
      rows({
        posts: [
          reply,
          post("00000000-0000-4000-8000-0000000000e1", AKI),
          // A reply to a post that is not in the town is left out.
          post("00000000-0000-4000-8000-0000000000e3", BEN, {
            parent_id: "00000000-0000-4000-8000-0000000000ff",
          }),
        ],
        postReactions: [
          {
            user_id: BEN,
            post_id: "00000000-0000-4000-8000-0000000000e1",
            kind: "like",
            taps: 1,
            created_at: at,
          },
          {
            user_id: AKI,
            post_id: reply.id,
            kind: "want",
            taps: 1,
            created_at: at,
          },
        ],
      }),
      ids,
    );
    assert.deepEqual(
      town.posts.map((entry) => [entry.authorId, entry.likes]),
      [
        [ME_ID, 1],
        [BEN, 0],
      ],
    );
    assert.deepEqual(town.wantedPosts, [reply.id]);
    assert.deepEqual(town.likedPosts, []);
  });

  await check("a POP reaction comes back only for a public placement", () => {
    const town = townFromRows(
      rows({
        shops: [
          shop(BEN_SHOP, BEN, {
            public_shelves: [shelf("s1", true, OTHER_BOOK)],
          }),
        ],
        popReactions: [
          {
            user_id: AKI,
            shop_id: BEN_SHOP,
            placement_key: placementKey("s1", "s1-item"),
            reaction: "love",
            created_at: at,
          },
          {
            user_id: AKI,
            shop_id: BEN_SHOP,
            placement_key: placementKey("s9", "gone"),
            reaction: "love",
            created_at: at,
          },
        ],
      }),
      ids,
    );
    assert.deepEqual(town.popReactions, {
      [popReactionKey(BEN_SHOP, "s1", "s1-item")]: ["love"],
    });
  });

  await check("bad shelves from someone else's shop are dropped", () => {
    const known = new Set([BOOK]);
    const shelves = cleanShelves(
      [
        shelf("s1", true),
        shelf("s1", true), // the same id twice
        { ...shelf("s2", true), capacity: 0 },
        { ...shelf("s3", true), items: "not a list" },
        {
          ...shelf("s4", true),
          capacity: 4,
          items: [
            { id: "a", bookId: BOOK, display: "face", pop: "" },
            { id: "b", bookId: BOOK, display: "spine", pop: "" }, // same book again
            { id: "c", bookId: "unknown", display: "spine", pop: "" },
            { id: "d", bookId: BOOK, display: "sideways", pop: "" },
          ],
        },
        "not a shelf",
      ],
      known,
    );
    assert.deepEqual(
      shelves.map((entry) => [entry.id, entry.items.map((item) => item.id)]),
      [
        ["s1", ["s1-item"]],
        ["s4", ["a"]],
      ],
    );
    assert.deepEqual(cleanShelves({ not: "a list" }, known), []);
  });

  await check("every book a town points to is read", () => {
    const referenced = referencedBookIds({
      ...rows(),
      shops: [
        shop(BEN_SHOP, BEN, {
          public_shelves: [shelf("s1", true, OTHER_BOOK)],
        }),
      ],
      ownShelves: [shelf("s1", true)],
    });
    assert.deepEqual(referenced.sort(), [BOOK, OTHER_BOOK].sort());
    // Books standing only in a store scene are read too.
    const inScenes = referencedBookIds({
      ...rows(),
      shops: [shop(BEN_SHOP, BEN, { public_scene_books: [OTHER_BOOK, 3] })],
      ownSceneBooks: [BOOK],
    });
    assert.deepEqual(inScenes.sort(), [BOOK, OTHER_BOOK].sort());
    // So are the books on posters.
    const onPosters = referencedBookIds({
      ...rows(),
      posters: [posterRow("00000000-0000-4000-8000-0000000000d1", BEN)],
    });
    assert.deepEqual(onPosters.sort(), [BOOK, OTHER_BOOK].sort());
  });

  // The person's own rows are read a page at a time (allRows), so the
  // server's 1000-row limit never leaves one out.
  const uuid = (n: number) =>
    "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
  const minutes = (n: number) =>
    new Date(Date.parse(at) - n * 60_000).toISOString();
  const retried = (error: unknown) =>
    error instanceof TownSyncError && error.retry;

  await check(
    "pages meet without losing or repeating a row, whatever the server's limit",
    async () => {
      // Two marks a book, kept in no particular order.
      const marks = Array.from({ length: 2500 }, (_, n) => ({
        user_id: AKI,
        book_id: uuid(2500 - Math.floor(n / 2)),
        kind: n % 2 ? "wish" : "library",
        created_at: at,
      }));
      const key = (row: AnyRow) => row.book_id + ":" + row.kind;
      // Never more than 1000 at a time, each page after the first starting
      // at the last row read, until the rows counted are all in.
      const thousands = [0, 999, 1998];
      const pages: [number, number[]][] = [
        [1000, thousands],
        [300, [0, 299, 598, 897, 1196, 1495, 1794, 2093, 2392]],
        [5000, thousands],
      ];
      for (const [cap, starts] of pages) {
        const fake = fakeReads({ book_marks: marks }, { cap });
        const read = await allRows(fake.pages("book_marks"), [
          "book_id",
          "kind",
        ]);
        assert.deepEqual(read.map(key), marks.map(key).sort());
        assert.deepEqual(
          fake.asked.map((ask) => ask.from),
          starts,
        );
      }
    },
  );

  await check("an empty table is one request and no rows", async () => {
    const fake = fakeReads({});
    assert.deepEqual(await allRows(fake.pages("book_marks"), ["book_id"]), []);
    assert.equal(fake.asked.length, 1);
  });

  await check(
    "rows that change while being read are read again, never used short",
    async () => {
      // 1500 sessions ten apart, so a new one can go between any two.
      const sessions = () =>
        Array.from({ length: 1500 }, (_, n) => ({ id: uuid(10 * n + 10) }));
      // Reads them, changing them once the first page is answered.
      const readChanging = (change: (rows: AnyRow[]) => void, cap = 1000) => {
        const rows = sessions();
        const fake = fakeReads(
          { reading_sessions: rows },
          { cap, between: (_, from) => from === 0 && change(rows) },
        );
        return allRows(fake.pages("reading_sessions"), ["id"]);
      };
      const changed = (error: unknown) =>
        error instanceof RowsChangedError && error.retry;
      // A row added ahead of the next page pushes one across the boundary.
      await assert.rejects(
        readChanging((rows) => rows.unshift({ id: uuid(1) })),
        changed,
      );
      // A row removed ahead of it lets one slip between the pages, even when
      // a row added after it keeps the count.
      await assert.rejects(
        readChanging((rows) => {
          rows.splice(5, 1);
          rows.push({ id: uuid(99999) });
        }),
        changed,
      );
      // A row added after the last one: the count tells.
      await assert.rejects(
        readChanging((rows) => rows.push({ id: uuid(99999) })),
        changed,
      );
      // Whatever is removed and added between two pages, the read is tried
      // again or holds every row that was there all along, each once.
      for (const cap of [1000, 300])
        for (const removed of [null, 0, 5, cap - 1, cap, 1499])
          for (const after of [null, -1, 5, cap - 2, cap - 1, cap, 1499]) {
            const read = await readChanging((rows) => {
              if (after !== null) rows.push({ id: uuid(10 * after + 15) });
              if (removed !== null) rows.splice(removed, 1);
            }, cap).catch((error) => {
              assert.ok(changed(error));
              return null;
            });
            if (!read) continue;
            const ids = new Set(read.map((row) => row.id));
            assert.equal(ids.size, read.length);
            assert.ok(
              sessions().every((row, n) => n === removed || ids.has(row.id)),
            );
          }
      // A row added ahead of a last page that would end just on the last
      // row counted pushes that row out of it: the read is tried again.
      for (const [cap, count] of [
        [7, 13],
        [1000, 1999],
      ]) {
        const rows = Array.from({ length: count }, (_, n) => ({
          id: uuid(10 * n + 10),
        }));
        const fake = fakeReads(
          { reading_sessions: rows },
          {
            cap,
            between: (_, from) =>
              from === 0 && rows.splice(cap, 0, { id: uuid(10 * cap + 5) }),
          },
        );
        await assert.rejects(
          allRows(fake.pages("reading_sessions"), ["id"]),
          changed,
        );
      }
      // Without a count there is no telling the list is whole.
      const uncounted = fakeReads({ reading_sessions: sessions() });
      await assert.rejects(
        allRows(() => uncounted.pages("reading_sessions")(), ["id"]),
        retried,
      );
    },
  );

  // A reader with 1001 wishes: more than one request holds, and the books
  // reach back past the newest 300 of the catalog.
  const wished = Array.from({ length: 1001 }, (_, n) => uuid(0x1000 + n));
  const wishedTown = () => ({
    profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
    books: wished.map((id, n) => ({ ...book(id), created_at: minutes(n) })),
    book_marks: [
      ...wished.map((book_id, n) => ({
        user_id: AKI,
        book_id,
        kind: "wish",
        created_at: minutes(-n),
      })),
      // Someone else's marks are not the reader's.
      { user_id: BEN, book_id: wished[0], kind: "finished", created_at: at },
    ],
    reading_sessions: [
      {
        id: uuid(0x2001),
        user_id: AKI,
        book_id: wished[1000],
        mode: "solo",
        started_at: minutes(10),
        ended_at: minutes(5),
      },
    ],
    reading_entries: [
      {
        id: uuid(0x3001),
        user_id: AKI,
        book_id: wished[999],
        kind: "finished",
        body: "",
        feelings: ["quiet"],
        spoiler: false,
        is_public: false,
        created_at: minutes(3),
        updated_at: minutes(3),
      },
      {
        id: uuid(0x3002),
        user_id: BEN,
        book_id: wished[998],
        kind: "finished",
        body: "",
        feelings: ["warm"],
        spoiler: false,
        is_public: true,
        created_at: minutes(2),
        updated_at: minutes(2),
      },
    ],
  });

  await check(
    "1001 marks all arrive, with the books they point to",
    async () => {
      const fake = fakeReads(wishedTown());
      // One request stops at the server's limit.
      assert.equal(
        (
          await all(
            fake.client.from("book_marks").select("*").eq("user_id", AKI),
          )
        ).length,
        1000,
      );
      fake.asked.length = 0;
      const { state } = await loadTown(fake.client, AKI, [], () => AKI_SHOP);
      assert.deepEqual(state.wishlist, wished);
      assert.deepEqual(state.finishedBooks, []);
      const known = new Set(state.books.map((entry) => entry.id));
      assert.ok(wished.every((id) => known.has(id)));
      // The newest 300, then the other 701 by id, 100 at a time.
      const byId = fake.asked.filter(
        (ask) => ask.table === "books" && ask.ids !== undefined,
      );
      assert.deepEqual(
        byId.map((ask) => ask.ids),
        [100, 100, 100, 100, 100, 100, 100, 1],
      );
      assert.deepEqual(
        fake.asked
          .filter((ask) => ask.table === "book_marks")
          .map((ask) => ask.from),
        [0, 999],
      );
      // The reader's own reading and records, each once, beside others'.
      assert.deepEqual(
        state.readingSessions.map((entry) => entry.bookId),
        [wished[1000]],
      );
      assert.deepEqual(
        state.readingRecords.map((entry) => [entry.readerId, entry.bookId]),
        [
          [ME_ID, wished[999]],
          [BEN, wished[998]],
        ],
      );
    },
  );

  await check(
    "the reader's own nine comes whole, however many nines the town holds",
    async () => {
      const fake = fakeReads({
        ...wishedTown(),
        // 112 others' nines fill a request before the reader's own comes.
        profile_nine: [
          ...Array.from({ length: 1008 }, (_, n) => ({
            profile_id: uuid(0x5000 + Math.floor(n / 9)),
            position: (n % 9) + 1,
            book_id: wished[n % 9],
            note: "",
          })),
          {
            profile_id: AKI,
            position: 1,
            book_id: wished[0],
            note: "最初の一冊",
          },
        ],
      });
      const { state } = await loadTown(fake.client, AKI, [], () => AKI_SHOP);
      assert.deepEqual(state.me.lifeNine, [wished[0]]);
      assert.deepEqual(state.me.nineNotes, { [wished[0]]: "最初の一冊" });
    },
  );

  await check(
    "a town whose rows change while it is read is read again as a whole",
    async () => {
      // Another device keeps a book while the first page of marks is on its
      // way, as many reads in a row as asked.
      const loadChanging = async (times: number) => {
        const rows = wishedTown();
        const kept = Array.from({ length: times }, (_, n) => uuid(0xf00 + n));
        rows.books.push(...kept.map((id) => book(id)));
        let moved = 0;
        const fake = fakeReads(rows, {
          between(table, from) {
            if (table !== "book_marks" || from || moved === times) return;
            rows.book_marks.unshift({
              user_id: AKI,
              book_id: kept[moved++],
              kind: "favorite",
              created_at: at,
            });
          },
        });
        const backend = accountTownBackend(fake.client, AKI, {
          storage: false,
          retryDelays: [1],
        });
        const statuses: string[] = [];
        backend.watch?.({
          status: (status) => statuses.push(status),
          replace: () => undefined,
        });
        const { state } = await backend.load();
        backend.close?.();
        assert.equal(state.wishlist.length, 1001);
        assert.deepEqual([...state.favorites].sort(), kept);
        const reads = fake.asked.filter((ask) => ask.table === "profiles");
        return { statuses, reads: reads.length };
      };
      // Read again at once, with nothing on screen: the network is fine.
      assert.deepEqual(await loadChanging(1), { statuses: [], reads: 2 });
      // Rows that keep changing are waited out like network trouble.
      assert.deepEqual(await loadChanging(4), {
        statuses: ["unavailable"],
        reads: 5,
      });
    },
  );

  await check(
    "every read of the database is whole, or a stretch on purpose",
    () => {
      // Supabase stops at 1000 rows a request without a word, so a list is
      // read with allRows (sync.ts). A read that stops at a number has to
      // be one of these, each read on past it another way: the newest 便り
      // and books (with newer, older and the books the rows point to), and
      // the newest 注釈 of a page; the newest records felt with a feeling,
      // the books a search shows for it, newest first (town-more.ts); or one
      // that reads no row at all (whether the database counts versions,
      // before the reader has a shop).
      const root = path.resolve(__dirname, "..");
      const found: Record<string, string[]> = {};
      for (const entry of readdirSync(path.join(root, "src"), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
        const file = path.join(entry.parentPath, entry.name);
        const limits = [
          ...readFileSync(file, "utf8").matchAll(/\.limit\(([^)]*)\)/g),
        ].map((match) => match[1]);
        if (limits.length) found[path.relative(root, file)] = limits;
      }
      assert.deepEqual(found, {
        "src/lib/supabase/site-notes.ts": ["200"],
        "src/lib/supabase/town-backend.ts": [
          "POSTS",
          "CATALOG",
          "NEWER_MAX",
          "NEWER_MAX",
          "size",
          "FELT_RECORDS",
        ],
        "src/lib/supabase/walk-backend.ts": ["0"],
      });
    },
  );

  await check(
    "past the limit, the pages after the first are asked for together",
    async () => {
      // Waits a moment on every answer, counting the requests on their way.
      const rows = Array.from({ length: 3500 }, (_, n) => ({
        id: uuid(n + 1),
      }));
      const starts: number[] = [];
      let open = 0;
      let most = 0;
      const select = (count?: "exact"): Pageable<AnyRow> => {
        const query: Pageable<AnyRow> = {
          order: () => query,
          async range(from, to) {
            starts.push(from);
            most = Math.max(most, (open += 1));
            await new Promise((done) => setTimeout(done, 5));
            open -= 1;
            return {
              data: rows.slice(from, Math.min(to + 1, from + 1000)),
              error: null,
              status: 200,
              count: count ? rows.length : null,
            };
          },
        };
        return query;
      };
      assert.deepEqual(await allRows(select, ["id"]), rows);
      // The first counts them; the other three go at once, each starting at
      // the last row of the one before.
      assert.deepEqual(starts, [0, 999, 1998, 2997]);
      assert.equal(most, 3);
    },
  );

  const entry = (
    id: string,
    userId: string,
    extra: Partial<Tables<"reading_entries">> = {},
  ): Tables<"reading_entries"> => ({
    id,
    user_id: userId,
    book_id: BOOK,
    kind: "finished",
    body: "",
    feelings: ["quiet"],
    spoiler: false,
    is_public: extra.is_public ?? true,
    audience: (extra.is_public ?? true) ? "everyone" : "private",
    created_at: at,
    updated_at: at,
    ...extra,
  });

  // A town past the server's 1000 rows a request in every list it shows.
  const many = (count: number, from: number) =>
    Array.from({ length: count }, (_, n) => uuid(from + n));
  const crowd = many(1500, 0x10000);
  const crowdedTown = () => ({
    profiles: [
      profile(AKI, "aki"),
      ...crowd.map((id, n) => ({
        ...profile(id, "r" + n),
        created_at: minutes(n),
      })),
    ],
    books: [book(BOOK)],
    // 1200 shops, all open.
    shops: crowd.slice(0, 1200).map((owner, n) => ({
      ...shop(uuid(0x20000 + n), owner),
      created_at: minutes(n),
    })),
    // 1350 rows of nines: 150 readers' whole nine.
    profile_nine: crowd.slice(0, 150).flatMap((profile_id) =>
      Array.from({ length: 9 }, (_, n) => ({
        profile_id,
        position: n + 1,
        book_id: BOOK,
        note: "",
      })),
    ),
    // 2299 public records, and one the reader keeps to themselves.
    reading_entries: [
      ...crowd.map((user, n) =>
        entry(uuid(0x30000 + n), user, { created_at: minutes(n) }),
      ),
      ...crowd
        .slice(0, 799)
        .map((user, n) =>
          entry(uuid(0x31000 + n), user, { created_at: minutes(n) }),
        ),
      entry(uuid(0x32000), AKI, { is_public: false }),
    ],
    // 1100 posters put up.
    posters: crowd
      .slice(0, 1100)
      .map((author, n) =>
        posterRow(uuid(0x40000 + n), author, { created_at: minutes(n) }),
      ),
    // 1100 shops folded by reports.
    moderation_folds: crowd.slice(0, 1100).map((_, n) => ({
      target_kind: "shop",
      target_id: uuid(0x20000 + n),
      state: "folded",
      since: at,
    })),
    // 1100 reading together right now.
    reading_sessions: crowd.slice(0, 1100).map((user_id, n) => ({
      id: uuid(0x50000 + n),
      user_id,
      book_id: BOOK,
      mode: "together",
      started_at: minutes(n),
      ended_at: null,
    })),
  });

  await check(
    "a town past 1000 in every list is read whole, signed in or not",
    async () => {
      const crowded = (state: TownState) => ({
        readers: state.readers.length,
        shops: state.shops.length,
        nines: state.readers.filter((reader) => reader.lifeNine.length === 9)
          .length,
        records: state.readingRecords.length,
        posters: state.posters.length,
        folds: Object.keys(state.reviewFolds ?? {}).length,
        reading: state.readingNow.length,
      });
      const whole = {
        readers: 1500,
        shops: 1200,
        nines: 150,
        records: 2300,
        posters: 1100,
        folds: 1100,
        reading: 1100,
      };
      const signedIn = fakeReads(crowdedTown());
      const { state } = await loadTown(
        signedIn.client,
        AKI,
        [],
        () => AKI_SHOP,
      );
      assert.deepEqual(crowded(state), whole);
      // The reader's own private record too.
      assert.ok(
        state.readingRecords.some((record) => record.readerId === ME_ID),
      );
      // The order they opened in, as before: the walk goes that way.
      assert.deepEqual(
        state.shops.slice(0, 2).map((entry) => entry.ownerId),
        [crowd[1199], crowd[1198]],
      );
      const visiting = fakeReads(crowdedTown());
      const visited = await loadPublicTown(visiting.client);
      assert.deepEqual(crowded(visited), {
        ...whole,
        // Aki is someone else to a visitor, whose record is Aki's own.
        readers: 1501,
        records: 2299,
      });
      // Two answers a list of up to 1998, three past that; nothing else.
      for (const fake of [signedIn, visiting]) {
        const starts = (table: string) =>
          fake.asked
            .filter(
              (ask) =>
                ask.table === table &&
                !ask.filters.includes("profile_id=eq." + AKI),
            )
            .map((ask) => ask.from);
        for (const table of [
          "profiles",
          "shops",
          "profile_nine",
          "posters",
          "moderation_folds",
        ])
          assert.deepEqual(starts(table), [0, 999], table);
        assert.deepEqual(starts("reading_entries"), [0, 999, 1998]);
      }
      // The reader's own nine is read once more, after its version
      // (write_versions); a visitor has none.
      const ownNine = (fake: typeof signedIn) =>
        fake.asked.filter(
          (ask) =>
            ask.table === "profile_nine" &&
            ask.filters.includes("profile_id=eq." + AKI),
        ).length;
      assert.equal(ownNine(signedIn), 1);
      assert.equal(ownNine(visiting), 0);
    },
  );

  await check(
    "a walk past 1000 shops and 1000 of one's own is read whole",
    async () => {
      const scene = { name: "店内" };
      const tables = {
        shops: [
          { id: AKI_SHOP, owner_id: AKI, public_scene: scene },
          ...many(1200, 0x20000).map((id, n) => ({
            id,
            owner_id: crowd[n],
            public_scene: scene,
          })),
          // No public scene yet: not on the walk.
          { id: uuid(0x2ffff), owner_id: crowd[1300], public_scene: null },
        ],
        shop_private: [{ shop_id: AKI_SHOP, scene }],
        ...Object.fromEntries(
          ["shop_reactions", "saved_shops", "shop_visits"].map((table) => [
            table,
            many(1100, 0x20000).map((shop_id) => ({
              user_id: AKI,
              shop_id,
              liked: true,
              message: "",
              visited_at: at,
            })),
          ]),
        ),
        pop_reactions: many(1100, 0x20000).map((shop_id) => ({
          user_id: AKI,
          shop_id,
          placement_key: JSON.stringify({ scene: "p1" }),
          reaction: "want",
        })),
      };
      const fake = fakeReads(tables);
      const read = await loadWalkRows(
        fake.client as unknown as Parameters<typeof loadWalkRows>[0],
        AKI,
      );
      assert.equal(read.shopId, AKI_SHOP);
      assert.deepEqual(read.rows.ownScene, scene);
      assert.deepEqual(
        [
          read.rows.elsewhere?.length,
          read.rows.reactions.length,
          read.rows.saved.length,
          read.rows.popReactions.length,
          read.rows.visits.length,
        ],
        [1200, 1100, 1100, 1100, 1100],
      );
      const visitor = await loadWalkRows(
        fakeReads(tables).client as unknown as Parameters<
          typeof loadWalkRows
        >[0],
        null,
      );
      assert.equal(visitor.shopId, null);
      // A visitor sees every shop with a public scene (each read when
      // walked to), and keeps nothing.
      assert.deepEqual(
        [visitor.rows.elsewhere?.length, visitor.rows.reactions.length],
        [1201, 0],
      );
    },
  );

  await check(
    "older 便り come past a town holding more than 1000 of their writer's",
    async () => {
      // Ben wrote 1030; the town holds the newest 1010 of them.
      const letters = many(1030, 0x60000).map((id, n) =>
        post(id, BEN, { created_at: minutes(n) }),
      );
      const fake = fakeReads({
        profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
        posts: letters,
      });
      const backend = visitorTownBackend(fake.client);
      const { state } = await backend.load();
      const held = state.posts.filter((entry) => entry.authorId === BEN);
      assert.equal(held.length, 500);
      backend.absorb!((town) => ({
        ...town,
        posts: [
          ...town.posts,
          ...letters.slice(500, 1010).map((row) => ({
            ...held[0],
            id: row.id,
            createdAt: row.created_at,
          })),
        ],
      }));
      fake.asked.length = 0;
      const older = await backend.older!(at, [BEN]);
      assert.deepEqual(
        older.posts.map((entry) => entry.id),
        letters.slice(1010).map((row) => row.id),
      );
      // The first 1000, then on from the oldest of them.
      assert.deepEqual(
        fake.asked
          .filter((ask) => ask.table === "posts" && ask.ids === 1)
          .map((ask) => ask.filters.at(-1)),
        ["limit=1000", "limit=1000"],
      );
    },
  );

  await check("a store scene's books are known as used", () => {
    // A 見本's book by its own name; the owner's own scene, private books too.
    const sample = demoBooks[0].id;
    const town = townFromRows(
      rows({
        shops: [
          shop(AKI_SHOP, AKI),
          shop(BEN_SHOP, BEN, {
            public_scene_books: [
              OTHER_BOOK,
              3,
              sampleBookRowId(sample),
              "gone",
              OTHER_BOOK,
            ],
          }),
        ],
        ownSceneBooks: [BOOK],
      }),
      ids,
    );
    assert.deepEqual(town.shops[0].sceneBookIds, [OTHER_BOOK, sample]);
    assert.deepEqual(town.ownShop?.sceneBookIds, [BOOK]);
    // No scene, no field.
    const bare = townFromRows(rows({ shops: [shop(BEN_SHOP, BEN)] }), ids);
    assert.equal("sceneBookIds" in bare.shops[0], false);
  });

  await check("posters: own drafts come back, others' only once put up", () => {
    const MINE = "00000000-0000-4000-8000-0000000000d1";
    const BENS = "00000000-0000-4000-8000-0000000000d2";
    const BENS_DRAFT = "00000000-0000-4000-8000-0000000000d3";
    const GONE = "00000000-0000-4000-8000-0000000000d4";
    const BAD = "00000000-0000-4000-8000-0000000000d5";
    const town = townFromRows(
      rows({
        posters: [
          posterRow(MINE, AKI, { status: "draft", show_in_timeline: false }),
          posterRow(BENS, BEN, {
            template: "one_book",
            theme: "kosho",
            spoiler: true,
            pages: [
              {
                blocks: [
                  // A book the town cannot read leaves the page; the
                  // poster stays.
                  {
                    type: "books",
                    book_ids: ["00000000-0000-4000-8000-000000000bff"],
                  },
                  { type: "text", text: "最後の頁について" },
                  // A kind of block from a later version is passed over.
                  { type: "photo", photo_id: "x" },
                ],
              },
            ],
          }),
          posterRow(BENS_DRAFT, BEN, { status: "draft" }),
          // Someone the town does not know is left out.
          posterRow(GONE, "00000000-0000-4000-8000-00000000000c"),
          posterRow(BAD, BEN, { theme: "neon" }),
        ],
      }),
      ids,
    );
    assert.deepEqual(
      town.posters.map((entry) => entry.id),
      [MINE, BENS],
    );
    assert.deepEqual(town.posters[0], {
      id: MINE,
      authorId: ME_ID,
      template: "lineup",
      theme: "navy",
      font: "mincho",
      pages: [
        {
          heading: "夜の本",
          text: "眠れない夜に。",
          bookIds: [BOOK, OTHER_BOOK],
        },
      ],
      spoiler: false,
      inTimeline: false,
      status: "draft",
      createdAt: at,
      updatedAt: at,
    } satisfies Poster);
    assert.equal(town.posters[1].authorId, BEN);
    assert.equal(town.posters[1].spoiler, true);
    assert.deepEqual(town.posters[1].pages, [
      { heading: "", text: "最後の頁について", bookIds: [] },
    ]);
    // A visitor sees only what is put up.
    const visitor = townFromRows(
      rows({ posters: [posterRow(BENS_DRAFT, BEN, { status: "draft" })] }),
      { userId: null, shopId: "" },
    );
    assert.deepEqual(visitor.posters, []);
  });

  await check("words left at the shop reach its owner, newest first", () => {
    const town = townFromRows(
      rows({
        shopMessages: [
          { user_id: BEN, message: "また来ます", updated_at: at },
          {
            user_id: BEN,
            message: "   ",
            updated_at: "2026-10-12T11:00:00+00:00",
          },
          // Someone the town does not know (no profile to show) is left out.
          {
            user_id: "00000000-0000-4000-8000-00000000000c",
            message: "だれ？",
            updated_at: at,
          },
        ],
      }),
      ids,
    );
    assert.deepEqual(town.shopMessages, [
      { readerId: BEN, text: "また来ます", at },
    ]);
    assert.deepEqual(emptyTown().shopMessages, []);
  });

  const base = (): TownState =>
    townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN)],
        posts: [post("00000000-0000-4000-8000-0000000000e9", BEN)],
      }),
      ids,
    );

  await check("nothing changed, nothing is written", () => {
    assert.deepEqual(planWrites(base(), base(), ids), []);
  });

  await check("a new shop is created open, with every shelf", () => {
    const before = base();
    const next: TownState = {
      ...before,
      ownShop: {
        id: OWN_SHOP_ID,
        ownerId: ME_ID,
        name: "夜の本屋",
        description: "",
        tagline: "",
        theme: "ink",
        followers: 0,
        demo: false,
        shelves: cleanShelves(
          [shelf("s1", true), shelf("s2", false)],
          new Set([BOOK]),
        ),
      },
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), ["create-shop", "shelves"]);
    const create = writes[0] as Extract<Write, { kind: "create-shop" }>;
    assert.equal(create.row.id, AKI_SHOP);
    assert.equal(create.row.owner_id, AKI);
    assert.equal(create.row.is_open, true);
    const shelves = writes[1] as Extract<Write, { kind: "shelves" }>;
    assert.equal(shelves.shelves.length, 2);
  });

  await check(
    "a book fixed is written as its title, author and ISBN, and only that",
    () => {
      const mine = createRegisteredBook(
        "00000000-0000-4000-8000-0000000000b7",
        {
          title: "よるのとしょかん",
          author: "ドウ",
          isbn: "9784000000000",
        },
      );
      const local = createRegisteredBook("my-book-1", {
        title: "手元の本",
        author: "",
      });
      const before: TownState = {
        ...base(),
        books: [...base().books, mine, local],
      };
      const next: TownState = {
        ...before,
        books: before.books.map((book) =>
          book.id === mine.id
            ? {
                ...book,
                title: "夜の図書館",
                author: "ジェーン・ドウ",
                isbn: undefined,
              }
            : book.id === local.id
              ? { ...book, title: "直した手元の本" }
              : book,
        ),
      };
      const writes = planWrites(before, next, ids);
      // A book only in this browser has no row to fix.
      assert.deepEqual(writes, [
        {
          kind: "fix-books",
          rows: [
            {
              id: mine.id,
              title: "夜の図書館",
              author: "ジェーン・ドウ",
              isbn: null,
            },
          ],
        },
      ]);
      // A book's other fields changing on screen write nothing.
      assert.deepEqual(
        planWrites(
          before,
          {
            ...before,
            books: before.books.map((book) => ({ ...book, summary: "x" })),
          },
          ids,
        ),
        [],
      );
    },
  );

  await check("only the person's own posts are written, replies last", () => {
    const before = base();
    const parent = {
      id: "00000000-0000-4000-8000-0000000000f1",
      authorId: ME_ID,
      body: "読みはじめた。",
      bookId: null,
      spoiler: false,
      parentId: null,
      createdAt: at,
      likes: 0,
      wants: 0,
      readingMode: null,
    };
    const reply = {
      ...parent,
      id: "00000000-0000-4000-8000-0000000000f2",
      parentId: parent.id,
    };
    const next: TownState = {
      ...before,
      // Someone else's post changing on screen is never written.
      posts: [
        ...before.posts.map((entry) => ({ ...entry, likes: entry.likes + 1 })),
        reply,
        parent,
      ],
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), ["posts"]);
    const rowsWritten = (writes[0] as Extract<Write, { kind: "posts" }>).rows;
    assert.deepEqual(
      rowsWritten.map((row) => [row.id, row.author_id]),
      [
        [parent.id, AKI],
        [reply.id, AKI],
      ],
    );
    // The database dates posts itself.
    assert.equal("created_at" in rowsWritten[0], false);

    const deleted = planWrites(next, before, ids);
    assert.deepEqual(kinds(deleted), ["delete-posts"]);
  });

  await check(
    "a post folded by readers comes in folded; marking it is written",
    () => {
      const town = townFromRows(
        rows({
          posts: [
            post("00000000-0000-4000-8000-0000000000e1", BEN, {
              spoiler_folded: true,
            }),
            // Once marked, it is simply a spoiler.
            post("00000000-0000-4000-8000-0000000000e2", AKI, {
              spoiler: true,
              spoiler_folded: true,
            }),
            post("00000000-0000-4000-8000-0000000000e3", AKI),
          ],
        }),
        ids,
      );
      assert.deepEqual(
        town.posts.map((entry) => [entry.id.slice(-2), entry.folded]),
        [
          ["e1", true],
          ["e2", undefined],
          ["e3", undefined],
        ],
      );

      const before = base();
      const mine = {
        id: "00000000-0000-4000-8000-0000000000f1",
        authorId: ME_ID,
        body: "最後の場面で泣いた。",
        bookId: "00000000-0000-4000-8000-0000000000b1",
        spoiler: false,
        folded: true,
        parentId: null,
        createdAt: at,
        likes: 0,
        wants: 0,
        readingMode: null,
      };
      const folded = { ...before, posts: [...before.posts, mine] };
      const marked = {
        ...folded,
        posts: [...before.posts, { ...mine, spoiler: true }],
      };
      assert.deepEqual(planWrites(folded, marked, ids), [
        { kind: "mark-spoilers", ids: [mine.id] },
      ]);
    },
  );

  await check("a like pressed again comes back with its count", () => {
    const ownPost = post("00000000-0000-4000-8000-0000000000e1", AKI);
    const benPost = post("00000000-0000-4000-8000-0000000000e2", BEN);
    const like = (user: string, postId: string, taps: number) => ({
      user_id: user,
      post_id: postId,
      kind: "like",
      taps,
      created_at: at,
    });
    const town = townFromRows(
      rows({
        posts: [ownPost, benPost],
        postReactions: [like(BEN, ownPost.id, 7), like(AKI, benPost.id, 3)],
      }),
      ids,
    );
    const mine = town.posts.find((entry) => entry.id === ownPost.id);
    assert.deepEqual(mine?.likers, [{ readerId: BEN, taps: 7, at }]);
    assert.equal(mine?.likes, 1);
    // Others' posts carry nobody's likes.
    assert.equal(
      town.posts.find((entry) => entry.id === benPost.id)?.likers,
      undefined,
    );
    assert.deepEqual(town.likedPosts, [benPost.id]);
    assert.deepEqual(town.likeTaps, { [benPost.id]: 3 });

    // A first like is added as a row, then its count is set.
    const before = townFromRows(rows({ posts: [ownPost, benPost] }), ids);
    const pressed = {
      ...before,
      likedPosts: [benPost.id],
      likeTaps: { [benPost.id]: 3 },
    };
    assert.deepEqual(kinds(planWrites(before, pressed, ids)), [
      "add:post_reactions",
      "like-taps",
    ]);
    const more = { ...pressed, likeTaps: { [benPost.id]: 4 } };
    assert.deepEqual(planWrites(pressed, more, ids), [
      { kind: "like-taps", rows: [{ post_id: benPost.id, taps: 4 }] },
    ]);
    // Pressed once, the row's own default is enough.
    const once = { ...before, likedPosts: [benPost.id] };
    assert.deepEqual(kinds(planWrites(before, once, ids)), [
      "add:post_reactions",
    ]);
    // Taking it back removes the row.
    assert.deepEqual(kinds(planWrites(more, before, ids)), [
      "remove:post_reactions",
    ]);
  });

  await check("follows and marks become rows of their own tables", () => {
    const before = base();
    const next: TownState = {
      ...before,
      following: [BEN_SHOP],
      wishlist: [OTHER_BOOK],
      popReactions: {
        [popReactionKey(BEN_SHOP, "s1", "s1-item")]: ["like"],
      },
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), [
      "add:shop_follows",
      "add:book_marks",
      "add:pop_reactions",
    ]);
    assert.deepEqual((writes[0] as Extract<Write, { kind: "add" }>).rows, [
      { follower_id: AKI, shop_id: BEN_SHOP },
    ]);
    assert.deepEqual((writes[2] as Extract<Write, { kind: "add" }>).rows, [
      {
        user_id: AKI,
        shop_id: BEN_SHOP,
        placement_key: placementKey("s1", "s1-item"),
        reaction: "like",
      },
    ]);
    assert.deepEqual(kinds(planWrites(next, before, ids)), [
      "remove:shop_follows",
      "remove:book_marks",
      "remove:pop_reactions",
    ]);
  });

  await check("a running reading ends before the next one starts", () => {
    const running = {
      id: "00000000-0000-4000-8000-0000000000d1",
      bookId: BOOK,
      mode: "together" as const,
      startedAt: at,
      endedAt: null,
    };
    const before: TownState = { ...base(), readingSessions: [running] };
    const next: TownState = {
      ...before,
      readingSessions: [
        { ...running, endedAt: "2026-10-12T09:30:00Z" },
        {
          ...running,
          id: "00000000-0000-4000-8000-0000000000d2",
          startedAt: "2026-10-12T09:31:00Z",
        },
      ],
    };
    assert.deepEqual(kinds(planWrites(before, next, ids)), [
      "end-sessions",
      "sessions",
    ]);
  });

  await check(
    "the profile and the nine are written only when they change",
    () => {
      const before = base();
      const next: TownState = {
        ...before,
        me: {
          ...before.me,
          bio: "夜に本を読む。",
          lifeNine: [BOOK],
          nineNotes: { [BOOK]: "最初の一冊" },
        },
      };
      const writes = planWrites(before, next, ids);
      assert.deepEqual(kinds(writes), ["profile", "nine"]);
      assert.deepEqual(
        (writes[0] as Extract<Write, { kind: "profile" }>).patch,
        {
          bio: "夜に本を読む。",
        },
      );
      assert.deepEqual(writes[1], {
        kind: "nine",
        bookIds: [BOOK],
        notes: ["最初の一冊"],
      });
    },
  );

  await check(
    "reading records: own ones always, others' only as far as they let",
    () => {
      const town = townFromRows(
        rows({
          readerSettings: { records_audience: "everyone" },
          records: [
            entry("00000000-0000-4000-8000-0000000000c1", AKI, {
              is_public: false,
              body: "  夜が長かった。 ",
              feelings: ["talk", "cried"],
            }),
            entry("00000000-0000-4000-8000-0000000000c2", BEN, {
              created_at: "2026-10-12T08:00:00Z",
            }),
            // Someone else's private record never reaches the screen.
            entry("00000000-0000-4000-8000-0000000000c3", BEN, {
              is_public: false,
            }),
            // Nor does a record of a book the town cannot show,
            entry("00000000-0000-4000-8000-0000000000c4", BEN, {
              book_id: "00000000-0000-4000-8000-000000000bff",
            }),
            // by someone it does not know,
            entry(
              "00000000-0000-4000-8000-0000000000c5",
              "00000000-0000-4000-8000-00000000000c",
            ),
            // or of a kind the screens do not read yet.
            entry("00000000-0000-4000-8000-0000000000c6", BEN, {
              kind: "opened",
            }),
            // One for followers comes when the database lets it.
            entry("00000000-0000-4000-8000-0000000000ca", BEN, {
              is_public: false,
              audience: "followers",
              created_at: "2026-10-12T07:00:00Z",
            }),
          ],
        }),
        ids,
      );
      assert.deepEqual(
        town.readingRecords.map((record) => [record.id, record.readerId]),
        [
          ["00000000-0000-4000-8000-0000000000ca", BEN],
          ["00000000-0000-4000-8000-0000000000c2", BEN],
          ["00000000-0000-4000-8000-0000000000c1", ME_ID],
        ],
      );
      const own = town.readingRecords[2];
      assert.equal(own.note, "夜が長かった。");
      assert.deepEqual(own.feelings, ["cried", "talk"]);
      assert.equal(own.audience, "private");
      assert.equal(town.readingRecords[0].audience, "followers");
      assert.equal(town.settings.visibility.records.audience, "everyone");
      assert.deepEqual(
        townFromRows(rows(), ids).settings.visibility,
        cleanVisibilities(null),
      );
      // A database a migration behind sends is_public alone.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { audience: _, ...behind } = entry(
        "00000000-0000-4000-8000-0000000000cb",
        BEN,
      );
      assert.equal(
        townFromRows(
          rows({ records: [behind as Tables<"reading_entries">] }),
          ids,
        ).readingRecords[0].audience,
        "everyone",
      );
      assert.deepEqual(
        referencedBookIds(
          rows({
            records: [
              entry("00000000-0000-4000-8000-0000000000c7", BEN, {
                book_id: OTHER_BOOK,
              }),
            ],
          }),
        ),
        [OTHER_BOOK],
      );
    },
  );

  await check("own reading records are added, rewritten and removed", () => {
    const before = base();
    const record = {
      id: "00000000-0000-4000-8000-0000000000c8",
      readerId: ME_ID,
      bookId: BOOK,
      feelings: ["warm" as const],
      note: "",
      spoiler: false,
      audience: "everyone" as const,
      createdAt: at,
    };
    const others = {
      ...record,
      id: "00000000-0000-4000-8000-0000000000c9",
      readerId: BEN,
    };
    const added: TownState = {
      ...before,
      readingRecords: [record, others],
      settings: {
        ...before.settings,
        visibility: {
          ...before.settings.visibility,
          records: { audience: "everyone", detail: "content" },
        },
      },
    };
    const writes = planWrites(before, added, ids);
    // The starting choice goes first: a narrower one narrows the records
    // the database has, never one written after it.
    assert.deepEqual(kinds(writes), ["reader-settings", "records"]);
    assert.deepEqual(writes[0], {
      kind: "reader-settings",
      row: { user_id: AKI, records_audience: "everyone" },
    });
    // Someone else's record on screen is never written, and the database
    // dates the new one itself.
    assert.deepEqual((writes[1] as Extract<Write, { kind: "records" }>).rows, [
      {
        id: record.id,
        user_id: AKI,
        book_id: BOOK,
        kind: "finished",
        body: "",
        feelings: ["warm"],
        spoiler: false,
        audience: "everyone",
      },
    ]);

    const rewritten: TownState = {
      ...added,
      readingRecords: [
        { ...record, note: "また読む", audience: "private" },
        { ...others, note: "変わった" },
      ],
    };
    // Only what changed: a device a change behind sends no audience with a
    // new note, and puts back none narrowed elsewhere.
    assert.deepEqual(planWrites(added, rewritten, ids), [
      {
        kind: "update-record",
        id: record.id,
        patch: { body: "また読む", audience: "private" },
      },
    ]);
    assert.deepEqual(
      planWrites(
        added,
        {
          ...added,
          readingRecords: [{ ...record, note: "ひとことだけ" }, others],
        },
        ids,
      ),
      [
        {
          kind: "update-record",
          id: record.id,
          patch: { body: "ひとことだけ" },
        },
      ],
    );
    assert.deepEqual(
      planWrites(added, { ...added, readingRecords: [others] }, ids),
      [{ kind: "delete-records", ids: [record.id] }],
    );
  });

  await check("own posters are made, changed and taken down", () => {
    const before = base();
    const poster: Poster = {
      id: "00000000-0000-4000-8000-0000000000d6",
      authorId: ME_ID,
      template: "one_book",
      theme: "kinari",
      font: "mincho",
      pages: [{ heading: "", text: "ずっと手元に。", bookIds: [BOOK] }],
      spoiler: false,
      inTimeline: true,
      status: "draft",
      createdAt: at,
      updatedAt: at,
    };
    const others: Poster = {
      ...poster,
      id: "00000000-0000-4000-8000-0000000000d7",
      authorId: BEN,
    };
    const made: TownState = { ...before, posters: [poster, others] };
    // Someone else's poster on screen is never written; the database dates
    // the new one itself.
    assert.deepEqual(planWrites(before, made, ids), [
      {
        kind: "posters",
        rows: [
          {
            id: poster.id,
            author_id: AKI,
            template: "one_book",
            theme: "kinari",
            font: "mincho",
            pages: [
              {
                blocks: [
                  { type: "books", book_ids: [BOOK] },
                  { type: "text", text: "ずっと手元に。" },
                ],
              },
            ],
            spoiler: false,
            show_in_timeline: true,
            status: "draft",
          },
        ],
      },
    ]);
    const putUp: TownState = {
      ...made,
      posters: [
        { ...poster, status: "published", theme: "navy", updatedAt: "later" },
        { ...others, theme: "sumi" },
      ],
    };
    const writes = planWrites(made, putUp, ids);
    assert.deepEqual(kinds(writes), ["update-poster"]);
    assert.deepEqual(
      (writes[0] as Extract<Write, { kind: "update-poster" }>).patch,
      {
        template: "one_book",
        theme: "navy",
        font: "mincho",
        pages: [
          {
            blocks: [
              { type: "books", book_ids: [BOOK] },
              { type: "text", text: "ずっと手元に。" },
            ],
          },
        ],
        spoiler: false,
        show_in_timeline: true,
        status: "published",
      },
    );
    assert.deepEqual(
      planWrites(putUp, { ...putUp, posters: [putUp.posters[1]] }, ids),
      [{ kind: "delete-posters", ids: [poster.id] }],
    );
  });

  await check("the empty town is the person's, with nothing in it", () => {
    const town = emptyTown({ handle: "aki" });
    assert.equal(town.me.id, ME_ID);
    assert.equal(town.me.handle, "aki");
    assert.equal(town.ownShop, null);
    assert.deepEqual(town.shops, []);
  });

  await check("a visitor sees every open shop, and owns none", () => {
    const town = townFromRows(
      rows({
        shops: [shop(AKI_SHOP, AKI), shop(BEN_SHOP, BEN, { is_open: false })],
        posts: [post("00000000-0000-4000-8000-0000000000f1", AKI)],
      }),
      { userId: null, shopId: "" },
    );
    assert.equal(town.me.name, "ゲスト");
    assert.equal(town.ownShop, null);
    assert.deepEqual(
      town.shops.map((entry) => [entry.id, entry.ownerId]),
      [[AKI_SHOP, AKI]],
    );
    assert.deepEqual(
      town.readers.map((reader) => reader.id),
      [AKI, BEN],
    );
    assert.equal(town.posts[0].authorId, AKI);
    // Nobody's book is the visitor's own, so none shows its own summary.
    assert.ok(
      town.books
        .filter((entry) => !isSampleBook(entry.id))
        .every((entry) => entry.summary.startsWith("読書家が")),
    );
  });

  await check("見本 joins the real town, and the real one wins", () => {
    const real = townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN), shop(demoShops[0].id, AKI)],
      }),
      { userId: null, shopId: "" },
    );
    const town = withSamples(real);
    const ids = town.shops.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
      town.shops.find((entry) => entry.id === demoShops[0].id)?.demo,
      false,
    );
    assert.ok(town.shops.some((entry) => entry.demo));
    assert.equal(town.posts.length, real.posts.length + demoPosts.length);
    assert.deepEqual(
      town.posts.map((entry) => entry.createdAt),
      town.posts
        .map((entry) => entry.createdAt)
        .sort((a, b) => Date.parse(a) - Date.parse(b)),
    );
    // The samples are copies: changing the town never changes the demo data.
    town.shops[town.shops.length - 1].name = "変えた";
    assert.notEqual(demoShops.at(-1)?.name, "変えた");
  });

  await check(
    "a signed-in reader keeps a 見本's book, under its database id",
    () => {
      const SOLARIS = demoBooks[0].id;
      const row = sampleBookRowId(SOLARIS);
      assert.match(
        row,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      assert.equal(sampleBookRowId(SOLARIS), row);
      const before = withSamples(townFromRows(rows(), ids));
      const wished = { ...before, wishlist: [...before.wishlist, SOLARIS] };
      const writes = planWrites(before, wished, ids);
      // The row is the database's, for everyone and nobody's (AUD-078): the
      // reader names it by the shared id and never writes it.
      assert.deepEqual(kinds(writes), ["add:book_marks"]);
      assert.deepEqual((writes[0] as Extract<Write, { kind: "add" }>).rows, [
        { user_id: AKI, book_id: row, kind: "wish" },
      ]);
      // Read back, it is the 見本's book again, whatever its row says.
      const again = townFromRows(
        rows({
          books: [
            ...rows().books,
            { ...book(row), title: "別の題", author: "誰か" },
          ],
          marks: [{ user_id: AKI, book_id: row, kind: "wish", created_at: at }],
        }),
        ids,
      );
      assert.deepEqual(again.wishlist, [SOLARIS]);
      assert.equal(
        again.books.find((entry) => entry.id === SOLARIS)?.title,
        demoBooks[0].title,
      );
      assert.equal(
        again.books.some((entry) => entry.id === row),
        false,
      );
      // Taking it back removes the mark and leaves the catalog alone.
      assert.deepEqual(planWrites(wished, before, ids), [
        {
          kind: "remove",
          table: "book_marks",
          rows: [{ user_id: AKI, book_id: row, kind: "wish" }],
        },
      ]);
    },
  );

  await check(
    "a poster with a 見本's book keeps the book under its database id",
    () => {
      const SOLARIS = demoBooks[0].id;
      const before = withSamples(townFromRows(rows(), ids));
      // The 見本's own posters are shown, and never written.
      assert.ok(
        demoPosters.every((entry) =>
          before.posters.some((shown) => shown.id === entry.id),
        ),
      );
      const poster: Poster = {
        id: "00000000-0000-4000-8000-0000000000d8",
        authorId: ME_ID,
        template: "lineup",
        theme: "navy",
        font: "gothic",
        pages: [{ heading: "星の本", text: "", bookIds: [SOLARIS, BOOK] }],
        spoiler: false,
        inTimeline: true,
        status: "published",
        createdAt: at,
        updatedAt: at,
      };
      const next = { ...before, posters: [...before.posters, poster] };
      const writes = planWrites(before, next, ids);
      assert.deepEqual(kinds(writes), ["posters"]);
      assert.deepEqual(
        (writes[0] as Extract<Write, { kind: "posters" }>).rows[0].pages,
        [
          {
            blocks: [
              { type: "heading", text: "星の本" },
              { type: "books", book_ids: [sampleBookRowId(SOLARIS), BOOK] },
            ],
          },
        ],
      );
      // Read back, the poster shows the 見本's book again.
      const again = townFromRows(
        rows({
          posters: [
            posterRow(poster.id, AKI, {
              pages: (writes[0] as Extract<Write, { kind: "posters" }>).rows[0]
                .pages,
            }),
          ],
        }),
        ids,
      );
      assert.deepEqual(again.posters[0].pages[0].bookIds, [SOLARIS, BOOK]);
    },
  );

  await check("nothing is written toward a 見本's shop or post", () => {
    const before = withSamples(townFromRows(rows(), ids));
    const post = demoPosts.find((entry) => entry.bookId)!;
    const next: TownState = {
      ...before,
      following: [demoShops[0].id],
      likedPosts: [post.id],
      // Wanting the book of a 見本's post still keeps the book.
      wantedPosts: [post.id],
      wishlist: [post.bookId!],
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), ["add:book_marks"]);
    assert.deepEqual((writes[0] as Extract<Write, { kind: "add" }>).rows, [
      { user_id: AKI, book_id: sampleBookRowId(post.bookId!), kind: "wish" },
    ]);
  });

  await check("folds by reports arrive under the town's own names", () => {
    const town = townFromRows(
      rows({
        shops: [shop(AKI_SHOP, AKI), shop("shop-ben", BEN)],
        folds: [
          { target_kind: "post", target_id: "p1", state: "folded", since: at },
          { target_kind: "post", target_id: "p2", state: "held", since: at },
          {
            target_kind: "profile",
            target_id: AKI,
            state: "folded",
            since: at,
          },
          {
            target_kind: "profile",
            target_id: BEN,
            state: "folded",
            since: at,
          },
          {
            target_kind: "shop",
            target_id: AKI_SHOP,
            state: "folded",
            since: at,
          },
          {
            target_kind: "shop",
            target_id: "shop-ben",
            state: "folded",
            since: at,
          },
          { target_kind: "poster", target_id: "x1", state: "held", since: at },
          // Unknown kinds and states are left alone.
          { target_kind: "book", target_id: BOOK, state: "folded", since: at },
          { target_kind: "post", target_id: "p3", state: "gone", since: at },
        ],
      }),
      ids,
    );
    assert.deepEqual(
      Object.keys(town.reviewFolds).sort(),
      [
        "post:p1",
        "post:p2",
        "poster:x1",
        "profile:" + BEN,
        "profile:" + ME_ID,
        "shop:" + OWN_SHOP_ID,
        "shop:shop-ben",
      ].sort(),
    );
    assert.deepEqual(town.reviewFolds["post:p2"], { state: "held", since: at });
  });

  await check("the reader's own reports and spoiler setting are read", () => {
    const report = (id: string, created: string, extra = {}) => ({
      id,
      target_kind: "post",
      target_id: "p1",
      reason: "harassment",
      progress: "open",
      created_at: created,
      status_at: created,
      ...extra,
    });
    const town = townFromRows(
      rows({
        myReports: [
          report("r1", "2026-10-10T00:00:00Z"),
          report("r2", "2026-10-12T00:00:00Z", { progress: "checking" }),
          report("r3", "2026-10-11T00:00:00Z", { reason: "spoiler" }),
          report("r4", "2026-10-11T00:00:00Z", { progress: "lost" }),
          // Never the operator's own words for which way it went.
          report("r5", "2026-10-09T00:00:00Z", { progress: "checked" }),
          report("r6", "2026-10-09T00:00:00Z", { progress: "resolved" }),
        ],
        readerSettings: { spoiler_display: "leave_out" },
      }),
      ids,
    );
    assert.deepEqual(
      town.myReports.map((entry) => entry.id + ":" + entry.status),
      ["r2:checking", "r3:open", "r1:open", "r5:checked"],
    );
    assert.equal(town.settings.spoilerDisplay, "leave_out");
    // No row, or one it does not know: folded when possible.
    assert.equal(
      townFromRows(rows(), ids).settings.spoilerDisplay,
      "fold_possible",
    );
    assert.equal(
      townFromRows(rows({ readerSettings: { spoiler_display: "x" } }), ids)
        .settings.spoilerDisplay,
      "fold_possible",
    );
    const empty = emptyTown();
    assert.equal(empty.settings.spoilerDisplay, "fold_possible");
    assert.deepEqual(empty.settings.visibility, cleanVisibilities(null));
    assert.deepEqual(empty.reviewFolds, {});
    assert.deepEqual(empty.myReports, []);
  });

  await check("the spoiler setting is written only when it changes", () => {
    const before = townFromRows(rows(), ids);
    const next: TownState = {
      ...before,
      settings: { ...before.settings, spoilerDisplay: "show_all" },
      // Folds and reports are the database's; nothing is written for them.
      reviewFolds: { "post:p1": { state: "folded", since: at } },
      myReports: [
        {
          id: "r1",
          kind: "post",
          targetId: "p1",
          reason: "spam",
          status: "open",
          createdAt: at,
          statusAt: at,
        },
      ],
    };
    assert.deepEqual(planWrites(before, next, ids), [
      {
        kind: "reader-settings",
        row: { user_id: AKI, spoiler_display: "show_all" },
      },
    ]);
    assert.deepEqual(
      planWrites(before, { ...next, settings: before.settings }, ids),
      [],
    );
    // A starting choice is sent alone, as is 読書の状態's detail.
    const status: TownState = {
      ...before,
      settings: {
        ...before.settings,
        visibility: {
          ...before.settings.visibility,
          status: { audience: "everyone", detail: "content" },
          shelves: { audience: "followers", detail: "content" },
        },
      },
    };
    assert.deepEqual(planWrites(before, status, ids), [
      {
        kind: "reader-settings",
        row: {
          user_id: AKI,
          status_detail: "content",
          shelves_audience: "followers",
        },
      },
    ]);
    // Read back, each column is its kind's choice; unknown ones fall back.
    assert.deepEqual(
      townFromRows(
        rows({
          readerSettings: {
            status_audience: "private",
            status_detail: "content",
            stats_audience: "followers",
            saves_audience: "nobody",
          },
        }),
        ids,
      ).settings.visibility,
      {
        ...cleanVisibilities(null),
        status: { audience: "private", detail: "content" },
        stats: { audience: "followers", detail: "content" },
      },
    );
  });

  // 便り read after the town (PR 2): newer ones, older ones, one by its id.
  // They join what the database is known to hold, never what is to be
  // written: otherwise a book that came with one would be saved again as
  // the reader's own (planWrites writes every book the base lacks).
  const NEW_POST = "00000000-0000-4000-8000-0000000000e1";
  const NEW_BOOK = "00000000-0000-4000-8000-000000000b0e";
  const CAL = "00000000-0000-4000-8000-00000000000c";
  /** Ben's 便り and a new reader's reply, about a book the town lacked. */
  const arrivedNow = (): Arrived => ({
    ...emptyArrived(),
    posts: [
      {
        id: NEW_POST,
        authorId: BEN,
        body: "届いたばかりの便り。",
        bookId: NEW_BOOK,
        spoiler: false,
        parentId: null,
        createdAt: "2026-10-13T09:00:00Z",
        likes: 0,
        wants: 0,
        readingMode: null,
      },
      {
        id: NEW_POST.replace("e1", "e2"),
        authorId: CAL,
        body: "わたしも読みました。",
        bookId: null,
        spoiler: false,
        parentId: NEW_POST,
        createdAt: "2026-10-13T09:05:00Z",
        likes: 0,
        wants: 0,
        readingMode: null,
      },
    ],
    readers: [
      {
        id: CAL,
        handle: "cal",
        name: "CAL",
        bio: "",
        color: "#768281",
        lifeNine: [],
        nineNotes: {},
        links: [],
      },
    ],
    books: [bookFromRow(book(NEW_BOOK), false)],
  });
  const loadedTown = () =>
    townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN)],
        follows: [{ shop_id: BEN_SHOP }],
        posts: [post("00000000-0000-4000-8000-0000000000e0", BEN)],
      }),
      ids,
    );
  /** A sync of `town` whose writes are planned, not sent. */
  const plannedSync = (town: TownState, hold?: Promise<void>) => {
    const planned: Write[] = [];
    let writes = 0;
    const sync = backgroundSync<TownState, Write>(
      {
        read: async () => town,
        plan: (base, target) => planWrites(base, target, ids),
        async apply(write) {
          planned.push(write);
          await hold;
        },
        landed() {
          writes += 1;
        },
      },
      { delay: 0 },
    );
    return { sync, planned, writes: () => writes };
  };
  const settle = async (done: () => boolean) => {
    for (let wait = 0; wait < 200 && !done(); wait += 1)
      await new Promise((resume) => setTimeout(resume, 5));
    assert.ok(done(), "the write was made");
  };

  await check(
    "便り taken in after the town, with their books, are never written back",
    async () => {
      const town = loadedTown();
      // Taken as a change of the reader's, the new book would be written as
      // one they typed in: the bug that taking in avoids.
      assert.ok(
        kinds(planWrites(town, takeIn(town, arrivedNow()), ids)).includes(
          "books",
        ),
      );
      const { sync, planned, writes } = plannedSync(town);
      assert.equal(
        sync.absorb((value, saved) => takeIn(value, arrivedNow(), saved)),
        null,
        "nothing to take in before the town is read",
      );
      await sync.load();
      const shown = sync.absorb((value, saved) =>
        takeIn(value, arrivedNow(), saved),
      );
      assert.ok(shown);
      assert.deepEqual(shown.posts.map((entry) => entry.id).slice(-2), [
        NEW_POST,
        NEW_POST.replace("e1", "e2"),
      ]);
      assert.ok(shown.books.some((entry) => entry.id === NEW_BOOK));
      assert.ok(shown.readers.some((entry) => entry.id === CAL));
      // Saving the town as shown writes nothing; a like of the new 便り
      // later writes that like, and only it.
      assert.equal(sync.save(shown), "saved");
      sync.save({ ...shown, likedPosts: [NEW_POST] });
      await settle(() => writes() === 1);
      assert.deepEqual(kinds(planned), ["add:post_reactions"]);
      sync.close();
    },
  );

  await check(
    "便り taken in while a save is on its way are not written when it lands",
    async () => {
      let land: () => void = () => {};
      const landing = new Promise<void>((resume) => (land = resume));
      const town = loadedTown();
      const { sync, planned, writes } = plannedSync(town, landing);
      await sync.load();
      // The reader's like is being saved when the 便り arrive.
      const liked = { ...town, likedPosts: [town.posts[0].id] };
      sync.save(liked);
      await settle(() => planned.length === 1);
      const shown = sync.absorb((value, saved) =>
        takeIn(value, arrivedNow(), saved),
      );
      assert.ok(shown?.books.some((entry) => entry.id === NEW_BOOK));
      assert.deepEqual(shown?.likedPosts, liked.likedPosts);
      land();
      await settle(() => writes() >= 1);
      // The save landed without the new book; the next one still knows
      // the database has it.
      sync.save({ ...shown!, likedPosts: [...liked.likedPosts, NEW_POST] });
      await settle(() => kinds(planned).length >= 2);
      await settle(() => writes() >= 2);
      assert.deepEqual(kinds(planned), [
        "add:post_reactions",
        "add:post_reactions",
      ]);
      sync.close();
    },
  );

  await check(
    "a 便り the reader deleted here, not yet deleted there, is not taken back in",
    async () => {
      const MINE = "00000000-0000-4000-8000-0000000000f1";
      const town = townFromRows(
        rows({ posts: [post(MINE, AKI, { created_at: at })] }),
        ids,
      );
      let land: () => void = () => {};
      const landing = new Promise<void>((resume) => (land = resume));
      const { sync, planned, writes } = plannedSync(town, landing);
      await sync.load();
      const deleted = { ...town, posts: [] };
      sync.save(deleted);
      await settle(() => planned.length === 1);
      // Read again by its id (an old 便り's page) while the delete is out.
      const again: Arrived = { ...emptyArrived(), posts: town.posts };
      const shown = sync.absorb((value, saved) => takeIn(value, again, saved));
      assert.deepEqual(shown?.posts, []);
      land();
      await settle(() => writes() === 1);
      // Landed, the delete is not planned again: the database is known
      // not to hold it.
      await new Promise((resume) => setTimeout(resume, 30));
      assert.equal(writes(), 1);
      assert.deepEqual(kinds(planned), ["delete-posts"]);
      sync.close();
    },
  );

  await check(
    "the store takes 便り in by the backend, never as a change to save",
    async () => {
      const town = loadedTown();
      const { sync } = plannedSync(town);
      let saves = 0;
      const backend: TownBackend = {
        kind: "account",
        newId: () => crypto.randomUUID(),
        load: async () => ({ state: await sync.load(), status: "saved" }),
        save(state) {
          saves += 1;
          return sync.save(state);
        },
        absorb: sync.absorb,
      };
      const store = createTownStore(backend);
      store.initialize();
      await settle(() => store.getPersistenceSnapshot() === "saved");
      const generation = store.getGeneration();
      // Read for another town (a sign-out meanwhile): not taken.
      assert.equal(store.absorb(arrivedNow(), generation + 1), false);
      assert.equal(store.absorb(arrivedNow(), generation), true);
      assert.ok(
        store.getSnapshot().posts.some((entry) => entry.id === NEW_POST),
      );
      assert.equal(saves, 0);
      // The same again changes nothing.
      assert.equal(store.absorb(arrivedNow(), generation), false);
      sync.close();
      // A visitor's town takes them in too; nothing is saved there.
      const visitor = createTownStore(
        visitorTownBackend({} as Parameters<typeof visitorTownBackend>[0]),
      );
      visitor.initialize();
      await settle(() => visitor.getPersistenceSnapshot() !== "loading");
      const before = visitor.getSnapshot();
      const ben = {
        ...arrivedNow(),
        readers: [
          ...arrivedNow().readers,
          { ...arrivedNow().readers[0], id: BEN },
        ],
      };
      assert.equal(visitor.absorb(ben, visitor.getGeneration()), true);
      assert.equal(visitor.getSnapshot().posts.length, before.posts.length + 2);
      // The visitor's backend takes arrivals into the town as last shown to
      // it, never the one it read: a town handed to save is not undone.
      const look = visitorTownBackend(
        {} as Parameters<typeof visitorTownBackend>[0],
      );
      const { state: read } = await look.load();
      const shown = { ...read, seenNotifications: ["follow:seen-here"] };
      look.save(shown);
      let given: TownState | null = null;
      look.absorb!((value) => (given = value));
      assert.equal(given, shown);
    },
  );

  await check(
    "a town read again after a refused change counts as a new reading",
    async () => {
      const town = loadedTown();
      let listener: Parameters<NonNullable<TownBackend["watch"]>>[0] | null =
        null;
      let shown = town;
      const backend: TownBackend = {
        kind: "account",
        newId: () => crypto.randomUUID(),
        load: async () => ({ state: town, status: "saved" }),
        save: () => "saved",
        watch(next) {
          listener = next;
          return () => undefined;
        },
        absorb(take) {
          shown = take(shown, shown);
          return shown;
        },
      };
      const store = createTownStore(backend);
      store.initialize();
      await settle(() => store.getPersistenceSnapshot() === "saved");
      const read = store.getReadCount();
      // Taking 便り in is no new reading.
      assert.equal(store.absorb(arrivedNow(), store.getGeneration()), true);
      assert.equal(store.getReadCount(), read);
      // Read again: what was read after the town is gone, and screens that
      // read it (a 便り's page, 便りだけ's older pages) can tell.
      listener!.replace(town, "recovered");
      assert.equal(store.getReadCount(), read + 1);
      assert.ok(
        !store.getSnapshot().posts.some((entry) => entry.id === NEW_POST),
      );
    },
  );

  await check(
    "a change settles once the account has it, and fails when turned away",
    async () => {
      const town = loadedTown();
      let listener: Parameters<NonNullable<TownBackend["watch"]>>[0] | null =
        null;
      const backend: TownBackend = {
        kind: "account",
        newId: () => crypto.randomUUID(),
        load: async () => ({ state: town, status: "saved" }),
        save: () => "saving",
        watch(next) {
          listener = next;
          return () => undefined;
        },
      };
      const store = createTownStore(backend);
      store.initialize();
      await settle(() => store.getPersistenceSnapshot() === "saved");
      // Nothing on its way: settled at once.
      assert.equal(await townSettled(store), true);
      listener!.status("saving");
      let heard: boolean | null = null;
      const saved = townSettled(store).then((taken) => (heard = taken));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(heard, null);
      listener!.status("saved");
      assert.equal(await saved, true);
      // Turned away: the town goes back to what is saved, and says so.
      listener!.status("saving");
      const refused = townSettled(store);
      listener!.replace(town, "recovered");
      assert.equal(await refused, false);
    },
  );

  await check("posts read after the town come in the town's shapes", () => {
    const SAMPLE = demoBooks[0].id;
    const arrived = arrivedFromRows(
      {
        posts: [
          post(NEW_POST, BEN, {
            book_id: NEW_BOOK,
            created_at: "2026-10-13T09:00:00Z",
          }),
          // The reader's own, from another device, about a 見本's book.
          post("00000000-0000-4000-8000-0000000000e3", AKI, {
            book_id: sampleBookRowId(SAMPLE),
            spoiler_folded: true,
            reading_mode: "together",
          }),
          post(NEW_POST, BEN),
        ],
        profiles: [
          profile(AKI, "aki"),
          profile(BEN, "ben"),
          profile(CAL, "cal"),
        ],
        books: [
          book(NEW_BOOK),
          book(OTHER_BOOK),
          book(sampleBookRowId(SAMPLE)),
        ],
        postReactions: [
          // Ben liked the reader's post three times; the reader liked his.
          {
            user_id: BEN,
            post_id: "00000000-0000-4000-8000-0000000000e3",
            kind: "like",
            taps: 3,
            created_at: at,
          },
          {
            user_id: AKI,
            post_id: NEW_POST,
            kind: "like",
            taps: 2,
            created_at: at,
          },
          {
            user_id: AKI,
            post_id: NEW_POST,
            kind: "want",
            taps: 1,
            created_at: at,
          },
          // On a post not read here: not taken.
          {
            user_id: AKI,
            post_id: "p9",
            kind: "like",
            taps: 1,
            created_at: at,
          },
        ],
        spoilerReports: [{ post_id: NEW_POST }, { post_id: "p9" }],
        folds: [
          {
            target_kind: "post",
            target_id: NEW_POST,
            state: "folded",
            since: at,
          },
          { target_kind: "post", target_id: "p9", state: "folded", since: at },
          {
            target_kind: "shop",
            target_id: NEW_POST,
            state: "folded",
            since: at,
          },
        ],
      },
      AKI,
    );
    assert.deepEqual(
      arrived.posts.map((entry) => [entry.id, entry.authorId, entry.bookId]),
      [
        [NEW_POST, BEN, NEW_BOOK],
        ["00000000-0000-4000-8000-0000000000e3", ME_ID, SAMPLE],
      ],
    );
    const own = arrived.posts[1];
    assert.equal(own.likes, 1);
    assert.deepEqual(own.likers, [{ readerId: BEN, taps: 3, at }]);
    assert.equal(own.folded, true);
    assert.equal(own.readingMode, "together");
    assert.equal(arrived.posts[0].likes, 0);
    // Only the writers, never the reader; only their books, never a 見本's row.
    assert.deepEqual(
      arrived.readers.map((reader) => reader.id),
      [BEN],
    );
    assert.deepEqual(arrived.readers[0].lifeNine, []);
    assert.deepEqual(
      arrived.books.map((entry) => entry.id),
      [NEW_BOOK],
    );
    // Ben's typed-in book is told as his only by a town that tells the
    // reader's own books apart (my_books read).
    assert.equal(arrived.books[0].theirs, undefined);
    assert.equal(
      arrivedFromRows(
        {
          posts: [post(NEW_POST, BEN, { book_id: NEW_BOOK })],
          profiles: [profile(BEN, "ben")],
          books: [book(NEW_BOOK)],
          postReactions: [],
          spoilerReports: [],
          folds: [],
        },
        AKI,
        true,
      ).books[0].theirs,
      true,
    );
    assert.deepEqual(arrived.likedPosts, [NEW_POST]);
    assert.deepEqual(arrived.likeTaps, { [NEW_POST]: 2 });
    assert.deepEqual(arrived.wantedPosts, [NEW_POST]);
    assert.deepEqual(arrived.spoilerReports, [NEW_POST]);
    assert.deepEqual(arrived.reviewFolds, {
      ["post:" + NEW_POST]: { state: "folded", since: at },
    });
  });

  await check(
    "the reads after the town ask the database only for what the town lacks",
    async () => {
      const OLD = "00000000-0000-4000-8000-0000000000d0";
      const REPLY = "00000000-0000-4000-8000-0000000000d1";
      const tables: Record<string, AnyRow[]> = {
        profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
        books: [book(BOOK)],
        shops: [shop(BEN_SHOP, BEN)],
        shop_follows: [{ follower_id: AKI, shop_id: BEN_SHOP }],
        posts: [
          post("00000000-0000-4000-8000-0000000000e0", BEN, {
            created_at: "2026-10-12T09:00:00Z",
          }),
        ],
      };
      const fake = fakeReads(tables);
      const backend = accountTownBackend(fake.client, AKI, { storage: false });
      await backend.load();
      // Then Cal signs up and writes about a new book, and Ben replies.
      tables.profiles.push(profile(CAL, "cal"));
      tables.books.push(book(NEW_BOOK));
      tables.posts.push(
        post(NEW_POST, CAL, {
          book_id: NEW_BOOK,
          created_at: "2026-10-13T09:00:00Z",
        }),
        post(NEW_POST.replace("e1", "e2"), BEN, {
          parent_id: NEW_POST,
          created_at: "2026-10-13T09:05:00Z",
        }),
        // Two old ones, past what the town read: a 便り of Ben's, a reply.
        post(OLD, BEN, { created_at: "2026-09-01T09:00:00Z" }),
        post(REPLY, AKI, {
          parent_id: OLD,
          created_at: "2026-09-02T09:00:00Z",
        }),
      );
      fake.asked.length = 0;
      const newer = await backend.newer!("2026-10-12T09:00:00Z");
      // Only what the town lacks, oldest first: not Ben's known 便り.
      assert.deepEqual(
        newer.posts.map((entry) => entry.id),
        [NEW_POST, NEW_POST.replace("e1", "e2")],
      );
      const filtersOf = (table: string) =>
        fake.asked
          .filter((ask) => ask.table === table)
          .map((ask) => ask.filters);
      // From a little before the newest known: one saved late joins on.
      assert.deepEqual(filtersOf("posts"), [
        [
          "created_at=gte.2026-10-12T08:59:50.000Z",
          "order=created_at.asc",
          "limit=50",
        ],
      ]);
      // Only Cal is asked for, only the new book.
      assert.deepEqual(filtersOf("profiles"), [["id=in.1"]]);
      assert.deepEqual(filtersOf("books"), [["id=in.1"]]);
      assert.deepEqual(
        newer.readers.map((reader) => reader.id),
        [CAL],
      );
      assert.deepEqual(
        newer.books.map((entry) => entry.id),
        [NEW_BOOK],
      );
      assert.deepEqual(filtersOf("spoiler_reports"), [
        ["reporter_id=eq." + AKI, "post_id=in.2"],
      ]);

      // 便りだけ's next stretch: the reader's and Ben's, before the oldest.
      fake.asked.length = 0;
      const older = await backend.older!("2026-10-12T09:00:00Z", [ME_ID, BEN]);
      assert.deepEqual(filtersOf("posts")[0], [
        "parent_id=is.null",
        "author_id=in.2",
        "created_at=lte.2026-10-12T09:00:00Z",
        "order=created_at.desc",
        // One more for Ben's 便り the town has at that moment, left out.
        "limit=21",
      ]);
      assert.deepEqual(
        older.posts.map((entry) => [entry.id, entry.authorId]),
        [
          [OLD, BEN],
          [REPLY, ME_ID],
        ],
      );
      // Nobody followed, nothing asked.
      fake.asked.length = 0;
      assert.deepEqual((await backend.older!(at, [])).posts, []);
      assert.equal(fake.asked.length, 0);

      // A reply's page by its id: its post and every reply.
      const page = await backend.post!(REPLY);
      assert.deepEqual(
        page.posts.map((entry) => entry.id).sort(),
        [OLD, REPLY].sort(),
      );
      // Not a database id (a 見本's post): nothing is asked.
      fake.asked.length = 0;
      assert.deepEqual((await backend.post!("p-1")).posts, []);
      assert.equal(fake.asked.length, 0);
      assert.deepEqual((await backend.post!(uuid(0xdead))).posts, []);
      backend.close?.();

      // A visitor reads the same, and nothing of a reader's own.
      const visitor = visitorTownBackend(fake.client);
      await visitor.load();
      fake.asked.length = 0;
      const seen = await visitor.post!(REPLY);
      assert.equal(seen.posts.length, 2);
      assert.equal(
        fake.asked.some(
          (ask) =>
            ask.table === "post_reactions" || ask.table === "spoiler_reports",
        ),
        false,
      );
    },
  );

  await check(
    "older pages skip no 便り written at the same moment, on a page's edge or the town's",
    async () => {
      const second = (n: number) =>
        new Date(Date.parse(at) - n * 1000).toISOString();
      const KNOWN = uuid(0xf00);
      const tables: Record<string, AnyRow[]> = {
        profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
        books: [book(BOOK)],
        shops: [shop(BEN_SHOP, BEN)],
        shop_follows: [{ follower_id: AKI, shop_id: BEN_SHOP }],
        posts: [post(KNOWN, BEN, { created_at: second(0) })],
      };
      const fake = fakeReads(tables);
      const backend = accountTownBackend(fake.client, AKI, { storage: false });
      let state = (await backend.load()).state;
      // Older 便り the town did not read: two at the very moment of its
      // oldest (its reading stopped among them), then 45, of which 12 at
      // one moment that falls on the first page's edge.
      const older = [
        uuid(0xf01),
        uuid(0xf02),
        ...Array.from({ length: 45 }, (_, n) => uuid(0xf10 + n)),
      ];
      const times = [
        second(0),
        second(0),
        ...older
          .slice(2)
          .map((_, n) => second(n < 10 ? n + 1 : n < 22 ? 11 : n)),
      ];
      tables.posts.push(
        ...older.map((id, n) => post(id, BEN, { created_at: times[n] })),
      );
      const letters = createLetterReads({
        reads: () => ({
          generation: 1,
          newer: backend.newer!,
          older: backend.older!,
          post: backend.post!,
        }),
        state: () => state,
        absorb(arrived) {
          const next = backend.absorb!((town, saved) =>
            takeIn(town, arrived, saved),
          );
          if (!next || next === state) return false;
          state = next;
          return true;
        },
        reading: () => 1,
      });
      const read: string[] = [];
      for (let page = 0; page < 10; page += 1) {
        const got = await letters.older(Date.parse(at));
        assert.ok(got);
        read.push(...got.entries.map((entry) => entry.id));
        if (got.done) break;
      }
      // Every one, each once, newest first, and the last page says so.
      assert.equal(new Set(read).size, read.length);
      assert.deepEqual([...read].sort(), [...older].sort());
      assert.equal(state.olderRead?.done, true);
    },
  );

  await check(
    "newer 便り are read page after page, joined on to the town, and an idle read asks once",
    async () => {
      const minute = (n: number) =>
        new Date(Date.parse("2026-10-12T09:00:00Z") + n * 60_000).toISOString();
      const KNOWN = uuid(0xe00);
      const tables: Record<string, AnyRow[]> = {
        profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
        books: [book(BOOK)],
        shops: [shop(BEN_SHOP, BEN)],
        shop_follows: [{ follower_id: AKI, shop_id: BEN_SHOP }],
        posts: [post(KNOWN, BEN, { created_at: minute(0) })],
      };
      const fake = fakeReads(tables);
      const backend = accountTownBackend(fake.client, AKI, { storage: false });
      await backend.load();
      const postsAsked = () =>
        fake.asked.filter((ask) => ask.table === "posts");
      // Nothing new: the one read of posts, and nothing else is asked.
      fake.asked.length = 0;
      assert.deepEqual((await backend.newer!(minute(0))).posts, []);
      assert.deepEqual(
        fake.asked.map((ask) => ask.table),
        ["posts"],
      );
      // Saved late, a little older than the newest known: it joins on.
      const LATE = uuid(0xe01);
      tables.posts.push(post(LATE, BEN, { created_at: minute(-0.1) }));
      assert.deepEqual(
        (await backend.newer!(minute(0))).posts.map((entry) => entry.id),
        [LATE],
      );
      // A night away: 230 new 便り, some the reader's own from elsewhere.
      const night = Array.from({ length: 230 }, (_, n) =>
        post(uuid(0x1000 + n), n % 10 ? BEN : AKI, {
          created_at: minute(1 + n),
        }),
      );
      tables.posts.push(...night);
      fake.asked.length = 0;
      const first = await backend.newer!(minute(0));
      // Four pages of fifty at most, each from the last one's newest.
      assert.deepEqual(
        postsAsked().map((ask) => ask.filters[0]),
        [
          `created_at=gte.${new Date(Date.parse(minute(0)) - 10_000).toISOString()}`,
          `created_at=gte.${minute(48)}`,
          `created_at=gte.${minute(97)}`,
          `created_at=gte.${minute(146)}`,
        ],
      );
      // Oldest first and with no gap: every one up to the newest read.
      const others = night.filter((row) => row.author_id === BEN);
      const got = first.posts.map((entry) => entry.id);
      assert.equal(got[0], LATE);
      const last = others.findIndex((row) => row.id === got.at(-1));
      assert.deepEqual(
        got.slice(1),
        others.slice(0, last + 1).map((row) => row.id),
      );
      assert.ok(first.posts.every((entry) => entry.authorId !== ME_ID));
      // The next read goes on from the newest of them, and brings the rest.
      backend.absorb!((value, saved) => takeIn(value, first, saved));
      const second = await backend.newer!(others[last].created_at);
      assert.deepEqual(
        second.posts.map((entry) => entry.id),
        others.slice(last + 1).map((row) => row.id),
      );
      backend.close?.();
    },
  );

  await check("a block comes in for a reader the town knows", () => {
    const town = townFromRows(
      rows({
        blocks: [{ blocked_id: BEN }, { blocked_id: BEN }, { blocked_id: AKI }],
      }),
      ids,
    );
    assert.deepEqual(town.blocked, [BEN]);
    // Whatever the rows say, their 便り and shop stay out of the town.
    const leaked = townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN)],
        posts: [post("00000000-0000-4000-8000-0000000000e9", BEN)],
        blocks: [{ blocked_id: BEN }],
      }),
      ids,
    );
    assert.deepEqual([leaked.posts, leaked.shops], [[], []]);
    // Their profile stays, so the block can be lifted from it.
    assert.ok(town.readers.some((reader) => reader.id === BEN));
    // What they did to the person's own 便り is not shown.
    const own = post("00000000-0000-4000-8000-0000000000e1", AKI);
    const reacted = townFromRows(
      rows({
        posts: [own],
        postReactions: (["like", "want"] as const).map((kind) => ({
          user_id: BEN,
          post_id: own.id,
          kind,
          taps: 1,
          created_at: at,
        })),
        blocks: [{ blocked_id: BEN }],
      }),
      ids,
    );
    assert.deepEqual(
      reacted.posts.map((entry) => [entry.likes, entry.wants, entry.likers]),
      [[0, 0, []]],
    );
    const unknown = townFromRows(
      rows({
        blocks: [{ blocked_id: "00000000-0000-4000-8000-0000000000c0" }],
      }),
      ids,
    );
    assert.deepEqual(unknown.blocked, []);
  });

  await check(
    "the blocked are known, however many readers there are a request",
    async () => {
      const CAL = "00000000-0000-4000-8000-00000000000c";
      const fake = fakeReads(
        {
          profiles: [
            profile(AKI, "aki"),
            profile(BEN, "ben"),
            profile(CAL, "cal"),
          ],
          blocks: [{ blocker_id: AKI, blocked_id: CAL, created_at: at }],
        },
        { cap: 2 },
      );
      const { state } = await loadTown(fake.client, AKI, [], () => AKI_SHOP);
      assert.deepEqual(state.blocked, [CAL]);
      assert.deepEqual(
        fake.asked
          .filter((ask) => ask.table === "blocks")
          .map((ask) => ask.filters),
        [["blocker_id=eq." + AKI, "order=blocked_id.asc", "limit=1000"]],
      );
      // Every reader, two a request: the first page, then the pages after
      // it together, the last starting at the last reader counted.
      assert.deepEqual(
        fake.asked
          .filter((ask) => ask.table === "profiles")
          .map((ask) => ask.from),
        [0, 1, 2],
      );
    },
  );

  await check("a block and its lifting are written as the person's own", () => {
    const before = townFromRows(
      rows({ shops: [shop(BEN_SHOP, BEN)], follows: [{ shop_id: BEN_SHOP }] }),
      ids,
    );
    const blocked: TownState = { ...before, following: [], blocked: [BEN] };
    const writes = planWrites(before, blocked, ids);
    // Following ends (the database ends it too), then the block.
    assert.deepEqual(kinds(writes), ["remove:shop_follows", "add:blocks"]);
    assert.deepEqual((writes[1] as Extract<Write, { kind: "add" }>).rows, [
      { blocker_id: AKI, blocked_id: BEN },
    ]);
    const lifted = planWrites(blocked, { ...blocked, blocked: [] }, ids);
    assert.deepEqual(lifted, [
      {
        kind: "remove",
        table: "blocks",
        rows: [{ blocker_id: AKI, blocked_id: BEN }],
      },
    ]);
    // A 見本 is nobody to block: nothing is written for one.
    assert.deepEqual(
      planWrites(before, { ...before, blocked: [demoPosts[0].authorId] }, ids),
      [],
    );
  });

  await check(
    "blocking takes the reader out of the town at once, and keeps them out",
    async () => {
      const CAL = "00000000-0000-4000-8000-00000000000c";
      const benPost = "00000000-0000-4000-8000-0000000000e0";
      const myReply = "00000000-0000-4000-8000-0000000000e3";
      const calPost = "00000000-0000-4000-8000-0000000000e4";
      const town = townFromRows(
        rows({
          profiles: [
            profile(AKI, "aki"),
            profile(BEN, "ben"),
            profile(CAL, "cal"),
          ],
          shops: [shop(BEN_SHOP, BEN)],
          follows: [{ shop_id: BEN_SHOP }],
          posts: [
            post(benPost, BEN),
            post(myReply, AKI, { parent_id: benPost }),
            post(calPost, CAL),
          ],
          postReactions: [BEN, CAL].map((user_id) => ({
            user_id,
            post_id: myReply,
            kind: "like",
            taps: 2,
            created_at: at,
          })),
          records: [
            {
              id: uuid(0x4001),
              user_id: BEN,
              book_id: BOOK,
              kind: "finished",
              body: "",
              feelings: ["warm"],
              spoiler: false,
              is_public: true,
              audience: "everyone",
              created_at: at,
              updated_at: at,
            },
          ],
        }),
        ids,
      );
      assert.equal(town.readingRecords.length, 1);
      const { sync, planned, writes } = plannedSync(town);
      const backend: TownBackend = {
        kind: "account",
        newId: counterId,
        load: async () => ({ state: await sync.load(), status: "saved" }),
        save: sync.save,
        absorb: sync.absorb,
      };
      const store = createTownStore(backend);
      store.initialize();
      await settle(() => store.getSnapshot().posts.length === 3);

      // A 見本, or someone the town does not know, cannot be blocked.
      assert.equal(store.actions.blockReader(demoPosts[0].authorId), false);
      assert.equal(
        store.actions.blockReader("00000000-0000-4000-8000-0000000000c0"),
        false,
      );
      assert.deepEqual(store.getSnapshot().blocked, []);

      assert.equal(store.actions.blockReader(BEN), true);
      const blocked = store.getSnapshot();
      assert.deepEqual(blocked.blocked, [BEN]);
      // Their 便り, their shop and their records go; the follow ends; their
      // profile stays. The reader's own reply to them stays, never deleted.
      assert.deepEqual(
        blocked.posts.map((entry) => entry.id),
        [myReply, calPost],
      );
      // Their like of the reader's reply is no longer shown.
      const reply = blocked.posts[0];
      assert.deepEqual(
        [reply.likes, reply.likers?.map((liker) => liker.readerId)],
        [1, [CAL]],
      );
      assert.deepEqual(blocked.shops, []);
      assert.deepEqual(blocked.following, []);
      assert.deepEqual(blocked.readingRecords, []);
      assert.ok(blocked.readers.some((reader) => reader.id === BEN));
      await settle(() => writes() === 1);
      assert.deepEqual(kinds(planned), ["remove:shop_follows", "add:blocks"]);

      // A 便り of theirs read before the block reached the database stays out.
      const late: Arrived = {
        ...emptyArrived(),
        posts: [
          {
            id: "00000000-0000-4000-8000-0000000000e5",
            authorId: BEN,
            body: "まだ届く？",
            bookId: null,
            spoiler: false,
            parentId: null,
            createdAt: "2026-10-13T09:00:00Z",
            likes: 0,
            wants: 0,
            readingMode: null,
          },
        ],
      };
      store.absorb(late, store.getGeneration());
      assert.deepEqual(
        store.getSnapshot().posts.map((entry) => entry.id),
        [myReply, calPost],
      );

      store.actions.unblockReader(BEN);
      assert.deepEqual(store.getSnapshot().blocked, []);
      await settle(() => writes() === 2);
      assert.deepEqual(kinds(planned).slice(2), ["remove:blocks"]);
      sync.close();
    },
  );

  console.log(passed + " town sync checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
