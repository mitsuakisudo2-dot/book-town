import { createAccountStore, useAccount, type AccountState } from "./account";
import { supabaseAccountBackend } from "./supabase/account-backend";
import { getSupabase } from "./supabase/client";
import { supabaseConfigured } from "./supabase/config";
import { forgetAccountSnapshot } from "./home-snapshot";

/** The signed-in reader of this browser, shared by every screen. */
export const accountStore = createAccountStore(() => {
  const client = getSupabase();
  return client ? supabaseAccountBackend(client) : null;
}, supabaseConfigured);

export const accountActions = accountStore.actions;

// Signed out: Home's 便り kept for the account are not left in this browser.
if (typeof window !== "undefined" && supabaseConfigured)
  accountStore.subscribe(() => {
    if (accountStore.getSnapshot().status === "signed-out")
      forgetAccountSnapshot();
  });

export function useAccountState(): AccountState {
  return useAccount(accountStore);
}
