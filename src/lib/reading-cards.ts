import type { ReadingSession, TownState } from "./types";

// 読書記録 (item 18): one reading is one card (reading_cards), every book read
// in it a book of that card (reading_card_books, one a span of reading,
// reading_sessions) and 今日のノート are written on it (reading_notes), all of
// it the reader's own. The rules are docs/機能/読書記録.md; here is how the
// town keeps them, and the card's clock worked out from them.

export const READING_TIMERS = ["none", "timer", "pomodoro"] as const;
export type ReadingTimer = (typeof READING_TIMERS)[number];
export const PAGE_UNITS = ["page", "percent", "location", "second"] as const;
export type PageUnit = (typeof PAGE_UNITS)[number];
export const READING_FORMATS = ["paper", "ebook", "audio"] as const;
export type ReadingFormat = (typeof READING_FORMATS)[number];
/** 言葉を調べる (the word itself), 思ったこと, 好きな一文. */
export const NOTE_KINDS = ["word", "thought", "quote"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** The longest note the database keeps. */
export const READING_NOTE_MAX_LENGTH = 2000;
/** The highest page (or percent, location, second) the database keeps. */
export const PAGE_MAX = 1_000_000;
/**
 * A book changed less than this many seconds into reading it takes the
 * place of the one before on the card; later, both stay on it.
 */
export const BOOK_REPLACED_WITHIN = 60;

export interface ReadingCard {
  id: string;
  /** The device's zone when the reading began (Intl), the card's day read in it. */
  timeZone: string;
  /** 記録し忘れた日を、あとから足す: its times are the reader's, not a clock's. */
  addedLater: boolean;
  /** While paused, since when (the device's time, as the sessions'). */
  pausedAt: string | null;
  /** The pauses before it, in seconds. */
  pausedSeconds: number;
  timer: ReadingTimer;
  timerMinutes: number | null;
  restMinutes: number | null;
  timerAt: string | null;
  /** The room and light read in, and the card's look; null for the first. */
  room: string | null;
  light: string | null;
  look: string | null;
  createdAt: string;
}

export interface ReadingCardBook {
  /** Its span of reading: its book, and when it began and ended. */
  sessionId: string;
  cardId: string;
  /** Counted when its span ended, pauses left out; null while read, or not counted. */
  readSeconds: number | null;
  pageFrom: number | null;
  pageTo: number | null;
  pageUnit: PageUnit;
  format: ReadingFormat | null;
  /** この本を読み終えた, in this reading. The book's status is the library's. */
  finished: boolean;
  createdAt: string;
}

export interface ReadingNote {
  id: string;
  cardId: string;
  /** The book of the card it was written at; null for none. */
  sessionId: string | null;
  kind: NoteKind;
  body: string;
  page: number | null;
  createdAt: string;
}

type Cards = Pick<
  TownState,
  "readingSessions" | "readingCards" | "readingCardBooks"
>;

const ms = (time: string) => Date.parse(time);
/** Whole seconds from `from` to `to`, never below nothing. */
const between = (from: string, to: number) =>
  Math.max(0, Math.floor((to - ms(from)) / 1000));
/** The later of two times, so a device's clock set back ends nothing before it began. */
const later = (at: string, than: string) => (ms(at) < ms(than) ? than : at);

export const cardBookOf = (state: Cards, sessionId: string) =>
  state.readingCardBooks.find((book) => book.sessionId === sessionId);

export const cardById = (state: Cards, cardId: string) =>
  state.readingCards.find((card) => card.id === cardId);

/** The spans of a card's books, in the order they were read. */
export function cardSessions(state: Cards, cardId: string): ReadingSession[] {
  const ids = new Set(
    state.readingCardBooks
      .filter((book) => book.cardId === cardId)
      .map((book) => book.sessionId),
  );
  return state.readingSessions
    .filter((session) => ids.has(session.id))
    .sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
}

/** The card being read now, with its book's span: the running session's. */
export function runningCard(
  state: Cards,
): { card: ReadingCard; session: ReadingSession } | null {
  const session = state.readingSessions.find((entry) => entry.endedAt === null);
  const book = session && cardBookOf(state, session.id);
  const card = book && cardById(state, book.cardId);
  return session && card ? { card, session } : null;
}

/** The seconds a card has been paused, by `now`. */
export const pausedSeconds = (card: ReadingCard, now: number): number =>
  card.pausedSeconds + (card.pausedAt ? between(card.pausedAt, now) : 0);

/** A span over: as counted when it ended, else its end less its start. */
const endedSeconds = (state: Cards, session: ReadingSession, now: number) =>
  cardBookOf(state, session.id)?.readSeconds ??
  between(session.startedAt, session.endedAt ? ms(session.endedAt) : now);

/**
 * The seconds a span was read, by `now`. One running on a card is the
 * card's time since its first book began, less its pauses and its other
 * books' time: a book changed keeps the clock going.
 */
export function sessionReadSeconds(
  state: Cards,
  session: ReadingSession,
  now: number,
): number {
  if (session.endedAt !== null) return endedSeconds(state, session, now);
  const book = cardBookOf(state, session.id);
  const card = book && cardById(state, book.cardId);
  if (!card) return between(session.startedAt, now);
  const sessions = cardSessions(state, card.id);
  const others = sessions
    .filter((entry) => entry.id !== session.id)
    .reduce((sum, entry) => sum + endedSeconds(state, entry, now), 0);
  return Math.max(
    0,
    between(sessions[0].startedAt, now) - pausedSeconds(card, now) - others,
  );
}

/** The seconds a card was read by `now`, its books together. */
export const cardReadSeconds = (
  state: Cards,
  cardId: string,
  now: number,
): number =>
  cardSessions(state, cardId).reduce(
    (sum, session) => sum + sessionReadSeconds(state, session, now),
    0,
  );

/** Where a book's next reading starts: the page its last reading in pages ended at. */
export function pageToStartFrom(
  state: Cards,
  bookId: string | null,
): number | null {
  if (bookId === null) return null;
  const sessions = new Map(
    state.readingSessions.map((session) => [session.id, session]),
  );
  let last: { at: number; page: number } | null = null;
  for (const book of state.readingCardBooks) {
    const session = sessions.get(book.sessionId);
    if (
      session?.bookId !== bookId ||
      book.pageUnit !== "page" ||
      book.pageTo === null
    )
      continue;
    const at = ms(session.startedAt);
    if (!last || at >= last.at) last = { at, page: book.pageTo };
  }
  return last?.page ?? null;
}

/** A page as the database keeps it, or null for none or one out of its range. */
export const cleanPage = (page: number | null | undefined): number | null =>
  typeof page === "number" &&
  Number.isInteger(page) &&
  page >= 0 &&
  page <= PAGE_MAX
    ? page
    : null;

/** A note's words as kept: trimmed, null when blank or too long. */
export function cleanNoteBody(body: string): string | null {
  const trimmed = body.replace(/^[\s　]+|[\s　]+$/g, "");
  // Counted by characters, as the database does (char_length).
  return trimmed && [...trimmed].length <= READING_NOTE_MAX_LENGTH
    ? trimmed
    : null;
}

/** The device's zone (Intl), as the card keeps it; Japan's when it cannot tell. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone)) return zone;
  } catch {
    // An old browser: the card is read as Japan's.
  }
  return "Asia/Tokyo";
}

/**
 * The town with a reading begun: `session` (added to the town already) on a
 * new card, its book read from where it was left.
 */
export function withCardBegun<T extends Cards>(
  state: T,
  session: ReadingSession,
  cardId: string,
  timeZone: string,
): T {
  return {
    ...state,
    readingCards: [
      ...state.readingCards,
      newCard(cardId, timeZone, session.startedAt),
    ],
    readingCardBooks: [
      ...state.readingCardBooks,
      bookOnCard(state, session, cardId, null),
    ],
  };
}

const newCard = (
  id: string,
  timeZone: string,
  createdAt: string,
): ReadingCard => ({
  id,
  timeZone,
  addedLater: false,
  pausedAt: null,
  pausedSeconds: 0,
  timer: "none",
  timerMinutes: null,
  restMinutes: null,
  timerAt: null,
  room: null,
  light: null,
  look: null,
  createdAt,
});

const bookOnCard = (
  state: Cards,
  session: ReadingSession,
  cardId: string,
  format: ReadingFormat | null,
): ReadingCardBook => ({
  sessionId: session.id,
  cardId,
  readSeconds: null,
  pageFrom: pageToStartFrom(state, session.bookId),
  pageTo: null,
  pageUnit: "page",
  format,
  finished: false,
  createdAt: session.startedAt,
});

/**
 * A reading added afterwards (記録し忘れた日を、あとから足す, or one read
 * away from the app): when it began, by the reader; how long, null when
 * they cannot say (then it adds no time); where it began and ended; whether
 * the book was finished in it.
 */
export interface ReadingAddedLater {
  startedAt: string;
  seconds: number | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  format?: ReadingFormat | null;
  finished?: boolean;
}

/** The longest reading added afterwards: one sitting, a day at most. */
export const ADDED_READING_MAX_SECONDS = 24 * 60 * 60;

/**
 * The town with a reading added afterwards at `now`: an ended span of
 * `bookId` (`sessionId`, read alone) on a new card said added later. Null
 * when it began or would end after `now`, or its time is not one kept.
 */
export function withReadingAdded<T extends Cards>(
  state: T,
  ids: { sessionId: string; cardId: string },
  bookId: string,
  given: ReadingAddedLater,
  timeZone: string,
  now: string,
): T | null {
  const start = ms(given.startedAt);
  const { seconds } = given;
  if (
    Number.isNaN(start) ||
    (seconds !== null &&
      !(
        Number.isInteger(seconds) &&
        seconds > 0 &&
        seconds <= ADDED_READING_MAX_SECONDS
      )) ||
    start + (seconds ?? 0) * 1000 > ms(now)
  )
    return null;
  const session: ReadingSession = {
    id: ids.sessionId,
    bookId,
    mode: "solo",
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + (seconds ?? 0) * 1000).toISOString(),
  };
  const card: ReadingCard = {
    ...newCard(ids.cardId, timeZone, now),
    addedLater: true,
  };
  const book: ReadingCardBook = {
    sessionId: session.id,
    cardId: card.id,
    readSeconds: seconds ?? 0,
    pageFrom: cleanPage(given.pageFrom),
    pageTo: cleanPage(given.pageTo),
    pageUnit: "page",
    format:
      given.format && READING_FORMATS.includes(given.format)
        ? given.format
        : null,
    finished: given.finished === true,
    createdAt: now,
  };
  return {
    ...state,
    readingSessions: [...state.readingSessions, session],
    readingCards: [...state.readingCards, card],
    readingCardBooks: [...state.readingCardBooks, book],
  };
}

/** The card's clock going again: a pause let go, counted into the pauses. */
const resumed = (card: ReadingCard, now: number): ReadingCard =>
  card.pausedAt
    ? { ...card, pausedAt: null, pausedSeconds: pausedSeconds(card, now) }
    : card;

/**
 * The town with the running span ended at `at`: its book's time counted,
 * and its card's pause let go (ended, the card is not paused). Any other
 * left running (a town kept from before one ran at a time) ends with it.
 */
export function withReadingEnded<T extends Cards>(state: T, at: string): T {
  const running = state.readingSessions.find(
    (session) => session.endedAt === null,
  );
  if (!running) return state;
  return withReadingEnded(spanEnded(state, running, at), at);
}

function spanEnded<T extends Cards>(
  state: T,
  running: ReadingSession,
  at: string,
): T {
  const endedAt = later(at, running.startedAt);
  const now = ms(endedAt);
  const book = cardBookOf(state, running.id);
  const card = book && cardById(state, book.cardId);
  const read = sessionReadSeconds(state, running, now);
  return {
    ...state,
    readingSessions: state.readingSessions.map((session) =>
      session === running ? { ...session, endedAt } : session,
    ),
    readingCardBooks: book
      ? state.readingCardBooks.map((entry) =>
          entry === book ? { ...entry, readSeconds: read } : entry,
        )
      : state.readingCardBooks,
    readingCards: card?.pausedAt
      ? state.readingCards.map((entry) =>
          entry === card ? resumed(entry, now) : entry,
        )
      : state.readingCards,
  };
}

/**
 * The town with the running card's book changed to `bookId` at `at`. Less
 * than BOOK_REPLACED_WITHIN into the book, with nothing written at it, its
 * span is given the new book (`replaced`), as read from the start; else the
 * span ends and a new one (`sessionId`) begins on the same card. Either way the clock goes on, a
 * pause let go: a book chosen is a book being read. Null when nothing runs
 * on a card, or the book is the one being read.
 */
export function withBookChanged<
  T extends Cards & Pick<TownState, "readingNotes">,
>(
  state: T,
  bookId: string,
  at: string,
  sessionId: string,
): { state: T; replaced: boolean } | null {
  const running = runningCard(state);
  if (!running || running.session.bookId === bookId) return null;
  const { card, session } = running;
  const time = later(at, session.startedAt);
  const now = ms(time);
  // A note written at the book keeps it on the card: the note is of it.
  if (
    sessionReadSeconds(state, session, now) < BOOK_REPLACED_WITHIN &&
    !state.readingNotes.some((note) => note.sessionId === session.id)
  ) {
    const changed = { ...session, bookId };
    return {
      replaced: true,
      state: {
        ...state,
        readingSessions: state.readingSessions.map((entry) =>
          entry === session ? changed : entry,
        ),
        readingCardBooks: state.readingCardBooks.map((entry) =>
          entry.sessionId === session.id
            ? {
                ...bookOnCard(state, changed, card.id, entry.format),
                createdAt: entry.createdAt,
              }
            : entry,
        ),
        readingCards: state.readingCards.map((entry) =>
          entry === card ? resumed(entry, now) : entry,
        ),
      },
    };
  }
  const ended = withReadingEnded(state, time);
  const next: ReadingSession = {
    id: sessionId,
    bookId,
    mode: session.mode,
    startedAt: time,
    endedAt: null,
  };
  const format = cardBookOf(state, session.id)?.format ?? null;
  return {
    replaced: false,
    state: {
      ...ended,
      readingSessions: [...ended.readingSessions, next],
      readingCardBooks: [
        ...ended.readingCardBooks,
        bookOnCard(ended, next, card.id, format),
      ],
    },
  };
}

/** The town with the running card paused at `at`; as it was if paused already. */
export function withPaused<T extends Cards>(state: T, at: string): T {
  const running = runningCard(state);
  if (!running || running.card.pausedAt) return state;
  const { card, session } = running;
  return {
    ...state,
    readingCards: state.readingCards.map((entry) =>
      entry === card
        ? { ...entry, pausedAt: later(at, session.startedAt) }
        : entry,
    ),
  };
}

/** The town with the running card's pause let go at `at`. */
export function withResumed<T extends Cards>(state: T, at: string): T {
  const running = runningCard(state);
  if (!running?.card.pausedAt) return state;
  const { card } = running;
  const now = ms(later(at, card.pausedAt as string));
  return {
    ...state,
    readingCards: state.readingCards.map((entry) =>
      entry === card ? resumed(entry, now) : entry,
    ),
  };
}

/**
 * The town with a card just ended read on (読書にもどる) at `at`: its last
 * book's span runs again, the time between counted as a pause. Null while
 * something runs, when the card has no span ended or was added afterwards,
 * or when a reading began after it (only the last reading is read on).
 */
export function withReadOn<T extends Cards>(
  state: T,
  cardId: string,
  at: string,
): T | null {
  if (state.readingSessions.some((session) => session.endedAt === null))
    return null;
  const card = cardById(state, cardId);
  const last = cardSessions(state, cardId).at(-1);
  if (!card || card.addedLater || !last?.endedAt) return null;
  if (
    state.readingSessions.some(
      (session) => ms(session.startedAt) > ms(last.startedAt),
    )
  )
    return null;
  const gap = between(last.endedAt, ms(later(at, last.endedAt)));
  return {
    ...state,
    readingSessions: state.readingSessions.map((session) =>
      session === last ? { ...session, endedAt: null } : session,
    ),
    readingCardBooks: state.readingCardBooks.map((book) =>
      book.sessionId === last.id ? { ...book, readSeconds: null } : book,
    ),
    readingCards: state.readingCards.map((entry) =>
      entry === card
        ? { ...entry, pausedSeconds: entry.pausedSeconds + gap }
        : entry,
    ),
  };
}

/**
 * The town without a card (記録しない): its books' spans, its books and its
 * notes go with it.
 */
export function withCardDiscarded<
  T extends Cards & Pick<TownState, "readingNotes">,
>(state: T, cardId: string): T {
  if (!cardById(state, cardId)) return state;
  const sessions = new Set(
    state.readingCardBooks
      .filter((book) => book.cardId === cardId)
      .map((book) => book.sessionId),
  );
  return {
    ...state,
    readingSessions: state.readingSessions.filter(
      (session) => !sessions.has(session.id),
    ),
    readingCards: state.readingCards.filter((card) => card.id !== cardId),
    readingCardBooks: state.readingCardBooks.filter(
      (book) => book.cardId !== cardId,
    ),
    readingNotes: state.readingNotes.filter((note) => note.cardId !== cardId),
  };
}

/** What the reader says of a book of a card: どこまで読んだ, この本を読み終えた. */
export type CardBookChange = Partial<
  Pick<ReadingCardBook, "pageTo" | "finished">
>;

/** The town with a book of a card changed; as it was when nothing changes. */
export function withCardBookChanged<T extends Cards>(
  state: T,
  sessionId: string,
  change: CardBookChange,
): T {
  const book = cardBookOf(state, sessionId);
  if (!book) return state;
  const next: ReadingCardBook = {
    ...book,
    ...(change.pageTo !== undefined && { pageTo: cleanPage(change.pageTo) }),
    ...(change.finished !== undefined && { finished: change.finished }),
  };
  if (next.pageTo === book.pageTo && next.finished === book.finished)
    return state;
  return {
    ...state,
    readingCardBooks: state.readingCardBooks.map((entry) =>
      entry === book ? next : entry,
    ),
  };
}

/** The book of a card a note is written at: the one read now, else its last. */
export function noteSessionOf(state: Cards, cardId: string): string | null {
  const sessions = cardSessions(state, cardId);
  return (
    sessions.find((session) => session.endedAt === null)?.id ??
    sessions.at(-1)?.id ??
    null
  );
}

/** A card's notes, in the order they were written. */
export const cardNotes = (
  state: Pick<TownState, "readingNotes">,
  cardId: string,
): ReadingNote[] =>
  state.readingNotes
    .filter((note) => note.cardId === cardId)
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

/** What can be changed of a note: its kind, words and page. */
export type NoteChange = Partial<Pick<ReadingNote, "kind" | "body" | "page">>;

/** A note changed, or null when nothing changes or the words would not be kept. */
export function changedNote(
  note: ReadingNote,
  change: NoteChange,
): ReadingNote | null {
  const body =
    change.body === undefined ? note.body : cleanNoteBody(change.body);
  const kind = change.kind ?? note.kind;
  if (body === null || !NOTE_KINDS.includes(kind)) return null;
  const next: ReadingNote = {
    ...note,
    kind,
    body,
    page: change.page === undefined ? note.page : cleanPage(change.page),
  };
  return next.kind === note.kind &&
    next.body === note.body &&
    next.page === note.page
    ? null
    : next;
}

/** Read back from the device or the database: a card, if it is one. */
export function readCard(value: unknown): ReadingCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Partial<ReadingCard>;
  const text = (v: unknown) => typeof v === "string";
  const name = (v: unknown) => v === null || typeof v === "string";
  const minutes = (v: unknown) =>
    v === null || (typeof v === "number" && Number.isInteger(v) && v > 0);
  if (
    !text(card.id) ||
    !text(card.timeZone) ||
    typeof card.addedLater !== "boolean" ||
    !(card.pausedAt === null || text(card.pausedAt)) ||
    typeof card.pausedSeconds !== "number" ||
    !READING_TIMERS.includes(card.timer as ReadingTimer) ||
    !minutes(card.timerMinutes) ||
    !minutes(card.restMinutes) ||
    !(card.timerAt === null || text(card.timerAt)) ||
    !name(card.room) ||
    !name(card.light) ||
    !name(card.look) ||
    !text(card.createdAt)
  )
    return null;
  return {
    id: card.id as string,
    timeZone: card.timeZone as string,
    addedLater: card.addedLater,
    pausedAt: card.pausedAt as string | null,
    pausedSeconds: Math.max(0, Math.floor(card.pausedSeconds)),
    timer: card.timer as ReadingTimer,
    timerMinutes: card.timerMinutes as number | null,
    restMinutes: card.restMinutes as number | null,
    timerAt: card.timerAt as string | null,
    room: card.room as string | null,
    light: card.light as string | null,
    look: card.look as string | null,
    createdAt: card.createdAt as string,
  };
}

/** Read back: a book of a card, if it is one. */
export function readCardBook(value: unknown): ReadingCardBook | null {
  if (!value || typeof value !== "object") return null;
  const book = value as Partial<ReadingCardBook>;
  const page = (v: unknown) => v === null || cleanPage(v as number) !== null;
  if (
    typeof book.sessionId !== "string" ||
    typeof book.cardId !== "string" ||
    !(
      book.readSeconds === null ||
      (typeof book.readSeconds === "number" && book.readSeconds >= 0)
    ) ||
    !page(book.pageFrom) ||
    !page(book.pageTo) ||
    !PAGE_UNITS.includes(book.pageUnit as PageUnit) ||
    !(
      book.format === null ||
      READING_FORMATS.includes(book.format as ReadingFormat)
    ) ||
    typeof book.finished !== "boolean" ||
    typeof book.createdAt !== "string"
  )
    return null;
  return {
    sessionId: book.sessionId,
    cardId: book.cardId,
    readSeconds:
      book.readSeconds === null ? null : Math.floor(book.readSeconds as number),
    pageFrom: book.pageFrom as number | null,
    pageTo: book.pageTo as number | null,
    pageUnit: book.pageUnit as PageUnit,
    format: book.format as ReadingFormat | null,
    finished: book.finished,
    createdAt: book.createdAt,
  };
}

/** Read back: a note, if it is one. */
export function readNote(value: unknown): ReadingNote | null {
  if (!value || typeof value !== "object") return null;
  const note = value as Partial<ReadingNote>;
  if (
    typeof note.id !== "string" ||
    typeof note.cardId !== "string" ||
    !(note.sessionId === null || typeof note.sessionId === "string") ||
    !NOTE_KINDS.includes(note.kind as NoteKind) ||
    typeof note.body !== "string" ||
    cleanNoteBody(note.body) === null ||
    !(note.page === null || cleanPage(note.page) !== null) ||
    typeof note.createdAt !== "string"
  )
    return null;
  return {
    id: note.id,
    cardId: note.cardId,
    sessionId: note.sessionId as string | null,
    kind: note.kind as NoteKind,
    body: note.body,
    page: note.page as number | null,
    createdAt: note.createdAt,
  };
}

/**
 * A reading's cards, books and notes as kept together: each card once, each
 * book of a card there and of a span there, each note of a card there (its
 * book let go when that is not on its card).
 */
export function keptCards(
  sessions: ReadingSession[],
  cards: ReadingCard[],
  books: ReadingCardBook[],
  notes: ReadingNote[],
): Pick<TownState, "readingCards" | "readingCardBooks" | "readingNotes"> {
  const cardIds = new Set<string>();
  const readingCards = cards.filter((card) => {
    if (cardIds.has(card.id)) return false;
    cardIds.add(card.id);
    return true;
  });
  const sessionIds = new Set(sessions.map((session) => session.id));
  const bookOf = new Map<string, string>();
  const readingCardBooks = books.filter((book) => {
    if (
      !cardIds.has(book.cardId) ||
      !sessionIds.has(book.sessionId) ||
      bookOf.has(book.sessionId)
    )
      return false;
    bookOf.set(book.sessionId, book.cardId);
    return true;
  });
  const noteIds = new Set<string>();
  const readingNotes = notes.flatMap((note): ReadingNote[] => {
    if (!cardIds.has(note.cardId) || noteIds.has(note.id)) return [];
    noteIds.add(note.id);
    return [
      note.sessionId !== null && bookOf.get(note.sessionId) !== note.cardId
        ? { ...note, sessionId: null }
        : note,
    ];
  });
  return { readingCards, readingCardBooks, readingNotes };
}
