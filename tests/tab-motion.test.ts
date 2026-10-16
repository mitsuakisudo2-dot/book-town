import assert from "node:assert/strict";
import { tabMove } from "../src/lib/tab-motion";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

check("the first tab seen is no move", () => {
  assert.equal(tabMove(2, 0), null);
});
check("another tab is a move from the tab shown to it", () => {
  assert.deepEqual(tabMove(4, 1000), { from: 2, to: 4 });
  assert.deepEqual(tabMove(1, 2000), { from: 4, to: 1 });
});
check("the same tab again, or a page outside the tabs, is no move", () => {
  assert.equal(tabMove(1, 3000), null);
  assert.equal(tabMove(null, 4000), null);
  // A page outside the tabs is not remembered: the next tab counts from 1.
  assert.deepEqual(tabMove(0, 5000), { from: 1, to: 0 });
});
check(
  "a tab named a moment late is the same move, from where it started",
  () => {
    // ホーム (0) to 本棚 (3): the page is わたし (5) for a frame first.
    assert.deepEqual(tabMove(5, 10_000), { from: 0, to: 5 });
    assert.deepEqual(tabMove(3, 10_016), { from: 0, to: 3 });
    // Back to where the move started, at once: no move after all.
    assert.deepEqual(tabMove(4, 13_000), { from: 3, to: 4 });
    assert.equal(tabMove(3, 13_050), null);
  },
);

console.log(`tab motion ok (${passed} checks)`);
