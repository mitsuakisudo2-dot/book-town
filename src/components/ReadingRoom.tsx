"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Book,
  ReadingSession,
  TownActions,
  TownState,
} from "../lib/types";
import { booksToRead, formatClock } from "../lib/reading";
import {
  BOOK_REPLACED_WITHIN,
  cardBookOf,
  cardNotes,
  cardReadSeconds,
  NOTE_KINDS,
  READING_NOTE_MAX_LENGTH,
  sessionReadSeconds,
  type NoteKind,
  type ReadingCard,
  type ReadingNote,
} from "../lib/reading-cards";
import { BookPicker } from "./BookPicker";
import { booksBeforeSearch } from "../lib/book-lists";
import { BookJacket, CoverCredit, Icon, Modal } from "./ui";
import type { useClock } from "./useClock";
import { ReadersNow, ReadingFeed, TogetherLetters } from "./ReadingTogether";
import { useOwnedDraft } from "../lib/kept-draft";
import { noteDraftStore, noteWorkKey } from "../lib/reading-note-draft";
import {
  KeptDraftNote,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { bookAuthor, bookById, bookTitle, quotedTitle } from "../lib/book-name";
import { AGAIN, counted, failure, NAMES } from "../lib/words";
import { inManageMode } from "../lib/town-mode";
import { useLastHomeAddress } from "../lib/last-address";
import { enterPressed } from "../lib/keys";
import { scrollBehavior } from "../lib/motion";
import { focusField } from "../lib/coarse-pointer";
import "./reading-room.css";

// 読書中 (管理表 18): one screen but for the notes, the room seen through
// glass. At the top what is set (out of the way, the screen kept on, the
// town), in the middle the time (光の輪), at the bottom what is written
// (今日のノート) and おわり. The decided look is docs/機能/読書記録.md.

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

/** The three kinds of note, as the writing place names them. */
export const NOTE_WORDS: Record<
  NoteKind,
  { tab: string; tag: string; placeholder: string; kept: string }
> = {
  word: {
    tab: "言葉を調べる",
    tag: "言葉",
    placeholder: "気になった言葉を残す",
    kept: "言葉をノートに残しました",
  },
  thought: {
    tab: "思ったこと",
    tag: "思った",
    placeholder: "思ったことを書きとめる（自分だけ）",
    kept: "ノートに書きとめました",
  },
  quote: {
    tab: "好きな一文",
    tag: "一文",
    placeholder: "好きな一文を書き写す（自分だけ）",
    kept: "一文をノートに残しました",
  },
};

/** A point on the clock's ring: `p` of the way round from the top. */
const ringAt = (radius: number, p: number) => [
  50 + radius * Math.sin(p * 2 * Math.PI),
  50 - radius * Math.cos(p * 2 * Math.PI),
];

const HOURS = Array.from({ length: 12 }, (_, hour) => hour);

/** 光の輪: the light goes round once an hour from the top. */
function ClockFace({ progress }: { progress: number }) {
  const [x, y] = ringAt(45, progress);
  return (
    <svg className="reading-face" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="reading-face-track" cx="50" cy="50" r="45" />
      {HOURS.map((hour) => {
        const quarter = hour % 3 === 0;
        const [x1, y1] = ringAt(quarter ? 38 : 40, hour / 12);
        const [x2, y2] = ringAt(41.6, hour / 12);
        return (
          <line
            key={hour}
            className={"reading-face-tick" + (quarter ? " is-quarter" : "")}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
          />
        );
      })}
      <circle
        className="reading-face-arc"
        cx="50"
        cy="50"
        r="45"
        pathLength={100}
        strokeDasharray={`${(progress * 100).toFixed(2)} 100`}
        transform="rotate(-90 50 50)"
      />
      <circle className="reading-face-halo" cx={x} cy={y} r="5.6" />
      <circle className="reading-face-knob" cx={x} cy={y} r="2.7" />
      <circle className="reading-face-core" cx={x} cy={y} r="1.1" />
    </svg>
  );
}

/**
 * 画面をつけたままにする (Wake Lock): asked for again when the page comes
 * back, since the device lets it go while the page is hidden; let go with
 * the room.
 */
function useWakeLock(notify: Shared["notify"]) {
  const [on, setOn] = useState(false);
  const wanted = useRef(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  const request = async (): Promise<boolean> => {
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!wanted.current) {
        await sentinel.release();
        return false;
      }
      lock.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (lock.current === sentinel) lock.current = null;
      });
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    const back = () => {
      if (
        wanted.current &&
        !lock.current &&
        document.visibilityState === "visible"
      )
        void request();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      wanted.current = false;
      void lock.current?.release().catch(() => undefined);
      lock.current = null;
    };
  }, []);
  async function toggle() {
    if (wanted.current) {
      wanted.current = false;
      setOn(false);
      await lock.current?.release().catch(() => undefined);
      lock.current = null;
      notify("画面は、いつもどおりに消えます");
      return;
    }
    if (!("wakeLock" in navigator)) {
      notify("この端末では、画面をつけたままにできません");
      return;
    }
    wanted.current = true;
    if (await request()) {
      setOn(true);
      notify("読んでいる間、画面をつけたままにします");
    } else {
      wanted.current = false;
      notify(failure({ what: "画面をつけたままにできませんでした" }));
    }
  }
  return { on, toggle };
}

/** The room of a reading going on. `card` is null for one begun before cards. */
export function ReadingRoom({
  state,
  actions,
  notify,
  clock,
  card,
  session,
  onEnded,
}: Shared & {
  clock: ReturnType<typeof useClock>;
  card: ReadingCard | null;
  session: ReadingSession;
  /** After おわり: the card to put away, read on or not keep. */
  onEnded: (cardId: string | null) => void;
}) {
  const router = useRouter();
  const home = useLastHomeAddress();
  const book = session.bookId
    ? bookById(state.books, session.bookId)
    : undefined;
  const manage = inManageMode(state);
  const together = session.mode === "together";
  const paused = card?.pausedAt != null;
  const seconds = clock
    ? card
      ? cardReadSeconds(state, card.id, clock.now)
      : sessionReadSeconds(state, session, clock.now)
    : null;
  const [sheet, setSheet] = useState<"books" | "cover" | "people" | null>(null);
  const wake = useWakeLock(notify);
  const panes = useRef<HTMLDivElement>(null);

  // The words being written are kept in this browser until 今日のノート has
  // them or the reader throws them away (reading-note-draft.ts).
  const owner = useDraftOwner();
  const note = useOwnedDraft(
    noteDraftStore,
    owner !== null && card ? noteWorkKey(owner, card.id) : null,
  );
  const [chosen, setChosen] = useState<NoteKind>("thought");
  const kind = note.draft?.kind ?? chosen;
  const body = note.draft?.body ?? "";
  const continuing = useOpenedWithWork(note.loaded, note.kept !== null);
  const field = useRef<HTMLTextAreaElement>(null);
  const notTaken = useNotTakenWords();
  const notes = card ? cardNotes(state, card.id) : [];

  /** Puts the words written in 今日のノート; false when they were not taken. */
  function keepNote(): boolean {
    if (!card || !body.trim()) return true;
    if (!actions.writeReadingNote(card.id, { kind, body })) {
      notify(notTaken);
      return false;
    }
    note.clear();
    return true;
  }
  function writeNote() {
    if (!body.trim()) return;
    if (keepNote()) notify(NOTE_WORDS[kind].kept);
  }
  function end() {
    // Words written and not yet put in the note go into it first.
    keepNote();
    actions.endReading(false);
    onEnded(card?.id ?? null);
  }
  const toPane = (pane: "book" | "notes") =>
    panes.current?.scrollTo({
      left: pane === "notes" ? panes.current.clientWidth : 0,
      behavior: scrollBehavior(),
    });
  const from = cardBookOf(state, session.id)?.pageFrom ?? null;
  // Read for under a minute with nothing written on it, the book read now
  // gives way to another chosen (withBookChanged); else it stays on the card.
  const soon =
    clock !== null &&
    sessionReadSeconds(state, session, clock.now) < BOOK_REPLACED_WITHIN &&
    !state.readingNotes.some((entry) => entry.sessionId === session.id);
  const progress = seconds === null ? 0 : (seconds % 3600) / 3600;

  return (
    <div
      className={"reading-room" + (paused ? " is-paused" : "")}
      aria-label="読書中"
      role="region"
    >
      <div className="reading-room-bar">
        <button
          type="button"
          className="reading-chip"
          aria-label="ホームへ（読書は続きます）"
          onClick={() => router.push(home)}
        >
          <Icon name="down" />
        </button>
        <span className="reading-room-set">
          {!manage && (
            <button
              type="button"
              className={"reading-chip" + (together ? " is-together" : "")}
              aria-haspopup="dialog"
              aria-label={
                together
                  ? `みんなで読む：いま読んでいる人と${NAMES.letter}`
                  : "街の読書をのぞく"
              }
              onClick={() => setSheet("people")}
            >
              <Icon name="users" />
            </button>
          )}
          <button
            type="button"
            className="reading-chip"
            aria-pressed={wake.on}
            aria-label="画面をつけたままにする"
            onClick={() => void wake.toggle()}
          >
            <Icon name="bulb" />
          </button>
        </span>
      </div>

      <div className="reading-panes" ref={panes}>
        <section className="reading-pane" aria-label="本と時間">
          <div className="reading-stage">
            <div className="reading-hud">
              {book ? (
                <button
                  type="button"
                  className="reading-hud-cover"
                  aria-label={`${quotedTitle(book)}の表紙を大きく見る`}
                  onClick={() => setSheet("cover")}
                >
                  <BookJacket book={book} sizes="44px" />
                </button>
              ) : (
                <span className="reading-hud-cover is-none" aria-hidden="true">
                  <Icon name="reading" size={22} />
                </span>
              )}
              <div className="reading-hud-text">
                <button
                  type="button"
                  className="reading-hud-book"
                  aria-haspopup="dialog"
                  onClick={() => setSheet("books")}
                >
                  <b>{book ? bookTitle(book) : "本を選ばずに"}</b>
                  {book && <span>{bookAuthor(book)}</span>}
                  {book && (
                    <span>
                      {from ? `${counted(from, "ページ")}から` : "はじめから"}
                    </span>
                  )}
                  <em>{book ? "本を変える" : "本を選ぶ"} ›</em>
                </button>
                {book && <CoverCredit book={book} />}
              </div>
            </div>
            <div className="reading-clock">
              <div
                className="reading-bigtime"
                data-long={seconds !== null && seconds >= 3600 ? "" : undefined}
              >
                <ClockFace progress={progress} />
                <small>{paused ? "ひと休み中" : ""}</small>
                <b role="timer" aria-label="読書時間">
                  {seconds === null ? "" : formatClock(seconds)}
                </b>
                {card && (
                  <button
                    type="button"
                    className="reading-stop"
                    aria-label={paused ? "続きから読む" : "時計を止める"}
                    onClick={() =>
                      paused ? actions.resumeReading() : actions.pauseReading()
                    }
                  >
                    <Icon name={paused ? "play" : "pause"} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {card ? (
            <form
              className="reading-desk"
              onSubmit={(event) => {
                event.preventDefault();
                writeNote();
              }}
            >
              <div
                className="reading-kinds"
                role="tablist"
                aria-label="書くもの"
              >
                {NOTE_KINDS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="tab"
                    aria-selected={entry === kind}
                    onClick={() => {
                      setChosen(entry);
                      if (note.draft) note.set({ ...note.draft, kind: entry });
                    }}
                  >
                    {NOTE_WORDS[entry].tab}
                  </button>
                ))}
              </div>
              <div
                className={
                  "reading-write" + (kind === "quote" ? " is-quote" : "")
                }
              >
                <textarea
                  ref={field}
                  rows={1}
                  value={body}
                  maxLength={READING_NOTE_MAX_LENGTH}
                  placeholder={NOTE_WORDS[kind].placeholder}
                  aria-label={NOTE_WORDS[kind].placeholder}
                  enterKeyHint="done"
                  onChange={(event) =>
                    note.set({ kind, body: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (enterPressed(event) && !event.shiftKey) {
                      event.preventDefault();
                      writeNote();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="btn fill"
                  disabled={!body.trim()}
                >
                  残す
                </button>
              </div>
              <KeptDraftNote
                continuing={continuing && note.kept !== null}
                saved={note.saved}
                wordsLost={body.trim() !== ""}
                onDiscard={() => {
                  note.clear();
                  focusField(field.current);
                }}
              />
            </form>
          ) : (
            <div className="reading-desk">
              <p className="reading-muted">
                この読書は前の形で始まっています。ノートと一時停止は、次の読書から使えます。
              </p>
            </div>
          )}
          <div className="reading-foot">
            <button
              type="button"
              className="btn fill reading-end"
              onClick={end}
            >
              おわり
            </button>
            {card && (
              <button
                type="button"
                className="reading-chip reading-to-notes"
                aria-label="今日のノートをひらく"
                onClick={() => toPane("notes")}
              >
                ノート
                {notes.length > 0 && <i>{notes.length}</i>}
                <Icon name="chevron" size={16} />
              </button>
            )}
          </div>
        </section>

        {card && (
          <section
            className="reading-pane reading-notes-pane"
            aria-labelledby="reading-notes-title"
          >
            <div className="reading-leaf">
              <h2 id="reading-notes-title">
                今日のノート<small>自分だけ</small>
              </h2>
              {notes.length ? (
                <ul className="reading-notes">
                  {notes.map((entry) => (
                    <NoteRow
                      key={entry.id}
                      note={entry}
                      onErase={() => actions.eraseReadingNote(entry.id)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="reading-muted">
                  書いた言葉は、ここにたまります。
                </p>
              )}
            </div>
            <div className="reading-foot">
              <button
                type="button"
                className="reading-chip"
                onClick={() => toPane("book")}
              >
                <Icon name="back" size={16} />
                本へ
              </button>
              <button
                type="button"
                className="btn fill reading-end"
                onClick={end}
              >
                おわり
              </button>
            </div>
          </section>
        )}
      </div>

      {sheet === "books" && (
        <BookSheet
          state={state}
          actions={actions}
          notify={notify}
          session={session}
          book={book}
          soon={soon}
          onCover={() => setSheet("cover")}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "cover" && book && (
        <Modal
          title={`${quotedTitle(book)}の表紙`}
          onClose={() => setSheet(null)}
        >
          <div className="reading-cover-big">
            <BookJacket book={book} sizes="240px" />
            <CoverCredit book={book} />
          </div>
        </Modal>
      )}
      {sheet === "people" && (
        <Modal
          title={together ? "みんなで読む" : "街の読書"}
          fromBottom
          onClose={() => setSheet(null)}
        >
          <div className="reading-people">
            {together ? (
              <TogetherLetters
                state={state}
                actions={actions}
                notify={notify}
                session={session}
                book={book}
              />
            ) : (
              <p className="reading-muted">
                一人で読んでいます。読んでいることもノートも、誰にも見えません。
              </p>
            )}
            <ReadersNow state={state} clock={clock} bookId={book?.id} />
            <ReadingFeed
              state={state}
              actions={actions}
              notify={notify}
              excludeMine
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** A note of 今日のノート; erasing it asks once. */
function NoteRow({
  note,
  onErase,
}: {
  note: ReadingNote;
  onErase: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <li className={"is-" + note.kind}>
      <i>{NOTE_WORDS[note.kind].tag}</i>
      <span>{note.kind === "quote" ? `「${note.body}」` : note.body}</span>
      {asking ? (
        <span className="reading-note-ask">
          <button
            type="button"
            className="text-btn quiet"
            onClick={() => setAsking(false)}
          >
            残す
          </button>
          <button type="button" className="btn danger" onClick={onErase}>
            消す
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="icon-btn"
          aria-label="このノートを消す"
          onClick={() => setAsking(true)}
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </li>
  );
}

/** 本を変える: another book, read on the same card. */
function BookSheet({
  state,
  actions,
  notify,
  session,
  book,
  soon,
  onCover,
  onClose,
}: Shared & {
  session: ReadingSession;
  book?: Book;
  /** The book read now gives way to the one chosen. */
  soon: boolean;
  onCover: () => void;
  onClose: () => void;
}) {
  function choose(bookId: string | null) {
    onClose();
    if (!bookId || bookId === session.bookId) return;
    const next = bookById(state.books, bookId);
    if (actions.changeReadingBook(bookId))
      notify(
        next ? `${quotedTitle(next)}を読みはじめました` : "本を変えました",
      );
    else notify(failure({ what: "本を変えられませんでした", next: AGAIN.now }));
  }
  return (
    <Modal
      title={book ? "ほかの本に変える" : "読む本を選ぶ"}
      fromBottom
      onClose={onClose}
    >
      <div className="reading-books">
        {book && (
          <div className="reading-books-now">
            <button
              type="button"
              className="reading-hud-cover"
              aria-label={`${quotedTitle(book)}の表紙を大きく見る`}
              onClick={onCover}
            >
              <BookJacket book={book} sizes="56px" />
            </button>
            <div>
              <small>いま読んでいる本</small>
              <b>{bookTitle(book)}</b>
              <CoverCredit book={book} />
            </div>
          </div>
        )}
        <p className="reading-muted">
          {soon
            ? "選ぶと、その本ですぐに読みはじめます。"
            : "ここまで読んだ時間とノートはカードに残ります。選んだ本は、同じカードで続けて読みます。"}
        </p>
        <BookPicker
          books={state.books}
          genreFinds={booksBeforeSearch(state)}
          value={null}
          onChange={choose}
          label="読む本を探す"
          suggestions={booksToRead(state).filter(
            (entry) => entry !== session.bookId,
          )}
          suggestionLabel="読んでいる本・登録した本・読みたい本"
        />
        <button type="button" className="btn quiet" onClick={onClose}>
          このまま読む
        </button>
      </div>
    </Modal>
  );
}
