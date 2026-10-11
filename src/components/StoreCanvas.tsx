"use client";
import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { BookJacket, Icon } from "./ui";
import { bookPop, type SceneObject, type StoreScene } from "../lib/store-scene";
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
export function StoreBook({ book, display }: { book: Book; display?: string }) {
  return display === "face" ? (
    <BookJacket book={book} />
  ) : (
    <span
      className="walk-spine"
      style={{ background: book.color, color: book.ink }}
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
}: {
  scene: StoreScene;
  books: Book[];
  onBook: (p: SceneObject) => void;
  onZoom: (rowId: string) => void;
  onPop: (p: SceneObject) => void;
  onLabel: (o: SceneObject) => void;
}) {
  const drag = useRef(false);
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
    if (o.kind === "row")
      return (
        <div
          key={o.id}
          className="walk-object walk-row"
          style={pose(o)}
          data-row={o.id}
        >
          <button
            className="walk-row-label"
            onClick={() => onLabel(o)}
            aria-label={o.text + "、棚の案内"}
          >
            {o.text}
          </button>
          {children.map(render)}
          <span className="walk-shelf-lip" />
          <button
            className="walk-zoom-trigger"
            onClick={() => onZoom(o.id)}
            aria-label={o.text + "の段を近くで見る"}
          >
            <Icon name="search" size={12} />
          </button>
        </div>
      );
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
              style={o.display === "face" ? pose(pop) : undefined}
              onClick={() => onPop(o)}
              aria-label={book.title + "のPOP全文を読む"}
            >
              {o.display === "face" ? pop.text : <span>POP</span>}
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
