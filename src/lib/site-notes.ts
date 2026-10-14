// 注釈モード: the words and places a staff member's note keeps, worked out
// from the page without touching it. Nothing here reads the DOM itself: the
// screen hands in the elements it found (or plain objects, in the tests).

import { iosDevice } from "./ios-device";

/** The same limits as public.site_notes (tests check them against the migration). */
export const SITE_NOTE_LIMITS = {
  body: 2000,
  page: 500,
  target: 300,
  layer: 120,
  anchor: 500,
  device: 40,
  perHour: 60,
  /** The largest place across and down the page, and the largest window, in CSS pixels. */
  x: 100_000,
  y: 10_000_000,
  viewport: 20_000,
} as const;

/** A deployed commit as the database keeps it, or null. */
export const commitOf = (sha: string | undefined): string | null =>
  sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;

/** The deployed commit, when Vercel gave it to the build; null otherwise. */
// Read by its full name, so Next writes the value into the page at build time.
export const BUILD_COMMIT = commitOf(
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
);

/** Where a tap was: what the database keeps besides the words. */
export interface SiteNoteSpot {
  page: string;
  /** The tap in the page's CSS pixels, scrolling included. */
  x: number;
  y: number;
  viewportW: number;
  viewportH: number;
  scrollY: number;
  /** What was under the finger, in words. */
  target: string;
  /** The open dialog's title; null on the page. */
  layer: string | null;
  /** A CSS path to the element under the finger; "" when there was none. */
  anchor: string;
  /** Where on that element (0 to 1 across and down); both or neither. */
  anchorX: number | null;
  anchorY: number | null;
}

export interface SiteNote extends SiteNoteSpot {
  id: string;
  body: string;
  device: string;
  createdAt: string;
}

// The query values the app itself reads. Anything else in the address (a
// link from LINE or Instagram brings fbclid, utm_… and the like) is dropped.
const APP_PARAMS = new Set([
  "id",
  "book",
  "q",
  "page",
  "show",
  "lane",
  "rounds",
  "feeling",
  "books",
]);

/**
 * The page as a note keeps it: the path and the query the app reads, and on
 * the walk the shop in view (#id). Any other part after # is never kept: a
 * sign-in link's keys arrive there, and the street keeps what was typed there.
 */
export function pageOf(place: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const kept = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(place.search))
    if (APP_PARAMS.has(name)) kept.append(name, value);
  const query = kept.toString();
  const hash =
    place.pathname === "/walk/" && /^#[\w%.-]{1,80}$/.test(place.hash)
      ? place.hash
      : "";
  return (place.pathname + (query ? "?" + query : "") + hash).slice(
    0,
    SITE_NOTE_LIMITS.page,
  );
}

/** Which notes share pins: the same path, the same ?id=, and on the walk the same shop. */
export function pageKey(page: string): string {
  const url = new URL(page, "https://booktown.invalid");
  const id = url.searchParams.get("id");
  return (
    url.pathname +
    (id ? "?id=" + encodeURIComponent(id) : "") +
    (url.pathname === "/walk/" ? url.hash : "")
  );
}

/** The text as the database will keep it, or null when there is nothing to keep or too much. */
export function noteBody(text: string): string | null {
  const body = text.trim();
  return body && [...body].length <= SITE_NOTE_LIMITS.body ? body : null;
}

const whole = (value: number, max: number) =>
  Math.min(max, Math.max(0, Math.round(value)));

/** The tap in page coordinates, rounded and never negative (iOS bounces past the top). */
export function noteSpotAt(tap: {
  clientX: number;
  clientY: number;
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}): Pick<SiteNoteSpot, "x" | "y" | "viewportW" | "viewportH" | "scrollY"> {
  const { x, y, viewport } = SITE_NOTE_LIMITS;
  return {
    x: whole(tap.clientX + Math.max(0, tap.scrollX), x),
    y: whole(tap.clientY + Math.max(0, tap.scrollY), y),
    viewportW: Math.max(1, whole(tap.width, viewport)),
    viewportH: Math.max(1, whole(tap.height, viewport)),
    scrollY: whole(tap.scrollY, y),
  };
}

/** A short label such as "iPhone Safari"; never versions or the user agent itself. */
export function deviceLabel(userAgent: string, touchPoints = 0): string {
  const ua = userAgent;
  const system = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : iosDevice(ua, touchPoints)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /\bLine\//.test(ua)
    ? "LINE"
    : /Instagram/.test(ua)
      ? "Instagram"
      : /FBAN|FBAV|FB_IAB/.test(ua)
        ? "Facebook"
        : /EdgiOS|EdgA|Edg\//.test(ua)
          ? "Edge"
          : /OPR\/|OPiOS/.test(ua)
            ? "Opera"
            : /SamsungBrowser/.test(ua)
              ? "Samsung Internet"
              : /FxiOS|Firefox\//.test(ua)
                ? "Firefox"
                : /; wv\)/.test(ua)
                  ? "アプリ内"
                  : /CriOS|Chrome\//.test(ua)
                    ? "Chrome"
                    : /Version\/[\d.]+.*Safari\//.test(ua)
                      ? "Safari"
                      : system === "iPhone" || system === "iPad"
                        ? "アプリ内"
                        : "";
  return [system, browser]
    .filter(Boolean)
    .join(" ")
    .slice(0, SITE_NOTE_LIMITS.device);
}

/** A text, element or other node, as an element's childNodes holds it. */
export interface NoteNode {
  /** 1 for an element, 3 for text. */
  nodeType: number;
  textContent: string | null;
}

/** The few parts of a DOM element the descriptions read; tests pass plain objects. */
export interface NoteElement extends NoteNode {
  /** "BUTTON" for HTML, "path" for SVG: always lower-cased before use. */
  tagName: string;
  /** Classes are read with getAttribute("class"): an SVG's className is not a string. */
  getAttribute(name: string): string | null;
  parentElement: NoteElement | null;
  children: ArrayLike<NoteElement>;
  childNodes: ArrayLike<NoteNode>;
}
export type FindById = (id: string) => NoteElement | null;

const tagOf = (element: NoteElement) => element.tagName.toLowerCase();
const roleOf = (element: NoteElement) => element.getAttribute("role") ?? "";
const INTERACTIVE = new Set([
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "label",
]);
const INTERACTIVE_ROLE =
  /^(button|link|tab|checkbox|radio|switch|menuitem|option)$/;
const isInteractive = (element: NoteElement) =>
  INTERACTIVE.has(tagOf(element)) || INTERACTIVE_ROLE.test(roleOf(element));
const isLayer = (element: NoteElement) =>
  tagOf(element) === "dialog" || roleOf(element) === "dialog";
const isHeading = (element: NoteElement) =>
  /^h[1-3]$/.test(tagOf(element)) || roleOf(element) === "heading";

/**
 * Up to `count` steps up from `element`, itself first, stopping below a
 * dialog: a dialog is what a note is left in (its own column), never what
 * it is about.
 */
function upwards(element: NoteElement, count: number): NoteElement[] {
  const line: NoteElement[] = [];
  for (
    let node: NoteElement | null = element;
    node &&
    line.length <= count &&
    (node === element ||
      (!isLayer(node) && !["body", "html"].includes(tagOf(node))));
    node = node.parentElement
  )
    line.push(node);
  return line;
}

/** What a description is about: the button or link around an icon, not the icon. */
export function meaningfulElement(hit: NoteElement): NoteElement {
  const near = upwards(hit, 4);
  const interactive = near.find(isInteractive);
  if (interactive) return interactive;
  const labelled = near
    .slice(0, 3)
    .find((node) => node.getAttribute("aria-label"));
  if (labelled) return labelled;
  // Out of a drawing (an icon's path, its svg) to the element that holds it.
  for (let node: NoteElement | null = hit; node; node = node.parentElement)
    if (tagOf(node) === "svg")
      return node.parentElement && !isLayer(node.parentElement)
        ? node.parentElement
        : hit;
  return hit;
}

const squeeze = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

/** At most `max` characters (code points), the last one 「…」 when cut. */
function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
}

/** The first `max` characters, never splitting one in two. */
const upTo = (text: string, max: number) => [...text].slice(0, max).join("");

/**
 * The words in a node, as textContent has them, but never what was typed
 * into a field. An input has no text; a textarea does, because React writes
 * its value in as the default, so a textarea's words are left out wherever
 * it sits (inside a label, say).
 */
function textOf(node: NoteNode): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as NoteElement;
  if (tagOf(element) === "textarea") return "";
  return Array.from(element.childNodes, textOf).join("");
}

function labelledBy(element: NoteElement, byId?: FindById): string {
  const ids = squeeze(element.getAttribute("aria-labelledby"));
  if (!ids || !byId) return "";
  return squeeze(
    ids
      .split(" ")
      .map((id) => {
        const label = byId(id);
        return label ? textOf(label) : "";
      })
      .join(" "),
  );
}

/**
 * A box of several parts (a book's hero, a card) tapped on its blank space:
 * all its words would only crowd out where it was, so the heading before it
 * says that alone. A paragraph keeps its words, links and all.
 */
const isRoomy = (element: NoteElement) =>
  !wordOf(element) &&
  tagOf(element) !== "p" &&
  element.children.length > 1 &&
  [...squeeze(element.textContent)].length > 40;

function nameOf(element: NoteElement, byId?: FindById): string {
  const tag = tagOf(element);
  return (
    [
      element.getAttribute("aria-label"),
      labelledBy(element, byId),
      tag === "img" ? element.getAttribute("alt") : null,
      tag === "input" || tag === "textarea"
        ? element.getAttribute("placeholder")
        : null,
      element.getAttribute("title"),
      isRoomy(element) ? null : textOf(element),
    ]
      .map(squeeze)
      .find(Boolean) ?? ""
  );
}

function wordOf(element: NoteElement): string {
  const tag = tagOf(element);
  const role = roleOf(element);
  if (tag === "button" || role === "button") return "ボタン";
  if (tag === "a" || role === "link") return "リンク";
  if (tag === "input" || tag === "textarea") return "入力欄";
  if (tag === "select") return "選択欄";
  if (tag === "img") return "画像";
  if (/^h[1-6]$/.test(tag)) return "見出し";
  if (tag === "label") return "ラベル";
  if (tag === "summary") return "開閉";
  if (role === "tab") return "タブ";
  return "";
}

/** Elements inside `element` in reverse document order, the deepest last ones first. */
function* backwards(element: NoteElement): Generator<NoteElement> {
  for (let i = element.children.length - 1; i >= 0; i--) {
    yield* backwards(element.children[i]);
    yield element.children[i];
  }
}

/** What comes before `child` inside `parent`, nearest first, then `parent` itself. */
function* before(parent: NoteElement, child: NoteElement) {
  const siblings = Array.from(parent.children);
  for (let i = siblings.indexOf(child) - 1; i >= 0; i--) {
    yield* backwards(siblings[i]);
    yield siblings[i];
  }
  yield parent;
}

/**
 * The nearest heading before `element` in the page, looking no further than
 * six levels up and never past a dialog (its title has a column of its own).
 */
function headingBefore(element: NoteElement, skip: string): string {
  let node = element;
  let looked = 0;
  for (let level = 0; level < 6; level++) {
    const parent = node.parentElement;
    if (!parent || isLayer(parent) || ["body", "html"].includes(tagOf(parent)))
      return "";
    for (const candidate of before(parent, node)) {
      if (++looked > 400) return "";
      if (!isHeading(candidate)) continue;
      const text = squeeze(textOf(candidate));
      if (text && text !== skip) return text;
    }
    node = parent;
  }
  return "";
}

/** ボタン「好き」 / 見出し「軌道書房」: what was tapped, and under which heading. */
export function describeTarget(element: NoteElement, byId?: FindById): string {
  const word = wordOf(element);
  const name = nameOf(element, byId);
  const what = name ? `${word}「${clip(name, 60)}」` : word;
  const heading = /^h[1-6]$/.test(tagOf(element))
    ? ""
    : headingBefore(element, name);
  return upTo(
    [what, heading && `見出し「${clip(heading, 40)}」`]
      .filter(Boolean)
      .join(" / "),
    SITE_NOTE_LIMITS.target,
  );
}

/** A dialog's title: aria-label, then aria-labelledby, then its first heading; "" if none. */
export function layerTitle(layer: NoteElement, byId?: FindById): string {
  let title =
    squeeze(layer.getAttribute("aria-label")) || labelledBy(layer, byId);
  if (!title) {
    let looked = 0;
    const first = (node: NoteElement): string => {
      for (const child of Array.from(node.children)) {
        if (++looked > 200) return "";
        if (/^h[1-6]$/.test(tagOf(child)) || roleOf(child) === "heading")
          return squeeze(textOf(child));
        const found = first(child);
        if (found) return found;
      }
      return "";
    };
    title = first(layer);
  }
  return clip(title, SITE_NOTE_LIMITS.layer);
}

const STATE_CLASSES = new Set([
  "active",
  "open",
  "selected",
  "current",
  "hidden",
  "visible",
  "pressed",
  "loading",
  "disabled",
  "checked",
  "held",
]);
const LANDMARKS = new Set([
  "main",
  "header",
  "nav",
  "aside",
  "footer",
  "dialog",
]);

/** A CSS path from just below `root` to `element`, at most 500 characters. */
export function anchorPath(
  element: NoteElement,
  root: NoteElement | null,
): string {
  const steps: string[] = [];
  for (
    let node: NoteElement | null = element;
    node && node !== root && !["body", "html"].includes(tagOf(node));
    node = node.parentElement
  ) {
    const tag = tagOf(node);
    const id = node.getAttribute("id") ?? "";
    if (/^[A-Za-z][\w-]*$/.test(id)) {
      steps.unshift("#" + id);
      break;
    }
    const classes = (node.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(
        (name) =>
          /^[A-Za-z_][\w-]*$/.test(name) &&
          !/^(is|has)-/.test(name) &&
          !STATE_CLASSES.has(name),
      )
      .slice(0, 2);
    let step = [tag, ...classes].join(".");
    const parent = node.parentElement;
    if (parent) {
      // 注釈モード's own parts, placed last in a dialog, are not counted.
      const same = Array.from(parent.children).filter(
        (child) =>
          tagOf(child) === tag &&
          child.getAttribute("data-site-notes") === null,
      );
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    steps.unshift(step);
    if (LANDMARKS.has(tag) || isLayer(node) || steps.length >= 8) break;
  }
  while (steps.join(" > ").length > SITE_NOTE_LIMITS.anchor) steps.shift();
  return steps.join(" > ");
}

/** A box in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The element a note's anchor found again, as it stands now. */
export interface PinAnchor {
  /** Its box, in viewport pixels. */
  rect: Box;
  /** It is on something fixed or sticky to the screen, so its pin is too. */
  onScreen: boolean;
  /** What its scrolling ancestors (a shelf's rail, a dialog's body) let be seen, in viewport pixels. */
  clip: Box | null;
}

export interface PinPlace {
  left: number;
  top: number;
  /** Fixed to the screen; otherwise placed in the page and scrolled with it. */
  fixed: boolean;
  /**
   * Why the pin is only near its place: the spot is scrolled out of sight
   * within a shelf or a dialog, the note was left on a screen of another
   * size, or the page has changed since. Null when it is exact.
   */
  why: "hidden" | "other-size" | "changed" | null;
}

/** Half a pin's 44px hit area: a pin never reaches past the screen's edge. */
export const PIN_REACH = 22;

const within = (value: number, low: number, high: number) =>
  high < low ? (low + high) / 2 : Math.min(high, Math.max(low, value));

/** The part two boxes share (empty when they do not meet). */
export const boxOverlap = (a: Box, b: Box): Box => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(0, Math.min(a.left + a.width, b.left + b.width) - left),
    height: Math.max(0, Math.min(a.top + a.height, b.top + b.height) - top),
  };
};

/** Where a note's pin goes now, and how sure that place is. */
export function pinPlace(
  note: Pick<
    SiteNoteSpot,
    "x" | "y" | "viewportW" | "scrollY" | "layer" | "anchorX" | "anchorY"
  >,
  now: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    pageHeight: number;
  },
  anchor: PinAnchor | null,
): PinPlace {
  const screen: Box = { left: 0, top: 0, width: now.width, height: now.height };
  // Kept inside the screen across, and down the page (or the screen, when fixed).
  const settle = (left: number, top: number, fixed: boolean) => ({
    left: within(left, PIN_REACH, now.width - PIN_REACH),
    top: within(
      top,
      PIN_REACH,
      (fixed ? now.height : now.pageHeight) - PIN_REACH,
    ),
    fixed,
  });
  if (anchor) {
    const { rect } = anchor;
    let x = rect.left + (note.anchorX ?? 0.5) * rect.width;
    let y = rect.top + (note.anchorY ?? 0.5) * rect.height;
    const fixed = note.layer !== null || anchor.onScreen;
    const seen = anchor.clip
      ? fixed
        ? boxOverlap(anchor.clip, screen)
        : anchor.clip
      : fixed
        ? screen
        : null;
    let why: PinPlace["why"] = null;
    if (
      seen &&
      (x < seen.left ||
        x > seen.left + seen.width ||
        y < seen.top ||
        y > seen.top + seen.height)
    ) {
      why = "hidden";
      x = within(x, seen.left + PIN_REACH, seen.left + seen.width - PIN_REACH);
      y = within(y, seen.top + PIN_REACH, seen.top + seen.height - PIN_REACH);
    }
    return fixed
      ? { ...settle(x, y, true), why }
      : { ...settle(x + now.scrollX, y + now.scrollY, false), why };
  }
  const sameWidth = Math.abs(note.viewportW - now.width) <= 2;
  const left = sameWidth ? note.x : (note.x * now.width) / note.viewportW;
  const why = sameWidth ? "changed" : "other-size";
  return note.layer !== null
    ? { ...settle(left, note.y - note.scrollY, true), why }
    : { ...settle(left, note.y, false), why };
}
