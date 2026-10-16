import { isDatabaseId } from "./paths";
import { ME_ID, type Reader, type TownState } from "./types";

// A block works both ways (supabase/migrations/20261012000000_initial_schema
// .sql): neither person reads the other's shop, 便り, records or posters, and
// following ends. The database keeps them apart from the next reading on;
// these take them out of the town already read, so they leave at once.

/** Whether the viewer may block this reader: someone in the database. */
export const blockable = (state: TownState, readerId: string): boolean =>
  readerId !== ME_ID &&
  isDatabaseId(readerId) &&
  state.readers.some((reader) => reader.id === readerId);

export const isBlocked = (state: TownState, readerId: string): boolean =>
  state.blocked.includes(readerId);

/** The readers the viewer blocked, as the town knows them, oldest first. */
export const blockedReaders = (state: TownState): Reader[] =>
  state.blocked.flatMap((id) => {
    const reader = state.readers.find((entry) => entry.id === id);
    return reader ? [reader] : [];
  });

/**
 * The town without what the database keeps from the viewer and these
 * readers. Their profiles stay, so a block can be lifted from them. Others'
 * replies to their 便り go with them, as the next reading leaves those out;
 * the viewer's own stay, since a 便り gone from the town is deleted with the
 * next save (planWrites), and a reply whose post is gone already has a way to
 * show (LetterCard).
 */
export function withoutReaders(
  state: TownState,
  readerIds: Iterable<string>,
): TownState {
  const gone = new Set(readerIds);
  if (!gone.size) return state;
  const postsGone = new Set(
    state.posts
      .filter((post) => gone.has(post.authorId))
      .map((post) => post.id),
  );
  const shopsGone = new Set(
    state.shops.filter((shop) => gone.has(shop.ownerId)).map((shop) => shop.id),
  );
  const changed =
    postsGone.size > 0 ||
    shopsGone.size > 0 ||
    state.readingRecords.some((record) => gone.has(record.readerId)) ||
    state.readingNow.some((entry) => gone.has(entry.readerId)) ||
    state.posters.some((poster) => gone.has(poster.authorId)) ||
    state.shopMessages.some((message) => gone.has(message.readerId));
  if (!changed) return state;
  return {
    ...state,
    posts: state.posts.filter(
      (post) =>
        post.authorId === ME_ID ||
        (!postsGone.has(post.id) &&
          !(post.parentId !== null && postsGone.has(post.parentId))),
    ),
    shops: state.shops.filter((shop) => !shopsGone.has(shop.id)),
    following: state.following.filter((id) => !shopsGone.has(id)),
    readingRecords: state.readingRecords.filter(
      (record) => !gone.has(record.readerId),
    ),
    readingNow: state.readingNow.filter((entry) => !gone.has(entry.readerId)),
    posters: state.posters.filter((poster) => !gone.has(poster.authorId)),
    shopMessages: state.shopMessages.filter(
      (message) => !gone.has(message.readerId),
    ),
  };
}
