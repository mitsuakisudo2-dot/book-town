import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TAB_TAPS_PER_SEND,
  countTabTap,
  sendTabTaps,
  setTabTapSender,
  tabTapTally,
  type TabTapCounts,
} from "../src/lib/tab-taps";

// タブが押された回数を数える (src/lib/tab-taps.ts, けにーさん 11-01): what a
// page counts and sends. The database's side is tests/db-tab-taps.test.ts.

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check("a page's taps go as three even lists, in a fixed order", () => {
    const tally = tabTapTally();
    assert.equal(tally.take(), null);
    tally.count("town", "walk");
    tally.count("manage", "home");
    tally.count("town", "home");
    tally.count("town", "home");
    tally.count("town", "top_me");
    assert.deepEqual(tally.take(), {
      modes: ["town", "town", "town", "manage"],
      tabs: ["home", "walk", "top_me", "home"],
      times: [2, 1, 1, 1],
    });
    assert.equal(tally.take(), null);
  });

  await check("a cell stops at what the database takes in one call", () => {
    const tally = tabTapTally();
    for (let i = 0; i < TAB_TAPS_PER_SEND + 50; i += 1)
      tally.count("town", "search");
    assert.deepEqual(tally.take()?.times, [TAB_TAPS_PER_SEND]);
  });

  await check(
    "only a signed-in reader's taps are kept, and they go when the sender is taken back",
    async () => {
      const sent: TabTapCounts[] = [];
      countTabTap("town", "home");
      sendTabTaps();
      const stop = setTabTapSender(async (counts) => {
        sent.push(counts);
      });
      sendTabTaps();
      assert.equal(sent.length, 0);
      countTabTap("town", "library");
      countTabTap("town", "library");
      stop();
      await Promise.resolve();
      assert.deepEqual(sent, [
        { modes: ["town"], tabs: ["library"], times: [2] },
      ]);
      // Signed out: nothing more is kept.
      countTabTap("town", "library");
      const after: TabTapCounts[] = [];
      const stopAgain = setTabTapSender(async (counts) => {
        after.push(counts);
      });
      sendTabTaps();
      assert.equal(after.length, 0);
      stopAgain();
    },
  );

  await check("taps that could not go wait for the next send", async () => {
    let fail = true;
    const sent: TabTapCounts[] = [];
    const stop = setTabTapSender(async (counts) => {
      if (fail) throw new Error("offline");
      sent.push(counts);
    });
    countTabTap("town", "reading");
    sendTabTaps();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail = false;
    countTabTap("town", "reading");
    sendTabTaps();
    await Promise.resolve();
    assert.deepEqual(sent, [
      { modes: ["town"], tabs: ["reading"], times: [2] },
    ]);
    stop();
  });

  await check("the phone's row and the bar at the top count their taps", () => {
    const app = readFileSync("src/components/TownApp.tsx", "utf8");
    // The row at the bottom counts every tab it shows.
    assert.match(app, /onClick=\{bottomClickOf\(l\)\}/);
    for (const top of ["top_add", "top_bell", "top_me"])
      assert.ok(app.includes(`tapped("${top}")`), top);
    // Only where the row shows.
    assert.match(app, /const tapped[\s\S]{0,200}display === "none"/);
  });

  console.log(`${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
