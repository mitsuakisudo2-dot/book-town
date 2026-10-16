import assert from "node:assert/strict";
import {
  APPEARANCE_BOOT,
  APPEARANCE_KEY,
  FIRST_PALETTE,
  PALETTES,
  paletteOf,
} from "../src/lib/appearance";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

/** Runs the head's script on an `<html>` with `kept` in storage (or a
    browser that refuses storage) and says what it marked. */
function boot(kept: string | null | "refused") {
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem: (key: string) => {
      if (kept === "refused") throw new Error("SecurityError");
      return key === APPEARANCE_KEY ? kept : null;
    },
  };
  new Function("document", "localStorage", APPEARANCE_BOOT)(
    { documentElement: { dataset } },
    localStorage,
  );
  return dataset.palette;
}

check("a kept palette is read back; anything else is 深緑", () => {
  for (const { id } of PALETTES)
    assert.equal(paletteOf(JSON.stringify({ palette: id })), id);
  for (const kept of [
    null,
    "",
    "ai",
    "{",
    "null",
    "[]",
    JSON.stringify({ palette: "night" }),
    JSON.stringify({ palette: 3 }),
  ])
    assert.equal(paletteOf(kept), FIRST_PALETTE, String(kept));
});

check("before the first paint, <html> is marked with the kept palette", () => {
  assert.equal(boot(JSON.stringify({ palette: "ai" })), "ai");
  assert.equal(boot(JSON.stringify({ palette: "yamabuki" })), "yamabuki");
  // 深緑 is :root itself: no mark.
  assert.equal(boot(JSON.stringify({ palette: "green" })), undefined);
  assert.equal(boot(null), undefined);
  assert.equal(boot("not json"), undefined);
  assert.equal(boot(JSON.stringify({ palette: "toString" })), undefined);
  assert.equal(boot("refused"), undefined);
});

check("the head's script marks exactly what paletteOf reads", () => {
  for (const { id } of PALETTES) {
    const kept = JSON.stringify({ palette: id });
    const read = paletteOf(kept);
    assert.equal(boot(kept), read === FIRST_PALETTE ? undefined : read);
  }
});

console.log(`appearance ok (${passed})`);
