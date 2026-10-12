import { createAccountStore, useAccount, type AccountState } from "./account";
import { supabaseAccountBackend } from "./supabase/account-backend";
import { getSupabase } from "./supabase/client";
import { supabaseConfigured } from "./supabase/config";

/** The signed-in reader of this browser, shared by every screen. */
export const accountStore = createAccountStore(() => {
  const client = getSupabase();
  return client ? supabaseAccountBackend(client) : null;
}, supabaseConfigured);

export const accountActions = accountStore.actions;

export function useAccountState(): AccountState {
  return useAccount(accountStore);
}
