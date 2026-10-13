// A title's parts: the title itself, its edition (新装版, ハヤカワ文庫SF), its
// volume (上, 2, BOOK 1) and a subtitle; and an author line's names.

const EDITION =
  "新装版|増補改訂版|改訂新版|改訂版|増補版|決定版|完全版|愛蔵版|普及版|新訳版|文庫版|特装版|限定版";
// Short markers that also end ordinary words (最新版) need a space or a bracket.
const EDITION_SPACED = "新版|改版|新訳";
const SERIES = "文庫|新書|選書|叢書|シリーズ|全集|ライブラリ";
const OPEN = "(\\[［【〈《〔「『";
const CLOSE = ")\\]］】〉》〕」』";
const VOLUME =
  "上巻|中巻|下巻|上|中|下|前編|後編|前篇|後篇|第?[0-9一二三四五六七八九十]+巻|[0-9]+|[IVX]+|vol\\.?\\s*[0-9]+|book\\s*[0-9]+";

const EDITION_AT_END = new RegExp(
  `\\s*(?:[${OPEN}]([^${OPEN}${CLOSE}]*(?:${EDITION}|${EDITION_SPACED}|${SERIES})[^${OPEN}${CLOSE}]*)[${CLOSE}]|(${EDITION})|\\s(${EDITION_SPACED}))\\s*$`,
  "u",
);
const VOLUME_AT_END = new RegExp(
  `(?:\\s+|[${OPEN}])(${VOLUME})[${CLOSE}]?\\s*$`,
  "iu",
);
const SUBTITLE = /\s*(?::|\s―\s|──|――|——|\s[〜~]).*$/u;

/** Words a query may add after a title to ask for an edition or a volume: kept out of matching. */
export const SOFT_TERM = new RegExp(
  `^(?:${EDITION}|${EDITION_SPACED}|文庫|新書|単行本|${VOLUME})$`,
  "iu",
);
export const VOLUME_TERM = new RegExp(`^(?:${VOLUME})$`, "iu");

const KANJI_DIGITS = "一二三四五六七八九";
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10 };
const NAMED: Record<string, number> = {
  上: 1,
  中: 2,
  下: 3,
  上巻: 1,
  中巻: 2,
  下巻: 3,
  前編: 1,
  後編: 2,
  前篇: 1,
  後篇: 2,
};

/** The number of a volume marker: 上 1, 下 3, 第二巻 2, IV 4, BOOK 3 3. */
export function volumeNumber(marker: string): number {
  const text = marker.normalize("NFKC").toUpperCase().replace(/\s/g, "");
  if (NAMED[text]) return NAMED[text];
  const digits = text.match(/[0-9]+/);
  if (digits) return Number(digits[0]) || 1;
  const kanji = text.match(/[一二三四五六七八九十]+/);
  if (kanji) {
    const [tens, ones] = kanji[0].includes("十")
      ? kanji[0].split("十")
      : ["", kanji[0]];
    const digit = (c: string) => KANJI_DIGITS.indexOf(c) + 1;
    return (
      (kanji[0].includes("十") ? (tens ? digit(tens) : 1) * 10 : 0) +
      (ones ? digit(ones) : 0)
    );
  }
  if (/^[IVX]+$/.test(text)) {
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      const value = ROMAN[text[i]];
      total += value < (ROMAN[text[i + 1]] ?? 0) ? -value : value;
    }
    return total;
  }
  return 1;
}

export interface TitleParts {
  /** The title without its edition, volume and subtitle. */
  base: string;
  /** 0 when the title names no volume. */
  volume: number;
  edition: string;
  subtitle: string;
}

export function splitTitle(title: string): TitleParts {
  let rest = title.normalize("NFKC").trim();
  let volume = 0;
  let edition = "";
  // The edition and the volume can come in either order: 罪と罰 上 (新潮文庫).
  for (let pass = 0; pass < 3; pass++) {
    const before = rest;
    const ed = rest.match(EDITION_AT_END);
    if (ed && ed.index) {
      edition = (ed[1] ?? ed[2] ?? ed[3]).trim();
      rest = rest.slice(0, ed.index).trim();
    }
    const vol = rest.match(VOLUME_AT_END);
    if (vol && vol.index) {
      volume = volumeNumber(vol[1]);
      rest = rest.slice(0, vol.index).trim();
    }
    if (rest === before) break;
  }
  let subtitle = "";
  const sub = rest.match(SUBTITLE);
  if (sub && sub.index) {
    subtitle = rest
      .slice(sub.index)
      .replace(/^[\s:―─—〜~]+|[〜~]$/gu, "")
      .trim();
    rest = rest.slice(0, sub.index).trim();
  }
  return { base: rest, volume, edition, subtitle };
}

const ROLES = "編著|監修|監訳|原作|写真|ほか訳|ほか|著|作|文|絵|訳|編|画|他";
const ROLE = new RegExp(
  `\\s*[(（［\\[](?:${ROLES})[)）］\\]]\\s*$|\\s+(?:${ROLES})\\s*$|^(?:${ROLES})$`,
  "u",
);

/**
 * The people in an author line: split on ; / 、 and commas, without the roles
 * (著, 訳, 編…) written after a space or in brackets. 遠藤周作 keeps its 作.
 */
export function splitAuthors(author: string): string[] {
  return author
    .split(/[;；/／、,，]/)
    .map((name) =>
      name
        .replace(/[[［]ほか[\]］]/g, "")
        .replace(ROLE, "")
        .replace(ROLE, "")
        .trim(),
    )
    .filter(Boolean);
}
