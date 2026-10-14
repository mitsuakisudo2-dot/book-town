import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import { dayOrder, jstDay, tonightsShop } from "../src/lib/tonight";
import { ME_ID, type Shop, type TownState } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const HOUR = 60 * 60 * 1000;
const at = (iso: string) => Date.parse(iso);
const town = (change: Partial<TownState> = {}): TownState => ({
  ...structuredClone(seedState),
  ...change,
});
const REAL = "8a6f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_REAL = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

check("the day is Japan's: it turns at midnight JST, not UTC", () => {
  assert.equal(
    jstDay(at("2026-10-14T23:59:00+09:00")),
    jstDay(at("2026-10-14T00:00:00+09:00")),
  );
  assert.equal(
    jstDay(at("2026-10-15T00:00:00+09:00")),
    jstDay(at("2026-10-14T00:00:00+09:00")) + 1,
  );
  // 08:59 in Japan is still the day before in UTC; it is today here.
  assert.equal(
    jstDay(at("2026-10-14T08:59:00+09:00")),
    jstDay(at("2026-10-14T12:00:00+09:00")),
  );
});

check("今夜の一軒 holds all day, and moves on the next", () => {
  const morning = tonightsShop(town(), at("2026-10-14T00:05:00+09:00"))!;
  for (const hour of [3, 9, 15, 23])
    assert.equal(
      tonightsShop(town(), at("2026-10-14T00:05:00+09:00") + hour * HOUR)?.id,
      morning.id,
    );
  const seen = new Set<string>();
  let day = at("2026-10-14T20:00:00+09:00");
  let last = morning.id;
  for (let count = 0; count < 6; count += 1) {
    day += 24 * HOUR;
    const next = tonightsShop(town(), day)!.id;
    assert.notEqual(next, last, "the next day another shop");
    seen.add(next);
    last = next;
  }
  // Each of the six shops has its night in turn.
  assert.equal(seen.size, 6);
});

check("never the reader's own, never a shop without three public books", () => {
  const now = at("2026-10-14T20:00:00+09:00");
  const own: Shop = { ...seedState.shops[0], ownerId: ME_ID };
  const closed = (shop: Shop): Shop => ({
    ...shop,
    shelves: shop.shelves.map((shelf) => ({ ...shelf, isPublic: false })),
  });
  const shops = [own, ...seedState.shops.slice(1, 3).map(closed)];
  for (let day = 0; day < 7; day += 1)
    assert.equal(
      tonightsShop(town({ shops, ownShop: own }), now + day * 24 * HOUR),
      null,
    );
  const thin: Shop = {
    ...seedState.shops[3],
    shelves: [
      {
        ...seedState.shops[3].shelves[0],
        isPublic: true,
        items: seedState.shops[3].shelves[0].items.slice(0, 2),
      },
    ],
  };
  assert.equal(tonightsShop(town({ shops: [thin] }), now), null);
});

check("a real shop comes before every 見本", () => {
  const now = at("2026-10-14T20:00:00+09:00");
  const real = { ...seedState.shops[2], id: REAL, demo: false };
  const shops = [...seedState.shops, real];
  for (let day = 0; day < 10; day += 1)
    assert.equal(
      tonightsShop(town({ shops }), now + day * 24 * HOUR)?.id,
      REAL,
    );
  // Two real shops share the nights between them.
  const other = { ...seedState.shops[4], id: OTHER_REAL, demo: false };
  const both = new Set(
    Array.from(
      { length: 4 },
      (_, day) =>
        tonightsShop(town({ shops: [...shops, other] }), now + day * 24 * HOUR)
          ?.id,
    ),
  );
  assert.deepEqual([...both].sort(), [OTHER_REAL, REAL].sort());
});

check("the day's order is made from ids alone, not from counts", () => {
  const now = at("2026-10-14T20:00:00+09:00");
  const famous = seedState.shops.map((shop, index) => ({
    ...shop,
    followers: index * 1000,
  }));
  assert.deepEqual(
    dayOrder(famous, (shop) => shop.id, now).map((shop) => shop.id),
    dayOrder(seedState.shops, (shop) => shop.id, now).map((shop) => shop.id),
  );
});

console.log(`tonight ok (${passed})`);
