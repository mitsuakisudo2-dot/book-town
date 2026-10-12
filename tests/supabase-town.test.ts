import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTownStore } from "../src/lib/store";
import { notificationsFor } from "../src/lib/notifications";
import {
  accountTownBackend,
  visitorTownBackend,
} from "../src/lib/supabase/town-backend";
import {
  accountWalkBackend,
  visitorWalkBackend,
} from "../src/lib/supabase/walk-backend";
import {
  migrateShopScene,
  placementReactionKey,
  publicStoreScene,
} from "../src/lib/store-customization";
import { createWalkStore } from "../src/lib/walk-store";
import type { Database } from "../src/lib/supabase/database.types";
import { ME_ID, OWN_SHOP_ID, type PersistenceStatus } from "../src/lib/types";

// Two readers use the town against a real local Supabase (`supabase start`):
// what one saves comes back after a reload, what is public reaches the other,
// and what is private never does. Reads the stack's URLs and keys from
// `supabase status -o env`. Everything runs inside main() because tsx compiles
// this file as CommonJS.

const env = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is missing; run \`supabase status -o env\`.`);
  return value;
};
const API_URL = env("API_URL");
const PUBLISHABLE_KEY = env("PUBLISHABLE_KEY");
const SECRET_KEY = env("SECRET_KEY");

type Client = SupabaseClient<Database>;
const admin = createClient(API_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const newClient = (): Client =>
  createClient<Database>(API_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const run = Date.now().toString(36);

/** An invited reader, signed in with a code the admin API hands out, with a profile. */
async function reader(name: string) {
  const email = `${name}-${run}@example.jp`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  assert.ifError(created.error);
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  assert.ifError(link.error);
  const client = newClient();
  const signedIn = await client.auth.verifyOtp({
    email,
    token: link.data.properties!.email_otp,
    type: "email",
  });
  assert.ifError(signedIn.error);
  const id = created.data.user!.id;
  const handle = `${name}_${run}`.slice(0, 20);
  const profile = await client
    .from("profiles")
    .insert({ id, handle, name: name.toUpperCase() });
  assert.ifError(profile.error);
  return { id, handle, client };
}

/** A town store for this reader, as the app makes one after signing in. */
async function townOf(person: { id: string; client: Client }) {
  const store = createTownStore(
    accountTownBackend(person.client, person.id, {
      delay: 0,
      retryDelays: [50],
      storage: false,
    }),
  );
  store.initialize();
  await settled(store);
  return store;
}

type Store = ReturnType<typeof createTownStore>;

/** The walk store for this reader, as the app makes one after signing in. */
async function walkOf(person: { id: string; client: Client }) {
  const store = createWalkStore(
    accountWalkBackend(person.client, person.id, {
      delay: 0,
      retryDelays: [50],
      storage: false,
    }),
  );
  store.initialize();
  await walked(store);
  return store;
}

/** Waits until the walk has nothing left to save. */
async function walked(store: ReturnType<typeof createWalkStore>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { ready, status } = store.getSnapshot();
    if (ready && status !== "saving" && status !== "unavailable") {
      assert.equal(status, "saved");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The walk never finished saving.");
}

/** Waits until the store has nothing left to save, retries included. */
async function settled(
  store: Store,
  expected: PersistenceStatus = "saved",
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = store.getPersistenceSnapshot();
    // "unavailable" means a retry is coming, unless that is what is expected.
    const waiting =
      status === "loading" ||
      status === "saving" ||
      (status === "unavailable" && expected !== "unavailable");
    if (!waiting) {
      assert.equal(status, expected);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The town never finished saving.");
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const aki = await reader("aki");
  const ben = await reader("ben");
  let akiShopId = "";
  let bookId = "";
  let postId = "";
  let shelfId = "";
  let itemId = "";

  await check(
    "a new reader starts with an empty town of their own",
    async () => {
      const town = (await townOf(aki)).getSnapshot();
      assert.equal(town.me.id, ME_ID);
      assert.equal(town.me.handle, aki.handle);
      assert.equal(town.ownShop, null);
      assert.equal(
        town.readers.some((entry) => entry.handle === ben.handle),
        true,
      );
    },
  );

  await check("a shop, its shelves, a book and a post are saved", async () => {
    const store = await townOf(aki);
    const { actions } = store;
    bookId = actions.addBook({
      title: "華氏451度",
      author: "レイ・ブラッドベリ",
      isbn: "9784150119553",
    })!;
    assert.match(bookId, /^[0-9a-f-]{36}$/);
    actions.createShop("夜の本屋", "灯りの下で読む本", "ink");
    shelfId = store.getSnapshot().ownShop!.shelves[0].id;
    assert.equal(actions.addShelfBook(shelfId, bookId, "face"), true);
    itemId = store.getSnapshot().ownShop!.shelves[0].items[0].id;
    actions.updatePop(shelfId, itemId, "本を燃やす世界で、覚えていること。");
    actions.addShelf("秘密の棚");
    const secret = store.getSnapshot().ownShop!.shelves[1].id;
    actions.updateShelf(secret, { isPublic: false });
    actions.addShelfBook(secret, bookId, "spine");
    actions.updateProfile("アキ", "夜に本を読む。", ["note.com/aki"]);
    actions.updateNine([bookId], { [bookId]: "最初の一冊" });
    postId = actions.createPost({ body: "炎の色が忘れられない。", bookId })!;
    actions.toggleWish(bookId);
    actions.startReading(bookId, "together");
    await settled(store);

    const again = (await townOf(aki)).getSnapshot();
    assert.equal(again.ownShop?.id, OWN_SHOP_ID);
    assert.equal(again.ownShop?.name, "夜の本屋");
    assert.equal(again.ownShop?.theme, "ink");
    assert.deepEqual(
      again.ownShop?.shelves.map((shelf) => [shelf.name, shelf.isPublic]),
      [
        ["はじめの本棚", true],
        ["秘密の棚", false],
      ],
    );
    assert.equal(
      again.ownShop?.shelves[0].items[0].pop,
      "本を燃やす世界で、覚えていること。",
    );
    assert.equal(again.me.name, "アキ");
    assert.equal(again.me.bio, "夜に本を読む。");
    assert.deepEqual(again.me.links, ["https://note.com/aki"]);
    assert.deepEqual(again.me.lifeNine, [bookId]);
    assert.deepEqual(again.me.nineNotes, { [bookId]: "最初の一冊" });
    assert.deepEqual(again.library, [bookId]);
    assert.deepEqual(again.wishlist, [bookId]);
    const post = again.posts.find((entry) => entry.id === postId);
    assert.equal(post?.authorId, ME_ID);
    assert.equal(post?.bookId, bookId);
    assert.equal(again.readingSessions.length, 1);
    assert.equal(again.readingSessions[0].endedAt, null);

    const shops = await admin
      .from("shops")
      .select("id, public_shelves")
      .eq("owner_id", aki.id)
      .single();
    akiShopId = shops.data!.id;
  });

  await check(
    "another reader sees the public shelf and never the private one",
    async () => {
      const town = (await townOf(ben)).getSnapshot();
      const shop = town.shops.find((entry) => entry.id === akiShopId);
      assert.ok(shop, "Aki's shop is in Ben's town");
      assert.equal(shop.ownerId, aki.id);
      assert.deepEqual(
        shop.shelves.map((shelf) => shelf.name),
        ["はじめの本棚"],
      );
      const akiInTown = town.readers.find((entry) => entry.id === aki.id);
      assert.deepEqual(akiInTown?.lifeNine, [bookId]);
      assert.equal(
        town.posts.find((entry) => entry.id === postId)?.authorId,
        aki.id,
      );
      assert.deepEqual(
        town.readingNow.map((entry) => entry.readerId),
        [aki.id],
      );
      // Aki's lists are hers alone.
      assert.deepEqual(town.wishlist, []);
      const anonymous = await newClient()
        .from("shop_private")
        .select("shelves");
      assert.deepEqual(anonymous.data ?? [], []);
    },
  );

  await check("follows, reactions and a reply reach the owner", async () => {
    const store = await townOf(ben);
    const { actions } = store;
    actions.toggleFollow(akiShopId);
    actions.toggleLike(postId);
    actions.toggleWant(postId);
    actions.togglePopReaction(akiShopId, shelfId, itemId, "love");
    const reply = actions.createPost({
      body: "わたしも読みました。",
      parentId: postId,
    });
    assert.ok(reply);
    await settled(store);

    const benAgain = (await townOf(ben)).getSnapshot();
    assert.deepEqual(benAgain.following, [akiShopId]);
    // Only Aki can count Aki's followers.
    assert.equal(
      benAgain.shops.find((shop) => shop.id === akiShopId)?.followers,
      0,
    );
    assert.deepEqual(benAgain.likedPosts, [postId]);
    assert.deepEqual(benAgain.wantedPosts, [postId]);
    assert.deepEqual(benAgain.wishlist, [bookId]);
    assert.equal(Object.values(benAgain.popReactions)[0]?.[0], "love");

    const akiAgain = (await townOf(aki)).getSnapshot();
    assert.equal(akiAgain.ownShop?.followers, 1);
    const post = akiAgain.posts.find((entry) => entry.id === postId);
    assert.equal(post?.likes, 1);
    assert.equal(post?.wants, 1);
    assert.ok(
      notificationsFor(akiAgain).some((notice) =>
        notice.text.includes("返信しました"),
      ),
    );
  });

  await check(
    "taking things back and ending the reading are saved",
    async () => {
      const ben2 = await townOf(ben);
      ben2.actions.toggleFollow(akiShopId);
      ben2.actions.toggleLike(postId);
      await settled(ben2);
      const benAgain = (await townOf(ben)).getSnapshot();
      assert.deepEqual(benAgain.following, []);
      assert.deepEqual(benAgain.likedPosts, []);

      const store = await townOf(aki);
      store.actions.endReading(true);
      await settled(store);
      const again = (await townOf(aki)).getSnapshot();
      assert.notEqual(again.readingSessions[0].endedAt, null);
      assert.deepEqual(again.finishedBooks, [bookId]);
      assert.deepEqual((await townOf(ben)).getSnapshot().readingNow, []);
    },
  );

  await check("a change the database refuses is undone on screen", async () => {
    const store = await townOf(aki);
    // Someone takes an ID after Aki's town was read, then Aki picks it too.
    const chi = await reader("chi");
    assert.equal(
      store.actions.updateProfile("アキ", "夜に本を読む。", [], chi.handle),
      true,
    );
    await settled(store, "recovered");
    assert.equal(store.getSnapshot().me.handle, aki.handle);
    // Saving works again afterwards.
    store.actions.updateProfile("アキ", "朝にも読む。", []);
    await settled(store);
    assert.equal((await townOf(aki)).getSnapshot().me.bio, "朝にも読む。");
  });

  await check(
    "changes made while offline are saved once back online",
    async () => {
      // Aki's town, through a connection that can be cut.
      let offline = false;
      const flaky = createClient<Database>(API_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            offline
              ? Promise.reject(new TypeError("Failed to fetch"))
              : fetch(input, init),
        },
      });
      const session = (await aki.client.auth.getSession()).data.session!;
      assert.ifError(
        (
          await flaky.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
        ).error,
      );
      const store = await townOf({ id: aki.id, client: flaky });
      offline = true;
      store.actions.updateShop({
        name: "夜の本屋",
        description: "電波の届かない場所で書いた紹介。",
        tagline: "",
        theme: "ink",
      });
      await settled(store, "unavailable");
      offline = false;
      await settled(store);
      assert.equal(
        (await townOf(aki)).getSnapshot().ownShop?.description,
        "電波の届かない場所で書いた紹介。",
      );
    },
  );

  await check(
    "deleting a post removes it, and its replies, for everyone",
    async () => {
      const store = await townOf(aki);
      store.actions.deletePost(postId);
      await settled(store);
      const town = (await townOf(ben)).getSnapshot();
      assert.equal(
        town.posts.some(
          (entry) => entry.id === postId || entry.parentId === postId,
        ),
        false,
      );
    },
  );

  await check(
    "the store scene is saved, and visitors see only its public part",
    async () => {
      const town = (await townOf(aki)).getSnapshot();
      const walk = await walkOf(aki);
      // The shop's shelves become a scene: the public book on a shelf, the
      // private one kept aside.
      const scene = migrateShopScene(town.ownShop!, town.books);
      assert.equal(walk.saveScene(scene, town).ok, true);
      await walked(walk);

      const again = (await walkOf(aki)).getSnapshot();
      assert.deepEqual(
        again.scenes.find((entry) => entry.storeId === OWN_SHOP_ID),
        scene,
      );

      const visitor = (await walkOf(ben)).getSnapshot();
      const seen = visitor.scenes.find((entry) => entry.storeId === akiShopId);
      assert.ok(seen, "Aki's scene is on Ben's walk");
      assert.deepEqual(
        seen.objects.map((object) => object.id),
        publicStoreScene(scene).objects.map((object) => object.id),
      );
      assert.ok(
        seen.objects.length < scene.objects.length,
        "the private book stays with Aki",
      );
    },
  );

  await check(
    "likes, saves, visits, POP reactions and words are kept, and the words reach the owner",
    async () => {
      const walk = await walkOf(ben);
      const seen = walk
        .getSnapshot()
        .scenes.find((entry) => entry.storeId === akiShopId)!;
      const placement = seen.objects.find((object) => object.kind === "book")!;
      const pop = placementReactionKey(seen, placement);
      const visitedAt = new Date().toISOString();
      assert.equal(
        walk.update((state) => ({
          ...state,
          reactions: {
            [akiShopId]: { liked: true, saved: true, message: "また来ます" },
          },
          visits: { [akiShopId]: visitedAt },
          placementReactions: { [pop]: ["love"] },
        })),
        true,
      );
      await walked(walk);

      const again = (await walkOf(ben)).getSnapshot().state;
      assert.deepEqual(again.reactions, {
        [akiShopId]: { liked: true, saved: true, message: "また来ます" },
      });
      assert.deepEqual(Object.keys(again.visits), [akiShopId]);
      assert.equal(Date.parse(again.visits[akiShopId]), Date.parse(visitedAt));
      assert.deepEqual(again.placementReactions, { [pop]: ["love"] });

      const akiTown = (await townOf(aki)).getSnapshot();
      assert.deepEqual(
        akiTown.shopMessages.map((message) => [message.readerId, message.text]),
        [[ben.id, "また来ます"]],
      );
      assert.ok(
        notificationsFor(akiTown).some((notice) =>
          notice.text.includes("ひとことを残しました"),
        ),
      );

      // Taking it all back.
      walk.update((state) => ({
        ...state,
        reactions: {
          [akiShopId]: { liked: false, saved: false, message: "" },
        },
        visits: {},
        placementReactions: {},
      }));
      await walked(walk);
      const cleared = (await walkOf(ben)).getSnapshot().state;
      assert.deepEqual(cleared.reactions, {});
      assert.deepEqual(cleared.visits, {});
      assert.deepEqual(cleared.placementReactions, {});
      assert.deepEqual((await townOf(aki)).getSnapshot().shopMessages, []);
    },
  );

  await check(
    "a visitor reads the open shops and public posts, and changes nothing",
    async () => {
      let invited = 0;
      const onVisitor = () => (invited += 1);
      const said = async (body: string, solo = false) => {
        const row = await aki.client
          .from("posts")
          .insert({
            author_id: aki.id,
            body,
            reading_mode: solo ? "solo" : null,
          })
          .select("id")
          .single();
        assert.ifError(row.error);
        return row.data.id;
      };
      const open = await said("見学の人にも見える言葉");
      const note = await said("自分だけのメモ", true);
      const visitor = newClient();
      const store = createTownStore(visitorTownBackend(visitor), undefined, {
        onVisitor,
      });
      store.initialize();
      await settled(store);
      const town = store.getSnapshot();
      assert.equal(town.me.name, "ゲスト");
      assert.equal(town.ownShop, null);
      const shop = town.shops.find((entry) => entry.id === akiShopId);
      assert.equal(shop?.demo, false);
      assert.deepEqual(
        shop?.shelves.map((shelf) => shelf.name),
        ["はじめの本棚"],
      );
      assert.ok(town.posts.some((entry) => entry.id === open));
      assert.ok(!town.posts.some((entry) => entry.id === note));
      assert.ok(town.shops.some((entry) => entry.demo));
      assert.deepEqual(town.library, []);
      assert.deepEqual(town.wishlist, []);

      store.actions.toggleFollow(akiShopId);
      assert.deepEqual(store.getSnapshot().following, []);

      const walk = createWalkStore(visitorWalkBackend(visitor), { onVisitor });
      walk.initialize();
      await walked(walk);
      assert.ok(
        walk.getSnapshot().scenes.some((entry) => entry.storeId === akiShopId),
      );
      assert.equal(
        walk.update((state) => ({
          ...state,
          reactions: {
            [akiShopId]: { liked: true, saved: false, message: "" },
          },
        })),
        false,
      );
      assert.deepEqual(walk.getSnapshot().state.reactions, {});
      assert.equal(invited, 2);

      // The database itself refuses a visitor's writes, too.
      const follow = await visitor
        .from("shop_follows")
        .insert({ shop_id: akiShopId, follower_id: ben.id });
      assert.ok(follow.error);
    },
  );

  console.log(passed + " Supabase town checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
