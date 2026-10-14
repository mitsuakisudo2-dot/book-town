"use client";

// Home has two tabs, ホーム and 便りだけ, each with its own address: `/` and
// `/timeline/`. Switching between them rewrites the address in place (no
// step of 戻る), and the tab shown is read back from the address, so 戻る to
// a Home address, a reload or a shared link opens the tab it names.

export type HomeTab = "home" | "letters";

export const HOME_TAB_PATHS = {
  home: "/",
  letters: "/timeline/",
} as const satisfies Record<HomeTab, string>;

/** The tab an address names, or null when it is not one of Home's. */
export function tabOfPath(path: string): HomeTab | null {
  if (path === HOME_TAB_PATHS.home) return "home";
  if (path === HOME_TAB_PATHS.letters) return "letters";
  return null;
}

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
