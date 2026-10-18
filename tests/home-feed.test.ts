import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  LETTERS_MAX,
  TOWN_MAX,
  authorOf,
  createFirstStepsBegun,
  FIRST_STEPS_KEY,
  firstSteps,
  followedAuthors,
  followedLetters,
  homeLetters,
  isNewcomer,
  isQuiet,
  letterOf,
  ownLettersSince,
  showsFirstSteps,
  sinceMark,
  weave,
} from "../src/lib/home-feed";
import {
  LAST_OPEN_KEY,
  createLastOpen,
  readOpened,
} from "../src/lib/last-open";
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

check(
  "はじめの3つ: each step ticked when done, shown until all three are",
  () => {
    // Nothing in the library: no mark, record, post, poster, nine or like.
    const empty = town({
      library: [],
      wishlist: [],
      favorites: [],
      finishedBooks: [],
      readingRecords: [],
      readingSessions: [],
      libraryEntries: {},
      libraryShelves: [],
      likedPosts: [],
      wantedPosts: [],
      popReactions: {},
      posts: seedState.posts.filter((entry) => entry.authorId !== ME_ID),
      posters: seedState.posters.filter((entry) => entry.authorId !== ME_ID),
      me: { ...seedState.me, lifeNine: [] },
      ownShop: null,
    });
    assert.deepEqual(firstSteps(empty), {
      book: false,
      shelf: false,
      shop: false,
    });
    // A book in the library however it came in ticks 本を登録 (AUD-148).
    assert.equal(
      firstSteps({ ...empty, wishlist: [seedState.books[0].id] }).book,
      true,
    );
    assert.equal(showsFirstSteps(empty), true);
    const shelf = {
      ...structuredClone(seedState.libraryShelves[0] ?? {}),
      id: "shelf-1",
      deletedAt: null,
    } as TownState["libraryShelves"][number];
    // Opening the shop first does not end them, as isNewcomer would.
    const opened = { ...empty, ownShop: seedState.shops[0] };
    assert.equal(isNewcomer(opened), false);
    assert.equal(showsFirstSteps(opened), true);
    const all = {
      ...opened,
      library: [seedState.books[0].id],
      libraryShelves: [shelf],
    };
    assert.deepEqual(firstSteps(all), { book: true, shelf: true, shop: true });
    assert.equal(showsFirstSteps(all), false);
    // A reader already with others is not shown them...
    const followed = { ...empty, following: ["shop-orbit"] };
    const posted = {
      ...empty,
      posts: [...seedState.posts, post("mine", ME_ID, NOW)],
    };
    assert.equal(showsFirstSteps(followed), false);
    assert.equal(showsFirstSteps(posted), false);
    // ...but one shown them before keeps them until all three are done, a
    // follow or a post on the way notwithstanding (けにー 10-18).
    assert.equal(showsFirstSteps(followed, true), true);
    assert.equal(showsFirstSteps(posted, true), true);
    assert.equal(
      showsFirstSteps({ ...all, following: ["shop-orbit"] }, true),
      false,
    );
  },
);

check("はじめの3つ begun are kept per reader in this browser", () => {
  const store = new Map<string, string>();
  const begun = createFirstStepsBegun(() => ({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  }));
  assert.equal(begun.has("ben"), false);
  begun.mark("ben");
  assert.equal(begun.has("ben"), true);
  assert.equal(begun.has("visitor"), false);
  assert.deepEqual([...store.keys()], [FIRST_STEPS_KEY + "ben"]);
  // Closed storage keeps nothing and says nothing was begun.
  const closed = createFirstStepsBegun(() => {
    throw new Error("closed");
  });
  closed.mark("ben");
  assert.equal(closed.has("ben"), false);
});

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

check("便りだけ is the followed shops' owners' and the reader's", () => {
  assert.deepEqual(followedAuthors(town()), [ME_ID]);
  assert.deepEqual(
    followedAuthors(town({ following: ["shop-orbit", "shop-question"] })),
    [ME_ID, "r-nagi", "r-tou"],
  );
});

check(
  "「前に開いたのはここまで」 goes before the first 便り from before the last opening",
  () => {
    const HOUR = 60 * 60 * 1000;
    const letters = followedLetters(
      town({
        following: ["shop-orbit"],
        posts: [
          ...seedState.posts,
          post("new-1", "r-nagi", NOW + 2 * HOUR),
          post("new-2", "r-nagi", NOW + HOUR),
        ],
      }),
    );
    assert.deepEqual(ids(letters).slice(0, 3), ["new-1", "new-2", "p-m1"]);
    // Others' came since: the line is above the first from before.
    assert.equal(sinceMark(letters, NOW), "p-m1");
    // Exactly at the opening counts as before it.
    assert.equal(sinceMark(letters, NOW + HOUR), "new-2");
    // A first opening: no line.
    assert.equal(sinceMark(letters, null), null);
    // Everything came since, or nothing did: no line.
    assert.equal(sinceMark(letters, 0), null);
    assert.equal(sinceMark(letters, NOW + 3 * HOUR), null);
    assert.equal(sinceMark([], NOW), null);
    // Only the reader's own above it: nothing came from others.
    const own = followedLetters(
      town({
        following: ["shop-orbit"],
        posts: [...seedState.posts, post("mine", ME_ID, NOW + HOUR)],
      }),
    );
    assert.equal(sinceMark(own, NOW), null);
  },
);

check(
  "the last opening is read once a page, and this one kept for the next",
  () => {
    const kept = new Map<string, string>();
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
    let now = NOW;
    const first = createLastOpen(
      () => storage,
      () => now,
    );
    assert.equal(first.opened(), null, "a first opening");
    first.keep();
    assert.equal(kept.get(LAST_OPEN_KEY), String(NOW));
    now += 60_000;
    // Back on Home in the same page: the same line, and kept once.
    first.keep();
    assert.equal(first.opened(), null);
    assert.equal(kept.get(LAST_OPEN_KEY), String(NOW));
    // The next page reads it.
    const next = createLastOpen(
      () => storage,
      () => now,
    );
    assert.equal(next.opened(), NOW);
    next.keep();
    assert.equal(next.opened(), NOW);
    assert.equal(kept.get(LAST_OPEN_KEY), String(now));
    // Kept before the panes read it (they draw once the time is known):
    // they still read the opening before.
    const opening = now;
    now += 60_000;
    const third = createLastOpen(
      () => storage,
      () => now,
    );
    third.keep();
    assert.equal(third.opened(), opening);
    // What cannot be a past moment is as a first opening.
    for (const value of ["", "abc", "-5", "1.5", String(NOW + 120_000)])
      assert.equal(readOpened(value, NOW + 60_000), null, value);
    assert.equal(readOpened(String(NOW), NOW), NOW);
    // No storage, or one that throws: a first opening, and nothing breaks.
    const blocked = createLastOpen(
      () => ({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      }),
      () => now,
    );
    assert.equal(blocked.opened(), null);
    blocked.keep();
    assert.equal(
      createLastOpen(
        () => null,
        () => now,
      ).opened(),
      null,
    );
  },
);

console.log(`home-feed ok (${passed})`);
