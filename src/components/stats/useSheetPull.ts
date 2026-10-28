"use client";

// A sheet from below closes when pulled down (刷新版 2節「取っ手を下に引く・
// いちばん上でさらに下へ引く」): from its top, a finger dragging down takes
// the sheet with it, and let go far enough it closes; short of that it goes
// back. Only with a finger, and only when the sheet is scrolled to its top.

import { useEffect, type RefObject } from "react";
import { DUR_MS, EASE, reducedMotion } from "../../lib/motion";

/** How far, in px, the sheet is pulled before letting go closes it. */
const CLOSE_AT = 96;

export function useSheetPull(
  inside: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const sheet = inside.current?.closest<HTMLElement>(".modal");
    if (!sheet) return;
    let start: number | null = null;
    let pulled = 0;
    const down = (event: TouchEvent) => {
      start = sheet.scrollTop <= 0 && event.touches.length === 1 ? event.touches[0].clientY : null;
      pulled = 0;
    };
    const drag = (event: TouchEvent) => {
      if (start === null) return;
      pulled = Math.max(0, event.touches[0].clientY - start);
      if (pulled === 0) return;
      if (event.cancelable) event.preventDefault();
      sheet.style.translate = `0 ${pulled}px`;
    };
    const up = () => {
      if (start === null) return;
      start = null;
      if (pulled >= CLOSE_AT) {
        onClose();
        return;
      }
      if (pulled > 0 && !reducedMotion())
        sheet.animate([{ translate: `0 ${pulled}px` }, { translate: "0 0" }], {
          duration: DUR_MS.move,
          easing: EASE.standard,
        });
      sheet.style.translate = "";
    };
    sheet.addEventListener("touchstart", down, { passive: true });
    sheet.addEventListener("touchmove", drag, { passive: false });
    sheet.addEventListener("touchend", up);
    sheet.addEventListener("touchcancel", up);
    return () => {
      sheet.removeEventListener("touchstart", down);
      sheet.removeEventListener("touchmove", drag);
      sheet.removeEventListener("touchend", up);
      sheet.removeEventListener("touchcancel", up);
    };
  }, [inside, onClose]);
}
