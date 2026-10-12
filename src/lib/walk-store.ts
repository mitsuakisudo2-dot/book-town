"use client";
import { useEffect, useSyncExternalStore } from "react";
import { emptyWalk, type WalkState } from "./walk-state";
import { loadWalk, saveWalk } from "./walk-repository";
import type { StoreScene } from "./store-scene";
import {
  importedPlacementReactions,
  validateOwnedScene,
  type SceneBackup,
} from "./store-customization";
import type { TownState } from "./types";
const initial = {
  state: emptyWalk(),
  scenes: [] as StoreScene[],
  backups: [] as SceneBackup[],
  ready: false,
  status: "loading",
};
let snapshot = initial;
const listeners = new Set<() => void>();
let writable = true;
function initialize() {
  if (snapshot.ready) return;
  const result = loadWalk();
  writable = result.status === "ready";
  snapshot = {
    state: result.data.walkState,
    scenes: result.data.sceneOverrides,
    backups: result.data.legacyBackups,
    ready: true,
    status: result.status,
  };
  listeners.forEach((fn) => fn());
}
export function updateWalk(update: (state: WalkState) => WalkState) {
  initialize();
  const next = update(snapshot.state);
  if (next === snapshot.state)
    return writable && snapshot.status !== "unavailable";
  snapshot = {
    ...snapshot,
    state: next,
    ready: true,
    status: writable
      ? saveWalk(next, snapshot.scenes, snapshot.backups)
        ? "saved"
        : "unavailable"
      : snapshot.status,
  };
  listeners.forEach((fn) => fn());
  return snapshot.status === "saved";
}
/** Drafts become visible only after an atomic localStorage write succeeds. */
export function saveOwnedScene(
  scene: StoreScene,
  town: TownState,
): { ok: boolean; error?: string } {
  initialize();
  if (!writable)
    return {
      ok: false,
      error:
        "保存データを読み込めないため、上書きできません。元のデータは保持しています。",
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
  const backups = snapshot.backups.some((b) => b.storeId === shop.id)
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
  const next = {
    ...snapshot.state,
    placementReactions: { ...imported, ...snapshot.state.placementReactions },
  };
  if (!saveWalk(next, scenes, backups))
    return {
      ok: false,
      error: "ブラウザに保存できません。編集内容はこの画面に残っています。",
    };
  snapshot = { state: next, scenes, backups, ready: true, status: "saved" };
  listeners.forEach((fn) => fn());
  return { ok: true };
}
export function useWalkStore() {
  const data = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => snapshot,
    () => initial,
  );
  useEffect(initialize, []);
  return { ...data, update: updateWalk, saveScene: saveOwnedScene };
}
