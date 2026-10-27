"use client";

// What a reader who left Booktown (退会) had in this browser goes with them:
// their unsent work in every kept-draft store, the scanner's journal, the
// changes waiting to be sent (outbox.ts), and the small things kept per
// account (which notices were read, where the walk stopped). Work kept for
// no one in particular (a visitor's, the demo's) stays. Every module that
// keeps a reader's work is imported here, so its store exists to be told;
// tests/leave.test.ts checks none is missing.
import { forgetOwnerEverywhere } from "./kept-draft";
import "./account-draft";
import "./book-fix-draft";
import "./encounter-memo-draft";
import "./library-shelf-draft";
import "./open-shop-draft";
import "./post-draft";
import "./poster-draft";
import "./profile-draft";
import "./reading-note-draft";
import "./record-draft";
import "./report-draft";
import "./scene-draft";
import "./shelves-draft";
import "./shop-draft";
import "./site-report-draft";
import { JOURNAL_KEY, libraryJournal } from "./library-journal";
import { LAST_SCAN_KEY } from "./scan-resume";
import { POSITION_KEY } from "./walk-repository";
import { SEEN_KEY } from "./supabase/town-backend";
import { FIRST_STEPS_KEY } from "./home-feed";
import { OUTBOX_KEY, OUTBOX_KEY_BEFORE, WALK_OUTBOX_KEY } from "./outbox";

/** The browser storage keys kept per account: the key, then the account id. */
export const PER_ACCOUNT_KEYS = [
  JOURNAL_KEY,
  LAST_SCAN_KEY,
  POSITION_KEY,
  SEEN_KEY,
  FIRST_STEPS_KEY,
  OUTBOX_KEY,
  OUTBOX_KEY_BEFORE,
  WALK_OUTBOX_KEY,
];

/** Lets go of everything this browser keeps for `userId`. */
export function forgetReaderHere(userId: string) {
  forgetOwnerEverywhere(userId);
  libraryJournal.forget(userId);
  for (const key of PER_ACCOUNT_KEYS)
    try {
      window.localStorage.removeItem(key + userId);
    } catch {
      // Storage that cannot be reached keeps nothing to let go of.
    }
}
