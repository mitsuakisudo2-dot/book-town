export interface WalkSession {
  ids: string[];
  index: number;
  ended: boolean;
  startedAt: string;
}
export interface ShopReaction {
  liked: boolean;
  saved: boolean;
  message: string;
}
export interface WalkState {
  visits: Record<string, string>;
  lastStoreId: string | null;
  session: WalkSession | null;
  reactions: Record<string, ShopReaction>;
  placementReactions: Record<string, string[]>;
}
export const emptyWalk = (): WalkState => ({
  visits: {},
  lastStoreId: null,
  session: null,
  reactions: {},
  placementReactions: {},
});
export function startWalk(
  state: WalkState,
  ids: string[],
  specified?: string,
  now = new Date().toISOString(),
  restart = false,
): WalkState {
  ids = [...new Set(ids)];
  if (specified && ids.includes(specified))
    return {
      ...state,
      lastStoreId: specified,
      session: {
        ids,
        index: ids.indexOf(specified),
        ended: false,
        startedAt: now,
      },
    };
  if (!restart && state.session && !state.session.ended) {
    const remaining = state.session.ids.filter((id) => ids.includes(id));
    const previous = state.session.ids[state.session.index];
    let index = remaining.indexOf(previous);
    if (index < 0) {
      const following = state.session.ids
        .slice(state.session.index)
        .find((id) => remaining.includes(id));
      index = following ? remaining.indexOf(following) : remaining.length;
    }
    const ended = state.session.ended || index >= remaining.length;
    return {
      ...state,
      lastStoreId: ended ? null : remaining[index],
      session: { ...state.session, ids: remaining, index, ended },
    };
  }
  const unvisited = ids.filter((id) => !state.visits[id]);
  const ordered = restart
    ? ids
    : [...unvisited, ...ids.filter((id) => state.visits[id])];
  const ended = !ordered.length || (!restart && !unvisited.length);
  return {
    ...state,
    lastStoreId: ended ? null : ordered[0],
    session: {
      ids: ordered,
      index: ended ? ordered.length : 0,
      ended,
      startedAt: now,
    },
  };
}
export function stepWalk(state: WalkState, direction: -1 | 1): WalkState {
  const s = state.session;
  if (!s) return state;
  const index = Math.max(0, Math.min(s.ids.length, s.index + direction));
  return {
    ...state,
    lastStoreId: s.ids[index] ?? null,
    session: { ...s, index, ended: index === s.ids.length },
  };
}
export function visitStore(
  state: WalkState,
  id: string,
  now = new Date().toISOString(),
): WalkState {
  return { ...state, visits: { ...state.visits, [id]: now } };
}
export function clearVisits(state: WalkState): WalkState {
  return { ...state, visits: {}, lastStoreId: null, session: null };
}
export function qualifiedVisit(
  elapsed: number,
  visible: boolean,
  interacted: boolean,
) {
  return visible && (elapsed >= 3000 || interacted);
}
export function verticalSwipe(
  dx: number,
  dy: number,
  duration: number,
): -1 | 1 | null {
  return duration < 1400 &&
    Math.abs(dy) >= 56 &&
    Math.abs(dy) > Math.abs(dx) * 1.5
    ? dy < 0
      ? 1
      : -1
    : null;
}
