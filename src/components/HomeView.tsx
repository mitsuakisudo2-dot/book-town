"use client";

import {
  Activity,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import type { Notify, TownActions, TownState } from "../lib/types";
import { ComposeFab } from "./Social";
import { leaveLayers } from "../lib/back-layer";
import { replaceAddress, useAddressPath } from "../lib/url-state";
import {
  HOME_SEEN,
  HOME_TAB_PATHS,
  loadHomeTab,
  onHomeTop,
  openingTab,
  saveHomeTab,
  tabOfPath,
  type HomeTab,
} from "../lib/home-tab";
import { HomeTabs, paneId, tabId } from "./home/HomeTabs";
import { HomePane } from "./home/HomePane";
import { LettersOnly } from "./home/LettersOnly";
import { motion } from "./home/hooks";
import "./home/home.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/** Each tab's page title, as its address's static page names it. */
const TITLES: Record<HomeTab, string> = {
  home: "Book Town | 本を読みたくなるSNS",
  letters: "便りだけ | Book Town",
};

const toTop = () => window.scrollTo({ top: 0, behavior: motion() });

/** A swipe starting this near either edge belongs to the browser (back). */
const EDGE = 24;

/**
 * A swipe that starts on something that scrolls sideways (a shelf, the
 * carousel, a 特集's rail) belongs to that element; one in a dialog or in
 * 注釈モード, to them. Only swipes that start elsewhere switch the tabs.
 */
function startsOnSideways(
  target: EventTarget | null,
  root: Element,
  x: number,
): boolean {
  let element = target instanceof Element ? target : null;
  if (
    !element ||
    !root.contains(element) ||
    x < EDGE ||
    x > innerWidth - EDGE ||
    document.querySelector(".modal-backdrop, .site-notes-mode") ||
    // Dialogs (an open book, the compose sheet) handle their own gestures,
    // even through portals.
    element.closest(
      'dialog, [role="dialog"], [aria-modal="true"], input, textarea, select, .street-shelf, .wooden-shelf, .shelf-scroll, .home-carousel-track, .home-rail',
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

/**
 * Home: ホーム and 便りだけ, two panes under one row of tabs. The tab is the
 * address's (`/` or `/timeline/`, rewritten in place: no step of 戻る), each
 * pane keeps where it was scrolled to, and 便りだけ is made on its first
 * visit, then kept.
 */
export function HomeView({
  tab: routeTab,
  ...shared
}: Shared & { tab: HomeTab }) {
  // The tab is the address's: a switch rewrites `/` ↔ `/timeline/` in place,
  // so 戻る to this address, or a reload, opens the same tab. While a page of
  // another address is drawn over Home, the tab shown last stays.
  const path = useAddressPath(HOME_TAB_PATHS[routeTab]);
  const [shownTab, setShownTab] = useState<HomeTab>(routeTab);
  const tab = tabOfPath(path) ?? shownTab;
  if (tab !== shownTab) setShownTab(tab);
  // A pane is made the first time it is shown, then kept.
  const [mounted, setMounted] = useState<ReadonlySet<HomeTab>>(
    () => new Set([routeTab]),
  );
  if (!mounted.has(tab)) setMounted(new Set([...mounted, tab]));
  // A tap on the tab shown (or ホーム) asks each pane for what is new.
  const [refresh, setRefresh] = useState<Record<HomeTab, number>>({
    home: 0,
    letters: 0,
  });
  const tabRef = useRef(tab);
  const panes = useRef<Partial<Record<HomeTab, HTMLDivElement | null>>>({});
  const view = useRef<HTMLDivElement>(null);
  const bar = useRef<{ reset: () => void } | null>(null);
  // A fresh `/` opens on the tab shown last; the entry is marked as opened,
  // so 戻る and a reload come back to the tab its address names.
  useLayoutEffect(() => {
    const seen = Boolean(
      (history.state as Record<string, unknown> | null)?.[HOME_SEEN],
    );
    const path = location.pathname;
    const named = tabOfPath(path);
    if (!named) return;
    const opening = openingTab(path, seen, loadHomeTab());
    if (!seen)
      try {
        history.replaceState({ ...history.state, [HOME_SEEN]: true }, "");
      } catch {
        // Unmarked, a reload opens on the kept tab: the one shown anyway.
      }
    if (opening && opening !== named)
      replaceAddress({ path: HOME_TAB_PATHS[opening] });
  }, []);
  // The tab shown is kept for the next fresh `/`, and said on <html> for CSS
  // (as the layout's boot script did before React), and in the title.
  useLayoutEffect(() => {
    tabRef.current = tab;
    saveHomeTab(tab);
    document.documentElement.dataset.homeTab = tab;
    document.title = TITLES[tab];
  }, [tab]);
  useEffect(
    () => () => void delete document.documentElement.dataset.homeTab,
    [],
  );
  // Each tab keeps where it was scrolled to, for coming back to it,
  const scrolls = useRef<Partial<Record<HomeTab, number>>>({});
  // and the rest of its address (how far it was walked: `rounds`).
  const searches = useRef<Partial<Record<HomeTab, string>>>({});
  const switched = useRef<{ to: HomeTab; top: number } | null>(null);
  useLayoutEffect(() => {
    const change = switched.current;
    if (!change || change.to !== tab) return;
    switched.current = null;
    window.scrollTo({ top: change.top, behavior: "instant" });
    bar.current?.reset();
    // The pane comes in from the side it was swiped from (v37: 40px, .28s).
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      panes.current[tab]?.animate(
        [
          {
            transform: `translateX(${tab === "letters" ? 40 : -40}px)`,
            opacity: 0.3,
          },
          { transform: "none", opacity: 1 },
        ],
        { duration: 280, easing: "cubic-bezier(.2,0,0,1)" },
      );
  }, [tab]);
  /** The pane shown goes to its top, and draws what came since. */
  const renew = (which: HomeTab) => {
    toTop();
    setRefresh((counts) => ({ ...counts, [which]: counts[which] + 1 }));
  };
  // ホーム at the bottom (or the brand) while on Home: the same as the tab.
  useEffect(
    () =>
      onHomeTop(() => {
        toTop();
        const which = tabRef.current;
        setRefresh((counts) => ({ ...counts, [which]: counts[which] + 1 }));
      }),
    [],
  );
  /** Shows `to` in place: no step of 戻る. The tab already open renews. */
  function switchTo(to: HomeTab) {
    if (to === tab) return renew(tab);
    scrolls.current[tab] = window.scrollY;
    searches.current[tab] = location.search;
    switched.current = { to, top: scrolls.current[to] ?? 0 };
    replaceAddress({
      path: HOME_TAB_PATHS[to],
      params: Object.fromEntries(
        new URLSearchParams(searches.current[to] ?? ""),
      ),
    });
  }
  // On a phone the bars slide away while reading down, and come back on
  // the way up (v37): more than 6px down past the first 80px, any 6px up.
  useEffect(() => {
    const shell = view.current?.closest<HTMLElement>(".town-shell");
    if (!shell) return;
    const phone = matchMedia("(max-width: 760px)");
    let anchor = window.scrollY;
    let hidden = false;
    // Whether a layer held the page still since the last scroll read.
    let held = false;
    const hide = (next: boolean) => {
      if (hidden === next) return;
      hidden = next;
      if (next) shell.dataset.bar = "hidden";
      else delete shell.dataset.bar;
    };
    const onScroll = () => {
      const y = window.scrollY;
      if (!phone.matches) {
        anchor = y;
        return;
      }
      // A 便り's page or a book in hand holds the page still beneath it (the
      // body fixed, the window at 0): no scroll of the reader's, so nothing
      // to read. Let go, the page goes back where it was; that is no scroll
      // of theirs either, so the bars stay as they were, from there.
      if (document.body.style.position === "fixed") {
        held = true;
        return;
      }
      if (held) {
        held = false;
        anchor = y;
        return;
      }
      if (y > anchor + 6) {
        if (y > 80) hide(true);
        anchor = y;
      } else if (y < anchor - 6) {
        hide(false);
        anchor = y;
      }
    };
    bar.current = {
      reset: () => {
        anchor = window.scrollY;
        hide(false);
      },
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      hide(false);
      bar.current = null;
    };
  }, []);
  // Today's swipe (≥ 70px, ≥ 1.8×|dy|, < 800ms), now switching in place.
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    start.current =
      event.touches.length === 1 &&
      !startsOnSideways(event.target, event.currentTarget, touch.clientX)
        ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp }
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
  const pane = (which: HomeTab) =>
    mounted.has(which) && (
      <Activity mode={tab === which ? "visible" : "hidden"}>
        <div
          ref={(element) => {
            panes.current[which] = element;
          }}
          role="tabpanel"
          id={paneId(which)}
          aria-labelledby={tabId(which)}
          className="home-pane"
          data-pane={which}
        >
          {which === "home" ? (
            <HomePane
              {...shared}
              shown={tab === "home"}
              refresh={refresh.home}
              onLetters={() => switchTo("letters")}
            />
          ) : (
            <LettersOnly
              {...shared}
              shown={tab === "letters"}
              refresh={refresh.letters}
              onHome={() => switchTo("home")}
            />
          )}
        </div>
      </Activity>
    );
  return (
    <div
      ref={view}
      className="home-view"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => (start.current = null)}
    >
      <HomeTabs tab={tab} mounted={mounted} onSelect={switchTo} />
      {pane("home")}
      {pane("letters")}
      <ComposeFab
        {...shared}
        // Your own 便り comes in at the top of the pane shown, and glows.
        onPosted={() => leaveLayers(toTop)}
      />
    </div>
  );
}
