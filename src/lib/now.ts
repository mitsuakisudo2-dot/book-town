"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const still = () => () => {};

/**
 * The time, to the minute. Null in the static page and while it hydrates, so
 * what depends on the day (今夜の一軒, the 特集) is drawn only in the browser
 * and the first render matches the HTML.
 */
export function useNow(): number | null {
  return useSyncExternalStore(
    still,
    () => Math.floor(Date.now() / MINUTE) * MINUTE,
    () => null,
  );
}
