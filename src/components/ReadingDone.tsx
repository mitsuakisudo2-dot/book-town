"use client";

import { useId, useState } from "react";
import type {
  Book,
  ReadingSession,
  TownActions,
  TownState,
} from "../lib/types";
import { formatDuration } from "../lib/reading";
import {
  cardById,
  cardBookOf,
  cardReadSeconds,
  cardSessions,
  PAGE_MAX,
  type ReadingCardBook,
} from "../lib/reading-cards";
import { formatPostTime } from "../lib/social";
import type { useClock } from "./useClock";
import Link from "next/link";
import { BookJacket, CoverCredit, Icon } from "./ui";
import { myBookPath } from "../lib/books";
import { useOwnedDraft } from "../lib/kept-draft";
import { noteDraftStore, noteWorkKey } from "../lib/reading-note-draft";
import { DiscardDraft, useDraftOwner, useNotTakenWords } from "./KeptDraftNote";
import { bookById, bookTitle, quotedTitle } from "../lib/book-name";
import { counted, failure } from "../lib/words";
import { inManageMode } from "../lib/town-mode";
import "./reading-room.css";

// おわりのあと: the card of the reading just ended. どこまで読んだ and この本
// を読み終えた for each book read on it, then put away, read on, or not kept
// (asked twice). The card's own look comes with the album (管理表 18 の3本目).

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export function ReadingDone({
  state,
  actions,
  notify,
  clock,
  cardId,
  phrase,
  onReadOn,
  onClose,
  onReview,
  onFinished,
}: Shared & {
  clock: ReturnType<typeof useClock>;
  cardId: string;
  /** A small word for the book just closed (ReadingView's END_PHRASES). */
  phrase: string;
  /** 読書にもどる: the reading goes on. */
  onReadOn: () => void;
  /** Put away or not kept: the start of 読書 again. */
  onClose: () => void;
  /** 感想を書く, for a book of the card and its span (its line written). */
  onReview: (book: Book | undefined, sessionId: string) => void;
  /** A book finished on the card, put away: how it felt. */
  onFinished: (book: Book) => void;
}) {
  const owner = useDraftOwner();
  const note = useOwnedDraft(
    noteDraftStore,
    owner === null ? null : noteWorkKey(owner, cardId),
  );
  const notTaken = useNotTakenWords();
  const [discarding, setDiscarding] = useState(false);
  const card = cardById(state, cardId);
  if (!card) return null;
  const sessions = cardSessions(state, cardId);
  const read = sessions.flatMap((session) => {
    const book = session.bookId
      ? bookById(state.books, session.bookId)
      : undefined;
    const kept = cardBookOf(state, session.id);
    return kept ? [{ session, book, kept }] : [];
  });
  const books = read.flatMap(({ book }) => (book ? [book] : []));
  const last = read.at(-1);
  const seconds = cardReadSeconds(state, cardId, clock?.now ?? 0);
  const manage = inManageMode(state);

  function readOn() {
    if (actions.readOn(cardId)) onReadOn();
    else notify(failure({ what: "読書にもどれませんでした" }));
  }
  function putAway() {
    const finished = read.find(({ kept, book }) => kept.finished && book)?.book;
    onClose();
    notify("カードをしまいました。読書の記録に残っています");
    if (finished) onFinished(finished);
  }
  function discard() {
    if (!discarding) {
      setDiscarding(true);
      return;
    }
    actions.discardReading(cardId);
    note.clear();
    onClose();
    notify("記録せずに閉じました");
  }
  return (
    <div className="reading-page reading-done">
      <button type="button" className="text-btn" onClick={readOn}>
        <Icon name="back" size={16} />
        読書にもどる
      </button>
      <header className="reading-done-made">
        <h1>カードができました</h1>
        <p className="reading-done-phrase">{phrase}</p>
        <p>
          {books.length
            ? books.map((book) => quotedTitle(book)).join("・")
            : "本を選ばずに"}
          ・{formatDuration(seconds)}
        </p>
        {sessions[0] && <small>{formatPostTime(sessions[0].startedAt)}</small>}
      </header>
      {read.map(
        ({ session, book, kept }) =>
          book && (
            <BookRead
              key={session.id}
              actions={actions}
              session={session}
              book={book}
              kept={kept}
            />
          ),
      )}
      {note.draft?.body.trim() && (
        <div className="reading-unsent-line">
          <p>まだノートに残していない言葉があります</p>
          <blockquote>{note.draft.body}</blockquote>
          <div className="btns">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (
                  note.draft &&
                  actions.writeReadingNote(cardId, note.draft)
                ) {
                  note.clear();
                  notify("ノートに残しました");
                } else notify(notTaken);
              }}
            >
              ノートに残す
            </button>
            <DiscardDraft wordsLost onDiscard={note.clear} />
          </div>
        </div>
      )}
      {!manage && last?.book && (
        <button
          type="button"
          className="text-btn"
          onClick={() => onReview(last.book, last.session.id)}
        >
          <Icon name="pen" size={15} />
          感想を書く
        </button>
      )}
      <div className="reading-done-keep">
        <button type="button" className="btn fill" onClick={putAway}>
          カードをしまう
        </button>
        <button
          type="button"
          className={"text-btn quiet" + (discarding ? " is-asking" : "")}
          onClick={discard}
        >
          {discarding
            ? "もう一度押すと、この読書の記録とノートが消えます"
            : "記録しないで閉じる"}
        </button>
      </div>
    </div>
  );
}

/** どこまで読んだ and この本を読み終えた, for one book of the card. */
function BookRead({
  actions,
  session,
  book,
  kept,
}: {
  actions: TownActions;
  session: ReadingSession;
  book: Book;
  kept: ReadingCardBook;
}) {
  const id = useId();
  const to = kept.pageTo;
  const from = kept.pageFrom;
  const setTo = (page: number | null) => {
    if (
      page !== null &&
      (!Number.isInteger(page) || page < 0 || page > PAGE_MAX)
    )
      return;
    actions.changeCardBook(session.id, { pageTo: page });
  };
  return (
    <section
      className="reading-done-book"
      aria-label={`${quotedTitle(book)}をどこまで読んだか`}
    >
      <header className="reading-done-title">
        <Link
          href={myBookPath(book.id)}
          aria-label={`${quotedTitle(book)}の作品ページへ`}
        >
          <BookJacket book={book} sizes="44px" />
        </Link>
        <div>
          <h2>{bookTitle(book)}</h2>
          <CoverCredit book={book} />
        </div>
      </header>
      <div className="reading-done-row">
        <label htmlFor={id + "-to"}>どこまで読んだ？</label>
        <span className="reading-step">
          <button
            type="button"
            aria-label="1ページ戻す"
            disabled={to === null || to <= 0}
            onClick={() => to !== null && setTo(to - 1)}
          >
            −
          </button>
          <input
            id={id + "-to"}
            type="number"
            inputMode="numeric"
            min={0}
            max={PAGE_MAX}
            value={to ?? ""}
            placeholder={from === null ? undefined : String(from)}
            onChange={(event) =>
              setTo(
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          />
          <span>ページ</span>
          <button
            type="button"
            aria-label="1ページ進める"
            onClick={() => setTo((to ?? from ?? 0) + 1)}
          >
            ＋
          </button>
        </span>
      </div>
      {from !== null && from > 0 && (
        <p className="reading-muted">{counted(from, "ページ")}から読みました</p>
      )}
      <div className="reading-done-row">
        <span id={id + "-done"}>この本を読み終えた</span>
        <button
          type="button"
          className="reading-switch"
          role="switch"
          aria-checked={kept.finished}
          aria-labelledby={id + "-done"}
          onClick={() =>
            actions.changeCardBook(session.id, { finished: !kept.finished })
          }
        />
      </div>
    </section>
  );
}
