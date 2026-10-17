import assert from "node:assert/strict";
import {
  COVER_SOURCES,
  coverRefusalsFrom,
  googleCover,
  googleQuestions,
  lookCovers,
  openBdCovers,
  shownCover,
  type CoverSourceName,
} from "../src/lib/covers";
import { lookUpBook, lookUpBooks } from "../src/lib/openbd";

// Checks where a book's cover is looked for, against stand-ins for openBD and
// Google Books. Everything runs inside main() because tsx compiles this file
// as CommonJS.

const KOKORO = "9784101010137";
const MOMO = "9784001141276";
const NONE = "9784000000002";

type Answer = { status?: number; body: unknown };

/** A stand-in for fetch that answers by host and records what was asked. */
function stand(answers: (url: URL) => Answer) {
  const asked: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(url.host + url.pathname + url.search);
    const { status = 200, body } = answers(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { asked, fetcher };
}

const openBdRecord = (isbn: string, cover = "") => ({
  summary: { isbn, cover },
});

const googleVolume = (isbn: string, thumbnail?: string) => ({
  volumeInfo: {
    industryIdentifiers: [{ type: "ISBN_13", identifier: isbn }],
    ...(thumbnail ? { imageLinks: { thumbnail } } : {}),
    canonicalVolumeLink: "https://books.google.com/books/about/x.html?id=x",
  },
});

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  console.log("PASS " + name);
}

async function main() {
  await check("covers are asked of openBD first, then Google Books", () => {
    assert.deepEqual(
      COVER_SOURCES.map((source) => source.name),
      ["openbd", "google"] satisfies CoverSourceName[],
    );
    assert.equal(COVER_SOURCES[0].keep, true);
    // Google's answers are not kept past the page.
    assert.equal(COVER_SOURCES[1].keep, false);
  });

  await check("openBD's answer is read in the asked order", () => {
    const found = openBdCovers(
      [KOKORO, NONE, MOMO],
      [
        openBdRecord(KOKORO, "https://cover.openbd.jp/9784101010137.jpg"),
        null,
        openBdRecord(MOMO, ""),
      ],
    );
    assert.deepEqual([...found.keys()], [KOKORO]);
    assert.deepEqual(found.get(KOKORO), {
      url: "https://cover.openbd.jp/9784101010137.jpg",
      source: "openbd",
    });
    // Only covers served over https are shown.
    assert.equal(
      openBdCovers([KOKORO], [openBdRecord(KOKORO, "http://x/y.jpg")]).size,
      0,
    );
  });

  await check(
    "a question openBD fails loses only its own ISBNs, not what others found",
    async () => {
      // Three questions of 100, 100 and 50; the second never gets an answer.
      const isbns = Array.from({ length: 250 }, (_, i) =>
        String(9784000000000 + i),
      );
      let questions = 0;
      const fetcher = (async (input: string | URL | Request) => {
        questions += 1;
        if (questions === 2) throw new TypeError("Failed to fetch");
        const asked = new URL(String(input)).searchParams
          .get("isbn")!
          .split(",");
        return new Response(
          JSON.stringify(
            asked.map((isbn, index) =>
              index === 0 ? { summary: { title: "本" + isbn } } : null,
            ),
          ),
        );
      }) as typeof fetch;
      const { found, unanswered } = await lookUpBooks(isbns, fetcher);
      assert.equal(questions, 3);
      assert.deepEqual([...found.keys()], [isbns[0], isbns[200]]);
      assert.deepEqual(unanswered, isbns.slice(100, 200));
      // One book whose question failed is simply not found.
      assert.equal(
        await lookUpBook(KOKORO, (async () => {
          throw new TypeError("Failed to fetch");
        }) as typeof fetch),
        null,
      );
    },
  );

  await check("Google's cover is its own thumbnail, for that very ISBN", () => {
    const cover = googleCover(MOMO, {
      items: [
        googleVolume("9780000000001", "https://books.google.com/other"),
        googleVolume(
          MOMO,
          "http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
        ),
      ],
    });
    assert.deepEqual(cover, {
      url: "https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&source=gbs_api",
      source: "google",
      link: "https://books.google.com/books/about/x.html?id=x",
    });
    assert.equal(googleCover(MOMO, { items: [googleVolume(MOMO)] }), null);
    assert.equal(googleCover(MOMO, {}), null);
  });

  await check(
    "a book openBD has no cover for is asked of Google; one neither has gets none",
    async () => {
      const { asked, fetcher } = stand((url) =>
        url.host === "api.openbd.jp"
          ? {
              body: [
                openBdRecord(KOKORO, "https://cover.openbd.jp/k.jpg"),
                openBdRecord(MOMO),
                null,
              ],
            }
          : url.searchParams.get("q") === "isbn:" + MOMO
            ? {
                body: {
                  items: [googleVolume(MOMO, "https://books.google.com/m")],
                },
              }
            : { body: {} },
      );
      const answers = await lookCovers(
        [KOKORO, MOMO, NONE],
        COVER_SOURCES,
        fetcher,
      );
      assert.equal(answers.get(KOKORO)?.source, "openbd");
      assert.equal(answers.get(MOMO)?.source, "google");
      assert.equal(answers.get(NONE), null);
      // openBD is asked once for all three; Google only for the two it lacked.
      assert.equal(
        asked.filter((u) => u.startsWith("api.openbd.jp")).length,
        1,
      );
      assert.match(asked[0], /isbn=9784101010137,9784001141276,9784000000002$/);
      const google = asked.filter((u) => u.startsWith("www.googleapis.com"));
      assert.equal(google.length, 2);
      assert.ok(google.every((u) => !u.includes(KOKORO)));
    },
  );

  await check(
    "Google is asked the title and author first, then the ISBN",
    () => {
      const [words, isbn] = googleQuestions(MOMO, {
        title: 'Re:ゼロ "モモ"',
        author: "-ミヒャエル・エンデ",
      }).map((question) => new URL(question).searchParams);
      // Quotes, colons and a leading minus are not read as Google's syntax.
      assert.equal(words.get("q"), "Re ゼロ モモ ミヒャエル・エンデ");
      assert.equal(words.get("maxResults"), "10");
      assert.equal(isbn.get("q"), "isbn:" + MOMO);
      assert.equal(isbn.get("maxResults"), "3");
      // A book without a title is asked by its ISBN only.
      assert.deepEqual(
        googleQuestions(MOMO).map((q) => new URL(q).searchParams.get("q")),
        ["isbn:" + MOMO],
      );
      assert.equal(googleQuestions(MOMO, { title: " " }).length, 1);
    },
  );

  await check(
    "Google's search by words finds the cover of that very ISBN only",
    async () => {
      // As Google answers since October 2026: nothing for isbn:, the book
      // among others for its title.
      const { asked, fetcher } = stand((url) => {
        if (url.host === "api.openbd.jp")
          return { body: [openBdRecord(MOMO), null] };
        const q = url.searchParams.get("q") ?? "";
        if (q.startsWith("isbn:")) return { body: {} };
        if (q.startsWith("モモ"))
          return {
            body: {
              items: [
                googleVolume("9784000000019", "https://books.google.com/o"),
                googleVolume(MOMO, "https://books.google.com/m"),
              ],
            },
          };
        // Another book's title brings only other editions.
        return {
          body: {
            items: [
              googleVolume("9784000000019", "https://books.google.com/o"),
            ],
          },
        };
      });
      const answers = await lookCovers(
        [MOMO, NONE],
        COVER_SOURCES,
        fetcher,
        new Set(),
        new Map(),
        new Map([
          [MOMO, { title: "モモ", author: "ミヒャエル・エンデ" }],
          [NONE, { title: "ない本" }],
        ]),
      );
      assert.equal(answers.get(MOMO)?.url, "https://books.google.com/m");
      assert.equal(answers.get(NONE), null);
      const google = asked
        .filter((u) => u.startsWith("www.googleapis.com"))
        .map((u) => new URL("https://" + u).searchParams.get("q"));
      // MOMO is found by its words and its ISBN is not asked; NONE is asked
      // both ways.
      assert.deepEqual(
        google.sort(),
        ["isbn:" + NONE, "モモ ミヒャエル・エンデ", "ない本"].sort(),
      );
    },
  );

  await check(
    "a source that cannot be asked rests, and leaves its books unsettled",
    async () => {
      const rest = new Set<CoverSourceName>();
      const { fetcher } = stand((url) =>
        url.host === "api.openbd.jp"
          ? { body: [openBdRecord(MOMO), null] }
          : { status: 429, body: {} },
      );
      const answers = await lookCovers(
        [MOMO, NONE],
        COVER_SOURCES,
        fetcher,
        rest,
      );
      // Not settled as coverless: Google may have them on another visit.
      assert.equal(answers.has(MOMO), false);
      assert.equal(answers.has(NONE), false);
      assert.deepEqual([...rest], ["google"]);

      // While it rests, only openBD is asked.
      const again = stand(() => ({
        body: [openBdRecord(MOMO, "https://cover.openbd.jp/m.jpg")],
      }));
      const later = await lookCovers(
        [MOMO],
        COVER_SOURCES,
        again.fetcher,
        rest,
      );
      assert.equal(later.get(MOMO)?.source, "openbd");
      assert.equal(again.asked.length, 1);
    },
  );
  await check(
    "a refused source is passed over for that book; the next is asked",
    async () => {
      const refused = coverRefusalsFrom([
        { isbn: KOKORO, source: "openbd" },
        { isbn: MOMO, source: "google" },
        { isbn: NONE, source: "openbd" },
        { isbn: NONE, source: "google" },
        // A source the app does not know is ignored.
        { isbn: MOMO, source: "elsewhere" },
      ]);
      assert.deepEqual([...refused.get(NONE)!].sort(), ["google", "openbd"]);
      assert.deepEqual([...refused.get(MOMO)!], ["google"]);
      const { asked, fetcher } = stand((url) =>
        url.host === "api.openbd.jp"
          ? { body: [openBdRecord(MOMO)] }
          : url.searchParams.get("q") === "isbn:" + KOKORO
            ? {
                body: {
                  items: [googleVolume(KOKORO, "https://books.google.com/k")],
                },
              }
            : { body: {} },
      );
      const answers = await lookCovers(
        [KOKORO, MOMO, NONE],
        COVER_SOURCES,
        fetcher,
        new Set(),
        refused,
      );
      // KOKORO: openBD refused, so Google's cover. MOMO: openBD has none and
      // Google is refused, so its 装丁カード. NONE: neither is asked.
      assert.equal(answers.get(KOKORO)?.source, "google");
      assert.equal(answers.get(MOMO), null);
      assert.equal(answers.get(NONE), null);
      assert.match(asked[0], /isbn=9784001141276$/);
      const google = asked.filter((u) => u.startsWith("www.googleapis.com"));
      assert.equal(google.length, 1);
      assert.ok(google[0].includes(KOKORO));
    },
  );

  await check("a book refused by every source asks nothing", async () => {
    const { asked, fetcher } = stand(() => ({ body: {} }));
    const answers = await lookCovers(
      [NONE],
      COVER_SOURCES,
      fetcher,
      new Set(),
      coverRefusalsFrom([
        { isbn: NONE, source: "openbd" },
        { isbn: NONE, source: "google" },
      ]),
    );
    assert.equal(answers.get(NONE), null);
    assert.equal(asked.length, 0);
  });

  await check(
    "a cover is shown only when its source is not refused, and refusals were read",
    () => {
      const cover = {
        url: "https://books.google.com/k",
        source: "google" as const,
      };
      const refused = coverRefusalsFrom([{ isbn: KOKORO, source: "google" }]);
      assert.equal(shownCover(KOKORO, cover, refused), null);
      assert.equal(shownCover(MOMO, cover, refused), cover);
      assert.equal(
        shownCover(KOKORO, { ...cover, source: "openbd" }, refused)?.source,
        "openbd",
      );
      assert.equal(shownCover(MOMO, cover, "unreadable"), null);
      assert.equal(shownCover(MOMO, null, new Map()), null);
    },
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
