import { ME_ID, type Post, type ReadingSession, type TownState } from "./types";
import { uncoverHidden } from "./hidden-words";
import { notLeftOut } from "./social";
import { counted } from "./words";
import { booksOfWork } from "./works";
import { sessionReadSeconds } from "./reading-cards";

export const activeSession = (state: TownState): ReadingSession | undefined =>
  state.readingSessions.find((session) => session.endedAt === null);

/**
 * Whether the reader has finished the book: their own of its work, whoever's
 * book is asked about (booksOfWork). Read from finishedBooks today; the
 * library's status (L1) takes its place here, and nothing else changes.
 */
export function hasFinished(
  state: Pick<TownState, "finishedBooks" | "books">,
  bookId: string | null,
): boolean {
  if (bookId === null) return false;
  const work = booksOfWork(state.books, bookId);
  return state.finishedBooks.some((id) => work.has(id));
}

/** The book a new session starts with: the one being read, else the last one left unfinished. */
export function currentBookId(state: TownState): string | null {
  const active = activeSession(state);
  if (active) return active.bookId;
  const last = [...state.readingSessions]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .find(
      (session) =>
        session.bookId !== null &&
        !state.finishedBooks.includes(session.bookId),
    );
  return last?.bookId ?? null;
}

export const sessionSeconds = (session: ReadingSession, now: number): number =>
  Math.max(
    0,
    Math.floor(
      ((session.endedAt ? Date.parse(session.endedAt) : now) -
        Date.parse(session.startedAt)) /
        1000,
    ),
  );

/** Time read, by `now`: in all, and by book. A card's pauses are left out. */
export function readingTotals(state: TownState, now: number) {
  const byBook = new Map<string, number>();
  let total = 0;
  // A span over is as counted when it ended (sessionReadSeconds), looked
  // up once here: this runs on every tick of the clock.
  const readSeconds = new Map(
    state.readingCardBooks.map((book) => [book.sessionId, book.readSeconds]),
  );
  for (const session of state.readingSessions) {
    const seconds =
      session.endedAt === null
        ? sessionReadSeconds(state, session, now)
        : (readSeconds.get(session.id) ?? sessionSeconds(session, now));
    total += seconds;
    if (session.bookId)
      byBook.set(session.bookId, (byBook.get(session.bookId) ?? 0) + seconds);
  }
  return { total, byBook };
}

export interface ReaderReadingNow {
  readerId: string;
  bookId: string | null;
  startedAt: number;
}

/**
 * Readers who chose "みんなで読む". Demo readers count back from when the page opened;
 * the viewer appears only while their own session is set to together.
 */
export function readersNow(
  state: TownState,
  openedAt: number,
): ReaderReadingNow[] {
  const demo = state.readingNow.map((entry) => ({
    readerId: entry.readerId,
    bookId: entry.bookId,
    startedAt: openedAt - entry.minutesAgo * 60_000,
  }));
  const active = activeSession(state);
  return active?.mode === "together"
    ? [
        {
          readerId: ME_ID,
          bookId: active.bookId,
          startedAt: Date.parse(active.startedAt),
        },
        ...demo,
      ]
    : demo;
}

/**
 * Everyone's reading-together posts across all books, plus the viewer's
 * private notes; spoilers the reader chose not to see are left out.
 */
export const readingFeed = (state: TownState): Post[] =>
  state.posts
    .filter(
      (post) =>
        (post.readingMode === "together" ||
          (post.readingMode === "solo" && post.authorId === ME_ID)) &&
        notLeftOut(state, post),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/** Time read, in words that never show a 0: whole hours alone, else 「1分未満」. */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours)
    return minutes
      ? `${counted(hours, "時間")}${counted(minutes, "分")}`
      : `${counted(hours, "時間")}`;
  if (minutes) return `${counted(minutes, "分")}`;
  return "1分未満";
}

export function formatTimer(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${pad(minutes)}:${pad(rest)}`;
}

/**
 * A book left unfinished, to pick up again from the home screen, with the
 * reader's last words about it. Nothing while a session runs (the reading
 * page already holds it) or before anything was read.
 */
export function bookToContinue(
  state: TownState,
): { bookId: string; lastWords: string | null } | null {
  if (activeSession(state)) return null;
  const bookId = currentBookId(state);
  if (!bookId) return null;
  const last = state.posts
    .filter(
      (post) =>
        post.authorId === ME_ID &&
        post.bookId === bookId &&
        post.readingMode !== null &&
        post.body.trim(),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return { bookId, lastWords: last ? uncoverHidden(last.body).trim() : null };
}
