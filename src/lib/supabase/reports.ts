import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type ReportKind = "post" | "shop" | "profile" | "poster";
export type ReportReason =
  "spam" | "harassment" | "spoiler" | "inappropriate" | "other";

/** The same limit as reports.detail in the database. */
export const REPORT_DETAIL_MAX = 1000;

/**
 * Files a report for the operator, who reads it in the Supabase dashboard.
 * Three open reports from different people hide the thing until it is looked at.
 */
export async function fileReport(
  client: SupabaseClient<Database>,
  reporterId: string,
  target: { kind: ReportKind; id: string },
  reason: ReportReason,
  detail: string,
): Promise<"sent" | "already" | "failed"> {
  const { error } = await client.from("reports").insert({
    reporter_id: reporterId,
    target_kind: target.kind,
    target_id: target.id,
    reason,
    detail: detail.trim().slice(0, REPORT_DETAIL_MAX),
  });
  if (!error) return "sent";
  return error.code === "23505" ? "already" : "failed";
}
