"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  createArrivals,
  createLetterReads,
  type ArrivalsSnapshot,
} from "../../lib/arrivals";
import type { LetterEntry } from "../../lib/home-feed";
import { townStore } from "../../lib/store";

// The town's arrivals (src/lib/arrivals.ts) and its other reads after the
// town was read: older 便り for 便りだけ, one 便り by its id for its page.
// Each lands in the town through the store's `absorb`, never as a change of
// the reader's. The demo reads none of them.

/** The 便り that came while Home is open, waiting for the reader. */
export const townArrivals = createArrivals({
  reads: () => townStore.reads(),
  state: () => townStore.getSnapshot(),
  absorb: (arrived, from) => townStore.absorb(arrived, from),
  subscribe: (listener) => townStore.subscribe(listener),
});

const NONE: ArrivalsSnapshot = { arrived: null, retired: false };

/** What waits, and whether the pill retired for a dot. */
export const useArrivals = (): ArrivalsSnapshot =>
  useSyncExternalStore(
    townArrivals.subscribe,
    townArrivals.getSnapshot,
    () => NONE,
  );

/**
 * Reads what came every minute while Home shows, and at once when the page
 * comes back into view, the network comes back or the page is shown again
 * from the browser's back cache.
 */
export function useArrivalsWatch() {
  useEffect(() => {
    const stop = townArrivals.watch();
    const wake = () => townArrivals.wake();
    document.addEventListener("visibilitychange", wake);
    addEventListener("online", wake);
    addEventListener("pageshow", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      removeEventListener("online", wake);
      removeEventListener("pageshow", wake);
      stop();
    };
  }, []);
}

const letterReads = createLetterReads({
  reads: () => townStore.reads(),
  state: () => townStore.getSnapshot(),
  absorb: (arrived, from) => townStore.absorb(arrived, from),
  reading: () => townStore.getReading(),
});

/**
 * Reads one 便り by its id, with its replies, into the town: a page of one
 * the town did not read (an old one, from a link). Whether it was read for
 * the town as it is. A failed read throws.
 */
export const readPost = (id: string): Promise<boolean> => letterReads.post(id);

/**
 * Reads 便りだけ's next older page into the town: its 便り as the pane shows
 * them, and whether it was the last. Null when there is nothing to read
 * (the demo), or the town changed meanwhile. A failed read throws.
 */
export const readOlder = (): Promise<{
  entries: LetterEntry[];
  done: boolean;
} | null> => letterReads.older();
