// Home has two tabs, ホーム and 便りだけ, each with its own address: `/` and
// `/timeline/`. Switching between them rewrites the address in place (no
// step of 戻る), and the tab shown is read back from the address, so 戻る to
// a Home address, a reload or a shared link opens the tab it names.
//
// The tab shown last is kept in this browser, and a fresh `/` (ホーム from
// another page, the brand, a bookmark) opens on it. `/timeline/` always
// opens 便りだけ. An address already opened (戻る, a reload) keeps its own
// tab: the history entry carries a mark saying so.
//
// No React here: the layout's boot script is built from these names on the
// server.

export type HomeTab = "home" | "letters";

export const HOME_TAB_PATHS = {
  home: "/",
  letters: "/timeline/",
} as const satisfies Record<HomeTab, string>;

/** Where the tab shown last is kept, in localStorage. */
export const HOME_TAB_KEY = "book-town-home-tab-v1";

/** The history entry's mark: this Home address was opened already. */
export const HOME_SEEN = "booktownHome";

/** The tab an address names, or null when it is not one of Home's. */
export function tabOfPath(path: string): HomeTab | null {
  if (path === HOME_TAB_PATHS.home) return "home";
  if (path === HOME_TAB_PATHS.letters) return "letters";
  return null;
}

/** A kept tab, read back only as one of the two. */
export const readHomeTab = (value: unknown): HomeTab | null =>
  value === "home" || value === "letters" ? value : null;

type TabStorage = Pick<Storage, "getItem" | "setItem">;

function local(): TabStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** The tab shown last, or null when none is kept (or storage is closed). */
export function loadHomeTab(storage = local()): HomeTab | null {
  try {
    return readHomeTab(storage?.getItem(HOME_TAB_KEY));
  } catch {
    return null;
  }
}

/** Keeps `tab` as the one shown last. Without storage, nothing is kept. */
export function saveHomeTab(tab: HomeTab, storage = local()) {
  try {
    if (storage?.getItem(HOME_TAB_KEY) === tab) return;
    storage?.setItem(HOME_TAB_KEY, tab);
  } catch {
    // The next fresh `/` opens on ホーム.
  }
  listeners.forEach((listener) => listener());
}

/** Calls `listener` when the kept tab changes, here or in another tab. */
export function subscribeHomeTab(listener: () => void) {
  listeners.add(listener);
  const fromElsewhere = (event: StorageEvent) => {
    if (event.key === HOME_TAB_KEY) listener();
  };
  addEventListener("storage", fromElsewhere);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", fromElsewhere);
  };
}

/**
 * The tab a Home address opens on: the one it names, but a fresh `/` (not
 * `seen` before in this entry) opens on the tab kept last.
 */
export function openingTab(
  path: string,
  seen: boolean,
  kept: HomeTab | null,
): HomeTab | null {
  const named = tabOfPath(path);
  if (named !== "home" || seen) return named;
  return kept ?? "home";
}

/**
 * Run in the page's head before it is painted: says on `<html>` which tab
 * opens (`data-home-tab`), so CSS hides what the other tab alone shows and
 * nothing flashes while the town loads. The same rule as `openingTab`.
 */
export const HOME_TAB_BOOT = `try{var p=location.pathname,t=p===${JSON.stringify(
  HOME_TAB_PATHS.letters,
)}?"letters":p===${JSON.stringify(
  HOME_TAB_PATHS.home,
)}?"home":null;try{if(t==="home"&&!(history.state&&history.state.${HOME_SEEN})&&localStorage.getItem(${JSON.stringify(
  HOME_TAB_KEY,
)})==="letters")t="letters"}catch(e){}if(t)document.documentElement.dataset.homeTab=t}catch(e){}`;

const topListeners = new Set<() => void>();

/** ホーム tapped while on Home: the pane shown goes back to its top. */
export function requestHomeTop() {
  topListeners.forEach((listener) => listener());
}

export function onHomeTop(listener: () => void) {
  topListeners.add(listener);
  return () => {
    topListeners.delete(listener);
  };
}
