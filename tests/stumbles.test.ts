import assert from "node:assert/strict";
import {
  STUMBLES_PER_SEND,
  countStumble,
  sendStumbles,
  setStumbleSender,
  stumbleTally,
  type StumbleCounts,
  type StumbleFeature,
} from "../src/lib/stumbles";
import {
  backgroundSync,
  stumbleOf,
  TownSyncError,
} from "../src/lib/supabase/sync";
import { townWriteFeature } from "../src/lib/supabase/town-backend";
import type { Write } from "../src/lib/town-remote";

// 機能ごとのつまずきを数える (管理表 110, src/lib/stumbles.ts): what a page
// counts and sends, and how a save tells how each write went. The database's
// side is tests/db-stumbles.test.ts.

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "a page's counts go as three even lists, in a fixed order",
    () => {
      const tally = stumbleTally();
      assert.equal(tally.take(), null);
      tally.count("shelf", "refused");
      tally.count("search", "ok");
      tally.count("search", "ok");
      tally.count("search", "not_found");
      assert.deepEqual(tally.take(), {
        features: ["search", "search", "shelf"],
        results: ["ok", "not_found", "refused"],
        times: [2, 1, 1],
      });
      // Taken: none left.
      assert.equal(tally.take(), null);
    },
  );

  await check("a cell stops at what the database takes in one call", () => {
    const tally = stumbleTally();
    for (let i = 0; i < STUMBLES_PER_SEND + 50; i += 1)
      tally.count("register", "ok");
    assert.deepEqual(tally.take()?.times, [STUMBLES_PER_SEND]);
  });

  await check(
    "network trouble is one stumble until a try of the feature goes otherwise",
    () => {
      const tally = stumbleTally();
      tally.count("shelf", "offline");
      tally.count("shelf", "offline");
      tally.count("search", "offline");
      tally.count("shelf", "offline");
      tally.count("shelf", "ok");
      tally.count("shelf", "offline");
      assert.deepEqual(tally.take(), {
        features: ["search", "shelf", "shelf"],
        results: ["offline", "ok", "offline"],
        times: [1, 1, 2],
      });
    },
  );

  await check(
    "only a signed-in reader's tries are kept, and they go when the sender is taken back",
    async () => {
      const sent: StumbleCounts[] = [];
      countStumble("search", "ok");
      sendStumbles();
      const stop = setStumbleSender(async (counts) => {
        sent.push(counts);
      });
      // Counted before anyone was signed in: not kept.
      sendStumbles();
      assert.equal(sent.length, 0);
      countStumble("barcode", "ok");
      countStumble("barcode", "refused");
      stop();
      await Promise.resolve();
      assert.deepEqual(sent, [
        {
          features: ["barcode", "barcode"],
          results: ["ok", "refused"],
          times: [1, 1],
        },
      ]);
      // Signed out: nothing more is kept.
      countStumble("barcode", "ok");
      setStumbleSender(async (counts) => {
        sent.push(counts);
      })();
      assert.equal(sent.length, 1);
    },
  );

  await check(
    "counts a sender could not send wait for the next send; offline, none is tried",
    async () => {
      let fail = true;
      const sent: StumbleCounts[] = [];
      const stop = setStumbleSender(async (counts) => {
        if (fail) throw new Error("401");
        sent.push(counts);
      });
      countStumble("search", "refused");
      sendStumbles();
      await new Promise((resume) => setTimeout(resume, 0));
      assert.equal(sent.length, 0);
      // Offline: nothing is tried, and the counts wait.
      Object.defineProperty(globalThis.navigator, "onLine", {
        value: false,
        configurable: true,
      });
      fail = false;
      countStumble("search", "refused");
      sendStumbles();
      await new Promise((resume) => setTimeout(resume, 0));
      assert.equal(sent.length, 0);
      Object.defineProperty(globalThis.navigator, "onLine", {
        value: true,
        configurable: true,
      });
      sendStumbles();
      await new Promise((resume) => setTimeout(resume, 0));
      assert.deepEqual(sent, [
        { features: ["search"], results: ["refused"], times: [2] },
      ]);
      // Taken back while one cannot go: dropped, not left for the next
      // reader.
      fail = true;
      countStumble("barcode", "ok");
      stop();
      await new Promise((resume) => setTimeout(resume, 0));
      const next: StumbleCounts[] = [];
      setStumbleSender(async (counts) => {
        next.push(counts);
      })();
      assert.deepEqual(next, []);
      // A sender that throws at once is no harm.
      const stopThrowing = setStumbleSender(() => {
        throw new Error("no network");
      });
      countStumble("search", "ok");
      sendStumbles();
      stopThrowing();
    },
  );

  await check("how a failed request counts", () => {
    assert.equal(
      stumbleOf(new TownSyncError("rule", false, "23514", "", 400)),
      "refused",
    );
    assert.equal(
      stumbleOf(new TownSyncError("network", true, "", "", 0)),
      "offline",
    );
    assert.equal(
      stumbleOf(new TownSyncError("busy", true, "", "", 503)),
      "other",
    );
    assert.equal(
      stumbleOf(new TownSyncError("login gone", true, "", "", 401)),
      "other",
    );
    // A wait of the app's own (the town not read yet) is no try.
    assert.equal(
      stumbleOf(new TownSyncError("The town is not loaded yet", true)),
      null,
    );
    assert.equal(stumbleOf(new Error("bug")), "other");
  });

  await check("which town writes count, and for what", () => {
    const write = (value: unknown) => value as Write;
    assert.equal(
      townWriteFeature(
        write({
          kind: "library-entries",
          rows: [{ book_id: "b" }],
          patches: [],
        }),
      ),
      "register",
    );
    // A change of a book already in the library is not a registration.
    assert.equal(
      townWriteFeature(
        write({
          kind: "library-entries",
          rows: [],
          patches: [{ book_id: "b", made: false, patch: {} }],
        }),
      ),
      null,
    );
    for (const kind of ["shelves", "library-shelves", "shelf-books"])
      assert.equal(townWriteFeature(write({ kind })), "shelf");
    for (const kind of ["books", "posts", "profile", "records", "add"])
      assert.equal(townWriteFeature(write({ kind })), null);
  });

  await check(
    "a save counts each write once, as a whole: saved, turned away, changed elsewhere, offline, server trouble",
    async () => {
      // Writes are words; "no" is turned away, "elsewhere" was changed on
      // another device, "both" is two parts of which "no" is turned away,
      // "late" meets the network gone once, "busy" a busy server once, and
      // "wait" the app's own wait once.
      const feature: Record<string, StumbleFeature> = {
        yes: "search",
        busy: "search",
        no: "register",
        both: "register",
        elsewhere: "barcode",
        late: "shelf",
        wait: "shelf",
      };
      const once = new Set(["late", "busy", "wait"]);
      const sent: StumbleCounts[] = [];
      const stop = setStumbleSender(async (counts) => {
        sent.push(counts);
      });
      let saved = false;
      const sync = backgroundSync<string[], string>(
        {
          read: async () => [],
          plan: (base, target) => target.filter((w) => !base.includes(w)),
          async apply(write) {
            if (once.delete(write)) {
              if (write === "late")
                throw new TownSyncError("network", true, "", "", 0);
              if (write === "busy")
                throw new TownSyncError("busy", true, "", "", 503);
              throw new TownSyncError("The town is not loaded yet", true);
            }
            if (write === "no") throw new TownSyncError("rule", false);
            if (write === "elsewhere")
              throw new TownSyncError("changed", false, "PT409");
            if (write === "both") throw new TownSyncError("rule", false);
          },
          split: (write) => (write === "both" ? ["yes", "no"] : []),
          stumble: (write) => feature[write] ?? null,
        },
        { delay: 0, retryDelays: [0] },
      );
      await sync.load();
      sync.watch({
        status() {},
        replace() {
          saved = true;
        },
      });
      sync.save(["yes", "no", "elsewhere", "both", "late", "busy", "wait"]);
      for (let wait = 0; wait < 400 && !saved; wait += 1)
        await new Promise((resume) => setTimeout(resume, 5));
      sync.close();
      stop();
      await Promise.resolve();
      // Sent again whole after each cut-off round, a write already counted
      // is not counted again.
      assert.deepEqual(sent, [
        {
          features: [
            "search",
            "search",
            "register",
            "barcode",
            "shelf",
            "shelf",
          ],
          results: ["ok", "other", "refused", "other", "ok", "offline"],
          times: [2, 1, 2, 1, 2, 1],
        },
      ]);
    },
  );

  await check("counting that throws never stops a save", async () => {
    const applied: string[] = [];
    const sync = backgroundSync<string[], string>(
      {
        read: async () => [],
        plan: (base, target) => target.filter((w) => !base.includes(w)),
        async apply(write) {
          applied.push(write);
        },
        stumble() {
          throw new Error("counting broke");
        },
      },
      { delay: 0 },
    );
    await sync.load();
    sync.save(["a", "b"]);
    for (let wait = 0; wait < 100 && applied.length < 2; wait += 1)
      await new Promise((resume) => setTimeout(resume, 5));
    sync.close();
    assert.deepEqual(applied, ["a", "b"]);
  });

  console.log(`${passed} stumble checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
