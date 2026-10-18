"use client";

import { useSyncExternalStore } from "react";
import {
  APPEARANCE_KEY,
  DEVICE_DARK,
  FIRST_BRIGHTNESS,
  FIRST_PALETTE,
  FIRST_TEXT_SIZE,
  appearanceOf,
  isNight,
  type Appearance,
  type Brightness,
  type Palette,
  type TextSize,
} from "./appearance";

// Choosing the palette, the brightness and the size of the words in 設定, and reading them back
// (appearance.ts).

const FIRST: Appearance = {
  palette: FIRST_PALETTE,
  brightness: FIRST_BRIGHTNESS,
  text: FIRST_TEXT_SIZE,
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
  if (
    next.palette !== last.palette ||
    next.brightness !== last.brightness ||
    next.text !== last.text
  )
    last = next;
  return last;
}

/** Marks `<html>` so the tokens of that palette, brightness and size of the
    words apply. The
    head's script (APPEARANCE_BOOT) reads `data-brightness` again when the
    device turns dark or light. */
function mark({ palette, brightness, text }: Appearance) {
  const html = document.documentElement;
  if (palette === FIRST_PALETTE) delete html.dataset.palette;
  else html.dataset.palette = palette;
  if (text === FIRST_TEXT_SIZE) delete html.dataset.text;
  else html.dataset.text = text;
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
export const setTextSize = (text: TextSize) => choose({ text });

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

/** The size of the words (字の大きさ) chosen on this device. */
export const useTextSize = () => useAppearance().text;
