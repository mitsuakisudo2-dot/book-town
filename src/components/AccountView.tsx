"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  CODE_LENGTH,
  MINIMUM_AGE,
  NAME_MAX_LENGTH,
  normalizeCode,
  normalizeEmail,
} from "../lib/account";
import { accountActions, useAccountState } from "../lib/account-session";
import { normalizeHandle } from "../lib/handles";
import { useTownStore } from "../lib/store";
import { Icon } from "./ui";
import "./profile.css";
import "./reading.css";
import "./account.css";

/** Sign-in with a code from email, then the first profile. One page for both. */
export default function AccountView() {
  const account = useAccountState();
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
        {account.status === "needs-profile" && <FirstProfile />}
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
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    const result = await accountActions.sendCode(email);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSentTo(normalizeEmail(email));
    setCode("");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await accountActions.verifyCode(sentTo, code);
    setBusy(false);
    if (!result.ok) setError(result.message);
  }

  if (!sentTo)
    return (
      <>
        <h1>本の街に入る</h1>
        <p className="account-lead">
          招待を受けたメールアドレスを入れてください。6桁のコードを送ります。パスワードはいりません。
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
            onChange={(event) => setEmail(event.target.value)}
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
      <h1>コードを入れてください</h1>
      <p className="account-lead">
        <b>{sentTo}</b> に{CODE_LENGTH}
        桁のコードを送りました。届かないときは、迷惑メールのフォルダも見てください。
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
            setSentTo("");
            setError("");
          }}
        >
          メールアドレスを変える
        </button>
      </div>
    </>
  );
}

function FirstProfile() {
  const { state, actions } = useTownStore();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
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
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    // Until the shops and posts move to the database, the demo town shows the
    // same name (and ID, unless a demo reader already uses it).
    const nextHandle = normalizeHandle(handle);
    if (
      !actions.updateProfile(
        name.trim(),
        state.me.bio,
        state.me.links,
        nextHandle,
      )
    )
      actions.updateProfile(name.trim(), state.me.bio, state.me.links);
  }

  return (
    <>
      <h1>ようこそ、本の街へ</h1>
      <p className="account-lead">
        街で呼ばれる名前と、あなたのIDを決めてください。どちらもあとから変えられます。
      </p>
      <form className="profile-form" onSubmit={create}>
        <label htmlFor="account-name">ユーザー名</label>
        <input
          id="account-name"
          autoComplete="nickname"
          required
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
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
            maxLength={21}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
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
