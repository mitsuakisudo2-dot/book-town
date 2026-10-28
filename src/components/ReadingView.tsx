"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import type { Book, ReadingMode, TownActions, TownState } from "../lib/types";
import {
  activeSession,
  booksToRead,
  currentBookId,
  formatDuration,
  readingTotals,
} from "../lib/reading";
import {
  cardById,
  runningCard,
  sessionReadSeconds,
} from "../lib/reading-cards";
import { formatPostTime } from "../lib/social";
import { BookPicker } from "./BookPicker";
import { booksBeforeSearch } from "../lib/book-lists";
import { PostComposer } from "./Social";
import { RecordSheet } from "./ReadingRecords";
import { Icon, Modal } from "./ui";
import { useClock } from "./useClock";
import "./reading.css";
import { uncoverHidden } from "../lib/hidden-words";
import { focusField } from "../lib/coarse-pointer";
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
  noteDraftStore,
  noteWorkKey,
  useNoteDrafts,
} from "../lib/reading-note-draft";
import { DiscardDraft, useDraftOwner, useNotTakenWords } from "./KeptDraftNote";
import { bookById, bookTitle, quotedTitle } from "../lib/book-name";
import { counted, failure, NAMES } from "../lib/words";
import { inManageMode } from "../lib/town-mode";
import { ReadersNow, ReadingFeed } from "./ReadingTogether";
import { ReadingRoom } from "./ReadingRoom";
import { ReadingDone } from "./ReadingDone";
import dynamic from "next/dynamic";

// 読書の統計 comes in its own file, after the page itself (管理表 19).
const ReadingStats = dynamic(
  () => import("./stats/ReadingStats").then((file) => file.ReadingStats),
  { ssr: false, loading: () => null },
);

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

const modeLabel: Record<ReadingMode, string> = {
  solo: "一人で読む",
  together: "みんなで読む",
};

// A small greeting picked at random each time, before opening a book and
// once it is closed.
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
  "今日はここまで。また続きで会いましょう。",
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
  const running = runningCard(props.state);
  // "感想を書く" opens a composer for the book just read, with the sitting
  // whose line was meant for it.
  const [review, setReview] = useState<{
    book?: Book;
    line?: string;
  } | null>(null);
  // Finishing a book goes on to how it felt.
  const [finished, setFinished] = useState<Book | null>(null);
  // おわりのあと: the card just ended, until it is put away, read on or not
  // kept. Leaving the page keeps it as it is.
  const [ended, setEnded] = useState<{
    cardId: string;
    phrase: string;
  } | null>(null);
  const owner = useDraftOwner();
  // The review opens within the tap that asks for it, so a phone's keyboard
  // rises with its text box (Modal's `writing`).
  const openReview = (read?: Book, line?: string) =>
    flushSync(() => setReview({ book: read, line }));
  const done =
    !active && ended && cardById(props.state, ended.cardId) ? ended : null;
  return (
    <>
      {active ? (
        <ReadingRoom
          // A book changed is read on the same card: the room stays.
          key={running?.card.id ?? active.id}
          {...props}
          clock={clock}
          card={running?.card ?? null}
          session={active}
          onEnded={(cardId) => {
            if (cardId) setEnded({ cardId, phrase: pick(END_PHRASES) });
            else props.notify("読書を終えました");
          }}
        />
      ) : done ? (
        <ReadingDone
          {...props}
          clock={clock}
          cardId={done.cardId}
          phrase={done.phrase}
          onReadOn={() => setEnded(null)}
          onClose={() => setEnded(null)}
          onReview={(book, sessionId) => {
            // The line not sent starts the review, when that is empty.
            if (owner !== null) carryLine(owner, sessionId, book);
            openReview(book, sessionId);
          }}
          onFinished={setFinished}
        />
      ) : (
        <>
          <UnsavedNotes {...props} />
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

/**
 * Words written in the note of a reading over and not put in it (turned
 * away, or left when the reading ended): they wait here until they are
 * kept or thrown away.
 */
function UnsavedNotes({ state, actions, notify }: Shared) {
  const owner = useDraftOwner();
  const drafts = useNoteDrafts(owner);
  const notTaken = useNotTakenWords();
  const running = runningCard(state)?.card.id;
  const lines = drafts.filter(
    ({ cardId, draft }) => cardId !== running && draft.body.trim(),
  );
  if (owner === null || !lines.length) return null;
  return (
    <section className="reading-unsent" aria-labelledby="reading-unsaved-notes">
      <h2 id="reading-unsaved-notes">ノートに残していない言葉</h2>
      <ul>
        {lines.map(({ cardId, draft }) => {
          const card = cardById(state, cardId);
          const key = noteWorkKey(owner, cardId);
          return (
            <li key={cardId}>
              <blockquote>{draft.body}</blockquote>
              <small>
                {card
                  ? `${formatPostTime(card.createdAt)}の読書で書いた言葉`
                  : "読書中に書いた言葉"}
              </small>
              <div className="reading-unsent-actions">
                {card && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (actions.writeReadingNote(cardId, draft)) {
                        noteDraftStore.clear(key);
                        notify("ノートに残しました");
                      } else notify(notTaken);
                    }}
                  >
                    ノートに残す
                  </button>
                )}
                <DiscardDraft
                  wordsLost
                  onDiscard={() => noteDraftStore.clear(key)}
                />
              </div>
            </li>
          );
        })}
      </ul>
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
  const suggestions = booksToRead(state);
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
        ? "一人で読み始めました。ノートはあなただけに見えます"
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
              読んでいることは誰にも見えません。ノートは自分だけのものです。
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
      <ReadingStats
        state={state}
        now={clock?.now ?? 0}
        onArrange={actions.setStatsLayout}
      />
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
