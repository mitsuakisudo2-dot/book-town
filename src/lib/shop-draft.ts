"use client";

import { useEffect, useRef, useState } from "react";
import { DRAFT_OWNER } from "./draft-owner";
import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
  type KeptDraftStore,
} from "./kept-draft";
import { getTownSnapshot, usePersistenceStatus } from "./store";
import {
  SHELF_NAME_MAX_LENGTH,
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_TAGLINE_MAX_LENGTH,
  type Shop,
  type ShopTheme,
} from "./types";
import { failure, AGAIN, KEPT } from "./words";

// The shop's sign and words (書店の看板と紹介) and a shelf's new name are kept
// in this browser while they are written, so leaving the page, 戻る or a
// reload does not lose them. Each is let go once it is saved, or when the
// reader throws it away.

export const SHOP_SIGN_DRAFT_KEY = "book-town-shop-sign-drafts-v1";
export const SHELF_NAME_DRAFT_KEY = "book-town-shelf-name-drafts-v1";

/**
 * A key that starts with its owner (draftOwner), so two accounts on one
 * browser never see each other's work; the rest of a key follows a "/".
 */
export const ownerKeyPattern = (parts = 0) =>
  new RegExp("^" + DRAFT_OWNER + String.raw`(/[^/]+)`.repeat(parts) + "$");

/** Said when a save is turned away: the work stays in hand, kept. */
export const SAVE_REFUSED = failure({
  what: "うまく保存できませんでした",
  kept: KEPT.draft,
  next: AGAIN.later,
});

/** Whether the town took a change: one refused leaves the town as it was. */
export function townTook(change: () => unknown): boolean {
  const before = getTownSnapshot();
  change();
  return getTownSnapshot() !== before;
}

type Held = { what: string; letGo: () => void };

/**
 * Work handed to the town stays kept until the town says it is saved. An
 * account's database can still turn a change away after the screen has moved
 * on; the town then goes back to what is saved, the work is still here to be
 * shown again, and `onRefused` hears which work it was.
 */
export function useKeptUntilSaved(onRefused: (what: string) => void) {
  const status = usePersistenceStatus();
  const held = useRef<Held[]>([]);
  const [handed, setHanded] = useState(0);
  const refused = useRef(onRefused);
  useEffect(() => {
    refused.current = onRefused;
  });
  useEffect(() => {
    if (!held.current.length || (status !== "saved" && status !== "recovered"))
      return;
    const settled = held.current;
    held.current = [];
    for (const work of settled)
      if (status === "saved") work.letGo();
      else refused.current(work.what);
  }, [status, handed]);
  return {
    /** All the town holds is saved: kept work that matches it can go. */
    settled: status === "saved",
    /**
     * Keeps `value` under `key` until the town is saved, then lets it go
     * (unless it has been written over since). `value` is the work as the
     * town now holds it, so the screen shows what was saved meanwhile.
     */
    hold<T>(what: string, store: KeptDraftStore<T>, key: string, value: T) {
      store.set(key, value);
      const kept = store.get(key);
      const letGo = () => {
        if (kept !== null && store.get(key) === kept) store.clear(key);
      };
      held.current = [
        ...held.current.filter((work) => work.what !== what),
        { what, letGo },
      ];
      setHanded((count) => count + 1);
    },
  };
}

/**
 * Work on a form, kept with what was saved when it was last written. The
 * fields the reader changed keep their words; the others follow what is saved
 * now, so work kept on one device never puts back an older value saved since
 * on another.
 */
export type OverSaved<T> = { work: T; base: T };

const sameField = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((entry, index) => entry === b[index])
    : a === b;

/** The work over what is saved now; null when that leaves nothing changed. */
export function overSaved<T extends object>(
  kept: OverSaved<T> | null,
  saved: T,
): T | null {
  if (!kept) return null;
  const work = { ...saved };
  let changed = false;
  for (const field of Object.keys(saved) as (keyof T)[]) {
    if (sameField(kept.work[field], kept.base[field])) continue;
    work[field] = kept.work[field];
    changed ||= !sameField(work[field], saved[field]);
  }
  return changed ? work : null;
}

/** Kept work read back from storage, if both its sides fit the form. */
export function readOverSaved<T>(
  value: unknown,
  read: (side: unknown) => T | null,
): OverSaved<T> | null {
  if (!value || typeof value !== "object") return null;
  const kept = value as Partial<OverSaved<unknown>>;
  const work = read(kept.work);
  const base = read(kept.base);
  return work && base ? { work, base } : null;
}

/** Nothing changed from what was saved: nothing to keep. */
export const unchanged = <T extends object>(kept: OverSaved<T>) =>
  (Object.keys(kept.work) as (keyof T)[]).every((field) =>
    sameField(kept.work[field], kept.base[field]),
  );

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

/** Keyed by owner and shop ("demo/mine"), with the sign it was written over. */
export const shopSignDraftOptions: KeptDraftOptions<OverSaved<ShopSign>> = {
  storageKey: SHOP_SIGN_DRAFT_KEY,
  keyPattern: ownerKeyPattern(1),
  read: (value) => readOverSaved(value, readShopSign),
  isEmpty: unchanged,
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
