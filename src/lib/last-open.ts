// 「前に開いたのはここまで」 (仮; PR 2): when Home was opened last in this
// browser. It is read once a page, before this opening is kept, so the line
// stays where it was while the reader moves about (戻る to Home included);
// the next page drawn from the server puts it at this opening.

/** Where the time Home was opened last is kept, in localStorage. */
export const LAST_OPEN_KEY = "book-town-home-opened-v1";

type KeptStorage = Pick<Storage, "getItem" | "setItem">;

/** A kept time read back: a moment before `now`, in milliseconds, or null. */
export function readOpened(value: string | null, now: number): number | null {
  if (!value) return null;
  const at = Number(value);
  return Number.isSafeInteger(at) && at > 0 && at <= now ? at : null;
}

function local(): KeptStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The time Home was opened last, read once for this page, and this opening
 * kept for the next. `storage` and `now` are a test's.
 */
export function createLastOpen(
  storage: () => KeptStorage | null = local,
  now: () => number = Date.now,
) {
  let before: number | null | undefined;
  let kept = false;
  const opened = (): number | null => {
    if (before === undefined) {
      let value: string | null = null;
      try {
        value = storage()?.getItem(LAST_OPEN_KEY) ?? null;
      } catch {
        // Unreadable: as on a first opening.
      }
      before = readOpened(value, now());
    }
    return before;
  };
  return {
    /** When Home was opened before this page; null on a first opening. */
    opened,
    /** Keeps this opening for the next page, once a page. */
    keep() {
      opened();
      if (kept) return;
      kept = true;
      try {
        storage()?.setItem(LAST_OPEN_KEY, String(now()));
      } catch {
        // Not kept: the next page shows no line, as on a first opening.
      }
    },
  };
}

/** This page's. */
export const lastOpen = createLastOpen();
