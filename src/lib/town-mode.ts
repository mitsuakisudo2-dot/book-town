import type { TownState } from "./types";

// 読書管理モード (docs/機能/読書管理モード.md, 管理表 99): the same screens,
// with the town left out. The reader's own books, shelves, records and
// reading stay as they are; others' words, counts, shops and anything that
// reaches people are not shown, nor anything that invites to them.

/** Whether the reader keeps the town out of sight (読書管理モード). */
export const inManageMode = (state: Pick<TownState, "settings">): boolean =>
  state.settings.mode === "manage";

/**
 * The notices kept in 読書管理モード: only the reader's own (a book held
 * back, their reports, what of theirs was folded). Others' are kept for the
 * town: told, as they come, once the reader is back (unseen until then).
 */
const OWN_NOTICES = ["held:", "folded:", "review-", "report:"];
export const ownNotice = (id: string): boolean =>
  OWN_NOTICES.some((prefix) => id.startsWith(prefix));
