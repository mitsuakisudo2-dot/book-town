import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { townMissedLine, walkMissedLine } from "../src/lib/missed-changes";
import {
  deviceOutbox,
  forgetOutboxes,
  OUTBOX_KEY,
  outboxWaiting,
} from "../src/lib/outbox";
import { POST_DRAFT_KEY } from "../src/lib/post-draft";
import { RECORD_DRAFT_KEY } from "../src/lib/record-draft";
import { createTownStore } from "../src/lib/store";
import { accountTownBackend } from "../src/lib/supabase/town-backend";
import { accountWalkBackend } from "../src/lib/supabase/walk-backend";
import { isWrite, type Write } from "../src/lib/town-remote";
import { ME_ID, type PersistenceStatus } from "../src/lib/types";
import { createWalkStore } from "../src/lib/walk-store";
import { fakeSupabase, memoryStorage } from "./fixtures/fake-supabase";

// What happens to the reader's changes when saving does not go as planned
// (監査 AUD-002・007・008・125・126): one change the database turns away,
// no network, a page closed before its changes went out, a sign-in that ends
// without the reader pressing anything, and two devices. The real backend
// saves through a stand-in for Supabase (fixtures/fake-supabase.ts), so what
// is planned, sent, refused and read again is the app's own. Everything runs
// inside main() because tsx compiles this file as CommonJS.

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const BEN_SHOP = "00000000-0000-4000-8000-0000000000b5";
const BOOK = "00000000-0000-4000-8000-000000000b01";
const BEN_POST = "00000000-0000-4000-8000-0000000000e1";
const CAL = "00000000-0000-4000-8000-00000000000c";
const CAL_SHOP = "00000000-0000-4000-8000-0000000000c5";
const at = "2026-10-12T09:00:00Z";

const profile = (id: string, handle: string) => ({
  id,
  handle,
  name: handle.toUpperCase(),
  bio: "",
  color: "#768281",
  links: [],
  compose_icon: "pen",
  reading_visibility: "private",
  created_at: at,
  updated_at: at,
});

/** Ben's town, as Aki finds it: his shop, a book, and his 便り. */
const seed = () => ({
  profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
  shops: [
    {
      id: BEN_SHOP,
      owner_id: BEN,
      name: "朝の本屋",
      description: "",
      tagline: "",
      theme: "sage",
      is_open: true,
      public_shelves: [],
      public_scene_books: [],
      created_at: at,
    },
  ],
  books: [
    {
      id: BOOK,
      isbn: null,
      title: "華氏451度",
      author: "レイ・ブラッドベリ",
      publisher: "",
      price: null,
      source: "manual",
      work_id: "w" + BOOK.slice(1),
      created_at: at,
      updated_at: at,
    },
  ],
  posts: [
    {
      id: BEN_POST,
      author_id: BEN,
      body: "炎の色が忘れられない。",
      book_id: null,
      spoiler: false,
      spoiler_folded: false,
      parent_id: null,
      reading_mode: null,
      created_at: at,
    },
  ],
});

type Store = ReturnType<typeof createTownStore>;

/** Waits until the town has nothing left on its way; its status then. */
async function settled(store: Store): Promise<PersistenceStatus> {
  for (let wait = 0; wait < 400; wait++) {
    const status = store.getPersistenceSnapshot();
    if (status !== "loading" && status !== "saving" && status !== "unavailable")
      return status;
    await new Promise((resume) => setTimeout(resume, 5));
  }
  throw new Error("The town never settled: " + store.getPersistenceSnapshot());
}

/** Waits until `done` holds, a moment at a time. */
async function until(done: () => boolean, what: string) {
  for (let wait = 0; wait < 400 && !done(); wait++)
    await new Promise((resume) => setTimeout(resume, 5));
  assert.ok(done(), what);
}

/**
 * Aki's town through `db`, as the app opens it after signing in, with what
 * did not reach the database told as the app tells it (store.ts).
 */
function openTown(
  db: ReturnType<typeof fakeSupabase>,
  device?: ReturnType<typeof memoryStorage>,
) {
  const store = createTownStore(
    accountTownBackend(db.client, AKI, {
      delay: 0,
      retryDelays: [10],
      storage: false,
      device,
    }),
    undefined,
    { onMissed: (missed) => townMissedLine(missed, AKI) },
  );
  store.initialize();
  return store;
}

/** The town opened, once it has nothing left on its way. */
async function townOf(
  db: ReturnType<typeof fakeSupabase>,
  device?: ReturnType<typeof memoryStorage>,
) {
  const store = openTown(db, device);
  assert.equal(await settled(store), "saved");
  return store;
}

/** Closes the page `store` is on: the town moves to no backend at all. */
function closePage(store: Store) {
  store.use({
    kind: "unavailable",
    newId: () => "",
    load: () => ({ state: store.getSnapshot(), status: "unavailable" }),
    save: () => "unavailable",
  });
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "one change the database turns away goes alone: the others are saved",
    async () => {
      const db = fakeSupabase(AKI, seed());
      const store = await townOf(db);
      // Out of signal: a reply to Ben's 便り, a finished book with how it
      // felt, and Ben's shop followed.
      db.offline = true;
      const reply = store.actions.createPost({
        body: "わたしも読みました。",
        parentId: BEN_POST,
      });
      assert.ok(reply);
      const record = store.actions.recordReading({
        bookId: BOOK,
        feelings: ["quiet"],
        note: "静かな夜に読み終えた。",
        spoiler: false,
        audience: "private",
      });
      assert.ok(record);
      store.actions.toggleFollow(BEN_SHOP);
      await until(
        () => store.getPersistenceSnapshot() === "unavailable",
        "the town waits for the network",
      );
      // Meanwhile Ben takes his 便り down, so the reply has nothing to
      // answer; then the signal comes back.
      db.tables.posts = [];
      db.offline = false;
      assert.equal(await settled(store), "recovered");
      // The database has the record, the book read and the follow; only
      // the reply is missing.
      assert.deepEqual(
        db.tables.reading_entries?.map((row) => row.body),
        ["静かな夜に読み終えた。"],
      );
      assert.deepEqual(
        db.tables.shop_follows?.map((row) => row.shop_id),
        [BEN_SHOP],
      );
      assert.deepEqual(
        db.tables.library_entries?.map((row) => row.status),
        ["finished"],
      );
      assert.equal(db.tables.posts.length, 0);
      // And so does the town on screen.
      const town = store.getSnapshot();
      assert.deepEqual(
        town.readingRecords
          .filter((entry) => entry.readerId === ME_ID)
          .map((entry) => entry.note),
        ["静かな夜に読み終えた。"],
      );
      assert.deepEqual(town.following, [BEN_SHOP]);
      assert.ok(!town.posts.some((post) => post.id === reply));
    },
  );

  await check(
    "changes kept on the device go out when the town opens again",
    async () => {
      const db = fakeSupabase(AKI, seed());
      const device = memoryStorage();
      const store = await townOf(db, device);
      db.offline = true;
      const posted = store.actions.createPost({ body: "地下鉄で書いた。" });
      assert.ok(posted);
      store.actions.toggleLike(BEN_POST);
      await until(
        () => store.getPersistenceSnapshot() === "unavailable",
        "the town waits for the network",
      );
      // The page is closed before the signal comes back, and opened again
      // while it is still out; then it comes back.
      closePage(store);
      const next = openTown(db, device);
      await until(
        () => next.getPersistenceSnapshot() === "unavailable",
        "the page waits for the network to read the town",
      );
      db.offline = false;
      assert.equal(await settled(next), "saved");
      assert.deepEqual(
        db.tables.posts.map((row) => row.body),
        ["炎の色が忘れられない。", "地下鉄で書いた。"],
      );
      assert.deepEqual(
        db.tables.post_reactions?.map((row) => [row.post_id, row.kind]),
        [[BEN_POST, "like"]],
      );
      assert.ok(next.getSnapshot().posts.some((post) => post.id === posted));
      assert.deepEqual(next.getSnapshot().likedPosts, [BEN_POST]);
    },
  );

  // The drafts the words of a refused 便り or record go back to live in the
  // browser's storage.
  const browser = memoryStorage();
  const tab = new EventTarget();
  Object.assign(tab, { localStorage: browser });
  Object.assign(globalThis, { window: tab });
  const draftOf = (key: string, name: string) =>
    JSON.parse(browser.getItem(key) ?? "{}").drafts?.[name];

  await check(
    "the words of a 便り and a record turned away come back to their drafts",
    async () => {
      const db = fakeSupabase(AKI, seed());
      const store = await townOf(db);
      // Ben blocked Aki meanwhile: the database takes no reply from her,
      // and the record is turned away for a rule of its own.
      db.refuse = (write) =>
        (write.table === "posts" && write.rows.some((row) => row.parent_id)) ||
        write.table === "reading_entries"
          ? {
              status: 403,
              code: "42501",
              message: "new row violates row-level security policy",
            }
          : null;
      store.actions.createPost({
        body: "わたしも読みました。",
        parentId: BEN_POST,
      });
      store.actions.recordReading({
        bookId: BOOK,
        feelings: ["quiet"],
        note: "静かな夜に読み終えた。",
        spoiler: false,
        audience: "private",
      });
      store.actions.toggleFollow(BEN_SHOP);
      assert.equal(await settled(store), "recovered");
      assert.deepEqual(
        db.tables.shop_follows?.map((row) => row.shop_id),
        [BEN_SHOP],
      );
      const missed = store.getMissedSnapshot();
      assert.deepEqual(
        missed?.refused.map((write) => write.kind),
        ["posts", "records"],
      );
      assert.equal(
        missed?.line,
        "返信、読書の記録を保存できませんでした。書きかけは残しています。",
      );
      // The reply's words wait in the composer of 投稿する (its page may be
      // gone); the record's, in its book's.
      assert.equal(
        draftOf(POST_DRAFT_KEY, AKI + ":new-post")?.body,
        "わたしも読みました。",
      );
      assert.deepEqual(draftOf(RECORD_DRAFT_KEY, AKI + ":record-new:" + BOOK), {
        feelings: ["quiet"],
        note: "静かな夜に読み終えた。",
        spoiler: false,
        audience: "private",
      });
      // Told once: the next change is saved as any other.
      db.refuse = () => null;
      store.actions.toggleFollow(BEN_SHOP);
      assert.equal(await settled(store), "saved");
      assert.deepEqual(db.tables.shop_follows, []);
    },
  );

  await check(
    "a whole thing changed on the device is not sent over a newer save",
    async () => {
      const db = fakeSupabase(AKI, seed());
      const device = memoryStorage();
      const store = await townOf(db, device);
      db.offline = true;
      store.actions.updateNine([BOOK], { [BOOK]: "何度でも読む" });
      await until(
        () => store.getPersistenceSnapshot() === "unavailable",
        "the town waits for the network",
      );
      closePage(store);
      // Meanwhile Aki's nine is saved from another device.
      db.tables.profile_nine = [
        {
          profile_id: AKI,
          book_id: BOOK,
          note: "別の端末で書いた",
          position: 0,
        },
      ];
      db.offline = false;
      const next = openTown(db, device);
      assert.equal(await settled(next), "recovered");
      assert.deepEqual(
        db.tables.profile_nine.map((row) => row.note),
        ["別の端末で書いた"],
      );
      assert.deepEqual(next.getSnapshot().me.nineNotes, {
        [BOOK]: "別の端末で書いた",
      });
      assert.equal(
        next.getMissedSnapshot()?.line,
        "別の端末で先に変わっていたため、人生の9冊の変更は送りませんでした。",
      );
      // The device keeps nothing more of it.
      assert.equal(outboxWaiting(AKI, device), false);
    },
  );

  await check(
    "what waits on the device is told per reader, kept a week, let go on ログアウト",
    async () => {
      const device = memoryStorage();
      const now = Date.parse("2026-10-18T09:00:00Z");
      const outbox = (at = now) =>
        deviceOutbox<Write>(OUTBOX_KEY + AKI, isWrite, device, () => at);
      const like: Write = {
        kind: "add",
        table: "post_reactions",
        rows: [{ user_id: AKI, post_id: BEN_POST, kind: "like" }],
      };
      assert.equal(outboxWaiting(AKI, device), false);
      // Two pages keep their own, side by side.
      assert.ok(outbox().keep("page-1", [{ write: like }]));
      const second = outbox(now + 1000);
      assert.ok(second.keep("page-2", [{ write: like }]));
      assert.deepEqual(
        outbox()
          .left("page-3")
          .map((entry) => entry.page),
        ["page-1", "page-2"],
      );
      assert.deepEqual(
        outbox()
          .left("page-1")
          .map((entry) => entry.page),
        ["page-2"],
      );
      assert.equal(outboxWaiting(AKI, device), true);
      assert.equal(outboxWaiting(BEN, device), false);
      // A page with nothing left waiting lets its own go.
      assert.ok(second.keep("page-2", []));
      assert.deepEqual(
        outbox()
          .left("page-3")
          .map((entry) => entry.page),
        ["page-1"],
      );
      // Past a week, what waited is let go.
      assert.deepEqual(outbox(now + 8 * 86_400_000).left("page-3"), []);
      // A write of a shape this app does not make is let go too.
      device.setItem(
        OUTBOX_KEY + AKI,
        JSON.stringify([
          {
            page: "page-9",
            at: new Date(now).toISOString(),
            writes: [{ write: { kind: "drop" } }, { write: like }],
          },
        ]),
      );
      assert.deepEqual(
        outbox()
          .left("page-3")[0]
          ?.writes.map((kept) => kept.write),
        [like],
      );
      forgetOutboxes(AKI, device);
      assert.equal(outboxWaiting(AKI, device), false);
      // Storage that takes nothing: the page knows it kept nothing.
      const full = {
        ...memoryStorage(),
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      };
      assert.equal(
        deviceOutbox<Write>(OUTBOX_KEY + AKI, isWrite, full).keep("page-1", [
          { write: like },
        ]),
        false,
      );
    },
  );

  await check(
    "on the walk too, one change turned away goes alone",
    async () => {
      const db = fakeSupabase(AKI, {
        ...seed(),
        profiles: [...seed().profiles, profile(CAL, "cal")],
        shops: [
          ...seed().shops,
          { ...seed().shops[0], id: CAL_SHOP, owner_id: CAL, name: "夜の本屋" },
        ],
      });
      const walk = createWalkStore(
        accountWalkBackend(db.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
        }),
      );
      walk.initialize();
      await until(
        () => walk.getSnapshot().ready && walk.getSnapshot().status === "saved",
        "the walk is read",
      );
      db.offline = true;
      walk.update((state) => ({
        ...state,
        reactions: {
          [BEN_SHOP]: { liked: true, saved: false, message: "また来ます" },
          [CAL_SHOP]: { liked: false, saved: true, message: "" },
        },
      }));
      await until(
        () => walk.getSnapshot().status === "unavailable",
        "the walk waits for the network",
      );
      // Cal closes his shop meanwhile.
      db.tables.shops = db.tables.shops.filter((row) => row.id !== CAL_SHOP);
      db.offline = false;
      await until(
        () => walk.getSnapshot().status === "recovered",
        "the walk is read again",
      );
      assert.deepEqual(
        db.tables.shop_reactions?.map((row) => [row.shop_id, row.message]),
        [[BEN_SHOP, "また来ます"]],
      );
      assert.equal(db.tables.saved_shops?.length ?? 0, 0);
      const missed = walk.getSnapshot().missed;
      assert.ok(missed);
      assert.equal(
        walkMissedLine(missed),
        "あとで寄る書店を保存できませんでした。",
      );
    },
  );

  await check("values are compared one way: canonical.ts", async () => {
    // A mark kept on the device and one worked out from what the database
    // hands back must be made alike, whatever order the keys come in.
    const root = path.resolve(__dirname, "..");
    const own = readdirSync(path.join(root, "src"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)),
      )
      .filter(
        (file) =>
          file !== path.join("src", "lib", "canonical.ts") &&
          /\b(function|const|let)\s+canonical\b|0x811c9dc5/.test(
            readFileSync(path.join(root, file), "utf8"),
          ),
      );
    assert.deepEqual(own, []);
  });

  console.log(`${passed} save guard checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
