"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CODE_LENGTH,
  MINIMUM_AGE,
  NAME_MAX_LENGTH,
  type Passkey,
  failureMessages,
  linkFailure,
  normalizeCode,
  normalizeEmail,
  profileDraftIssue,
  validEmail,
} from "../lib/account";
import { accountActions, useAccountState } from "../lib/account-session";
import {
  HANDLE_FIELD_MAX_LENGTH,
  SENT_CODE,
  emailChangeStore,
  profileWorkStore,
  sentCodeStore,
  type ProfileWork,
} from "../lib/account-draft";
import { EMAIL_MAX_LENGTH } from "../lib/types";
import { shortDate } from "../lib/japan-time";
import { useUrlParam } from "../lib/url-state";
import { useKeptDraft } from "../lib/kept-draft";
import { adoptVisitorRecords } from "../lib/record-draft";
import { adoptVisitorPosts } from "../lib/post-draft";
import { adoptVisitorPosters } from "../lib/poster-draft";
import { libraryJournal, useJournal } from "../lib/library-journal";
import { forgetOutboxes, useOutboxWaiting } from "../lib/outbox";
import {
  focusField,
  markField,
  useCoarsePointer,
  useFocusFieldOnShow,
} from "../lib/coarse-pointer";
import { Icon } from "./ui";
import { KeptDraftNote } from "./KeptDraftNote";
import { useHumanCheck } from "./HumanCheck";
import "./profile.css";
import "./reading.css";
import "./account.css";
import "./leave.css";
import { counted, failure, AGAIN, NOT_CONNECTED } from "../lib/words";

/** Sign-in with a code from email, then the first profile. One page for both. */
export default function AccountView() {
  const account = useAccountState();
  // The step reached in signing in is kept only while signed out.
  useEffect(() => {
    if (account.status === "loading" || account.status === "signed-out")
      sentCodeStore.initialize();
    else sentCodeStore.clear(SENT_CODE);
  }, [account.status]);
  // What a visitor wrote (about a finished book, a post, a poster) before
  // being asked to sign in goes with them into the account (every sign-in
  // ends on this page).
  const userId =
    account.status === "signed-in" || account.status === "needs-profile"
      ? account.user.id
      : null;
  useEffect(() => {
    if (!userId) return;
    adoptVisitorRecords(userId);
    adoptVisitorPosts(userId);
    adoptVisitorPosters(userId);
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
            userId={account.user.id}
            email={account.user.email}
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
      <Link className="btn fill" href="/">
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
  // Each step starts with its field ready where a mouse points. On a touch
  // screen the field waits for a tap and the step's heading has the focus,
  // and the browser's own check is off, since it would put the focus (and
  // the keyboard) in the field: a field found wrong is marked instead.
  const coarse = useCoarsePointer();
  const heading = useRef<HTMLHeadingElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  useFocusFieldOnShow(emailField, { instead: heading, when: !sentTo });
  useFocusFieldOnShow(codeField, { instead: heading, when: Boolean(sentTo) });
  // Cloudflare's check for the login email and the passkey (turnstile.ts).
  const { boxRef: humanBoxRef, take: humanCheck } = useHumanCheck();

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
    const result = await accountActions.sendCode(email, await humanCheck());
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      if (coarse && !validEmail(normalizeEmail(email)))
        markField(emailField.current);
      return;
    }
    sent.set({ email: normalizeEmail(email), sentAt: Date.now() });
    setCode("");
  }

  // A passkey says whose it is: no address to type, no code to wait for.
  // Its own line: a passkey's failure is not about the address field.
  const [passkeyError, setPasskeyError] = useState("");
  async function signInWithPasskey() {
    setBusy(true);
    setError("");
    setPasskeyError("");
    const result = await accountActions.signInWithPasskey(await humanCheck());
    // Signed in, the page waits for the profile with nothing to press.
    if (result.ok) return;
    setBusy(false);
    setPasskeyError(result.message);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await accountActions.verifyCode(sentTo, code);
    setBusy(false);
    // Once the code works, the step stays until the account says who signed
    // in (the profile is read first); AccountView then forgets it.
    if (!result.ok) {
      setError(result.message);
      if (coarse && normalizeCode(code).length !== CODE_LENGTH)
        markField(codeField.current);
    }
  }

  return (
    <>
      {sentTo ? codeStep() : emailStep()}
      {/* Where Turnstile asks for a tap when it cannot tell; empty
          otherwise. The same box through both steps, since
          コードを送り直す asks too. */}
      <div ref={humanBoxRef} className="account-human-check" />
    </>
  );

  function emailStep() {
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          本の街に入る
        </h1>
        <p className="account-lead">
          招待を受けたメールアドレスを入れてください。ログイン用のメールを送ります。パスワードはいりません。
        </p>
        <form className="profile-form" onSubmit={send} noValidate={coarse}>
          <label htmlFor="account-email">メールアドレス</label>
          <input
            id="account-email"
            ref={emailField}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            onChange={(event) => setTyped(event.target.value)}
            aria-describedby={error ? "account-error" : undefined}
          />
          <ErrorLine message={error} />
          <button className="btn fill" disabled={busy || !email.trim()}>
            {busy ? "送っています…" : "コードを送る"}
          </button>
        </form>
        {passkeysPossible() && (
          <button
            type="button"
            className="btn account-passkey-in"
            onClick={() => void signInWithPasskey()}
            disabled={busy}
          >
            <Icon name="lock" size={18} />
            パスキーでログイン
          </button>
        )}
        <ErrorLine id="account-passkey-error" message={passkeyError} />
      </>
    );
  }

  function codeStep() {
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          メールを確かめてください
        </h1>
        <p className="account-lead">
          <b>{sentTo}</b>{" "}
          にメールを送りました。メールのリンクを開くと、そのままログインできます。
          {CODE_LENGTH}
          桁のコードが書かれていれば、ここに入れてもかまいません。届かないときは、迷惑メールのフォルダも見てください。
        </p>
        <form className="profile-form" onSubmit={verify} noValidate={coarse}>
          <label htmlFor="account-code">{CODE_LENGTH}桁のコード</label>
          <input
            id="account-code"
            ref={codeField}
            className="account-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            required
            value={code}
            onChange={(event) => setCode(normalizeCode(event.target.value))}
            aria-describedby={error ? "account-error" : undefined}
          />
          <ErrorLine message={error} />
          <button
            className="btn fill"
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
  // Ready to type where a mouse points; on a touch screen the name waits for
  // a tap, and a field found wrong is marked instead of focused (SignIn).
  const coarse = useCoarsePointer();
  const heading = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const handleField = useRef<HTMLInputElement>(null);
  const ageField = useRef<HTMLInputElement>(null);
  useFocusFieldOnShow(nameField, { instead: heading });
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // Records start private; each one can be published, and is told when it is.
  const [readingPublic, setReadingPublic] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const draft = { handle, name, ageConfirmed, readingPublic };
    const result = await accountActions.createProfile(draft);
    setBusy(false);
    if (result.ok) return kept.clear();
    setError(result.message);
    const issue = coarse ? profileDraftIssue(draft) : null;
    if (issue)
      markField(
        { handle: handleField, name: nameField, age: ageField }[issue.field]
          .current,
      );
  }

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        ようこそ、本の街へ
      </h1>
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
          focusField(nameField.current, { instead: heading.current });
        }}
      />
      <form className="profile-form" onSubmit={create} noValidate={coarse}>
        <label htmlFor="account-name">ユーザー名</label>
        <input
          id="account-name"
          ref={nameField}
          autoComplete="nickname"
          required
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => change({ name: event.target.value })}
        />
        <label htmlFor="account-handle">ユーザーID</label>
        <div className="profile-handle-field">
          <span aria-hidden="true">@</span>
          <input
            id="account-handle"
            ref={handleField}
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
            ref={ageField}
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
        <button className="btn fill" disabled={busy}>
          {busy ? "準備しています…" : "はじめる"}
        </button>
      </form>
    </>
  );
}

function Unavailable() {
  return (
    <>
      <h1>{NOT_CONNECTED}</h1>
      <p className="account-lead">
        {failure({
          what: "ログインはできていますが、プロフィールを読み込めませんでした",
          next: AGAIN.connection,
        })}
      </p>
      <button className="btn fill" onClick={() => void accountActions.retry()}>
        もう一度読み込む
      </button>
      <SignOut />
    </>
  );
}

function SignedIn({
  userId,
  email,
  handle,
  name,
}: {
  userId: string;
  email: string;
  handle: string;
  name: string;
}) {
  // 「メールアドレスを変える」 is open while the address says so (設定 opens it).
  const [change, setChange] = useUrlParam("change");
  // The address just changed to, said once below it.
  const [changedTo, setChangedTo] = useState("");
  if (change === "email")
    return (
      <ChangeEmail
        userId={userId}
        current={email}
        onClose={(changed) => {
          setChangedTo(changed ?? "");
          setChange(null);
        }}
      />
    );
  if (change === "passkey") return <Passkeys onClose={() => setChange(null)} />;
  return (
    <>
      <h1>ログインしています</h1>
      <p className="account-lead">
        {name}（@{handle}）さんとして、本の街にいます。
      </p>
      <Link className="btn fill" href="/">
        本の街へ
      </Link>
      <div className="account-email">
        <span>ログインのメールアドレス</span>
        <b>{email}</b>
        <button type="button" onClick={() => setChange("email")}>
          変える
        </button>
      </div>
      {changedTo === email && (
        <p className="account-changed" role="status">
          メールアドレスを変えました。次からは、このアドレスにログインのコードが届きます。
        </p>
      )}
      <div className="account-row">
        <span>メールのコードなしでログイン</span>
        <b>パスキー</b>
        <button type="button" onClick={() => setChange("passkey")}>
          開く
        </button>
      </div>
      <SignOut leave />
    </>
  );
}

/**
 * Changing the address takes two codes: one sent to the new address (it
 * reads mail) and one to the current address (its owner asked). The step
 * reached is kept for this tab like the sign-in's (account-draft.ts).
 */
function ChangeEmail({
  userId,
  current,
  onClose,
}: {
  userId: string;
  current: string;
  /** With the new address once it is changed; empty when given up. */
  onClose: (changedTo?: string) => void;
}) {
  const sent = useKeptDraft(emailChangeStore, userId);
  const sentTo = sent.draft?.email ?? "";
  const newConfirmed = sent.draft?.newConfirmed ?? false;
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? sentTo;
  const [newCode, setNewCode] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [error, setError] = useState<{
    message: string;
    field: "email" | "new" | "current";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const coarse = useCoarsePointer();
  const heading = useRef<HTMLHeadingElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const newField = useRef<HTMLInputElement>(null);
  const currentField = useRef<HTMLInputElement>(null);
  // Until this tab's kept step is read, neither step is shown (a reload in
  // the middle of a change would show the address form for a moment).
  useFocusFieldOnShow(emailField, {
    instead: heading,
    when: sent.loaded && !sentTo,
  });
  useFocusFieldOnShow(newConfirmed ? currentField : newField, {
    instead: heading,
    when: sent.loaded && Boolean(sentTo),
  });

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await accountActions.changeEmail(email);
    setBusy(false);
    if (!result.ok) {
      setError({ message: result.message, field: "email" });
      if (coarse) markField(emailField.current);
      return;
    }
    // New codes went to both addresses; none is taken yet.
    sent.set({
      email: normalizeEmail(email),
      sentAt: Date.now(),
      newConfirmed: false,
    });
    setNewCode("");
    setCurrentCode("");
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await accountActions.confirmEmailChange({
      email: sentTo,
      newCode,
      currentCode,
      newConfirmed,
    });
    setBusy(false);
    if (result.ok) {
      sent.clear();
      onClose(sentTo);
      return;
    }
    if (result.newConfirmed !== newConfirmed)
      sent.set({
        email: sentTo,
        sentAt: sent.draft?.sentAt ?? Date.now(),
        newConfirmed: result.newConfirmed,
      });
    setError({ message: result.message, field: result.field });
    if (coarse)
      markField(
        result.field === "new" ? newField.current : currentField.current,
      );
  }

  const describe = (field: "email" | "new" | "current") =>
    error?.field === field ? "account-error" : undefined;

  if (!sent.loaded) return null;
  if (!sentTo)
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          メールアドレスを変える
        </h1>
        <p className="account-lead">
          いまは <b>{current}</b>{" "}
          でログインしています。新しいアドレスと今のアドレスに、{CODE_LENGTH}
          桁のコードを1通ずつ送ります。
        </p>
        <form className="profile-form" onSubmit={send} noValidate={coarse}>
          <label htmlFor="account-new-email">新しいメールアドレス</label>
          <input
            id="account-new-email"
            ref={emailField}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            onChange={(event) => setTyped(event.target.value)}
            aria-describedby={describe("email")}
          />
          <ErrorLine message={error?.message ?? ""} />
          <button className="btn fill" disabled={busy || !email.trim()}>
            {busy ? "送っています…" : "コードを送る"}
          </button>
        </form>
        <div className="account-links">
          <button type="button" onClick={() => onClose()}>
            やめる
          </button>
        </div>
      </>
    );

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        届いたコードを入れる
      </h1>
      <p className="account-lead">
        2つのアドレスに、{CODE_LENGTH}
        桁のコードを1通ずつ送りました。届かないときは、迷惑メールのフォルダに入っていることもあります。
      </p>
      <form className="profile-form" onSubmit={confirm} noValidate={coarse}>
        <label htmlFor="account-new-code" className="account-code-label">
          新しいアドレス
          <b>{sentTo}</b>
        </label>
        {newConfirmed ? (
          <p className="account-code-done">
            <Icon name="check" size={16} /> 確かめました
          </p>
        ) : (
          <input
            id="account-new-code"
            ref={newField}
            className="account-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            required
            value={newCode}
            onChange={(event) => setNewCode(normalizeCode(event.target.value))}
            aria-describedby={describe("new")}
          />
        )}
        <label htmlFor="account-current-code" className="account-code-label">
          今のアドレス
          <b>{current}</b>
        </label>
        <input
          id="account-current-code"
          ref={currentField}
          className="account-code"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9 ]*"
          required
          value={currentCode}
          onChange={(event) =>
            setCurrentCode(normalizeCode(event.target.value))
          }
          aria-describedby={describe("current")}
        />
        <ErrorLine message={error?.message ?? ""} />
        <button
          className="btn fill"
          disabled={
            busy ||
            (!newConfirmed && newCode.length !== CODE_LENGTH) ||
            currentCode.length !== CODE_LENGTH
          }
        >
          {busy ? "確かめています…" : "メールアドレスを変える"}
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
            setError(null);
          }}
        >
          アドレスを入れ直す
        </button>
        <button
          type="button"
          onClick={() => {
            sent.clear();
            onClose();
          }}
        >
          やめる
        </button>
      </div>
    </>
  );
}

/** Whether this browser can make and use passkeys at all. */
const passkeysPossible = () =>
  typeof window !== "undefined" &&
  typeof window.PublicKeyCredential === "function";

/**
 * The reader's passkeys: each signs in without the email code, from the
 * device or password manager that keeps it, so a lost mailbox does not lock
 * them out. One is made on this device; any can be removed.
 */
function Passkeys({ onClose }: { onClose: () => void }) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(false);
  // The passkey whose removal is being asked about.
  const [asking, setAsking] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const load = useCallback(async () => {
    setLoadError("");
    const result = await accountActions.listPasskeys();
    if (result.ok) setPasskeys(result.passkeys);
    else setLoadError(result.message);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError("");
    setMade(false);
    const result = await accountActions.addPasskey();
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setMade(true);
    await load();
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    setMade(false);
    const result = await accountActions.removePasskey(id);
    setBusy(false);
    setAsking(null);
    if (!result.ok) setError(result.message);
    await load();
  }

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        パスキー
      </h1>
      <p className="account-lead">
        パスキーがあれば、メールのコードを待たずに、指紋や顔、端末の画面ロックでログインできます。メールが読めなくなったときも、パスキーで入れます。
      </p>
      {loadError ? (
        <>
          <ErrorLine message={loadError} />
          <button type="button" className="btn" onClick={() => void load()}>
            もう一度読み込む
          </button>
        </>
      ) : passkeys === null ? (
        <p className="account-lead">読み込んでいます…</p>
      ) : (
        passkeys.length > 0 && (
          <ul className="account-passkeys">
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <b>{passkey.name || "パスキー"}</b>
                <span>
                  {shortDate(passkey.createdAt)}に作成
                  {passkey.lastUsedAt &&
                    `・${shortDate(passkey.lastUsedAt)}に使用`}
                </span>
                {asking === passkey.id ? (
                  <span className="account-passkey-ask" role="group">
                    消すと、このパスキーではログインできなくなります。
                    <span>
                      <button
                        type="button"
                        onClick={() => void remove(passkey.id)}
                        disabled={busy}
                      >
                        消す
                      </button>
                      <button type="button" onClick={() => setAsking(null)}>
                        残す
                      </button>
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="account-passkey-remove"
                    onClick={() => setAsking(passkey.id)}
                    disabled={busy}
                  >
                    消す
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      {made && (
        <p className="account-changed" role="status">
          パスキーを作りました。次からは、ログインの画面で「パスキーでログイン」を選べます。
        </p>
      )}
      <ErrorLine message={error} />
      {passkeysPossible() ? (
        <button
          type="button"
          // Once there is one, another is there to make, not asked for.
          className={passkeys?.length ? "btn" : "btn fill"}
          onClick={() => void add()}
          disabled={busy || passkeys === null}
        >
          {busy ? "確かめています…" : "この端末でパスキーを作る"}
        </button>
      ) : (
        <p className="account-lead">このブラウザでは、パスキーを作れません。</p>
      )}
      <div className="account-links">
        <button type="button" onClick={onClose}>
          戻る
        </button>
      </div>
    </>
  );
}

/**
 * ログアウト lets this reader's scan journal and the changes still waiting to
 * be sent (outbox.ts) go from the device (a shared device keeps nothing of
 * theirs), saying first when anything still waits. A sign-out the reader did
 * not press (a failed token refresh) keeps both.
 */
function SignOut({ leave = false }: { leave?: boolean }) {
  const account = useAccountState();
  const userId = "user" in account ? account.user.id : null;
  const waiting = useJournal(userId).length;
  const unsent = useOutboxWaiting(userId);
  return (
    <div className="account-links">
      {waiting > 0 && (
        <p className="account-journal-warning">
          まだ登録できていない本が{counted(waiting, "冊")}
          あります。ログアウトすると、この端末の控えから消えます
        </p>
      )}
      {unsent && (
        <p className="account-journal-warning">
          まだ送れていない変更があります。ログアウトすると、この端末から消えます
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          if (!userId) return void accountActions.signOut();
          libraryJournal.forget(userId);
          // Once signed out, the town has stopped saving: nothing it still
          // had waiting is kept after the outbox is let go.
          void accountActions.signOut().then(() => forgetOutboxes(userId));
        }}
      >
        ログアウト
      </button>
      {leave && (
        <Link className="account-leave" href="/leave/">
          退会する
        </Link>
      )}
    </div>
  );
}

function ErrorLine({
  message,
  id = "account-error",
}: {
  message: string;
  id?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className="profile-link-error" role="alert">
      {message}
    </p>
  );
}
