import { ME_ID, type Post, type ReadingSession, type TownState } from "./types";

export const activeSession = (state: TownState): ReadingSession | undefined =>
  state.readingSessions.find((session) => session.endedAt === null);

/** The book a new session starts with: the one being read, else the last one left unfinished. */
export function currentBookId(state: TownState): string | null {
  const active = activeSession(state);
  if (active) return active.bookId;
  const last = [...state.readingSessions]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .find((session) => !state.finishedBooks.includes(session.bookId));
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

export function readingTotals(state: TownState, now: number) {
  const byBook = new Map<string, number>();
  let total = 0;
  for (const session of state.readingSessions) {
    const seconds = sessionSeconds(session, now);
    total += seconds;
    byBook.set(session.bookId, (byBook.get(session.bookId) ?? 0) + seconds);
  }
  return { total, byBook };
}

export interface ReaderReadingNow {
  readerId: string;
  bookId: string;
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

/** Memos for a book: everyone's together memos, plus the viewer's own private notes. */
export const readingMemos = (state: TownState, bookId: string): Post[] =>
  state.posts
    .filter(
      (post) =>
        post.bookId === bookId &&
        post.readingMode !== null &&
        (post.readingMode === "together" || post.authorId === ME_ID),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}時間${minutes}分`;
  if (minutes) return `${minutes}分`;
  return seconds ? "1分未満" : "0分";
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
