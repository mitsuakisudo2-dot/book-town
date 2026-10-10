import { ME_ID } from "../types";
import type { Post, ReactionKind, SocialState } from "./types";

// Pure queries over SocialState. Screens never filter `state.posts` themselves, so a
// server-backed implementation can replace these one by one with real queries.

const time = (post: Post) => Date.parse(post.createdAt);
const newestFirst = (a: Post, b: Post) =>
  time(b) - time(a) || (a.id < b.id ? 1 : -1);
const oldestFirst = (a: Post, b: Post) => -newestFirst(a, b);

export const findPost = (state: SocialState, id: string): Post | undefined =>
  state.posts.find((post) => post.id === id);

/** Only a top-level post explicitly published as a review counts; a mere attachment does not. */
export const isReview = (post: Post): boolean =>
  post.reply === null && post.book?.purpose === "review";

export type TimelineScope = "everyone" | "following";

/** Top-level posts, newest first. Replies live in their conversations. */
export function timeline(
  state: SocialState,
  scope: TimelineScope,
  viewerId = ME_ID,
): Post[] {
  const followed = new Set(followingIds(state, viewerId));
  return state.posts
    .filter(
      (post) =>
        post.reply === null &&
        (scope === "everyone" ||
          post.authorId === viewerId ||
          followed.has(post.authorId)),
    )
    .sort(newestFirst);
}

export const reviewsOf = (state: SocialState, bookId: string): Post[] =>
  state.posts
    .filter((post) => isReview(post) && post.book?.bookId === bookId)
    .sort(newestFirst);

/** Replies that offered this book to someone: "この本も好きなんじゃない？". */
export const recommendationsOf = (state: SocialState, bookId: string): Post[] =>
  state.posts
    .filter(
      (post) =>
        post.reply !== null &&
        post.book?.purpose === "recommend" &&
        post.book.bookId === bookId,
    )
    .sort(newestFirst);

export const postsBy = (
  state: SocialState,
  authorId: string,
  filter: "posts" | "reviews" = "posts",
): Post[] =>
  state.posts
    .filter(
      (post) =>
        post.authorId === authorId &&
        post.reply === null &&
        (filter === "posts" || isReview(post)),
    )
    .sort(newestFirst);

export const replyCount = (state: SocialState, postId: string): number =>
  state.posts.filter((post) => post.reply?.parentId === postId).length;

/** Everything said below `post`, flattened and oldest first, like a chat log. */
export function conversationBelow(state: SocialState, post: Post): Post[] {
  const inThread = new Set([post.id]);
  const found: Post[] = [];
  // A reply is always newer than its parent, so one chronological pass finds all descendants.
  for (const candidate of [...state.posts].sort(oldestFirst)) {
    if (candidate.reply && inThread.has(candidate.reply.parentId)) {
      inThread.add(candidate.id);
      found.push(candidate);
    }
  }
  return found;
}

export type Ancestor = Post | { id: string; missing: true };

/** Root first. A deleted post in the chain is returned as a tombstone, never as content. */
export function ancestorsOf(state: SocialState, post: Post): Ancestor[] {
  const chain: Ancestor[] = [];
  const seen = new Set([post.id]);
  let parentId = post.reply?.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = findPost(state, parentId);
    if (!parent) {
      chain.unshift({ id: parentId, missing: true });
      break;
    }
    chain.unshift(parent);
    parentId = parent.reply?.parentId;
  }
  return chain;
}

export const reactionCount = (
  state: SocialState,
  postId: string,
  kind: ReactionKind,
): number =>
  state.reactions.filter(
    (reaction) => reaction.postId === postId && reaction.kind === kind,
  ).length;

export const hasReacted = (
  state: SocialState,
  postId: string,
  kind: ReactionKind,
  readerId = ME_ID,
): boolean =>
  state.reactions.some(
    (reaction) =>
      reaction.postId === postId &&
      reaction.kind === kind &&
      reaction.readerId === readerId,
  );

/** "読みたくなった" needs a book to want, and is meaningless on one's own post. */
export const canWantToRead = (post: Post, viewerId = ME_ID): boolean =>
  post.book !== null && post.authorId !== viewerId;

export const followingIds = (state: SocialState, readerId: string): string[] =>
  state.follows
    .filter((follow) => follow.followerId === readerId)
    .map((follow) => follow.followeeId);

export const followerIds = (state: SocialState, readerId: string): string[] =>
  state.follows
    .filter((follow) => follow.followeeId === readerId)
    .map((follow) => follow.followerId);

export const isFollowing = (
  state: SocialState,
  followerId: string,
  followeeId: string,
): boolean =>
  state.follows.some(
    (follow) =>
      follow.followerId === followerId && follow.followeeId === followeeId,
  );

/**
 * Whether a post's body (text and images) may be shown without the viewer choosing to.
 * Spoilers propagate down a conversation: answers to a spoiler usually discuss it too.
 * "reported" is the viewer's own report, which hides the body for them right away.
 */
export type Protection = "none" | "spoiler" | "reported";

export function protectionOf(
  state: SocialState,
  post: Post,
  viewerId = ME_ID,
): Protection {
  const chain = [post, ...ancestorsOf(state, post)].filter(
    (entry): entry is Post => !("missing" in entry),
  );
  if (chain.some((entry) => entry.spoiler)) return "spoiler";
  if (chain.some((entry) => hasReportedSpoiler(state, entry.id, viewerId)))
    return "reported";
  return "none";
}

export const hasReportedSpoiler = (
  state: SocialState,
  postId: string,
  viewerId = ME_ID,
): boolean =>
  state.spoilerReports.some(
    (report) => report.postId === postId && report.reporterId === viewerId,
  );
