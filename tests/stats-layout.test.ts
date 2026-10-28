import assert from "node:assert/strict";
import {
  addCard,
  cardsLeft,
  FIRST_LAYOUT,
  layoutRows,
  LAYOUT_PLACES_MAX,
  move,
  putIn,
  readLayout,
  resize,
  STAT_CARDS,
  takeOut,
  type StatsLayout,
} from "../src/lib/reading-stats";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

// A layout written short: a card's key with its size, "_" an empty place.
const SIZE = { h: "half", w: "wide", f: "full" } as const;
const lay = (text: string): StatsLayout =>
  text.split(" ").map((place) => {
    if (place === "_") return { card: null, size: "half" };
    const [card, size] = place.split(":");
    return {
      card: card as StatsLayout[number]["card"],
      size: SIZE[size as keyof typeof SIZE],
    };
  });
const show = (tiles: StatsLayout) =>
  layoutRows(tiles)
    .map((row) =>
      row
        .map(({ tile }) =>
          tile.card === null ? "_" : `${tile.card}:${tile.size[0]}`,
        )
        .join(" "),
    )
    .join(" | ");

check("the first arrangement is the twelve, each once, in rows", () => {
  assert.equal(FIRST_LAYOUT.length, 12);
  assert.deepEqual(cardsLeft(FIRST_LAYOUT), []);
  assert.equal(
    show(FIRST_LAYOUT),
    "year:f | chart:f | days:h clock:h | genre:h pace:h | shelf:h joy:h | met:h stack:h | album:w | shape:f",
  );
});

check(
  "a kept arrangement is read whole, and what is not one is the first",
  () => {
    for (const kept of [null, undefined, "year", { card: "year" }, 3])
      assert.equal(readLayout(kept), null);
    assert.deepEqual(readLayout([]), []);
    assert.equal(
      show(
        readLayout([
          { card: "pace", size: "half" },
          { card: "a_card_from_a_newer_app", size: "half" },
          { card: "pace", size: "full" },
          { card: "year", size: "huge" },
          null,
          "chart",
          { card: "chart", size: "wide" },
          { card: null, size: "full" },
          { card: null, size: "half" },
        ]) ?? [],
      ),
      // pace was left alone by a card this app does not know: a place beside it.
      "pace:h _ | chart:w",
    );
    const many = Array.from({ length: 100 }, () => ({
      card: null,
      size: "half",
    }));
    assert.ok(
      (readLayout([{ card: "year", size: "half" }, ...many]) ?? []).length <=
        LAYOUT_PLACES_MAX,
    );
  },
);

check(
  "taking out a half-width card leaves its place, a row of places goes",
  () => {
    const two = takeOut(lay("days:h clock:h shape:f"), 1);
    assert.equal(show(two), "days:h _ | shape:f");
    assert.equal(show(takeOut(two, 0)), "shape:f");
    assert.equal(
      show(takeOut(lay("year:f days:h clock:h"), 0)),
      "days:h clock:h",
    );
    // An empty place is not taken out.
    assert.deepEqual(takeOut(two, 1), two);
  },
);

check(
  "a card sized keeps its place; a half-width one alone gets a place beside it",
  () => {
    const sized = resize(lay("days:h clock:h shape:f"), 0, "full");
    assert.equal(show(sized), "days:f | clock:h _ | shape:f");
    assert.equal(show(resize(sized, 0, "half")), "days:h clock:h | shape:f");
  },
);

check(
  "＋ puts a card in an empty place, and offers only cards not there",
  () => {
    const gap = lay("days:h _ shape:f");
    assert.ok(cardsLeft(gap).includes("clock"));
    assert.ok(!cardsLeft(gap).includes("days"));
    assert.equal(show(putIn(gap, 1, "clock")), "days:h clock:h | shape:f");
    // Not over a card, not a card already there.
    assert.deepEqual(putIn(gap, 0, "clock"), gap);
    assert.deepEqual(putIn(gap, 1, "shape"), gap);
    assert.equal(show(addCard(gap, "pace")), "days:h pace:h | shape:f");
    assert.equal(show(addCard(lay("shape:f"), "pace")), "shape:f | pace:h _");
  },
);

check(
  "a half-width card carried onto another half-width place trades places with it",
  () => {
    const rows = lay("days:h clock:h genre:h pace:h");
    assert.equal(show(move(rows, 0, 3)), "pace:h clock:h | genre:h days:h");
    const gap = lay("days:h _ genre:h pace:h");
    assert.equal(show(move(gap, 2, 1)), "days:h genre:h | _ pace:h");
    // Its size is kept wherever it goes.
    for (const to of [0, 1, 2, 3])
      assert.ok(move(rows, 1, to).every((tile) => tile.size === "half"));
  },
);

check(
  "a full-width card carried over a row of two moves the two down whole, and back",
  () => {
    const start = lay("days:h clock:h year:f genre:h pace:h");
    const up = move(start, 2, 1);
    assert.equal(show(up), "year:f | days:h clock:h | genre:h pace:h");
    assert.equal(
      show(move(up, 0, 2)),
      "days:h clock:h | year:f | genre:h pace:h",
    );
    assert.equal(
      show(move(start, 2, 4)),
      "days:h clock:h | genre:h pace:h | year:f",
    );
    assert.equal(move(start, 2, 4)[4].size, "full");
  },
);

check(
  "a half-width card carried over a full-width one leaves its partner in place",
  () => {
    const start = lay("year:f days:h clock:h");
    assert.equal(show(move(start, 2, 0)), "clock:h _ | year:f | days:h _");
    assert.equal(
      show(move(lay("days:h clock:h year:f"), 0, 2)),
      "_ clock:h | year:f | days:h _",
    );
  },
);

check("nothing changes for a move that is no move", () => {
  const start = lay("days:h _ year:f");
  assert.deepEqual(move(start, 1, 0), start, "an empty place is not carried");
  assert.deepEqual(move(start, 0, 0), start);
  assert.deepEqual(move(start, 0, 9), start);
  assert.deepEqual(resize(start, 2, "full"), start);
  assert.equal(STAT_CARDS.length, new Set(STAT_CARDS).size);
});

console.log(`${passed} statistics layout checks passed`);
