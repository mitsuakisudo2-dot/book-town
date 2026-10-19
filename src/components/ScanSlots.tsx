"use client";

import { useState } from "react";
import type { LibraryShelf } from "../lib/library";
import { SCAN_COPY } from "../lib/scan";
import {
  readSlots,
  shelfOfSlot,
  SLOTS_KEY,
  type Slot,
} from "../lib/scan-slots";

// 自由3枠 (資料 4章): which buttons the second row of a card holds, and in
// what order, left to right. The sheet that picks them, from the bottom
// bar, is ScanSlotsSheet: read only when it opens, with what drags its
// buttons. This device remembers them.

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
