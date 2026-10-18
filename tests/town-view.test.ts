import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  accountTownBackend,
  loadPublicTown,
  loadTown,
} from "../src/lib/supabase/town-backend";
import { ME_ID, type TownState } from "../src/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";

// The town in one answer (AUD-006 6a; supabase/migrations/*_town_view.sql):
// read through town_view and town_books, the town is the same as read table
// by table, signed in or not, with the same versions of what the reader
// saves whole; it takes a handful of requests whatever the town's size; and
// a made-up town of 10,000 readers is read and put together within a time
// (AUD-048). Everything runs inside main() because tsx compiles this file as
// CommonJS.

type Row = Record<string, unknown>;

const AKI = "00000000-0000-4000-8000-00000000000a";
const at = (n: number) =>
  new Date(Date.parse("2026-10-01T00:00:00Z") + n * 1000).toISOString();
const uuid = (group: number, n: number) =>
  `${String(group).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const profile = (id: string, n: number): Row => ({
  id,
  handle: "r" + n,
  name: "読書家" + n,
  bio: "",
  color: "#768281",
  links: [],
  compose_icon: "pen",
  reading_visibility: "private",
  created_at: at(n),
  updated_at: at(n),
  nine_version: 0,
});

const book = (id: string, n: number): Row => ({
  id,
  isbn: null,
  title: "本" + n,
  author: "著者" + (n % 997),
  publisher: "",
  price: null,
  source: "ndl",
  work_id: id,
  created_at: at(n),
  updated_at: at(n),
});

/**
 * A made-up town as the audit made it (AUD-006): `readers` readers, 3 in 10
 * with a shop of 40 books, each with 9 books in 人生の9冊 and 5 public
 * records, and 600 便り, among `books` books. Aki is the first reader.
 */
function madeUpTown(readers: number, books: number) {
  const ids = Array.from({ length: readers }, (_, n) =>
    n === 0 ? AKI : uuid(1, n),
  );
  const bookIds = Array.from({ length: books }, (_, n) => uuid(2, n));
  const pick = (n: number) => bookIds[(n * 7919) % books];
  const tables: Record<string, Row[]> = {
    profiles: ids.map(profile),
    books: bookIds.map(book),
    profile_nine: ids.flatMap((id, r) =>
      Array.from({ length: 9 }, (_, p) => ({
        profile_id: id,
        position: p,
        book_id: pick(r * 9 + p),
        note: p === 0 ? "最初の一冊" : "",
      })),
    ),
    shops: ids
      .filter((_, r) => r % 10 < 3)
      .map((owner, s) => ({
        id: uuid(3, s),
        owner_id: owner,
        name: "書店" + s,
        description: "",
        tagline: "",
        theme: "sage",
        is_open: true,
        public_shelves: [
          {
            id: "shelf-1",
            name: "棚",
            capacity: 100,
            isPublic: true,
            items: Array.from({ length: 40 }, (_, i) => ({
              id: "item-" + i,
              bookId: pick(s * 40 + i + 31),
              display: "spine",
              pop: i % 4 ? "" : "ひとこと",
            })),
          },
        ],
        public_scene_books: [],
        created_at: at(s),
      })),
    shop_private: [],
    reading_entries: ids.flatMap((id, r) =>
      Array.from({ length: 5 }, (_, k) => ({
        id: uuid(4, r * 5 + k),
        user_id: id,
        book_id: pick(r * 5 + k + 11),
        kind: "finished",
        body: "読み終えた。",
        feelings: [],
        spoiler: false,
        is_public: true,
        audience: "everyone",
        created_at: at(r * 5 + k),
        updated_at: at(r * 5 + k),
      })),
    ),
    posts: Array.from({ length: 600 }, (_, n) => ({
      id: uuid(5, n),
      author_id: ids[(n * 13) % readers],
      body: "便り" + n,
      book_id: n % 2 ? pick(n + 3) : null,
      spoiler: false,
      spoiler_folded: false,
      parent_id: null,
      reading_mode: null,
      created_at: at(n),
    })),
    // Each reader's like or want of a 便り, once.
    post_reactions: [
      ...new Map(
        Array.from({ length: 300 }, (_, n) => {
          const row = {
            user_id: ids[(n % (readers - 1)) + 1],
            post_id: uuid(5, (n * 3) % 600),
            kind: n % 2 ? "like" : "want",
            taps: 1,
            created_at: at(n),
          };
          return [`${row.user_id} ${row.post_id} ${row.kind}`, row] as const;
        }),
      ).values(),
    ],
    reading_sessions: [],
    moderation_folds: [],
    posters: [],
  };
  return tables;
}

/**
 * The town as town_view leaves it: others' records without their words,
 * which their profile's page reads (notes).
 */
const withoutOthersWords = (state: TownState): TownState => ({
  ...state,
  readingRecords: state.readingRecords.map((record) =>
    record.readerId === ME_ID
      ? record
      : { ...record, note: "", spoiler: false },
  ),
});

/** The client of a fake town, counting the requests asked of it. */
function counted(fake: ReturnType<typeof fakeSupabase>) {
  const asked: string[] = [];
  const client = new Proxy(fake.client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key !== "from" && key !== "rpc") return value;
      return (name: string, ...rest: unknown[]) => {
        asked.push(String(key) + ":" + name);
        return (value as (...args: unknown[]) => unknown).call(
          target,
          name,
          ...rest,
        );
      };
    },
  });
  return { client, asked };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const small = () => madeUpTown(40, 600);

  await check(
    "the town read through town_view is the town read table by table",
    async () => {
      const byView = fakeSupabase(AKI, small(), {
        versions: true,
        townView: true,
      });
      const byTables = fakeSupabase(AKI, small(), { versions: true });
      const viewed = await loadTown(byView.client, AKI, [], () => "shop");
      const tabled = await loadTown(byTables.client, AKI, [], () => "shop");
      assert.ok(viewed.state.readers.length > 30);
      assert.ok(viewed.state.posts.length > 100);
      assert.ok(viewed.state.readingRecords.length > 100);
      assert.deepEqual(viewed.state, withoutOthersWords(tabled.state));
      assert.deepEqual(viewed.ids, tabled.ids);
      assert.deepEqual(viewed.versions, tabled.versions);
      assert.equal(viewed.ownBooksKnown, tabled.ownBooksKnown);
    },
  );

  await check(
    "a visitor's town read through town_view is the one read table by table",
    async () => {
      const byView = fakeSupabase(AKI, small(), {
        townView: true,
        visitor: true,
      });
      const byTables = fakeSupabase(AKI, small());
      assert.deepEqual(
        await loadPublicTown(byView.client),
        withoutOthersWords(await loadPublicTown(byTables.client)),
      );
    },
  );

  await check(
    "another reader's words come when asked for, as the tables hold them",
    async () => {
      const seed = small();
      const other = uuid(1, 3);
      for (const row of seed.reading_entries)
        if (row.user_id === other) {
          row.body = "ネタバレあり：" + String(row.id).slice(-2);
          row.spoiler = true;
        }
      const fake = fakeSupabase(AKI, seed, { versions: true, townView: true });
      const backend = accountTownBackend(fake.client, AKI, {
        delay: 0,
        storage: false,
      });
      const { state } = await backend.load();
      const theirs = state.readingRecords.filter((r) => r.readerId === other);
      assert.equal(theirs.length, 5);
      assert.ok(theirs.every((r) => r.note === "" && !r.spoiler));
      const words = await backend.notes!(other);
      assert.deepEqual(
        theirs.map((r) => words.get(r.id)),
        theirs.map((r) => ({
          note: "ネタバレあり：" + r.id.slice(-2),
          spoiler: true,
        })),
      );
      // The reader's own words come with the town; nothing more to ask.
      assert.equal((await backend.notes!(ME_ID)).size, 0);
      assert.equal((await backend.notes!(AKI)).size, 0);
      backend.close?.();
    },
  );

  await check(
    "the versions of what the reader saves whole come with the town",
    async () => {
      const seed = small();
      (seed.profiles[0] as Row).nine_version = 4;
      const own = seed.shops.find((shop) => shop.owner_id === AKI) as Row;
      seed.shop_private.push({
        shop_id: own.id,
        shelves: [],
        scene: null,
        scene_books: [],
        shelves_version: 7,
        scene_version: 2,
      });
      seed.posters.push({
        id: uuid(6, 1),
        author_id: AKI,
        template: "text",
        theme: null,
        font: null,
        pages: [{ blocks: [{ type: "text", text: "夜に" }] }],
        spoiler: false,
        show_in_timeline: false,
        allow_display: true,
        status: "draft",
        created_at: at(1),
        updated_at: at(1),
        version: 3,
      });
      const fake = fakeSupabase(AKI, seed, { versions: true, townView: true });
      const { versions } = await loadTown(fake.client, AKI, [], () => "shop");
      assert.deepEqual(versions, {
        shelves: 7,
        nine: 4,
        ["poster:" + uuid(6, 1)]: 3,
      });
    },
  );

  await check(
    "a town of 10,000 readers is a handful of requests, and put together in time (AUD-048)",
    async () => {
      const seed = madeUpTown(10_000, 80_000);
      const viewed = counted(
        fakeSupabase(AKI, seed, { versions: true, townView: true }),
      );
      const started = performance.now();
      const { state } = await loadTown(viewed.client, AKI, [], () => "shop");
      const took = performance.now() - started;
      assert.equal(state.readers.length, 9_999);
      // Each list of others' rows in the one answer; the books they point
      // to in one more for each thousand; the rest are the reader's own.
      const shared = viewed.asked.filter(
        (name) =>
          /^from:(profiles|profile_nine|shops|posts|post_reactions|reading_entries|moderation_folds|posters)$/.test(
            name,
          ) || name === "from:books",
      );
      assert.deepEqual(shared, [], "nothing shared is read table by table");
      const books = viewed.asked.filter((name) => name === "rpc:town_books");
      assert.ok(books.length <= 20, `${books.length} town_books requests`);
      const others = viewed.asked.length - books.length;
      assert.ok(others <= 20, `${others} requests besides the books`);
      const tabled = counted(fakeSupabase(AKI, seed, { versions: true }));
      await loadTown(tabled.client, AKI, [], () => "shop");
      console.log(
        `    10,000 readers: ${viewed.asked.length} requests (${tabled.asked.length} table by table), ${Math.round(took)}ms`,
      );
      assert.ok(viewed.asked.length * 5 < tabled.asked.length);
      // Generous for a slow machine: before this, putting the town together
      // alone took about 10 seconds.
      assert.ok(took < 6000, `read and put together in ${Math.round(took)}ms`);
    },
  );

  console.log(`${passed} town view checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
