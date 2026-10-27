"use client";
import { useSyncExternalStore } from "react";
import { inManageMode } from "./town-mode";
import { cardSessions } from "./reading-cards";
import type { PosterDraft } from "./posters";
import type {
  LibraryShelfChange,
  PostDraft,
  ReadingMode,
  RecordDraft,
  TownActions,
  TownState,
} from "./types";
import type { Audience, Choice } from "./visibility";

/**
 * A reader who started with 「人とつながらず、自分の記録だけで使う」 has no
 * public profile: no ID, perhaps no name, seen by nobody (管理表 99, けにーさん
 * 10-25 15:39Z, decision 5). In the usual mode they look round the town
 * freely; the first thing they do that would reach someone asks for a name
 * and an ID in a small sheet, and once those are chosen the thing goes on.
 * Their records from before stay their own. In 読書管理モード nothing that
 * reaches people is offered, so nothing asks.
 */
export const needsName = (state: Pick<TownState, "me" | "settings">) =>
  state.me.unpublished === true && !inManageMode(state);

/** What the reader is called on their own screens, with no name yet. */
export const OWN_NAME_UNSET = "あなた";
export const ownName = (me: TownState["me"]) =>
  me.name.trim() || OWN_NAME_UNSET;

const wider = (audience: Audience | Choice | undefined) =>
  audience !== undefined && audience !== "private";

/**
 * Whether an action, with these arguments, would reach other people
 * (private.reaches_people in reading_mode lists them). A reader with no
 * public profile has never followed, liked or reacted, so every toggle of
 * theirs is the first. A 便り written while reading alone is a private note.
 */
const REACHES: Partial<
  Record<keyof TownActions, (args: unknown[], state: TownState) => boolean>
> = {
  createShop: () => true,
  toggleFollow: () => true,
  togglePopReaction: () => true,
  toggleLike: () => true,
  tapLike: () => true,
  toggleWant: () => true,
  createPost: ([draft], state) => {
    const post = draft as PostDraft;
    if (!post.fromReading || post.parentId) return true;
    const running = state.readingSessions.find((s) => s.endedAt === null);
    return running?.mode === "together";
  },
  startReading: ([, mode]) => (mode as ReadingMode) === "together",
  // Reading together, another book or reading on again is seen by others.
  changeReadingBook: (_, state) =>
    state.readingSessions.some(
      (s) => s.endedAt === null && s.mode === "together",
    ),
  readOn: ([cardId], state) =>
    cardSessions(state, cardId as string).at(-1)?.mode === "together",
  savePoster: ([draft]) => (draft as PosterDraft).status === "published",
  recordReading: ([draft]) => wider((draft as RecordDraft).audience),
  updateRecord: ([, patch]) => wider((patch as Partial<RecordDraft>).audience),
  setVisibility: ([, choice]) => wider(choice as Choice),
  makeLibraryShelf: ([, , more]) =>
    wider((more as LibraryShelfChange | undefined)?.audience),
  editLibraryShelf: ([, change]) =>
    wider((change as LibraryShelfChange).audience),
  setDefaultShelfAudience: ([, audience]) => wider(audience as Audience),
};

export const reachesPeople = (
  name: keyof TownActions,
  args: unknown[],
  state: TownState,
) => REACHES[name]?.(args, state) ?? false;

/**
 * Actions sent from a sheet the reader wrote in (a 便り, a record, a
 * poster, the shop being opened): the sheet itself goes on after the name (askFirst), so its words
 * are sent once and leave the sheet as a sent thing does.
 */
export const WRITTEN = new Set<keyof TownActions>([
  "createShop",
  "createPost",
  "recordReading",
  "updateRecord",
  "savePoster",
]);

/**
 * Asks for the name first when the action would reach people and the
 * reader has none: true when it asked (`then` runs once the name is
 * chosen), false when the action can go ahead. Give it the town as it is
 * now (getTownSnapshot), not as a screen last drew it.
 */
export function askFirst<Name extends keyof TownActions>(
  state: TownState,
  name: Name,
  args: Parameters<TownActions[Name]>,
  then: () => void,
): boolean {
  if (!needsName(state) || !reachesPeople(name, args, state)) return false;
  askForName(then);
  return true;
}

// The sheet that asks for a name: one at a time, with what goes on after.
let asked: (() => void) | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

/** Opens the sheet; `then` runs once a name and an ID are chosen. */
export function askForName(then: () => void) {
  asked = then;
  tell();
}
/** Closes the sheet, running what waited when the name was chosen. */
export function answerName(chosen: boolean) {
  const then = asked;
  asked = null;
  tell();
  if (chosen) then?.();
}
/** Read at the moment of a change, before the page has re-rendered. */
export const nameAsked = () => asked !== null;

export function useNameRequest(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => asked !== null,
    () => false,
  );
}
