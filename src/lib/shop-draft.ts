"use client";

import { useEffect, useRef, useState } from "react";
import { DRAFT_OWNER } from "./draft-owner";
import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
  type KeptDraftStore,
} from "./kept-draft";
import { getTownSnapshot, townStore, usePersistenceStatus } from "./store";
import type { Write } from "./town-remote";
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

type Held = {
  what: string;
  letGo: () => void;
  /** The kind of change it went as, and what the town had missed before. */
  kind?: Write["kind"];
  after: number;
  /** The town it was handed to (townStore's generation). */
  generation: number;
};

/**
 * How work handed to the town came back: turned away, or not sent because
 * it had been saved over on another device (the town tells that above).
 */
export type NotSaved = "refused" | "elsewhere";

/**
 * Work handed to the town stays kept until the town says it is saved. An
 * account's database can still turn a change away after the screen has moved
 * on; the town then goes back to what is saved, the work is still here to be
 * shown again, and `onRefused` hears which work it was, and how.
 */
export function useKeptUntilSaved(
  onRefused: (what: string, how: NotSaved) => void,
) {
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
    const missed = townStore.getMissedSnapshot();
    const generation = townStore.getGeneration();
    for (const work of settled) {
      // Another town shown since (signed out meanwhile): the change may yet
      // be sent from the account's outbox, so the work stays kept.
      if (work.generation !== generation) continue;
      if (status === "saved") {
        work.letGo();
        continue;
      }
      // What the town missed since the work was handed to it says how the
      // work's own change went; without it, it is told as turned away.
      const told = work.kind && missed && missed.id > work.after;
      const kindOf = (writes: Write[]) =>
        writes.some((write) => write.kind === work.kind);
      if (!told || kindOf(missed.refused))
        refused.current(work.what, "refused");
      else if (kindOf(missed.elsewhere))
        refused.current(work.what, "elsewhere");
      // Saved with the rest: only another change was turned away.
      else work.letGo();
    }
  }, [status, handed]);
  return {
    /** All the town holds is saved: kept work that matches it can go. */
    settled: status === "saved",
    /**
     * Keeps `value` under `key` until the town is saved, then lets it go
     * (unless it has been written over since). `value` is the work as the
     * town now holds it, so the screen shows what was saved meanwhile.
     * `kind` is the change it goes as, which tells how it went.
     */
    hold<T>(
      what: string,
      store: KeptDraftStore<T>,
      key: string,
      value: T,
      kind?: Write["kind"],
    ) {
      store.set(key, value);
      const kept = store.get(key);
      const letGo = () => {
        if (kept !== null && store.get(key) === kept) store.clear(key);
      };
      held.current = [
        ...held.current.filter((work) => work.what !== what),
        {
          what,
          letGo,
          kind,
          after: townStore.getMissedSnapshot()?.id ?? 0,
          generation: townStore.getGeneration(),
        },
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

/** The same value: lists entry by entry, objects field by field in any order. */
export const sameField = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length &&
      a.every((entry, index) => sameField(entry, b[index]))
    );
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) ||
    Array.isArray(b)
  )
    return a === b;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>) =>
    Object.keys(o).filter((key) => o[key] !== undefined);
  return (
    keys(x).length === keys(y).length &&
    keys(x).every((key) => sameField(x[key], y[key]))
  );
};

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
