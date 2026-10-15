import { mergeArrived, takeIn, type Arrived } from "./arrived";
import { followedLetters, homeLetters, type LetterEntry } from "./home-feed";
import type { HomeTab } from "./home-tab";
import type { TownReads } from "./town-backend";
import { ME_ID, type TownState } from "./types";

// New 便り arriving while Home is open (PR 2; 決定 H:56-57, H:120-123). They
// wait here, outside the town, until the reader asks for them: a tap on the
// pill 「新しい便り」, on the tab shown, or a pull at the top. Nothing is put
// above what the reader is reading without that.
//
// Polling runs every minute while a Home pane shows and the page is in
// view, and at once when the page comes back into view, the network comes
// back or the page is shown again from the browser's back cache. It waits
// longer after each failure. The demo has nothing to poll.

/** Between two reads while Home shows. */
export const POLL_EVERY = 60_000;
/** The longest wait after failures, which double it from POLL_EVERY. */
export const BACKOFF_MAX = 10 * 60_000;
/** A nudge (the page in view again) this soon after a read waits its turn. */
export const NUDGE_GAP = 10_000;
/** How long the pill shows, added up over its showings, before it retires. */
export const PILL_BUDGET = 8_000;

/** The town as arrivals see it: the store, or a stand-in in a test. */
export interface ArrivalsTown {
  reads(): TownReads | null;
  state(): TownState;
  absorb(arrived: Arrived, generation: number): boolean;
  subscribe(listener: () => void): () => void;
}

/** The time and timers, which a test drives by hand. */
export interface ArrivalsClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: ArrivalsClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ArrivalsSnapshot {
  /** What came and is not in the town yet; null when nothing is waiting. */
  arrived: Arrived | null;
  /** The pill used its time: a small dot by the tab says it instead. */
  retired: boolean;
}

/** How a read asked for by the reader (a pull) went. */
export interface Refreshed {
  /** The read failed (the network): only what had come before is taken. */
  failed: boolean;
  /** What was taken into the town, if anything. */
  taken: Arrived | null;
}

/**
 * Only what the town does not have yet. Never the reader's own: those are
 * written here (or come with the town's next reading), and one removed here
 * may still be in the database a moment.
 */
export function unseen(arrived: Arrived, state: TownState): Arrived {
  const have = new Set(state.posts.map((post) => post.id));
  return {
    ...arrived,
    posts: arrived.posts.filter(
      (post) => !have.has(post.id) && post.authorId !== ME_ID,
    ),
  };
}

/**
 * Where the next read starts: the newest time of others' posts known (the
 * database's times; the reader's own carry this device's until read again).
 * Null for a town with none: the newest, whatever they are.
 */
export function sinceOf(
  state: TownState,
  arrived: Arrived | null,
): string | null {
  let since: string | null = null;
  let newest = -Infinity;
  for (const post of [...state.posts, ...(arrived?.posts ?? [])]) {
    const at = Date.parse(post.createdAt);
    if (post.authorId === ME_ID || !(at > newest)) continue;
    newest = at;
    since = post.createdAt;
  }
  return since;
}

/**
 * The new 便り each pane would show at its top once taken in: on ホーム, as
 * homeLetters would place them (followed, or among 「街の便り」 on a quiet
 * home); on 便りだけ, the followed ones. Replies and the reader's own are not
 * new 便り. The pill and the dot are for these only.
 */
export function freshFor(
  state: TownState,
  arrived: Arrived | null,
  now: number,
): Record<HomeTab, LetterEntry[]> {
  if (!arrived) return { home: [], letters: [] };
  const fresh = unseen(arrived, state);
  const ids = new Set(
    fresh.posts.filter((post) => post.parentId === null).map((post) => post.id),
  );
  if (!ids.size) return { home: [], letters: [] };
  const town = takeIn(state, fresh);
  const { followed, town: others } = homeLetters(town, now);
  return {
    home: [...followed, ...others].filter((entry) => ids.has(entry.id)),
    letters: followedLetters(town).filter((entry) => ids.has(entry.id)),
  };
}

/**
 * The 便り that arrive while Home is open, kept outside the town until the
 * reader asks for them, and the pill's eight seconds.
 */
export function createArrivals(
  town: ArrivalsTown,
  options: { clock?: ArrivalsClock; visible?: () => boolean } = {},
) {
  const clock = options.clock ?? realClock;
  const visible =
    options.visible ??
    (() =>
      typeof document === "undefined" ||
      document.visibilityState === "visible");
  let snapshot: ArrivalsSnapshot = { arrived: null, retired: false };
  /** The generation of the town what is waiting was read for. */
  let generation: number | null = null;
  let watchers = 0;
  let unsubscribe: (() => void) | null = null;
  let timer: unknown = null;
  let failures = 0;
  let lastRead = -Infinity;
  let reading: Promise<boolean | "failed"> | null = null;
  // The pill: wanted on screen by Home, the time it has shown, and since when.
  let showing = false;
  let used = 0;
  let countingSince: number | null = null;
  let budget: unknown = null;
  const listeners = new Set<() => void>();
  const emit = (next: ArrivalsSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  function stopTimer() {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    if (timer !== null || reading || !watchers || !visible() || !town.reads())
      return;
    const wait = failures
      ? Math.min(POLL_EVERY * 2 ** failures, BACKOFF_MAX)
      : POLL_EVERY;
    timer = clock.setTimeout(() => {
      timer = null;
      // Out of view by now (a nudge stops the timer, but not every browser
      // nudges): the next one in view reads.
      if (visible()) void read();
    }, wait);
  }

  function stopCounting() {
    if (countingSince === null) return;
    used += clock.now() - countingSince;
    countingSince = null;
    clock.clearTimeout(budget);
    budget = null;
  }
  /** The pill's time counts while it is wanted, the page is seen, and it has time. */
  function count() {
    const on = showing && visible() && !snapshot.retired && !!snapshot.arrived;
    if (!on) return stopCounting();
    if (countingSince !== null) return;
    countingSince = clock.now();
    budget = clock.setTimeout(
      () => {
        budget = null;
        countingSince = null;
        used = PILL_BUDGET;
        emit({ ...snapshot, retired: true });
      },
      Math.max(0, PILL_BUDGET - used),
    );
  }
  function resetPill() {
    stopCounting();
    used = 0;
  }
  /** What waits is for another town (a sign-in or sign-out): let it go. */
  function forget(next: number | null) {
    generation = next;
    resetPill();
    if (snapshot.arrived || snapshot.retired)
      emit({ arrived: null, retired: false });
  }

  /**
   * Reads what came since the newest 便り known, and keeps what the town
   * does not have. Whether anything new came, or "failed".
   */
  function read(): Promise<boolean | "failed"> {
    if (reading) return reading;
    const reads = town.reads();
    if (!reads) return Promise.resolve(false);
    stopTimer();
    if (generation !== reads.generation) forget(reads.generation);
    const asked = reads.newer(sinceOf(town.state(), snapshot.arrived));
    const done = (outcome: boolean | "failed") => {
      reading = null;
      lastRead = clock.now();
      schedule();
      return outcome;
    };
    reading = asked.then(
      (arrived) => {
        failures = 0;
        if (town.reads()?.generation !== reads.generation) return done(false);
        const state = town.state();
        const fresh = unseen(arrived, state);
        if (!fresh.posts.length) return done(false);
        const known = new Set(
          snapshot.arrived?.posts.map((post) => post.id) ?? [],
        );
        if (fresh.posts.every((post) => known.has(post.id))) return done(false);
        emit({
          ...snapshot,
          arrived: unseen(
            snapshot.arrived ? mergeArrived(snapshot.arrived, fresh) : fresh,
            state,
          ),
        });
        count();
        return done(true);
      },
      () => {
        failures += 1;
        return done("failed");
      },
    );
    return reading;
  }

  /** Takes what waits into the town: the reader asked for it. */
  function take(): Arrived | null {
    const arrived = snapshot.arrived;
    const from = generation;
    resetPill();
    if (snapshot.arrived || snapshot.retired)
      emit({ arrived: null, retired: false });
    if (!arrived || from === null || !town.absorb(arrived, from)) return null;
    return arrived;
  }

  function onTown() {
    const reads = town.reads();
    if (reads && generation !== null && reads.generation !== generation)
      forget(reads.generation);
    schedule();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: (): ArrivalsSnapshot => snapshot,
    /** A Home pane shows: polls while one does. Returns the stop. */
    watch(): () => void {
      watchers += 1;
      if (watchers === 1) {
        unsubscribe = town.subscribe(onTown);
        // The town was just read when Home first opens; back on Home after
        // a while elsewhere, what came meanwhile is read at once.
        if (lastRead === -Infinity) lastRead = clock.now();
        if (clock.now() - lastRead >= POLL_EVERY) void read();
        else schedule();
      }
      return () => {
        watchers -= 1;
        if (watchers) return;
        stopTimer();
        unsubscribe?.();
        unsubscribe = null;
      };
    },
    /**
     * The page came into view again, the network came back, or the page
     * was shown from the browser's back cache: read now, unless a read was
     * just made and none failed.
     */
    wake() {
      count();
      if (!watchers) return;
      if (!visible()) return stopTimer();
      if (failures || clock.now() - lastRead >= NUDGE_GAP) void read();
      else schedule();
    },
    /** Whether the pill is on screen (Home says), for its eight seconds. */
    shown(on: boolean) {
      showing = on;
      count();
    },
    read,
    take,
    /** A pull, or the tab tapped at the top: reads now, then takes all. */
    async refresh(): Promise<Refreshed> {
      const outcome = await read();
      return { failed: outcome === "failed", taken: take() };
    },
  };
}

export type Arrivals = ReturnType<typeof createArrivals>;
