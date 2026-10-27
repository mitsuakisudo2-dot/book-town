"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { DRAFT_OWNER } from "./draft-owner";
import {
  NOTE_KINDS,
  READING_NOTE_MAX_LENGTH,
  type NoteKind,
} from "./reading-cards";

// The words being written in 読書中の書く欄, kept in this browser until 今日
// のノート has them or the reader throws them away, one card at a time
// ("<owner>:<card id>"). A note the database turned away comes back here
// (missed-changes.ts), after the words already there.

export const READING_NOTE_DRAFT_KEY = "book-town-reading-note-drafts-v1";

export type NoteWork = { kind: NoteKind; body: string };

export const noteWorkKey = (owner: string, cardId: string) =>
  owner + ":" + cardId;

/** Work read back from storage, if it is still the shape the screen makes. */
export function readNoteWork(value: unknown): NoteWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<NoteWork>;
  const kind = NOTE_KINDS.find((entry) => entry === work.kind);
  return kind && keptText(work.body, READING_NOTE_MAX_LENGTH)
    ? { kind, body: work.body }
    : null;
}

export const noteDraftOptions: KeptDraftOptions<NoteWork> = {
  storageKey: READING_NOTE_DRAFT_KEY,
  keyPattern: new RegExp("^" + DRAFT_OWNER + ":.+$"),
  read: readNoteWork,
  isEmpty: (work) => !work.body.trim(),
  limit: 20,
};
export const noteDraftStore = createKeptDraftStore(noteDraftOptions);

/**
 * Puts a note's words back for `owner` under its card: as they were, or
 * after the words kept there already, on a line of their own. False when
 * the two together would be longer than a note is kept.
 */
export function returnNoteWords(
  owner: string,
  cardId: string,
  words: NoteWork,
  store = noteDraftStore,
): boolean {
  if (!words.body.trim()) return false;
  const key = noteWorkKey(owner, cardId);
  const kept = store.get(key);
  const body = kept?.body.trim() ? kept.body + "\n" + words.body : words.body;
  if ([...body].length > READING_NOTE_MAX_LENGTH) return false;
  store.set(key, { kind: kept?.kind ?? words.kind, body });
  return true;
}

/** The owner's words not yet in 今日のノート, by card. */
export function useNoteDrafts(
  owner: string | null,
): { cardId: string; draft: NoteWork }[] {
  const snapshot = useSyncExternalStore(
    noteDraftStore.subscribe,
    noteDraftStore.getSnapshot,
    noteDraftStore.getServerSnapshot,
  );
  useEffect(() => noteDraftStore.initialize(), []);
  if (owner === null) return [];
  const mine = owner + ":";
  return Object.entries(snapshot.drafts).flatMap(([key, draft]) =>
    key.startsWith(mine) ? [{ cardId: key.slice(mine.length), draft }] : [],
  );
}
