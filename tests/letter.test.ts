import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  FOLD_OVER,
  FOLD_TO,
  foldsAt,
  letterFeelings,
  likeTapOutcome,
  linesOf,
  postPageOf,
  spoilerBars,
} from "../src/lib/letter";
import { notificationsFor } from "../src/lib/notifications";
import { spoilerBookOf, spoilerViewOf } from "../src/lib/social";
import { LIKE_TAPS_MAX, ME_ID, type Post } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const post = (id: string) => seedState.posts.find((entry) => entry.id === id)!;

check("いいね adds one per tap up to ten, then asks to take it back", () => {
  assert.equal(LIKE_TAPS_MAX, 10);
  for (let taps = 0; taps < 10; taps += 1)
    assert.equal(likeTapOutcome(taps), "tap", `${taps} taps so far`);
  assert.equal(likeTapOutcome(10), "confirm");
});

check("a spoiler's book is the post's; a reply's, the one it answers", () => {
  assert.equal(spoilerBookOf(seedState, post("p-7")), "left-hand");
  // A reply without a book takes its post's.
  assert.equal(spoilerBookOf(seedState, post("p-7-r1")), "left-hand");
  // A reply that recommends a book still spoils its post's book: p-1-r2
  // recommends 闇の左手 under a post about ソラリス.
  assert.equal(post("p-1-r2").bookId, "left-hand");
  assert.equal(spoilerBookOf(seedState, post("p-1-r2")), "solaris");
  // Words with no book, and a reply to a post that is gone, have none.
  assert.equal(spoilerBookOf(seedState, post("p-2")), null);
  const orphan: Post = { ...post("p-7-r1"), parentId: "gone" };
  assert.equal(spoilerBookOf(seedState, orphan), null);
  // So a marked reply opens for whoever finished its post's book, not the
  // book it recommends.
  const marked: Post = { ...post("p-1-r2"), spoiler: true };
  const town = { ...seedState, posts: [...seedState.posts, marked] };
  assert.equal(
    spoilerViewOf({ ...town, finishedBooks: ["left-hand"] }, marked),
    "folded",
  );
  assert.equal(
    spoilerViewOf({ ...town, finishedBooks: ["solaris"] }, marked),
    "open",
  );
});

check("a post folds past eight lines, to six", () => {
  assert.equal(FOLD_OVER, 8);
  assert.equal(FOLD_TO, 6);
  assert.equal(foldsAt(8), false);
  assert.equal(foldsAt(9), true);
  // 15px type at 1.6: a line is 24px.
  assert.equal(linesOf(24 * 8, 24), 8);
  assert.equal(linesOf(24 * 9 - 2, 24), 9);
  assert.equal(linesOf(100, 0), 0);
});

check("a covered spoiler shows one to four bars", () => {
  assert.equal(spoilerBars("短い。"), 1);
  assert.equal(spoilerBars("あ".repeat(41)), 3);
  assert.equal(spoilerBars("あ".repeat(400)), 4);
  assert.equal(spoilerBars("   "), 1);
});

check("the book row carries the writer's public feelings, two at most", () => {
  // すみれ kept a public record of 見えない都市.
  assert.deepEqual(letterFeelings(seedState, post("p-8")), [
    "よく分からない、でも残る",
    "もう一度読みたい",
  ]);
  // No record of that book by that writer: no chips.
  assert.deepEqual(letterFeelings(seedState, post("p-6")), []);
  assert.deepEqual(letterFeelings(seedState, post("p-2")), []);
  // A record kept to oneself is not shown, even to the writer's readers.
  const kept = {
    ...seedState,
    readingRecords: seedState.readingRecords.map((record) =>
      record.id === "record-sumire-cities"
        ? { ...record, audience: "private" as const }
        : record,
    ),
  };
  assert.deepEqual(letterFeelings(kept, post("p-8")), []);
  // The newest public record wins.
  const twice = {
    ...seedState,
    readingRecords: [
      ...seedState.readingRecords,
      {
        ...seedState.readingRecords[2],
        id: "again",
        feelings: ["warm" as const],
        createdAt: "2026-10-12T00:00:00Z",
      },
    ],
  };
  assert.deepEqual(letterFeelings(twice, post("p-8")), ["あたたかくなった"]);
  assert.deepEqual(
    letterFeelings(seedState, { authorId: ME_ID, bookId: "momo" }),
    [],
  );
});

check("a reply opens on its post's page", () => {
  assert.equal(postPageOf(post("p-1")), "p-1");
  assert.equal(postPageOf(post("p-1-r2")), "p-1");
});

check("notices about a post lead to its page while it is in the town", () => {
  const liked = [{ readerId: "r-sumire", taps: 2, at: "2026-10-12T01:00:00Z" }];
  const mine: Post = {
    ...post("p-1"),
    id: "m-1",
    authorId: ME_ID,
    likers: liked,
  };
  const answer: Post = {
    ...post("p-1-r1"),
    id: "m-1-r1",
    parentId: "m-1",
    authorId: "r-sumire",
  };
  // My reply on another's post, folded by readers: its page is that post's.
  const myReply: Post = {
    ...post("p-1-r1"),
    id: "m-2",
    authorId: ME_ID,
    folded: true,
    likers: liked,
  };
  // A reply whose post is not here keeps the old way.
  const astray: Post = { ...myReply, id: "m-3", parentId: "gone" };
  const state = {
    ...seedState,
    posts: [...seedState.posts, mine, answer, myReply, astray],
    following: ["shop-orbit"],
  };
  const href = (id: string) =>
    notificationsFor(state).find((notice) => notice.id === id)?.href;
  assert.equal(href("reply:m-1-r1"), "/post/?id=m-1");
  assert.equal(href("likes:m-1:1"), "/post/?id=m-1");
  assert.equal(href("likes:m-2:1"), "/post/?id=p-1");
  assert.equal(href("folded:m-2"), "/post/?id=p-1");
  assert.equal(href("folded:m-3"), "/profiles/me/");
  assert.equal(href("likes:m-3:1"), "/profiles/me/");
  // 軌道書房's owner (凪) wrote p-1.
  assert.equal(href("follow:p-1"), "/post/?id=p-1");
  // Nor to a page that would not open: its post left out by 出さない, or
  // written by a reader not in the town.
  const hiddenPost = {
    ...state,
    posts: state.posts.map((entry) =>
      entry.id === "p-1" ? { ...entry, spoiler: true } : entry,
    ),
    settings: { ...state.settings, spoilerDisplay: "leave_out" as const },
  };
  assert.equal(
    notificationsFor(hiddenPost).find(
      (notice) => notice.id === "likes:m-2:1",
    )?.href,
    "/profiles/me/",
  );
  const stranger: Post = { ...post("p-1"), id: "s-1", authorId: "r-gone" };
  const toStranger: Post = { ...myReply, id: "m-4", parentId: "s-1" };
  const unknown = {
    ...state,
    posts: [...state.posts, stranger, toStranger],
  };
  assert.equal(
    notificationsFor(unknown).find(
      (notice) => notice.id === "likes:m-4:1",
    )?.href,
    "/profiles/me/",
  );
});

console.log(`letter ok (${passed})`);
