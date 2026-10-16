import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";
import type { AccountBackend, AccountFailure, AccountUser } from "../account";
import type { Database } from "./database.types";

const accountUser = (user: User | null | undefined): AccountUser | null =>
  user ? { id: user.id, email: user.email ?? "" } : null;

/** Turns Supabase Auth errors into the few cases the sign-in screen explains. */
export function authFailure(error: Pick<AuthError, "code" | "status">) {
  const code = error.code ?? "";
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    error.status === 429
  )
    return "rate-limited" satisfies AccountFailure;
  // Sign-ups are closed, so an email without an account cannot get a code.
  // Supabase's built-in mail also refuses addresses outside the project team.
  if (
    code === "otp_disabled" ||
    code === "signup_disabled" ||
    code === "email_address_not_authorized"
  )
    return "not-invited" satisfies AccountFailure;
  if (code === "otp_expired" || error.status === 403)
    return "invalid-code" satisfies AccountFailure;
  if (code === "email_address_invalid" || code === "validation_failed")
    return "invalid-email" satisfies AccountFailure;
  // The site's key was refused: the build was given a wrong or secret key.
  if (error.status === 401) return "misconfigured" satisfies AccountFailure;
  // No answer at all: offline, or the build points at a wrong address.
  if (!error.status) return "network" satisfies AccountFailure;
  return "server" satisfies AccountFailure;
}

export function supabaseAccountBackend(
  client: SupabaseClient<Database>,
): AccountBackend {
  return {
    onUserChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const user = accountUser(session?.user);
        // Supabase asks callers not to await other auth calls inside this callback.
        setTimeout(() => listener(user), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          // Supabase uses this only when it is on the project's list of
          // redirect URLs, and falls back to the Site URL otherwise.
          ...(typeof window !== "undefined"
            ? { emailRedirectTo: window.location.origin + "/login/" }
            : {}),
        },
      });
      return error ? authFailure(error) : null;
    },
    async verifyCode(email, code) {
      const { error } = await client.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      return error ? authFailure(error) : null;
    },
    async signOut() {
      await client.auth.signOut();
    },
    async deleteAccount() {
      // One statement in the database: either all of it goes or nothing
      // does. Asked again after an answer that was lost, it deletes nothing
      // more and succeeds.
      const { error } = await client.rpc("delete_my_account");
      // No code: no answer came (offline), so it may be tried again. 42501:
      // the call went without a session, which a deletion that went through
      // ends (its refresh token went with the account). Neither says nothing
      // went, so the account stays marked as leaving (account.ts, Leaving).
      if (error)
        return !error.code || error.code === "42501"
          ? "network"
          : "leave-failed";
      // Lets go of the session here. The server has none left to end, and
      // says so; supabase-js takes that as done.
      await client.auth.signOut({ scope: "local" });
      return null;
    },
    async loadProfile(userId) {
      const { data, error } = await client
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async createProfile(row) {
      const { data, error } = await client
        .from("profiles")
        .insert(row)
        .select()
        .single();
      if (error)
        return {
          failure:
            error.code === "23505"
              ? "handle-taken"
              : error.code === "23514"
                ? "invalid-profile"
                : "network",
        };
      return { profile: data };
    },
  };
}
