import {
  applyOp,
  blankEntry,
  contextsOf,
  keptByNothing,
  LIBRARY_SETTINGS,
  legacyToLibrary,
  opBefore,
  sameEntry,
  shopBookIds,
  type Encounter,
  type EntrySource,
  type LibraryEntry,
  type LibrarySet,
  type LibraryState,
  type OpBefore,
} from "./library";
import { posterBookIds } from "./posters";
import { ME_ID, type TownState } from "./types";

// The library (library.ts) in the town. The rows the reader changed are kept
// (TownState.libraryEntries, library_entries in the database); every other
// book they have met is worked out here from the rest of the town each time,
// as the database's backfill would make its row: the marks (登録・読みたい・
// ☆・読了), their own records, readings, posts, posters, 人生の9冊 and shop.
// So a book used since the backfill ran, or a demo saved before the library,
// is in the library without a row being written for it, and gets one the
// first time the reader sorts it, or changes anything at all while it is used
// (keepingUses), so it stays when the use goes.
//
// Likes and 読みたくなった are not kept as encounters yet (管理表 9 and 10):
// until they are, the town's own reactions stand in for them, so いいねした本
// shows the books of the posts and POPs the reader liked, and a book only
// liked is in the library while the like stands (4-10).

/**
 * When the books worked out from lists without times came in: before
 * anything the reader does from now on, in the order of their lists.
 */
export const LEGACY_AT = "2026-10-01T00:00:00.000Z";

const at = (base: string, i: number) =>
  new Date(Date.parse(base) + i).toISOString();

/** The reader's likes, 私も好き！ and 読みたくなった, as the encounters they will be. */
export function townEncounters(state: TownState): Encounter[] {
  const base = {
    shopId: null,
    postId: null,
    placementKey: null,
    memo: null,
    memoAt: null,
    undoneAt: null,
  };
  const posts = new Map(state.posts.map((post) => [post.id, post]));
  const fromPosts = (ids: string[], kind: "like" | "want") =>
    ids.flatMap((postId, i): Encounter[] => {
      const post = posts.get(postId);
      if (!post?.bookId || post.authorId === ME_ID) return [];
      return [
        {
          ...base,
          id: `${kind}:post:${postId}`,
          bookId: post.bookId,
          kind,
          via: "post",
          postId,
          otherReaderId: post.authorId,
          createdAt: at(LEGACY_AT, i),
        },
      ];
    });
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const fromPops = Object.entries(state.popReactions).flatMap(
    ([key, reactions], i): Encounter[] => {
      let place: unknown;
      try {
        place = JSON.parse(key);
      } catch {
        return [];
      }
      if (!Array.isArray(place)) return [];
      const [shopId, shelfId, itemId] = place as string[];
      const shop = shops.find((entry) => entry.id === shopId);
      const item = shop?.shelves
        .find((shelf) => shelf.id === shelfId)
        ?.items.find((entry) => entry.id === itemId);
      if (!shop || !item || shop.ownerId === ME_ID) return [];
      return reactions.map((reaction) => {
        const kind = reaction === "read" ? "want" : reaction;
        return {
          ...base,
          id: `${kind}:pop:${key}`,
          bookId: item.bookId,
          kind,
          via: "pop",
          shopId,
          placementKey: key,
          otherReaderId: shop.ownerId,
          createdAt: at(LEGACY_AT, i),
        };
      });
    },
  );
  return [
    ...fromPosts(state.likedPosts, "like"),
    ...fromPosts(state.wantedPosts, "want"),
    ...fromPops,
  ];
}

/** The books in the reader's own shop: every shelf of its page, and its store scene. */
export const townShopBooks = (state: TownState): Set<string> =>
  shopBookIds(state.ownShop);

const worked = new WeakMap<TownState, Record<string, LibraryEntry>>();

/**
 * Every row of the reader's library: the rows kept, and for each other book
 * they have met, the row the backfill would make, or a fresh one for a book
 * only liked. Rows of books the town does not know are left as they are.
 */
export function entriesOf(state: TownState): Record<string, LibraryEntry> {
  const known = worked.get(state);
  if (known) return known;
  const own = (authorId: string) => authorId === ME_ID;
  const shop = state.ownShop;
  const legacy = legacyToLibrary(
    {
      lists: {
        wishlist: state.wishlist,
        favorites: state.favorites,
        library: state.library,
        finishedBooks: state.finishedBooks,
      },
      records: state.readingRecords,
      sessions: state.readingSessions,
      uses: [
        ...state.posts
          .filter((post) => own(post.authorId) && post.bookId !== null)
          .map((post) => ({
            bookId: post.bookId as string,
            at: post.createdAt,
          })),
        ...state.posters
          .filter((poster) => own(poster.authorId))
          .flatMap((poster) =>
            posterBookIds(poster).map((bookId) => ({
              bookId,
              at: poster.createdAt,
            })),
          ),
        ...[...state.me.lifeNine, ...shopBookIds(shop)].map((bookId) => ({
          bookId,
          at: LEGACY_AT,
        })),
      ],
    },
    LEGACY_AT,
  );
  const entries: Record<string, LibraryEntry> = {
    ...legacy,
    ...state.libraryEntries,
  };
  for (const c of townEncounters(state))
    if ((c.kind === "like" || c.kind === "love") && !entries[c.bookId])
      entries[c.bookId] = blankEntry(
        c.bookId,
        c.via === "pop" ? "pop" : "like",
        LEGACY_AT,
      );
  worked.set(state, entries);
  return entries;
}

/** The town as the library's rules read it. */
export function libraryStateOf(state: TownState): LibraryState {
  return {
    books: state.books,
    me: state.me,
    favorites: state.favorites,
    library: state.library,
    readingRecords: state.readingRecords,
    posts: state.posts,
    posters: state.posters,
    libraryEntries: entriesOf(state),
    // The reader's own shelves come with 管理表 15.
    libraryShelves: [],
    libraryShelfBooks: [],
    encounters: townEncounters(state),
    settings: LIBRARY_SETTINGS,
  };
}

/**
 * One op on some books (applyOp), in the town: the rows it changed are kept,
 * ☆ and the books registered on purpose are the op's own, and the op's books
 * go into or out of 読みたい and 読了 as their rows now say (relisted). The
 * state itself comes back when nothing changes.
 */
export function withLibraryOp(
  state: TownState,
  books: string[],
  set: LibrarySet,
  time: string,
  via: EntrySource,
): TownState {
  const before = entriesOf(state);
  const library = libraryStateOf(state);
  const next = applyOp(library, books, set, time, via, townShopBooks(state));
  if (next === library) return state;
  let kept = state.libraryEntries;
  const changed: string[] = [];
  for (const [bookId, row] of Object.entries(next.libraryEntries))
    if (row !== before[bookId]) {
      if (kept === state.libraryEntries) kept = { ...kept };
      kept[bookId] = row;
      changed.push(bookId);
    }
  return {
    ...state,
    libraryEntries: kept,
    favorites: next.favorites,
    library: next.library,
    ...relisted(state, [...books, ...changed], next.libraryEntries),
  };
}

/**
 * 読みたい and 読了 as the old screens and book_marks keep them, for the
 * books of an op: each is added at the end of its list or taken out, as its
 * row now says. The other books stay as they are, in their order, whatever
 * their rows say: a list follows only what the reader did.
 */
function relisted(
  state: TownState,
  books: string[],
  rows: Record<string, LibraryEntry>,
): Pick<TownState, "wishlist" | "finishedBooks"> {
  const known = new Set(state.books.map((book) => book.id));
  const ids = [...new Set(books)].filter((id) => known.has(id));
  const relist = (list: string[], has: (row: LibraryEntry) => boolean) => {
    const keep = (id: string) => {
      const row = rows[id];
      return row !== undefined && has(row);
    };
    const touched = new Set(ids);
    const stays = list.filter((id) => !touched.has(id) || keep(id));
    const there = new Set(stays);
    const next = [...stays, ...ids.filter((id) => keep(id) && !there.has(id))];
    return next.length === list.length && next.every((id, i) => id === list[i])
      ? list
      : next;
  };
  return {
    wishlist: relist(
      state.wishlist,
      (row) => row.removedAt === null && row.wantedAt !== null,
    ),
    finishedBooks: relist(
      state.finishedBooks,
      (row) => row.status === "finished",
    ),
  };
}

/**
 * A book no longer registered on purpose (the 登録 list's 外す, a scan taken
 * back): it leaves the library only when nothing else keeps it, as an old
 * app's library mark taken off does. Its 読みたい, ☆ and status stay.
 */
export function withoutRegistering(
  state: TownState,
  bookId: string,
  time: string,
): TownState {
  if (!state.library.includes(bookId)) return state;
  const next = {
    ...state,
    library: state.library.filter((id) => id !== bookId),
  };
  const row = entriesOf(next)[bookId];
  if (!row || row.removedAt !== null) return next;
  const x = contextsOf(libraryStateOf(next), townShopBooks(next))(bookId);
  return keptByNothing(row, x)
    ? {
        ...next,
        libraryEntries: {
          ...next.libraryEntries,
          [bookId]: { ...row, removedAt: time, likeRestored: false },
        },
      }
    : next;
}

/** What the reader can change of books from the library's screens. */
export type LibraryChange = Pick<
  LibrarySet,
  "status" | "want" | "owned" | "favorite" | "removed"
>;

/**
 * An op, to undo it (10-6): each book as the op found it, and its row as the
 * op left it, so a book changed again since is left as it is.
 */
export interface LibraryUndo {
  books: string[];
  before: Record<string, OpBefore>;
  after: Record<string, LibraryEntry | null>;
}

/** withLibraryOp, and what undoes it; null when nothing changed. */
export function libraryChange(
  state: TownState,
  books: string[],
  set: LibrarySet,
  time: string,
  via: EntrySource,
): { state: TownState; undo: LibraryUndo } | null {
  const ids = [...new Set(books)];
  const before = opBefore(libraryStateOf(state), ids);
  const next = withLibraryOp(state, ids, set, time, via);
  if (next === state) return null;
  const rows = entriesOf(next);
  return {
    state: next,
    undo: {
      books: ids,
      before,
      after: Object.fromEntries(ids.map((id) => [id, rows[id] ?? null])),
    },
  };
}

/**
 * Puts the books of an op back as it found them: the row, ☆ and being
 * registered. A use made since stays (everUsed), and a book changed again
 * since is left as it is. A book the op brought in from nothing is taken
 * out again with nothing set: its row stays, as every row does. Answers the town and how
 * many books went back.
 */
export function undoLibraryChange(
  state: TownState,
  undo: LibraryUndo,
  time: string,
): { state: TownState; restored: number } {
  const rows = entriesOf(state);
  let kept = state.libraryEntries;
  let favorites = state.favorites;
  let library = state.library;
  let restored = 0;
  for (const bookId of undo.books) {
    const now = rows[bookId] ?? null;
    const after = undo.after[bookId] ?? null;
    if (
      now === null ? after !== null : after === null || !sameEntry(now, after)
    )
      continue;
    const was = undo.before[bookId];
    if (!was) continue;
    const row: LibraryEntry | null = was.entry
      ? {
          ...was.entry,
          everUsed: was.entry.everUsed || (now?.everUsed ?? false),
        }
      : now && {
          ...blankEntry(bookId, now.source, now.addedAt, now.batchId),
          removedAt: now.removedAt ?? time,
          everUsed: now.everUsed,
        };
    if (row && (!now || !sameEntry(row, now))) {
      if (kept === state.libraryEntries) kept = { ...kept };
      kept[bookId] = row;
    }
    if (was.favorite && !favorites.includes(bookId))
      favorites = [...favorites, bookId];
    if (!was.favorite && favorites.includes(bookId))
      favorites = favorites.filter((id) => id !== bookId);
    if (was.registered && !library.includes(bookId))
      library = [...library, bookId];
    if (!was.registered && library.includes(bookId))
      library = library.filter((id) => id !== bookId);
    restored += 1;
  }
  if (
    kept === state.libraryEntries &&
    favorites === state.favorites &&
    library === state.library
  )
    return { state, restored };
  return {
    state: {
      ...state,
      libraryEntries: kept,
      favorites,
      library,
      ...relisted(state, undo.books, { ...rows, ...kept }),
    },
    restored,
  };
}

/** The books the reader uses: their own posts, posters (drafts too), 人生の9冊 and shop. */
function usedBooks(state: TownState): string[] {
  const own = (authorId: string) => authorId === ME_ID;
  return [
    ...state.posts.flatMap((post) =>
      own(post.authorId) && post.bookId !== null ? [post.bookId] : [],
    ),
    ...state.posters
      .filter((poster) => own(poster.authorId))
      .flatMap((poster) => posterBookIds(poster)),
    ...state.me.lifeNine,
    ...shopBookIds(state.ownShop),
  ];
}

/**
 * A book once used stays in the library when the use goes (ever_used, N19).
 * The row worked out for a used book says so only while the use is there, so
 * a change keeps the row of every book used before or after it, marked used,
 * the first time it sees one. Answers `next` itself when nothing is to keep.
 */
export function keepingUses(prev: TownState, next: TownState): TownState {
  const known = new Set(next.books.map((book) => book.id));
  let kept = next.libraryEntries;
  for (const bookId of new Set([...usedBooks(prev), ...usedBooks(next)])) {
    if (!known.has(bookId) || kept[bookId]?.everUsed) continue;
    const row =
      kept[bookId] ?? entriesOf(next)[bookId] ?? entriesOf(prev)[bookId];
    if (!row) continue;
    if (kept === next.libraryEntries) kept = { ...kept };
    kept[bookId] = { ...row, everUsed: true };
  }
  return kept === next.libraryEntries
    ? next
    : { ...next, libraryEntries: kept };
}
