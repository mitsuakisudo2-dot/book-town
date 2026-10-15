import assert from "node:assert/strict";
import {
  HOME_SEEN,
  HOME_TAB_BOOT,
  HOME_TAB_KEY,
  loadHomeTab,
  openingTab,
  readHomeTab,
  saveHomeTab,
  tabOfPath,
} from "../src/lib/home-tab";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

const memory = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};
const refusing = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
};

check("each Home address names its tab; others none", () => {
  assert.equal(tabOfPath("/"), "home");
  assert.equal(tabOfPath("/timeline/"), "letters");
  assert.equal(tabOfPath("/timeline"), null);
  assert.equal(tabOfPath("/search/"), null);
});

check("a kept tab is read back only as one of the two", () => {
  assert.equal(readHomeTab("home"), "home");
  assert.equal(readHomeTab("letters"), "letters");
  for (const value of ["timeline", "shelves", "", null, undefined, 1, {}])
    assert.equal(readHomeTab(value), null, String(value));
  assert.equal(loadHomeTab(memory({ [HOME_TAB_KEY]: "street" })), null);
});

check(
  "the last tab is kept in localStorage, and storage that throws is no matter",
  () => {
    const storage = memory();
    assert.equal(loadHomeTab(storage), null);
    saveHomeTab("letters", storage);
    assert.equal(storage.data.get(HOME_TAB_KEY), "letters");
    assert.equal(loadHomeTab(storage), "letters");
    saveHomeTab("home", storage);
    assert.equal(loadHomeTab(storage), "home");
    assert.doesNotThrow(() => saveHomeTab("letters", refusing));
    assert.equal(loadHomeTab(refusing), null);
    assert.equal(loadHomeTab(null), null);
  },
);

check(
  "a fresh / opens on the kept tab; /timeline/ and a seen / keep their own",
  () => {
    assert.equal(openingTab("/", false, "letters"), "letters");
    assert.equal(openingTab("/", false, null), "home");
    assert.equal(openingTab("/", true, "letters"), "home");
    assert.equal(openingTab("/timeline/", false, "home"), "letters");
    assert.equal(openingTab("/timeline/", true, "home"), "letters");
    assert.equal(openingTab("/search/", false, "letters"), null);
  },
);

check("the boot script marks <html> by the same rule, before React", () => {
  const run = (
    path: string,
    state: Record<string, unknown> | null,
    storage: { getItem: (key: string) => string | null },
  ) => {
    const dataset: Record<string, string> = {};
    new Function(
      "location",
      "history",
      "localStorage",
      "document",
      HOME_TAB_BOOT,
    )({ pathname: path }, { state }, storage, { documentElement: { dataset } });
    return dataset.homeTab ?? null;
  };
  const kept = memory({ [HOME_TAB_KEY]: "letters" });
  for (const [path, state, storage] of [
    ["/", null, kept],
    ["/", { [HOME_SEEN]: true }, kept],
    ["/", { __NA: true }, memory()],
    ["/timeline/", null, memory({ [HOME_TAB_KEY]: "home" })],
    ["/search/", null, kept],
  ] as const)
    assert.equal(
      run(path, state, storage),
      openingTab(path, Boolean(state?.[HOME_SEEN]), loadHomeTab(storage)),
      `${path} ${JSON.stringify(state)}`,
    );
  // Storage closed: the address alone decides, and nothing throws.
  assert.equal(run("/", null, refusing), "home");
  assert.equal(run("/timeline/", null, refusing), "letters");
});

console.log(`home-tab ok (${passed})`);
