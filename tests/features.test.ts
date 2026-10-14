import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  BOARD_PICKS,
  FEATURE_MIN,
  boardPicks,
  exhibitionFeature,
  exhibitionPick,
  exhibitionPosters,
  popsFeature,
  reviewsFeature,
  shelvesFeature,
  shopCovers,
} from "../src/lib/features";
import {
  ME_ID,
  reviewKey,
  type Post,
  type Shop,
  type TownState,
} from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-12T12:00:00+09:00");
const town = (change: Partial<TownState> = {}): TownState => ({
  ...structuredClone(seedState),
  ...change,
});
const review = (
  id: string,
  authorId: string,
  daysAgo: number,
  extra: Partial<Post> = {},
): Post => ({
  id,
  authorId,
  body: "読んでよかった " + id,
  bookId: "solaris",
  spoiler: false,
  parentId: null,
  createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
  likes: 0,
  wants: 0,
  readingMode: null,
  ...extra,
});
const ids = (list: { id: string }[]) => list.map((entry) => entry.id);
/** Every shop with its shelves made private. */
const privateShelves = (shop: Shop): Shop => ({
  ...shop,
  shelves: shop.shelves.map((shelf) => ({ ...shelf, isPublic: false })),
});

check("企画展: published posters open to this reader, newest first", () => {
  const all = ids(exhibitionPosters(town()));
  assert.deepEqual(all, [
    "poster-shiori-look-again",
    "poster-sou-slow",
    "poster-sumire-weekend",
    "poster-nagi-night-sf",
  ]);
  // The spoiler poster is behind its door: never a 企画展.
  assert.ok(!all.includes("poster-haru-last-page"));
  assert.equal(exhibitionPick(town())?.id, "poster-shiori-look-again");
  // Folded by reports, or reported by the reader: left out, not shown folded.
  const folded = town({
    reviewFolds: {
      [reviewKey("poster", "poster-sou-slow")]: {
        state: "folded",
        since: "2026-10-12T00:00:00Z",
      },
    },
  });
  assert.ok(!ids(exhibitionPosters(folded)).includes("poster-sou-slow"));
  // A draft is its maker's own.
  const drafts = town({
    posters: seedState.posters.map((poster) => ({
      ...poster,
      status: "draft" as const,
    })),
  });
  assert.equal(exhibitionPick(drafts), null);
});

check("a 企画展 band repeats no poster already shown, and needs two", () => {
  const shown = new Set(["poster-shiori-look-again"]);
  assert.deepEqual(ids(exhibitionFeature(town(), shown)!.posters), [
    "poster-sou-slow",
    "poster-sumire-weekend",
    "poster-nagi-night-sf",
  ]);
  shown.add("poster-sou-slow").add("poster-sumire-weekend");
  assert.equal(exhibitionFeature(town(), shown), null);
  assert.equal(FEATURE_MIN.exhibition, 2);
});

check(
  "本棚をのぞく: others' shops, by their public shelves only, three or more",
  () => {
    const feature = shelvesFeature(town(), NOW)!;
    assert.ok(feature.shops.length >= FEATURE_MIN.shelves);
    // Covers come from public shelves only.
    for (const shop of feature.shops)
      for (const book of shopCovers(town(), shop)) {
        const shelf = shop.shelves.find((entry) =>
          entry.items.some((item) => item.bookId === book.id),
        )!;
        assert.ok(
          shop.shelves.some(
            (entry) =>
              entry.isPublic &&
              entry.items.some((item) => item.bookId === book.id),
          ),
          `${shop.id}: ${book.id} on ${shelf.name}`,
        );
      }
    // A shop with only private shelves is not there; under three, no band.
    const closed = town({
      shops: seedState.shops.map((shop, at) =>
        at < 4 ? privateShelves(shop) : shop,
      ),
    });
    assert.equal(shelvesFeature(closed, NOW), null);
    const fewer = town({
      shops: seedState.shops.map((shop, at) =>
        at < 2 ? privateShelves(shop) : shop,
      ),
    });
    for (const shop of shelvesFeature(fewer, NOW)!.shops)
      assert.ok(shop.shelves.some((shelf) => shelf.isPublic));
    // Never one's own shop.
    const own = { ...seedState.shops[0], ownerId: ME_ID };
    const mine = town({
      shops: [own, ...seedState.shops.slice(1)],
      ownShop: own,
    });
    assert.ok(!ids(shelvesFeature(mine, NOW)!.shops).includes(own.id));
  },
);

check(
  "感想が面白い本: open, recent, one per writer, none already in the 便り",
  () => {
    const posts = [
      review("r1", "r-nagi", 1),
      review("r2", "r-nagi", 2), // the same writer: only the newest
      review("r3", "r-haru", 3),
      review("r4", "r-tou", 4),
      review("old", "r-sou", 15), // older than two weeks
      review("spoiler", "r-shiori", 1, { spoiler: true }),
      review("hidden", "r-sumire", 1, { body: "ここは||犯人||が" }),
      review("together", "r-sou", 1, { readingMode: "together" }),
      review("solo", "r-sou", 1, { readingMode: "solo" }),
      review("reply", "r-sou", 1, { parentId: "r1" }),
      review("nobook", "r-sou", 1, { bookId: null }),
      review("mine", ME_ID, 1),
      review("covered", "r-shiori", 2),
    ];
    const state = town({
      posts,
      reviewFolds: {
        [reviewKey("post", "covered")]: {
          state: "folded",
          since: "2026-10-12T00:00:00Z",
        },
      },
    });
    assert.deepEqual(ids(reviewsFeature(state, NOW)!.posts), [
      "r1",
      "r3",
      "r4",
    ]);
    // One already in the home's 便り leaves the band under three: none.
    assert.equal(reviewsFeature(state, NOW, new Set(["r3"])), null);
    // The reader's own report covers it for them too.
    const reported = town({
      posts,
      reviewFolds: state.reviewFolds,
      myReports: [
        {
          ...({} as TownState["myReports"][number]),
          kind: "post",
          targetId: "r4",
        },
      ],
    });
    assert.equal(reviewsFeature(reported, NOW), null);
  },
);

check("本屋のPOP: one public POP per shop, the day's, three or more", () => {
  const feature = popsFeature(town(), NOW)!;
  const shops = feature.pops.map((pop) => pop.shop.id);
  assert.equal(new Set(shops).size, shops.length);
  assert.ok(feature.pops.length >= FEATURE_MIN.pops);
  for (const pop of feature.pops) {
    assert.ok(pop.shelf.isPublic, pop.shelf.name);
    assert.ok(pop.item.pop.trim());
  }
  // The same within the day; private shelves' POPs never.
  assert.deepEqual(
    popsFeature(town(), NOW + 60_000)!.pops.map((pop) => pop.item.id),
    feature.pops.map((pop) => pop.item.id),
  );
  const closed = town({
    shops: seedState.shops.map((shop, at) =>
      at < 4 ? privateShelves(shop) : shop,
    ),
  });
  assert.equal(popsFeature(closed, NOW), null);
});

check(
  "the 見本 掲示板 picks one book a 見本 shop shows, never a private shelf or a real shop",
  () => {
    const picks = boardPicks(town(), NOW);
    assert.equal(picks.length, BOARD_PICKS);
    assert.equal(new Set(picks.map((pick) => pick.shop.id)).size, BOARD_PICKS);
    for (const pick of picks) {
      assert.ok(pick.shelf.isPublic, pick.shelf.id);
      assert.ok(pick.shelf.items.includes(pick.item));
    }
    // The same all day.
    assert.deepEqual(
      boardPicks(town(), NOW + 3 * 60 * 60 * 1000).map((pick) => pick.item.id),
      picks.map((pick) => pick.item.id),
    );
    // Private shelves are never pinned up.
    assert.deepEqual(
      boardPicks(town({ shops: seedState.shops.map(privateShelves) }), NOW),
      [],
    );
    // A real shop's choice is its own to make: the board takes none.
    const real = seedState.shops.map((shop, at) => ({
      ...shop,
      id: `0000000${at}-0000-4000-8000-000000000000`,
      demo: false,
    }));
    assert.deepEqual(boardPicks(town({ shops: real }), NOW), []);
  },
);

console.log(`features ok (${passed})`);
