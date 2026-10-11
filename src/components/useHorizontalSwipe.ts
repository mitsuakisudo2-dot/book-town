"use client";

import { useRef, type TouchEvent } from "react";

/** Keep vertical scrolling and gestures on nested controls with their own surface. */
export function useHorizontalSwipe({
  onSwipe,
  enabled = true,
  exclude = "button,a,input,textarea,select,summary",
  contain = false,
}: {
  onSwipe: (direction: -1 | 1) => void;
  enabled?: boolean;
  exclude?: string;
  contain?: boolean;
}) {
  const start = useRef<{
    id: number;
    x: number;
    y: number;
    time: number;
    axis: "horizontal" | "vertical" | null;
  } | null>(null);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      if (contain) event.stopPropagation();
      const target = event.target;
      if (
        !enabled ||
        event.touches.length !== 1 ||
        !(target instanceof Element) ||
        target.closest(exclude)
      ) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      start.current = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
        axis: null,
      };
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      if (contain) event.stopPropagation();
      const from = start.current;
      if (!from || event.touches.length !== 1) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      if (touch.identifier !== from.id || from.axis) return;
      const dx = Math.abs(touch.clientX - from.x);
      const dy = Math.abs(touch.clientY - from.y);
      if (dx > 12 && dx > dy * 1.5) from.axis = "horizontal";
      else if (dy > 12) from.axis = "vertical";
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      if (contain) event.stopPropagation();
      const from = start.current;
      start.current = null;
      if (!enabled || !from || from.axis === "vertical" || event.touches.length)
        return;
      const touch = Array.from(event.changedTouches).find(
        (entry) => entry.identifier === from.id,
      );
      if (!touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (
        Math.abs(dx) >= 56 &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        event.timeStamp - from.time < 1000
      )
        onSwipe(dx < 0 ? 1 : -1);
    },
    onTouchCancel(event: TouchEvent<HTMLElement>) {
      if (contain) event.stopPropagation();
      start.current = null;
    },
  };
}
