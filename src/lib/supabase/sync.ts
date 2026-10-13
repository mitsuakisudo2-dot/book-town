import type { PersistenceStatus } from "../types";

/** What a Supabase request hands back, as far as saving needs to know. */
export interface Outcome<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
  count?: number | null;
}

/** A request that failed: worth retrying (offline, server busy) or refused for good. */
export class TownSyncError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
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

export async function settled<T>(
  request: PromiseLike<Outcome<T>>,
): Promise<Outcome<T>> {
  const outcome = await request;
  if (outcome.error)
    throw new TownSyncError(
      outcome.error.message,
      shouldRetry(outcome.status, outcome.error.code),
    );
  return outcome;
}

export const all = async <T>(
  request: PromiseLike<Outcome<T[]>>,
): Promise<T[]> => (await settled(request)).data ?? [];

/** How many rows `allRows` asks for at a time; Supabase's own limit. */
const PAGE = 1000;

/** A select that can be put in order and read a stretch at a time. */
export interface Pageable<T> {
  order(column: string): Pageable<T>;
  range(from: number, to: number): PromiseLike<Outcome<T[]>>;
}

/**
 * Reads every row a select matches, a page at a time, until the rows the
 * first page counted are all in (or a page brings nothing new), so it works
 * whatever the server's own limit is. The rows go in
 * the order of their key (the primary key, without the columns the select
 * fixes). Each page after the first starts again at the last row already read:
 * if another row stands there, rows were added or removed ahead of it
 * meanwhile, so the pages no longer meet and one could slip between them. That,
 * a row met twice, or a total other than the first page's count fails as worth
 * retrying, so the whole town is read again rather than written from a short
 * list.
 */
export async function allRows<T extends Record<string, unknown>>(
  select: (count?: "exact") => Pageable<T>,
  keys: (keyof T & string)[],
  size = PAGE,
): Promise<T[]> {
  const keyOf = (row: T) => JSON.stringify(keys.map((column) => row[column]));
  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let first = true; ; first = false) {
    let query = select(first ? "exact" : undefined);
    for (const key of keys) query = query.order(key);
    const from = first ? 0 : rows.length - 1;
    const outcome = await settled(query.range(from, from + size - 1));
    if (first) total = outcome.count ?? null;
    const page = outcome.data ?? [];
    if (!first && (!page.length || keyOf(page[0]) !== keyOf(rows[from])))
      throw new RowsChangedError("Rows moved between two pages; reading again");
    const fresh = first ? page : page.slice(1);
    for (const row of fresh) {
      const key = keyOf(row);
      if (seen.has(key))
        throw new RowsChangedError("A row was read twice; reading again");
      seen.add(key);
      rows.push(row);
    }
    if (!fresh.length || total === null || rows.length >= total) break;
  }
  if (total === null)
    throw new TownSyncError("The rows were not counted; reading again", true);
  if (rows.length !== total)
    throw new RowsChangedError(
      `Read ${rows.length} rows of ${total}; reading again`,
    );
  return rows;
}

export const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, index * size + size),
  );

export interface SyncListener<T> {
  status(status: PersistenceStatus): void;
  /** The value as it really is, after the database refused a change. */
  replace(value: T, status: PersistenceStatus): void;
}

export interface SyncOptions {
  /** Waits before writing, so a burst of changes goes out together. */
  delay?: number;
  /** Waits between tries while the network is down: 2s, 5s, 15s, then 30s. */
  retryDelays?: number[];
}

/**
 * Keeps a value in memory for the screens and saves it back in the background.
 * `write` gets the last value the database confirmed and the one to save, so a
 * failed save is simply planned again on the next try. Network trouble is
 * retried; a refusal reloads the value and hands it to the listener.
 */
export function backgroundSync<T>(
  spec: {
    /** Reads the value once; throws TownSyncError. */
    read(): Promise<T>;
    /** Writes what changed between `base` and `target`; throws TownSyncError. */
    write(base: T, target: T): Promise<void>;
  },
  options: SyncOptions = {},
) {
  const delay = options.delay ?? 400;
  const retryDelays = options.retryDelays ?? [2000, 5000, 15000, 30000];
  let synced: T | null = null;
  let latest: T | null = null;
  let listener: SyncListener<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let failures = 0;
  let closed = false;

  const report = (status: PersistenceStatus) => {
    if (!closed) listener?.status(status);
  };
  const pending = () => latest !== null && latest !== synced;

  const schedule = (wait: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, wait);
  };

  async function reload(status: PersistenceStatus) {
    const fresh = await load();
    if (closed) return;
    latest = fresh;
    listener?.replace(fresh, status);
  }

  async function flush() {
    if (closed || writing || synced === null || latest === null) return;
    if (!pending()) return report("saved");
    writing = true;
    const base = synced;
    const target = latest;
    try {
      await spec.write(base, target);
      synced = target;
      failures = 0;
      report(pending() ? "saving" : "saved");
    } catch (error) {
      if (error instanceof TownSyncError && error.retry) {
        report("unavailable");
        schedule(retryDelays[Math.min(failures, retryDelays.length - 1)]);
        failures += 1;
        return;
      }
      // The database refused: show the value as it really is.
      failures = 0;
      try {
        await reload("recovered");
      } catch {
        report("unavailable");
        schedule(retryDelays[0]);
      }
      return;
    } finally {
      writing = false;
    }
    if (pending()) schedule(delay);
  }

  const online = () => {
    if (pending()) schedule(0);
  };
  const leaving = (event: BeforeUnloadEvent) => {
    // Ask before closing the page while changes are still on their way.
    if (pending()) event.preventDefault();
  };

  /** Reads the value, waiting out network trouble. */
  async function load(): Promise<T> {
    let rereads = 0;
    for (let attempt = 0; ;) {
      try {
        const value = await spec.read();
        synced = value;
        return value;
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
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", leaving);
  }

  return {
    load,
    save(value: T): PersistenceStatus {
      if (synced === null) return "loading";
      latest = value;
      if (!pending()) return "saved";
      if (!writing) schedule(delay);
      return "saving";
    },
    watch(next: SyncListener<T>) {
      listener = next;
      return () => {
        if (listener === next) listener = null;
      };
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", online);
        window.removeEventListener("beforeunload", leaving);
      }
    },
  };
}
