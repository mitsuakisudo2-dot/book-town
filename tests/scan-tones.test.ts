import assert from "node:assert/strict";
import {
  FIRST_TONE,
  SOUND_KEY,
  TONE_KEY,
  chooseTone,
  setSoundOn,
  toneOf,
} from "../src/lib/scan-tones";
import { SHELF_ROW, fillsRow } from "../src/components/ScanShelf";

// 読み取りの音 (114): コトッ first; ♪ and 音なし are one switch, kept as
// before ("off"), so a reader who had turned it off stays without sound.
assert.equal(FIRST_TONE, "kotto");
assert.equal(SOUND_KEY, "book-town-scan-sound");
assert.equal(toneOf(null, null), "kotto");
assert.equal(toneOf("off", null), "off");
assert.equal(toneOf("off", "wood"), "off");
assert.equal(toneOf(null, "pip"), "pip");
assert.equal(toneOf(null, "bell"), "kotto", "an unknown tone is コトッ");

const data = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
};
const kept = () =>
  toneOf(data.get(SOUND_KEY) ?? null, data.get(TONE_KEY) ?? null);
chooseTone("pluck");
assert.equal(kept(), "pluck");
chooseTone("off");
assert.equal(kept(), "off");
setSoundOn(true);
assert.equal(kept(), "pluck", "♪ turns back on to the tone last chosen");
setSoundOn(false);
assert.equal(kept(), "off");
chooseTone("wood");
assert.equal(kept(), "wood", "choosing a tone turns the sound on");
assert.equal(data.get(SOUND_KEY), undefined);

// この回の棚: every tenth book sounds as one more 段 (完了 shows ten to one).
assert.equal(SHELF_ROW, 10);
assert.deepEqual([0, 1, 9, 10, 11, 20].map(fillsRow), [
  false,
  false,
  false,
  true,
  false,
  true,
]);

console.log("scan tones: ok");
