"use client";
import { useState, type ReactNode } from "react";
import { useAccountState } from "../lib/account-session";
import { isDatabaseId } from "../lib/paths";
import { closeReport, openReport, useReportTarget } from "../lib/report";
import type { ReportTarget } from "../lib/report";
import { useTownBackend } from "../lib/store";
import { getSupabase } from "../lib/supabase/client";
import {
  fileReport,
  REPORT_DETAIL_MAX,
  type ReportReason,
} from "../lib/supabase/reports";
import { requestAccount } from "../lib/visitor";
import { Icon, Modal } from "./ui";
import "./report.css";

const REASONS: { value: ReportReason; label: string; postsOnly?: boolean }[] = [
  { value: "spam", label: "宣伝・スパム" },
  { value: "harassment", label: "嫌がらせ・攻撃的な言葉" },
  { value: "spoiler", label: "目印のないネタバレ", postsOnly: true },
  { value: "inappropriate", label: "不適切な内容" },
  { value: "other", label: "その他" },
];

/**
 * A quiet link to report a post, a shop or a person. Shown only for records in
 * the database; a visitor is invited to sign in instead.
 */
export function ReportButton({
  target,
  className = "report-button",
  onOpen,
  children = "通報",
}: {
  target: ReportTarget;
  className?: string;
  /** Called first, e.g. to close the menu the button sits in. */
  onOpen?: () => void;
  children?: ReactNode;
}) {
  const savedIn = useTownBackend();
  if (!isDatabaseId(target.id)) return null;
  if (savedIn !== "account" && savedIn !== "visitor") return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onOpen?.();
        if (savedIn === "visitor") requestAccount();
        else openReport(target);
      }}
    >
      {children}
    </button>
  );
}

type Phase = "form" | "sending" | "sent" | "already" | "failed";

/** The one report dialog of the page; ReportButton opens it. */
export function ReportDialog() {
  const target = useReportTarget();
  if (!target) return null;
  // A new target starts a fresh form.
  return <ReportForm key={target.kind + target.id} target={target} />;
}

function ReportForm({ target }: { target: ReportTarget }) {
  const account = useAccountState();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const done = phase === "sent" || phase === "already";

  async function send() {
    const client = getSupabase();
    if (!reason || !client || account.status !== "signed-in") {
      setPhase("failed");
      return;
    }
    setPhase("sending");
    setPhase(await fileReport(client, account.user.id, target, reason, detail));
  }

  return (
    <Modal title="通報する" onClose={closeReport}>
      {done ? (
        <>
          <p className="modal-lead">
            {phase === "sent"
              ? "受け付けました。知らせてくださって、ありがとうございます。"
              : "これについては、すでに通報を受け付けています。"}
          </p>
          <p className="muted">
            運営が内容を確かめて、必要なら非表示にします。通報したことが相手に知らされることはありません。
          </p>
          <button className="button secondary" onClick={closeReport}>
            閉じる
          </button>
        </>
      ) : (
        <form
          className="report-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <p className="modal-lead">
            「{target.name}」について、運営に知らせます。
          </p>
          <fieldset className="report-reasons">
            <legend>理由</legend>
            {REASONS.filter(
              (entry) => !entry.postsOnly || target.kind === "post",
            ).map((entry) => (
              <label key={entry.value}>
                <input
                  type="radio"
                  name="report-reason"
                  checked={reason === entry.value}
                  onChange={() => setReason(entry.value)}
                />
                {entry.label}
              </label>
            ))}
          </fieldset>
          <label className="form-label">
            くわしく（なくても大丈夫です）
            <textarea
              className="field"
              rows={3}
              maxLength={REPORT_DETAIL_MAX}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
          <p className="muted report-note">
            通報したことが相手に知らされることはありません。運営が確かめて、必要なら非表示にします。
          </p>
          {phase === "failed" && (
            <p className="profile-link-error" role="alert">
              送れませんでした。時間をおいて、もう一度お試しください。
            </p>
          )}
          <div className="report-actions">
            <button
              className="button primary"
              type="submit"
              disabled={!reason || phase === "sending"}
            >
              <Icon name="flag" size={16} />
              {phase === "sending" ? "送っています…" : "通報する"}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={closeReport}
            >
              やめる
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
