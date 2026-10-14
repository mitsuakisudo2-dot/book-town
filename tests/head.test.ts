import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// What every page's <head> asks for (src/app/layout.tsx), read from the
// layout's own HTML without a build, and how long browsers keep the theme
// images and fonts (vercel.json). A stylesheet from another origin must never
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

/** Runs the head's inline scripts on a page holding `link`. */
function runScripts(html: string, link: Attributes, sheet: object | null) {
  const listeners = new Map<string, () => void>();
  const element = {
    media: link.media,
    sheet,
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, listener),
  };
  const document = {
    getElementById: (id: string) => (id === link.id ? element : null),
  };
  for (const body of inlineScripts(html))
    new Function("document", body)(document);
  return { element, listeners };
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

  await check(
    "the font CSS turns on for the screen when it arrives, or at once if it has",
    () => {
      for (const link of tags(scripted(demo), "link").filter(
        fromAnotherOrigin,
      )) {
        const waiting = runScripts(demo, link, null);
        assert.equal(waiting.element.media, "print");
        waiting.listeners.get("load")?.();
        assert.equal(waiting.element.media, "all", link.href);
        // The CSS came before the script ran (from the cache, or while the
        // page's own CSS held the script back).
        const arrived = runScripts(demo, link, {});
        assert.equal(arrived.element.media, "all", link.href);
        assert.equal(arrived.listeners.size, 0);
      }
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

  console.log(passed + " head checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
