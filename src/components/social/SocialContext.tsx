"use client";

import { createContext, useContext } from "react";
import { ME_ID, type Reader, type TownState } from "../../lib/types";
import type { BookLink } from "../../lib/social/types";

export interface ComposerPreset {
  /** Answer this post. */
  replyTo?: string | null;
  /** Start with a book attached, e.g. "write a review" on a work page. */
  book?: BookLink | null;
}

export interface SocialUI {
  notify(message: string): void;
  compose(preset?: ComposerPreset): void;
}

const SocialUIContext = createContext<SocialUI>({
  notify: () => {},
  compose: () => {},
});

export const SocialUIProvider = SocialUIContext.Provider;
export const useSocialUI = () => useContext(SocialUIContext);

export const readerOf = (town: TownState, id: string): Reader | undefined =>
  id === ME_ID ? town.me : town.readers.find((reader) => reader.id === id);
