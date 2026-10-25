import { createInitialState } from "./data";
import { cleanLinks } from "./links";
import { cleanRecord } from "./records";
import { cleanVisibilities } from "./visibility";
import { restorePoster, type Poster } from "./posters";
import {
  validateEntry,
  cleanShelfAudiences,
  encounterKey,
  readEncounter,
  readRule,
  validateShelf,
  type Encounter,
  type LibraryEntry,
  type LibraryShelf,
  type ShelfBook,
} from "./library";
import { DEFAULT_HANDLE, handleProblem } from "./handles";
import { createRegisteredBook, normalizeIsbn, REGISTERED_GENRE } from "./books";
import {
  COMPOSE_ICONS,
  SPOILER_DISPLAYS,
  LIKE_TAPS_MAX,
  ME_ID,
  POP_REACTIONS,
  POST_MAX_LENGTH,
  READING_MODES,
  popReactionKey,
  type PopReaction,
  OWN_SHOP_ID,
  shelfUsed,
  type Book,
  type ComposeIcon,
  type SpoilerDisplay,
  type PersistenceStatus,
  type Post,
  type Reader,
  type ReadingMode,
  type ReadingRecord,
  type ReadingSession,
  type Shop,
  type TownState,
  STORED_NAME_MAX_LENGTH,
  STORED_POP_MAX_LENGTH,
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
  | "likeTaps"
  | "wantedPosts"
  | "spoilerReports"
  | "readingSessions"
  | "finishedBooks"
  | "library"
  | "readingRecords"
  | "settings"
  | "seenNotifications"
> & {
  /** Only the viewer's own posts; demo posts always come from the current catalog. */
  posts: Post[];
  /** Only the viewer's own posters; the demo's come from the current catalog. */
  posters?: Poster[];
  /** The library's rows; none in a save from before the library. */
  libraryEntries?: TownState["libraryEntries"];
  /** The shelves the reader made, and their books; none in a save from before them. */
  libraryShelves?: TownState["libraryShelves"];
  libraryShelfBooks?: TownState["libraryShelfBooks"];
  /** Where the viewer met books; none in a save from before them. */
  encounters?: TownState["encounters"];
  /** Only books the viewer registered; their jackets are redrawn on load. */
  addedBooks: Pick<Book, "id" | "title" | "author" | "isbn" | "price">[];
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

export function validShop(
  value: unknown,
  bookIds: Set<string>,
): value is Shop | null {
  if (value === null) return true;
  if (
    !object(value) ||
    value.id !== OWN_SHOP_ID ||
    value.ownerId !== ME_ID ||
    value.demo !== false ||
    !text(value.name, STORED_NAME_MAX_LENGTH) ||
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
      !text(candidate.name, STORED_NAME_MAX_LENGTH) ||
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
        !text(candidateItem.pop, STORED_POP_MAX_LENGTH)
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

const validPrice = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 1_000_000;

/** Registered books are rebuilt from their id, title and author, so stored styling is never trusted. */
function restoreBooks(value: unknown, catalogIds: Set<string>): Book[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(catalogIds);
  const books: Book[] = [];
  for (const entry of value) {
    if (
      !object(entry) ||
      !text(entry.id, 200) ||
      ids.has(entry.id) ||
      !text(entry.title, 200) ||
      !entry.title.trim() ||
      !text(entry.author, 200)
    )
      continue;
    const isbn = entry.id.startsWith("isbn-")
      ? normalizeIsbn(entry.id.slice(5))
      : null;
    if (isbn ? entry.id !== "isbn-" + isbn : !/^my-book-\d+$/.test(entry.id))
      continue;
    ids.add(entry.id);
    books.push(
      createRegisteredBook(entry.id, {
        title: entry.title.trim(),
        author: entry.author.trim(),
        ...(isbn ? { isbn } : {}),
        ...(validPrice(entry.price) ? { price: entry.price } : {}),
      }),
    );
  }
  return books;
}

function restoreSessions(
  value: unknown,
  bookIds: Set<string>,
): ReadingSession[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const sessions = value.filter((entry): entry is ReadingSession => {
    if (
      !object(entry) ||
      !text(entry.id, 200) ||
      !/^me-reading-\d+$/.test(entry.id) ||
      ids.has(entry.id) ||
      (entry.bookId !== null &&
        (!text(entry.bookId, 200) || !bookIds.has(entry.bookId))) ||
      !READING_MODES.includes(entry.mode as ReadingMode) ||
      !text(entry.startedAt, 40) ||
      Number.isNaN(Date.parse(entry.startedAt)) ||
      (entry.endedAt !== null &&
        (!text(entry.endedAt, 40) ||
          !(Date.parse(entry.endedAt) >= Date.parse(entry.startedAt))))
    )
      return false;
    ids.add(entry.id);
    return true;
  });
  // Only the newest running session keeps running.
  const running = sessions.filter((entry) => entry.endedAt === null);
  const keep = running[running.length - 1];
  return sessions.map((entry) =>
    entry.endedAt === null && entry !== keep
      ? { ...entry, endedAt: entry.startedAt }
      : entry,
  );
}

/** Keeps each valid record of the viewer's own, about a book this town knows. */
/**
 * The library's rows kept in this browser, those the database would take
 * (validateEntry), of books the town knows. A save from before the library
 * has none, and every book is worked out from the rest (library-town.ts).
 */
function restoreEntries(
  value: unknown,
  bookIds: Set<string>,
): Record<string, LibraryEntry> {
  if (!object(value)) return {};
  const entries: Record<string, LibraryEntry> = {};
  for (const [bookId, entry] of Object.entries(value)) {
    if (!bookIds.has(bookId) || !object(entry)) continue;
    const row = {
      bookId,
      status: entry.status,
      statusAt: entry.statusAt,
      wantedAt: entry.wantedAt,
      likedAt: entry.likedAt,
      owned: entry.owned,
      source: entry.source,
      batchId: entry.batchId,
      addedAt: entry.addedAt,
      removedAt: entry.removedAt,
      likeRestored: entry.likeRestored,
      everUsed: entry.everUsed,
    } as LibraryEntry;
    if (entry.bookId === bookId && validateEntry(row) === null)
      entries[bookId] = row;
  }
  return entries;
}

/** The shelves kept, as the database would take them. */
function restoreShelves(value: unknown): LibraryShelf[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((shelf: unknown): LibraryShelf[] => {
    if (!object(shelf)) return [];
    const row = {
      id: shelf.id,
      name: shelf.name,
      note: shelf.note,
      position: shelf.position,
      showWanted: shelf.showWanted,
      // Kept before 2026-10-17: private, filled by hand.
      audience: shelf.audience ?? "private",
      rule: shelf.rule == null ? null : readRule(shelf.rule),
      createdAt: shelf.createdAt,
      deletedAt: shelf.deletedAt,
    } as LibraryShelf;
    if (shelf.rule != null && row.rule === null) return [];
    if (validateShelf(row) !== null || ids.has(row.id)) return [];
    ids.add(row.id);
    return [row];
  });
}

/** The books on those shelves, once each, of books the library keeps a row for. */
function restoreShelfBooks(
  value: unknown,
  shelves: LibraryShelf[],
  entries: Record<string, LibraryEntry>,
): ShelfBook[] {
  if (!Array.isArray(value)) return [];
  const shelfIds = new Set(shelves.map((shelf) => shelf.id));
  const seen = new Set<string>();
  return value.flatMap((book: unknown): ShelfBook[] => {
    if (!object(book)) return [];
    const { shelfId, bookId, addedAt, position } = book;
    if (
      typeof shelfId !== "string" ||
      typeof bookId !== "string" ||
      !shelfIds.has(shelfId) ||
      !entries[bookId] ||
      typeof addedAt !== "string" ||
      Number.isNaN(Date.parse(addedAt)) ||
      !(position === null || typeof position === "string")
    )
      return [];
    const key = JSON.stringify([shelfId, bookId]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ shelfId, bookId, addedAt, position }];
  });
}

/** The encounters kept here, of books the town knows, each once. */
function restoreEncounters(value: unknown, bookIds: Set<string>): Encounter[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item: unknown): Encounter[] => {
    const c = readEncounter(item);
    if (!c || !bookIds.has(c.bookId)) return [];
    const key = encounterKey(c);
    if (seen.has(c.id) || seen.has(key)) return [];
    seen.add(c.id);
    seen.add(key);
    return [c];
  });
}

function restoreRecords(value: unknown, bookIds: Set<string>): ReadingRecord[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((entry): ReadingRecord[] => {
    if (
      !object(entry) ||
      !text(entry.id, 200) ||
      !/^me-record-\d+$/.test(entry.id) ||
      ids.has(entry.id) ||
      !text(entry.bookId, 200) ||
      !bookIds.has(entry.bookId) ||
      !text(entry.createdAt, 40) ||
      Number.isNaN(Date.parse(entry.createdAt))
    )
      return [];
    // Saved before 見せる範囲, a record was public or not.
    const fields = cleanRecord({
      ...(entry as Partial<ReadingRecord>),
      ...(entry.audience === undefined && entry.isPublic === true
        ? { audience: "everyone" as const }
        : {}),
    });
    if (!fields) return [];
    ids.add(entry.id);
    return [
      {
        id: entry.id,
        readerId: ME_ID,
        bookId: entry.bookId,
        ...fields,
        createdAt: entry.createdAt,
      },
    ];
  });
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
      !Number.isNaN(Date.parse(post.createdAt)) &&
      (post.readingMode === undefined ||
        post.readingMode === null ||
        (READING_MODES.includes(post.readingMode as ReadingMode) &&
          post.parentId === null)),
  );
  const kept: Post[] = [];
  for (const post of candidates.filter((entry) => entry.parentId === null)) {
    if (ids.has(post.id)) continue;
    ids.add(post.id);
    topLevel.add(post.id);
    kept.push({
      ...post,
      likes: 0,
      wants: 0,
      readingMode: post.readingMode ?? null,
    });
  }
  for (const post of candidates.filter((entry) => entry.parentId !== null)) {
    if (ids.has(post.id) || !topLevel.has(post.parentId as string)) continue;
    ids.add(post.id);
    kept.push({ ...post, likes: 0, wants: 0, readingMode: null });
  }
  return kept;
}

/** The viewer's own posters, each kept or dropped on its own. */
function restorePosters(
  value: unknown,
  demo: Poster[],
  bookIds: Set<string>,
): Poster[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(demo.map((poster) => poster.id));
  const kept: Poster[] = [];
  for (const candidate of value.slice(0, 1000)) {
    const poster = restorePoster(candidate, bookIds);
    if (!poster || poster.authorId !== ME_ID || ids.has(poster.id)) continue;
    ids.add(poster.id);
    kept.push(poster);
  }
  return kept;
}

/** Invalid records fall back atomically. Demo catalog changes are never overwritten by stored snapshots. */
export function deserializeTown(raw: string | null): RepositorySnapshot {
  const initial = createInitialState();
  if (raw === null) return { state: initial, status: "saved" };
  try {
    const envelope: unknown = JSON.parse(raw);
    const addedBooks = restoreBooks(
      object(envelope) && object(envelope.data)
        ? envelope.data.addedBooks
        : undefined,
      new Set(initial.books.map((book) => book.id)),
    );
    const books = [...initial.books, ...addedBooks];
    const bookIds = new Set(books.map((book) => book.id));
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
    const knownBooks = (value: unknown): string[] =>
      Array.isArray(value)
        ? [...new Set(value)].filter(
            (id): id is string => typeof id === "string" && bookIds.has(id),
          )
        : [];
    const settings = object(data.settings) ? data.settings : {};
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
    const likedPosts = postList(data.likedPosts, () => true);
    const libraryEntries = restoreEntries(data.libraryEntries, bookIds);
    const libraryShelves = restoreShelves(data.libraryShelves);
    return {
      state: {
        ...initial,
        books,
        // Links migrate on their own: a bad one is dropped, the profile stays.
        me: {
          ...(data.me as Reader),
          // A missing, malformed or taken ID falls back to the default; the profile stays.
          handle:
            typeof (data.me as Reader).handle === "string" &&
            !handleProblem((data.me as Reader).handle, initial.readers)
              ? (data.me as Reader).handle
              : DEFAULT_HANDLE,
          links: cleanLinks((data.me as Reader).links),
        },
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
        likedPosts,
        likeTaps: likeTapsFrom(data.likeTaps, likedPosts),
        wantedPosts: postList(
          data.wantedPosts,
          (post) => post.bookId !== null && post.authorId !== ME_ID,
        ),
        spoilerReports: postList(
          data.spoilerReports,
          (post) => !post.spoiler && post.authorId !== ME_ID,
        ),
        readingSessions: restoreSessions(data.readingSessions, bookIds),
        finishedBooks: knownBooks(data.finishedBooks),
        library: knownBooks(data.library),
        libraryEntries,
        libraryShelves,
        libraryShelfBooks: restoreShelfBooks(
          data.libraryShelfBooks,
          libraryShelves,
          libraryEntries,
        ),
        encounters: restoreEncounters(data.encounters, bookIds),
        readingRecords: [
          ...initial.readingRecords,
          ...restoreRecords(data.readingRecords, bookIds),
        ],
        settings: {
          composeIcon: COMPOSE_ICONS.includes(
            settings.composeIcon as ComposeIcon,
          )
            ? (settings.composeIcon as ComposeIcon)
            : initial.settings.composeIcon,
          // A choice already saved in this browser was the reader's own;
          // before 見せる範囲 it was only whether records start public.
          visibility: cleanVisibilities(
            settings.visibility ??
              (settings.readingPublic === true
                ? { records: { audience: "everyone" } }
                : initial.settings.visibility),
          ),
          shelfAudiences: cleanShelfAudiences(settings.shelfAudiences),
          spoilerDisplay: SPOILER_DISPLAYS.includes(
            settings.spoilerDisplay as SpoilerDisplay,
          )
            ? (settings.spoilerDisplay as SpoilerDisplay)
            : initial.settings.spoilerDisplay,
        },
        seenNotifications: Array.isArray(data.seenNotifications)
          ? [...new Set(data.seenNotifications)]
              .filter((id): id is string => text(id, 200))
              .slice(-500)
          : [],
        posters: [
          ...initial.posters,
          ...restorePosters(data.posters, initial.posters, bookIds),
        ],
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
      likeTaps: state.likeTaps,
      wantedPosts: state.wantedPosts,
      spoilerReports: state.spoilerReports,
      readingSessions: state.readingSessions,
      finishedBooks: state.finishedBooks,
      library: state.library,
      libraryEntries: state.libraryEntries,
      libraryShelves: state.libraryShelves,
      libraryShelfBooks: state.libraryShelfBooks,
      encounters: state.encounters,
      readingRecords: state.readingRecords.filter(
        (record) => record.readerId === ME_ID,
      ),
      settings: state.settings,
      seenNotifications: state.seenNotifications,
      posters: state.posters.filter((poster) => poster.authorId === ME_ID),
      addedBooks: state.books
        .filter((book) => book.genre === REGISTERED_GENRE)
        .map(({ id, title, author, isbn, price }) => ({
          id,
          title,
          author,
          isbn,
          price,
        })),
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
/** Saved like counts, kept only for liked posts and within the cap. */
function likeTapsFrom(value: unknown, liked: string[]): Record<string, number> {
  if (!object(value)) return {};
  return Object.fromEntries(
    liked.flatMap((id) => {
      const taps = value[id];
      return Number.isInteger(taps) &&
        (taps as number) > 1 &&
        (taps as number) <= LIKE_TAPS_MAX
        ? [[id, taps as number]]
        : [];
    }),
  );
}

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
