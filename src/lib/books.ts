import type { Book, NewBook } from "./types";

const isbn13Valid = (digits: string) =>
  digits
    .split("")
    .reduce(
      (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1),
      0,
    ) %
    10 ===
  0;

const isbn10Valid = (digits: string) =>
  digits
    .split("")
    .reduce(
      (sum, digit, index) =>
        sum + (digit === "X" ? 10 : Number(digit)) * (10 - index),
      0,
    ) %
    11 ===
  0;

function isbn10To13(digits: string): string {
  const body = "978" + digits.slice(0, 9);
  const sum = body
    .split("")
    .reduce(
      (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
      0,
    );
  return body + String((10 - (sum % 10)) % 10);
}

/** Accepts ISBN-10 or ISBN-13 with hyphens or spaces; returns a checked ISBN-13 or null. */
export function normalizeIsbn(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(digits) && isbn13Valid(digits)) return digits;
  if (/^\d{9}[\dX]$/.test(digits) && isbn10Valid(digits))
    return isbn10To13(digits);
  return null;
}

// Registered books get an original jacket drawn from these tokens, never a scanned cover.
const jackets: Array<[string, string]> = [
  ["#374d53", "#f3ede1"],
  ["#768281", "#fff7e9"],
  ["#ad704f", "#fff7e9"],
  ["#5f6f52", "#f6f0df"],
  ["#8c5a5a", "#fbf3e8"],
  ["#4a5873", "#f1ece0"],
  ["#b39a6b", "#2f2a22"],
  ["#6d7c8a", "#fbf6ec"],
];

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export const REGISTERED_GENRE = "登録した本";

export function createRegisteredBook(id: string, book: NewBook): Book {
  const seed = hash(id + book.title);
  const [color, ink] = jackets[seed % jackets.length];
  return {
    id,
    title: book.title,
    author: book.author,
    genre: REGISTERED_GENRE,
    summary: "あなたが登録した本です。あらすじは登録されていません。",
    color,
    ink,
    height: 182 + (seed % 24),
    thickness: 30 + ((seed >> 5) % 12),
    pattern: (seed >> 9) % 6,
    ...(book.isbn ? { isbn: book.isbn } : {}),
    ...(book.price ? { price: book.price } : {}),
  };
}

export const formatPrice = (price: number): string =>
  "¥" + price.toLocaleString("ja-JP");
