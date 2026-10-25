"use client";

import {
  createKeptDraftStore,
  keptText,
  type KeptDraftOptions,
  type KeptDraftStore,
} from "./kept-draft";
import { valueMark } from "./canonical";
import { DRAFT_OWNER } from "./draft-owner";
import { validateScene, type SceneKind, type StoreScene } from "./store-scene";
import {
  SHELF_NAME_MAX_LENGTH,
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  type PersistenceStatus,
} from "./types";

// The scene changed in 整える (order, POPs, the greeting, shelf labels,
// stamps) is kept in this browser until the account has it, so a change the
// account refuses is not lost. It is let go once the scene is saved, or when
// the reader throws it away.

export const SCENE_DRAFT_KEY = "book-town-scene-drafts-v1";

export type KeptScene = {
  scene: StoreScene;
  /** The mark of the saved scene the work began from (sceneMark). */
  from: string;
};

/**
 * Whose work it is: one shop of its owner (draftOwner), so two accounts on
 * one browser never see each other's work. Null, keeping nothing, while the
 * account is still being read.
 */
export const sceneWorkKey = (owner: string | null, shopId: string) =>
  owner === null ? null : owner + "/" + shopId;

/** The longest text each kind of object can hold, as the editor writes it. */
const TEXT_LIMITS: Partial<Record<SceneKind, number>> = {
  sign: SHOP_NAME_MAX_LENGTH,
  row: SHELF_NAME_MAX_LENGTH,
  // The greeting begins as the shop's description, longer than its field.
  ownerPop: Math.max(500, SHOP_DESCRIPTION_MAX_LENGTH),
  bookPop: 10000,
};
const STAMPS = ["", "plane", "coffee", "leaf"];
const MOST_OBJECTS = 2000;

/** Work read back from storage, if it is still a scene the editor makes. */
export function readKeptScene(value: unknown): KeptScene | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<KeptScene>;
  const scene = work.scene;
  if (
    typeof work.from !== "string" ||
    !work.from ||
    work.from.length > 40 ||
    !scene ||
    typeof scene !== "object" ||
    scene.ownerManaged !== true ||
    !Array.isArray(scene.objects) ||
    scene.objects.length > MOST_OBJECTS
  )
    return null;
  try {
    // Its books are checked against the town when it is saved: the town may
    // still be loading here.
    if (validateScene(scene).length) return null;
  } catch {
    return null;
  }
  for (const o of scene.objects) {
    if (
      (o.text !== undefined && !keptText(o.text, TEXT_LIMITS[o.kind] ?? 500)) ||
      (o.stamp !== undefined && !STAMPS.includes(o.stamp)) ||
      (o.kind === "book" && typeof o.bookId !== "string")
    )
      return null;
  }
  return { scene: structuredClone(scene), from: work.from };
}

export const sceneDraftOptions: KeptDraftOptions<KeptScene> = {
  storageKey: SCENE_DRAFT_KEY,
  keyPattern: new RegExp("^" + DRAFT_OWNER + "/[^/]+$"),
  read: readKeptScene,
  // A scene can be long; a few readers' shops are all one browser holds.
  limit: 4,
};

export const sceneDraftStore = createKeptDraftStore(sceneDraftOptions);

/**
 * A short mark of a saved scene. Work keeps the mark of the scene it began
 * from, so a scene saved since (on another device) is told apart. The mark
 * reads what the scene holds, not the order of its keys: the database hands
 * a scene back with its keys in an order of its own.
 */
export function sceneMark(scene: StoreScene | undefined): string {
  if (!scene) return "none";
  return valueMark({ ...scene, storeId: "" });
}

/**
 * How kept work stands against the scene saved now (by its mark): still to
 * be saved ("fresh"), begun before another scene was saved over it
 * ("stale"), or the very scene saved now ("saved", nothing left to keep).
 */
export function sceneWorkState(
  work: KeptScene,
  savedMark: string,
): "fresh" | "stale" | "saved" {
  if (sceneMark(work.scene) === savedMark) return "saved";
  return work.from === savedMark ? "fresh" : "stale";
}

/** The walk as far as a scene's save is heard from it (walk-store.ts). */
export interface SceneSaves {
  subscribe(listener: () => void): () => void;
  getSnapshot(): {
    kind: string;
    status: PersistenceStatus;
    scenes: StoreScene[];
  };
}

/**
 * An account takes a scene in the background, after the editor has closed.
 * The work stays kept until the account has the very scene sent, and is let
 * go then, whether the editor is open or not. A refusal brings the account's
 * own scene back and leaves the work kept, to go on with; work begun since
 * the save is never let go here.
 */
export function keepUntilSaved(
  store: KeptDraftStore<KeptScene>,
  key: string,
  sent: StoreScene,
  saves: SceneSaves,
) {
  const mark = sceneMark(sent);
  let settled = false;
  let stop = () => {};
  const settle = () => {
    if (settled) return;
    const now = saves.getSnapshot();
    // Still on its way, or waiting out network trouble.
    if (
      now.kind === "account" &&
      now.status !== "saved" &&
      now.status !== "recovered"
    )
      return;
    settled = true;
    stop();
    const held = now.scenes.find((scene) => scene.storeId === sent.storeId);
    const work = store.get(key);
    if (
      now.kind === "account" &&
      now.status === "saved" &&
      sceneMark(held) === mark &&
      work !== null &&
      sceneMark(work.scene) === mark
    )
      store.clear(key);
  };
  stop = saves.subscribe(settle);
  settle();
}
