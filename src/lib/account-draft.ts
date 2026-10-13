"use client";

import { NAME_MAX_LENGTH, validEmail } from "./account";
import { createKeptDraftStore, keptText } from "./kept-draft";

// Signing in sends the reader to their mail app, where the phone may drop
// this page. The step reached (the address the code went to) and the first
// profile being typed are kept for this browser tab, in sessionStorage, so a
// reload comes back to them. Of the sign-in only the address and the time
// the code was sent are kept, never the code.

/** How long an emailed code works (supabase/hosted-auth.json). */
export const CODE_LIFE_MS = 10 * 60 * 1000;

export type SentCode = { email: string; sentAt: number };
/** The sign-in store's one entry. */
export const SENT_CODE = "sent";

/** The sent code read back, while the code can still sign in. */
export function readSentCode(
  value: unknown,
  now = Date.now(),
): SentCode | null {
  const sent = value as Partial<SentCode> | null;
  if (
    !sent ||
    typeof sent.email !== "string" ||
    !validEmail(sent.email) ||
    typeof sent.sentAt !== "number" ||
    !Number.isFinite(sent.sentAt)
  )
    return null;
  // Past its life the code cannot sign in: the address is asked again.
  if (now - sent.sentAt >= CODE_LIFE_MS || sent.sentAt > now + 60_000)
    return null;
  return { email: sent.email, sentAt: sent.sentAt };
}

export const sentCodeStore = createKeptDraftStore<SentCode>(
  {
    storageKey: "book-town-sign-in-v1",
    keyPattern: /^sent$/,
    read: (value) => readSentCode(value),
    limit: 1,
  },
  () => window.sessionStorage,
);

export type ProfileWork = { name: string; handle: string };
/** The ID field takes an @ and an ID of up to 20 characters. */
export const HANDLE_FIELD_MAX_LENGTH = 21;
const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first profile read back, if it fits the form's fields. */
export function readProfileWork(value: unknown): ProfileWork | null {
  const work = value as Partial<ProfileWork> | null;
  if (
    !work ||
    !keptText(work.name, NAME_MAX_LENGTH) ||
    !keptText(work.handle, HANDLE_FIELD_MAX_LENGTH)
  )
    return null;
  return { name: work.name, handle: work.handle };
}

/** The first profile being typed, by the signed-in person's id. */
export const profileWorkStore = createKeptDraftStore<ProfileWork>(
  {
    storageKey: "book-town-first-profile-v1",
    keyPattern: USER_ID,
    read: readProfileWork,
    isEmpty: (work) => !work.name.trim() && !work.handle.trim(),
    limit: 3,
  },
  () => window.sessionStorage,
);
