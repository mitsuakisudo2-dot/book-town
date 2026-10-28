import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import { spoilerViewOf } from "../src/lib/social";
import {
  rangeChoices,
  rangedIsbns,
  readFarEnough,
  readThrough,
  SPOILER_RANGE,
  spoilerUntil,
} from "../src/lib/spoiler-range";
import { joinPostDrafts } from "../src/lib/post-draft";
import { createTownStore } from "../src/lib/store";
import { createMemoryRepository } from "../src/lib/repository";
import {
  ME_ID,
  SPOILER_DISPLAYS,
  type Book,
  type Post,
  type SpoilerLine,
  type TownState,
} from "../src/lib/types";

// ネタバレの範囲 (管理表 22 ①): how far a spoiler goes in a series, and who
// reads it as it is (src/lib/spoiler-range.ts, docs/機能/通報と安全.md).

let passed = 0;
function check(name: string, run: () => void | Promise<void>) {
  return Promise.resolve(run()).then(() => {
    passed += 1;
    console.log(`PASS ${name}`);
  });
}

/** A valid ISBN-13 for volume n (1-9), with its check digit. */
const isbn = (n: number) => {
  const head = "97840000000" + n;
  const sum = [...head].reduce(
    (total, c, i) => total + Number(c) * (i % 2 ? 3 : 1),
    0,
  );
  return head + ((10 - (sum % 10)) % 10);
};
const base = seedState.books[0];
/** Volume n of the series, as the reader's book (or another's). */
const volumeBook = (n: number, id = "vol-" + n): Book => ({
  ...base,
  id,
  title: "夜の図書館 " + n,
  isbn: isbn(n),
});
const line: SpoilerLine = {
  volumes: [1, 2, 3, 4, 5].map((n) => ({
    number: n,
    shown: String(n),
    isbn: isbn(n),
    bookId: "catalog-" + n,
  })),
};
const lines = Object.fromEntries(line.volumes.map((v) => [v.isbn, line]));
const books = [1, 2, 3, 4, 5].map((n) => volumeBook(n));
const writer = seedState.posts.find((post) => post.parentId === null)!;
const ranged: Post = {
  ...writer,
  id: "x-ranged",
  authorId: "r-nagi",
  bookId: "vol-2",
  spoiler: true,
  spoilerThrough: 4,
};
const town = (patch: Partial<TownState> = {}): TownState => ({
  ...seedState,
  books: [...seedState.books, ...books],
  posts: [...seedState.posts, ranged],
  spoilerLines: lines,
  finishedBooks: [],
  spoilerReports: [],
  ...patch,
});

async function main() {
  await check("the volumes a writer may choose: their own and after", () => {
    assert.deepEqual(
      rangeChoices(line, isbn(2)).map((v) => v.number),
      [2, 3, 4, 5],
    );
    // The last volume, a book in no line, a line not read: nothing to choose.
    assert.deepEqual(rangeChoices(line, isbn(5)), []);
    assert.deepEqual(rangeChoices(line, "9780000000000"), []);
    assert.deepEqual(rangeChoices(null, isbn(2)), []);
    assert.deepEqual(rangeChoices(undefined, isbn(2)), []);
  });

  await check("how far a reader has read: the highest volume finished", () => {
    assert.equal(readThrough(town(), line), 0);
    assert.equal(readThrough(town({ finishedBooks: ["vol-1"] }), line), 1);
    // Finishing 4 is reading as far as 4, whatever came before.
    assert.equal(
      readThrough(town({ finishedBooks: ["vol-4", "vol-1"] }), line),
      4,
    );
    // Another book of the same ISBN (the reader's own copy) counts too.
    const own = volumeBook(3, "my-copy-3");
    assert.equal(
      readThrough(
        town({ books: [...town().books, own], finishedBooks: [own.id] }),
        line,
      ),
      3,
    );
  });

  await check("a ranged spoiler opens for a reader who read that far", () => {
    const at = (finished: string[], mode = seedState.settings.spoilerDisplay) =>
      spoilerViewOf(
        town({
          finishedBooks: finished,
          settings: { ...seedState.settings, spoilerDisplay: mode },
        }),
        ranged,
      );
    assert.equal(at([]), "folded");
    // Its own book alone is not far enough: it goes up to 4.
    assert.equal(at(["vol-2"]), "folded");
    assert.equal(at(["vol-3"]), "folded");
    assert.equal(at(["vol-4"]), "open");
    assert.equal(at(["vol-5"]), "open");
    // 出さない leaves it out until then; すべて表示する opens it anyway.
    assert.equal(at(["vol-3"], "leave_out"), "left_out");
    assert.equal(at(["vol-4"], "leave_out"), "open");
    assert.equal(at([], "show_all"), "open");
    // Their own 「ネタバレでは？」 is not asked of a marked post; their own
    // post is never left out.
    for (const mode of SPOILER_DISPLAYS)
      assert.notEqual(
        spoilerViewOf(
          town({ settings: { ...seedState.settings, spoilerDisplay: mode } }),
          { ...ranged, authorId: ME_ID },
        ),
        "left_out",
      );
  });

  await check(
    "while the line is not known, a ranged spoiler stays folded",
    () => {
      const unread = town({ spoilerLines: {}, finishedBooks: ["vol-5"] });
      assert.equal(spoilerViewOf(unread, ranged), "folded");
      assert.equal(spoilerUntil(unread, ranged, "vol-2"), null);
      // A book that left every series: folded too, never opened by its own.
      const none = town({
        spoilerLines: { [isbn(2)]: null },
        finishedBooks: ["vol-2", "vol-5"],
      });
      assert.equal(readFarEnough(none, ranged, "vol-2"), false);
    },
  );

  await check(
    "a mark with no range on a series goes as far as the whole",
    () => {
      // A mark from before ranges, or put on afterwards: the safe side.
      const whole: Post = {
        ...ranged,
        id: "x-whole",
        spoilerThrough: undefined,
      };
      const state = town({ posts: [...town().posts, whole] });
      assert.equal(spoilerViewOf(state, whole), "folded");
      assert.equal(
        spoilerViewOf({ ...state, finishedBooks: ["vol-2"] }, whole),
        "folded",
      );
      assert.equal(
        spoilerViewOf({ ...state, finishedBooks: ["vol-5"] }, whole),
        "open",
      );
      assert.equal(spoilerUntil(state, whole, "vol-2")?.number, 5);
      // Not read yet in an account: nothing opens.
      assert.equal(
        readFarEnough(
          { ...state, spoilerLines: {}, finishedBooks: ["vol-5"] },
          whole,
          "vol-2",
        ),
        false,
      );
      // A book in no series, or where lines are not read (the demo): its own book.
      const alone = { ...state, spoilerLines: { [isbn(2)]: null } };
      assert.equal(readFarEnough(alone, whole, "vol-2"), false);
      assert.equal(
        readFarEnough({ ...alone, finishedBooks: ["vol-2"] }, whole, "vol-2"),
        true,
      );
      const demo = {
        ...state,
        spoilerLines: undefined,
        finishedBooks: ["vol-2"],
      };
      assert.equal(readFarEnough(demo, whole, "vol-2"), true);
      // A ranged one where lines are not read never opens by reading.
      assert.equal(
        readFarEnough({ ...demo, finishedBooks: ["vol-5"] }, ranged, "vol-2"),
        false,
      );
    },
  );

  await check("the cover says when it opens of itself", () => {
    const until = spoilerUntil(town(), ranged, "vol-2");
    assert.equal(until?.number, 4);
    assert.equal(
      SPOILER_RANGE.cover(until!.shown),
      "4巻まで読むと開きます・押すと表示",
    );
    assert.equal(SPOILER_RANGE.tag("上"), "上巻までのネタバレ");
    assert.equal(SPOILER_RANGE.chosen("5", true), "全巻（5巻まで）のネタバレ");
    assert.equal(SPOILER_RANGE.chosen("3", false), "3巻までのネタバレ");
    // A number the line no longer has: the volume before it.
    const gap: SpoilerLine = {
      volumes: line.volumes.filter((v) => v.number !== 4),
    };
    const state = town({
      spoilerLines: Object.fromEntries(gap.volumes.map((v) => [v.isbn, gap])),
    });
    assert.equal(spoilerUntil(state, ranged, "vol-2")?.number, 3);
  });

  await check(
    "the lines to read: the marked spoilers' books, a reply's by its post",
    () => {
      const reply: Post = {
        ...writer,
        id: "x-reply",
        parentId: "x-plain",
        bookId: null,
        spoiler: true,
        spoilerThrough: 3,
      };
      const plain: Post = { ...writer, id: "x-plain", bookId: "vol-3" };
      const marked: Post = {
        ...writer,
        id: "x-marked",
        bookId: "vol-1",
        spoiler: true,
      };
      assert.deepEqual(
        rangedIsbns({
          books: town().books,
          posts: [
            ranged,
            reply,
            plain,
            marked,
            { ...writer, id: "x-unmarked", bookId: "vol-4" },
          ],
        }),
        [isbn(1), isbn(2), isbn(3)],
      );
      assert.deepEqual(rangedIsbns(seedState), []);
    },
  );

  await check("two drafts joined keep the wider range", () => {
    const draft = (spoiler: boolean, through?: number) => ({
      body: "a",
      bookId: "vol-2",
      spoiler,
      ...(through !== undefined ? { spoilerThrough: through } : {}),
    });
    const join = (a: ReturnType<typeof draft>, b: ReturnType<typeof draft>) =>
      joinPostDrafts(a, { ...b, body: "b" });
    assert.equal(join(draft(true, 3), draft(true, 4))?.spoilerThrough, 4);
    assert.equal(join(draft(true, 3), draft(true))?.spoilerThrough, undefined);
    assert.equal(join(draft(true, 3), draft(false))?.spoilerThrough, 3);
    assert.equal(join(draft(false), draft(false))?.spoilerThrough, undefined);
  });

  await check("a post keeps its range only on a spoiler", () => {
    const store = createTownStore(createMemoryRepository());
    store.actions.createPost({
      body: "4巻の話",
      bookId: seedState.books[0].id,
      spoiler: true,
      spoilerThrough: 4,
    });
    store.actions.createPost({
      body: "印なし",
      bookId: seedState.books[0].id,
      spoiler: false,
      spoilerThrough: 4,
    });
    store.actions.createPost({
      body: "変な数",
      bookId: seedState.books[0].id,
      spoiler: true,
      spoilerThrough: 0,
    });
    const mine = store
      .getSnapshot()
      .posts.filter((post) => post.authorId === ME_ID)
      .slice(-3);
    assert.deepEqual(
      mine.map((post) => [post.body, post.spoiler, post.spoilerThrough]),
      [
        ["4巻の話", true, 4],
        ["印なし", false, undefined],
        ["変な数", true, undefined],
      ],
    );
  });

  console.log(`${passed} spoiler range checks passed.`);
}

void main();
