import type { Post, TownState } from "./types";
import { coverHidden } from "./hidden-words";

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

/** Public posts that carry a tag, newest first. Private reading notes never appear. */
export const postsWithTag = (state: TownState, tag: string): Post[] =>
  state.posts
    .filter(
      (post) =>
        post.readingMode !== "solo" &&
        extractTags(post.body).includes(tag.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/** Tags in use across public posts, most used first. */
export function popularTags(state: TownState, limit = 12) {
  const counts = new Map<string, number>();
  for (const post of state.posts)
    if (post.readingMode !== "solo")
      for (const tag of extractTags(post.body))
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/** A search handed over by a tapped tag; read once by the search page. */
let pendingSearch: string | null = null;
export const requestSearch = (query: string) => {
  pendingSearch = query;
};
export function takeRequestedSearch(): string | null {
  const query = pendingSearch;
  pendingSearch = null;
  return query;
}
