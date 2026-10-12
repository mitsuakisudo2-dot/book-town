import type { RepositorySnapshot, TownRepository } from "./repository";
import type { PersistenceStatus, TownState } from "./types";

/** The kinds of record the town creates, each with its own ids. */
export type RecordKind = "post" | "reading" | "book" | "shelf" | "item";

/** What the town store saves through: this browser, or the person's account. */
export interface TownBackend {
  readonly kind: "local" | "account" | "unavailable";
  /** A new id for a record, unique among `existing`. */
  newId(kind: RecordKind, existing: string[], isbn?: string | null): string;
  /** The town to show; an account's town arrives later. */
  load(): RepositorySnapshot | Promise<RepositorySnapshot>;
  /** Called after every change with the whole town. */
  save(state: TownState): PersistenceStatus;
  /** News from a backend that keeps working after save() returns. */
  watch?(listener: TownBackendListener): () => void;
  /** Stops background work once the store moves on to another backend. */
  close?(): void;
}

export interface TownBackendListener {
  status(status: PersistenceStatus): void;
  /** The town as it really is, after the database refused a change. */
  replace(state: TownState, status: PersistenceStatus): void;
}

const PREFIXES: Record<RecordKind, string> = {
  post: "me-post-",
  reading: "me-reading-",
  book: "my-book-",
  shelf: "mine-shelf-",
  item: "mine-item-",
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
