import assert from "node:assert/strict";
import {
  COVER_SOURCES,
  googleCover,
  lookCovers,
  openBdCovers,
  type CoverSourceName,
} from "../src/lib/covers";

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
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
