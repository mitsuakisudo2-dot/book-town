import assert from "node:assert/strict";
import { emptyArrived } from "../src/lib/arrived";
import { freshFor } from "../src/lib/arrivals";
import { seedState } from "../src/lib/data";
import {
  RECENT_DAYS,
  RECENT_ENOUGH,
  followedLetters,
  homeLetters,
} from "../src/lib/home-feed";
import {
  LIVE_DAYS,
  LIVE_MAX,
  LIVE_MIN,
  guardedWorks,
  isGuarded,
  isLiveLine,
  liveIds,
  liveLines,
  liveRows,
  newLines,
  togetherIds,
} from "../src/lib/live";
import { ME_ID, reviewKey, type Post, type TownState } from "../src/lib/types";

// 読みながらのひとこと (Live, PR 2b): which memos are its lines, the band
// only from three, what leaves ホーム's 便り, the stand-in for a book being
// read, and the lines that come in at the box's top.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
/** Two days after the demo's four memos (10-10, 20:55 to 21:40). */
const NOW = Date.parse("2026-10-12T12:00:00+09:00");
const town = (change: Partial<TownState> = {}): TownState => ({
  ...structuredClone(seedState),
  ...change,
});
/** A memo written while reading together, `minutes` after NOW. */
const memo = (
  id: string,
  authorId: string,
  minutes: number,
  extra: Partial<Post> = {},
): Post => ({
  id,
  authorId,
  body: "ひとこと " + id,
  bookId: "solaris",
  spoiler: false,
  parentId: null,
  createdAt: new Date(NOW + minutes * MIN).toISOString(),
  likes: 0,
  wants: 0,
  readingMode: "together",
  ...extra,
});
const withPosts = (...posts: Post[]) =>
  town({ posts: [...seedState.posts, ...posts] });
const ids = (entries: { id: string }[] | null) =>
  entries?.map((entry) => entry.id) ?? null;
/** The demo's four memos, newest first. */
const DEMO = ["p-m4", "p-m2", "p-m1", "p-m3"];

check("the demo's four memos are Live's lines, newest first", () => {
  assert.deepEqual(ids(liveLines(town(), NOW)), DEMO);
  assert.deepEqual([...liveIds(town(), NOW)], DEMO);
});

check(
  "a line is another reader's top-level memo read together, of a known book and writer",
  () => {
    const state = town();
    const line = (extra: Partial<Post>) =>
      isLiveLine(state, memo("x", "r-nagi", -60, extra), NOW);
    assert.equal(line({}), true);
    // Read alone, a plain post, a reply: not Live's.
    assert.equal(line({ readingMode: "solo" }), false);
    assert.equal(line({ readingMode: null }), false);
    assert.equal(line({ parentId: "p-m1" }), false);
    // The reader's own: never.
    assert.equal(line({ authorId: ME_ID }), false);
    // No book, or one the town does not know; a writer it does not know.
    assert.equal(line({ bookId: null }), false);
    assert.equal(line({ bookId: "no-such-book" }), false);
    assert.equal(line({ authorId: "r-nobody" }), false);
  },
);

check(`a line is from the last ${LIVE_DAYS} days`, () => {
  const state = town();
  const at = (minutes: number) =>
    isLiveLine(state, memo("x", "r-nagi", minutes), NOW);
  assert.equal(at(-LIVE_DAYS * 24 * 60), true);
  assert.equal(at(-LIVE_DAYS * 24 * 60 - 1), false);
  // Six days on from the demo's memos they are still there; eight, gone.
  assert.notEqual(liveLines(town(), NOW + 4 * DAY), null);
  assert.equal(liveLines(town(), NOW + 6 * DAY), null);
});

check(
  "a spoiler stays a line (in its box); one left out or folded by reports does not",
  () => {
    const spoiler = memo("s", "r-nagi", -60, { spoiler: true });
    assert.equal(isLiveLine(town(), spoiler, NOW), true);
    // 「ネタバレの表示」 出さない: it never reaches this reader.
    const leaveOut = town({
      settings: { ...seedState.settings, spoilerDisplay: "leave_out" },
    });
    assert.equal(isLiveLine(leaveOut, spoiler, NOW), false);
    // Folded by three readers' reports, or reported by this reader.
    const plain = memo("r", "r-nagi", -60);
    const folded = town({
      reviewFolds: {
        [reviewKey("post", "r")]: { state: "folded", since: "2026-10-12" },
      },
    });
    assert.equal(isLiveLine(folded, plain, NOW), false);
    const reported = town({
      myReports: [
        {
          id: "report-1",
          kind: "post",
          targetId: "r",
          reason: "spoiler",
          status: "open",
          createdAt: "2026-10-12T00:00:00Z",
          statusAt: "2026-10-12T00:00:00Z",
        },
      ],
    });
    assert.equal(isLiveLine(reported, plain, NOW), false);
  },
);

check(`at most ${LIVE_MAX} lines, and no band at all below ${LIVE_MIN}`, () => {
  const many = withPosts(
    memo("n1", "r-haru", -1),
    memo("n2", "r-sou", -2),
    memo("n3", "r-tou", -3),
  );
  const lines = liveLines(many, NOW);
  assert.equal(lines?.length, LIVE_MAX);
  assert.deepEqual(ids(lines), ["n1", "n2", "n3", "p-m4", "p-m2", "p-m1"]);
  // Two memos are no band: no empty frame, no number.
  const two = town({
    posts: seedState.posts.filter(
      (post) => post.id !== "p-m3" && post.id !== "p-m4",
    ),
  });
  assert.equal(liveLines(two, NOW), null);
  assert.equal(liveIds(two, NOW).size, 0);
  const three = town({
    posts: seedState.posts.filter((post) => post.id !== "p-m4"),
  });
  assert.equal(liveLines(three, NOW)?.length, LIVE_MIN);
});

check(
  "Live's memos leave ホーム's 便り, but stay in 便りだけ; without a band they stay where they were",
  () => {
    // A reader who follows every shop: the memos' writers are followed.
    const following = seedState.shops.map((shop) => shop.id);
    const state = town({ following });
    const all = (letters: ReturnType<typeof homeLetters>) => [
      ...ids(letters.followed)!,
      ...ids(letters.town)!,
    ];
    const home = all(homeLetters(state, NOW, liveIds(state, NOW)));
    for (const id of DEMO) assert.equal(home.includes(id), false, id);
    const letters = ids(followedLetters(state))!;
    for (const id of DEMO) assert.equal(letters.includes(id), true, id);
    // Two memos: no band, and they are 便り on ホーム as before.
    const quiet = town({
      following,
      posts: seedState.posts.filter(
        (post) => post.id !== "p-m3" && post.id !== "p-m4",
      ),
    });
    const kept = all(homeLetters(quiet, NOW, liveIds(quiet, NOW)));
    assert.equal(kept.includes("p-m1"), true);
    assert.equal(kept.includes("p-m2"), true);
  },
);

check(
  "the pill counts no memo the Live box drawn takes in; with no box, it counts them",
  () => {
    const following = seedState.shops.map((shop) => shop.id);
    const state = town({ following });
    const arrived = {
      ...emptyArrived(),
      posts: [
        memo("new-memo", "r-nagi", 1),
        memo("new-letter", "r-nagi", 2, {
          readingMode: null,
        }),
        // Read together, but of no book: no line of Live, a 便り.
        memo("no-book", "r-nagi", 3, { bookId: null }),
      ],
    };
    const drawn = { ids: DEMO, known: togetherIds(state), at: NOW };
    const fresh = freshFor(state, arrived, NOW + 4 * MIN, drawn);
    assert.deepEqual(ids(fresh.home), ["no-book", "new-letter"]);
    // 便りだけ keeps memos as 便り.
    assert.deepEqual(ids(fresh.letters), ["no-book", "new-letter", "new-memo"]);
    // ホーム drawn with two memos has no box: a third that comes is a new
    // 便り there, not Live's (there is nothing to take it in).
    const quiet = town({
      following,
      posts: seedState.posts.filter(
        (post) => post.id !== "p-m3" && post.id !== "p-m4",
      ),
    });
    assert.equal(liveLines(quiet, NOW), null);
    const one = { ...emptyArrived(), posts: [memo("new-memo", "r-nagi", 1)] };
    assert.deepEqual(ids(freshFor(quiet, one, NOW + 2 * MIN).home), [
      "new-memo",
    ]);
    // A box drawn with three lines that has lost one since still takes in
    // what comes.
    assert.deepEqual(
      ids(
        freshFor(quiet, one, NOW + 2 * MIN, {
          ids: ["p-m2", "p-m1", "p-m4"],
          known: new Set(DEMO),
          at: NOW,
        }).home,
      ),
      [],
    );
  },
);

check(
  "a line taken into the town since the box was drawn is still the box's, so a quiet ホーム stays quiet",
  () => {
    // A reader who follows ナギ, one 便り of late short of a busy ホーム.
    let state = town({ following: ["shop-orbit"] });
    const late = (now: TownState) =>
      homeLetters(now, NOW, liveIds(now, NOW)).followed.filter(
        (entry) => entry.at >= NOW - RECENT_DAYS * DAY,
      ).length;
    for (let k = 0; late(state) < RECENT_ENOUGH - 1; k++)
      state = {
        ...state,
        posts: [
          ...state.posts,
          memo("f" + k, "r-nagi", -100 - k, {
            bookId: null,
            readingMode: null,
          }),
        ],
      };
    const drawn = {
      ids: [...liveIds(state, NOW)],
      known: togetherIds(state),
      at: NOW,
    };
    // ナギ's memo came into the box, and a tap on it took it into the town;
    // then a 便り of someone not followed comes.
    const taken = { ...state, posts: [...state.posts, memo("m", "r-nagi", 2)] };
    const letter = {
      ...emptyArrived(),
      posts: [memo("l", "r-tou", 3, { bookId: null, readingMode: null })],
    };
    assert.deepEqual(ids(freshFor(taken, letter, NOW + 4 * MIN, drawn).home), [
      "l",
    ]);
    // Read back by asking (an older page), it was never the box's.
    const asked = { ...taken, readAfter: { m: "older" as const } };
    assert.deepEqual(
      ids(freshFor(asked, letter, NOW + 4 * MIN, drawn).home),
      [],
    );
  },
);

check("what Live knew when drawn: every memo read together", () => {
  const known = togetherIds(withPosts(memo("n1", "r-haru", -1)));
  for (const id of [...DEMO, "n1"]) assert.equal(known.has(id), true, id);
  assert.equal(known.has("p-1"), false);
});

check(
  "a book on the reader's shelves and not finished waits behind the stand-in: being read, wanted or registered",
  () => {
    const session = (bookId: string | null, endedAt: string | null = null) => ({
      id: "s-" + bookId,
      bookId,
      mode: "together" as const,
      startedAt: "2026-10-12T10:00:00+09:00",
      endedAt,
    });
    const shelved = town({
      readingSessions: [
        session("solaris"),
        session("silence", "2026-10-11T10:00:00+09:00"),
        session(null),
      ],
      wishlist: ["invisible-cities"],
      library: ["left-hand"],
      finishedBooks: ["silence"],
    });
    assert.deepEqual([...guardedWorks(shelved)].sort(), [
      "invisible-cities",
      "left-hand",
      "solaris",
    ]);
    for (const bookId of ["solaris", "invisible-cities", "left-hand"])
      assert.equal(isGuarded(shelved, { bookId }), true, bookId);
    // Finished, or not on the shelves at all: as it is.
    assert.equal(isGuarded(shelved, { bookId: "silence" }), false);
    assert.equal(isGuarded(shelved, { bookId: "momo" }), false);
    assert.equal(isGuarded(shelved, { bookId: null }), false);
    // An ended session's book, not finished, still waits (until DB-1).
    const ended = town({
      readingSessions: [session("solaris", "2026-10-11T10:00:00+09:00")],
    });
    assert.equal(isGuarded(ended, { bookId: "solaris" }), true);
    assert.equal(isGuarded(town(), { bookId: "solaris" }), false);
    // By the work: another edition shelved holds it, one finished frees it.
    const bunko = {
      ...seedState.books.find((book) => book.id === "solaris")!,
      id: "solaris-bunko",
      workId: "solaris",
    };
    const editions = town({
      books: [...seedState.books, bunko],
      wishlist: ["solaris-bunko"],
    });
    assert.equal(isGuarded(editions, { bookId: "solaris" }), true);
    assert.equal(
      isGuarded(
        { ...editions, finishedBooks: ["solaris"] },
        {
          bookId: "solaris-bunko",
        },
      ),
      false,
    );
  },
);

check(
  "the box's lines: those come in at the top, then those it was drawn with, read again",
  () => {
    const state = withPosts(memo("n1", "r-haru", 1), memo("n2", "r-sou", 2));
    assert.deepEqual(ids(liveRows(state, DEMO, ["n2", "n1"], NOW)), [
      "n2",
      "n1",
      "p-m4",
      "p-m2",
      "p-m1",
      "p-m3",
    ]);
    // At most six; one in both is there once.
    const more = withPosts(
      memo("n1", "r-haru", 1),
      memo("n2", "r-sou", 2),
      memo("n3", "r-tou", 3),
    );
    assert.deepEqual(
      ids(liveRows(more, DEMO, ["n3", "n2", "n1", "p-m4"], NOW)),
      ["n3", "n2", "n1", "p-m4", "p-m2", "p-m1"],
    );
    // One deleted, or reported since, leaves the box.
    const gone = town({
      posts: seedState.posts.filter((post) => post.id !== "p-m2"),
      reviewFolds: {
        [reviewKey("post", "p-m1")]: { state: "folded", since: "2026-10-12" },
      },
    });
    assert.deepEqual(ids(liveRows(gone, DEMO, [], NOW)), ["p-m4", "p-m3"]);
  },
);

check(
  "new lines: memos the box did not know, not in it, not read back by asking, newest first",
  () => {
    const known = togetherIds(town());
    const state = withPosts(
      memo("n1", "r-haru", 1),
      memo("n2", "r-sou", 3),
      memo("n3", "r-tou", 2),
      memo("old", "r-haru", -60),
      memo("reply", "r-haru", 4, { parentId: "p-m1" }),
    );
    const read = {
      ...state,
      readAfter: { old: "older" as const, n4: "alone" as const },
      posts: [...state.posts, memo("n4", "r-tou", 4)],
    };
    assert.deepEqual(ids(newLines(read, known, new Set(DEMO), NOW + 5 * MIN)), [
      "n2",
      "n3",
      "n1",
    ]);
    // One already in the box comes in no more.
    assert.deepEqual(
      ids(newLines(read, known, new Set([...DEMO, "n2"]), NOW + 5 * MIN)),
      ["n3", "n1"],
    );
    // More than six at once: all of them, newest first, so the newest
    // stay on top when they go in (the box keeps six).
    const eight = withPosts(
      ...Array.from({ length: 8 }, (_, n) =>
        memo("w" + (n + 1), "r-haru", n + 1),
      ),
    );
    const flood = newLines(eight, known, new Set(DEMO), NOW + 10 * MIN);
    assert.deepEqual(ids(flood), [
      "w8",
      "w7",
      "w6",
      "w5",
      "w4",
      "w3",
      "w2",
      "w1",
    ]);
    assert.deepEqual(ids(liveRows(eight, DEMO, ids(flood)!, NOW)), [
      "w8",
      "w7",
      "w6",
      "w5",
      "w4",
      "w3",
    ]);
    // What the town had when the box was drawn is not new.
    assert.deepEqual(
      ids(newLines(read, togetherIds(read), new Set(DEMO), NOW + 5 * MIN)),
      [],
    );
  },
);

console.log(`${passed} live checks passed`);
