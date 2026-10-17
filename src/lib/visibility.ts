/**
 * 見せる範囲 (item 8 of the 2026-10-16 plan). What a reader keeps is shown as
 * far as they say, in two parts kept apart: who may read it (audience) and,
 * for 読書の状態 only, whether the thing itself is shown or only counted
 * (detail). The screens offer four choices made of them. The database keeps
 * the same rules (supabase/migrations/*_visibility.sql, private.may_see), and
 * docs/09「見せる範囲」has them in words.
 */

import { ME_ID, type TownState } from "./types";

/** Who may read: everyone, the people following the reader, or the reader alone. */
export const AUDIENCES = ["everyone", "followers", "private"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** What is shown: the thing itself, or only that one more person counts (人数だけ). */
export const DETAILS = ["content", "count"] as const;
export type Detail = (typeof DETAILS)[number];

export interface Visibility {
  audience: Audience;
  detail: Detail;
}

/**
 * The four choices on screen, the narrowest first: 自分だけ leads, as it has
 * since records began private (2026-10-13).
 */
export const CHOICES = ["private", "count", "followers", "everyone"] as const;
export type Choice = (typeof CHOICES)[number];

export const CHOICE_NAMES: Record<Choice, string> = {
  everyone: "公開",
  followers: "フォロワー限定",
  count: "人数だけ",
  private: "自分だけ",
};

/**
 * Whether フォロワー限定 may be chosen. Not until following people and 鍵
 * come (item 51): until then anyone may follow anyone, and the choice would
 * read as narrower than it is.
 */
export const FOLLOWERS_OPEN = false;

/**
 * Each kind of thing a reader keeps, with its own starting choice
 * (reader_settings.<kind>_audience). Only records are shown to others today;
 * the others come with their screens.
 */
export const VISIBILITY_KINDS = [
  "status",
  "records",
  "shelves",
  "stats",
  "likes",
  "saves",
  "encounters",
] as const;
export type VisibilityKind = (typeof VISIBILITY_KINDS)[number];

export type Visibilities = Record<VisibilityKind, Visibility>;

/**
 * Who may see each of the shelves every library has, by its key
 * (src/lib/library.ts DEFAULT_SHELVES); one not named follows the starting
 * choice of shelves.
 */
export type ShelfAudiences = Partial<Record<string, Audience>>;

const content = (audience: Audience): Visibility => ({
  audience,
  detail: "content",
});

/** The owner's defaults (2026-10-16 05:31Z): 読書の状態 人数だけ, the rest 自分だけ. */
export const DEFAULT_VISIBILITIES: Visibilities = {
  status: { audience: "everyone", detail: "count" },
  records: content("private"),
  shelves: content("private"),
  stats: content("private"),
  likes: content("private"),
  saves: content("private"),
  encounters: content("private"),
};

/** Only 読書の状態 can be counted without names. */
const COUNTED: readonly VisibilityKind[] = ["status"];

/** The choices a kind offers now, the narrowest first. */
export function choicesFor(kind: VisibilityKind): Choice[] {
  return CHOICES.filter(
    (choice) =>
      (choice !== "count" || COUNTED.includes(kind)) &&
      (choice !== "followers" || FOLLOWERS_OPEN),
  );
}

export function choiceOf(visibility: Visibility): Choice {
  if (visibility.audience === "private") return "private";
  if (visibility.audience === "followers") return "followers";
  return visibility.detail === "count" ? "count" : "everyone";
}

export function visibilityOf(choice: Choice): Visibility {
  switch (choice) {
    case "everyone":
      return content("everyone");
    case "followers":
      return content("followers");
    case "count":
      return { audience: "everyone", detail: "count" };
    case "private":
      return content("private");
  }
}

const RANK: Record<Audience, number> = {
  private: 0,
  followers: 1,
  everyone: 2,
};

/**
 * Whether next lets nobody read more than before: no one who could not read
 * comes to, and no one who saw a count comes to see names. The database's
 * private.audience_rank orders audiences the same way.
 */
export function isNarrowing(before: Visibility, next: Visibility): boolean {
  if (next.audience === "private") return true;
  if (RANK[next.audience] > RANK[before.audience]) return false;
  return (
    next.detail === "count" ||
    before.detail === "content" ||
    before.audience === "private"
  );
}

/** An audience no wider than the limit. */
export function narrowAudience(audience: Audience, limit: Audience): Audience {
  return RANK[audience] > RANK[limit] ? limit : audience;
}

export const isAudience = (value: unknown): value is Audience =>
  (AUDIENCES as readonly unknown[]).includes(value);
export const isDetail = (value: unknown): value is Detail =>
  (DETAILS as readonly unknown[]).includes(value);

/** Saved settings as far as they are valid, the defaults for the rest. */
export function cleanVisibilities(saved: unknown): Visibilities {
  const given =
    saved && typeof saved === "object"
      ? (saved as Partial<Record<VisibilityKind, Partial<Visibility>>>)
      : {};
  return Object.fromEntries(
    VISIBILITY_KINDS.map((kind) => {
      const fallback = DEFAULT_VISIBILITIES[kind];
      const one = given[kind];
      return [
        kind,
        {
          audience: isAudience(one?.audience)
            ? one.audience
            : fallback.audience,
          detail:
            COUNTED.includes(kind) && isDetail(one?.detail)
              ? one.detail
              : fallback.detail,
        },
      ];
    }),
  ) as Visibilities;
}

/** Whether a record is shown beyond its reader. */
export const shownToOthers = (audience: Audience) => audience !== "private";

/**
 * The town with a kind's starting choice changed. A narrower one narrows
 * what the reader kept before at once, records and shelves set one by one
 * too (the database does the same, private.narrow_past and
 * private.narrow_shelves). A wider one widens only the records and shelves
 * that were at the old starting choice, and only when the reader said so
 * (past); the others keep their own choice.
 */
export function withVisibility(
  state: TownState,
  kind: VisibilityKind,
  next: Visibility,
  past: boolean,
): TownState {
  const before = state.settings.visibility[kind];
  if (before.audience === next.audience && before.detail === next.detail)
    return state;
  const settings = {
    ...state.settings,
    visibility: { ...state.settings.visibility, [kind]: next },
  };
  if (kind !== "records" && kind !== "shelves") return { ...state, settings };
  const narrowing = isNarrowing(before, next);
  if (!narrowing && !past) return { ...state, settings };
  const moved = (audience: Audience) =>
    narrowing
      ? narrowAudience(audience, next.audience)
      : audience === before.audience
        ? next.audience
        : audience;
  if (kind === "shelves")
    return {
      ...state,
      settings: {
        ...settings,
        shelfAudiences: Object.fromEntries(
          Object.entries(settings.shelfAudiences).map(([key, audience]) => [
            key,
            audience && moved(audience),
          ]),
        ),
      },
      libraryShelves: state.libraryShelves.map((shelf) => {
        const audience = moved(shelf.audience);
        return audience === shelf.audience ? shelf : { ...shelf, audience };
      }),
    };
  return {
    ...state,
    settings,
    readingRecords: state.readingRecords.map((record) => {
      if (record.readerId !== ME_ID) return record;
      const audience = moved(record.audience);
      return audience === record.audience ? record : { ...record, audience };
    }),
  };
}
