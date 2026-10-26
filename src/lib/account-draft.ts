"use client";

import { NAME_MAX_LENGTH, validEmail } from "./account";
import { createKeptDraftStore, keptText } from "./kept-draft";
import { DATABASE_ID } from "./record-kind";

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

// A name and an ID put in to start with, so はじめる can be pressed as it is
// (けにーさん 10-26 01:35Z 「ユーザー名とIDはとりあえずランダムでいいように」).
// Either can be changed then, or later.
const NAME_FIRST = [
  "夜更けの",
  "窓辺の",
  "雨の日の",
  "木陰の",
  "灯りの",
  "旅する",
  "静かな",
  "栞の",
];
const NAME_LAST = ["読書家", "本の虫", "読み手", "本好き"];
const ID_LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function suggestProfile(): ProfileWork {
  const picks = crypto.getRandomValues(new Uint32Array(8));
  const id = Array.from(
    picks.slice(2),
    (n) => ID_LETTERS[n % ID_LETTERS.length],
  );
  return {
    name:
      NAME_FIRST[picks[0] % NAME_FIRST.length] +
      NAME_LAST[picks[1] % NAME_LAST.length],
    handle: `reader_${id.join("")}`,
  };
}

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
    keyPattern: DATABASE_ID,
    read: readProfileWork,
    isEmpty: (work) => !work.name.trim() && !work.handle.trim(),
    limit: 3,
  },
  () => window.sessionStorage,
);

/**
 * A change of address under way: the new address, when its codes were sent
 * (they work as long as a sign-in code), and whether the new address's code
 * was taken already (each code works once). Never the codes themselves.
 */
export type EmailChangeSent = {
  email: string;
  sentAt: number;
  newConfirmed: boolean;
};

/** The change of address read back, while its codes can still be used. */
export function readEmailChange(
  value: unknown,
  now = Date.now(),
): EmailChangeSent | null {
  const change = value as Partial<EmailChangeSent> | null;
  const sent = readSentCode(change, now);
  if (!sent || typeof change?.newConfirmed !== "boolean") return null;
  return { ...sent, newConfirmed: change.newConfirmed };
}

/** The change of address under way, by the signed-in person's id. */
export const emailChangeStore = createKeptDraftStore<EmailChangeSent>(
  {
    storageKey: "book-town-email-change-v1",
    keyPattern: DATABASE_ID,
    read: (value) => readEmailChange(value),
    limit: 3,
  },
  () => window.sessionStorage,
);
