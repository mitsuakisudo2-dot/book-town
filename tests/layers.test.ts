import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { styledFiles } from "./style-count";

// What lies over what is named once, in src/app/tokens.css (--layer-…), so a
// Modal is never left under a bar by a number someone picked on their own.
// A screen's z-index is a layer, or a small number (-2 to 9) for the order
// of parts inside one part. The walk closes its layers in .walk-view and
// names its own in walk.css (--walk-z-…). Anything fixed to the screen
// takes a layer: it is compared with every other screen's.

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const uncommented = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

/** The custom properties `text` sets, with their values. */
const defined = (text: string) =>
  Object.fromEntries(
    [
      ...uncommented(text).matchAll(/(--(?:layer|walk-z)-[\w-]+):\s*(-?\d+);/g),
    ].map(([, name, value]) => [name, Number(value)]),
  );
const layers = defined(read("src/app/tokens.css"));
const walkLayers = defined(read("src/components/walk.css"));

const LOCAL = /^-?\d+$/;
const NAMED = /^(?:var\((--[\w-]+)\)|calc\(var\((--[\w-]+)\) [+-] \d\))$/;

/** The value is a layer, the walk's own, or a part's small order. */
function allowed(file: string, value: string): string | null {
  if (value === "auto") return null;
  if (LOCAL.test(value)) {
    const n = Number(value);
    return n >= -2 && n <= 9
      ? null
      : `${value} is a layer: use var(--layer-…) from tokens.css`;
  }
  const name = value.match(NAMED)?.slice(1).find(Boolean);
  if (!name) return `${value} is not a named layer`;
  if (name in layers) return null;
  if (name in walkLayers && file === "src/components/walk.css") return null;
  return `${name} is not a layer in tokens.css`;
}

/** Each rule's z-index in a CSS file, with whether it is fixed. */
function rulesOf(text: string) {
  const out: { value: string; fixed: boolean; at: string }[] = [];
  for (const [, selector, body] of uncommented(text).matchAll(
    /([^{}]*)\{([^{}]*)\}/g,
  )) {
    const z = body.match(/z-index:\s*([^;!]+?)\s*(?:!important)?\s*(?:;|$)/);
    if (!z) continue;
    out.push({
      value: z[1].trim(),
      fixed: /position:\s*fixed/.test(body),
      at: selector.trim().split("\n").at(-1)!.trim(),
    });
  }
  return out;
}

check("the layers go up in the order tokens.css lists them", () => {
  const values = Object.values(layers);
  assert.ok(values.length >= 8, "tokens.css names the layers");
  assert.deepEqual(
    values,
    [...values].sort((a, b) => a - b),
    "list the layers lowest first",
  );
  assert.ok(
    layers["--layer-sticky"] > 9,
    "a part's own order stays under the layers",
  );
  assert.ok(layers["--layer-tabbar"] < layers["--layer-modal"]);
  assert.ok(layers["--layer-page"] < layers["--layer-modal"]);
  assert.ok(layers["--layer-modal"] < layers["--layer-notes-button"]);
  assert.ok(layers["--layer-notes"] + 3 < layers["--layer-toast"]);
});

check(
  "every z-index on a screen is a named layer or a part's own order",
  () => {
    const wrong: string[] = [];
    for (const file of styledFiles()) {
      const text = read(file);
      if (file.endsWith(".css")) {
        for (const rule of rulesOf(text)) {
          const why = allowed(file, rule.value);
          if (why) wrong.push(`${file} ${rule.at}: ${why}`);
          else if (rule.fixed && !rule.value.includes("--layer-"))
            wrong.push(`${file} ${rule.at}: fixed to the screen, so a layer`);
        }
      } else {
        for (const [, value] of uncommented(text).matchAll(
          /zIndex:\s*(-?\d+)\b(?!\s*[-+*/])/g,
        )) {
          const why = allowed(file, value);
          if (why) wrong.push(`${file} zIndex ${why}`);
        }
        // Either side of a choice: `zIndex: lifted ? 9 : undefined`.
        for (const [, choice] of uncommented(text).matchAll(
          /zIndex:\s*[^,}?]*\?([^,}]*)/g,
        )) {
          for (const [value] of choice.matchAll(/-?\d+/g)) {
            const why = allowed(file, value);
            if (why) wrong.push(`${file} zIndex ${why}`);
          }
        }
      }
    }
    assert.deepEqual(wrong, []);
  },
);

check("a Modal on the walk rises over the town's bars", () => {
  assert.match(
    uncommented(read("src/components/walk.css")),
    /\.walk-view:has\(\.modal-backdrop\)\s*\{\s*z-index:\s*var\(--layer-modal\);/,
  );
});

console.log(`${passed} layer checks passed`);
