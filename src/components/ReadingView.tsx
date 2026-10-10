"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ME_ID,
  POST_MAX_LENGTH,
  type Book,
  type ReadingMode,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  activeSession,
  currentBookId,
  formatDuration,
  formatTimer,
  readersNow,
  readingMemos,
  readingTotals,
  sessionSeconds,
} from "../lib/reading";
import { findReader, formatPostTime } from "../lib/social";
import { BookPicker } from "./BookPicker";
import { PostCard } from "./Social";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import { useClock } from "./useClock";
import "./reading.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

const modeLabel: Record<ReadingMode, string> = {
  solo: "一人で読む",
  together: "みんなで読む",
};

export function ReadingView(props: Shared) {
  const clock = useClock();
  const active = activeSession(props.state);
  const book = active
    ? props.state.books.find((entry) => entry.id === active.bookId)
    : undefined;
  return active && book ? (
    <ReadingRoom {...props} book={book} clock={clock} />
  ) : (
    <StartReading {...props} clock={clock} />
  );
}

function minutesSince(startedAt: number, now: number | undefined) {
  return now === undefined
    ? ""
    : `読み始めて${Math.max(1, Math.round((now - startedAt) / 60000))}分`;
}

function ReadersNow({
  state,
  clock,
  bookId,
}: {
  state: TownState;
  clock: ReturnType<typeof useClock>;
  bookId?: string;
}) {
  const all = readersNow(state, clock?.openedAt ?? 0);
  const readers = bookId ? all.filter((entry) => entry.bookId === bookId) : all;
  return (
    <section
      className="readers-now"
      aria-labelledby={"readers-now-" + (bookId ?? "all")}
    >
      <h2 id={"readers-now-" + (bookId ?? "all")}>
        <span className="live-dot" aria-hidden="true" />
        {bookId
          ? `同じ本を、いま${readers.length}人が読んでいます`
          : `いま${readers.length}人が、みんなで読んでいます`}
      </h2>
      {readers.length ? (
        <ul>
          {readers.map((entry) => {
            const reader = findReader(state, entry.readerId);
            const book = state.books.find((item) => item.id === entry.bookId);
            if (!reader || !book) return null;
            return (
              <li key={entry.readerId}>
                <Link href={"/profiles/" + reader.id + "/"}>
                  <ReaderAvatar reader={reader} size={34} />
                  <span>
                    <b>
                      {reader.id === ME_ID ? "あなた" : reader.name}
                      {reader.id !== ME_ID && (
                        <small className="demo-tag">デモの読書家</small>
                      )}
                    </b>
                    <small>
                      {!bookId && <>『{book.title}』・</>}
                      {minutesSince(entry.startedAt, clock?.now)}
                    </small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="reading-muted">
          いまこの本を「みんなで読む」にしている人はいません。
        </p>
      )}
    </section>
  );
}

function StartReading({
  state,
  actions,
  notify,
  clock,
}: Shared & { clock: ReturnType<typeof useClock> }) {
  const current = currentBookId(state);
  // Until the reader picks, follow the book being read (it appears once saved data loads).
  const [picked, setBookId] = useState<string | null | undefined>(undefined);
  const bookId = picked === undefined ? current : picked;
  const recent = [...state.readingSessions]
    .reverse()
    .map((session) => session.bookId);
  const suggestions = [
    ...(current ? [current] : []),
    ...recent,
    ...state.library,
    ...state.wishlist,
  ].filter(
    (entry, index, list) =>
      list.indexOf(entry) === index && !state.finishedBooks.includes(entry),
  );
  const totals = readingTotals(state, clock?.now ?? 0);
  const sessions = [...state.readingSessions].reverse().slice(0, 5);
  function start(mode: ReadingMode) {
    if (!bookId || !actions.startReading(bookId, mode)) return;
    notify(
      mode === "solo"
        ? "一人で読み始めました。メモはあなただけに見えます"
        : "みんなで読み始めました。同じ時間に読んでいる人に見えます",
    );
    window.scrollTo(0, 0);
  }
  return (
    <div className="reading-page">
      <span className="eyebrow">OPEN A BOOK</span>
      <h1 className="page-title">読書を開始</h1>
      <p className="page-subtitle">
        これから読む本を選んで、読み方を決めてください。読書時間を記録します。
      </p>
      <section className="reading-start" aria-label="これから読む本">
        <h2>これから読む本</h2>
        <BookPicker
          books={state.books}
          value={bookId}
          onChange={setBookId}
          label="読む本を探す"
          suggestions={suggestions}
          suggestionLabel="読んでいる本・登録した本・読みたい本"
        />
        {bookId && current === bookId && (
          <p className="reading-muted">いま読んでいる本を選んでいます。</p>
        )}
        <div className="reading-modes">
          <button
            type="button"
            className="reading-mode"
            disabled={!bookId}
            onClick={() => start("solo")}
          >
            <Icon name="lock" size={20} />
            <b>一人で読む</b>
            <small>
              読んでいることは誰にも見えません。メモは自分だけのものです。
            </small>
          </button>
          <button
            type="button"
            className="reading-mode is-together"
            disabled={!bookId}
            onClick={() => start("together")}
          >
            <Icon name="users" size={20} />
            <b>みんなで読む</b>
            <small>
              同じ時間に読んでいる人に、あなたと本が見えます。つぶやきはタイムラインにも流れます。
            </small>
          </button>
        </div>
      </section>
      <ReadersNow state={state} clock={clock} />
      <section className="reading-log" aria-labelledby="reading-log-title">
        <h2 id="reading-log-title">読書の記録</h2>
        <p className="reading-total">
          <Icon name="clock" size={17} />
          これまでの読書時間 <b>{formatDuration(totals.total)}</b>
          <small>・{state.readingSessions.length}回</small>
        </p>
        {sessions.length ? (
          <ul>
            {sessions.map((session) => {
              const book = state.books.find(
                (entry) => entry.id === session.bookId,
              );
              return (
                <li key={session.id}>
                  <span>
                    <b>{book?.title}</b>
                    <small>
                      {formatPostTime(session.startedAt)}・
                      {modeLabel[session.mode]}
                      {state.finishedBooks.includes(session.bookId) && "・読了"}
                    </small>
                  </span>
                  <em>
                    {formatDuration(sessionSeconds(session, clock?.now ?? 0))}
                  </em>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="reading-muted">まだ記録はありません。</p>
        )}
      </section>
    </div>
  );
}

function ReadingRoom({
  state,
  actions,
  notify,
  book,
  clock,
}: Shared & { book: Book; clock: ReturnType<typeof useClock> }) {
  const id = useId();
  const session = activeSession(state);
  const [memo, setMemo] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  if (!session) return null;
  const seconds = clock ? sessionSeconds(session, clock.now) : null;
  const bookTotal = clock
    ? (readingTotals(state, clock.now).byBook.get(book.id) ?? 0)
    : null;
  const memos = readingMemos(state, book.id);
  const together = session.mode === "together";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actions.createPost({ body: memo, spoiler, fromReading: true })) return;
    setMemo("");
    setSpoiler(false);
    notify(together ? "つぶやきました" : "メモしました（自分だけ）");
  }
  return (
    <div className="reading-page">
      <span className="eyebrow">NOW READING</span>
      <section className="reading-now-card" aria-label="読書中">
        <BookJacket book={book} className="reading-jacket" />
        <div className="reading-now-main">
          <span
            className={"reading-mode-tag" + (together ? " is-together" : "")}
          >
            <Icon name={together ? "users" : "lock"} size={13} />
            {modeLabel[session.mode]}
          </span>
          <h1>{book.title}</h1>
          <p>{book.author}</p>
          <p className="reading-timer" role="timer" aria-label="読書時間">
            {seconds === null ? "--:--" : formatTimer(seconds)}
          </p>
          <p className="reading-muted">
            この本の合計 {bookTotal === null ? "—" : formatDuration(bookTotal)}
          </p>
          <div className="reading-end">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                actions.endReading(false);
                notify("読書を終えました。時間を記録しました");
              }}
            >
              読書を終える
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                actions.endReading(true);
                notify(`『${book.title}』を読み終えました`);
              }}
            >
              <Icon name="check" size={16} />
              読み終えた！
            </button>
          </div>
        </div>
      </section>

      <form className="memo-composer" onSubmit={submit}>
        <label htmlFor={id}>
          {together ? "読書中のつぶやき" : "読書メモ（自分だけ）"}
        </label>
        <textarea
          id={id}
          className="field"
          rows={3}
          maxLength={POST_MAX_LENGTH}
          placeholder={
            together
              ? "いま読んでいるところの気持ちを、みんなに"
              : "気になった言葉や、考えたことを残す"
          }
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
        />
        <div className="composer-tools">
          <label className="composer-spoiler">
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(event) => setSpoiler(event.target.checked)}
            />
            ネタバレあり
          </label>
          <span className="composer-count" aria-hidden="true">
            {memo.length}/{POST_MAX_LENGTH}
          </span>
          <button className="button" type="submit" disabled={!memo.trim()}>
            {together ? "つぶやく" : "メモする"}
          </button>
        </div>
      </form>

      <ReadersNow state={state} clock={clock} bookId={book.id} />

      <section className="reading-memos" aria-labelledby="reading-memos-title">
        <h2 id="reading-memos-title">この本の読書中のつぶやき</h2>
        <div className="post-feed">
          {memos.map((post) => (
            <PostCard
              key={post.id}
              state={state}
              actions={actions}
              notify={notify}
              post={post}
            />
          ))}
          {!memos.length && (
            <p className="reading-muted">まだつぶやきはありません。</p>
          )}
        </div>
      </section>
    </div>
  );
}
