import assert from "node:assert/strict";
import { townMissedLine, walkMissedLine } from "../src/lib/missed-changes";
import { createTownStore } from "../src/lib/store";
import type { StoreScene } from "../src/lib/store-scene";
import type { Missed } from "../src/lib/supabase/sync";
import { accountTownBackend } from "../src/lib/supabase/town-backend";
import { accountWalkBackend } from "../src/lib/supabase/walk-backend";
import { OWN_SHOP_ID, type PersistenceStatus } from "../src/lib/types";
import type { WalkData } from "../src/lib/walk-backend";
import type { WalkWrite } from "../src/lib/walk-remote";
import { fakeSupabase, memoryStorage } from "./fixtures/fake-supabase";

// What the reader saves whole (their shop's shelves, 人生の9冊, a poster,
// the store scene) is written only over the version it began from (監査
// AUD-003; docs/09「版を確かめて書く」): a device that read it before
// another device saved it since does not write over that save, and the
// reader is told. The real backends save through a stand-in for Supabase
// that counts versions as the database does (fixtures/fake-supabase.ts,
// `versions`). Everything runs inside main() because tsx compiles this file
// as CommonJS.

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const AKI_SHOP = "00000000-0000-4000-8000-0000000000a5";
const BOOK = "00000000-0000-4000-8000-000000000b01";
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

/** Aki's own shop, with nothing on its shelves yet, and a book to use. */
const seed = () => ({
  profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
  shops: [
    {
      id: AKI_SHOP,
      owner_id: AKI,
      name: "雨の本屋",
      description: "",
      tagline: "",
      theme: "sage",
      is_open: true,
      public_shelves: [],
      public_scene_books: [],
      created_at: at,
    },
  ],
  shop_private: [
    { shop_id: AKI_SHOP, shelves: [], scene: null, scene_books: [] },
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
});

type Db = ReturnType<typeof fakeSupabase>;
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

/** Aki's town on one device, opened and read, as the app tells what it missed. */
async function device(db: Db, storage?: ReturnType<typeof memoryStorage>) {
  const store = createTownStore(
    accountTownBackend(db.client, AKI, {
      delay: 0,
      retryDelays: [10],
      storage: false,
      device: storage,
    }),
    undefined,
    { onMissed: (missed) => townMissedLine(missed, AKI) },
  );
  store.initialize();
  assert.equal(await settled(store), "saved");
  return store;
}

const shelfNames = (rows: unknown) =>
  (rows as { name: string }[]).map((shelf) => shelf.name);
const ownShelves = (db: Db) => shelfNames(db.tables.shop_private[0].shelves);
const saves = (db: Db, name: string) =>
  db.writes.filter(
    (write) => write.op === "rpc" && write.rows[0]?.name === name,
  ).length;

const scene = (sign: string): StoreScene => ({
  schemaVersion: 1,
  storeId: OWN_SHOP_ID,
  ownerManaged: true,
  theme: {
    id: "woodshop",
    light: "#fff",
    wood: "#000",
    paper: "#eee",
    font: "serif",
  },
  background: { kind: "preset", blur: 0, darkness: 0 },
  forbidden: [],
  objects: [
    {
      id: "sign",
      kind: "sign",
      parentId: null,
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, rotation: 0 },
      z: 1,
      text: sign,
    },
  ],
});

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "shelves saved on another device since are not written over, and the reader is told",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const phone = await device(db);
      const laptop = await device(db);
      // On the laptop, two shelves one after the other: each goes over the
      // version the one before left.
      laptop.actions.addShelf("雨の日に", 10);
      assert.equal(await settled(laptop), "saved");
      laptop.actions.addShelf("夜ふかし", 10);
      assert.equal(await settled(laptop), "saved");
      assert.deepEqual(ownShelves(db), ["雨の日に", "夜ふかし"]);
      // The phone, read before them, adds its own.
      phone.actions.addShelf("晴れの日に", 10);
      assert.equal(await settled(phone), "recovered");
      assert.deepEqual(ownShelves(db), ["雨の日に", "夜ふかし"]);
      assert.deepEqual(
        phone.getSnapshot().ownShop?.shelves.map((shelf) => shelf.name),
        ["雨の日に", "夜ふかし"],
      );
      assert.equal(
        phone.getMissedSnapshot()?.line,
        "別の端末で先に変わっていたため、書店の棚の変更は送りませんでした。",
      );
      // Read again, the phone's next change goes over what it now knows.
      phone.actions.addShelf("晴れの日に", 10);
      assert.equal(await settled(phone), "saved");
      assert.deepEqual(ownShelves(db), ["雨の日に", "夜ふかし", "晴れの日に"]);
      assert.ok(saves(db, "save_shelves") >= 3);
      assert.ok(
        !db.writes.some(
          (write) => write.table === "shop_private" && write.op === "upsert",
        ),
        "written through save_shelves only",
      );
    },
  );

  await check(
    "人生の9冊 and a poster saved on another device since are not written over",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const phone = await device(db);
      const laptop = await device(db);
      laptop.actions.updateNine([BOOK], { [BOOK]: "ノートで書いた" });
      assert.equal(await settled(laptop), "saved");
      phone.actions.updateNine([BOOK], { [BOOK]: "電話で書いた" });
      assert.equal(await settled(phone), "recovered");
      assert.deepEqual(
        db.tables.profile_nine.map((row) => row.note),
        ["ノートで書いた"],
      );
      assert.deepEqual(phone.getSnapshot().me.nineNotes, {
        [BOOK]: "ノートで書いた",
      });
      assert.equal(
        phone.getMissedSnapshot()?.line,
        "別の端末で先に変わっていたため、人生の9冊の変更は送りませんでした。書きかけは残しています。",
      );

      const draft = (heading: string, theme: "navy" | "kinari" | "sumi") => ({
        template: "lineup" as const,
        theme,
        font: "mincho" as const,
        pages: [{ heading, text: "", bookIds: [BOOK] }],
        spoiler: false,
        inTimeline: true,
        status: "draft" as const,
      });
      const id = laptop.actions.savePoster(draft("夜の本", "navy"));
      assert.ok(id);
      assert.equal(await settled(laptop), "saved");
      // The phone reads it, then the laptop changes it.
      const phoneAgain = await device(db);
      laptop.actions.savePoster(draft("夜の本", "kinari"), id);
      assert.equal(await settled(laptop), "saved");
      phoneAgain.actions.savePoster(draft("夜の本", "sumi"), id);
      assert.equal(await settled(phoneAgain), "recovered");
      assert.deepEqual(
        db.tables.posters.map((row) => row.theme),
        ["kinari"],
      );
      assert.equal(
        phoneAgain.getSnapshot().posters.find((poster) => poster.id === id)
          ?.theme,
        "kinari",
      );
      assert.equal(
        phoneAgain.getMissedSnapshot()?.line,
        "別の端末で先に変わっていたため、ポスターの変更は送りませんでした。書きかけは残しています。",
      );
    },
  );

  await check(
    "an answer lost on the way, then another change: both are saved, and nothing is told",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const laptop = await device(db);
      // The database takes the shelf, but the answer is lost; meanwhile the
      // reader goes on.
      db.loseAnswers = true;
      laptop.actions.addShelf("雨の日に", 10);
      await until(
        () => laptop.getPersistenceSnapshot() === "unavailable",
        "the answer is lost",
      );
      assert.deepEqual(ownShelves(db), ["雨の日に"]);
      db.loseAnswers = false;
      laptop.actions.addShelf("夜ふかし", 10);
      assert.equal(await settled(laptop), "saved");
      assert.equal(laptop.getMissedSnapshot(), null);
      assert.deepEqual(ownShelves(db), ["雨の日に", "夜ふかし"]);
      // The same with the nine.
      db.loseAnswers = true;
      laptop.actions.updateNine([BOOK], { [BOOK]: "一度目" });
      await until(
        () => laptop.getPersistenceSnapshot() === "unavailable",
        "the answer is lost",
      );
      assert.deepEqual(
        db.tables.profile_nine.map((row) => row.note),
        ["一度目"],
      );
      db.loseAnswers = false;
      laptop.actions.updateNine([BOOK], { [BOOK]: "二度目" });
      assert.equal(await settled(laptop), "saved");
      assert.equal(laptop.getMissedSnapshot(), null);
      assert.deepEqual(
        db.tables.profile_nine.map((row) => row.note),
        ["二度目"],
      );
    },
  );

  await check(
    "changes kept on the device go over the version the next page reads",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const storage = memoryStorage();
      const phone = await device(db, storage);
      db.offline = true;
      phone.actions.addShelf("地下鉄で", 10);
      await until(
        () => phone.getPersistenceSnapshot() === "unavailable",
        "the town waits for the network",
      );
      // The page is closed; the next one sends what was kept.
      phone.use({
        kind: "unavailable",
        newId: () => "",
        load: () => ({ state: phone.getSnapshot(), status: "unavailable" }),
        save: () => "unavailable",
      });
      db.offline = false;
      const next = createTownStore(
        accountTownBackend(db.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
          device: storage,
        }),
        undefined,
        { onMissed: (missed) => townMissedLine(missed, AKI) },
      );
      next.initialize();
      assert.equal(await settled(next), "saved");
      assert.deepEqual(ownShelves(db), ["地下鉄で"]);
      assert.ok(saves(db, "save_shelves") >= 1);
      // And the page goes on over the version it read since.
      next.actions.addShelf("帰り道", 10);
      assert.equal(await settled(next), "saved");
      assert.deepEqual(ownShelves(db), ["地下鉄で", "帰り道"]);
    },
  );

  await check(
    "a database without versions is written the old way",
    async () => {
      const db = fakeSupabase(AKI, seed());
      const laptop = await device(db);
      laptop.actions.addShelf("雨の日に", 10);
      laptop.actions.updateNine([BOOK], { [BOOK]: "前のまま" });
      assert.equal(await settled(laptop), "saved");
      assert.deepEqual(ownShelves(db), ["雨の日に"]);
      assert.deepEqual(
        db.tables.profile_nine.map((row) => row.note),
        ["前のまま"],
      );
      assert.equal(saves(db, "save_shelves") + saves(db, "save_nine"), 0);
      assert.ok(
        db.writes.some(
          (write) => write.table === "shop_private" && write.op === "upsert",
        ),
      );
    },
  );

  await check(
    "the store scene saved on another device since is not written over",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      /** Aki's walk on one device, with what it was told when read again. */
      async function walkOn() {
        const backend = accountWalkBackend(db.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
        });
        const loaded = await backend.load();
        const told: {
          status: PersistenceStatus;
          missed?: Missed<WalkWrite>;
        }[] = [];
        let data: WalkData = loaded.data;
        backend.watch?.({
          status(status) {
            told.push({ status });
          },
          replace(next, status, missed) {
            data = next;
            told.push({ status, missed });
          },
        });
        const save = (sign: string) =>
          backend.save({
            ...data,
            scenes: [
              scene(sign),
              ...data.scenes.filter((entry) => entry.storeId !== OWN_SHOP_ID),
            ],
          });
        return { told, save, data: () => data };
      }
      const phone = await walkOn();
      const laptop = await walkOn();
      laptop.save("ノートの看板");
      await until(
        () => laptop.told.some(({ status }) => status === "saved"),
        "the laptop's scene is saved",
      );
      assert.equal(
        (db.tables.shop_private[0].scene as { objects: { text: string }[] })
          .objects[0].text,
        "ノートの看板",
      );
      phone.save("電話の看板");
      await until(
        () => phone.told.some(({ status }) => status === "recovered"),
        "the phone reads the scene again",
      );
      const recovered = phone.told.find(({ status }) => status === "recovered");
      assert.ok(recovered?.missed);
      assert.equal(
        walkMissedLine(recovered.missed),
        "別の端末で先に変わっていたため、店内の飾りつけの変更は送りませんでした。書きかけは残しています。",
      );
      assert.equal(
        (db.tables.shop_private[0].scene as { objects: { text: string }[] })
          .objects[0].text,
        "ノートの看板",
      );
      const own = phone
        .data()
        .scenes.find((entry) => entry.storeId === OWN_SHOP_ID);
      assert.equal(
        (own?.objects[0] as { text?: string } | undefined)?.text,
        "ノートの看板",
      );
    },
  );

  const poster = (heading: string, theme: "navy" | "kinari" | "sumi") => ({
    template: "lineup" as const,
    theme,
    font: "mincho" as const,
    pages: [{ heading, text: "", bookIds: [BOOK] }],
    spoiler: false,
    inTimeline: true,
    status: "draft" as const,
  });
  /** The heading on a poster's first page, as the database keeps it. */
  const headingOf = (pages: unknown) =>
    (
      pages as { blocks: { type: string; text?: string }[] }[] | undefined
    )?.[0]?.blocks.find((block) => block.type === "heading")?.text;
  /** What a write to posters sends of a poster (save_poster or a row). */
  const sentPoster = (write: { rows: Record<string, unknown>[] }) => {
    const row = (write.rows[0]?.value ?? write.rows[0] ?? {}) as {
      theme?: string;
      pages?: unknown;
    };
    return { theme: row.theme, heading: headingOf(row.pages) };
  };
  /** Nothing gets through for now: as a connection that drops. */
  const dropped = { status: 0, code: "", message: "Failed to fetch" };
  const posterThemes = (db: Db) =>
    Object.fromEntries(
      db.tables.posters.map((row) => [headingOf(row.pages), row.theme]),
    );

  await check(
    "a nine saved between the reads of its version and of its books is not written over",
    async () => {
      // Read table by table (a database before town_view): the version and
      // the nine come from two requests. town_view answers both at once.
      const db = fakeSupabase(AKI, seed(), { versions: true });
      const phone = await device(db);
      // The laptop reads the nine's books at once, its version only after
      // the phone has saved (two requests, two moments).
      let saved!: () => void;
      const phoneSaved = new Promise<void>((done) => (saved = done));
      let holding = true;
      let nineRead = false;
      db.hold = (table, op) => {
        if (!holding || op !== "select") return undefined;
        if (table === "profile_nine") nineRead = true;
        return table === "profiles" ? phoneSaved : undefined;
      };
      const opening = device(db);
      await until(() => nineRead, "the laptop reads the nine's books");
      phone.actions.updateNine([BOOK], { [BOOK]: "電話で書いた" });
      assert.equal(await settled(phone), "saved");
      holding = false;
      saved();
      const laptop = await opening;
      // What the laptop holds is never older than the version it writes over.
      assert.deepEqual(laptop.getSnapshot().me.nineNotes, {
        [BOOK]: "電話で書いた",
      });
      laptop.actions.updateNine([BOOK], { [BOOK]: "ノートで書き足した" });
      assert.equal(await settled(laptop), "saved");
      assert.deepEqual(
        db.tables.profile_nine.map((row) => row.note),
        ["ノートで書き足した"],
      );
    },
  );

  await check(
    "a poster whose making went unanswered is written only over the version it was made at",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const phone = await device(db);
      // The phone makes a poster; the database takes it, the answer is lost.
      db.loseAnswers = true;
      const id = phone.actions.savePoster(poster("夜の本", "navy"));
      assert.ok(id);
      await until(
        () => phone.getPersistenceSnapshot() === "unavailable",
        "the answer is lost",
      );
      db.loseAnswers = false;
      // The phone gets nothing through for a while, and the reader goes on
      // changing it there; the laptop reads it and changes it meanwhile.
      let away = true;
      db.refuse = (write) =>
        away &&
        write.table === "posters" &&
        sentPoster(write).theme !== "kinari"
          ? dropped
          : null;
      phone.actions.savePoster(poster("夜の本", "sumi"), id);
      const laptop = await device(db);
      laptop.actions.savePoster(poster("夜の本", "kinari"), id);
      assert.equal(await settled(laptop), "saved");
      away = false;
      assert.equal(await settled(phone), "recovered");
      assert.deepEqual(posterThemes(db), { 夜の本: "kinari" });
      assert.equal(
        phone.getMissedSnapshot()?.line,
        "別の端末で先に変わっていたため、ポスターの変更は送りませんでした。書きかけは残しています。",
      );
      assert.ok(
        !db.writes.some(
          (write) => write.table === "posters" && write.op === "update",
        ),
        "never the old way",
      );
    },
  );

  await check(
    "two posters made at once, one changed elsewhere since: the other is still made",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const phone = await device(db);
      // The first goes in; the connection drops before the second.
      let cut = true;
      db.refuse = (write) =>
        cut &&
        write.table === "posters" &&
        sentPoster(write).heading === "二枚目"
          ? dropped
          : null;
      const first = phone.actions.savePoster(poster("一枚目", "navy"));
      phone.actions.savePoster(poster("二枚目", "navy"));
      assert.ok(first);
      await until(
        () => phone.getPersistenceSnapshot() === "unavailable",
        "the second cannot be sent",
      );
      assert.deepEqual(posterThemes(db), { 一枚目: "navy" });
      const laptop = await device(db);
      laptop.actions.savePoster(poster("一枚目", "kinari"), first);
      assert.equal(await settled(laptop), "saved");
      cut = false;
      assert.equal(await settled(phone), "recovered");
      assert.deepEqual(posterThemes(db), { 一枚目: "kinari", 二枚目: "navy" });
      assert.equal(
        phone.getMissedSnapshot()?.line,
        "別の端末で先に変わっていたため、ポスターの変更は送りませんでした。書きかけは残しています。",
      );
    },
  );

  await check(
    "shelves turned away and kept for the next page are told there, not sent again",
    async () => {
      const db = fakeSupabase(AKI, seed(), { versions: true, townView: true });
      const storage = memoryStorage();
      const phone = await device(db, storage);
      // Turned away; then the page loses the network before it can tell it,
      // and is closed.
      let first = true;
      db.refuse = (write) => {
        if (write.table !== "shop_private") return null;
        db.offline = first;
        first = false;
        return {
          status: 400,
          code: "23514",
          message: "new row violates check constraint",
        };
      };
      phone.actions.addShelf("断られた棚", 10);
      await until(
        () => db.offline && phone.getPersistenceSnapshot() === "unavailable",
        "the page cannot read the town again",
      );
      phone.use({
        kind: "unavailable",
        newId: () => "",
        load: () => ({ state: phone.getSnapshot(), status: "unavailable" }),
        save: () => "unavailable",
      });
      db.offline = false;
      db.refuse = () => null;
      // Another device saves the shelves meanwhile.
      const laptop = await device(db);
      laptop.actions.addShelf("ノートの棚", 10);
      assert.equal(await settled(laptop), "saved");
      const sent = saves(db, "save_shelves");
      const next = createTownStore(
        accountTownBackend(db.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
          device: storage,
        }),
        undefined,
        { onMissed: (missed) => townMissedLine(missed, AKI) },
      );
      next.initialize();
      assert.equal(await settled(next), "recovered");
      assert.deepEqual(ownShelves(db), ["ノートの棚"]);
      assert.equal(saves(db, "save_shelves"), sent);
      assert.match(
        next.getMissedSnapshot()?.line ?? "",
        /^書店の棚を保存できませんでした。/,
      );
    },
  );

  console.log(`${passed} write version checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
