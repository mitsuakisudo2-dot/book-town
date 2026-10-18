import type { SceneBackup } from "./store-customization";
import type { StoreScene } from "./store-scene";
import type { Missed } from "./supabase/sync";
import type { PersistenceStatus } from "./types";
import type { WalkWrite } from "./walk-remote";
import { loadWalk, saveWalk } from "./walk-repository";
import { emptyWalk, type WalkState } from "./walk-state";

/** Everything the bookshop walk keeps: the walk itself and the store scenes. */
export interface WalkData {
  state: WalkState;
  /** The person's own scene (the whole of it) and others' public scenes. */
  scenes: StoreScene[];
  /** The demo's copies of a shop from before its scene was first saved. */
  backups: SceneBackup[];
  /**
   * Others' shops with a public scene that is not in `scenes`: it is read
   * when the shop is walked to (walk-store's `need`, AUD-006). Absent where
   * every scene is at hand (the demo).
   */
  elsewhere?: string[];
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
  /**
   * The walk as the database holds it, read again after a change was
   * refused ("recovered", with the changes that did not reach it) or after
   * changes kept on the device were sent (supabase/sync.ts).
   */
  replace(
    data: WalkData,
    status: PersistenceStatus,
    missed?: Missed<WalkWrite>,
  ): void;
}

/** What the walk saves through: this browser, or the person's account. */
export interface WalkBackend {
  readonly kind: "local" | "account" | "visitor" | "unavailable";
  load(): WalkSnapshot | Promise<WalkSnapshot>;
  /** Called after every change with the whole walk. */
  save(data: WalkData): PersistenceStatus;
  /** False while saving would overwrite data that could not be read. */
  writable(): boolean;
  /**
   * The public scenes of the shops `ids` (each of `elsewhere`), by shop:
   * null for one with none, or one not well formed.
   */
  scenes?(ids: string[]): Promise<Map<string, StoreScene | null>>;
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
