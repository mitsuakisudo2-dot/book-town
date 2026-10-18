// Errors that happen on a reader's screen. The site is static, so an error on
// a phone reached no one (AUD-032). ErrorWatch (src/components/ErrorWatch.tsx)
// hears them and sends each one, with what could name a reader taken out, to
// the hosted Supabase (`report_screen_error`, docs/09 「画面のエラーの記録」).
// The morning watch counts them (scripts/watch.mjs).
//
// What is kept: the kind, the error's words with names, addresses, numbers,
// quoted words and IDs taken out, the page's path without its query, a few
// script positions of our own, the build, and the kind of browser. Never who
// the reader is, what they wrote, or a book's title.

import { deviceLabel } from "./site-notes";

/** How many reports one page may send before it stops. */
export const REPORTS_PER_PAGE = 5;

export const MESSAGE_LENGTH = 300;
export const PLACE_LENGTH = 200;
export const STACK_LENGTH = 600;

export type ErrorKind = "error" | "rejection";

export interface ScreenError {
  kind: ErrorKind;
  message: string;
  place: string;
  stack: string;
  build: string;
  device: string;
}

/**
 * The words of an error with what could name a reader taken out: quoted words
 * (a title, a shop's name, what was typed), email addresses, the query of an
 * address, IDs, long numbers (an ISBN) and anything that looks like a key.
 */
export function scrubText(text: string, length = MESSAGE_LENGTH): string {
  return (
    String(text)
      // Keys and tokens before anything else touches their dots.
      .replace(/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, "***")
      .replace(/\b(sb|sbp|re|vcp)_[\w-]{8,}/g, "***")
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "(email)")
      // An address keeps its origin and path; its query and hash may hold
      // what the reader searched for.
      .replace(/(https?:\/\/[^\s?#"'<>)]+)[?#][^\s"'<>)]*/g, "$1")
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        "(id)",
      )
      .replace(/「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'|“[^”]*”/g, "(…)")
      // A database's "Key (name)=(value)" names what a reader saved.
      .replace(/=\([^)]*\)/g, "=(…)")
      .replace(/\d{5,}/g, "(n)")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, length)
  );
}

/**
 * The page as a path: no query or hash (they hold searches, IDs and the
 * screen's small choices), and a segment that looks like an ID collapsed.
 */
export function pagePlace(pathname: string): string {
  const path = String(pathname).split(/[?#]/)[0] || "/";
  return path
    .split("/")
    .map((segment) =>
      /^[0-9a-f-]{16,}$/i.test(segment) || /\d{5,}/.test(segment)
        ? "(id)"
        : segment,
    )
    .join("/")
    .slice(0, PLACE_LENGTH);
}

/**
 * The script positions of an error that are the site's own, as
 * `chunk.js:line:column`. Scripts of an extension or another site are left
 * out: they are not ours to fix, and their addresses can be anything.
 */
export function stackFrames(stack: string | undefined, origin: string): string {
  if (!stack) return "";
  const frames: string[] = [];
  for (const match of String(stack).matchAll(
    /(https?:\/\/[^\s)]+?):(\d+):(\d+)/g,
  )) {
    const [, url, line, column] = match;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;
    const file = parsed.pathname.split("/").pop() || parsed.pathname;
    frames.push(`${file}:${line}:${column}`);
    if (frames.length === 5) break;
  }
  return frames.join(" ").slice(0, STACK_LENGTH);
}

/** What a thrown value says, whatever was thrown. */
function wordsOf(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error)
    return { message: `${value.name}: ${value.message}`, stack: value.stack };
  if (typeof value === "string") return { message: value };
  // Supabase answers with a plain object that has a message.
  if (value && typeof value === "object" && "message" in value)
    return { message: String((value as { message: unknown }).message) };
  return { message: Object.prototype.toString.call(value) };
}

export function screenError(
  kind: ErrorKind,
  value: unknown,
  where: {
    pathname: string;
    origin: string;
    userAgent: string;
    touchPoints: number;
    build: string;
  },
): ScreenError {
  const { message, stack } = wordsOf(value);
  return {
    kind,
    message: scrubText(message) || "(no message)",
    place: pagePlace(where.pathname),
    stack: stackFrames(stack, where.origin),
    build: String(where.build).slice(0, 40),
    device: deviceLabel(where.userAgent, where.touchPoints),
  };
}

/**
 * An error worth sending: not "Script error." from another site's script (the
 * browser hides its words), and not an extension's.
 */
export function worthSending(error: ScreenError, filename?: string): boolean {
  if (/^Script error\.?$/i.test(error.message)) return false;
  if (filename && /^(chrome|moz|safari)(-web)?-extension:/.test(filename))
    return false;
  return true;
}

/**
 * Lets the same error through once and at most REPORTS_PER_PAGE in all, so a
 * loop that throws on every frame sends a few rows, not thousands.
 */
export function reportGate(limit = REPORTS_PER_PAGE) {
  const seen = new Set<string>();
  return (error: ScreenError): boolean => {
    const key = `${error.kind} ${error.message} ${error.place}`;
    if (seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  };
}

/**
 * The first script in the head: keeps the errors that happen before React
 * starts, at most a few, in `window.__screenErrors`. ErrorWatch sends them
 * once it has started, then sets the list to null and listens itself.
 */
export const ERROR_BOOT = `try{var w=window;w.__screenErrors=[];function k(r){var q=w.__screenErrors;if(q&&q.length<${REPORTS_PER_PAGE})q.push(r)}addEventListener("error",function(e){if(e.error!==undefined)k(["error",e.error||e.message,e.filename])});addEventListener("unhandledrejection",function(e){k(["rejection",e.reason])})}catch(e){}`;
