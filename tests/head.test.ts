import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// What every page's <head> asks for (src/app/layout.tsx), read from the
// layout's own HTML without a build, and how long browsers keep the theme
// images and fonts (vercel.json), which holds only while a versioned image
// keeps its bytes. A stylesheet from another origin must never
// hold up the first paint: Google's font CSS once kept the town blank for
// seconds on a slow line. Everything runs inside main() because tsx compiles
// this file as CommonJS.

const SUPABASE = "https://test-project.supabase.co";
// Loads the layout afresh for each build, which import() would not.
const load = createRequire(__filename);

/** The layout's HTML, built with or without a Supabase project. */
function layoutHtml(supabase: boolean) {
  // The layout's CSS import is for the bundler; the head does not need it.
  load.extensions[".css"] = () => {};
  if (supabase) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
  // The project is read once, when the config module loads.
  for (const file of Object.keys(load.cache))
    if (file.includes(`${path.sep}src${path.sep}`)) delete load.cache[file];
  const { default: RootLayout } = load(
    "../src/app/layout",
  ) as typeof import("../src/app/layout");
  return renderToStaticMarkup(
    createElement(RootLayout, null, createElement("main")),
  );
}

type Attributes = Record<string, string>;

/** Each `<tag>` in the HTML, as its attributes. */
function tags(html: string, tag: string): Attributes[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, "g"))].map(
    ([, attributes]) =>
      Object.fromEntries(
        [...attributes.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(
          ([, name, value = ""]) => [name, value.replaceAll("&amp;", "&")],
        ),
      ),
  );
}

const noscripts = (html: string) =>
  [...html.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map(([, inner]) =>
    inner.replaceAll("&lt;", "<").replaceAll("&gt;", ">"),
  );
/** The HTML as a browser that runs scripts reads it. */
const scripted = (html: string) =>
  html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
const fromAnotherOrigin = (link: Attributes) =>
  link.rel === "stylesheet" && /^(https?:)?\/\//.test(link.href);
const inlineScripts = (html: string) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => body);

const NOW = Date.UTC(2026, 9, 14, 9);
const HOUR = 60 * 60 * 1000;

/**
 * Runs the head's inline scripts on a page holding `link`, in a browser that
 * kept `stored` from earlier visits (or refuses storage, as some private
 * windows do) and whose clock reads `now`. `load()` finishes the CSS.
 */
function runScripts(
  html: string,
  link: Attributes,
  {
    sheet = null,
    stored = new Map(),
    now = NOW,
  }: {
    sheet?: object | null;
    stored?: Map<string, string> | "refused";
    now?: number;
  } = {},
) {
  const listeners = new Map<string, () => void>();
  const element = {
    href: link.href,
    media: link.media,
    sheet,
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, listener),
  };
  const document = {
    getElementById: (id: string) => (id === link.id ? element : null),
  };
  const refused = () => {
    throw new Error("SecurityError");
  };
  const localStorage =
    stored === "refused"
      ? { getItem: refused, setItem: refused }
      : {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: unknown) =>
            stored.set(key, String(value)),
        };
  for (const body of inlineScripts(html))
    new Function("document", "localStorage", "Date", body)(
      document,
      localStorage,
      { now: () => now },
    );
  return {
    element,
    listeners,
    load: () => listeners.get("load")?.(),
  };
}

/** The Cache-Control that vercel.json gives a path, as Vercel matches it. */
function cacheControl(pathname: string) {
  const { headers } = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    headers: {
      source: string;
      headers: { key: string; value: string }[];
    }[];
  };
  let value: string | undefined;
  for (const rule of headers)
    if (getPathMatch(rule.source, { strict: true, sensitive: true })(pathname))
      for (const header of rule.headers)
        if (header.key === "Cache-Control") value = header.value;
  return value;
}

// The bytes of every versioned theme file (sha256, first 16 hex digits).
// Browsers keep a -vN file for a year without asking again, so its bytes
// never change: a new look is a new name, -v(N+1), and the CSS or scene
// points at it (public/themes/woodshop/ASSETS.md). A new file is added here.
// A line stays when its file is removed, so the name cannot come back with
// other bytes.
const VERSIONED: Record<string, string> = {
  "woodshop/chain-v1.svg": "6358aa666d2a980f",
  "woodshop/daisy-vase-v1.svg": "4a858d967a99ac72",
  "woodshop/fg-left-v1.webp": "82fb2c2c3de625cc",
  "woodshop/fg-right-v1.webp": "35d267736179ef51",
  "woodshop/globe-v1.svg": "9980300ea09f6189",
  "woodshop/grain-chalk-v1.webp": "ed57ca2f4bf24b90",
  "woodshop/grain-paper-v1.webp": "627e74baf9f78051",
  "woodshop/ivy-clump-v1.svg": "df262aa08599cff9",
  "woodshop/ivy-hang-v1.svg": "ee7c6f0b16dd9ee4",
  "woodshop/ivy-pot-v1.svg": "6998ad857c85dbe7",
  "woodshop/ivy-trail-v1.svg": "52621b232aad37be",
  "woodshop/jackets-v2.webp": "cf31b8da745db2bd",
  "woodshop/lamp-pendant-v1.svg": "f5c8827b4c9547ae",
  "woodshop/planks-dark-v1.webp": "32ae191355a9f31f",
  "woodshop/room-bokeh-v1.webp": "81e8e69f4a2f911e",
  "woodshop/sign-plank-v1.webp": "e492097be980be54",
  "woodshop/wood-v2.webp": "1fb65b6ac9a9a8e0",
};

const filesIn = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(path.join(folder, entry.name))
      : [path.join(folder, entry.name)],
  );

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const demo = layoutHtml(false);
  const hosted = layoutHtml(true);

  await check(
    "no stylesheet from another origin is drawn without a media that holds up nothing",
    () => {
      for (const html of [demo, hosted]) {
        const links = tags(scripted(html), "link").filter(fromAnotherOrigin);
        assert.ok(links.length > 0, "the web fonts are still asked for");
        for (const link of links) {
          assert.equal(link.media, "print", link.href);
          // A font that has not arrived yet leaves its text in the fallback
          // font, never blank.
          assert.match(link.href, /[?&]display=swap(&|$)/);
        }
      }
    },
  );

  const [fontsLink] = tags(scripted(demo), "link").filter(fromAnotherOrigin);

  await check(
    "the font CSS turns on for the screen when it arrives, or at once if it has",
    () => {
      const waiting = runScripts(demo, fontsLink);
      assert.equal(waiting.element.media, "print");
      waiting.load();
      assert.equal(waiting.element.media, "all");
      // The CSS came before the script ran (from the cache, or while the
      // page's own CSS held the script back).
      const arrived = runScripts(demo, fontsLink, { sheet: {} });
      assert.equal(arrived.element.media, "all");
      assert.equal(arrived.listeners.size, 0);
    },
  );

  await check(
    "a reader back within a day of loading the font CSS turns it on before it arrives",
    () => {
      const stored = new Map<string, string>();
      runScripts(demo, fontsLink, { stored }).load();
      assert.equal(stored.size, 1);
      // Most likely still in the HTTP cache: the first layout asks for the
      // font files instead of drawing frames without them.
      const soon = runScripts(demo, fontsLink, {
        stored,
        now: NOW + 23 * HOUR,
      });
      assert.equal(soon.element.media, "all");
      // Loaded again (from the cache, or after Google revalidated it): the
      // day starts again.
      soon.load();
      assert.equal(
        runScripts(demo, fontsLink, { stored, now: NOW + 46 * HOUR }).element
          .media,
        "all",
      );
      const later = runScripts(demo, fontsLink, {
        stored,
        now: NOW + 48 * HOUR,
      });
      assert.equal(later.element.media, "print");
      later.load();
      assert.equal(later.element.media, "all");
      // Another CSS address (the fonts changed), a clock set back, or
      // storage refused: wait for it as on a first visit.
      const [key] = stored.keys();
      for (const [kept, now] of [
        [
          `${NOW} ${fontsLink.href.replace("display=swap", "display=block")}`,
          NOW + HOUR,
        ],
        [`${NOW} ${fontsLink.href}`, NOW - HOUR],
      ] as const)
        assert.equal(
          runScripts(demo, fontsLink, {
            stored: new Map([[key, kept]]),
            now,
          }).element.media,
          "print",
          kept,
        );
      const refused = runScripts(demo, fontsLink, { stored: "refused" });
      assert.equal(refused.element.media, "print");
      refused.load();
      assert.equal(refused.element.media, "all");
    },
  );

  await check("without scripts the same CSS still loads", () => {
    const scriptedHrefs = tags(scripted(demo), "link")
      .filter(fromAnotherOrigin)
      .map((link) => link.href);
    const fallback = noscripts(demo)
      .flatMap((inner) => tags(inner, "link"))
      .filter(fromAnotherOrigin);
    assert.deepEqual(
      fallback.map((link) => link.href),
      scriptedHrefs,
    );
    for (const link of fallback) assert.equal(link.media, undefined);
  });

  await check(
    "a hosted build opens its line to Supabase early; the demo has none",
    () => {
      const preconnects = (html: string) =>
        tags(html, "link")
          .filter((link) => link.rel === "preconnect")
          .map((link) => [link.href, link.crossorigin ?? null]);
      assert.deepEqual(preconnects(hosted), [
        ["https://fonts.googleapis.com", null],
        ["https://fonts.gstatic.com", "anonymous"],
        // supabase-js fetches without cookies, on the anonymous connection.
        [SUPABASE, "anonymous"],
      ]);
      assert.deepEqual(preconnects(demo), preconnects(hosted).slice(0, 2));
    },
  );

  await check(
    "versioned theme images are kept a year; fonts and room.webp a week",
    () => {
      const year = "public, max-age=31536000, immutable";
      const week = "public, max-age=604800";
      for (const file of filesIn(path.join("public", "themes"))) {
        const pathname =
          "/" + path.relative("public", file).split(path.sep).join("/");
        if (/-v\d+\.(webp|svg)$/.test(pathname))
          assert.equal(cacheControl(pathname), year, pathname);
        // A name without a version can change in place, so it is never
        // kept as if it could not.
        else assert.notEqual(cacheControl(pathname), year, pathname);
      }
      assert.equal(cacheControl("/themes/woodshop/room.webp"), week);
      for (const file of filesIn(path.join("public", "fonts")))
        assert.equal(cacheControl("/fonts/" + path.basename(file)), week, file);
      // The rest of the site keeps Vercel's own revalidation.
      assert.equal(cacheControl("/"), undefined);
      assert.equal(cacheControl("/_next/static/media/x-v1.webp"), undefined);
    },
  );

  await check("a versioned theme file keeps its bytes under its name", () => {
    const themes = path.join("public", "themes");
    for (const file of filesIn(themes)) {
      const name = path.relative(themes, file).split(path.sep).join("/");
      if (!/-v\d+\.(webp|svg)$/.test(name)) continue;
      assert.ok(name in VERSIONED, `${name}: record its hash in VERSIONED`);
      assert.equal(
        createHash("sha256")
          .update(readFileSync(file))
          .digest("hex")
          .slice(0, 16),
        VERSIONED[name],
        `${name} changed in place: browsers keep the old bytes for a year, ` +
          "so save the new look as the next -vN name and point at that",
      );
    }
  });

  console.log(passed + " head checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
