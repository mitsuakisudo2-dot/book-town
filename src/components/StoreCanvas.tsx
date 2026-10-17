"use client";
import Link from "next/link";
import { useId, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { BookJacket, Icon } from "./ui";
import {
  bookPop,
  boundsOf,
  worldPolygon,
  type Rect,
  type SceneObject,
  type StoreScene,
} from "../lib/store-scene";
import { popExcerpt, tierCardOwners } from "../lib/store-scene-adapter";
import { ART_PANELS, artPanel } from "../lib/book-art";
import type { Book } from "../lib/types";
import { bookAuthor, bookById, bookTitle } from "../lib/book-name";

const THEME = "/themes/woodshop/";
const pct = (n: number) => n * 100 + "%";
const pose = (o: SceneObject): CSSProperties => ({
  left: pct(o.rect.x),
  top: pct(o.rect.y),
  width: pct(o.rect.w),
  height: pct(o.rect.h),
  transform: "rotate(" + o.rect.rotation + "deg)",
  zIndex: o.z,
  color: o.style?.color,
  fontFamily: o.style?.font,
});
export function StoreStamp({ name }: { name?: string }) {
  if (name === "plane")
    return (
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="m5 27 15 2 14 14 4-3-8-15 12-14c5-7 0-9-5-4L22 20 8 14l-4 4 12 8-11 1Z" />
        <path d="M4 43c9 1 11-5 11-5" strokeDasharray="2 3" />
      </svg>
    );
  if (name === "coffee")
    return (
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M8 18h25v14c0 10-25 10-25 0Z M33 19c13-2 13 14 0 12 M5 41h33 M16 5c-6 5 6 7 0 11 M25 3c-6 5 6 7 0 11" />
      </svg>
    );
  return <Icon name="leaf" />;
}

/** Chalk line drawings for shelf boards and the shelf chips. */
const DOODLE_ICONS: Record<string, string> = {
  travel:
    "M3 16 20 14 30 4h4l-6 10h11l4-5h3l-2 7 2 7h-3l-4-5H28l6 10h-4L20 18 3 16Z",
  daily:
    "M13 12h17v6a8.5 8.5 0 0 1-17 0Zm17 2a3.5 3.5 0 0 1 0 7M9 26h25M18 3c-2 2 2 4 0 6M24 3c-2 2 2 4 0 6",
  forest: "M24 2 15 15h5l-8 10h24l-8-10h5Zm0 23v4",
  stars:
    "M24 6a8 8 0 1 0 0.01 0ZM6 18c4 3 33-5 36-10 1-3-5-2-8-1M14 22c-6 2-9 1-8-4",
  garden:
    "M24 27V10M24 18c-5-1-9-5-9-10 5 0 9 4 9 10Zm0-4c4-1 8-4 8-9-5 0-8 4-8 9Z",
  city: "M8 26V13l10-8 10 8v13ZM15 26v-7h6v7M28 26V16h10v10M31 20h4",
  lamp: "M21 26V12h6v14ZM24 12V8M24 2c-3 3-2 6 0 6s3-3 0-6ZM16 27h16",
  leaf: "M38 4C14 2 6 18 14 26c10 2 24-4 24-22ZM8 28 26 12",
};
export function DoodleIcon({ name }: { name?: string }) {
  const d = DOODLE_ICONS[name ?? "leaf"] ?? DOODLE_ICONS.leaf;
  return (
    <svg
      viewBox="0 0 48 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const CORNER_ART: Record<string, string> = {
  travel:
    "M26 8a14 14 0 1 0 .01 0ZM12 22h28M26 8c-7 8-7 20 0 28M26 8c7 8 7 20 0 28M14 15h24M14 29h24M26 36v6M18 44h16M6 6l3 3M44 5l-3 3M46 15h-4",
  daily:
    "M8 40h34v6H8ZM11 33h30v7H11ZM7 26h34v7H7ZM10 26v-3h26v3M14 36h20M12 43h22",
  forest:
    "M4 44h44M10 20 4 34h12ZM10 34v10M22 8l-8 18h16ZM22 26v18M34 14l-7 14h14ZM34 28v16M44 24l-5 10h10ZM44 34v10",
  stars:
    "M30 6a14 14 0 1 0 12 22A11 11 0 1 1 30 6ZM8 10l1.5 3.5L13 15l-3.5 1.5L8 20l-1.5-3.5L3 15l3.5-1.5ZM44 36l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1ZM14 38l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z",
  garden:
    "M14 30h24l-3 16H17ZM12 30h28M26 30V14M26 22c-6 0-10-4-10-10 6 0 10 4 10 10Zm0-4c5 0 9-4 9-10-5 0-9 4-9 10Z",
  city: "M10 46V16M6 16h8l-4-6ZM10 22h3M20 46V28l8-6 8 6v18M36 46V32h10v14M25 34h6M25 40h6M40 38h3",
  lamp: "M4 40c8-4 16-4 22 0 6-4 14-4 22 0V20c-8-4-16-4-22 0-6-4-14-4-22 0ZM26 20v20M10 26c4-1 8-1 11 1M10 32c4-1 8-1 11 1M31 27c3-2 7-2 11-1M31 33c3-2 7-2 11-1",
};
function CornerArt({ name }: { name?: string }) {
  const d = CORNER_ART[name ?? ""];
  if (!d) return null;
  return (
    <svg
      className="walk-board-corner"
      viewBox="0 0 52 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const RULE_DOODLES = new Set([
  "travel",
  "daily",
  "stars",
  "garden",
  "city",
  "lamp",
]);

/** Small objects that keep a shelf gutter company when it has no shelf of its own. */
function ShelfDecor({ index }: { index: number }) {
  const glow = useId();
  const kind = index % 4;
  if (kind === 0)
    return (
      <svg viewBox="0 0 60 80" aria-hidden="true">
        <path d="M30 52C28 38 18 30 9 31c3 9 11 17 21 21Z" fill="#7d9655" />
        <path d="M31 52c1-15 10-26 21-27-2 11-9 21-21 27Z" fill="#91a965" />
        <path d="M30 52c-6-14-3-29 4-37 6 9 4 24-4 37Z" fill="#6c8749" />
        <path d="M30 53c-9-6-19-6-25-2 8 5 17 6 25 2Z" fill="#88a05d" />
        <path d="M30 52V25" stroke="#4d6234" strokeWidth="1.2" fill="none" />
        <path d="M17 52h26l-3 24H20Z" fill="#b26a43" />
        <path d="M15 50h30v6H15Z" fill="#c7825a" />
      </svg>
    );
  if (kind === 1)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={THEME + "globe-v1.svg"} alt="" />;
  if (kind === 2)
    return (
      <svg viewBox="0 0 60 80" aria-hidden="true">
        <rect x="6" y="66" width="48" height="10" rx="1" fill="#8b5a3c" />
        <rect x="9" y="57" width="42" height="9" rx="1" fill="#e4d4b6" />
        <rect x="5" y="48" width="46" height="9" rx="1" fill="#5f6f72" />
        <rect x="11" y="40" width="38" height="8" rx="1" fill="#d9c3a0" />
        <path d="M6 70h48M9 60h42M5 52h46" stroke="#00000030" strokeWidth="1" />
        <path d="M37 40c0-7 9-7 9 0Z" fill="#c9a76b" />
      </svg>
    );
  return (
    <svg viewBox="0 0 60 80" aria-hidden="true">
      <defs>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#ffd98a" stopOpacity=".9" />
          <stop offset="1" stopColor="#ffb54d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="30" cy="40" r="26" fill={"url(#" + glow + ")"} />
      <path d="M30 31c-4 5-3 9 0 9s4-4 0-9Z" fill="#fff1c4" />
      <rect x="22" y="42" width="16" height="25" rx="2" fill="#f2e6cf" />
      <path
        d="M16 40h28v32c0 3-2 4-4 4H20c-2 0-4-1-4-4Z"
        fill="#ffe6b31f"
        stroke="#f6e3bd80"
        strokeWidth="1.2"
      />
    </svg>
  );
}
/** What stands on a tier that holds no books yet: a few things, never a bare board. */
const STILL_LIFE: Array<number | string> = [0, "daisy-vase-v1.svg", 2, 3, 1];
function StillLife({ seed, left }: { seed: number; left: string }) {
  return (
    <span className="walk-row-still" style={{ left }} aria-hidden="true">
      {[0, 1, 2].map((k) => {
        const item = STILL_LIFE[(seed * 3 + k) % STILL_LIFE.length];
        return (
          <span key={k} className={item === 1 ? "is-globe" : undefined}>
            {typeof item === "number" ? (
              <ShelfDecor index={item} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={THEME + item} alt="" />
            )}
          </span>
        );
      })}
    </span>
  );
}
/** Ink mountains drawn on the shop signboard. */
function SignArt() {
  return (
    <svg
      className="walk-sign-art"
      viewBox="0 0 220 70"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 66C24 62 40 50 58 32L64 28 72 36 84 30 104 14 128 2 142 16 156 30 170 24 190 40 218 60" />
      <path d="M84 30C96 44 104 54 120 62" />
      <path d="M142 16C150 32 158 44 176 56" />
      <path d="M128 8 120 26M132 12 126 30M138 18 134 32M64 32 60 44M170 28 166 38M176 32 172 42" />
      <path d="M110 66C140 63 180 63 218 66" />
    </svg>
  );
}
const SPINE_TONES: Array<[string, string] | null> = [
  ["#efe5d3", "#2a2420"],
  ["#e3cfaa", "#2a2420"],
  ["#d8c19c", "#2a2420"],
  ["#b8c2cc", "#1f2a3a"],
  null,
  ["#2b3550", "#f3ead8"],
  ["#e9dcc3", "#2a2420"],
  ["#5f7a90", "#f3ead8"],
];
const shortAuthor = (author: string) =>
  author.split("・").pop()?.trim() || author;
export function StoreBook({
  book,
  display,
  artIndex,
}: {
  book: Book;
  display?: string;
  artIndex?: number;
}) {
  if (display === "face")
    return (
      <BookJacket
        book={book}
        illustrated
        author={shortAuthor(bookAuthor(book))}
        artIndex={artIndex}
      />
    );
  const tone = SPINE_TONES[
    [...book.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) %
      SPINE_TONES.length
  ] ?? [book.color, book.ink];
  const author = shortAuthor(bookAuthor(book));
  return (
    <span
      className={"walk-spine is-pattern-" + (Math.abs(book.pattern) % 3)}
      style={
        {
          background: tone[0],
          color: tone[1],
          "--n": [...bookTitle(book)].length,
          "--m": [...author].length,
          "--accent": book.color,
        } as CSSProperties
      }
    >
      <span>{bookTitle(book)}</span>
      <small>{author}</small>
      <i className="walk-spine-mark" aria-hidden="true" />
    </span>
  );
}
const CARD_W = [0.262, 0.263, 0.292];
const CARD_K = [0.1875, 0.27, 0.232];
const CARD_ROT = [-2, -1.3, -2.5];
const COVER_ROT = [1, 0, -1, -2, -2];
/** The decorations that stand on a store's shelves, by row. */
const ROW_DECOR: Array<
  Array<{ src: string; box: [number, number, number, number] }>
> = [
  [
    { src: "ivy-clump-v1.svg", box: [-27.9, 81.7, 12.5, 34.7] },
    { src: "ivy-trail-v1.svg", box: [-3.5, 87.7, 13.1, 61.1] },
  ],
  [{ src: "daisy-vase-v1.svg", box: [-29.5, 79.1, 15.1, 64.9] }],
  [{ src: "ivy-pot-v1.svg", box: [100.6, 86.3, 11.9, 25.3] }],
];
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export function StoreCanvas({
  scene,
  books,
  onBook,
  onZoom,
  onPop,
  onLabel,
  signature,
  tagline,
  focusText = null,
  greetingHref,
}: {
  scene: StoreScene;
  books: Book[];
  onBook: (p: SceneObject) => void;
  onZoom: (rowId: string) => void;
  onPop: (p: SceneObject) => void;
  onLabel: (o: SceneObject) => void;
  /** The owner's name, signed under POPs as on a handwritten card. */
  signature?: string;
  /** Shown under the shop name on the signboard. */
  tagline?: string;
  /** When set, rows with another shelf name step back into the shadow. */
  focusText?: string | null;
  /** The owner's own visit: an empty floor POP invites them to write one. */
  greetingHref?: string;
}) {
  const drag = useRef(false);
  const greetingPop = scene.objects.find((o) => o.kind === "ownerPop");
  const greeting = greetingPop?.text;
  // With no words of the owner's, the stamp on the floor POP steps out too.
  const noGreeting = !greeting?.trim();
  const woodshop = scene.theme.id === "woodshop";
  const owners = tierCardOwners(scene);
  const cardOwners = new Set(owners.values());
  const hasTable = scene.objects.some(
    (o) => o.kind === "furniture" && o.furnitureType === "table",
  );
  // Face-outs on one screen get different paintings where the atlas allows.
  const artFor = new Map<string, number>();
  {
    const used = new Set<number>();
    let previous = -1;
    for (const p of scene.objects
      .filter((o) => o.kind === "furniture")
      .sort((a, b) => a.rect.y - b.rect.y)
      .flatMap((f) =>
        scene.objects
          .filter((r) => r.kind === "row" && r.parentId === f.id)
          .sort((a, b) => a.rect.y - b.rect.y),
      )
      .flatMap((row) =>
        scene.objects
          .filter(
            (o) =>
              o.kind === "book" &&
              o.parentId === row.id &&
              o.display === "face",
          )
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      )) {
      const book = bookById(books, p.bookId);
      if (!book) continue;
      const preferred = artPanel(book);
      let panel = preferred;
      for (let k = 0; k < ART_PANELS && used.has(panel); k++)
        panel = (preferred + k + 1) % ART_PANELS;
      if (used.has(panel) && panel === previous)
        panel = (panel + 1) % ART_PANELS;
      used.add(panel);
      artFor.set(p.id, panel);
      previous = panel;
    }
  }
  const bounds = (o: SceneObject) => {
    const polygon = worldPolygon(scene, o);
    return polygon ? boundsOf(polygon) : null;
  };
  function focusNeighbor(
    event: KeyboardEvent<HTMLButtonElement>,
    book: SceneObject,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const row = scene.objects
      .filter((o) => o.kind === "book" && o.parentId === book.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const next =
      row[
        row.findIndex((o) => o.id === book.id) +
          (event.key === "ArrowRight" ? 1 : -1)
      ];
    if (next)
      document
        .getElementById("walk-book-" + next.id)
        ?.focus({ preventScroll: true });
  }
  /** Card geometry in the lead book's own box, from canvas-unit rules. */
  function tierCard(row: SceneObject, lead: SceneObject, index: number) {
    const r = bounds(row),
      b = bounds(lead);
    if (!r || !b) return undefined;
    const i = index % 3;
    const right0 = Math.min(r.x + r.w, 0.918);
    const left = Math.max(
      Math.min(right0 - CARD_W[i], b.x + b.w - 0.01),
      b.x + 0.2 * b.w,
    );
    const right = Math.min(left + CARD_W[i], right0);
    const top = r.y + r.h - CARD_K[i] * b.h;
    const pop = bookPop(scene, lead.id);
    return {
      left: pct((left - b.x) / b.w),
      top: pct((top - b.y) / b.h),
      width: pct((right - left) / b.w),
      transform: "rotate(" + (pop?.rect.rotation || CARD_ROT[i]) + "deg)",
    } as CSSProperties;
  }
  function renderBook(o: SceneObject, row: SceneObject, rowIndex: number) {
    const book = bookById(books, o.bookId);
    if (!book) return null;
    const pop = bookPop(scene, o.id);
    const tier = cardOwners.has(o.id);
    const cover = row.mode === "face" && o.display === "face";
    const shown = Boolean(pop?.text) && (tier || cover);
    return (
      <div
        key={o.id}
        className={"walk-object walk-book is-" + o.display}
        style={{ ...pose(o), zIndex: tier ? 8 : 3 }}
      >
        <button
          id={"walk-book-" + o.id}
          className="walk-book-target"
          data-placement={o.id}
          aria-label={
            bookTitle(book) +
            "、" +
            bookAuthor(book) +
            "。手に取る" +
            (pop?.text && !shown ? "。POPあり" : "")
          }
          onKeyDown={(e) => focusNeighbor(e, o)}
          onClick={(e) => {
            if (drag.current) return;
            const box = e.currentTarget.getBoundingClientRect();
            if (e.detail !== 0 && o.display === "spine" && box.width < 24)
              onZoom(o.parentId!);
            else onBook(o);
          }}
        >
          <StoreBook
            book={book}
            display={o.display}
            artIndex={artFor.get(o.id)}
          />
        </button>
        {shown && pop && (
          <button
            className={
              "walk-book-pop " +
              (tier ? "is-tier is-tier-" + (rowIndex % 3) : "is-cover")
            }
            style={
              tier
                ? tierCard(row, o, rowIndex)
                : {
                    transform:
                      "rotate(" +
                      COVER_ROT[(o.order ?? 0) % COVER_ROT.length] +
                      "deg)",
                  }
            }
            onClick={() => onPop(o)}
            aria-label={bookTitle(book) + "のPOP全文を読む"}
          >
            <span className="walk-pop-excerpt">
              {tier ? popExcerpt(pop.text ?? "", 28) : pop.text}
            </span>
            {signature && (
              <small className="walk-pop-sign">— {signature}</small>
            )}
            {pop.stamp && (
              <span className="walk-pop-stamp">
                <StoreStamp name={pop.stamp} />
              </span>
            )}
          </button>
        )}
      </div>
    );
  }
  function renderRow(o: SceneObject, furniture: SceneObject | undefined) {
    const siblings = scene.objects
      .filter((r) => r.kind === "row" && r.parentId === o.parentId)
      .sort((a, b) => a.rect.y - b.rect.y);
    const index = siblings.findIndex((r) => r.id === o.id);
    const shelf = furniture?.furnitureType === "shelf";
    // Rows that leave a gutter get a chalkboard beside them; older saved
    // stores keep the small tag over the books.
    const gutter = shelf && o.rect.x >= 0.15;
    // A tier that continues the shelf above shares its chalkboard.
    const continued =
      !o.boardTitle && index > 0 && siblings[index - 1].text === o.text;
    const board = gutter && !!o.text && !continued;
    const below = siblings[index + 1];
    const boardH = shelf
      ? Math.max(
          0.006,
          (below ? below.rect.y : 1 - 0.0169) - (o.rect.y + o.rect.h),
        )
      : 0;
    const rowWorldH = o.rect.h * (furniture?.rect.h ?? 1);
    const items = scene.objects
      .filter((child) => child.parentId === o.id && child.kind === "book")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const lastBook = items[items.length - 1];
    const spare = lastBook
      ? (1 - lastBook.rect.x - lastBook.rect.w) *
        o.rect.w *
        (furniture?.rect.w ?? 1)
      : o.rect.w * (furniture?.rect.w ?? 1);
    const title = o.boardTitle ?? o.text ?? "";
    const still = woodshop && gutter && !o.text && items.length === 0;
    return (
      <div
        key={o.id}
        className={
          "walk-object walk-row" +
          (focusText !== null && o.text !== focusText ? " is-dimmed" : "")
        }
        style={{ ...pose(o), zIndex: 20 - index }}
        data-row={o.id}
      >
        {board ? (
          <button
            className="walk-row-board"
            style={
              {
                right: pct(1 + 0.0082 / o.rect.w),
                width: pct((o.rect.x - 0.0236) / o.rect.w),
                height: pct(((o.bookHeight ?? 0.115) * 1.02) / rowWorldH),
                "--n": [...title].length,
              } as CSSProperties
            }
            onClick={() => onZoom(o.id)}
            aria-label={
              (o.boardTitle ? o.boardTitle + "、" : "") +
              o.text +
              "の段を近くで見る"
            }
          >
            <span className="walk-board-title">{title}</span>
            {o.boardTitle && RULE_DOODLES.has(o.doodle ?? "") && (
              <span className="walk-board-rule">
                <i />
                <DoodleIcon name={o.doodle} />
              </span>
            )}
            {o.boardTitle && <span className="walk-board-body">{o.text}</span>}
            {(!o.boardTitle || [...title].length <= 5) && (
              <CornerArt name={o.doodle} />
            )}
          </button>
        ) : still ? (
          <StillLife
            seed={index + scene.storeId.length}
            left={pct(-(o.rect.x - 0.03) / o.rect.w)}
          />
        ) : gutter ? (
          <span
            className="walk-row-decor"
            style={{
              width: pct((o.rect.x - 0.055) / o.rect.w),
              right: pct(1 + 0.015 / o.rect.w),
            }}
          >
            <ShelfDecor index={index + scene.storeId.length} />
          </span>
        ) : (
          <>
            <button
              className="walk-row-label"
              onClick={() => onLabel(o)}
              aria-label={o.text + "、棚の案内"}
            >
              <span>{o.text}</span>
            </button>
            <button
              className="walk-zoom-trigger"
              onClick={() => onZoom(o.id)}
              aria-label={o.text + "の段を近くで見る"}
            >
              <Icon name="search" size={12} />
            </button>
          </>
        )}
        {items.map((book) => renderBook(book, o, index))}
        {shelf && (
          <span
            className={"walk-shelf-lip is-board-" + (index % 3)}
            style={{
              height: pct(boardH / o.rect.h),
              // The board runs the full furniture width, under any sign.
              left: pct(-(o.rect.x + 0.006) / o.rect.w),
              right: pct(-(1.006 - o.rect.x - o.rect.w) / o.rect.w),
            }}
          />
        )}
        {woodshop &&
          board &&
          ROW_DECOR[index]?.map((d) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={d.src}
              className="walk-decor"
              src={THEME + d.src}
              alt=""
              aria-hidden="true"
              style={{
                left: d.box[0] + "%",
                top: d.box[1] + "%",
                width: d.box[2] + "%",
                height: d.box[3] + "%",
              }}
            />
          ))}
        {woodshop && shelf && !still && spare >= 0.085 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="walk-decor walk-globe"
            src={THEME + "globe-v1.svg"}
            alt=""
            aria-hidden="true"
            style={{
              width: pct(0.085 / (o.rect.w * (furniture?.rect.w ?? 1))),
              height: pct(0.076 / rowWorldH),
            }}
          />
        )}
      </div>
    );
  }
  function render(o: SceneObject) {
    if (o.placed === false) return null;
    if (o.kind === "furniture") {
      const rows = scene.objects
        .filter((child) => child.parentId === o.id && child.kind === "row")
        .sort((a, b) => a.rect.y - b.rect.y);
      return (
        <div
          key={o.id}
          className={"walk-object walk-furniture is-" + o.furnitureType}
          style={pose(o)}
          data-furniture={o.id}
        >
          {o.furnitureType === "shelf" && (
            <>
              <span className="walk-case-post is-left" />
              <span className="walk-case-post is-right" />
            </>
          )}
          {rows.map((row) => renderRow(row, o))}
          <span className="walk-wood-edge" />
        </div>
      );
    }
    if (
      o.kind === "stamp" &&
      noGreeting &&
      greetingPop &&
      overlaps(o.rect, greetingPop.rect)
    )
      return null;
    if (o.kind === "stamp")
      return (
        <span key={o.id} className="walk-object walk-stamp" style={pose(o)}>
          <StoreStamp name={o.stamp} />
        </span>
      );
    if (o.kind === "sign") {
      const name = o.text ?? "";
      return (
        <button
          key={o.id}
          className="walk-object walk-sign"
          style={{ ...pose(o), "--n": [...name].length } as CSSProperties}
          onClick={() => onLabel(o)}
        >
          {woodshop && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="walk-sign-chain"
                src={THEME + "chain-v1.svg"}
                alt=""
                aria-hidden="true"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="walk-sign-ivy"
                src={THEME + "ivy-hang-v1.svg"}
                alt=""
                aria-hidden="true"
              />
            </>
          )}
          <span className="walk-sign-board">
            <span className="walk-sign-name">
              {name.split(/(の)/).map((part, i) =>
                part === "の" ? (
                  <span key={i} className="walk-sign-no">
                    の
                  </span>
                ) : (
                  part
                ),
              )}
            </span>
            {tagline && tagline !== greeting && (
              <small className="walk-sign-tagline">{tagline}</small>
            )}
            <SignArt />
          </span>
        </button>
      );
    }
    if (o.kind === "ownerPop" && !o.text?.trim())
      return greetingHref ? (
        <Link
          key={o.id}
          href={greetingHref}
          className="walk-object walk-ownerPop is-invite"
          style={pose(o)}
        >
          <span className="walk-floor-pop-text">ひとことを書く</span>
          <small>あなたにだけ見えています</small>
        </Link>
      ) : null;
    if (o.kind === "ownerPop") {
      const words = (o.text ?? "").trim();
      const excerpt = popExcerpt(words, 30);
      // Words cut short (or too long for three lines) say there is more to read.
      const more = excerpt.length < words.length || words.length > 45;
      return (
        <button
          key={o.id}
          className="walk-object walk-ownerPop"
          style={pose(o)}
          onClick={() => onLabel(o)}
        >
          <span className="walk-floor-pop-text">{excerpt}</span>
          {(more || signature) && (
            <small className="walk-floor-pop-foot">
              {more && <span className="walk-floor-pop-more">つづき</span>}
              {signature && <span>— {signature}</span>}
            </small>
          )}
        </button>
      );
    }
    return (
      <button
        key={o.id}
        className={"walk-object walk-" + o.kind}
        style={pose(o)}
        onClick={() => onLabel(o)}
      >
        {o.text}
      </button>
    );
  }
  // The blurred foreground fills the floor of the current layout only; older
  // saved stores use that area for furniture.
  const mainShelf = scene.objects.find((o) => o.id === "main-shelf");
  const shelfScene =
    woodshop && !!mainShelf && mainShelf.rect.y + mainShelf.rect.h <= 0.83;
  const rightFloorFree = !scene.objects.some(
    (o) =>
      o.kind === "furniture" &&
      o.id !== "main-shelf" &&
      o.rect.x + o.rect.w > 0.56 &&
      o.rect.y + o.rect.h > 0.83,
  );
  return (
    <div
      className="walk-store-objects"
      onPointerDown={() => {
        drag.current = false;
      }}
      onPointerMove={(e) => {
        if (e.buttons && Math.abs(e.movementY) > 3) drag.current = true;
      }}
    >
      {scene.objects
        .filter((o) => !o.parentId && o.kind !== "book")
        .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
        .map(render)}
      {shelfScene && (
        <>
          {!hasTable && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="walk-fg walk-fg-left"
              src={THEME + "fg-left-v1.webp"}
              alt=""
              aria-hidden="true"
            />
          )}
          {rightFloorFree && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="walk-fg walk-fg-right"
              src={THEME + "fg-right-v1.webp"}
              alt=""
              aria-hidden="true"
            />
          )}
        </>
      )}
    </div>
  );
}
