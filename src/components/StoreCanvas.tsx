"use client";
import { useId, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { BookJacket, Icon } from "./ui";
import {
  bookPop,
  objectById,
  type SceneObject,
  type StoreScene,
} from "../lib/store-scene";
import type { Book } from "../lib/types";

const pose = (o: SceneObject): CSSProperties => ({
  left: o.rect.x * 100 + "%",
  top: o.rect.y * 100 + "%",
  width: o.rect.w * 100 + "%",
  height: o.rect.h * 100 + "%",
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
/** Small objects that keep a shelf gutter company when it has no new sign. */
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
    return (
      <svg viewBox="0 0 60 80" aria-hidden="true">
        <circle cx="30" cy="36" r="19" fill="#4f767c" />
        <path
          d="M18 26c6-3 9 2 13 0s7 3 5 7-7 3-9 7-7 5-9 1 3-6 0-9Z M37 43c4-2 8 0 8 4s-5 6-8 4Z"
          fill="#d6c08a"
        />
        <ellipse cx="25" cy="29" rx="7" ry="4" fill="#ffffff" opacity=".18" />
        <path
          d="M8 34a22 22 0 0 0 40 12"
          stroke="#c39a51"
          strokeWidth="2.4"
          fill="none"
        />
        <path d="M30 57v12" stroke="#a37c3c" strokeWidth="3" />
        <path d="M19 69h22l3 7H16Z" fill="#7a5530" />
      </svg>
    );
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
/** Engraved line art for the shop signboard. */
function SignArt() {
  return (
    <svg
      className="walk-sign-art"
      viewBox="0 0 80 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 30 22 9l9 9 9-12 18 17 6-5 14 12" />
      <path d="m19 12 3 3 3-2M38 9l2 3 3-1" />
      <circle cx="61" cy="8" r="4" />
      <path d="M2 30h76" />
    </svg>
  );
}
export function StoreBook({ book, display }: { book: Book; display?: string }) {
  return display === "face" ? (
    <BookJacket book={book} illustrated />
  ) : (
    <span
      className="walk-spine"
      style={{
        background:
          book.pattern % 5 === 0
            ? book.color
            : ["#e2d3b9", "#efe4cd", "#cdb89b", "#ddc9ae"][book.pattern % 4],
        color: book.pattern % 5 === 0 ? book.ink : "#392d20",
      }}
    >
      <span>{book.title}</span>
      <small>{book.author}</small>
    </span>
  );
}
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
}) {
  const drag = useRef(false);
  const greeting = scene.objects.find((o) => o.kind === "ownerPop")?.text;
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
  function render(o: SceneObject) {
    if (o.placed === false) return null;
    const children = scene.objects
      .filter((child) => child.parentId === o.id && child.kind !== "bookPop")
      .sort(
        (a, b) =>
          a.rect.y - b.rect.y ||
          a.rect.x - b.rect.x ||
          (a.order ?? 0) - (b.order ?? 0),
      );
    if (o.kind === "furniture")
      return (
        <div
          key={o.id}
          className={"walk-object walk-furniture is-" + o.furnitureType}
          style={pose(o)}
          data-furniture={o.id}
        >
          {children.map(render)}
          <span className="walk-wood-edge" />
        </div>
      );
    if (o.kind === "row") {
      const furniture = o.parentId ? objectById(scene, o.parentId) : undefined;
      // Rows that leave a gutter (new default stores) get a sign beside them;
      // older saved stores keep the small tag over the books.
      const gutter =
        furniture?.furnitureType === "shelf" && o.rect.x >= 0.15
          ? o.rect.x - 0.055
          : 0;
      const siblings = scene.objects
        .filter((r) => r.kind === "row" && r.parentId === o.parentId)
        .sort((a, b) => a.rect.y - b.rect.y);
      const index = siblings.findIndex((r) => r.id === o.id);
      const continued = gutter > 0 && siblings[index - 1]?.text === o.text;
      const side = {
        width: (gutter / o.rect.w) * 100 + "%",
        right: (1 + 0.015 / o.rect.w) * 100 + "%",
      };
      return (
        <div
          key={o.id}
          className={
            "walk-object walk-row" +
            (focusText !== null && o.text !== focusText ? " is-dimmed" : "")
          }
          style={pose(o)}
          data-row={o.id}
        >
          {continued ? (
            <span className="walk-row-decor" style={side}>
              <ShelfDecor index={index + scene.storeId.length} />
            </span>
          ) : (
            <button
              className={"walk-row-label" + (gutter ? " is-board" : "")}
              style={gutter ? side : undefined}
              onClick={() => onLabel(o)}
              aria-label={o.text + "、棚の案内"}
            >
              <span>{o.text}</span>
            </button>
          )}
          {children.map(render)}
          <span
            className="walk-shelf-lip"
            style={{
              // The shelf board runs the full furniture width, under any sign.
              left: (-(o.rect.x + 0.006) / o.rect.w) * 100 + "%",
              right: (-(1.006 - o.rect.x - o.rect.w) / o.rect.w) * 100 + "%",
            }}
          />
          <button
            className="walk-zoom-trigger"
            onClick={() => onZoom(o.id)}
            aria-label={o.text + "の段を近くで見る"}
          >
            <Icon name="search" size={12} />
          </button>
        </div>
      );
    }
    if (o.kind === "book") {
      const book = books.find((b) => b.id === o.bookId);
      if (!book) return null;
      const pop = bookPop(scene, o.id);
      return (
        <div
          key={o.id}
          className={"walk-object walk-book is-" + o.display}
          style={pose(o)}
        >
          <button
            id={"walk-book-" + o.id}
            className="walk-book-target"
            data-placement={o.id}
            aria-label={book.title + "、" + book.author + "。手に取る"}
            onKeyDown={(e) => focusNeighbor(e, o)}
            onClick={(e) => {
              if (drag.current) return;
              const box = e.currentTarget.getBoundingClientRect();
              if (e.detail !== 0 && o.display === "spine" && box.width < 24)
                onZoom(o.parentId!);
              else onBook(o);
            }}
          >
            <StoreBook book={book} display={o.display} />
          </button>
          {pop?.text && (
            <button
              className={
                "walk-book-pop " + (o.display === "face" ? "" : "is-tab")
              }
              style={
                o.display === "face"
                  ? {
                      ...pose(pop),
                      transform:
                        "rotate(" +
                        (pop.rect.rotation ||
                          [-2, 1.5, -1, 2.2][(o.order ?? 0) % 4]) +
                        "deg)",
                    }
                  : undefined
              }
              onClick={() => onPop(o)}
              aria-label={book.title + "のPOP全文を読む"}
            >
              {o.display === "face" ? (
                <>
                  <span className="walk-pop-excerpt">{pop.text}</span>
                  {signature && (
                    <small className="walk-pop-sign">— {signature}</small>
                  )}
                  {pop.stamp && (
                    <span className="walk-pop-stamp">
                      <StoreStamp name={pop.stamp} />
                    </span>
                  )}
                </>
              ) : (
                <span>POP</span>
              )}
            </button>
          )}
        </div>
      );
    }
    if (o.kind === "stamp")
      return (
        <span key={o.id} className="walk-object walk-stamp" style={pose(o)}>
          <StoreStamp name={o.stamp} />
        </span>
      );
    if (o.kind === "sign")
      return (
        <button
          key={o.id}
          className="walk-object walk-sign"
          style={pose(o)}
          onClick={() => onLabel(o)}
        >
          <span className="walk-sign-name">{o.text}</span>
          {tagline && tagline !== greeting && (
            <small className="walk-sign-tagline">{tagline}</small>
          )}
          <SignArt />
        </button>
      );
    if (o.kind === "ownerPop")
      return (
        <button
          key={o.id}
          className="walk-object walk-ownerPop"
          style={pose(o)}
          onClick={() => onLabel(o)}
        >
          <span className="walk-floor-pop-text">{o.text}</span>
          {signature && <small>— {signature}</small>}
        </button>
      );
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
    </div>
  );
}
