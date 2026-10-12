import type { SupabaseClient } from "@supabase/supabase-js";
import { accountStore } from "./account-session";
import { localTownRepository } from "./repository";
import { getSupabase } from "./supabase/client";
import type { Database } from "./supabase/database.generated";
import { accountTownBackend } from "./supabase/town-backend";
import { accountWalkBackend } from "./supabase/walk-backend";
import {
  localBackend,
  unavailableBackend,
  type TownBackend,
} from "./town-backend";
import { emptyTown } from "./town-remote";
import {
  localWalkBackend,
  unavailableWalkBackend,
  type WalkBackend,
} from "./walk-backend";

interface Backends<B> {
  local(): B;
  unavailable(): B;
  account(client: SupabaseClient<Database>, userId: string): B;
}

/**
 * Keeps a store on the right backend as the account changes: the signed-in
 * person's data in Supabase, or the demo in this browser when nobody is signed
 * in. Waits while the account is still being checked.
 */
function followAccountWith<B>(
  switchTo: (backend: B) => void,
  backends: Backends<B>,
) {
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
      switchTo(backends.account(client, account.user.id));
    else if (account.status === "unavailable") switchTo(backends.unavailable());
    else switchTo(backends.local());
  };
  accountStore.subscribe(sync);
  sync();
}

/** The town: the person's town in Supabase, or the demo in this browser. */
export function followAccount(switchTo: (backend: TownBackend) => void) {
  followAccountWith(switchTo, {
    local: () => localBackend(localTownRepository),
    unavailable: () => unavailableBackend(emptyTown()),
    account: (client, userId) => accountTownBackend(client, userId),
  });
}

/** The bookshop walk and store scenes, following the account like the town. */
export function followAccountWalk(switchTo: (backend: WalkBackend) => void) {
  followAccountWith(switchTo, {
    local: localWalkBackend,
    unavailable: unavailableWalkBackend,
    account: (client, userId) => accountWalkBackend(client, userId),
  });
}
