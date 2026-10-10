import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  createMemoryRepository,
  deserializeTown,
  serializeTown,
} from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import {
  bookReviews,
  likeCount,
  repliesOf,
  timelinePosts,
  wantCount,
  wantSources,
} from "../src/lib/social";
import {
  activeSession,
  currentBookId,
  readersNow,
  readingMemos,
  readingTotals,
} from "../src/lib/reading";
import { notificationsFor, unreadCount } from "../src/lib/notifications";
import { normalizeIsbn } from "../src/lib/books";
import { popReactionKey, shelfUsed, type TownState } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

/** Assert the create flow succeeded, rather than suppressing nullable state types. */
function ownShop(state: TownState) {
  assert.ok(state.ownShop, "A shop must be created before editing it");
  return state.ownShop;
}

const repository = createMemoryRepository();
const store = createTownStore(repository);
const { actions } = store;

check("SSR snapshot stays stable without initialization", () => {
  assert.equal(store.getSnapshot(), seedState);
  assert.equal(store.getServerSnapshot(), seedState);
  assert.equal(store.getServerSnapshot(), store.getServerSnapshot());
});

check(
  "all demo shelves respect capacity and support discovery across shops",
  () => {
    seedState.shops.forEach((shop) => {
      assert.ok(shop.shelves.length >= 2);
      shop.shelves.forEach((shelf) =>
        assert.ok(shelfUsed(shelf) <= shelf.capacity),
      );
    });
    const solarisShops = seedState.shops.filter((shop) =>
      shop.shelves.some((shelf) =>
        shelf.items.some((item) => item.bookId === "solaris"),
      ),
    );
    assert.ok(solarisShops.length >= 3);
    const pops = solarisShops.flatMap((shop) =>
      shop.shelves.flatMap((shelf) =>
        shelf.items
          .filter((item) => item.bookId === "solaris")
          .map((item) => item.pop),
      ),
    );
    assert.equal(pops.length, new Set(pops).size);
  },
);

check(
  "shop creation preserves prior snapshots and cannot overwrite an existing shop",
  () => {
    actions.createShop("わたしの店", "説明", "sage");
    assert.equal(ownShop(store.getSnapshot()).id, "mine");
    assert.equal(ownShop(store.getSnapshot()).ownerId, "me");
    assert.equal(seedState.ownShop, null);
    const before = store.getSnapshot();
    actions.createShop("上書きしない", "", "rose");
    assert.equal(store.getSnapshot(), before);
  },
);

actions.addShelf("小さい棚", 3);
const shelfId = ownShop(store.getSnapshot()).shelves[1].id;

check(
  "face display consumes three spaces and over-capacity addition rejects atomically",
  () => {
    assert.equal(actions.addShelfBook(shelfId, "solaris", "face"), true);
    assert.equal(shelfUsed(ownShop(store.getSnapshot()).shelves[1]), 3);
    const before = store.getSnapshot();
    assert.equal(actions.addShelfBook(shelfId, "momo", "spine"), false);
    assert.equal(store.getSnapshot(), before);
  },
);

const firstId = ownShop(store.getSnapshot()).shelves[1].items[0].id;
actions.changeDisplay(shelfId, firstId, "spine");
actions.addShelfBook(shelfId, "momo", "spine");
actions.addShelfBook(shelfId, "night-fog", "spine");

check("over-capacity face conversion leaves the snapshot unchanged", () => {
  const before = store.getSnapshot();
  assert.equal(actions.changeDisplay(shelfId, firstId, "face"), false);
  assert.equal(store.getSnapshot(), before);
  assert.equal(shelfUsed(ownShop(store.getSnapshot()).shelves[1]), 3);
});

check("duplicate and unknown books cannot enter a shelf", () => {
  assert.equal(actions.addShelfBook("mine-shelf-1", "missing", "spine"), false);
  assert.equal(actions.addShelfBook(shelfId, "momo", "spine"), false);
});

check("ordering uses target index and preserves display and POP", () => {
  actions.updatePop(shelfId, firstId, "私のPOP");
  actions.moveShelfBook(shelfId, firstId, 2);
  const items = ownShop(store.getSnapshot()).shelves[1].items;
  assert.deepEqual(
    items.map((item) => item.bookId),
    ["momo", "night-fog", "solaris"],
  );
  assert.equal(items[2].pop, "私のPOP");
  assert.equal(items[2].display, "spine");
});

check("private shelf and edits survive repository reload", () => {
  actions.updateShelf(shelfId, { name: "わたしだけの棚", isPublic: false });
  const reloaded = createTownStore(repository);
  reloaded.initialize();
  assert.deepEqual(reloaded.getSnapshot(), store.getSnapshot());
  assert.equal(ownShop(reloaded.getSnapshot()).shelves[1].isPublic, false);
});

check("profile nine books are normalized and persisted", () => {
  actions.updateNine(
    ["momo", "momo", "missing", ...seedState.books.map((book) => book.id)],
    { momo: "大切な一冊", missing: "消える" },
  );
  const me = store.getSnapshot().me;
  assert.equal(me.lifeNine.length, 9);
  assert.equal(new Set(me.lifeNine).size, 9);
  assert.deepEqual(me.nineNotes, { momo: "大切な一冊" });
  assert.deepEqual(repository.load().state.me, me);
});

check("wishlist and following toggles reject unknown ids", () => {
  actions.toggleWish("solaris");
  actions.toggleWish("missing");
  assert.deepEqual(store.getSnapshot().wishlist, ["solaris"]);
  actions.toggleWish("solaris");
  assert.deepEqual(store.getSnapshot().wishlist, []);
  actions.toggleFollow("shop-orbit");
  actions.toggleFollow("missing");
  assert.deepEqual(store.getSnapshot().following, ["shop-orbit"]);
  actions.toggleFollow("shop-orbit");
  assert.deepEqual(store.getSnapshot().following, []);
});

check("invalid JSON and tampered capacity restore a safe initial state", () => {
  assert.equal(deserializeTown("{bad json").status, "recovered");
  const envelope = JSON.parse(serializeTown(store.getSnapshot())) as {
    data: { ownShop: NonNullable<TownState["ownShop"]> };
  };
  envelope.data.ownShop.shelves[1].capacity = 1;
  const restored = deserializeTown(JSON.stringify(envelope));
  assert.equal(restored.status, "recovered");
  assert.equal(restored.state.ownShop, null);
});

check("write failures remain usable and report unavailable persistence", () => {
  const failing = createTownStore({
    load: () => ({ state: structuredClone(seedState), status: "saved" }),
    save: () => "unavailable",
  });
  failing.actions.toggleWish("momo");
  assert.deepEqual(failing.getSnapshot().wishlist, ["momo"]);
  assert.equal(failing.getPersistenceSnapshot(), "unavailable");
});

check(
  "old saves gain optional fields without losing existing personal data",
  () => {
    const envelope = JSON.parse(serializeTown(store.getSnapshot()));
    delete envelope.data.favorites;
    delete envelope.data.popReactions;
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.deepEqual(loaded.state.ownShop, store.getSnapshot().ownShop);
    assert.deepEqual(loaded.state.me, store.getSnapshot().me);
    assert.deepEqual(loaded.state.favorites, []);
    assert.deepEqual(loaded.state.popReactions, {});
  },
);

check(
  "favorites and POP reactions persist independently and are scoped to the exact shelf item",
  () => {
    const shop = seedState.shops[0],
      shelf = shop.shelves[0],
      item = shelf.items[0];
    const other = seedState.shops.find(
      (entry) =>
        entry.id !== shop.id &&
        entry.shelves.some((s) =>
          s.items.some((i) => i.bookId === item.bookId),
        ),
    )!;
    const otherShelf = other.shelves.find((s) =>
      s.items.some((i) => i.bookId === item.bookId),
    )!;
    const otherItem = otherShelf.items.find((i) => i.bookId === item.bookId)!;
    const key = popReactionKey(shop.id, shelf.id, item.id);
    actions.toggleFavorite("solaris");
    actions.toggleFavorite("missing");
    actions.togglePopReaction(shop.id, shelf.id, item.id, "like");
    actions.togglePopReaction(shop.id, shelf.id, item.id, "read");
    actions.togglePopReaction("missing", shelf.id, item.id, "love");
    assert.deepEqual(store.getSnapshot().favorites, ["solaris"]);
    assert.deepEqual(store.getSnapshot().wishlist, []);
    assert.deepEqual(store.getSnapshot().popReactions[key], ["like", "read"]);
    assert.equal(
      store.getSnapshot().popReactions[
        popReactionKey(other.id, otherShelf.id, otherItem.id)
      ],
      undefined,
    );
    assert.deepEqual(repository.load().state, store.getSnapshot());
    actions.togglePopReaction(shop.id, shelf.id, item.id, "like");
    assert.deepEqual(store.getSnapshot().popReactions[key], ["read"]);
    actions.toggleFavorite("solaris");
    assert.deepEqual(store.getSnapshot().favorites, []);
  },
);

check(
  "invalid optional fields and private reaction targets do not destroy a saved shop",
  () => {
    const before = store.getSnapshot();
    actions.togglePopReaction("mine", shelfId, firstId, "love");
    assert.equal(store.getSnapshot(), before);
    const envelope = JSON.parse(serializeTown(before));
    envelope.data.favorites = ["solaris", "solaris", "unknown", 1];
    envelope.data.popReactions = {
      ...envelope.data.popReactions,
      bad: ["like"],
      [popReactionKey("mine", shelfId, firstId)]: ["love"],
    };
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.deepEqual(loaded.state.ownShop, before.ownShop);
    assert.deepEqual(loaded.state.favorites, ["solaris"]);
    assert.equal(loaded.state.popReactions.bad, undefined);
    assert.equal(
      loaded.state.popReactions[popReactionKey("mine", shelfId, firstId)],
      undefined,
    );
  },
);

check("removing an item clears reactions before its ID can be reused", () => {
  const fresh = createTownStore(createMemoryRepository());
  fresh.actions.createShop("one book", "", "sage");
  const id = "mine-shelf-1";
  fresh.actions.addShelfBook(id, "solaris", "spine");
  const item = ownShop(fresh.getSnapshot()).shelves[0].items[0];
  fresh.actions.togglePopReaction("mine", id, item.id, "like");
  fresh.actions.removeShelfBook(id, item.id);
  fresh.actions.addShelfBook(id, "momo", "spine");
  assert.deepEqual(fresh.getSnapshot().popReactions, {});
});

check(
  "timeline keeps spoilers out and the book page keeps them behind the door",
  () => {
    const timeline = timelinePosts(seedState);
    assert.ok(timeline.length > 0);
    assert.ok(
      timeline.every((post) => !post.spoiler && post.parentId === null),
    );
    for (let i = 1; i < timeline.length; i += 1)
      assert.ok(
        Date.parse(timeline[i - 1].createdAt) >=
          Date.parse(timeline[i].createdAt),
      );
    const leftHand = bookReviews(seedState, "left-hand");
    assert.ok(leftHand.spoilers.some((post) => post.id === "p-7"));
    assert.ok(leftHand.open.every((post) => !post.spoiler));
  },
);

check(
  "posts with a book become reviews; replies continue the conversation",
  () => {
    let clock = Date.parse("2026-10-11T00:00:00Z");
    const fresh = createTownStore(
      createMemoryRepository(),
      () => new Date((clock += 60_000)),
    );
    const daily = fresh.actions.createPost({ body: "  今日は雨。  " });
    const review = fresh.actions.createPost({
      body: "最後まで眠れなかった。",
      bookId: "momo",
    });
    assert.ok(daily && review);
    const state = fresh.getSnapshot();
    assert.equal(
      state.posts.find((post) => post.id === daily)?.body,
      "今日は雨。",
    );
    assert.deepEqual(
      timelinePosts(state)
        .slice(0, 2)
        .map((post) => post.id),
      [review, daily],
    );
    assert.ok(
      bookReviews(state, "momo").open.some((post) => post.id === review),
    );
    const reply = fresh.actions.createPost({
      body: "これが好きなら、こちらも。",
      bookId: "walking",
      parentId: review,
    });
    assert.ok(reply);
    assert.deepEqual(
      repliesOf(fresh.getSnapshot(), review).map((post) => post.id),
      [reply],
    );
    assert.ok(
      !timelinePosts(fresh.getSnapshot()).some((post) => post.id === reply),
    );
    assert.ok(
      !bookReviews(fresh.getSnapshot(), "walking").open.some(
        (post) => post.id === reply,
      ),
    );
  },
);

check("invalid posts are rejected without changing the snapshot", () => {
  const fresh = createTownStore(createMemoryRepository());
  fresh.initialize();
  const before = fresh.getSnapshot();
  assert.equal(fresh.actions.createPost({ body: "   " }), null);
  assert.equal(fresh.actions.createPost({ body: "x".repeat(1001) }), null);
  assert.equal(
    fresh.actions.createPost({ body: "a", bookId: "missing" }),
    null,
  );
  // A top-level spoiler needs a book page to wait on.
  assert.equal(fresh.actions.createPost({ body: "a", spoiler: true }), null);
  assert.equal(
    fresh.actions.createPost({ body: "a", parentId: "missing" }),
    null,
  );
  assert.equal(
    fresh.actions.createPost({ body: "a", parentId: "p-1-r1" }),
    null,
  );
  assert.equal(fresh.getSnapshot(), before);
});

check("spoiler posts and reported posts leave the timeline", () => {
  const fresh = createTownStore(createMemoryRepository());
  const spoiler = fresh.actions.createPost({
    body: "結末で泣いた。",
    bookId: "silence",
    spoiler: true,
  });
  assert.ok(spoiler);
  assert.ok(
    !timelinePosts(fresh.getSnapshot()).some((post) => post.id === spoiler),
  );
  assert.ok(
    bookReviews(fresh.getSnapshot(), "silence").spoilers.some(
      (post) => post.id === spoiler,
    ),
  );
  fresh.actions.toggleSpoilerReport("p-1");
  assert.ok(
    !timelinePosts(fresh.getSnapshot()).some((post) => post.id === "p-1"),
  );
  assert.ok(
    bookReviews(fresh.getSnapshot(), "solaris").spoilers.some(
      (post) => post.id === "p-1",
    ),
  );
  // Own posts and already-marked posts cannot be reported.
  fresh.actions.toggleSpoilerReport(spoiler);
  fresh.actions.toggleSpoilerReport("p-7");
  assert.deepEqual(fresh.getSnapshot().spoilerReports, ["p-1"]);
  fresh.actions.toggleSpoilerReport("p-1");
  assert.ok(
    timelinePosts(fresh.getSnapshot()).some((post) => post.id === "p-1"),
  );
});

check(
  "wanting to read records whose words inspired it and saves the book",
  () => {
    const fresh = createTownStore(createMemoryRepository());
    const base = seedState.posts.find((post) => post.id === "p-3");
    assert.ok(base);
    fresh.actions.toggleWant("p-3");
    fresh.actions.toggleLike("p-3");
    let state = fresh.getSnapshot();
    assert.ok(state.wishlist.includes("traveling-tree"));
    assert.equal(wantCount(state, base), base.wants + 1);
    assert.equal(likeCount(state, base), base.likes + 1);
    assert.deepEqual(
      wantSources(state, "traveling-tree").map((post) => post.authorId),
      ["r-haru"],
    );
    fresh.actions.toggleWant("p-3");
    state = fresh.getSnapshot();
    assert.deepEqual(state.wantedPosts, []);
    assert.ok(state.wishlist.includes("traveling-tree"));
    // Posts without a book, and one's own posts, have nothing to want.
    fresh.actions.toggleWant("p-2");
    const own = fresh.actions.createPost({ body: "再読中", bookId: "solaris" });
    assert.ok(own);
    fresh.actions.toggleWant(own);
    assert.deepEqual(fresh.getSnapshot().wantedPosts, []);
  },
);

check(
  "own posts, replies and reactions survive reload; deleting cascades",
  () => {
    const repo = createMemoryRepository();
    const first = createTownStore(repo);
    const review = first.actions.createPost({
      body: "良かった",
      bookId: "momo",
    });
    assert.ok(review);
    const reply = first.actions.createPost({ body: "追記", parentId: review });
    const demoReply = first.actions.createPost({
      body: "同感です",
      parentId: "p-1",
    });
    assert.ok(reply && demoReply);
    first.actions.toggleLike(review);
    first.actions.toggleWant("p-1");
    first.actions.toggleSpoilerReport("p-6");
    const loaded = repo.load().state;
    assert.deepEqual(
      loaded.posts
        .filter((post) => post.authorId === "me")
        .map((post) => post.id),
      [review, reply, demoReply],
    );
    assert.equal(loaded.posts.length, seedState.posts.length + 3);
    assert.deepEqual(loaded.likedPosts, [review]);
    assert.deepEqual(loaded.wantedPosts, ["p-1"]);
    assert.deepEqual(loaded.spoilerReports, ["p-6"]);

    const second = createTownStore(repo);
    second.actions.deletePost("p-1");
    second.actions.deletePost(review);
    const after = repo.load().state;
    assert.ok(after.posts.some((post) => post.id === "p-1"));
    assert.ok(
      !after.posts.some((post) => post.id === review || post.id === reply),
    );
    assert.ok(after.posts.some((post) => post.id === demoReply));
    assert.deepEqual(after.likedPosts, []);
  },
);

check(
  "tampered stored posts are dropped without losing the rest of the save",
  () => {
    const fresh = createTownStore(createMemoryRepository());
    fresh.actions.createShop("keep me", "", "sage");
    const kept = fresh.actions.createPost({ body: "残る", bookId: "momo" });
    assert.ok(kept);
    const envelope = JSON.parse(serializeTown(fresh.getSnapshot()));
    const valid = envelope.data.posts[0];
    envelope.data.posts.push(
      { ...valid, id: "p-1" },
      { ...valid, id: "me-post-9", authorId: "r-nagi" },
      { ...valid, id: "me-post-10", bookId: "missing" },
      { ...valid, id: "me-post-11", bookId: null, spoiler: true },
      { ...valid, id: "me-post-12", parentId: "missing" },
      { ...valid, id: "me-post-13", body: "   " },
      { ...valid, id: "me-post-14", createdAt: "yesterday" },
      { ...valid, id: "me-post-15", likes: 999 },
    );
    envelope.data.wantedPosts = ["p-2", "missing", kept, "p-1"];
    envelope.data.spoilerReports = ["p-7", "p-6", "p-6"];
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.equal(loaded.state.ownShop?.name, "keep me");
    assert.deepEqual(
      loaded.state.posts
        .filter((post) => post.authorId === "me")
        .map((post) => post.id),
      [kept, "me-post-15"],
    );
    assert.equal(
      loaded.state.posts.find((post) => post.id === "me-post-15")?.likes,
      0,
    );
    assert.deepEqual(loaded.state.wantedPosts, ["p-1"]);
    assert.deepEqual(loaded.state.spoilerReports, ["p-6"]);
  },
);

check("saves from before posts existed load with empty social data", () => {
  const legacy = JSON.parse(serializeTown(seedState));
  delete legacy.data.posts;
  delete legacy.data.likedPosts;
  delete legacy.data.wantedPosts;
  delete legacy.data.spoilerReports;
  const loaded = deserializeTown(JSON.stringify(legacy));
  assert.equal(loaded.status, "saved");
  assert.equal(loaded.state.posts.length, seedState.posts.length);
  assert.deepEqual(loaded.state.likedPosts, []);
});

check("reading sessions time themselves and keep one running at a time", () => {
  let clock = Date.parse("2026-10-11T10:00:00Z");
  const fresh = createTownStore(
    createMemoryRepository(),
    () => new Date(clock),
  );
  assert.equal(fresh.actions.startReading("missing", "solo"), null);
  assert.ok(fresh.actions.startReading("solaris", "together"));
  clock += 25 * 60_000;
  assert.ok(fresh.actions.startReading("momo", "solo"));
  let state = fresh.getSnapshot();
  assert.equal(state.readingSessions.filter((s) => !s.endedAt).length, 1);
  assert.equal(activeSession(state)?.bookId, "momo");
  clock += 5 * 60_000;
  fresh.actions.endReading(true);
  state = fresh.getSnapshot();
  assert.equal(activeSession(state), undefined);
  assert.deepEqual(state.finishedBooks, ["momo"]);
  const totals = readingTotals(state, clock);
  assert.equal(totals.total, 30 * 60);
  assert.equal(totals.byBook.get("solaris"), 25 * 60);
  // The finished book is skipped, so the default returns to the unfinished one.
  assert.equal(currentBookId(state), "solaris");
  fresh.actions.startReading("momo", "solo");
  assert.deepEqual(fresh.getSnapshot().finishedBooks, []);
});

check("reading memos: together is public, solo stays private", () => {
  const fresh = createTownStore(createMemoryRepository());
  assert.equal(
    fresh.actions.createPost({ body: "a", fromReading: true }),
    null,
  );
  fresh.actions.startReading("solaris", "together");
  const shared = fresh.actions.createPost({
    body: "第二章",
    bookId: "momo",
    fromReading: true,
  });
  fresh.actions.endReading(false);
  fresh.actions.startReading("solaris", "solo");
  const note = fresh.actions.createPost({ body: "自分用", fromReading: true });
  assert.ok(shared && note);
  const state = fresh.getSnapshot();
  const posted = state.posts.find((post) => post.id === shared);
  assert.equal(posted?.bookId, "solaris");
  assert.equal(posted?.readingMode, "together");
  assert.ok(timelinePosts(state).some((post) => post.id === shared));
  assert.ok(!timelinePosts(state).some((post) => post.id === note));
  assert.ok(
    !bookReviews(state, "solaris").open.some((post) => post.id === note),
  );
  assert.ok(readingMemos(state, "solaris").some((post) => post.id === note));
  assert.ok(readingMemos(state, "solaris").some((post) => post.id === "p-m1"));
});

check(
  "readers now count demo readers and the viewer only when together",
  () => {
    const fresh = createTownStore(createMemoryRepository());
    const opened = Date.parse("2026-10-11T12:00:00Z");
    assert.equal(readersNow(fresh.getSnapshot(), opened).length, 4);
    fresh.actions.startReading("solaris", "solo");
    assert.equal(readersNow(fresh.getSnapshot(), opened).length, 4);
    fresh.actions.startReading("solaris", "together");
    const now = readersNow(fresh.getSnapshot(), opened);
    assert.equal(now.length, 5);
    assert.equal(now.filter((entry) => entry.bookId === "solaris").length, 3);
  },
);

check("ISBNs are checked and registered books are deduplicated", () => {
  assert.equal(normalizeIsbn("978-4-10-109205-8"), "9784101092058");
  assert.equal(normalizeIsbn("4101092052"), "9784101092058");
  assert.equal(normalizeIsbn("9784101092059"), null);
  const fresh = createTownStore(createMemoryRepository());
  assert.equal(
    fresh.actions.addBook({ title: "x", author: "", isbn: "123" }),
    null,
  );
  assert.equal(fresh.actions.addBook({ title: " ", author: "" }), null);
  const first = fresh.actions.addBook({
    title: "QAの本",
    author: "試験",
    isbn: "4101092052",
  });
  assert.equal(first, "isbn-9784101092058");
  assert.equal(
    fresh.actions.addBook({ title: "別名", author: "", isbn: "9784101092058" }),
    first,
  );
  const manual = fresh.actions.addBook({ title: "手書きの本", author: "" });
  assert.equal(manual, "my-book-1");
  const state = fresh.getSnapshot();
  assert.equal(state.books.length, seedState.books.length + 2);
  assert.deepEqual(state.library, [first, manual]);
  fresh.actions.toggleLibrary(manual);
  assert.deepEqual(fresh.getSnapshot().library, [first]);
});

check("reading, books, settings and seen notices survive reload", () => {
  const repo = createMemoryRepository();
  const first = createTownStore(repo);
  const book = first.actions.addBook({ title: "残る本", author: "誰か" });
  assert.ok(book);
  first.actions.startReading(book, "together");
  first.actions.setComposeIcon("quill");
  first.actions.markNotificationsSeen(["reply:x", "reply:x"]);
  first.actions.createShop("棚", "", "sage");
  first.actions.addShelfBook("mine-shelf-1", book, "face");
  const loaded = repo.load().state;
  assert.equal(
    loaded.books.find((entry) => entry.id === book)?.title,
    "残る本",
  );
  assert.equal(activeSession(loaded)?.bookId, book);
  assert.equal(loaded.settings.composeIcon, "quill");
  assert.deepEqual(loaded.seenNotifications, ["reply:x"]);
  assert.equal(loaded.ownShop?.shelves[0].items[0].bookId, book);
});

check(
  "tampered reading data and books are dropped without losing the save",
  () => {
    const fresh = createTownStore(createMemoryRepository());
    fresh.actions.createShop("keep", "", "sage");
    fresh.actions.startReading("solaris", "solo");
    const envelope = JSON.parse(serializeTown(fresh.getSnapshot()));
    const running = envelope.data.readingSessions[0];
    envelope.data.readingSessions.push(
      { ...running, id: "me-reading-2", startedAt: "2026-10-12T00:00:00Z" },
      { ...running, id: "me-reading-3", bookId: "missing" },
      { ...running, id: "me-reading-4", mode: "public" },
      { ...running, id: "me-reading-5", endedAt: "2000-01-01T00:00:00Z" },
    );
    envelope.data.addedBooks = [
      { id: "isbn-9784101092059", title: "bad check digit", author: "" },
      { id: "solaris", title: "overwrite", author: "" },
      { id: "my-book-1", title: "ok", author: "" },
    ];
    envelope.data.settings = { composeIcon: "rocket" };
    envelope.data.library = ["my-book-1", "missing"];
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.equal(loaded.state.ownShop?.name, "keep");
    assert.deepEqual(
      loaded.state.readingSessions.map((session) => session.id),
      ["me-reading-1", "me-reading-2"],
    );
    assert.equal(
      loaded.state.readingSessions.filter((session) => !session.endedAt).length,
      1,
    );
    assert.deepEqual(
      loaded.state.books.slice(seedState.books.length).map((book) => book.id),
      ["my-book-1"],
    );
    assert.equal(
      loaded.state.books.find((book) => book.id === "solaris")?.title,
      "ソラリス",
    );
    assert.equal(loaded.state.settings.composeIcon, "pen");
    assert.deepEqual(loaded.state.library, ["my-book-1"]);
  },
);

check("notifications come only from what happened in this town", () => {
  const fresh = createTownStore(createMemoryRepository());
  assert.deepEqual(notificationsFor(fresh.getSnapshot()), []);
  fresh.actions.toggleWish("traveling-tree");
  fresh.actions.toggleFollow("shop-orbit");
  const state = fresh.getSnapshot();
  const notices = notificationsFor(state);
  assert.ok(notices.some((notice) => notice.id === "wish:p-3"));
  const orbitOwner = state.shops.find(
    (shop) => shop.id === "shop-orbit",
  )?.ownerId;
  assert.ok(
    notices.some(
      (notice) =>
        notice.id.startsWith("follow:") && notice.readerId === orbitOwner,
    ),
  );
  // Spoilers never become notices.
  assert.ok(!notices.some((notice) => notice.id.endsWith(":p-7")));
  const unread = unreadCount(state);
  assert.ok(unread > 0);
  fresh.actions.markNotificationsSeen(notices.map((notice) => notice.id));
  assert.equal(unreadCount(fresh.getSnapshot()), 0);
});

console.log(`${passed} domain checks passed.`);
