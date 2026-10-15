import { ME_ID, type Post, type TownState } from "./types";
import { followedTimelinePosts, timelinePosts } from "./social";
import { timelinePosters, type Poster } from "./posters";

// The 便り of the home: what the reader follows, newest first, and when that
// is quiet, 「街の便り」 from everyone else. Features are woven in between.

const DAY = 24 * 60 * 60 * 1000;

/** The most followed 便り on ホーム; older ones are on 便りだけ. */
export const LETTERS_MAX = 20;
/** The most 「街の便り」 that top up a quiet home. */
export const TOWN_MAX = 10;
/** Fewer followed 便り than this in the last RECENT_DAYS: topped up. */
export const RECENT_ENOUGH = 6;
export const RECENT_DAYS = 14;
/** A feature after every this many 便り. */
export const FEATURE_EVERY = 2;

export type LetterEntry =
  | { kind: "post"; id: string; post: Post; at: number }
  | { kind: "poster"; id: string; poster: Poster; at: number };

const postEntry = (post: Post): LetterEntry => ({
  kind: "post",
  id: post.id,
  post,
  at: Date.parse(post.createdAt) || 0,
});
const posterEntry = (poster: Poster): LetterEntry => ({
  kind: "poster",
  id: "poster:" + poster.id,
  poster,
  at: Date.parse(poster.createdAt) || 0,
});
const newestFirst = (a: LetterEntry, b: LetterEntry) => b.at - a.at;

export const authorOf = (entry: LetterEntry): string =>
  entry.kind === "post" ? entry.post.authorId : entry.poster.authorId;

/**
 * A first-time reader: no shop of their own, following nobody, and no post
 * yet. A visitor is one too. They get the welcome, 本屋を開く and the town's
 * 便り.
 */
export const isNewcomer = (state: TownState): boolean =>
  !state.ownShop &&
  state.following.length === 0 &&
  !state.posts.some((post) => post.authorId === ME_ID);

/**
 * Every 便り the reader follows (the owners of followed shops, and their
 * own), posts and posters together, newest first: 便りだけ.
 */
export function followedLetters(state: TownState): LetterEntry[] {
  return [
    ...followedTimelinePosts(state).map(postEntry),
    ...timelinePosters(state, true).map(posterEntry),
  ].sort(newestFirst);
}

/**
 * A quiet day: not a first-time reader, and nothing from those they follow
 * in the last two weeks. The features may then follow one another.
 */
export const isQuiet = (state: TownState, now: number): boolean =>
  !isNewcomer(state) &&
  !followedLetters(state).some(
    (entry) => authorOf(entry) !== ME_ID && entry.at >= now - RECENT_DAYS * DAY,
  );

export type HomeLetters = {
  /** The followed 便り, newest first, at most LETTERS_MAX. */
  followed: LetterEntry[];
  /** 「街の便り」: others' 便り, when the followed ones are few of late. */
  town: LetterEntry[];
};

/** The 便り of ホーム. */
export function homeLetters(state: TownState, now: number): HomeLetters {
  const followed = followedLetters(state).slice(0, LETTERS_MAX);
  const recent = followed.filter(
    (entry) => entry.at >= now - RECENT_DAYS * DAY,
  ).length;
  if (recent >= RECENT_ENOUGH) return { followed, town: [] };
  const ids = new Set(followed.map((entry) => entry.id));
  const town = [
    ...timelinePosts(state).map(postEntry),
    ...timelinePosters(state).map(posterEntry),
  ]
    .filter((entry) => !ids.has(entry.id))
    .sort(newestFirst)
    .slice(0, TOWN_MAX);
  return { followed, town };
}

/**
 * A 便り a pane drew, read again from the town by its id: the post or poster
 * as it is now (a like, a fold), or null once it is gone.
 */
export function letterOf(state: TownState, id: string): LetterEntry | null {
  if (id.startsWith("poster:")) {
    const poster = state.posters.find((entry) => "poster:" + entry.id === id);
    return poster ? posterEntry(poster) : null;
  }
  const post = state.posts.find((entry) => entry.id === id);
  return post ? postEntry(post) : null;
}

/**
 * The reader's own 便り written after `since`, newest first: the one thing a
 * list held still takes in at once, because the reader asked for it.
 */
export const ownLettersSince = (
  state: TownState,
  since: number,
): LetterEntry[] =>
  followedLetters(state).filter(
    (entry) => authorOf(entry) === ME_ID && entry.at > since,
  );

export type Woven<L, F> =
  { kind: "letter"; letter: L } | { kind: "feature"; feature: F };

/**
 * The 便り with features between them: the k-th feature after the
 * (k × every)-th 便り, so two never meet while 便り last. A slot whose
 * feature is null is skipped (the next keeps its own place). Once the 便り
 * run out, the features left follow one another.
 */
export function weave<L, F>(
  letters: L[],
  features: (F | null)[],
  every = FEATURE_EVERY,
): Woven<L, F>[] {
  const woven: Woven<L, F>[] = [];
  let next = 0;
  letters.forEach((letter, index) => {
    woven.push({ kind: "letter", letter });
    if ((index + 1) % every !== 0 || next >= features.length) return;
    const feature = features[next];
    next += 1;
    if (feature !== null) woven.push({ kind: "feature", feature });
  });
  for (const feature of features.slice(next))
    if (feature !== null) woven.push({ kind: "feature", feature });
  return woven;
}
