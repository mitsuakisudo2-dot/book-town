// Romaji in a query read as kana (Hepburn, 訓令式 and IME spellings), and kana
// written as romaji for counting the letters two titles share.

const VOWELS = "aiueo";
const ROWS: Array<[string, string]> = [
  ["", "あいうえお"],
  ["k", "かきくけこ"],
  ["s", "さしすせそ"],
  ["t", "たちつてと"],
  ["n", "なにぬねの"],
  ["h", "はひふへほ"],
  ["m", "まみむめも"],
  ["r", "らりるれろ"],
  ["l", "らりるれろ"],
  ["g", "がぎぐげご"],
  ["z", "ざじずぜぞ"],
  ["d", "だぢづでど"],
  ["b", "ばびぶべぼ"],
  ["p", "ぱぴぷぺぽ"],
];

const SYLLABLES: Record<string, string> = {
  ya: "や",
  yu: "ゆ",
  yo: "よ",
  ye: "いぇ",
  wa: "わ",
  wo: "を",
  wi: "うぃ",
  we: "うぇ",
  shi: "し",
  chi: "ち",
  tsu: "つ",
  fu: "ふ",
  ji: "じ",
  ja: "じゃ",
  ju: "じゅ",
  jo: "じょ",
  je: "じぇ",
  sha: "しゃ",
  shu: "しゅ",
  sho: "しょ",
  she: "しぇ",
  cha: "ちゃ",
  chu: "ちゅ",
  cho: "ちょ",
  che: "ちぇ",
  fa: "ふぁ",
  fi: "ふぃ",
  fe: "ふぇ",
  fo: "ふぉ",
  va: "ゔぁ",
  vi: "ゔぃ",
  vu: "ゔ",
  ve: "ゔぇ",
  vo: "ゔぉ",
  thi: "てぃ",
  dhi: "でぃ",
  jya: "じゃ",
  jyu: "じゅ",
  jyo: "じょ",
  cya: "ちゃ",
  cyu: "ちゅ",
  cyo: "ちょ",
};
for (const [consonant, kana] of ROWS)
  Array.from(VOWELS).forEach((vowel, i) => {
    SYLLABLES[consonant + vowel] ??= kana[i];
    // kya, sya, nyu…: the i-column kana with a small ゃゅょ.
    if (consonant && i < 3)
      SYLLABLES[consonant + "y" + "auo"[i]] = kana[1] + "ゃゅょ"[i];
  });

/**
 * A query written only in Latin letters, as kana. `tail` is a last syllable
 * still being typed ("anatanojins" → あなたのじん + "s"): the kana may then
 * match only the start of a title. Null for text that is not romaji (SF, 1Q84,
 * English words), which is still matched as written.
 */
export function romajiToKana(
  text: string,
): { kana: string; tail: string } | null {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s・\-]+/g, "")
    .replace(/’/g, "'");
  if (!/^[a-z']+$/.test(s) || !/[aiueo]/.test(s)) return null;
  let kana = "";
  let i = 0;
  while (i < s.length) {
    const char = s[i];
    const next = s[i + 1] ?? "";
    if (char === "'") {
      i++;
      continue;
    }
    if (char === "n" && !/[aiueoy]/.test(next)) {
      // nn, n' and n before a consonant or at the end are ん.
      kana += "ん";
      i += next === "n" && !/[aiueoy]/.test(s[i + 2] ?? "") ? 2 : 1;
      continue;
    }
    if (char === "m" && /[bmp]/.test(next)) {
      kana += "ん";
      i++;
      continue;
    }
    if (
      (char === next && /[bcdfghjkpqrstvwxz]/.test(char)) ||
      (char === "t" && next === "c")
    ) {
      kana += "っ";
      i++;
      continue;
    }
    const syllable = [3, 2, 1]
      .map((length) => s.slice(i, i + length))
      .find((part) => SYLLABLES[part]);
    if (!syllable) {
      if (/^[^aiueo']+$/.test(s.slice(i))) return { kana, tail: s.slice(i) };
      return null;
    }
    kana += SYLLABLES[syllable];
    i += syllable.length;
  }
  return { kana, tail: "" };
}

const LETTERS: Record<string, string> = { ん: "n" };
for (const [consonant, kana] of ROWS)
  if (consonant !== "l")
    Array.from(kana).forEach((char, i) => {
      LETTERS[char] = consonant + VOWELS[i];
    });
Object.assign(LETTERS, { や: "ya", ゆ: "yu", よ: "yo", わ: "wa" });

/** One spelling per kana of folded text (し si, ち ti, つ tu, ふ hu, ん n). */
export const kanaToRomaji = (folded: string): string =>
  Array.from(folded, (char) => LETTERS[char] ?? char).join("");
