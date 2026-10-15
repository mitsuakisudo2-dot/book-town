"use client";

import { useCallback, useSyncExternalStore } from "react";
import { noteAddressChanged } from "./in-town";

// A screen's small choices (a tab, a filter, a lane of the street) live in
// the address, replaced in place: they add no step to 戻る, and coming back
// to the page brings them back as they were.

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    removeEventListener("popstate", listener);
  };
}

export const readParam = (name: string): string | null =>
  new URLSearchParams(location.search).get(name);

/**
 * Rewrites the address in place; null or "" removes the value. A new `path`
 * (Home's two tabs, `/` and `/timeline/`) leaves the other page's choices
 * behind: only the `params` and `hash` given come along.
 */
export function replaceAddress(change: {
  path?: string;
  params?: Record<string, string | null>;
  hash?: string | null;
}) {
  const url = new URL(location.href);
  if (change.path !== undefined && change.path !== url.pathname) {
    url.pathname = change.path;
    url.search = "";
    url.hash = "";
  }
  for (const [name, value] of Object.entries(change.params ?? {}))
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  if (change.hash !== undefined) url.hash = change.hash ?? "";
  const next = url.pathname + url.search + url.hash;
  if (next === location.pathname + location.search + location.hash) return;
  // Keeping the router's own entry state tells Next.js this is not a
  // navigation of its own; otherwise it would restore this page and cancel a
  // link the reader has just tapped (the street grows while they scroll).
  try {
    history.replaceState(history.state, "", next);
  } catch {
    // Safari refuses many replacements in a short time (a query typed fast);
    // the address catches up with the next change.
    return;
  }
  noteAddressChanged();
  emit();
}

/**
 * The address's path, as it is rewritten in place too. The static page and
 * its first render have the route's own path, `routePath`.
 */
export function useAddressPath(routePath: string): string {
  return useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => routePath,
  );
}

/** A value kept in the address under `name`: null when absent. */
export function useUrlParam(
  name: string,
): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readParam(name),
    () => null,
  );
  const set = useCallback(
    (next: string | null) => replaceAddress({ params: { [name]: next } }),
    [name],
  );
  return [value, set];
}
