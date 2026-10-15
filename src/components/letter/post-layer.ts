"use client";

import { useSyncExternalStore } from "react";
import { postPath } from "../../lib/paths";

// Which 便り's page is open over the screen. Kept outside React, because
// each page of the town is a TownApp of its own, and any screen's card opens
// the one layer TownApp mounts.

let openId: string | null = null;
/** The card's time link, which takes the focus back when the page closes. */
let returnTo: HTMLElement | null = null;
/** Covers opened on a card, so its page shows them open too. */
const opened = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Opens the page of the post `id`, over whatever screen is shown. */
export function openPost(id: string, from?: HTMLElement | null) {
  returnTo = from ?? null;
  if (openId === id) return;
  openId = id;
  emit();
}

export function closePost() {
  if (openId === null) return;
  openId = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The post whose page is open, if any. */
export const usePostLayer = (): string | null =>
  useSyncExternalStore(
    subscribe,
    () => openId,
    () => null,
  );

export const isPostOpen = (id: string): boolean => openId === id;

/** The 戻る step of a post's page (back-layer.ts). */
export const postLayerName = (id: string): string => "post:" + id;

/** The post a recorded layer is the page of, if it is one. */
export const postOfLayer = (name: string): string | null =>
  name.startsWith("post:") ? name.slice("post:".length) : null;

/**
 * Gives the focus back to the time link of the card (or Live's line) the
 * page opened from, or, opened another way (戻る from a page it left for),
 * to that post's time link wherever it is on the screen.
 */
export function focusReturn(id: string) {
  const href = CSS.escape(postPath(id));
  // The first on the screen: not in a pane hidden, nor in a line under Live.
  const link = returnTo?.isConnected
    ? returnTo
    : [
        ...document.querySelectorAll<HTMLElement>(
          `a.letter-time[href="${href}"], a.home-live-time[href="${href}"]`,
        ),
      ].find(
        (element) =>
          element.getClientRects().length > 0 && !element.closest("[inert]"),
      );
  returnTo = null;
  link?.focus({ preventScroll: true });
}

/** A cover the reader opened on a card ("spoiler:<id>", "report:<id>"). */
export const noteOpened = (key: string) => {
  opened.add(key);
};
export const wasOpened = (key: string): boolean => opened.has(key);
export const forgetOpened = (key: string) => {
  opened.delete(key);
};
