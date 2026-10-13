import { expect } from "@playwright/test";

// Words a reader has to read stand out from what is behind them: WCAG AA,
// 4.5:1 for text of the sizes the town uses.

/** Every match's text contrast against the first background behind it. */
export const contrastsOf = (locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const rgb = (value) => value.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => {
        const c = [r, g, b].map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      let back = element;
      let bg = "rgba(0, 0, 0, 0)";
      while (back && /rgba\(.*, 0\)$/.test(bg)) {
        bg = getComputedStyle(back).backgroundColor;
        back = back.parentElement;
      }
      const a = lum(rgb(getComputedStyle(element).color));
      const b = lum(rgb(bg));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }),
  );

/** Fails unless the locator matches something, all of it readable. */
export async function expectReadable(locator, label) {
  const contrasts = await contrastsOf(locator);
  expect(contrasts.length, label).toBeGreaterThan(0);
  for (const contrast of contrasts)
    expect(contrast, label).toBeGreaterThanOrEqual(4.5);
}
