// After a new build goes up, a page opened before it still names the old
// build's files. Each screen comes in its own file (docs/09 「速さの見張りと
// ページごとの JS」), so a screen the page has not shown yet may be gone, and
// webpack throws ChunkLoadError: the screen would go blank. A screen's own
// CSS may be gone the same way, and the screen would show unstyled. The page
// reads itself again once, from the new build instead. What the reader was writing
// is kept (kept-draft.ts) and where they were is in the address.

const KEY = "book-town-new-build-v1";
/** Not read again within this, so a file truly missing does not loop. */
export const QUIET_MS = 60_000;

/**
 * Whether an error is a file of this site that could not be read: webpack's
 * error for a screen's JS, or the failed load of a screen's stylesheet. A
 * screen's CSS comes with it (screen-styles.ts), and when only the CSS
 * changed in the new build, the screen's JS is found but its stylesheet is
 * not: the page hears an Event whose target is the <link>, not an Error.
 */
export function isMissingFile(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { name, message, type, target } = value as {
    name?: unknown;
    message?: unknown;
    type?: unknown;
    target?: unknown;
  };
  return (
    name === "ChunkLoadError" ||
    (typeof message === "string" &&
      /^Loading (CSS )?chunk \S+ failed/.test(message)) ||
    (type === "error" && isSiteStylesheet(target))
  );
}

/** A <link rel="stylesheet"> to this site's own built files. */
function isSiteStylesheet(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const { tagName, rel, href } = target as {
    tagName?: unknown;
    rel?: unknown;
    href?: unknown;
  };
  if (tagName !== "LINK" || rel !== "stylesheet" || typeof href !== "string")
    return false;
  try {
    const here = globalThis.location?.origin;
    const url = new URL(href, here ?? "http://localhost");
    return (
      (!here || url.origin === here) &&
      url.pathname.startsWith("/_next/static/")
    );
  } catch {
    return false;
  }
}

type Page = {
  storage: Pick<Storage, "getItem" | "setItem">;
  now: number;
  online: boolean;
  reload: () => void;
};

/**
 * Reads the page again from the new build, unless it did within QUIET_MS
 * (the file is missing from the new build too) or the device is offline (a
 * reload would leave the reader on the browser's own error page). Says
 * whether it did.
 */
export function readNewBuild(page?: Partial<Page>): boolean {
  try {
    const storage = page?.storage ?? sessionStorage;
    const now = page?.now ?? Date.now();
    const online = page?.online ?? navigator.onLine;
    const reload = page?.reload ?? (() => location.reload());
    if (!online) return false;
    const last = Number(storage.getItem(KEY));
    if (last && now - last >= 0 && now - last < QUIET_MS) return false;
    storage.setItem(KEY, String(now));
    reload();
    return true;
  } catch {
    return false;
  }
}
