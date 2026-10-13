"use client";

import {
  createKeptDraftStore,
  keptIds,
  keptText,
  type KeptDraftOptions,
} from "./kept-draft";
import { PROFILE_LINK_LIMIT } from "./links";
import {
  ownerKeyPattern,
  readOverSaved,
  unchanged,
  type OverSaved,
} from "./shop-draft";
import {
  BIO_MAX_LENGTH,
  NINE_NOTE_MAX_LENGTH,
  READER_NAME_MAX_LENGTH,
  type Reader,
} from "./types";

// The reader's own card (name, @ID, bio, links) and 人生の9冊 (the books in
// their order, and a word for each) while they are being changed. Kept in this
// browser for the reader, so Escape, a tap outside, 戻る or a reload does not
// lose them; each is let go once it is saved, or when the reader throws it
// away.

export const PROFILE_DRAFT_KEY = "book-town-profile-drafts-v1";
export const NINE_DRAFT_KEY = "book-town-nine-drafts-v1";

/** The longest text each field of the forms takes (its maxLength). */
export const PROFILE_FIELDS = {
  name: 40,
  handle: 21,
  bio: 600,
  link: 300,
  note: 140,
} as const;
// Work begins from what is saved, which the town may keep longer than the
// form's own limit; a normalized link gains its scheme and a slash.
const LIMITS = {
  name: Math.max(PROFILE_FIELDS.name, READER_NAME_MAX_LENGTH),
  handle: PROFILE_FIELDS.handle,
  bio: Math.max(PROFILE_FIELDS.bio, BIO_MAX_LENGTH),
  link: PROFILE_FIELDS.link + 100,
  note: Math.max(PROFILE_FIELDS.note, NINE_NOTE_MAX_LENGTH),
};
export const NINE_MAX = 9;

export type ProfileWork = {
  name: string;
  handle: string;
  bio: string;
  /** The link fields as shown, empty ones too (always at least one). */
  links: string[];
};

/** The profile as the form shows it before anything is changed. */
export const profileForm = (
  reader: Pick<Reader, "name" | "handle" | "bio" | "links">,
): ProfileWork => ({
  name: reader.name,
  handle: reader.handle,
  bio: reader.bio,
  links: reader.links?.length ? [...reader.links] : [""],
});

export const sameProfile = (a: ProfileWork, b: ProfileWork) =>
  a.name === b.name &&
  a.handle === b.handle &&
  a.bio === b.bio &&
  a.links.length === b.links.length &&
  a.links.every((link, index) => link === b.links[index]);

/** Whether letting the work go would lose words the reader wrote. */
export const profileLosesWords = (work: ProfileWork, saved: ProfileWork) =>
  (["name", "handle", "bio"] as const).some(
    (field) => work[field].trim() !== "" && work[field] !== saved[field],
  ) ||
  work.links.some((link) => link.trim() !== "" && !saved.links.includes(link));

/** The card read back from storage, if it still fits the form. */
export function readProfileWork(value: unknown): ProfileWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<ProfileWork>;
  if (
    !keptText(work.name, LIMITS.name) ||
    !keptText(work.handle, LIMITS.handle) ||
    !keptText(work.bio, LIMITS.bio) ||
    !Array.isArray(work.links) ||
    !work.links.length ||
    work.links.length > PROFILE_LINK_LIMIT ||
    !work.links.every((link) => keptText(link, LIMITS.link))
  )
    return null;
  return {
    name: work.name,
    handle: work.handle,
    bio: work.bio,
    links: [...work.links],
  };
}

export type NineWork = {
  /** The books in order, up to nine. */
  ids: string[];
  /** A word for each book; a book taken off keeps its word to come back to. */
  notes: Record<string, string>;
};

export const nineForm = (
  reader: Pick<Reader, "lifeNine" | "nineNotes">,
): NineWork => ({
  ids: [...reader.lifeNine],
  notes: { ...reader.nineNotes },
});

/** The same books in the same order, with the same words for them. */
export const sameNine = (a: NineWork, b: NineWork) =>
  a.ids.length === b.ids.length &&
  a.ids.every(
    (id, index) =>
      id === b.ids[index] && (a.notes[id] ?? "") === (b.notes[id] ?? ""),
  );

/** Whether letting the work go would lose a word written for a book in it. */
export const nineLosesWords = (work: NineWork, saved: NineWork) =>
  work.ids.some((id) => {
    const note = work.notes[id] ?? "";
    return note.trim() !== "" && note !== (saved.notes[id] ?? "");
  });

/** Words kept for books taken off, besides the nine in the list. */
const MOST_NOTES = NINE_MAX * 3;

/** The nine read back from storage, if they still fit the editor. */
export function readNineWork(value: unknown): NineWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<NineWork>;
  if (
    !keptIds(work.ids, NINE_MAX) ||
    new Set(work.ids).size !== work.ids.length ||
    !work.notes ||
    typeof work.notes !== "object" ||
    Array.isArray(work.notes)
  )
    return null;
  const notes = Object.entries(work.notes);
  if (
    notes.length > MOST_NOTES ||
    !notes.every(
      ([id, note]) => id && id.length <= 200 && keptText(note, LIMITS.note),
    )
  )
    return null;
  return { ids: [...work.ids], notes: Object.fromEntries(notes) };
}

/** Keyed by owner (workOwner): the reader's own card, over the saved one. */
export const profileDraftOptions: KeptDraftOptions<OverSaved<ProfileWork>> = {
  storageKey: PROFILE_DRAFT_KEY,
  keyPattern: ownerKeyPattern(),
  read: (value) => readOverSaved(value, readProfileWork),
  isEmpty: unchanged,
  limit: 4,
};
export const profileDraftStore = createKeptDraftStore(profileDraftOptions);

/** Keyed by owner (workOwner): the reader's own nine. */
export const nineDraftOptions: KeptDraftOptions<NineWork> = {
  storageKey: NINE_DRAFT_KEY,
  keyPattern: ownerKeyPattern(),
  read: readNineWork,
  limit: 4,
};
export const nineDraftStore = createKeptDraftStore(nineDraftOptions);
