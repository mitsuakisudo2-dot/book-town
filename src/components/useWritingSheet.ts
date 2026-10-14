"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { coarsePointer, keyboardRoom, takesText } from "../lib/coarse-pointer";

// A writing screen (Modal's `writing`) works as a phone's own writing apps
// do: it opens with its text box ready and the keyboard up, the keyboard
// stays up while the reader writes, and its buttons sit just above it.
//
// - A press with a finger on anything that is not a field (a button, a
//   chip, a check box's label, the title, blank space) does not take the
//   focus: the field keeps it, so the keyboard stays, and the tap still
//   does what it does. Where the field it was in went away (a book picked
//   unmounts its search), the text box takes the focus back in the tap.
// - With no field focused (the keyboard put away), a tap on blank space
//   brings the text box and its keyboard back.
// - A select, a file to choose ([data-may-blur]), and the question before a
//   draft is thrown away (.kept-note) behave as anywhere: they may close the
//   keyboard. So does any press while a kana conversion is open, which ends
//   it; the text box takes the focus back as the tap ends.
// - With a finger the screen is as tall as what the keyboard leaves
//   (--vv-top and --vv-height on the root, from visualViewport, and
//   data-keyboard="up"): globals.css docks its toolbar on the keyboard.
// - With a mouse nothing changes.

/** Presses on these behave as anywhere: they may take the focus. */
const OWN_FOCUS = [
  "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable=false])",
  "[data-may-blur]",
  ".kept-note",
].join(", ");
/** What a tap works on; a tap anywhere else is on blank space. */
const CONTROL = [
  "button",
  "a[href]",
  "label",
  "input",
  "textarea",
  "select",
  "summary",
  "[role=button]",
  "[role=switch]",
  "[role=checkbox]",
  "[tabindex]",
  "[contenteditable]",
].join(", ");

/** The writing screen's text box: its first. */
export const writingField = (sheet: ParentNode | null | undefined) =>
  sheet?.querySelector<HTMLTextAreaElement>("textarea") ?? null;

/** The text box made ready to go on writing: the caret after its words. */
export function focusWritingField(field: HTMLTextAreaElement) {
  field.focus({ preventScroll: true });
  field.setSelectionRange(field.value.length, field.value.length);
}

/** A check box or a choice, which a tap on its label would focus. */
const choiceOf = (target: Element) => {
  const control = target.closest("label")?.control;
  return control instanceof HTMLInputElement &&
    (control.type === "checkbox" || control.type === "radio") &&
    control !== target &&
    !control.disabled
    ? control
    : null;
};

/**
 * Makes `sheet` a writing screen while `on`: returns the handlers to spread
 * on it (none when off).
 */
export function useWritingSheet(
  sheet: RefObject<HTMLElement | null>,
  on: boolean,
): {
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
} {
  // How the last press began: in a field ("typing") or with none ("idle");
  // null where it was left to the browser.
  const press = useRef<"typing" | "idle" | null>(null);
  const composing = useRef(false);
  useEffect(() => {
    const element = sheet.current;
    if (!on || !element) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const { scrollX: x, scrollY: y } = window;
    const typing = () => {
      const active = document.activeElement;
      return takesText(active) && element.contains(active);
    };
    const clear = () => {
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-height");
      delete root.dataset.keyboard;
    };
    // With no field focused there is no keyboard: the whole screen. That
    // also covers a phone that reports the old size after its keyboard
    // closed (iOS 26.0).
    const fit = () => {
      const room =
        coarsePointer() && typing()
          ? keyboardRoom(viewport, window.innerHeight)
          : null;
      if (!room) return clear();
      root.style.setProperty("--vv-top", room.top + "px");
      root.style.setProperty("--vv-height", room.height + "px");
      if (room.up) root.dataset.keyboard = "up";
      else delete root.dataset.keyboard;
    };
    // Measured again once the focus has settled: some phones report the
    // keyboard's size or the page's offset late.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(fit);
      });
    };
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    element.addEventListener("focusin", fit);
    element.addEventListener("focusout", later);
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      element.removeEventListener("focusin", fit);
      element.removeEventListener("focusout", later);
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
      cancelAnimationFrame(frame);
      clear();
      // A phone may have moved the page to show the field.
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    };
  }, [on, sheet]);
  if (!on) return {};
  return {
    onPointerDown(event) {
      press.current = null;
      const element = sheet.current;
      const target = event.target;
      if (
        !element ||
        event.pointerType === "mouse" ||
        !event.isPrimary ||
        !(target instanceof Element) ||
        target.closest(OWN_FOCUS)
      )
        return;
      const active = document.activeElement;
      const typing = takesText(active) && element.contains(active);
      press.current = typing ? "typing" : "idle";
      // A kana conversion still open: this press ends it as the field
      // blurs, and the click brings the field back.
      if (typing && composing.current) return;
      event.preventDefault();
    },
    onClick(event) {
      const was = press.current;
      press.current = null;
      const element = sheet.current;
      const target = event.target;
      if (!was || !element || !(target instanceof Element)) return;
      const field = writingField(element);
      // A check box's label would give the box the focus: the box is
      // toggled here instead, and the focus stays.
      const choice = choiceOf(target);
      if (choice) {
        event.preventDefault();
        choice.click();
      }
      if (was === "typing")
        // After this tap's own render, which was asked for first.
        queueMicrotask(() => {
          const active = document.activeElement;
          if (
            field?.isConnected &&
            !(takesText(active) && element.contains(active)) &&
            !active?.closest(".kept-note, [data-may-blur]")
          )
            field.focus({ preventScroll: true });
        });
      // Blank space brings the text box back, and its keyboard.
      else if (!target.closest(CONTROL)) field?.focus({ preventScroll: true });
    },
  };
}
