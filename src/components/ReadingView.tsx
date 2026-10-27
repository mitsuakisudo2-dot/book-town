"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
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
} from "../lib/reading";
import { sessionReadSeconds } from "../lib/reading-cards";
import { findReader, formatPostTime } from "../lib/social";
import { BookPicker } from "./BookPicker";
import { booksBeforeSearch } from "../lib/book-lists";
import {
  HiddenWordsHint,
  HideWordsButton,
  LengthNearLimit,
  PostComposer,
} from "./Social";
import { LetterCard } from "./letter/LetterCard";
import { RecordSheet } from "./ReadingRecords";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { useClock } from "./useClock";
import "./reading.css";
import { profilePath } from "../lib/paths";
import { isSampleId } from "../lib/record-kind";
import { bookPath, myBookPath } from "../lib/books";
import { recentlyFinished } from "../lib/records";
import { uncoverHidden } from "../lib/hidden-words";
import { focusField } from "../lib/coarse-pointer";
import { setReadingPeekOpen, useReadingPeekOpen } from "../lib/reading-peek";
import {
  appendPostDraft,
  carryPostDraft,
  clearPostDraft,
  postDraftKey,
  readingDraftKey,
  usePostDraft,
  useReadingDrafts,
} from "../lib/post-draft";
import {
  DiscardDraft,
  KeptDraftNote,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import {
  bookAuthor,
  bookById,
  booksById,
  bookTitle,
  quotedTitle,
} from "../lib/book-name";
import {
  counted,
  whenSome,
  failure,
  offlineFor,
  WHILE_OFFLINE,
  NAMES,
} from "../lib/words";
import { inManageMode } from "../lib/town-mode";
import { townOffline } from "../lib/store";
import { booksOfWork } from "../lib/works";

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

/** The draft a review of the book read starts from (a new post without one). */
const reviewDraftKey = (owner: string, book?: Book) =>
  postDraftKey(owner, { bookId: book?.id });

/**
 * Carries the line written in a sitting into the review of its book, when
 * that has nothing written yet; otherwise the review shows it (LineToAdd).
 */
const carryLine = (owner: string, sessionId: string, book?: Book) =>
  carryPostDraft(
    readingDraftKey(owner, sessionId),
    reviewDraftKey(owner, book),
  );

export function ReadingView(props: Shared) {
  const clock = useClock();
  const active = activeSession(props.state);
  const book = active?.bookId
    ? bookById(props.state.books, active.bookId)
    : undefined;
  // After closing the book, "感想を書く" opens a composer for the book just
  // read, with the sitting whose line was meant for it.
  const [review, setReview] = useState<{
    book?: Book;
    line?: string;
  } | null>(null);
  // Finishing a book goes on to how it felt.
  const [finished, setFinished] = useState<Book | null>(null);
  // Closing the book leaves a small card of what this time was.
  const [closed, setClosed] = useState<Closed | null>(null);
  // The review opens within the tap that asks for it, so a phone's keyboard
  // rises with its text box (Modal's `writing`). From the reading room the
  // sitting's end, asked for in the same tap, is rendered with it.
  const openReview = (read?: Book, line?: string) =>
    flushSync(() => setReview({ book: read, line }));
  // 読書管理モード: reading alone, nothing written for others (town-mode.ts).
  const manage = inManageMode(props.state);
  return (
    <>
      {active ? (
        <ReadingRoom
          key={active.id}
          {...props}
          book={book}
          clock={clock}
          onReview={openReview}
          onFinished={setFinished}
          onClosed={setClosed}
        />
      ) : (
        <>
          {closed && (
            <ClosedCard
              closed={closed}
              onReview={
                manage
                  ? null
                  : () =>
                      flushSync(() => {
                        setReview({ book: closed.book });
                        setClosed(null);
                      })
              }
              onDismiss={() => setClosed(null)}
            />
          )}
          <UnsentLines {...props} onReview={openReview} />
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
          title={
            review.book ? `${quotedTitle(review.book)}の感想` : "感想を書く"
          }
          onClose={() => setReview(null)}
          writing
        >
          {review.line && (
            <LineToAdd
              sessionId={review.line}
              book={review.book}
              notify={props.notify}
            />
          )}
          <PostComposer
            {...props}
            fixedBook={review.book}
            sheet
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
      <h2 id="reading-feed-title">みんなの読書中の{NAMES.letter}</h2>
      <div className="post-feed">
        {posts.map((post) => (
          <LetterCard
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
            最初の{NAMES.letter}は、あなたのものかもしれません。
          </p>
        )}
      </div>
    </section>
  );
}

function minutesSince(startedAt: number, now: number | undefined) {
  return now === undefined
    ? ""
    : `読み始めて${counted(Math.max(1, Math.round((now - startedAt) / 60000)), "分")}`;
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
  // Readers of the book's work: whose own book it is does not matter here.
  const work = bookId ? booksOfWork(state.books, bookId) : null;
  const readers = work
    ? all.filter((entry) => entry.bookId !== null && work.has(entry.bookId))
    : all;
  // An empty room for one book says nothing; the room for the whole town
  // shows what was read lately instead of a zero.
  if (!readers.length && bookId) return null;
  if (!readers.length) {
    const finished = booksById(state.books, recentlyFinished(state));
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
                  <Link href={bookPath(book.id)} title={bookTitle(book)}>
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
          ? whenSome(
              readers.length,
              "人",
              (c) => `同じ本を、いま${c}が読んでいます`,
            )
          : whenSome(
              readers.length,
              "人",
              (c) => `いま${c}が、みんなで読んでいます`,
            )}
      </h2>
      <ul>
        {readers.map((entry) => {
          const reader = findReader(state, entry.readerId);
          const book = bookById(state.books, entry.bookId);
          if (!reader) return null;
          return (
            <li key={entry.readerId}>
              <Link href={profilePath(reader.id)}>
                <ReaderAvatar reader={reader} size={34} />
                <span>
                  <b>
                    {reader.id === ME_ID ? "あなた" : reader.name}
                    {isSampleId(reader.id) && (
                      <small className="demo-tag">見本の読書家</small>
                    )}
                  </b>
                  <small>
                    {!bookId &&
                      (book ? <>{quotedTitle(book)}・</> : <>本を選ばずに・</>)}
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
  /** Null in 読書管理モード: a 感想 is written for others. */
  onReview: (() => void) | null;
  onDismiss: () => void;
}) {
  return (
    <section className="reading-closed" aria-label="今日の読書" role="status">
      {closed.book && (
        <Link
          href={myBookPath(closed.book.id)}
          className="reading-jacket-link"
          aria-label={`${quotedTitle(closed.book)}の作品ページへ`}
        >
          <BookJacket book={closed.book} className="reading-closed-jacket" />
        </Link>
      )}
      <div>
        <p className="reading-closed-time">
          今日の読書 <b>{formatDuration(closed.seconds)}</b>
        </p>
        {closed.book && (
          <p className="reading-closed-title">{quotedTitle(closed.book)}</p>
        )}
        {closed.memo && (
          <blockquote className="reading-closed-memo">{closed.memo}</blockquote>
        )}
        <div className="reading-closed-actions">
          {onReview && (
            <button type="button" className="btn" onClick={onReview}>
              <Icon name="pen" size={15} />
              感想を書く
            </button>
          )}
          <button type="button" className="text-btn" onClick={onDismiss}>
            閉じる
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * A line written while reading, meant for this review but left out of it
 * because the review already had words: shown above it, to add at its end.
 * Not added, it waits on the reading page.
 */
function LineToAdd({
  sessionId,
  book,
  notify,
}: {
  sessionId: string;
  book?: Book;
  notify: Shared["notify"];
}) {
  const owner = useDraftOwner();
  const { draft } = usePostDraft(
    owner === null ? null : readingDraftKey(owner, sessionId),
  );
  if (owner === null || !draft.body.trim()) return null;
  return (
    <div className="reading-unsent-line reading-line-to-add">
      <p>読みながら書いた言葉は、まだ感想に入れていません</p>
      <blockquote>{uncoverHidden(draft.body)}</blockquote>
      <button
        type="button"
        className="btn"
        onClick={(event) => {
          const review = event.currentTarget
            .closest(".modal")
            ?.querySelector("textarea");
          if (
            appendPostDraft(
              readingDraftKey(owner, sessionId),
              reviewDraftKey(owner, book),
            )
          )
            focusField(review);
          else
            notify(
              failure(
                {
                  what: "長くなりすぎるため、書き足せませんでした",
                  kept: "言葉は読書のページに残しています",
                },
                "",
              ),
            );
        }}
      >
        <Icon name="pen" size={15} />
        書き足す
      </button>
    </div>
  );
}

/**
 * Lines written while reading and never sent, from a sitting already over.
 * They wait here until the reader uses them for a review or throws them away.
 */
function UnsentLines({
  state,
  onReview,
}: Shared & { onReview: (book?: Book, line?: string) => void }) {
  const owner = useDraftOwner();
  const drafts = useReadingDrafts(owner);
  const lines = drafts.flatMap(({ sessionId, draft }) => {
    const session = state.readingSessions.find(
      (entry) => entry.id === sessionId,
    );
    // Only this reader's sittings that are over: a running one's line is in
    // the reading room, and a line for a sitting not (or not yet) in this
    // town is not shown here.
    if (!session || session.endedAt === null || !draft.body.trim()) return [];
    const book = session.bookId
      ? bookById(state.books, session.bookId)
      : undefined;
    return [{ sessionId, body: draft.body, book }];
  });
  if (owner === null || !lines.length) return null;
  return (
    <section className="reading-unsent" aria-labelledby="reading-unsent-title">
      <h2 id="reading-unsent-title">読みながら書いて、送っていない言葉</h2>
      <ul>
        {lines.map(({ sessionId, body, book }) => (
          <li key={sessionId}>
            <blockquote>{uncoverHidden(body)}</blockquote>
            <small>
              {book
                ? `${quotedTitle(book)}を読みながら`
                : "本を選ばずに読みながら"}
            </small>
            <div className="reading-unsent-actions">
              {!inManageMode(state) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    // It starts the review, unless one is already being written.
                    carryLine(owner, sessionId, book);
                    onReview(book, sessionId);
                  }}
                >
                  <Icon name="pen" size={15} />
                  感想に使う
                </button>
              )}
              <DiscardDraft
                wordsLost
                onDiscard={() =>
                  clearPostDraft(readingDraftKey(owner, sessionId))
                }
              />
            </div>
          </li>
        ))}
      </ul>
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
  const chosen = bookId ? bookById(state.books, bookId) : undefined;
  const manage = inManageMode(state);
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
        {manage
          ? "「一人で読む」を押すと、読書時間の記録が始まります。本は選ばなくても始められます。"
          : "読み方を選ぶと、読書時間の記録が始まります。本は選ばなくても始められます。"}
      </p>
      <section className="reading-start" aria-label="これから読む本">
        <h2>
          これから読む本{" "}
          <small className="reading-optional">選ばなくてもOK</small>
        </h2>
        <BookPicker
          books={state.books}
          genreFinds={booksBeforeSearch(state)}
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
          {!manage && (
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
                同じ時間に読んでいる人に、あなたが読書中だと見えます。
                {NAMES.letter}はタイムラインにも流れます。
              </small>
            </button>
          )}
        </div>
      </section>
      {!manage && <ReadersNow state={state} clock={clock} />}
      {!manage && (
        <ReadingFeed state={state} actions={actions} notify={notify} />
      )}
      <section className="reading-log" aria-labelledby="reading-log-title">
        <h2 id="reading-log-title">読書の記録</h2>
        {sessions.length > 0 && (
          <p className="reading-total">
            <Icon name="clock" size={17} />
            これまでの読書時間 <b>{formatDuration(totals.total)}</b>
            <small>・{counted(state.readingSessions.length, "回")}</small>
          </p>
        )}
        {sessions.length ? (
          <ul>
            {sessions.map((session) => {
              const book = bookById(state.books, session.bookId);
              return (
                <li key={session.id}>
                  <span>
                    <b>{book ? bookTitle(book) : "本を選ばずに"}</b>
                    <small>
                      {formatPostTime(session.startedAt)}・
                      {modeLabel[session.mode]}
                      {session.bookId &&
                        state.finishedBooks.includes(session.bookId) &&
                        "・読了"}
                    </small>
                  </span>
                  <em>
                    {formatDuration(
                      sessionReadSeconds(state, session, clock?.now ?? 0),
                    )}
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
              {chosen ? quotedTitle(chosen) : "本を選ばずに"}
            </p>
            <div className="reading-confirm-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirm(null)}
              >
                もう少し準備する
              </button>
              <button
                type="button"
                className="btn fill"
                onClick={() => start(confirm.mode)}
              >
                {chosen ? "本を開く" : "はじめる"}
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
  onReview: (book?: Book, line?: string) => void;
  onFinished: (book: Book) => void;
  onClosed: (closed: Closed) => void;
}) {
  const id = useId();
  const session = activeSession(state);
  // The line being written is kept in this browser until it is sent, carried
  // into a review, or thrown away: leaving, a reload or closing the book
  // does not lose it.
  const owner = useDraftOwner();
  const memoKey =
    session && owner !== null ? readingDraftKey(owner, session.id) : null;
  const {
    draft: { body: memo, spoiler },
    kept,
    saved,
    loaded,
    update,
    clear,
  } = usePostDraft(memoKey);
  const continuing = useOpenedWithWork(loaded, kept);
  const notTaken = useNotTakenWords();
  const field = useRef<HTMLTextAreaElement>(null);
  const peekOpen = useReadingPeekOpen();
  const [ending, setEnding] = useState<{
    finished: boolean;
    phrase: string;
  } | null>(null);
  if (!session) return null;
  const seconds = clock ? sessionReadSeconds(state, session, clock.now) : null;
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
  /** Sends the line written; false when the town did not take it (it stays). */
  function send(): boolean {
    const created = actions.createPost({
      body: memo,
      spoiler: Boolean(book) && spoiler,
      fromReading: true,
    });
    if (!created) {
      notify(notTaken);
      return false;
    }
    clear();
    return true;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const offline = townOffline();
    if (send())
      notify(
        offline
          ? failure(together ? offlineFor("投稿") : WHILE_OFFLINE)
          : together
            ? "投稿しました"
            : "メモしました（自分だけ）",
      );
  }
  /** Closes the book; `sent` is a line sent just now, for the closing card. */
  function close(finished: boolean, sent?: string) {
    actions.endReading(finished);
    // Finishing a book asks how it felt; the record says the rest.
    if (finished && book) onFinished(book);
    else
      onClosed({
        book,
        seconds: seconds ?? 0,
        memo:
          sent ??
          uncoverHidden(
            written.find((post) => post.body.trim())?.body ?? "",
          ).trim(),
      });
    setEnding(null);
  }
  return (
    <div className="reading-page">
      <span className="eyebrow">NOW READING</span>
      <section className="reading-now-card" aria-label="読書中">
        {book ? (
          <Link
            href={myBookPath(book.id)}
            className="reading-jacket-link"
            aria-label={`${quotedTitle(book)}の作品ページへ`}
          >
            <BookJacket book={book} className="reading-jacket" />
          </Link>
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
          <h1>{book ? bookTitle(book) : "読書中"}</h1>
          <p>{book ? bookAuthor(book) : "本を選ばずに読んでいます"}</p>
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
              className="btn"
              onClick={() =>
                setEnding({ finished: false, phrase: pick(END_PHRASES) })
              }
            >
              読書を終える
            </button>
            {book && (
              <button
                type="button"
                className="btn fill"
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
          {together ? `読書中の${NAMES.letter}` : "読書メモ（自分だけ）"}
        </label>
        <textarea
          ref={field}
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
          onChange={(event) => update({ body: event.target.value })}
        />
        <div className="composer-tools">
          {book && (
            <label className="composer-spoiler">
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(event) => update({ spoiler: event.target.checked })}
              />
              ネタバレあり
            </label>
          )}
          {/* A note only the reader sees has nothing to hide from anyone. */}
          {together && (
            <HideWordsButton
              field={field}
              body={memo}
              onChange={(body) => update({ body })}
              notify={notify}
            />
          )}
          <span className="composer-send">
            <LengthNearLimit length={memo.length} max={POST_MAX_LENGTH} />
            <button className="btn fill" type="submit" disabled={!memo.trim()}>
              {together ? "つぶやく" : "メモする"}
            </button>
          </span>
        </div>
        <KeptDraftNote
          continuing={continuing && kept}
          saved={saved}
          wordsLost={memo.trim() !== ""}
          onDiscard={() => {
            clear();
            focusField(field.current);
          }}
        />
        {together && <HiddenWordsHint body={memo} />}
      </form>

      {written.length > 0 && (
        <section className="reading-mine" aria-label="今回書いたこと">
          <div className="post-feed">
            {written.map((post) => (
              <LetterCard
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
      {!inManageMode(state) && (
        <details className="reading-peek" open={peekOpen}>
          <summary>
            <Icon name="chevron" size={14} />
            ひと休みに、
            {together ? `みんなの${NAMES.letter}` : "街の読書"}
            をのぞく
          </summary>
          <label className="reading-peek-keep">
            <input
              type="checkbox"
              checked={peekOpen}
              onChange={(event) => {
                setReadingPeekOpen(event.target.checked);
                notify(
                  event.target.checked
                    ? "読書中も、街の言葉を開いておきます"
                    : "読書中は、街の言葉をたたんでおきます",
                );
              }}
            />
            読書中はいつも開いておく
          </label>
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
      )}
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
              {book && `・${quotedTitle(book)}`}
            </p>
            {/* A line not sent yet is offered, never dropped with the book. */}
            {memo.trim() && (
              <div className="reading-unsent-line">
                <p>
                  {together
                    ? "まだつぶやいていない言葉があります"
                    : "まだメモしていない言葉があります"}
                </p>
                <blockquote>{uncoverHidden(memo)}</blockquote>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const line = uncoverHidden(memo).trim();
                    if (send()) close(ending.finished, line);
                  }}
                >
                  {(together ? "つぶやいて" : "メモして") +
                    (ending.finished ? "読み終える" : "閉じる")}
                </button>
              </div>
            )}
            <div className="reading-confirm-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setEnding(null)}
              >
                もう少し読む
              </button>
              {!inManageMode(state) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    actions.endReading(ending.finished);
                    // The line not sent starts the review, when that is empty.
                    if (owner !== null) carryLine(owner, session.id, book);
                    onReview(book, session.id);
                  }}
                >
                  <Icon name="pen" size={15} />
                  感想を書く
                </button>
              )}
              <button
                type="button"
                className="btn fill"
                onClick={() => close(ending.finished)}
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
