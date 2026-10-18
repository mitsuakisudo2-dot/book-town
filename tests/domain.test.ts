import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  createMemoryRepository,
  deserializeTown,
  serializeTown,
  type RepositorySnapshot,
} from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import { bookById } from "../src/lib/book-name";
import { bookFixOf } from "../src/lib/book-fix-draft";
import { bookWords } from "../src/lib/library-journal";
import {
  counterId,
  unavailableBackend,
  type TownBackend,
} from "../src/lib/town-backend";
import { emptyTown } from "../src/lib/town-remote";
import {
  bookFeelings,
  booksFelt,
  recordNoteView,
  feelingsInTown,
  ownRecordFor,
  recentlyFinished,
  recordsOf,
  talkersOf,
} from "../src/lib/records";
import {
  bookReviews,
  followedTimelinePosts,
  likeCount,
  likesReceived,
  tapsOf,
  repliesOf,
  hasReplies,
  readerPosts,
  reviewFoldOf,
  spoilerViewOf,
  timelinePosts,
  wantCount,
  wantSources,
  wordsFolded,
} from "../src/lib/social";
import {
  activeSession,
  bookToContinue,
  currentBookId,
  formatDuration,
  readersNow,
  readingFeed,
  readingTotals,
} from "../src/lib/reading";
import {
  notificationsFor,
  unreadCount,
  weekOf,
} from "../src/lib/notifications";
import {
  normalizeIsbn,
  bookPath,
  createRegisteredBook,
} from "../src/lib/books";
import { openBdBooks, openBdQuestions } from "../src/lib/openbd";
import {
  extractTags,
  popularTags,
  postsWithTag,
  tagLeftOut,
} from "../src/lib/tags";
import {
  coverHidden,
  coverSelection,
  splitHidden,
  uncoverHidden,
} from "../src/lib/hidden-words";
import {
  createPostDraftStore,
  EMPTY_POST_DRAFT,
  POST_DRAFT_KEY,
} from "../src/lib/post-draft";
import {
  LIKE_TAPS_MAX,
  ME_ID,
  POP_REACTIONS,
  popReactionKey,
  shelfUsed,
  SPOILER_DISPLAYS,
  type FiledReport,
  type Post,
  type SpoilerDisplay,
  type TownState,
} from "../src/lib/types";

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

check("finishing a book keeps how it felt, in the offered order", () => {
  const fresh = createTownStore(createMemoryRepository());
  const id = fresh.actions.recordReading({
    bookId: "momo",
    feelings: ["talk", "cried", "cried"],
    note: "  時間の花  ",
    spoiler: true,
    audience: "everyone",
  });
  assert.ok(id);
  const record = fresh
    .getSnapshot()
    .readingRecords.find((entry) => entry.id === id);
  assert.deepEqual(record?.feelings, ["cried", "talk"]);
  assert.equal(record?.note, "時間の花");
  assert.equal(record?.readerId, "me");
  assert.ok(fresh.getSnapshot().finishedBooks.includes("momo"));
  // A spoiler needs words to hide; an unknown book or a long note is refused.
  fresh.actions.updateRecord(id!, { note: "", audience: "private" });
  const changed = fresh
    .getSnapshot()
    .readingRecords.find((entry) => entry.id === id);
  assert.equal(changed?.spoiler, false);
  assert.equal(changed?.audience, "private");
  assert.equal(
    fresh.actions.recordReading({
      bookId: "no-such-book",
      feelings: [],
      note: "",
      spoiler: false,
      audience: "everyone",
    }),
    null,
  );
  assert.equal(
    fresh.actions.recordReading({
      bookId: "momo",
      feelings: [],
      note: "あ".repeat(256),
      spoiler: false,
      audience: "everyone",
    }),
    null,
  );
  // Only the reader's own records can be changed or removed.
  const demo = fresh
    .getSnapshot()
    .readingRecords.find((entry) => entry.readerId !== "me")!;
  fresh.actions.deleteRecord(demo.id);
  assert.ok(
    fresh.getSnapshot().readingRecords.some((entry) => entry.id === demo.id),
  );
  fresh.actions.deleteRecord(id!);
  assert.ok(
    !fresh.getSnapshot().readingRecords.some((entry) => entry.id === id),
  );
});

check(
  "records and the visibility choice survive a reload, bad ones do not",
  () => {
    const repo = createMemoryRepository();
    const first = createTownStore(repo);
    first.actions.setVisibility("records", "everyone");
    const id = first.actions.recordReading({
      bookId: "solaris",
      feelings: ["quiet"],
      note: "海",
      spoiler: false,
      audience: "private",
    });
    const saved = JSON.parse(serializeTown(first.getSnapshot()));
    assert.ok(
      saved.data.readingRecords.every(
        (entry: { readerId: string }) => entry.readerId === "me",
      ),
    );
    saved.data.readingRecords.push(
      { ...saved.data.readingRecords[0], id: "me-record-99", bookId: "nope" },
      { ...saved.data.readingRecords[0], id: "record-nagi-solaris" },
    );
    const loaded = deserializeTown(JSON.stringify(saved));
    const own = loaded.state.readingRecords.filter(
      (entry) => entry.readerId === "me",
    );
    assert.deepEqual(
      own.map((entry) => [entry.id, entry.feelings, entry.audience]),
      [[id, ["quiet"], "private"]],
    );
    assert.deepEqual(loaded.state.settings.visibility.records, {
      audience: "everyone",
      detail: "content",
    });
  },
);

check("the book page shows feelings as words and who wants to talk", () => {
  const town = createTownStore(createMemoryRepository());
  town.actions.recordReading({
    bookId: "solaris",
    feelings: ["quiet", "talk"],
    note: "",
    spoiler: false,
    audience: "private",
  });
  const state = town.getSnapshot();
  // Demo readers chose quiet, again, talk / sleepless, shaken, talk.
  assert.deepEqual(bookFeelings(state, "solaris"), [
    "talk",
    "quiet",
    "sleepless",
  ]);
  assert.deepEqual(
    talkersOf(state, "solaris").map((reader) => reader.id),
    ["r-haru", "r-nagi"],
  );
  assert.equal(ownRecordFor(state, "solaris")?.audience, "private");
  assert.deepEqual(
    recordsOf(state, "r-nagi").map((entry) => entry.bookId),
    ["solaris"],
  );
});

check("the town's finished books and feelings show without any zero", () => {
  const town = createTownStore(createMemoryRepository());
  const state = town.getSnapshot();
  assert.deepEqual(recentlyFinished(state), [
    "momo",
    "galaxy-railroad",
    "silence",
    "invisible-cities",
    "solaris",
  ]);
  // Only feelings someone kept are offered, in the usual order.
  assert.deepEqual(feelingsInTown(state), [
    "cried",
    "quiet",
    "sleepless",
    "warm",
    "shaken",
    "again",
    "recommend",
    "talk",
    "lingering",
  ]);
  assert.deepEqual(booksFelt(state, "talk"), ["momo", "solaris"]);
  assert.deepEqual(booksFelt(state, "laughed"), []);

  // Finishing a book others finished brings them as notices.
  assert.ok(
    !notificationsFor(state).some((notice) =>
      notice.id.startsWith("finished:"),
    ),
  );
  town.actions.recordReading({
    bookId: "solaris",
    feelings: [],
    note: "",
    spoiler: false,
    audience: "private",
  });
  const finished = notificationsFor(town.getSnapshot()).filter((notice) =>
    notice.id.startsWith("finished:"),
  );
  assert.deepEqual(
    finished.map((notice) => notice.readerId),
    ["r-haru", "r-nagi"],
  );
  assert.match(
    finished[0].text,
    /ソラリス』を読み終えて、誰かと話したいそうです/,
  );
  // The viewer's own record counts for them, even when kept private.
  assert.equal(recentlyFinished(town.getSnapshot())[0], "solaris");
});

check("a visitor is invited to sign in instead of changing the town", () => {
  let invited = 0;
  const saved: TownState[] = [];
  const visitor = createTownStore(
    {
      kind: "visitor",
      newId: counterId,
      load: () => ({ state: structuredClone(seedState), status: "saved" }),
      save: (state) => {
        saved.push(state);
        return "saved";
      },
    },
    undefined,
    { onVisitor: () => (invited += 1) },
  );
  visitor.initialize();
  const before = visitor.getSnapshot();
  visitor.actions.toggleWish("momo");
  visitor.actions.toggleFollow(seedState.shops[0].id);
  assert.equal(visitor.actions.createPost(EMPTY_POST_DRAFT), null);
  assert.equal(
    visitor.actions.changeDisplay("any-shelf", "any-item", "face"),
    false,
  );
  assert.equal(invited, 4);
  assert.equal(visitor.getSnapshot(), before);
  assert.deepEqual(saved, []);
  // Opening the notifications page marks them seen by itself: no invitation.
  visitor.actions.markNotificationsSeen(["any"]);
  assert.equal(invited, 4);
});

check(
  "with an account, a 見本 keeps its books but receives no like or follow",
  () => {
    let refused = 0;
    const saved: TownState[] = [];
    const account = createTownStore(
      {
        kind: "account",
        newId: counterId,
        load: () => ({ state: structuredClone(seedState), status: "saved" }),
        save: (state) => {
          saved.push(state);
          return "saved";
        },
      },
      undefined,
      { onSample: () => (refused += 1) },
    );
    account.initialize();
    const sampleShop = seedState.shops[0];
    const samplePost = seedState.posts.find(
      (post) => post.authorId !== ME_ID && post.bookId,
    )!;
    const before = account.getSnapshot();
    account.actions.toggleFollow(sampleShop.id);
    account.actions.toggleLike(samplePost.id);
    account.actions.toggleSpoilerReport(samplePost.id);
    const item = sampleShop.shelves[0].items[0];
    account.actions.togglePopReaction(
      sampleShop.id,
      sampleShop.shelves[0].id,
      item.id,
      POP_REACTIONS[0],
    );
    assert.equal(
      account.actions.createPost({
        ...EMPTY_POST_DRAFT,
        body: "返信",
        parentId: samplePost.id,
      }),
      null,
    );
    assert.equal(refused, 5);
    assert.equal(account.getSnapshot(), before);
    // Its books are real books: wanting one, or a 見本's post, is kept.
    account.actions.toggleWish(samplePost.bookId!);
    account.actions.toggleWant(samplePost.id);
    assert.equal(refused, 5);
    assert.ok(account.getSnapshot().wishlist.includes(samplePost.bookId!));
    assert.equal(saved.length, 2);
  },
);

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
  "timeline carries spoilers to be covered; the book page keeps them behind the door",
  () => {
    const timeline = timelinePosts(seedState);
    assert.ok(timeline.length > 0);
    assert.ok(timeline.every((post) => post.parentId === null));
    // Spoilers stay on the timeline; the card covers them until the reader taps 表示する.
    assert.ok(timeline.some((post) => post.id === "p-7" && post.spoiler));
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

check(
  "spoiler and reported posts are covered on the timeline and behind the door",
  () => {
    const fresh = createTownStore(createMemoryRepository());
    const spoiler = fresh.actions.createPost({
      body: "結末で泣いた。",
      bookId: "silence",
      spoiler: true,
    });
    assert.ok(spoiler);
    const covered = timelinePosts(fresh.getSnapshot()).find(
      (post) => post.id === spoiler,
    );
    assert.equal(
      covered && spoilerViewOf(fresh.getSnapshot(), covered),
      "folded",
    );
    assert.ok(
      bookReviews(fresh.getSnapshot(), "silence").spoilers.some(
        (post) => post.id === spoiler,
      ),
    );
    fresh.actions.toggleSpoilerReport("p-1");
    const reported = timelinePosts(fresh.getSnapshot()).find(
      (post) => post.id === "p-1",
    );
    assert.equal(
      reported && spoilerViewOf(fresh.getSnapshot(), reported),
      "folded",
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
      bookReviews(fresh.getSnapshot(), "solaris").open.some(
        (post) => post.id === "p-1",
      ),
    );
  },
);

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
  const feed = readingFeed(state);
  assert.ok(feed.some((post) => post.id === note));
  // Everyone's reading posts, whatever book they are on.
  assert.ok(feed.some((post) => post.id === "p-m1"));
  assert.ok(feed.some((post) => post.id === "p-m3"));
  assert.ok(feed.every((post) => post.readingMode !== null));
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

// Registering a book: one way in (registerBook), and what it did, told apart.
{
  const KOKORO = "9784101010137";
  /** An account's town where another reader already brought こころ in. */
  const accountTown = (saves: TownState[] = []) => {
    const town = createTownStore({
      kind: "account",
      newId: counterId,
      load: () => ({
        state: {
          ...structuredClone(seedState),
          books: [
            ...structuredClone(seedState.books),
            createRegisteredBook("their-kokoro", {
              title: "こころ",
              author: "夏目漱石",
              isbn: KOKORO,
            }),
          ],
        },
        status: "saved",
      }),
      save: (state) => {
        saves.push(state);
        return "saved";
      },
    });
    town.initialize();
    return town;
  };

  check(
    "a book is already registered only when it is in the reader's library",
    () => {
      const saves: TownState[] = [];
      const town = accountTown(saves);
      // Only in the town's catalogue: registered as usual, as that book.
      assert.deepEqual(
        town.actions.registerBook(
          { title: "別の題", author: "", isbn: "4101010137" },
          "isbn",
        ),
        { result: "added", bookId: "their-kokoro", title: "こころ" },
      );
      assert.deepEqual(town.getSnapshot().library, ["their-kokoro"]);
      assert.equal(
        town.getSnapshot().books.find((book) => book.id === "their-kokoro")
          ?.title,
        "こころ",
      );
      // In the library: nothing changes, and nothing is saved.
      const before = town.getSnapshot();
      const kept = saves.length;
      assert.deepEqual(
        town.actions.registerBook(
          { title: "こころ", author: "", isbn: KOKORO },
          "scan",
        ),
        { result: "already", bookId: "their-kokoro", title: "こころ" },
      );
      assert.equal(town.getSnapshot(), before);
      assert.equal(saves.length, kept);
      // A new ISBN is a new book; the second time, it is already there.
      const added = town.actions.registerBook(
        { title: "新しい本", author: "", isbn: "9784101092058" },
        "isbn",
      );
      assert.deepEqual(added, {
        result: "added",
        bookId: "isbn-9784101092058",
        title: "新しい本",
      });
      assert.equal(
        town.actions.registerBook(
          { title: "新しい本", author: "", isbn: "978-4-10-109205-8" },
          "isbn",
        )?.result,
        "already",
      );
      // addBook is registerBook by hand, and answers with the book's id.
      assert.equal(
        town.actions.addBook({ title: "", author: "", isbn: KOKORO }),
        null,
      );
      assert.equal(
        town.actions.addBook({ title: "こころ", author: "", isbn: KOKORO }),
        "their-kokoro",
      );
      // Without an ISBN, the same title is never taken for the same book.
      const one = town.actions.registerBook(
        { title: "手書きの本", author: "" },
        "manual",
      );
      const two = town.actions.registerBook(
        { title: "手書きの本", author: "" },
        "manual",
      );
      assert.equal(one?.result, "added");
      assert.equal(two?.result, "added");
      assert.notEqual(
        one?.result === "added" && one.bookId,
        two?.result === "added" && two.bookId,
      );
    },
  );

  check(
    "a book taken out of the library comes back as added, the same book",
    () => {
      // Nothing is kept for a book taken out yet, so there is nothing to
      // restore: "restored" waits for the library to keep status and shelves.
      const town = accountTown();
      const first = town.actions.registerBook(
        { title: "こころ", author: "", isbn: KOKORO },
        "isbn",
      );
      town.actions.toggleLibrary("their-kokoro");
      assert.deepEqual(town.getSnapshot().library, []);
      const books = town.getSnapshot().books.length;
      assert.deepEqual(
        town.actions.registerBook(
          { title: "こころ", author: "", isbn: KOKORO },
          "isbn",
        ),
        first,
      );
      assert.deepEqual(town.getSnapshot().library, ["their-kokoro"]);
      assert.equal(town.getSnapshot().books.length, books);
    },
  );

  check("while the town loads, a book is never said to be registered", () => {
    let saves = 0;
    const loading = createTownStore({
      kind: "account",
      newId: counterId,
      load: () => new Promise(() => {}),
      save: () => {
        saves++;
        return "saved";
      },
    });
    loading.initialize();
    assert.deepEqual(
      loading.actions.registerBook(
        { title: "こころ", author: "", isbn: KOKORO },
        "scan",
      ),
      { result: "not-saved" },
    );
    assert.equal(
      loading.actions.addBook({ title: "手書きの本", author: "" }),
      null,
    );
    assert.deepEqual(loading.getSnapshot().library, []);
    assert.equal(saves, 0);
    // Still checking who is signed in: the demo in this browser is not
    // written to in the meantime either.
    const repo = createMemoryRepository();
    const checking = createTownStore(repo, undefined, { follow: () => {} });
    checking.initialize();
    assert.deepEqual(
      checking.actions.registerBook({ title: "こころ", author: "" }, "manual"),
      { result: "not-saved" },
    );
    assert.deepEqual(repo.load().state.library, []);
  });

  check(
    "when the account could not be read, a book is never said to be registered",
    () => {
      // Nothing is ever written there; the page has to be read again.
      const unread = createTownStore(
        unavailableBackend(structuredClone(seedState)),
      );
      unread.initialize();
      const before = unread.getSnapshot();
      assert.deepEqual(
        unread.actions.registerBook(
          { title: "こころ", author: "", isbn: KOKORO },
          "isbn",
        ),
        { result: "not-saved" },
      );
      assert.equal(
        unread.actions.addBook({ title: "手書きの本", author: "" }),
        null,
      );
      assert.equal(unread.getSnapshot(), before);
      // Only out of reach for now: kept, and sent once it can be.
      const offline = createTownStore({
        kind: "account",
        newId: counterId,
        load: () => ({ state: structuredClone(seedState), status: "saved" }),
        save: () => "unavailable",
      });
      offline.initialize();
      assert.equal(
        offline.actions.registerBook(
          { title: "こころ", author: "", isbn: KOKORO },
          "isbn",
        )?.result,
        "added",
      );
    },
  );

  check("a title or author over 200 characters ends in …", () => {
    const repo = createMemoryRepository();
    const town = createTownStore(repo);
    const done = town.actions.registerBook(
      {
        title: "あ".repeat(250),
        author: "い".repeat(198) + " " + "う".repeat(40),
      },
      "manual",
    );
    assert.equal(done?.result, "added");
    const id = done?.result === "added" ? done.bookId : "";
    // Named as kept, for the screen to say what was registered.
    assert.equal(
      done?.result === "added" && done.title,
      "あ".repeat(199) + "…",
    );
    // Kept through a reload, which keeps no title over 200 characters.
    const book = repo.load().state.books.find((entry) => entry.id === id);
    assert.equal(book?.title, "あ".repeat(199) + "…");
    // A space left at the cut is dropped before the ….
    assert.equal(book?.author, "い".repeat(198) + "…");
    // Exactly 200 is kept whole; a cut never splits a character in two.
    const whole = town.actions.addBook({ title: "え".repeat(200), author: "" });
    assert.equal(
      town.getSnapshot().books.find((entry) => entry.id === whole)?.title,
      "え".repeat(200),
    );
    const wide = town.actions.addBook({ title: "𠮷".repeat(150), author: "" });
    const cut = town
      .getSnapshot()
      .books.find((entry) => entry.id === wide)?.title;
    assert.equal(cut, "𠮷".repeat(99) + "…");
    assert.ok(cut!.length <= 200);
    // Blank is still no title.
    assert.equal(
      town.actions.registerBook({ title: "　 ", author: "" }, "manual"),
      null,
    );
  });

  check(
    "openBD is asked 100 ISBNs at a time, and read with the publisher",
    () => {
      const isbns = Array.from({ length: 250 }, (_, i) => String(i));
      const questions = openBdQuestions(isbns);
      assert.deepEqual(
        questions.map((question) => question.isbns.length),
        [100, 100, 50],
      );
      assert.equal(
        questions[2].url,
        "https://api.openbd.jp/v1/get?isbn=" + isbns.slice(200).join(","),
      );
      const found = openBdBooks(
        [KOKORO, "9784101092058", "9784003101018"],
        [
          {
            summary: {
              title: " こころ ",
              author: "夏目漱石／著",
              publisher: "新潮社",
            },
            onix: {
              ProductSupply: {
                SupplyDetail: { Price: [{ PriceAmount: "400" }] },
              },
            },
          },
          null,
          { summary: { title: "  " } },
        ],
      );
      assert.deepEqual(
        [...found.values()],
        [
          {
            isbn: KOKORO,
            title: "こころ",
            author: "夏目漱石",
            publisher: "新潮社",
            price: 440,
          },
        ],
      );
    },
  );
}

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

check("an owner hears once a week how many stopped by", () => {
  const town = createTownStore(createMemoryRepository());
  town.actions.createShop("夜の本屋", "", "sage");
  const state = town.getSnapshot();
  const visitors = (count: number, at: string): TownState => ({
    ...state,
    ownShop: { ...state.ownShop!, weekVisitors: { count, at } },
  });
  assert.ok(
    !notificationsFor(state).some((notice) =>
      notice.id.startsWith("visitors:"),
    ),
  );
  // Last week's number, settled when the week ended (Monday 00:00 in Japan).
  const [notice] = notificationsFor(visitors(3, "2026-10-11T15:00:00Z")).filter(
    (entry) => entry.id.startsWith("visitors:"),
  );
  assert.equal(notice.text, "先週、3人があなたの本屋に立ち寄りました");
  // One notice for each week (Monday to Sunday, Japan time).
  assert.equal(notice.id, "visitors:2026-10-12");
  assert.equal(weekOf("2026-10-11T15:30:00Z"), "2026-10-12");
  assert.equal(weekOf("2026-10-11T14:30:00Z"), "2026-10-05");
});

check("reading can start without a book", () => {
  const fresh = createTownStore(createMemoryRepository());
  assert.ok(fresh.actions.startReading(null, "together"));
  const memo = fresh.actions.createPost({
    body: "なんとなく開いた",
    fromReading: true,
  });
  assert.ok(memo);
  // Without a book there is nothing to hide a spoiler behind.
  assert.equal(
    fresh.actions.createPost({ body: "x", spoiler: true, fromReading: true }),
    null,
  );
  let state = fresh.getSnapshot();
  assert.equal(state.posts.find((post) => post.id === memo)?.bookId, null);
  assert.ok(timelinePosts(state).some((post) => post.id === memo));
  assert.equal(readersNow(state, Date.now())[0].bookId, null);
  fresh.actions.endReading(true);
  state = fresh.getSnapshot();
  assert.deepEqual(state.finishedBooks, []);
  assert.equal(currentBookId(state), null);
  const reloaded = deserializeTown(serializeTown(state)).state;
  assert.equal(reloaded.readingSessions[0].bookId, null);
  assert.ok(reloaded.posts.some((post) => post.id === memo));
});

check("profile links keep only web pages, up to five", () => {
  const fresh = createTownStore(createMemoryRepository());
  fresh.actions.updateProfile("あなた", "", [
    "note.com/reader",
    "javascript:alert(1)",
    "https://www.youtube.com/@reader",
    "https://note.com/reader",
    "ftp://example.com",
    "localhost",
  ]);
  let me = fresh.getSnapshot().me;
  assert.deepEqual(me.links, [
    "https://note.com/reader",
    "https://www.youtube.com/@reader",
  ]);
  // Saving the profile without links keeps them.
  fresh.actions.updateProfile("新しい名前", "bio");
  me = fresh.getSnapshot().me;
  assert.equal(me.links?.length, 2);
  const envelope = JSON.parse(serializeTown(fresh.getSnapshot()));
  envelope.data.me.links = ["data:text/html,x", "example.org", 3];
  const loaded = deserializeTown(JSON.stringify(envelope));
  assert.equal(loaded.status, "saved");
  assert.equal(loaded.state.me.name, "新しい名前");
  assert.deepEqual(loaded.state.me.links, ["https://example.org/"]);
});

check(
  "every reader has a unique ID; the viewer's ID is validated and kept",
  () => {
    const handles = [seedState.me, ...seedState.readers].map((r) => r.handle);
    assert.equal(new Set(handles).size, handles.length);
    const fresh = createTownStore(createMemoryRepository());
    assert.equal(
      fresh.actions.updateProfile("あなた", "", undefined, "NAGI"),
      false,
    );
    assert.equal(
      fresh.actions.updateProfile("あなた", "", undefined, "a!"),
      false,
    );
    assert.equal(fresh.getSnapshot().me.handle, "reader");
    assert.equal(
      fresh.actions.updateProfile("あなた", "", undefined, "@Book_Lover"),
      true,
    );
    assert.equal(fresh.getSnapshot().me.handle, "book_lover");
    const envelope = JSON.parse(serializeTown(fresh.getSnapshot()));
    assert.equal(
      deserializeTown(JSON.stringify(envelope)).state.me.handle,
      "book_lover",
    );
    envelope.data.me.handle = "sumire";
    assert.equal(
      deserializeTown(JSON.stringify(envelope)).state.me.handle,
      "reader",
    );
    delete envelope.data.me.handle;
    const legacy = deserializeTown(JSON.stringify(envelope));
    assert.equal(legacy.status, "saved");
    assert.equal(legacy.state.me.handle, "reader");
  },
);

check("tags are read from post text and gathered across public posts", () => {
  assert.deepEqual(extractTags("朝 #朝読書 と #SF、mail#x #再読 ＃再読"), [
    "朝読書",
    "sf",
    "再読",
  ]);
  const fresh = createTownStore(createMemoryRepository());
  fresh.actions.startReading(null, "solo");
  fresh.actions.createPost({ body: "ひみつ #積読", fromReading: true });
  fresh.actions.endReading(false);
  const shared = fresh.actions.createPost({ body: "今日も #積読 が増えた" });
  const state = fresh.getSnapshot();
  const tagged = postsWithTag(state, "積読").map((post) => post.id);
  assert.ok(tagged.includes(shared as string));
  assert.ok(tagged.includes("p-5"));
  // Private reading notes never surface through tags.
  assert.ok(
    postsWithTag(state, "積読").every((post) => post.readingMode !== "solo"),
  );
  assert.equal(
    popularTags(state).find((entry) => entry.tag === "積読")?.count,
    2,
  );
});

check(
  "demo books carry a price; registered prices are kept and checked",
  () => {
    assert.ok(seedState.books.every((book) => typeof book.price === "number"));
    const repo = createMemoryRepository();
    const fresh = createTownStore(repo);
    const priced = fresh.actions.addBook({
      title: "値段のある本",
      author: "",
      price: 1980,
    });
    const odd = fresh.actions.addBook({
      title: "変な値段",
      author: "",
      price: -5,
    });
    assert.ok(priced && odd);
    const loaded = repo.load().state;
    assert.equal(loaded.books.find((book) => book.id === priced)?.price, 1980);
    assert.equal(
      loaded.books.find((book) => book.id === odd)?.price,
      undefined,
    );
  },
);

check("a book taken off can be put back with its POP at its old place", () => {
  const fresh = createTownStore(createMemoryRepository());
  fresh.actions.createShop("棚", "", "sage");
  const id = "mine-shelf-1";
  for (const book of ["solaris", "momo", "walden"])
    fresh.actions.addShelfBook(id, book, "spine");
  const shelf = () => ownShop(fresh.getSnapshot()).shelves[0];
  const momo = shelf().items[1];
  fresh.actions.updatePop(id, momo.id, "灰色の男たちに気をつけて");
  fresh.actions.removeShelfBook(id, momo.id);
  assert.ok(
    fresh.actions.addShelfBook(id, "momo", "face", {
      pop: "灰色の男たちに気をつけて",
      index: 1,
    }),
  );
  assert.deepEqual(
    shelf().items.map((item) => item.bookId),
    ["solaris", "momo", "walden"],
  );
  assert.equal(shelf().items[1].pop, "灰色の男たちに気をつけて");
  assert.equal(shelf().items[1].display, "face");
});

check(
  "following feed includes followed shop owners and self, but no private notes or replies",
  () => {
    const fresh = createTownStore(createMemoryRepository());
    fresh.initialize();
    const state = fresh.getSnapshot();
    const owner = state.shops[0].ownerId;
    const sample = { ...state.posts[0], parentId: null, readingMode: null };
    const posts = followedTimelinePosts({
      ...state,
      following: [state.shops[0].id],
      posts: [
        {
          ...sample,
          id: "followed-public",
          authorId: owner,
          createdAt: "2026-10-10T10:00:00Z",
        },
        {
          ...sample,
          id: "my-public",
          authorId: "me",
          createdAt: "2026-10-10T11:00:00Z",
        },
        { ...sample, id: "other-reader", authorId: "not-followed" },
        { ...sample, id: "private", authorId: owner, readingMode: "solo" },
        {
          ...sample,
          id: "reply",
          authorId: owner,
          parentId: "followed-public",
        },
      ],
    });
    assert.deepEqual(
      posts.map((post) => post.id),
      ["my-public", "followed-public"],
    );
  },
);

check(
  "drafts survive reopening, keep review/reply contexts apart and clear only the submitted draft",
  () => {
    const values = new Map<string, string>([
      ["book-town-v1", "existing town data"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const drafts = createPostDraftStore(() => storage);
    drafts.update("demo:new-post", {
      body: "書きかけ #読書",
      bookId: "momo",
      spoiler: true,
    });
    drafts.update("demo:review:solaris", { body: "レビューの下書き" });
    drafts.update("demo:reply:sample", { body: "返信の下書き" });
    const reopened = createPostDraftStore(() => storage);
    reopened.initialize();
    assert.deepEqual(reopened.getSnapshot().drafts["demo:new-post"], {
      body: "書きかけ #読書",
      bookId: "momo",
      spoiler: true,
    });
    reopened.update("demo:new-post", EMPTY_POST_DRAFT);
    assert.equal(reopened.getSnapshot().drafts["demo:new-post"], undefined);
    assert.equal(
      reopened.getSnapshot().drafts["demo:review:solaris"].body,
      "レビューの下書き",
    );
    assert.equal(
      reopened.getSnapshot().drafts["demo:reply:sample"].body,
      "返信の下書き",
    );
    assert.equal(values.get("book-town-v1"), "existing town data");
  },
);

check(
  "broken or unavailable draft storage never breaks composing, and saving failures retain the draft in memory",
  () => {
    const malformed = createPostDraftStore(() => ({
      getItem: () => "{",
      setItem: () => {},
      removeItem: () => {},
    }));
    malformed.initialize();
    assert.deepEqual(malformed.getSnapshot().drafts, {});
    const blocked = createPostDraftStore(() => {
      throw new Error("storage disabled");
    });
    blocked.update("demo:new-post", { body: "まだ失いたくない言葉" });
    assert.equal(blocked.getSnapshot().saved, false);
    assert.equal(
      blocked.getSnapshot().drafts["demo:new-post"].body,
      "まだ失いたくない言葉",
    );
    const invalid = createPostDraftStore(() => ({
      getItem: (key: string) =>
        key === POST_DRAFT_KEY
          ? JSON.stringify({
              version: 1,
              drafts: {
                "demo:new-post": { body: 99, bookId: null, spoiler: false },
                "demo:review:momo": {
                  body: "有効",
                  bookId: null,
                  spoiler: false,
                },
              },
            })
          : null,
      setItem: () => {},
      removeItem: () => {},
    }));
    invalid.initialize();
    assert.equal(invalid.getSnapshot().drafts["demo:new-post"], undefined);
    assert.equal(invalid.getSnapshot().drafts["demo:review:momo"].body, "有効");
  },
);

check(
  "registered book links use an exported route, including ISBN books; existing demo URLs stay stable",
  () => {
    assert.equal(bookPath("my-book-1"), "/books/registered/?id=my-book-1");
    assert.equal(
      bookPath("isbn-9784101092058"),
      "/books/registered/?id=isbn-9784101092058",
    );
    assert.equal(bookPath("solaris"), "/books/solaris/");
  },
);

check(
  "a post folded by readers is covered for everyone, and its writer can mark it",
  () => {
    const town = createTownStore(createMemoryRepository());
    const review = town.actions.createPost({
      body: "最後の場面で泣いた。",
      bookId: "solaris",
    }) as string;
    const chat = town.actions.createPost({ body: "今日は雨。" }) as string;
    const fold = (state: TownState, ids: string[]): TownState => ({
      ...state,
      posts: state.posts.map((post) =>
        ids.includes(post.id) ? { ...post, folded: true } : post,
      ),
    });
    const others = town
      .getSnapshot()
      .posts.find((post) => post.authorId !== ME_ID && !post.spoiler)!;
    const state = fold(town.getSnapshot(), [review, chat, others.id]);
    // Folded posts go behind the door like marked ones.
    assert.equal(spoilerViewOf(town.getSnapshot(), others), "open");
    assert.equal(
      spoilerViewOf(
        state,
        state.posts.find((post) => post.id === others.id)!,
      ),
      "folded",
    );
    assert.ok(
      bookReviews(state, "solaris").spoilers.some((post) => post.id === review),
    );
    assert.ok(
      !notificationsFor(state).some((notice) =>
        notice.text.includes(others.body.slice(0, 10)),
      ),
    );
    // The writer hears about it once, not who asked.
    const notice = notificationsFor(state).find(
      (entry) => entry.id === "folded:" + review,
    );
    assert.ok(notice?.text.includes("「最後の場面で泣いた。」"));
    assert.ok(
      notificationsFor(state).some((entry) => entry.id === "folded:" + chat),
    );

    // Marking works on the writer's own post with a book, and nowhere else.
    const marking = createTownStore(createMemoryRepository(state));
    marking.actions.markSpoiler(review);
    marking.actions.markSpoiler(chat);
    marking.actions.markSpoiler(others.id);
    const marked = marking.getSnapshot();
    const find = (id: string) => marked.posts.find((post) => post.id === id)!;
    assert.equal(find(review).spoiler, true);
    assert.equal(find(chat).spoiler, false);
    assert.equal(find(others.id).spoiler, false);
    assert.ok(
      !notificationsFor(marked).some(
        (entry) => entry.id === "folded:" + review,
      ),
    );
  },
);

check("a spoiler reply is not quoted in the notice about it", () => {
  const town = createTownStore(createMemoryRepository());
  const review = town.actions.createPost({
    body: "結末に驚いた。",
    bookId: "solaris",
  }) as string;
  const state = town.getSnapshot();
  const other = state.posts.find((post) => post.authorId !== ME_ID)!;
  const reply = {
    ...other,
    id: "p-spoiler-reply",
    parentId: review,
    spoiler: true,
    body: "海が生きていたとは",
  };
  const notice = notificationsFor({
    ...state,
    posts: [...state.posts, reply],
  }).find((entry) => entry.id === "reply:p-spoiler-reply");
  assert.ok(notice);
  assert.ok(!notice.text.includes("海が生きていた"));
});

check("a writer can cover a few words without hiding the whole post", () => {
  assert.deepEqual(splitHidden("犯人は||兄||だった｜｜！｜｜"), [
    { text: "犯人は" },
    { text: "兄", hidden: true },
    { text: "だった" },
    { text: "！", hidden: true },
  ]);
  // Unclosed, empty or mismatched marks stay as written.
  for (const body of ["a||b", "a|| ||b", "a||b｜｜c"])
    assert.deepEqual(splitHidden(body), [{ text: body }]);
  assert.equal(coverHidden("最後に||彼は去る||。"), "最後に（ネタバレ）。");
  assert.equal(uncoverHidden("最後に||彼は去る||。"), "最後に彼は去る。");

  // The button covers what is selected, or leaves a covered place to type in.
  assert.deepEqual(coverSelection("犯人は兄", 3, 4, 1000), {
    body: "犯人は||兄||",
    start: 5,
    end: 6,
  });
  assert.deepEqual(coverSelection("犯人は", 3, 3, 1000), {
    body: "犯人は||隠したい言葉||",
    start: 5,
    end: 11,
  });
  assert.equal(coverSelection("x".repeat(997), 0, 1, 1000), null);
  assert.ok(coverSelection("x".repeat(996), 0, 1, 1000));

  // Covered words do not leak through tags or quotes in notifications.
  assert.deepEqual(extractTags("#ミステリ ||#犯人は兄||"), ["ミステリ"]);
  const town = createTownStore(createMemoryRepository());
  town.actions.toggleFollow("shop-orbit");
  const state = town.getSnapshot();
  const owner = state.shops.find((shop) => shop.id === "shop-orbit")?.ownerId;
  const theirs = state.posts.find(
    (post) => post.authorId === owner && spoilerViewOf(state, post) === "open",
  );
  assert.ok(theirs);
  const covered: TownState = {
    ...state,
    posts: [
      ...state.posts,
      { ...theirs, id: "p-covered", body: "結末で||主人公が去る||のが良い" },
    ],
  };
  const notice = notificationsFor(covered).find(
    (entry) => entry.id === "follow:p-covered",
  );
  assert.ok(notice?.text.includes("「結末で（ネタバレ）のが良い」"));
  assert.ok(!notice?.text.includes("主人公が去る"));

  // The writer's own last words come back to them uncovered.
  const reader = createTownStore(createMemoryRepository());
  reader.actions.startReading("solaris", "together");
  reader.actions.createPost({ body: "海は||生きていた||", fromReading: true });
  reader.actions.endReading(false);
  assert.equal(
    bookToContinue(reader.getSnapshot())?.lastWords,
    "海は生きていた",
  );
});

check(
  "a like is pressed again up to ten times and taken back in one go",
  () => {
    const repo = createMemoryRepository();
    const town = createTownStore(repo);
    assert.equal(town.actions.tapLike("p-3"), 1);
    assert.equal(town.actions.tapLike("p-3"), 2);
    for (let press = 0; press < 20; press += 1) town.actions.tapLike("p-3");
    let state = town.getSnapshot();
    assert.equal(tapsOf(state, "p-3"), LIKE_TAPS_MAX);
    assert.deepEqual(state.likedPosts, ["p-3"]);
    assert.equal(town.actions.tapLike("p-3"), LIKE_TAPS_MAX);
    // The count survives a reload; a tampered one does not.
    assert.deepEqual(repo.load().state.likeTaps, { "p-3": LIKE_TAPS_MAX });
    const stored = JSON.parse(serializeTown(state));
    stored.data.likeTaps = { "p-3": 99, "p-1": 4 };
    assert.deepEqual(
      deserializeTown(JSON.stringify(stored)).state.likeTaps,
      {},
    );
    town.actions.toggleLike("p-3");
    state = town.getSnapshot();
    assert.equal(tapsOf(state, "p-3"), 0);
    assert.deepEqual(state.likeTaps, {});
    assert.equal(town.actions.tapLike("missing"), 0);
  },
);

check("the writer learns who liked their post and how many times", () => {
  const town = createTownStore(createMemoryRepository());
  const own = town.actions.createPost({
    body: "再読して、また泣いた。",
    bookId: "solaris",
  }) as string;
  const state = town.getSnapshot();
  const [haru, nagi] = state.readers;
  const withLikers: TownState = {
    ...state,
    posts: state.posts.map((post) =>
      post.id === own
        ? {
            ...post,
            likes: 2,
            likers: [
              { readerId: haru.id, taps: 7, at: "2026-10-13T01:00:00Z" },
              { readerId: nagi.id, taps: 1, at: "2026-10-13T02:00:00Z" },
            ],
          }
        : post,
    ),
  };
  const post = withLikers.posts.find((entry) => entry.id === own)!;
  assert.equal(post.authorId, ME_ID);
  assert.deepEqual(likesReceived(post), { people: 2, taps: 8 });
  const notices = notificationsFor(withLikers).filter((notice) =>
    notice.id.startsWith("like:"),
  );
  assert.deepEqual(
    notices.map((notice) => notice.text),
    [
      `${nagi.name}さんが、あなたの投稿にいいねしました 「再読して、また泣いた。」`,
      `${haru.name}さんが、あなたの投稿に7回いいねしました 「再読して、また泣いた。」`,
    ],
  );
});

check("records start private: saving one does not publish it", () => {
  assert.equal(seedState.settings.visibility.records.audience, "private");
  assert.equal(seedState.settings.spoilerDisplay, "fold_possible");
  const town = createTownStore(createMemoryRepository());
  const state = town.getSnapshot();
  // The sheet starts at the setting; saved as it starts, the record is the reader's own.
  const id = town.actions.recordReading({
    bookId: "momo",
    feelings: ["warm"],
    note: "",
    spoiler: false,
    audience: state.settings.visibility.records.audience,
  })!;
  const record = () =>
    town.getSnapshot().readingRecords.find((entry) => entry.id === id)!;
  assert.equal(record().audience, "private");
  assert.ok(
    !recordsOf({ ...town.getSnapshot(), me: state.me }, ME_ID).every(
      (entry) => entry.audience === "everyone",
    ),
  );
  // Publishing is its own step, and taking it back is one more.
  town.actions.updateRecord(id, { audience: "everyone" });
  assert.equal(record().audience, "everyone");
  town.actions.updateRecord(id, { audience: "private" });
  assert.equal(record().audience, "private");
  assert.equal(record().feelings[0], "warm");
});

/** The demo town with one setting for spoilers. */
const showing = (mode: SpoilerDisplay, state = seedState): TownState => ({
  ...state,
  settings: { ...state.settings, spoilerDisplay: mode },
});

check(
  "how a spoiler reaches a reader, for each choice of 「ネタバレの表示」",
  () => {
    const base = seedState.posts.find((post) => post.id === "p-3")!;
    const kinds: Record<string, Post> = {
      marked: { ...base, id: "x-marked", spoiler: true },
      folded: { ...base, id: "x-folded", folded: true },
      asked: { ...base, id: "x-asked" },
      plain: { ...base, id: "x-plain" },
    };
    const expected: Record<SpoilerDisplay, Record<string, string>> = {
      show_all: {
        marked: "folded",
        folded: "open",
        asked: "folded",
        plain: "open",
      },
      fold_possible: {
        marked: "folded",
        folded: "folded",
        asked: "folded",
        plain: "open",
      },
      leave_out: {
        marked: "left_out",
        folded: "left_out",
        asked: "left_out",
        plain: "open",
      },
    };
    for (const mode of SPOILER_DISPLAYS)
      for (const [kind, post] of Object.entries(kinds)) {
        const state = {
          ...showing(mode),
          spoilerReports: ["x-asked"],
          posts: Object.values(kinds),
        };
        assert.equal(
          spoilerViewOf(state, post),
          expected[mode][kind],
          mode + " " + kind,
        );
        // The reader's own posts are never left out of their own screens.
        const mine = { ...post, authorId: ME_ID };
        assert.notEqual(
          spoilerViewOf(state, mine),
          "left_out",
          mode + " mine " + kind,
        );
        if (kind === "marked")
          assert.equal(spoilerViewOf(state, mine), "folded");
      }
  },
);

check(
  "a reader who finished the book reads its spoilers, unless they asked about one",
  () => {
    const base = seedState.posts.find((post) => post.id === "p-3")!;
    const kinds: Record<string, Post> = {
      marked: { ...base, id: "x-marked", spoiler: true },
      folded: { ...base, id: "x-folded", folded: true },
      asked: { ...base, id: "x-asked" },
      plain: { ...base, id: "x-plain" },
    };
    // Finished: the writer's mark and three readers' fold open, whatever the
    // setting (出さない too); the reader's own 「ネタバレでは？」 still folds.
    const finished: Record<SpoilerDisplay, Record<string, string>> = {
      show_all: {
        marked: "open",
        folded: "open",
        asked: "folded",
        plain: "open",
      },
      fold_possible: {
        marked: "open",
        folded: "open",
        asked: "folded",
        plain: "open",
      },
      leave_out: {
        marked: "open",
        folded: "open",
        asked: "left_out",
        plain: "open",
      },
    };
    for (const mode of SPOILER_DISPLAYS)
      for (const [kind, post] of Object.entries(kinds)) {
        const state = {
          ...showing(mode),
          spoilerReports: ["x-asked"],
          posts: Object.values(kinds),
        };
        assert.equal(
          spoilerViewOf({ ...state, finishedBooks: [base.bookId!] }, post),
          finished[mode][kind],
          "finished " + mode + " " + kind,
        );
        // Another book finished changes nothing: as before.
        assert.equal(
          spoilerViewOf({ ...state, finishedBooks: ["solaris"] }, post),
          spoilerViewOf(state, post),
          "not finished " + mode + " " + kind,
        );
      }
    // A reply takes its post's book: a spoiler reply opens for whoever
    // finished the book the post is about, and only for them.
    const reply = seedState.posts.find((post) => post.id === "p-7-r1")!;
    assert.equal(reply.bookId, null);
    assert.equal(spoilerViewOf(seedState, reply), "folded");
    const done = { ...seedState, finishedBooks: ["left-hand"] };
    assert.equal(spoilerViewOf(done, reply), "open");
    assert.equal(
      spoilerViewOf({ ...seedState, finishedBooks: ["solaris"] }, reply),
      "folded",
    );
    // On the book page, the marked review leaves the door for a finisher.
    const ids = (posts: Post[]) => posts.map((post) => post.id);
    assert.ok(
      ids(bookReviews(seedState, "left-hand").spoilers).includes("p-7"),
    );
    assert.ok(ids(bookReviews(done, "left-hand").open).includes("p-7"));
    assert.ok(!ids(bookReviews(done, "left-hand").spoilers).includes("p-7"));
  },
);

check(
  "left-out spoilers leave every list, and the book page says so once",
  () => {
    const folded: TownState = {
      ...seedState,
      posts: seedState.posts.map((post) =>
        post.id === "p-1" ? { ...post, folded: true } : post,
      ),
    };
    const ids = (posts: Post[]) => posts.map((post) => post.id);
    // fold_possible (the default): marked and folded wait behind the door.
    const usual = bookReviews(folded, "solaris");
    assert.ok(ids(usual.spoilers).includes("p-1"));
    assert.equal(usual.leftOut, false);
    assert.ok(ids(timelinePosts(folded)).includes("p-7"));
    // show_all: three readers' fold opens; the writer's mark still folds.
    const all = showing("show_all", folded);
    assert.ok(ids(bookReviews(all, "solaris").open).includes("p-1"));
    assert.ok(ids(bookReviews(all, "left-hand").spoilers).includes("p-7"));
    // leave_out: out of the timeline, the book page, profiles, threads, feeds and tags.
    const out = showing("leave_out", folded);
    assert.ok(!ids(timelinePosts(out)).includes("p-7"));
    assert.ok(!ids(timelinePosts(out)).includes("p-1"));
    assert.ok(!ids(readerPosts(out, "r-nagi")).includes("p-7"));
    const leftHand = bookReviews(out, "left-hand");
    assert.deepEqual(ids(leftHand.spoilers), []);
    assert.equal(leftHand.leftOut, true);
    assert.ok(!ids(repliesOf(out, "p-7")).length);
    assert.ok(!ids(repliesOf(showing("leave_out"), "p-7")).includes("p-7-r1"));
    assert.ok(ids(repliesOf(seedState, "p-7")).includes("p-7-r1"));
    // A reply left out is still a reply: deleting the post deletes it for
    // everyone, so the writer is asked about the replies too.
    const p7 = seedState.posts.find((entry) => entry.id === "p-7")!;
    const mineWithHidden = showing("leave_out", {
      ...seedState,
      posts: seedState.posts.map((entry) =>
        entry.id === "p-7" ? { ...p7, authorId: ME_ID } : entry,
      ),
    });
    assert.deepEqual(ids(repliesOf(mineWithHidden, "p-7")), []);
    assert.equal(hasReplies(mineWithHidden, "p-7"), true);
    assert.equal(hasReplies(mineWithHidden, "p-3"), false);
    const together = {
      ...seedState.posts[2],
      id: "x-memo",
      readingMode: "together" as const,
      spoiler: true,
      bookId: "solaris",
    };
    const withMemo = { ...out, posts: [...out.posts, together] };
    assert.ok(!ids(readingFeed(withMemo)).includes("x-memo"));
    assert.ok(
      ids(readingFeed({ ...withMemo, settings: seedState.settings })).includes(
        "x-memo",
      ),
    );
    const tagged = {
      ...together,
      id: "x-tag",
      readingMode: null,
      body: "#結末 の話",
    };
    const withTag = { ...out, posts: [...out.posts, tagged] };
    assert.deepEqual(ids(postsWithTag(withTag, "結末")), []);
    assert.deepEqual(
      ids(postsWithTag({ ...withTag, settings: seedState.settings }, "結末")),
      ["x-tag"],
    );
  },
);

check("a record's spoiler note is folded, or left out, for others only", () => {
  const record = {
    ...seedState.readingRecords[0],
    note: "結末の話",
    spoiler: true,
  };
  assert.equal(recordNoteView(seedState, record), "folded");
  assert.equal(recordNoteView(showing("show_all"), record), "folded");
  assert.equal(recordNoteView(showing("leave_out"), record), "left_out");
  assert.equal(
    recordNoteView(showing("leave_out"), { ...record, readerId: ME_ID }),
    "open",
  );
  assert.equal(
    recordNoteView(showing("leave_out"), { ...record, spoiler: false }),
    "open",
  );
});

const filed = (patch: Partial<FiledReport>): FiledReport => ({
  id: "report-1",
  kind: "post",
  targetId: "p-3",
  reason: "harassment",
  status: "open",
  createdAt: "2026-10-13T01:00:00Z",
  statusAt: "2026-10-13T01:00:00Z",
  ...patch,
});

check(
  "folds by reports: everyone's, the owner's held, the reporter's own",
  () => {
    const state: TownState = {
      ...seedState,
      reviewFolds: {
        "post:p-3": { state: "folded", since: "2026-10-13T02:00:00Z" },
        "profile:r-nagi": { state: "folded", since: "2026-10-13T02:00:00Z" },
        "profile:me": { state: "folded", since: "2026-10-13T02:00:00Z" },
      },
      myReports: [filed({ targetId: "p-5", status: "checked" })],
    };
    assert.equal(reviewFoldOf(state, "post", "p-3"), "folded");
    // A reporter keeps what they reported folded, whatever came of it.
    assert.equal(reviewFoldOf(state, "post", "p-5"), "reported");
    assert.equal(reviewFoldOf(state, "post", "p-6"), null);
    assert.equal(
      reviewFoldOf(
        {
          ...state,
          reviewFolds: { "post:p-9": { state: "held", since: "x" } },
        },
        "post",
        "p-9",
      ),
      "held",
    );
    // Words fold for others; their owner reads them with a note instead.
    assert.ok(wordsFolded(state, "profile", "r-nagi"));
    assert.ok(!wordsFolded(state, "profile", ME_ID));
    assert.ok(!wordsFolded(state, "shop", "shop-orbit"));
    // Report-folded posts stay in their place on the timeline.
    assert.ok(timelinePosts(state).some((post) => post.id === "p-3"));
  },
);

check(
  "a tag is offered only from posts that reach the reader as they are",
  () => {
    const base = seedState.posts.find((post) => post.id === "p-3")!;
    const address: Post = {
      ...base,
      id: "x-address",
      body: "あの人の住所は #山田太郎の家 です",
      spoiler: false,
      folded: false,
    };
    const spoiler: Post = {
      ...base,
      id: "x-spoiler",
      body: "#犯人は執事 だった",
      spoiler: true,
      bookId: "solaris",
    };
    const asked: Post = {
      ...base,
      id: "x-asked",
      body: "#最後の一行 がすべて",
      spoiler: false,
      folded: true,
      bookId: "solaris",
    };
    const state: TownState = {
      ...seedState,
      posts: [...seedState.posts, address, spoiler, asked],
      reviewFolds: {
        "post:x-address": { state: "folded", since: "2026-10-13T02:00:00Z" },
      },
    };
    const offered = (from: TownState) =>
      popularTags(from, 100).map((entry) => entry.tag);
    for (const mode of SPOILER_DISPLAYS) {
      const town = showing(mode, state);
      // Folded by reports, or a spoiler: its words stay behind the cover.
      assert.ok(!offered(town).includes("山田太郎の家"), mode);
      assert.ok(!offered(town).includes("犯人は執事"), mode);
      // Every tag offered leads to a post the reader can read.
      for (const tag of offered(town))
        assert.ok(postsWithTag(town, tag).length > 0, mode + " #" + tag);
    }
    // Three readers' 「ネタバレでは？」: offered only to one who shows all.
    assert.ok(!offered(state).includes("最後の一行"));
    assert.ok(offered(showing("show_all", state)).includes("最後の一行"));
    // Reported by the reader, it stays folded for them, tags and all.
    const reported: TownState = {
      ...state,
      reviewFolds: {},
      myReports: [filed({ targetId: "x-address" })],
    };
    assert.ok(!offered(reported).includes("山田太郎の家"));
    // Unfolded, its tags are offered like any post's.
    assert.ok(offered({ ...state, reviewFolds: {} }).includes("山田太郎の家"));
    // The search says once that the reader's setting left a post out,
    // rather than that there is none.
    const out = showing("leave_out", state);
    assert.deepEqual(postsWithTag(out, "犯人は執事"), []);
    assert.equal(tagLeftOut(out, "犯人は執事"), true);
    assert.equal(tagLeftOut(state, "犯人は執事"), false);
    assert.equal(tagLeftOut(out, "積読"), false);
  },
);

check(
  "the writer hears of a fold, gently; the reporter hears only its status",
  () => {
    const town = createTownStore(createMemoryRepository());
    const mine = town.actions.createPost({
      body: "静かな夜の本",
      bookId: "solaris",
    })!;
    const base = town.getSnapshot();
    const state: TownState = {
      ...base,
      reviewFolds: {
        ["post:" + mine]: { state: "folded", since: "2026-10-13T02:00:00Z" },
        "profile:me": { state: "folded", since: "2026-10-13T02:01:00Z" },
        "shop:mine": { state: "folded", since: "2026-10-13T02:02:00Z" },
        // Others' folds are not the reader's news.
        "post:p-3": { state: "folded", since: "2026-10-13T02:03:00Z" },
      },
    };
    const text = (id: string) =>
      notificationsFor(state).find((notice) => notice.id === id)?.text;
    assert.equal(
      text("review-folded:post:" + mine),
      "通報があったため、運営が確かめるまで、あなたの投稿「静かな夜の本」をみんなの画面ではたたんでいます。投稿は消えていません",
    );
    assert.equal(
      text("review-folded:profile:me"),
      "通報があったため、運営が確かめるまで、あなたの紹介文をたたんでいます",
    );
    assert.equal(
      text("review-folded:shop:mine"),
      "通報があったため、運営が確かめるまで、あなたの本屋の紹介文をたたんでいます",
    );
    assert.equal(text("review-folded:post:p-3"), undefined);
    const held = notificationsFor({
      ...base,
      reviewFolds: {
        ["post:" + mine]: { state: "held", since: "2026-10-13T02:00:00Z" },
      },
    }).find((notice) => notice.id === "review-held:post:" + mine);
    assert.equal(
      held?.text,
      "運営が確かめるまで、あなたの投稿「静かな夜の本」をほかの人から見えないようにしています。問題がなければ、元に戻ります",
    );

    const reports = (
      status: FiledReport["status"],
      kind: FiledReport["kind"] = "post",
    ) =>
      notificationsFor({
        ...base,
        myReports: [filed({ status, kind, statusAt: "2026-10-14T01:00:00Z" })],
      }).filter((notice) => notice.id.startsWith("report:"));
    assert.deepEqual(reports("open"), []);
    assert.deepEqual(
      reports("checking").map((notice) => [
        notice.id,
        notice.text,
        notice.href,
      ]),
      [
        [
          "report:report-1:checking",
          "投稿について10月13日にいただいた通報を、運営が確認しています",
          "/notifications/#reports",
        ],
      ],
    );
    // Acted on or not (the reporter cannot know which), the same words.
    assert.deepEqual(
      reports("checked").map((notice) => [notice.id, notice.text]),
      [
        [
          "report:report-1:done",
          "投稿について10月13日にいただいた通報を、運営が確認しました。知らせてくださって、ありがとうございます",
        ],
      ],
    );
    // A person or a shop reported is named as what the report was about, so
    // it never reads as if the reporter were the one being checked.
    assert.equal(
      reports("checking", "shop")[0].text,
      "本屋について10月13日にいただいた通報を、運営が確認しています",
    );
    assert.equal(
      reports("checking", "profile")[0].text,
      "読書家について10月13日にいただいた通報を、運営が確認しています",
    );
    assert.equal(
      reports("checking", "poster")[0].text,
      "ポスターについて10月13日にいただいた通報を、運営が確認しています",
    );
    // What was reported comes first: いただいた is the report, never a
    // poster or a cover someone gave, nor a reader who reported.
    for (const kind of ["post", "shop", "profile", "poster", "book"] as const)
      for (const status of ["checking", "checked"] as const)
        assert.doesNotMatch(
          reports(status, kind)[0].text,
          /いただいた(ポスター|投稿|本屋|読書家|表紙)|通報してくださった/,
        );
    assert.equal(
      reports("checked", "book")[0].text,
      "表紙について10月13日にいただいた削除の依頼を、運営が確認しました",
    );
    for (const notice of notificationsFor({
      ...state,
      myReports: [filed({ status: "checking" })],
    }))
      assert.doesNotMatch(notice.text, /(^|\D)0(人|件)/);
  },
);

check("folded and left-out posts are not quoted in notices", () => {
  const town = createTownStore(createMemoryRepository());
  const review = town.actions.createPost({
    body: "結末に驚いた。",
    bookId: "solaris",
  })!;
  town.actions.toggleFollow("shop-orbit");
  const base = town.getSnapshot();
  const owner = base.shops.find((shop) => shop.id === "shop-orbit")!.ownerId;
  const theirs = base.posts.find(
    (post) =>
      post.authorId === owner && post.parentId === null && !post.spoiler,
  )!;
  const reply: Post = {
    ...theirs,
    id: "x-reply",
    parentId: review,
    folded: true,
    body: "海が生きていたとは",
  };
  const folded: Post = {
    ...theirs,
    id: "x-folded",
    folded: true,
    body: "三人がたたんだ言葉",
  };
  const state = { ...base, posts: [...base.posts, reply, folded] };
  const find = (from: TownState, id: string) =>
    notificationsFor(from).find((notice) => notice.id === id);
  // fold_possible: the reply is told without its words; the folded post is not news.
  assert.ok(find(state, "reply:x-reply"));
  assert.ok(!find(state, "reply:x-reply")!.text.includes("海が"));
  assert.equal(find(state, "follow:x-folded"), undefined);
  // show_all: three readers' folds are quoted like any post.
  const all = showing("show_all", state);
  assert.ok(find(all, "reply:x-reply")!.text.includes("海が"));
  assert.ok(find(all, "follow:x-folded")!.text.includes("三人がたたんだ言葉"));
  // leave_out: told of the reply, never with its words, and nothing more.
  const out = showing("leave_out", state);
  assert.ok(!find(out, "reply:x-reply")!.text.includes("海が"));
  assert.equal(find(out, "follow:x-folded"), undefined);
  // Folded by reports: never quoted.
  const reported = {
    ...all,
    reviewFolds: { "post:x-folded": { state: "folded" as const, since: "x" } },
  };
  assert.equal(find(reported, "follow:x-folded"), undefined);
});

check("the spoiler setting and filed reports are kept as the store's", () => {
  const repo = createMemoryRepository();
  const town = createTownStore(repo);
  town.actions.setSpoilerDisplay("leave_out");
  town.actions.setSpoilerDisplay("hide_everything" as SpoilerDisplay);
  assert.equal(town.getSnapshot().settings.spoilerDisplay, "leave_out");
  assert.equal(repo.load().state.settings.spoilerDisplay, "leave_out");
  const saved = JSON.parse(serializeTown(town.getSnapshot()));
  saved.data.settings.spoilerDisplay = "everything";
  assert.equal(
    deserializeTown(JSON.stringify(saved)).state.settings.spoilerDisplay,
    "fold_possible",
  );
  // A reader who chose 公開 in this browser before keeps that choice.
  delete saved.data.settings.visibility;
  saved.data.settings.readingPublic = true;
  assert.equal(
    deserializeTown(JSON.stringify(saved)).state.settings.visibility.records
      .audience,
    "everyone",
  );
  town.actions.noteReport(filed({}));
  town.actions.noteReport(filed({ status: "checking" }));
  town.actions.noteReport(filed({ id: "report-2" }));
  assert.deepEqual(
    town.getSnapshot().myReports.map((entry) => [entry.id, entry.status]),
    [
      ["report-2", "open"],
      ["report-1", "checking"],
    ],
  );
});

check("reading time is told without a 0 in it", () => {
  assert.equal(formatDuration(0), "1分未満");
  assert.equal(formatDuration(59), "1分未満");
  assert.equal(formatDuration(60), "1分");
  assert.equal(formatDuration(3600), "1時間");
  assert.equal(formatDuration(3660), "1時間1分");
  assert.equal(formatDuration(7200 + 59), "2時間");
});

check("words are not taken while the town loads or cannot be kept", () => {
  const words = { body: "まだ街が来ない", bookId: null, spoiler: false };
  // Before `follow` has chosen where the town lives, nothing is taken, and
  // nothing is written into this browser's demo.
  let switchTo: (backend: TownBackend) => void = () => {};
  const demo = createMemoryRepository();
  const before = serializeTown(demo.load().state);
  const town = createTownStore(demo, undefined, {
    follow: (next) => {
      switchTo = next;
    },
  });
  town.initialize();
  assert.equal(town.actions.createPost(words), null);
  assert.equal(
    town.actions.recordReading({
      bookId: "momo",
      feelings: ["warm"],
      note: "",
      spoiler: false,
      audience: "private",
    }),
    null,
  );
  assert.equal(town.getSnapshot().posts.length, 0);
  assert.equal(serializeTown(demo.load().state), before);
  // While an account's town is on its way, the same. (The way is a
  // thenable here, so the town arrives when the check says.)
  let arrive: (snapshot: RepositorySnapshot) => void = () => {};
  const saved: TownState[] = [];
  switchTo({
    kind: "account",
    newId: counterId,
    load: () =>
      ({
        then: (resolve: (snapshot: RepositorySnapshot) => void) => {
          arrive = resolve;
        },
      }) as unknown as Promise<RepositorySnapshot>,
    save: (state) => {
      saved.push(state);
      return "saving";
    },
  });
  assert.equal(town.getPersistenceSnapshot(), "loading");
  assert.equal(town.actions.createPost(words), null);
  assert.deepEqual(saved, []);
  arrive({ state: structuredClone(seedState), status: "saved" });
  // Arrived, the town takes words, and a record answers when it changed.
  assert.ok(town.actions.createPost(words));
  assert.equal(saved.length, 1);
  const recordId = town.actions.recordReading({
    bookId: "momo",
    feelings: ["warm"],
    note: "",
    spoiler: false,
    audience: "private",
  });
  assert.ok(recordId);
  assert.equal(
    town.actions.updateRecord(recordId, { note: "あたたかい" }),
    true,
  );
  assert.equal(town.actions.updateRecord("no-such-record", {}), false);
  // An account that could not be read takes no words at all.
  switchTo(unavailableBackend(emptyTown()));
  assert.equal(town.actions.createPost(words), null);
  assert.equal(town.getSnapshot().posts.length, 0);
});

check("a book the reader registered is fixed: its title, author and ISBN", () => {
  const town = createTownStore(createMemoryRepository());
  const id = town.actions.addBook({
    title: "よるのとしょかん",
    author: "ドウ",
    isbn: "9784000000000",
  });
  assert.ok(id);
  const other = town.actions.addBook({ title: "ほかの本", author: "", isbn: "9784000000017" });
  assert.ok(other);
  const fix = (title: string, author: string, isbn: string) =>
    town.actions.fixBook(id, { title, author, isbn });
  assert.equal(fix("  ", "ドウ", ""), "no-title");
  assert.equal(fix("夜の図書館", "ドウ", "978-4"), "bad-isbn");
  assert.equal(fix("よるのとしょかん", "ドウ", "9784000000000"), "unchanged");
  // Another book of the library has that ISBN: not two of one book.
  assert.equal(fix("夜の図書館", "ドウ", "978-4-00-000001-7"), "already");
  assert.equal(fix(" 夜の図書館 ", "ジェーン・ドウ", "978-4-00-000003-1"), "fixed");
  const fixed = bookById(town.getSnapshot().books, id);
  assert.equal(fixed?.title, "夜の図書館");
  assert.equal(fixed?.author, "ジェーン・ドウ");
  assert.equal(fixed?.isbn, "9784000000031");
  // An empty ISBN takes it away; the book stays in the library.
  assert.equal(fix("夜の図書館", "ジェーン・ドウ", ""), "fixed");
  assert.equal(bookById(town.getSnapshot().books, id)?.isbn, undefined);
  assert.ok(town.getSnapshot().library.includes(id));
  assert.equal(town.actions.fixBook("no-such-book", { title: "x", author: "", isbn: "" }), "not-saved");
});

check("a catalogue's author comes as the reader sees it, and stays as written when left so", () => {
  // A scan's item and the field filled from openBD take the reader's shape.
  assert.equal(
    bookWords({ title: "ノルウェイの森", author: "村上,春樹,1949-" }).author,
    "村上春樹",
  );
  const town = createTownStore(createMemoryRepository());
  const id = town.actions.addBook({
    title: "ノルウェイの森",
    author: "村上,春樹,1949-",
    isbn: "9784000000055",
  });
  assert.ok(id);
  const book = () => bookById(town.getSnapshot().books, id)!;
  // The form to fix it starts from the author as shown.
  assert.equal(bookFixOf(book()).author, "村上春樹");
  const fix = (author: string, isbn: string) =>
    town.actions.fixBook(id, { title: "ノルウェイの森", author, isbn });
  assert.equal(fix("村上春樹", "9784000000055"), "unchanged");
  // Only the ISBN fixed: the author is left as it was written.
  assert.equal(fix("村上春樹", "9784000000062"), "fixed");
  assert.equal(book().author, "村上,春樹,1949-");
  assert.equal(fix("村上 春樹", "9784000000062"), "fixed");
  assert.equal(book().author, "村上 春樹");
});

check("a book held back is told once in お知らせ, leading to its page", () => {
  const town = createTownStore(createMemoryRepository());
  const id = town.actions.addBook({ title: "よるのとしょかん", author: "", isbn: "9784000000000" });
  assert.ok(id);
  const state = town.getSnapshot();
  const hold = {
    bookId: id,
    heldAt: "2026-10-17T05:00:00.000Z",
    master: { title: "見本の物語", creators: [{ name: "山田一郎" }] },
  };
  const notice = notificationsFor(state, 0, [hold]).find((entry) =>
    entry.id.startsWith("held:"),
  );
  assert.ok(notice);
  assert.equal(
    notice.text,
    "登録した『よるのとしょかん』のISBNは、『見本の物語』のものです。本のページで確かめてください",
  );
  assert.equal(notice.href, bookPath(id));
  assert.equal(unreadCount(state, [hold]), unreadCount(state) + 1);
  town.actions.markNotificationsSeen([notice.id]);
  assert.equal(unreadCount(town.getSnapshot(), [hold]), unreadCount(state));
  // A book the town does not have tells nothing.
  assert.equal(
    notificationsFor(state, 0, [{ ...hold, bookId: "gone" }]).filter((entry) =>
      entry.id.startsWith("held:"),
    ).length,
    0,
  );
});

console.log(`${passed} domain checks passed.`);
