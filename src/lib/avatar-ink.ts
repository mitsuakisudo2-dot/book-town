// The initial on a reader's round avatar: light or dark letters, whichever
// stands out more from the colour the reader chose. The avatar is a picture
// and keeps its colour at night, so the letters do too (globals.css
// `.reader-avatar`, `.reader-avatar.is-light-ink`).

const channel = (hex: string, at: number) => {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) +
  0.7152 * channel(hex, 3) +
  0.0722 * channel(hex, 5);
const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The light and the dark letters (tokens.css --on-dark and the day's --ink). */
export const AVATAR_INKS = { light: "#fffcf7", dark: "#2e2823" } as const;

/** Which letters stand out more on `color` (#rrggbb); dark for anything else. */
export function avatarInk(color: string): "light" | "dark" {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "dark";
  const back = luminance(color);
  return contrast(back, luminance(AVATAR_INKS.light)) >
    contrast(back, luminance(AVATAR_INKS.dark))
    ? "light"
    : "dark";
}

/** How far the chosen letters stand out on `color`. */
export const avatarInkContrast = (color: string) =>
  contrast(luminance(color), luminance(AVATAR_INKS[avatarInk(color)]));
