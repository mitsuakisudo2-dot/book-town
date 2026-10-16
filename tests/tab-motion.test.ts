import assert from "node:assert/strict";
import { tabStep } from "../src/lib/tab-motion";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

check("the first tab seen does not slide", () => {
  assert.equal(tabStep(2, 0), 0);
});
check(
  "a tab to the right slides in from the right, to the left from the left",
  () => {
    assert.equal(tabStep(4, 1000), 1);
    assert.equal(tabStep(1, 2000), -1);
  },
);
check("the same tab again, or a page outside the tabs, does not slide", () => {
  assert.equal(tabStep(1, 3000), 0);
  assert.equal(tabStep(null, 4000), 0);
  // A page outside the tabs is not remembered: the next tab counts from 1.
  assert.equal(tabStep(0, 5000), -1);
});
check(
  "a tab named a moment late is the same move, from where it started",
  () => {
    // ホーム (0) to 本棚 (3): the page is わたし (5) for a frame first.
    assert.equal(tabStep(5, 10_000), 1);
    assert.equal(tabStep(3, 10_016), 1);
    // わたし (5), then 本棚 (3) to 検索 (1) named a moment late: left.
    assert.equal(tabStep(5, 11_000), 1);
    assert.equal(tabStep(3, 12_000), -1);
    assert.equal(tabStep(1, 12_050), -1);
    // Back to where the move started, at once: no move after all.
    assert.equal(tabStep(4, 13_000), 1);
    assert.equal(tabStep(1, 13_050), 0);
  },
);

console.log(`tab motion ok (${passed} checks)`);
