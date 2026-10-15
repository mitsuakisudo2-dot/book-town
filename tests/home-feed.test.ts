import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  LETTERS_MAX,
  TOWN_MAX,
  authorOf,
  followedLetters,
  homeLetters,
  isNewcomer,
  isQuiet,
  letterOf,
  ownLettersSince,
  weave,
} from "../src/lib/home-feed";
import { ME_ID, type Post, type TownState } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;
/** Two days after the demo's newest post. */
const NOW = Date.parse("2026-10-12T12:00:00+09:00");
const town = (change: Partial<TownState> = {}): TownState => ({
  ...structuredClone(seedState),
  ...change,
});
const post = (
  id: string,
  authorId: string,
  createdAt: number,
  extra: Partial<Post> = {},
): Post => ({
  id,
  authorId,
  body: "言葉 " + id,
  bookId: null,
  spoiler: false,
  parentId: null,
  createdAt: new Date(createdAt).toISOString(),
  likes: 0,
  wants: 0,
  readingMode: null,
  ...extra,
});
const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);

check(
  "a first-time reader has no shop, follows nobody and has not posted",
  () => {
    assert.equal(isNewcomer(town()), true);
    assert.equal(isNewcomer(town({ following: ["shop-orbit"] })), false);
    assert.equal(
      isNewcomer(
        town({ posts: [...seedState.posts, post("mine", ME_ID, NOW)] }),
      ),
      false,
    );
    assert.equal(isNewcomer(town({ ownShop: seedState.shops[0] })), false);
    // A first-timer is never "quiet": they get the town's 便り instead.
    assert.equal(isQuiet(town(), NOW), false);
  },
);

check("a first-timer's 便り are the town's, newest first, at most ten", () => {
  const { followed, town: others } = homeLetters(town(), NOW);
  assert.deepEqual(followed, []);
  assert.equal(others.length, TOWN_MAX);
  const times = others.map((entry) => entry.at);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
  // Top-level public posts only: no replies, nothing written alone.
  for (const entry of others)
    if (entry.kind === "post") assert.equal(entry.post.parentId, null);
});

check(
  "followed 便り come first; a quiet fortnight is topped up with the town's",
  () => {
    const following = town({ following: ["shop-orbit"] });
    const { followed, town: others } = homeLetters(following, NOW);
    assert.ok(followed.length > 0);
    for (const entry of followed)
      assert.ok(["r-nagi", ME_ID].includes(authorOf(entry)), entry.id);
    // Under six from the last fortnight: the town's follow, none twice.
    assert.ok(others.length > 0);
    for (const entry of others) assert.ok(!ids(followed).includes(entry.id));
    // Six recent ones from those followed: no top-up.
    const busy = town({
      following: ["shop-orbit"],
      posts: [
        ...seedState.posts,
        ...Array.from({ length: 6 }, (_, at) =>
          post(`n-${at}`, "r-nagi", NOW - at * DAY),
        ),
      ],
    });
    assert.deepEqual(homeLetters(busy, NOW).town, []);
    // Six that are older than two weeks still leave it quiet.
    const old = town({
      following: ["shop-orbit"],
      posts: Array.from({ length: 6 }, (_, at) =>
        post(`o-${at}`, "r-nagi", NOW - (15 + at) * DAY),
      ),
      posters: [],
    });
    assert.equal(homeLetters(old, NOW).town.length, 0); // nobody else to read
    assert.equal(isQuiet(old, NOW), true);
    assert.equal(isQuiet(busy, NOW), false);
  },
);

check(
  "ホーム holds at most twenty followed 便り; 便りだけ holds them all",
  () => {
    const many = town({
      following: ["shop-orbit"],
      posts: Array.from({ length: 30 }, (_, at) =>
        post(`m-${at}`, "r-nagi", NOW - at * 60_000),
      ),
    });
    const { followed } = homeLetters(many, NOW);
    assert.equal(followed.length, LETTERS_MAX);
    assert.equal(followed[0].id, "m-0");
    assert.ok(followedLetters(many).length >= 30);
  },
);

check("a memo read alone is the reader's own: never among the 便り", () => {
  // Written while reading alone (solo): by someone followed, by someone
  // not, and by the reader; a memo read together stays, with its tag.
  const memos = [
    post("solo-followed", "r-nagi", NOW - 60_000, {
      bookId: "solaris",
      readingMode: "solo",
    }),
    post("solo-other", "r-sou", NOW - 60_000, {
      bookId: "silence",
      readingMode: "solo",
    }),
    post("solo-mine", ME_ID, NOW - 60_000, {
      bookId: "momo",
      readingMode: "solo",
    }),
    post("together", "r-sou", NOW - 120_000, {
      bookId: "silence",
      readingMode: "together",
    }),
  ];
  const state = town({
    following: ["shop-orbit"],
    posts: [...seedState.posts, ...memos],
  });
  const { followed, town: others } = homeLetters(state, NOW);
  const shown = ids([...followed, ...others]);
  assert.ok(others.length > 0, "a quiet day is topped up");
  for (const id of ["solo-followed", "solo-other", "solo-mine"])
    assert.ok(!shown.includes(id), id);
  assert.ok(shown.includes("together"));
  assert.ok(!ids(followedLetters(state)).includes("solo-followed"));
  assert.ok(!ids(followedLetters(state)).includes("solo-mine"));
});

check("posters ride in the 便り beside posts, by their time", () => {
  const following = town({ following: ["shop-orbit", "shop-rain"] });
  const letters = followedLetters(following);
  assert.ok(
    letters.some((entry) => entry.id === "poster:poster-nagi-night-sf"),
  );
  const times = letters.map((entry) => entry.at);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
});

check(
  "weave: a feature after every two 便り, never two together while 便り last",
  () => {
    const letters = ["a", "b", "c", "d", "e", "f", "g"];
    const woven = weave(letters, ["F1", "F2", "BOARD", "F4"]);
    assert.deepEqual(
      woven.map((slot) =>
        slot.kind === "letter" ? slot.letter : slot.feature,
      ),
      ["a", "b", "F1", "c", "d", "F2", "e", "f", "BOARD", "g", "F4"],
    );
    // The board keeps the third slot when one before it is skipped.
    const skipped = weave(letters, [null, "F2", "BOARD"]);
    assert.deepEqual(
      skipped.map((slot) =>
        slot.kind === "letter" ? slot.letter : slot.feature,
      ),
      ["a", "b", "c", "d", "F2", "e", "f", "BOARD", "g"],
    );
    // With no 便り, the features follow one another, nulls left out.
    assert.deepEqual(
      weave([], ["F1", null, "BOARD"]).map((slot) =>
        slot.kind === "feature" ? slot.feature : "?",
      ),
      ["F1", "BOARD"],
    );
    // Two 便り and three features: one between, the rest after.
    assert.deepEqual(
      weave(["a", "b"], ["F1", "F2", "BOARD"]).map((slot) =>
        slot.kind === "letter" ? slot.letter : slot.feature,
      ),
      ["a", "b", "F1", "F2", "BOARD"],
    );
  },
);

check(
  "a held list reads its 便り again by id, and takes in only the reader's own new ones",
  () => {
    const state = town({ following: ["shop-orbit"] });
    const drawn = followedLetters(state);
    // Read again as they are now: a like changes the card, not the list.
    const liked = town({
      following: ["shop-orbit"],
      posts: state.posts.map((entry) =>
        entry.id === drawn[0].id ? { ...entry, likes: entry.likes + 1 } : entry,
      ),
    });
    const again = letterOf(liked, drawn[0].id);
    assert.ok(again?.kind === "post" && again.post.likes > 0);
    assert.equal(
      letterOf(state, "poster:poster-nagi-night-sf")?.kind,
      "poster",
    );
    // Gone: nothing to draw.
    assert.equal(letterOf(town({ posts: [] }), drawn[0].id), null);
    // Another's new 便り waits; the reader's own comes in.
    const since = NOW;
    const later = town({
      following: ["shop-orbit"],
      posts: [
        ...seedState.posts,
        post("theirs", "r-nagi", NOW + 60_000),
        post("mine", ME_ID, NOW + 60_000),
        post("mine-before", ME_ID, NOW - 60_000),
      ],
    });
    assert.deepEqual(ids(ownLettersSince(later, since)), ["mine"]);
  },
);

console.log(`home-feed ok (${passed})`);
