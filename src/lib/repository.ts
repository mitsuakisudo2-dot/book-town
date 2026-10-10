import { createInitialState } from "./data";
import {
  ME_ID,
  POP_REACTIONS,
  POST_MAX_LENGTH,
  popReactionKey,
  type PopReaction,
  OWN_SHOP_ID,
  shelfUsed,
  type PersistenceStatus,
  type Post,
  type Reader,
  type Shop,
  type TownState,
} from "./types";

export const STORAGE_KEY = "book-town-v1";
export const STORAGE_VERSION = 1;

export interface RepositorySnapshot {
  state: TownState;
  status: PersistenceStatus;
}

/** The UI depends on this boundary, rather than directly on localStorage. */
export interface TownRepository {
  load(): RepositorySnapshot;
  save(state: TownState): "saved" | "unavailable";
}

type PersonalData = Pick<
  TownState,
  | "me"
  | "ownShop"
  | "following"
  | "wishlist"
  | "favorites"
  | "popReactions"
  | "likedPosts"
  | "wantedPosts"
  | "spoilerReports"
> & {
  /** Only the viewer's own posts; demo posts always come from the current catalog. */
  posts: Post[];
};
interface StoredEnvelope {
  version: number;
  data: PersonalData;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit = 10000): value is string =>
  typeof value === "string" && value.length <= limit;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => text(entry, 200));
const unique = (values: string[]) => new Set(values).size === values.length;
const knownList = (value: unknown, allowed: Set<string>): value is string[] =>
  strings(value) && unique(value) && value.every((id) => allowed.has(id));
const hex = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

function validReader(value: unknown, bookIds: Set<string>): value is Reader {
  if (
    !object(value) ||
    value.id !== ME_ID ||
    !text(value.name, 120) ||
    !value.name.trim() ||
    !text(value.bio) ||
    !hex(value.color) ||
    !knownList(value.lifeNine, bookIds) ||
    value.lifeNine.length > 9 ||
    !object(value.nineNotes)
  )
    return false;
  return Object.entries(value.nineNotes).every(
    ([key, note]) =>
      (value.lifeNine as string[]).includes(key) && text(note, 1000),
  );
}

function validShop(value: unknown, bookIds: Set<string>): value is Shop | null {
  if (value === null) return true;
  if (
    !object(value) ||
    value.id !== OWN_SHOP_ID ||
    value.ownerId !== ME_ID ||
    value.demo !== false ||
    !text(value.name, 120) ||
    !value.name.trim() ||
    !text(value.description) ||
    !text(value.tagline, 500) ||
    !["sage", "ink", "ochre", "rose"].includes(String(value.theme)) ||
    typeof value.followers !== "number" ||
    !Number.isInteger(value.followers) ||
    value.followers < 0 ||
    !Array.isArray(value.shelves) ||
    value.shelves.length > 100
  )
    return false;
  const shelfIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const candidate of value.shelves) {
    if (
      !object(candidate) ||
      !text(candidate.id, 200) ||
      !candidate.id ||
      shelfIds.has(candidate.id) ||
      !text(candidate.name, 120) ||
      !candidate.name.trim() ||
      typeof candidate.isPublic !== "boolean" ||
      typeof candidate.capacity !== "number" ||
      !Number.isInteger(candidate.capacity) ||
      candidate.capacity < 1 ||
      candidate.capacity > 100 ||
      !Array.isArray(candidate.items)
    )
      return false;
    shelfIds.add(candidate.id);
    const shelfBooks = new Set<string>();
    for (const candidateItem of candidate.items) {
      if (
        !object(candidateItem) ||
        !text(candidateItem.id, 200) ||
        !candidateItem.id ||
        itemIds.has(candidateItem.id) ||
        !text(candidateItem.bookId, 200) ||
        !bookIds.has(candidateItem.bookId) ||
        shelfBooks.has(candidateItem.bookId) ||
        !["spine", "face"].includes(String(candidateItem.display)) ||
        !text(candidateItem.pop)
      )
        return false;
      itemIds.add(candidateItem.id);
      shelfBooks.add(candidateItem.bookId);
    }
    if (
      shelfUsed(candidate as unknown as Shop["shelves"][number]) >
      candidate.capacity
    )
      return false;
  }
  return true;
}

/** Keeps each valid post of the viewer's own; replies need a surviving top-level parent. */
function restorePosts(
  value: unknown,
  demoPosts: Post[],
  bookIds: Set<string>,
): Post[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(demoPosts.map((post) => post.id));
  const topLevel = new Set(
    demoPosts.filter((post) => post.parentId === null).map((post) => post.id),
  );
  const candidates = value.filter(
    (post): post is Post =>
      object(post) &&
      text(post.id, 200) &&
      post.id.startsWith("me-post-") &&
      post.authorId === ME_ID &&
      text(post.body, POST_MAX_LENGTH) &&
      Boolean(post.body.trim()) &&
      (post.bookId === null ||
        (typeof post.bookId === "string" && bookIds.has(post.bookId))) &&
      typeof post.spoiler === "boolean" &&
      (post.parentId === null || text(post.parentId, 200)) &&
      (post.spoiler === false ||
        post.parentId !== null ||
        post.bookId !== null) &&
      text(post.createdAt, 40) &&
      !Number.isNaN(Date.parse(post.createdAt)),
  );
  const kept: Post[] = [];
  for (const post of candidates.filter((entry) => entry.parentId === null)) {
    if (ids.has(post.id)) continue;
    ids.add(post.id);
    topLevel.add(post.id);
    kept.push({ ...post, likes: 0, wants: 0 });
  }
  for (const post of candidates.filter((entry) => entry.parentId !== null)) {
    if (ids.has(post.id) || !topLevel.has(post.parentId as string)) continue;
    ids.add(post.id);
    kept.push({ ...post, likes: 0, wants: 0 });
  }
  return kept;
}

/** Invalid records fall back atomically. Demo catalog changes are never overwritten by stored snapshots. */
export function deserializeTown(raw: string | null): RepositorySnapshot {
  const initial = createInitialState();
  if (raw === null) return { state: initial, status: "saved" };
  try {
    const envelope: unknown = JSON.parse(raw);
    const bookIds = new Set(initial.books.map((book) => book.id));
    const shopIds = new Set(initial.shops.map((shop) => shop.id));
    if (
      !object(envelope) ||
      envelope.version !== STORAGE_VERSION ||
      !object(envelope.data) ||
      !validReader(envelope.data.me, bookIds) ||
      !validShop(envelope.data.ownShop, bookIds) ||
      !knownList(envelope.data.following, shopIds) ||
      !knownList(envelope.data.wishlist, bookIds)
    ) {
      return { state: initial, status: "recovered" };
    }
    // Optional additions migrate independently, so an older save never loses its shop.
    const data = envelope.data;
    const ownShop = data.ownShop as Shop | null;
    const reactionKeys = new Set(
      [...initial.shops, ...(ownShop ? [ownShop] : [])].flatMap((shop) =>
        shop.shelves
          .filter((shelf) => shelf.isPublic)
          .flatMap((shelf) =>
            shelf.items.map((item) =>
              popReactionKey(shop.id, shelf.id, item.id),
            ),
          ),
      ),
    );
    const popReactions: Record<string, PopReaction[]> = {};
    if (object(data.popReactions)) {
      for (const [key, reactions] of Object.entries(data.popReactions)) {
        if (!reactionKeys.has(key) || !Array.isArray(reactions)) continue;
        const valid = [...new Set(reactions)].filter(
          (reaction): reaction is PopReaction =>
            POP_REACTIONS.includes(reaction as PopReaction),
        );
        if (valid.length) popReactions[key] = valid;
      }
    }
    const posts = [
      ...initial.posts,
      ...restorePosts(data.posts, initial.posts, bookIds),
    ];
    const byId = new Map(posts.map((post) => [post.id, post]));
    const postList = (
      value: unknown,
      allowed: (post: Post) => boolean,
    ): string[] =>
      Array.isArray(value)
        ? [...new Set(value)].filter((id): id is string => {
            const post = typeof id === "string" ? byId.get(id) : undefined;
            return Boolean(post && allowed(post));
          })
        : [];
    return {
      state: {
        ...initial,
        me: data.me as Reader,
        ownShop,
        following: data.following as string[],
        wishlist: data.wishlist as string[],
        favorites: Array.isArray(data.favorites)
          ? [...new Set(data.favorites)].filter(
              (id): id is string => typeof id === "string" && bookIds.has(id),
            )
          : [],
        popReactions,
        posts,
        likedPosts: postList(data.likedPosts, () => true),
        wantedPosts: postList(
          data.wantedPosts,
          (post) => post.bookId !== null && post.authorId !== ME_ID,
        ),
        spoilerReports: postList(
          data.spoilerReports,
          (post) => !post.spoiler && post.authorId !== ME_ID,
        ),
      },
      status: "saved",
    };
  } catch {
    return { state: initial, status: "recovered" };
  }
}

export function serializeTown(state: TownState): string {
  const envelope: StoredEnvelope = {
    version: STORAGE_VERSION,
    data: {
      me: state.me,
      ownShop: state.ownShop,
      following: state.following,
      wishlist: state.wishlist,
      favorites: state.favorites,
      popReactions: state.popReactions,
      posts: state.posts.filter((post) => post.authorId === ME_ID),
      likedPosts: state.likedPosts,
      wantedPosts: state.wantedPosts,
      spoilerReports: state.spoilerReports,
    },
  };
  return JSON.stringify(envelope);
}

export const localTownRepository: TownRepository = {
  load() {
    if (typeof window === "undefined")
      return { state: createInitialState(), status: "loading" };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const snapshot = deserializeTown(raw);
      // A first visit also checks that browser storage can actually be written.
      if (raw === null)
        window.localStorage.setItem(STORAGE_KEY, serializeTown(snapshot.state));
      return snapshot;
    } catch {
      return { state: createInitialState(), status: "unavailable" };
    }
  },
  save(state) {
    if (typeof window === "undefined") return "unavailable";
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeTown(state));
      return "saved";
    } catch {
      return "unavailable";
    }
  },
};

/** A replaceable test/development adapter; a Supabase adapter can implement the same boundary. */
export function createMemoryRepository(
  initial = createInitialState(),
): TownRepository {
  let raw = serializeTown(initial);
  return {
    load: () => deserializeTown(raw),
    save: (state) => {
      raw = serializeTown(state);
      return "saved";
    },
  };
}
