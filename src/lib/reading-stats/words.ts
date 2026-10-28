// The words of the statistics screen (管理表 19), in one place, as the 刷新版
// 試作 says them (統計_工事向けのまとめ_刷新版_2026-10-28.md). Only the
// statistics read this file, so it stays out of words.ts, which every page
// reads. Counts are the reader's own records: shown as they are, 0 too
// (words.ts counted, けにーさん 10-16「数字に嘘をついてはいけない」).

import { counted, NAMES, type CountUnit } from "../words";
import type { Period, PeriodKind } from "./periods";
import type { StatCard, TileSize } from "./layout";
import type { DayKey } from "./zone";

/** A number and the unit it is counted in, drawn large and small: 4,763 ページ. */
export interface Amount {
  /** Before the number: 約, あと. */
  lead?: string;
  n: string;
  unit: StatsUnit;
}
/** The units the statistics count in: words.ts's, and the days and the height. */
export type StatsUnit = CountUnit | "日" | "cm" | "曜日";

/** 4,763: thousands set off, as the 試作 writes them. */
export const grouped = (n: number): string =>
  Math.round(n).toLocaleString("ja-JP");

/** An amount of the reader's own records. */
export const amount = (n: number, unit: StatsUnit, lead?: string): Amount => ({
  lead,
  n: grouped(n),
  unit,
});

/** Time read (rule 4: cut down, never rounded up): 131時間9分, 26分, and under a minute 0分. */
export function timeAmounts(seconds: number): Amount[] {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return [amount(minutes, "分")];
  return minutes % 60
    ? [amount(hours, "時間"), amount(minutes % 60, "分")]
    : [amount(hours, "時間")];
}

/** Time ahead (rule 4: an estimate, rounded, with 約): 約125時間, 約40分. */
export function aboutTime(seconds: number): Amount {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? amount(Math.round(minutes / 60), "時間", "約")
    : amount(Math.max(1, minutes), "分", "約");
}

/** The same in plain words, for a line of text: 131時間9分. */
export const timeWords = (seconds: number): string =>
  timeAmounts(seconds)
    .map((part) => part.n + part.unit)
    .join("");

/** An amount as a line of text: 約24冊. */
export const amountWords = (part: Amount): string =>
  (part.lead ?? "") + part.n + part.unit;

/** The names of the cards: the question each answers, short. */
export const CARD_NAMES: Record<StatCard, string> = {
  year: "の読書",
  chart: "読書時間チャート",
  days: "読んだ日",
  clock: "よく読む時間帯",
  genre: "よく読むジャンル",
  pace: "のペース",
  shelf: "本棚の本",
  joy: "これからの楽しみ",
  met: "出会った本",
  stack: "積んだ高さ",
  album: "最近のカード",
  shape: "どんな読み方をしている？",
};

/** The card's name for the period: 今年の読書, 10月のペース. */
export function cardName(card: StatCard, period: Period, today: DayKey): string {
  const name = CARD_NAMES[card];
  return card === "year" || card === "pace"
    ? periodName(period, today) + name
    : name;
}

/** The sizes, as the long press offers them. */
export const SIZE_NAMES: Record<TileSize, string> = {
  half: "2×2",
  wide: "2×4",
  full: "最大",
};

/** The period band's names. */
export const PERIOD_NAMES: Record<Exclude<PeriodKind, "custom">, string> = {
  day: "日",
  week: "週",
  month: "月",
  year: "年",
  all: "ぜんぶ",
};

const parts = (day: DayKey) => day.split("-").map(Number);

/** The period as the band heads it: 2026年, 10月, 10月27日〜11月2日, これまで. */
export function periodTitle(period: Period): string {
  const [y, m, d] = parts(period.from);
  const [, m2, d2] = parts(period.to);
  switch (period.kind) {
    case "day":
      return `${m}月${d}日`;
    case "week":
    case "custom":
      return `${m}月${d}日〜${m2}月${d2}日`;
    case "month":
      return `${y}年${m}月`;
    case "year":
      return `${y}年`;
    case "all":
      return "これまで";
  }
}

/** The period as a card names it: 今年, 去年, 10月, この週, これまで. */
export function periodName(period: Period, today: DayKey): string {
  const [y, m, d] = parts(period.from);
  const [ty] = parts(today);
  const holds = period.from <= today && today <= period.to;
  switch (period.kind) {
    case "day":
      return holds ? "今日" : `${m}月${d}日`;
    case "week":
      return holds ? "今週" : "この週";
    case "month":
      return holds ? "今月" : y === ty ? `${m}月` : `${y}年${m}月`;
    case "year":
      return holds ? "今年" : y === ty - 1 ? "去年" : `${y}年`;
    case "all":
      return "これまで";
    case "custom":
      return "この期間";
  }
}

/** The four hours of the day, as よく読む時間帯 names them (from 0, 4, … 20). */
export const BAND_NAMES = ["真夜中", "明け方", "朝", "昼", "夕方", "夜"];
/** And the reader of them: 夜更けの読書家. */
export const BAND_READERS = [
  "真夜中の読書家",
  "夜明けの読書家",
  "朝の読書家",
  "昼下がりの読書家",
  "夕暮れの読書家",
  "夜更けの読書家",
];
/** The hours a band runs: 20〜24時. */
export const bandHours = (band: number) => `${band * 4}〜${band * 4 + 4}時`;

/** Monday first, as the town's weeks are. */
export const WEEKDAYS_FROM_MONDAY = ["月", "火", "水", "木", "金", "土", "日"];
/** By Date's numbering, Sunday 0. */
export const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

/** What a card says before there is anything to count: it shows what can be done, not what is missing. */
export const NOT_YET = "これから";

export const STATS_WORDS = {
  open: "をくわしく見る",
  readingNow: (books: number) => `いま ${counted(books, "冊")}を読んでいます`,
  sameAs: (others: string) => `${others}と同じくらい`,
  soFar: "いまのところ",
  aheadIf: "このまま読むと",
  perDayRead: "1日に読む時間",
  shelfNow: "いまの状態",
  joyHow: "積読と読書中の残りを読み切るまで",
  joyNotYet: "読書をはじめると、読み切るまでの時間が出ます",
  metHow: `${NAMES.service} で出会い、読み終えた本`,
  metNotYet: "書店めぐりで出会って読み終えた本が、ここに並びます",
  metGo: "書店めぐりに出かける",
  stackHow: (books: number) => `読み終えた ${counted(books, "冊")}を積むと`,
  stackAhead: (books: number) => `読書中の ${counted(books, "冊")}を読み終えると`,
  yearNotYet: "読書をはじめると、読んだ本と時間がここにたまります",
  shelfNotYet: "本を登録すると、いまの状態が出ます",
  stackNotYet: "読み終えた本を積んでいきます",
  albumNotYet: "読み終えて「おわり」を押すと、ここにカードがたまります",
  clockNotYet: "読書をはじめると、ここに出ます",
  genreNotYet: "読むと、ここに出ます",
  paceNotYet: "本を開くと、ここに出ます",
  shapeNotYet: "読むと、自分の読み方が一文で出ます",
  readDaysHow: (month: number) => `今月（${month}月）`,
  chartTotal: (name: string) => `${name}の合計`,
  chartAverage: "1か月の平均",
  chartAverageDay: "1日の平均",
  pagesAndDays: (pages: string, days: string) => `${pages}・${days}`,
  states: { tsundoku: "積読", reading: "読書中", finished: "読了" },
  finishedBooks: "読んだ本",
  pagesRead: "読んだページ",
  daysRead: "読んだ日",
  timeRead: "読書時間",
  shelfFinishedHint: "読み終えるとここに並びます",
  readingShelf: "読書中",
  noBook: "本を選ばずに",
  shapeLead: (period: string) => `${period}は `,
  close: "閉じる",
  kindsAll: "すべての本",
  kindsLabel: "見る本",
  guessed: (books: number) =>
    `ページ数のわからない ${counted(books, "冊")}は、本棚の本の平均の厚さで見込んでいます`,
  unknownPages: (books: number) => `ページ数のわからない ${counted(books, "冊")}は入れていません`,
  undated: (books: number) =>
    `登録したときに読了にした ${counted(books, "冊")}は、いつ読んだかわからないので「ぜんぶ」だけに入れています`,
  timeBy: { time: "読んだ時間", count: "読んだ回数" },
  genreBy: { count: "冊数", pages: "ページ", time: "時間" },
  topGenre: "いちばん多いジャンル",
  daysPerBook: "1冊を読み終えるまで",
  perDay: "1日に",
  perReading: "1回に",
  perHour: "1時間に",
  averagePages: "読み終えた本は、1冊平均",
  mostWeekday: "よく読むのは",
  pagesBand: (from: number) => `${from}〜${counted(from + 100, "ページ")}`,
  metShare: (books: string) =>
    `読み終えた本のうち ${books} は、${NAMES.service} で出会った本です。`,
  sentenceEnd: (fromReading: boolean) =>
    fromReading ? "を読みました。" : "を読んでいます。",
  albumAll: (cards: string) => `この期間・ぜんぶで ${cards}`,
  sumLabel: "合計",
  topHour: (hour: number, says: string) => `いちばんは ${hour}時台・${says}`,
  arranging: "札の並べ替え",
  arrangeHint: "札を押して、大きさを選べます",
  sizeOf: (name: string) => `${name} の大きさ`,
  done: "完了",
  takeOut: (name: string) => `${name}を外す`,
  takenOut: (name: string) => `「${name}」を外しました`,
  undo: "元に戻す",
  addHere: "ここに欄を足す",
  addCard: "欄を足す",
  addTitle: "足す欄を選ぶ",
};
