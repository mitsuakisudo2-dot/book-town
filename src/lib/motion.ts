// How long things move, for the movements the browser can't take from CSS
// (element.animate, timers). The names and numbers are those of --dur-* and
// --ease-* in src/app/tokens.css; tests/tokens.test.ts checks they agree.
// Screens in CSS use the variables themselves.

export const DUR_MS = {
  press: 150,
  move: 200,
  tab: 280,
  settle: 450,
  lamp: 800,
} as const;

export const EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  tab: "cubic-bezier(0.3, 0, 0, 1)",
} as const;

const LESS_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether the reader asked for less motion (the browser's setting). */
export const reducedMotion = (): boolean => matchMedia(LESS_MOTION).matches;

/** Scroll behavior that keeps still when less motion is asked for. */
export const scrollBehavior = (): ScrollBehavior =>
  reducedMotion() ? "instant" : "smooth";
