"use client";

import { useSyncExternalStore } from "react";
import { seedState } from "./data";
import { localTownRepository, type TownRepository } from "./repository";
import {
  localBackend,
  unavailableBackend,
  type RecordKind,
  type TownBackend,
} from "./town-backend";
import { emptyTown } from "./town-remote";
import { supabaseConfigured } from "./supabase/config";
import { followAccount } from "./town-session";
import { requestAccount } from "./visitor";
import { createRegisteredBook, normalizeIsbn } from "./books";
import { cleanLinks } from "./links";
import { cleanRecord } from "./records";
import { handleProblem, normalizeHandle } from "./handles";
import {
  COMPOSE_ICONS,
  ME_ID,
  POP_REACTIONS,
  POST_MAX_LENGTH,
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
  OWN_SHOP_ID,
  displayCost,
  normalizeCapacity,
  shelfUsed,
  type BookDisplay,
  type PersistenceStatus,
  type Post,
  type ReadingRecord,
  type ReadingSession,
  type Shelf,
  type Shop,
  type ShopTheme,
  type TownActions,
  type TownState,
} from "./types";

/** The shelf every new shop opens with. */
export const FIRST_SHELF_ID = "mine-shelf-1";
export { displayCost, shelfUsed } from "./types";

const themes: ShopTheme[] = ["sage", "ink", "ochre", "rose"];
const validDisplay = (display: BookDisplay): boolean =>
  display === "spine" || display === "face";
const clean = (value: string, max = 10000): string => value.slice(0, max);

const toggled = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

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
}

/** Actions a visitor's page runs by itself, which need no invitation. */
const QUIET_ACTIONS = new Set<keyof TownActions>(["markNotificationsSeen"]);
/** Actions that answer whether they did anything. */
const ANSWERING_ACTIONS = new Set<keyof TownActions>([
  "addShelfBook",
  "changeDisplay",
]);

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
  let loading = false;
  let generation = 0;
  let unwatch: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function start(next: TownBackend) {
    const mine = ++generation;
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
        replace(update, updateStatus) {
          if (!current()) return;
          state = update;
          status = updateStatus;
          notify();
        },
      }) ?? null;
    const result = next.load();
    if ("then" in result) {
      loading = true;
      state = emptyTown();
      status = "loading";
      notify();
      result.then(
        (snapshot) => {
          if (!current()) return;
          loading = false;
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

  function commit(next: TownState) {
    if (next === state || loading) return;
    state = next;
    status = backend.save(state);
    notify();
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
            name: "はじめの本棚",
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
    addShelfBook(shelfId, bookId, display, restore) {
      initialize();
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
    toggleWish(bookId) {
      initialize();
      if (!state.books.some((book) => book.id === bookId)) return;
      commit({
        ...state,
        wishlist: state.wishlist.includes(bookId)
          ? state.wishlist.filter((id) => id !== bookId)
          : [...state.wishlist, bookId],
      });
    },
    toggleFavorite(bookId) {
      initialize();
      if (!state.books.some((book) => book.id === bookId)) return;
      commit({
        ...state,
        favorites: state.favorites.includes(bookId)
          ? state.favorites.filter((id) => id !== bookId)
          : [...state.favorites, bookId],
      });
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
      const next = current.includes(reaction)
        ? current.filter((entry) => entry !== reaction)
        : [...current, reaction];
      const popReactions = { ...state.popReactions };
      if (next.length) popReactions[key] = next;
      else delete popReactions[key];
      commit({ ...state, popReactions });
    },
    updateProfile(name, bio, links, handle) {
      initialize();
      if (!name.trim()) return false;
      const nextHandle =
        handle === undefined ? state.me.handle : normalizeHandle(handle);
      if (handleProblem(nextHandle, state.readers)) return false;
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
    updateNine(ids, notes) {
      initialize();
      const validIds = [...new Set(ids)]
        .filter((id) => state.books.some((book) => book.id === id))
        .slice(0, 9);
      const validNotes = Object.fromEntries(
        validIds
          .filter((id) => typeof notes[id] === "string")
          .map((id) => [id, clean(notes[id], NINE_NOTE_MAX_LENGTH)]),
      );
      commit({
        ...state,
        me: { ...state.me, lifeNine: validIds, nineNotes: validNotes },
      });
    },
    createPost(draft) {
      initialize();
      const body = draft.body.trim();
      const session = draft.fromReading
        ? state.readingSessions.find((entry) => entry.endedAt === null)
        : undefined;
      if (draft.fromReading && !session) return null;
      // A reading memo belongs to the running session's book and never starts a thread reply.
      const bookId = session ? session.bookId : (draft.bookId ?? null);
      const parentId = session ? null : (draft.parentId ?? null);
      const spoiler = draft.spoiler === true;
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
        parentId,
        createdAt: now().toISOString(),
        likes: 0,
        wants: 0,
        readingMode: session ? session.mode : null,
      };
      commit({ ...state, posts: [...state.posts, post] });
      return post.id;
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
        posts: state.posts.filter((entry) => keep(entry.id)),
        likedPosts: state.likedPosts.filter(keep),
        wantedPosts: state.wantedPosts.filter(keep),
        spoilerReports: state.spoilerReports.filter(keep),
      });
    },
    toggleLike(postId) {
      initialize();
      if (!state.posts.some((entry) => entry.id === postId)) return;
      commit({ ...state, likedPosts: toggled(state.likedPosts, postId) });
    },
    toggleWant(postId) {
      initialize();
      const post = state.posts.find((entry) => entry.id === postId);
      if (!post?.bookId || post.authorId === ME_ID) return;
      const adding = !state.wantedPosts.includes(postId);
      commit({
        ...state,
        wantedPosts: toggled(state.wantedPosts, postId),
        // Wanting a book saves it; taking the reaction back keeps the list as the reader left it.
        wishlist:
          adding && !state.wishlist.includes(post.bookId)
            ? [...state.wishlist, post.bookId]
            : state.wishlist,
      });
    },
    startReading(bookId, mode) {
      initialize();
      if (
        (bookId !== null && !state.books.some((book) => book.id === bookId)) ||
        !READING_MODES.includes(mode)
      )
        return null;
      const time = now().toISOString();
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
      commit({
        ...state,
        readingSessions: [
          // Starting a new book closes whatever was running.
          ...state.readingSessions.map((entry) =>
            entry.endedAt === null ? { ...entry, endedAt: time } : entry,
          ),
          session,
        ],
        // Opening a finished book again is a reread.
        finishedBooks: state.finishedBooks.filter((id) => id !== bookId),
      });
      return session.id;
    },
    endReading(finished) {
      initialize();
      const active = state.readingSessions.find(
        (entry) => entry.endedAt === null,
      );
      if (!active) return;
      const time = now().toISOString();
      commit({
        ...state,
        readingSessions: state.readingSessions.map((entry) =>
          entry.id === active.id ? { ...entry, endedAt: time } : entry,
        ),
        finishedBooks:
          finished &&
          active.bookId !== null &&
          !state.finishedBooks.includes(active.bookId)
            ? [...state.finishedBooks, active.bookId]
            : state.finishedBooks,
      });
    },
    addBook(input) {
      initialize();
      const title = input.title.trim();
      const author = input.author.trim();
      const isbn = input.isbn ? normalizeIsbn(input.isbn) : null;
      if (!title || title.length > 200 || author.length > 200) return null;
      if (input.isbn && !isbn) return null;
      const existing = isbn
        ? state.books.find((book) => book.isbn === isbn)
        : undefined;
      if (existing) {
        if (!state.library.includes(existing.id))
          commit({ ...state, library: [...state.library, existing.id] });
        return existing.id;
      }
      const id = nextId(
        "book",
        state.books.map((book) => book.id),
        isbn,
      );
      const price =
        typeof input.price === "number" &&
        Number.isInteger(input.price) &&
        input.price > 0 &&
        input.price <= 1_000_000
          ? input.price
          : undefined;
      const book = createRegisteredBook(id, {
        title,
        author,
        ...(isbn ? { isbn } : {}),
        ...(price ? { price } : {}),
      });
      commit({
        ...state,
        books: [...state.books, book],
        library: [...state.library, id],
      });
      return id;
    },
    toggleLibrary(bookId) {
      initialize();
      if (!state.books.some((book) => book.id === bookId)) return;
      commit({ ...state, library: toggled(state.library, bookId) });
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
      if (!record || !state.books.some((book) => book.id === draft.bookId))
        return null;
      const entry: ReadingRecord = {
        id: nextId(
          "record",
          state.readingRecords.map((entry) => entry.id),
        ),
        readerId: ME_ID,
        bookId: draft.bookId,
        ...record,
        createdAt: now().toISOString(),
      };
      commit({
        ...state,
        readingRecords: [...state.readingRecords, entry],
        finishedBooks: state.finishedBooks.includes(draft.bookId)
          ? state.finishedBooks
          : [...state.finishedBooks, draft.bookId],
      });
      return entry.id;
    },
    updateRecord(recordId, patch) {
      initialize();
      const current = state.readingRecords.find(
        (entry) => entry.id === recordId && entry.readerId === ME_ID,
      );
      const record = current && cleanRecord({ ...current, ...patch });
      if (!current || !record) return;
      commit({
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
    setReadingPublic(value) {
      initialize();
      if (state.settings.readingPublic === value) return;
      commit({
        ...state,
        settings: { ...state.settings, readingPublic: value === true },
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
        if (backend.kind !== "visitor")
          return (actions[name] as (...a: unknown[]) => unknown)(...args);
        if (!QUIET_ACTIONS.has(name)) options.onVisitor?.();
        return ANSWERING_ACTIONS.has(name) ? false : null;
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
    getServerPersistenceSnapshot: (): PersistenceStatus => "loading",
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
    ? { follow: followAccount, onVisitor: requestAccount }
    : {},
);
export const townActions = townStore.actions;
export const actions = townActions;
export const getTownSnapshot = townStore.getSnapshot;

export function useTownStore(): { state: TownState; actions: TownActions } {
  const state = useSyncExternalStore(
    townStore.subscribe,
    townStore.getSnapshot,
    townStore.getServerSnapshot,
  );
  return { state, actions: townActions };
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
