import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The town's colours and type live in src/app/tokens.css. These checks keep
// them readable, and keep the rules the screens were promised: Japanese text
// fills to the right edge (no `text-wrap: pretty`, which on an iPhone breaks
// lines early across a whole paragraph).

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

/** Every file under `dir` whose name ends with one of `ends`. */
function filesIn(dir: string, ends: string[]): string[] {
  return readdirSync(path.join(root, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) => entry.isFile() && ends.some((end) => entry.name.endsWith(end)),
    )
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)),
    );
}

const tokens = read("src/app/tokens.css");
const value = (name: string): string => {
  const found = tokens.match(new RegExp(`\\s${name}:\\s*(#[0-9a-f]{6});`, "i"));
  assert.ok(found, `${name} has a colour in tokens.css`);
  return found[1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

check("every listed text and background pair is at least 4.5:1 by day", () => {
  const pairs = [...tokens.matchAll(/@pair (--[\w-]+) (--[\w-]+)/g)];
  assert.ok(pairs.length >= 10, "tokens.css lists its pairs");
  for (const [, text, back] of pairs) {
    const ratio = contrast(value(text), value(back));
    assert.ok(
      ratio >= 4.5,
      `${text} on ${back} is ${ratio.toFixed(2)}:1, under 4.5:1`,
    );
  }
});

check("globals.css reads the tokens first", () => {
  const globals = read("src/app/globals.css");
  const lines = globals.split("\n");
  assert.equal(lines[0], '@import "tailwindcss";');
  assert.equal(lines[1], '@import "./tokens.css";');
  // The palette is the tokens' alone: no second set of the same names.
  for (const name of ["--paper", "--ink", "--green", "--line", "--muted"])
    assert.ok(
      !new RegExp(`\\s${name}:`).test(globals),
      `globals.css sets ${name} again`,
    );
});

check("no `text-wrap: pretty` in the town's CSS or components", () => {
  // walk.css keeps one, on a two-line shop name in the walk's header.
  const allowed: Record<string, number> = { "src/components/walk.css": 1 };
  for (const file of filesIn("src", [".css"])) {
    const css = read(file);
    // text-wrap: pretty, its longhand text-wrap-style, and with other words
    // (text-wrap: wrap pretty).
    const found =
      css.match(/text-wrap(-style)?\s*:[^;}]*\bpretty\b/g)?.length ?? 0;
    assert.ok(
      found <= (allowed[file] ?? 0),
      `${file} uses text-wrap: pretty (${found})`,
    );
    // Tailwind's class, applied from CSS.
    assert.ok(!/\btext-pretty\b/.test(css), `${file} uses text-pretty`);
  }
  // Tailwind is imported, so a class or a style would emit it too.
  for (const file of filesIn("src", [".tsx", ".ts"])) {
    const text = read(file);
    assert.ok(!/\btext-pretty\b/.test(text), `${file} uses text-pretty`);
    assert.ok(!/textWrap/.test(text), `${file} sets textWrap`);
  }
});

check("the town's own words take the device-first stack from --sans", () => {
  // Only tokens.css names the stacks; a reader's poster pins its two
  // typefaces there too (--poster-mincho, --poster-gothic).
  for (const file of filesIn("src", [".css"])) {
    if (file === path.join("src", "app", "tokens.css")) continue;
    for (const [rule] of read(file).matchAll(/font-family\s*:[^;}]*/g))
      assert.ok(
        !/^font-family\s*:\s*"Noto Sans JP"/.test(rule),
        `${file}: ${rule}`,
      );
  }
  assert.match(tokens, /--poster-mincho:\s*"Noto Serif JP"/);
  assert.match(tokens, /--poster-gothic:\s*"Noto Sans JP"/);
  const poster = read("src/components/poster.css");
  assert.match(
    poster,
    /\.poster-sheet\.is-mincho\s*\{\s*font-family:\s*var\(--poster-mincho\);/,
  );
  assert.match(
    poster,
    /\.poster-sheet\.is-gothic\s*\{\s*font-family:\s*var\(--poster-gothic\);/,
  );
});

check("letter.css and home.css take every colour from the tokens", () => {
  for (const file of [
    "src/components/letter/letter.css",
    "src/components/home/home.css",
  ]) {
    const css = read(file);
    const hex = css.match(/#[0-9a-f]{3,8}\b/gi);
    assert.equal(hex, null, `${file} has hex colours: ${hex?.join(", ")}`);
  }
  // The home writes its shades as the tokens mixed with transparent, never
  // as a colour of its own in another notation.
  const own = read("src/components/home/home.css").match(
    /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi,
  );
  assert.equal(own, null, `home.css has colours of its own: ${own}`);
});

check("covers are shown whole: no object-fit: cover on a jacket", () => {
  // v37 cropped its covers (app.css .cover); the town shows them as served.
  for (const file of [
    "src/components/letter/letter.css",
    "src/components/home/home.css",
  ]) {
    const css = read(file);
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      assert.ok(
        !/object-fit\s*:\s*cover/.test(body) ||
          !/jacket|cover|book/.test(selector),
        `${file}: ${selector.trim()} crops a cover`,
      );
  }
});

console.log(`tokens ok (${passed})`);
