import { expect } from "@playwright/test";

// On a touch screen a text field that takes the focus raises the keyboard
// over whatever has just opened (src/lib/coarse-pointer.ts). Nothing that
// opens or shows does that: the focus goes into what opened, never into a
// field, and no field's words are selected. The reader taps a field to
// write. With a mouse the field is ready to type into, as before.

/** Whether the page's main pointer is a finger. */
export const coarse = (page) =>
  page.evaluate(() => matchMedia("(pointer: coarse)").matches);

/**
 * Fails when the focus is in a field that takes text, or any field's words
 * are selected: what would put a phone's keyboard up. `inside`, a locator,
 * also asks that the focus be within it (the dialog that opened).
 */
export async function expectNoKeyboard(page, label, inside) {
  const now = await page.evaluate(() => {
    const keyless = [
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
    ];
    const takesText = (element) =>
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        !keyless.includes(element.type)) ||
      Boolean(element?.isContentEditable);
    const active = document.activeElement;
    const selected = [...document.querySelectorAll("input, textarea")]
      .filter((field) => {
        try {
          return field.selectionStart !== field.selectionEnd;
        } catch {
          return false;
        }
      })
      .map((field) => field.outerHTML.slice(0, 80));
    return {
      typing: takesText(active),
      active: active?.outerHTML.slice(0, 80) ?? "nothing",
      selected,
    };
  });
  expect(now.typing, `${label}: the focus is in a field (${now.active})`).toBe(
    false,
  );
  expect(now.selected, `${label}: a field's words are selected`).toEqual([]);
  if (inside)
    expect(
      await inside.evaluate((element) =>
        element.contains(document.activeElement),
      ),
      `${label}: the focus is in what opened (${now.active})`,
    ).toBe(true);
}

/** A tap on the field gives it the focus, as the reader's own. */
export async function expectTapWrites(field) {
  await field.tap();
  await expect(field).toBeFocused();
}

// Writing screens (a post, a review, words for a shop's owner) are the one
// exception: they open with the text box focused, and the keyboard stays up
// while the reader writes (src/components/useWritingSheet.ts). Headless
// Chromium shows no keyboard, so a check asks what would raise one on a
// phone: a text field focused within the tap itself (iOS raises it for no
// other focus), and the sheet's buttons above a keyboard stood in for by
// fakeKeyboard.

/**
 * Notes every focus() with whether it ran within a tap: from a touchend or
 * a click until the task ends, and not in an animation frame (which can
 * come before that task is marked over, but a phone counts it as after the
 * tap). Installed before the context's first page.
 */
export const watchFocus = (context) =>
  context.addInitScript(() => {
    let inTap = false;
    let inFrame = false;
    for (const type of ["touchend", "click"])
      addEventListener(
        type,
        () => {
          inTap = true;
          setTimeout(() => {
            inTap = false;
          });
        },
        true,
      );
    const frame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      frame.call(window, (time) => {
        inFrame = true;
        try {
          callback(time);
        } finally {
          inFrame = false;
        }
      });
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      (window.__focusLog ??= []).push({
        tag: this.tagName,
        inTap: inTap && !inFrame,
      });
      return focus.apply(this, args);
    };
  });

/** Whether the last focus() of a `tag` ran within a tap (watchFocus). */
export const lastFocusInTap = (page, tag = "TEXTAREA") =>
  page.evaluate(
    (tag) =>
      window.__focusLog?.findLast((entry) => entry.tag === tag)?.inTap ?? null,
    tag,
  );

/** Forgets the focus() calls noted so far (watchFocus). */
export const forgetFocus = (page) =>
  page.evaluate(() => {
    window.__focusLog = [];
  });

/**
 * Stands in a keyboard for visualViewport: `__keyboard(height, offsetTop)`
 * in the page puts one up, `__keyboard(0)` puts it away. Otherwise the real
 * values and events pass through. Installed before the context's first page
 * (page.setContent would drop its listeners).
 */
export const fakeKeyboard = (context) =>
  context.addInitScript(() => {
    const real = window.visualViewport;
    if (!real) return;
    const fake = new EventTarget();
    let keyboard = null;
    for (const key of ["width", "offsetLeft", "pageLeft", "scale"])
      Object.defineProperty(fake, key, { get: () => real[key] });
    Object.defineProperty(fake, "height", {
      get: () => (keyboard ? innerHeight - keyboard.height : real.height),
    });
    Object.defineProperty(fake, "offsetTop", {
      get: () => (keyboard ? keyboard.top : real.offsetTop),
    });
    Object.defineProperty(fake, "pageTop", {
      get: () => scrollY + fake.offsetTop,
    });
    for (const type of ["resize", "scroll"])
      real.addEventListener(type, () => fake.dispatchEvent(new Event(type)));
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get: () => fake,
    });
    window.__keyboard = (height, top = 0) => {
      keyboard = height ? { height, top } : null;
      fake.dispatchEvent(new Event("resize"));
      fake.dispatchEvent(new Event("scroll"));
    };
  });

/**
 * Fails unless `field` has the focus, given within the last tap: on a phone
 * the keyboard is up with it.
 */
export async function expectKeyboardUp(page, field, label) {
  await expect(field, `${label}: the text box has the focus`).toBeFocused();
  const tag = await field.evaluate((element) => element.tagName);
  expect(
    await lastFocusInTap(page, tag),
    `${label}: the focus came within the tap`,
  ).toBe(true);
}

/**
 * Where a writing sheet's toolbar sits against what the keyboard leaves:
 * its bottom, the sheet's top, and the visible screen's bottom.
 */
export const toolbarPlace = (dialog) =>
  dialog.evaluate((sheet) => {
    const toolbar = sheet.querySelector(".writing-toolbar");
    const viewport = window.visualViewport;
    return {
      bottom: toolbar.getBoundingClientRect().bottom,
      top: sheet.getBoundingClientRect().top,
      seen: viewport.offsetTop + viewport.height,
      seenTop: viewport.offsetTop,
    };
  });

/**
 * Fails when a text field's words are under 16px: a phone zooms in on such
 * a field as it takes the focus, and a writing sheet zoomed in no longer
 * fits what the keyboard leaves.
 */
export async function expectNoZoomOnFocus(field, label) {
  const size = await field.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  expect(size, `${label}: its words are ${size}px`).toBeGreaterThanOrEqual(16);
}
