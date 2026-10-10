import type { PersistenceStatus } from "../types";

/*
 * SNS domain model (mock phase).
 *
 * One `Post` type covers free posts, posts with a book, reviews and replies, so every
 * kind of message can carry text, images, a book, likes and further replies. What a
 * book attachment *means* is explicit (`BookLink.purpose`): attaching a book never turns
 * a post into a review by itself.
 */

export const POST_TEXT_LIMIT = 2000;
export const POST_IMAGE_LIMIT = 4;
export const IMAGE_ALT_LIMIT = 200;
/** A data URL that would push localStorage near its quota is rejected up front. */
export const IMAGE_SRC_LIMIT = 1_500_000;

export const REACTION_KINDS = ["like", "wantToRead"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/**
 * - mention: the post talks about or shows a book (bought it, reading it, a photo).
 * - review: published as a review; also listed on the work page. Top-level posts only.
 * - recommend: a reply that offers a (usually different) book to the person it answers.
 */
export const BOOK_PURPOSES = ["mention", "review", "recommend"] as const;
export type BookPurpose = (typeof BOOK_PURPOSES)[number];

export interface BookLink {
  bookId: string;
  purpose: BookPurpose;
}

export interface PostImage {
  /** A data URL for posts made in this browser, or an app-relative path for demo images. */
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** Bluesky-style reply reference: the conversation's first post and the direct parent. */
export interface ReplyRef {
  rootId: string;
  parentId: string;
}

export interface Post {
  id: string;
  authorId: string;
  /** ISO 8601. */
  createdAt: string;
  text: string;
  images: PostImage[];
  book: BookLink | null;
  /** The author says this post reveals plot. Replies inherit protection from a spoiler root. */
  spoiler: boolean;
  reply: ReplyRef | null;
  /** Fictional posts by demo readers, labelled as such in the UI. */
  demo: boolean;
}

export interface Reaction {
  postId: string;
  readerId: string;
  kind: ReactionKind;
}

export interface Follow {
  followerId: string;
  followeeId: string;
}

/** "This post spoils without a flag." Visible only to its reporter until moderation exists. */
export interface SpoilerReport {
  postId: string;
  reporterId: string;
}

/** What every screen reads: the demo world plus this browser's own activity. */
export interface SocialState {
  posts: Post[];
  reactions: Reaction[];
  follows: Follow[];
  spoilerReports: SpoilerReport[];
}

/**
 * What this browser persists. Everything here belongs to the viewer (ME_ID); demo data is
 * never stored, so catalogue updates always reach existing visitors.
 */
export interface SocialPersonalData {
  posts: Post[];
  reactions: { postId: string; kind: ReactionKind }[];
  following: string[];
  spoilerReports: string[];
  /** Monotonic, so a deleted post's ID (and anything that pointed at it) is never reused. */
  nextPostNumber: number;
}

export interface PostDraft {
  text: string;
  images: PostImage[];
  book: BookLink | null;
  spoiler: boolean;
  /** The post being answered; null for a new conversation. */
  replyTo: string | null;
}

export type PostRejection =
  | "empty"
  | "review-needs-text"
  | "too-long"
  | "too-many-images"
  | "invalid-image"
  | "unknown-book"
  | "invalid-purpose"
  | "missing-parent"
  | "storage-full";

export type PostResult =
  { ok: true; post: Post } | { ok: false; reason: PostRejection };

export interface SocialActions {
  createPost(draft: PostDraft): PostResult;
  /** Own posts only. Replies stay and show the parent as deleted. */
  deletePost(postId: string): boolean;
  /** Own posts only: the author can add a missed spoiler flag, or remove one. */
  setSpoiler(postId: string, spoiler: boolean): boolean;
  toggleReaction(postId: string, kind: ReactionKind): boolean;
  toggleFollowReader(readerId: string): boolean;
  toggleSpoilerReport(postId: string): boolean;
}

export type SocialSaveResult = "saved" | "unavailable" | "quota";

export interface SocialSnapshot {
  data: SocialPersonalData;
  status: PersistenceStatus;
}

/** The UI depends on this boundary; a server-backed adapter can replace localStorage. */
export interface SocialRepository {
  load(): SocialSnapshot;
  save(data: SocialPersonalData): SocialSaveResult;
}

export const POST_ID_PATTERN = /^[a-z0-9-]{1,80}$/;
export const isPostId = (value: unknown): value is string =>
  typeof value === "string" && POST_ID_PATTERN.test(value);
