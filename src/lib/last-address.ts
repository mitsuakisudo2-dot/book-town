"use client";

import { useSyncExternalStore } from "react";
import {
  HOME_TAB_PATHS,
  loadHomeTab,
  subscribeHomeTab,
  type HomeTab,
} from "./home-tab";

// ホーム from another page returns to the Home tab shown last, kept in this
// browser (home-tab.ts). Only the path is kept: how far the alley or the
// 便り were walked (`rounds`) stays with that history entry, for 戻る, and
// a fresh ホーム starts at the top.

export const HOME_PATHS = [
  HOME_TAB_PATHS.home,
  HOME_TAB_PATHS.letters,
] as const;
export type HomePath = (typeof HOME_PATHS)[number];

const isHomePath = (path: unknown): path is HomePath =>
  HOME_PATHS.includes(path as HomePath);

/** The address ホーム keeps for a page: its path alone, or null when it is not a Home tab. */
export const homeAddressOf = (path: string): string | null =>
  isHomePath(path) ? path : null;

const lastTab = (): HomeTab => loadHomeTab() ?? "home";

/** The address of the Home tab shown last, for ホーム: `/` at first. */
export function useLastHomeAddress(): string {
  return HOME_TAB_PATHS[
    useSyncExternalStore(subscribeHomeTab, lastTab, () => "home" as const)
  ];
}
