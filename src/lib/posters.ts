import { ME_ID, type Book, type TownState } from "./types";
import type { ReviewCover, SpoilerView } from "./social";

// A poster is what a reader makes about books: a few pages, each set by its
// template (one book told at length, a lineup of covers, or words alone) in a
// chosen look. It is kept as data, never as a picture, so its words can be
// read, searched and set again for every screen; a cover leads to its book.
// A post is something said; a poster is something made. Both stay.

export const POSTER_TEMPLATES = ["one_book", "lineup", "text"] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];

export const POSTER_TEMPLATE_WORDS: Record<
  PosterTemplate,
  { name: string; hint: string }
> = {
  one_book: { name: "1冊を語る", hint: "大きな表紙と、長めの言葉" },
  lineup: { name: "並べる", hint: "2〜9冊の表紙と、見出し" },
  text: { name: "文章", hint: "雑誌の1ページのように、言葉だけ" },
};

export const POSTER_THEMES = [
  "kinari",
  "navy",
  "kosho",
  "wakakusa",
  "usubeni",
  "sumi",
] as const;
export type PosterTheme = (typeof POSTER_THEMES)[number];

/** Each look: its name, paper, ink and the accent of its rules and marks. */
export const POSTER_THEME_STYLES: Record<
  PosterTheme,
  { name: string; paper: string; ink: string; accent: string }
> = {
  kinari: {
    name: "生成り",
    paper: "#f4eddc",
    ink: "#2f2a22",
    accent: "#9b7b4a",
  },
  navy: { name: "夜の紺", paper: "#1f2a44", ink: "#f1ead8", accent: "#d8b56a" },
  kosho: {
    name: "古書の茶",
    paper: "#6e4f33",
    ink: "#f6ecd9",
    accent: "#e7c98f",
  },
  wakakusa: {
    name: "若草",
    paper: "#dfe6d2",
    ink: "#2d3a2c",
    accent: "#5f7a52",
  },
  usubeni: {
    name: "薄紅",
    paper: "#f1dcd6",
    ink: "#4a2c2c",
    accent: "#b06a62",
  },
  sumi: { name: "墨", paper: "#25231f", ink: "#f3efe6", accent: "#b9b2a3" },
};

export const POSTER_FONTS = ["mincho", "gothic"] as const;
export type PosterFont = (typeof POSTER_FONTS)[number];
export const POSTER_FONT_NAMES: Record<PosterFont, string> = {
  mincho: "明朝",
  gothic: "ゴシック",
};

/** The same limits as the database (supabase/migrations). */
export const POSTER_LIMITS = {
  pages: 10,
  booksPerPage: 9,
  books: 100,
  heading: 60,
  text: 2000,
} as const;

export interface PosterPage {
  heading: string;
  text: string;
  bookIds: string[];
}

export interface Poster {
  id: string;
  authorId: string;
  template: PosterTemplate;
  theme: PosterTheme;
  font: PosterFont;
  pages: PosterPage[];
  /** Its words give a story away: shown behind a door until opened. */
  spoiler: boolean;
  /** Also shown on the timeline, beside posts. */
  inTimeline: boolean;
  /** A draft is the author's alone, and may be unfinished. */
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
}

export type PosterDraft = Pick<
  Poster,
  "template" | "theme" | "font" | "pages" | "spoiler" | "inTimeline" | "status"
>;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** How many books each template's page holds. */
export const pageBooks: Record<PosterTemplate, { min: number; max: number }> = {
  one_book: { min: 1, max: 1 },
  lineup: { min: 2, max: POSTER_LIMITS.booksPerPage },
  text: { min: 0, max: 0 },
};

export const emptyPage = (): PosterPage => ({
  heading: "",
  text: "",
  bookIds: [],
});

/**
 * A poster's fields as far as they are well formed, or null when they are not
 * (an unknown template or look, too many pages, words or books, a book the
 * town does not know). A draft may be unfinished; whether it can be put up
 * is posterProblem's question.
 */
export function cleanPosterDraft(
  value: unknown,
  bookIds: ReadonlySet<string>,
): PosterDraft | null {
  if (!object(value)) return null;
  const template = value.template as PosterTemplate;
  const theme = value.theme as PosterTheme;
  const font = value.font as PosterFont;
  if (
    !POSTER_TEMPLATES.includes(template) ||
    !POSTER_THEMES.includes(theme) ||
    !POSTER_FONTS.includes(font) ||
    !Array.isArray(value.pages) ||
    value.pages.length < 1 ||
    value.pages.length > POSTER_LIMITS.pages
  )
    return null;
  const pages: PosterPage[] = [];
  let books = 0;
  for (const page of value.pages) {
    if (!object(page)) return null;
    const heading = typeof page.heading === "string" ? page.heading.trim() : "";
    const text = typeof page.text === "string" ? page.text.trim() : "";
    const ids = Array.isArray(page.bookIds) ? page.bookIds : [];
    if (
      [...heading].length > POSTER_LIMITS.heading ||
      [...text].length > POSTER_LIMITS.text ||
      ids.length > pageBooks[template].max ||
      !ids.every((id) => typeof id === "string" && bookIds.has(id)) ||
      new Set(ids).size !== ids.length
    )
      return null;
    books += ids.length;
    pages.push({ heading, text, bookIds: ids as string[] });
  }
  if (books > POSTER_LIMITS.books) return null;
  return {
    template,
    theme,
    font,
    pages,
    spoiler: value.spoiler === true,
    inTimeline: value.inTimeline === true,
    status: value.status === "draft" ? "draft" : "published",
  };
}

/**
 * A kept poster read back (from this browser or the database), its books
 * limited to those the town knows: a book that is gone leaves its page, the
 * poster stays. Null when the rest is not well formed.
 */
export function restorePoster(
  value: unknown,
  bookIds: ReadonlySet<string>,
): Poster | null {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 200 ||
    typeof value.authorId !== "string" ||
    !value.authorId ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !Array.isArray(value.pages)
  )
    return null;
  const pages = value.pages.map((page: unknown) =>
    object(page) && Array.isArray(page.bookIds)
      ? {
          ...page,
          bookIds: page.bookIds.filter(
            (id): id is string => typeof id === "string" && bookIds.has(id),
          ),
        }
      : page,
  );
  const draft = cleanPosterDraft({ ...value, pages }, bookIds);
  if (!draft) return null;
  const updatedAt =
    typeof value.updatedAt === "string" &&
    !Number.isNaN(Date.parse(value.updatedAt))
      ? value.updatedAt
      : value.createdAt;
  return {
    id: value.id,
    authorId: value.authorId,
    ...draft,
    createdAt: value.createdAt,
    updatedAt,
  };
}

/**
 * Why the poster cannot be put up yet, in the words the maker reads, or null
 * when it can. Every page needs its books, and words to go with them.
 */
export function posterProblem(draft: PosterDraft): string | null {
  const need = pageBooks[draft.template];
  for (const [index, page] of draft.pages.entries()) {
    const where = draft.pages.length > 1 ? `${index + 1}ページ目に、` : "";
    if (page.bookIds.length < need.min)
      return need.min === 1
        ? `${where}本を1冊選んでください。`
        : `${where}本を${need.min}冊以上選んでください。`;
    if (draft.template === "lineup" && index === 0 && !page.heading)
      return "見出しを書いてください。";
    if (draft.template !== "lineup" && !page.heading && !page.text)
      return draft.template === "one_book"
        ? `${where}ひとことを書いてください。`
        : `${where}見出しか本文を書いてください。`;
  }
  return null;
}

/** Every book on the poster once, in order of first appearance. */
export function posterBookIds(poster: Pick<Poster, "pages">): string[] {
  return [...new Set(poster.pages.flatMap((page) => page.bookIds))];
}

/** What a poster is called in a list: its first heading, or its first book. */
export function posterTitle(
  poster: Pick<Poster, "pages">,
  books: Pick<Book, "id" | "title">[],
): string {
  const heading = poster.pages.find((page) => page.heading)?.heading;
  if (heading) return heading;
  const first = posterBookIds(poster)[0];
  const book = books.find((entry) => entry.id === first);
  if (book) return `『${book.title}』`;
  const text = poster.pages.find((page) => page.text)?.text ?? "";
  return text.length > 24 ? text.slice(0, 24) + "…" : text || "ポスター";
}

/**
 * What a poster folded by reports is called where it is listed or titled:
 * none of its words, nor its books.
 */
export const FOLDED_POSTER_NAMES: Record<ReviewCover, string> = {
  folded: "たたんでいるポスター",
  reported: "あなたが通報したポスター",
};

const newestFirst = (a: Poster, b: Poster) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** The posters others may see: put up, not drafts. */
export const isPublished = (poster: Poster) => poster.status === "published";

/**
 * How a poster reaches this reader, by its maker's spoiler mark and the
 * reader's 「ネタバレの表示」, as a post its writer marked does: behind its
 * door whatever the setting, and not listed at all for a reader who chose
 * 出さない. The maker always sees their own.
 */
export function posterSpoilerView(
  state: Pick<TownState, "settings">,
  poster: Pick<Poster, "spoiler" | "authorId">,
): SpoilerView {
  if (!poster.spoiler) return "open";
  if (
    state.settings.spoilerDisplay === "leave_out" &&
    poster.authorId !== ME_ID
  )
    return "left_out";
  return "folded";
}

const listed = (state: TownState, poster: Poster) =>
  posterSpoilerView(state, poster) !== "left_out";

/**
 * A reader's posters as this reader gets them, newest first; the viewer
 * also sees their drafts.
 */
export function postersOf(state: TownState, readerId: string): Poster[] {
  return state.posters
    .filter(
      (poster) =>
        poster.authorId === readerId &&
        (isPublished(poster) || readerId === ME_ID) &&
        listed(state, poster),
    )
    .sort(newestFirst);
}

const showsBook = (poster: Poster, bookId: string) =>
  isPublished(poster) &&
  poster.pages.some((page) => page.bookIds.includes(bookId));

/**
 * The posters a book appears in, as this reader gets them: those that show
 * it on their first page first, then newest first.
 */
export function postersOfBook(state: TownState, bookId: string): Poster[] {
  const firstPage = (poster: Poster) =>
    poster.pages[0]?.bookIds.includes(bookId) ? 0 : 1;
  return state.posters
    .filter((poster) => showsBook(poster, bookId) && listed(state, poster))
    .sort((a, b) => firstPage(a) - firstPage(b) || newestFirst(a, b));
}

/**
 * Whether the reader's 「ネタバレの表示」 kept any of a book's posters out,
 * which its page says once, without a count.
 */
export const postersLeftOutOfBook = (
  state: TownState,
  bookId: string,
): boolean =>
  state.posters.some(
    (poster) => showsBook(poster, bookId) && !listed(state, poster),
  );

/**
 * The posters their makers chose to show on the timeline, as this reader
 * gets them; with `followingOnly`, those of followed owners and the
 * viewer's own.
 */
export function timelinePosters(
  state: TownState,
  followingOnly = false,
): Poster[] {
  const owners = new Set(
    state.shops
      .filter((shop) => state.following.includes(shop.id))
      .map((shop) => shop.ownerId),
  );
  return state.posters.filter(
    (poster) =>
      isPublished(poster) &&
      poster.inTimeline &&
      listed(state, poster) &&
      (!followingOnly ||
        poster.authorId === ME_ID ||
        owners.has(poster.authorId)),
  );
}

// In the database a page is a list of blocks, so later templates (a ranking,
// photos) and free layouts can add kinds of block without a new table.
export type PosterBlockRow =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "books"; book_ids: string[] };
export type PosterPageRow = { blocks: PosterBlockRow[] };

/** The pages as the database keeps them; `rowId` names a book there. */
export function pagesToRows(
  pages: PosterPage[],
  rowId: (bookId: string) => string = (id) => id,
): PosterPageRow[] {
  return pages.map((page) => ({
    blocks: [
      ...(page.heading
        ? [{ type: "heading" as const, text: page.heading }]
        : []),
      ...(page.bookIds.length
        ? [{ type: "books" as const, book_ids: page.bookIds.map(rowId) }]
        : []),
      ...(page.text ? [{ type: "text" as const, text: page.text }] : []),
    ],
  }));
}

/** The same pages with each book's id given by `rowId`. */
export const withPageRowBooks = (
  pages: PosterPageRow[],
  rowId: (bookId: string) => string,
): PosterPageRow[] =>
  pages.map((page) => ({
    blocks: page.blocks.map((block) =>
      block.type === "books"
        ? { ...block, book_ids: block.book_ids.map(rowId) }
        : block,
    ),
  }));

/** Every book id the database's pages refer to, well formed or not. */
export function pageRowBookIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((page) =>
    object(page) && Array.isArray(page.blocks)
      ? page.blocks.flatMap((block: unknown) =>
          object(block) &&
          block.type === "books" &&
          Array.isArray(block.book_ids)
            ? block.book_ids.filter(
                (id): id is string => typeof id === "string",
              )
            : [],
        )
      : [],
  );
}

/**
 * The pages read back from the database, the town's names for its books
 * given by `bookId`. Blocks of kinds this version does not know are passed
 * over; null when the pages are not a list of pages at all.
 */
export function pagesFromRows(
  value: unknown,
  bookId: (rowId: string) => string = (id) => id,
): PosterPage[] | null {
  if (!Array.isArray(value)) return null;
  const pages: PosterPage[] = [];
  for (const row of value) {
    if (!object(row) || !Array.isArray(row.blocks)) return null;
    const page = emptyPage();
    for (const block of row.blocks) {
      if (!object(block)) continue;
      if (block.type === "heading" && typeof block.text === "string")
        page.heading ||= block.text;
      else if (block.type === "text" && typeof block.text === "string")
        page.text = page.text ? page.text + "\n\n" + block.text : block.text;
      else if (block.type === "books" && Array.isArray(block.book_ids))
        page.bookIds.push(
          ...block.book_ids
            .filter((id): id is string => typeof id === "string")
            .map(bookId),
        );
    }
    pages.push(page);
  }
  return pages;
}
