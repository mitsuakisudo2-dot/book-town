import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  createMemoryRepository,
  deserializeTown,
  serializeTown,
} from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import { popReactionKey, shelfUsed, type TownState } from "../src/lib/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

/** Assert the create flow succeeded, rather than suppressing nullable state types. */
function ownShop(state: TownState) {
  assert.ok(state.ownShop, "A shop must be created before editing it");
  return state.ownShop;
}

const repository = createMemoryRepository();
const store = createTownStore(repository);
const { actions } = store;

check("SSR snapshot stays stable without initialization", () => {
  assert.equal(store.getSnapshot(), seedState);
  assert.equal(store.getServerSnapshot(), seedState);
  assert.equal(store.getServerSnapshot(), store.getServerSnapshot());
});

check(
  "all demo shelves respect capacity and support discovery across shops",
  () => {
    seedState.shops.forEach((shop) => {
      assert.ok(shop.shelves.length >= 2);
      shop.shelves.forEach((shelf) =>
        assert.ok(shelfUsed(shelf) <= shelf.capacity),
      );
    });
    const solarisShops = seedState.shops.filter((shop) =>
      shop.shelves.some((shelf) =>
        shelf.items.some((item) => item.bookId === "solaris"),
      ),
    );
    assert.ok(solarisShops.length >= 3);
    const pops = solarisShops.flatMap((shop) =>
      shop.shelves.flatMap((shelf) =>
        shelf.items
          .filter((item) => item.bookId === "solaris")
          .map((item) => item.pop),
      ),
    );
    assert.equal(pops.length, new Set(pops).size);
  },
);

check(
  "shop creation preserves prior snapshots and cannot overwrite an existing shop",
  () => {
    actions.createShop("わたしの店", "説明", "sage");
    assert.equal(ownShop(store.getSnapshot()).id, "mine");
    assert.equal(ownShop(store.getSnapshot()).ownerId, "me");
    assert.equal(seedState.ownShop, null);
    const before = store.getSnapshot();
    actions.createShop("上書きしない", "", "rose");
    assert.equal(store.getSnapshot(), before);
  },
);

actions.addShelf("小さい棚", 3);
const shelfId = ownShop(store.getSnapshot()).shelves[1].id;

check(
  "face display consumes three spaces and over-capacity addition rejects atomically",
  () => {
    assert.equal(actions.addShelfBook(shelfId, "solaris", "face"), true);
    assert.equal(shelfUsed(ownShop(store.getSnapshot()).shelves[1]), 3);
    const before = store.getSnapshot();
    assert.equal(actions.addShelfBook(shelfId, "momo", "spine"), false);
    assert.equal(store.getSnapshot(), before);
  },
);

const firstId = ownShop(store.getSnapshot()).shelves[1].items[0].id;
actions.changeDisplay(shelfId, firstId, "spine");
actions.addShelfBook(shelfId, "momo", "spine");
actions.addShelfBook(shelfId, "night-fog", "spine");

check("over-capacity face conversion leaves the snapshot unchanged", () => {
  const before = store.getSnapshot();
  assert.equal(actions.changeDisplay(shelfId, firstId, "face"), false);
  assert.equal(store.getSnapshot(), before);
  assert.equal(shelfUsed(ownShop(store.getSnapshot()).shelves[1]), 3);
});

check("duplicate and unknown books cannot enter a shelf", () => {
  assert.equal(actions.addShelfBook("mine-shelf-1", "missing", "spine"), false);
  assert.equal(actions.addShelfBook(shelfId, "momo", "spine"), false);
});

check("ordering uses target index and preserves display and POP", () => {
  actions.updatePop(shelfId, firstId, "私のPOP");
  actions.moveShelfBook(shelfId, firstId, 2);
  const items = ownShop(store.getSnapshot()).shelves[1].items;
  assert.deepEqual(
    items.map((item) => item.bookId),
    ["momo", "night-fog", "solaris"],
  );
  assert.equal(items[2].pop, "私のPOP");
  assert.equal(items[2].display, "spine");
});

check("private shelf and edits survive repository reload", () => {
  actions.updateShelf(shelfId, { name: "わたしだけの棚", isPublic: false });
  const reloaded = createTownStore(repository);
  reloaded.initialize();
  assert.deepEqual(reloaded.getSnapshot(), store.getSnapshot());
  assert.equal(ownShop(reloaded.getSnapshot()).shelves[1].isPublic, false);
});

check("profile nine books are normalized and persisted", () => {
  actions.updateNine(
    ["momo", "momo", "missing", ...seedState.books.map((book) => book.id)],
    { momo: "大切な一冊", missing: "消える" },
  );
  const me = store.getSnapshot().me;
  assert.equal(me.lifeNine.length, 9);
  assert.equal(new Set(me.lifeNine).size, 9);
  assert.deepEqual(me.nineNotes, { momo: "大切な一冊" });
  assert.deepEqual(repository.load().state.me, me);
});

check("wishlist and following toggles reject unknown ids", () => {
  actions.toggleWish("solaris");
  actions.toggleWish("missing");
  assert.deepEqual(store.getSnapshot().wishlist, ["solaris"]);
  actions.toggleWish("solaris");
  assert.deepEqual(store.getSnapshot().wishlist, []);
  actions.toggleFollow("shop-orbit");
  actions.toggleFollow("missing");
  assert.deepEqual(store.getSnapshot().following, ["shop-orbit"]);
  actions.toggleFollow("shop-orbit");
  assert.deepEqual(store.getSnapshot().following, []);
});

check("invalid JSON and tampered capacity restore a safe initial state", () => {
  assert.equal(deserializeTown("{bad json").status, "recovered");
  const envelope = JSON.parse(serializeTown(store.getSnapshot())) as {
    data: { ownShop: NonNullable<TownState["ownShop"]> };
  };
  envelope.data.ownShop.shelves[1].capacity = 1;
  const restored = deserializeTown(JSON.stringify(envelope));
  assert.equal(restored.status, "recovered");
  assert.equal(restored.state.ownShop, null);
});

check("write failures remain usable and report unavailable persistence", () => {
  const failing = createTownStore({
    load: () => ({ state: structuredClone(seedState), status: "saved" }),
    save: () => "unavailable",
  });
  failing.actions.toggleWish("momo");
  assert.deepEqual(failing.getSnapshot().wishlist, ["momo"]);
  assert.equal(failing.getPersistenceSnapshot(), "unavailable");
});

check(
  "old saves gain optional fields without losing existing personal data",
  () => {
    const envelope = JSON.parse(serializeTown(store.getSnapshot()));
    delete envelope.data.favorites;
    delete envelope.data.popReactions;
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.deepEqual(loaded.state.ownShop, store.getSnapshot().ownShop);
    assert.deepEqual(loaded.state.me, store.getSnapshot().me);
    assert.deepEqual(loaded.state.favorites, []);
    assert.deepEqual(loaded.state.popReactions, {});
  },
);

check(
  "favorites and POP reactions persist independently and are scoped to the exact shelf item",
  () => {
    const shop = seedState.shops[0],
      shelf = shop.shelves[0],
      item = shelf.items[0];
    const other = seedState.shops.find(
      (entry) =>
        entry.id !== shop.id &&
        entry.shelves.some((s) =>
          s.items.some((i) => i.bookId === item.bookId),
        ),
    )!;
    const otherShelf = other.shelves.find((s) =>
      s.items.some((i) => i.bookId === item.bookId),
    )!;
    const otherItem = otherShelf.items.find((i) => i.bookId === item.bookId)!;
    const key = popReactionKey(shop.id, shelf.id, item.id);
    actions.toggleFavorite("solaris");
    actions.toggleFavorite("missing");
    actions.togglePopReaction(shop.id, shelf.id, item.id, "like");
    actions.togglePopReaction(shop.id, shelf.id, item.id, "read");
    actions.togglePopReaction("missing", shelf.id, item.id, "love");
    assert.deepEqual(store.getSnapshot().favorites, ["solaris"]);
    assert.deepEqual(store.getSnapshot().wishlist, []);
    assert.deepEqual(store.getSnapshot().popReactions[key], ["like", "read"]);
    assert.equal(
      store.getSnapshot().popReactions[
        popReactionKey(other.id, otherShelf.id, otherItem.id)
      ],
      undefined,
    );
    assert.deepEqual(repository.load().state, store.getSnapshot());
    actions.togglePopReaction(shop.id, shelf.id, item.id, "like");
    assert.deepEqual(store.getSnapshot().popReactions[key], ["read"]);
    actions.toggleFavorite("solaris");
    assert.deepEqual(store.getSnapshot().favorites, []);
  },
);

check(
  "invalid optional fields and private reaction targets do not destroy a saved shop",
  () => {
    const before = store.getSnapshot();
    actions.togglePopReaction("mine", shelfId, firstId, "love");
    assert.equal(store.getSnapshot(), before);
    const envelope = JSON.parse(serializeTown(before));
    envelope.data.favorites = ["solaris", "solaris", "unknown", 1];
    envelope.data.popReactions = {
      ...envelope.data.popReactions,
      bad: ["like"],
      [popReactionKey("mine", shelfId, firstId)]: ["love"],
    };
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.deepEqual(loaded.state.ownShop, before.ownShop);
    assert.deepEqual(loaded.state.favorites, ["solaris"]);
    assert.equal(loaded.state.popReactions.bad, undefined);
    assert.equal(
      loaded.state.popReactions[popReactionKey("mine", shelfId, firstId)],
      undefined,
    );
  },
);

check("removing an item clears reactions before its ID can be reused", () => {
  const fresh = createTownStore(createMemoryRepository());
  fresh.actions.createShop("one book", "", "sage");
  const id = "mine-shelf-1";
  fresh.actions.addShelfBook(id, "solaris", "spine");
  const item = ownShop(fresh.getSnapshot()).shelves[0].items[0];
  fresh.actions.togglePopReaction("mine", id, item.id, "like");
  fresh.actions.removeShelfBook(id, item.id);
  fresh.actions.addShelfBook(id, "momo", "spine");
  assert.deepEqual(fresh.getSnapshot().popReactions, {});
});

console.log(`${passed} domain checks passed.`);
