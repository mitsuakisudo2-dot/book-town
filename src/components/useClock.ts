"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock time for timers. It stays null during the static render and hydration,
 * so the first client render matches the prerendered HTML.
 */
export function useClock(intervalMs = 1000) {
  const [clock, setClock] = useState<{ now: number; openedAt: number } | null>(
    null,
  );
  useEffect(() => {
    const openedAt = Date.now();
    const tick = () => setClock({ now: Date.now(), openedAt });
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return clock;
}
