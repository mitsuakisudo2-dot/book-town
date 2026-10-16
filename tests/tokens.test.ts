import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { FIRST_PALETTE, PALETTES } from "../src/lib/appearance";
import { countStyles, type StyleCounts } from "./style-count";

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

/** The colours a block of tokens.css sets, by name. */
const coloursOf = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(
      ([, name, hex]) => [name, hex.toLowerCase()],
    ),
  );
const blocks = [
  ...tokens
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(:root[^{]*)\{([^}]*)\}/g),
];
const base = coloursOf(
  blocks.find(([, selector]) => selector.trim() === ":root")![2],
);
/** Each palette's own block: `:root[data-palette="…"]`. */
const paletteBlocks = Object.fromEntries(
  blocks
    .map(([, selector, body]) => [
      selector.match(/^:root\[data-palette="([\w-]+)"\]\s*$/)?.[1],
      coloursOf(body),
    ])
    .filter(([id]) => id),
) as Record<string, Record<string, string>>;
/** The colours by day with `palette` chosen (the first is :root alone). */
const coloursWith = (palette: string): Record<string, string> => ({
  ...base,
  ...(paletteBlocks[palette] ?? {}),
});
const night = coloursOf(
  blocks.find(
    ([, selector]) => selector.trim() === ':root[data-theme="dark"]',
  )?.[2] ?? "",
);
/** Each palette's night: `:root[data-palette="…"][data-theme="dark"]`. */
const nightPaletteBlocks = Object.fromEntries(
  blocks
    .map(([, selector, body]) => [
      selector.match(
        /^:root\[data-palette="([\w-]+)"\]\[data-theme="dark"\]\s*$/,
      )?.[1],
      coloursOf(body),
    ])
    .filter(([id]) => id),
) as Record<string, Record<string, string>>;
/** The colours at night with `palette` chosen, in the cascade's order. */
const nightColoursWith = (palette: string): Record<string, string> => ({
  ...coloursWith(palette),
  ...night,
  ...(nightPaletteBlocks[palette] ?? {}),
});
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

check(
  "every listed text and background pair is at least 4.5:1 by day, in each of the six palettes",
  () => {
    const pairs = [...tokens.matchAll(/@pair (--[\w-]+) (--[\w-]+)/g)];
    assert.ok(pairs.length >= 10, "tokens.css lists its pairs");
    for (const { id } of PALETTES) {
      const colours = coloursWith(id);
      for (const [, text, back] of pairs) {
        assert.ok(colours[text], `${text} has a colour in tokens.css`);
        assert.ok(colours[back], `${back} has a colour in tokens.css`);
        const ratio = contrast(colours[text], colours[back]);
        assert.ok(
          ratio >= 4.5,
          `${id}: ${text} on ${back} is ${ratio.toFixed(2)}:1, under 4.5:1`,
        );
      }
    }
  },
);

check(
  "every listed pair is at least 4.5:1 at night too, in each of the six palettes",
  () => {
    const pairs = [...tokens.matchAll(/@pair (--[\w-]+) (--[\w-]+)/g)];
    // The night redefines the paper, the ink, the lines and the palette:
    // every name the day sets except the swatches, the fonts' companions
    // and the colours that stay the same day and night.
    const stays = new Set(["--on-dark", "--on-photo", "--muted"]);
    for (const name of Object.keys(base))
      if (!name.startsWith("--palette-") && !stays.has(name))
        assert.ok(night[name], `the night sets ${name}`);
    for (const { id } of PALETTES) {
      const colours = nightColoursWith(id);
      for (const [, text, back] of pairs) {
        const ratio = contrast(colours[text], colours[back]);
        assert.ok(
          ratio >= 4.5,
          `${id} at night: ${text} on ${back} is ${ratio.toFixed(2)}:1, under 4.5:1`,
        );
      }
    }
    assert.deepEqual(
      Object.keys(nightPaletteBlocks).sort(),
      Object.keys(paletteBlocks).sort(),
      "a night block for every palette that has a day block",
    );
    for (const [id, colours] of Object.entries(nightPaletteBlocks))
      assert.deepEqual(
        Object.keys(colours).sort(),
        ["--green", "--green-soft", "--on-green"],
        `${id}'s night sets only the palette's colours`,
      );
  },
);

check(
  "a shop's own colour keeps its words readable, by day and at night",
  () => {
    const shopThemes = (prefix: string) =>
      Object.fromEntries(
        [
          ...tokens
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .matchAll(/(^|\n)([^{}\n]*)\.theme-([\w-]+)\s*\{([^}]*)\}/g),
        ]
          .filter(([, , selector]) => selector.trim() === prefix)
          .map(([, , , id, body]) => [id, coloursOf(body)]),
      );
    const day = shopThemes("");
    const atNight = shopThemes(':root[data-theme="dark"]');
    assert.deepEqual(Object.keys(day).sort(), ["ink", "ochre", "rose", "sage"]);
    assert.deepEqual(Object.keys(atNight).sort(), Object.keys(day).sort());
    for (const [id, own] of Object.entries(day))
      for (const [when, town, theme] of [
        ["by day", coloursWith(FIRST_PALETTE), own],
        [
          "at night",
          nightColoursWith(FIRST_PALETTE),
          { ...own, ...atNight[id] },
        ],
      ] as const) {
        for (const back of [
          theme["--theme-pale"],
          town["--sheet"],
          town["--paper"],
        ]) {
          const ratio = contrast(theme["--theme-deep"], back);
          assert.ok(
            ratio >= 4.5,
            `${id} ${when}: its words on ${back} are ${ratio.toFixed(2)}:1`,
          );
        }
        for (const words of [town["--ink"], town["--ink-2"]]) {
          const ratio = contrast(words, theme["--theme-pale"]);
          assert.ok(
            ratio >= 4.5,
            `${id} ${when}: ${words} on its pale is ${ratio.toFixed(2)}:1`,
          );
        }
        const sign = contrast(town["--on-dark"], theme["--theme-fill"]);
        assert.ok(
          sign >= 4.5,
          `${id} ${when}: its sign is ${sign.toFixed(2)}:1`,
        );
      }
  },
);

check("the six palettes are the decided ones, each in tokens.css", () => {
  // 深緑・煉瓦・藍・藤・山吹・墨, 深緑 first (けにー 2026-10-14).
  assert.deepEqual(
    PALETTES.map((palette) => palette.name),
    ["深緑", "煉瓦", "藍", "藤", "山吹", "墨"],
  );
  assert.equal(FIRST_PALETTE, PALETTES[0].id);
  assert.deepEqual(
    Object.keys(paletteBlocks).sort(),
    PALETTES.map((palette) => palette.id)
      .filter((id) => id !== FIRST_PALETTE)
      .sort(),
    "a block for every palette but the first, and no other",
  );
  // A palette changes the palette's four names only; the paper, the ink
  // and the lines stay the town's.
  for (const [id, colours] of Object.entries(paletteBlocks))
    assert.deepEqual(
      Object.keys(colours).sort(),
      ["--green", "--green-soft", "--on-green", "--on-photo"],
      `${id} sets only the palette's colours`,
    );
  // Each swatch in 設定 shows its own palette's colour.
  for (const { id, swatch } of PALETTES) {
    assert.equal(swatch, `var(--palette-${id})`);
    assert.equal(
      base[`--palette-${id}`],
      coloursWith(id)["--green"],
      `--palette-${id} is ${id}'s --green`,
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

check(
  "no screen writes more colours or small text of its own than before",
  () => {
    // The screens made before the rules keep what they had, counted in
    // tests/style-baseline.json, and lose it as each is worked on. A new file
    // starts with none (docs/色と部品の決まり.md).
    const baseline = JSON.parse(
      read("tests/style-baseline.json"),
    ) as StyleCounts;
    const now = countStyles();
    const problems: string[] = [];
    const what = {
      colours: "colours of its own (use the tokens)",
      smallText: "font sizes under 12px (use --t-cap or larger)",
    };
    for (const kind of ["colours", "smallText"] as const) {
      const files = new Set([
        ...Object.keys(baseline[kind]),
        ...Object.keys(now[kind]),
      ]);
      for (const file of [...files].sort()) {
        const had = baseline[kind][file] ?? 0;
        const has = now[kind][file] ?? 0;
        if (has > had)
          problems.push(`${file} has ${has} ${what[kind]}, ${had} allowed`);
        else if (has < had)
          problems.push(
            `${file} is down to ${has} ${kind}: set it to ${has} in tests/style-baseline.json${has ? "" : " (or remove the line)"}, so it stays there`,
          );
      }
    }
    assert.deepEqual(problems, [], problems.join("\n"));
  },
);

console.log(`tokens ok (${passed})`);
