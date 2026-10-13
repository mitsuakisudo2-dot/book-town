"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CODE_LENGTH,
  MINIMUM_AGE,
  NAME_MAX_LENGTH,
  failureMessages,
  linkFailure,
  normalizeCode,
  normalizeEmail,
} from "../lib/account";
import { accountActions, useAccountState } from "../lib/account-session";
import {
  HANDLE_FIELD_MAX_LENGTH,
  SENT_CODE,
  profileWorkStore,
  sentCodeStore,
  type ProfileWork,
} from "../lib/account-draft";
import { useKeptDraft } from "../lib/kept-draft";
import { adoptVisitorRecords } from "../lib/record-draft";
import { Icon } from "./ui";
import { KeptDraftNote } from "./KeptDraftNote";
import "./profile.css";
import "./reading.css";
import "./account.css";

/** Sign-in with a code from email, then the first profile. One page for both. */
export default function AccountView() {
  const account = useAccountState();
  // The step reached in signing in is kept only while signed out.
  useEffect(() => {
    if (account.status === "loading" || account.status === "signed-out")
      sentCodeStore.initialize();
    else sentCodeStore.clear(SENT_CODE);
  }, [account.status]);
  // What a visitor wrote about a finished book before being asked to sign in
  // goes with them into the account (every sign-in ends on this page).
  const userId =
    account.status === "signed-in" || account.status === "needs-profile"
      ? account.user.id
      : null;
  useEffect(() => {
    if (userId) adoptVisitorRecords(userId);
  }, [userId]);
  return (
    <main className="account-page">
      <Link href="/" className="account-brand">
        <Icon name="store" size={26} />
        <span>Book Town</span>
      </Link>
      <section className="account-card" aria-live="polite">
        {account.status === "demo" && <DemoNotice />}
        {account.status === "loading" && (
          <p className="account-lead">ログインの状態を確かめています…</p>
        )}
        {account.status === "signed-out" && <SignIn />}
        {account.status === "needs-profile" && (
          <FirstProfile userId={account.user.id} />
        )}
        {account.status === "unavailable" && <Unavailable />}
        {account.status === "signed-in" && (
          <SignedIn
            handle={account.profile.handle}
            name={account.profile.name}
          />
        )}
      </section>
    </main>
  );
}

function DemoNotice() {
  return (
    <>
      <h1>ログインは準備中です</h1>
      <p className="account-lead">
        いまは、このブラウザだけに保存されるデモの街です。最初の店主のみなさんを招待する準備ができたら、ここからログインできるようになります。
      </p>
      <Link className="button primary" href="/">
        本の街へ
      </Link>
    </>
  );
}

function SignIn() {
  // The address the code went to, kept through a reload while the code works.
  const sent = useKeptDraft(sentCodeStore, SENT_CODE);
  const sentTo = sent.draft?.email ?? "";
  // What is typed; until then, the address the code went to.
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? sentTo;
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A link from the email that did not work lands here with its reason.
  useEffect(() => {
    const failure = linkFailure(window.location.hash);
    if (!failure) return;
    setError(failureMessages[failure]);
    history.replaceState(null, "", location.pathname + location.search);
  }, []);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    const result = await accountActions.sendCode(email);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    sent.set({ email: normalizeEmail(email), sentAt: Date.now() });
    setCode("");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await accountActions.verifyCode(sentTo, code);
    setBusy(false);
    // Once the code works, the step stays until the account says who signed
    // in (the profile is read first); AccountView then forgets it.
    if (!result.ok) setError(result.message);
  }

  if (!sentTo)
    return (
      <>
        <h1>本の街に入る</h1>
        <p className="account-lead">
          招待を受けたメールアドレスを入れてください。ログイン用のメールを送ります。パスワードはいりません。
        </p>
        <form className="profile-form" onSubmit={send}>
          <label htmlFor="account-email">メールアドレス</label>
          <input
            id="account-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setTyped(event.target.value)}
            aria-describedby={error ? "account-error" : undefined}
            autoFocus
          />
          <ErrorLine message={error} />
          <button className="button primary" disabled={busy || !email.trim()}>
            {busy ? "送っています…" : "コードを送る"}
          </button>
        </form>
      </>
    );

  return (
    <>
      <h1>メールを確かめてください</h1>
      <p className="account-lead">
        <b>{sentTo}</b>{" "}
        にメールを送りました。メールのリンクを開くと、そのままログインできます。
        {CODE_LENGTH}
        桁のコードが書かれていれば、ここに入れてもかまいません。届かないときは、迷惑メールのフォルダも見てください。
      </p>
      <form className="profile-form" onSubmit={verify}>
        <label htmlFor="account-code">{CODE_LENGTH}桁のコード</label>
        <input
          id="account-code"
          className="account-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          required
          value={code}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
          aria-describedby={error ? "account-error" : undefined}
          autoFocus
        />
        <ErrorLine message={error} />
        <button
          className="button primary"
          disabled={busy || code.length !== CODE_LENGTH}
        >
          {busy ? "確かめています…" : "ログインする"}
        </button>
      </form>
      <div className="account-links">
        <button type="button" onClick={() => send()} disabled={busy}>
          コードを送り直す
        </button>
        <button
          type="button"
          onClick={() => {
            setTyped(sentTo);
            sent.clear();
            setError("");
          }}
        >
          メールアドレスを変える
        </button>
      </div>
    </>
  );
}

const NO_PROFILE_WORK: ProfileWork = { name: "", handle: "" };

function FirstProfile({ userId }: { userId: string }) {
  // The name and the ID typed so far are kept through a reload, by person.
  const kept = useKeptDraft(profileWorkStore, userId);
  const work = kept.draft ?? NO_PROFILE_WORK;
  const { name, handle } = work;
  // Whether the form opened on work kept from before, said once.
  const [resumed, setResumed] = useState<boolean | null>(null);
  const change = (patch: Partial<ProfileWork>) => {
    const next = { ...work, ...patch };
    kept.set(next);
    // Emptied by hand, what is typed next is new work, not kept work.
    if (!next.name.trim() && !next.handle.trim()) setResumed(false);
  };
  const hasWork = kept.draft !== null;
  useEffect(() => {
    if (kept.loaded && resumed === null) setResumed(hasWork);
  }, [kept.loaded, resumed, hasWork]);
  const nameField = useRef<HTMLInputElement>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // Records start private; each one can be published, and is told when it is.
  const [readingPublic, setReadingPublic] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await accountActions.createProfile({
      handle,
      name,
      ageConfirmed,
      readingPublic,
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else kept.clear();
  }

  return (
    <>
      <h1>ようこそ、本の街へ</h1>
      <p className="account-lead">
        街で呼ばれる名前と、あなたのIDを決めてください。どちらもあとから変えられます。
      </p>
      <KeptDraftNote
        className="account-kept"
        work={hasWork}
        continuing={Boolean(resumed)}
        saved={kept.saved}
        wordsLost
        onDiscard={() => {
          kept.clear();
          setResumed(false);
          nameField.current?.focus();
        }}
      />
      <form className="profile-form" onSubmit={create}>
        <label htmlFor="account-name">ユーザー名</label>
        <input
          id="account-name"
          ref={nameField}
          autoComplete="nickname"
          required
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => change({ name: event.target.value })}
          autoFocus
        />
        <label htmlFor="account-handle">ユーザーID</label>
        <div className="profile-handle-field">
          <span aria-hidden="true">@</span>
          <input
            id="account-handle"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={HANDLE_FIELD_MAX_LENGTH}
            value={handle}
            onChange={(event) => change({ handle: event.target.value })}
            aria-describedby="account-handle-hint"
          />
        </div>
        <p id="account-handle-hint" className="profile-form-hint">
          3〜20文字の半角英小文字・数字・_。ほかの読書家と同じIDは使えません。
        </p>
        <label className="account-check">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(event) => setAgeConfirmed(event.target.checked)}
          />
          {MINIMUM_AGE}歳以上です
        </label>
        <fieldset className="account-choice">
          <legend>読み終えた本の記録</legend>
          <label>
            <input
              type="radio"
              name="reading-visibility"
              checked={!readingPublic}
              onChange={() => setReadingPublic(false)}
            />
            <span>
              <b>自分だけ</b>
              記録はあなたにだけ見えます。1冊ずつ公開にもできます。
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="reading-visibility"
              checked={readingPublic}
              onChange={() => setReadingPublic(true)}
            />
            <span>
              <b>公開する</b>
              同じ本を読んだ人と出会えます。公開したときは、毎回お知らせします。
            </span>
          </label>
        </fieldset>
        <ErrorLine message={error} />
        <button className="button primary" disabled={busy}>
          {busy ? "準備しています…" : "はじめる"}
        </button>
      </form>
    </>
  );
}

function Unavailable() {
  return (
    <>
      <h1>つながりませんでした</h1>
      <p className="account-lead">
        ログインはできていますが、プロフィールを読み込めませんでした。通信の状態を確かめて、もう一度お試しください。
      </p>
      <button
        className="button primary"
        onClick={() => void accountActions.retry()}
      >
        もう一度読み込む
      </button>
      <div className="account-links">
        <button type="button" onClick={() => void accountActions.signOut()}>
          ログアウト
        </button>
      </div>
    </>
  );
}

function SignedIn({ handle, name }: { handle: string; name: string }) {
  return (
    <>
      <h1>ログインしています</h1>
      <p className="account-lead">
        {name}（@{handle}）さんとして、本の街にいます。
      </p>
      <Link className="button primary" href="/">
        本の街へ
      </Link>
      <div className="account-links">
        <button type="button" onClick={() => void accountActions.signOut()}>
          ログアウト
        </button>
      </div>
    </>
  );
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p id="account-error" className="profile-link-error" role="alert">
      {message}
    </p>
  );
}
