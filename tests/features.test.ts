import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  BOARD_PICKS,
  FEATURE_MIN,
  boardPicks,
  exhibitionFeature,
  exhibitionPick,
  exhibitionPosters,
  isBoardPick,
  isOpenPop,
  isOpenPoster,
  isOpenReview,
  isOpenShop,
  pickAt,
  placeOf,
  popsFeature,
  reviewsFeature,
  shelvesFeature,
  shopCovers,
} from "../src/lib/features";
import type { Poster } from "../src/lib/posters";
import {
  ME_ID,
  reviewKey,
  type Post,
  type Shelf,
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
/** The reader's own report of something, as the store notes it. */
const reported = (kind: "post" | "poster", targetId: string) =>
  ({
    ...({} as TownState["myReports"][number]),
    kind,
    targetId,
  }) as TownState["myReports"][number];
/**
 * One shop holding a public shelf and a private one, the private one first
 * and with POPs of its own words: what anyone may see is the public shelf.
 */
const SECRET_POP = "ここだけの言葉";
const mixedShop = (shop: Shop): Shop => {
  const [open, hidden] = shop.shelves;
  return {
    ...shop,
    shelves: [
      {
        ...hidden,
        id: "secret",
        isPublic: false,
        items: hidden.items.map((item) => ({ ...item, pop: SECRET_POP })),
      },
      {
        ...open,
        isPublic: true,
        items: open.items.map((item, at) => ({
          ...item,
          pop: at === 0 ? "棚の前で" : "",
        })),
      },
    ],
  };
};
const secretShelf = (shelf: Shelf) => shelf.id === "secret";
/** Each day for `days` days from NOW. */
const days = (count: number) =>
  Array.from({ length: count }, (_, at) => NOW + at * DAY);

check("企画展: published posters open to this reader, newest first", () => {
  const all = ids(exhibitionPosters(town()));
  // poster-sou-slow is kept off the timeline by its maker.
  assert.deepEqual(all, [
    "poster-shiori-look-again",
    "poster-sumire-weekend",
    "poster-nagi-night-sf",
  ]);
  // The spoiler poster is behind its door: never a 企画展.
  assert.ok(!all.includes("poster-haru-last-page"));
  assert.equal(exhibitionPick(town())?.id, "poster-shiori-look-again");
  // Folded by reports, or reported by the reader: left out, not shown folded.
  const folded = town({
    reviewFolds: {
      [reviewKey("poster", "poster-sumire-weekend")]: {
        state: "folded",
        since: "2026-10-12T00:00:00Z",
      },
    },
  });
  assert.deepEqual(ids(exhibitionPosters(folded)), [
    "poster-shiori-look-again",
    "poster-nagi-night-sf",
  ]);
  const mine = town({
    myReports: [reported("poster", "poster-shiori-look-again")],
  });
  assert.deepEqual(ids(exhibitionPosters(mine)), [
    "poster-sumire-weekend",
    "poster-nagi-night-sf",
  ]);
  assert.equal(exhibitionPick(mine)?.id, "poster-sumire-weekend");
  // A draft is its maker's own.
  const drafts = town({
    posters: seedState.posters.map((poster) => ({
      ...poster,
      status: "draft" as const,
    })),
  });
  assert.equal(exhibitionPick(drafts), null);
});

check(
  "企画展 keeps to what the maker put on the timeline, and is never the reader's own",
  () => {
    // 「タイムラインにも出す」 off: the editor promises it shows only on the
    // maker's profile and the books' pages.
    const slow = (inTimeline: boolean) =>
      town({
        posters: seedState.posters.map((poster) =>
          poster.id === "poster-sou-slow" ? { ...poster, inTimeline } : poster,
        ),
      });
    assert.ok(!ids(exhibitionPosters(slow(false))).includes("poster-sou-slow"));
    assert.ok(ids(exhibitionPosters(slow(true))).includes("poster-sou-slow"));
    // The reader's own poster, the newest, put up and on the timeline: they
    // made it, so it is no 企画展 for them.
    const own: Poster = {
      ...seedState.posters.find(
        (poster) => poster.id === "poster-shiori-look-again",
      )!,
      id: "me-poster",
      authorId: ME_ID,
      createdAt: "2026-10-12T11:00:00+09:00",
      updatedAt: "2026-10-12T11:00:00+09:00",
    };
    const withOwn = town({ posters: [...seedState.posters, own] });
    assert.ok(!ids(exhibitionPosters(withOwn)).includes("me-poster"));
    assert.equal(exhibitionPick(withOwn)?.id, "poster-shiori-look-again");
    assert.equal(isOpenPoster(withOwn, own), false);
    assert.equal(isOpenPoster(withOwn, { ...own, authorId: "r-sou" }), true);
  },
);

check("a 企画展 band repeats no poster already shown, and needs two", () => {
  const shown = new Set(["poster-shiori-look-again"]);
  assert.deepEqual(ids(exhibitionFeature(town(), shown)!.posters), [
    "poster-sumire-weekend",
    "poster-nagi-night-sf",
  ]);
  shown.add("poster-sumire-weekend");
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
      // A book the town does not know (or may not see): nothing to show.
      review("unknown", "r-sou", 1, { bookId: "no-such-book" }),
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
    const mine = town({
      posts,
      reviewFolds: state.reviewFolds,
      myReports: [reported("post", "r4")],
    });
    assert.equal(reviewsFeature(mine, NOW), null);
  },
);

check(
  "感想が面白い本 leaves out a post whose book the town does not have",
  () => {
    // Its only post with a book the town knows nothing of, or a book it
    // may not see (a reader's own entry, not listed anywhere public).
    const posts = [
      review("a", "r-nagi", 1),
      review("b", "r-haru", 2),
      review("c", "r-tou", 3, { bookId: "no-such-book" }),
      review("d", "r-sou", 4, { bookId: "laozi" }),
    ];
    assert.deepEqual(ids(reviewsFeature(town({ posts }), NOW)!.posts), [
      "a",
      "b",
      "d",
    ]);
    const unseen = town({
      posts,
      books: seedState.books.filter((book) => book.id !== "laozi"),
    });
    assert.equal(reviewsFeature(unseen, NOW), null);
    assert.equal(isOpenReview(unseen, posts[3], NOW), false);
  },
);

check(
  "a tile held on the home is checked again by the same test that chose it",
  () => {
    const posts = [
      review("r1", "r-nagi", 1),
      review("r3", "r-haru", 3),
      review("r4", "r-tou", 4),
    ];
    const state = town({ posts });
    const chosen = reviewsFeature(state, NOW)!.posts;
    for (const post of chosen) assert.ok(isOpenReview(state, post, NOW));
    // Asked about as a spoiler, or reported, after it was chosen: it fails.
    const asked = town({ posts, spoilerReports: ["r1"] });
    assert.equal(isOpenReview(asked, chosen[0], NOW), false);
    const mine = town({ posts, myReports: [reported("post", "r3")] });
    assert.equal(isOpenReview(mine, chosen[1], NOW), false);
    // Reported or folded since: a poster fails; taken back to a draft too.
    const poster = exhibitionPick(town())!;
    assert.ok(isOpenPoster(town(), poster));
    assert.equal(
      isOpenPoster(
        town({ myReports: [reported("poster", poster.id)] }),
        poster,
      ),
      false,
    );
    assert.equal(
      isOpenPoster(town(), { ...poster, status: "draft" as const }),
      false,
    );
    // A shop whose shelves went private, and a POP moved to a private shelf.
    const shop = shelvesFeature(town(), NOW)!.shops[0];
    assert.ok(isOpenShop(town(), shop));
    assert.equal(isOpenShop(town(), privateShelves(shop)), false);
    const pop = popsFeature(town(), NOW)!.pops[0];
    const place = placeOf(pop);
    assert.deepEqual(pickAt(town(), place), pop);
    assert.ok(isOpenPop(town(), pop));
    const closed = town({
      shops: seedState.shops.map((each) =>
        each.id === pop.shop.id ? privateShelves(each) : each,
      ),
    });
    assert.equal(isOpenPop(closed, pickAt(closed, place)!), false);
    // Gone from the shelf: nothing to find.
    const taken = town({
      shops: seedState.shops.map((each) =>
        each.id === pop.shop.id
          ? {
              ...each,
              shelves: each.shelves.map((shelf) => ({
                ...shelf,
                items: shelf.items.filter((item) => item.id !== pop.item.id),
              })),
            }
          : each,
      ),
    });
    assert.equal(pickAt(taken, place), null);
    const pin = boardPicks(town(), NOW)[0];
    assert.ok(isBoardPick(town(), pin));
    assert.equal(
      isBoardPick(town(), { ...pin, shelf: { ...pin.shelf, isPublic: false } }),
      false,
    );
  },
);

check(
  "one shop with a public and a private shelf shows only the public one, any day",
  () => {
    const mixed = mixedShop(seedState.shops[0]);
    const state = town({ shops: [mixed, ...seedState.shops.slice(1)] });
    const secretBooks = new Set(
      mixed.shelves.filter(secretShelf)[0].items.map((item) => item.bookId),
    );
    const openBooks = new Set(
      mixed.shelves
        .filter((shelf) => !secretShelf(shelf))[0]
        .items.map((item) => item.bookId),
    );
    // 本棚をのぞく: its covers are the public shelf's.
    assert.ok(ids(shelvesFeature(state, NOW, 0, 10)!.shops).includes(mixed.id));
    const covers = shopCovers(state, mixed, 10).map((book) => book.id);
    assert.ok(covers.length > 0);
    for (const book of covers) assert.ok(openBooks.has(book), book);
    for (const book of secretBooks)
      if (!openBooks.has(book)) assert.ok(!covers.includes(book), book);
    // Every day in turn (each of its books is the day's pick once): its
    // POP and its お題 come from the public shelf only.
    for (const day of days(12)) {
      const pops = popsFeature(state, day, 20)!.pops.filter(
        (pop) => pop.shop.id === mixed.id,
      );
      assert.equal(pops.length, 1);
      assert.ok(!secretShelf(pops[0].shelf));
      assert.notEqual(pops[0].item.pop, SECRET_POP);
      const pins = boardPicks(state, day, 20).filter(
        (pick) => pick.shop.id === mixed.id,
      );
      assert.equal(pins.length, 1);
      assert.ok(!secretShelf(pins[0].shelf), pins[0].item.id);
    }
  },
);

check("the reader's own shop is never in 本屋のPOP or on the 掲示板", () => {
  // Their own shop among the town's, as a 見本 one would be, with POPs.
  const own: Shop = { ...seedState.shops[0], ownerId: ME_ID };
  const state = town({ shops: [own, ...seedState.shops.slice(1)] });
  for (const day of days(8)) {
    const pops = popsFeature(state, day, 20)!.pops;
    assert.equal(pops.length, seedState.shops.length - 1);
    assert.ok(!pops.some((pop) => pop.shop.id === own.id));
    const pins = boardPicks(state, day, 20);
    assert.equal(pins.length, seedState.shops.length - 1);
    assert.ok(!pins.some((pick) => pick.shop.id === own.id));
  }
  // Known as their own by the town's record of it, too.
  const byRecord = town({ ownShop: seedState.shops[1] });
  assert.ok(
    !popsFeature(byRecord, NOW, 20)!.pops.some(
      (pop) => pop.shop.id === seedState.shops[1].id,
    ),
  );
  assert.ok(
    !boardPicks(byRecord, NOW, 20).some(
      (pick) => pick.shop.id === seedState.shops[1].id,
    ),
  );
});

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
