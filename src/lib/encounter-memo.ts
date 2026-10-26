"use client";

import { useSyncExternalStore } from "react";
import type { ToastUndo, TownActions, TownState } from "./types";

// 押したときのメモ (いいねと読みたいのメモ, 2026-10-14, 4章): a press that
// meets a book (an encounter, 管理表9) offers a memo in its toast, and the
// row of 「この本との出会い」 opens the same sheet. Every page reads this
// file, so it holds only the asking; the sheet is read once it is asked for
// (EncounterMemo.tsx).

/** The toast's button. */
export const MEMO_OFFER = "メモ";
/** What a press that meets a book says, when it says nothing else. */
export const MET_TOAST = {
  liked: "いいねした本に入れました",
  wanted: "読みたい本に入れました",
} as const;

let asked: string | null = null;
let ever = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

/** Opens the memo sheet for one of the reader's encounters (null closes it). */
export function askMemo(encounterId: string | null) {
  asked = encounterId;
  if (encounterId) ever = true;
  tell();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The encounter whose memo is being written, if any. */
export const useAskedMemo = () =>
  useSyncExternalStore(
    subscribe,
    () => asked,
    () => null,
  );

/** Whether a memo was ever asked for here: the sheet's code is read from then on. */
export const useMemoEverAsked = () =>
  useSyncExternalStore(
    subscribe,
    () => ever,
    () => false,
  );

/**
 * The toast's メモ for what the press just made, asked right after it:
 * nothing when it met nothing new, or the reader turned the offer off
 * (「メモの案内を出す」).
 */
export function memoOffer(
  state: Pick<TownState, "settings">,
  actions: Pick<TownActions, "takeMet">,
): ToastUndo | undefined {
  const met = actions.takeMet();
  if (!met || !state.settings.memoHint) return undefined;
  return { label: MEMO_OFFER, run: () => askMemo(met) };
}
