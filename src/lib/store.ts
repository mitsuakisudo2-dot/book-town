"use client";

import { useSyncExternalStore } from "react";
import { seedState } from "./data";
import { localTownRepository, type TownRepository } from "./repository";
import {
  ME_ID,
  POP_REACTIONS,
  popReactionKey,
  OWN_SHOP_ID,
  displayCost,
  normalizeCapacity,
  shelfUsed,
  type BookDisplay,
  type PersistenceStatus,
  type Shelf,
  type Shop,
  type ShopTheme,
  type TownActions,
  type TownState,
} from "./types";

export { displayCost, shelfUsed } from "./types";

const themes: ShopTheme[] = ["sage", "ink", "ochre", "rose"];
const validDisplay = (display: BookDisplay): boolean =>
  display === "spine" || display === "face";
const clean = (value: string, max = 10000): string => value.slice(0, max);

export function createTownStore(
  repository: TownRepository = localTownRepository,
) {
  // This stable snapshot is used both by static rendering and the first hydration render.
  let state: TownState = seedState;
  let status: PersistenceStatus = "loading";
  let initialized = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function initialize() {
    if (initialized) return;
    initialized = true;
    const snapshot = repository.load();
    state = snapshot.state;
    status = snapshot.status;
    notify();
  }

  function commit(next: TownState) {
    if (next === state) return;
    state = next;
    status = repository.save(state);
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

  function nextId(prefix: string, ids: string[]): string {
    const max = ids.reduce((highest, id) => {
      if (!id.startsWith(prefix)) return highest;
      const suffix = Number(id.slice(prefix.length));
      return Number.isInteger(suffix) ? Math.max(highest, suffix) : highest;
    }, 0);
    return `${prefix}${max + 1}`;
  }

  const actions: TownActions = {
    createShop(name, description, theme) {
      initialize();
      if (state.ownShop || !name.trim() || !themes.includes(theme)) return;
      withShop({
        id: OWN_SHOP_ID,
        ownerId: ME_ID,
        name: clean(name.trim(), 120),
        description: clean(description),
        theme,
        tagline: "あなたの愛した一冊が、誰かの愛する一冊になる。",
        followers: 0,
        demo: false,
        shelves: [
          {
            id: "mine-shelf-1",
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
        name: clean(patch.name.trim(), 120),
        description: clean(patch.description),
        theme: patch.theme,
        tagline: clean(patch.tagline, 500),
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
              "mine-shelf-",
              shop.shelves.map((entry) => entry.id),
            ),
            name: clean(name.trim(), 120),
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
          ? { name: clean(patch.name.trim(), 120) }
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
    addShelfBook(shelfId, bookId, display) {
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
        "mine-item-",
        shop.shelves.flatMap((entry) => entry.items.map((item) => item.id)),
      );
      editShelf(shelfId, (entry) => ({
        ...entry,
        items: [...entry.items, { id, bookId, display, pop: "" }],
      }));
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
                entry.id === itemId ? { ...entry, pop: clean(pop) } : entry,
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
    updateProfile(name, bio) {
      initialize();
      if (!name.trim()) return;
      commit({
        ...state,
        me: { ...state.me, name: clean(name.trim(), 120), bio: clean(bio) },
      });
    },
    updateNine(ids, notes) {
      initialize();
      const validIds = [...new Set(ids)]
        .filter((id) => state.books.some((book) => book.id === id))
        .slice(0, 9);
      const validNotes = Object.fromEntries(
        validIds
          .filter((id) => typeof notes[id] === "string")
          .map((id) => [id, clean(notes[id], 1000)]),
      );
      commit({
        ...state,
        me: { ...state.me, lifeNine: validIds, nineNotes: validNotes },
      });
    },
  };

  return {
    actions,
    initialize,
    getSnapshot: () => state,
    getServerSnapshot: () => seedState,
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

export const townStore = createTownStore();
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

export function usePersistenceStatus(): PersistenceStatus {
  return useSyncExternalStore(
    townStore.subscribe,
    townStore.getPersistenceSnapshot,
    townStore.getServerPersistenceSnapshot,
  );
}
