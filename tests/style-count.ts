import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Counts, file by file, what a screen holds of its own instead of the
// tokens: colours written out (#hex, rgb() and the like, white and black)
// and text set under --t-cap (12px). tests/style-baseline.json keeps the
// counts of the screens made before the rules (docs/色と部品の決まり.md);
// tokens.test.ts stops any count that grows and asks for a smaller number
// when one shrinks, so the old screens only ever move towards the tokens.

const root = path.resolve(__dirname, "..");

/** The files a screen is made of: CSS and components. tokens.css is where
    the colours belong, so it is not counted. Colours kept as data (a
    sample book's jacket, a poster's inks) live in src/lib and are not a
    screen's colour. */
export function styledFiles(): string[] {
  return readdirSync(path.join(root, "src"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".css") || entry.name.endsWith(".tsx")),
    )
    .map((entry) =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    )
    .filter((file) => file !== "src/app/tokens.css")
    .sort();
}

/** The text without its comments, which may name a colour. */
const uncommented = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black)(?![\w-])/gi;

/** Colours written out in `text`. */
export const coloursIn = (text: string) =>
  uncommented(text).match(COLOUR)?.length ?? 0;

/** Font sizes under 12px written out in `text` (CSS, or a style in TSX). */
export const smallTextIn = (text: string) =>
  [
    ...uncommented(text).matchAll(/font-?size\s*:\s*["']?(\d+(?:\.\d+)?)px/gi),
  ].filter(([, size]) => Number(size) < 12).length;

export type StyleCounts = {
  colours: Record<string, number>;
  smallText: Record<string, number>;
};

/** Today's counts, leaving out files with none. */
export function countStyles(): StyleCounts {
  const counts: StyleCounts = { colours: {}, smallText: {} };
  for (const file of styledFiles()) {
    const text = readFileSync(path.join(root, file), "utf8");
    const colours = coloursIn(text);
    const small = smallTextIn(text);
    if (colours) counts.colours[file] = colours;
    if (small) counts.smallText[file] = small;
  }
  return counts;
}
