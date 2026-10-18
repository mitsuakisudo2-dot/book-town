import type { Arrived } from "./arrived";
import type { RepositorySnapshot, TownRepository } from "./repository";
import type { Missed } from "./supabase/sync";
import type { Write } from "./town-remote";
import type { PersistenceStatus, TownState } from "./types";

/** The kinds of record the town creates, each with its own ids. */
export type RecordKind =
  "post" | "reading" | "record" | "book" | "shelf" | "item" | "poster";

/** What the town store saves through: this browser, or the person's account. */
export interface TownBackend {
  /**
   * Where the town comes from: the demo in this browser, the signed-in
   * person's account, a read-only view for a visitor who is not signed in, or
   * nothing (the account could not be read).
   */
  readonly kind: "local" | "account" | "visitor" | "unavailable";
  /** A new id for a record, unique among `existing`. */
  newId(kind: RecordKind, existing: string[], isbn?: string | null): string;
  /** The town to show; an account's town arrives later. */
  load(): RepositorySnapshot | Promise<RepositorySnapshot>;
  /** Called after every change with the whole town. */
  save(state: TownState): PersistenceStatus;
  /** News from a backend that keeps working after save() returns. */
  watch?(listener: TownBackendListener): () => void;
  /**
   * Takes rows read after the town into it as the backend's own reading
   * (arrived.ts), so they are never written back: `take` is handed the town
   * and the one last saved. The town to show, or null while none is read.
   * The demo has nothing to take in.
   */
  absorb?(
    take: (state: TownState, saved: TownState) => TownState,
  ): TownState | null;
  /**
   * 便り the town lacks, written since `since` (an ISO time), oldest first,
   * from NEWER_SLACK before it and at most NEWER_PAGES pages of NEWER_MAX;
   * with no `since`, the newest NEWER_MAX. What polling and a pull bring
   * (arrivals.ts). Never the reader's own.
   */
  newer?(since: string | null): Promise<Arrived>;
  /**
   * Top-level 便り by `authors` ("me" for the reader) at or before
   * `before` that the town lacks, newest first, at most OLDER_PAGE, with
   * their replies: 便りだけ's next stretch past what the town read. Ones
   * written at the same moment as `before` are never skipped.
   */
  older?(before: string, authors: string[]): Promise<Arrived>;
  /** One post with its replies (a reply brings its post): a page by its id. */
  post?(id: string): Promise<Arrived>;
  /**
   * The words of another reader's records of finished books, by record:
   * the town reads others' records without them (AUD-006), and a profile's
   * page reads them when it is opened. Nothing for the reader's own.
   */
  notes?(readerId: string): Promise<Map<string, RecordWords>>;
  /** Stops background work once the store moves on to another backend. */
  close?(): void;
}

/** 便り one page of the newer ones brings. */
export const NEWER_MAX = 50;
/** Pages one read of the newer ones goes on for, at most (仮). */
export const NEWER_PAGES = 4;
/**
 * How far before the newest known 便り newer ones are read from (仮): a
 * post's time is when it was written, and it may be saved a moment later.
 */
export const NEWER_SLACK = 10_000;
/** 便り one stretch of 便りだけ's older ones brings. */
export const OLDER_PAGE = 20;

/**
 * What a town can read after it was read, from the backend it was read
 * from (`generation`, as the store counts them). The demo has none.
 */
export type TownReads = Required<
  Pick<TownBackend, "newer" | "older" | "post">
> & { generation: number };

/** A record's words as its reader wrote them, and whether they give away the story. */
export interface RecordWords {
  note: string;
  spoiler: boolean;
}

export interface TownBackendListener {
  status(status: PersistenceStatus): void;
  /**
   * The town as the database holds it, read again after a change was
   * refused ("recovered", with the changes that did not reach it) or after
   * changes kept on the device were sent (supabase/sync.ts).
   */
  replace(
    state: TownState,
    status: PersistenceStatus,
    missed?: Missed<Write>,
  ): void;
}

const PREFIXES: Record<RecordKind, string> = {
  post: "me-post-",
  reading: "me-reading-",
  record: "me-record-",
  book: "my-book-",
  shelf: "mine-shelf-",
  item: "mine-item-",
  poster: "me-poster-",
};

/** Short ids counted up in this browser: me-post-1, me-post-2, … */
export function counterId(
  kind: RecordKind,
  existing: string[],
  isbn?: string | null,
): string {
  if (kind === "book" && isbn) return "isbn-" + isbn;
  const prefix = PREFIXES[kind];
  const max = existing.reduce((highest, id) => {
    if (!id.startsWith(prefix)) return highest;
    const suffix = Number(id.slice(prefix.length));
    return Number.isInteger(suffix) ? Math.max(highest, suffix) : highest;
  }, 0);
  return `${prefix}${max + 1}`;
}

/** The demo: everything stays in this browser. */
export function localBackend(repository: TownRepository): TownBackend {
  return {
    kind: "local",
    newId: counterId,
    load: () => repository.load(),
    save: (state) => repository.save(state),
  };
}

/** Signed in, but the account could not be read: nothing to show or save. */
export function unavailableBackend(empty: TownState): TownBackend {
  return {
    kind: "unavailable",
    newId: counterId,
    load: () => ({ state: empty, status: "unavailable" }),
    save: () => "unavailable",
  };
}
