import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  bookAuthor,
  bookById,
  bookByIsbn,
  booksById,
  bookTitle,
  quote,
  quotedTitle,
} from "../src/lib/book-name";

// A book's name reads the same everywhere because every screen asks
// src/lib/book-name.ts for it. These checks keep it that way: no title put in
// 『』 by hand, no book looked up by its ID with a find of its own, and no file
// reading `.title` / `.author` more often than it does today (most of what is
// left are the titles of posters and groups, and the book's own fields where
// it is saved or searched). The count covers the screens and the words they
// show (notices, posters, features); the code that saves, loads and searches
// books works on their own fields and is left out. A file is listed in
// tests/book-name-baseline.json and loses its count as it is worked on; a new
// file starts with none.

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

/** The app's own code: src, less this file's subject. */
const sources = readdirSync(path.join(root, "src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
  .filter((file) => file !== "src/lib/book-name.ts")
  .sort();

/** Where `pattern` (a /g pattern, which may span lines) matches, as "file:line". */
const where = (pattern: RegExp) =>
  sources.flatMap((file) => {
    const text = read(file);
    return [...text.matchAll(pattern)].map(
      (match) => `${file}:${text.slice(0, match.index).split("\n").length}`,
    );
  });

const book = {
  id: "b1",
  title: "銀河鉄道の夜",
  author: "宮沢賢治",
  isbn: "9784101092058",
};

check("the name of a book, in and out of 『』", () => {
  assert.equal(bookTitle(book), "銀河鉄道の夜");
  assert.equal(quotedTitle(book), "『銀河鉄道の夜』");
  assert.equal(quote("春と修羅"), "『春と修羅』");
  assert.equal(bookAuthor(book), "宮沢賢治");
});

check("an author headed the catalogue's way reads as on the book", () => {
  const author = (written: string) => bookAuthor({ author: written });
  assert.equal(
    author("King,Stephen,1947- 小尾,芙佐,1932-"),
    "Stephen King、小尾芙佐",
  );
  assert.equal(
    author("Thurber,James,1894-1961 鳴海,四郎,1917-2004"),
    "James Thurber、鳴海四郎",
  );
  assert.equal(author("富樫,義博,1966-"), "富樫義博");
  assert.equal(
    author("Hogan,JamesP.,1941-2010 池,央耿,1940-"),
    "James P. Hogan、池央耿",
  );
  assert.equal(
    author("Clarke,ArthurCharles 福島,正実"),
    "ArthurCharles Clarke、福島正実",
  );
  // Written any other way, the author is left as written.
  for (const written of [
    "宮沢賢治",
    "テッド・チャン",
    "John Doe",
    "山田一郎 編",
    "",
  ])
    assert.equal(author(written), written);
});

check("a book by its ID or ISBN, and none for none", () => {
  const books = [book, { ...book, id: "b2", isbn: undefined }];
  assert.equal(bookById(books, "b2"), books[1]);
  assert.equal(bookById(books, "b3"), undefined);
  assert.equal(bookById(books, null), undefined);
  assert.equal(bookById(books, ""), undefined);
  assert.deepEqual(booksById(books, ["b2", "gone", undefined, "b1"]), [
    books[1],
    books[0],
  ]);
  assert.equal(bookByIsbn(books, "9784101092058"), book);
  assert.equal(bookByIsbn(books, undefined), undefined);
});

check("no title put in 『』 by hand (use quotedTitle or quote)", () => {
  assert.deepEqual(where(/『\$?\{[^}]*\btitle\b/g), []);
});

check("no book found by its ID or ISBN by hand (use bookById)", () => {
  assert.deepEqual(
    where(
      /books\s*\.find\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.(id|isbn)\s*===\s*[\w.?!]+\s*,?\s*\)/g,
    ),
    [],
  );
});

/** Where a book's name is put into words for a reader. */
const SHOWN = [
  "src/components/",
  "src/app/",
  "src/lib/arrivals.ts",
  "src/lib/features.ts",
  "src/lib/home-feed.ts",
  "src/lib/letter.ts",
  "src/lib/live.ts",
  "src/lib/notifications.ts",
  "src/lib/posters.ts",
  "src/lib/social.ts",
  "src/lib/tonight.ts",
];

check("no more `.title` / `.author` than the baseline", () => {
  const baseline = JSON.parse(read("tests/book-name-baseline.json")) as Record<
    string,
    number
  >;
  const now = Object.fromEntries(
    sources
      .filter((file) => SHOWN.some((place) => file.startsWith(place)))
      .map(
        (file) =>
          [
            file,
            [...read(file).matchAll(/\.(title|author)\b/g)].length,
          ] as const,
      )
      .filter(([, count]) => count > 0),
  );
  const problems: string[] = [];
  for (const file of [
    ...new Set([...Object.keys(baseline), ...Object.keys(now)]),
  ].sort()) {
    const had = baseline[file] ?? 0;
    const has = now[file] ?? 0;
    if (has > had)
      problems.push(
        `${file} reads .title/.author ${has} times, ${had} allowed: show a book's name with bookTitle / quotedTitle / bookAuthor (src/lib/book-name.ts)`,
      );
    else if (has < had)
      problems.push(
        `${file} is down to ${has}: set it to ${has} in tests/book-name-baseline.json${has ? "" : " (or remove the line)"}, so it stays there`,
      );
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

console.log(`book names ok (${passed})`);
