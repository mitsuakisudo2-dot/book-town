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
