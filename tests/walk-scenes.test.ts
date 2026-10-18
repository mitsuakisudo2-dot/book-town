import assert from "node:assert/strict";
import {
  accountWalkBackend,
  loadWalkRows,
  visitorWalkBackend,
} from "../src/lib/supabase/walk-backend";
import { createWalkStore } from "../src/lib/walk-store";
import type { StoreScene } from "../src/lib/store-scene";
import { OWN_SHOP_ID } from "../src/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";

// The walk reads a shop's scene when it is walked to (AUD-006 6a): the walk
// itself reads which shops have one, the reader's own scene and what they did
// on their walks; walk-store's `need` reads others' scenes by their shops,
// keeps them when the walk is read again, and asks again for one it could not
// read. Everything runs inside main() because tsx compiles this file as
// CommonJS.

type Row = Record<string, unknown>;

const AKI = "00000000-0000-4000-8000-00000000000a";
const shopId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reader = (n: number) =>
  `00000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`;
const AKI_SHOP = shopId(0);

const scene = (storeId: string, sign: string): StoreScene => ({
  schemaVersion: 1,
  storeId,
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

/**
 * Aki's shop and `others` shops; every other shop but the last has a public
 * scene (as the database copies it), the last only its shelves.
 */
function seed(others: number): Record<string, Row[]> {
  const shop = (n: number, owner: string): Row => ({
    id: shopId(n),
    owner_id: owner,
    name: "書店" + n,
    description: "",
    tagline: "",
    theme: "sage",
    is_open: true,
    public_shelves: [],
    public_scene:
      n === 0 || n === others ? null : scene("anything", "看板" + n),
    public_scene_books: [],
    created_at: "2026-10-01T00:00:00Z",
  });
  return {
    shops: [
      shop(0, AKI),
      ...Array.from({ length: others }, (_, i) => shop(i + 1, reader(i + 1))),
    ],
    shop_private: [
      {
        shop_id: AKI_SHOP,
        shelves: [],
        scene: scene("anything", "アキの看板"),
        scene_books: [],
      },
    ],
    shop_reactions: [],
    saved_shops: [],
    pop_reactions: [],
    shop_visits: [],
  };
}

/** The client of a fake, keeping each request's table and columns asked. */
function watched(fake: ReturnType<typeof fakeSupabase>) {
  const asked: string[] = [];
  const client = new Proxy(fake.client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key !== "from") return value;
      return (name: string) => {
        const query = (value as (name: string) => Row).call(target, name);
        return new Proxy(query, {
          get(inner, method, innerReceiver) {
            const found = Reflect.get(inner, method, innerReceiver);
            if (method !== "select" || typeof found !== "function")
              return found;
            return (columns: string, ...rest: unknown[]) => {
              asked.push(name + ":" + columns);
              return found.call(inner, columns, ...rest);
            };
          },
        });
      };
    },
  });
  return { client: client as typeof fake.client, asked };
}

async function until(done: () => boolean, what: string) {
  for (let wait = 0; wait < 400 && !done(); wait++)
    await new Promise((resume) => setTimeout(resume, 5));
  assert.ok(done(), what);
}

const signOf = (scenes: StoreScene[], id: string) =>
  scenes.find((s) => s.storeId === id)?.objects[0].text;

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "the walk reads which shops have a scene, not the scenes",
    async () => {
      const fake = fakeSupabase(AKI, seed(3));
      const { client, asked } = watched(fake);
      const { rows } = await loadWalkRows(client, AKI);
      assert.deepEqual(rows.scenes, []);
      assert.deepEqual(rows.elsewhere, [shopId(1), shopId(2)]);
      assert.ok(
        !asked.some((read) => read.startsWith("shops:") && /scene/.test(read)),
        "no public scene read: " + asked.join(", "),
      );
      // The reader's own scene comes whole, as before.
      assert.equal((rows.ownScene as StoreScene).objects[0].text, "アキの看板");
    },
  );

  await check(
    "a shop's scene is read when needed, by its shop, and kept",
    async () => {
      const fake = fakeSupabase(AKI, seed(3));
      const { client, asked } = watched(fake);
      const walk = createWalkStore(
        accountWalkBackend(client, AKI, { delay: 0, storage: false }),
      );
      walk.initialize();
      await until(() => walk.getSnapshot().ready, "the walk is read");
      let now = walk.getSnapshot();
      assert.deepEqual(
        now.scenes.map((s) => s.storeId),
        [OWN_SHOP_ID],
      );
      assert.deepEqual([...now.unread], [shopId(1), shopId(2)]);
      asked.length = 0;
      // The shop with only shelves, the walk's own and one never heard of
      // are not asked for.
      await walk.need([shopId(1), shopId(3), OWN_SHOP_ID, shopId(9)]);
      now = walk.getSnapshot();
      assert.deepEqual(asked, ["shops:id, public_scene"]);
      assert.equal(signOf(now.scenes, shopId(1)), "看板1");
      assert.deepEqual([...now.unread], [shopId(2)]);
      // Asked again, it is not read again.
      asked.length = 0;
      await walk.need([shopId(1)]);
      assert.deepEqual(asked, []);
      // Asked twice at once, it is read once.
      await Promise.all([walk.need([shopId(2)]), walk.need([shopId(2)])]);
      assert.deepEqual(asked, ["shops:id, public_scene"]);
      assert.equal(walk.getSnapshot().unread.size, 0);
    },
  );

  await check(
    "scenes read stay when the walk is read again, and what is saved is only the reader's",
    async () => {
      const fake = fakeSupabase(AKI, seed(3));
      const walk = createWalkStore(
        accountWalkBackend(fake.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
        }),
      );
      walk.initialize();
      await until(() => walk.getSnapshot().ready, "the walk is read");
      await walk.need([shopId(1)]);
      // A change the database turns away reads the walk again.
      fake.refuse = (write) =>
        write.table === "saved_shops"
          ? { status: 409, code: "23503", message: "gone" }
          : null;
      walk.update((state) => ({
        ...state,
        reactions: {
          [shopId(2)]: { liked: false, saved: true, message: "" },
        },
      }));
      await until(
        () => walk.getSnapshot().status === "recovered",
        "the walk is read again",
      );
      const now = walk.getSnapshot();
      assert.equal(signOf(now.scenes, shopId(1)), "看板1");
      assert.deepEqual([...now.unread], [shopId(2)]);
      assert.ok(
        !fake.writes.some((write) => write.table === "shops"),
        "nobody else's scene is written",
      );
      assert.ok(
        !fake.writes.some((write) => write.table === "shop_private"),
        "nor the reader's own, unchanged",
      );
    },
  );

  await check("a scene that could not be read is asked for again", async () => {
    const fake = fakeSupabase(AKI, seed(2));
    const walk = createWalkStore(
      accountWalkBackend(fake.client, AKI, { delay: 0, storage: false }),
    );
    walk.initialize();
    await until(() => walk.getSnapshot().ready, "the walk is read");
    fake.offline = true;
    await walk.need([shopId(1)]);
    assert.deepEqual([...walk.getSnapshot().unread], [shopId(1)]);
    fake.offline = false;
    await walk.need([shopId(1)]);
    assert.equal(signOf(walk.getSnapshot().scenes, shopId(1)), "看板1");
    assert.equal(walk.getSnapshot().unread.size, 0);
  });

  await check("a visitor's walk reads scenes the same way", async () => {
    const fake = fakeSupabase(AKI, seed(3), { visitor: true });
    const walk = createWalkStore(visitorWalkBackend(fake.client));
    walk.initialize();
    await until(() => walk.getSnapshot().ready, "the walk is read");
    // Every shop with a scene: a visitor has none of their own.
    assert.deepEqual([...walk.getSnapshot().unread], [shopId(1), shopId(2)]);
    await walk.need([shopId(2)]);
    assert.equal(signOf(walk.getSnapshot().scenes, shopId(2)), "看板2");
  });

  await check(
    "a walk of 3,000 shops reads a handful of rows' worth of scenes",
    async () => {
      const fake = fakeSupabase(AKI, seed(3000));
      const { client, asked } = watched(fake);
      const walk = createWalkStore(
        accountWalkBackend(client, AKI, { delay: 0, storage: false }),
      );
      walk.initialize();
      await until(() => walk.getSnapshot().ready, "the walk is read");
      assert.equal(walk.getSnapshot().unread.size, 2999);
      await walk.need([shopId(1500), shopId(1501), shopId(1499)]);
      assert.equal(
        asked.filter((read) => read === "shops:id, public_scene").length,
        1,
      );
      assert.equal(walk.getSnapshot().scenes.length, 4);
    },
  );

  console.log(`${passed} walk scene checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
