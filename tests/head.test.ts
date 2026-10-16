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
 * Runs the head's inline scripts in a browser that kept `stored` from
 * earlier visits (or refuses storage, as some private windows do), whose
 * clock reads `now`, on a page still loading or already loaded. `element()`
 * is the font CSS the scripts added to the head, if they have; `pageLoad()`
 * finishes loading the page, and `load()` the CSS.
 */
function runScripts(
  html: string,
  {
    stored = new Map(),
    now = NOW,
    readyState = "loading",
  }: {
    stored?: Map<string, string> | "refused";
    now?: number;
    readyState?: "loading" | "complete";
  } = {},
) {
  const listeners = new Map<string, () => void>();
  const pageListeners = new Map<string, () => void>();
  const added: Attributes[] = [];
  const document = {
    readyState,
    getElementById: () => null,
    createElement: (tag: string) => ({
      tag,
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
    }),
    head: { appendChild: (element: Attributes) => added.push(element) },
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
    new Function("document", "localStorage", "Date", "addEventListener", body)(
      document,
      localStorage,
      { now: () => now },
      (type: string, listener: () => void) => pageListeners.set(type, listener),
    );
  assert.ok(added.length <= 1, "the font CSS is added once");
  return {
    element: (): Attributes | undefined => added[0],
    pageLoad: () => pageListeners.get("load")?.(),
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

// The bytes of every versioned image under public/themes and public/home
// (sha256, first 16 hex digits), named from public/.
// Browsers keep a -vN file for a year without asking again, so its bytes
// never change: a new look is a new name, -v(N+1), and the CSS or scene
// points at it (public/themes/woodshop/ASSETS.md). A new file is added here.
// A line stays when its file is removed, so the name cannot come back with
// other bytes.
const VERSIONED: Record<string, string> = {
  "themes/woodshop/chain-v1.svg": "6358aa666d2a980f",
  "themes/woodshop/daisy-vase-v1.svg": "4a858d967a99ac72",
  "themes/woodshop/fg-left-v1.webp": "82fb2c2c3de625cc",
  "themes/woodshop/fg-right-v1.webp": "35d267736179ef51",
  "themes/woodshop/globe-v1.svg": "9980300ea09f6189",
  "themes/woodshop/grain-chalk-v1.webp": "ed57ca2f4bf24b90",
  "themes/woodshop/grain-paper-v1.webp": "627e74baf9f78051",
  "themes/woodshop/ivy-clump-v1.svg": "df262aa08599cff9",
  "themes/woodshop/ivy-hang-v1.svg": "ee7c6f0b16dd9ee4",
  "themes/woodshop/ivy-pot-v1.svg": "6998ad857c85dbe7",
  "themes/woodshop/ivy-trail-v1.svg": "52621b232aad37be",
  "themes/woodshop/jackets-v2.webp": "cf31b8da745db2bd",
  "themes/woodshop/lamp-pendant-v1.svg": "f5c8827b4c9547ae",
  "themes/woodshop/planks-dark-v1.webp": "32ae191355a9f31f",
  "themes/woodshop/room-bokeh-v1.webp": "81e8e69f4a2f911e",
  "themes/woodshop/sign-plank-v1.webp": "e492097be980be54",
  "themes/woodshop/wood-v2.webp": "1fb65b6ac9a9a8e0",
  "home/lamp-1170-v1.webp": "af15ef867edd2336",
  "home/lamp-390-v1.webp": "f37e7752bde5ac54",
  "home/lamp-780-v1.webp": "a83a66bf92eba6fd",
  "home/shelves-1170-v1.webp": "66e24d3ac5085555",
  "home/shelves-390-v1.webp": "6703b32cbe91a434",
  "home/shelves-780-v1.webp": "97761269cfc822e9",
};

/** Where versioned images live: the woodshop's, and the home's carousel. */
const VERSIONED_FOLDERS = [
  path.join("public", "themes"),
  path.join("public", "home"),
];

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

  // The font CSS as the noscript fallback asks for it: the same address
  // the script asks for.
  const fonts = noscripts(demo)
    .flatMap((inner) => tags(inner, "link"))
    .filter(fromAnotherOrigin);

  await check(
    "no stylesheet from another origin is drawn without a media that holds up nothing",
    () => {
      for (const html of [demo, hosted]) {
        // Only the scripts add one, as a print sheet first.
        assert.deepEqual(
          tags(scripted(html), "link").filter(fromAnotherOrigin),
          [],
        );
        const added = runScripts(html, { readyState: "complete" }).element();
        assert.ok(added, "the web fonts are still asked for");
        assert.equal(added.rel, "stylesheet");
        assert.equal(added.media, "print");
        // A font that has not arrived yet leaves its text in the fallback
        // font, never blank.
        assert.match(added.href, /[?&]display=swap(&|$)/);
      }
    },
  );

  await check(
    "on a first visit the font CSS is asked for once the page has loaded, and turns on for the screen when it arrives",
    () => {
      const first = runScripts(demo);
      // Not while the town's own scripts are on their way.
      assert.equal(first.element(), undefined);
      first.pageLoad();
      assert.equal(first.element()?.media, "print");
      first.load();
      assert.equal(first.element()?.media, "all");
      // The scripts ran after the page loaded: asked for at once.
      const late = runScripts(demo, { readyState: "complete" });
      assert.equal(late.element()?.media, "print");
    },
  );

  await check(
    "a reader back within a day of loading the font CSS asks for it and turns it on at once",
    () => {
      const stored = new Map<string, string>();
      const first = runScripts(demo, { stored });
      first.pageLoad();
      first.load();
      assert.equal(stored.size, 1);
      // Most likely still in the HTTP cache: the first layout asks for the
      // font files instead of drawing frames without them.
      const soon = runScripts(demo, { stored, now: NOW + 23 * HOUR });
      assert.equal(soon.element()?.media, "all");
      assert.equal(soon.element()?.href, fonts[0].href);
      // Loaded again (from the cache, or after Google revalidated it): the
      // day starts again.
      soon.load();
      assert.equal(
        runScripts(demo, { stored, now: NOW + 46 * HOUR }).element()?.media,
        "all",
      );
      const later = runScripts(demo, { stored, now: NOW + 48 * HOUR });
      assert.equal(later.element(), undefined);
      later.pageLoad();
      later.load();
      assert.equal(later.element()?.media, "all");
      // Another CSS address (the fonts changed), a clock set back, or
      // storage refused: wait for the page as on a first visit.
      const [key] = stored.keys();
      for (const [kept, now] of [
        [
          `${NOW} ${fonts[0].href.replace("display=swap", "display=block")}`,
          NOW + HOUR,
        ],
        [`${NOW} ${fonts[0].href}`, NOW - HOUR],
      ] as const)
        assert.equal(
          runScripts(demo, { stored: new Map([[key, kept]]), now }).element(),
          undefined,
          kept,
        );
      const refused = runScripts(demo, { stored: "refused" });
      assert.equal(refused.element(), undefined);
      refused.pageLoad();
      refused.load();
      assert.equal(refused.element()?.media, "all");
    },
  );

  await check("without scripts the same CSS still loads", () => {
    assert.equal(fonts.length, 1);
    assert.equal(
      runScripts(demo, { readyState: "complete" }).element()?.href,
      fonts[0].href,
    );
    for (const link of fonts) assert.equal(link.media, undefined);
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
    "versioned images are kept a year; fonts and room.webp a week",
    () => {
      const year = "public, max-age=31536000, immutable";
      const week = "public, max-age=604800";
      for (const file of VERSIONED_FOLDERS.flatMap(filesIn)) {
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

  await check("a versioned image keeps its bytes under its name", () => {
    for (const file of VERSIONED_FOLDERS.flatMap(filesIn)) {
      const name = path.relative("public", file).split(path.sep).join("/");
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
