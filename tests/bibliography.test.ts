import assert from "node:assert/strict";
import {
  bibliographyFrom,
  holdFrom,
  showsIsbnCover,
  type BibliographyRow,
} from "../src/lib/bibliography";
import {
  bookHeading,
  bookNamedBy,
  masterAuthor,
  masterAuthorParts,
  masterPublication,
  masterSubtitle,
  masterTitle,
} from "../src/lib/book-name";

// The bibliographic master as the book's page shows it: a row of
// public.book_bibliography read into the app's shape, and the words made of
// it (docs/09「書誌マスタ」の「画面」). The people and books are made up.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const row = (fields: Partial<BibliographyRow> = {}): BibliographyRow => ({
  book_id: "00000000-0000-4000-8000-000000000001",
  title: "見本の物語",
  subtitle: null,
  volume: null,
  edition: null,
  series: [],
  creators: [{ name: "山田一郎", role: "著" }],
  publisher: "見本書房",
  issued: "2003-09",
  sources: { title: "ndl", creators: "ndl", publisher: "ndl", issued: "ndl" },
  ...fields,
});

const master = (fields: Partial<BibliographyRow> = {}) => {
  const read = bibliographyFrom(row(fields));
  assert.ok(read);
  return read;
};

check("a row is read into the master, trimmed, with only named people and series", () => {
  assert.deepEqual(
    master({
      title: " 見本の物語 ",
      subtitle: "",
      series: [{ name: "見本文庫", number: "12" }, { number: "3" }, "x"],
      creators: [{ name: "山田一郎", role: " 著 " }, { role: "訳" }, null],
    }),
    {
      title: "見本の物語",
      series: [{ name: "見本文庫", number: "12" }],
      creators: [{ name: "山田一郎", role: "著" }],
      publisher: "見本書房",
      issued: "2003-09",
      from: ["ndl"],
    },
  );
});

check("a row without a title is no master; a date of another shape is left out", () => {
  assert.equal(bibliographyFrom(row({ title: "  " })), null);
  assert.equal(master({ issued: "2003年" }).issued, undefined);
  assert.equal(master({ issued: "2003" }).issued, "2003");
});

check("the sources named are the shown fields', the library first", () => {
  assert.deepEqual(
    master({ sources: { publisher: "openbd", title: "ndl", ndc: "openbd" } }).from,
    ["ndl", "openbd"],
  );
  // An operator's correction, or a field the page does not show, names none.
  assert.deepEqual(master({ sources: { title: "fix", ndc: "openbd" } }).from, []);
  assert.deepEqual(master({ sources: null }).from, []);
});

check("the title carries its volume, once", () => {
  assert.equal(masterTitle({ title: "見本の物語", volume: "2" }), "見本の物語 2");
  assert.equal(masterTitle({ title: "見本の物語", volume: "下" }), "見本の物語 下");
  assert.equal(masterTitle({ title: "見本の物語", volume: "no.1" }), "見本の物語 no.1");
  assert.equal(masterTitle({ title: "見本の物語(2)", volume: "2" }), "見本の物語(2)");
  assert.equal(masterTitle({ title: "見本の物語 ２", volume: "2" }), "見本の物語 ２");
  assert.equal(masterTitle({ title: "見本の物語" }), "見本の物語");
  assert.equal(masterTitle({ title: "見本の物語（下）", volume: "下" }), "見本の物語（下）");
  // The title's own last word is not its volume.
  assert.equal(masterTitle({ title: "見本2001", volume: "1" }), "見本2001 1");
  assert.equal(masterTitle({ title: "見本の物語 no.1", volume: "no.1" }), "見本の物語 no.1");
});

check("the line under the title is the subtitle and the edition", () => {
  assert.equal(masterSubtitle({}), undefined);
  assert.equal(masterSubtitle({ subtitle: "ある町の話" }), "ある町の話");
  assert.equal(
    masterSubtitle({ subtitle: "ある町の話", edition: "新訳版" }),
    "ある町の話 新訳版",
  );
  assert.equal(masterSubtitle({ edition: "増補改訂版" }), "増補改訂版");
});

check("people who all wrote it are named one after another", () => {
  assert.equal(masterAuthor({ creators: [{ name: "山田一郎", role: "著" }] }), "山田一郎");
  assert.equal(
    masterAuthor({
      creators: [{ name: "Jane Doe", role: "[著]" }, { name: "山田花子" }],
    }),
    "Jane Doe、山田花子",
  );
});

check("people who did other things are named with what they did", () => {
  assert.equal(
    masterAuthor({
      creators: [
        { name: "Jane Doe", role: "著" },
        { name: "山田一郎", role: "訳" },
      ],
    }),
    "Jane Doe\u00a0著／山田一郎\u00a0訳",
  );
  assert.equal(
    masterAuthor({
      creators: [
        { name: "Jane Doe", role: "［著］" },
        { name: "山田一郎", role: "訳" },
        { name: "山田花子", role: "訳" },
      ],
    }),
    "Jane Doe\u00a0著／山田一郎、山田花子\u00a0訳",
  );
  assert.equal(
    masterAuthor({
      creators: [
        { name: "Jane Doe", role: "著" },
        { name: "山田一郎", role: "他訳" },
      ],
    }),
    "Jane Doe\u00a0著／山田一郎\u00a0他訳",
  );
  // openBD's codes: A01 is 著, B06 is 訳; a code it does not name is left unsaid.
  assert.equal(
    masterAuthor({
      creators: [
        { name: "Jane Doe", role: "A01" },
        { name: "山田一郎", role: "B06" },
        { name: "山田花子", role: "Z99" },
      ],
    }),
    "Jane Doe\u00a0著／山田一郎\u00a0訳／山田花子",
  );
  assert.equal(masterAuthor({ creators: [] }), "");
});

check("the page has the people a part for each role, to break between them", () => {
  assert.deepEqual(
    masterAuthorParts({
      creators: [
        { name: "Jane Doe", role: "著" },
        { name: "山田一郎", role: "訳" },
        { name: "山田花子", role: "訳" },
      ],
    }),
    ["Jane Doe\u00a0著", "山田一郎、山田花子\u00a0訳"],
  );
  assert.deepEqual(
    masterAuthorParts({
      creators: [{ name: "Jane Doe", role: "著" }, { name: "山田花子" }],
    }),
    ["Jane Doe、山田花子"],
  );
  assert.deepEqual(masterAuthorParts({ creators: [] }), []);
});

check("who published it, in which series, and when", () => {
  assert.equal(
    masterPublication({
      publisher: "見本書房",
      series: [{ name: "見本文庫" }],
      issued: "2003-09",
    }),
    "見本書房・見本文庫・2003年9月",
  );
  assert.equal(masterPublication({ publisher: "見本書房", series: [], issued: "2003" }), "見本書房・2003年");
  assert.equal(masterPublication({ series: [] }), undefined);
});

check("a book's page is headed by the master, else by what its reader typed", () => {
  const typed = { title: "みほんのものがたり", author: "Doe,Jane,1950-" };
  assert.deepEqual(bookHeading(typed, null), {
    title: "みほんのものがたり",
    author: ["Jane Doe"],
    publication: [],
  });
  assert.deepEqual(bookHeading({ title: "みほんのものがたり", author: "" }, null).author, []);
  assert.deepEqual(
    bookHeading(
      typed,
      master({
        volume: "上",
        subtitle: "ある町の話",
        creators: [
          { name: "Jane Doe", role: "著" },
          { name: "山田一郎", role: "訳" },
        ],
      }),
    ),
    {
      title: "見本の物語 上",
      subtitle: "ある町の話",
      author: ["Jane Doe\u00a0著", "山田一郎\u00a0訳"],
      publication: ["見本書房", "2003年9月"],
    },
  );
  // A master that names no one keeps the reader's author.
  assert.deepEqual(bookHeading(typed, master({ creators: [] })).author, ["Jane Doe"]);
});

check("the cover and the shop links go by the heading's name, people by name only", () => {
  const typed = { id: "x", title: "みほんのものがたり", author: "Doe,Jane,1950-" };
  assert.equal(bookNamedBy(typed, null), typed);
  assert.deepEqual(
    bookNamedBy(
      typed,
      master({
        volume: "上",
        creators: [
          { name: "Jane Doe", role: "著" },
          { name: "山田一郎", role: "訳" },
        ],
      }),
    ),
    { id: "x", title: "見本の物語 上", author: "Jane Doe、山田一郎" },
  );
  assert.equal(bookNamedBy(typed, master({ creators: [] })).author, "Doe,Jane,1950-");
});

check("a hold a day or more after the book was placed is told as a book registered before", () => {
  const row = {
    book_id: "x",
    held_at: "2026-10-19T08:00:00+00:00",
    placed_at: "2026-10-19T07:49:00+00:00",
    title: "見本の物語",
    creators: [{ name: "山田一郎", role: "著" }],
  };
  assert.deepEqual(holdFrom(row), {
    bookId: "x",
    heldAt: row.held_at,
    earlier: false,
    master: { title: "見本の物語", creators: [{ name: "山田一郎", role: "著" }] },
  });
  assert.equal(holdFrom({ ...row, placed_at: "2026-10-18T08:00:00+00:00" })?.earlier, true);
  // From a database that does not send it yet: as before.
  assert.equal(holdFrom({ ...row, placed_at: undefined })?.earlier, false);
  assert.equal(holdFrom({ ...row, title: null }), null);
});

check("a held book shows no cover of its ISBN, and nobody else can tell it is held", () => {
  const cover = (book: Partial<Parameters<typeof showsIsbnCover>[0]>) =>
    showsIsbnCover({ database: true, own: true, held: false, hasMaster: false, ...book });
  // Its reader: once their holds are known to leave it out, and only then.
  assert.equal(cover({}), true);
  assert.equal(cover({ held: null }), false);
  assert.equal(cover({ held: true }), false);
  assert.equal(cover({ held: true, hasMaster: true }), false);
  // Another reader's: as its master is shown, which a held book's is not, so
  // it looks like a book whose sources have not answered yet.
  assert.equal(cover({ own: false, held: null, hasMaster: true }), true);
  assert.equal(cover({ own: false, held: null, hasMaster: false }), false);
  // The demo's, a 見本, this browser's: as before.
  assert.equal(cover({ database: false, held: null }), true);
});

console.log(`${passed} bibliography checks passed`);
