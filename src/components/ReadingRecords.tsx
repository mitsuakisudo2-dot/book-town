"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { profilePath } from "../lib/paths";
import {
  bookFeelings,
  ownRecordFor,
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
  type ReadingRecord,
  type TownActions,
  type TownState,
} from "../lib/types";
import { bookPath } from "../lib/books";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import "./records.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

const KEPT = [
  "この本と過ごした時間が、棚に残ります。",
  "最後のページまで、おつかれさまでした。",
  "しおり、確かに預かりました。",
];
const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/**
 * Keeps what a reader felt when they finished a book: feelings instead of
 * stars, a few words, and who may see it. Opens empty for a new record, or
 * with an existing one to change it.
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
  const [feelings, setFeelings] = useState<Feeling[]>(record?.feelings ?? []);
  const [note, setNote] = useState(record?.note ?? "");
  const [spoiler, setSpoiler] = useState(record?.spoiler ?? false);
  const [isPublic, setIsPublic] = useState(
    record?.isPublic ?? state.settings.readingPublic,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const toggle = (feeling: Feeling) =>
    setFeelings((list) =>
      list.includes(feeling)
        ? list.filter((entry) => entry !== feeling)
        : [...list, feeling],
    );

  function save() {
    const draft = { feelings, note, spoiler, isPublic };
    if (record) {
      actions.updateRecord(record.id, draft);
      notify("記録を書き直しました");
    } else if (actions.recordReading({ ...draft, bookId: book.id })) {
      notify(pick(KEPT));
    }
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
          <b>{book.title}</b>
          <small>{book.author}</small>
        </div>
      </div>
      <fieldset className="feeling-picker">
        <legend>どんな気持ちになりましたか？（いくつでも、なくても）</legend>
        <div>
          {FEELINGS.map((feeling) => (
            <button
              type="button"
              key={feeling}
              className="feeling-chip"
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
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="record-options">
        {note.trim() && (
          <label>
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(event) => setSpoiler(event.target.checked)}
            />
            ネタバレを含む
          </label>
        )}
        <span className="record-count" aria-hidden="true">
          {note.length}/{RECORD_NOTE_MAX_LENGTH}
        </span>
      </div>
      <fieldset className="record-visibility">
        <legend>この記録を見られる人</legend>
        <label>
          <input
            type="radio"
            name="record-visibility"
            checked={isPublic}
            onChange={() => setIsPublic(true)}
          />
          公開
        </label>
        <label>
          <input
            type="radio"
            name="record-visibility"
            checked={!isPublic}
            onChange={() => setIsPublic(false)}
          />
          自分だけ
        </label>
      </fieldset>
      <div className="record-actions">
        <button className="button primary" type="button" onClick={save}>
          {record ? "書き直す" : "記録する"}
        </button>
        <button className="button secondary" type="button" onClick={onClose}>
          {record ? "やめる" : "あとで"}
        </button>
        {record &&
          (confirmingDelete ? (
            <button
              type="button"
              className="text-button record-delete"
              onClick={() => {
                actions.deleteRecord(record.id);
                notify("記録を消しました");
                onClose();
              }}
            >
              本当に消す
            </button>
          ) : (
            <button
              type="button"
              className="text-button record-delete"
              onClick={() => setConfirmingDelete(true)}
            >
              記録を消す
            </button>
          ))}
      </div>
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
            <Icon name={own.isPublic ? "users" : "lock"} size={13} />
            あなたの記録
            {own.feelings.length > 0 &&
              "：" +
                own.feelings
                  .map((feeling) => FEELING_WORDS[feeling])
                  .join("・")}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => setOpen(true)}
          >
            見直す
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button secondary"
          onClick={() => setOpen(true)}
        >
          <Icon name="leaf" size={15} />
          読み終えた気持ちを残す
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
  const editingBook =
    editing && state.books.find((book) => book.id === editing.bookId);
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
          const book = state.books.find((entry) => entry.id === record.bookId);
          if (!book) return null;
          const hidden = record.spoiler && !mine && !opened.includes(record.id);
          return (
            <li key={record.id} className="record-card">
              <Link href={bookPath(book.id)} className="record-card-book">
                <BookJacket book={book} />
              </Link>
              <div>
                <Link href={bookPath(book.id)} className="record-card-title">
                  {book.title}
                </Link>
                {record.feelings.length > 0 && (
                  <p className="record-card-feelings">
                    {record.feelings.map((feeling) => (
                      <span key={feeling}>{FEELING_WORDS[feeling]}</span>
                    ))}
                  </p>
                )}
                {record.note &&
                  (hidden ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setOpened([...opened, record.id])}
                    >
                      ネタバレを含むひとことを読む
                    </button>
                  ) : (
                    <p className="record-card-note">{record.note}</p>
                  ))}
                <p className="record-card-meta">
                  <time dateTime={record.createdAt}>
                    {new Date(record.createdAt).toLocaleDateString("ja-JP")}
                  </time>
                  {mine && !record.isPublic && (
                    <span>
                      <Icon name="lock" size={12} />
                      自分だけ
                    </span>
                  )}
                  {mine && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditing(record)}
                    >
                      見直す
                    </button>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && editingBook && (
        <RecordSheet
          state={state}
          actions={actions}
          notify={notify}
          book={editingBook}
          record={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
