import type { AccountState } from "./account";

/**
 * Whose work a kept draft is, the first part of its key, so what one account
 * left unsent in this browser never shows for another: the signed-in reader
 * (by account), the demo's one reader, or someone not signed in. Null while
 * the account is still being checked: nothing is kept until it is known.
 * Every store that keeps a reader's own work keys it this way (posts and
 * posters, records, reports, the shop, its scene, the profile).
 */
export function draftOwner(account: AccountState): string | null {
  switch (account.status) {
    case "loading":
      return null;
    case "demo":
      return "demo";
    case "signed-out":
      return "visitor";
    default:
      return account.user.id;
  }
}

/** An owner as draftOwner gives it, for the start of a store's key pattern. */
export const DRAFT_OWNER = String.raw`[\w-]+`;
