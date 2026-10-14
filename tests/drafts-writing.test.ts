import assert from "node:assert/strict";
import { createKeptDraftStore } from "../src/lib/kept-draft";
import { draftOwner } from "../src/lib/draft-owner";
import {
  createPostDraftStore,
  POST_DRAFT_KEY,
  readingDraftKey,
} from "../src/lib/post-draft";
import {
  adoptVisitorRecords,
  readRecordChanges,
  RECORD_DRAFT_KEY,
  RECORD_DRAFT_OPTIONS,
  recordChanges,
  recordWorkKey,
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
  const key = readingDraftKey("demo", "me-reading-3");
  assert.equal(key, "demo:reading:me-reading-3");
  drafts.update(key, { body: "ここで一度、本を伏せた。" });
  const reopened = createPostDraftStore(() => storage);
  reopened.initialize();
  assert.equal(reopened.get(key)?.body, "ここで一度、本を伏せた。");
  // A spoiler mark set before any words is kept too; nothing at all is not.
  reopened.update("demo:review:momo", { spoiler: true });
  assert.equal(reopened.get("demo:review:momo")?.spoiler, true);
  reopened.update("demo:review:momo", { spoiler: false });
  assert.equal(reopened.get("demo:review:momo"), null);
  // Keys of no composer, or of no owner, are not kept.
  reopened.update("demo:reading:", { body: "x" });
  reopened.update("demo:draft:x", { body: "x" });
  reopened.update("reading:me-reading-3", { body: "x" });
  reopened.update(":new-post", { body: "x" });
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts), [key]);
  const stored = JSON.parse(storage.data.get(POST_DRAFT_KEY)!);
  assert.deepEqual(Object.keys(stored.drafts), [key]);
});

check("a reading line is carried into a review only when that is empty", () => {
  const drafts = createPostDraftStore(() => memory());
  const line = readingDraftKey("u-1", "s1");
  drafts.update(line, { body: "灰色の男たち。", spoiler: true });
  assert.equal(drafts.carry(line, "u-1:review:momo"), true);
  assert.deepEqual(drafts.get("u-1:review:momo"), {
    body: "灰色の男たち。",
    bookId: null,
    spoiler: true,
  });
  assert.equal(drafts.get(line), null);
  // A review already being written is not overwritten; the line stays.
  drafts.update(line, { body: "もうひとつ。" });
  assert.equal(drafts.carry(line, "u-1:review:momo"), false);
  assert.equal(drafts.get("u-1:review:momo")?.body, "灰色の男たち。");
  assert.equal(drafts.get(line)?.body, "もうひとつ。");
  // A new post with only a book chosen keeps its book.
  drafts.update("u-1:new-post", { bookId: "solaris" });
  assert.equal(drafts.carry(line, "u-1:new-post"), true);
  assert.deepEqual(drafts.get("u-1:new-post"), {
    body: "もうひとつ。",
    bookId: "solaris",
    spoiler: false,
  });
  // Nothing written, nothing carried.
  drafts.update(line, { spoiler: true });
  assert.equal(drafts.carry(line, "u-1:review:silence"), false);
  assert.equal(drafts.get("u-1:review:silence"), null);
});

check("a reading line can be added after a review's own words", () => {
  const drafts = createPostDraftStore(() => memory());
  const line = readingDraftKey("u-1", "s2");
  drafts.update("u-1:review:momo", { body: "前から書いていた感想。\n" });
  drafts.update(line, { body: " 時間の花。", spoiler: true });
  assert.equal(drafts.carry(line, "u-1:review:momo", true), true);
  assert.deepEqual(drafts.get("u-1:review:momo"), {
    body: "前から書いていた感想。\n時間の花。",
    bookId: null,
    spoiler: true,
  });
  assert.equal(drafts.get(line), null);
  // Into an empty review it goes as it is, the same as carrying it.
  drafts.update(line, { body: "ひとこと。" });
  assert.equal(drafts.carry(line, "u-1:review:silence", true), true);
  assert.equal(drafts.get("u-1:review:silence")?.body, "ひとこと。");
  // Too long for one post together: nothing moves, and the line stays.
  drafts.update("u-1:review:solaris", { body: "海".repeat(995) });
  drafts.update(line, { body: "海の記憶。" });
  assert.equal(drafts.carry(line, "u-1:review:solaris", true), false);
  assert.equal(drafts.get("u-1:review:solaris")?.body.length, 995);
  assert.equal(drafts.get(line)?.body, "海の記憶。");
});

check("post drafts read back too long or misshapen are dropped", () => {
  const storage = memory();
  storage.setItem(
    POST_DRAFT_KEY,
    JSON.stringify({
      version: 1,
      drafts: {
        "u-1:reading:a": { body: "よし", bookId: null, spoiler: false },
        "u-1:reading:b": {
          body: "あ".repeat(1001),
          bookId: null,
          spoiler: false,
        },
        "u-1:reading:c": { body: "x", bookId: 3, spoiler: false },
        "u-1:reading:d": { body: "x", bookId: null },
      },
    }),
  );
  const drafts = createPostDraftStore(() => storage);
  drafts.initialize();
  assert.deepEqual(Object.keys(drafts.getSnapshot().drafts), ["u-1:reading:a"]);
});

const work = (patch: Partial<RecordWork> = {}): RecordWork => ({
  feelings: ["warm", "again"],
  note: "読み終えた夜、窓を開けた。",
  spoiler: false,
  isPublic: false,
  ...patch,
});

check(
  "drafts are kept per reader: by account, the demo's or a visitor's",
  () => {
    const user = { id: "u-1", email: "a@example.com" };
    assert.equal(draftOwner({ status: "loading" }), null);
    assert.equal(draftOwner({ status: "demo" }), "demo");
    assert.equal(draftOwner({ status: "signed-out" }), "visitor");
    assert.equal(draftOwner({ status: "needs-profile", user }), "u-1");
    assert.equal(draftOwner({ status: "unavailable", user }), "u-1");
  },
);

check("a record's changes are kept per reader and book, or per record", () => {
  assert.equal(
    recordWorkKey({ owner: "u-1", bookId: "momo" }),
    "u-1:record-new:momo",
  );
  assert.equal(
    recordWorkKey({ owner: "u-1", recordId: "r-2", bookId: "momo" }),
    "u-1:record:r-2",
  );
  const storage = memory();
  const drafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  drafts.set("u-1:record-new:momo", { note: "灰色の男たち。" });
  drafts.set("u-1:record:r-2", { isPublic: true });
  drafts.set("record-new:momo", { note: "誰のものでもない" });
  drafts.set("u-1:review:momo", { note: "x" });
  drafts.set("u-1:record:r-3", {});
  const reopened = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  reopened.initialize();
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts), [
    "u-1:record-new:momo",
    "u-1:record:r-2",
  ]);
  assert.deepEqual(reopened.get("u-1:record-new:momo"), {
    note: "灰色の男たち。",
  });
  // Another account on this browser has nothing kept for the same book.
  assert.equal(
    reopened.get(recordWorkKey({ owner: "u-2", bookId: "momo" })),
    null,
  );
  assert.ok(storage.data.has(RECORD_DRAFT_KEY));
});

check("a visitor's new records go with them into the account", () => {
  const storage = memory();
  const drafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  drafts.set("visitor:record-new:momo", {
    feelings: ["warm"],
    note: "灰色の男たち。",
  });
  drafts.set("visitor:record-new:solaris", { note: "海。" });
  drafts.set("u-1:record-new:solaris", { note: "もう書いていた" });
  drafts.set("u-2:record-new:momo", { note: "ほかの人" });
  adoptVisitorRecords("u-1", drafts);
  assert.deepEqual(drafts.get("u-1:record-new:momo"), {
    feelings: ["warm"],
    note: "灰色の男たち。",
  });
  assert.equal(drafts.get("visitor:record-new:momo"), null);
  // What the account already kept is not replaced, and the visitor's stays.
  assert.deepEqual(drafts.get("u-1:record-new:solaris"), {
    note: "もう書いていた",
  });
  assert.deepEqual(drafts.get("visitor:record-new:solaris"), { note: "海。" });
  assert.deepEqual(drafts.get("u-2:record-new:momo"), { note: "ほかの人" });
  // The next account to sign in here takes what is still waiting, and only
  // that: what was handed to u-1 stays with u-1.
  adoptVisitorRecords("u-2", drafts);
  assert.deepEqual(drafts.get("u-2:record-new:momo"), { note: "ほかの人" });
  assert.deepEqual(drafts.get("u-2:record-new:solaris"), { note: "海。" });
  const reopened = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  reopened.initialize();
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts).sort(), [
    "u-1:record-new:momo",
    "u-1:record-new:solaris",
    "u-2:record-new:momo",
    "u-2:record-new:solaris",
  ]);
});

check("handing over records at the limit lets no other record go", () => {
  const storage = memory();
  const drafts = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  // As many as are kept: the account's own and a visitor's, oldest first.
  for (let index = 0; index < 15; index++) {
    drafts.set("u-1:record-new:a" + index, { note: "A" + index });
    drafts.set("visitor:record-new:b" + index, { note: "訪問者" + index });
  }
  const before = Object.keys(drafts.getSnapshot().drafts);
  assert.equal(before.length, 30);
  adoptVisitorRecords("u-1", drafts);
  const reopened = createKeptDraftStore(RECORD_DRAFT_OPTIONS, () => storage);
  reopened.initialize();
  assert.deepEqual(
    Object.keys(reopened.getSnapshot().drafts),
    before.map((key) => key.replace(/^visitor:/, "u-1:")),
  );
  assert.deepEqual(reopened.get("u-1:record-new:a0"), { note: "A0" });
});

check("only what was changed is kept, so the rest follows the record", () => {
  // The order feelings were chosen in does not make it a change.
  assert.equal(
    recordChanges(work({ feelings: ["again", "warm"] }), work()),
    null,
  );
  assert.deepEqual(recordChanges(work({ note: "豆畑。" }), work()), {
    note: "豆畑。",
  });
  const changes = recordChanges(
    work({ note: "豆畑。", feelings: ["quiet"] }),
    work(),
  );
  assert.deepEqual(changes, { feelings: ["quiet"], note: "豆畑。" });
  // Made public elsewhere since: the note changed, and the record stays public.
  assert.deepEqual(
    { ...work({ isPublic: true }), ...changes },
    work({ isPublic: true, note: "豆畑。", feelings: ["quiet"] }),
  );
});

check("a record's changes read back must be ones the sheet could make", () => {
  assert.deepEqual(readRecordChanges(work()), work());
  assert.deepEqual(readRecordChanges({ isPublic: false }), {
    isPublic: false,
  });
  assert.deepEqual(readRecordChanges({ feelings: ["warm", "warm"] }), {
    feelings: ["warm"],
  });
  assert.equal(
    readRecordChanges({ note: "あ".repeat(255) })?.note?.length,
    255,
  );
  for (const bad of [
    null,
    "work",
    [],
    {},
    { note: "あ".repeat(256) },
    { feelings: ["cried", "bored"] },
    { feelings: "warm" },
    { spoiler: "yes" },
    { isPublic: undefined },
    { note: "x", stars: 5 },
  ])
    assert.equal(readRecordChanges(bad), null);
});

check("a report's reason and words are kept per reporter and thing", () => {
  assert.equal(
    reportWorkKey("u-1", { kind: "post", id: "p-1" }),
    "u-1:post:p-1",
  );
  assert.equal(
    reportWorkKey("u-1", { kind: "book", id: "b-1" }),
    "u-1:book:b-1",
  );
  const storage = memory();
  const drafts = createKeptDraftStore(REPORT_DRAFT_OPTIONS, () => storage);
  const words: ReportWork = { reason: "harassment", detail: "何度も。" };
  drafts.set("u-1:post:p-1", words);
  drafts.set("u-1:profile:r-1", { reason: "spam", detail: "" });
  drafts.set("u-1:shop:s-1", { reason: null, detail: "" });
  drafts.set("u-1:comment:c-1", words);
  drafts.set("post:p-1", words);
  const reopened = createKeptDraftStore(REPORT_DRAFT_OPTIONS, () => storage);
  reopened.initialize();
  assert.deepEqual(Object.keys(reopened.getSnapshot().drafts), [
    "u-1:post:p-1",
    "u-1:profile:r-1",
  ]);
  assert.deepEqual(reopened.get("u-1:post:p-1"), words);
  // Another account reporting the same post starts with nothing.
  assert.equal(
    reopened.get(reportWorkKey("u-2", { kind: "post", id: "p-1" })),
    null,
  );
  reopened.clear("u-1:post:p-1");
  reopened.clear("u-1:profile:r-1");
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
