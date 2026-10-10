"use client";
import { type CSSProperties, useId } from "react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Book, Shelf, ShelfItem } from "../lib/types";
import { BookJacket, Icon } from "./ui";

type Props = {
  shelf: Shelf;
  books: Book[];
  onSelect?: (item: ShelfItem) => void;
  editing?: boolean;
  selectedId?: string;
  onReorder?: (activeId: string, overId: string) => void;
};
export function WoodenShelf({
  shelf,
  books,
  onSelect,
  editing = false,
  selectedId,
  onReorder,
}: Props) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 240, tolerance: 7 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const dndId = useId();
  const dragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id)
      onReorder?.(String(event.active.id), String(event.over.id));
  };
  const contents = (
    <div className="shelf-scroll" aria-label={shelf.name + "の書棚"}>
      <div className="shelf-back">
        <div className="shelf-books-row">
          {shelf.items.map((item) => {
            const b = books.find((book) => book.id === item.bookId);
            return b ? (
              <ShelfBook
                key={item.id}
                item={item}
                book={b}
                editing={editing}
                selected={selectedId === item.id}
                onSelect={() => onSelect?.(item)}
              />
            ) : null;
          })}
          {!shelf.items.length && (
            <div className="shelf-blank">
              <Icon name="book" size={23} />
              <span>最初の一冊を、ここに。</span>
            </div>
          )}
          <div className="shelf-bookend" />
        </div>
        <div className="shelf-plank">
          <span>{shelf.name}</span>
          <i />
        </div>
      </div>
    </div>
  );
  return editing ? (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={dragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "スペースキーで本をつかみ、左右の矢印キーで移動します。再びスペースキーで配置、Escapeで中止できます。",
        },
      }}
    >
      <SortableContext
        items={shelf.items.map((i) => i.id)}
        strategy={horizontalListSortingStrategy}
      >
        {contents}
      </SortableContext>
    </DndContext>
  ) : (
    contents
  );
}
function ShelfBook({
  item,
  book,
  editing,
  selected,
  onSelect,
}: {
  item: ShelfItem;
  book: Book;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: item.id, disabled: !editing });
  const h = book.height > 80 ? book.height : 140;
  const thickness =
    book.thickness > 10 ? book.thickness : Math.round(28 * book.thickness);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition,
    zIndex: isDragging ? 10 : undefined,
    "--book-height": h + "px",
    "--book-thickness": Math.max(20, Math.min(thickness, 38)) + "px",
    "--book-color": book.color,
    "--book-ink": book.ink,
  } as CSSProperties;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`shelf-book ${item.display} ${selected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""}`}
      data-item-id={item.id}
      data-display={item.display}
    >
      <button
        {...(editing ? attributes : {})}
        {...(editing ? listeners : {})}
        onClick={onSelect}
        className="shelf-book-button"
        aria-label={`${book.title} · ${item.display === "face" ? "面陳" : "背表紙"}${item.pop ? " · POPあり" : ""}${editing ? " · 編集する" : ""}`}
      >
        {item.display === "face" ? (
          <BookJacket book={book} />
        ) : (
          <span className={"book-spine pattern-" + (book.pattern % 3)}>
            <span className="spine-cap" />
            <span className="spine-title">{book.title}</span>
            <span className="spine-author">{book.author}</span>
            <span className="spine-mark">本</span>
          </span>
        )}
        {item.pop && <span className="pop-marker">POP</span>}
        {editing && (
          <span className="book-grip">
            <Icon name="grip" size={13} />
          </span>
        )}
      </button>
    </div>
  );
}
