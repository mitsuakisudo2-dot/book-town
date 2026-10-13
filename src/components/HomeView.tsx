"use client";

import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import Link from "next/link";
import { bookPath } from "../lib/books";
import { useRouter } from "next/navigation";
import type { TownActions, TownState } from "../lib/types";
import { ComposeFab, TimelineView } from "./Social";
import { BookJacket, Icon } from "./ui";
import { bookToContinue } from "../lib/reading";
import { leaveLayers } from "../lib/back-layer";
import {
  noteHomeAddress,
  useHomeAddress,
  type HomePath,
} from "../lib/last-address";
import { useUrlParam } from "../lib/url-state";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export type HomeTab = "shelves" | "timeline";
const routes: Record<HomeTab, HomePath> = {
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
  // The other tab opens as it was left (its filter, the street's lane); the
  // tab already open stays a plain way back to its start.
  const other: HomeTab = tab === "shelves" ? "timeline" : "shelves";
  const otherAddress = useHomeAddress(routes[other]);
  const href = (to: HomeTab) => (to === tab ? routes[to] : otherAddress);
  // This tab's choices are kept as they now are, however they changed: a
  // filter, a link back to the start, 戻る or 進む.
  const [show] = useUrlParam("show");
  const [lane] = useUrlParam("lane");
  useEffect(() => noteHomeAddress(), [tab, show, lane]);
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
    if (dx < 0 && tab === "shelves") router.push(otherAddress);
    if (dx > 0 && tab === "timeline") router.push(otherAddress);
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
          href={href("shelves")}
          aria-current={tab === "shelves" ? "page" : undefined}
        >
          書店
        </Link>
        <Link
          href={href("timeline")}
          aria-current={tab === "timeline" ? "page" : undefined}
        >
          タイムライン
        </Link>
      </nav>
      {/* Until a book is saved, the way to the list lives on the profile. */}
      {shared.state.wishlist.length > 0 && (
        <div className="home-saved-books">
          <Link href="/reading-list/">
            <Icon name="bookmark" size={16} />
            読みたい本
            <span>{shared.state.wishlist.length}</span>
            <Icon name="arrow" size={14} />
          </Link>
        </div>
      )}
      <ContinueReading state={shared.state} />
      {tab === "timeline" ? <TimelineView {...shared} /> : children}
      <ComposeFab
        {...shared}
        onPosted={() => {
          // The dialog's step comes off first; 戻る from the timeline is home.
          if (tab !== "timeline")
            leaveLayers(() => router.push(routes.timeline));
        }}
      />
    </div>
  );
}

/** The book left unfinished, a tap away from its next reading. */
function ContinueReading({ state }: { state: TownState }) {
  const next = bookToContinue(state);
  const book = next && state.books.find((entry) => entry.id === next.bookId);
  if (!next || !book) return null;
  // The jacket leads to the book's own page (where its cover is credited);
  // the rest of the card, to reading on. Two links side by side, not nested.
  return (
    <div className="home-continue">
      <Link
        href={bookPath(book.id)}
        className="home-continue-book"
        aria-label={`『${book.title}』の作品ページへ`}
      >
        <BookJacket book={book} className="home-continue-jacket" />
      </Link>
      <Link
        href="/reading/"
        className="home-continue-main"
        aria-label={`『${book.title}』の続きを読む`}
      >
        <span className="home-continue-text">
          <small>読みかけの本</small>
          <b>{book.title}</b>
          {next.lastWords && (
            <span className="home-continue-words">
              前回のひとこと「{next.lastWords}」
            </span>
          )}
        </span>
        <span className="home-continue-go">
          <Icon name="reading" size={16} />
          続きを読む
        </span>
      </Link>
    </div>
  );
}
