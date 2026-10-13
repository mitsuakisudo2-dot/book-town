import { ITAIJI } from "./itaiji";

// How a search reads text. searchFold is the one key titles, readings and
// queries are compared on; it is built only from steps that do not depend on a
// locale, so the database can repeat it exactly later (docs: search design §3):
//   F1 NFKD, Latin marks removed, NFKC (full-width → ASCII, ｶﾞ → ガ, ō → o);
//      then ヴァ ヴィ ヴェ ヴォ ヴュ as バ ビ ベ ボ ビュ, and ゝゞ written out (こゝろ → こころ)
//   F2 one pass of a character map (A–Z, katakana, small kana, は→わ, old kanji)
//   F3 only digits, a–z, hiragana, 々〆 and kanji are kept
//   F4 long vowels go (とうきょう = ときょ = トーキョー = tokyo)

const KATAKANA_FIRST = 0x30a1; // ァ
const KATAKANA_LAST = 0x30f6; // ヶ
const SMALL = "ぁぃぅぇぉっゃゅょゎゕゖ";
const LARGE = "あいうえおつやゆよわかけ";
// Library spelling: a particle is read as it sounds, and old kana as today's.
const SOUND_FROM = "はへをぢづゐゑゔ";
const SOUND_TO = "わえおじずいえぶ";

/** The F2 map as two strings of equal length: each source character and its final form. */
export function foldTable(): { from: string; to: string } {
  const map = new Map<string, string>();
  const final = (kana: string) => {
    const small = SMALL.indexOf(kana);
    const large = small >= 0 ? LARGE[small] : kana;
    const sound = SOUND_FROM.indexOf(large);
    return sound >= 0 ? SOUND_TO[sound] : large;
  };
  for (let code = KATAKANA_FIRST; code <= KATAKANA_LAST; code++)
    map.set(String.fromCharCode(code), final(String.fromCharCode(code - 0x60)));
  for (const kana of SMALL + SOUND_FROM) map.set(kana, final(kana));
  for (let code = 0x41; code <= 0x5a; code++)
    map.set(String.fromCharCode(code), String.fromCharCode(code + 0x20));
  for (const [old, common] of ITAIJI) map.set(old, common);
  let from = "";
  let to = "";
  for (const [source, target] of map)
    if (source !== target) {
      from += source;
      to += target;
    }
  return { from, to };
}

const MAP = (() => {
  const { from, to } = foldTable();
  const targets = Array.from(to);
  return new Map(Array.from(from).map((source, i) => [source, targets[i]]));
})();
const OLD_KANJI = new Map(ITAIJI);

const MARKS = /[̀-ͯ]/g;
const DROPPED = /[^0-9a-zぁ-ゖ々〆㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ffff}]/gu;

// ヴェニス is as often ベニス, and ヴァイオリン バイオリン: the pair becomes the
// バ row before the map, which turns a lone ヴ into ぶ.
const V_PAIR = /[ヴゔ]([ァィェォュぁぃぇぉゅ])/g;
const V_ROW: Record<string, string> = {
  ァ: "ば",
  ィ: "び",
  ェ: "べ",
  ォ: "ぼ",
  ュ: "びゅ",
  ぁ: "ば",
  ぃ: "び",
  ぇ: "べ",
  ぉ: "ぼ",
  ゅ: "びゅ",
};

/** ゝ and ヽ repeat the kana before them, ゞ and ヾ voice it: こゝろ = こころ, みすゞ = みすず. */
function writeOutRepeats(text: string): string {
  if (!/[ゝゞヽヾ]/.test(text)) return text;
  let out = "";
  let before = "";
  for (const char of text) {
    let next = char;
    if (before && (char === "ゝ" || char === "ヽ")) next = before;
    else if (before && (char === "ゞ" || char === "ヾ")) {
      const voiced = (before + "゙").normalize("NFC");
      next = voiced.length === 1 ? voiced : before;
    }
    out += next;
    before = next;
  }
  return out;
}

/** F1–F3: what was written, with long vowels kept. */
export function kanaFold(text: string): string {
  const plain = writeOutRepeats(
    (text ?? "")
      .normalize("NFKD")
      .replace(MARKS, "")
      .normalize("NFKC")
      .replace(V_PAIR, (_, small: string) => V_ROW[small]),
  );
  let out = "";
  for (const char of plain) out += MAP.get(char) ?? char;
  return out.replace(DROPPED, "");
}

// The kana each vowel lengthens: あ after the a-row, い after the i- and e-rows,
// う after the o- and u-rows, え after the e-row, お after the o-row.
const A_ROW = "あかさたなわまやらがざだばぱ";
const I_ROW = "いきしちにひみりぎじびぴ";
const U_ROW = "うくすつぬふむゆるぐずぶぷ";
const E_ROW = "えけせてねめれげぜでべぺ";
const O_ROW = "おこそとのほもよろごぞどぼぽ";
const LENGTHENS: Record<string, string> = {
  あ: A_ROW,
  い: I_ROW + E_ROW,
  う: O_ROW + U_ROW,
  え: E_ROW,
  お: O_ROW,
};

/** F4 on kanaFold's output: each vowel is tested against the character written before it. */
export function dropLongVowels(text: string): string {
  let out = "";
  let before = "";
  for (const char of text) {
    if (!before || !LENGTHENS[char]?.includes(before)) out += char;
    before = char;
  }
  return out;
}

/** The key searches compare on. */
export const searchFold = (text: string): string =>
  dropLongVowels(kanaFold(text));

/** Exactly as typed, give or take case, kana and old kanji: tells a true match from a folded one. */
export function strictFold(text: string): string {
  let out = "";
  for (const char of writeOutRepeats(
    (text ?? "").normalize("NFKC").toLowerCase(),
  )) {
    const code = char.codePointAt(0) ?? 0;
    const kana =
      code >= KATAKANA_FIRST && code <= KATAKANA_LAST
        ? String.fromCharCode(code - 0x60)
        : char;
    const common = OLD_KANJI.get(kana) ?? kana;
    if (/[\p{L}\p{N}]/u.test(common)) out += common;
  }
  return out;
}

/** Katakana written as hiragana, everything else as it was: for showing a reading. */
export const hiragana = (text: string): string =>
  text.replace(/[ァ-ヶ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60),
  );

export const isKana = (char: string) => /^[ぁ-ゖ]$/.test(char);
export const hasKanji = (text: string) =>
  /[々〆㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ffff}]/u.test(text);
