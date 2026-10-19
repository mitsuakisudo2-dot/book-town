// How much JS each page of the built site reads before it can run: every
// script its HTML names, compressed as the server sends it. Prints one line
// per page, largest first. With --css, the same for its stylesheets: those
// the page reads first and those of the screens it draws (next/dynamic).
//
//   node scripts/perf/page-js.mjs [out] [--css] [--json | --baseline]
//
// tests/page-js.test.ts compares these with tests/page-js-baseline.json and
// tests/page-css-baseline.json (--baseline prints that file anew).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export function pageScripts(out, kind = "js") {
  const pages = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_next") walk(file);
      } else if (entry.name === "index.html") {
        const page = "/" + path.relative(out, dir).split(path.sep).join("/");
        const html = fs.readFileSync(file, "utf8");
        // The scripts it runs, and those it asks for ahead (a screen read
        // with next/dynamic that the page draws). A nomodule script (the
        // polyfills) is skipped by today's browsers.
        const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
        const tags =
          kind === "css"
            ? links.filter((tag) => /rel="stylesheet"/.test(tag))
            : [
                ...[...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]),
                ...links.filter(
                  (tag) => /rel="preload"/.test(tag) && /as="script"/.test(tag),
                ),
              ];
        const srcs = tags
          .filter((tag) => !/nomodule/i.test(tag))
          .map((tag) => tag.match(/\s(?:src|href)="([^"]+\.(?:js|css))"/)?.[1])
          .filter(Boolean)
          .map((src) => decodeURIComponent(src))
          .filter((src) => src.startsWith("/_next/"));
        pages[page === "/" ? "/" : page + "/"] = [...new Set(srcs)];
      }
    }
  };
  walk(out);
  return pages;
}

const sizes = new Map();
function compressed(out, src) {
  if (!sizes.has(src)) {
    const body = fs.readFileSync(path.join(out, src));
    sizes.set(src, {
      gz: zlib.gzipSync(body, { level: 9 }).length,
      br: zlib.brotliCompressSync(body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
    });
  }
  return sizes.get(src);
}

// Pages that only differ by their id (a demo book, shop or reader) read the
// same scripts; one of each is enough.
const same = (page) =>
  page
    .replace(/^\/books\/(?!registered\/)[^/]+\//, "/books/[id]/")
    .replace(/^\/shops\/[^/]+\//, "/shops/[id]/")
    .replace(/^\/profiles\/[^/]+\//, "/profiles/[id]/");

export function pageSizes(out, kind = "js") {
  const result = {};
  for (const [page, srcs] of Object.entries(pageScripts(out, kind))) {
    const key = same(page);
    if (key === "/404/" || key === "/_not-found/") continue;
    let gz = 0;
    let br = 0;
    for (const src of srcs) {
      const size = compressed(out, src);
      gz += size.gz;
      br += size.br;
    }
    const kb = { gz: Math.round(gz / 1024), br: Math.round(br / 1024) };
    if (!result[key] || result[key].br < kb.br) result[key] = kb;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.resolve(
    process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "out",
  );
  const result = pageSizes(out, process.argv.includes("--css") ? "css" : "js");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (process.argv.includes("--baseline")) {
    const lines = Object.fromEntries(
      Object.entries(result).map(([page, kb]) => [page, kb.br]),
    );
    console.log(JSON.stringify(lines, null, 2));
  } else {
    const rows = Object.entries(result).sort(([, a], [, b]) => b.br - a.br);
    for (const [page, kb] of rows)
      console.log(
        `${String(kb.br).padStart(5)}KB br ${String(kb.gz).padStart(5)}KB gz  ${page}`,
      );
  }
}
