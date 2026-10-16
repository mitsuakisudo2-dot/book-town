import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import { homeLetters, letterOf } from "../src/lib/home-feed";
import {
  SNAPSHOT_LETTERS,
  snapshotFor,
  snapshotOf,
  type HomeSnapshot,
} from "../src/lib/home-snapshot";
import { emptyTown } from "../src/lib/town-remote";
import { ME_ID, type TownState } from "../src/lib/types";

// Home's first 便り kept for the next opening (home-snapshot.ts): only what
// anyone may read, only for the town it came from, and not for long.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

const NOW = Date.parse("2026-10-16T12:00:00+09:00");
const DAY = 24 * 60 * 60 * 1000;
const drawnOf = (state: TownState) => {
  const { followed, town } = homeLetters(state, NOW);
  return {
    followed: followed.map((entry) => entry.id),
    town: town.map((entry) => entry.id),
  };
};
const keep = (state: TownState, owner = "user-1") =>
  snapshotOf(state, drawnOf(state), owner, NOW) as HomeSnapshot;

check("the first 便り are kept, in Home's order, with what draws them", () => {
  const drawn = drawnOf(seedState);
  const snapshot = keep(seedState);
  const ids = [...snapshot.followed, ...snapshot.town];
  assert.ok(ids.length > 0 && ids.length <= SNAPSHOT_LETTERS);
  // In Home's order: a subsequence of what was drawn.
  const order = [...drawn.followed, ...drawn.town];
  assert.deepEqual(
    ids,
    order.filter((id) => ids.includes(id)),
  );
  for (const id of ids) {
    const entry = letterOf(snapshot.state, id);
    assert.ok(entry, id + " draws from the kept town");
    const author =
      entry.kind === "post" ? entry.post.authorId : entry.poster.authorId;
    if (author !== ME_ID)
      assert.ok(
        snapshot.state.readers.some((reader) => reader.id === author),
        "its writer is kept",
      );
  }
});

check(
  "only what anyone may read: no spoiler, fold, reply, memo or blocked writer",
  () => {
    const first = keep(seedState);
    const firstPost = first.state.posts[0];
    assert.ok(firstPost, "the demo keeps a post");
    const folded: TownState = {
      ...seedState,
      posts: seedState.posts.map((post) =>
        post.id === firstPost.id ? { ...post, folded: true } : post,
      ),
    };
    assert.ok(
      !keep(folded).state.posts.some((post) => post.id === firstPost.id),
    );
    const reported: TownState = {
      ...seedState,
      reviewFolds: {
        ...seedState.reviewFolds,
        ["post:" + firstPost.id]: { state: "folded", since: "2026-10-15" },
      } as TownState["reviewFolds"],
    };
    assert.ok(
      !keep(reported).state.posts.some((post) => post.id === firstPost.id),
    );
    const blocked: TownState = {
      ...seedState,
      blocked: [firstPost.authorId],
    };
    assert.ok(
      !keep(blocked).state.posts.some(
        (post) => post.authorId === firstPost.authorId,
      ),
    );
    for (const snapshot of [first, keep(folded), keep(reported), keep(blocked)])
      for (const post of snapshot.state.posts) {
        assert.equal(post.spoiler, false);
        assert.notEqual(post.folded, true);
        assert.equal(post.parentId, null);
        assert.notEqual(post.readingMode, "solo");
        assert.equal(post.likers, undefined);
      }
  },
);

check(
  "nothing of the reader's own town but their name on their own 便り",
  () => {
    const snapshot = keep(seedState);
    const empty = emptyTown();
    for (const key of [
      "shops",
      "ownShop",
      "following",
      "blocked",
      "wishlist",
      "favorites",
      "likedPosts",
      "wantedPosts",
      "spoilerReports",
      "readingNow",
      "readingSessions",
      "finishedBooks",
      "library",
      "readingRecords",
      "settings",
      "seenNotifications",
      "shopMessages",
      "reviewFolds",
      "myReports",
      "popReactions",
      "likeTaps",
    ] as const)
      assert.deepEqual(snapshot.state[key], empty[key], key + " is not kept");
    for (const reader of [...snapshot.state.readers, snapshot.state.me]) {
      assert.deepEqual(reader.lifeNine, []);
      assert.deepEqual(reader.links, []);
      assert.equal(reader.bio, "");
    }
    const bookIds = new Set(snapshot.state.books.map((book) => book.id));
    for (const post of snapshot.state.posts)
      if (post.bookId) assert.ok(bookIds.has(post.bookId));
    assert.ok(snapshot.state.books.length < seedState.books.length);
  },
);

check("nothing to keep: no snapshot", () => {
  assert.equal(
    snapshotOf(emptyTown(), { followed: [], town: [] }, "x", NOW),
    null,
  );
});

check("drawn again only for its own town, while recent", () => {
  const words = JSON.stringify(keep(seedState, "user-1"));
  assert.ok(snapshotFor(words, "user-1", NOW + DAY));
  // While the account is being checked: anyone's (it holds only the public).
  assert.ok(snapshotFor(words, null, NOW));
  assert.equal(snapshotFor(words, "user-2", NOW), null);
  assert.equal(snapshotFor(words, "visitor", NOW), null);
  assert.equal(snapshotFor(words, "user-1", NOW + 8 * DAY), null);
  assert.equal(snapshotFor(words, "user-1", NOW - DAY), null);
  for (const bad of [
    null,
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({ v: 2 }),
    JSON.stringify({ ...JSON.parse(words), state: { posts: "x" } }),
  ])
    assert.equal(snapshotFor(bad, null, NOW), null, String(bad));
  // The rest of the town is empty, whatever the kept words hold.
  const kept = snapshotFor(words, "user-1", NOW)!;
  assert.deepEqual(kept.state.readingRecords, []);
  assert.deepEqual(kept.state.following, []);
});

console.log(`home snapshot ok (${passed})`);
