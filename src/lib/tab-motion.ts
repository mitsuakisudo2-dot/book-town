// Moving between the tabs of the bottom bar, as phone apps do: the round
// mark behind the chosen tab slides along the bar to the tab tapped.
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
let playing: { animation: Animation; mark: Element } | null = null;

export type TabMove = { from: number; to: number };

/**
 * The move along the bar that reached the tab at `index`, or `null` when it
 * is the same tab, the first tab seen, or a page outside the tabs (`null`,
 * which is not remembered).
 */
export function tabMove(
  index: number | null,
  now = typeof performance === "undefined" ? 0 : performance.now(),
): TabMove | null {
  if (index === null) return null;
  const sameMove = now - movedAt < SAME_MOVE_MS;
  const from = sameMove ? cameFrom : shownLast;
  if (!sameMove) cameFrom = shownLast;
  shownLast = index;
  if (from === index) {
    // Back where the move started: it was no move after all.
    if (sameMove) stopPlaying();
    return null;
  }
  if (from === null) return null;
  movedAt = now;
  return { from, to: index };
}

function stopPlaying() {
  if (!playing) return;
  playing.animation.cancel();
  playing.mark.remove();
  playing = null;
}

/** How long, in ms, the mark takes to reach the tab tapped. */
export const TAB_MARK_MS = 280;

/**
 * Slides a round mark (`.nav-mark`) along `bar` from the icon of the tab
 * moved from to the icon of the tab moved to. The chosen tab's own mark is
 * hidden (`is-moving`) until it arrives.
 */
export function playTabMove(move: TabMove | null, bar: HTMLElement | null) {
  if (!move || !bar || typeof window === "undefined") return;
  stopPlaying();
  bar.classList.remove("is-moving");
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const tabs = bar.querySelectorAll(":scope > a");
  const from = tabs[move.from]?.querySelector("svg");
  const to = tabs[move.to]?.querySelector("svg");
  if (!from || !to || typeof bar.animate !== "function") return;
  const box = bar.getBoundingClientRect();
  const centre = (icon: Element) => {
    const rect = icon.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - box.left,
      y: rect.top + rect.height / 2 - box.top,
    };
  };
  const start = centre(from);
  const end = centre(to);
  const mark = document.createElement("span");
  mark.className = "nav-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.style.left = `${end.x}px`;
  mark.style.top = `${end.y}px`;
  bar.prepend(mark);
  bar.classList.add("is-moving");
  const animation = mark.animate(
    [
      {
        transform: `translate(-50%, -50%) translate(${start.x - end.x}px, ${start.y - end.y}px)`,
      },
      { transform: "translate(-50%, -50%)" },
    ],
    { duration: TAB_MARK_MS, easing: "cubic-bezier(0.3, 0, 0, 1)" },
  );
  playing = { animation, mark };
  animation.finished
    .then(() => {
      if (playing?.animation !== animation) return;
      bar.classList.remove("is-moving");
      mark.remove();
      playing = null;
    })
    .catch(() => {});
}
