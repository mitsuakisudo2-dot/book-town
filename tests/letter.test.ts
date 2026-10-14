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
import { spoilerBookOf } from "../src/lib/social";
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

check("a spoiler's book is the post's, else the one it answers", () => {
  assert.equal(spoilerBookOf(seedState, post("p-7")), "left-hand");
  // A reply without a book takes its post's.
  assert.equal(spoilerBookOf(seedState, post("p-7-r1")), "left-hand");
  // A reply that recommends a book is about that book.
  assert.equal(spoilerBookOf(seedState, post("p-1-r2")), "left-hand");
  // Words with no book, and a reply to a post that is gone, have none.
  assert.equal(spoilerBookOf(seedState, post("p-2")), null);
  const orphan: Post = { ...post("p-7-r1"), parentId: "gone" };
  assert.equal(spoilerBookOf(seedState, orphan), null);
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
        ? { ...record, isPublic: false }
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

console.log(`letter ok (${passed})`);
