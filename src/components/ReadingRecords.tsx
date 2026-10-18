"use client";
import { shortDate } from "../lib/japan-time";
import Link from "next/link";
import { useId, useState } from "react";
import { profilePath } from "../lib/paths";
import {
  bookFeelings,
  ownRecordFor,
  recordNoteView,
  recordsOf,
  talkersOf,
} from "../lib/records";
import {
  FEELINGS,
  FEELING_WORDS,
  ME_ID,
  RECORD_NOTE_MAX_LENGTH,
  type Book,
  type Feeling,
  type Notify,
  type ReadingRecord,
  type TownActions,
  type TownState,
} from "../lib/types";
import { bookPath } from "../lib/books";
import { useKeptDraft } from "../lib/kept-draft";
import {
  recordChanges,
  recordDrafts,
  recordWorkKey,
  type RecordWork,
} from "../lib/record-draft";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import {
  KeptDraftNote,
  StopConfirm,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { LengthNearLimit } from "./Social";
import { shownToOthers, type Audience } from "../lib/visibility";
import { bookAuthor, bookById, bookTitle } from "../lib/book-name";
import { townOffline } from "../lib/store";
import { failure, offlineFor } from "../lib/words";
import "./records.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

const KEPT = [
  "この本と過ごした時間が、棚に残ります。",
  "最後のページまで、おつかれさまでした。",
  "しおり、確かに預かりました。",
];
const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/**
 * Publishing is told every time, with the way back right there: no dialog to
 * get past first, and nothing goes out unnoticed.
 */
function told(
  actions: TownActions,
  notify: Notify,
  recordId: string,
  audience: Audience,
) {
  if (shownToOthers(audience)) {
    notify("公開しました。同じ本を読んだ人に届きます", {
      label: "自分だけに戻す",
      run: () => {
        actions.updateRecord(recordId, { audience: "private" });
        notify("自分だけに戻しました");
      },
    });
  } else notify("自分だけにしました");
}

/**
 * The other of the two choices a record offers until フォロワー限定 comes
 * (item 51): shown to others goes back to the reader, the reader's own goes
 * public.
 */
const flipped = (audience: Audience): Audience =>
  shownToOthers(audience) ? "private" : "everyone";

/** The quiet one-tap publish (or the way back) beside 「見直す」. */
function PublishButton({
  actions,
  notify,
  record,
}: Pick<Shared, "actions" | "notify"> & { record: ReadingRecord }) {
  return (
    <button
      type="button"
      className="text-btn record-publish"
      onClick={() => {
        const audience = flipped(record.audience);
        actions.updateRecord(record.id, { audience });
        told(actions, notify, record.id, audience);
      }}
    >
      {shownToOthers(record.audience) ? "自分だけにする" : "公開する"}
    </button>
  );
}

/** The key of the reader's work on a book's new record (or a record's changes). */
function useRecordWorkKey(options: {
  recordId?: string;
  bookId: string;
}): string | null {
  const owner = useDraftOwner();
  return owner === null ? null : recordWorkKey({ owner, ...options });
}

/** Whether there is work kept for a book's new record (or a record's changes). */
export const useRecordWorkKept = (options: {
  recordId?: string;
  bookId: string;
}) => useKeptDraft(recordDrafts, useRecordWorkKey(options)).draft !== null;

/**
 * Keeps what a reader felt when they finished a book: feelings instead of
 * stars, a few words, and who may see it. Opens empty for a new record, or
 * with an existing one to change it. What is chosen and written is kept in
 * this browser until it is saved: a tap outside, Escape, 戻る or あとで lose
 * nothing. Only やめる (while changing a record) or 書きかけを消す throw it away.
 */
export function RecordSheet({
  state,
  actions,
  notify,
  book,
  record,
  onClose,
}: Shared & { book: Book; record?: ReadingRecord; onClose: () => void }) {
  const noteId = useId();
  const { draft, saved, loaded, set, clear } = useKeptDraft(
    recordDrafts,
    useRecordWorkKey({ recordId: record?.id, bookId: book.id }),
  );
  const continuing = useOpenedWithWork(loaded, draft !== null);
  const notTaken = useNotTakenWords();
  // What is kept for real: the record as it is, or a new one's empty start.
  const base: RecordWork = record
    ? {
        feelings: record.feelings,
        note: record.note,
        spoiler: record.spoiler,
        audience: record.audience,
      }
    : {
        feelings: [],
        note: "",
        spoiler: false,
        audience: state.settings.visibility.records.audience,
      };
  // Only the changes are kept, over the record as it is now.
  const work: RecordWork = { ...base, ...draft };
  const { feelings, note, spoiler, audience } = work;
  const isPublic = shownToOthers(audience);
  // Words written that are not in the record yet, lost if thrown away.
  const wordsLost = note.trim() !== base.note.trim();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stopping, setStopping] = useState(false);
  const change = (patch: Partial<RecordWork>) =>
    set(recordChanges({ ...work, ...patch }, base));
  const toggle = (feeling: Feeling) =>
    change({
      feelings: feelings.includes(feeling)
        ? feelings.filter((entry) => entry !== feeling)
        : [...feelings, feeling],
    });

  // Saving and publishing are told apart: the toast says when a record went
  // out to others (with the way back), and when it came back to the reader.
  // A change the town did not take keeps the sheet open, with the work.
  function save() {
    // The record waits on this device until it is saved (outbox.ts); should
    // the database turn it away, its words come back to the draft
    // (missed-changes.ts).
    const offline = townOffline();
    if (record) {
      // Only what was changed: the rest stays as the record is by now.
      if (!actions.updateRecord(record.id, draft ?? {})) {
        notify(notTaken);
        return;
      }
      clear();
      if (offline) notify(failure(offlineFor("記録")));
      else if (audience !== record.audience)
        told(actions, notify, record.id, audience);
      else notify("記録を書き直しました");
    } else {
      const id = actions.recordReading({ ...work, bookId: book.id });
      if (!id) {
        notify(notTaken);
        return;
      }
      clear();
      if (offline) notify(failure(offlineFor("記録")));
      else if (isPublic) told(actions, notify, id, audience);
      else notify(pick(KEPT));
    }
    onClose();
  }

  // やめる is the one close that throws the changes away (asked once when
  // words would be lost); every other way out keeps them.
  function stop() {
    clear();
    onClose();
  }

  return (
    <Modal
      title={record ? "記録を見直す" : "読み終えた気持ち"}
      onClose={onClose}
    >
      <div className="record-book">
        <BookJacket book={book} />
        <div>
          <b>{bookTitle(book)}</b>
          <small>{bookAuthor(book)}</small>
        </div>
      </div>
      <fieldset className="feeling-picker">
        <legend>どんな気持ちになりましたか？（いくつでも、なくても）</legend>
        <div>
          {FEELINGS.map((feeling) => (
            <button
              type="button"
              key={feeling}
              className="chip"
              aria-pressed={feelings.includes(feeling)}
              onClick={() => toggle(feeling)}
            >
              {FEELING_WORDS[feeling]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="form-label" htmlFor={noteId}>
        ひとこと（なくても大丈夫です）
      </label>
      <textarea
        id={noteId}
        className="field"
        rows={3}
        maxLength={RECORD_NOTE_MAX_LENGTH}
        placeholder="残っている場面や、読み終えた夜のこと"
        value={note}
        onChange={(event) => change({ note: event.target.value })}
      />
      <div className="record-options">
        {note.trim() && (
          <label>
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(event) => change({ spoiler: event.target.checked })}
            />
            ネタバレを含む
          </label>
        )}
        <LengthNearLimit
          length={note.length}
          max={RECORD_NOTE_MAX_LENGTH}
          className="record-count"
        />
      </div>
      <p className="record-going" aria-live="polite">
        <Icon name={isPublic ? "users" : "lock"} size={14} />
        <span>
          {isPublic
            ? "公開します（同じ本を読んだ人に届きます）"
            : "自分だけに残します"}
        </span>
        <button
          type="button"
          className="text-btn"
          onClick={() => change({ audience: flipped(audience) })}
        >
          {isPublic ? "自分だけにする" : "公開にする"}
        </button>
      </p>
      <KeptDraftNote
        continuing={continuing && draft !== null}
        saved={saved}
        wordsLost={wordsLost}
        onDiscard={clear}
      />
      {stopping ? (
        <StopConfirm onDiscard={stop} onKeep={onClose} />
      ) : (
        <div className="record-actions">
          <button className="btn fill" type="button" onClick={save}>
            {record ? "書き直す" : "記録する"}
          </button>
          {/* あとで keeps what is chosen for the next time; やめる does not. */}
          <button
            className="btn"
            type="button"
            onClick={() =>
              !record ? onClose() : wordsLost ? setStopping(true) : stop()
            }
          >
            {record ? "やめる" : "あとで"}
          </button>
          {record &&
            (confirmingDelete ? (
              <button
                type="button"
                className="text-btn record-delete"
                onClick={() => {
                  actions.deleteRecord(record.id);
                  clear();
                  notify("記録を消しました");
                  onClose();
                }}
              >
                本当に消す
              </button>
            ) : (
              <button
                type="button"
                className="text-btn record-delete"
                onClick={() => setConfirmingDelete(true)}
              >
                記録を消す
              </button>
            ))}
        </div>
      )}
    </Modal>
  );
}

/** The book page's 読後の気持ち: words, not scores, and who wants to talk. */
export function BookFeelings({
  state,
  actions,
  notify,
  book,
}: Shared & { book: Book }) {
  const [open, setOpen] = useState(false);
  const words = bookFeelings(state, book.id);
  const talkers = talkersOf(state, book.id);
  const own = ownRecordFor(state, book.id);
  // Feelings chosen and left for later are picked up where they were.
  const keptNew = useRecordWorkKept({ bookId: book.id });
  return (
    <section className="book-feelings" aria-labelledby="book-feelings-title">
      <span className="eyebrow">AFTER THE LAST PAGE</span>
      <h2 id="book-feelings-title">読み終えた人の気持ち</h2>
      {words.length ? (
        <p className="book-feelings-words">
          {words.map((feeling) => (
            <span key={feeling}>{FEELING_WORDS[feeling]}</span>
          ))}
        </p>
      ) : (
        <p className="book-feelings-empty">
          星の数ではなく、読み終えたときの気持ちを言葉で残す場所です。
        </p>
      )}
      {talkers.length > 0 && (
        <div className="book-talkers">
          <h3>この本について、誰かと話したい人</h3>
          <ul>
            {talkers.slice(0, 8).map((reader) => (
              <li key={reader.id}>
                <Link href={profilePath(reader.id)}>
                  <ReaderAvatar reader={reader} size={30} />
                  <span>{reader.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {own ? (
        <div className="book-feelings-own">
          <p>
            <Icon
              name={shownToOthers(own.audience) ? "users" : "lock"}
              size={13}
            />
            あなたの記録
            {own.feelings.length > 0 &&
              "：" +
                own.feelings
                  .map((feeling) => FEELING_WORDS[feeling])
                  .join("・")}
          </p>
          <span className="book-feelings-own-actions">
            <button
              type="button"
              className="text-btn"
              onClick={() => setOpen(true)}
            >
              見直す
            </button>
            <PublishButton actions={actions} notify={notify} record={own} />
          </span>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          <Icon name="leaf" size={15} />
          {keptNew ? "書きかけの気持ちを続ける" : "読み終えた気持ちを残す"}
        </button>
      )}
      {open && (
        <RecordSheet
          state={state}
          actions={actions}
          notify={notify}
          book={book}
          record={own}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** A reader's finished books with their feelings, for the profile page. */
export function RecordShelf({
  state,
  actions,
  notify,
  readerId,
}: Shared & { readerId: string }) {
  const [editing, setEditing] = useState<ReadingRecord | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const records = recordsOf(state, readerId);
  if (!records.length) return null;
  const mine = readerId === ME_ID;
  // The record as it is now, if it was changed after 見直す was tapped.
  const editingRecord =
    editing && records.find((entry) => entry.id === editing.id);
  const editingBook =
    editingRecord && bookById(state.books, editingRecord.bookId);
  return (
    <section className="record-shelf" aria-labelledby="record-shelf-title">
      <div className="profile-section-heading">
        <div>
          <p className="profile-eyebrow">AFTER THE LAST PAGE</p>
          <h2 id="record-shelf-title">読み終えた本</h2>
        </div>
      </div>
      <ul>
        {records.map((record) => {
          const book = bookById(state.books, record.bookId);
          if (!book) return null;
          const noteView = recordNoteView(state, record);
          const hidden = noteView === "folded" && !opened.includes(record.id);
          return (
            <li key={record.id} className="record-card">
              <Link href={bookPath(book.id)} className="record-card-book">
                <BookJacket book={book} />
              </Link>
              <div>
                <Link href={bookPath(book.id)} className="record-card-title">
                  {bookTitle(book)}
                </Link>
                {record.feelings.length > 0 && (
                  <p className="record-card-feelings">
                    {record.feelings.map((feeling) => (
                      <span key={feeling}>{FEELING_WORDS[feeling]}</span>
                    ))}
                  </p>
                )}
                {record.note &&
                  noteView !== "left_out" &&
                  (hidden ? (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setOpened([...opened, record.id])}
                    >
                      ネタバレを含むひとことを読む
                    </button>
                  ) : (
                    <p className="record-card-note">{record.note}</p>
                  ))}
                <p className="record-card-meta">
                  <time dateTime={record.createdAt}>
                    {shortDate(record.createdAt)}
                  </time>
                  {mine && !shownToOthers(record.audience) && (
                    <span>
                      <Icon name="lock" size={12} />
                      自分だけ
                    </span>
                  )}
                  {mine && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setEditing(record)}
                    >
                      見直す
                    </button>
                  )}
                  {mine && (
                    <PublishButton
                      actions={actions}
                      notify={notify}
                      record={record}
                    />
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {editingRecord && editingBook && (
        <RecordSheet
          state={state}
          actions={actions}
          notify={notify}
          book={editingBook}
          record={editingRecord}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
