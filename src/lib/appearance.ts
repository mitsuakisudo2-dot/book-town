// How the town looks on this device: the palette and the brightness (明るさ)
// the reader chose in 設定. A way of looking that belongs to this browser,
// like the reading screen's fold, so it is kept here and not in the account.
// The colours themselves are in src/app/tokens.css (`:root[data-palette=…]`,
// `:root[data-theme="dark"]`); this only says which.
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

/** 明るさ: 端末に合わせる (the first, 仮 from v37), 昼 or 夜. */
export const BRIGHTNESSES = [
  { id: "system", name: "端末に合わせる" },
  { id: "day", name: "昼" },
  { id: "night", name: "夜" },
] as const;

export type Brightness = (typeof BRIGHTNESSES)[number]["id"];

export const FIRST_BRIGHTNESS: Brightness = "system";

/** The palette and the brightness, in one entry: `{ palette, brightness }`. */
export const APPEARANCE_KEY = "book-town-appearance-v1";

export type Appearance = { palette: Palette; brightness: Brightness };

const isPalette = (value: unknown): value is Palette =>
  PALETTES.some((palette) => palette.id === value);
const isBrightness = (value: unknown): value is Brightness =>
  BRIGHTNESSES.some((brightness) => brightness.id === value);

/** What a kept entry says, with the first of each for anything else. */
export function appearanceOf(kept: string | null): Appearance {
  let entry: { palette?: unknown; brightness?: unknown } | null = null;
  try {
    entry = JSON.parse(kept ?? "null");
  } catch {
    // Not an entry this town wrote: the first of each.
  }
  const palette = entry?.palette;
  const brightness = entry?.brightness;
  return {
    palette: isPalette(palette) ? palette : FIRST_PALETTE,
    brightness: isBrightness(brightness) ? brightness : FIRST_BRIGHTNESS,
  };
}

/** The palette in a kept entry, or the first one for anything else. */
export const paletteOf = (kept: string | null): Palette =>
  appearanceOf(kept).palette;

/** Whether the night's colours apply: 夜, or 端末に合わせる on a dark device. */
export const isNight = (brightness: Brightness, deviceDark: boolean) =>
  brightness === "night" || (brightness === "system" && deviceDark);

/** The device's own setting, which 端末に合わせる follows. */
export const DEVICE_DARK = "(prefers-color-scheme: dark)";

/**
 * Run in the page's head before it is painted: marks `<html>` with the
 * chosen palette (`data-palette`) and, at night, `data-theme="dark"`, so the
 * town never shows 深緑 or the day first and then changes. The same rules as
 * `appearanceOf` and `isNight`. `data-brightness` keeps the choice on the
 * page, so 端末に合わせる follows the device when it turns dark or light
 * while the town is open (appearance-store.ts changes it with the choice).
 */
export const APPEARANCE_BOOT = `try{var d=document.documentElement,a=null;try{a=JSON.parse(localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)})||"null")}catch(e){}var p=a&&a.palette,b=a&&a.brightness;if(${JSON.stringify(
  PALETTES.map((palette) => palette.id).filter((id) => id !== FIRST_PALETTE),
)}.indexOf(p)>=0)d.dataset.palette=p;d.dataset.brightness=${JSON.stringify(
  BRIGHTNESSES.map((brightness) => brightness.id),
)}.indexOf(b)>=0?b:${JSON.stringify(FIRST_BRIGHTNESS)};var m=matchMedia(${JSON.stringify(
  DEVICE_DARK,
)});function t(){var n=d.dataset.brightness;if(n==="night"||(n==="system"&&m.matches))d.dataset.theme="dark";else delete d.dataset.theme}t();m.addEventListener("change",t)}catch(e){}`;
