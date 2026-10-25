"use client";

import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { ENCOUNTER_MEMO_MAX_LENGTH } from "./library";
import {
  ownerKeyPattern,
  readOverSaved,
  unchanged,
  type OverSaved,
} from "./shop-draft";

// The memo of an encounter being written (押したときのメモ), kept in this
// browser until the town has it saved or the reader throws it away. Keyed by
// owner and encounter ("<owner>/<encounter id>").

export const ENCOUNTER_MEMO_DRAFT_KEY = "book-town-encounter-memo-drafts-v1";

export type MemoWork = { memo: string };

export function readMemoWork(value: unknown): MemoWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<MemoWork>;
  return keptText(work.memo, ENCOUNTER_MEMO_MAX_LENGTH)
    ? { memo: work.memo }
    : null;
}

export const memoDraftOptions: KeptDraftOptions<OverSaved<MemoWork>> = {
  storageKey: ENCOUNTER_MEMO_DRAFT_KEY,
  keyPattern: ownerKeyPattern(1),
  read: (value) => readOverSaved(value, readMemoWork),
  isEmpty: unchanged,
  limit: 20,
};
export const memoDraftStore = createKeptDraftStore(memoDraftOptions);
