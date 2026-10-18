import assert from "node:assert/strict";
import {
  GAPS,
  nextOf,
  NO_TIMING,
  noteDone,
  noteFrame,
  noteReadAt,
  readLine,
  readTiming,
  SIZES,
  summarize,
  timingReport,
  USUAL,
} from "../src/lib/scan-timing";

// The scanner's timing mode (scan-timing.ts): only an address that asks for
// it turns it on, the tab keeps it until ?scan-timing=off, the settings are
// one of the choices or as usual, and the record says what each read took.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("the mode is off unless the address or the tab asks for it", () => {
  assert.equal(readTiming("", null), null);
  assert.equal(readTiming("?tab=read", null), null);
  assert.deepEqual(readTiming("?scan-timing", null), USUAL);
  assert.deepEqual(readTiming("?scan-timing=1&tab=read", null), USUAL);
  // The tab keeps it, with the settings tried.
  assert.deepEqual(readTiming("", JSON.stringify({ gap: 0, size: 1280 })), {
    gap: 0,
    size: 1280,
  });
  assert.equal(readTiming("?scan-timing=off", JSON.stringify(USUAL)), null);
});

check("a setting that is not one of the choices reads as usual", () => {
  assert.deepEqual(
    readTiming("", JSON.stringify({ gap: 5, size: 99999 })),
    USUAL,
  );
  assert.deepEqual(readTiming("?scan-timing", "not json"), USUAL);
  assert.equal(readTiming("", "not json"), null);
  assert.ok((GAPS as readonly number[]).includes(USUAL.gap));
  assert.ok((SIZES as readonly number[]).includes(USUAL.size));
});

check("the choices go round", () => {
  assert.equal(nextOf(GAPS, 200), 100);
  assert.equal(nextOf(GAPS, 100), 0);
  assert.equal(nextOf(GAPS, 0), 200);
  assert.equal(nextOf(SIZES, 1920), 1280);
  assert.equal(nextOf(SIZES, 1280), 1920);
});

check("frames give the middle read and frames a second", () => {
  let timing = NO_TIMING;
  assert.equal(summarize(timing).frameMs, null);
  assert.equal(summarize(timing).perSecond, null);
  for (const [at, ms] of [
    [1000, 30],
    [1250, 50],
    [1500, 40],
    [1750, 90],
    [2000, 40],
  ])
    timing = noteFrame(timing, at, ms);
  const sum = summarize(timing);
  assert.equal(timing.started, 1000);
  assert.equal(sum.frameMs, 40);
  assert.equal(sum.slowestMs, 90);
  assert.equal(sum.perSecond, 4);
});

check("each read keeps when its title and its save came, once", () => {
  let timing = noteReadAt(NO_TIMING, "s-1", 1000, true);
  timing = noteReadAt(timing, "again-1", 2500, false);
  timing = noteReadAt(timing, "s-2", 4000, true);
  timing = noteDone(timing, "s-1", "titleAt", 1500);
  timing = noteDone(timing, "s-1", "titleAt", 9000);
  timing = noteDone(timing, "s-1", "savedAt", 2200);
  timing = noteDone(timing, "nobody", "savedAt", 2200);
  assert.equal(timing.reads[0].titleAt, 1500);
  assert.equal(timing.reads[0].savedAt, 2200);
  assert.equal(readLine(timing, 0), "1冊目・書名 0.5秒・保存 1.2秒");
  assert.equal(readLine(timing, 1), "前の本から 1.5秒・もう入っている本");
  assert.equal(readLine(timing, 2), "前の本から 1.5秒");
  assert.equal(summarize(timing).firstToLast, 3000);
  assert.equal(summarize(timing).books, 3);
});

check("the record has a line a book, and nothing to send", () => {
  let timing = noteFrame(NO_TIMING, 900, 35);
  timing = noteReadAt(timing, "s-1", 1000, true);
  timing = noteDone(timing, "s-1", "titleAt", 1400);
  timing = noteReadAt(timing, "s-2", 3000, true);
  const report = timingReport(timing, {
    reader: "wasm",
    picture: "1920×1080",
    settings: USUAL,
    userAgent: "iPhone",
    when: "10/18 21:30",
  }).split("\n");
  assert.equal(report[0], "BookTown スキャン計測 10/18 21:30");
  assert.match(
    report[1],
    /wasm・映像 1920×1080・頼んだ幅 1920・コマの間 200ms/,
  );
  assert.match(report[2], /^1コマ 中央 35ms/);
  assert.equal(report[3], "1冊目から2冊目まで 2.0秒");
  assert.equal(report[5], ["1", "-", "0.4", "-", "はい"].join("\t"));
  assert.equal(report[6], ["2", "2.0", "-", "-", "はい"].join("\t"));
  assert.equal(report.at(-1), "iPhone");
});

console.log(`${passed} checks passed`);
