import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAccountStore,
  failureMessages,
  LEAVE_HANDLE_MISMATCH,
  linkFailure,
  normalizeCode,
  profileDraftIssue,
  profileDraftProblem,
  type AccountBackend,
  type AccountFailure,
  type AccountUser,
  type Leaving,
} from "../src/lib/account";
import { RESERVED_HANDLES } from "../src/lib/handles";
import { authFailure } from "../src/lib/supabase/account-backend";
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
    async sendCode(email) {
      calls.sendCode += 1;
      return control.invited.has(email) ? null : "not-invited";
    },
    async verifyCode(email, code) {
      calls.verifyCode += 1;
      if (code !== "123456") return "invalid-code";
      listener(email === AKI.email ? AKI : null);
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
      if ([...profiles.values()].some((p) => p.handle === row.handle))
        return { failure: "handle-taken" as AccountFailure };
      const profile = {
        ...profileOf(row.id, row.handle, row.name),
        reading_visibility: row.reading_visibility ?? "private",
      };
      profiles.set(row.id, profile);
      return { profile };
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

  console.log(passed + " account domain checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
