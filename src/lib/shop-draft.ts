"use client";

import type { AccountState } from "./account";
import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { getTownSnapshot } from "./store";
import {
  SHELF_NAME_MAX_LENGTH,
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_TAGLINE_MAX_LENGTH,
  type Shop,
  type ShopTheme,
} from "./types";

// The shop's sign and words (書店の看板と紹介) and a shelf's new name are kept
// in this browser while they are written, so leaving the page, 戻る or a
// reload does not lose them. Each is let go once it is saved, or when the
// reader throws it away.

export const SHOP_SIGN_DRAFT_KEY = "book-town-shop-sign-drafts-v1";
export const SHELF_NAME_DRAFT_KEY = "book-town-shelf-name-drafts-v1";

/**
 * Whose work it is: the demo's reader in this browser, or a signed-in
 * account. Two accounts on one browser never see each other's work; while
 * the account is still being read, nothing is kept.
 */
export function workOwner(account: AccountState): string | null {
  if (account.status === "demo") return "demo";
  return "user" in account ? "reader:" + account.user.id : null;
}

/** An owner's key, as workOwner gives it; the rest of a key follows a "/". */
const OWNER = String.raw`(demo|reader:[\w-]+)`;
export const ownerKeyPattern = (parts = 0) =>
  new RegExp("^" + OWNER + String.raw`(/[^/]+)`.repeat(parts) + "$");

/** Whether the town took a change: one refused leaves the town as it was. */
export function townTook(change: () => unknown): boolean {
  const before = getTownSnapshot();
  change();
  return getTownSnapshot() !== before;
}

const THEMES: ShopTheme[] = ["sage", "ink", "ochre", "rose"];
export const isShopTheme = (value: unknown): value is ShopTheme =>
  THEMES.includes(value as ShopTheme);

export type ShopSign = Pick<Shop, "name" | "tagline" | "description" | "theme">;

export const sameSign = (a: ShopSign, b: ShopSign) =>
  a.name === b.name &&
  a.tagline === b.tagline &&
  a.description === b.description &&
  a.theme === b.theme;

/** Whether letting the sign go would lose words the reader wrote. */
export const signLosesWords = (work: ShopSign, saved: ShopSign) =>
  (["name", "tagline", "description"] as const).some(
    (field) => work[field].trim() !== "" && work[field] !== saved[field],
  );

/** The sign read back from storage, if it still fits the settings form. */
export function readShopSign(value: unknown): ShopSign | null {
  if (!value || typeof value !== "object") return null;
  const sign = value as Partial<ShopSign>;
  if (
    !keptText(sign.name, SHOP_NAME_MAX_LENGTH) ||
    !keptText(sign.tagline, SHOP_TAGLINE_MAX_LENGTH) ||
    !keptText(sign.description, SHOP_DESCRIPTION_MAX_LENGTH) ||
    !isShopTheme(sign.theme)
  )
    return null;
  return {
    name: sign.name,
    tagline: sign.tagline,
    description: sign.description,
    theme: sign.theme,
  };
}

/** Keyed by owner and shop ("demo/mine"). */
export const shopSignDraftOptions: KeptDraftOptions<ShopSign> = {
  storageKey: SHOP_SIGN_DRAFT_KEY,
  keyPattern: ownerKeyPattern(1),
  read: readShopSign,
  limit: 4,
};
export const shopSignDraftStore = createKeptDraftStore(shopSignDraftOptions);

export type ShelfNameWork = { name: string };

/** A shelf's new name read back from storage; an emptied field is not. */
export function readShelfName(value: unknown): ShelfNameWork | null {
  const work = value as Partial<ShelfNameWork> | null;
  if (!work || !keptText(work.name, SHELF_NAME_MAX_LENGTH) || !work.name.trim())
    return null;
  return { name: work.name };
}

/** Keyed by owner, shop and shelf ("demo/mine/shelf-first"). */
export const shelfNameDraftOptions: KeptDraftOptions<ShelfNameWork> = {
  storageKey: SHELF_NAME_DRAFT_KEY,
  keyPattern: ownerKeyPattern(2),
  read: readShelfName,
};
export const shelfNameDraftStore = createKeptDraftStore(shelfNameDraftOptions);
