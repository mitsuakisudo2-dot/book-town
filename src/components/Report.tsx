"use client";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAccountState } from "../lib/account-session";
import { useCover } from "../lib/covers";
import { isDatabaseId } from "../lib/paths";
import type { Book } from "../lib/types";
import { closeReport, openReport, useReportTarget } from "../lib/report";
import type { ReportTarget } from "../lib/report";
import { townActions, useTownBackend } from "../lib/store";
import { getSupabase } from "../lib/supabase/client";
import {
  fileReport,
  REPORT_DETAIL_MAX,
  type ReportReason,
} from "../lib/supabase/reports";
import { requestAccount } from "../lib/visitor";
import { Icon, Modal } from "./ui";
import "./report.css";

// A spoiler is asked about with 「ネタバレでは？」 instead, which folds a post
// rather than hiding it. Personal information and threats act at once (when
// the reporter's account is a week old), so they are named on their own.
const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "宣伝・スパム" },
  { value: "harassment", label: "嫌がらせ・攻撃的な言葉" },
  { value: "personal_info", label: "個人情報をさらしている" },
  { value: "threat", label: "脅し・危害を加えるという言葉" },
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

/**
 * Beside a cover's credit, for a real cover (openBD or Google) of a book in
 * the database: a rights holder can ask for it not to be shown here. Where
 * the cover came from is added for the operator.
 *
 * Signed-in readers only. Sign-in is by invitation, so a visitor (a rights
 * holder without an account, most likely) could only be sent to a sign-in
 * they cannot complete; there is no other way to ask yet.
 */
export function CoverRemovalLink({ book }: { book: Book }) {
  const savedIn = useTownBackend();
  const cover = useCover(book.coverUrl ? undefined : book.isbn);
  if (!cover || !book.isbn || savedIn !== "account") return null;
  return (
    <ReportButton
      className="cover-removal-link"
      target={{
        kind: "book",
        id: book.id,
        name: `『${book.title}』の表紙`,
        extra: `表紙の出どころ: ${cover.source === "google" ? "Google Books" : "openBD"} / ISBN ${book.isbn}`,
      }}
    >
      表紙の削除依頼はこちら
    </ReportButton>
  );
}

type Phase = "form" | "sending" | "sent" | "already" | "failed";

/** The one report dialog of the page; ReportButton opens it. */
export function ReportDialog() {
  const target = useReportTarget();
  if (!target) return null;
  // A new target starts a fresh form. Opened from a book in hand (the
  // browser's top layer), the dialog is placed inside it, so it is seen.
  const form = <ReportForm key={target.kind + target.id} target={target} />;
  const openDialog = document.querySelector("dialog[open]");
  return openDialog ? createPortal(form, openDialog) : form;
}

function ReportForm({ target }: { target: ReportTarget }) {
  const account = useAccountState();
  // A report about a book is always a request to take its cover down.
  const cover = target.kind === "book";
  const [reason, setReason] = useState<ReportReason | null>(
    cover ? "cover" : null,
  );
  const [detail, setDetail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const done = phase === "sent" || phase === "already";
  const ready = reason !== null && (!cover || detail.trim() !== "");

  async function send() {
    const client = getSupabase();
    if (!ready || !client || account.status !== "signed-in") {
      setPhase("failed");
      return;
    }
    setPhase("sending");
    const filed = await fileReport(
      client,
      account.user.id,
      target,
      reason,
      detail,
    );
    // The reporter's own list (お知らせ「あなたの通報」) has it at once, and a
    // post they reported folds on their screen.
    if (filed.result === "sent") townActions.noteReport(filed.report);
    setPhase(filed.result);
  }

  return (
    <Modal
      title={cover ? "表紙の削除を依頼する" : "通報する"}
      onClose={closeReport}
    >
      {done ? (
        <>
          {phase === "sent" ? (
            cover ? (
              <p className="modal-lead">
                受け付けました。運営が確認を始めたときと、確認し終えたときに、お知らせでお伝えします。
              </p>
            ) : (
              <>
                <p className="modal-lead">
                  受け付けました。知らせてくださって、ありがとうございます。
                </p>
                <p className="muted">
                  運営が確認を始めたときと、確認し終えたときに、お知らせでお伝えします。相手への対応の中身は、お伝えしていません。
                </p>
                {(target.kind === "post" || target.kind === "poster") && (
                  <p className="muted">
                    この投稿は、あなたの画面ではたたんでおきます。
                  </p>
                )}
              </>
            )
          ) : (
            <p className="modal-lead">
              これについては、すでに通報を受け付けています。
            </p>
          )}
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
            {cover
              ? `${target.name}を、BookTown に出さないよう運営に依頼します。`
              : `「${target.name}」について、運営に知らせます。`}
          </p>
          {!cover && (
            <fieldset className="report-reasons">
              <legend>理由</legend>
              {REASONS.map((entry) => (
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
          )}
          <label className="form-label">
            {cover
              ? "この表紙とのご関係と、依頼の内容（必ず書いてください）"
              : "くわしく（なくても大丈夫です）"}
            <textarea
              className="field"
              rows={cover ? 4 : 3}
              required={cover}
              maxLength={REPORT_DETAIL_MAX}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
          <p className="muted report-note">
            {cover
              ? "運営が確かめて、この本の表紙を出さないようにします。表紙の画像に手を加えることはありません。"
              : "通報したことが相手に知らされることはありません。運営が確かめて、必要なら見えなくします。"}
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
              disabled={!ready || phase === "sending"}
            >
              <Icon name="flag" size={16} />
              {phase === "sending"
                ? "送っています…"
                : cover
                  ? "依頼する"
                  : "通報する"}
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
