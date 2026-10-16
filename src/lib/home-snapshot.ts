import { authorOf, letterOf, type LetterEntry } from "./home-feed";
import { reviewFoldOf, spoilerViewOf } from "./social";
import { emptyTown } from "./town-remote";
import { ME_ID, type TownState } from "./types";

// Home's first 便り, kept in this browser to be drawn the next time the town
// opens, before the town has been read again (管理表58 ③). A slow phone
// shows them at once instead of the bones, and the town as it is now takes
// their place when it arrives.
//
// Only what anyone may read is kept: published, public 便り that no report
// folded, no spoiler, no 便り by a blocked reader, and of each writer only
// the name, handle and colour. Nothing of the reader's own (records,
// shelves, settings, what they liked). A town of someone else, or a sign
// out, leaves it behind (`snapshotFor`), and a sign-out removes it.

export const HOME_SNAPSHOT_KEY = "book-town-home-snapshot-v1";

/** Kept this long; an older one is not drawn. */
const KEPT_FOR = 7 * 24 * 60 * 60 * 1000;
/** As many 便り as a phone's first screens show. */
export const SNAPSHOT_LETTERS = 6;

export interface HomeSnapshot {
  v: 1;
  /** Whose town: an account's id, or "visitor" for the public town. */
  owner: string;
  /** When it was kept. */
  at: number;
  /** The 便り, in Home's order: those followed, then 「街の便り」. */
  followed: string[];
  town: string[];
  /** Enough of a town to draw those 便り (emptyTown otherwise). */
  state: TownState;
}

/** Whether a 便り may be kept: anyone may read it, as it is, now. */
function keepable(state: TownState, entry: LetterEntry): boolean {
  if (state.blocked.includes(authorOf(entry))) return false;
  if (entry.kind === "post") {
    const { post } = entry;
    return (
      !post.spoiler &&
      !post.folded &&
      post.readingMode !== "solo" &&
      post.parentId === null &&
      spoilerViewOf(state, post) === "open" &&
      reviewFoldOf(state, "post", post.id) === null
    );
  }
  const { poster } = entry;
  return (
    poster.status === "published" &&
    poster.inTimeline &&
    !poster.spoiler &&
    reviewFoldOf(state, "poster", poster.id) === null
  );
}

/**
 * What to keep of Home as drawn: its first 便り that may be kept, and of the
 * town only what draws them. Null when none may.
 */
export function snapshotOf(
  state: TownState,
  drawn: { followed: string[]; town: string[] },
  owner: string,
  now: number,
): HomeSnapshot | null {
  const followed: string[] = [];
  const town: string[] = [];
  const entries: LetterEntry[] = [];
  for (const [ids, into] of [
    [drawn.followed, followed],
    [drawn.town, town],
  ] as const)
    for (const id of ids) {
      if (entries.length >= SNAPSHOT_LETTERS) break;
      const entry = letterOf(state, id);
      if (!entry || !keepable(state, entry)) continue;
      entries.push(entry);
      into.push(id);
    }
  if (!entries.length) return null;
  const posts = entries.flatMap((entry) =>
    entry.kind === "post" ? [{ ...entry.post, likers: undefined }] : [],
  );
  const posters = entries.flatMap((entry) =>
    entry.kind === "poster" ? [entry.poster] : [],
  );
  const authors = new Set(entries.map(authorOf));
  const bookIds = new Set([
    ...posts.flatMap((post) => (post.bookId ? [post.bookId] : [])),
    ...posters.flatMap((poster) =>
      poster.pages.flatMap((page) => page.bookIds),
    ),
  ]);
  const face = (reader: TownState["me"]) => ({
    ...emptyTown().me,
    id: reader.id,
    handle: reader.handle,
    name: reader.name,
    color: reader.color,
  });
  const kept = emptyTown();
  return {
    v: 1,
    owner,
    at: now,
    followed,
    town,
    state: {
      ...kept,
      me: authors.has(ME_ID) ? face(state.me) : kept.me,
      readers: state.readers
        .filter((reader) => authors.has(reader.id))
        .map(face),
      books: state.books.filter((book) => bookIds.has(book.id)),
      posts,
      posters,
    },
  };
}

/**
 * The kept snapshot, if it may be drawn now: written by this town, recent,
 * for `owner` (an account's id or "visitor"), or for anyone while the
 * account is still being checked (`owner` null): it holds only what anyone
 * may read.
 */
export function snapshotFor(
  kept: string | null,
  owner: string | null,
  now: number,
): HomeSnapshot | null {
  let snapshot: Partial<HomeSnapshot> | null = null;
  try {
    snapshot = JSON.parse(kept ?? "null");
  } catch {
    return null;
  }
  if (
    !snapshot ||
    snapshot.v !== 1 ||
    typeof snapshot.owner !== "string" ||
    typeof snapshot.at !== "number" ||
    !Array.isArray(snapshot.followed) ||
    !Array.isArray(snapshot.town) ||
    !snapshot.state ||
    !Array.isArray(snapshot.state.posts) ||
    !Array.isArray(snapshot.state.posters) ||
    !Array.isArray(snapshot.state.readers) ||
    !Array.isArray(snapshot.state.books)
  )
    return null;
  if (now - snapshot.at > KEPT_FOR || snapshot.at > now + 60_000) return null;
  if (owner !== null && snapshot.owner !== owner) return null;
  return {
    ...(snapshot as HomeSnapshot),
    // Whatever was kept, the rest of the town is empty.
    state: { ...emptyTown(), ...snapshot.state, me: snapshot.state.me },
  };
}

/** Reads the kept snapshot's words, or null where storage is refused. */
export function readKeptSnapshot(): string | null {
  try {
    return localStorage.getItem(HOME_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

/** Keeps `snapshot`, or removes the kept one for null. */
export function keepSnapshot(snapshot: HomeSnapshot | null) {
  try {
    if (snapshot)
      localStorage.setItem(HOME_SNAPSHOT_KEY, JSON.stringify(snapshot));
    else localStorage.removeItem(HOME_SNAPSHOT_KEY);
  } catch {
    // Full or refused: the next opening shows the bones, as before.
  }
}

/** On a sign-out: an account's kept 便り go; the public town's may stay. */
export function forgetAccountSnapshot() {
  const kept = snapshotFor(readKeptSnapshot(), null, Date.now());
  if (kept?.owner !== "visitor") keepSnapshot(null);
}
