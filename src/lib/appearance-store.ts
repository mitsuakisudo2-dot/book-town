"use client";

import { useSyncExternalStore } from "react";
import {
  APPEARANCE_KEY,
  FIRST_PALETTE,
  paletteOf,
  type Palette,
} from "./appearance";

// Choosing the palette in 設定, and reading it back (appearance.ts).

/** Chosen on this page, for a browser that refuses storage. */
let chosenHere: Palette | null = null;

function read(): Palette {
  try {
    return paletteOf(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return chosenHere ?? FIRST_PALETTE;
  }
}

/** Marks `<html>` so the tokens of that palette apply. */
function mark(palette: Palette) {
  const html = document.documentElement;
  if (palette === FIRST_PALETTE) delete html.dataset.palette;
  else html.dataset.palette = palette;
}

const listeners = new Set<() => void>();

export function setPalette(palette: Palette) {
  chosenHere = palette;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ palette }));
  } catch {
    // Kept for this page only: the colour still changes until it is left.
  }
  mark(palette);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Chosen in another tab of the town: this one follows.
  const fromElsewhere = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_KEY) return;
    mark(paletteOf(event.newValue));
    listener();
  };
  window.addEventListener("storage", fromElsewhere);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromElsewhere);
  };
}

/** The palette chosen on this device. */
export const usePalette = () =>
  useSyncExternalStore(subscribe, read, () => FIRST_PALETTE);
