"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  createArrivals,
  olderFrom,
  olderPage,
  type ArrivalsSnapshot,
} from "../../lib/arrivals";
import { followedAuthors, type LetterEntry } from "../../lib/home-feed";
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

/** 便り read alone by their id: never where an older page starts. */
const alone = new Set<string>();

/**
 * Reads one 便り by its id, with its replies, into the town: a page of one
 * the town did not read (an old one, from a link). Whether it was read; a
 * town with nothing to read (the demo) has none to read.
 */
export async function readPost(id: string): Promise<boolean> {
  const reads = townStore.reads();
  if (!reads) return false;
  const arrived = await reads.post(id);
  const had = new Set(townStore.getSnapshot().posts.map((post) => post.id));
  for (const post of arrived.posts) if (!had.has(post.id)) alone.add(post.id);
  townStore.absorb(arrived, reads.generation);
  return true;
}

/**
 * Reads 便りだけ's next older page into the town: its 便り as the pane shows
 * them, and whether it was the last. Null when there is nothing to read
 * (the demo), or the town changed meanwhile. A failed read throws.
 */
export async function readOlder(): Promise<{
  entries: LetterEntry[];
  done: boolean;
} | null> {
  const reads = townStore.reads();
  if (!reads) return null;
  const state = townStore.getSnapshot();
  const arrived = await reads.older(
    olderFrom(state, alone, Date.now()),
    followedAuthors(state),
  );
  if (townStore.reads()?.generation !== reads.generation) return null;
  townStore.absorb(arrived, reads.generation);
  return olderPage(townStore.getSnapshot(), arrived);
}
