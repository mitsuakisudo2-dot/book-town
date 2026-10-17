import type { SupabaseClient } from "@supabase/supabase-js";
import { accountStore } from "./account-session";
import { localTownRepository } from "./repository";
import { getSupabase } from "./supabase/client";
import { allRows } from "./supabase/sync";
import { supabaseConfigured } from "./supabase/config";
import { setCoverRefusalLoader } from "./covers";
import type { Database } from "./supabase/database.generated";
import {
  accountTownBackend,
  visitorTownBackend,
} from "./supabase/town-backend";
import {
  accountWalkBackend,
  visitorWalkBackend,
} from "./supabase/walk-backend";
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

interface Backend {
  load(): unknown;
  close?(): void;
}

interface Backends<B extends Backend> {
  local(): B;
  unavailable(): B;
  visitor(client: SupabaseClient<Database>): B;
  account(client: SupabaseClient<Database>, userId: string): B;
}

/** A backend already reading: its first load() is the read under way. */
function readingAhead<B extends Backend>(backend: B): B {
  let first: unknown = backend.load();
  // Not used if the account turns out otherwise: its failure says nothing.
  if (first instanceof Promise) first.catch(() => {});
  return {
    ...backend,
    load() {
      const ahead = first;
      first = undefined;
      return ahead ?? backend.load();
    },
  };
}

/**
 * Keeps a store on the right backend as the account changes: the signed-in
 * person's data in Supabase, the public town to look at when nobody is signed
 * in, or the demo in this browser when the site has no Supabase. Waits while
 * the account is still being checked. Once it knows whose session this is,
 * that person's town is read while their profile is, so the two answers come
 * back together, not one after the other (docs/09 「速さ」); the store still
 * waits, taking no change, until the profile says the town is theirs. A
 * session without a profile moves on to the public town instead.
 */
function followAccountWith<B extends Backend>(
  switchTo: (backend: B) => void,
  backends: Backends<B>,
) {
  let current = "";
  let ahead: { userId: string; backend: B } | null = null;
  const sync = () => {
    const account = accountStore.getSnapshot();
    const client = getSupabase();
    if (account.status === "loading") {
      const pending = account.pending;
      if (pending && client && ahead?.userId !== pending.id) {
        ahead?.backend.close?.();
        ahead = {
          userId: pending.id,
          backend: readingAhead(backends.account(client, pending.id)),
        };
      }
      return;
    }
    const key =
      account.status === "signed-in" && client
        ? "account:" + account.user.id
        : account.status === "unavailable"
          ? "unavailable"
          : client
            ? "visitor"
            : "local";
    const early = ahead;
    ahead = null;
    if (key === current) {
      early?.backend.close?.();
      return;
    }
    current = key;
    if (account.status === "signed-in" && client) {
      if (early && early.userId !== account.user.id) early.backend.close?.();
      switchTo(
        early?.userId === account.user.id
          ? early.backend
          : backends.account(client, account.user.id),
      );
      return;
    }
    early?.backend.close?.();
    if (account.status === "unavailable") switchTo(backends.unavailable());
    else if (client) switchTo(backends.visitor(client));
    else switchTo(backends.local());
  };
  accountStore.subscribe(sync);
  sync();
}

// Covers rights holders asked us not to show (cover_refusals), read by
// everyone who has the database, signed in or not.
if (supabaseConfigured)
  setCoverRefusalLoader(async () => {
    const client = getSupabase();
    if (!client) throw new Error("No database on this page");
    // Every one: a refusal left out would show that cover again.
    return allRows(
      (count) =>
        client.from("cover_refusals").select("isbn, source", { count }),
      ["isbn", "source"],
    );
  });

/** The town: the person's town in Supabase, or the demo in this browser. */
export function followAccount(switchTo: (backend: TownBackend) => void) {
  followAccountWith(switchTo, {
    local: () => localBackend(localTownRepository),
    unavailable: () => unavailableBackend(emptyTown()),
    visitor: visitorTownBackend,
    account: (client, userId) => accountTownBackend(client, userId),
  });
}

/** The bookshop walk and store scenes, following the account like the town. */
export function followAccountWalk(switchTo: (backend: WalkBackend) => void) {
  followAccountWith(switchTo, {
    local: localWalkBackend,
    unavailable: unavailableWalkBackend,
    visitor: visitorWalkBackend,
    account: (client, userId) => accountWalkBackend(client, userId),
  });
}
