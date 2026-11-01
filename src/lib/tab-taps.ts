// タブが押された回数を数える (けにーさん 11-01 11:45Z: the six tabs stay for
// now, and the β counts which is pressed how often). Counted on the
// reader's own device and sent now and then as counts alone
// (`count_tab_taps`, supabase/migrations/*_tab_taps.sql), like the stumble
// counts (stumbles.ts): a mode, a tab and a number, from the fixed lists
// below, so nothing that names a reader, a page or an order of taps can go.
//
// Only a signed-in reader's taps go: the account's town gives the sender
// (accountTownBackend) and takes it back when it closes; a tap without one
// is not kept. Counts go every few minutes and when the page is hidden.
// Counts that could not go wait for the next send while the page is open;
// closed, they are dropped.

/**
 * What is counted: the phone's row of tabs at the bottom, then the three
 * buttons of the bar at the top. A tab added later is one more word here
 * and in the database's lists (a new migration).
 */
export const TAB_TAP_TABS = [
  "home",
  "search",
  "walk",
  "library",
  "reading",
  "profile",
  /** 本を登録, at the top. */
  "top_add",
  /** お知らせ, at the top. */
  "top_bell",
  /** The reader's face at the top: the same page as わたし. */
  "top_me",
] as const;
export type TabTapTab = (typeof TAB_TAP_TABS)[number];

/** The town, or 読書管理モード (five tabs, no 書店めぐり). */
export const TAB_TAP_MODES = ["town", "manage"] as const;
export type TabTapMode = (typeof TAB_TAP_MODES)[number];

/** The most one call adds to a row; the database stops there too. */
export const TAB_TAPS_PER_SEND = 200;
/** How often what was counted is sent while the page stays open. */
export const TAB_TAPS_EVERY_MS = 5 * 60_000;

export interface TabTapCounts {
  modes: TabTapMode[];
  tabs: TabTapTab[];
  times: number[];
}

export type TabTapSender = (counts: TabTapCounts) => PromiseLike<unknown>;

const key = (mode: TabTapMode, tab: TabTapTab) => `${mode} ${tab}`;

/** The counts of one page. */
export function tabTapTally() {
  const counts = new Map<string, number>();
  const add = (at: string, times: number) =>
    counts.set(at, Math.min((counts.get(at) ?? 0) + times, TAB_TAPS_PER_SEND));
  return {
    count(mode: TabTapMode, tab: TabTapTab) {
      add(key(mode, tab), 1);
    },
    /** Counts that could not be sent, back with the rest. */
    restore(taken: TabTapCounts) {
      taken.tabs.forEach((tab, i) =>
        add(key(taken.modes[i], tab), taken.times[i]),
      );
    },
    /** What was counted, in the shape the database takes; then none. */
    take(): TabTapCounts | null {
      if (!counts.size) return null;
      const taken: TabTapCounts = { modes: [], tabs: [], times: [] };
      for (const mode of TAB_TAP_MODES)
        for (const tab of TAB_TAP_TABS) {
          const times = counts.get(key(mode, tab));
          if (!times) continue;
          taken.modes.push(mode);
          taken.tabs.push(tab);
          taken.times.push(times);
        }
      counts.clear();
      return taken;
    },
  };
}

const tally = tabTapTally();
let sender: TabTapSender | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Sends what was counted, if anyone is signed in to send it. Offline, or
 * turned back, the counts wait for the next send. Never throws.
 */
export function sendTabTaps() {
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
  if (document.visibilityState === "hidden") sendTabTaps();
};
const listen = (on: boolean) => {
  const change = on ? "addEventListener" : "removeEventListener";
  document[change]("visibilitychange", onHidden);
  if (typeof window !== "undefined") window[change]("pagehide", sendTabTaps);
};

/** Counts one tap, while a signed-in reader's sender is set. */
export function countTabTap(mode: TabTapMode, tab: TabTapTab) {
  if (!sender) return;
  tally.count(mode, tab);
}

/**
 * The signed-in reader's way to send (accountTownBackend). Answers how to
 * take it back: what was counted is sent first.
 */
export function setTabTapSender(send: TabTapSender): () => void {
  // The page before keeps no counts for the next reader.
  if (sender) {
    sendTabTaps();
    tally.take();
  }
  sender = send;
  if (typeof document !== "undefined" && timer === null) {
    timer = setInterval(sendTabTaps, TAB_TAPS_EVERY_MS);
    listen(true);
  }
  return () => {
    if (sender !== send) return;
    sendTabTaps();
    tally.take();
    sender = null;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      listen(false);
    }
  };
}
