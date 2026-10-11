"use client";

import { useRef, type ReactNode, type TouchEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TownActions, TownState } from "../lib/types";
import { ComposeFab, TimelineView } from "./Social";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export type HomeTab = "shelves" | "timeline";
const routes: Record<HomeTab, string> = {
  shelves: "/",
  timeline: "/timeline/",
};

/**
 * A swipe that starts on something that scrolls sideways (a shelf, a row of chips) belongs
 * to that element. Only swipes that start elsewhere switch between the shelves and the timeline.
 */
function startsOnSideways(target: EventTarget | null, root: Element): boolean {
  let element = target instanceof Element ? target : null;
  // Dialogs (an open book, the compose sheet) handle their own gestures, even through portals.
  if (
    !element ||
    !root.contains(element) ||
    element.closest(
      'dialog, [role="dialog"], [aria-modal="true"], input, textarea, select, .street-shelf, .wooden-shelf, .shelf-scroll',
    )
  )
    return true;
  while (element && element !== root) {
    const overflow = getComputedStyle(element).overflowX;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      element.scrollWidth > element.clientWidth + 1
    )
      return true;
    element = element.parentElement;
  }
  return false;
}

export function HomeView({
  tab,
  children,
  ...shared
}: Shared & { tab: HomeTab; children: ReactNode }) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    start.current =
      event.touches.length === 1 &&
      !startsOnSideways(event.target, event.currentTarget)
        ? {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY,
            time: Date.now(),
          }
        : null;
  }
  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const from = start.current;
    start.current = null;
    const touch = event.changedTouches[0];
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (
      Math.abs(dx) < 70 ||
      Math.abs(dx) < Math.abs(dy) * 1.8 ||
      Date.now() - from.time > 800
    )
      return;
    if (dx < 0 && tab === "shelves") router.push(routes.timeline);
    if (dx > 0 && tab === "timeline") router.push(routes.shelves);
  }
  return (
    <div
      className="home-view"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => (start.current = null)}
    >
      <nav className="home-tabs" aria-label="ホームの表示">
        <Link
          href={routes.shelves}
          aria-current={tab === "shelves" ? "page" : undefined}
        >
          書店
        </Link>
        <Link
          href={routes.timeline}
          aria-current={tab === "timeline" ? "page" : undefined}
        >
          タイムライン
        </Link>
      </nav>
      {tab === "timeline" ? <TimelineView {...shared} /> : children}
      <ComposeFab
        {...shared}
        onPosted={() => {
          if (tab !== "timeline") router.push(routes.timeline);
        }}
      />
    </div>
  );
}
