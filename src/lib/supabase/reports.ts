import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "./database.types";
import { NAMES } from "../words";

export type ReportKind = "post" | "shop" | "profile" | "poster" | "book";
/** What the app sends. A report about a book is always a cover removal request. */
export type ReportReason =
  | "spam"
  | "harassment"
  | "inappropriate"
  | "other"
  | "personal_info"
  | "threat"
  | "cover";
/** Reports filed before 2026-10-13 may also say "spoiler". */
export type FiledReason = ReportReason | "spoiler";
/**
 * How far along a report is, as the reporter may know it: the database's
 * `progress`. Resolved and dismissed are both "checked"; the reporter cannot
 * read which (reports.status is not granted to them).
 */
export const REPORT_STATUSES = ["open", "checking", "checked"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** One of the viewer's own reports, as far as they may know it. */
export interface FiledReport {
  id: string;
  kind: ReportKind;
  targetId: string;
  reason: FiledReason;
  status: ReportStatus;
  createdAt: string;
  /** When the status last changed. */
  statusAt: string;
}

/** How a report's thing is spoken of. */
export const REPORT_KIND_WORDS: Record<ReportKind, string> = {
  post: NAMES.letter,
  shop: "書店",
  profile: "読書家",
  poster: "ポスター",
  book: "本の表紙",
};
export const REPORT_REASON_WORDS: Record<FiledReason, string> = {
  spam: "宣伝・スパム",
  harassment: "嫌がらせ・攻撃的な言葉",
  personal_info: "個人情報をさらしている",
  threat: "脅し・危害を加えるという言葉",
  inappropriate: "不適切な内容",
  other: "その他",
  spoiler: "ネタバレ",
  cover: "削除の依頼",
};
/**
 * What the reporter is told: received, being checked, checked. Never which
 * way it went, nor what was done about the other person.
 */
export const REPORT_STATUS_WORDS: Record<ReportStatus, string> = {
  open: "受け付けました",
  checking: "確認中",
  checked: "確認しました",
};

/** The same limit as reports.detail in the database. */
export const REPORT_DETAIL_MAX = 1000;

/** The columns a reporter may read of their own reports. */
export const REPORT_COLUMNS =
  "id, target_kind, target_id, reason, progress, created_at, status_at";

const KINDS: ReportKind[] = ["post", "shop", "profile", "poster", "book"];

/** A report row as the app keeps it; null for one it does not know. */
export function filedReportFrom(
  row: Pick<
    Tables<"reports">,
    | "id"
    | "target_kind"
    | "target_id"
    | "reason"
    | "progress"
    | "created_at"
    | "status_at"
  >,
): FiledReport | null {
  if (
    !KINDS.includes(row.target_kind as ReportKind) ||
    !(row.reason in REPORT_REASON_WORDS) ||
    !REPORT_STATUSES.includes(row.progress as ReportStatus)
  )
    return null;
  return {
    id: row.id,
    kind: row.target_kind as ReportKind,
    targetId: row.target_id,
    reason: row.reason as FiledReason,
    status: row.progress as ReportStatus,
    createdAt: row.created_at,
    statusAt: row.status_at,
  };
}

/**
 * Files a report for the operator, who reads it in the Supabase dashboard.
 * Three people's worth of reports fold the thing (a tap still opens it) until
 * the operator checks; reports from new accounts, and from accounts made
 * together, weigh less. Personal information and threats, from an account a
 * week old or more, hide a post or poster from all but its writer at once.
 * (The rule is the database's: supabase/migrations/20261022000000.)
 *
 * `extra` is added to the detail after a blank line, e.g. where a cover came
 * from, so the operator has it whatever the reader wrote.
 */
export async function fileReport(
  client: SupabaseClient<Database>,
  reporterId: string,
  target: { kind: ReportKind; id: string; extra?: string },
  reason: ReportReason,
  detail: string,
): Promise<
  { result: "sent"; report: FiledReport } | { result: "already" | "failed" }
> {
  const extra = target.extra?.trim() ?? "";
  const words = detail
    .trim()
    .slice(0, REPORT_DETAIL_MAX - (extra ? extra.length + 2 : 0));
  const { data, error } = await client
    .from("reports")
    .insert({
      reporter_id: reporterId,
      target_kind: target.kind,
      target_id: target.id,
      reason,
      detail: [words, extra].filter(Boolean).join("\n\n"),
    })
    .select(REPORT_COLUMNS)
    .single();
  const report = !error && data ? filedReportFrom(data) : null;
  if (report) return { result: "sent", report };
  return { result: error?.code === "23505" ? "already" : "failed" };
}
