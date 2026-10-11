"use client";
import { useEffect, useSyncExternalStore } from "react";
import { emptyWalk, type WalkState } from "./walk-state";
import { loadWalk, saveWalk } from "./walk-repository";
import type { StoreScene } from "./store-scene";
const initial = { state: emptyWalk(), ready: false, status: "loading" };
let snapshot = initial;
const listeners = new Set<() => void>();
let writable = true;
let retainedScenes: StoreScene[] = [];
function initialize() {
  if (snapshot.ready) return;
  const result = loadWalk();
  writable = result.status === "ready";
  retainedScenes = result.data.sceneOverrides;
  snapshot = {
    state: result.data.walkState,
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
    state: next,
    ready: true,
    status: writable
      ? saveWalk(next, retainedScenes)
        ? "saved"
        : "unavailable"
      : snapshot.status,
  };
  listeners.forEach((fn) => fn());
  return snapshot.status === "saved";
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
  return { ...data, update: updateWalk };
}
