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
    if (remaining.length) {
      const previous = state.session.ids[state.session.index];
      let index = remaining.indexOf(previous);
      if (index < 0) {
        const following = state.session.ids
          .slice(state.session.index)
          .find((id) => remaining.includes(id));
        index = following ? remaining.indexOf(following) : 0;
      }
      return {
        ...state,
        lastStoreId: remaining[index],
        session: { ...state.session, ids: remaining, index, ended: false },
      };
    }
  }
  // Shops not yet visited come first, then the ones visited longest ago.
  // The walk has no end: once every shop is visited, it simply goes round.
  const visitedAt = (id: string) => Date.parse(state.visits[id] ?? "") || 0;
  const ordered = restart
    ? ids
    : [...ids].sort((a, b) => visitedAt(a) - visitedAt(b));
  const ended = !ordered.length;
  return {
    ...state,
    lastStoreId: ended ? null : ordered[0],
    session: {
      ids: ordered,
      index: 0,
      ended,
      startedAt: now,
    },
  };
}
/** Past the last shop the walk goes round again; before the first it stays. */
export function stepWalk(state: WalkState, direction: -1 | 1): WalkState {
  const s = state.session;
  if (!s || !s.ids.length) return state;
  const next = s.index + direction;
  const index = next >= s.ids.length ? 0 : Math.max(0, next);
  return {
    ...state,
    lastStoreId: s.ids[index],
    session: { ...s, index, ended: false },
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
