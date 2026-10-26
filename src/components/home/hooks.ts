"use client";

import { useState } from "react";
import { usePersistenceStatus } from "../../lib/store";
import { scrollBehavior } from "../../lib/motion";
import { useUrlParam } from "../../lib/url-state";

import { useNow } from "../../lib/now";

export { useNow };

/**
 * Which reading of the town the panes draw: null while one is on its way,
 * then 1, 2, … for each the town has finished. A later reading begins when
 * the town moves to another account (a sign-in or sign-out, in this tab or
 * another, or a session that ended): until it is read, the panes show their
 * bones, never the empty town in between nor the account before. A reload of
 * the same town after a refused write is not one (its status never goes back
 * to loading): what is drawn stays.
 */
export function useTownReading(): number | null {
  const loading = usePersistenceStatus() === "loading";
  const [reads, setReads] = useState({ count: 0, loading: true });
  if (reads.loading !== loading) {
    const next = { count: reads.count + (loading ? 0 : 1), loading };
    setReads(next);
    return loading ? null : next.count;
  }
  return loading ? null : reads.count;
}

/**
 * What a pane drew, held still (決定 H:56-57): made once the town is read,
 * and again only when `refresh` changes (a tap on the tab already shown, or
 * ホーム at the bottom) or the town is read afresh (`reading`, another
 * account's). A change of the town after that redraws the cards it holds,
 * but never adds one above the reader or reorders them. Null while the town
 * is on its way.
 */
export function useHeld<T>(
  reading: number | null,
  refresh: number,
  capture: (now: number) => T,
): T | null {
  const now = useNow();
  const [held, setHeld] = useState<{
    value: T;
    refresh: number;
    reading: number;
  } | null>(null);
  if (reading === null) return null;
  if (
    now !== null &&
    (held === null || held.refresh !== refresh || held.reading !== reading)
  ) {
    const next = { value: capture(now), refresh, reading };
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
export const motion = scrollBehavior;

/** Brings `id` under the bars at the top, as the entrances do. */
export function scrollToPart(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ block: "start", behavior: motion() });
}
