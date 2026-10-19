"use client";

import { useId, useState, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LibraryShelf } from "../lib/library";
import { SCAN_COPY } from "../lib/scan";
import {
  placeSlot,
  SLOT_COUNT,
  toggleSlot,
  type Slot,
} from "../lib/scan-slots";
import { slotName } from "./ScanSlots";
import { Icon, Modal } from "./ui";

// 自由3枠's sheet (資料 4章), from the scanner's bottom bar: the row's
// buttons dragged into order (けにーさん 2026-10-19), and what can go there.
// Its own file, so the scanner reads the dragging only when it opens.

const COPY = SCAN_COPY.slots;

export function ScanSlots({
  slots,
  shelves,
  favorite,
  onChange,
  onClose,
}: {
  slots: readonly Slot[];
  /** The shelves the reader fills by hand. */
  shelves: LibraryShelf[];
  /** お気に入り, as the library names it. */
  favorite: string;
  onChange: (slots: Slot[]) => void;
  onClose: () => void;
}) {
  const choices: Slot[] = [
    "not-owned",
    "favorite",
    "shelves",
    ...shelves.map((shelf) => `shelf:${shelf.id}` as const),
  ];
  const name = (slot: Slot) => slotName(slot, shelves, favorite);
  const full = slots.length >= SLOT_COUNT;
  const label = (slot: Slot) => (
    <>
      {slot === "shelves" && <Icon name="plus" size={16} />}
      <span className="scan-chip-name">{name(slot)}</span>
    </>
  );
  // Dragged by a finger or the mouse, or picked up with the keyboard's
  // space and moved with its arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const dndId = useId();
  // What is read out while moving lives inside the sheet: the page behind
  // it is not read while it is open.
  const [voice, setVoice] = useState<HTMLDivElement | null>(null);
  const placed = (id: string | number) => slots.indexOf(id as Slot) + 1;
  const drop = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(
      placeSlot(slots, active.id as Slot, slots.indexOf(over.id as Slot)),
    );
  };
  return (
    <Modal title={COPY.name} onClose={onClose} fromBottom>
      <div className="scan-slots">
        <p className="scan-sort-lead">{COPY.lead}</p>
        <section>
          <h3 id="scan-slots-row">{COPY.row}</h3>
          {slots.length ? (
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={drop}
              accessibility={{
                container: voice ?? undefined,
                screenReaderInstructions: { draggable: COPY.howToMove },
                announcements: {
                  onDragStart: ({ active }) =>
                    COPY.picked(name(active.id as Slot)),
                  // Not over its own place: it was just picked up.
                  onDragOver: ({ active, over }) =>
                    over && over.id !== active.id
                      ? COPY.moving(name(active.id as Slot), placed(over.id))
                      : undefined,
                  onDragEnd: ({ active, over }) =>
                    COPY.put(
                      name(active.id as Slot),
                      placed((over ?? active).id),
                    ),
                  onDragCancel: ({ active }) =>
                    COPY.back(name(active.id as Slot)),
                },
              }}
            >
              <SortableContext
                items={[...slots]}
                strategy={horizontalListSortingStrategy}
              >
                {/* As the second row of a card shows them, left to right. */}
                <div
                  className="scan-slots-row"
                  role="group"
                  aria-labelledby="scan-slots-row"
                >
                  {slots.map((slot) => (
                    <SlotInRow key={slot} slot={slot}>
                      {label(slot)}
                    </SlotInRow>
                  ))}
                  {Array.from(
                    { length: SLOT_COUNT - slots.length },
                    (_, free) => (
                      <span key={free} className="scan-slot-free" aria-hidden />
                    ),
                  )}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="scan-item-none">{COPY.empty}</p>
          )}
          <div ref={setVoice} />
        </section>
        <section>
          <h3 id="scan-slots-can">{COPY.can}</h3>
          <div
            className="btns scan-slots-choices"
            role="group"
            aria-labelledby="scan-slots-can"
          >
            {choices.map((slot) => {
              const on = slots.includes(slot);
              return (
                <button
                  key={slot}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => onChange(toggleSlot(slots, slot))}
                >
                  {label(slot)}
                </button>
              );
            })}
          </div>
          {full && <p className="scan-sort-foot">{COPY.full}</p>}
        </section>
        <button type="button" className="btn fill" onClick={onClose}>
          {COPY.done}
        </button>
      </div>
    </Modal>
  );
}

/** A button of the row, moved by dragging it or with the keyboard. */
function SlotInRow({ slot, children }: { slot: Slot; children: ReactNode }) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({
    id: slot,
    attributes: { roleDescription: COPY.movable },
  });
  return (
    <div
      ref={setNodeRef}
      className={"chip scan-slot" + (isDragging ? " is-dragging" : "")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <Icon name="grip" size={14} />
      {children}
    </div>
  );
}
