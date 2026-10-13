import type { Post, TownState } from "./types";
import { coverHidden } from "./hidden-words";
import {
  readTextQuery,
  sameText,
  textKey as tagKey,
  textMatch,
  TEXT_MATCH,
} from "./search/text";

// A tag is # (or the full-width ＃) followed by letters, digits, _ or Japanese marks.
const TAG = /[#＃]([\p{L}\p{N}_ー・々〆]{1,30})/gu;
const BOUNDARY = /[\p{L}\p{N}_]/u;

/**
 * Tags written in a post, without the #, in the order written. Latin letters are
 * lowercased. A tag inside covered words stays covered and is not a tag.
 */
export function extractTags(post: string): string[] {
  const body = coverHidden(post);
  const tags: string[] = [];
  for (const match of body.matchAll(TAG)) {
    const before = body[(match.index ?? 0) - 1];
    if (before && BOUNDARY.test(before)) continue;
    const tag = match[1].toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 10);
}

export type BodyPart = { text: string; tag?: string };

/** Splits a post into plain text and tags so the tags can be shown as links. */
export function splitTags(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(TAG)) {
    const index = match.index ?? 0;
    const before = body[index - 1];
    if (before && BOUNDARY.test(before)) continue;
    if (index > last) parts.push({ text: body.slice(last, index) });
    parts.push({ text: match[0], tag: match[1].toLowerCase() });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/**
 * Whether a tag is the one asked for: the same once folded, or read from
 * romaji (#misuteri is #ミステリ).
 */
function tagFinder(asked: string): (tag: string) => boolean {
  const query = readTextQuery(asked);
  const key = tagKey(asked);
  return (tag) =>
    tagKey(tag) === key || textMatch(query, [tag]) === TEXT_MATCH.exact;
}

/** Public posts that carry a tag, newest first. Private reading notes never appear. */
export function postsWithTag(state: TownState, tag: string): Post[] {
  const asked = tagFinder(tag);
  return state.posts
    .filter(
      (post) =>
        post.readingMode !== "solo" && extractTags(post.body).some(asked),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Tags in use across public posts, most used first: the number of posts that
 * carry each. Spellings of one tag count together, under the one used most,
 * and a post that writes a tag in several spellings counts once.
 */
export function popularTags(state: TownState, limit = 12) {
  const counts = new Map<
    string,
    { count: number; spellings: Map<string, number> }
  >();
  for (const post of state.posts) {
    if (post.readingMode === "solo") continue;
    const seen = new Set<string>();
    for (const tag of extractTags(post.body)) {
      const key = tagKey(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { count: 0, spellings: new Map() };
      entry.count++;
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1);
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .map(({ count, spellings }) => ({
      tag: [...spellings].sort((a, b) => b[1] - a[1])[0][0],
      count,
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"))
    .slice(0, limit);
}

/**
 * Tags in use to offer a post being written: the town's popular ones it does
 * not carry yet in any spelling (a draft with #ミステリー is not offered #ミステリ).
 */
export function suggestTags(
  state: TownState,
  written: readonly string[],
  limit = 4,
): string[] {
  return popularTags(state, 8)
    .map((entry) => entry.tag)
    .filter((tag) => !written.some((own) => sameText(own, tag)))
    .slice(0, limit);
}

/**
 * A search handed over by a tapped tag; read once by the search page, or
 * taken at once when the search page is already open.
 */
let pendingSearch: string | null = null;
const searchListeners = new Set<(query: string) => void>();
export const requestSearch = (query: string) => {
  pendingSearch = query;
  searchListeners.forEach((listener) => listener(query));
};
export function onSearchRequest(listener: (query: string) => void) {
  searchListeners.add(listener);
  return () => {
    searchListeners.delete(listener);
  };
}
export function takeRequestedSearch(): string | null {
  const query = pendingSearch;
  pendingSearch = null;
  return query;
}
