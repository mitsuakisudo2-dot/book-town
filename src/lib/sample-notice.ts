"use client";

/**
 * The 見本 are there to walk through and read. A signed-in reader can keep
 * their books, but a like, a follow or a word for a 見本's shop or post would
 * reach nobody, so the stores turn it away and the page says so once.
 */
export const SAMPLE_NOTICE =
  "見本の書店と投稿には、いいねやフォローは届きません";

let refusedAt = 0;
const listeners = new Set<(message: string) => void>();

export function refuseForSample() {
  refusedAt = Date.now();
  listeners.forEach((listener) => listener(SAMPLE_NOTICE));
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
