"use client";
import { useState, type FormEvent } from "react";
import { accountActions } from "../lib/account-session";
import { AgreeToTerms } from "./LegalLinks";
import { Modal } from "./ui";
import "./account.css";

/**
 * The terms and the privacy page, asked once of a reader who has not agreed
 * to them (TermsGate). Agreed, it goes for good; closed, it asks again the
 * next time the town opens. The two pages open from the box's words.
 */
export function TermsAsk({
  version,
  onDone,
}: {
  version: string;
  onDone: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function agree(event: FormEvent) {
    event.preventDefault();
    if (!agreed) return;
    setBusy(true);
    setError("");
    const result = await accountActions.agreeToTerms(version);
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.message);
  }
  return (
    <Modal title="利用規約とプライバシー" onClose={onDone}>
      <form className="terms-ask" onSubmit={agree}>
        <p>
          BookTownの利用規約と、読書家の情報の扱い（プライバシー）をまとめました。目を通して、同意をお願いします。
        </p>
        <AgreeToTerms checked={agreed} onChange={setAgreed} />
        {error && (
          <p className="terms-ask-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn fill" disabled={busy || !agreed}>
          同意する
        </button>
      </form>
    </Modal>
  );
}
