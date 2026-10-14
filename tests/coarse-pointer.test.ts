import assert from "node:assert/strict";
import {
  COARSE_POINTER,
  coarsePointer,
  fieldTakesFocus,
  focusBack,
  focusField,
  KEYBOARD_MIN_HEIGHT,
  keyboardRoom,
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
type Fake = HTMLInputElement & {
  did: string[];
  typed(): void;
  blurred(): void;
};
function page() {
  const state: { focused: unknown } = { focused: null };
  const element = (
    tagName: string,
    {
      type,
      editable = false,
      dialog = null,
      writing = null,
      form = null,
    }: {
      type?: string;
      editable?: boolean;
      dialog?: Fake | null;
      /** The writing screen around it (data-writing). */
      writing?: Fake | null;
      form?: Fake | null;
    } = {},
  ): Fake => {
    const did: string[] = [];
    const attributes = new Map<string, string>();
    const listeners = new Map<string, (() => void)[]>();
    const fire = (type: string) => {
      const now = listeners.get(type) ?? [];
      listeners.delete(type);
      now.forEach((listener) => listener());
    };
    const fake = {
      did,
      tagName,
      type,
      form,
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
      closest: (selector: string) =>
        selector === "[data-writing]" ? writing : dialog,
      querySelector: () => null as Fake | null,
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      removeAttribute(name: string) {
        attributes.delete(name);
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      hasAttribute: (name: string) => attributes.has(name),
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      // The reader changes the field.
      typed: () => fire("input"),
      // The focus leaves the element.
      blurred: () => fire("blur"),
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
  // Outside any dialog (a draft thrown away on a page), the field's form
  // holds the focus, so it is not dropped to the top of the page. The form
  // takes the focus only while it holds it: a tap between its controls
  // later does not land on it.
  const form = element("FORM");
  const memo = element("TEXTAREA", { form });
  focusField(memo, { view: phone() });
  assert.equal(state.focused, form);
  assert.deepEqual(form.did, ["focus quietly"]);
  assert.deepEqual(memo.did, ["into view nearest"]);
  assert.equal(form.getAttribute("tabindex"), "-1");
  form.blurred();
  assert.equal(form.getAttribute("tabindex"), null);
  // A form that takes the focus of its own keeps it as it was.
  const own = element("FORM");
  own.setAttribute("tabindex", "0");
  focusField(element("INPUT", { form: own }), { view: phone() });
  assert.equal(state.focused, own);
  own.blurred();
  assert.equal(own.getAttribute("tabindex"), "0");
  // With a mouse the field takes the focus, and the form is left alone.
  const signForm = element("FORM");
  const name = element("INPUT", { form: signForm });
  focusField(name, { view: desk() });
  assert.equal(state.focused, name);
  assert.equal(signForm.getAttribute("tabindex"), null);
  // Outside any dialog or form, the focus is not moved.
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
  // A writing screen (a post, a review) opens to be written in: there a
  // field takes the focus with a finger too, and the keyboard rises with
  // it: a book's search after ［本を添える］, the text box after a draft is
  // thrown away, the words covered by ［隠す］.
  const { state, element } = page();
  const sheet = element("DIV");
  const close = element("BUTTON");
  sheet.querySelector = (() => close) as Fake["querySelector"];
  const search = element("INPUT", {
    type: "search",
    dialog: sheet,
    writing: sheet,
  });
  assert.equal(focusField(search, { view: phone() }), true);
  assert.equal(state.focused, search);
  assert.deepEqual(search.did, ["focus"]);
  assert.deepEqual(close.did, []);
  const text = element("TEXTAREA", { dialog: sheet, writing: sheet });
  assert.equal(focusField(text, { instead: null, view: phone() }), true);
  assert.equal(state.focused, text);
  // Outside one, the same field waits for a tap (the dialog's 閉じる).
  const plain = element("INPUT", { type: "search", dialog: sheet });
  assert.equal(focusField(plain, { view: phone() }), false);
  assert.equal(state.focused, close);
  assert.deepEqual(plain.did, ["into view nearest"]);
  // A field found wrong there is focused and selected as typing goes on.
  const wrong = element("TEXTAREA", { writing: sheet });
  markField(wrong, { select: true, view: phone() });
  assert.equal(state.focused, wrong);
  assert.deepEqual(wrong.did, ["focus", "select"]);
  // A layer closing over it gives the focus back to its field.
  const back = element("TEXTAREA", { writing: sheet });
  assert.equal(focusBack(back, undefined, phone()), true);
  assert.equal(state.focused, back);
}

{
  // The reader asked for this one field in this tap (［ISBNを打つ］): it
  // takes the focus with a finger too, outside any writing screen.
  const { state, element } = page();
  const close = element("BUTTON");
  const field = element("INPUT");
  assert.equal(
    focusField(field, { asked: true, instead: close, view: phone() }),
    true,
  );
  assert.equal(state.focused, field);
  assert.deepEqual(close.did, []);
  const quiet = element("INPUT");
  focusField(quiet, { asked: true, preventScroll: true, view: phone() });
  assert.deepEqual(quiet.did, ["focus quietly"]);
  // Not asked, the same field waits for its tap.
  const waits = element("INPUT");
  assert.equal(focusField(waits, { instead: close, view: phone() }), false);
  assert.equal(state.focused, close);
}

{
  // What the keyboard leaves of the screen (visualViewport against the
  // page's height), for a writing screen to sit in.
  assert.equal(keyboardRoom(null, 793), null);
  assert.equal(keyboardRoom(undefined, 793), null);
  // Zoomed in, the visible part is small for another reason: not known.
  assert.equal(
    keyboardRoom({ height: 400, offsetTop: 0, scale: 1.5 }, 793),
    null,
  );
  // No keyboard: the whole screen.
  assert.deepEqual(keyboardRoom({ height: 793, offsetTop: 0, scale: 1 }, 793), {
    top: 0,
    height: 793,
    up: false,
  });
  // A keyboard of 336px, the page scrolled 120px up by the browser.
  assert.deepEqual(
    keyboardRoom({ height: 457, offsetTop: 120, scale: 1 }, 793),
    { top: 120, height: 457, up: true },
  );
  // iOS 26 reports a gap of about 24px with no keyboard up.
  assert.equal(
    keyboardRoom({ height: 769, offsetTop: 0, scale: 1 }, 793)?.up,
    false,
  );
  assert.equal(
    keyboardRoom(
      { height: 793 - KEYBOARD_MIN_HEIGHT - 1, offsetTop: 0, scale: 1 },
      793,
    )?.up,
    true,
  );
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
