import { books, readers } from "../data";
import { ME_ID } from "../types";
import { demoPosts } from "./data";
import {
  BOOK_PURPOSES,
  IMAGE_ALT_LIMIT,
  IMAGE_SRC_LIMIT,
  POST_IMAGE_LIMIT,
  POST_TEXT_LIMIT,
  REACTION_KINDS,
  isPostId,
  type Post,
  type PostImage,
  type ReactionKind,
  type SocialPersonalData,
  type SocialRepository,
  type SocialSaveResult,
  type SocialSnapshot,
} from "./types";

// A separate key from the town (`book-town-v1`): SNS data, images included, can grow or be
// reset without ever touching shops, profiles or the wishlist.
export const SOCIAL_STORAGE_KEY = "book-town-sns-v1";
export const SOCIAL_STORAGE_VERSION = 1;
/**
 * Both keys share one per-origin localStorage quota (about 5M characters in some browsers).
 * Capping SNS data well below it keeps the town save writable however many images are posted.
 */
export const SOCIAL_STORAGE_BUDGET = 2_000_000;

export const emptySocialData = (): SocialPersonalData => ({
  posts: [],
  reactions: [],
  following: [],
  spoilerReports: [],
  nextPostNumber: 1,
});

const MINE_PREFIX = "mine-post-";
export const minePostId = (number: number) => `${MINE_PREFIX}${number}`;
const minePostNumber = (id: string) =>
  id.startsWith(MINE_PREFIX) ? Number(id.slice(MINE_PREFIX.length)) : NaN;

/** The demo world a stored record is checked against. */
export interface SocialCatalog {
  bookIds: Set<string>;
  readerIds: Set<string>;
  demoPosts: Post[];
}
export const defaultCatalog: SocialCatalog = {
  bookIds: new Set(books.map((book) => book.id)),
  readerIds: new Set(readers.map((reader) => reader.id)),
  demoPosts,
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit;
const dimension = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 10000;

const IMAGE_DATA_URL =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const DEMO_IMAGE_PATH = /^\/demo\/[a-z0-9-]+\.(?:svg|png|jpe?g|webp)$/;

/** Posts from this browser may only carry inline raster data, never a URL to elsewhere. */
export function validImage(
  value: unknown,
  allowDemoPath = false,
): value is PostImage {
  return (
    object(value) &&
    text(value.src, IMAGE_SRC_LIMIT) &&
    (IMAGE_DATA_URL.test(value.src) ||
      (allowDemoPath && DEMO_IMAGE_PATH.test(value.src))) &&
    text(value.alt, IMAGE_ALT_LIMIT) &&
    dimension(value.width) &&
    dimension(value.height)
  );
}

/**
 * Rules every post written in this browser satisfies, whether freshly drafted or loaded.
 * `known` holds the posts that may be replied to; a missing parent is allowed because the
 * viewer may have deleted it, but a present parent must agree on the conversation root.
 */
export function validMinePost(
  value: unknown,
  catalog: SocialCatalog,
  known: ReadonlyMap<string, Post>,
): value is Post {
  if (
    !object(value) ||
    !isPostId(value.id) ||
    !(minePostNumber(value.id) >= 1) ||
    value.authorId !== ME_ID ||
    value.demo !== false ||
    !text(value.createdAt, 40) ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !text(value.text, POST_TEXT_LIMIT) ||
    typeof value.spoiler !== "boolean" ||
    !Array.isArray(value.images) ||
    value.images.length > POST_IMAGE_LIMIT ||
    !value.images.every((image) => validImage(image)) ||
    (!value.text.trim() && value.images.length === 0)
  )
    return false;
  const reply = value.reply;
  if (reply !== null) {
    if (!object(reply) || !isPostId(reply.rootId) || !isPostId(reply.parentId))
      return false;
    const parent = known.get(reply.parentId);
    if (parent && (parent.reply?.rootId ?? parent.id) !== reply.rootId)
      return false;
  }
  const book = value.book;
  if (book !== null) {
    if (
      !object(book) ||
      typeof book.bookId !== "string" ||
      !catalog.bookIds.has(book.bookId) ||
      !BOOK_PURPOSES.includes(book.purpose as never)
    )
      return false;
    // Reviews start conversations; a book in a reply is always a recommendation.
    if (
      reply === null
        ? book.purpose === "recommend"
        : book.purpose !== "recommend"
    )
      return false;
    if (book.purpose === "review" && !value.text.trim()) return false;
  }
  return true;
}

/** Each record is checked on its own, so one damaged post never costs the viewer the rest. */
export function deserializeSocial(
  raw: string | null,
  catalog: SocialCatalog = defaultCatalog,
): SocialSnapshot {
  if (raw === null) return { data: emptySocialData(), status: "saved" };
  try {
    const envelope: unknown = JSON.parse(raw);
    if (
      !object(envelope) ||
      envelope.version !== SOCIAL_STORAGE_VERSION ||
      !object(envelope.data)
    )
      return { data: emptySocialData(), status: "recovered" };
    const data = envelope.data;
    let dropped = 0;
    const list = (value: unknown): unknown[] => {
      if (Array.isArray(value)) return value;
      if (value !== undefined) dropped += 1;
      return [];
    };

    const known = new Map(catalog.demoPosts.map((post) => [post.id, post]));
    const posts: Post[] = [];
    for (const candidate of list(data.posts)) {
      if (
        validMinePost(candidate, catalog, known) &&
        !known.has(candidate.id)
      ) {
        const post: Post = {
          id: candidate.id,
          authorId: ME_ID,
          createdAt: candidate.createdAt,
          text: candidate.text,
          images: candidate.images.map(({ src, alt, width, height }) => ({
            src,
            alt,
            width,
            height,
          })),
          book: candidate.book && {
            bookId: candidate.book.bookId,
            purpose: candidate.book.purpose,
          },
          spoiler: candidate.spoiler,
          reply: candidate.reply && {
            rootId: candidate.reply.rootId,
            parentId: candidate.reply.parentId,
          },
          demo: false,
        };
        posts.push(post);
        known.set(post.id, post);
      } else dropped += 1;
    }

    const reactionKeys = new Set<string>();
    const reactions: SocialPersonalData["reactions"] = [];
    for (const candidate of list(data.reactions)) {
      const post = object(candidate)
        ? known.get(String(candidate.postId))
        : undefined;
      const kind = object(candidate) ? (candidate.kind as ReactionKind) : null;
      const key = `${post?.id}:${kind}`;
      if (
        !post ||
        !kind ||
        !REACTION_KINDS.includes(kind) ||
        (kind === "wantToRead" && (!post.book || post.authorId === ME_ID)) ||
        reactionKeys.has(key)
      ) {
        dropped += 1;
        continue;
      }
      reactionKeys.add(key);
      reactions.push({ postId: post.id, kind });
    }

    const following = [
      ...new Set(
        list(data.following).filter(
          (id): id is string =>
            typeof id === "string" && catalog.readerIds.has(id),
        ),
      ),
    ];
    const spoilerReports = [
      ...new Set(
        list(data.spoilerReports).filter(
          (id): id is string =>
            typeof id === "string" &&
            known.has(id) &&
            known.get(id)?.authorId !== ME_ID,
        ),
      ),
    ];

    const highest = posts.reduce(
      (max, post) => Math.max(max, minePostNumber(post.id)),
      0,
    );
    const stored = data.nextPostNumber;
    const nextPostNumber =
      typeof stored === "number" && Number.isInteger(stored) && stored > highest
        ? stored
        : highest + 1;

    return {
      data: { posts, reactions, following, spoilerReports, nextPostNumber },
      status: dropped ? "recovered" : "saved",
    };
  } catch {
    return { data: emptySocialData(), status: "recovered" };
  }
}

export function serializeSocial(data: SocialPersonalData): string {
  return JSON.stringify({ version: SOCIAL_STORAGE_VERSION, data });
}

const isQuotaError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED");

export const localSocialRepository: SocialRepository = {
  load() {
    if (typeof window === "undefined")
      return { data: emptySocialData(), status: "loading" };
    try {
      const raw = window.localStorage.getItem(SOCIAL_STORAGE_KEY);
      const snapshot = deserializeSocial(raw);
      if (raw === null)
        window.localStorage.setItem(
          SOCIAL_STORAGE_KEY,
          serializeSocial(snapshot.data),
        );
      return snapshot;
    } catch {
      return { data: emptySocialData(), status: "unavailable" };
    }
  },
  save(data) {
    const raw = serializeSocial(data);
    if (raw.length > SOCIAL_STORAGE_BUDGET) return "quota";
    if (typeof window === "undefined") return "unavailable";
    try {
      window.localStorage.setItem(SOCIAL_STORAGE_KEY, raw);
      return "saved";
    } catch (error) {
      return isQuotaError(error) ? "quota" : "unavailable";
    }
  },
};

/** Test/development adapter. `quota` simulates a full browser storage, in characters. */
export function createMemorySocialRepository(
  initial: SocialPersonalData = emptySocialData(),
  quota = SOCIAL_STORAGE_BUDGET,
): SocialRepository & { raw(): string } {
  let raw = serializeSocial(initial);
  return {
    load: () => deserializeSocial(raw),
    save: (data): SocialSaveResult => {
      const next = serializeSocial(data);
      if (next.length > quota) return "quota";
      raw = next;
      return "saved";
    },
    raw: () => raw,
  };
}
