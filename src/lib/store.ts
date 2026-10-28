"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { seedState } from "./data";
import { localTownRepository, type TownRepository } from "./repository";
import {
  localBackend,
  unavailableBackend,
  type RecordKind,
  type TownBackend,
  type TownReads,
} from "./town-backend";
import {
  askOfKey,
  moreKey,
  withMore,
  type MoreAsk,
  type TownMore,
} from "./town-more";
import { cleanShelves, emptyTown, type Write } from "./town-remote";
import type { Missed } from "./supabase/sync";
import { townMissedLine } from "./missed-changes";
import { FIRST_SHELF_NAME } from "./words";
import { draftOwner } from "./draft-owner";
import { takeIn, type Arrived } from "./arrived";
import { supabaseConfigured } from "./supabase/config";
import { followAccount } from "./town-session";
import { accountStore } from "./account-session";
import { journalOwner, type JournalTown } from "./library-journal";
import {
  libraryChange,
  undoLibraryChange,
  withLibraryOp,
  type LibraryUndo,
  keepingUses,
  withoutRegistering,
} from "./library-town";
import {
  defaultShelfAudience,
  DEFAULT_SHELVES,
  encounterOf,
  forgetEncounter,
  meetEncounter,
  restoreEncounter,
  popEncounterKind,
  positionAfter,
  undoEncounter,
  writeMemo,
  type EncounterInput,
  READING_STATUSES,
  readRule,
  validateShelf,
  type LibraryShelf,
  type ReadingStatus,
} from "./library";
import { requestAccount } from "./visitor";
import {
  askForName,
  needsName,
  reachesPeople,
  WRITTEN,
} from "./public-profile";
import { refuseForSample } from "./sample-notice";
import { isDatabaseId, isSampleId } from "./record-kind";
import { bookAuthor, bookById, bookByIsbn, booksOfIsbn } from "./book-name";
import { mine as ownBookOf, owning } from "./own-books";
import {
  bookPrice,
  bookText,
  createRegisteredBook,
  normalizeIsbn,
} from "./books";
import { cleanLinks } from "./links";
import { cleanRecord } from "./records";
import {
  choicesFor,
  visibilityOf,
  VISIBILITY_KINDS,
  withVisibility,
} from "./visibility";
import { cleanPosterDraft, posterProblem, type Poster } from "./posters";
import {
  NOTE_KINDS,
  cardById,
  changedNote,
  cleanNoteBody,
  cleanPage,
  deviceTimeZone,
  noteSessionOf,
  runningCard,
  withBookChanged,
  withCardBegun,
  withCardBookChanged,
  withCardDiscarded,
  withPaused,
  withReadOn,
  withReadingAdded,
  withReadingEnded,
  withResumed,
  type ReadingNote,
} from "./reading-cards";
import { handleProblem, normalizeHandle } from "./handles";
import { tapsOf } from "./social";
import { rangedIsbns } from "./spoiler-range";
import { blockable, withoutReaders } from "./blocks";
import {
  COMPOSE_ICONS,
  SPOILER_DISPLAYS,
  TOWN_MODES,
  LIKE_TAPS_MAX,
  ME_ID,
  POP_REACTIONS,
  POST_MAX_LENGTH,
  SPOILER_THROUGH_MAX,
  BIO_MAX_LENGTH,
  NINE_NOTE_MAX_LENGTH,
  POP_MAX_LENGTH,
  READER_NAME_MAX_LENGTH,
  SHELF_NAME_MAX_LENGTH,
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_TAGLINE_MAX_LENGTH,
  READING_MODES,
  popReactionKey,
  reviewKey,
  OWN_SHOP_ID,
  displayCost,
  normalizeCapacity,
  shelfUsed,
  type Book,
  type BookDisplay,
  type PersistenceStatus,
  type Post,
  type ReadingRecord,
  type ReadingSession,
  type Shelf,
  type Shop,
  type ShopTheme,
  type SpoilerLine,
  type TownActions,
  type TownState,
} from "./types";

/** The shelf every new shop opens with. */
export const FIRST_SHELF_ID = "mine-shelf-1";
export { displayCost, shelfUsed } from "./types";

/** How many searches what more() read is kept for (the last ones typed). */
const SEARCHES_KEPT = 20;

const themes: ShopTheme[] = ["sage", "ink", "ochre", "rose"];
const validDisplay = (display: BookDisplay): boolean =>
  display === "spine" || display === "face";
const clean = (value: string, max = 10000): string => value.slice(0, max);

const toggled = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

/** The reader's own registered book with this ISBN, if any. */
export const libraryBookByIsbn = (state: TownState, isbn: string) =>
  state.books.find(
    (book) => book.isbn === isbn && state.library.includes(book.id),
  );

/** Folds by reports, less those of things that are gone. */
const withoutFolds = (
  folds: TownState["reviewFolds"],
  kind: "post" | "poster",
  gone: Set<string>,
): TownState["reviewFolds"] => {
  const keys = [...gone].map((id) => reviewKey(kind, id));
  if (!keys.some((key) => key in folds)) return folds;
  return Object.fromEntries(
    Object.entries(folds).filter(([key]) => !keys.includes(key)),
  );
};

const isBackend = (
  source: TownRepository | TownBackend,
): source is TownBackend => "newId" in source;

export interface TownStoreOptions {
  /**
   * Called once, on first use, instead of loading `source`: it decides which
   * backend the town uses (the demo, or the signed-in person's account) and
   * switches with switchTo(). Until then the town is empty and loading.
   */
  follow?: (switchTo: (backend: TownBackend) => void) => void;
  /** Called when a visitor who is not signed in tries to change something. */
  onVisitor?: () => void;
  /** Called when a signed-in reader's like or follow would go to a 見本. */
  onSample?: () => void;
  /**
   * Called when a reader with no public profile tries something that would
   * reach people (public-profile.ts): `then` does it again once they have
   * chosen a name and an ID.
   */
  onNeedsName?: (then: () => void) => void;
  /**
   * Called once for each batch of changes that did not reach the database
   * (supabase/sync.ts): it keeps what can be kept of them and answers the
   * line that tells the reader (missed-changes.ts).
   */
  onMissed?: (missed: Missed<Write>) => string | null;
}

/** Changes that did not reach the database, as the town last told them. */
export interface TownMissed extends Missed<Write> {
  /** Counts the batches, so each is told once. */
  id: number;
  /** What the reader is told, or null with nothing to tell. */
  line: string | null;
}

/** Actions a visitor's page runs by itself, which need no invitation. */
const QUIET_ACTIONS = new Set<keyof TownActions>(["markNotificationsSeen"]);
/**
 * Actions that reach the person behind a shop or a post, and which shop or
 * post they reach. With an account, those meant for a 見本 are turned away:
 * nobody is there to receive them, and the database could not keep them.
 */
const REACHING: Partial<Record<string, (args: unknown[]) => unknown>> = {
  toggleFollow: ([shopId]) => shopId,
  blockReader: ([readerId]) => readerId,
  togglePopReaction: ([shopId]) => shopId,
  toggleLike: ([postId]) => postId,
  tapLike: ([postId]) => postId,
  toggleSpoilerReport: ([postId]) => postId,
  createPost: ([draft]) =>
    (draft as { parentId?: unknown } | undefined)?.parentId,
};
const reachesSample = (name: string, args: unknown[]) => {
  const target = REACHING[name]?.(args);
  return typeof target === "string" && isSampleId(target);
};

/** Actions that answer whether they did anything. */
const ANSWERING_ACTIONS = new Set<keyof TownActions>([
  "addShelfBook",
  "blockReader",
  "changeCardBook",
  "changeDisplay",
  "changeReadingBook",
  "changeReadingNote",
  "deletePoster",
  "editLibraryShelf",
  "putAwayLibraryShelf",
  "readOn",
  "setDefaultShelfAudience",
  "updateRecord",
]);
/** What an action turned away answers: false, no books put back, or nothing. */
const refused = (name: keyof TownActions) =>
  ANSWERING_ACTIONS.has(name) ? false : name === "undoLibrary" ? 0 : null;

export function createTownStore(
  source: TownRepository | TownBackend = localTownRepository,
  now: () => Date = () => new Date(),
  options: TownStoreOptions = {},
) {
  // This stable snapshot is used both by static rendering and the first
  // hydration render. A build with accounts starts empty, so a signed-in
  // reader never sees the demo town flash by.
  const initial = options.follow ? emptyTown() : seedState;
  let backend: TownBackend = isBackend(source) ? source : localBackend(source);
  let state: TownState = initial;
  let status: PersistenceStatus = "loading";
  let initialized = false;
  // While an account's town is on its way, nothing can be changed or saved.
  // That includes the time before `follow` has chosen where the town lives,
  // so nothing meant for an account is written into this browser's demo.
  let loading = Boolean(options.follow);
  let generation = 0;
  // Counts the town's readings: each load, and each reading again after a
  // refused change, which leaves out what was read after the town.
  let readCount = 0;
  let missed: TownMissed | null = null;
  let unwatch: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  // What pages read after the town (more), by ask, from this backend; and
  // the readings on their way.
  let kept = new Map<string, TownMore>();
  const asking = new Map<string, Promise<void>>();

  function start(next: TownBackend) {
    const mine = ++generation;
    kept = new Map();
    asking.clear();
    const previous = backend;
    unwatch?.();
    backend = next;
    if (previous !== next) previous.close?.();
    const current = () => mine === generation;
    unwatch =
      next.watch?.({
        status(update) {
          if (!current()) return;
          status = update;
          notify();
        },
        replace(update, updateStatus, lost) {
          if (!current()) return;
          readCount += 1;
          state = update;
          status = updateStatus;
          if (lost && (lost.refused.length || lost.elsewhere.length))
            missed = {
              ...lost,
              id: (missed?.id ?? 0) + 1,
              line: options.onMissed?.(lost) ?? null,
            };
          notify();
        },
      }) ?? null;
    const result = next.load();
    readCount += 1;
    if ("then" in result) {
      loading = true;
      state = emptyTown();
      status = "loading";
      notify();
      result.then(
        (snapshot) => {
          if (!current()) return;
          loading = false;
          readCount += 1;
          state = snapshot.state;
          status = snapshot.status;
          notify();
        },
        () => {
          // The account could not be read: show that, and keep nothing to save.
          if (current()) start(unavailableBackend(emptyTown()));
        },
      );
      return;
    }
    loading = false;
    state = result.state;
    status = result.status;
    notify();
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    if (options.follow) options.follow(start);
    else start(backend);
  }

  /** Whether the change was taken: nothing is changed while the town loads. */
  // The encounter a press is making (withMet), and once it is in the town,
  // the one takeMet gives its toast: only within the same turn of the press,
  // so a press that met nothing new is never offered an older one's.
  let pendingMet: string | null = null;
  let lastMet: string | null = null;
  // What a reading marked in the library, by its session, to undo while
  // this page is open: 読書中 when its book gives way to another within a
  // minute, 読了 when it is taken back or the card is not kept. Gone with
  // the page: the library is the reader's to change after that.
  const readingMarks = new Map<string, LibraryUndo>();
  const finishMarks = new Map<string, LibraryUndo>();
  function commit(next: TownState): boolean {
    const making = pendingMet;
    pendingMet = null;
    if (next === state || loading) return false;
    if (making && next.encounters.some((c) => c.id === making)) {
      lastMet = making;
      queueMicrotask(() => {
        if (lastMet === making) lastMet = null;
      });
    }
    state = keepingUses(state, next);
    status = backend.save(state);
    notify();
    return true;
  }

  function withShop(nextShop: Shop) {
    const validKeys = new Set(
      [...state.shops, nextShop].flatMap((shop) =>
        shop.shelves
          .filter((shelf) => shelf.isPublic)
          .flatMap((shelf) =>
            shelf.items.map((item) =>
              popReactionKey(shop.id, shelf.id, item.id),
            ),
          ),
      ),
    );
    commit({
      ...state,
      ownShop: nextShop,
      popReactions: Object.fromEntries(
        Object.entries(state.popReactions).filter(([key]) =>
          validKeys.has(key),
        ),
      ),
    });
  }
  /** Whether a smart shelf's 「ほかの棚」 names only shelves filled by hand. */
  const handShelves = (ids: string[] | undefined) =>
    !ids ||
    ids.every((id) =>
      state.libraryShelves.some(
        (shelf) => shelf.id === id && shelf.rule === null,
      ),
    );

  function editShelf(shelfId: string, edit: (shelf: Shelf) => Shelf) {
    const shop = state.ownShop;
    if (!shop) return;
    const shelf = shop.shelves.find((entry) => entry.id === shelfId);
    if (!shelf) return;
    const nextShelf = edit(shelf);
    if (nextShelf === shelf || shelfUsed(nextShelf) > nextShelf.capacity)
      return;
    withShop({
      ...shop,
      shelves: shop.shelves.map((entry) =>
        entry.id === shelfId ? nextShelf : entry,
      ),
    });
  }

  const nextId = (kind: RecordKind, ids: string[], isbn?: string | null) =>
    backend.newId(kind, ids, isbn);
  const newBookId = (ids: string[], isbn: string | null) =>
    nextId("book", ids, isbn);
  // The town before the running action was given copies of others' books
  // (own()), and the town with them: an action not taken leaves none.
  let unowned: { before: TownState; staged: TownState } | null = null;
  /**
   * The books `ids` name that the town lacks and a page read after it
   * (more: a search's, a book's page's, a reader's 人生の9冊), taken in as
   * the backend's own reading before an action names them: they are the
   * database's rows (the library's catalog's, or another reader's, then
   * copied by own()), never written back as typed in. Without this, a book
   * a search found beyond the town's newest was turned away without a word.
   */
  function takeInRead(ids: readonly (string | null | undefined)[]) {
    if (loading || !backend.absorb || !kept.size) return;
    const known = new Set(state.books.map((book) => book.id));
    const wanted = new Set(
      ids.filter((id): id is string => Boolean(id) && !known.has(id!)),
    );
    if (!wanted.size) return;
    const found = new Map<string, Book>();
    // The newest reading of a book first.
    for (const read of [...kept.values()].reverse())
      for (const book of read.books)
        if (wanted.has(book.id) && !found.has(book.id))
          found.set(book.id, book);
    if (!found.size) return;
    const take = (town: TownState): TownState => {
      const have = new Set(town.books.map((book) => book.id));
      const more = [...found.values()].filter((book) => !have.has(book.id));
      return more.length ? { ...town, books: [...town.books, ...more] } : town;
    };
    // Into what the backend holds as saved, and into the town as it is now
    // (with copies an action staged), the same.
    if (!backend.absorb(take)) return;
    const next = take(state);
    if (next === state) return;
    if (unowned && state === unowned.staged)
      unowned = { before: take(unowned.before), staged: next };
    state = next;
    notify();
  }
  /**
   * The books the reader's rows will name for `ids` (own-books.ts): another
   * reader's book is named by the reader's own (one in `list`, the list the
   * action changes, first), a copy of it put in the town now when they have
   * none. The copy stays if the action is taken.
   */
  function own<T extends string | null | undefined>(
    ids: readonly T[],
    list?: readonly string[],
  ): T[] {
    takeInRead(ids);
    const made = owning(state, ids, newBookId, list);
    if (made.state !== state) {
      unowned = { before: unowned?.before ?? state, staged: made.state };
      state = made.state;
    }
    return made.ids;
  }
  /**
   * own(), and a book named twice only by two given for the same one (another
   * reader's and the reader's own of it) once: what was given twice stays
   * twice, for the check that turns that away.
   */
  function ownOnce(ids: readonly string[]): string[] {
    const named = own(ids);
    return named.filter((id, at) => {
      const first = named.indexOf(id);
      return first === at || ids[first] === ids[at];
    });
  }
  /**
   * The town with the encounter a press makes (on) or takes back (a diary:
   * the press itself is kept as before, and the library goes by it). Its
   * book is the reader's own (own()), so the same book met before and
   * registered later is one book.
   */
  function withMet(
    town: TownState,
    input: EncounterInput | null,
    on: boolean,
  ): TownState {
    if (!input) return town;
    const at = now().toISOString();
    const c = encounterOf(
      input,
      crypto.randomUUID(),
      at,
      backend.kind === "account",
    );
    if (!c) return town;
    if (on) {
      const meeting = meetEncounter(town.encounters, c);
      if (!meeting.met) return town;
      pendingMet = meeting.encounter.id;
      return { ...town, encounters: meeting.encounters };
    }
    const encounters = undoEncounter(town.encounters, c, at);
    return encounters === town.encounters ? town : { ...town, encounters };
  }
  /**
   * A post's encounter, its book the reader's own (made now when met), or
   * null for a post the town lacks. Asked before the town is changed, so a
   * copy own() makes is in it.
   */
  function postMet(
    postId: string,
    kind: "like" | "want",
    on: boolean,
  ): EncounterInput | null {
    const post = state.posts.find((entry) => entry.id === postId);
    if (!post) return null;
    const [bookId] = on && post.bookId ? own([post.bookId]) : [post.bookId];
    return { via: "post", kind, post: { ...post, bookId } };
  }
  const shopOf = (shopId: string) =>
    [...state.shops, ...(state.ownShop ? [state.ownShop] : [])].find(
      (entry) => entry.id === shopId,
    );
  // Words the reader wrote are not taken where they cannot be kept (an
  // account that could not be read): the screen keeps them as a draft instead.
  const keepsWords = () => backend.kind !== "unavailable";

  const actions: TownActions = {
    createShop(name, description, theme) {
      initialize();
      if (state.ownShop || !name.trim() || !themes.includes(theme)) return;
      withShop({
        id: OWN_SHOP_ID,
        ownerId: ME_ID,
        name: clean(name.trim(), SHOP_NAME_MAX_LENGTH),
        description: clean(description, SHOP_DESCRIPTION_MAX_LENGTH),
        theme,
        tagline: "",
        followers: 0,
        demo: false,
        shelves: [
          {
            id: FIRST_SHELF_ID,
            name: FIRST_SHELF_NAME,
            capacity: 20,
            items: [],
            isPublic: true,
          },
        ],
      });
    },
    updateShop(patch) {
      initialize();
      if (!state.ownShop || !patch.name.trim() || !themes.includes(patch.theme))
        return;
      withShop({
        ...state.ownShop,
        name: clean(patch.name.trim(), SHOP_NAME_MAX_LENGTH),
        description: clean(patch.description, SHOP_DESCRIPTION_MAX_LENGTH),
        theme: patch.theme,
        tagline: clean(patch.tagline, SHOP_TAGLINE_MAX_LENGTH),
      });
    },
    addShelf(name, capacity) {
      initialize();
      const shop = state.ownShop;
      if (!shop || !name.trim() || shop.shelves.length >= 100) return;
      withShop({
        ...shop,
        shelves: [
          ...shop.shelves,
          {
            id: nextId(
              "shelf",
              shop.shelves.map((entry) => entry.id),
            ),
            name: clean(name.trim(), SHELF_NAME_MAX_LENGTH),
            capacity: normalizeCapacity(capacity),
            items: [],
            isPublic: true,
          },
        ],
      });
    },
    updateShelf(shelfId, patch) {
      initialize();
      if (patch.name !== undefined && !patch.name.trim()) return;
      editShelf(shelfId, (shelf) => ({
        ...shelf,
        ...(patch.name !== undefined
          ? { name: clean(patch.name.trim(), SHELF_NAME_MAX_LENGTH) }
          : {}),
        ...(typeof patch.isPublic === "boolean"
          ? { isPublic: patch.isPublic }
          : {}),
      }));
    },
    removeShelf(shelfId) {
      initialize();
      if (
        !state.ownShop ||
        !state.ownShop.shelves.some((entry) => entry.id === shelfId)
      )
        return;
      withShop({
        ...state.ownShop,
        shelves: state.ownShop.shelves.filter((entry) => entry.id !== shelfId),
      });
    },
    restoreShelves(given) {
      initialize();
      const known = () => new Set(state.books.map((book) => book.id));
      // Books gone from the town since are left out; another reader's book
      // is named by the reader's own, as on every shelf.
      const kept = cleanShelves(given, known());
      const named = own(
        kept.flatMap((shelf) => shelf.items.map((item) => item.bookId)),
      );
      let at = 0;
      const shelves = cleanShelves(
        kept.map((shelf) => ({
          ...shelf,
          items: shelf.items.map((item) => ({ ...item, bookId: named[at++] })),
        })),
        known(),
      );
      const shop = state.ownShop;
      if (!shop || !shelves.length) return;
      withShop({ ...shop, shelves });
    },
    addShelfBook(shelfId, given, display, restore) {
      initialize();
      const [bookId] = own(
        [given],
        state.ownShop?.shelves
          .find((entry) => entry.id === shelfId)
          ?.items.map((item) => item.bookId),
      );
      const shop = state.ownShop;
      const shelf = shop?.shelves.find((entry) => entry.id === shelfId);
      if (
        !shop ||
        !shelf ||
        !validDisplay(display) ||
        !state.books.some((book) => book.id === bookId) ||
        shelf.items.some((entry) => entry.bookId === bookId) ||
        shelfUsed(shelf) + displayCost(display) > shelf.capacity
      )
        return false;
      const id = nextId(
        "item",
        shop.shelves.flatMap((entry) => entry.items.map((item) => item.id)),
      );
      editShelf(shelfId, (entry) => {
        const items = [...entry.items];
        const at =
          restore && Number.isFinite(restore.index)
            ? Math.min(items.length, Math.max(0, Math.trunc(restore.index)))
            : items.length;
        items.splice(at, 0, {
          id,
          bookId,
          display,
          pop: restore ? clean(restore.pop, POP_MAX_LENGTH) : "",
        });
        return { ...entry, items };
      });
      return true;
    },
    removeShelfBook(shelfId, itemId) {
      initialize();
      editShelf(shelfId, (shelf) =>
        shelf.items.some((entry) => entry.id === itemId)
          ? {
              ...shelf,
              items: shelf.items.filter((entry) => entry.id !== itemId),
            }
          : shelf,
      );
    },
    moveShelfBook(shelfId, itemId, toIndex) {
      initialize();
      if (!Number.isFinite(toIndex)) return;
      editShelf(shelfId, (shelf) => {
        const from = shelf.items.findIndex((entry) => entry.id === itemId);
        if (from < 0) return shelf;
        const to = Math.min(
          shelf.items.length - 1,
          Math.max(0, Math.trunc(toIndex)),
        );
        if (from === to) return shelf;
        const items = [...shelf.items];
        const [moving] = items.splice(from, 1);
        items.splice(to, 0, moving);
        return { ...shelf, items };
      });
    },
    changeDisplay(shelfId, itemId, display) {
      initialize();
      const shelf = state.ownShop?.shelves.find(
        (entry) => entry.id === shelfId,
      );
      const item = shelf?.items.find((entry) => entry.id === itemId);
      if (!shelf || !item || !validDisplay(display)) return false;
      if (
        shelfUsed(shelf) - displayCost(item.display) + displayCost(display) >
        shelf.capacity
      )
        return false;
      if (item.display !== display)
        editShelf(shelfId, (entry) => ({
          ...entry,
          items: entry.items.map((book) =>
            book.id === itemId ? { ...book, display } : book,
          ),
        }));
      return true;
    },
    updatePop(shelfId, itemId, pop) {
      initialize();
      editShelf(shelfId, (shelf) =>
        shelf.items.some((entry) => entry.id === itemId)
          ? {
              ...shelf,
              items: shelf.items.map((entry) =>
                entry.id === itemId
                  ? { ...entry, pop: clean(pop, POP_MAX_LENGTH) }
                  : entry,
              ),
            }
          : shelf,
      );
    },
    toggleFollow(shopId) {
      initialize();
      if (!state.shops.some((shop) => shop.id === shopId)) return;
      commit({
        ...state,
        following: state.following.includes(shopId)
          ? state.following.filter((id) => id !== shopId)
          : [...state.following, shopId],
      });
    },
    blockReader(readerId) {
      initialize();
      // Only an account keeps a block; the demo has nobody to keep away.
      if (
        backend.kind !== "account" ||
        state.blocked.includes(readerId) ||
        !blockable(state, readerId)
      )
        return false;
      return commit({
        ...withoutReaders(state, [readerId]),
        blocked: [...state.blocked, readerId],
      });
    },
    unblockReader(readerId) {
      initialize();
      if (!state.blocked.includes(readerId)) return;
      commit({
        ...state,
        blocked: state.blocked.filter((id) => id !== readerId),
      });
    },
    toggleWish(given, inShop) {
      initialize();
      const [bookId] = own([given], state.wishlist);
      if (!state.books.some((book) => book.id === bookId)) return;
      const on = !state.wishlist.includes(bookId);
      const shop = inShop ? shopOf(inShop) : undefined;
      const wished = withLibraryOp(
        state,
        [bookId],
        { want: on },
        now().toISOString(),
        "want",
      );
      if (wished === state) return;
      if (on) {
        commit(
          withMet(
            wished,
            shop && shop.ownerId !== ME_ID
              ? { via: "shop", kind: "want", shop, bookId }
              : { via: "book", kind: "want", bookId },
            true,
          ),
        );
        return;
      }
      // 読みたい taken back, wherever it is pressed, takes back its book
      // page's and shops' encounters; a post's or a POP's go with their own.
      const at = now().toISOString();
      const encounters = wished.encounters
        .filter(
          (c) =>
            c.bookId === bookId &&
            c.kind === "want" &&
            (c.via === "book" || c.via === "shop") &&
            c.undoneAt === null,
        )
        .reduce((list, c) => undoEncounter(list, c, at), wished.encounters);
      commit(
        encounters === wished.encounters ? wished : { ...wished, encounters },
      );
    },
    takeMet() {
      const id = lastMet;
      lastMet = null;
      return id;
    },
    writeEncounterMemo(encounterId, memo) {
      initialize();
      const encounters = writeMemo(
        state.encounters,
        encounterId,
        memo,
        now().toISOString(),
      );
      if (encounters === state.encounters) return false;
      return commit({ ...state, encounters });
    },
    setMemoHint(on) {
      initialize();
      if (state.settings.memoHint === on) return;
      commit({ ...state, settings: { ...state.settings, memoHint: on } });
    },
    meetScenePop(shopId, given, placementKey, reaction, on) {
      initialize();
      const shop = shopOf(shopId);
      if (!shop || !POP_REACTIONS.includes(reaction)) return;
      const [bookId] = on ? own([given]) : [ownBookOf(state, given) ?? given];
      if (!state.books.some((book) => book.id === bookId)) return;
      commit(
        withMet(
          state,
          {
            via: "pop",
            kind: popEncounterKind(reaction),
            shop,
            bookId,
            placementKey,
          },
          on,
        ),
      );
    },
    forgetEncounter(encounterId) {
      initialize();
      const encounters = forgetEncounter(state.encounters, encounterId);
      if (encounters !== state.encounters) commit({ ...state, encounters });
    },
    restoreEncounter(encounter) {
      initialize();
      const encounters = restoreEncounter(state.encounters, encounter);
      if (encounters !== state.encounters) commit({ ...state, encounters });
    },
    toggleFavorite(given) {
      initialize();
      const [bookId] = own([given], state.favorites);
      if (!state.books.some((book) => book.id === bookId)) return;
      commit(
        withLibraryOp(
          state,
          [bookId],
          { favorite: !state.favorites.includes(bookId) },
          now().toISOString(),
          "favorite",
        ),
      );
    },
    togglePopReaction(shopId, shelfId, itemId, reaction) {
      initialize();
      const shop = [
        ...state.shops,
        ...(state.ownShop ? [state.ownShop] : []),
      ].find((entry) => entry.id === shopId);
      const shelf = shop?.shelves.find(
        (entry) => entry.id === shelfId && entry.isPublic,
      );
      if (
        !shelf?.items.some((entry) => entry.id === itemId) ||
        !POP_REACTIONS.includes(reaction)
      )
        return;
      const key = popReactionKey(shopId, shelfId, itemId);
      const current = state.popReactions[key] ?? [];
      const on = !current.includes(reaction);
      const next = on
        ? [...current, reaction]
        : current.filter((entry) => entry !== reaction);
      const popReactions = { ...state.popReactions };
      if (next.length) popReactions[key] = next;
      else delete popReactions[key];
      const given = shelf.items.find((entry) => entry.id === itemId)!.bookId;
      const [bookId] = on ? own([given]) : [ownBookOf(state, given) ?? given];
      commit(
        withMet(
          { ...state, popReactions },
          {
            via: "pop",
            kind: popEncounterKind(reaction),
            shop: shop!,
            bookId,
            placementKey: key,
          },
          on,
        ),
      );
    },
    updateProfile(name, bio, links, handle) {
      initialize();
      if (!name.trim()) return false;
      // With no public profile there is no ID to change: publishProfile
      // gives the first one.
      const nextHandle =
        handle === undefined || state.me.unpublished
          ? state.me.handle
          : normalizeHandle(handle);
      if (!state.me.unpublished && handleProblem(nextHandle, state.readers))
        return false;
      commit({
        ...state,
        me: {
          ...state.me,
          handle: nextHandle,
          name: clean(name.trim(), READER_NAME_MAX_LENGTH),
          bio: clean(bio, BIO_MAX_LENGTH),
          links:
            links === undefined ? (state.me.links ?? []) : cleanLinks(links),
        },
      });
      return true;
    },
    publishProfile(name, handle) {
      initialize();
      const chosen = normalizeHandle(handle);
      if (
        !state.me.unpublished ||
        !name.trim() ||
        handleProblem(chosen, state.readers)
      )
        return false;
      commit({
        ...state,
        me: {
          ...state.me,
          handle: chosen,
          name: clean(name.trim(), READER_NAME_MAX_LENGTH),
          unpublished: false,
        },
      });
      return true;
    },
    updateNine(given, notes) {
      initialize();
      const ids = own(given, state.me.lifeNine);
      // A note written for another reader's book goes with the reader's own,
      // the first such note when two books given are the same one of theirs.
      const noteOf = (id: string) =>
        notes[id] ??
        given
          .map((entry, at) => (ids[at] === id ? notes[entry] : undefined))
          .find((note) => typeof note === "string");
      const validIds = [...new Set(ids)]
        .filter((id) => state.books.some((book) => book.id === id))
        .slice(0, 9);
      const validNotes = Object.fromEntries(
        validIds
          .filter((id) => typeof noteOf(id) === "string")
          .map((id) => [id, clean(noteOf(id), NINE_NOTE_MAX_LENGTH)]),
      );
      commit({
        ...state,
        me: { ...state.me, lifeNine: validIds, nineNotes: validNotes },
      });
    },
    createPost(draft) {
      initialize();
      if (!keepsWords()) return null;
      const body = draft.body.trim();
      const session = draft.fromReading
        ? state.readingSessions.find((entry) => entry.endedAt === null)
        : undefined;
      if (draft.fromReading && !session) return null;
      // A reading memo belongs to the running session's book and never starts a thread reply.
      const bookId = session ? session.bookId : own([draft.bookId ?? null])[0];
      const parentId = session ? null : (draft.parentId ?? null);
      const spoiler = draft.spoiler === true;
      // How far it goes: a volume's number, on a spoiler only (管理表 22 ①).
      const through =
        spoiler &&
        Number.isInteger(draft.spoilerThrough) &&
        draft.spoilerThrough! >= 1 &&
        draft.spoilerThrough! <= SPOILER_THROUGH_MAX
          ? draft.spoilerThrough!
          : undefined;
      const parent = parentId
        ? state.posts.find((entry) => entry.id === parentId)
        : undefined;
      if (
        !body ||
        body.length > POST_MAX_LENGTH ||
        (bookId !== null && !state.books.some((book) => book.id === bookId)) ||
        (parentId !== null && (!parent || parent.parentId !== null)) ||
        // A top-level spoiler needs a book, so it has a door to wait behind.
        (spoiler && parentId === null && bookId === null)
      )
        return null;
      const post: Post = {
        id: nextId(
          "post",
          state.posts.map((entry) => entry.id),
        ),
        authorId: ME_ID,
        body,
        bookId,
        spoiler,
        ...(through !== undefined ? { spoilerThrough: through } : {}),
        parentId,
        createdAt: now().toISOString(),
        likes: 0,
        wants: 0,
        readingMode: session ? session.mode : null,
      };
      // Not taken (the town is still loading): the composer keeps the draft.
      return commit({ ...state, posts: [...state.posts, post] })
        ? post.id
        : null;
    },
    deletePost(postId) {
      initialize();
      const post = state.posts.find((entry) => entry.id === postId);
      if (!post || post.authorId !== ME_ID) return;
      const removed = new Set(
        state.posts
          .filter((entry) => entry.id === postId || entry.parentId === postId)
          .map((entry) => entry.id),
      );
      const keep = (id: string) => !removed.has(id);
      commit({
        ...state,
        // Gone, it keeps no fold, nor a notice about one.
        reviewFolds: withoutFolds(state.reviewFolds, "post", removed),
        posts: state.posts.filter((entry) => keep(entry.id)),
        likedPosts: state.likedPosts.filter(keep),
        likeTaps: Object.fromEntries(
          Object.entries(state.likeTaps).filter(([id]) => keep(id)),
        ),
        wantedPosts: state.wantedPosts.filter(keep),
        spoilerReports: state.spoilerReports.filter(keep),
      });
    },
    toggleLike(postId) {
      initialize();
      if (!state.posts.some((entry) => entry.id === postId)) return;
      const likeTaps = { ...state.likeTaps };
      delete likeTaps[postId];
      const on = !state.likedPosts.includes(postId);
      const met = postMet(postId, "like", on);
      commit(
        withMet(
          {
            ...state,
            likedPosts: toggled(state.likedPosts, postId),
            likeTaps,
          },
          met,
          on,
        ),
      );
    },
    tapLike(postId) {
      initialize();
      const now = tapsOf(state, postId);
      if (!state.posts.some((entry) => entry.id === postId)) return now;
      if (now >= LIKE_TAPS_MAX) return now;
      const taps = now + 1;
      // The first press is the encounter; the presses after it count only.
      const met = now ? null : postMet(postId, "like", true);
      const pressed = {
        ...state,
        likedPosts: now ? state.likedPosts : [...state.likedPosts, postId],
        likeTaps:
          taps > 1 ? { ...state.likeTaps, [postId]: taps } : state.likeTaps,
      };
      commit(withMet(pressed, met, true));
      return taps;
    },
    toggleWant(postId) {
      initialize();
      const post = state.posts.find((entry) => entry.id === postId);
      if (!post?.bookId || post.authorId === ME_ID) return;
      const adding = !state.wantedPosts.includes(postId);
      // What is saved is the reader's own book for it.
      const [bookId] = adding ? own([post.bookId]) : [post.bookId];
      const wanted = {
        ...state,
        wantedPosts: toggled(state.wantedPosts, postId),
      };
      // Wanting a book saves it; taking the reaction back keeps the list as
      // the reader left it.
      commit(
        withMet(
          adding
            ? withLibraryOp(
                wanted,
                [bookId],
                { want: true },
                now().toISOString(),
                "want",
              )
            : wanted,
          { via: "post", kind: "want", post: { ...post, bookId } },
          adding,
        ),
      );
    },
    startReading(given, mode) {
      initialize();
      const [bookId] = own([given]);
      if (
        (bookId !== null && !state.books.some((book) => book.id === bookId)) ||
        !READING_MODES.includes(mode)
      )
        return null;
      const time = now().toISOString();
      // Starting a new reading ends whatever was running.
      const ended = withReadingEnded(state, time);
      const session: ReadingSession = {
        id: nextId(
          "reading",
          state.readingSessions.map((entry) => entry.id),
        ),
        bookId,
        mode,
        startedAt: time,
        endedAt: null,
      };
      // The book is 読書中; a finished one opened again is a reread (問い7).
      // Before the session is added: a running session would already make
      // the row worked out for it 読書中, and nothing would be kept.
      const marked =
        bookId === null
          ? null
          : libraryChange(
              ended,
              [bookId],
              { status: "reading" },
              time,
              "reading",
            );
      const begun = withCardBegun(
        {
          ...(marked?.state ?? ended),
          readingSessions: [...ended.readingSessions, session],
        },
        session,
        nextId(
          "card",
          state.readingCards.map((card) => card.id),
        ),
        deviceTimeZone(),
      );
      if (!commit(begun)) return null;
      if (marked) readingMarks.set(session.id, marked.undo);
      return session.id;
    },
    endReading(finished) {
      initialize();
      const active = state.readingSessions.find(
        (entry) => entry.endedAt === null,
      );
      if (!active) return;
      const time = now().toISOString();
      const ended = withReadingEnded(state, time);
      if (!finished || active.bookId === null) {
        commit(ended);
        return;
      }
      const done = withCardBookChanged(ended, active.id, { finished: true });
      const marked = state.finishedBooks.includes(active.bookId)
        ? null
        : libraryChange(
            done,
            [active.bookId],
            { status: "finished" },
            time,
            "reading",
          );
      if (commit(marked?.state ?? done) && marked)
        finishMarks.set(active.id, marked.undo);
    },
    changeReadingBook(given) {
      initialize();
      const [bookId] = own([given]);
      if (!bookId || !state.books.some((book) => book.id === bookId))
        return false;
      const running = runningCard(state);
      const time = now().toISOString();
      const nextSession = nextId(
        "reading",
        state.readingSessions.map((entry) => entry.id),
      );
      const changed = withBookChanged(state, bookId, time, nextSession);
      if (!running || !changed) return false;
      // The library first, as for a reading begun (startReading): the book
      // given way to so soon goes back to what the library said of it before
      // this reading (読書中, and 読了 if it was said finished), and the new
      // one is 読書中.
      let library: TownState = state;
      const span = running.session.id;
      if (changed.replaced)
        for (const undo of [finishMarks.get(span), readingMarks.get(span)])
          if (undo) library = undoLibraryChange(library, undo, time).state;
      const marked = libraryChange(
        library,
        [bookId],
        { status: "reading" },
        time,
        "reading",
      );
      if (marked) library = marked.state;
      const read = changed.replaced ? span : nextSession;
      if (
        !commit({
          ...library,
          readingSessions: changed.state.readingSessions,
          readingCards: changed.state.readingCards,
          readingCardBooks: changed.state.readingCardBooks,
        })
      )
        return false;
      if (changed.replaced) {
        readingMarks.delete(span);
        finishMarks.delete(span);
      }
      if (marked) readingMarks.set(read, marked.undo);
      return true;
    },
    addReadingLater(given, reading) {
      initialize();
      const [bookId] = own([given]);
      if (!bookId || !state.books.some((book) => book.id === bookId))
        return null;
      const time = now().toISOString();
      const ids = {
        sessionId: nextId(
          "reading",
          state.readingSessions.map((entry) => entry.id),
        ),
        cardId: nextId(
          "card",
          state.readingCards.map((card) => card.id),
        ),
      };
      const added = withReadingAdded(
        state,
        ids,
        bookId,
        reading,
        deviceTimeZone(),
        time,
      );
      if (!added) return null;
      // Finished in it, the book is 読了, as a reading ended finished; 記録
      // しない or taking it back undoes that (finishMarks).
      const marked =
        reading.finished === true && !state.finishedBooks.includes(bookId)
          ? libraryChange(
              added,
              [bookId],
              { status: "finished" },
              time,
              "reading",
            )
          : null;
      if (!commit(marked?.state ?? added)) return null;
      if (marked) finishMarks.set(ids.sessionId, marked.undo);
      return ids.cardId;
    },
    pauseReading() {
      initialize();
      commit(withPaused(state, now().toISOString()));
    },
    resumeReading() {
      initialize();
      commit(withResumed(state, now().toISOString()));
    },
    readOn(cardId) {
      initialize();
      const next = withReadOn(state, cardId, now().toISOString());
      return next !== null && commit(next);
    },
    discardReading(cardId) {
      initialize();
      const card = cardById(state, cardId);
      if (!card) return;
      // What the reading marked in the library (読了, then 読書中) goes
      // back as it was: nothing of the reading is kept.
      const time = now().toISOString();
      const sessions = state.readingCardBooks
        .filter((book) => book.cardId === cardId)
        .map((book) => book.sessionId);
      let next = withCardDiscarded(state, cardId);
      for (const session of [...sessions].reverse())
        for (const undo of [
          finishMarks.get(session),
          readingMarks.get(session),
        ])
          if (undo) next = undoLibraryChange(next, undo, time).state;
      if (!commit(next)) return;
      for (const session of sessions) {
        finishMarks.delete(session);
        readingMarks.delete(session);
      }
    },
    changeCardBook(sessionId, change) {
      initialize();
      const next = withCardBookChanged(state, sessionId, change);
      if (next === state) return false;
      const session = state.readingSessions.find(
        (entry) => entry.id === sessionId,
      );
      const time = now().toISOString();
      const bookId = session?.bookId ?? null;
      // 読み終えた marks the book 読了 in the library, as ending a reading
      // finished does; taken back, the mark made here is undone.
      let library: { state: TownState; undo?: LibraryUndo } = { state: next };
      if (change.finished === true && bookId !== null) {
        const marked = state.finishedBooks.includes(bookId)
          ? null
          : libraryChange(
              next,
              [bookId],
              { status: "finished" },
              time,
              "reading",
            );
        if (marked) library = marked;
      } else if (change.finished === false) {
        const undo = finishMarks.get(sessionId);
        if (undo)
          library = { state: undoLibraryChange(next, undo, time).state };
      }
      if (!commit(library.state)) return false;
      if (library.undo) finishMarks.set(sessionId, library.undo);
      else if (change.finished === false) finishMarks.delete(sessionId);
      return true;
    },
    writeReadingNote(cardId, given) {
      initialize();
      if (!keepsWords() || !cardById(state, cardId)) return null;
      const body = cleanNoteBody(given.body);
      if (body === null || !NOTE_KINDS.includes(given.kind)) return null;
      const note: ReadingNote = {
        id: nextId(
          "note",
          state.readingNotes.map((entry) => entry.id),
        ),
        cardId,
        sessionId: noteSessionOf(state, cardId),
        kind: given.kind,
        body,
        page: cleanPage(given.page),
        createdAt: now().toISOString(),
      };
      return commit({ ...state, readingNotes: [...state.readingNotes, note] })
        ? note.id
        : null;
    },
    changeReadingNote(noteId, change) {
      initialize();
      if (!keepsWords()) return false;
      const note = state.readingNotes.find((entry) => entry.id === noteId);
      const next = note && changedNote(note, change);
      if (!next) return false;
      return commit({
        ...state,
        readingNotes: state.readingNotes.map((entry) =>
          entry === note ? next : entry,
        ),
      });
    },
    eraseReadingNote(noteId) {
      initialize();
      if (
        !keepsWords() ||
        !state.readingNotes.some((entry) => entry.id === noteId)
      )
        return;
      commit({
        ...state,
        readingNotes: state.readingNotes.filter((entry) => entry.id !== noteId),
      });
    },
    registerBook(input, via, bookId, batchId) {
      initialize();
      const title = bookText(input.title);
      const author = bookText(input.author);
      const isbn = input.isbn ? normalizeIsbn(input.isbn) : null;
      if (!title) return null;
      if (input.isbn && !isbn) return null;
      // Until the town is read (or while the account is still being
      // checked), and when the account could not be read at all, nothing
      // would be kept: say so, never that it was registered.
      if (status === "loading" || backend.kind === "unavailable")
        return { result: "not-saved" };
      // Already registered is about the reader's own library, not the town:
      // a book only in the town's catalogue is registered as usual.
      const mine = isbn ? libraryBookByIsbn(state, isbn) : undefined;
      if (mine)
        return { result: "already", bookId: mine.id, title: mine.title };
      // A book sent before under its decided id (its row arrived, its place
      // in the library did not) is that book again; otherwise a book the
      // town has with the ISBN, but never one another reader typed in: the
      // reader registers their own of it (own-books.ts), so what either of
      // them later fixes stays theirs. One with no ISBN is named by its id
      // alone (a book found for ［手で入力］): that book, never a new one.
      const sent = bookById(state.books, bookId);
      const decided =
        sent && !sent.theirs && (isbn ? sent.isbn === isbn : !sent.isbn)
          ? sent
          : undefined;
      if (!isbn && decided && state.library.includes(decided.id))
        return { result: "already", bookId: decided.id, title: decided.title };
      const existing = decided ?? bookByIsbn(state.books, isbn);
      // The library remembers how a book first came in.
      // A scan session's id, as the database keeps it (a UUID).
      const batch = batchId && isDatabaseId(batchId) ? { batchId } : {};
      const register = (town: TownState, id: string) =>
        withLibraryOp(
          town,
          [id],
          { removed: false, ...batch },
          now().toISOString(),
          via === "scan" || via === "isbn" ? via : "manual",
        );
      if (existing)
        return commit(register(state, existing.id))
          ? { result: "added", bookId: existing.id, title: existing.title }
          : { result: "not-saved" };
      const ids = state.books.map((book) => book.id);
      const given = nextId("book", ids, isbn);
      // The decided id, when it is one this town could have given itself.
      const id =
        bookId &&
        !ids.includes(bookId) &&
        (backend.kind === "account" ? isDatabaseId(bookId) : bookId === given)
          ? bookId
          : given;
      const price = bookPrice(input.price);
      // The database puts it in the work of its ISBN's edition; until it is
      // read again, the work of a book the town has with that ISBN stands in.
      const workId = booksOfIsbn(state.books, isbn).find(
        (book) => book.workId,
      )?.workId;
      const book = createRegisteredBook(id, {
        title,
        author,
        ...(isbn ? { isbn } : {}),
        ...(price ? { price } : {}),
      });
      if (workId) book.workId = workId;
      return commit(register({ ...state, books: [...state.books, book] }, id))
        ? { result: "added", bookId: id, title }
        : { result: "not-saved" };
    },
    addBook(input) {
      const done = actions.registerBook(input, input.isbn ? "isbn" : "manual");
      return done && done.result !== "not-saved" ? done.bookId : null;
    },
    fixBook(bookId, fix) {
      initialize();
      const book = bookById(state.books, bookId);
      const title = bookText(fix.title);
      const typed = fix.isbn.trim();
      const isbn = typed ? normalizeIsbn(typed) : null;
      if (!title) return "no-title";
      if (typed && !isbn) return "bad-isbn";
      // Only the reader's own book is theirs to fix.
      if (
        !book ||
        book.theirs ||
        status === "loading" ||
        backend.kind === "unavailable"
      )
        return "not-saved";
      // The form shows the author as the reader sees it (bookAuthor); left
      // as shown, the author stays as it was written.
      const shown = bookText(fix.author);
      const author = shown === bookAuthor(book) ? book.author : shown;
      const moved = (isbn ?? undefined) !== book.isbn;
      if (title === book.title && author === book.author && !moved)
        return "unchanged";
      const mine = isbn ? libraryBookByIsbn(state, isbn) : undefined;
      if (mine && mine.id !== bookId) return "already";
      // A new ISBN puts the book in that ISBN's work, which the database
      // decides: until it is read again, the book is its own.
      const fixed: Book = { ...book, title, author };
      if (isbn) fixed.isbn = isbn;
      else delete fixed.isbn;
      if (moved) delete fixed.workId;
      return commit({
        ...state,
        books: state.books.map((entry) =>
          entry.id === bookId ? fixed : entry,
        ),
      })
        ? "fixed"
        : "not-saved";
    },
    toggleLibrary(given) {
      initialize();
      const [bookId] = own([given], state.library);
      if (!state.books.some((book) => book.id === bookId)) return;
      const time = now().toISOString();
      commit(
        state.library.includes(bookId)
          ? withoutRegistering(state, bookId, time)
          : withLibraryOp(state, [bookId], { removed: false }, time, "manual"),
      );
    },
    ownBook(given) {
      initialize();
      takeInRead([given]);
      const made = owning(state, [given], newBookId);
      const [bookId] = made.ids;
      if (!made.state.books.some((book) => book.id === bookId)) return null;
      return made.state === state || commit(made.state) ? bookId : null;
    },
    changeLibrary(bookIds, change) {
      initialize();
      const named = own(bookIds, state.library);
      const known = new Set(state.books.map((book) => book.id));
      const books = [...new Set(named)].filter((id) => known.has(id));
      const set: Parameters<typeof withLibraryOp>[2] = {};
      if (
        change.status === null ||
        READING_STATUSES.includes(change.status as ReadingStatus)
      )
        set.status = change.status;
      if (typeof change.want === "boolean") set.want = change.want;
      if (
        change.owned === null ||
        change.owned === "yes" ||
        change.owned === "no"
      )
        set.owned = change.owned;
      if (typeof change.favorite === "boolean") set.favorite = change.favorite;
      if (typeof change.removed === "boolean") set.removed = change.removed;
      // A smart shelf gathers its books itself: none is put on by hand.
      const live = (id: unknown) =>
        state.libraryShelves.some(
          (shelf) =>
            shelf.id === id && shelf.deletedAt === null && shelf.rule === null,
        );
      if (live(change.addShelf)) set.addShelf = change.addShelf;
      if (live(change.removeShelf)) set.removeShelf = change.removeShelf;
      if (!books.length || !Object.keys(set).length) return null;
      // A book sorted before it was in the library was found there, on its
      // page or in a search; "manual" would be a registering, which never
      // sets 所有 on a book already in.
      const done = libraryChange(
        state,
        books,
        set,
        now().toISOString(),
        "search",
      );
      return done && commit(done.state) ? done.undo : null;
    },
    undoLibrary(undo) {
      initialize();
      const done = undoLibraryChange(state, undo, now().toISOString());
      return commit(done.state) ? done.restored : 0;
    },
    makeLibraryShelf(name, note, more = {}) {
      initialize();
      const time = now().toISOString();
      const rule = more.rule == null ? null : readRule(more.rule);
      if (more.rule != null && (rule === null || !handShelves(rule.with)))
        return null;
      const shelf: LibraryShelf = {
        id: crypto.randomUUID(),
        name: name.trim(),
        note: note.trim(),
        position: positionAfter(
          state.libraryShelves.map((entry) => entry.position),
          time,
        ),
        showWanted: true,
        // Who may see it starts at the starting choice, as a record does.
        audience: more.audience ?? state.settings.visibility.shelves.audience,
        rule,
        createdAt: time,
        deletedAt: null,
      };
      if (
        validateShelf(shelf) !== null ||
        !choicesFor("shelves").includes(shelf.audience)
      )
        return null;
      return commit({
        ...state,
        libraryShelves: [...state.libraryShelves, shelf],
      })
        ? shelf.id
        : null;
    },
    editLibraryShelf(shelfId, change) {
      initialize();
      const shelf = state.libraryShelves.find((entry) => entry.id === shelfId);
      if (!shelf) return false;
      const next: LibraryShelf = {
        ...shelf,
        ...(typeof change.name === "string"
          ? { name: change.name.trim() }
          : {}),
        ...(typeof change.note === "string"
          ? { note: change.note.trim() }
          : {}),
        ...(typeof change.showWanted === "boolean"
          ? { showWanted: change.showWanted }
          : {}),
        ...(change.audience !== undefined ? { audience: change.audience } : {}),
        // A smart shelf's rule, never taken away or given to one filled by hand.
        ...(change.rule != null && shelf.rule !== null
          ? { rule: readRule(change.rule) }
          : {}),
      };
      if (
        validateShelf(next) !== null ||
        (next.rule === null) !== (shelf.rule === null) ||
        !handShelves(next.rule?.with) ||
        (next.audience !== shelf.audience &&
          !choicesFor("shelves").includes(next.audience)) ||
        (next.name === shelf.name &&
          next.note === shelf.note &&
          next.showWanted === shelf.showWanted &&
          next.audience === shelf.audience &&
          JSON.stringify(next.rule) === JSON.stringify(shelf.rule))
      )
        return false;
      return commit({
        ...state,
        libraryShelves: state.libraryShelves.map((entry) =>
          entry.id === shelfId ? next : entry,
        ),
      });
    },
    setDefaultShelfAudience(key, audience) {
      initialize();
      if (
        !DEFAULT_SHELVES.some((shelf) => shelf.key === key) ||
        !choicesFor("shelves").includes(audience) ||
        defaultShelfAudience(state.settings, key) === audience
      )
        return false;
      return commit({
        ...state,
        settings: {
          ...state.settings,
          shelfAudiences: { ...state.settings.shelfAudiences, [key]: audience },
        },
      });
    },
    putAwayLibraryShelf(shelfId, away) {
      initialize();
      const shelf = state.libraryShelves.find((entry) => entry.id === shelfId);
      if (!shelf || (shelf.deletedAt !== null) === away) return false;
      const deletedAt = away ? now().toISOString() : null;
      return commit({
        ...state,
        libraryShelves: state.libraryShelves.map((entry) =>
          entry.id === shelfId ? { ...entry, deletedAt } : entry,
        ),
      });
    },
    setComposeIcon(icon) {
      initialize();
      if (!COMPOSE_ICONS.includes(icon) || state.settings.composeIcon === icon)
        return;
      commit({ ...state, settings: { ...state.settings, composeIcon: icon } });
    },
    recordReading(draft) {
      initialize();
      const record = cleanRecord(draft);
      if (!keepsWords() || !record) return null;
      const [bookId] = own([draft.bookId]);
      if (!state.books.some((book) => book.id === bookId)) return null;
      const entry: ReadingRecord = {
        id: nextId(
          "record",
          state.readingRecords.map((entry) => entry.id),
        ),
        readerId: ME_ID,
        bookId,
        ...record,
        createdAt: now().toISOString(),
      };
      const recorded = {
        ...state,
        readingRecords: [...state.readingRecords, entry],
      };
      const taken = commit(
        state.finishedBooks.includes(bookId)
          ? recorded
          : withLibraryOp(
              recorded,
              [bookId],
              { status: "finished" },
              entry.createdAt,
              "record",
            ),
      );
      return taken ? entry.id : null;
    },
    updateRecord(recordId, patch) {
      initialize();
      const current = state.readingRecords.find(
        (entry) => entry.id === recordId && entry.readerId === ME_ID,
      );
      const record = current && cleanRecord({ ...current, ...patch });
      if (!keepsWords() || !current || !record) return false;
      return commit({
        ...state,
        readingRecords: state.readingRecords.map((entry) =>
          entry.id === recordId ? { ...entry, ...record } : entry,
        ),
      });
    },
    deleteRecord(recordId) {
      initialize();
      if (
        !state.readingRecords.some(
          (entry) => entry.id === recordId && entry.readerId === ME_ID,
        )
      )
        return;
      commit({
        ...state,
        readingRecords: state.readingRecords.filter(
          (entry) => entry.id !== recordId,
        ),
      });
    },
    setVisibility(kind, choice, past = false) {
      initialize();
      if (
        !VISIBILITY_KINDS.includes(kind) ||
        !choicesFor(kind).includes(choice)
      )
        return;
      commit(withVisibility(state, kind, visibilityOf(choice), past));
    },
    setSpoilerDisplay(value) {
      initialize();
      if (
        !SPOILER_DISPLAYS.includes(value) ||
        state.settings.spoilerDisplay === value
      )
        return;
      commit({
        ...state,
        settings: { ...state.settings, spoilerDisplay: value },
      });
    },
    setTownMode(mode) {
      initialize();
      if (!TOWN_MODES.includes(mode) || state.settings.mode === mode) return;
      commit({ ...state, settings: { ...state.settings, mode } });
    },
    noteReport(report) {
      initialize();
      if (!report || typeof report.id !== "string") return;
      commit({
        ...state,
        myReports: [
          report,
          ...state.myReports.filter((entry) => entry.id !== report.id),
        ],
      });
    },
    savePoster(draft, posterId) {
      initialize();
      const pages = Array.isArray(draft.pages)
        ? draft.pages.map((page) =>
            Array.isArray(page?.bookIds)
              ? { ...page, bookIds: ownOnce(page.bookIds) }
              : page,
          )
        : draft.pages;
      const poster = cleanPosterDraft(
        { ...draft, pages },
        new Set(state.books.map((book) => book.id)),
      );
      if (!poster || (poster.status === "published" && posterProblem(poster)))
        return null;
      const at = now().toISOString();
      if (posterId !== undefined) {
        const current = state.posters.find(
          (entry) => entry.id === posterId && entry.authorId === ME_ID,
        );
        if (!current) return null;
        const next: Poster = {
          ...current,
          ...poster,
          // A draft put up is new on the board from then on.
          createdAt:
            current.status === "draft" && poster.status === "published"
              ? at
              : current.createdAt,
          updatedAt: at,
        };
        // Until the town has loaded, nothing is kept: the maker's work stays
        // with them rather than being thanked for and lost.
        return commit({
          ...state,
          posters: state.posters.map((entry) =>
            entry.id === posterId ? next : entry,
          ),
        })
          ? posterId
          : null;
      }
      const entry: Poster = {
        id: nextId(
          "poster",
          state.posters.map((entry) => entry.id),
        ),
        authorId: ME_ID,
        ...poster,
        createdAt: at,
        updatedAt: at,
      };
      return commit({ ...state, posters: [...state.posters, entry] })
        ? entry.id
        : null;
    },
    deletePoster(posterId) {
      initialize();
      if (
        !state.posters.some(
          (entry) => entry.id === posterId && entry.authorId === ME_ID,
        )
      )
        return false;
      return commit({
        ...state,
        // Taken down, it keeps no fold, nor a notice about one.
        reviewFolds: withoutFolds(
          state.reviewFolds,
          "poster",
          new Set([posterId]),
        ),
        posters: state.posters.filter((entry) => entry.id !== posterId),
      });
    },
    markNotificationsSeen(ids) {
      initialize();
      const fresh = ids.filter(
        (id) => typeof id === "string" && !state.seenNotifications.includes(id),
      );
      if (!fresh.length) return;
      commit({
        ...state,
        seenNotifications: [...state.seenNotifications, ...fresh].slice(-500),
      });
    },
    toggleSpoilerReport(postId) {
      initialize();
      const post = state.posts.find((entry) => entry.id === postId);
      if (!post || post.authorId === ME_ID || post.spoiler) return;
      commit({
        ...state,
        spoilerReports: toggled(state.spoilerReports, postId),
      });
    },
    markSpoiler(postId) {
      initialize();
      const post = state.posts.find((entry) => entry.id === postId);
      // A spoiler needs a book (or the post it answers) to wait behind.
      if (
        !post ||
        post.authorId !== ME_ID ||
        post.spoiler ||
        (post.bookId === null && post.parentId === null)
      )
        return;
      commit({
        ...state,
        posts: state.posts.map((entry) =>
          entry.id === postId ? { ...entry, spoiler: true } : entry,
        ),
      });
    },
  };

  // A visitor only looks: every change asks them to sign in instead.
  const gated = Object.fromEntries(
    (Object.keys(actions) as (keyof TownActions)[]).map((name) => [
      name,
      (...args: unknown[]) => {
        initialize();
        if (backend.kind === "account" && reachesSample(name, args)) {
          options.onSample?.();
          return refused(name);
        }
        if (
          backend.kind !== "visitor" &&
          needsName(state) &&
          reachesPeople(name, args, state)
        ) {
          // Nothing is done yet: it is done once the name is chosen. What a
          // sheet sends, the sheet sends again itself (askFirst).
          options.onNeedsName?.(() => {
            if (!WRITTEN.has(name))
              (gated[name] as (...a: unknown[]) => unknown)(...args);
          });
          return refused(name);
        }
        if (backend.kind !== "visitor")
          try {
            return (actions[name] as (...a: unknown[]) => unknown)(...args);
          } finally {
            // Copies of others' books given to an action not taken go.
            if (unowned && state === unowned.staged) state = unowned.before;
            unowned = null;
          }
        if (!QUIET_ACTIONS.has(name)) options.onVisitor?.();
        return refused(name);
      },
    ]),
  ) as unknown as TownActions;

  return {
    actions: gated,
    initialize,
    /** Moves the town to another backend, e.g. after signing in or out. */
    use: (next: TownBackend) => {
      initialized = true;
      start(next);
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    getBackendSnapshot: () => backend.kind,
    getServerBackendSnapshot: (): TownBackend["kind"] =>
      options.follow ? "account" : "local",
    getPersistenceSnapshot: () => status,
    /** The changes that last did not reach the database, or null. */
    getMissedSnapshot: () => missed,
    getServerPersistenceSnapshot: (): PersistenceStatus => "loading",
    /**
     * Whether a change made now is kept: the town has been read, and it is
     * the demo or the reader's own account.
     */
    getReadySnapshot: () =>
      !loading &&
      status !== "loading" &&
      (backend.kind === "local" || backend.kind === "account"),
    getServerReadySnapshot: () => false,
    /**
     * Counts the backends the town has used in this page. Changes waiting to
     * be written belong to one of them: a new one starts from what the
     * database has. What the old one had not written waits in the reader's
     * outbox (outbox.ts), sent once that reader's town is read again.
     */
    getGeneration: () => generation,
    /**
     * Counts the town's readings. A town read again (after a refused change)
     * has none of what was read after it: older 便り, one read by its id.
     */
    getReadCount: () => readCount,
    /**
     * What the town can read after it was read, from the backend it was
     * read from; null in the demo, and while the town is on its way.
     */
    reads(): TownReads | null {
      const { newer, older, post } = backend;
      if (loading || !newer || !older || !post) return null;
      return { generation, newer, older, post };
    },
    /**
     * Reads what a page shows that the town does not read with it
     * (TownBackend.more, town-more.ts), and keeps it by its ask for this
     * backend: asked again while it is on its way, the same reading is
     * waited on. Null in the demo, where the town holds everything, and
     * while the town is on its way.
     */
    more(ask: MoreAsk): Promise<void> | null {
      const read = backend.more;
      if (loading || !read) return null;
      const key = moreKey(ask);
      const waiting = asking.get(key);
      if (waiting) return waiting;
      const from = generation;
      const reading = read(ask).then((found) => {
        if (from !== generation) return;
        const next = new Map(kept);
        // Only the last few searches are kept: one is asked as each is typed.
        if ("search" in ask) {
          const searches = [...next.keys()].filter((at) =>
            at.startsWith("search:"),
          );
          for (const old of searches.slice(0, -SEARCHES_KEPT + 1))
            next.delete(old);
        }
        kept = next.set(key, found);
        notify();
      });
      const done = () => {
        if (asking.get(key) === reading) asking.delete(key);
      };
      reading.then(done, done);
      asking.set(key, reading);
      return reading;
    },
    /** What more() read for `key` (moreKey), if it has. */
    getMore: (key: string): TownMore | undefined => kept.get(key),
    /** Whether reads() has any: a build with the database, the town read. */
    getReadsSnapshot: () => !loading && Boolean(backend.newer),
    getServerReadsSnapshot: () => false,
    /**
     * Forgets the books of scan `batch` taken back and still out (AUD-055,
     * forget-books.ts): in the demo at once; in an account once what is
     * saved has them taken out, as the database answers (each with when it
     * was taken out, so one taken out again elsewhere since stays), taken
     * in as its own reading so nothing is written back. Not one a draft in
     * this browser names. The ids that went.
     */
    async forget(ids: string[], batch: string): Promise<string[]> {
      const from = generation;
      // Read only when a scan ends, so no page carries it for nothing.
      const { forgetIn } = await import("./forget-books");
      return forgetIn(
        {
          town: () => (loading || from !== generation ? null : state),
          backend,
          commit,
          settled: () => townSettled(this),
          take: (next) => {
            state = next;
            notify();
          },
        },
        ids,
        batch,
      );
    },
    /**
     * Takes in what was read after the town (arrived.ts) as the backend's
     * own reading, by the path a refused change comes back by: never
     * through `commit`, so nothing of it is saved. `from` is the generation
     * it was read in; a town since moved to another backend takes none.
     * Whether the town changed.
     */
    absorb(arrived: Arrived, from: number): boolean {
      if (loading || from !== generation || !backend.absorb) return false;
      // A 便り read before a block was saved still stays away.
      const next = backend.absorb((town, saved) =>
        withoutReaders(takeIn(town, arrived, saved), town.blocked),
      );
      if (!next || next === state) return false;
      state = next;
      notify();
      return true;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      initialize();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const townStore = createTownStore(
  localTownRepository,
  undefined,
  supabaseConfigured
    ? {
        follow: followAccount,
        onVisitor: requestAccount,
        onSample: refuseForSample,
        onNeedsName: askForName,
        onMissed: (lost) =>
          townMissedLine(lost, draftOwner(accountStore.getSnapshot())),
      }
    : { onNeedsName: askForName },
);
export const townActions = townStore.actions;
export const actions = townActions;
export const getTownSnapshot = townStore.getSnapshot;

export function useTownStore(): { state: TownState; actions: TownActions } {
  const town = useSyncExternalStore(
    townStore.subscribe,
    townStore.getSnapshot,
    townStore.getServerSnapshot,
  );
  return { state: useSpoilerLines(town), actions: townActions };
}

/**
 * The town with the series lines its marked spoilers are about (管理表 22 ①,
 * spoiler-range.ts): read with series_for_isbn as they come, kept by the
 * store like any page's reading (useMoreRead), and laid over the town only.
 * One that could not be read is asked again once, a little later. Where
 * nothing can be read (the demo, the town on its way), none are laid.
 */
function useSpoilerLines(town: TownState): TownState {
  const reads = useTownReads();
  const isbns = useMemo(() => rangedIsbns(town), [town]);
  const wanted = isbns.join(" ");
  // Which of them are read: changes as each comes.
  const came = useSyncExternalStore(
    townStore.subscribe,
    () =>
      isbns
        .map((isbn) => (townStore.getMore(moreKey({ series: isbn })) ? 1 : 0))
        .join(""),
    () => "",
  );
  useEffect(() => {
    if (!reads || !wanted) return;
    let live = true;
    const retries: ReturnType<typeof setTimeout>[] = [];
    const tryRead = (isbn: string, again: boolean) =>
      townStore.more({ series: isbn })?.catch(() => {
        if (live && again)
          retries.push(setTimeout(() => tryRead(isbn, false), 5000));
      });
    for (const isbn of wanted.split(" "))
      if (!townStore.getMore(moreKey({ series: isbn }))) tryRead(isbn, true);
    return () => {
      live = false;
      retries.forEach(clearTimeout);
    };
  }, [reads, wanted]);
  return useMemo(() => {
    if (!reads) return town;
    const lines: Record<string, SpoilerLine | null> = {};
    for (const isbn of isbns) {
      const read = townStore.getMore(moreKey({ series: isbn }));
      if (!read) continue;
      lines[isbn] =
        (read.series ?? [])
          .flatMap((series) => series.lines)
          .find((line) =>
            line.volumes.some((volume) => volume.isbn === isbn),
          ) ?? null;
    }
    return { ...town, spoilerLines: lines };
    // `came` tells when one more is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [town, isbns, came, reads]);
}

/** Where the town is saved: this browser ("local") or an account. */
export function useTownBackend(): TownBackend["kind"] {
  return useSyncExternalStore(
    townStore.subscribe,
    townStore.getBackendSnapshot,
    townStore.getServerBackendSnapshot,
  );
}

export function usePersistenceStatus(): PersistenceStatus {
  return useSyncExternalStore(
    townStore.subscribe,
    townStore.getPersistenceSnapshot,
    townStore.getServerPersistenceSnapshot,
  );
}

/**
 * Whether the account takes what the town holds now: true once it is all
 * saved, false when a change is turned away (the town then goes back to
 * what is saved) or the account cannot be reached.
 */
export function townSettled(store = townStore): Promise<boolean> {
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    const look = () => {
      const status = store.getPersistenceSnapshot();
      if (status === "loading" || status === "saving") return false;
      stop?.();
      resolve(status === "saved");
      return true;
    };
    if (!look()) stop = store.subscribe(look);
  });
}

/**
 * What last did not reach the database, with the line telling it, while the
 * town says so ("recovered"); null otherwise.
 */
export function useTownMissed(): TownMissed | null {
  const status = usePersistenceStatus();
  const missed = useSyncExternalStore(
    townStore.subscribe,
    townStore.getMissedSnapshot,
    () => null,
  );
  return status === "recovered" ? missed : null;
}

/**
 * Whether a change made now waits for the network: the account's town could
 * not be reached, or the browser knows it is offline. Asked before the
 * change, as the change itself sets the town saving.
 */
export function townOffline(store = townStore): boolean {
  return (
    store.getBackendSnapshot() === "account" &&
    (store.getPersistenceSnapshot() === "unavailable" ||
      (typeof navigator !== "undefined" && navigator.onLine === false))
  );
}

/** Whether the town can read 便り after it was read (not in the demo). */
export function useTownReads(): boolean {
  return useSyncExternalStore(
    townStore.subscribe,
    townStore.getReadsSnapshot,
    townStore.getServerReadsSnapshot,
  );
}

/**
 * The town with what this page shows that the town does not read with it
 * (town-more.ts): another reader's records and 人生の9冊 (`reader`), a
 * book's records (`work`), which feelings anyone kept (`felt`), the books
 * felt with a feeling (`feeling`). Read
 * when the page opens, each time it opens, and laid over the town; asked
 * again once, a little later, when it could not be read. `ready` is false
 * while it is on its way (the page may hold back what would look empty),
 * and in the demo, the town itself, ready.
 */
export function useTownMore(
  state: TownState,
  ask: MoreAsk | null,
): { state: TownState; ready: boolean } {
  const { read, ready } = useMoreRead(ask);
  const shown = useMemo(
    () => (read ? withMore(state, [read]) : state),
    [state, read],
  );
  return { state: shown, ready };
}

/**
 * What one ask brought (useTownMore), as it came, for a page that lays it
 * over the town itself (the books a search finds). Undefined while it is
 * on its way, and in the demo.
 */
export function useMoreRead(ask: MoreAsk | null): {
  read: TownMore | undefined;
  ready: boolean;
} {
  const reads = useTownReads();
  const key =
    ask && !("reader" in ask && ask.reader === ME_ID) ? moreKey(ask) : null;
  const read = useSyncExternalStore(
    townStore.subscribe,
    () => (key ? townStore.getMore(key) : undefined),
    () => undefined,
  );
  useEffect(() => {
    // By its key: a page draws a new ask each time.
    const ask = key && askOfKey(key);
    if (!reads || !ask) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const tryRead = (again: boolean) =>
      townStore.more(ask)?.catch(() => {
        if (live && again) retry = setTimeout(() => tryRead(false), 5000);
      });
    tryRead(true);
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
    };
  }, [reads, key]);
  return { read, ready: !reads || !key || read !== undefined };
}

/** Counts the town's readings (store.getReadCount). */
export function useTownReadCount(): number {
  return useSyncExternalStore(
    townStore.subscribe,
    townStore.getReadCount,
    () => 0,
  );
}

/** Whether a change made now is kept: the town is read, and it is the reader's own. */
export function useTownReady(): boolean {
  return useSyncExternalStore(
    townStore.subscribe,
    townStore.getReadySnapshot,
    townStore.getServerReadySnapshot,
  );
}

/** A town store as the scan journal sends to it (library-journal.ts). */
export function journalTownOf(
  store: ReturnType<typeof createTownStore>,
  owner: () => string | null,
): JournalTown {
  return {
    subscribe: store.subscribe,
    state: store.getSnapshot,
    status: store.getPersistenceSnapshot,
    ready: store.getReadySnapshot,
    generation: store.getGeneration,
    where: store.getBackendSnapshot,
    owner,
    register: (book, via, bookId, batchId) =>
      store.actions.registerBook(book, via, bookId, batchId),
    changeLibrary: (bookId, set) => {
      store.actions.changeLibrary([bookId], set);
    },
    forget: (bookIds, batch) => store.forget(bookIds, batch),
  };
}

export const journalTown = journalTownOf(townStore, () =>
  journalOwner(accountStore.getSnapshot(), townStore.getBackendSnapshot()),
);
