"use client";

import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import type { ReportTarget } from "./report";
import { REPORT_DETAIL_MAX, type ReportReason } from "./supabase/reports";

// What a reporter has chosen and written, kept per thing reported: closing
// the dialog by a tap, Escape, ✕ or 戻る leaves it for the next time. Cleared
// once the report is received (or was already), or when the reporter stops.

export const REPORT_DRAFT_KEY = "book-town-report-drafts-v1";

export type ReportWork = { reason: ReportReason | null; detail: string };

const REASONS: readonly ReportReason[] = [
  "spam",
  "harassment",
  "inappropriate",
  "other",
  "personal_info",
  "threat",
  "cover",
];

/**
 * The thing reported, for one reporter (by account id): one entry per kind
 * and id. A post or a book has the same id for everyone.
 */
export const reportWorkKey = (
  owner: string,
  target: Pick<ReportTarget, "kind" | "id">,
) => owner + ":" + target.kind + ":" + target.id;

/** Work read back from storage, if it is still the shape the dialog makes. */
export function readReportWork(value: unknown): ReportWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<ReportWork>;
  const reason =
    work.reason === null
      ? null
      : REASONS.find((entry) => entry === work.reason);
  if (reason === undefined || !keptText(work.detail, REPORT_DETAIL_MAX))
    return null;
  return { reason, detail: work.detail };
}

export const REPORT_DRAFT_OPTIONS: KeptDraftOptions<ReportWork> = {
  storageKey: REPORT_DRAFT_KEY,
  keyPattern: /^[^:]+:(post|shop|profile|poster|book):.+$/,
  read: readReportWork,
  isEmpty: (work) => work.reason === null && !work.detail,
};

export const reportDrafts = createKeptDraftStore(REPORT_DRAFT_OPTIONS);
