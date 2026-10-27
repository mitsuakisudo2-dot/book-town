// 機能ごとのつまずきを数える (管理表 110): how each try of a few features
// went, counted on the reader's own device and sent now and then as counts
// alone (`count_stumbles`, supabase/migrations/*_stumble_counts.sql). What is
// sent is a feature, a result and a number, from the fixed lists below, so
// nothing that could name a reader, a book or what was typed can go with it.
//
// Only a signed-in reader's counts go: the account's town gives the sender
// (accountTownBackend) and takes it back when it closes; a try counted
// without one is not kept. Counts go every few minutes, soon after a try
// that went wrong (a reader who meets one often leaves), and when the page
// is hidden. Counts that could not go wait for the next send while the page
// is open; closed, they are dropped.

/** The features counted (けにーさん 10-18: まずは4つ). */
export const STUMBLE_FEATURES = [
  /** A typed search the database was asked (find_books). */
  "search",
  /** Books put into the library, as saved (library-entries). */
  "register",
  /** The scanner's camera and the ISBNs it read. */
  "barcode",
  /** The reader's shelves and shop as saved (shelves, scene). */
  "shelf",
] as const;
export type StumbleFeature = (typeof STUMBLE_FEATURES)[number];

/** How a try went. 見つからない is no failure: it is told apart. */
export const STUMBLE_RESULTS = [
  "ok",
  "not_found",
  "refused",
  "offline",
  "other",
] as const;
export type StumbleResult = (typeof STUMBLE_RESULTS)[number];

/** The most one call adds to a row; the database stops there too. */
export const STUMBLES_PER_SEND = 100;
/** How often what was counted is sent while the page stays open. */
export const STUMBLES_EVERY_MS = 5 * 60_000;
/** How soon a try that went wrong is sent. */
export const STUMBLES_SOON_MS = 20_000;

export interface StumbleCounts {
  features: StumbleFeature[];
  results: StumbleResult[];
  times: number[];
}

export type StumbleSender = (counts: StumbleCounts) => PromiseLike<unknown>;

const key = (feature: StumbleFeature, result: StumbleResult) =>
  `${feature} ${result}`;

/**
 * The counts of one page. Network trouble is counted once for a feature
 * until a try of it goes otherwise: a page waiting out a lost connection
 * tries again and again, and that is one stumble, not a hundred.
 */
export function stumbleTally() {
  const counts = new Map<string, number>();
  const offline = new Set<StumbleFeature>();
  return {
    count(feature: StumbleFeature, result: StumbleResult) {
      if (result === "offline") {
        if (offline.has(feature)) return;
        offline.add(feature);
      } else offline.delete(feature);
      const at = key(feature, result);
      counts.set(at, Math.min((counts.get(at) ?? 0) + 1, STUMBLES_PER_SEND));
    },
    /** Counts that could not be sent, back with the rest. */
    restore(taken: StumbleCounts) {
      taken.features.forEach((feature, i) => {
        const at = key(feature, taken.results[i]);
        counts.set(
          at,
          Math.min((counts.get(at) ?? 0) + taken.times[i], STUMBLES_PER_SEND),
        );
      });
    },
    /** What was counted, in the shape the database takes; then none. */
    take(): StumbleCounts | null {
      if (!counts.size) return null;
      const taken: StumbleCounts = { features: [], results: [], times: [] };
      for (const feature of STUMBLE_FEATURES)
        for (const result of STUMBLE_RESULTS) {
          const times = counts.get(key(feature, result));
          if (!times) continue;
          taken.features.push(feature);
          taken.results.push(result);
          taken.times.push(times);
        }
      counts.clear();
      return taken;
    },
  };
}

const tally = stumbleTally();
let sender: StumbleSender | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;

/**
 * Sends what was counted, if anyone is signed in to send it. Offline, or
 * turned back, the counts wait for the next send. Never throws.
 */
export function sendStumbles() {
  if (soon !== null) {
    clearTimeout(soon);
    soon = null;
  }
  const send = sender;
  if (!send) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const counts = tally.take();
  if (!counts) return;
  const back = () => {
    // Only to the same reader's page: another's counts are not theirs.
    if (sender === send) tally.restore(counts);
  };
  try {
    void Promise.resolve(send(counts)).then(undefined, back);
  } catch {
    back();
  }
}

const onHidden = () => {
  if (document.visibilityState === "hidden") sendStumbles();
};
const listen = (on: boolean) => {
  const change = on ? "addEventListener" : "removeEventListener";
  document[change]("visibilitychange", onHidden);
  if (typeof window !== "undefined") window[change]("pagehide", sendStumbles);
};

/** Counts one try, while a signed-in reader's sender is set. */
export function countStumble(feature: StumbleFeature, result: StumbleResult) {
  if (!sender) return;
  tally.count(feature, result);
  if (result !== "ok" && soon === null && typeof window !== "undefined")
    soon = setTimeout(sendStumbles, STUMBLES_SOON_MS);
}

/**
 * The signed-in reader's way to send (accountTownBackend). Answers how to
 * take it back: what was counted is sent first.
 */
export function setStumbleSender(send: StumbleSender): () => void {
  // The page before keeps no counts for the next reader: what could not
  // go is dropped.
  if (sender) {
    sendStumbles();
    tally.take();
  }
  sender = send;
  if (typeof document !== "undefined" && timer === null) {
    timer = setInterval(sendStumbles, STUMBLES_EVERY_MS);
    listen(true);
  }
  return () => {
    if (sender !== send) return;
    sendStumbles();
    tally.take();
    sender = null;
    if (soon !== null) {
      clearTimeout(soon);
      soon = null;
    }
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      listen(false);
    }
  };
}
