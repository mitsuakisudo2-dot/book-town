"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

// Where the reader points with a finger, a text field given the focus raises
// the keyboard, and the keyboard covers whatever has just opened or appeared:
// a sheet, a page, a step, a mode. So there nothing that opens or shows puts
// the focus in a field, or selects its words. The reader looks at what is
// there and taps the field when ready; the focus still goes into what opened
// (its first button, or a heading) for whoever moves by keys or a screen
// reader. A field the reader tapped is theirs as usual. With a mouse or a
// trackpad a field is made ready to type into, as before. Screens use these
// helpers in place of autoFocus or a bare focus() on a field.
//
// Writing screens are the one exception (Modal's `writing`, marked
// data-writing: a post, a review, words for a shop's owner). They open to
// be written in, so there the keyboard rises with them and stays up, and any
// field in them may take the focus.

/**
 * Whether the reader's main pointer is a finger. On a touch screen a text
 * field given the focus raises the keyboard, and the keyboard covers what has
 * just opened. A laptop with a touch screen still points with its trackpad.
 */
export const COARSE_POINTER = "(pointer: coarse)";

type Media = {
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
  };
};

export function coarsePointer(view: Media = globalThis): boolean {
  return view.matchMedia?.(COARSE_POINTER).matches ?? false;
}

/** coarsePointer for a render: false on the server, then the browser's. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = globalThis.matchMedia?.(COARSE_POINTER);
      query?.addEventListener?.("change", changed);
      return () => query?.removeEventListener?.("change", changed);
    },
    () => coarsePointer(),
    () => false,
  );
}

/**
 * Whether a field may take the focus without the reader's tap on it: only
 * where the main pointer is not a finger.
 */
export function fieldTakesFocus(view: Media = globalThis): boolean {
  return !coarsePointer(view);
}

/** The kinds of input that raise no keyboard. */
const KEYLESS_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether the element takes typed text, so that its focus raises a touch
 * keyboard: a text box, a text field of any kind (search, email, numbers),
 * or anything editable. A select, a check box or a button does not.
 */
export function takesText(element: unknown): boolean {
  if (!element || typeof element !== "object") return false;
  const { tagName, type, isContentEditable } = element as {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
  };
  if (isContentEditable) return true;
  const tag = tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !KEYLESS_INPUTS.has((type || "text").toLowerCase());
}

/** The field has the focus already: the reader's own, from a tap or a key. */
const theirs = (field: HTMLElement) =>
  field.ownerDocument?.activeElement === field;

/** A field inside a writing screen: the keyboard belongs up there. */
const inWritingScreen = (field: HTMLElement) =>
  Boolean(field.closest?.("[data-writing]"));

/**
 * Whether a field may take the focus now without a tap of its own: the
 * reader's already, in a writing screen, away from a finger, or one that
 * raises no keyboard.
 */
const mayFocus = (field: HTMLElement, view: Media) =>
  theirs(field) ||
  inWritingScreen(field) ||
  fieldTakesFocus(view) ||
  !takesText(field);

/**
 * Where the focus goes in place of a field, with a finger and nothing named:
 * the first button of the dialog around it (閉じる), or else the field's
 * form. A form takes the focus only for as long as it holds it, so a tap
 * between its controls later does not land on it.
 */
function standIn(field: HTMLElement): HTMLElement | null {
  const button = field
    .closest?.('[role="dialog"], dialog')
    ?.querySelector<HTMLElement>("button");
  if (button) return button;
  const form = (field as { form?: HTMLFormElement | null }).form;
  if (!form) return null;
  if (!form.hasAttribute("tabindex")) {
    form.setAttribute("tabindex", "-1");
    form.addEventListener("blur", () => form.removeAttribute("tabindex"), {
      once: true,
    });
  }
  return form;
}

/**
 * Hands a field to the reader as something opens or appears with it, or as a
 * step leads to it. With a mouse the field takes the focus. With a finger it
 * is brought into view and waits for a tap; the focus goes to `instead` (a
 * button or a heading by the field; by default the first button of the
 * dialog around it, or the field's form outside a dialog; null to leave the
 * focus where it is). A field the reader is typing in stays theirs either
 * way, and a field in a writing screen takes the focus on any screen.
 * Returns whether the field has the focus.
 */
export function focusField(
  field: HTMLElement | null | undefined,
  {
    instead,
    preventScroll = false,
    asked = false,
    view = globalThis,
  }: {
    instead?: HTMLElement | null;
    /** The screen keeps the field in view itself. */
    preventScroll?: boolean;
    /**
     * The reader asked for this one field in this very tap (a button whose
     * only job is to start typing in it, such as ［ISBNを打つ］): it takes
     * the focus on any screen, and the keyboard rises with it. Called inside
     * the tap, with the field already rendered (flushSync), since a phone
     * raises its keyboard only for a focus within the tap itself.
     */
    asked?: boolean;
    view?: Media;
  } = {},
): boolean {
  if (!field) return false;
  if (asked || mayFocus(field, view)) {
    field.focus(preventScroll ? { preventScroll } : undefined);
    return true;
  }
  if (!preventScroll) field.scrollIntoView?.({ block: "nearest" });
  const next = instead === undefined ? standIn(field) : instead;
  next?.focus({ preventScroll: true });
  return false;
}

/**
 * focusField as the field first shows, in place of autoFocus (which would
 * raise the keyboard on a touch screen). `when` holds it back until the field
 * is meant to be ready; a ref for `instead` names where the focus goes with a
 * finger.
 */
export function useFocusFieldOnShow(
  field: RefObject<HTMLElement | null>,
  {
    instead,
    when = true,
  }: { instead?: RefObject<HTMLElement | null>; when?: boolean } = {},
): void {
  useEffect(() => {
    if (when)
      focusField(field.current, {
        instead: instead ? instead.current : undefined,
      });
  }, [field, instead, when]);
}

/**
 * Points to a field a submit or a check found wrong: it is marked invalid
 * until it is changed. With a mouse it also takes the focus (its words
 * selected when `select`, so typing starts again), as the browser's own check
 * does. With a finger the keyboard would rise over the reason given, so the
 * field is only brought into view. A field the reader is typing in stays
 * theirs, and is selected all the same, as is one in a writing screen; a
 * check box takes the focus anyway.
 */
export function markField(
  field: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  {
    select = false,
    view = globalThis,
  }: { select?: boolean; view?: Media } = {},
): void {
  if (!field) return;
  field.setAttribute("aria-invalid", "true");
  field.addEventListener("input", () => field.removeAttribute("aria-invalid"), {
    once: true,
  });
  if (mayFocus(field, view)) {
    field.focus();
    if (select && takesText(field)) field.select();
    return;
  }
  field.scrollIntoView?.({ block: "center" });
}

/**
 * Gives the focus back where it was before a layer opened (a sheet, the
 * scanner, a book in hand). With a finger a field does not take it back: on
 * iOS a tapped button does not take the focus, so what had it before can be
 * a field the reader typed in, and its keyboard would rise as the layer
 * closes. A field in a writing screen does: the keyboard belongs up there.
 * Returns whether the focus went back.
 */
export function focusBack(
  element: HTMLElement | null | undefined,
  options?: FocusOptions,
  view: Media = globalThis,
): boolean {
  if (
    !element ||
    (takesText(element) && !inWritingScreen(element) && !fieldTakesFocus(view))
  )
    return false;
  element.focus(options);
  return true;
}

/**
 * The fewest pixels the visible screen falls short of the page for the
 * keyboard to count as up: iOS 26 reports a gap of about 24px with none.
 */
export const KEYBOARD_MIN_HEIGHT = 100;

/**
 * What the keyboard leaves of the screen, from the visual viewport: where
 * it begins, how tall it is, and whether a keyboard is up. Null when it is
 * not known or the reader has zoomed in; a writing screen then keeps the
 * whole screen.
 */
export function keyboardRoom(
  viewport:
    { height: number; offsetTop: number; scale: number } | null | undefined,
  layoutHeight: number,
): { top: number; height: number; up: boolean } | null {
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01) return null;
  return {
    top: viewport.offsetTop,
    height: viewport.height,
    up: layoutHeight - viewport.height > KEYBOARD_MIN_HEIGHT,
  };
}
