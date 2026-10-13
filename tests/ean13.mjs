// EAN-13 barcodes for the barcode reader's tests (barcode-reader.test.ts,
// library-journey.mjs): a Japanese book's two codes, the ISBN (978…) above
// the price code (192…), drawn the same way every time.

const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const flip = (bits) => bits.replace(/./g, (bit) => (bit === "1" ? "0" : "1"));
const R = L.map(flip);
const G = R.map((bits) => [...bits].reverse().join(""));
// Which left-hand digits are written G, by the first digit.
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

/** The 13th digit for 12. */
export function withCheckDigit(body) {
  const sum = [...body].reduce(
    (total, digit, at) => total + Number(digit) * (at % 2 ? 3 : 1),
    0,
  );
  return body + ((10 - (sum % 10)) % 10);
}

/** An EAN-13 code's 95 modules, "1" for each bar. */
export function ean13Modules(code) {
  if (!/^\d{13}$/.test(code) || withCheckDigit(code.slice(0, 12)) !== code)
    throw new Error("Not an EAN-13 code: " + code);
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0]];
  const left = digits
    .slice(1, 7)
    .map((digit, at) => (parity[at] === "L" ? L : G)[digit])
    .join("");
  const right = digits
    .slice(7)
    .map((digit) => R[digit])
    .join("");
  return "101" + left + "01010" + right + "101";
}

/**
 * The two codes as grey pixels (0 black, 255 white), one above the other:
 * paper a little darker than white, ink a little lighter than black, bars
 * `module` pixels wide so their edges fall between pixels, and a little
 * noise from a fixed seed.
 */
export function bookBarcodes({
  isbn,
  price,
  module = 2.6,
  barHeight = 64,
  gap = 22,
  margin = 16,
}) {
  const quiet = 12 * module;
  const width = Math.ceil(2 * quiet + 95 * module);
  const height = 2 * margin + 2 * barHeight + gap;
  const gray = new Uint8Array(width * height).fill(236);
  let seed = 7;
  const noise = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed % 13) - 6;
  };
  const row = (code) => {
    const bars = ean13Modules(code);
    const shade = new Float64Array(width);
    for (let at = 0; at < 95; at++) {
      if (bars[at] !== "1") continue;
      const from = quiet + at * module;
      const to = from + module;
      for (let x = Math.floor(from); x < Math.ceil(to); x++)
        shade[x] += Math.min(to, x + 1) - Math.max(from, x);
    }
    return shade;
  };
  const draw = (shade, top) => {
    for (let y = top; y < top + barHeight; y++)
      for (let x = 0; x < width; x++)
        gray[y * width + x] = Math.round(236 - shade[x] * (236 - 38));
  };
  draw(row(isbn), margin);
  draw(row(price), margin + barHeight + gap);
  for (let at = 0; at < gray.length; at++)
    gray[at] = Math.min(255, Math.max(0, gray[at] + noise()));
  return { width, height, gray };
}
