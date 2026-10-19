// The volume a title ends in, read alike here and in the database
// (private.bib_volume_end, AUD-087): 進撃の巨人 2, 進撃の巨人（２）, 第2巻,
// 巻1, 2巻, 第2部, 1Q84 BOOK2, Vol.3, ノルウェイの森. 上, 前編, 銀河英雄伝説 二,
// Rocky IV. A volume is a mark: its number in figures (02 is 2, 二十三 is 23,
// IV is 4) or 上・中・下 (前編 is 上, 後編 下). Not a year (four figures),
// nor 1Q84, 天下, 世界の一部. tests/fixtures/volumes.ts holds the examples
// both are checked against (tests/db-judging.test.ts).

const SEPARATOR = /[\s([{「『【〔〈《.,、。・:;~〜/\-‐−―─—]/u;
const TRAILING_CLOSE = /[\s)\]}」』】〕〉》]+$/u;
const TRAILING_SEPARATORS = /[\s([{「『【〔〈《.,、。・:;~〜/\-‐−―─—]+$/u;
const NUMBER = "[0-9]+|[一二三四五六七八九十]+|[IVXivx]+";
const SUFFIX = "巻|部|集|編|篇";

const AFTER_KANJI = new RegExp(
  `((?:第|巻)\\s*(${NUMBER})\\s*(?:${SUFFIX})?)$`,
  "u",
);
const AFTER_LATIN = new RegExp(
  `((?:vol\\.?|volume|book|part|no\\.|#)\\s*(${NUMBER}))$`,
  "iu",
);
const BEFORE_SUFFIX = new RegExp(`((${NUMBER})\\s*(?:${SUFFIX}))$`, "u");
const NAMED_ALONE = /((上巻|中巻|下巻|前編|後編|前篇|後篇))$/u;
const NAMED_SPACED = /((上|中|下|中編|中篇))$/u;
const BARE = new RegExp(`((${NUMBER}))$`, "u");

const NAMED: Record<string, string> = {
  上: "上",
  上巻: "上",
  前編: "上",
  前篇: "上",
  中: "中",
  中巻: "中",
  中編: "中",
  中篇: "中",
  下: "下",
  下巻: "下",
  後編: "下",
  後篇: "下",
};
const KANJI_DIGITS = "一二三四五六七八九";
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10 };

/** A volume's number as a mark: 02 2, 二十三 23, IV 4; null for anything else (1984, 百). */
function numberMark(text: string): string | null {
  if (/^[0-9]{1,3}$/.test(text)) return String(Number(text));
  const kanji = text.match(
    /^([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)$/u,
  );
  if (kanji && text) {
    const digit = (c: string) => KANJI_DIGITS.indexOf(c) + 1;
    if (!kanji[2]) return text.length === 1 ? String(digit(text)) : null;
    return String(
      (kanji[1] ? digit(kanji[1]) : 1) * 10 + (kanji[3] ? digit(kanji[3]) : 0),
    );
  }
  const roman = text.toUpperCase();
  if (/^X{0,3}(IX|IV|V?I{0,3})$/.test(roman) && roman) {
    let total = 0;
    for (let i = 0; i < roman.length; i++) {
      const value = ROMAN[roman[i]];
      total += value < (ROMAN[roman[i + 1]] ?? 0) ? -value : value;
    }
    return String(total);
  }
  return null;
}

const kindOf = (number: string) =>
  /^[0-9]/.test(number)
    ? "figures"
    : /^[IVXivx]/.test(number)
      ? "roman"
      : "kanji";

/**
 * The volume at the end of a text, and the text before it (without the
 * spaces, brackets and dots between); null when it ends in none. The text
 * before may be empty (第2巻, 上).
 */
export function volumeAtEnd(
  text: string,
): { before: string; mark: string } | null {
  const rest = text.normalize("NFKC").replace(TRAILING_CLOSE, "");
  const before = (marker: string) => rest.slice(0, rest.length - marker.length);
  const last = (marker: string) =>
    Array.from(before(marker)).slice(-1)[0] ?? "";
  const separated = (marker: string) => {
    const char = last(marker);
    return char === "" || SEPARATOR.test(char);
  };
  const found = (marker: string, mark: string | null) =>
    mark === null
      ? null
      : { before: before(marker).replace(TRAILING_SEPARATORS, ""), mark };

  let m = rest.match(AFTER_KANJI);
  if (m) {
    const got = found(m[1], numberMark(m[2]));
    if (got) return got;
  }
  m = rest.match(AFTER_LATIN);
  if (m && !/[A-Za-z0-9]/.test(last(m[1]))) {
    const got = found(m[1], numberMark(m[2]));
    if (got) return got;
  }
  m = rest.match(BEFORE_SUFFIX);
  if (
    m &&
    (kindOf(m[2]) === "figures"
      ? !/[A-Za-z]/.test(last(m[1]))
      : separated(m[1]))
  ) {
    const got = found(m[1], numberMark(m[2]));
    if (got) return got;
  }
  m = rest.match(NAMED_ALONE);
  if (m && !/[上中下]/.test(last(m[1]))) return found(m[1], NAMED[m[2]]);
  m = rest.match(NAMED_SPACED);
  if (m && separated(m[1])) return found(m[1], NAMED[m[2]]);
  m = rest.match(BARE);
  if (m) {
    const kind = kindOf(m[2]);
    const fits =
      kind === "figures"
        ? !/[A-Za-z]/.test(last(m[1]))
        : separated(m[1]) && (kind === "kanji" || /^[IVX]+$/.test(m[2]));
    if (fits) return found(m[1], numberMark(m[2]));
  }
  return null;
}

/** The mark of a word that is a volume and nothing else (上, 第2巻, BOOK 3, vol.5); else null. */
export function volumeMark(word: string): string | null {
  const read = volumeAtEnd(word);
  return read && read.before === "" ? read.mark : null;
}

/** Whether two marks are one volume: the same, or 上 and 1, 中 and 2, 下 and 2 or 3. */
export function sameVolume(a: string, b: string): boolean {
  if (a === b) return true;
  const pair = [a, b].sort().join(" ");
  return ["1 上", "2 中", "2 下", "3 下"].includes(pair);
}

/** A mark's place among volumes, for sorting: 上 1, 中 2, 下 3, figures as they are. */
export const volumeOrder = (mark: string): number =>
  mark === "上" ? 1 : mark === "中" ? 2 : mark === "下" ? 3 : Number(mark) || 0;
