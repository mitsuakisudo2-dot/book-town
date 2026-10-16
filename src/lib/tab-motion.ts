// Moving between the tabs of the bottom bar, as phone apps do: the page
// slides in from the side of the tab tapped, and that tab's icon springs.
//
// Each tab's page mounts its own TownApp, so the tab shown last is kept here,
// outside React, for as long as the page is open.

let shownLast: number | null = null;
// A tab's page can name its tab a moment late: 本棚 reads `?books=` from the
// address, which changes just after the page is drawn, so it is わたし for a
// frame first. A move straight after another is the same move, counted from
// where the first one started.
const SAME_MOVE_MS = 200;
let cameFrom: number | null = null;
let movedAt = -Infinity;
let playing: Animation[] = [];

/**
 * Which way the reader moved along the bar to reach the tab at `index`:
 * 1 to the right, -1 to the left, 0 when it is the same tab, the first tab
 * seen, or a page outside the tabs (`null`, which is not remembered).
 */
export function tabStep(
  index: number | null,
  now = typeof performance === "undefined" ? 0 : performance.now(),
): -1 | 0 | 1 {
  if (index === null) return 0;
  const sameMove = now - movedAt < SAME_MOVE_MS;
  const from = sameMove ? cameFrom : shownLast;
  if (!sameMove) cameFrom = shownLast;
  shownLast = index;
  if (from === index) {
    // Back where the move started: it was no move after all.
    if (sameMove) stopPlaying();
    return 0;
  }
  if (from === null) return 0;
  movedAt = now;
  return index > from ? 1 : -1;
}

function stopPlaying() {
  for (const animation of playing) animation.cancel();
  playing = [];
}

/** How far, in px, the page starts from where it comes to rest. */
export const TAB_SLIDE = 24;

/** Slides `page` in from the side of the tab tapped and springs `icon`. */
export function playTabMove(
  step: -1 | 0 | 1,
  page: HTMLElement | null,
  icon: Element | null,
) {
  if (step === 0 || typeof window === "undefined") return;
  stopPlaying();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const slide = page?.animate?.(
    [
      // By its offset (the page is position: relative), not a transform,
      // which would carry the page's fixed parts away while it moves.
      { opacity: 0, left: `${step * TAB_SLIDE}px` },
      { opacity: 1, left: "0px" },
    ],
    { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  );
  const spring = icon?.animate?.(
    [
      { transform: "scale(0.82)" },
      { transform: "scale(1.14)", offset: 0.55 },
      { transform: "scale(1)" },
    ],
    { duration: 320, easing: "ease-out" },
  );
  playing = [slide, spring].filter((a): a is Animation => Boolean(a));
}
