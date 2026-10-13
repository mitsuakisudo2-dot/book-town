// How readable text is on screen, for journeys that check small, quiet text
// (WCAG AA asks 4.5:1 for text below 18px).

/**
 * The contrast of an element's text with the first opaque background behind
 * it, from the colors the browser computed.
 */
export async function contrastOf(locator) {
  return locator.evaluate((element) => {
    const channels = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let background = [255, 255, 255];
    for (let node = element; node; node = node.parentElement) {
      const color = channels(getComputedStyle(node).backgroundColor);
      if (color.length === 3 || color[3] === 1) {
        background = color.slice(0, 3);
        break;
      }
    }
    const text = channels(getComputedStyle(element).color).slice(0, 3);
    const [light, dark] = [luminance(text), luminance(background)].sort(
      (a, b) => b - a,
    );
    return (light + 0.05) / (dark + 0.05);
  });
}
