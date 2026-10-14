"use client";

import { useEffect, useRef, type RefObject } from "react";

/** The strip at the left edge that belongs to Safari's own back gesture. */
export const SWIPE_EDGE = 24;
/** How far a finger moves before the page follows it. */
const SWIPE_START = 8;
/** Closes past this share of the width… */
const SWIPE_CLOSE_SHARE = 0.3;
/** …or on a flick this fast (px/ms), once it has gone this far. */
const SWIPE_FLICK_SPEED = 0.35;
const SWIPE_FLICK_DISTANCE = 24;

/** Whether `target`, up to `layer`, sits in something that scrolls sideways. */
function inSidewaysScroller(target: Element, layer: Element): boolean {
  for (
    let node: Element | null = target;
    node && node !== layer;
    node = node.parentElement
  ) {
    if (node.scrollWidth <= node.clientWidth + 1) continue;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll") return true;
  }
  return false;
}

/**
 * A 便り's page follows a finger dragged to the right from anywhere on it,
 * and closes when let go far enough or fast enough; otherwise it springs
 * back (v37 app.js:400-429). A finger, not a mouse: a mouse drags to select
 * words. Starts within 24px of the left edge are Safari's back gesture, which
 * takes the page's 戻る step itself. The click a drag ends with is not a tap.
 */
export function useSwipeBack(
  ref: RefObject<HTMLElement | null>,
  onBack: () => void,
) {
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    type Drag = {
      id: number;
      x: number;
      y: number;
      following: boolean;
      width: number;
      /** The last few positions, for the speed at release. */
      trail: { x: number; at: number }[];
    };
    let drag: Drag | null = null;
    let swallow = false;
    const reduced = () =>
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const settle = (to: "back" | "open", from: number) => {
      layer.classList.remove("is-dragging");
      if (to === "open") {
        layer.style.transform = "";
        return;
      }
      if (reduced() || typeof layer.animate !== "function") {
        backRef.current();
        return;
      }
      const slide = layer.animate(
        [
          { transform: `translateX(${from}px)` },
          { transform: "translateX(100%)" },
        ],
        { duration: 150, easing: "cubic-bezier(.2,0,0,1)", fill: "forwards" },
      );
      void slide.finished.then(
        () => backRef.current(),
        () => backRef.current(),
      );
    };
    const down = (event: PointerEvent) => {
      // A new touch starts afresh: whatever came of the last drag is over.
      swallow = false;
      drag = null;
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      const target = event.target as Element | null;
      if (
        !target ||
        event.clientX < SWIPE_EDGE ||
        document.querySelector(".modal-backdrop, .site-notes-mode") ||
        inSidewaysScroller(target, layer)
      )
        return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        following: false,
        width: layer.getBoundingClientRect().width,
        trail: [{ x: event.clientX, at: event.timeStamp }],
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.following) {
        if (Math.abs(dx) < SWIPE_START && Math.abs(dy) < SWIPE_START) return;
        // Up, down or to the left first: the page scrolls, and that is all.
        if (dx < SWIPE_START || Math.abs(dx) < 1.2 * Math.abs(dy)) {
          drag = null;
          return;
        }
        drag.following = true;
        layer.classList.add("is-dragging");
        try {
          layer.setPointerCapture(event.pointerId);
        } catch {
          // Already let go.
        }
      }
      drag.trail = [
        ...drag.trail,
        { x: event.clientX, at: event.timeStamp },
      ].slice(-6);
      layer.style.transform = `translateX(${Math.max(0, dx)}px)`;
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const ended = drag;
      drag = null;
      if (!ended.following) return;
      swallow = true;
      const dx = Math.max(0, event.clientX - ended.x);
      const first = ended.trail[0];
      const last = ended.trail[ended.trail.length - 1];
      const speed = (last.x - first.x) / Math.max(1, last.at - first.at);
      const away =
        dx > ended.width * SWIPE_CLOSE_SHARE ||
        (speed > SWIPE_FLICK_SPEED && dx > SWIPE_FLICK_DISTANCE);
      settle(away ? "back" : "open", dx);
    };
    const cancel = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const ended = drag;
      drag = null;
      if (ended.following) settle("open", 0);
    };
    // The page that follows the finger takes the touch as its own. Left to
    // the browser, a drag let go fast is a flick it carries on (Chrome), and
    // the next tap, however soon, only stops that: it would open nothing.
    const hold = (event: TouchEvent) => {
      if (drag?.following && event.cancelable) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      event.preventDefault();
      event.stopPropagation();
    };
    layer.addEventListener("pointerdown", down);
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", cancel);
    layer.addEventListener("touchmove", hold, { passive: false });
    layer.addEventListener("click", click, true);
    return () => {
      layer.removeEventListener("pointerdown", down);
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", cancel);
      layer.removeEventListener("touchmove", hold);
      layer.removeEventListener("click", click, true);
    };
  }, [ref]);
}
