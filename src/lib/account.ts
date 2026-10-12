import { useSyncExternalStore } from "react";
import { handleProblem, normalizeHandle } from "./handles";
import type { ProfileInsert, ProfileRow } from "./supabase/database.types";

/** Sign-in sends a six-digit code by email; the reader types it back in. */
export const CODE_LENGTH = 6;
/** The youngest age Booktown is offered to. */
export const MINIMUM_AGE = 13;
export const NAME_MAX_LENGTH = 40;

export interface AccountUser {
  id: string;
  email: string;
}

export type AccountState =
  /** This build has no Supabase project: the local demo, saved in this browser. */
  | { status: "demo" }
  | { status: "loading" }
  | { status: "signed-out" }
  /** Signed in, but the profile could not be read; retry() tries again. */
  | { status: "unavailable"; user: AccountUser }
  /** Signed in for the first time: a public ID and a name come next. */
  | { status: "needs-profile"; user: AccountUser }
  | { status: "signed-in"; user: AccountUser; profile: ProfileRow };

export type AccountFailure =
  | "invalid-email"
  | "not-invited"
  | "invalid-code"
  | "invalid-link"
  | "rate-limited"
  | "handle-taken"
  | "invalid-profile"
  | "network"
  | "misconfigured"
  | "server";

export const failureMessages: Record<AccountFailure, string> = {
  "invalid-email": "メールアドレスの形を確かめてください。",
  "not-invited":
    "このメールアドレスは、まだ招待されていません。招待を受けたアドレスで入ってください。",
  "invalid-code":
    "コードが違うか、期限が切れています。もう一度コードを送ってください。",
  "invalid-link":
    "このログイン用のリンクは、期限が切れているか、すでに使われています。もう一度メールを送ってください。",
  "rate-limited": "少し時間をおいてから、もう一度お試しください。",
  "handle-taken": "このIDはほかの読書家が使っています。",
  "invalid-profile": "入力した内容を確かめてください。",
  network:
    "つながりませんでした。通信の状態を確かめて、もう一度お試しください。",
  misconfigured:
    "サイトの設定に問題があり、いまはログインできません。運営にお知らせください。",
  server:
    "ログインの仕組みが応えませんでした。しばらくしてから、もう一度お試しください。",
};

export type AccountResult = { ok: true } | { ok: false; message: string };

/** The few calls the account needs, so tests can stand in for Supabase. */
export interface AccountBackend {
  /** Calls the listener with the current user right away, then on every change. */
  onUserChange(listener: (user: AccountUser | null) => void): () => void;
  sendCode(email: string): Promise<AccountFailure | null>;
  verifyCode(email: string, code: string): Promise<AccountFailure | null>;
  signOut(): Promise<void>;
  /** Null when the person has no profile yet; throws when it cannot be read. */
  loadProfile(userId: string): Promise<ProfileRow | null>;
  createProfile(
    row: ProfileInsert,
  ): Promise<{ profile: ProfileRow } | { failure: AccountFailure }>;
}

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (email: string): boolean =>
  email.length <= 254 && EMAIL_PATTERN.test(email);

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

/** Why a first profile cannot be created yet, or null when it can. */
export function profileDraftProblem(draft: ProfileDraft): string | null {
  const handleError = handleProblem(normalizeHandle(draft.handle), []);
  if (handleError) return handleError;
  const name = draft.name.trim();
  if (!name) return "ユーザー名を入れてください。";
  if (name.length > NAME_MAX_LENGTH)
    return `ユーザー名は${NAME_MAX_LENGTH}文字までです。`;
  if (!draft.ageConfirmed)
    return `Booktownは${MINIMUM_AGE}歳以上の方が使えます。`;
  return null;
}

const failed = (reason: AccountFailure): AccountResult => ({
  ok: false,
  message: failureMessages[reason],
});

export function createAccountStore(
  connect: () => AccountBackend | null,
  configured: boolean,
) {
  const initial: AccountState = configured
    ? { status: "loading" }
    : { status: "demo" };
  let state: AccountState = initial;
  let backend: AccountBackend | null = null;
  let started = false;
  // A newer sign-in or sign-out wins over a profile read that is still running.
  let generation = 0;
  const listeners = new Set<() => void>();

  const set = (next: AccountState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const userOf = (current: AccountState): AccountUser | null =>
    "user" in current ? current.user : null;

  async function adopt(user: AccountUser | null, force = false) {
    if (!backend) return;
    const current = userOf(state);
    // Token refreshes repeat the same user; their profile is already known.
    if (
      !force &&
      user &&
      current?.id === user.id &&
      (state.status === "signed-in" || state.status === "needs-profile")
    )
      return;
    const mine = ++generation;
    if (!user) {
      set({ status: "signed-out" });
      return;
    }
    try {
      const profile = await backend.loadProfile(user.id);
      if (mine !== generation) return;
      set(
        profile
          ? { status: "signed-in", user, profile }
          : { status: "needs-profile", user },
      );
    } catch {
      if (mine !== generation) return;
      set({ status: "unavailable", user });
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
      await backend?.signOut();
      set({ status: "signed-out" });
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
