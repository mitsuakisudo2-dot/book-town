"use client";

import { useSyncExternalStore } from "react";
import {
  APPEARANCE_KEY,
  DEVICE_DARK,
  FIRST_BRIGHTNESS,
  FIRST_PALETTE,
  appearanceOf,
  isNight,
  type Appearance,
  type Brightness,
  type Palette,
} from "./appearance";

// Choosing the palette and the brightness in 設定, and reading them back
// (appearance.ts).

const FIRST: Appearance = {
  palette: FIRST_PALETTE,
  brightness: FIRST_BRIGHTNESS,
};

/** Chosen on this page, for a browser that refuses storage. */
let chosenHere: Appearance | null = null;
/** The last answer, so React sees the same object until something changes. */
let last: Appearance = FIRST;

function read(): Appearance {
  let next: Appearance;
  try {
    next = appearanceOf(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    next = chosenHere ?? FIRST;
  }
  if (next.palette !== last.palette || next.brightness !== last.brightness)
    last = next;
  return last;
}

/** Marks `<html>` so the tokens of that palette and brightness apply. The
    head's script (APPEARANCE_BOOT) reads `data-brightness` again when the
    device turns dark or light. */
function mark({ palette, brightness }: Appearance) {
  const html = document.documentElement;
  if (palette === FIRST_PALETTE) delete html.dataset.palette;
  else html.dataset.palette = palette;
  html.dataset.brightness = brightness;
  if (isNight(brightness, matchMedia(DEVICE_DARK).matches))
    html.dataset.theme = "dark";
  else delete html.dataset.theme;
}

const listeners = new Set<() => void>();

function choose(change: Partial<Appearance>) {
  const next = { ...read(), ...change };
  chosenHere = next;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    // Kept for this page only: the colours still change until it is left.
  }
  mark(next);
  listeners.forEach((listener) => listener());
}

export const setPalette = (palette: Palette) => choose({ palette });
export const setBrightness = (brightness: Brightness) => choose({ brightness });

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Chosen in another tab of the town: this one follows.
  const fromElsewhere = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_KEY) return;
    mark(appearanceOf(event.newValue));
    listener();
  };
  window.addEventListener("storage", fromElsewhere);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromElsewhere);
  };
}

const useAppearance = () => useSyncExternalStore(subscribe, read, () => FIRST);

/** The palette chosen on this device. */
export const usePalette = () => useAppearance().palette;

/** The brightness (明るさ) chosen on this device. */
export const useBrightness = () => useAppearance().brightness;
