import type { SiteNoteSpot } from "./site-notes";

// The note being written in 注釈モード, kept in memory until it is left or
// thrown away on purpose. Closing the mode by accident (戻る, Escape, going
// to another page) keeps it; reloading the page forgets it.

export interface SiteNoteDraft {
  /** Whose draft it is: another account signed in on this browser never sees it. */
  userId: string;
  /** The page it was written on (pageKey). */
  pageKey: string;
  text: string;
  /** Where it points, once a place was tapped. */
  spot: SiteNoteSpot | null;
}

let kept: SiteNoteDraft | null = null;

/** The draft this account is writing, if any. */
export const keptDraft = (userId: string): SiteNoteDraft | null =>
  kept?.userId === userId ? kept : null;

/** Keeps the draft as it stands; one with no words yet is not worth keeping. */
export function keepDraft(draft: SiteNoteDraft) {
  kept = draft.text.trim() ? draft : null;
}

export function forgetDraft() {
  kept = null;
}
