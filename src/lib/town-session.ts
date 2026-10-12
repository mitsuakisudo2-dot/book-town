import { accountStore } from "./account-session";
import { localTownRepository } from "./repository";
import { getSupabase } from "./supabase/client";
import { accountTownBackend } from "./supabase/town-backend";
import {
  localBackend,
  unavailableBackend,
  type TownBackend,
} from "./town-backend";
import { emptyTown } from "./town-remote";

/**
 * Keeps the town on the right backend as the account changes: the signed-in
 * person's town from Supabase, or the demo in this browser when nobody is
 * signed in. Waits while the account is still being checked.
 */
export function followAccount(switchTo: (backend: TownBackend) => void) {
  let current = "";
  const sync = () => {
    const account = accountStore.getSnapshot();
    if (account.status === "loading") return;
    const client = getSupabase();
    const key =
      account.status === "signed-in" && client
        ? "account:" + account.user.id
        : account.status === "unavailable"
          ? "unavailable"
          : "local";
    if (key === current) return;
    current = key;
    if (account.status === "signed-in" && client)
      switchTo(accountTownBackend(client, account.user.id));
    else if (account.status === "unavailable")
      switchTo(unavailableBackend(emptyTown()));
    else switchTo(localBackend(localTownRepository));
  };
  accountStore.subscribe(sync);
  sync();
}
