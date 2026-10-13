"use client";

import { useSyncExternalStore } from "react";

// Whether the reading screen keeps the town's words open instead of folded.
// A way of looking that belongs to this browser, so it is kept here and not
// in the account; without storage it simply starts folded.
export const READING_PEEK_KEY = "book-town-reading-peek";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(READING_PEEK_KEY) === "open";
  } catch {
    return false;
  }
}

export function setReadingPeekOpen(open: boolean) {
  try {
    if (open) localStorage.setItem(READING_PEEK_KEY, "open");
    else localStorage.removeItem(READING_PEEK_KEY);
  } catch {
    // Kept for this page only; the fold still opens by hand.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the reader chose to keep the town's words open while reading. */
export const useReadingPeekOpen = () =>
  useSyncExternalStore(subscribe, read, () => false);
