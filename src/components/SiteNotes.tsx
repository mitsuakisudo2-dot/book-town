"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { createPortal, flushSync } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAccountState } from "../lib/account-session";
import { useBackLayer } from "../lib/back-layer";
import { getSupabase } from "../lib/supabase/client";
import type { Database } from "../lib/supabase/database.types";
import {
  leaveSiteNote,
  loadOpenNotes,
  setSiteNoteRemoved,
} from "../lib/supabase/site-notes";
import {
  BUILD_COMMIT,
  SITE_NOTE_LIMITS,
  anchorPath,
  boxOverlap,
  describeTarget,
  deviceLabel,
  layerTitle,
  meaningfulElement,
  noteBody,
  noteSpotAt,
  pageKey,
  pageOf,
  pinPlace,
  type Box,
  type PinAnchor,
  type PinPlace,
  type SiteNote,
  type SiteNoteSpot,
} from "../lib/site-notes";
import { forgetDraft, keepDraft, keptDraft } from "../lib/site-note-draft";
import { formatPostTime } from "../lib/social";
import type { Notify } from "../lib/types";
import "./site-notes.css";

// 注釈モード, for staff only (SiteNotesGate decides): a round 注釈 button in a
// corner; tapping it tints the page, and the next tap drops a pin there and
// opens a small sheet to write in. The notes already left on the page come
// back as numbered pins. Everything here carries data-site-notes, so it is
// never taken for part of the page it points at.

const OURS = "[data-site-notes]";
const DRAFT = "draft";
const byId = (id: string) => document.getElementById(id);

type Client = SupabaseClient<Database>;
type Phase = "aim" | "write" | "read";

/**
 * The open mode's way to hear of a note brought back with 元に戻す: the
 * toast outlives the mode it was raised in, which may have closed and
 * opened again meanwhile.
 */
const returnedNotes = new Set<(note: SiteNote) => void>();

/**
 * Where the button and the mode live: inside an open book in hand (a native
 * dialog, in the browser's top layer, which makes the rest of the page inert),
 * or else in the body. The toast and the report dialog do the same.
 */
function useLayerHost(): Element {
  const [host, setHost] = useState<Element>(
    () => document.querySelector("dialog[open]") ?? document.body,
  );
  useEffect(() => {
    const look = () =>
      setHost(document.querySelector("dialog[open]") ?? document.body);
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => watch.disconnect();
  }, []);
  return host;
}

/** The dialog on top of the page (a book in hand, a Modal), if one is open. */
function topLayer(): Element | null {
  return (
    Array.from(document.querySelectorAll('dialog[open], [role="dialog"]'))
      .filter((element) => !element.closest(OURS))
      .at(-1) ?? null
  );
}

export default function SiteNotes({ notify }: { notify: Notify }) {
  const host = useLayerHost();
  const account = useAccountState();
  const userId = account.status === "signed-in" ? account.user.id : null;
  const [on, setOn] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    if (on || !returning.current) return;
    returning.current = false;
    buttonRef.current?.focus({ preventScroll: true });
  }, [on]);
  const leave = useCallback(() => {
    returning.current = true;
    setOn(false);
  }, []);
  const client = getSupabase();
  if (!userId || !client) return null;
  return createPortal(
    on ? (
      <NotesMode
        notify={notify}
        client={client}
        userId={userId}
        textRef={textRef}
        onLeave={leave}
      />
    ) : (
      <button
        ref={buttonRef}
        type="button"
        className="site-notes-button"
        data-site-notes=""
        onClick={() => {
          flushSync(() => setOn(true));
          // A note half written here opens at its pin. iOS opens the
          // keyboard only for a focus inside the tap itself.
          textRef.current?.focus({ preventScroll: true });
        }}
      >
        注釈
      </button>
    ),
    host,
  );
}

/** What a pin's anchor found again, and what can clip it or hold it to the screen. */
type Found = { element: Element; clippers: Element[]; onScreen: boolean };

/** Finds the element a spot points at, unless the page has changed under it. */
function findAnchor(
  spot: SiteNoteSpot,
  root: Element,
  live: Element | null = null,
): Found | null {
  let element = live;
  if (!element && spot.anchor) {
    try {
      element = root.querySelector(spot.anchor);
    } catch {
      element = null;
    }
    // Another element now at the same path (a new post above shifted the
    // count) would take the pin somewhere wrong: then it is only near.
    if (
      element &&
      (element.closest(OURS) || describeTarget(element, byId) !== spot.target)
    )
      element = null;
  }
  if (!element) return null;
  const clippers: Element[] = [];
  let onScreen = false;
  for (
    let node: Element | null = element;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.position === "fixed" || style.position === "sticky")
      onScreen = true;
    if (
      node !== element &&
      (style.overflowX !== "visible" || style.overflowY !== "visible")
    )
      clippers.push(node);
    if (node === root) break;
  }
  return { element, clippers, onScreen };
}

const boxOf = (element: Element): Box => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
};

function anchorNow(found: Found): PinAnchor {
  return {
    rect: boxOf(found.element),
    onScreen: found.onScreen,
    clip: found.clippers.reduce<Box | null>(
      (seen, clipper) =>
        seen ? boxOverlap(seen, boxOf(clipper)) : boxOf(clipper),
      null,
    ),
  };
}

/**
 * The scrolling boxes under a point of the screen, nearest first: a shelf's
 * rail, a book in hand's pages, a Modal. Never the page itself, which
 * scrolls on its own.
 */
function scrollersAt(clientX: number, clientY: number): HTMLElement[] {
  const hit = document
    .elementsFromPoint(clientX, clientY)
    .find((element) => !element.closest(OURS));
  const found: HTMLElement[] = [];
  for (
    let node = hit instanceof HTMLElement ? hit : (hit?.parentElement ?? null);
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (
      (/auto|scroll|overlay/.test(style.overflowX) &&
        node.scrollWidth > node.clientWidth) ||
      (/auto|scroll|overlay/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight)
    )
      found.push(node);
  }
  return found;
}

/** Scrolls the first of `boxes` that can go by (dx, dy); that one, or null. */
function scrollFirst(
  boxes: HTMLElement[],
  dx: number,
  dy: number,
): HTMLElement | null {
  for (const box of boxes) {
    const { scrollLeft, scrollTop } = box;
    box.scrollBy({ left: dx, top: dy, behavior: "instant" });
    if (box.scrollLeft !== scrollLeft || box.scrollTop !== scrollTop)
      return box;
  }
  return null;
}

/** Where a tap landed: the element under it, in words and as a path. */
function spotAt(
  clientX: number,
  clientY: number,
  layer: Element | null,
  title: string | null,
): { spot: SiteNoteSpot; element: Element | null } {
  const hit = document
    .elementsFromPoint(clientX, clientY)
    .find((element) => !element.closest(OURS));
  // A tap beside a dialog (on its backdrop) or on its bare edge is about no
  // element of it: the dialog's title is already kept.
  const inside =
    hit &&
    hit !== layer &&
    (layer ? layer.contains(hit) : !["HTML", "BODY"].includes(hit.tagName))
      ? hit
      : null;
  const about = inside ? (meaningfulElement(inside) as Element) : null;
  const rect = about?.getBoundingClientRect();
  const share = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
  const point =
    rect && rect.width > 0 && rect.height > 0
      ? {
          x: share((clientX - rect.left) / rect.width),
          y: share((clientY - rect.top) / rect.height),
        }
      : null;
  return {
    element: about,
    spot: {
      page: pageOf(location),
      ...noteSpotAt({
        clientX,
        clientY,
        scrollX,
        scrollY,
        width: document.documentElement.clientWidth,
        height: innerHeight,
      }),
      target: about ? describeTarget(about, byId) : "",
      layer: title,
      anchor: about ? anchorPath(about, layer ?? document.body) : "",
      anchorX: point?.x ?? null,
      anchorY: point?.y ?? null,
    },
  };
}

/** The sheet or card: clear of the keyboard, on the side away from its pin. */
type SheetBox = {
  side: "top" | "bottom";
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};
type Layout = { pins: Record<string, PinPlace>; sheet: SheetBox | null };

function sheetBox(pin: PinPlace | undefined, scrolled: number): SheetBox {
  // The part of the page actually on screen: with the keyboard up, the
  // visual viewport is all that is left of it.
  const vv = window.visualViewport;
  const view: Box = vv
    ? {
        left: vv.offsetLeft,
        top: vv.offsetTop,
        width: vv.width,
        height: vv.height,
      }
    : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const narrow = matchMedia("(max-width: 760px)").matches;
  const width = Math.max(
    0,
    narrow ? view.width - 24 : Math.min(440, view.width - 24),
  );
  const pinY = pin ? (pin.fixed ? pin.top : pin.top - scrolled) : null;
  const side =
    pinY !== null && pinY - view.top > view.height * 0.45 ? "top" : "bottom";
  return {
    side,
    // A bottom sheet is moved up by its own height (translateY in the CSS).
    top: side === "top" ? view.top + 8 : view.top + view.height - 8,
    left: narrow
      ? view.left + 12
      : Math.max(view.left + 12, view.left + view.width - width - 36),
    width,
    maxHeight: Math.max(100, view.height - 16),
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
function sameLayout(a: Layout, b: Layout): boolean {
  const keys = Object.keys(b.pins);
  if (keys.length !== Object.keys(a.pins).length) return false;
  for (const key of keys) {
    const was = a.pins[key];
    const now = b.pins[key];
    if (
      !was ||
      was.fixed !== now.fixed ||
      was.why !== now.why ||
      !near(was.left, now.left) ||
      !near(was.top, now.top)
    )
      return false;
  }
  if (!a.sheet || !b.sheet) return a.sheet === b.sheet;
  return (
    a.sheet.side === b.sheet.side &&
    near(a.sheet.top, b.sheet.top) &&
    near(a.sheet.left, b.sheet.left) &&
    near(a.sheet.width, b.sheet.width) &&
    near(a.sheet.maxHeight, b.sheet.maxHeight)
  );
}

const WHY: Record<NonNullable<PinPlace["why"]>, string> = {
  hidden: "この場所はいま隠れています（棚や小窓を送ると見えます）",
  "other-size": "位置はおおよそです（別の大きさの画面で残した注釈です）",
  changed: "位置はおおよそです（残したあとで画面が変わりました）",
};
const SAVE_FAILED =
  "保存できませんでした。通信の状態を確かめて、もう一度お試しください。";
const HOURLY_LIMIT = `1時間に残せる注釈は${SITE_NOTE_LIMITS.perHour}件までです。少し時間をおいてから残してください。`;
const first = (text: string, count: number) =>
  Array.from(text).slice(0, count).join("");

function NotesMode({
  notify,
  client,
  userId,
  textRef,
  onLeave,
}: {
  notify: Notify;
  client: Client;
  userId: string;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onLeave: () => void;
}) {
  // 戻る leaves 注釈モード, one step, keeping what was written.
  useBackLayer(onLeave);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const modeRef = useRef<HTMLDivElement>(null);
  const pagePinsRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const ids = useId();
  // What the mode is over stays the same while it is on: nothing beneath
  // can open or close through the tint.
  const [over] = useState(() => {
    const layer = topLayer();
    return {
      layer,
      title: layer ? layerTitle(layer, byId) || null : null,
      key: pageKey(pageOf(location)),
    };
  });
  // A note half written on this page (and this dialog) opens at its pin;
  // one from elsewhere keeps its words for the next tap.
  const [kept] = useState(() => {
    const draft = keptDraft(userId);
    const here =
      !!draft?.spot &&
      draft.pageKey === over.key &&
      draft.spot.layer === over.title;
    return { draft, here };
  });
  const [phase, setPhase] = useState<Phase>(kept.here ? "write" : "aim");
  const [spot, setSpot] = useState<SiteNoteSpot | null>(
    kept.here ? (kept.draft?.spot ?? null) : null,
  );
  const [text, setText] = useState(kept.draft?.text ?? "");
  const [notes, setNotes] = useState<SiteNote[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [bannerAt, setBannerAt] = useState<"top" | "bottom">(() =>
    // The button's own corner: top-left over a Modal, and over a book in
    // hand on a wide screen.
    over.layer &&
    (over.layer.tagName !== "DIALOG" ||
      !matchMedia("(max-width: 760px)").matches)
      ? "top"
      : "bottom",
  );
  const [layout, setLayout] = useState<Layout>({ pins: {}, sheet: null });
  const bannerRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);

  // A note brought back while this mode is open comes back as its pin.
  useEffect(() => {
    const back = (note: SiteNote) => {
      if (pageKey(note.page) !== over.key || note.layer !== over.title) return;
      setNotes((list) =>
        [...list.filter((entry) => entry.id !== note.id), note].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      );
    };
    returnedNotes.add(back);
    return () => {
      returnedNotes.delete(back);
    };
  }, [over]);

  useEffect(() => {
    let current = true;
    loadOpenNotes(client, location.pathname).then(
      (all) => {
        if (current)
          setNotes(
            all.filter(
              (note) =>
                pageKey(note.page) === over.key && note.layer === over.title,
            ),
          );
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [client, over]);

  // Each pin's element, found once; looked for again when the page changes.
  const anchors = useRef(new Map<string, Found | null>());
  const place = useCallback(() => {
    const root = over.layer ?? document.body;
    const doc = document.documentElement;
    // The page's own height, without the pins' box in it.
    const pagePins = pagePinsRef.current;
    if (pagePins) pagePins.style.height = "0px";
    const now = {
      width: doc.clientWidth,
      height: innerHeight,
      scrollX,
      scrollY,
      pageHeight: doc.scrollHeight,
    };
    if (pagePins) pagePins.style.height = now.pageHeight + "px";
    const at = (key: string, where: SiteNoteSpot) => {
      if (!anchors.current.has(key))
        anchors.current.set(key, findAnchor(where, root));
      let found = anchors.current.get(key) ?? null;
      if (found && !found.element.isConnected) {
        found = findAnchor(where, root);
        anchors.current.set(key, found);
      }
      return pinPlace(where, now, found && anchorNow(found));
    };
    const pins: Record<string, PinPlace> = {};
    for (const note of notes) pins[note.id] = at(note.id, note);
    if (spot && phase === "write") pins[DRAFT] = at(DRAFT, spot);
    const pin =
      phase === "write"
        ? pins[DRAFT]
        : phase === "read" && reading
          ? pins[reading]
          : undefined;
    const next: Layout = {
      pins,
      sheet: phase === "aim" ? null : sheetBox(pin, now.scrollY),
    };
    setLayout((previous) => (sameLayout(previous, next) ? previous : next));
  }, [over, notes, spot, phase, reading]);
  useLayoutEffect(() => place(), [place]);

  // The banner moves out of the way of a pin under it, once: a pin hidden
  // below a book's fold waits at its bottom edge, where the banner starts.
  // Moved by hand with ↑ or ↓, it stays where it was put.
  const bannerSettled = useRef(false);
  useLayoutEffect(() => {
    const banner = bannerRef.current?.getBoundingClientRect();
    if (!banner || bannerSettled.current) return;
    const covered = Array.from(
      modeRef.current?.querySelectorAll(".site-notes-pin") ?? [],
    ).some((pin) => {
      const box = pin.getBoundingClientRect();
      return (
        box.left < banner.right &&
        banner.left < box.right &&
        box.top < banner.bottom &&
        banner.top < box.bottom
      );
    });
    if (!covered) return;
    bannerSettled.current = true;
    setBannerAt((at) => (at === "bottom" ? "top" : "bottom"));
  }, [layout, phase]);

  // Pins follow the page: scrolling (pins on sticky and fixed bars), the
  // keyboard, turning the phone, and content arriving after the mode opened.
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  }, [place]);
  useEffect(() => {
    let frame = 0;
    const later = (fresh: boolean) => () => {
      if (fresh) anchors.current.clear();
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeRef.current();
      });
    };
    const moved = later(false);
    const changed = later(true);
    // Captured, so a shelf's rail or a book's pages scrolling moves pins too.
    addEventListener("scroll", moved, { capture: true, passive: true });
    addEventListener("resize", changed);
    addEventListener("orientationchange", changed);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", moved);
    vv?.addEventListener("scroll", moved);
    const watch = new ResizeObserver(changed);
    watch.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", moved, { capture: true });
      removeEventListener("resize", changed);
      removeEventListener("orientationchange", changed);
      vv?.removeEventListener("resize", moved);
      vv?.removeEventListener("scroll", moved);
      watch.disconnect();
    };
  }, []);

  // Escape leaves only 注釈モード (before a Modal or a book in hand hears
  // it), and Tab stays inside it.
  const leaveRef = useRef(onLeave);
  useEffect(() => {
    leaveRef.current = onLeave;
  }, [onLeave]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        leaveRef.current();
        return;
      }
      if (event.key !== "Tab" || !modeRef.current) return;
      event.stopImmediatePropagation();
      const all = Array.from(
        modeRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea",
        ),
      ).filter((element) => element.tabIndex >= 0);
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at < 0) {
        event.preventDefault();
        all[0]?.focus();
      } else if (event.shiftKey && at === 0) {
        event.preventDefault();
        all.at(-1)?.focus();
      } else if (!event.shiftKey && at === all.length - 1) {
        event.preventDefault();
        all[0]?.focus();
      }
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, []);

  // The tint takes every tap, so a swipe or the wheel on it would reach only
  // the page. One over a scrolling box beneath (a shelf's rail, a book in
  // hand's pages, a Modal) is passed on to that box, so a place out of sight
  // there can be brought into view without leaving the mode.
  useEffect(() => {
    const tint = tintRef.current;
    if (!tint) return;
    let drag: {
      x: number;
      y: number;
      boxes: HTMLElement[];
      // Undecided until the first move; null once left to the browser.
      owner?: HTMLElement | null;
      // Along one way only, as the browser itself scrolls.
      across?: boolean;
      snap?: string;
    } | null = null;
    const release = () => {
      // A paged rail settles on a page again once the finger is lifted.
      if (drag?.owner && drag.snap !== undefined)
        drag.owner.style.scrollSnapType = drag.snap;
      drag = null;
    };
    const start = (event: TouchEvent) => {
      release();
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return;
      drag = {
        x: touch.clientX,
        y: touch.clientY,
        boxes: scrollersAt(touch.clientX, touch.clientY),
      };
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!drag || event.touches.length !== 1 || !touch) return release();
      const dx = drag.x - touch.clientX;
      const dy = drag.y - touch.clientY;
      drag.x = touch.clientX;
      drag.y = touch.clientY;
      if (drag.owner === null || (!dx && !dy)) return;
      if (drag.owner === undefined) {
        drag.across = Math.abs(dx) > Math.abs(dy);
        drag.owner = drag.across
          ? scrollFirst(drag.boxes, dx, 0)
          : scrollFirst(drag.boxes, 0, dy);
        if (!drag.owner) return;
        // Followed pixel by pixel, not page by page.
        drag.snap = drag.owner.style.scrollSnapType;
        drag.owner.style.scrollSnapType = "none";
      } else
        drag.owner.scrollBy({
          left: drag.across ? dx : 0,
          top: drag.across ? 0 : dy,
          behavior: "instant",
        });
      event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      if (
        scrollFirst(
          scrollersAt(event.clientX, event.clientY),
          event.deltaX * unit,
          event.deltaY * unit,
        )
      )
        event.preventDefault();
    };
    tint.addEventListener("touchstart", start, { passive: true });
    tint.addEventListener("touchmove", move, { passive: false });
    tint.addEventListener("touchend", release);
    tint.addEventListener("touchcancel", release);
    tint.addEventListener("wheel", wheel, { passive: false });
    return () => {
      release();
      tint.removeEventListener("touchstart", start);
      tint.removeEventListener("touchmove", move);
      tint.removeEventListener("touchend", release);
      tint.removeEventListener("touchcancel", release);
      tint.removeEventListener("wheel", wheel);
    };
  }, []);

  useEffect(() => {
    if (phase === "aim") stopRef.current?.focus({ preventScroll: true });
    else if (phase === "read") cardRef.current?.focus({ preventScroll: true });
    else textRef.current?.focus({ preventScroll: true });
  }, [phase, reading, textRef]);

  const write = (value: string, where = spot) => {
    setText(value);
    keepDraft({ userId, pageKey: over.key, text: value, spot: where });
  };

  function tapTint(event: MouseEvent) {
    if (phase === "write") {
      // Tapping beside the sheet puts the keyboard away; the pin stays.
      // Moving it is 場所を選び直す, on purpose.
      if (document.activeElement === textRef.current) textRef.current?.blur();
      return;
    }
    if (phase === "read") {
      setReading(null);
      setProblem(null);
      setPhase("aim");
      return;
    }
    const tapped = spotAt(event.clientX, event.clientY, over.layer, over.title);
    anchors.current.set(
      DRAFT,
      findAnchor(tapped.spot, over.layer ?? document.body, tapped.element),
    );
    flushSync(() => {
      setSpot(tapped.spot);
      setProblem(null);
      setPhase("write");
    });
    write(text, tapped.spot);
    textRef.current?.focus({ preventScroll: true });
  }

  /** やめる in the sheet: the words go, with a way back in the toast. */
  function discard() {
    const previous = keptDraft(userId);
    forgetDraft();
    if (previous)
      notify("書きかけの注釈を消しました", {
        label: "元に戻す",
        run: () => {
          keepDraft(previous);
          notify("書きかけの注釈を戻しました");
        },
      });
    onLeave();
  }

  async function save() {
    const body = noteBody(text);
    if (!body || !spot || busy) return;
    setBusy(true);
    setProblem(null);
    const saving = keptDraft(userId);
    const result = await leaveSiteNote(
      client,
      spot,
      body,
      deviceLabel(navigator.userAgent, navigator.maxTouchPoints),
      BUILD_COMMIT,
    );
    if ("note" in result) {
      // Left even if 戻る closed the mode meanwhile; a newer draft stays.
      if (keptDraft(userId) === saving) forgetDraft();
      notify("注釈を残しました");
      if (alive.current) onLeave();
      return;
    }
    if (!alive.current) return;
    setBusy(false);
    setProblem(result.failure === "limit" ? HOURLY_LIMIT : SAVE_FAILED);
  }

  async function takeBack(note: SiteNote) {
    setBusy(true);
    setProblem(null);
    const done = await setSiteNoteRemoved(client, note.id, true);
    if (alive.current) setBusy(false);
    if (!done) {
      if (alive.current)
        setProblem("取り下げられませんでした。もう一度お試しください。");
      return;
    }
    if (alive.current) {
      setNotes((list) => list.filter((entry) => entry.id !== note.id));
      setReading(null);
      setPhase("aim");
    }
    notify("注釈を取り下げました", {
      label: "元に戻す",
      run: async () => {
        if (!(await setSiteNoteRemoved(client, note.id, false))) {
          notify("戻せませんでした。もう一度お試しください。");
          return;
        }
        returnedNotes.forEach((back) => back(note));
        notify("注釈を戻しました");
      },
    });
  }

  // Drawn unseen until its place is worked out (before the first paint),
  // but focusable all along: the textarea within the tap itself, the card as
  // soon as it opens.
  const sheetStyle = (sheet: SheetBox | null) =>
    sheet
      ? {
          top: sheet.top,
          left: sheet.left,
          width: sheet.width,
          maxHeight: sheet.maxHeight,
        }
      : { opacity: 0 };
  const pinOf = (note: SiteNote, index: number) => {
    const at = layout.pins[note.id];
    if (!at) return null;
    return (
      <button
        key={note.id}
        type="button"
        className={
          "site-notes-pin" +
          (at.fixed ? " is-fixed" : "") +
          (at.why ? " is-approximate" : "") +
          (reading === note.id ? " is-reading" : "")
        }
        style={{ left: at.left, top: at.top }}
        aria-label={`注釈${index + 1}「${first(note.body, 20)}」`}
        tabIndex={phase === "write" ? -1 : undefined}
        onClick={() => {
          setProblem(null);
          setReading(note.id);
          setPhase("read");
        }}
      >
        {index + 1}
      </button>
    );
  };
  const draft = phase === "write" ? layout.pins[DRAFT] : undefined;
  const draftPin = draft && (
    <span
      className={
        "site-notes-pin is-draft" +
        (draft.fixed ? " is-fixed" : "") +
        (draft.why ? " is-approximate" : "")
      }
      style={{ left: draft.left, top: draft.top }}
      aria-hidden="true"
    />
  );
  const readIndex = notes.findIndex((note) => note.id === reading);
  const read = readIndex >= 0 ? notes[readIndex] : null;
  const readWhy = read ? layout.pins[read.id]?.why : null;
  const placed = (note: SiteNote) => layout.pins[note.id];

  return (
    <div
      ref={modeRef}
      className="site-notes-mode"
      data-site-notes=""
      data-phase={phase}
      data-over={over.layer ? "layer" : "page"}
      role="dialog"
      aria-modal="true"
      aria-label="注釈モード"
    >
      <div
        ref={tintRef}
        className="site-notes-tint"
        onClick={tapTint}
        aria-hidden="true"
      />
      {!over.layer && (
        <div className="site-notes-page-pins" ref={pagePinsRef}>
          {notes.map((note, index) =>
            placed(note) && !placed(note).fixed ? pinOf(note, index) : null,
          )}
          {draft && !draft.fixed && draftPin}
        </div>
      )}
      <div className="site-notes-screen-pins">
        {notes.map((note, index) =>
          placed(note)?.fixed ? pinOf(note, index) : null,
        )}
        {draft?.fixed && draftPin}
      </div>
      {phase === "aim" && (
        <div ref={bannerRef} className="site-notes-banner" data-at={bannerAt}>
          <p>
            <span>メモしたい場所を</span>
            <span>タップしてください</span>
            {loadFailed && (
              <span className="site-notes-banner-note">
                これまでの注釈を読み込めませんでした
              </span>
            )}
          </p>
          <button
            ref={stopRef}
            type="button"
            className="site-notes-quiet"
            onClick={onLeave}
          >
            やめる
          </button>
          <button
            type="button"
            className="site-notes-move"
            aria-label={
              bannerAt === "bottom" ? "案内を上へ動かす" : "案内を下へ動かす"
            }
            onClick={() => {
              bannerSettled.current = true;
              setBannerAt((at) => (at === "bottom" ? "top" : "bottom"));
            }}
          >
            <span aria-hidden="true">{bannerAt === "bottom" ? "↑" : "↓"}</span>
          </button>
        </div>
      )}
      {phase === "write" && spot && (
        <form
          className="site-notes-sheet"
          data-side={layout.sheet?.side ?? "bottom"}
          style={sheetStyle(layout.sheet)}
          aria-labelledby={ids + "-write"}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* The buttons first: they stay in sight however little room the keyboard leaves. */}
          <div className="site-notes-head">
            <h2 id={ids + "-write"}>注釈を残す</h2>
            <button
              type="submit"
              className="site-notes-primary"
              disabled={!noteBody(text) || busy}
            >
              {busy ? "残しています…" : "残す"}
            </button>
            <button
              type="button"
              className="site-notes-quiet"
              onClick={discard}
            >
              やめる
            </button>
          </div>
          <div className="site-notes-where">
            <p>
              {spot.target || "この場所"}
              {spot.layer && `　小窓「${spot.layer}」の中`}
            </p>
            <button
              type="button"
              className="site-notes-text-button"
              onClick={() => {
                setProblem(null);
                setPhase("aim");
              }}
            >
              場所を選び直す
            </button>
          </div>
          {kept.draft && <p className="site-notes-kept">書きかけの注釈です</p>}
          <label className="site-notes-label" htmlFor={ids + "-text"}>
            注釈
          </label>
          <textarea
            id={ids + "-text"}
            ref={textRef}
            className="site-notes-field"
            value={text}
            onChange={(event) => write(event.target.value)}
            maxLength={SITE_NOTE_LIMITS.body}
            rows={4}
            placeholder="直してほしいこと、気になったことを書いてください"
          />
          {text.length >= SITE_NOTE_LIMITS.body && (
            <p className="site-notes-limit">
              {SITE_NOTE_LIMITS.body}文字までです
            </p>
          )}
          {problem && (
            <p className="site-notes-problem" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}
      {phase === "read" && read && (
        <section
          ref={cardRef}
          className="site-notes-card"
          data-side={layout.sheet?.side ?? "bottom"}
          style={sheetStyle(layout.sheet)}
          tabIndex={-1}
          aria-labelledby={ids + "-read"}
        >
          <h2 id={ids + "-read"}>注釈{readIndex + 1}</h2>
          <p className="site-notes-card-body">{read.body}</p>
          <p className="site-notes-card-meta">
            {formatPostTime(read.createdAt)} に残しました
            {read.device && "・" + read.device}
          </p>
          {readWhy && <p className="site-notes-card-why">{WHY[readWhy]}</p>}
          {problem && (
            <p className="site-notes-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="site-notes-card-actions">
            <button
              type="button"
              className="site-notes-quiet"
              disabled={busy}
              onClick={() => void takeBack(read)}
            >
              取り下げる
            </button>
            <button
              type="button"
              className="site-notes-primary"
              onClick={() => {
                setReading(null);
                setProblem(null);
                setPhase("aim");
              }}
            >
              閉じる
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
