import { emptyWalk, type WalkState } from "./walk-state";
import { sceneFromJson, sceneToJson, type StoreScene } from "./store-scene";
export const WALK_KEY = "book-town-walk-v1";
export interface WalkEnvelope {
  schemaVersion: 1;
  walkState: WalkState;
  sceneOverrides: StoreScene[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
export function decodeWalk(raw: string | null): {
  data: WalkEnvelope;
  status: "ready" | "recovered";
} {
  const fallback = {
    data: {
      schemaVersion: 1 as const,
      walkState: emptyWalk(),
      sceneOverrides: [],
    },
    status: "recovered" as const,
  };
  if (raw === null) return { ...fallback, status: "ready" };
  try {
    const value = JSON.parse(raw);
    if (
      !record(value) ||
      value.schemaVersion !== 1 ||
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
    if (s.session !== null) {
      const session = s.session;
      if (
        !record(session) ||
        !Array.isArray(session.ids) ||
        !session.ids.every((id) => typeof id === "string") ||
        new Set(session.ids).size !== session.ids.length ||
        !Number.isInteger(session.index) ||
        (session.index as number) < 0 ||
        (session.index as number) > session.ids.length ||
        typeof session.ended !== "boolean" ||
        session.ended !== ((session.index as number) === session.ids.length) ||
        !date(session.startedAt)
      )
        return fallback;
    }
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
    return {
      data: {
        schemaVersion: 1,
        walkState: s as unknown as WalkState,
        sceneOverrides: scenes,
      },
      status: "ready",
    };
  } catch {
    return fallback;
  }
}
export function encodeWalk(state: WalkState, scenes: StoreScene[] = []) {
  return JSON.stringify({
    schemaVersion: 1,
    walkState: state,
    sceneOverrides: scenes.map((s) => JSON.parse(sceneToJson(s))),
  });
}
export function loadWalk() {
  try {
    return decodeWalk(window.localStorage.getItem(WALK_KEY));
  } catch {
    return {
      data: {
        schemaVersion: 1 as const,
        walkState: emptyWalk(),
        sceneOverrides: [],
      },
      status: "unavailable" as const,
    };
  }
}
/** Corrupt or unknown data is retained; callers must not save over it. */
export function saveWalk(state: WalkState, scenes: StoreScene[] = []) {
  try {
    window.localStorage.setItem(WALK_KEY, encodeWalk(state, scenes));
    return true;
  } catch {
    return false;
  }
}
