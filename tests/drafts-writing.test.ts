import assert from "node:assert/strict";
import { createKeptDraftStore } from "../src/lib/kept-draft";
import {
  createPostDraftStore,
  POST_DRAFT_KEY,
  readingDraftKey,
} from "../src/lib/post-draft";
import {
  readRecordWork,
  RECORD_DRAFT_KEY,
  RECORD_DRAFT_OPTIONS,
  recordWorkKey,
  sameRecordWork,
  type RecordWork,
} from "../src/lib/record-draft";
import {
  readReportWork,
  REPORT_DRAFT_KEY,
  REPORT_DRAFT_OPTIONS,
  reportWorkKey,
  type ReportWork,
} from "../src/lib/report-draft";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

check("a line written while reading is kept by its sitting", () => {
  const storage = memory();
  const drafts = createPostDraftStore(() => storage);
  const key = readingDraftKey("me-reading-3");
  assert.equal(key, "reading:me-reading-3");
  drafts.update(key, { body: "ここで一度、本を伏せた。" });
  const reopened = createPostDraftStore(() => storage);
  reopened.initialize();
  assert.equal(reopened.get(key)?.body, "ここで一度、本を伏せた。");
  // A spoiler mark set before any words is kept too; nothing at all is not.
  reopened.update("review:momo", { spoiler: true });
  assert.equal(reopened.get("review:momo")?.spoiler, true);
  reopened.update("review:momo", { spoiler: false });
  assert.equal(reopened.get("review:momo"), null);
  // Keys of no composer are not kept.
  reopened.update("reading:", { body: "x" });
  reopened.update("draft:x", { body: "x" });
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts), [key]);
  const stored = JSON.parse(storage.data.get(POST_DRAFT_KEY)!);
  assert.deepEqual(Object.keys(stored.drafts), [key]);
});

check("a reading line is carried into a review only when that is empty", () => {
  const drafts = createPostDraftStore(() => memory());
  const line = readingDraftKey("s1");
  drafts.update(line, { body: "灰色の男たち。", spoiler: true });
  assert.equal(drafts.carry(line, "review:momo"), true);
  assert.deepEqual(drafts.get("review:momo"), {
    body: "灰色の男たち。",
    bookId: null,
    spoiler: true,
  });
  assert.equal(drafts.get(line), null);
  // A review already being written is not overwritten; the line stays.
  drafts.update(line, { body: "もうひとつ。" });
  assert.equal(drafts.carry(line, "review:momo"), false);
  assert.equal(drafts.get("review:momo")?.body, "灰色の男たち。");
  assert.equal(drafts.get(line)?.body, "もうひとつ。");
  // A new post with only a book chosen keeps its book.
  drafts.update("new-post", { bookId: "solaris" });
  assert.equal(drafts.carry(line, "new-post"), true);
  assert.deepEqual(drafts.get("new-post"), {
    body: "もうひとつ。",
    bookId: "solaris",
    spoiler: false,
  });
  // Nothing written, nothing carried.
  drafts.update(line, { spoiler: true });
  assert.equal(drafts.carry(line, "review:silence"), false);
  assert.equal(drafts.get("review:silence"), null);
});

check("post drafts read back too long or misshapen are dropped", () => {
  const storage = memory();
  storage.setItem(
    POST_DRAFT_KEY,
    JSON.stringify({
      version: 1,
      drafts: {
        "reading:a": { body: "よし", bookId: null, spoiler: false },
        "reading:b": { body: "あ".repeat(1001), bookId: null, spoiler: false },
        "reading:c": { body: "x", bookId: 3, spoiler: false },
        "reading:d": { body: "x", bookId: null },
      },
    }),
  );
  const drafts = createPostDraftStore(() => storage);
  drafts.initialize();
  assert.deepEqual(Object.keys(drafts.getSnapshot().drafts), ["reading:a"]);
});

const work = (patch: Partial<RecordWork> = {}): RecordWork => ({
  feelings: ["warm", "again"],
  note: "読み終えた夜、窓を開けた。",
  spoiler: false,
  isPublic: false,
  ...patch,
});

check("a record's work is kept per book, or per record being changed", () => {
  assert.equal(recordWorkKey({ bookId: "momo" }), "record-new:momo");
  assert.equal(
    recordWorkKey({ recordId: "me-record-2", bookId: "momo" }),
    "record:me-record-2",
  );
  const storage = memory();
  const drafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  drafts.set("record-new:momo", work());
  drafts.set("record:me-record-2", work({ isPublic: true }));
  drafts.set("review:momo", work());
  const reopened = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  reopened.initialize();
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts), [
    "record-new:momo",
    "record:me-record-2",
  ]);
  assert.deepEqual(reopened.get("record-new:momo"), work());
  assert.ok(storage.data.has(RECORD_DRAFT_KEY));
  // The order feelings were chosen in does not make it different work.
  assert.equal(
    sameRecordWork(work(), work({ feelings: ["again", "warm"] })),
    true,
  );
  assert.equal(sameRecordWork(work(), work({ note: "" })), false);
  assert.equal(sameRecordWork(work(), work({ isPublic: true })), false);
});

check("a record's work read back must be one the sheet could make", () => {
  assert.deepEqual(readRecordWork(work()), work());
  assert.deepEqual(
    readRecordWork(work({ note: "あ".repeat(255) }))?.note.length,
    255,
  );
  for (const bad of [
    null,
    "work",
    work({ note: "あ".repeat(256) }),
    work({ feelings: ["cried", "bored" as never] }),
    work({ feelings: "warm" as never }),
    { ...work(), spoiler: "yes" },
    { ...work(), isPublic: undefined },
  ])
    assert.equal(readRecordWork(bad), null);
});

check("a report's reason and words are kept per thing reported", () => {
  assert.equal(reportWorkKey({ kind: "post", id: "p-1" }), "post:p-1");
  assert.equal(reportWorkKey({ kind: "book", id: "b-1" }), "book:b-1");
  const storage = memory();
  const drafts = createKeptDraftStore(REPORT_DRAFT_OPTIONS, () => storage);
  const words: ReportWork = { reason: "harassment", detail: "何度も。" };
  drafts.set("post:p-1", words);
  drafts.set("profile:r-1", { reason: "spam", detail: "" });
  drafts.set("shop:s-1", { reason: null, detail: "" });
  drafts.set("comment:c-1", words);
  const reopened = createKeptDraftStore(REPORT_DRAFT_OPTIONS, () => storage);
  reopened.initialize();
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts), [
    "post:p-1",
    "profile:r-1",
  ]);
  assert.deepEqual(reopened.get("post:p-1"), words);
  reopened.clear("post:p-1");
  reopened.clear("profile:r-1");
  assert.equal(storage.data.has(REPORT_DRAFT_KEY), false);
  assert.deepEqual(readReportWork({ reason: "cover", detail: "装丁" }), {
    reason: "cover",
    detail: "装丁",
  });
  for (const bad of [
    { reason: "spoiler", detail: "" },
    { reason: "spam", detail: "あ".repeat(1001) },
    { reason: undefined, detail: "" },
    { reason: null },
    "spam",
  ])
    assert.equal(readReportWork(bad), null);
});

console.log(`${passed} writing draft checks passed.`);
