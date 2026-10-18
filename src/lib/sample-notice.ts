"use client";
import { NAMES } from "./words";

/**
 * The 見本 are there to walk through and read. A signed-in reader can keep
 * their books, but a like, a follow or a word for a 見本's shop or post would
 * reach nobody, so the stores turn it away and the page says so once.
 */
export const SAMPLE_NOTICE = `見本の書店と${NAMES.letter}には、いいねやフォローは届きません`;

/** The home's 見本 掲示板 says what it is when its buttons are pressed. */
export const BOARD_NOTICE =
  "見本の掲示板です。お題と募集は、これから始まります";

let refusedAt = 0;
const listeners = new Set<(message: string) => void>();

/** Says, once, why nothing happened: `message`, or the 見本's own words. */
export function refuseForSample(message: string = SAMPLE_NOTICE) {
  refusedAt = Date.now();
  listeners.forEach((listener) => listener(message));
}

/** Read at the moment of a change: whether it was just turned away. */
export const refusedForSample = () => Date.now() - refusedAt < 300;

/** Calls `listener` with the words to show each time a change is turned away. */
export function onSampleRefusal(listener: (message: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
