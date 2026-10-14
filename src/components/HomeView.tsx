"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import Link from "next/link";
import { bookPath } from "../lib/books";
import type { TownActions, TownState } from "../lib/types";
import { ComposeFab, TimelineView } from "./Social";
import { BookJacket, Icon } from "./ui";
import { bookToContinue } from "../lib/reading";
import { leaveLayers } from "../lib/back-layer";
import { noteHomeAddress, useHomeAddress } from "../lib/last-address";
import { replaceAddress, useAddressPath, useUrlParam } from "../lib/url-state";
import {
  HOME_TAB_PATHS,
  onHomeTop,
  tabOfPath,
  type HomeTab,
} from "../lib/home-tab";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
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

/** A plain click, not one meant to open the link in a new tab or window. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

export function HomeView({
  tab: routeTab,
  children,
  ...shared
}: Shared & { tab: HomeTab; children: ReactNode }) {
  // The tab is the address's: a switch rewrites `/` ↔ `/timeline/` in place,
  // so 戻る to this address, or a reload, opens the same tab. While a page of
  // another address is drawn over Home, the tab shown last stays.
  const path = useAddressPath(HOME_TAB_PATHS[routeTab]);
  const [shownTab, setShownTab] = useState<HomeTab>(routeTab);
  const tab = tabOfPath(path) ?? shownTab;
  if (tab !== shownTab) setShownTab(tab);
  // The other tab opens as it was left (its filter, the street's lane).
  const other: HomeTab = tab === "home" ? "letters" : "home";
  const otherAddress = useHomeAddress(HOME_TAB_PATHS[other]);
  // This tab's choices are kept as they now are, however they changed: a
  // filter, a switch of tabs, 戻る or 進む.
  const [show] = useUrlParam("show");
  const [lane] = useUrlParam("lane");
  useEffect(() => noteHomeAddress(), [tab, show, lane]);
  // Each tab keeps where it was scrolled to, for coming back to it.
  const scrolls = useRef<Partial<Record<HomeTab, number>>>({});
  const scrollBack = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (scrollBack.current === null) return;
    window.scrollTo({ top: scrollBack.current, behavior: "instant" });
    scrollBack.current = null;
  }, [tab]);
  function toTop() {
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  useEffect(() => onHomeTop(toTop), []);
  /** Shows `to` in place: no step of 戻る. The tab already open goes to its top. */
  function switchTo(to: HomeTab) {
    if (to === tab) return toTop();
    scrolls.current[tab] = window.scrollY;
    scrollBack.current = scrolls.current[to] ?? 0;
    const kept = new URL(otherAddress, location.href);
    replaceAddress({
      path: HOME_TAB_PATHS[to],
      params: Object.fromEntries(kept.searchParams),
    });
  }
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    start.current =
      event.touches.length === 1 &&
      !startsOnSideways(event.target, event.currentTarget)
        ? {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY,
            time: event.timeStamp,
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
      event.timeStamp - from.time > 800
    )
      return;
    if (dx < 0 && tab === "home") switchTo("letters");
    if (dx > 0 && tab === "letters") switchTo("home");
  }
  const tabLink = (to: HomeTab, label: string) => (
    <Link
      href={to === tab ? HOME_TAB_PATHS[to] : otherAddress}
      aria-current={to === tab ? "page" : undefined}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        switchTo(to);
      }}
    >
      {label}
    </Link>
  );
  return (
    <div
      className="home-view"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => (start.current = null)}
    >
      <nav className="home-tabs" aria-label="ホームの表示">
        {tabLink("home", "書店")}
        {tabLink("letters", "タイムライン")}
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
      {tab === "letters" ? <TimelineView {...shared} /> : children}
      <ComposeFab
        {...shared}
        onPosted={() => {
          // The dialog's step comes off first; then the timeline is shown.
          if (tab !== "letters") leaveLayers(() => switchTo("letters"));
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
