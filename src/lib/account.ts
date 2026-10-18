import { useSyncExternalStore } from "react";
import { handleProblem, normalizeHandle } from "./handles";
import type { ProfileInsert, ProfileRow } from "./supabase/database.types";
import { EMAIL_MAX_LENGTH } from "./types";
import { counted, failure, AGAIN, KEPT, NOT_CONNECTED } from "./words";

/** Sign-in sends a six-digit code by email; the reader types it back in. */
export const CODE_LENGTH = 6;
/** The youngest age Booktown is offered to. */
export const MINIMUM_AGE = 13;
export const NAME_MAX_LENGTH = 40;
/** How many passkeys one account can have (the auth server's own limit). */
export const PASSKEY_LIMIT = 10;

export interface AccountUser {
  id: string;
  email: string;
}

export type AccountState =
  /** This build has no Supabase project: the local demo, saved in this browser. */
  | { status: "demo" }
  /**
   * Being checked. `pending` is the person whose session this browser has,
   * while their profile is still being read: the town can start loading with
   * it (town-session.ts).
   */
  | { status: "loading"; pending?: AccountUser }
  /**
   * `lapsed` is who was signed in when the session ended without them
   * pressing ログアウト (signed out on another device, a token that could
   * not be renewed): what they had not sent waits on this device for them.
   */
  | { status: "signed-out"; lapsed?: AccountUser }
  /** Signed in, but the profile could not be read; retry() tries again. */
  | { status: "unavailable"; user: AccountUser }
  /** Signed in for the first time: a public ID and a name come next. */
  | { status: "needs-profile"; user: AccountUser }
  | { status: "signed-in"; user: AccountUser; profile: ProfileRow };

export type AccountFailure =
  | "invalid-email"
  | "same-email"
  | "email-taken"
  | "not-invited"
  | "invalid-code"
  | "invalid-link"
  | "rate-limited"
  | "handle-taken"
  | "invalid-profile"
  | "network"
  | "misconfigured"
  | "server"
  | "leave-failed"
  | "passkey-cancelled"
  | "passkey-unavailable"
  | "passkey-unknown"
  | "passkey-exists"
  | "passkey-too-many"
  | "passkey-expired"
  | "passkey-failed";

export const failureMessages: Record<AccountFailure, string> = {
  "invalid-email": failure({ next: "メールアドレスの形を確かめてください" }),
  "same-email": failure({ what: "いまログインに使っているアドレスと同じです" }),
  "email-taken": failure({
    what: "このメールアドレスは、ほかのアカウントで使われています",
  }),
  "not-invited": failure({
    what: "このメールアドレスは、まだ招待されていません",
    next: "招待を受けたアドレスで入ってください",
  }),
  "invalid-code": failure({
    what: "コードが違うか、期限が切れています",
    next: "もう一度コードを送ってください",
  }),
  "invalid-link": failure({
    what: "このログイン用のリンクは、期限が切れているか、すでに使われています",
    next: "もう一度メールを送ってください",
  }),
  "rate-limited": failure({ next: AGAIN.later }),
  "handle-taken": failure({ what: "このIDはほかの読書家が使っています" }),
  "invalid-profile": failure({ next: "入力した内容を確かめてください" }),
  network: failure({ what: NOT_CONNECTED, next: AGAIN.connection }),
  misconfigured: failure({
    what: "サイトの設定に問題があり、いまはログインできません",
    next: "運営にお知らせください",
  }),
  server: failure({
    what: "ログインの仕組みが応えませんでした",
    next: AGAIN.later,
  }),
  "leave-failed": failure({
    what: "退会できませんでした",
    kept: KEPT.nothing,
    next: AGAIN.later,
  }),
  // Closed by the reader in the browser's own window: nothing to say.
  "passkey-cancelled": "",
  "passkey-unavailable": failure({
    what: "このページやブラウザでは、パスキーを使えません",
  }),
  "passkey-unknown": failure({
    what: "このパスキーでは入れませんでした",
    next: "ほかのパスキーを選ぶか、メールのコードで入ってください",
  }),
  "passkey-exists": failure({
    what: "この端末のパスキーは、もう作ってあります",
  }),
  "passkey-too-many": failure({
    what: `パスキーは${counted(PASSKEY_LIMIT, "個")}まで作れます`,
    next: "使っていないものを消すと、作れます",
  }),
  "passkey-expired": failure({
    what: "時間がたって、パスキーの確認が切れました",
    next: AGAIN.now,
  }),
  "passkey-failed": failure({
    what: "パスキーで確かめられませんでした",
    next: AGAIN.now,
  }),
};

/** The ID typed to confirm 退会 is not the reader's. */
export const LEAVE_HANDLE_MISMATCH =
  "IDが違います。@のあとの、あなたのユーザーIDを入れてください。";

export type AccountResult = { ok: true } | { ok: false; message: string };

/**
 * A change of address, checked with the code sent to each address. The new
 * address's code goes first, so the change is never made to an address
 * nobody has read mail at. `field` is the code the message is about, and
 * `newConfirmed` says the new address's code was taken (it works once).
 */
export type EmailChangeResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      field: "new" | "current";
      newConfirmed: boolean;
    };

/**
 * A passkey the signed-in reader made. `name` is what keeps it (iCloud
 * Keychain, Google Password Manager…), when the auth server knows.
 */
export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type PasskeysResult =
  { ok: true; passkeys: Passkey[] } | { ok: false; message: string };

/** The few calls the account needs, so tests can stand in for Supabase. */
export interface AccountBackend {
  /** Calls the listener with the current user right away, then on every change. */
  onUserChange(listener: (user: AccountUser | null) => void): () => void;
  sendCode(email: string): Promise<AccountFailure | null>;
  verifyCode(email: string, code: string): Promise<AccountFailure | null>;
  /**
   * Asks to change the signed-in reader's address: a code goes to the new
   * address, and one to the current address.
   */
  changeEmail(email: string): Promise<AccountFailure | null>;
  /**
   * Checks a code of a change of address, sent to `email`. `done` once the
   * change is made; until then the other address's code is still to come.
   */
  confirmEmailChange(
    email: string,
    code: string,
  ): Promise<{ done: boolean } | { failure: AccountFailure }>;
  /**
   * Signs in with a passkey kept by this device or a password manager: no
   * address is asked, the passkey says whose it is.
   */
  signInWithPasskey(): Promise<AccountFailure | null>;
  /** Makes a passkey for the signed-in reader, kept by this device. */
  addPasskey(): Promise<AccountFailure | null>;
  /** The signed-in reader's passkeys; throws when they cannot be read. */
  listPasskeys(): Promise<Passkey[]>;
  removePasskey(id: string): Promise<AccountFailure | null>;
  signOut(): Promise<void>;
  /**
   * Deletes the signed-in account and everything it owns (the database
   * takes it all along, docs/09 「アカウント削除の型」), then signs out here.
   */
  deleteAccount(): Promise<AccountFailure | null>;
  /** Null when the person has no profile yet; throws when it cannot be read. */
  loadProfile(userId: string): Promise<ProfileRow | null>;
  createProfile(
    row: ProfileInsert,
  ): Promise<{ profile: ProfileRow } | { failure: AccountFailure }>;
}

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (email: string): boolean =>
  email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);

/**
 * A sign-in link from the email that did not work comes back with the reason
 * after the # in the address (an expired or already used link, for example).
 */
export function linkFailure(hash: string): AccountFailure | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.has("error") || params.has("error_code")
    ? "invalid-link"
    : null;
}

/** Keeps the digits of a pasted or typed code, so "123 456" also works. */
export const normalizeCode = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, CODE_LENGTH);

export interface ProfileDraft {
  handle: string;
  name: string;
  /** The reader confirmed they are at least MINIMUM_AGE. */
  ageConfirmed: boolean;
  /** Whether reading records start public; the reader can change it later. */
  readingPublic: boolean;
}

/**
 * Why a first profile cannot be created yet, and the field it is about (so a
 * screen can point to it), or null when it can.
 */
export function profileDraftIssue(
  draft: ProfileDraft,
): { field: "handle" | "name" | "age"; message: string } | null {
  const handleError = handleProblem(normalizeHandle(draft.handle), []);
  if (handleError) return { field: "handle", message: handleError };
  const name = draft.name.trim();
  if (!name) return { field: "name", message: "ユーザー名を入れてください。" };
  if (name.length > NAME_MAX_LENGTH)
    return {
      field: "name",
      message: `ユーザー名は${counted(NAME_MAX_LENGTH, "文字")}までです。`,
    };
  if (!draft.ageConfirmed)
    return {
      field: "age",
      message: `Booktownは${MINIMUM_AGE}歳以上の方が使えます。`,
    };
  return null;
}

/** Why a first profile cannot be created yet, or null when it can. */
export function profileDraftProblem(draft: ProfileDraft): string | null {
  return profileDraftIssue(draft)?.message ?? null;
}

const failed = (reason: AccountFailure): { ok: false; message: string } => ({
  ok: false,
  message: failureMessages[reason],
});

/**
 * What a deletion (退会) leaves to do in this browser. Its answer can be lost
 * on the way back, so the account it was asked for is marked until the answer
 * is known: a later page that finds the account gone (signed out, or no
 * profile any more) finishes it.
 */
export interface Leaving {
  /** The account a deletion was asked for, whose answer is not known. */
  pending(): string | null;
  mark(userId: string | null): void;
  /** Lets go of everything this browser keeps for them. */
  forget(userId: string): Promise<void> | void;
}

const NO_LEAVING: Leaving = {
  pending: () => null,
  mark: () => {},
  forget: () => {},
};

/**
 * Whether ログアウト was pressed in this browser since the last sign-in. The
 * tabs share one session, so a sign-out pressed in one ends it in every
 * other: none of them says the session lapsed.
 */
export interface SignedOut {
  pressed(): boolean;
  mark(pressed: boolean): void;
}

const NOT_PRESSED: SignedOut = { pressed: () => false, mark: () => {} };

export function createAccountStore(
  connect: () => AccountBackend | null,
  configured: boolean,
  leaving: Leaving = NO_LEAVING,
  signedOut: SignedOut = NOT_PRESSED,
) {
  const initial: AccountState = configured
    ? { status: "loading" }
    : { status: "demo" };
  let state: AccountState = initial;
  let backend: AccountBackend | null = null;
  let started = false;
  // A newer sign-in or sign-out wins over a profile read that is still running.
  let generation = 0;
  // Whose profile is being read, in which generation: the same person told
  // again (Supabase tells the session restored twice) waits for that read.
  let reading: { userId: string; generation: number } | null = null;
  // While a deletion is asked, a sign-out it brings waits for its answer, so
  // the page goes from 退会する to 退会しました with nothing between.
  let deleting = false;
  let outWhileDeleting = false;
  // While ログアウト, pressed, is on its way: the session it ends did not lapse.
  let signingOut = false;
  const listeners = new Set<() => void>();

  const set = (next: AccountState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const userOf = (current: AccountState): AccountUser | null =>
    "user" in current ? current.user : null;

  async function adopt(user: AccountUser | null, force = false) {
    if (!backend) return;
    if (user) signedOut.mark(false);
    const current = userOf(state);
    // Token refreshes repeat the same user; their profile is already known.
    // A changed address is taken as it is.
    if (
      !force &&
      user &&
      current?.id === user.id &&
      (state.status === "signed-in" || state.status === "needs-profile")
    ) {
      if (current.email !== user.email)
        set(
          state.status === "signed-in"
            ? { ...state, user }
            : { status: "needs-profile", user },
        );
      return;
    }
    if (!user && deleting) {
      outWhileDeleting = true;
      return;
    }
    if (
      !force &&
      user &&
      reading?.userId === user.id &&
      reading.generation === generation
    )
      return;
    const mine = ++generation;
    if (!user) {
      // Signed out after a deletion whose answer was lost: it went through
      // (the session ended with the account), or the reader gave up on it.
      const left = leaving.pending();
      if (left) {
        leaving.mark(null);
        await leaving.forget(left);
      }
      // Whoever was signed in, or whose session was being restored, and
      // did not press ログアウト, here or in another tab.
      const was =
        state.status === "loading" ? (state.pending ?? null) : current;
      if (mine === generation)
        set(
          was && !signingOut && !signedOut.pressed() && left !== was.id
            ? { status: "signed-out", lapsed: was }
            : { status: "signed-out" },
        );
      return;
    }
    reading = { userId: user.id, generation: mine };
    // A deletion whose answer was lost may have gone: nothing loads for it.
    if (state.status === "loading" && leaving.pending() !== user.id)
      set({ status: "loading", pending: user });
    try {
      const profile = await backend.loadProfile(user.id);
      if (mine !== generation) return;
      if (leaving.pending() === user.id) {
        leaving.mark(null);
        // The profile is gone: the deletion went through.
        if (!profile) {
          await leaving.forget(user.id);
          await backend.signOut();
          if (mine === generation) set({ status: "signed-out" });
          return;
        }
      }
      set(
        profile
          ? { status: "signed-in", user, profile }
          : { status: "needs-profile", user },
      );
    } catch {
      if (mine !== generation) return;
      set({ status: "unavailable", user });
    } finally {
      if (reading?.generation === mine) reading = null;
    }
  }

  function start() {
    if (started) return;
    started = true;
    backend = connect();
    if (!backend) {
      set({ status: configured ? "signed-out" : "demo" });
      return;
    }
    backend.onUserChange((user) => void adopt(user));
  }

  const actions = {
    async sendCode(rawEmail: string): Promise<AccountResult> {
      start();
      const email = normalizeEmail(rawEmail);
      if (!validEmail(email)) return failed("invalid-email");
      if (!backend) return failed("network");
      const failure = await backend.sendCode(email);
      return failure ? failed(failure) : { ok: true };
    },
    async verifyCode(
      rawEmail: string,
      rawCode: string,
    ): Promise<AccountResult> {
      start();
      const email = normalizeEmail(rawEmail);
      const code = normalizeCode(rawCode);
      if (code.length !== CODE_LENGTH) return failed("invalid-code");
      if (!backend) return failed("network");
      const failure = await backend.verifyCode(email, code);
      return failure ? failed(failure) : { ok: true };
    },
    /** Sends the codes for a change of the signed-in reader's address. */
    async changeEmail(rawEmail: string): Promise<AccountResult> {
      start();
      const email = normalizeEmail(rawEmail);
      if (!validEmail(email)) return failed("invalid-email");
      if (!backend || state.status !== "signed-in") return failed("network");
      if (email === normalizeEmail(state.user.email))
        return failed("same-email");
      const failure = await backend.changeEmail(email);
      return failure ? failed(failure) : { ok: true };
    },
    /**
     * Makes the change of address with its two codes: the new address's
     * first (unless it was taken already), then the current address's.
     */
    async confirmEmailChange(change: {
      email: string;
      newCode: string;
      currentCode: string;
      newConfirmed: boolean;
    }): Promise<EmailChangeResult> {
      start();
      let newConfirmed = change.newConfirmed;
      const refuse = (
        reason: AccountFailure,
        field: "new" | "current",
      ): EmailChangeResult => ({
        ok: false,
        message: failureMessages[reason],
        field,
        newConfirmed,
      });
      const email = normalizeEmail(change.email);
      const newCode = normalizeCode(change.newCode);
      const currentCode = normalizeCode(change.currentCode);
      if (!newConfirmed && newCode.length !== CODE_LENGTH)
        return refuse("invalid-code", "new");
      if (currentCode.length !== CODE_LENGTH)
        return refuse("invalid-code", "current");
      if (!backend || state.status !== "signed-in")
        return refuse("network", newConfirmed ? "current" : "new");
      const current = normalizeEmail(state.user.email);
      const steps: ["new" | "current", string, string][] = [
        ["new", email, newCode],
        ["current", current, currentCode],
      ];
      for (const [field, address, code] of steps) {
        if (field === "new" && newConfirmed) continue;
        const answer = await backend.confirmEmailChange(address, code);
        if ("failure" in answer) return refuse(answer.failure, field);
        if (answer.done) {
          // The new session says so too; the page need not wait for it.
          if (state.status === "signed-in")
            set({ ...state, user: { ...state.user, email } });
          return { ok: true };
        }
        if (field === "new") newConfirmed = true;
      }
      // The server still waits after both: the codes were sent again from
      // somewhere else, so this page's count was behind. New codes, sent
      // again, start over.
      newConfirmed = false;
      return refuse("invalid-code", "new");
    },
    /** Signs in with a passkey; the session it starts is told as usual. */
    async signInWithPasskey(): Promise<AccountResult> {
      start();
      if (!backend) return failed("network");
      const failure = await backend.signInWithPasskey();
      return failure ? failed(failure) : { ok: true };
    },
    /** Makes a passkey for the signed-in reader on this device. */
    async addPasskey(): Promise<AccountResult> {
      start();
      if (!backend || state.status !== "signed-in") return failed("network");
      const failure = await backend.addPasskey();
      return failure ? failed(failure) : { ok: true };
    },
    async listPasskeys(): Promise<PasskeysResult> {
      start();
      if (!backend || state.status !== "signed-in") return failed("network");
      try {
        const passkeys = await backend.listPasskeys();
        return { ok: true, passkeys };
      } catch {
        return failed("network");
      }
    },
    async removePasskey(id: string): Promise<AccountResult> {
      start();
      if (!backend || state.status !== "signed-in") return failed("network");
      const failure = await backend.removePasskey(id);
      return failure ? failed(failure) : { ok: true };
    },
    async createProfile(draft: ProfileDraft): Promise<AccountResult> {
      start();
      const problem = profileDraftProblem(draft);
      if (problem) return { ok: false, message: problem };
      if (!backend || state.status !== "needs-profile")
        return failed("network");
      const user = state.user;
      const result = await backend.createProfile({
        id: user.id,
        handle: normalizeHandle(draft.handle),
        name: draft.name.trim(),
        reading_visibility: draft.readingPublic ? "public" : "private",
      });
      if ("failure" in result) return failed(result.failure);
      generation += 1;
      set({ status: "signed-in", user, profile: result.profile });
      return { ok: true };
    },
    async retry() {
      start();
      const user = userOf(state);
      if (user) await adopt(user, true);
    },
    async signOut() {
      start();
      generation += 1;
      signingOut = true;
      signedOut.mark(true);
      try {
        await backend?.signOut();
      } finally {
        signingOut = false;
      }
      set({ status: "signed-out" });
    },
    /**
     * 退会: only for the reader signed in now, and only when `confirm` is
     * their ID as they typed it to say so (a reader with no profile yet has
     * none to type). On success, what this browser keeps for them goes, and
     * `onLeft` is told, before the page shows them signed out.
     */
    async deleteAccount(
      confirm: string,
      onLeft: () => void = () => {},
    ): Promise<AccountResult> {
      start();
      if (state.status !== "signed-in" && state.status !== "needs-profile")
        return failed("network");
      if (
        state.status === "signed-in" &&
        normalizeHandle(confirm) !== state.profile.handle
      )
        return { ok: false, message: LEAVE_HANDLE_MISMATCH };
      if (!backend || deleting) return failed("network");
      const user = state.user;
      deleting = true;
      outWhileDeleting = false;
      leaving.mark(user.id);
      let failure: AccountFailure | null;
      try {
        failure = await backend.deleteAccount();
      } catch {
        failure = "network";
      }
      deleting = false;
      if (failure) {
        // Refused, nothing went; with no answer it may have, and stays marked.
        if (failure !== "network") leaving.mark(null);
        if (outWhileDeleting) void adopt(null);
        return failed(failure);
      }
      // A profile read still running for them must not bring them back.
      const mine = ++generation;
      // Gone, not lapsed, for the other tabs too.
      signedOut.mark(true);
      leaving.mark(null);
      await leaving.forget(user.id);
      onLeft();
      if (mine === generation) set({ status: "signed-out" });
      return { ok: true };
    },
  };

  return {
    actions,
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;

export function useAccount(store: AccountStore): AccountState {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
