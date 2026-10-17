"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { WalkState } from "./walk-state";
import type { StoreScene } from "./store-scene";
import {
  importedPlacementReactions,
  validateOwnedScene,
} from "./store-customization";
import { supabaseConfigured } from "./supabase/config";
import {
  emptyWalkData,
  localWalkBackend,
  unavailableWalkBackend,
  type WalkBackend,
  type WalkData,
} from "./walk-backend";
import { followAccountWalk } from "./town-session";
import { requestAccount } from "./visitor";
import { refuseForSample } from "./sample-notice";
import { isSampleId } from "./record-kind";
import { parseScreenKey } from "./walk-remote";
import { OWN_SHOP_ID, type PersistenceStatus, type TownState } from "./types";

export interface WalkSnapshot extends WalkData {
  ready: boolean;
  status: PersistenceStatus;
  /** Where the walk is saved: this browser, or the person's account. */
  kind: WalkBackend["kind"];
}

export interface WalkStoreOptions {
  /** Picks the backend as the account changes, as the town store does. */
  follow?: (switchTo: (backend: WalkBackend) => void) => void;
  /** Called when a visitor who is not signed in tries to leave something. */
  onVisitor?: () => void;
  /** Called when a signed-in reader leaves something at a 見本's shop. */
  onSample?: () => void;
}

/** Keys whose values differ between two records. */
const changedKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => a[key] !== b[key],
  );

/** Whether a change leaves a like, a word or a reaction at a 見本's shop. */
function reachesSample(before: WalkState, after: WalkState) {
  const shops = [
    ...changedKeys(before.reactions, after.reactions),
    ...changedKeys(before.placementReactions, after.placementReactions).map(
      (key) => parseScreenKey(key)?.[0] ?? OWN_SHOP_ID,
    ),
  ];
  return shops.some(isSampleId);
}

export function createWalkStore(
  source: WalkBackend = localWalkBackend(),
  options: WalkStoreOptions = {},
) {
  const initial: WalkSnapshot = {
    ...emptyWalkData(),
    ready: false,
    status: "loading",
    kind: source.kind,
  };
  let backend = source;
  let snapshot = initial;
  let initialized = false;
  let generation = 0;
  let unwatch: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  const set = (patch: Partial<WalkSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    notify();
  };

  function start(next: WalkBackend) {
    const mine = ++generation;
    const previous = backend;
    unwatch?.();
    backend = next;
    if (previous !== next) previous.close?.();
    const current = () => mine === generation;
    unwatch =
      next.watch?.({
        status(status) {
          if (current()) set({ status });
        },
        replace(data, status) {
          if (current()) set({ ...data, status });
        },
      }) ?? null;
    const result = next.load();
    if ("then" in result) {
      set({
        ...emptyWalkData(),
        ready: false,
        status: "loading",
        kind: next.kind,
      });
      result.then(
        (loaded) => {
          if (current())
            set({ ...loaded.data, ready: true, status: loaded.status });
        },
        () => {
          // The account could not be read: show that, and save nothing.
          if (current()) start(unavailableWalkBackend());
        },
      );
      return;
    }
    set({
      ...result.data,
      ready: true,
      status: result.status,
      kind: next.kind,
    });
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    if (options.follow) options.follow(start);
    else start(backend);
  }

  const data = (): WalkData => ({
    state: snapshot.state,
    scenes: snapshot.scenes,
    backups: snapshot.backups,
  });

  /** Returns whether the change is saved, or on its way to the account. */
  function update(change: (state: WalkState) => WalkState) {
    initialize();
    if (!snapshot.ready) return false;
    const next = change(snapshot.state);
    // A visitor walks freely, but likes, saves and words need an account.
    if (
      backend.kind === "visitor" &&
      (next.reactions !== snapshot.state.reactions ||
        next.placementReactions !== snapshot.state.placementReactions)
    ) {
      options.onVisitor?.();
      return false;
    }
    // Nobody is behind a 見本's shop to receive what is left there.
    if (backend.kind === "account" && reachesSample(snapshot.state, next)) {
      options.onSample?.();
      return false;
    }
    if (next !== snapshot.state) {
      const status = backend.save({ ...data(), state: next });
      set({ state: next, status });
    }
    return backend.writable() && snapshot.status !== "unavailable";
  }

  /**
   * Saves the person's own store scene. In this browser the scene is adopted
   * only after it is written; with an account it is saved in the background.
   */
  function saveScene(
    scene: StoreScene,
    town: TownState,
  ): { ok: boolean; error?: string } {
    initialize();
    if (backend.kind === "visitor") {
      options.onVisitor?.();
      return { ok: false, error: "店内を飾るには、ログインしてください。" };
    }
    if (!snapshot.ready || !backend.writable())
      return {
        ok: false,
        error:
          backend.kind === "local"
            ? "保存データを読み込めないため、上書きできません。元のデータは保持しています。"
            : "保存先を読み込めていないため、まだ保存できません。",
      };
    const shop = town.ownShop;
    if (!shop || shop.ownerId !== town.me.id || shop.demo)
      return { ok: false, error: "編集できるのは自分の書店だけです。" };
    const errors = validateOwnedScene(scene, shop, town.books);
    if (errors.length)
      return { ok: false, error: "配置を保存できません: " + errors[0] };
    const scenes = [
      ...snapshot.scenes.filter((s) => s.storeId !== shop.id),
      structuredClone(scene),
    ];
    // The demo keeps a copy of the shop as it was before its first scene.
    const backups =
      backend.kind !== "local" ||
      snapshot.backups.some((b) => b.storeId === shop.id)
        ? snapshot.backups
        : [
            ...snapshot.backups,
            {
              storeId: shop.id,
              shop: structuredClone(shop),
              migratedAt: new Date().toISOString(),
            },
          ];
    const imported = importedPlacementReactions(scene, town);
    const state = {
      ...snapshot.state,
      placementReactions: { ...imported, ...snapshot.state.placementReactions },
    };
    const status = backend.save({ state, scenes, backups });
    if (backend.kind === "local" && status !== "saved")
      return {
        ok: false,
        error: "ブラウザに保存できません。編集内容はこの画面に残っています。",
      };
    set({ state, scenes, backups, status });
    return { ok: true };
  }

  return {
    update,
    saveScene,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    initialize,
  };
}

export const walkStore = createWalkStore(
  localWalkBackend(),
  supabaseConfigured
    ? {
        follow: followAccountWalk,
        onVisitor: requestAccount,
        onSample: refuseForSample,
      }
    : {},
);

export const updateWalk = walkStore.update;
export const saveOwnedScene = walkStore.saveScene;

export function useWalkStore() {
  const data = useSyncExternalStore(
    walkStore.subscribe,
    walkStore.getSnapshot,
    walkStore.getServerSnapshot,
  );
  useEffect(() => walkStore.initialize(), []);
  return { ...data, update: updateWalk, saveScene: saveOwnedScene };
}
