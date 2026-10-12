import type { SceneBackup } from "./store-customization";
import type { StoreScene } from "./store-scene";
import type { PersistenceStatus } from "./types";
import { loadWalk, saveWalk } from "./walk-repository";
import { emptyWalk, type WalkState } from "./walk-state";

/** Everything the bookshop walk keeps: the walk itself and the store scenes. */
export interface WalkData {
  state: WalkState;
  /** The person's own scene (the whole of it) and others' public scenes. */
  scenes: StoreScene[];
  /** The demo's copies of a shop from before its scene was first saved. */
  backups: SceneBackup[];
}

export const emptyWalkData = (): WalkData => ({
  state: emptyWalk(),
  scenes: [],
  backups: [],
});

export interface WalkSnapshot {
  data: WalkData;
  status: PersistenceStatus;
}

export interface WalkBackendListener {
  status(status: PersistenceStatus): void;
  /** The walk as it really is, after the database refused a change. */
  replace(data: WalkData, status: PersistenceStatus): void;
}

/** What the walk saves through: this browser, or the person's account. */
export interface WalkBackend {
  readonly kind: "local" | "account" | "unavailable";
  load(): WalkSnapshot | Promise<WalkSnapshot>;
  /** Called after every change with the whole walk. */
  save(data: WalkData): PersistenceStatus;
  /** False while saving would overwrite data that could not be read. */
  writable(): boolean;
  watch?(listener: WalkBackendListener): () => void;
  close?(): void;
}

/** The demo: everything stays in this browser. */
export function localWalkBackend(): WalkBackend {
  let writable = true;
  let status: PersistenceStatus = "loading";
  return {
    kind: "local",
    load() {
      const result = loadWalk();
      // Corrupt or unknown data is kept; nothing is saved over it.
      writable = result.status === "ready";
      status = result.status === "ready" ? "saved" : result.status;
      return {
        data: {
          state: result.data.walkState,
          scenes: result.data.sceneOverrides,
          backups: result.data.legacyBackups,
        },
        status,
      };
    },
    save(data) {
      if (!writable) return status;
      status = saveWalk(data.state, data.scenes, data.backups)
        ? "saved"
        : "unavailable";
      return status;
    },
    writable: () => writable,
  };
}

/** Signed in, but the account could not be read: nothing to show or save. */
export function unavailableWalkBackend(): WalkBackend {
  return {
    kind: "unavailable",
    load: () => ({ data: emptyWalkData(), status: "unavailable" }),
    save: () => "unavailable",
    writable: () => false,
  };
}
