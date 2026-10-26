"use client";

import { useState, type FormEvent } from "react";
import { publishDraftIssue, NAME_MAX_LENGTH } from "../lib/account";
import { accountActions, useAccountState } from "../lib/account-session";
import {
  HANDLE_FIELD_MAX_LENGTH,
  profileWorkStore,
  type ProfileWork,
} from "../lib/account-draft";
import { handleProblem, normalizeHandle } from "../lib/handles";
import { useKeptDraft } from "../lib/kept-draft";
import { answerName, useNameRequest } from "../lib/public-profile";
import type { Notify, TownActions, TownState } from "../lib/types";
import { Modal } from "./ui";
import "./profile.css";
import "./name-sheet.css";

const NO_WORK: ProfileWork = { name: "", handle: "" };

/**
 * The small sheet a reader with no public profile meets the first time they
 * do something that reaches people (管理表 99, decision 5): a name and an ID,
 * then what they did goes on. What they typed is kept through a reload, as a
 * first profile's is.
 */
export function NameSheet({
  state,
  actions,
  notify,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
}) {
  const open = useNameRequest();
  const account = useAccountState();
  const userId = account.status === "signed-in" ? account.user.id : null;
  const kept = useKeptDraft(profileWorkStore, userId);
  // In the demo there is no one to keep it for: it lives as long as the sheet.
  const [local, setLocal] = useState(NO_WORK);
  const work = userId ? (kept.draft ?? NO_WORK) : local;
  const change = (patch: Partial<ProfileWork>) => {
    const next = { ...work, ...patch };
    if (userId) kept.set(next);
    else setLocal(next);
    setError("");
  };
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  function close() {
    setError("");
    answerName(false);
  }

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const handle = normalizeHandle(work.handle);
    const problem =
      publishDraftIssue(work)?.message ?? handleProblem(handle, state.readers);
    if (problem) return setError(problem);
    // With an account, the database says first whether the ID is free, so
    // what goes on after is never turned away for want of a name.
    if (account.status === "signed-in") {
      setBusy(true);
      const result = await accountActions.publishProfile(work);
      setBusy(false);
      if (!result.ok) return setError(result.message);
    }
    if (!actions.publishProfile(work.name, handle))
      return setError("名前とIDを確かめてください。");
    if (userId) kept.clear();
    else setLocal(NO_WORK);
    notify(`${work.name.trim()}（@${handle}）として、人とつながれます`);
    answerName(true);
  }

  return (
    <Modal title="名前を決めて、人とつながる" onClose={close}>
      <form className="profile-form name-sheet" onSubmit={decide} noValidate>
        <p className="name-sheet-lead">
          ここから先は、ほかの読書家に届きます。街で呼ばれる名前と、あなたのIDを決めてください。どちらもあとから変えられます。
        </p>
        <label htmlFor="name-sheet-name">ユーザー名</label>
        <input
          id="name-sheet-name"
          autoComplete="nickname"
          maxLength={NAME_MAX_LENGTH}
          value={work.name}
          onChange={(event) => change({ name: event.target.value })}
        />
        <label htmlFor="name-sheet-handle">ユーザーID</label>
        <div className="profile-handle-field">
          <span aria-hidden="true">@</span>
          <input
            id="name-sheet-handle"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={HANDLE_FIELD_MAX_LENGTH}
            value={work.handle}
            onChange={(event) => change({ handle: event.target.value })}
            aria-describedby="name-sheet-hint"
          />
        </div>
        <p id="name-sheet-hint" className="profile-form-hint">
          3〜20文字の半角英小文字・数字・_。ほかの読書家と同じIDは使えません。
        </p>
        <p className="name-sheet-note">
          これまでに入れた本と記録は、あなただけのままです。
        </p>
        {error && (
          <p className="profile-link-error" role="alert">
            {error}
          </p>
        )}
        <div className="btns">
          <button className="btn fill" disabled={busy}>
            {busy ? "決めています…" : "決めて続ける"}
          </button>
          <button type="button" className="btn quiet" onClick={close}>
            やめる
          </button>
        </div>
      </form>
    </Modal>
  );
}
