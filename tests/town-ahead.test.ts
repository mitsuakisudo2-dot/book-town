import assert from "node:assert/strict";
import vm from "node:vm";
import {
  AHEAD_FRESH_MS,
  takeTownAhead,
  townAheadScript,
} from "../src/lib/supabase/town-ahead";

// Someone not signed in has town_view asked by the page's head, beside the
// code (AUD-134); the town takes that answer once (town-ahead.ts).

let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const URL = "https://test-project.supabase.co";
const ARGS = { post_limit: 500, record_notes: false };
const script = townAheadScript(URL, "sb_publishable_test", ARGS);

/** Runs the head's script on a page; says what it asked. */
function head(page: { path?: string; href?: string; kept?: string[] }) {
  const asked: { url: string; init: RequestInit }[] = [];
  const kept = page.kept ?? [];
  const window: Record<string, unknown> = {
    location: {
      pathname: page.path ?? "/",
      href: page.href ?? "https://booktown.page" + (page.path ?? "/"),
    },
    localStorage: { length: kept.length, key: (i: number) => kept[i] ?? null },
    performance: { now: () => 1200 },
    fetch: (url: string, init: RequestInit) => {
      asked.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    },
  };
  window.window = window;
  vm.runInNewContext(script, window);
  return { asked, ahead: window.__townAhead };
}

void (async () => {
  await check("a first visit asks town_view as the town would", () => {
    const { asked, ahead } = head({ path: "/walk/" });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, URL + "/rest/v1/rpc/town_view");
    assert.equal(asked[0].init.method, "POST");
    assert.deepEqual(JSON.parse(String(asked[0].init.body)), ARGS);
    assert.ok(ahead);
  });

  await check(
    "nothing is asked for a kept session, a sign-in or ログイン",
    () => {
      assert.equal(
        head({ kept: ["sb-test-project-auth-token"] }).asked.length,
        0,
      );
      assert.equal(head({ path: "/login/" }).asked.length, 0);
      assert.equal(head({ path: "/leave/" }).asked.length, 0);
      assert.equal(
        head({ href: "https://booktown.page/#access_token=x" }).asked.length,
        0,
      );
      assert.equal(
        head({ href: "https://booktown.page/?code=x" }).asked.length,
        0,
      );
      // Others' keys on this site are not a session.
      assert.equal(head({ kept: ["book-town-fonts-at"] }).asked.length, 1);
    },
  );

  // takeTownAhead reads the page's window.
  Object.assign(globalThis, { window: globalThis });
  const at = performance.now();

  await check("the answer is taken once", async () => {
    window.__townAhead = { at, answer: Promise.resolve({ posts: [] }) };
    assert.deepEqual(await takeTownAhead(), { posts: [] });
    assert.equal(await takeTownAhead(), undefined);
  });

  await check("trouble or an old answer is not taken", async () => {
    window.__townAhead = { at, answer: Promise.resolve(undefined) };
    assert.equal(await takeTownAhead(), undefined);
    window.__townAhead = {
      at: at - AHEAD_FRESH_MS - 1,
      answer: Promise.resolve({ posts: [] }),
    };
    assert.equal(await takeTownAhead(), undefined);
    window.__townAhead = { at, answer: Promise.reject(new Error("offline")) };
    assert.equal(await takeTownAhead(), undefined);
  });

  console.log(`${passed} checks passed`);
})();
