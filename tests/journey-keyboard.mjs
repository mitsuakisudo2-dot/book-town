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
