import assert from "node:assert/strict";
import {
  APPEARANCE_BOOT,
  APPEARANCE_KEY,
  BRIGHTNESSES,
  DEVICE_DARK,
  FIRST_BRIGHTNESS,
  FIRST_PALETTE,
  PALETTES,
  appearanceOf,
  isNight,
  paletteOf,
} from "../src/lib/appearance";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

/** Runs the head's script on an `<html>` with `kept` in storage (or a
    browser that refuses storage), on a device set to dark or not, and says
    what it marked. `turn` turns the device dark or light afterwards. */
function boot(kept: string | null | "refused", deviceDark = false) {
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem: (key: string) => {
      if (kept === "refused") throw new Error("SecurityError");
      return key === APPEARANCE_KEY ? kept : null;
    },
  };
  const media = {
    matches: deviceDark,
    changed: [] as (() => void)[],
    addEventListener(type: string, run: () => void) {
      if (type === "change") this.changed.push(run);
    },
  };
  new Function("document", "localStorage", "matchMedia", APPEARANCE_BOOT)(
    { documentElement: { dataset } },
    localStorage,
    (query: string) => {
      assert.equal(query, DEVICE_DARK);
      return media;
    },
  );
  return {
    dataset,
    turn(dark: boolean) {
      media.matches = dark;
      media.changed.forEach((run) => run());
    },
  };
}
const paletteMarked = (kept: string | null | "refused") =>
  boot(kept).dataset.palette;

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
  assert.equal(paletteMarked(JSON.stringify({ palette: "ai" })), "ai");
  assert.equal(
    paletteMarked(JSON.stringify({ palette: "yamabuki" })),
    "yamabuki",
  );
  // 深緑 is :root itself: no mark.
  assert.equal(paletteMarked(JSON.stringify({ palette: "green" })), undefined);
  assert.equal(paletteMarked(null), undefined);
  assert.equal(paletteMarked("not json"), undefined);
  assert.equal(
    paletteMarked(JSON.stringify({ palette: "toString" })),
    undefined,
  );
  assert.equal(paletteMarked("refused"), undefined);
});

check("the head's script marks exactly what paletteOf reads", () => {
  for (const { id } of PALETTES) {
    const kept = JSON.stringify({ palette: id });
    const read = paletteOf(kept);
    assert.equal(
      paletteMarked(kept),
      read === FIRST_PALETTE ? undefined : read,
    );
  }
});

check("a kept brightness is read back; anything else is 端末に合わせる", () => {
  assert.equal(FIRST_BRIGHTNESS, "system");
  for (const { id } of BRIGHTNESSES)
    assert.deepEqual(
      appearanceOf(JSON.stringify({ palette: "ai", brightness: id })),
      { palette: "ai", brightness: id },
    );
  // An entry kept before the night has only the palette.
  assert.deepEqual(appearanceOf(JSON.stringify({ palette: "fuji" })), {
    palette: "fuji",
    brightness: "system",
  });
  for (const kept of [null, "{", JSON.stringify({ brightness: "dark" })])
    assert.equal(appearanceOf(kept).brightness, FIRST_BRIGHTNESS);
});

check("the night: 夜, or 端末に合わせる on a dark device", () => {
  assert.equal(isNight("night", false), true);
  assert.equal(isNight("night", true), true);
  assert.equal(isNight("day", true), false);
  assert.equal(isNight("system", true), true);
  assert.equal(isNight("system", false), false);
});

check(
  "before the first paint, <html> is marked dark exactly when isNight says",
  () => {
    for (const { id } of BRIGHTNESSES)
      for (const deviceDark of [false, true]) {
        const { dataset } = boot(
          JSON.stringify({ palette: "brick", brightness: id }),
          deviceDark,
        );
        assert.equal(dataset.brightness, id);
        assert.equal(dataset.palette, "brick");
        assert.equal(
          dataset.theme,
          isNight(id, deviceDark) ? "dark" : undefined,
          `${id} on a ${deviceDark ? "dark" : "light"} device`,
        );
      }
    // Nothing kept, or storage refused: 端末に合わせる.
    assert.equal(boot(null, true).dataset.theme, "dark");
    assert.equal(boot("refused", true).dataset.theme, "dark");
    assert.equal(boot("refused", false).dataset.theme, undefined);
  },
);

check(
  "端末に合わせる follows the device while the town is open; 昼 and 夜 stay",
  () => {
    const following = boot(null, false);
    following.turn(true);
    assert.equal(following.dataset.theme, "dark");
    following.turn(false);
    assert.equal(following.dataset.theme, undefined);

    const day = boot(JSON.stringify({ brightness: "day" }), false);
    day.turn(true);
    assert.equal(day.dataset.theme, undefined);
    const night = boot(JSON.stringify({ brightness: "night" }), false);
    night.turn(false);
    assert.equal(night.dataset.theme, "dark");

    // Chosen on the page afterwards (appearance-store.ts marks
    // data-brightness): the device's turn follows the new choice.
    day.dataset.brightness = "system";
    day.turn(true);
    assert.equal(day.dataset.theme, "dark");
  },
);

console.log(`appearance ok (${passed})`);
