"use client";

import { useId, useRef, type FormEvent } from "react";
import Link from "next/link";
import {
  ME_ID,
  POST_MAX_LENGTH,
  type Book,
  type ReadingSession,
  type TownActions,
  type TownState,
} from "../lib/types";
import { readersNow, readingFeed } from "../lib/reading";
import { findReader } from "../lib/social";
import { HiddenWordsHint, HideWordsButton, LengthNearLimit } from "./Social";
import { LetterCard } from "./letter/LetterCard";
import { BookJacket, ReaderAvatar } from "./ui";
import type { useClock } from "./useClock";
import { profilePath } from "../lib/paths";
import { isSampleId } from "../lib/record-kind";
import { bookPath } from "../lib/books";
import { recentlyFinished } from "../lib/records";
import { focusField } from "../lib/coarse-pointer";
import { readingDraftKey, usePostDraft } from "../lib/post-draft";
import {
  KeptDraftNote,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { bookById, booksById, bookTitle, quotedTitle } from "../lib/book-name";
import { counted, whenSome, failure, offlineFor, NAMES } from "../lib/words";
import { townOffline } from "../lib/store";
import { booksOfWork } from "../lib/works";

// Reading with the town: who reads now, everyone's 便り written while
// reading, and the 便り of a reading together. The start of 読書 shows the
// first two; while reading, they wait behind the mark of people at the top.

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

/** Everyone's reading-together posts, across every book; the viewer's private notes too. */
export function ReadingFeed({
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

export function ReadersNow({
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

/**
 * The 便り of a reading together, written while reading: kept in this
 * browser until it is sent, carried into a review, or thrown away (leaving,
 * a reload or the reading's end does not lose it; the start of 読書 shows
 * one left unsent). Under it, what the reader wrote in this reading.
 */
export function TogetherLetters({
  state,
  actions,
  notify,
  session,
  book,
}: Shared & { session: ReadingSession; book?: Book }) {
  const id = useId();
  const owner = useDraftOwner();
  const {
    draft: { body, spoiler },
    kept,
    saved,
    loaded,
    update,
    clear,
  } = usePostDraft(owner === null ? null : readingDraftKey(owner, session.id));
  const continuing = useOpenedWithWork(loaded, kept);
  const notTaken = useNotTakenWords();
  const field = useRef<HTMLTextAreaElement>(null);
  // The reading's own 便り stay in view, the newest first.
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
    const offline = townOffline();
    const created = actions.createPost({
      body,
      spoiler: Boolean(book) && spoiler,
      fromReading: true,
    });
    if (!created) {
      notify(notTaken);
      return;
    }
    clear();
    notify(offline ? failure(offlineFor("投稿")) : "投稿しました");
  }
  return (
    <>
      <form className="memo-composer" onSubmit={submit}>
        <label htmlFor={id}>読書中の{NAMES.letter}</label>
        <textarea
          ref={field}
          id={id}
          className="field"
          rows={3}
          maxLength={POST_MAX_LENGTH}
          placeholder="いま読んでいるところの気持ちを、みんなに"
          value={body}
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
          <HideWordsButton
            field={field}
            body={body}
            onChange={(next) => update({ body: next })}
            notify={notify}
          />
          <span className="composer-send">
            <LengthNearLimit length={body.length} max={POST_MAX_LENGTH} />
            <button className="btn fill" type="submit" disabled={!body.trim()}>
              つぶやく
            </button>
          </span>
        </div>
        <KeptDraftNote
          continuing={continuing && kept}
          saved={saved}
          wordsLost={body.trim() !== ""}
          onDiscard={() => {
            clear();
            focusField(field.current);
          }}
        />
        <HiddenWordsHint body={body} />
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
    </>
  );
}
