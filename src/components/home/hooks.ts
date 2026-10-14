"use client";

import { useState, useSyncExternalStore } from "react";
import { usePersistenceStatus } from "../../lib/store";
import { useUrlParam } from "../../lib/url-state";

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

/**
 * Whether the town has been read once. A later reload of the town (a refused
 * write) leaves what is drawn as it is.
 */
export function useTownRead(): boolean {
  const reading = usePersistenceStatus() === "loading";
  const [read, setRead] = useState(false);
  if (!read && !reading) setRead(true);
  return read || !reading;
}

/**
 * What a pane drew, held still (決定 H:56-57): made once the town is read,
 * and again only when `refresh` changes (a tap on the tab already shown, or
 * ホーム at the bottom). A change of the town after that redraws the cards it
 * holds, but never adds one above the reader or reorders them.
 */
export function useHeld<T>(
  ready: boolean,
  refresh: number,
  capture: (now: number) => T,
): T | null {
  const now = useNow();
  const [held, setHeld] = useState<{ value: T; refresh: number } | null>(null);
  if (ready && now !== null && (held === null || held.refresh !== refresh)) {
    const next = { value: capture(now), refresh };
    setHeld(next);
    return next.value;
  }
  return held?.value ?? null;
}

/**
 * A value each pane keeps in its own address (`rounds`: how far it was
 * walked). While the pane is hidden the address is the other pane's, so it
 * keeps the value it last read.
 */
export function usePaneParam(
  name: string,
  shown: boolean,
): [string | null, (value: string | null) => void] {
  const [value, setValue] = useUrlParam(name);
  const [kept, setKept] = useState(value);
  if (shown && kept !== value) setKept(value);
  return [shown ? value : kept, setValue];
}

/** Scrolls smoothly, unless the reader asked for less motion. */
export const motion = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

/** Brings `id` under the bars at the top, as the entrances do. */
export function scrollToPart(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ block: "start", behavior: motion() });
}
