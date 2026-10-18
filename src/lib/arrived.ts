import {
  ME_ID,
  reviewKey,
  type Book,
  type OlderRead,
  type Post,
  type Reader,
  type ReadingRecord,
  type TownState,
} from "./types";

// 便り read after the town was (PR 2): newer ones by polling or a pull,
// older ones for 便りだけ, one post by its id. They come with the readers and
// books they need, and are taken into the town as the backend's own reading
// (`absorb`), never as a change of the reader's: nothing here is written back.

/** What a read after the town brought, in the town's own shapes. */
export interface Arrived {
  posts: Post[];
  /** The writers of those posts the town may not know yet. */
  readers: Reader[];
  /** Their books the town may not know yet. */
  books: Book[];
  /** The reader's own いいね, 読みたい and 「ネタバレでは？」 on those posts. */
  likedPosts: string[];
  likeTaps: Record<string, number>;
  wantedPosts: string[];
  spoilerReports: string[];
  /** What reports folded among those posts. */
  reviewFolds: TownState["reviewFolds"];
  /**
   * The writers' records of their posts' books, for the feelings a post
   * shows (letter.ts): the town reads only a window of others' records.
   */
  records?: ReadingRecord[];
  /**
   * Read by the reader's asking, and old: an older page of 便りだけ, or one
   * 便り by its id. Its posts are marked so (TownState.readAfter). New ones
   * (polling, a pull) carry none.
   */
  how?: "older" | "alone";
  /** For an older page: how far 便りだけ has now read back. */
  olderRead?: OlderRead;
}

export const emptyArrived = (): Arrived => ({
  posts: [],
  readers: [],
  books: [],
  likedPosts: [],
  likeTaps: {},
  wantedPosts: [],
  spoilerReports: [],
  reviewFolds: {},
});

const time = (post: Post) => Date.parse(post.createdAt) || 0;

/** Each by its id, the first one met kept. */
function unique<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => !seen.has(entry.id) && seen.add(entry.id));
}

/** Two reads as one, each post, reader and book once. */
export function mergeArrived(a: Arrived, b: Arrived): Arrived {
  return {
    posts: unique([...a.posts, ...b.posts]),
    readers: unique([...a.readers, ...b.readers]),
    books: unique([...a.books, ...b.books]),
    likedPosts: [...new Set([...a.likedPosts, ...b.likedPosts])],
    likeTaps: { ...a.likeTaps, ...b.likeTaps },
    wantedPosts: [...new Set([...a.wantedPosts, ...b.wantedPosts])],
    spoilerReports: [...new Set([...a.spoilerReports, ...b.spoilerReports])],
    reviewFolds: { ...a.reviewFolds, ...b.reviewFolds },
    records: unique([...(a.records ?? []), ...(b.records ?? [])]),
  };
}

/**
 * The marks of what was read after the town by the reader's asking: the
 * posts `arrived` brought that are `fresh` here, as `how` it was read; an
 * older page also takes in order the posts it brought that were read alone.
 * A post read alone that is newer than all the town had read (a reply
 * written since, under an old 便り) is new, and goes unmarked.
 */
function marksAfter(
  state: TownState,
  arrived: Arrived,
  fresh: ReadonlySet<string>,
): TownState["readAfter"] {
  const how = arrived.how;
  if (!how) return state.readAfter;
  const newest = Math.max(-Infinity, ...state.posts.map(time));
  const marks = { ...state.readAfter };
  let changed = false;
  for (const post of arrived.posts) {
    const mark = marks[post.id];
    const due = fresh.has(post.id)
      ? mark !== how && (how === "older" || time(post) <= newest)
      : how === "older" && mark === "alone";
    if (!due) continue;
    marks[post.id] = how;
    changed = true;
  }
  return changed ? marks : state.readAfter;
}

/**
 * The town with what arrived taken in: posts it did not have, with the
 * readers and books they need, the reader's own reactions to those posts and
 * their folds. What the town has already is left as it is (a post's いいね
 * here may be newer than the database's), so taking the same twice changes
 * nothing. A post is taken only when its writer and book are known and, for
 * a reply, its post is; never one the reader removed here and the database
 * still holds (`saved`, the town as last saved): its deletion is on its way.
 */
export function takeIn(
  state: TownState,
  arrived: Arrived,
  saved: TownState = state,
): TownState {
  const readerIds = new Set(state.readers.map((reader) => reader.id));
  const readers = unique(arrived.readers).filter(
    (reader) => reader.id !== ME_ID && !readerIds.has(reader.id),
  );
  const knownBooks = new Set(state.books.map((book) => book.id));
  const books = unique(arrived.books).filter(
    (book) => !knownBooks.has(book.id),
  );
  const authors = new Set([ME_ID, ...readerIds, ...readers.map((r) => r.id)]);
  const bookIds = new Set([...knownBooks, ...books.map((book) => book.id)]);
  const had = new Set(state.posts.map((post) => post.id));
  const removedHere = new Set(
    saved === state
      ? []
      : saved.posts.filter((post) => !had.has(post.id)).map((post) => post.id),
  );
  const candidates = unique(arrived.posts).filter(
    (post) =>
      !had.has(post.id) &&
      !removedHere.has(post.id) &&
      authors.has(post.authorId) &&
      (post.bookId === null || bookIds.has(post.bookId)),
  );
  const tops = new Set(
    [...state.posts, ...candidates]
      .filter((post) => post.parentId === null)
      .map((post) => post.id),
  );
  const posts = candidates
    .filter((post) => post.parentId === null || tops.has(post.parentId))
    .sort((a, b) => time(a) - time(b));
  // Readers and books only for the posts taken, so nothing comes unused.
  const usedReaders = new Set(posts.map((post) => post.authorId));
  const usedBooks = new Set(posts.flatMap((post) => post.bookId ?? []));
  const fresh = new Set(posts.map((post) => post.id));
  const readAfter = marksAfter(state, arrived, fresh);
  const olderRead =
    arrived.olderRead &&
    JSON.stringify(arrived.olderRead) !== JSON.stringify(state.olderRead)
      ? arrived.olderRead
      : state.olderRead;
  if (!posts.length)
    return readAfter === state.readAfter && olderRead === state.olderRead
      ? state
      : { ...state, readAfter, olderRead };
  const newReaders = readers.filter((reader) => usedReaders.has(reader.id));
  const newBooks = books.filter((book) => usedBooks.has(book.id));

  // In the town's order (oldest first), without moving what is there.
  const merged = [...state.posts];
  for (const post of posts) {
    const at = merged.findIndex((entry) => time(entry) > time(post));
    merged.splice(at === -1 ? merged.length : at, 0, post);
  }
  const plus = (list: string[], more: string[]) => {
    const added = more.filter((id) => fresh.has(id) && !list.includes(id));
    return added.length ? [...list, ...added] : list;
  };
  const taps = Object.entries(arrived.likeTaps).filter(
    ([id, count]) => fresh.has(id) && count > 1,
  );
  const folds = Object.entries(arrived.reviewFolds).filter(
    ([key]) =>
      posts.some((post) => key === reviewKey("post", post.id)) &&
      !(key in state.reviewFolds),
  );
  // The writers' records of the books of the posts taken, ones the town lacks.
  const stands = new Set(
    posts.flatMap((post) =>
      post.bookId ? [post.authorId + "\n" + post.bookId] : [],
    ),
  );
  const hadRecords = new Set(state.readingRecords.map((record) => record.id));
  const records = unique(arrived.records ?? []).filter(
    (record) =>
      record.readerId !== ME_ID &&
      !hadRecords.has(record.id) &&
      stands.has(record.readerId + "\n" + record.bookId),
  );
  return {
    ...state,
    readers: newReaders.length
      ? [...state.readers, ...newReaders]
      : state.readers,
    books: newBooks.length ? [...state.books, ...newBooks] : state.books,
    posts: merged,
    likedPosts: plus(state.likedPosts, arrived.likedPosts),
    likeTaps: taps.length
      ? { ...state.likeTaps, ...Object.fromEntries(taps) }
      : state.likeTaps,
    wantedPosts: plus(state.wantedPosts, arrived.wantedPosts),
    spoilerReports: plus(state.spoilerReports, arrived.spoilerReports),
    reviewFolds: folds.length
      ? { ...state.reviewFolds, ...Object.fromEntries(folds) }
      : state.reviewFolds,
    readingRecords: records.length
      ? [...state.readingRecords, ...records].sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        )
      : state.readingRecords,
    readAfter,
    olderRead,
  };
}
