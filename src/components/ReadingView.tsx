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
  readingFeed,
  readingTotals,
  sessionSeconds,
} from "../lib/reading";
import { findReader, formatPostTime } from "../lib/social";
import { BookPicker } from "./BookPicker";
import { PostCard, PostComposer } from "./Social";
import { RecordSheet } from "./ReadingRecords";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { useClock } from "./useClock";
import "./reading.css";
import { isDatabaseId, profilePath } from "../lib/paths";
import { bookPath } from "../lib/books";
import { recentlyFinished } from "../lib/records";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

const modeLabel: Record<ReadingMode, string> = {
  solo: "一人で読む",
  together: "みんなで読む",
};

// A small greeting picked at random each time, before opening and before closing a book.
const START_PHRASES = [
  "コーヒーのご用意はできましたか？",
  "お茶、いれましたか？",
  "スマホの通知は、少しお休みにしますか？",
  "お気に入りの椅子に、座れましたか？",
  "部屋の明かりは、ちょうどいいですか？",
  "深呼吸をひとつ、どうぞ。",
  "ブランケットは、手の届くところに？",
  "今日の一ページ目へ、ようこそ。",
];
const END_PHRASES = [
  "しおりは、ちゃんと挟めましたか？",
  "最後に読んだ一文、覚えていますか？",
  "冷めたコーヒー、飲み干しましたか？",
  "本を閉じる前に、ひとこと残しますか？",
  "今日はここまで。また続きで会いましょう。",
];
const FINISH_PHRASES = [
  "最後のページまで、おつかれさまでした。",
  "読み終えた気持ちを、少しだけ言葉にしてみませんか？",
  "この本は、あなたの棚に並びそうですか？",
  "余韻は、もう少し味わいますか？",
];
const pick = (phrases: string[]) =>
  phrases[Math.floor(Math.random() * phrases.length)];

export function ReadingView(props: Shared) {
  const clock = useClock();
  const active = activeSession(props.state);
  const book = active?.bookId
    ? props.state.books.find((entry) => entry.id === active.bookId)
    : undefined;
  // After closing the book, "感想を書く" opens a composer for the book just read.
  const [review, setReview] = useState<{ book?: Book } | null>(null);
  // Finishing a book goes on to how it felt.
  const [finished, setFinished] = useState<Book | null>(null);
  // Closing the book leaves a small card of what this time was.
  const [closed, setClosed] = useState<Closed | null>(null);
  return (
    <>
      {active ? (
        <ReadingRoom
          {...props}
          book={book}
          clock={clock}
          onReview={(read) => setReview({ book: read })}
          onFinished={setFinished}
          onClosed={setClosed}
        />
      ) : (
        <>
          {closed && (
            <ClosedCard
              closed={closed}
              onReview={() => {
                setReview({ book: closed.book });
                setClosed(null);
              }}
              onDismiss={() => setClosed(null)}
            />
          )}
          <StartReading {...props} clock={clock} />
        </>
      )}
      {finished && (
        <RecordSheet
          {...props}
          book={finished}
          onClose={() => setFinished(null)}
        />
      )}
      {review && (
        <Modal
          title={review.book ? `『${review.book.title}』の感想` : "感想を書く"}
          onClose={() => setReview(null)}
        >
          <PostComposer
            {...props}
            fixedBook={review.book}
            autoFocus
            onDone={() => setReview(null)}
          />
        </Modal>
      )}
    </>
  );
}

/** Everyone's reading-together posts, across every book; the viewer's private notes too. */
function ReadingFeed({
  state,
  actions,
  notify,
  excludeMine = false,
}: Shared & { excludeMine?: boolean }) {
  const posts = readingFeed(state)
    .filter((post) => !excludeMine || post.authorId !== ME_ID)
    .slice(0, 30);
  return (
    <section className="reading-memos" aria-labelledby="reading-feed-title">
      <h2 id="reading-feed-title">みんなの読書中のつぶやき</h2>
      <div className="post-feed">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            state={state}
            actions={actions}
            notify={notify}
            post={post}
            showBook
          />
        ))}
        {!posts.length && (
          <p className="reading-muted">
            最初のつぶやきは、あなたのものかもしれません。
          </p>
        )}
      </div>
    </section>
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
  // An empty room for one book says nothing; the room for the whole town
  // shows what was read lately instead of a zero.
  if (!readers.length && bookId) return null;
  if (!readers.length) {
    const finished = recentlyFinished(state)
      .map((id) => state.books.find((book) => book.id === id))
      .filter((book): book is Book => Boolean(book));
    return (
      <section
        className="readers-now is-quiet"
        aria-labelledby="readers-now-all"
      >
        <h2 id="readers-now-all">いまは、まだ誰も読みはじめていません</h2>
        <p className="reading-muted">あなたが今日の一人目かもしれません。</p>
        {finished.length > 0 && (
          <div className="readers-now-finished">
            <h3>最近、街で読み終えられた本</h3>
            <ul>
              {finished.map((book) => (
                <li key={book.id}>
                  <Link href={bookPath(book.id)} title={book.title}>
                    <BookJacket book={book} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }
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
      <ul>
        {readers.map((entry) => {
          const reader = findReader(state, entry.readerId);
          const book = state.books.find((item) => item.id === entry.bookId);
          if (!reader) return null;
          return (
            <li key={entry.readerId}>
              <Link href={profilePath(reader.id)}>
                <ReaderAvatar reader={reader} size={34} />
                <span>
                  <b>
                    {reader.id === ME_ID ? "あなた" : reader.name}
                    {reader.id !== ME_ID && !isDatabaseId(reader.id) && (
                      <small className="demo-tag">見本の読書家</small>
                    )}
                  </b>
                  <small>
                    {!bookId &&
                      (book ? <>『{book.title}』・</> : <>本を選ばずに・</>)}
                    {minutesSince(entry.startedAt, clock?.now)}
                  </small>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Closed = { book?: Book; seconds: number; memo?: string };

/** Just after closing the book: this sitting's time, the book, a line written. */
function ClosedCard({
  closed,
  onReview,
  onDismiss,
}: {
  closed: Closed;
  onReview: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="reading-closed" aria-label="今日の読書" role="status">
      {closed.book && (
        <BookJacket book={closed.book} className="reading-closed-jacket" />
      )}
      <div>
        <p className="reading-closed-time">
          今日の読書 <b>{formatDuration(Math.max(1, closed.seconds))}</b>
        </p>
        {closed.book && (
          <p className="reading-closed-title">『{closed.book.title}』</p>
        )}
        {closed.memo && (
          <blockquote className="reading-closed-memo">{closed.memo}</blockquote>
        )}
        <div className="reading-closed-actions">
          <button type="button" className="button secondary" onClick={onReview}>
            <Icon name="pen" size={15} />
            感想を書く
          </button>
          <button type="button" className="text-button" onClick={onDismiss}>
            閉じる
          </button>
        </div>
      </div>
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
    .flatMap((session) => (session.bookId ? [session.bookId] : []));
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
  const [confirm, setConfirm] = useState<{
    mode: ReadingMode;
    phrase: string;
  } | null>(null);
  const chosen = bookId
    ? state.books.find((entry) => entry.id === bookId)
    : undefined;
  function start(mode: ReadingMode) {
    setConfirm(null);
    if (!actions.startReading(bookId, mode)) return;
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
        読み方を選ぶと、読書時間の記録が始まります。本は選ばなくても始められます。
      </p>
      <section className="reading-start" aria-label="これから読む本">
        <h2>
          これから読む本{" "}
          <small className="reading-optional">選ばなくてもOK</small>
        </h2>
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
            onClick={() =>
              setConfirm({ mode: "solo", phrase: pick(START_PHRASES) })
            }
          >
            <Icon name="lock" size={20} />
            <b>一人で読む</b>
            <small>
              読んでいることは誰にも見えません。メモは自分だけのものです。
            </small>
          </button>
          <button
            type="button"
            className="reading-mode"
            onClick={() =>
              setConfirm({ mode: "together", phrase: pick(START_PHRASES) })
            }
          >
            <Icon name="users" size={20} />
            <b>みんなで読む</b>
            <small>
              同じ時間に読んでいる人に、あなたが読書中だと見えます。つぶやきはタイムラインにも流れます。
            </small>
          </button>
        </div>
      </section>
      <ReadersNow state={state} clock={clock} />
      <ReadingFeed state={state} actions={actions} notify={notify} />
      <section className="reading-log" aria-labelledby="reading-log-title">
        <h2 id="reading-log-title">読書の記録</h2>
        {sessions.length > 0 && (
          <p className="reading-total">
            <Icon name="clock" size={17} />
            これまでの読書時間 <b>{formatDuration(totals.total)}</b>
            <small>・{state.readingSessions.length}回</small>
          </p>
        )}
        {sessions.length ? (
          <ul>
            {sessions.map((session) => {
              const book = state.books.find(
                (entry) => entry.id === session.bookId,
              );
              return (
                <li key={session.id}>
                  <span>
                    <b>{book?.title ?? "本を選ばずに"}</b>
                    <small>
                      {formatPostTime(session.startedAt)}・
                      {modeLabel[session.mode]}
                      {session.bookId &&
                        state.finishedBooks.includes(session.bookId) &&
                        "・読了"}
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
          <p className="reading-muted">
            読みはじめると、ここに日付と読んだ時間が残ります。
          </p>
        )}
      </section>
      {confirm && (
        <Modal title="読書をはじめますか？" onClose={() => setConfirm(null)}>
          <div className="reading-confirm">
            <p className="reading-confirm-phrase">{confirm.phrase}</p>
            <p className="reading-confirm-detail">
              <Icon
                name={confirm.mode === "together" ? "users" : "lock"}
                size={14}
              />
              {modeLabel[confirm.mode]}・
              {chosen ? `『${chosen.title}』` : "本を選ばずに"}
            </p>
            <div className="reading-confirm-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setConfirm(null)}
              >
                もう少し準備する
              </button>
              <button
                type="button"
                className="button"
                onClick={() => start(confirm.mode)}
              >
                はじめる
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReadingRoom({
  state,
  actions,
  notify,
  book,
  clock,
  onReview,
  onFinished,
  onClosed,
}: Shared & {
  book?: Book;
  clock: ReturnType<typeof useClock>;
  onReview: (book?: Book) => void;
  onFinished: (book: Book) => void;
  onClosed: (closed: Closed) => void;
}) {
  const id = useId();
  const session = activeSession(state);
  const [memo, setMemo] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [ending, setEnding] = useState<{
    finished: boolean;
    phrase: string;
  } | null>(null);
  if (!session) return null;
  const seconds = clock ? sessionSeconds(session, clock.now) : null;
  const bookTotal =
    clock && book
      ? (readingTotals(state, clock.now).byBook.get(book.id) ?? 0)
      : null;
  const together = session.mode === "together";
  // What the reader wrote during this sitting stays in view; everyone
  // else's words wait behind a fold until a break.
  const startedAt = Date.parse(session.startedAt);
  const written = state.posts
    .filter(
      (post) =>
        post.authorId === ME_ID &&
        post.readingMode !== null &&
        post.parentId === null &&
        Date.parse(post.createdAt) >= startedAt,
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !actions.createPost({
        body: memo,
        spoiler: Boolean(book) && spoiler,
        fromReading: true,
      })
    )
      return;
    setMemo("");
    setSpoiler(false);
    notify(together ? "つぶやきました" : "メモしました（自分だけ）");
  }
  return (
    <div className="reading-page">
      <span className="eyebrow">NOW READING</span>
      <section className="reading-now-card" aria-label="読書中">
        {book ? (
          <BookJacket book={book} className="reading-jacket" />
        ) : (
          <span className="reading-jacket reading-no-book" aria-hidden="true">
            <Icon name="reading" size={34} />
          </span>
        )}
        <div className="reading-now-main">
          <span
            className={"reading-mode-tag" + (together ? " is-together" : "")}
          >
            <Icon name={together ? "users" : "lock"} size={13} />
            {modeLabel[session.mode]}
          </span>
          <h1>{book ? book.title : "読書中"}</h1>
          <p>{book ? book.author : "本を選ばずに読んでいます"}</p>
          <p className="reading-timer" role="timer" aria-label="読書時間">
            {seconds === null ? "--:--" : formatTimer(seconds)}
          </p>
          {book && (
            <p className="reading-muted">
              この本の合計{" "}
              {bookTotal === null ? "—" : formatDuration(bookTotal)}
            </p>
          )}
          <div className="reading-end">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                setEnding({ finished: false, phrase: pick(END_PHRASES) })
              }
            >
              読書を終える
            </button>
            {book && (
              <button
                type="button"
                className="button"
                onClick={() =>
                  setEnding({ finished: true, phrase: pick(FINISH_PHRASES) })
                }
              >
                <Icon name="check" size={16} />
                読み終えた！
              </button>
            )}
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
          {book && (
            <label className="composer-spoiler">
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(event) => setSpoiler(event.target.checked)}
              />
              ネタバレあり
            </label>
          )}
          <span className="composer-count" aria-hidden="true">
            {memo.length}/{POST_MAX_LENGTH}
          </span>
          <button className="button" type="submit" disabled={!memo.trim()}>
            {together ? "つぶやく" : "メモする"}
          </button>
        </div>
      </form>

      {written.length > 0 && (
        <section className="reading-mine" aria-label="今回書いたこと">
          <div className="post-feed">
            {written.map((post) => (
              <PostCard
                key={post.id}
                state={state}
                actions={actions}
                notify={notify}
                post={post}
              />
            ))}
          </div>
        </section>
      )}
      {together && <ReadersNow state={state} clock={clock} bookId={book?.id} />}
      <details className="reading-peek">
        <summary>
          <Icon name="chevron" size={14} />
          ひと休みに、
          {together ? "みんなのつぶやき" : "街の読書"}
          をのぞく
        </summary>
        {!together && (
          <ReadersNow state={state} clock={clock} bookId={book?.id} />
        )}
        <ReadingFeed
          state={state}
          actions={actions}
          notify={notify}
          excludeMine
        />
      </details>
      {ending && (
        <Modal
          title={ending.finished ? "読み終えましたか？" : "読書を終えますか？"}
          onClose={() => setEnding(null)}
        >
          <div className="reading-confirm">
            <p className="reading-confirm-phrase">{ending.phrase}</p>
            <p className="reading-confirm-detail">
              <Icon name="clock" size={14} />
              今回の読書 {seconds === null ? "—" : formatDuration(seconds)}
              {book && `・『${book.title}』`}
            </p>
            <div className="reading-confirm-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEnding(null)}
              >
                もう少し読む
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  actions.endReading(ending.finished);
                  onReview(book);
                }}
              >
                <Icon name="pen" size={15} />
                感想を書く
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  actions.endReading(ending.finished);
                  // Finishing a book asks how it felt; the record says the rest.
                  if (ending.finished && book) onFinished(book);
                  else
                    onClosed({
                      book,
                      seconds: seconds ?? 0,
                      memo: written.find((post) => post.body.trim())?.body,
                    });
                  setEnding(null);
                }}
              >
                {ending.finished ? "読み終えた" : "本を閉じる"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
