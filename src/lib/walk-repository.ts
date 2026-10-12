import { emptyWalk, type WalkSession, type WalkState } from "./walk-state";
import { sceneFromJson, sceneToJson, type StoreScene } from "./store-scene";
import { validShop } from "./repository";
import type { SceneBackup } from "./store-customization";
export const WALK_KEY = "book-town-walk-v1";
export interface WalkEnvelope {
  schemaVersion: 2;
  walkState: WalkState;
  sceneOverrides: StoreScene[];
  legacyBackups: SceneBackup[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function validSession(session: unknown): session is WalkSession {
  return (
    record(session) &&
    Array.isArray(session.ids) &&
    session.ids.every((id) => typeof id === "string") &&
    new Set(session.ids).size === session.ids.length &&
    Number.isInteger(session.index) &&
    (session.index as number) >= 0 &&
    (session.index as number) <= session.ids.length &&
    typeof session.ended === "boolean" &&
    session.ended === ((session.index as number) === session.ids.length) &&
    date(session.startedAt)
  );
}
export function decodeWalk(raw: string | null): {
  data: WalkEnvelope;
  status: "ready" | "recovered";
} {
  const fallback = {
    data: {
      schemaVersion: 2 as const,
      walkState: emptyWalk(),
      sceneOverrides: [],
      legacyBackups: [],
    },
    status: "recovered" as const,
  };
  if (raw === null) return { ...fallback, status: "ready" };
  try {
    const value = JSON.parse(raw);
    if (
      !record(value) ||
      ![1, 2].includes(value.schemaVersion as number) ||
      !record(value.walkState) ||
      !Array.isArray(value.sceneOverrides)
    )
      return fallback;
    const s = value.walkState;
    if (
      !record(s.visits) ||
      !Object.values(s.visits).every(date) ||
      !record(s.reactions) ||
      !record(s.placementReactions) ||
      (s.lastStoreId !== null && typeof s.lastStoreId !== "string")
    )
      return fallback;
    if (s.session !== null && !validSession(s.session)) return fallback;
    if (
      !Object.values(s.reactions).every(
        (r) =>
          record(r) &&
          typeof r.liked === "boolean" &&
          typeof r.saved === "boolean" &&
          typeof r.message === "string",
      )
    )
      return fallback;
    if (
      !Object.values(s.placementReactions).every(
        (r) =>
          Array.isArray(r) &&
          r.every((v) => ["like", "read", "love"].includes(v)),
      )
    )
      return fallback;
    const scenes = value.sceneOverrides.map((scene) =>
      sceneFromJson(JSON.stringify(scene)),
    );
    if (new Set(scenes.map((s) => s.storeId)).size !== scenes.length)
      return fallback;
    const backups = value.schemaVersion === 1 ? [] : value.legacyBackups;
    if (
      !Array.isArray(backups) ||
      !backups.every((b) => {
        if (
          !record(b) ||
          typeof b.storeId !== "string" ||
          !date(b.migratedAt) ||
          !record(b.shop) ||
          !Array.isArray(b.shop.shelves)
        )
          return false;
        const bookIds = new Set<string>();
        for (const shelf of b.shop.shelves) {
          if (!record(shelf) || !Array.isArray(shelf.items)) return false;
          for (const item of shelf.items) {
            if (!record(item) || typeof item.bookId !== "string") return false;
            bookIds.add(item.bookId);
          }
        }
        return validShop(b.shop, bookIds) && b.shop?.id === b.storeId;
      }) ||
      new Set(backups.map((b) => b.storeId)).size !== backups.length
    )
      return fallback;
    return {
      data: {
        schemaVersion: 2,
        walkState: s as unknown as WalkState,
        sceneOverrides: scenes,
        legacyBackups: backups as SceneBackup[],
      },
      status: "ready",
    };
  } catch {
    return fallback;
  }
}
export function encodeWalk(
  state: WalkState,
  scenes: StoreScene[] = [],
  backups: SceneBackup[] = [],
) {
  return JSON.stringify({
    schemaVersion: 2,
    walkState: state,
    sceneOverrides: scenes.map((s) => JSON.parse(sceneToJson(s))),
    legacyBackups: backups,
  });
}
export function loadWalk() {
  try {
    return decodeWalk(window.localStorage.getItem(WALK_KEY));
  } catch {
    return {
      data: {
        schemaVersion: 2 as const,
        walkState: emptyWalk(),
        sceneOverrides: [],
        legacyBackups: [],
      },
      status: "unavailable" as const,
    };
  }
}
/** Corrupt or unknown data is retained; callers must not save over it. */
export function saveWalk(
  state: WalkState,
  scenes: StoreScene[] = [],
  backups: SceneBackup[] = [],
) {
  try {
    window.localStorage.setItem(WALK_KEY, encodeWalk(state, scenes, backups));
    return true;
  } catch {
    return false;
  }
}

/**
 * With an account, the walk's records live in the database; only where this
 * device stopped walking stays here, per account.
 */
export const POSITION_KEY = "book-town-walk-position-v1:";
export type WalkPosition = Pick<WalkState, "lastStoreId" | "session">;
export const noPosition = (): WalkPosition => ({
  lastStoreId: null,
  session: null,
});
export function decodePosition(raw: string | null): WalkPosition {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !record(value) ||
      (value.lastStoreId !== null && typeof value.lastStoreId !== "string") ||
      (value.session !== null && !validSession(value.session))
    )
      return noPosition();
    return {
      lastStoreId: value.lastStoreId as string | null,
      session: value.session as WalkSession | null,
    };
  } catch {
    return noPosition();
  }
}
export function loadPosition(userId: string): WalkPosition {
  try {
    return decodePosition(window.localStorage.getItem(POSITION_KEY + userId));
  } catch {
    return noPosition();
  }
}
export function savePosition(userId: string, position: WalkPosition) {
  try {
    window.localStorage.setItem(
      POSITION_KEY + userId,
      JSON.stringify({
        lastStoreId: position.lastStoreId,
        session: position.session,
      }),
    );
  } catch {
    // Where the walk stopped is a convenience; losing it loses nothing else.
  }
}
