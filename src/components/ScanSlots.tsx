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
      <span className="scan-chip-name">{name(slot)}</span>
    </>
  );
  // The button in the row that 左へ・外す・右へ move: the one last tapped
  // or put in, else the first.
  const [picked, setPicked] = useState<Slot | null>(null);
  const now = picked && slots.includes(picked) ? picked : (slots[0] ?? null);
  const at = now ? slots.indexOf(now) : -1;
  const change = (next: Slot[], pick: Slot | null) => {
    onChange(next);
    setPicked(pick);
  };
  return (
    <Modal title={COPY.name} onClose={onClose} fromBottom>
      <div className="scan-slots">
        <p className="scan-sort-lead">{COPY.lead}</p>
        <section>
          <h3 id="scan-slots-row">{COPY.row}</h3>
          {/* As the second row of a card shows them, left to right. */}
          <div
            className="scan-slots-row"
            role="group"
            aria-labelledby="scan-slots-row"
          >
            {Array.from({ length: SLOT_COUNT }, (_, place) => {
              const slot = slots[place];
              return slot ? (
                <button
                  key={slot}
                  type="button"
                  className="chip"
                  aria-pressed={slot === now}
                  onClick={() => setPicked(slot)}
                >
                  {label(slot)}
                </button>
              ) : (
                <span key={place} className="scan-slot-free" aria-hidden />
              );
            })}
          </div>
          {now ? (
            <div className="scan-slots-move">
              <button
                type="button"
                className="btn"
                aria-label={COPY.left(name(now))}
                disabled={at === 0}
                onClick={() => change(moveSlot(slots, now, -1), now)}
              >
                <Icon name="back" size={18} />
                {COPY.toLeft}
              </button>
              <button
                type="button"
                className="btn"
                aria-label={COPY.remove(name(now))}
                onClick={() => {
                  const next = toggleSlot(slots, now);
                  change(next, next[Math.min(at, next.length - 1)] ?? null);
                }}
              >
                {COPY.off}
              </button>
              <button
                type="button"
                className="btn"
                aria-label={COPY.right(name(now))}
                disabled={at === slots.length - 1}
                onClick={() => change(moveSlot(slots, now, 1), now)}
              >
                {COPY.toRight}
                <Icon name="arrow" size={18} />
              </button>
            </div>
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
                  onClick={() =>
                    change(
                      toggleSlot(slots, slot),
                      on ? (picked === slot ? null : picked) : slot,
                    )
                  }
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
