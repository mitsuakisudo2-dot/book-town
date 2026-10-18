"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { announce } from "../../lib/live-region";
import { failure, NAMES } from "../../lib/words";

// Pull to refresh (決定 H:123): at the very top of Home, a finger drawn down
// reads what is new and takes it in at once. The page itself does not move
// (`overscroll-behavior-y: none` on <html> while Home shows, home.css): the
// words open a space under the tabs as the finger goes, so no touchmove has
// to be held back.

/** The farthest the space opens. */
export const PULL_MAX = 110;
/** Let go this far down or farther, and it reads. */
export const PULL_RELEASE = 64;
/** The space the words keep while reading, and while saying how it went. */
const PULL_HOLD = 48;
/** How long how it went stays. */
const PULL_SAID_FOR = 900;

export type PullOutcome = "arrived" | "none" | "failed";
export type PullPhase = "pull" | "ready" | "loading" | PullOutcome;

/** v37's words, in turn; the failure's is this PR's (仮). */
export const PULL_WORDS: Record<PullPhase, string> = {
  pull: `引っぱって新しい${NAMES.letter}を読む`,
  ready: "離すと読み込みます",
  loading: "読み込んでいます",
  arrived: `新しい${NAMES.letter}が届きました`,
  none: `新しい${NAMES.letter}はまだありません`,
  failed: failure({ what: "つながらないため、読み込めませんでした" }, ""),
};

/**
 * Something is over the page: a dialog, 注釈モード, or a 便り's page or a
 * book in hand holding the page still beneath it.
 */
const covered = () =>
  document.body.style.position === "fixed" ||
  document.querySelector(
    '.modal-backdrop, .site-notes-mode, [aria-modal="true"], dialog[open]',
  ) !== null;

export type Pull = { phase: PullPhase; distance: number } | null;

/**
 * The space a pull opens, kept outside React's state of Home: a finger's
 * every move redraws the space (PullSpace), never the panes beneath.
 */
export function createPullSpace() {
  let pull: Pull = null;
  const listeners = new Set<() => void>();
  return {
    get: (): Pull => pull,
    set(next: Pull) {
      if (
        next === pull ||
        (next &&
          pull &&
          next.phase === pull.phase &&
          next.distance === pull.distance)
      )
        return;
      pull = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type PullSpaceStore = ReturnType<typeof createPullSpace>;

/**
 * The pull's touch handlers, the space it opens (`space`, for PullSpace)
 * and `run`, which reads as a pull does (the tab tapped at the top, for a
 * desktop and the keyboard). `refresh` reads and takes in, and says how it
 * went.
 */
export function usePullToRefresh(refresh: () => Promise<PullOutcome>) {
  const [space] = useState(createPullSpace);
  const setPull = space.set;
  const start = useRef<{ x: number; y: number; pulling: boolean } | null>(null);
  const distance = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function run() {
    if (busy.current) return;
    busy.current = true;
    setPull({ phase: "loading", distance: PULL_HOLD });
    void refresh()
      .catch((): PullOutcome => "failed")
      .then((outcome) => {
        announce(PULL_WORDS[outcome]);
        setPull({ phase: outcome, distance: PULL_HOLD });
        timer.current = setTimeout(() => {
          timer.current = null;
          busy.current = false;
          setPull(null);
        }, PULL_SAID_FOR);
      });
  }
  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    // A second finger while pulling: no pull, and the space closes.
    if (start.current?.pulling && !busy.current) {
      distance.current = 0;
      setPull(null);
    }
    start.current =
      !busy.current &&
      event.touches.length === 1 &&
      window.scrollY <= 0 &&
      !covered()
        ? { x: touch.clientX, y: touch.clientY, pulling: false }
        : null;
  }
  function onTouchMove(event: TouchEvent) {
    const from = start.current;
    const touch = event.touches[0];
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (!from.pulling) {
      if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;
      // Up, or more sideways than down (a swipe between the tabs): not a pull.
      if (dy <= 4 || Math.abs(dx) > dy || window.scrollY > 0) {
        start.current = null;
        return;
      }
      from.pulling = true;
    }
    distance.current = Math.max(0, Math.min(PULL_MAX, dy * 0.5));
    setPull({
      phase: distance.current >= PULL_RELEASE ? "ready" : "pull",
      distance: distance.current,
    });
  }
  function onTouchEnd() {
    const from = start.current;
    start.current = null;
    if (!from?.pulling) return;
    if (distance.current >= PULL_RELEASE) run();
    else setPull(null);
    distance.current = 0;
  }
  function onTouchCancel() {
    const from = start.current;
    start.current = null;
    distance.current = 0;
    if (from?.pulling && !busy.current) setPull(null);
  }
  return { space, run, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
