import { expect } from "@playwright/test";

// A dialog closed by hand takes its step back off the browser's history a
// moment later (see src/lib/back-layer.ts). A journey that then goes to an
// address, reloads or steps through the history waits for that first, as a
// reader's next tap would.

/** Resolves once no closed dialog is still taking its step off. */
export async function layersSettled(page) {
  await page.waitForTimeout(50);
  await page
    .waitForFunction(
      () =>
        document.querySelector('dialog[open], [role="dialog"]') ||
        !history.state?.booktownLayers,
      null,
      { timeout: 3000 },
    )
    .catch(() => {});
}

/** Makes the page's navigations wait for closed dialogs first. */
export function settleBeforeNavigating(page) {
  for (const name of ["goto", "reload", "goBack", "goForward"]) {
    const navigate = page[name].bind(page);
    page[name] = async (...args) => {
      await layersSettled(page);
      return navigate(...args);
    };
  }
  return page;
}

// The book in hand rises into place as it opens (bh-appear in
// src/components/book-in-hand.css). A size read during that motion can come
// out a fraction of a pixel short (43.9999 for a 44px button), so a journey
// that measures what a dialog shows waits for the page to stop moving first.

/** The element's box once no animation or transition that ends is running. */
export async function restingBox(locator) {
  const box = await locator.evaluate(async (element) => {
    const moving = () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
    const deadline = performance.now() + 3000;
    let running = moving();
    while (running.length && performance.now() < deadline) {
      await Promise.race([
        Promise.allSettled(running.map((animation) => animation.finished)),
        new Promise((resolve) =>
          setTimeout(resolve, deadline - performance.now()),
        ),
      ]);
      running = moving();
    }
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height, moving: running.length };
  });
  expect(box.moving, "measured while the page was still moving").toBe(0);
  return box;
}

// The Escape that cancels a kana conversion belongs to the keyboard: a dialog
// must not take it as a close request, or what is written in it goes with
// the dialog. Chromium composes through the DevTools protocol as an input
// method does, and an Escape pressed then reaches the page with isComposing.

/**
 * Presses Escape while `text` is being converted, then cancels the
 * conversion as the keyboard would. With `keyCode229`, the Escape comes as
 * Safari reports the key that ends a conversion (keyCode 229, not composing).
 */
export async function escapeWhileComposing(
  page,
  { text = "にほん", keyCode229 = false } = {},
) {
  const cdp = await page.context().newCDPSession(page);
  try {
    if (!keyCode229)
      await cdp.send("Input.imeSetComposition", {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    for (const type of ["rawKeyDown", "keyUp"])
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: keyCode229 ? 229 : 27,
        nativeVirtualKeyCode: keyCode229 ? 229 : 27,
      });
    if (!keyCode229)
      await cdp.send("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
  } finally {
    await cdp.detach();
  }
}
