"use client";

import { useSyncExternalStore } from "react";

// The last address of each Home tab (the street and the timeline), so the
// other tab and ホーム return to the filter and the lane the reader left
// there, as 戻る does. Kept for this browser tab only, in sessionStorage.
// How far down the street was walked (rounds) is left behind: without the
// scroll position, a long street drawn from its top is only extra weight.

export const HOME_PATHS = ["/", "/timeline/"] as const;
export type HomePath = (typeof HOME_PATHS)[number];
const STORAGE_KEY = "book-town-home-addresses-v1";
/** The choices a Home tab keeps in its address. */
const KEPT_PARAMS = ["show", "lane"];
const ADDRESS_MAX_LENGTH = 200;

type HomeAddresses = {
  /** Each tab's address, its path and the choices it keeps. */
  addresses: Partial<Record<HomePath, string>>;
  /** The Home tab open last, which ホーム returns to. */
  last: HomePath;
};

const isHomePath = (path: unknown): path is HomePath =>
  HOME_PATHS.includes(path as HomePath);

/** The address kept for a page, or null when it is not a Home tab. */
export function homeAddressOf(path: string, search: string): string | null {
  if (!isHomePath(path)) return null;
  const all = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const name of KEPT_PARAMS) {
    const value = all.get(name);
    if (value) kept.set(name, value);
  }
  const query = kept.toString();
  return query ? path + "?" + query : path;
}

/** What was kept, read back from storage, if it is still a shape kept here. */
export function readHomeAddresses(value: unknown): HomeAddresses | null {
  const data = value as Partial<HomeAddresses> | null;
  if (!data || typeof data !== "object" || !isHomePath(data.last)) return null;
  const addresses: HomeAddresses["addresses"] = {};
  for (const path of HOME_PATHS) {
    const address = data.addresses?.[path];
    if (
      typeof address === "string" &&
      address.length <= ADDRESS_MAX_LENGTH &&
      homeAddressOf(path, address.slice(path.length)) === address
    )
      addresses[path] = address;
  }
  return { addresses, last: data.last };
}

const listeners = new Set<() => void>();
let kept: HomeAddresses | null = null;

function current(): HomeAddresses {
  if (kept) return kept;
  kept = { addresses: {}, last: "/" };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    kept = (raw && readHomeAddresses(JSON.parse(raw))) || kept;
  } catch {
    // Without storage, the addresses are kept until the page is reloaded.
  }
  return kept;
}

/** Notes the page's address when it is a Home tab, as its choices change. */
export function noteHomeAddress() {
  const path = location.pathname;
  const address = homeAddressOf(path, location.search);
  if (!address || !isHomePath(path)) return;
  const was = current();
  if (was.addresses[path] === address && was.last === path) return;
  kept = { addresses: { ...was.addresses, [path]: address }, last: path };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Kept in memory all the same.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The address to return to a Home tab by. The static page and its first
 * render have the bare path; the kept address follows once mounted.
 */
export function useHomeAddress(path: HomePath): string {
  return useSyncExternalStore(
    subscribe,
    () => current().addresses[path] ?? path,
    () => path,
  );
}

/** The address of the Home tab open last, for ホーム: the street at first. */
export function useLastHomeAddress(): string {
  return useSyncExternalStore(
    subscribe,
    () => {
      const { addresses, last } = current();
      return addresses[last] ?? last;
    },
    () => "/",
  );
}
