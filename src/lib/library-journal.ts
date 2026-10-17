"use client";

// The scan journal (控え): every book the continuous scanner reads is written
// here, on the reader's own device, before anything is sent. It holds what
// the store has not taken yet (the town still loading, no title yet, no
// network) and what it took but has not confirmed saving, so a book read
// just before the tab was closed is registered the next time the page opens.
//
// Each read gets its book id when it is read, so sending it twice, from two
// page loads or two tabs, is still one book: the database keeps one row per
// id. A title that cannot be found is kept here only, never written
// (books.title is required), until the reader types it.
//
// One key per reader in localStorage. Every change reads the key again and
// writes it back, so two tabs of the same reader never write over each
// other's items.

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AccountState } from "./account";
import { bookPrice, bookText, normalizeIsbn } from "./books";
import { bookByIsbn } from "./book-name";
import { lookUpBooks, type OpenBdAnswer } from "./openbd";
import type { TownBackend } from "./town-backend";
import type {
  NewBook,
  Notify,
  PersistenceStatus,
  Registration,
  RegisterVia,
  TownState,
} from "./types";
import { counted } from "./words";

export const JOURNAL_KEY = "book-town-library-journal:";
/** Items older than this are let go (plan 5-6). */
export const JOURNAL_DAYS = 7;
const DAY_MS = 86_400_000;

export type ScanItemState =
  /** No title yet: openBD not asked, or it did not answer (offline, over 4 s, an error). */
  | "lookup"
  /** openBD answered that it has no such book: waits for the reader to type a title. */
  | "untitled"
  /** Title known; not taken by the store yet (the town loading, the account unreadable). */
  | "ready"
  /** Handed to the store (added, or in the library already); waiting until it is saved. */
  | "registered"
  /** The database refused a save while it waited: never sent again by itself. */
  | "refused";

const STATES: readonly ScanItemState[] = [
  "lookup",
  "untitled",
  "ready",
  "registered",
  "refused",
];

export interface ScanItem {
  kind: "scan";
  /** The session's id, a dash and a count. */
  id: string;
  /** The page load that read it. */
  page: string;
  /** The scan session that read it. */
  session: string;
  /** The ISBN-13. */
  isbn: string;
  /** Read by the camera, or typed in the scanner. */
  via: "scan" | "isbn";
  /** Decided when it was read; changed only to the book the store answered with. */
  bookId: string;
  title?: string;
  author?: string;
  price?: number;
  state: ScanItemState;
  /** When it was read (ISO). */
  at: string;
}

type Raw = Record<string, unknown>;
const record = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const name = (value: unknown, max = 80): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
/** A title or author as a book keeps it, or nothing. */
const words = (value: unknown): string =>
  typeof value === "string" ? bookText(value) : "";

/**
 * What a book's title, author and price come to in the journal: cut as the
 * book keeps them (books.ts), so an item never holds what it could not send.
 */
export const bookWords = (book: {
  title: string;
  author: string;
  price?: number;
}): Pick<ScanItem, "title" | "author" | "price"> => {
  const price = bookPrice(book.price);
  return {
    title: bookText(book.title),
    author: bookText(book.author),
    ...(price ? { price } : {}),
  };
};

/**
 * The items kept under one key, less anything malformed, of another
 * version, or older than JOURNAL_DAYS. A title or author too long is cut and
 * a price out of range left out: the read itself is kept.
 */
export function readJournal(raw: string | null, now: number): ScanItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!record(data) || data.version !== 1 || !Array.isArray(data.items))
    return [];
  const ids = new Set<string>();
  const items: ScanItem[] = [];
  for (const value of data.items) {
    if (!record(value)) continue;
    const at = typeof value.at === "string" ? Date.parse(value.at) : NaN;
    if (
      value.kind !== "scan" ||
      !name(value.id) ||
      ids.has(value.id) ||
      !name(value.page) ||
      !name(value.session) ||
      typeof value.isbn !== "string" ||
      normalizeIsbn(value.isbn) !== value.isbn ||
      (value.via !== "scan" && value.via !== "isbn") ||
      !name(value.bookId) ||
      !STATES.includes(value.state as ScanItemState) ||
      !Number.isFinite(at) ||
      now - at > JOURNAL_DAYS * DAY_MS
    )
      continue;
    ids.add(value.id);
    const title = words(value.title);
    const author = words(value.author);
    const price = bookPrice(value.price);
    const state = value.state as ScanItemState;
    items.push({
      kind: "scan",
      id: value.id,
      page: value.page,
      session: value.session,
      isbn: value.isbn,
      via: value.via,
      bookId: value.bookId,
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(price ? { price } : {}),
      // One that lost its title asks for it again.
      state: title || state === "untitled" ? state : "lookup",
      at: value.at as string,
    });
  }
  return items;
}

type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Patch = Partial<Omit<ScanItem, "kind" | "id">>;

export interface LibraryJournal {
  /** This page load. */
  readonly page: string;
  /**
   * Items being sent now in this page, so two senders never send one twice:
   * a new set each time it changes.
   */
  sending(): ReadonlySet<string>;
  /** Marks items as being sent now, or done. */
  markSending(ids: string[], on: boolean): void;
  /** Items taken back (［取り消す］) in this page: never registered after. */
  readonly cancelled: Set<string>;
  /** The book each item (or a book entered by hand) became in this page, for ［取り消す］. */
  readonly added: Map<string, string>;
  /** Scan sessions open in this page; the page's sender leaves their items to them. */
  readonly live: Set<string>;
  /** The reader's items, oldest first. The same array until something changes. */
  items(owner: string): ScanItem[];
  add(owner: string, item: ScanItem): void;
  update(owner: string, id: string, patch: Patch): void;
  remove(owner: string, ids: string[]): void;
  /** Puts items taken out back as they were (an undo). */
  restore(owner: string, items: ScanItem[]): void;
  /** Lets the reader's items go (ログアウト). */
  forget(owner: string): void;
  /** Reads the reader's items again (another tab wrote them). */
  reload(owner: string): void;
  /** The item was handed to the store while it used backend `generation`. */
  hand(id: string, generation: number): void;
  /** Whether the item was handed to the store's current backend in this page. */
  handed(id: string, generation: number): boolean;
  /** A new scan session's id. */
  newSession(): string;
  /** A new item id in a session. */
  newItemId(session: string): string;
  /** Whether the last change reached the device's storage. */
  kept(): boolean;
  /** The time now, as the journal counts its seven days. */
  now(): number;
  subscribe(listener: () => void): () => void;
}

/**
 * A journal over `storage`. Storage that cannot be read or written leaves
 * it working in memory, and kept() says so.
 */
export function createLibraryJournal(
  storage: () => JournalStorage | null,
  clock: () => number = () => Date.now(),
): LibraryJournal {
  const page = clock().toString(36) + Math.random().toString(36).slice(2, 7);
  const memory = new Map<string, ScanItem[]>();
  // Readers whose last write did not reach storage: memory holds their items.
  const unkept = new Set<string>();
  const handedTo = new Map<string, number>();
  const listeners = new Set<() => void>();
  let keptLast = true;
  let sending: ReadonlySet<string> = new Set();
  let sessions = 0;
  let counted = 0;
  let listening = false;
  const emit = () => listeners.forEach((listener) => listener());

  /** What storage holds now, or null when it cannot be read. */
  function stored(owner: string): ScanItem[] | null {
    try {
      const place = storage();
      return place
        ? readJournal(place.getItem(JOURNAL_KEY + owner), clock())
        : null;
    } catch {
      return null;
    }
  }

  function items(owner: string): ScanItem[] {
    let list = memory.get(owner);
    if (!list) {
      list = stored(owner) ?? [];
      memory.set(owner, list);
    }
    return list;
  }

  /** Reads the key again, changes it, and writes it back. */
  function change(owner: string, edit: (list: ScanItem[]) => ScanItem[]) {
    const base = (!unkept.has(owner) && stored(owner)) || items(owner);
    const next = edit(base);
    if (next !== base) {
      let ok = false;
      try {
        const place = storage();
        if (place) {
          if (next.length)
            place.setItem(
              JOURNAL_KEY + owner,
              JSON.stringify({ version: 1, items: next }),
            );
          else place.removeItem(JOURNAL_KEY + owner);
          ok = true;
        }
      } catch {
        // Full or refused: the items stay in memory for this page.
      }
      if (ok) unkept.delete(owner);
      else unkept.add(owner);
      keptLast = ok;
    }
    memory.set(owner, next);
    emit();
  }

  function reload(owner: string) {
    if (!memory.has(owner) || unkept.has(owner)) return;
    const list = stored(owner);
    if (!list) return;
    memory.set(owner, list);
    emit();
  }

  return {
    page,
    sending: () => sending,
    markSending(ids, on) {
      if (!ids.length) return;
      const next = new Set(sending);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      sending = next;
      emit();
    },
    cancelled: new Set(),
    added: new Map(),
    live: new Set(),
    items,
    add(owner, item) {
      change(owner, (list) =>
        list.some((entry) => entry.id === item.id) ? list : [...list, item],
      );
    },
    update(owner, id, patch) {
      change(owner, (list) =>
        list.some((entry) => entry.id === id)
          ? list.map((entry) =>
              entry.id === id ? { ...entry, ...patch } : entry,
            )
          : list,
      );
    },
    remove(owner, ids) {
      for (const id of ids) handedTo.delete(id);
      change(owner, (list) =>
        list.some((entry) => ids.includes(entry.id))
          ? list.filter((entry) => !ids.includes(entry.id))
          : list,
      );
    },
    restore(owner, back) {
      change(owner, (list) => {
        const missing = back.filter(
          (item) => !list.some((entry) => entry.id === item.id),
        );
        return missing.length ? [...list, ...missing] : list;
      });
    },
    forget(owner) {
      try {
        storage()?.removeItem(JOURNAL_KEY + owner);
      } catch {
        // Nothing more can be done; memory lets it go below.
      }
      for (const item of memory.get(owner) ?? []) handedTo.delete(item.id);
      memory.delete(owner);
      unkept.delete(owner);
      emit();
    },
    reload,
    hand(id, generation) {
      handedTo.set(id, generation);
    },
    handed: (id, generation) => handedTo.get(id) === generation,
    newSession: () => `${page}-s${++sessions}`,
    newItemId: (session) => `${session}-${++counted}`,
    kept: () => keptLast,
    now: clock,
    subscribe(listener) {
      listeners.add(listener);
      // Another tab of the same reader changed the journal: read it again.
      if (!listening && typeof window !== "undefined") {
        listening = true;
        window.addEventListener("storage", (event) => {
          if (event.key === null) [...memory.keys()].forEach(reload);
          else if (event.key.startsWith(JOURNAL_KEY))
            reload(event.key.slice(JOURNAL_KEY.length));
        });
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const libraryJournal = createLibraryJournal(() =>
  typeof window === "undefined" ? null : window.localStorage,
);

/**
 * Whose journal the page writes to: the demo's, or the signed-in reader's
 * (even when their town could not be read). Null while the account is being
 * checked, and for a visitor, who registers nothing.
 */
export function journalOwner(
  account: AccountState,
  where: TownBackend["kind"],
): string | null {
  if (account.status === "demo") return "demo";
  if (
    (account.status === "signed-in" || account.status === "unavailable") &&
    (where === "account" || where === "unavailable")
  )
    return account.user.id;
  return null;
}

/**
 * The id a book read now takes if it is new: what the town would give it
 * (counterId in the demo, a UUID for an account), decided at the read so
 * that sending it twice is one book.
 */
export const decideBookId = (owner: string, isbn: string): string =>
  owner === "demo" ? "isbn-" + isbn : crypto.randomUUID();

/**
 * Writes a new read into the journal, with its book id decided now, and
 * answers with it. A book the town knows comes with its title.
 */
export function keepRead(
  journal: LibraryJournal,
  owner: string,
  read: {
    session: string;
    isbn: string;
    via: ScanItem["via"];
    known?: { title: string; author: string; price?: number };
  },
): ScanItem {
  const known = read.known ? bookWords(read.known) : undefined;
  const item: ScanItem = {
    kind: "scan",
    id: journal.newItemId(read.session),
    page: journal.page,
    session: read.session,
    isbn: read.isbn,
    via: read.via,
    bookId: decideBookId(owner, read.isbn),
    ...(known?.title ? known : {}),
    state: known?.title ? "ready" : "lookup",
    at: new Date(journal.now()).toISOString(),
  };
  journal.add(owner, item);
  return item;
}

/**
 * The journal's item with this ISBN that is still on the device, if any.
 * Waiting reads are never doubled, across sessions and page loads (5-6):
 * only an item handed to the store's current backend is not held, since
 * the library has its book now.
 */
export const heldItem = (
  journal: LibraryJournal,
  owner: string,
  generation: number,
  isbn: string,
): ScanItem | undefined =>
  journal
    .items(owner)
    .find(
      (item) =>
        item.isbn === isbn &&
        !(item.state === "registered" && journal.handed(item.id, generation)),
    );

const NOT_SENDING: ReadonlySet<string> = new Set();

/**
 * Items waiting for a title: 書名待ち. Those being sent now are left out:
 * openBD may be answering for them.
 */
export const waitingForTitle = (
  items: ScanItem[],
  sending: ReadonlySet<string> = NOT_SENDING,
) =>
  items.filter(
    (item) =>
      (item.state === "lookup" || item.state === "untitled") &&
      !sending.has(item.id),
  );
/** Items the database refused. */
export const refusedItems = (items: ScanItem[]) =>
  items.filter((item) => item.state === "refused");

/** The town as the journal sends to it (store.ts's journalTown). */
export interface JournalTown {
  subscribe(listener: () => void): () => void;
  state(): TownState;
  status(): PersistenceStatus;
  /** Whether a change made now is kept (the store's getReadySnapshot). */
  ready(): boolean;
  /** The store's backend count (getGeneration). */
  generation(): number;
  where(): TownBackend["kind"];
  /** Whose journal belongs to this town now (journalOwner). */
  owner(): string | null;
  register(
    book: NewBook,
    via: RegisterVia,
    bookId?: string,
  ): Registration | null;
  toggleLibrary(bookId: string): void;
}

export type SendResult =
  | "added"
  | "already"
  /** openBD has no such book: waits for a typed title. */
  | "untitled"
  /** No title yet: offline, or openBD did not answer. Asked again later. */
  | "lookup"
  /** The town is still loading (or changed meanwhile). */
  | "waiting"
  /** The account could not be read. */
  | "unavailable";

export interface Sent {
  /** The item as it was when its result was decided. */
  item: ScanItem;
  result: SendResult;
}

export interface SendOptions {
  /** Only these items. */
  only?: string[];
  /** Leave out these items. */
  skip?: (item: ScanItem) => boolean;
  lookUp?: (isbns: string[]) => Promise<OpenBdAnswer>;
  online?: () => boolean;
}

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

const libraryBook = (state: TownState, isbn: string) =>
  state.books.find(
    (book) => book.isbn === isbn && state.library.includes(book.id),
  );

/**
 * Sends the reader's waiting items to the town, oldest first: those not
 * registered yet, and those a store took in an earlier page load (or before
 * the town changed backend) without confirming the save. A title the town
 * knows is used as it is; the rest are asked of openBD together.
 */
export async function sendJournal(
  journal: LibraryJournal,
  owner: string,
  town: JournalTown,
  options: SendOptions = {},
): Promise<Sent[]> {
  const generation = town.generation();
  const lookUp = options.lookUp ?? ((isbns: string[]) => lookUpBooks(isbns));
  const online = options.online ?? isOnline;
  // As stored now: another tab of the same reader may have sent some.
  journal.reload(owner);
  const picked = journal
    .items(owner)
    .filter(
      (item) =>
        (item.state === "lookup" ||
          item.state === "untitled" ||
          item.state === "ready" ||
          (item.state === "registered" &&
            !journal.handed(item.id, generation))) &&
        !journal.sending().has(item.id) &&
        !journal.cancelled.has(item.id) &&
        (!options.only || options.only.includes(item.id)) &&
        !options.skip?.(item),
    );
  journal.markSending(
    picked.map((item) => item.id),
    true,
  );
  const sent: Sent[] = [];
  // The same reader's town, on the same backend, as when this began.
  const same = () => town.owner() === owner && town.generation() === generation;
  // The item as stored now: another tab, the reader or ［取り消す］ may have
  // changed it while openBD was asked.
  const current = (id: string) =>
    journal.cancelled.has(id)
      ? undefined
      : journal.items(owner).find((item) => item.id === id);
  /** Handed to the store: let go once it is saved. */
  const handed = (item: ScanItem, bookId: string, title: string) => {
    if (town.status() === "saved") journal.remove(owner, [item.id]);
    else {
      journal.update(owner, item.id, { state: "registered", bookId, title });
      journal.hand(item.id, generation);
    }
  };
  /** In the library already: nothing is written. */
  const inLibrary = (item: ScanItem) => {
    if (!town.ready() || !same()) return false;
    const book = libraryBook(town.state(), item.isbn);
    if (!book) return false;
    handed(item, book.id, book.title);
    sent.push({ item, result: "already" });
    return true;
  };
  try {
    const left: ScanItem[] = [];
    for (const { id } of picked) {
      const item = current(id);
      if (!item || inLibrary(item)) continue;
      // A title the town knows needs no question.
      const known = item.title
        ? undefined
        : bookByIsbn(town.state().books, item.isbn);
      if (known)
        journal.update(owner, id, { ...bookWords(known), state: "ready" });
      left.push(item);
    }
    const asking = left
      .map(({ id }) => current(id))
      .filter(
        (item): item is ScanItem =>
          item !== undefined && !item.title && item.state === "lookup",
      );
    if (asking.length && online()) {
      let answer: OpenBdAnswer;
      try {
        answer = await lookUp(asking.map((item) => item.isbn));
      } catch {
        answer = { found: new Map(), unanswered: asking.map((i) => i.isbn) };
      }
      for (const { id, isbn } of asking) {
        const item = current(id);
        // A title typed meanwhile (書名を入れる) is the reader's own.
        if (!item || item.title) continue;
        const book = answer.found.get(isbn);
        if (book)
          journal.update(owner, id, { ...bookWords(book), state: "ready" });
        else if (!answer.unanswered.includes(isbn))
          journal.update(owner, id, { state: "untitled" });
      }
      journal.reload(owner);
    }
    for (const { id } of left) {
      const item = current(id);
      // In the library by now (entered by hand meanwhile): title or not.
      if (!item || inLibrary(item)) continue;
      if (!item.title) {
        sent.push({
          item,
          result: item.state === "untitled" ? "untitled" : "lookup",
        });
        continue;
      }
      if (!town.ready() || !same()) {
        sent.push({
          item,
          result: town.where() === "unavailable" ? "unavailable" : "waiting",
        });
        continue;
      }
      const done = town.register(
        {
          title: item.title,
          author: item.author ?? "",
          isbn: item.isbn,
          ...(item.price ? { price: item.price } : {}),
        },
        item.via,
        item.bookId,
      );
      if (!done) sent.push({ item, result: "unavailable" });
      else if (done.result === "not-saved")
        sent.push({ item, result: "waiting" });
      else {
        if (done.result !== "already") journal.added.set(id, done.bookId);
        handed(item, done.bookId, done.title);
        sent.push({
          item: { ...item, bookId: done.bookId, title: done.title },
          result: done.result === "already" ? "already" : "added",
        });
      }
    }
  } finally {
    journal.markSending(
      picked.map((item) => item.id),
      false,
    );
  }
  return sent;
}

/**
 * After a save: items the store took are let go once everything it had was
 * written ("saved"). After a refusal ("recovered") the town was read again:
 * an item whose book is in it is let go, the rest are marked refused and
 * wait for the reader (10-0: never sent again by themselves). Only items
 * handed to the store's current backend count: another backend's unsent
 * changes are gone, and its items are sent again.
 */
export function settleJournal(
  journal: LibraryJournal,
  owner: string,
  town: JournalTown,
  status: PersistenceStatus = town.status(),
) {
  const generation = town.generation();
  const taken = journal
    .items(owner)
    .filter(
      (item) =>
        item.state === "registered" && journal.handed(item.id, generation),
    );
  if (!taken.length) return;
  if (status === "saved")
    journal.remove(
      owner,
      taken.map((item) => item.id),
    );
  else if (status === "recovered") {
    const library = new Set(town.state().library);
    journal.remove(
      owner,
      taken.filter((item) => library.has(item.bookId)).map((item) => item.id),
    );
    for (const item of taken)
      if (!library.has(item.bookId))
        journal.update(owner, item.id, { state: "refused" });
  }
}

/** ［もう一度送る］: refused items are sent again, once. */
export async function retryRefused(
  journal: LibraryJournal,
  owner: string,
  town: JournalTown,
  options: SendOptions = {},
): Promise<Sent[]> {
  const ids = refusedItems(journal.items(owner)).map((item) => item.id);
  for (const id of ids) journal.update(owner, id, { state: "ready" });
  return sendJournal(journal, owner, town, { ...options, only: ids });
}

/**
 * ［取り消す］ for a book read in this page: decided when pressed, whatever
 * the card last showed. A book the store took comes back out of the
 * library; one still waiting is never sent. "not-yet" when the town could
 * not take it out now (it is loading): nothing changed.
 */
export function undoScan(
  journal: LibraryJournal,
  owner: string,
  town: JournalTown,
  id: string,
): "undone" | "not-yet" {
  // A book the store took, while the town loads again (another backend):
  // the loading town does not show it, yet it may come back with it.
  if (journal.added.has(id) && !town.ready()) return "not-yet";
  journal.cancelled.add(id);
  const bookId = journal.added.get(id);
  if (bookId && town.state().library.includes(bookId)) {
    town.toggleLibrary(bookId);
    if (town.state().library.includes(bookId)) {
      journal.cancelled.delete(id);
      return "not-yet";
    }
  }
  journal.added.delete(id);
  journal.remove(owner, [id]);
  return "undone";
}

/** What the page's sender says when books kept on the device were registered. */
export function sentNotice(journal: LibraryJournal, sent: Sent[]) {
  const added = sent.filter((entry) => entry.result === "added");
  const earlier = added.filter((entry) => entry.item.page !== journal.page);
  const later = added.length - earlier.length;
  if (earlier.length)
    return (
      `前回のスキャンの続き ${counted(earlier.length, "冊")}を登録しました` +
      (later ? `・控えていた${counted(later, "冊")}も登録しました` : "")
    );
  return later ? `控えていた${counted(later, "冊")}を登録しました` : null;
}

/**
 * The page's sender: settles the journal on every save the town reports,
 * and sends what waits whenever the reader's town is ready on a backend it
 * has not sent to yet, and when the device comes back online. Items of a
 * scan session that is open are left to it, so its cards stay right.
 */
export function createJournalSender(
  journal: LibraryJournal,
  town: JournalTown,
  options: SendOptions & { notify?: (message: string) => void } = {},
) {
  let status: PersistenceStatus | null = null;
  let generation = -1;
  let sentTo = "";
  const send = async (owner: string) => {
    const sent = await sendJournal(journal, owner, town, {
      ...options,
      skip: (item) => journal.live.has(item.session),
    });
    const notice = sentNotice(journal, sent);
    if (notice) options.notify?.(notice);
  };
  const look = () => {
    const owner = town.owner();
    const now = town.status();
    const changed = now !== status || town.generation() !== generation;
    status = now;
    generation = town.generation();
    if (!owner) return;
    // "saved" every time: a save that changed nothing reports nothing new.
    if (changed || now === "saved") settleJournal(journal, owner, town, now);
    const to = owner + " " + generation;
    if (town.ready() && to !== sentTo) {
      sentTo = to;
      void send(owner);
    }
  };
  const online = () => {
    const owner = town.owner();
    if (owner && town.ready()) void send(owner);
  };
  return {
    start() {
      const stop = town.subscribe(look);
      if (typeof window !== "undefined")
        window.addEventListener("online", online);
      look();
      return () => {
        stop();
        if (typeof window !== "undefined")
          window.removeEventListener("online", online);
      };
    },
  };
}

// One sender for the page, started by the first TownApp and kept across
// pages; its notices go to the TownApp shown now.
let pageNotice: Notify | null = null;
let pageSenderStarted = false;

/** Starts the page's sender (once) and gives it this page's notices. */
export function useJournalSender(town: JournalTown, notify: Notify) {
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  useEffect(() => {
    const tell: Notify = (message, undo) => notifyRef.current(message, undo);
    pageNotice = tell;
    if (!pageSenderStarted) {
      pageSenderStarted = true;
      createJournalSender(libraryJournal, town, {
        notify: (message) => pageNotice?.(message),
      }).start();
    }
    return () => {
      if (pageNotice === tell) pageNotice = null;
    };
  }, [town]);
}

const NO_ITEMS: ScanItem[] = [];

/** The reader's journal items, for a screen. */
export function useJournal(
  owner: string | null,
  journal: LibraryJournal = libraryJournal,
): ScanItem[] {
  return useSyncExternalStore(
    journal.subscribe,
    () => (owner ? journal.items(owner) : NO_ITEMS),
    () => NO_ITEMS,
  );
}

/** The items being sent now, for a screen that leaves them out. */
export function useJournalSending(
  journal: LibraryJournal = libraryJournal,
): ReadonlySet<string> {
  return useSyncExternalStore(
    journal.subscribe,
    journal.sending,
    () => NOT_SENDING,
  );
}

/** Whether the journal's last change reached this device's storage. */
export function useJournalKept(journal: LibraryJournal = libraryJournal) {
  return useSyncExternalStore(journal.subscribe, journal.kept, () => true);
}
