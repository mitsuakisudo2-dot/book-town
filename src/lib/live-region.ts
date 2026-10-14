"use client";

import { useSyncExternalStore } from "react";

// What the town says to a screen reader without moving the focus: いいね's
// count while the 「n回」 pill shows it to the eye, and later the pill and
// pull of the home. One polite region in the shell (TownApp) reads it out.

type Said = { text: string; at: number };
let said: Said = { text: "", at: 0 };
const listeners = new Set<() => void>();

/** Says `text` once. The same words said again are read again. */
export function announce(text: string) {
  said = { text, at: said.at + 1 };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The last words said, with a number that changes each time. */
export const useAnnouncement = (): Said =>
  useSyncExternalStore(
    subscribe,
    () => said,
    () => said,
  );
