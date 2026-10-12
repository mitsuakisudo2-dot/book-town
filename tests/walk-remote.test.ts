import assert from "node:assert/strict";
import { OWN_SHOP_ID } from "../src/lib/types";
import { emptyWalkData, type WalkData } from "../src/lib/walk-backend";
import {
  planWalkWrites,
  scenePlacementKey,
  sceneFromRow,
  walkFromRows,
  type WalkRows,
  type WalkWrite,
} from "../src/lib/walk-remote";
import { noPosition } from "../src/lib/walk-repository";
import type { StoreScene } from "../src/lib/store-scene";

// Translating the walk between database rows and the screens, and planning
// what to write, without a database.

const USER = "00000000-0000-4000-8000-00000000000a";
const OWN = "00000000-0000-4000-8000-0000000000f1";
const OTHER = "00000000-0000-4000-8000-0000000000f2";
const ids = { userId: USER, shopId: OWN };
const at = "2026-10-12T10:00:00+00:00";

const scene = (storeId: string): StoreScene => ({
  schemaVersion: 1,
  storeId,
  ownerManaged: true,
  theme: {
    id: "woodshop",
    light: "#fff",
    wood: "#000",
    paper: "#eee",
    font: "serif",
  },
  background: { kind: "preset", blur: 0, darkness: 0 },
  forbidden: [],
  objects: [
    {
      id: "sign",
      kind: "sign",
      parentId: null,
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, rotation: 0 },
      z: 1,
      text: "夜の本屋",
    },
  ],
});

function rows(extra: Partial<WalkRows> = {}): WalkRows {
  return {
    ownScene: null,
    scenes: [],
    reactions: [],
    saved: [],
    popReactions: [],
    visits: [],
    ...extra,
  };
}

const kinds = (writes: WalkWrite[]) =>
  writes.map((write) =>
    write.kind === "forget" ? "forget:" + write.table : write.kind,
  );

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

check("the own shop is 'mine' on screen; other shops keep their ids", () => {
  const data = walkFromRows(
    rows({
      ownScene: { ...scene(OWN) },
      scenes: [{ id: OTHER, public_scene: scene(OTHER) }],
      reactions: [
        { shop_id: OTHER, liked: true, message: "また来ます" },
        { shop_id: OWN, liked: true, message: "" },
      ],
      saved: [{ shop_id: OTHER }],
      popReactions: [
        {
          shop_id: OTHER,
          placement_key: scenePlacementKey("placement:a"),
          reaction: "love",
        },
        // A POP on the old shelves belongs to the town, not to the walk.
        { shop_id: OTHER, placement_key: '["s1","i1"]', reaction: "like" },
      ],
      visits: [{ shop_id: OTHER, visited_at: at }],
    }),
    ids,
    noPosition(),
  );
  assert.deepEqual(
    data.scenes.map((s) => s.storeId),
    [OWN_SHOP_ID, OTHER],
  );
  assert.deepEqual(data.state.reactions, {
    [OTHER]: { liked: true, saved: true, message: "また来ます" },
    [OWN_SHOP_ID]: { liked: true, saved: false, message: "" },
  });
  assert.deepEqual(data.state.placementReactions, {
    [JSON.stringify(["scene", OTHER, "placement:a"])]: ["love"],
  });
  assert.deepEqual(data.state.visits, { [OTHER]: at });
  assert.deepEqual(data.backups, []);
});

check("broken scenes are left out instead of breaking the walk", () => {
  assert.equal(sceneFromRow("not a scene", OTHER), null);
  assert.equal(sceneFromRow({ ...scene(OTHER), objects: "x" }, OTHER), null);
  const outside = scene(OTHER);
  outside.objects[0].rect.x = 3;
  assert.equal(sceneFromRow(outside, OTHER), null);
  // The shop it belongs to decides its label, not what the scene says.
  assert.equal(sceneFromRow(scene("elsewhere"), OTHER)?.storeId, OTHER);
});

check("nothing is written when nothing changed", () => {
  const data = walkFromRows(rows(), ids, noPosition());
  assert.deepEqual(planWalkWrites(data, data, ids), []);
  // Where the walk stopped stays on this device.
  const moved: WalkData = {
    ...data,
    state: { ...data.state, lastStoreId: OTHER },
  };
  assert.deepEqual(planWalkWrites(data, moved, ids), []);
});

check("the own scene is written whole, under the shop's real id", () => {
  const base = emptyWalkData();
  const next: WalkData = {
    ...base,
    scenes: [scene(OWN_SHOP_ID), scene(OTHER)],
  };
  const writes = planWalkWrites(base, next, ids);
  assert.deepEqual(kinds(writes), ["scene"]);
  assert.equal(
    (writes[0] as Extract<WalkWrite, { kind: "scene" }>).scene?.storeId,
    OWN_SHOP_ID,
  );
});

check("likes, words, saves, visits and POP reactions become rows", () => {
  const base = emptyWalkData();
  const next: WalkData = {
    ...base,
    state: {
      ...base.state,
      reactions: {
        [OTHER]: { liked: false, saved: true, message: "あ".repeat(3000) },
        "demo-shop": { liked: true, saved: true, message: "" },
      },
      visits: { [OTHER]: at, "demo-shop": at },
      placementReactions: {
        [JSON.stringify(["scene", OTHER, "placement:a"])]: ["love", "read"],
      },
    },
  };
  const writes = planWalkWrites(base, next, ids);
  assert.deepEqual(kinds(writes), ["reactions", "saved", "visits", "pops"]);
  const [reactions, saved, visits, pops] = writes as [
    Extract<WalkWrite, { kind: "reactions" }>,
    Extract<WalkWrite, { kind: "saved" }>,
    Extract<WalkWrite, { kind: "visits" }>,
    Extract<WalkWrite, { kind: "pops" }>,
  ];
  // The demo's shops are not in the database and are skipped.
  assert.deepEqual(
    reactions.rows.map((row) => row.shop_id),
    [OTHER],
  );
  assert.equal(reactions.rows[0].message?.length, 2000);
  assert.deepEqual(saved.rows, [{ user_id: USER, shop_id: OTHER }]);
  assert.deepEqual(visits.rows, [
    { user_id: USER, shop_id: OTHER, visited_at: at },
  ]);
  assert.deepEqual(
    pops.rows.map((row) => row.reaction),
    ["love", "read"],
  );
  assert.equal(pops.rows[0].placement_key, scenePlacementKey("placement:a"));
});

check("taking things back removes their rows", () => {
  const base = walkFromRows(
    rows({
      reactions: [{ shop_id: OTHER, liked: true, message: "また来ます" }],
      saved: [{ shop_id: OTHER }],
      visits: [{ shop_id: OTHER, visited_at: at }],
      popReactions: [
        {
          shop_id: OTHER,
          placement_key: scenePlacementKey("placement:a"),
          reaction: "love",
        },
      ],
    }),
    ids,
    noPosition(),
  );
  const next: WalkData = {
    ...base,
    state: {
      ...base.state,
      reactions: {
        [OTHER]: { liked: false, saved: false, message: "" },
      },
      visits: {},
      placementReactions: {},
    },
  };
  const writes = planWalkWrites(base, next, ids);
  assert.deepEqual(kinds(writes), [
    "forget:shop_reactions",
    "forget:saved_shops",
    "forget:shop_visits",
    "unpop",
  ]);
});

check("the own shop waits for its id before anything is written for it", () => {
  const base = emptyWalkData();
  const next: WalkData = {
    ...base,
    state: {
      ...base.state,
      reactions: { [OWN_SHOP_ID]: { liked: true, saved: true, message: "" } },
    },
  };
  assert.deepEqual(
    planWalkWrites(base, next, { userId: USER, shopId: null }),
    [],
  );
  assert.deepEqual(kinds(planWalkWrites(base, next, ids)), [
    "reactions",
    "saved",
  ]);
});

console.log(passed + " walk sync checks passed");
