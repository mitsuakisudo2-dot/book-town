import {
  createAccountStore,
  useAccount,
  type AccountState,
  type Leaving,
} from "./account";
import { supabaseAccountBackend } from "./supabase/account-backend";
import { getSupabase } from "./supabase/client";
import { supabaseConfigured } from "./supabase/config";
import { forgetAccountSnapshot } from "./home-snapshot";

const LEAVING_KEY = "book-town-leaving-v1";

/** 退会 in this browser (account.ts, Leaving). */
const leaving: Leaving = {
  pending() {
    try {
      return localStorage.getItem(LEAVING_KEY);
    } catch {
      return null;
    }
  },
  mark(userId) {
    try {
      if (userId) localStorage.setItem(LEAVING_KEY, userId);
      else localStorage.removeItem(LEAVING_KEY);
    } catch {
      // Without storage, a lost answer is not finished after a reload.
    }
  },
  // Loaded when needed: the stores it tells import this module.
  forget: (userId) =>
    import("./leave").then(({ forgetReaderHere }) => forgetReaderHere(userId)),
};

/** The signed-in reader of this browser, shared by every screen. */
export const accountStore = createAccountStore(
  () => {
    const client = getSupabase();
    return client ? supabaseAccountBackend(client) : null;
  },
  supabaseConfigured,
  leaving,
);

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
