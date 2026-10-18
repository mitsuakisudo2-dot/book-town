import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// 不具合と要望 (supabase/migrations/*_site_reports.sql): a signed-in reader
// sends one; staff read them, the newest first, a page at a time. The table
// is not served by the API, only these two functions.

type Client = SupabaseClient<Database>;

export type SiteReportKind = "bug" | "wish" | "other";

export const SITE_REPORT_KINDS: readonly SiteReportKind[] = [
  "bug",
  "wish",
  "other",
];

/** What staff see of a report. */
export type SiteReport = {
  id: string;
  kind: SiteReportKind;
  body: string;
  page: string;
  device: string;
  createdAt: string;
  /** The sender's @ID; null once their profile is gone. */
  handle: string | null;
};

/** The database's page of reports; the next page starts before the last one's time. */
export const SITE_REPORTS_PAGE = 30;

/**
 * Sends a report. "limit" when the sender, or everyone together, has sent
 * as many as the database takes for now.
 */
export async function sendSiteReport(
  client: Client,
  report: {
    kind: SiteReportKind;
    body: string;
    page: string;
    device: string;
    build: string | null;
  },
): Promise<"sent" | "limit" | "failed"> {
  const { error } = await client.rpc("send_site_report", {
    p_kind: report.kind,
    p_body: report.body,
    p_page: report.page,
    p_device: report.device,
    p_build: report.build ?? "",
  });
  if (!error) return "sent";
  return error.code === "23514" ? "limit" : "failed";
}

/** Staff's page of reports, the newest first; empty for anyone else. */
export async function loadSiteReports(
  client: Client,
  before: string | null,
): Promise<SiteReport[]> {
  const { data, error } = await client.rpc(
    "site_reports",
    before ? { p_before: before } : {},
  );
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: SITE_REPORT_KINDS.includes(row.kind as SiteReportKind)
      ? (row.kind as SiteReportKind)
      : "other",
    body: row.body,
    page: row.page,
    device: row.device,
    createdAt: row.created_at,
    handle: row.handle || null,
  }));
}
