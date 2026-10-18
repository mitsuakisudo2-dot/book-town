"use client";

import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { DRAFT_OWNER } from "./draft-owner";
import {
  SITE_REPORT_KINDS,
  type SiteReportKind,
} from "./supabase/site-reports";
import { SITE_REPORT_MAX_LENGTH } from "./types";

// What a reader is writing to the operator (不具合と要望), kept per reader:
// closing the dialog by a tap, Escape, ✕ or 戻る leaves it for next time.
// Cleared once the report is received, or when the reader stops.

export const SITE_REPORT_DRAFT_KEY = "book-town-site-report-drafts-v1";

export type SiteReportWork = { kind: SiteReportKind | null; body: string };

/** Work read back from storage, if it is still the shape the dialog makes. */
export function readSiteReportWork(value: unknown): SiteReportWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<SiteReportWork>;
  const kind =
    work.kind === null
      ? null
      : SITE_REPORT_KINDS.find((entry) => entry === work.kind);
  if (kind === undefined || !keptText(work.body, SITE_REPORT_MAX_LENGTH))
    return null;
  return { kind, body: work.body };
}

export const SITE_REPORT_DRAFT_OPTIONS: KeptDraftOptions<SiteReportWork> = {
  storageKey: SITE_REPORT_DRAFT_KEY,
  // One per reader: the key is the owner itself.
  keyPattern: new RegExp("^" + DRAFT_OWNER + "$"),
  read: readSiteReportWork,
  isEmpty: (work) => work.kind === null && !work.body,
};

export const siteReportDrafts = createKeptDraftStore(SITE_REPORT_DRAFT_OPTIONS);
