"use client";
import { useId } from "react";
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
import { ShelfBook, ShelfRow } from "./WoodenShelf";

type Props = {
  shelf: Shelf;
  books: Book[];
  onSelect: (item: ShelfItem) => void;
  selectedId?: string;
  onReorder: (activeId: string, overId: string) => void;
};
/** The owner's shelf, its books moved by dragging or with the keyboard. */
export function SortableShelf({
  shelf,
  books,
  onSelect,
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
      onReorder(String(event.active.id), String(event.over.id));
  };
  return (
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
        <ShelfRow
          shelf={shelf}
          books={books}
          book={(item, book) => (
            <SortableBook
              key={item.id}
              item={item}
              book={book}
              selected={selectedId === item.id}
              onSelect={() => onSelect(item)}
            />
          )}
        />
      </SortableContext>
    </DndContext>
  );
}

function SortableBook({
  item,
  book,
  selected,
  onSelect,
}: {
  item: ShelfItem;
  book: Book;
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
  } = useSortable({ id: item.id });
  return (
    <ShelfBook
      item={item}
      book={book}
      selected={selected}
      onSelect={onSelect}
      drag={{
        ref: setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          zIndex: isDragging ? 9 : undefined,
        },
        dragging: isDragging,
        handle: { ...attributes, ...listeners },
      }}
    />
  );
}
