"use client";

import { useState } from "react";
import type { LibraryShelf } from "../lib/library";
import { SCAN_COPY } from "../lib/scan";
import {
  moveSlot,
  readSlots,
  shelfOfSlot,
  SLOT_COUNT,
  SLOTS_KEY,
  toggleSlot,
  type Slot,
} from "../lib/scan-slots";
import { Icon, Modal } from "./ui";

// 自由3枠 (資料 4章): which buttons the second row of a card holds, and in
// what order, left to right. Picked here from the bottom bar; this device
// remembers them.

const COPY = SCAN_COPY.slots;

/** The row of slots, as this device keeps it. */
export function useSlots() {
  const [slots, setSlots] = useState<Slot[]>(() => {
    try {
      return readSlots(localStorage.getItem(SLOTS_KEY));
    } catch {
      return readSlots(null);
    }
  });
  const change = (next: Slot[]) => {
    setSlots(next);
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
    } catch {
      // Not remembered: this time only.
    }
  };
  return [slots, change] as const;
}

/** What a slot's button says. */
export function slotName(
  slot: Slot,
  shelves: readonly LibraryShelf[],
  favorite: string,
): string {
  if (slot === "not-owned") return SCAN_COPY.notOwned;
  if (slot === "favorite") return favorite;
  if (slot === "shelves") return SCAN_COPY.shelf;
  const id = shelfOfSlot(slot);
  return shelves.find((shelf) => shelf.id === id)?.name ?? "";
}

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
      {name(slot)}
    </>
  );
  return (
    <Modal title={COPY.name} onClose={onClose} fromBottom>
      <div className="scan-slots">
        <p className="scan-sort-lead">{COPY.lead}</p>
        <section>
          <h3 id="scan-slots-row">{COPY.row}</h3>
          {slots.length ? (
            <ol className="scan-slots-row" aria-labelledby="scan-slots-row">
              {slots.map((slot, at) => (
                <li key={slot} className="scan-slot">
                  <span className="scan-slot-at" aria-hidden="true">
                    {at + 1}
                  </span>
                  <span className="scan-slot-name">{label(slot)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={COPY.left(name(slot))}
                    disabled={at === 0}
                    onClick={() => onChange(moveSlot(slots, slot, -1))}
                  >
                    <Icon name="back" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={COPY.right(name(slot))}
                    disabled={at === slots.length - 1}
                    onClick={() => onChange(moveSlot(slots, slot, 1))}
                  >
                    <Icon name="arrow" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={COPY.remove(name(slot))}
                    onClick={() => onChange(toggleSlot(slots, slot))}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="scan-item-none">{COPY.empty}</p>
          )}
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
