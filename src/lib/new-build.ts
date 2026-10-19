// After a new build goes up, a page opened before it still names the old
// build's files. Each screen comes in its own file (docs/09 「速さの見張りと
// ページごとの JS」), so a screen the page has not shown yet may be gone, and
// webpack throws ChunkLoadError: the screen would go blank. The page reads
// itself again once, from the new build instead. What the reader was writing
// is kept (kept-draft.ts) and where they were is in the address.

const KEY = "book-town-new-build-v1";
/** Not read again within this, so a file truly missing does not loop. */
export const QUIET_MS = 60_000;

/** Whether an error is a file of this site that could not be read. */
export function isMissingFile(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { name, message } = value as { name?: unknown; message?: unknown };
  return (
    name === "ChunkLoadError" ||
    (typeof message === "string" &&
      /^Loading (CSS )?chunk \S+ failed/.test(message))
  );
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
