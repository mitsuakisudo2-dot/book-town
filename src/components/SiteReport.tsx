"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccountState } from "../lib/account-session";
import { useKeptDraft } from "../lib/kept-draft";
import { draftOwner } from "../lib/draft-owner";
import {
  siteReportDrafts,
  type SiteReportWork,
} from "../lib/site-report-draft";
import { BUILD_COMMIT, deviceLabel } from "../lib/site-notes";
import { useCanAnnotate } from "../lib/site-notes-session";
import { getSupabase } from "../lib/supabase/client";
import { supabaseConfigured } from "../lib/supabase/config";
import {
  loadSiteReports,
  sendSiteReport,
  SITE_REPORTS_PAGE,
  type SiteReport,
  type SiteReportKind,
} from "../lib/supabase/site-reports";
import { formatPostTime } from "../lib/social";
import { SITE_REPORT_MAX_LENGTH } from "../lib/types";
import { AGAIN, failure, KEPT, NAMES } from "../lib/words";
import { KeptDraftNote, StopConfirm, useOpenedWithWork } from "./KeptDraftNote";
import { Modal } from "./ui";
import "./report.css";

// 不具合と要望 (management table 47): a signed-in reader tells the operator
// what does not work or what they would like, from the settings. Staff read
// what came in, the newest first. Nothing here asks anything of the reader:
// it is there for whoever wants it.

/** How each kind is offered to the sender, and named to staff. */
const KINDS: { value: SiteReportKind; label: string; staff: string }[] = [
  { value: "bug", label: "うまく動かない", staff: "不具合" },
  { value: "wish", label: "こうだったらいい", staff: "要望" },
  { value: "other", label: "そのほか", staff: "そのほか" },
];

/**
 * The settings' entry: for a signed-in reader of a build with a database.
 * `open` shows the form, or for staff the list of what came in.
 */
export function SiteReportEntry({
  open,
}: {
  open: (sheet: "site-report" | "site-reports") => void;
}) {
  const account = useAccountState();
  const staff = useCanAnnotate();
  if (!supabaseConfigured || account.status !== "signed-in") return null;
  return (
    <fieldset className="leave-entry site-report-entry">
      <legend>{`${NAMES.service}に伝える`}</legend>
      <button
        type="button"
        className="btn quiet"
        onClick={() => open("site-report")}
      >
        不具合・要望を送る
      </button>
      {staff && (
        <button
          type="button"
          className="btn quiet"
          onClick={() => open("site-reports")}
        >
          届いた不具合・要望
        </button>
      )}
    </fieldset>
  );
}

type Phase = "form" | "sending" | "sent" | "limit" | "failed";

/**
 * What the reader picks and writes is kept in this browser until the report
 * is received: closing by a tap, Escape, ✕ or 戻る loses nothing. やめる
 * throws it away (asked once when words would be lost).
 */
export function SiteReportForm({ onClose }: { onClose: () => void }) {
  const account = useAccountState();
  const owner = account.status === "signed-in" ? draftOwner(account) : null;
  const { draft, saved, loaded, set, clear } = useKeptDraft(
    siteReportDrafts,
    owner,
  );
  const continuing = useOpenedWithWork(loaded, draft !== null);
  const work: SiteReportWork = draft ?? { kind: null, body: "" };
  const change = (patch: Partial<SiteReportWork>) => {
    const next = { ...work, ...patch };
    set(next.kind === null && !next.body ? null : next);
  };
  const [phase, setPhase] = useState<Phase>("form");
  const [stopping, setStopping] = useState(false);
  const ready = work.body.trim() !== "";
  const stop = () => {
    clear();
    onClose();
  };

  async function send() {
    const client = getSupabase();
    if (!ready || !client) {
      setPhase("failed");
      return;
    }
    setPhase("sending");
    const result = await sendSiteReport(client, {
      kind: work.kind ?? "other",
      body: work.body.trim(),
      page: window.location.pathname,
      device: deviceLabel(navigator.userAgent, navigator.maxTouchPoints),
      build: BUILD_COMMIT,
    });
    // Received: nothing is left to keep. Anything else keeps it.
    if (result === "sent") clear();
    setPhase(result);
  }

  return (
    <Modal title="不具合・要望を送る" onClose={onClose} writing>
      {phase === "sent" ? (
        <>
          <p className="modal-lead">
            受け付けました。知らせてくださって、ありがとうございます。
          </p>
          <button className="btn" onClick={onClose}>
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
          <div
            className="chips site-report-kinds"
            role="group"
            aria-label="種類"
          >
            {KINDS.map((kind) => (
              <button
                type="button"
                key={kind.value}
                className="chip"
                aria-pressed={work.kind === kind.value}
                onClick={() =>
                  change({ kind: work.kind === kind.value ? null : kind.value })
                }
              >
                {kind.label}
              </button>
            ))}
          </div>
          <label className="form-label">
            伝えたいこと
            <textarea
              className="field"
              rows={5}
              required
              maxLength={SITE_REPORT_MAX_LENGTH}
              value={work.body}
              onChange={(event) => change({ body: event.target.value })}
            />
          </label>
          <KeptDraftNote
            continuing={continuing && draft !== null}
            saved={saved}
            wordsLost={work.body.trim() !== ""}
            onDiscard={clear}
          />
          <p className="muted report-note">
            運営だけが読みます。メールアドレスや電話番号は伏せて届きます。
          </p>
          {(phase === "failed" || phase === "limit") && (
            <p className="profile-link-error" role="alert">
              {failure({
                what: phase === "limit" ? "今は送れません" : "送れませんでした",
                kept: KEPT.draft,
                next: AGAIN.later,
              })}
            </p>
          )}
          {stopping ? (
            <StopConfirm onDiscard={stop} onKeep={onClose} />
          ) : (
            <div className="report-actions writing-toolbar">
              <button
                className="btn fill"
                type="submit"
                disabled={!ready || phase === "sending"}
              >
                {phase === "sending" ? "送っています…" : "送る"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => (work.body.trim() ? setStopping(true) : stop())}
              >
                やめる
              </button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

/** For staff: what came in, the newest first, a page at a time. */
export function SiteReportList({ onClose }: { onClose: () => void }) {
  const [reports, setReports] = useState<SiteReport[] | null>(null);
  const [more, setMore] = useState(false);
  const [trouble, setTrouble] = useState(false);

  const load = useCallback(async (before: string | null) => {
    const client = getSupabase();
    if (!client) return setTrouble(true);
    setTrouble(false);
    try {
      const page = await loadSiteReports(client, before);
      setReports((shown) => [...(before ? (shown ?? []) : []), ...page]);
      setMore(page.length === SITE_REPORTS_PAGE);
    } catch {
      setTrouble(true);
    }
  }, []);
  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <Modal title="届いた不具合・要望" onClose={onClose} wide>
      {reports && reports.length === 0 && (
        <p className="modal-lead">まだ届いていません。</p>
      )}
      {reports && reports.length > 0 && (
        <ul className="site-report-list">
          {reports.map((report) => (
            <li key={report.id}>
              <p className="site-report-meta">
                <b>{KINDS.find((kind) => kind.value === report.kind)?.staff}</b>
                {[
                  formatPostTime(report.createdAt),
                  report.handle ? "@" + report.handle : null,
                  report.device || null,
                  report.page || null,
                ]
                  .filter(Boolean)
                  .join(" ・ ")}
              </p>
              <p className="site-report-body">{report.body}</p>
            </li>
          ))}
        </ul>
      )}
      {trouble && (
        <p className="profile-link-error" role="alert">
          {failure({ what: "読み込めませんでした", next: AGAIN.later })}
        </p>
      )}
      {(more || trouble) && (
        <button
          type="button"
          className="btn"
          onClick={() => void load(reports?.at(-1)?.createdAt ?? null)}
        >
          {trouble ? "もう一度読む" : "前のものを見る"}
        </button>
      )}
    </Modal>
  );
}
