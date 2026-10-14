import assert from "node:assert/strict";
import {
  COARSE_POINTER,
  coarsePointer,
  fieldTakesFocus,
  focusBack,
  focusField,
  markField,
  takesText,
} from "../src/lib/coarse-pointer";

/** A browser whose media queries match only `matching`. */
const screen = (...matching: string[]) => {
  const asked: string[] = [];
  return {
    asked,
    matchMedia: (query: string) => {
      asked.push(query);
      return { matches: matching.includes(query) };
    },
  };
};
const phone = () => screen(COARSE_POINTER);
const desk = () => screen("(pointer: fine)");

/**
 * A stand-in for an element on a page: what it was asked to do is noted in
 * `did`, and `state.focused` is the element with the focus.
 */
type Fake = HTMLInputElement & { did: string[]; typed(): void };
function page() {
  const state: { focused: unknown } = { focused: null };
  const element = (
    tagName: string,
    {
      type,
      editable = false,
      dialog = null,
    }: { type?: string; editable?: boolean; dialog?: Fake | null } = {},
  ): Fake => {
    const did: string[] = [];
    const attributes = new Map<string, string>();
    const listeners: (() => void)[] = [];
    const fake = {
      did,
      tagName,
      type,
      isContentEditable: editable,
      ownerDocument: {
        get activeElement() {
          return state.focused;
        },
      },
      focus(options?: FocusOptions) {
        did.push(options?.preventScroll ? "focus quietly" : "focus");
        state.focused = fake;
      },
      select() {
        did.push("select");
      },
      scrollIntoView({ block }: ScrollIntoViewOptions) {
        did.push("into view " + block);
      },
      closest: () => dialog,
      querySelector: () => null as Fake | null,
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      removeAttribute(name: string) {
        attributes.delete(name);
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      addEventListener(_: string, listener: () => void) {
        listeners.push(listener);
      },
      // The reader changes the field.
      typed: () => listeners.splice(0).forEach((listener) => listener()),
    };
    return fake as unknown as Fake;
  };
  return { state, element };
}

{
  // A phone or a tablet: the finger is the main pointer.
  const touch = phone();
  assert.equal(coarsePointer(touch), true);
  // The main pointer is asked about, not any pointer the device has.
  assert.deepEqual(touch.asked, ["(pointer: coarse)"]);
  // A laptop whose screen also takes touch still points with its trackpad.
  assert.equal(coarsePointer(screen("(any-pointer: coarse)")), false);
  assert.equal(coarsePointer(desk()), false);
  // Where nothing can be asked (the server, a test), no keyboard is assumed.
  assert.equal(coarsePointer({}), false);
  assert.equal(coarsePointer(), false);
}

{
  // A field takes the focus without a tap only away from a finger, on every
  // screen alike (a sheet, a page, a step, a mode).
  assert.equal(fieldTakesFocus(phone()), false);
  assert.equal(fieldTakesFocus(desk()), true);
  assert.equal(fieldTakesFocus(screen("(any-pointer: coarse)")), true);
  assert.equal(fieldTakesFocus({}), true);
}

{
  // What raises a keyboard: text of any kind, a text box, anything editable.
  const { element } = page();
  for (const type of [
    undefined,
    "",
    "text",
    "search",
    "email",
    "tel",
    "url",
    "number",
    "password",
    "SEARCH",
  ])
    assert.equal(takesText(element("INPUT", { type })), true, String(type));
  assert.equal(takesText(element("textarea")), true);
  assert.equal(takesText(element("DIV", { editable: true })), true);
  // What does not: buttons, choices, a select, the page itself.
  for (const type of ["checkbox", "radio", "button", "submit", "range"])
    assert.equal(takesText(element("INPUT", { type })), false, type);
  assert.equal(takesText(element("SELECT")), false);
  assert.equal(takesText(element("BUTTON")), false);
  assert.equal(takesText(element("H2")), false);
  assert.equal(takesText(element("BODY")), false);
  assert.equal(takesText(null), false);
  assert.equal(takesText(undefined), false);
  assert.equal(takesText("input"), false);
}

{
  // With a mouse, a field shown is ready to type into.
  const { state, element } = page();
  const field = element("INPUT");
  assert.equal(focusField(field, { view: desk() }), true);
  assert.equal(state.focused, field);
  assert.deepEqual(field.did, ["focus"]);
  // Kept where the screen put it, when the screen scrolls itself.
  const quiet = element("TEXTAREA");
  focusField(quiet, { preventScroll: true, view: desk() });
  assert.deepEqual(quiet.did, ["focus quietly"]);
  assert.equal(focusField(null, { view: desk() }), false);
}

{
  // With a finger, the field is brought into view and left for a tap; the
  // focus goes to the button or heading named instead.
  const { state, element } = page();
  const close = element("BUTTON");
  const field = element("INPUT", { type: "search" });
  assert.equal(focusField(field, { instead: close, view: phone() }), false);
  assert.notEqual(state.focused, field);
  assert.equal(state.focused, close);
  assert.deepEqual(field.did, ["into view nearest"]);
  assert.deepEqual(close.did, ["focus quietly"]);
  // A screen that keeps the field in view itself is not scrolled.
  const kept = element("TEXTAREA");
  focusField(kept, { instead: close, preventScroll: true, view: phone() });
  assert.deepEqual(kept.did, []);
  // Told to leave the focus alone, it stays where it is.
  const there = element("BUTTON");
  there.focus();
  focusField(element("TEXTAREA"), { instead: null, view: phone() });
  assert.equal(state.focused, there);
}

{
  // With a finger and nothing named, the focus goes to the first button of
  // the dialog around the field (閉じる), never into the field.
  const { state, element } = page();
  const close = element("BUTTON");
  const dialog = element("DIV");
  dialog.querySelector = (() => close) as Fake["querySelector"];
  const field = element("INPUT", { dialog });
  focusField(field, { view: phone() });
  assert.equal(state.focused, close);
  // Outside any dialog, the focus is not moved.
  const loose = element("INPUT");
  const before = element("BUTTON");
  before.focus();
  focusField(loose, { view: phone() });
  assert.equal(state.focused, before);
}

{
  // A field the reader is typing in stays theirs on a phone too.
  const { state, element } = page();
  const field = element("TEXTAREA");
  field.focus();
  field.did.length = 0;
  assert.equal(focusField(field, { instead: null, view: phone() }), true);
  assert.equal(state.focused, field);
  // Something that takes no text is focused on any screen.
  const tab = element("BUTTON");
  assert.equal(focusField(tab, { view: phone() }), true);
  assert.equal(state.focused, tab);
}

{
  // A field found wrong after a submit: with a mouse, marked, focused and
  // selected so typing starts again, as the browser's own check does.
  const { state, element } = page();
  const field = element("INPUT");
  markField(field, { select: true, view: desk() });
  assert.equal(state.focused, field);
  assert.deepEqual(field.did, ["focus", "select"]);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  field.typed();
  assert.equal(field.getAttribute("aria-invalid"), null);
}

{
  // With a finger: brought into view and marked, not focused or selected;
  // the mark goes as soon as the reader changes the field.
  const { state, element } = page();
  const field = element("INPUT", { type: "email" });
  markField(field, { select: true, view: phone() });
  assert.equal(state.focused, null);
  assert.deepEqual(field.did, ["into view center"]);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  field.typed();
  assert.equal(field.getAttribute("aria-invalid"), null);
  // Where the reader is typing already, the words are selected there.
  const typing = element("INPUT");
  typing.focus();
  typing.did.length = 0;
  markField(typing, { select: true, view: phone() });
  assert.deepEqual(typing.did, ["focus", "select"]);
  assert.equal(typing.getAttribute("aria-invalid"), "true");
  // A check box raises no keyboard: it takes the focus, and is not selected.
  const box = element("INPUT", { type: "checkbox" });
  markField(box, { select: true, view: phone() });
  assert.equal(state.focused, box);
  assert.deepEqual(box.did, ["focus"]);
  assert.equal(box.getAttribute("aria-invalid"), "true");
  markField(null, { view: phone() });
}

{
  // Closing a layer gives the focus back to what had it, but on a phone
  // never to a field: its keyboard would rise as the layer closes.
  const { state, element } = page();
  const opener = element("BUTTON");
  assert.equal(focusBack(opener, { preventScroll: true }, phone()), true);
  assert.equal(state.focused, opener);
  assert.deepEqual(opener.did, ["focus quietly"]);
  const field = element("INPUT");
  assert.equal(focusBack(field, undefined, phone()), false);
  assert.equal(state.focused, opener);
  assert.deepEqual(field.did, []);
  // With a mouse, a field had it before and takes it back.
  assert.equal(focusBack(field, undefined, desk()), true);
  assert.equal(state.focused, field);
  assert.equal(focusBack(null, undefined, desk()), false);
}

console.log("coarse-pointer ok");
