import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTownStore } from "../src/lib/store";
import { notificationsFor } from "../src/lib/notifications";
import {
  accountTownBackend,
  applyWrite,
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
import { fileReport } from "../src/lib/supabase/reports";
import { loadOpenNotes } from "../src/lib/supabase/site-notes";
import { createWalkStore } from "../src/lib/walk-store";
import type { Database } from "../src/lib/supabase/database.types";
import {
  ME_ID,
  OWN_SHOP_ID,
  reviewKey,
  type PersistenceStatus,
  type TownState,
} from "../src/lib/types";
import { demoBooks, demoPosts } from "../src/lib/data";
import { isDatabaseId } from "../src/lib/record-kind";
import { sampleBookRowId } from "../src/lib/samples";
import { bookById } from "../src/lib/book-name";
import { mine } from "../src/lib/own-books";
import { moreKey, withMore, type MoreAsk } from "../src/lib/town-more";

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

/** The town as a page that asks for more sees it (useTownMore). */
async function townWith(store: Store, ask: MoreAsk): Promise<TownState> {
  await store.more(ask);
  const read = store.getMore(moreKey(ask));
  assert.ok(read, "read for the page");
  return withMore(store.getSnapshot(), [read]);
}

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
        ["はじめの棚", true],
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
    "見本 stand in a signed-in town, and their books can be kept",
    async () => {
      const eri = await reader("eri");
      const store = await townOf(eri);
      const town = store.getSnapshot();
      assert.ok(town.shops.some((entry) => entry.demo));
      assert.ok(town.posts.some((entry) => !isDatabaseId(entry.authorId)));
      const sample = demoBooks[0].id;
      store.actions.toggleWish(sample);
      const about = store.actions.createPost({
        body: "見本の店で見つけた本。",
        bookId: sample,
      })!;
      // A like for a 見本's post would reach nobody, so it is not kept.
      store.actions.toggleLike(demoPosts[0].id);
      await settled(store);
      const again = (await townOf(eri)).getSnapshot();
      assert.deepEqual(again.wishlist, [sample]);
      assert.equal(
        again.posts.find((entry) => entry.id === about)?.bookId,
        sample,
      );
      assert.deepEqual(again.likedPosts, []);
      // The book's catalog row is shared: another reader keeps it too.
      const other = await townOf(ben);
      other.actions.toggleFavorite(sample);
      await settled(other);
      assert.deepEqual((await townOf(ben)).getSnapshot().favorites, [sample]);
      other.actions.toggleFavorite(sample);
      await settled(other);
      // Others read the post about it, with the 見本's book.
      const seen = (await townOf(aki)).getSnapshot();
      assert.equal(
        seen.posts.find((entry) => entry.id === about)?.bookId,
        sample,
      );
    },
  );

  await check(
    "two devices: what one saved whole is not written over from the other",
    async () => {
      const ota = await reader("ota");
      const first = await townOf(ota);
      first.actions.createShop("二台の本屋", "", "sage");
      await settled(first);
      const phone = await townOf(ota);
      const laptop = await townOf(ota);
      const sample = demoBooks[0].id;
      laptop.actions.addShelf("ノートの棚");
      laptop.actions.updateNine([sample], { [sample]: "ノートで書いた" });
      await settled(laptop);
      phone.actions.addShelf("電話の棚");
      phone.actions.updateNine([sample], { [sample]: "電話で書いた" });
      await settled(phone, "recovered");
      // The database keeps the laptop's, and the phone shows it.
      const kept = await admin
        .from("shop_private")
        .select("shelves, shelves_version, shops!inner(owner_id)")
        .eq("shops.owner_id", ota.id)
        .single();
      assert.ifError(kept.error);
      assert.deepEqual(
        (kept.data.shelves as { name: string }[]).map((shelf) => shelf.name),
        ["はじめの棚", "ノートの棚"],
      );
      assert.ok(kept.data.shelves_version > 0);
      const town = phone.getSnapshot();
      assert.deepEqual(
        town.ownShop?.shelves.map((shelf) => shelf.name),
        ["はじめの棚", "ノートの棚"],
      );
      assert.deepEqual(town.me.nineNotes, { [sample]: "ノートで書いた" });
      // Read again, the phone's next change goes in.
      phone.actions.addShelf("電話の棚");
      await settled(phone);
      assert.deepEqual(
        (await townOf(ota))
          .getSnapshot()
          .ownShop?.shelves.map((shelf) => shelf.name),
        ["はじめの棚", "ノートの棚", "電話の棚"],
      );
    },
  );

  await check(
    "the scene and a poster are refused over another version, and a poster made twice at once is one",
    async () => {
      const uno = await reader("uno");
      const town = await townOf(uno);
      town.actions.createShop("飾りの本屋", "", "sage");
      await settled(town);
      const shop = await uno.client
        .from("shops")
        .select("id")
        .eq("owner_id", uno.id)
        .single();
      assert.ifError(shop.error);
      const scene = await uno.client.rpc("save_scene", {
        shop: shop.data.id,
        value: { objects: [] },
        base: 5,
      });
      assert.equal(scene.error?.code, "PT409");
      assert.equal(scene.status, 409);
      // Sent twice at once (a try whose answer seemed lost, and the next):
      // one poster, and both told it is at version 0.
      const value = {
        template: "text",
        theme: "kinari",
        font: "mincho",
        pages: [{ blocks: [{ type: "text", text: "二度送る" }] }],
        spoiler: false,
        show_in_timeline: false,
        status: "draft",
      };
      for (let round = 0; round < 5; round++) {
        const id = crypto.randomUUID();
        const answers = await Promise.all(
          [0, 1].map(() =>
            uno.client.rpc("save_poster", { poster: id, value }),
          ),
        );
        for (const answer of answers) {
          assert.ifError(answer.error);
          assert.equal(answer.data, 0);
        }
        const over = await uno.client.rpc("save_poster", {
          poster: id,
          value: { ...value, theme: "navy" },
          base: 3,
        });
        assert.equal(over.error?.code, "PT409");
        assert.equal(over.status, 409);
      }
      const made = await admin
        .from("posters")
        .select("id")
        .eq("author_id", uno.id);
      assert.equal(made.data?.length, 5);
    },
  );

  await check(
    "another reader sees the public shelf and never the private one",
    async () => {
      const benStore = await townOf(ben);
      const town = benStore.getSnapshot();
      const shop = town.shops.find((entry) => entry.id === akiShopId);
      assert.ok(shop, "Aki's shop is in Ben's town");
      assert.equal(shop.ownerId, aki.id);
      assert.deepEqual(
        shop.shelves.map((shelf) => shelf.name),
        ["はじめの棚"],
      );
      // Aki's nine comes with her profile's page, not with the town.
      assert.deepEqual(
        town.readers.find((entry) => entry.id === aki.id)?.lifeNine,
        [],
      );
      const onHerPage = await townWith(benStore, { reader: aki.id });
      const akiInTown = onHerPage.readers.find((entry) => entry.id === aki.id);
      assert.deepEqual(akiInTown?.lifeNine, [bookId]);
      assert.equal(
        town.posts.find((entry) => entry.id === postId)?.authorId,
        aki.id,
      );
      // The 見本 readers read alongside; only real readers are counted here.
      assert.deepEqual(
        town.readingNow
          .map((entry) => entry.readerId)
          .filter((id) => isDatabaseId(id)),
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
    // Pressed three times: one row, counted three.
    actions.tapLike(postId);
    actions.tapLike(postId);
    actions.tapLike(postId);
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
    assert.deepEqual(benAgain.likeTaps, { [postId]: 3 });
    assert.deepEqual(benAgain.wantedPosts, [postId]);
    // The book Aki typed in stays hers: Ben wants his own copy of it
    // (own-books.ts), which his town tells apart as his.
    assert.equal(benAgain.wishlist.length, 1);
    assert.notEqual(benAgain.wishlist[0], bookId);
    assert.equal(
      bookById(benAgain.books, benAgain.wishlist[0])?.copyOf,
      bookId,
    );
    assert.equal(bookById(benAgain.books, bookId)?.theirs, true);
    assert.equal(mine(benAgain, bookId), benAgain.wishlist[0]);
    assert.equal(Object.values(benAgain.popReactions)[0]?.[0], "love");

    const akiAgain = (await townOf(aki)).getSnapshot();
    assert.equal(akiAgain.ownShop?.followers, 1);
    const post = akiAgain.posts.find((entry) => entry.id === postId);
    assert.equal(post?.likes, 1);
    assert.deepEqual(
      post?.likers?.map((liker) => liker.taps),
      [3],
    );
    assert.equal(post?.wants, 1);
    assert.ok(
      notificationsFor(akiAgain).some(
        (notice) =>
          // Three taps by one reader: one notice, one reader.
          notice.id.startsWith(`likes:${postId}@`) &&
          notice.text.includes("さんがあなたの便りにいいねしました"),
      ),
    );
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
      assert.deepEqual(
        (await townOf(ben))
          .getSnapshot()
          .readingNow.filter((entry) => isDatabaseId(entry.readerId)),
        [],
      );
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

      const benWalk = await walkOf(ben);
      // Read when walked to (AUD-006).
      assert.ok(benWalk.getSnapshot().unread.has(akiShopId));
      await benWalk.need([akiShopId]);
      const visitor = benWalk.getSnapshot();
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
      await walk.need([akiShopId]);
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
      // Aki hears how many stopped by only once the database has counted
      // the week (Monday 00:00 in Japan), and never who: not yet.
      const asked = await aki.client.rpc("shop_visitors");
      assert.ifError(asked.error);
      assert.deepEqual(asked.data, []);
      assert.equal(akiTown.ownShop?.weekVisitors, undefined);
      assert.ok(
        !notificationsFor(akiTown).some((notice) =>
          notice.id.startsWith("visitors:"),
        ),
      );
      const benAsked = await ben.client.rpc("shop_visitors");
      assert.ifError(benAsked.error);
      assert.deepEqual(benAsked.data, []);
      // Once the week is counted, the answer has the shape PostgREST sends
      // (this test cannot run the weekly count itself): Aki's town carries
      // it to her shop and to one notice for that week.
      const counted = createClient<Database>(API_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            new URL(input instanceof Request ? input.url : input).pathname ===
            "/rest/v1/rpc/shop_visitors"
              ? Promise.resolve(
                  new Response(
                    JSON.stringify([
                      { visitors: 2, week_end: "2026-10-18T15:00:00+00:00" },
                    ]),
                    { headers: { "content-type": "application/json" } },
                  ),
                )
              : fetch(input, init),
        },
      });
      const akiSession = (await aki.client.auth.getSession()).data.session!;
      assert.ifError(
        (
          await counted.auth.setSession({
            access_token: akiSession.access_token,
            refresh_token: akiSession.refresh_token,
          })
        ).error,
      );
      const countedTown = (
        await townOf({ id: aki.id, client: counted })
      ).getSnapshot();
      assert.deepEqual(countedTown.ownShop?.weekVisitors, {
        count: 2,
        at: "2026-10-18T15:00:00+00:00",
      });
      assert.deepEqual(
        notificationsFor(countedTown)
          .filter((notice) => notice.id.startsWith("visitors:"))
          .map((notice) => [notice.id, notice.text]),
        [["visitors:2026-10-19", "先週、2人があなたの書店に立ち寄りました"]],
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
        ["はじめの棚"],
      );
      // The books the visitor sees used come with them: the shelf's, and,
      // on Aki's page, the nine's, read as Aki typed them in.
      const onHerPage = await townWith(store, { reader: aki.id });
      const titles = new Map(
        onHerPage.books.map((entry) => [entry.id, entry.title]),
      );
      assert.deepEqual(
        shop?.shelves[0].items.map((item) => titles.get(item.bookId)),
        ["華氏451度"],
      );
      assert.deepEqual(
        onHerPage.readers.find((entry) => entry.id === aki.id)?.lifeNine,
        [bookId],
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
      await walk.need([akiShopId]);
      const scene = walk
        .getSnapshot()
        .scenes.find((entry) => entry.storeId === akiShopId);
      assert.ok(scene, "Aki's scene is on the visitor's walk");
      // The walk takes its books from the town: each one in the scene is there.
      const placed = scene.objects.flatMap((object) =>
        object.kind === "book" && object.bookId ? [object.bookId] : [],
      );
      assert.ok(placed.length > 0, "the scene shows a book");
      assert.deepEqual(
        [...new Set(placed.map((id) => titles.get(id)))],
        ["華氏451度"],
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

  await check(
    "a reading record is kept, and only a public one reaches others",
    async () => {
      const store = await townOf(aki);
      store.actions.setVisibility("records", "everyone");
      const shared = store.actions.recordReading({
        bookId,
        feelings: ["talk", "quiet"],
        note: "誰かと話したい。",
        spoiler: false,
        audience: "everyone",
      });
      const secret = store.actions.recordReading({
        bookId,
        feelings: ["cried"],
        note: "",
        spoiler: false,
        audience: "private",
      });
      assert.ok(shared && secret);
      await settled(store);

      const akiAgain = (await townOf(aki)).getSnapshot();
      assert.equal(akiAgain.settings.visibility.records.audience, "everyone");
      const own = akiAgain.readingRecords.filter(
        (record) => record.readerId === ME_ID,
      );
      assert.deepEqual(
        own.map((record) => record.id).sort(),
        [shared, secret].sort(),
      );
      assert.deepEqual(own.find((record) => record.id === shared)?.feelings, [
        "quiet",
        "talk",
      ]);

      const fromBen = async () =>
        (await townOf(ben))
          .getSnapshot()
          .readingRecords.filter((record) => record.readerId === aki.id)
          .map((record) => record.id);
      assert.deepEqual(await fromBen(), [shared]);

      const akiStore = await townOf(aki);
      akiStore.actions.updateRecord(secret, { audience: "everyone" });
      akiStore.actions.deleteRecord(shared);
      await settled(akiStore);
      assert.deepEqual(await fromBen(), [secret]);

      // The search's feelings and a feeling's books, asked of the database
      // (felt_in_town, feeling_records), and a book found by its title
      // (find_books).
      const benStore = await townOf(ben);
      assert.ok(
        (await townWith(benStore, { felt: true })).feltInTown?.includes(
          "cried",
        ),
      );
      const cried = await townWith(benStore, { feeling: "cried" });
      assert.ok(cried.readingRecords.some((record) => record.id === secret));
      await benStore.more({ search: "華氏" });
      assert.ok(
        benStore
          .getMore(moreKey({ search: "華氏" }))
          ?.books.some((book) => book.id === bookId),
        "華氏451度 found by the database",
      );
    },
  );

  await check(
    "a poster is put up for everyone, and a draft stays with its maker",
    async () => {
      const store = await townOf(aki);
      const look = { theme: "navy", font: "mincho" } as const;
      const draft = store.actions.savePoster({
        template: "one_book",
        ...look,
        pages: [{ heading: "", text: "ずっと手元に。", bookIds: [bookId] }],
        spoiler: false,
        inTimeline: true,
        status: "draft",
      });
      // A 見本's book goes on a poster too, under its database id.
      const lineup = store.actions.savePoster({
        template: "lineup",
        ...look,
        pages: [
          {
            heading: "夜の本",
            text: "",
            bookIds: [bookId, demoBooks[0].id],
          },
        ],
        spoiler: false,
        inTimeline: true,
        status: "published",
      });
      assert.ok(draft && lineup);
      await settled(store);

      const postersOf = async (person: typeof aki) =>
        (await townOf(person))
          .getSnapshot()
          .posters.filter((poster) => isDatabaseId(poster.id))
          .map((poster) => [poster.id, poster.status]);
      assert.deepEqual(
        (await postersOf(aki)).sort(),
        [
          [draft, "draft"],
          [lineup, "published"],
        ].sort(),
      );
      assert.deepEqual(await postersOf(ben), [[lineup, "published"]]);
      const fromBen = (await townOf(ben))
        .getSnapshot()
        .posters.find((poster) => poster.id === lineup);
      assert.deepEqual(fromBen?.pages[0].bookIds, [bookId, demoBooks[0].id]);
      assert.equal(fromBen?.authorId, aki.id);

      const again = await townOf(aki);
      const kept = again
        .getSnapshot()
        .posters.find((poster) => poster.id === draft)!;
      assert.equal(
        again.actions.savePoster({ ...kept, status: "published" }, draft),
        draft,
      );
      again.actions.deletePoster(lineup);
      await settled(again);
      assert.deepEqual(await postersOf(ben), [[draft, "published"]]);

      // An insert tried again after it had landed still carries the edits
      // made since (its first answer was lost on the way back).
      const row = {
        id: draft!,
        author_id: aki.id,
        template: "text",
        theme: "sumi",
        font: "gothic",
        pages: [{ blocks: [{ type: "text" as const, text: "書き直した。" }] }],
        spoiler: false,
        show_in_timeline: false,
        status: "published",
      };
      await applyWrite(
        aki.client,
        { kind: "posters", rows: [row] },
        { userId: aki.id, shopId: aki.id },
      );
      const changed = await aki.client
        .from("posters")
        .select("template, theme, font, pages")
        .eq("id", draft!)
        .single();
      assert.deepEqual(changed.data, {
        template: "text",
        theme: "sumi",
        font: "gothic",
        pages: row.pages,
      });
    },
  );

  await check(
    "reports from new accounts made together fold nothing; the reporter hears only how far it got",
    async () => {
      const carol = await reader("carol");
      const dan = await reader("dan");
      const eve = await reader("eve");
      const row = await ben.client
        .from("posts")
        .insert({ author_id: ben.id, body: "この本、いまなら半額です" })
        .select("id")
        .single();
      assert.ifError(row.error);
      const target = { kind: "post" as const, id: row.data.id };
      const key = reviewKey("post", target.id);
      const seenBy = async (person: { id: string; client: Client }) =>
        (await townOf(person))
          .getSnapshot()
          .posts.some((entry) => entry.id === target.id);
      for (const person of [aki, carol, dan]) {
        const sent = await fileReport(
          person.client,
          person.id,
          target,
          "spam",
          "",
        );
        assert.equal(sent.result, "sent");
        assert.equal(sent.result === "sent" && sent.report.status, "open");
      }
      assert.equal(
        (await fileReport(aki.client, aki.id, target, "spam", "二度目")).result,
        "already",
      );
      // Accounts this new, made the same day, weigh one person at most: the
      // post is neither hidden nor folded, for its writer or anyone else.
      const others = (await townOf(eve)).getSnapshot();
      assert.ok(others.posts.some((entry) => entry.id === target.id));
      assert.equal(others.reviewFolds[key], undefined);
      assert.equal(await seenBy(ben), true);
      // The reporter keeps the post, folded as their own report, and never
      // reads what the operator decided about it.
      const mine = (await townOf(aki)).getSnapshot();
      assert.ok(mine.posts.some((entry) => entry.id === target.id));
      const statusOf = async () =>
        (await townOf(aki))
          .getSnapshot()
          .myReports.find((entry) => entry.targetId === target.id)?.status;
      assert.equal(await statusOf(), "open");
      const secret = await aki.client
        .from("reports")
        .select("status")
        .eq("target_id", target.id);
      assert.ok(secret.error, "a reporter cannot read the decision");
      for (const [status, heard] of [
        ["checking", "checking"],
        ["dismissed", "checked"],
      ] as const) {
        const changed = await admin
          .from("reports")
          .update({ status })
          .eq("target_id", target.id);
        assert.ifError(changed.error);
        assert.equal(await statusOf(), heard);
      }
      // Only the operator hides a post outright; its writer still sees it.
      const hidden = await admin
        .from("moderation_hides")
        .insert({ target_kind: "post", target_id: target.id });
      assert.ifError(hidden.error);
      assert.equal(await seenBy(eve), false);
      assert.equal(await seenBy(ben), true);
    },
  );

  await check(
    "only staff leave site notes, and who is staff is never served",
    async () => {
      // No one here is staff: CI's database starts with no accounts.
      const asked = await aki.client.rpc("can_annotate");
      assert.ifError(asked.error);
      assert.equal(asked.data, false);
      const notes = await aki.client.from("site_notes").select("id");
      assert.ifError(notes.error);
      assert.deepEqual(notes.data, []);
      const left = await aki.client.from("site_notes").insert({
        page: "/",
        x: 1,
        y: 1,
        viewport_w: 390,
        viewport_h: 844,
        scroll_y: 0,
        body: "注釈",
      });
      assert.equal(left.error?.code, "42501");
      const visitor = newClient();
      assert.ok((await visitor.rpc("can_annotate")).error);
      assert.ok((await visitor.from("site_notes").select("id")).error);
      // The private schema is not served by the API, to anyone.
      for (const client of [aki.client, visitor]) {
        const staff = await (client as unknown as SupabaseClient)
          .schema("private")
          .from("staff")
          .select();
        assert.ok(staff.error, "private.staff must not be served");
      }
      // The screen's question for a page's notes, as the real API reads it.
      // The operator's key is let past row level security, so it stands in
      // for a staff member here.
      const odd = "/shops/a.b(c)+%_[1]$,x/";
      const pages = [odd, odd + "?id=1", odd + "#shop", odd + "more/", "/"];
      const placed = await admin
        .from("site_notes")
        .insert(
          pages.map((page) => ({
            user_id: aki.id,
            page,
            x: 1,
            y: 1,
            viewport_w: 390,
            viewport_h: 844,
            scroll_y: 0,
            body: "注釈",
          })),
        )
        .select("id");
      assert.ifError(placed.error);
      const found = await loadOpenNotes(admin as unknown as Client, odd);
      assert.deepEqual(found.map((note) => note.page).sort(), [
        odd,
        odd + "#shop",
        odd + "?id=1",
      ]);
      const cleared = await admin
        .from("site_notes")
        .delete()
        .in(
          "id",
          placed.data!.map((row) => row.id),
        );
      assert.ifError(cleared.error);
      // To anyone else, the same question is simply answered with nothing.
      assert.deepEqual(await loadOpenNotes(aki.client, odd), []);
    },
  );

  await check(
    "a book one reader only scanned reaches nobody else until it is shown",
    async () => {
      const store = await townOf(ben);
      const scanned = store.actions.addBook({
        title: "砂の器",
        author: "松本清張",
      })!;
      assert.match(scanned, /^[0-9a-f-]{36}$/);
      await settled(store);
      /** The title as the API, Aki's town and a visitor's town give it. */
      const seen = async () => {
        const row = await newClient()
          .from("books")
          .select("title")
          .eq("id", scanned);
        assert.ifError(row.error);
        const visitor = createTownStore(visitorTownBackend(newClient()));
        visitor.initialize();
        await settled(visitor);
        const title = (town: { books: { id: string; title: string }[] }) =>
          town.books.find((entry) => entry.id === scanned)?.title ?? null;
        return [
          row.data[0]?.title ?? null,
          title((await townOf(aki)).getSnapshot()),
          title(visitor.getSnapshot()),
        ];
      };
      assert.deepEqual(await seen(), [null, null, null]);
      const fromAki = await aki.client
        .from("books")
        .select("title")
        .eq("id", scanned);
      assert.ifError(fromAki.error);
      assert.deepEqual(fromAki.data, []);
      const own = (await townOf(ben)).getSnapshot();
      assert.ok(own.library.includes(scanned));
      assert.equal(
        own.books.find((entry) => entry.id === scanned)?.title,
        "砂の器",
      );
      // The questions the policy asks are not served by the API.
      for (const client of [ben.client, newClient()])
        assert.ok(
          (
            await (client as unknown as SupabaseClient)
              .schema("private")
              .rpc("book_is_mine", { b: scanned })
          ).error,
        );

      // On the public shelf of Ben's new shop, which opens at once, it reaches
      // everyone; moved to a private shelf, it is Ben's alone again.
      const shop = await townOf(ben);
      shop.actions.createShop("ベンの本屋", "", "sage");
      const shelf = shop.getSnapshot().ownShop!.shelves[0].id;
      assert.equal(shop.actions.addShelfBook(shelf, scanned, "face"), true);
      await settled(shop);
      assert.deepEqual(await seen(), ["砂の器", "砂の器", "砂の器"]);
      shop.actions.updateShelf(shelf, { isPublic: false });
      await settled(shop);
      assert.deepEqual(await seen(), [null, null, null]);
      const again = (await townOf(ben)).getSnapshot();
      assert.deepEqual(
        again.ownShop?.shelves[0].items.map((item) => item.bookId),
        [scanned],
      );
      assert.equal(
        again.books.find((entry) => entry.id === scanned)?.title,
        "砂の器",
      );
    },
  );

  await check(
    "a 見本's book is kept by a reader who cannot read its row",
    async () => {
      // demoBooks[0] is in Eri's post; this one is only ever wished for, so
      // its row, written by the first reader, is not shown to anyone else.
      const sample = demoBooks[1].id;
      const first = await reader("fay");
      const second = await reader("gus");
      const wish = async (person: typeof first) => {
        const store = await townOf(person);
        store.actions.toggleWish(sample);
        await settled(store);
        assert.deepEqual((await townOf(person)).getSnapshot().wishlist, [
          sample,
        ]);
      };
      await wish(first);
      const row = await second.client
        .from("books")
        .select("id")
        .eq("id", sampleBookRowId(sample));
      assert.ifError(row.error);
      assert.deepEqual(row.data, []);
      await wish(second);
      // Signed out, the row is not read either, and the town still shows the
      // 見本's book, from the app's own copy.
      const anonymous = await newClient()
        .from("books")
        .select("id")
        .eq("id", sampleBookRowId(sample));
      assert.ifError(anonymous.error);
      assert.deepEqual(anonymous.data, []);
      const visitor = createTownStore(visitorTownBackend(newClient()));
      visitor.initialize();
      await settled(visitor);
      assert.equal(
        visitor.getSnapshot().books.find((entry) => entry.id === sample)?.title,
        demoBooks[1].title,
      );
    },
  );

  await check(
    "an app without the library has its marks copied to the reader's rows, and the app that knows it writes its own",
    async () => {
      const lia = await reader("lia");
      // The app that knows the library sends this header with every request.
      const knowing = createClient<Database>(API_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-booktown-library": "1" } },
      });
      const session = (await lia.client.auth.getSession()).data.session!;
      assert.ifError(
        (
          await knowing.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
        ).error,
      );
      const [old, known] = [crypto.randomUUID(), crypto.randomUUID()];
      assert.ifError(
        // Lia's own, as a reader's rows name their own books.
        (
          await admin.from("books").insert([
            { id: old, title: "古いアプリの本", created_by: lia.id },
            { id: known, title: "新しいアプリの本", created_by: lia.id },
          ])
        ).error,
      );
      const rowOf = async (id: string) => {
        const row = await lia.client
          .from("library_entries")
          .select("source, wanted_at, removed_at, updated_at")
          .eq("book_id", id);
        assert.ifError(row.error);
        return row.data[0] ?? null;
      };
      const wish = (client: Client, book_id: string) =>
        client
          .from("book_marks")
          .insert({ user_id: lia.id, book_id, kind: "wish" })
          .select("created_at")
          .single();
      const unwish = (client: Client, book_id: string) =>
        client
          .from("book_marks")
          .delete()
          .eq("user_id", lia.id)
          .eq("book_id", book_id)
          .eq("kind", "wish");
      // An old app's 読みたい makes the row, wanted since the mark.
      const wished = await wish(lia.client, old);
      assert.ifError(wished.error);
      const copied = await rowOf(old);
      assert.equal(copied?.source, "legacy");
      assert.equal(
        Date.parse(copied!.wanted_at!),
        Date.parse(wished.data.created_at),
      );
      // The knowing app's marks change no row, not even its time.
      assert.ifError((await wish(knowing, known)).error);
      assert.equal(await rowOf(known), null);
      assert.ifError((await unwish(knowing, old)).error);
      assert.deepEqual(await rowOf(old), copied);
      // The old app's taking it back takes the row, wanted and nothing else, out.
      assert.ifError((await wish(lia.client, old)).error);
      assert.ifError((await unwish(lia.client, old)).error);
      const out = await rowOf(old);
      assert.equal(out?.wanted_at, null);
      assert.ok(out?.removed_at);
    },
  );

  await check(
    "the library is its reader's alone through the API, and is written as the app writes it",
    async () => {
      const noa = await reader("noa");
      const untyped = (client: Client) => client as unknown as SupabaseClient;
      const books = [1, 2, 3].map(() => crypto.randomUUID());
      assert.ifError(
        (
          await admin.from("books").insert(
            books.map((id, n) => ({
              id,
              title: `ノアの本 ${n + 1}`,
              created_by: noa.id,
            })),
          )
        ).error,
      );
      const entry = (book_id: string) => ({
        user_id: noa.id,
        book_id,
        status: null,
        status_at: null,
        wanted_at: null,
        liked_at: null,
        owned: null,
        source: "scan",
        batch_id: null,
        added_at: new Date().toISOString(),
        removed_at: null,
        like_restored: false,
        ever_used: false,
      });
      // New rows, inserted ignoring duplicates: sent again, none is new.
      for (const expected of [3, 0]) {
        const saved = await noa.client
          .from("library_entries")
          .upsert(books.map(entry), {
            onConflict: "user_id,book_id",
            ignoreDuplicates: true,
          })
          .select("book_id");
        assert.ifError(saved.error);
        assert.equal(saved.data.length, expected);
      }
      // The columns changed, for several books at once.
      const finished = await noa.client
        .from("library_entries")
        .update({ status: "finished", status_at: new Date().toISOString() })
        .eq("user_id", noa.id)
        .in("book_id", books)
        .select("book_id");
      assert.ifError(finished.error);
      assert.equal(finished.data.length, 3);
      // Only the columns granted change, and a partial upsert is refused.
      assert.equal(
        (
          await noa.client
            .from("library_entries")
            .update({ source: "isbn" })
            .eq("user_id", noa.id)
        ).error?.code,
        "42501",
      );
      assert.ok(
        (
          await untyped(noa.client)
            .from("library_entries")
            .upsert({ user_id: noa.id, book_id: books[0], status: "reading" })
        ).error,
      );
      // A shelf made and renamed; books put on it and one taken off. The
      // shelf books' default upsert would update columns that may not be.
      const shelf = crypto.randomUUID();
      assert.ifError(
        (
          await noa.client.from("library_shelves").insert({
            id: shelf,
            user_id: noa.id,
            name: "旅",
            position: "a0",
          })
        ).error,
      );
      assert.ifError(
        (
          await noa.client
            .from("library_shelves")
            .update({ name: "旅の本" })
            .eq("id", shelf)
            .eq("user_id", noa.id)
        ).error,
      );
      assert.equal(
        (
          await noa.client
            .from("library_shelf_books")
            .upsert({ shelf_id: shelf, user_id: noa.id, book_id: books[0] })
        ).error?.code,
        "42501",
      );
      for (const book_id of books.slice(0, 2))
        assert.ifError(
          (
            await noa.client.from("library_shelf_books").upsert(
              { shelf_id: shelf, user_id: noa.id, book_id },
              {
                onConflict: "user_id,shelf_id,book_id",
                ignoreDuplicates: true,
              },
            )
          ).error,
        );
      const off = await noa.client
        .from("library_shelf_books")
        .delete()
        .eq("user_id", noa.id)
        .eq("shelf_id", shelf)
        .in("book_id", [books[1]])
        .select("book_id");
      assert.ifError(off.error);
      assert.equal(off.data.length, 1);
      // Noa likes Aki's post (a new one: the first was deleted above): whose
      // it was is the post's, whatever is sent, and only the memo and its
      // taking back change afterwards.
      const post = await aki.client
        .from("posts")
        .insert({ author_id: aki.id, body: "炎の色", book_id: bookId })
        .select("id")
        .single();
      assert.ifError(post.error);
      // What Noa met is named by her own copy of the book Aki typed in: a
      // reader's rows name their own books (own-books.ts).
      const noasCopy = crypto.randomUUID();
      assert.ifError(
        (
          await noa.client.rpc("copy_book", {
            original: bookId,
            copy: noasCopy,
          })
        ).error,
      );
      const met = {
        id: crypto.randomUUID(),
        user_id: noa.id,
        book_id: noasCopy,
        kind: "like",
        via: "post",
        post_id: post.data.id,
        other_reader_id: noa.id,
        memo: "炎の色",
        memo_at: new Date().toISOString(),
      };
      assert.ifError(
        (await noa.client.from("book_encounters").insert(met)).error,
      );
      const kept = await noa.client
        .from("book_encounters")
        .select("other_reader_id")
        .eq("id", met.id)
        .single();
      assert.ifError(kept.error);
      assert.equal(kept.data.other_reader_id, aki.id);
      assert.ifError(
        (
          await noa.client
            .from("book_encounters")
            .update({ memo: "炎の色が忘れられない" })
            .eq("id", met.id)
        ).error,
      );
      assert.equal(
        (
          await noa.client
            .from("book_encounters")
            .update({ kind: "want" })
            .eq("id", met.id)
        ).error?.code,
        "42501",
      );
      const nowhere = await noa.client.from("book_encounters").insert({
        ...met,
        id: crypto.randomUUID(),
        post_id: crypto.randomUUID(),
      });
      assert.equal(nowhere.error?.code, "23503");
      assert.equal(nowhere.error?.message, "the post met is not found");
      // Aki deletes her post: the like stays, and sent again (an answer
      // lost) it is taken as saved.
      assert.ifError(
        (await aki.client.from("posts").delete().eq("id", post.data.id)).error,
      );
      const again = await noa.client
        .from("book_encounters")
        .upsert(met, { onConflict: "id", ignoreDuplicates: true })
        .select("post_id, memo");
      assert.ifError(again.error);
      assert.deepEqual(again.data, []);
      const left = await noa.client
        .from("book_encounters")
        .select("post_id, other_reader_id, memo")
        .eq("id", met.id)
        .single();
      assert.ifError(left.error);
      assert.deepEqual(left.data, {
        post_id: null,
        other_reader_id: aki.id,
        memo: "炎の色が忘れられない",
      });
      // Nobody else reads or changes any of it: not Aki, whose post it met,
      // nor Ben, nor anyone signed out.
      for (const table of [
        "library_entries",
        "library_shelves",
        "library_shelf_books",
        "book_encounters",
      ]) {
        for (const client of [aki.client, ben.client]) {
          const seen = await untyped(client)
            .from(table)
            .select("user_id")
            .eq("user_id", noa.id);
          assert.ifError(seen.error);
          assert.deepEqual(seen.data, [], table);
        }
        const anonymous = await untyped(newClient())
          .from(table)
          .select("user_id");
        assert.equal(anonymous.error?.code, "42501", table);
      }
      const theirs = await ben.client
        .from("library_entries")
        .update({ status: "tsundoku" })
        .eq("user_id", noa.id)
        .select("book_id");
      assert.ifError(theirs.error);
      assert.deepEqual(theirs.data, []);

      // Deleting the account (the auth server deletes as supabase_auth_admin)
      // takes all of it along, the marks copied to rows too.
      assert.ifError(
        (
          await noa.client
            .from("book_marks")
            .insert({ user_id: noa.id, book_id: books[2], kind: "favorite" })
        ).error,
      );
      assert.ifError(
        (
          await noa.client
            .from("reader_settings")
            .upsert({ user_id: noa.id, spoiler_display: "show_all" })
        ).error,
      );
      assert.ifError((await admin.auth.admin.deleteUser(noa.id)).error);
      for (const table of [
        "library_entries",
        "library_shelves",
        "library_shelf_books",
        "book_encounters",
        "book_marks",
        "reader_settings",
      ]) {
        const left = await admin
          .from(table)
          .select("user_id", { count: "exact", head: true })
          .eq("user_id", noa.id);
        assert.ifError(left.error);
        assert.equal(left.count, 0, table);
      }
    },
  );

  // Last, as its books fill the newest of the catalog.
  await check(
    "more than 1000 marks are read a page at a time, every one with its book",
    async () => {
      const mio = await reader("mio");
      // Put in as the operator, with ids made here, so no insert has to
      // answer with more rows than the server hands out at once.
      const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
      const books = await admin.from("books").insert(
        ids.map((id, n) => ({
          id,
          title: `読みたい本 ${n + 1}`,
          created_by: mio.id,
        })),
      );
      assert.ifError(books.error);
      const marks = await admin
        .from("book_marks")
        .insert(
          ids.map((book_id) => ({ user_id: mio.id, book_id, kind: "wish" })),
        );
      assert.ifError(marks.error);
      const town = (await townOf(mio)).getSnapshot();
      assert.deepEqual([...town.wishlist].sort(), [...ids].sort());
      const known = new Set(town.books.map((entry) => entry.id));
      assert.ok(ids.every((id) => known.has(id)));
      // They are the newest of the catalog, and only Mio's: nobody else's
      // town reads them.
      const others = (await townOf(aki)).getSnapshot();
      assert.ok(!others.books.some((entry) => ids.includes(entry.id)));
      const anonymous = await newClient()
        .from("books")
        .select("id")
        .in("id", ids.slice(0, 100));
      assert.ifError(anonymous.error);
      assert.deepEqual(anonymous.data, []);
    },
  );

  await check(
    "the app's library is written by the app, and comes back as the reader left it",
    async () => {
      const ren = await reader("ren");
      // The app's own client sends this header (src/lib/supabase/client.ts).
      const client = createClient<Database>(API_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-booktown-library": "1" } },
      });
      const session = (await ren.client.auth.getSession()).data.session!;
      assert.ifError(
        (
          await client.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
        ).error,
      );
      const person = { id: ren.id, client };
      const store = await townOf(person);
      const done = store.actions.registerBook(
        { title: "レンの本", author: "誰か" },
        "manual",
      );
      assert.ok(done && done.result === "added");
      const other = store.actions.registerBook(
        { title: "レンのもう一冊", author: "誰か" },
        "manual",
      );
      assert.ok(other && other.result === "added");
      await settled(store);
      assert.ok(
        store.actions.changeLibrary([done.bookId], {
          status: "tsundoku",
          owned: "yes",
        }),
      );
      store.actions.toggleWish(other.bookId);
      await settled(store);
      store.actions.toggleWish(other.bookId);
      store.actions.toggleLibrary(other.bookId);
      await settled(store);
      const rows = await client
        .from("library_entries")
        .select("book_id, status, owned, source, wanted_at, removed_at")
        .eq("user_id", ren.id);
      assert.ifError(rows.error);
      const row = (id: string) =>
        rows.data.find((entry) => entry.book_id === id);
      // Written by the app, with how the book came in: the database's copy of
      // marks would have said legacy.
      assert.deepEqual(row(done.bookId), {
        book_id: done.bookId,
        status: "tsundoku",
        owned: "yes",
        source: "manual",
        wanted_at: null,
        removed_at: null,
      });
      assert.equal(row(other.bookId)?.wanted_at, null);
      assert.ok(row(other.bookId)?.removed_at);
      const back = (await townOf(person)).getSnapshot();
      assert.equal(back.libraryEntries[done.bookId].status, "tsundoku");
      assert.equal(back.libraryEntries[done.bookId].owned, "yes");
      assert.ok(back.libraryEntries[other.bookId].removedAt);
      assert.ok(!back.wishlist.includes(other.bookId));
      assert.ok(!back.library.includes(other.bookId));
    },
  );

  await check(
    "the reader's own shelves are written as they change, and nobody else reads them",
    async () => {
      const mei = await reader("mei");
      const client = createClient<Database>(API_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-booktown-library": "1" } },
      });
      const session = (await mei.client.auth.getSession()).data.session!;
      assert.ifError(
        (
          await client.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
        ).error,
      );
      const person = { id: mei.id, client };
      const store = await townOf(person);
      const one = store.actions.registerBook(
        { title: "メイの本", author: "誰か" },
        "manual",
      );
      const two = store.actions.registerBook(
        { title: "メイのもう一冊", author: "誰か" },
        "manual",
      );
      assert.ok(one && one.result === "added");
      assert.ok(two && two.result === "added");
      await settled(store);
      const sf = store.actions.makeLibraryShelf("SF", "遠い星の話")!;
      const rain = store.actions.makeLibraryShelf("雨の日", "")!;
      assert.ok(
        store.actions.changeLibrary([one.bookId, two.bookId], { addShelf: sf }),
      );
      store.actions.changeLibrary([one.bookId], { addShelf: rain });
      await settled(store);
      store.actions.editLibraryShelf(sf, { name: "SFと宇宙" });
      store.actions.changeLibrary([two.bookId], { removeShelf: sf });
      store.actions.putAwayLibraryShelf(rain, true);
      await settled(store);
      const back = (await townOf(person)).getSnapshot();
      assert.deepEqual(
        back.libraryShelves
          .map((shelf) => [shelf.name, shelf.note, shelf.deletedAt === null])
          .sort(),
        [
          ["SFと宇宙", "遠い星の話", true],
          ["雨の日", "", false],
        ],
      );
      assert.deepEqual(
        back.libraryShelfBooks
          .map((book) => [book.shelfId, book.bookId])
          .sort(),
        [
          [rain, one.bookId],
          [sf, one.bookId],
        ].sort(),
      );
      // Another reader reads none of it.
      const other = await reader("nao");
      for (const table of ["library_shelves", "library_shelf_books"] as const) {
        const seen = await other.client
          .from(table)
          .select("user_id")
          .eq("user_id", mei.id);
        assert.ifError(seen.error);
        assert.equal(seen.data.length, 0);
      }
    },
  );

  await check(
    "more than 1000 public records reach every reader and visitor, each one",
    async () => {
      const rin = await reader("rin");
      // Rin's records of a book from the catalog, which anyone may read, put
      // in as the operator so no insert answers with more rows than one
      // request holds.
      const book = crypto.randomUUID();
      const catalog = await admin
        .from("books")
        .insert({ id: book, title: "夜の図書館", source: "ndl" });
      assert.ifError(catalog.error);
      const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
      const records = await admin.from("reading_entries").insert(
        ids.map((id) => ({
          id,
          user_id: rin.id,
          book_id: book,
          feelings: ["quiet"],
          is_public: true,
          audience: "everyone",
        })),
      );
      assert.ifError(records.error);
      const rinsIn = (town: TownState) =>
        town.readingRecords
          .filter((record) => record.readerId === rin.id)
          .map((record) => record.id)
          .sort();
      // The town reads a window of others' records; Rin's page reads all
      // of hers, past a page of a thousand.
      assert.deepEqual(
        rinsIn(await townWith(await townOf(ben), { reader: rin.id })),
        [...ids].sort(),
      );
      const visitor = createTownStore(visitorTownBackend(newClient()));
      visitor.initialize();
      await settled(visitor);
      assert.deepEqual(
        rinsIn(await townWith(visitor, { reader: rin.id })),
        [...ids].sort(),
      );
    },
  );

  console.log(passed + " Supabase town checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
