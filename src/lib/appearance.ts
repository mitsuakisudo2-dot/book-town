// How the town looks on this device: the palette the reader chose in 設定.
// A way of looking that belongs to this browser, like the reading screen's
// fold, so it is kept here and not in the account. The colours themselves
// are in src/app/tokens.css (`:root[data-palette=…]`); this only says which.
// The layout reads APPEARANCE_BOOT on the server, so the choosing (with its
// React hook) is in appearance-store.ts.

export const PALETTES = [
  { id: "green", name: "深緑", swatch: "var(--palette-green)" },
  { id: "brick", name: "煉瓦", swatch: "var(--palette-brick)" },
  { id: "ai", name: "藍", swatch: "var(--palette-ai)" },
  { id: "fuji", name: "藤", swatch: "var(--palette-fuji)" },
  { id: "yamabuki", name: "山吹", swatch: "var(--palette-yamabuki)" },
  { id: "sumi", name: "墨", swatch: "var(--palette-sumi)" },
] as const;

export type Palette = (typeof PALETTES)[number]["id"];

/** 深緑 is the first palette: `:root` itself, with no mark on `<html>`. */
export const FIRST_PALETTE: Palette = "green";

/** Room for the night (明るさ) later, in the same entry. */
export const APPEARANCE_KEY = "book-town-appearance-v1";

const isPalette = (value: unknown): value is Palette =>
  PALETTES.some((palette) => palette.id === value);

/** The palette in a kept entry, or the first one for anything else. */
export function paletteOf(kept: string | null): Palette {
  try {
    const palette = (JSON.parse(kept ?? "null") as { palette?: unknown })
      ?.palette;
    return isPalette(palette) ? palette : FIRST_PALETTE;
  } catch {
    return FIRST_PALETTE;
  }
}

/**
 * Run in the page's head before it is painted: marks `<html>` with the
 * chosen palette (`data-palette`), so the town never shows 深緑 first and
 * then changes. The same rule as `paletteOf`.
 */
export const APPEARANCE_BOOT = `try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)})||"null"),p=a&&a.palette;if(${JSON.stringify(
  PALETTES.map((palette) => palette.id).filter((id) => id !== FIRST_PALETTE),
)}.indexOf(p)>=0)document.documentElement.dataset.palette=p}catch(e){}`;
