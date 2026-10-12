"use client";
import { useSyncExternalStore } from "react";

/**
 * A visitor who is not signed in can look at everything public, and is asked
 * to sign in only when they try to change something: open a shop, post, like.
 * The stores call requestAccount(); the page shows the invitation.
 */
let open = false;
const listeners = new Set<() => void>();
const set = (next: boolean) => {
  if (open === next) return;
  open = next;
  listeners.forEach((listener) => listener());
};

export const requestAccount = () => set(true);
export const closeAccountRequest = () => set(false);
/** Read at the moment of a change, before the page has re-rendered. */
export const accountRequested = () => open;

/** Whether the invitation to sign in is showing. */
export function useAccountRequest(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => open,
    () => false,
  );
}
