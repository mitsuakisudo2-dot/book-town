// A title's parts: the title itself, its edition (新装版, ハヤカワ文庫SF), its
// volume (上, 2, BOOK 1) and a subtitle; and an author line's names.

import { volumeAtEnd, volumeMark, volumeOrder } from "./volume";

const EDITION =
  "新装版|増補改訂版|改訂新版|改訂版|増補版|決定版|完全版|愛蔵版|普及版|新訳版|文庫版|特装版|限定版";
// Short markers that also end ordinary words (最新版) need a space or a bracket.
const EDITION_SPACED = "新版|改版|新訳";
const SERIES = "文庫|新書|選書|叢書|シリーズ|全集|ライブラリ";
const OPEN = "(\\[［【〈《〔「『";
const CLOSE = ")\\]］】〉》〕」』";

// The same in the database: private.bib_title_volume (AUD-087).
const EDITION_AT_END = new RegExp(
  `\\s*(?:[${OPEN}]([^${OPEN}${CLOSE}]*(?:${EDITION}|${EDITION_SPACED}|${SERIES})[^${OPEN}${CLOSE}]*)[${CLOSE}]|(${EDITION})|\\s(${EDITION_SPACED}))\\s*$`,
  "u",
);
const SUBTITLE = /\s*(?::|\s―\s|──|――|——|\s[〜~]).*$/u;
const SOFT_EDITION = new RegExp(
  `^(?:${EDITION}|${EDITION_SPACED}|文庫|新書|単行本)$`,
  "iu",
);

/** Words a query may add after a title to ask for an edition or a volume: kept out of matching. */
export const isSoftTerm = (word: string) =>
  SOFT_EDITION.test(word) || /^[0-9]+$/.test(word) || volumeMark(word) !== null;

export interface TitleParts {
  /** The title without its edition, volume and subtitle. */
  base: string;
  /** The volume's mark (volume.ts): "" when the title names no volume. */
  mark: string;
  /** The volume's place for sorting (上 1, 下 3, 2 2): 0 when the title names none. */
  volume: number;
  edition: string;
  subtitle: string;
}

/**
 * The title without the edition and the volume at its end, and the volume's
 * mark ("" for none): 罪と罰 上 (新潮文庫) is 罪と罰 and 上. As the database
 * reads it (private.bib_title_volume).
 */
export function titleVolume(title: string): {
  rest: string;
  mark: string;
  edition: string;
} {
  let rest = title.normalize("NFKC").trim();
  let mark = "";
  let edition = "";
  // The edition and the volume can come in either order: 罪と罰 上 (新潮文庫).
  // One volume: ゴルゴ13 2 is volume 2 of ゴルゴ13.
  for (let pass = 0; pass < 3; pass++) {
    const before = rest;
    const ed = rest.match(EDITION_AT_END);
    if (ed && ed.index) {
      edition = (ed[1] ?? ed[2] ?? ed[3]).trim();
      rest = rest.slice(0, ed.index).trim();
    }
    const vol = mark ? null : volumeAtEnd(rest);
    if (vol && vol.before.trim()) {
      mark = vol.mark;
      rest = vol.before.trim();
    }
    if (rest === before) break;
  }
  return { rest, mark, edition };
}

export function splitTitle(title: string): TitleParts {
  const { rest: whole, mark, edition } = titleVolume(title);
  let rest = whole;
  let subtitle = "";
  const sub = rest.match(SUBTITLE);
  if (sub && sub.index) {
    subtitle = rest
      .slice(sub.index)
      .replace(/^[\s:―─—〜~]+|[〜~]$/gu, "")
      .trim();
    rest = rest.slice(0, sub.index).trim();
  }
  return {
    base: rest,
    mark,
    volume: mark ? volumeOrder(mark) : 0,
    edition,
    subtitle,
  };
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
