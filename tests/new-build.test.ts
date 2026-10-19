import assert from "node:assert/strict";
import { QUIET_MS, isMissingFile, readNewBuild } from "../src/lib/new-build";

// A page opened before a new build reads itself again once when a screen's
// file is gone (src/lib/new-build.ts): never in a loop, never offline.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

function chunkError(message: string) {
  const error = new Error(message);
  error.name = "ChunkLoadError";
  return error;
}

check("webpack's errors for a file that could not be read are known", () => {
  assert.equal(
    isMissingFile(
      chunkError(
        "Loading chunk 9958 failed.\n(error: https://booktown.page/_next/static/chunks/9958.js)",
      ),
    ),
    true,
  );
  assert.equal(
    isMissingFile(new Error("Loading CSS chunk 123 failed.\n(/x.css)")),
    true,
  );
  assert.equal(
    isMissingFile(new Error("Loading chunk app/page failed.")),
    true,
  );
  assert.equal(isMissingFile(new TypeError("x is undefined")), false);
  assert.equal(isMissingFile(new Error("Failed to fetch")), false);
  assert.equal(isMissingFile("Loading chunk 1 failed."), false);
  assert.equal(isMissingFile(null), false);
  assert.equal(isMissingFile(undefined), false);
});

check("a stylesheet of the site that did not load is known", () => {
  const link = (href: string, rel = "stylesheet") => ({
    type: "error",
    target: { tagName: "LINK", rel, href },
  });
  assert.equal(
    isMissingFile(link("https://booktown.page/_next/static/css/d37d.css")),
    true,
  );
  assert.equal(isMissingFile(link("/_next/static/css/d37d.css")), true);
  assert.equal(
    isMissingFile(link("https://fonts.googleapis.com/css2?family=Noto")),
    false,
  );
  assert.equal(isMissingFile(link("/themes/room.css")), false);
  assert.equal(
    isMissingFile(link("/_next/static/css/d37d.css", "preload")),
    false,
  );
  assert.equal(
    isMissingFile({
      type: "error",
      target: { tagName: "IMG", href: "/_next/static/media/a.png" },
    }),
    false,
  );
  assert.equal(
    isMissingFile({ type: "load", target: link("/_next/static/a.css").target }),
    false,
  );
});

function page(online = true) {
  const kept = new Map<string, string>();
  let reloads = 0;
  const storage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
  return {
    at: (now: number) =>
      readNewBuild({ storage, now, online, reload: () => (reloads += 1) }),
    reloads: () => reloads,
  };
}

check("the page is read again once, and not again within a minute", () => {
  const tab = page();
  assert.equal(tab.at(1_000_000), true);
  assert.equal(tab.reloads(), 1);
  // The file is missing from the new build too: no loop.
  assert.equal(tab.at(1_000_000 + 5_000), false);
  assert.equal(tab.at(1_000_000 + QUIET_MS - 1), false);
  assert.equal(tab.reloads(), 1);
  // Another build later on: read again.
  assert.equal(tab.at(1_000_000 + QUIET_MS), true);
  assert.equal(tab.reloads(), 2);
});

check("offline, the page stays as it is", () => {
  const tab = page(false);
  assert.equal(tab.at(1_000_000), false);
  assert.equal(tab.reloads(), 0);
});

check("storage that throws leaves the page as it is", () => {
  let reloads = 0;
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {},
  };
  assert.equal(
    readNewBuild({ storage, now: 1, online: true, reload: () => reloads++ }),
    false,
  );
  assert.equal(reloads, 0);
});

console.log(`new build ok (${passed} checks)`);
