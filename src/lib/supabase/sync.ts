import { valueMark } from "../canonical";
import {
  countStumble,
  type StumbleFeature,
  type StumbleResult,
} from "../stumbles";
import type { PersistenceStatus } from "../types";

/** What a Supabase request hands back, as far as saving needs to know. */
export interface Outcome<T> {
  data: T | null;
  error: { message: string; code?: string; hint?: string } | null;
  status: number;
  count?: number | null;
}

/** A request that failed: worth retrying (offline, server busy) or refused for good. */
export class TownSyncError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    /** The database's code for it (PGRST202, 23514…), when it gave one. */
    readonly code = "",
    /** Its hint, when it gave one (booktown:reading_mode…). */
    readonly hint = "",
    /**
     * The HTTP status the answer came with (0: none came, the network);
     * none for a wait of the app's own (the town not read yet).
     */
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Rows changed while they were being read, as when another device saves:
 * nothing is wrong with the network, and reading again at once will do.
 */
export class RowsChangedError extends TownSyncError {
  constructor(message: string) {
    super(message, true);
  }
}

/**
 * The database's answer to a write of a whole thing over a version it no
 * longer holds (save_shelves and the like, HTTP 409): it was changed on
 * another device since this one read it, and nothing was written.
 */
export const CHANGED_ELSEWHERE = "PT409";

/**
 * Network trouble, a busy server and an expired login get another try. Anything
 * else is the database saying no (a rule, a limit, a taken ID) and would only
 * fail again.
 */
export function shouldRetry(status: number, code = ""): boolean {
  return (
    status === 0 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    /^PGRST(00\d|30\d)$/.test(code)
  );
}

/**
 * How a request that failed counts as a stumble (stumbles.ts): turned away,
 * no network, or the server's trouble (busy, timed out, the login gone).
 * A wait of the app's own is no try: null.
 */
export function stumbleOf(error: unknown): StumbleResult | null {
  if (!(error instanceof TownSyncError)) return "other";
  if (!error.retry) return "refused";
  if (error.status === undefined) return null;
  return error.status === 0 ? "offline" : "other";
}

export async function settled<T>(
  request: PromiseLike<Outcome<T>>,
): Promise<Outcome<T>> {
  const outcome = await request;
  if (outcome.error)
    throw new TownSyncError(
      outcome.error.message,
      shouldRetry(outcome.status, outcome.error.code),
      outcome.error.code,
      outcome.error.hint,
      outcome.status,
    );
  return outcome;
}

export const all = async <T>(
  request: PromiseLike<Outcome<T[]>>,
): Promise<T[]> => (await settled(request)).data ?? [];

/** How many rows a request brings at most: Supabase's own limit (max_rows). */
export const PAGE = 1000;

/** A select that can be put in order and read a stretch at a time. */
export interface Pageable<T> {
  order(column: string): Pageable<T>;
  range(from: number, to: number): PromiseLike<Outcome<T[]>>;
}

/**
 * Reads every row a select matches, a page at a time, until the rows the
 * first page counted are all in, so it works whatever the server's own limit
 * is. The rows go in the order of their key (the primary key, without the
 * columns the select fixes, or a column to sort by before it). The first page
 * tells how many there are and how many one answer holds; the pages after it
 * are asked for together, so a list past the limit waits for one more answer,
 * not one a page. Each page after the first starts again at the last row of
 * the one before: if another row stands there, rows were added or removed
 * ahead of it meanwhile, so the pages no longer meet and one could slip
 * between them. That, a row met twice, or a total other than the first page's
 * count fails as worth retrying, so the whole town is read again rather than
 * written from, or shown with, a short list.
 */
export async function allRows<T extends Record<string, unknown>>(
  select: (count?: "exact") => Pageable<T>,
  keys: (keyof T & string)[],
  size = PAGE,
): Promise<T[]> {
  const keyOf = (row: T) => JSON.stringify(keys.map((column) => row[column]));
  const ask = async (from: number, to: number, count?: "exact") => {
    let query = select(count);
    for (const key of keys) query = query.order(key);
    return settled(query.range(from, to));
  };
  const rows: T[] = [];
  const seen = new Set<string>();
  /** Joins on a page that starts at the last row read; how many were new. */
  const join = (found: T[]) => {
    const last = rows[rows.length - 1];
    if (!found.length || keyOf(found[0]) !== keyOf(last))
      throw new RowsChangedError("Rows moved between two pages; reading again");
    return take(found.slice(1));
  };
  const take = (fresh: T[]) => {
    for (const row of fresh) {
      const key = keyOf(row);
      if (seen.has(key))
        throw new RowsChangedError("A row was read twice; reading again");
      seen.add(key);
      rows.push(row);
    }
    return fresh.length;
  };
  const first = await ask(0, size - 1, "exact");
  const total = first.count ?? null;
  if (total === null)
    throw new TownSyncError("The rows were not counted; reading again", true);
  take(first.data ?? []);
  // One answer's rows, less the one each page shares with the page before.
  const step = rows.length - 1;
  if (step > 0 && rows.length < total) {
    const starts: number[] = [];
    // Up to a page that starts at or after the last row counted: a full
    // page ending just on it would not tell a row pushed past it.
    for (let from = step; from < total; from += step) starts.push(from);
    const pages = await Promise.all(
      starts.map((from) => ask(from, from + step)),
    );
    pages.forEach((outcome, n) => {
      // A page short of the others leaves a gap before the next one.
      if (rows.length - 1 !== starts[n])
        throw new RowsChangedError("A page came short; reading again");
      join(outcome.data ?? []);
    });
  }
  // Rows added since they were counted.
  while (rows.length && rows.length < total) {
    const from = rows.length - 1;
    if (!join((await ask(from, from + size - 1)).data ?? [])) break;
  }
  if (rows.length !== total)
    throw new RowsChangedError(
      `Read ${rows.length} rows of ${total}; reading again`,
    );
  return rows;
}

/** Reads again at once while rows move under the read, a few times. */
export async function steadily<T>(read: () => Promise<T>, times = 3) {
  for (let tried = 0; ; tried += 1) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof RowsChangedError) || tried >= times) throw error;
    }
  }
}

export const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, index * size + size),
  );

/**
 * The versions the database counts for the things set whole (a shop's
 * shelves, the nine, a poster), by the key `stake` gives each. A thing
 * without one is written the old way (a database from before versions).
 */
export type Versions = Record<string, number>;

/** A value read with the versions of the things it holds whole. */
export class Versioned<T> {
  constructor(
    readonly value: T,
    readonly versions: Versions,
  ) {}
}

/**
 * One change kept on the device until the database takes it. A change that
 * sets a whole thing at once (a shop's shelves, the nine) keeps the marks of
 * that thing before it and after it (valueMark), so one sent again later is
 * not sent over a version saved since on another device.
 */
export interface KeptWrite<W> {
  write: W;
  was?: string;
  to?: string;
}

/** What one page kept and had not yet seen saved. */
export interface KeptWrites<W> {
  /** The page (one backgroundSync) that kept them. */
  page: string;
  /** When they were last kept (ISO). */
  at: string;
  writes: KeptWrite<W>[];
}

/** Where changes wait on the device until the database takes them (outbox.ts). */
export interface Outbox<W> {
  /** Keeps a page's changes in place of what it kept; false if it could not. */
  keep(page: string, writes: KeptWrite<W>[]): boolean;
  /** What other pages kept and did not see saved, oldest first. */
  left(page: string): KeptWrites<W>[];
  /** Lets go of what a page kept. */
  drop(page: string): void;
}

/** Changes that did not reach the database, for the screens to tell. */
export interface Missed<W> {
  /** Turned away by the database. */
  refused: W[];
  /** Kept on the device, but changed on another device since: not sent. */
  elsewhere: W[];
  /**
   * Why the database turned them away, when it said (the hints it gave,
   * each once): booktown:reading_mode, for one, says the reader is in
   * 読書管理モード now, switched to on another device or tab.
   */
  hints?: string[];
}

export const missedNothing = <W>(missed: Missed<W>) =>
  !missed.refused.length && !missed.elsewhere.length;

export interface SyncListener<T, W = unknown> {
  status(status: PersistenceStatus): void;
  /**
   * The value as the database holds it, read again after a change was
   * turned away ("recovered", with what did not reach it) or after changes
   * kept on the device were sent.
   */
  replace(value: T, status: PersistenceStatus, missed?: Missed<W>): void;
}

export interface SyncOptions {
  /** Waits before writing, so a burst of changes goes out together. */
  delay?: number;
  /** Waits between tries while the network is down: 2s, 5s, 15s, then 30s. */
  retryDelays?: number[];
}

/** Rounds in a row kept changes may fail, online, before a page saves its own. */
const LEFT_TRIES = 3;

/** Whether the browser thinks it is online (always, where it cannot tell). */
const online = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

export interface SyncSpec<T, W> {
  /**
   * Reads the value once, with the versions of what it holds whole where
   * the database keeps them; throws TownSyncError.
   */
  read(): Promise<T | Versioned<T>>;
  /** The writes that make the database, holding `base`, hold `target`. */
  plan(base: T, target: T): W[];
  /**
   * Runs one write; throws TownSyncError. Each can run twice without harm.
   * A write that sets a whole thing is handed the version of it the value
   * it was planned from holds (`base`, none where it has none): written only
   * over that, or refused with CHANGED_ELSEWHERE. It answers the versions
   * the database holds after it, by key.
   */
  apply(write: W, base?: number): Promise<Versions | void>;
  /** Runs before a round of writes (finding what they need). */
  prepare?(): Promise<void>;
  /**
   * A write of several rows as one write a row, so one row turned away
   * leaves the others to go; none for a write of one thing.
   */
  split?(write: W): W[];
  /**
   * For a write that sets a whole thing: which thing (`key`) and what of it
   * `state` holds. Undefined for any other write.
   */
  stake?(state: T, write: W): { key: string; value: unknown } | undefined;
  /** Told when the database has taken `target` (as far as it could). */
  landed?(base: T, target: T): void;
  /** Keeps the changes on the device while they wait. */
  outbox?: Outbox<W>;
  /**
   * The feature a write's try counts for (stumbles.ts), or null. Each write
   * sent is counted once, as a whole (its parts turned away or not); one
   * passed over or only told again is not.
   */
  stumble?(write: W): StumbleFeature | null;
}

/**
 * Keeps a value in memory for the screens and saves it back in the background,
 * by writing what changed between the last value the database confirmed and
 * the one to save: a save that fails is simply planned again on the next try.
 *
 * - Network trouble is retried, with the changes kept as they are.
 * - A write the database turns away is taken apart row by row (`split`) and
 *   only what it refuses is left out; the other changes are saved. The value
 *   is then read again and handed to the listener with what was left out.
 * - While changes wait, they are kept on the device (`outbox`), so a page
 *   closed, a sign-in ended or a tab lost before they went out sends them
 *   when the value is next read: before anything else, each change set
 *   whole sent only over the version it began from. Then the value is read
 *   again, with them.
 * - A thing set whole (`stake`) is written over the version the database
 *   counted when the value it was planned from was read or written
 *   (`Versioned`): one changed on another device since is not written but
 *   told with the others that were not (`elsewhere`), and the value read
 *   again. After network trouble, what was on its way is sent again first,
 *   as it was, before any later change: the database may have taken it, and
 *   a later change planned from before it would be refused.
 */
export function backgroundSync<T, W>(
  spec: SyncSpec<T, W>,
  options: SyncOptions = {},
) {
  const delay = options.delay ?? 400;
  const retryDelays = options.retryDelays ?? [2000, 5000, 15000, 30000];
  const page =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Math.random()).slice(2);
  let synced: T | null = null;
  // The versions of what `synced` holds whole, by key.
  let versions: Versions = {};
  // What a round of writes cut off by network trouble set out to save: sent
  // again before anything later.
  let tried: T | null = null;
  let latest: T | null = null;
  let listener: SyncListener<T, W> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let failures = 0;
  let closed = false;
  // What other pages kept and had not seen saved: sent before anything else.
  let left: KeptWrites<W>[] = [];
  // Some change did not reach the database (or reached it from another
  // page's keeping), so the value is read again once nothing waits.
  let stale = false;
  let missed: Missed<W> = { refused: [], elsewhere: [] };
  // Whether the device holds what waits now.
  let kept = false;
  // What the kept changes sent so far set, by the key of what each changed
  // whole, until the value is read again: a later change of the same thing
  // is checked against it, after network trouble too.
  let placed = new Map<string, string>();
  // Rounds in a row the kept changes could not be sent, online.
  let leftTries = 0;
  // Rows taken in while a write was on its way: the value it saves lacks
  // them, so they are taken into it again once it is saved (against what
  // was saved before, so a row the write removed stays removed).
  let absorbedWhileWriting: ((value: T) => T)[] = [];

  const report = (status: PersistenceStatus) => {
    if (!closed) listener?.status(status);
  };
  const shown = () => latest ?? synced;
  const pending = () =>
    (latest !== null && latest !== synced) || tried !== null;
  const opened = (read: T | Versioned<T>) =>
    read instanceof Versioned ? read : new Versioned(read, {});

  const schedule = (wait: number) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, wait);
  };
  const backOff = () => {
    report("unavailable");
    schedule(retryDelays[Math.min(failures, retryDelays.length - 1)]);
    failures += 1;
  };

  /**
   * Puts what waits now on the device, in place of what was kept. What the
   * database turned away stays too until the listener is told (with the
   * words written, missed-changes.ts): a page closed before that leaves it
   * to the next, which sends it again and tells it (a thing set whole is
   * only told: see send).
   */
  function keep() {
    if (!spec.outbox || closed || synced === null) return;
    try {
      const base = synced;
      const target = shown() as T;
      const planned =
        target === base
          ? []
          : spec.plan(base, target).map((write): KeptWrite<W> => {
              const was = spec.stake?.(base, write);
              const to = spec.stake?.(target, write);
              return was && to
                ? { write, was: valueMark(was.value), to: valueMark(to.value) }
                : { write };
            });
      kept = spec.outbox.keep(page, [
        ...missed.refused.map((write) => ({ write })),
        ...planned,
      ]);
    } catch (error) {
      console.error(error);
      kept = false;
    }
  }

  const isRetry = (error: unknown) =>
    error instanceof TownSyncError && error.retry;
  // Writes counted since a round last went through: a round cut off by
  // network trouble sends them all again, and each is counted once.
  const told = new Set<string>();
  /** Counting never stops a save. */
  const tell = (write: W, result: StumbleResult | null, thrown = false) => {
    if (!spec.stumble || result === null) return;
    try {
      const feature = spec.stumble(write);
      if (!feature) return;
      // A write that failed to be tried again is counted each time (network
      // trouble once a feature, by the tally itself); one that went through
      // or was turned away, once.
      if (!thrown) {
        const mark = valueMark(write);
        if (told.has(mark)) return;
        told.add(mark);
      }
      countStumble(feature, result);
    } catch {}
  };

  /**
   * Sends `writes`, planned from `from`, in order. A write set whole goes
   * over the version `known` holds of it, and `known` takes the version it
   * is written at. A write turned away is split and its parts sent one by
   * one; what is turned away whole joins `into.refused`, and one changed on
   * another device since joins `into.elsewhere`. A kept write set whole is
   * sent only over the version it began from, as `there` holds it (the
   * marks of what the database holds, by key): one already there is passed
   * over, one changed since joins `into.elsewhere`. Network trouble is
   * thrown, to be tried again.
   */
  async function send(
    writes: KeptWrite<W>[],
    into: Missed<W>,
    from: T,
    known: Versions,
    there?: (write: W) => { key: string; mark: string } | undefined,
    placed?: Map<string, string>,
  ) {
    async function one(write: W): Promise<void> {
      try {
        const key = spec.stake?.(from, write)?.key;
        const now = await spec.apply(
          write,
          key === undefined ? undefined : known[key],
        );
        if (now) Object.assign(known, now);
      } catch (error) {
        if (isRetry(error)) throw error;
        let parts: W[] = [];
        try {
          parts = spec.split?.(write) ?? [];
        } catch {
          // A write that cannot be taken apart is turned away whole.
        }
        // Each part alone: only the one changed elsewhere, or turned away,
        // is left out (two posters made at once, one changed since).
        if (parts.length > 1) for (const part of parts) await one(part);
        else if (
          error instanceof TownSyncError &&
          error.code === CHANGED_ELSEWHERE
        )
          into.elsewhere.push(write);
        else {
          into.refused.push(write);
          if (error instanceof TownSyncError && error.hint)
            into.hints = [...new Set([...(into.hints ?? []), error.hint])];
        }
      }
    }
    for (const kept of writes) {
      if (closed) return;
      // A thing set whole kept with no marks is one the database turned
      // away (keep): told again, not sent, as sent over the version this
      // page read it could write an old copy over a newer one.
      if (kept.was === undefined && there?.(kept.write)) {
        into.refused.push(kept.write);
        continue;
      }
      const now = kept.was !== undefined ? there?.(kept.write) : undefined;
      if (now) {
        const mark = placed?.get(now.key) ?? now.mark;
        if (mark === kept.to) continue;
        if (mark !== kept.was) {
          into.elsewhere.push(kept.write);
          continue;
        }
      }
      const refused = into.refused.length;
      const elsewhere = into.elsewhere.length;
      try {
        await one(kept.write);
      } catch (error) {
        tell(kept.write, stumbleOf(error), true);
        throw error;
      }
      tell(
        kept.write,
        into.refused.length > refused
          ? "refused"
          : into.elsewhere.length > elsewhere
            ? "other"
            : "ok",
      );
      if (
        now &&
        into.refused.length === refused &&
        into.elsewhere.length === elsewhere
      )
        placed?.set(now.key, kept.to as string);
    }
  }

  /** Sends what other pages kept, oldest first, each page's dropped once sent. */
  async function sendLeft() {
    report("saving");
    await spec.prepare?.();
    const against = synced as T;
    const there = (write: W) => {
      const stake = spec.stake?.(against, write);
      return stake && { key: stake.key, mark: valueMark(stake.value) };
    };
    // The versions these writes leave are not this page's: its own changes,
    // planned without them, are refused over them until it reads again.
    const sent = { ...versions };
    while (left.length) {
      const [entry] = left;
      // Told once the page's changes are all sent: sent again after network
      // trouble, a refusal would otherwise be told twice.
      const into: Missed<W> = { refused: [], elsewhere: [] };
      await send(entry.writes, into, against, sent, there, placed);
      if (closed) return;
      missed.refused.push(...into.refused);
      missed.elsewhere.push(...into.elsewhere);
      if (into.hints)
        missed.hints = [...new Set([...(missed.hints ?? []), ...into.hints])];
      left = left.slice(1);
      stale = true;
      // What was turned away is kept here before it is let go there.
      keep();
      spec.outbox?.drop(entry.page);
    }
    failures = 0;
    leftTries = 0;
  }

  /** Reads the value again and shows it, unless changes were made meanwhile. */
  async function reread() {
    const before = shown();
    let read: Versioned<T>;
    try {
      read = opened(await steadily(() => spec.read()));
    } catch {
      return backOff();
    }
    if (closed) return;
    // A change made while reading goes out first; then the value is read
    // again, with it.
    if (shown() !== before) return schedule(0);
    const fresh = read.value;
    synced = fresh;
    versions = { ...read.versions };
    tried = null;
    latest = fresh;
    stale = false;
    failures = 0;
    placed = new Map();
    const told = missed;
    if (listener) missed = { refused: [], elsewhere: [] };
    listener?.replace(fresh, missedNothing(told) ? "saved" : "recovered", told);
    // Told: what was turned away waits no more.
    keep();
  }

  async function flush() {
    if (closed || busy || synced === null) return;
    // What other pages kept is sent once someone hears how it went.
    if (left.length && !listener) return;
    busy = true;
    const sendingLeft = left.length > 0;
    try {
      if (sendingLeft) await sendLeft();
      else if (!pending()) {
        if (stale) await reread();
        else report("saved");
        return;
      } else {
        const base = synced;
        const target = tried ?? (latest as T);
        await spec.prepare?.();
        const into: Missed<W> = { refused: [], elsewhere: [] };
        const next = { ...versions };
        tried = target;
        await send(
          spec.plan(base, target).map((write) => ({ write })),
          into,
          base,
          next,
        );
        synced = target;
        versions = next;
        tried = null;
        for (const take of absorbedWhileWriting) synced = take(synced);
        failures = 0;
        spec.landed?.(base, target);
        if (into.refused.length || into.elsewhere.length) {
          missed.refused.push(...into.refused);
          missed.elsewhere.push(...into.elsewhere);
          if (into.hints)
            missed.hints = [
              ...new Set([...(missed.hints ?? []), ...into.hints]),
            ];
          stale = true;
        }
        keep();
        report(pending() || stale ? "saving" : "saved");
      }
      told.clear();
    } catch (error) {
      if (closed) return;
      if (!isRetry(error)) console.error(error);
      // Kept changes that do not go though the browser is online (one that
      // waits for a shop never saved, one this version cannot send) stay on
      // the device for a later page, and this one saves its own.
      if (
        sendingLeft &&
        (!isRetry(error) || online()) &&
        ++leftTries >= LEFT_TRIES
      ) {
        left = left.slice(1);
        leftTries = 0;
        failures = 0;
      }
      backOff();
      return;
    } finally {
      busy = false;
      absorbedWhileWriting = [];
    }
    if (pending() || stale || left.length) schedule(pending() ? delay : 0);
  }

  const cameOnline = () => {
    if (pending() || stale || left.length) schedule(0);
  };
  const leaving = (event: BeforeUnloadEvent) => {
    // Ask before closing the page while changes are on their way and the
    // device could not keep them.
    if (pending() && !kept) event.preventDefault();
  };

  /** Reads the value, waiting out network trouble. */
  async function load(): Promise<T> {
    let rereads = 0;
    for (let attempt = 0; ;) {
      try {
        const read = opened(await spec.read());
        synced = read.value;
        versions = { ...read.versions };
        left = spec.outbox?.left(page) ?? [];
        if (left.length) schedule(0);
        return read.value;
      } catch (error) {
        if (closed || !(error instanceof TownSyncError && error.retry))
          throw error;
        // Rows changed while being read: read again straight away, a few
        // times, without a word, as the network is fine.
        if (error instanceof RowsChangedError && rereads < 3) {
          rereads += 1;
          continue;
        }
        report("unavailable");
        await new Promise((resume) =>
          setTimeout(
            resume,
            retryDelays[Math.min(attempt, retryDelays.length - 1)],
          ),
        );
        attempt += 1;
      }
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", cameOnline);
    window.addEventListener("beforeunload", leaving);
  }

  return {
    load,
    /** The status the value read has: saving while kept changes wait to go. */
    loaded: (): PersistenceStatus => (left.length ? "saving" : "saved"),
    save(value: T): PersistenceStatus {
      if (synced === null) return "loading";
      latest = value;
      keep();
      if (!pending() && !stale && !left.length) return "saved";
      if (!busy) schedule(pending() ? delay : 0);
      return "saving";
    },
    /** The value as it is now, or null while none is read. */
    current: (): T | null => shown(),
    /**
     * Takes in what was read after the value (a 便り that arrived, an older
     * one): it joins both the value shown and the one the database is known
     * to hold, so it is never written back as a change. `take` is handed
     * the value and the one last saved, to tell what was removed here and
     * not yet written. The value to show, or null while none is read.
     */
    absorb(take: (value: T, saved: T) => T): T | null {
      if (closed || synced === null) return null;
      const saved = synced;
      const now = latest ?? saved;
      synced = take(saved, saved);
      latest = now === saved ? synced : take(now, saved);
      // What waits to be sent again takes them in too.
      if (tried !== null) tried = take(tried, saved);
      if (busy) absorbedWhileWriting.push((value) => take(value, saved));
      return latest;
    },
    watch(next: SyncListener<T, W>) {
      listener = next;
      if (left.length) schedule(0);
      return () => {
        if (listener === next) listener = null;
      };
    },
    /**
     * Stops saving. What waits stays kept on the device, to be sent when
     * the value is next read (by this person).
     */
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", cameOnline);
        window.removeEventListener("beforeunload", leaving);
      }
    },
  };
}
