"use client";

import {
  createKeptDraftStore,
  keptIds,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { isShopTheme, ownerKeyPattern } from "./shop-draft";
import {
  POP_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_TAGLINE_MAX_LENGTH,
  type ShopTheme,
} from "./types";

// 3分で開店, while it is under way: the kind of shop, the step reached, the
// books chosen for it in their order, the POP and the sign. It is kept in this
// browser for the reader, so 戻る, leaving the page or a reload does not lose
// it; it is let go once the shop opens, or when the reader throws it away.

export const OPEN_SHOP_DRAFT_KEY = "book-town-open-shop-drafts-v1";

export type OpenShopKind = "nine" | "five" | "one" | "free";
export type ShelfKind = Exclude<OpenShopKind, "free">;

/** The most books each kind of shop opens with. */
export const OPEN_SHOP_MAX: Record<ShelfKind, number> = {
  nine: 9,
  five: 5,
  one: 1,
};

export type OpenShopWork = {
  kind: OpenShopKind;
  /** The step to go on from. */
  step: "books" | "sign";
  /**
   * The books chosen for each kind, in order (the first faces out). A kind
   * not touched yet starts from its usual books.
   */
  picks: Partial<Record<ShelfKind, string[]>>;
  pop: string;
  name: string;
  tagline: string;
  theme: ShopTheme;
};

export const FRESH_OPEN_SHOP: Omit<OpenShopWork, "kind" | "step"> = {
  picks: {},
  pop: "",
  name: "",
  tagline: "",
  theme: "sage",
};

const KINDS: OpenShopKind[] = ["nine", "five", "one", "free"];

/** The work read back from storage, if it is still a shape the flow makes. */
export function readOpenShopWork(value: unknown): OpenShopWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<OpenShopWork>;
  const kind = work.kind as OpenShopKind;
  if (
    !KINDS.includes(kind) ||
    !(work.step === "sign" || (work.step === "books" && kind !== "free")) ||
    !work.picks ||
    typeof work.picks !== "object" ||
    Array.isArray(work.picks) ||
    !keptText(work.pop, POP_MAX_LENGTH) ||
    !keptText(work.name, SHOP_NAME_MAX_LENGTH) ||
    !keptText(work.tagline, SHOP_TAGLINE_MAX_LENGTH) ||
    !isShopTheme(work.theme)
  )
    return null;
  const picks: OpenShopWork["picks"] = {};
  for (const [shelf, ids] of Object.entries(work.picks)) {
    const max = OPEN_SHOP_MAX[shelf as ShelfKind];
    if (!max || !keptIds(ids, max) || new Set(ids).size !== ids.length)
      return null;
    picks[shelf as ShelfKind] = [...ids];
  }
  return {
    kind,
    step: work.step,
    picks,
    pop: work.pop,
    name: work.name,
    tagline: work.tagline,
    theme: work.theme,
  };
}

/** Nothing chosen or written yet: only the kind, which is not kept alone. */
export const openShopUntouched = (work: OpenShopWork) =>
  !Object.keys(work.picks).length &&
  !work.pop &&
  !work.name &&
  !work.tagline &&
  work.theme === FRESH_OPEN_SHOP.theme;

/** Whether letting the work go would lose words the reader wrote. */
export const openShopHasWords = (work: OpenShopWork) =>
  [work.pop, work.name, work.tagline].some((text) => text.trim() !== "");

/** Keyed by owner (workOwner): one opening at a time for each reader. */
export const openShopDraftOptions: KeptDraftOptions<OpenShopWork> = {
  storageKey: OPEN_SHOP_DRAFT_KEY,
  keyPattern: ownerKeyPattern(),
  read: readOpenShopWork,
  isEmpty: openShopUntouched,
  limit: 4,
};
export const openShopDraftStore = createKeptDraftStore(openShopDraftOptions);
