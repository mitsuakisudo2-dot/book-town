"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { normalizeHandle } from "../lib/handles";
import { accountActions, useAccountState } from "../lib/account-session";
import { HANDLE_FIELD_MAX_LENGTH } from "../lib/account-draft";
import { cameFromTown } from "../lib/in-town";
import {
  markField,
  useCoarsePointer,
  useFocusFieldOnShow,
} from "../lib/coarse-pointer";
import { Icon } from "./ui";
import "./profile.css";
import "./reading.css";
import "./account.css";
import "./leave.css";
import { failure, AGAIN, NOT_CONNECTED } from "../lib/words";

/**
 * 退会: the reader deletes their account here, from the web. Everything
 * they made goes with it (docs/09 「退会」), so the page says what goes and
 * asks for their ID before the one button that does it.
 */
export default function LeaveView() {
  const account = useAccountState();
  // Once gone, the page says so, though the account now reads signed out.
  const [left, setLeft] = useState(false);
  return (
    <main className="account-page">
      <Link href="/" className="account-brand">
        <Icon name="store" size={26} />
        <span>Book Town</span>
      </Link>
      <section className="account-card leave-card" aria-live="polite">
        {left ? (
          <Left />
        ) : account.status === "demo" ? (
          <>
            <h1>退会</h1>
            <p className="account-lead">
              いまは、このブラウザだけに保存されるデモの街です。消すアカウントはありません。
            </p>
            <Link className="btn fill" href="/">
              本の街へ
            </Link>
          </>
        ) : account.status === "loading" ? (
          <p className="account-lead">ログインの状態を確かめています…</p>
        ) : account.status === "signed-out" ? (
          <>
            <h1>退会</h1>
            <p className="account-lead">
              退会するには、消したいアカウントでログインしてください。
            </p>
            <Link className="btn fill" href="/login/">
              ログインする
            </Link>
          </>
        ) : account.status === "unavailable" ? (
          <>
            <h1>{NOT_CONNECTED}</h1>
            <p className="account-lead">
              {failure({
                what: "アカウントを読み込めませんでした",
                next: AGAIN.connection,
              })}
            </p>
            <button
              type="button"
              className="btn fill"
              onClick={() => void accountActions.retry()}
            >
              もう一度読み込む
            </button>
          </>
        ) : (
          <LeaveForm
            profile={account.status === "signed-in" ? account.profile : null}
            onLeft={() => setLeft(true)}
          />
        )}
      </section>
    </main>
  );
}

function LeaveForm({
  profile,
  onLeft,
}: {
  /** Null for a reader who signed in but has not made a profile yet. */
  profile: { handle: string; name: string } | null;
  onLeft: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The keyboard waits for a tap on a phone (the heading has the focus).
  const coarse = useCoarsePointer();
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useFocusFieldOnShow(field, { instead: heading, when: profile !== null });
  const confirmed =
    profile === null || normalizeHandle(typed) === profile.handle;

  async function leave(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    // Told before the account reads signed out, so that never shows.
    const result = await accountActions.deleteAccount(typed, onLeft);
    if (result.ok) return;
    setBusy(false);
    setError(result.message);
    if (coarse && !confirmed) markField(field.current);
  }

  function stay() {
    if (cameFromTown()) router.back();
    else router.push("/");
  }

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        退会する
      </h1>
      <p className="account-lead">
        {profile ? (
          <>
            {profile.name}（@{profile.handle}
            ）さんのアカウントと、作ったものをすべて消します。
          </>
        ) : (
          "このアカウントを消します。"
        )}
        消したものは、元に戻せません。
      </p>
      {profile && (
        <>
          <h2 className="leave-heading">消えるもの</h2>
          <ul className="leave-list">
            <li>あなたの本屋（棚・POP・店内の飾りつけ）</li>
            <li>投稿、ポスター、読書の記録、ひとこと</li>
            <li>読みたい本、登録した本、人生の9冊</li>
            <li>フォロー、いいね、保存、書店めぐりの記録</li>
            <li>この端末に残っている書きかけ</li>
          </ul>
          <h2 className="leave-heading">残るもの</h2>
          <p className="leave-note">
            手で入れた本の題名と著者は、本の目録に残ります。入れたのがあなただとは、分からなくなります。
          </p>
        </>
      )}
      <form className="profile-form" onSubmit={leave} noValidate>
        {profile && (
          <>
            <label htmlFor="leave-handle">
              確かめるため、あなたのユーザーID（{profile.handle}
              ）を入れてください
            </label>
            <div className="profile-handle-field">
              <span aria-hidden="true">@</span>
              <input
                id="leave-handle"
                ref={field}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={HANDLE_FIELD_MAX_LENGTH}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setError("");
                }}
                aria-describedby={error ? "leave-error" : undefined}
              />
            </div>
          </>
        )}
        {error && (
          <p id="leave-error" className="profile-link-error" role="alert">
            {error}
          </p>
        )}
        <div className="btns leave-buttons">
          <button className="btn danger fill" disabled={busy || !confirmed}>
            {busy ? "消しています…" : "退会する"}
          </button>
          <button
            type="button"
            className="btn quiet"
            onClick={stay}
            disabled={busy}
          >
            やめる
          </button>
        </div>
      </form>
    </>
  );
}

function Left() {
  return (
    <>
      <h1>退会しました</h1>
      <p className="account-lead">
        あなたのアカウントと、作ったものはすべて消えました。Book Town
        を使ってくださって、ありがとうございました。
      </p>
      <Link className="btn fill" href="/">
        本の街へ
      </Link>
    </>
  );
}
