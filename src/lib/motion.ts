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

/** The most, in ms, a movement played by playByFrames moves on per frame. */
const MAX_FRAME_MS = 34;

/**
 * Plays `animation` frame by frame, at most MAX_FRAME_MS on per frame, and
 * then lets it go (cancel) and calls `done`. A page that holds the screen
 * still while it is drawn (書店めぐり, ホーム coming back from 便りだけ)
 * would otherwise spend the movement's time then: driven by the clock, it
 * jumps to the end. Cancelling the animation stops it on the next frame.
 */
export function playByFrames(
  animation: Animation,
  duration: number,
  done?: () => void,
) {
  animation.pause();
  let shown = 0;
  let last: number | null = null;
  const frame = (time: number) => {
    if (animation.playState === "idle") return;
    shown += last === null ? 0 : Math.min(time - last, MAX_FRAME_MS);
    last = time;
    if (shown < duration) {
      animation.currentTime = shown;
      requestAnimationFrame(frame);
      return;
    }
    animation.cancel();
    done?.();
  };
  requestAnimationFrame(frame);
}

/** Scroll behavior that keeps still when less motion is asked for. */
export const scrollBehavior = (): ScrollBehavior =>
  reducedMotion() ? "instant" : "smooth";
