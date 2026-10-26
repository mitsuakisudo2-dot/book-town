import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAccountStore,
  failureMessages,
  LEAVE_HANDLE_MISMATCH,
  LEAVE_WORD,
  LEAVE_WORD_MISMATCH,
  linkFailure,
  normalizeCode,
  profileDraftIssue,
  profileDraftProblem,
  type AccountBackend,
  type AccountFailure,
  type AccountUser,
  type Leaving,
  type Passkey,
  type SignedOut,
} from "../src/lib/account";
import { handleProblem, RESERVED_HANDLES } from "../src/lib/handles";
import { suggestProfile } from "../src/lib/account-draft";
import {
  humanCheckKey,
  TURNSTILE_HOSTS,
  TURNSTILE_SITE_KEY,
} from "../src/lib/turnstile";
import {
  authFailure,
  emailChangeFailure,
  passkeyFailure,
} from "../src/lib/supabase/account-backend";
import type { ProfileRow } from "../src/lib/supabase/database.types";

// Checks the sign-in and first-profile flow against a stand-in for Supabase.
// Everything runs inside main() because tsx compiles this file as CommonJS.

const AKI: AccountUser = { id: "user-aki", email: "aki@example.jp" };

const profileOf = (id: string, handle: string, name: string): ProfileRow => ({
  id,
  handle,
  name,
  bio: "",
  color: "#768281",
  links: [],
  compose_icon: "pen",
  reading_visibility: "private",
  nine_version: 0,
  published: true,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
});

/** A pretend Supabase with one invited email and adjustable failures. */
function fakeBackend() {
  let listener: (user: AccountUser | null) => void = () => {};
  const profiles = new Map<string, ProfileRow>();
  const calls = {
    sendCode: 0,
    verifyCode: 0,
    loadProfile: 0,
    deleteAccount: 0,
    changeEmail: 0,
    confirmEmailChange: [] as string[],
    humanChecks: [] as (string | undefined)[],
  };
  const control = {
    calls,
    profiles,
    invited: new Set([AKI.email]),
    loadFails: false,
    deleteFails: null as AccountFailure | null,
    /** The deletion is done, but its answer is lost on the way. */
    deleteButLose: false,
    /** The sign-out is told before the call returns. */
    signOutAtOnce: false,
    /** Resolves profile reads only when release() is called. */
    holdLoads: false,
    held: [] as (() => void)[],
    /** Addresses another account uses. */
    taken: new Set(["ren@example.jp"]),
    /** The change of address asked for: its two codes, and which were taken. */
    change: null as null | { email: string; confirmed: Set<string> },
    /** Like the auth server while email confirmations are off. */
    oneCodeEnough: false,
    /** Aki's passkeys, and what this device's passkey window answers. */
    passkeys: [] as Passkey[],
    passkeyWindow: null as AccountFailure | null,
    /** reader_settings.mode, as each reader's was written. */
    modes: new Map<string, string>(),
    emit: (user: AccountUser | null) => listener(user),
    release() {
      control.held.splice(0).forEach((resume) => resume());
    },
  };
  const backend: AccountBackend = {
    onUserChange(next) {
      listener = next;
      next(null);
      return () => {};
    },
    async sendCode(email, humanCheck) {
      calls.sendCode += 1;
      calls.humanChecks.push(humanCheck);
      return control.invited.has(email) ? null : "not-invited";
    },
    async verifyCode(email, code) {
      calls.verifyCode += 1;
      if (code !== "123456") return "invalid-code";
      listener(email === AKI.email ? AKI : null);
      return null;
    },
    async changeEmail(email) {
      calls.changeEmail += 1;
      if (control.taken.has(email)) return "email-taken";
      // Asked again, new codes go out and none is taken yet.
      control.change = { email, confirmed: new Set() };
      return null;
    },
    async confirmEmailChange(email, code) {
      calls.confirmEmailChange.push(email);
      const change = control.change;
      // The new address's code is 111111; the current one's 222222.
      const which =
        change && email === change.email && code === "111111"
          ? "new"
          : email === AKI.email && code === "222222"
            ? "current"
            : null;
      if (!change || !which || change.confirmed.has(which))
        return { failure: "invalid-code" as AccountFailure };
      change.confirmed.add(which);
      if (!control.oneCodeEnough && change.confirmed.size < 2)
        return { done: false };
      control.change = null;
      setTimeout(() => listener({ ...AKI, email: change.email }), 0);
      return { done: true };
    },
    async signInWithPasskey(humanCheck) {
      calls.humanChecks.push(humanCheck);
      if (control.passkeyWindow) return control.passkeyWindow;
      if (!control.passkeys.length) return "passkey-unknown";
      control.passkeys[0].lastUsedAt = "2026-10-18T10:00:00Z";
      listener(AKI);
      return null;
    },
    async addPasskey() {
      if (control.passkeyWindow) return control.passkeyWindow;
      if (control.passkeys.length) return "passkey-exists";
      control.passkeys.push({
        id: "passkey-1",
        name: "iCloud Keychain",
        createdAt: "2026-10-18T09:00:00Z",
        lastUsedAt: null,
      });
      return null;
    },
    async listPasskeys() {
      if (control.loadFails) throw new Error("offline");
      return control.passkeys.map((passkey) => ({ ...passkey }));
    },
    async removePasskey(id) {
      control.passkeys = control.passkeys.filter((p) => p.id !== id);
      return null;
    },
    async signOut() {
      listener(null);
    },
    async deleteAccount() {
      calls.deleteAccount += 1;
      if (control.deleteFails) return control.deleteFails;
      profiles.clear();
      if (control.deleteButLose) return "network";
      // Supabase tells of the sign-out after its call returns, or before.
      if (control.signOutAtOnce) listener(null);
      else setTimeout(() => listener(null), 0);
      return null;
    },
    async loadProfile(userId) {
      calls.loadProfile += 1;
      if (control.holdLoads)
        await new Promise<void>((resume) => control.held.push(resume));
      if (control.loadFails) throw new Error("offline");
      return profiles.get(userId) ?? null;
    },
    async createProfile(row) {
      if (
        row.handle !== null &&
        [...profiles.values()].some((p) => p.handle === row.handle)
      )
        return { failure: "handle-taken" as AccountFailure };
      // Like profiles_published_named: an ID exactly on a public profile.
      if ((row.published ?? true) !== (row.handle != null))
        return { failure: "invalid-profile" as AccountFailure };
      const profile = {
        ...profileOf(row.id, row.handle ?? "", row.name),
        handle: row.handle ?? null,
        published: row.published ?? true,
        reading_visibility: row.reading_visibility ?? "private",
      };
      profiles.set(row.id, profile);
      return { profile };
    },
    async publishProfile(userId, chosen) {
      if ([...profiles.values()].some((p) => p.handle === chosen.handle))
        return { failure: "handle-taken" as AccountFailure };
      const was = profiles.get(userId);
      if (!was) return { failure: "network" as AccountFailure };
      const profile = { ...was, ...chosen, published: true };
      profiles.set(userId, profile);
      return { profile };
    },
    async startInManageMode(userId) {
      control.modes.set(userId, "manage");
      return null;
    },
  };
  return { backend, control };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void> | void) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check("without a Supabase project the app stays the demo", () => {
    const store = createAccountStore(() => null, false);
    assert.deepEqual(store.getSnapshot(), { status: "demo" });
    store.subscribe(() => {});
    assert.deepEqual(store.getSnapshot(), { status: "demo" });
  });

  await check(
    "an invited email gets a code; others are told why not",
    async () => {
      const { backend, control } = fakeBackend();
      const store = createAccountStore(() => backend, true);
      assert.deepEqual(store.getServerSnapshot(), { status: "loading" });
      store.subscribe(() => {});
      await settle();
      assert.equal(store.getSnapshot().status, "signed-out");
      assert.deepEqual(await store.actions.sendCode(" Aki@Example.jp "), {
        ok: true,
      });
      assert.deepEqual(await store.actions.sendCode("someone@example.jp"), {
        ok: false,
        message: failureMessages["not-invited"],
      });
      assert.deepEqual(await store.actions.sendCode("not an email"), {
        ok: false,
        message: failureMessages["invalid-email"],
      });
      assert.equal(control.calls.sendCode, 2);
    },
  );

  await check(
    "the human check's answer goes with the code and the passkey",
    async () => {
      const { backend, control } = fakeBackend();
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      await settle();
      await store.actions.sendCode(AKI.email, "answer-1");
      await store.actions.sendCode(AKI.email);
      await store.actions.signInWithPasskey("answer-2");
      assert.deepEqual(control.calls.humanChecks, [
        "answer-1",
        undefined,
        "answer-2",
      ]);
      assert.equal(
        authFailure({ code: "captcha_failed", status: 400 }),
        "human-check",
      );
      assert.equal(
        passkeyFailure({ code: "captcha_failed", status: 400 }),
        "human-check",
      );
      assert.match(failureMessages["human-check"], /ボットではない/);
      // Without a site key, or away from BookTown's own addresses, the login
      // asks no check; a build may name a test key of its own.
      assert.equal(humanCheckKey("booktown.page", ""), TURNSTILE_SITE_KEY);
      assert.equal(humanCheckKey("localhost", ""), null);
      assert.equal(humanCheckKey("book-town-git-x.vercel.app", ""), null);
      assert.match(TURNSTILE_SITE_KEY, /^0x4[A-Za-z0-9_-]{20,}$/);
      assert.equal(
        humanCheckKey("localhost", "1x00000000000000000000AA"),
        "1x00000000000000000000AA",
      );
      for (const host of TURNSTILE_HOSTS)
        assert.match(host, /^(booktown\.page|[a-z0-9-]+\.vercel\.app)$/);
    },
  );

  await check(
    "codes are six digits, and spaces in a pasted code are fine",
    async () => {
      assert.equal(normalizeCode("123 456"), "123456");
      assert.equal(normalizeCode("12-34-56-78"), "123456");
      const { backend, control } = fakeBackend();
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      assert.equal(
        (await store.actions.verifyCode(AKI.email, "12345")).ok,
        false,
      );
      assert.equal(control.calls.verifyCode, 0);
      assert.deepEqual(await store.actions.verifyCode(AKI.email, "999999"), {
        ok: false,
        message: failureMessages["invalid-code"],
      });
      assert.deepEqual(await store.actions.verifyCode(AKI.email, "123 456"), {
        ok: true,
      });
    },
  );

  await check(
    "a first sign-in asks for an ID, a name and the age",
    async () => {
      const { backend } = fakeBackend();
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      await store.actions.verifyCode(AKI.email, "123456");
      await settle();
      assert.deepEqual(store.getSnapshot(), {
        status: "needs-profile",
        user: AKI,
      });
      const draft = {
        handle: "@Aki_Books",
        name: " アキ ",
        ageConfirmed: true,
        readingPublic: true,
      };
      assert.equal(profileDraftProblem(draft), null);
      assert.match(
        profileDraftProblem({ ...draft, handle: "ab" }) ?? "",
        /3〜20文字/,
      );
      assert.match(
        profileDraftProblem({ ...draft, handle: "booktown" }) ?? "",
        /使えません/,
      );
      assert.match(
        profileDraftProblem({ ...draft, name: "  " }) ?? "",
        /名前|ユーザー名/,
      );
      assert.match(
        profileDraftProblem({ ...draft, ageConfirmed: false }) ?? "",
        /13歳以上/,
      );
      // Each problem names its field, for a touch screen to point to it
      // without raising the keyboard; the ID is asked about first.
      assert.equal(profileDraftIssue(draft), null);
      assert.equal(
        profileDraftIssue({ ...draft, handle: "ab" })?.field,
        "handle",
      );
      assert.equal(profileDraftIssue({ ...draft, name: "  " })?.field, "name");
      assert.equal(
        profileDraftIssue({ ...draft, name: "名".repeat(41) })?.field,
        "name",
      );
      assert.equal(
        profileDraftIssue({ ...draft, ageConfirmed: false })?.field,
        "age",
      );
      assert.equal(
        profileDraftIssue({ ...draft, handle: "", name: "" })?.field,
        "handle",
      );
      assert.equal(
        (await store.actions.createProfile({ ...draft, ageConfirmed: false }))
          .ok,
        false,
      );
      assert.deepEqual(await store.actions.createProfile(draft), { ok: true });
      const state = store.getSnapshot();
      assert.equal(state.status, "signed-in");
      if (state.status === "signed-in") {
        assert.equal(state.profile.handle, "aki_books");
        assert.equal(state.profile.name, "アキ");
        assert.equal(state.profile.reading_visibility, "public");
      }
    },
  );

  await check(
    "a taken ID is explained and the reader can choose again",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set("user-ben", profileOf("user-ben", "aki", "ベン"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      const taken = await store.actions.createProfile({
        handle: "aki",
        name: "アキ",
        ageConfirmed: true,
        readingPublic: false,
      });
      assert.deepEqual(taken, {
        ok: false,
        message: failureMessages["handle-taken"],
      });
      assert.equal(store.getSnapshot().status, "needs-profile");
    },
  );

  await check(
    "「自分の記録だけで使う」: no ID, no name, in 読書管理モード, and a name later",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set("user-ben", profileOf("user-ben", "ben", "ベン"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      // The age is asked of everyone.
      assert.equal((await store.actions.startQuietly(false)).ok, false);
      assert.equal(control.profiles.has(AKI.id), false);
      assert.deepEqual(await store.actions.startQuietly(true), { ok: true });
      const state = store.getSnapshot();
      assert.equal(state.status, "signed-in");
      if (state.status === "signed-in") {
        assert.equal(state.profile.handle, null);
        assert.equal(state.profile.name, "");
        assert.equal(state.profile.published, false);
        assert.equal(state.profile.reading_visibility, "private");
      }
      assert.equal(control.modes.get(AKI.id), "manage");
      // Leaving asks for the word, as there is no ID to type.
      assert.deepEqual(await store.actions.deleteAccount(""), {
        ok: false,
        message: LEAVE_WORD_MISMATCH,
      });
      assert.equal(control.calls.deleteAccount, 0);
      // A name and an ID later: checked, a taken ID said, then public.
      assert.equal(
        (await store.actions.publishProfile({ handle: "ab", name: "アキ" })).ok,
        false,
      );
      assert.deepEqual(
        await store.actions.publishProfile({ handle: "ben", name: "アキ" }),
        { ok: false, message: failureMessages["handle-taken"] },
      );
      assert.deepEqual(
        await store.actions.publishProfile({ handle: " Aki ", name: " アキ " }),
        { ok: true },
      );
      const named = store.getSnapshot();
      if (named.status !== "signed-in") throw new Error("signed out");
      assert.equal(named.profile.handle, "aki");
      assert.equal(named.profile.name, "アキ");
      assert.equal(named.profile.published, true);
      // Now the ID is what confirms leaving.
      assert.deepEqual(await store.actions.deleteAccount(LEAVE_WORD), {
        ok: false,
        message: LEAVE_HANDLE_MISMATCH,
      });
    },
  );

  await check("a returning reader goes straight to their profile", async () => {
    const { backend, control } = fakeBackend();
    control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
    const store = createAccountStore(() => backend, true);
    store.subscribe(() => {});
    control.emit(AKI);
    await settle();
    assert.equal(store.getSnapshot().status, "signed-in");
    // Token refreshes repeat the same user without reading the profile again.
    control.emit(AKI);
    await settle();
    assert.equal(control.calls.loadProfile, 1);
    await store.actions.signOut();
    assert.equal(store.getSnapshot().status, "signed-out");
  });

  /** A browser's memory of 退会, as account-session.ts keeps it. */
  const leavingHere = (store: () => ReturnType<typeof createAccountStore>) => {
    const memory = {
      marked: null as string | null,
      forgotten: [] as string[],
      /** The account's state each time it was let go of. */
      seenAs: [] as string[],
    };
    const leaving: Leaving = {
      pending: () => memory.marked,
      mark: (id) => void (memory.marked = id),
      async forget(id) {
        memory.seenAs.push(store().getSnapshot().status);
        memory.forgotten.push(id);
      },
    };
    return { memory, leaving };
  };

  await check(
    "退会 asks for the reader's own ID, then forgets them here",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const { memory, leaving } = leavingHere(() => store);
      const store = createAccountStore(() => backend, true, leaving);
      const seen: string[] = [];
      store.subscribe(() => seen.push(store.getSnapshot().status));
      control.emit(AKI);
      await settle();
      assert.deepEqual(await store.actions.deleteAccount("akii"), {
        ok: false,
        message: LEAVE_HANDLE_MISMATCH,
      });
      assert.equal(control.calls.deleteAccount, 0);
      control.deleteFails = "leave-failed";
      assert.deepEqual(await store.actions.deleteAccount(" @Aki "), {
        ok: false,
        message: failureMessages["leave-failed"],
      });
      assert.equal(store.getSnapshot().status, "signed-in");
      assert.equal(memory.marked, null);
      assert.deepEqual(memory.forgotten, []);
      control.deleteFails = null;
      // Supabase may tell of the sign-out before the call returns: the
      // page still goes straight from signed in to signed out, after the
      // browser has let go of them and the page was told.
      control.signOutAtOnce = true;
      let told = "";
      seen.length = 0;
      assert.deepEqual(
        await store.actions.deleteAccount("aki", () => {
          told = store.getSnapshot().status;
        }),
        { ok: true },
      );
      await settle();
      assert.equal(told, "signed-in");
      assert.deepEqual(memory.forgotten, [AKI.id]);
      assert.deepEqual(memory.seenAs, ["signed-in"]);
      assert.deepEqual(seen, ["signed-out"]);
      assert.equal(memory.marked, null);
      assert.equal(store.getSnapshot().status, "signed-out");
      assert.equal(control.calls.deleteAccount, 2);
      // Signed out, there is no one to delete.
      assert.equal((await store.actions.deleteAccount("aki")).ok, false);
      assert.equal(control.calls.deleteAccount, 2);
    },
  );

  await check(
    "a 退会 whose answer was lost is finished once the account is found gone",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const { memory, leaving } = leavingHere(() => store);
      const store = createAccountStore(() => backend, true, leaving);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      // Done in the database, but no answer came back.
      control.deleteButLose = true;
      assert.deepEqual(await store.actions.deleteAccount("aki"), {
        ok: false,
        message: failureMessages.network,
      });
      assert.equal(memory.marked, AKI.id);
      assert.deepEqual(memory.forgotten, []);
      // Read again (a reload): no profile any more, so it went through.
      await store.actions.retry();
      assert.deepEqual(memory.forgotten, [AKI.id]);
      assert.equal(memory.marked, null);
      assert.equal(store.getSnapshot().status, "signed-out");

      // Not done, no answer, then the session ends (the account is gone,
      // or the reader signed out): let go of here all the same.
      control.deleteButLose = false;
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      control.emit(AKI);
      await settle();
      control.deleteFails = "network";
      await store.actions.deleteAccount("aki");
      assert.equal(memory.marked, AKI.id);
      control.emit(null);
      await settle();
      assert.deepEqual(memory.forgotten, [AKI.id, AKI.id]);
      assert.equal(memory.marked, null);

      // Not done, and the account is still there: the mark goes, nothing else.
      control.emit(AKI);
      await settle();
      await store.actions.deleteAccount("aki");
      assert.equal(memory.marked, AKI.id);
      await store.actions.retry();
      assert.equal(memory.marked, null);
      assert.equal(store.getSnapshot().status, "signed-in");
      assert.deepEqual(memory.forgotten, [AKI.id, AKI.id]);
    },
  );

  await check(
    "a reader with no profile yet can leave without an ID",
    async () => {
      const { backend, control } = fakeBackend();
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      assert.equal(store.getSnapshot().status, "needs-profile");
      assert.deepEqual(await store.actions.deleteAccount(""), { ok: true });
      assert.equal(store.getSnapshot().status, "signed-out");
    },
  );

  await check("an unreadable profile can be retried", async () => {
    const { backend, control } = fakeBackend();
    control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
    control.loadFails = true;
    const store = createAccountStore(() => backend, true);
    store.subscribe(() => {});
    control.emit(AKI);
    await settle();
    assert.deepEqual(store.getSnapshot(), { status: "unavailable", user: AKI });
    control.loadFails = false;
    await store.actions.retry();
    assert.equal(store.getSnapshot().status, "signed-in");
  });

  await check(
    "a sign-in that ends by itself says who it was; a pressed ログアウト does not",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      await settle();
      // Nobody was signed in: nothing ended.
      assert.deepEqual(store.getSnapshot(), { status: "signed-out" });
      control.emit(AKI);
      await settle();
      assert.equal(store.getSnapshot().status, "signed-in");
      // Signed out on another device, or the session could not be renewed.
      control.emit(null);
      await settle();
      assert.deepEqual(store.getSnapshot(), {
        status: "signed-out",
        lapsed: AKI,
      });
      control.emit(AKI);
      await settle();
      assert.equal(store.getSnapshot().status, "signed-in");
      await store.actions.signOut();
      await settle();
      assert.deepEqual(store.getSnapshot(), { status: "signed-out" });

      // Two tabs share one session: ログアウト pressed in one ends it in the
      // other, which does not call it a lapse. Signed in again, it would.
      let pressed = false;
      const browser: SignedOut = {
        pressed: () => pressed,
        mark: (next) => void (pressed = next),
      };
      const one = fakeBackend();
      const two = fakeBackend();
      for (const { control } of [one, two])
        control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const here = createAccountStore(
        () => one.backend,
        true,
        undefined,
        browser,
      );
      const there = createAccountStore(
        () => two.backend,
        true,
        undefined,
        browser,
      );
      here.subscribe(() => {});
      there.subscribe(() => {});
      await settle();
      one.control.emit(AKI);
      two.control.emit(AKI);
      await settle();
      await here.actions.signOut();
      two.control.emit(null);
      await settle();
      assert.deepEqual(there.getSnapshot(), { status: "signed-out" });
      two.control.emit(AKI);
      await settle();
      assert.equal(pressed, false);
      two.control.emit(null);
      await settle();
      assert.deepEqual(there.getSnapshot(), {
        status: "signed-out",
        lapsed: AKI,
      });
    },
  );

  await check(
    "a restored session is known while its profile is read, and read once",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      control.holdLoads = true;
      let tell: (user: AccountUser | null) => void = () => {};
      // A page opening with a session kept in this browser: no sign-out is
      // told first, and Supabase tells the same session twice.
      const restored: AccountBackend = {
        ...backend,
        onUserChange(next) {
          tell = next;
          return () => {};
        },
      };
      const store = createAccountStore(() => restored, true);
      store.subscribe(() => {});
      assert.deepEqual(store.getSnapshot(), { status: "loading" });
      tell(AKI);
      tell(AKI);
      await settle();
      assert.deepEqual(store.getSnapshot(), {
        status: "loading",
        pending: AKI,
      });
      assert.equal(control.calls.loadProfile, 1);
      control.release();
      await settle();
      assert.equal(store.getSnapshot().status, "signed-in");
      assert.equal(control.calls.loadProfile, 1);
    },
  );

  await check(
    "signing out wins over a profile read still on its way",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      control.holdLoads = true;
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      control.emit(null);
      await settle();
      control.release();
      await settle();
      assert.equal(store.getSnapshot().status, "signed-out");
    },
  );

  await check(
    "a change of address takes a code from each address, the new one first",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      const { changeEmail, confirmEmailChange } = store.actions;
      // Checked here before anything is sent.
      assert.deepEqual(await changeEmail("aki@"), {
        ok: false,
        message: failureMessages["invalid-email"],
      });
      assert.deepEqual(await changeEmail(" AKI@example.jp "), {
        ok: false,
        message: failureMessages["same-email"],
      });
      assert.equal(control.calls.changeEmail, 0);
      assert.deepEqual(await changeEmail("ren@example.jp"), {
        ok: false,
        message: failureMessages["email-taken"],
      });
      assert.deepEqual(await changeEmail(" Aki.New@example.jp"), { ok: true });
      assert.equal(control.change?.email, "aki.new@example.jp");

      const both = {
        email: "aki.new@example.jp",
        newCode: "111111",
        currentCode: "222222",
        newConfirmed: false,
      };
      // A code not yet whole is pointed at, and nothing is checked.
      assert.deepEqual(
        await confirmEmailChange({ ...both, currentCode: "22" }),
        {
          ok: false,
          message: failureMessages["invalid-code"],
          field: "current",
          newConfirmed: false,
        },
      );
      assert.deepEqual(control.calls.confirmEmailChange, []);
      // A wrong new code stops before the current one is used.
      assert.deepEqual(
        await confirmEmailChange({ ...both, newCode: "999999" }),
        {
          ok: false,
          message: failureMessages["invalid-code"],
          field: "new",
          newConfirmed: false,
        },
      );
      assert.deepEqual(control.calls.confirmEmailChange, [
        "aki.new@example.jp",
      ]);
      // The new code taken, a wrong current one: said so, and remembered.
      const half = await confirmEmailChange({
        ...both,
        currentCode: "999999",
      });
      assert.deepEqual(half, {
        ok: false,
        message: failureMessages["invalid-code"],
        field: "current",
        newConfirmed: true,
      });
      assert.equal(store.getSnapshot().status, "signed-in");
      // Then only the current code is checked, and the address changes.
      control.calls.confirmEmailChange.length = 0;
      assert.deepEqual(
        await confirmEmailChange({ ...both, newCode: "", newConfirmed: true }),
        { ok: true },
      );
      assert.deepEqual(control.calls.confirmEmailChange, ["aki@example.jp"]);
      const after = store.getSnapshot();
      assert.equal(after.status, "signed-in");
      assert.equal("user" in after && after.user.email, "aki.new@example.jp");
      // The new session tells the same: the profile is not read again.
      const reads = control.calls.loadProfile;
      await settle();
      const told = store.getSnapshot();
      assert.equal("user" in told && told.user.email, "aki.new@example.jp");
      assert.equal(control.calls.loadProfile, reads);
    },
  );

  await check(
    "codes sent again from another tab start the change over here too",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      await store.actions.changeEmail("new@example.jp");
      // This page took the new code before; the codes were sent again since.
      const result = await store.actions.confirmEmailChange({
        email: "new@example.jp",
        newCode: "",
        currentCode: "222222",
        newConfirmed: true,
      });
      assert.deepEqual(result, {
        ok: false,
        message: failureMessages["invalid-code"],
        field: "new",
        newConfirmed: false,
      });
      assert.match(failureMessages["invalid-code"], /もう一度コードを送って/);
    },
  );

  await check(
    "where one code is enough, the new address's is the one used",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      control.oneCodeEnough = true;
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      assert.deepEqual(await store.actions.changeEmail("new@example.jp"), {
        ok: true,
      });
      assert.deepEqual(
        await store.actions.confirmEmailChange({
          email: "new@example.jp",
          newCode: "111111",
          currentCode: "222222",
          newConfirmed: false,
        }),
        { ok: true },
      );
      assert.deepEqual(control.calls.confirmEmailChange, ["new@example.jp"]);
    },
  );

  await check(
    "an address seen changed elsewhere is taken as it is",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "アキ"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      control.emit(AKI);
      await settle();
      const reads = control.calls.loadProfile;
      // Another tab made the change: the same person, a new address.
      control.emit({ ...AKI, email: "other@example.jp" });
      await settle();
      const now = store.getSnapshot();
      assert.equal(now.status, "signed-in");
      assert.equal("user" in now && now.user.email, "other@example.jp");
      assert.equal(control.calls.loadProfile, reads);
      // Signed out, nothing can be changed.
      control.emit(null);
      await settle();
      assert.deepEqual(await store.actions.changeEmail("x@example.jp"), {
        ok: false,
        message: failureMessages.network,
      });
    },
  );

  await check("Supabase errors become the messages the screen shows", () => {
    assert.equal(
      authFailure({ code: "otp_disabled", status: 422 }),
      "not-invited",
    );
    assert.equal(
      authFailure({ code: "signup_disabled", status: 422 }),
      "not-invited",
    );
    assert.equal(
      authFailure({ code: "otp_expired", status: 403 }),
      "invalid-code",
    );
    assert.equal(
      authFailure({ code: "email_address_not_authorized", status: 400 }),
      "not-invited",
    );
    assert.equal(
      authFailure({ code: "over_email_send_rate_limit", status: 429 }),
      "rate-limited",
    );
    assert.equal(
      authFailure({ code: "email_address_invalid", status: 400 }),
      "invalid-email",
    );
    assert.equal(authFailure({ code: undefined, status: 0 }), "network");
    // A wrong or secret key in the build is refused before anything else.
    assert.equal(
      authFailure({ code: undefined, status: 401 }),
      "misconfigured",
    );
    assert.equal(
      authFailure({ code: "unexpected_failure", status: 500 }),
      "server",
    );
    // Changing the address: the address may be another account's, and an
    // address refused is not about an invitation.
    assert.equal(
      emailChangeFailure({ code: "email_exists", status: 422 }),
      "email-taken",
    );
    assert.equal(
      emailChangeFailure({ code: "email_address_not_authorized", status: 400 }),
      "server",
    );
    assert.equal(
      emailChangeFailure({ code: "otp_expired", status: 403 }),
      "invalid-code",
    );
    assert.equal(
      emailChangeFailure({ code: "over_email_send_rate_limit", status: 429 }),
      "rate-limited",
    );
  });

  await check(
    "a passkey is made while signed in, and signs in without a code",
    async () => {
      const { backend, control } = fakeBackend();
      control.profiles.set(AKI.id, profileOf(AKI.id, "aki", "あき"));
      const store = createAccountStore(() => backend, true);
      store.subscribe(() => {});
      await settle();
      // Signed out, there is nobody to make one for.
      assert.deepEqual(await store.actions.addPasskey(), {
        ok: false,
        message: failureMessages.network,
      });
      // None made yet: the passkey offered is not this town's.
      assert.deepEqual(await store.actions.signInWithPasskey(), {
        ok: false,
        message: failureMessages["passkey-unknown"],
      });
      await store.actions.verifyCode(AKI.email, "123456");
      await settle();
      assert.equal(store.getSnapshot().status, "signed-in");
      assert.deepEqual(await store.actions.addPasskey(), { ok: true });
      assert.deepEqual(await store.actions.addPasskey(), {
        ok: false,
        message: failureMessages["passkey-exists"],
      });
      const listed = await store.actions.listPasskeys();
      assert.ok(listed.ok);
      assert.deepEqual(
        listed.passkeys.map((p) => p.name),
        ["iCloud Keychain"],
      );
      await store.actions.signOut();
      assert.equal(store.getSnapshot().status, "signed-out");
      // Closing the browser's window says nothing.
      control.passkeyWindow = "passkey-cancelled";
      assert.deepEqual(await store.actions.signInWithPasskey(), {
        ok: false,
        message: "",
      });
      control.passkeyWindow = null;
      assert.deepEqual(await store.actions.signInWithPasskey(), { ok: true });
      await settle();
      const state = store.getSnapshot();
      assert.equal(state.status, "signed-in");
      // Removed, it no longer signs anyone in.
      assert.deepEqual(await store.actions.removePasskey("passkey-1"), {
        ok: true,
      });
      const after = await store.actions.listPasskeys();
      assert.deepEqual(after, { ok: true, passkeys: [] });
      control.loadFails = true;
      assert.deepEqual(await store.actions.listPasskeys(), {
        ok: false,
        message: failureMessages.network,
      });
    },
  );

  await check("passkey errors become the messages the screen shows", () => {
    const browser = (code: string, cause?: string) => ({
      __isWebAuthnError: true,
      code,
      cause: cause ? { name: cause } : undefined,
    });
    assert.equal(
      passkeyFailure(
        browser("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "NotAllowedError"),
      ),
      "passkey-cancelled",
    );
    assert.equal(
      passkeyFailure(browser("ERROR_CEREMONY_ABORTED")),
      "passkey-cancelled",
    );
    assert.equal(
      passkeyFailure(browser("ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")),
      "passkey-exists",
    );
    assert.equal(
      passkeyFailure(browser("ERROR_INVALID_DOMAIN", "SecurityError")),
      "passkey-unavailable",
    );
    assert.equal(
      passkeyFailure(browser("ERROR_AUTHENTICATOR_GENERAL_ERROR")),
      "passkey-failed",
    );
    const server = (code: string, status = 400) => ({ code, status });
    assert.equal(
      passkeyFailure(server("passkey_disabled", 403)),
      "passkey-unavailable",
    );
    assert.equal(
      passkeyFailure(server("too_many_passkeys")),
      "passkey-too-many",
    );
    assert.equal(
      passkeyFailure(server("webauthn_credential_exists", 422)),
      "passkey-exists",
    );
    assert.equal(
      passkeyFailure(server("webauthn_credential_not_found", 404)),
      "passkey-unknown",
    );
    assert.equal(
      passkeyFailure(server("webauthn_challenge_expired")),
      "passkey-expired",
    );
    assert.equal(
      passkeyFailure(server("webauthn_verification_failed")),
      "passkey-unknown",
    );
    assert.equal(
      passkeyFailure({ message: "Browser does not support WebAuthn" }),
      "passkey-unavailable",
    );
    assert.equal(
      passkeyFailure(server("over_request_rate_limit", 429)),
      "rate-limited",
    );
    // A session ended elsewhere is not about a code this screen lacks.
    assert.equal(
      passkeyFailure(server("session_not_found", 403)),
      "passkey-failed",
    );
    assert.equal(passkeyFailure({ message: "Failed to fetch" }), "network");
    assert.equal(failureMessages["passkey-cancelled"], "");
    assert.match(failureMessages["passkey-too-many"], /10個まで/);
  });

  await check("a link that did not work is recognized", () => {
    assert.equal(
      linkFailure(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
      "invalid-link",
    );
    assert.equal(linkFailure("#access_token=abc&type=magiclink"), null);
    assert.equal(linkFailure(""), null);
    assert.match(failureMessages["invalid-link"], /もう一度メールを送って/);
  });

  await check("the app and the database reserve the same IDs", () => {
    const sql = readFileSync(
      join(
        __dirname,
        "..",
        "supabase",
        "migrations",
        "20261012000000_initial_schema.sql",
      ),
      "utf8",
    );
    const list = /handle not in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const reserved = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...reserved].sort(), [...RESERVED_HANDLES].sort());
  });

  await check(
    "the name and the ID put in to start with can be used as they are",
    () => {
      for (let i = 0; i < 200; i += 1) {
        const work = suggestProfile();
        assert.equal(handleProblem(work.handle, []), null, work.handle);
        assert.equal(
          profileDraftIssue({
            ...work,
            ageConfirmed: true,
            readingPublic: false,
          }),
          null,
          work.name,
        );
      }
    },
  );

  console.log(passed + " account domain checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
