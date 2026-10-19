"use client";

import { useId, useRef, useState } from "react";
import type { BookHold } from "../lib/bibliography";
import {
  forgetBibliography,
  forgetHold,
  settleHold,
  useBookHold,
} from "../lib/bibliography-session";
import {
  bookFixDraftStore,
  bookFixLosesWords,
  bookFixOf,
  ISBN_FIELD_MAX_LENGTH,
  sameBookFix,
  type BookFixWork,
} from "../lib/book-fix-draft";
import { BOOK_TEXT_MAX } from "../lib/books";
import { bookById, masterTitle, quote } from "../lib/book-name";
import { focusField } from "../lib/coarse-pointer";
import { useKeptDraft } from "../lib/kept-draft";
import { SCAN_COPY } from "../lib/scan";
import { getTownSnapshot, townSettled } from "../lib/store";
import { overSaved, SAVE_REFUSED, useKeptUntilSaved } from "../lib/shop-draft";
import { confirmIsbn } from "../lib/supabase/bibliography";
import { getSupabase } from "../lib/supabase/client";
import type { Book, BookFixResult, Notify, TownActions } from "../lib/types";
import { AGAIN, failure } from "../lib/words";
import {
  KeptDraftNote,
  useDraftOwner,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { Modal } from "./ui";

// A book of the reader's held back (docs/09「食い違いの判定と保留」): its ISBN
// looks like another book's. Its page tells its reader so, and only them,
// with the two answers: fix the ISBN (and the title and author with it), or
// say the book is the ISBN's after all. Nothing shows for a book not held.

export function HeldBook({
  book,
  actions,
  notify,
}: {
  book: Book;
  actions: TownActions;
  notify: Notify;
}) {
  const hold = useBookHold(book.id);
  const [fixing, setFixing] = useState(false);
  const owner = useDraftOwner();
  const draftKey = owner ? `${owner}/${book.id}` : null;
  // Kept here, on the page, so a fix is let go of once the town has it saved
  // although the note itself is gone.
  const saving = useKeptUntilSaved(() => notify(SAVE_REFUSED));
  if (!hold) return null;

  /** Fixes the book; the result, for the sheet to say what went wrong. */
  const save = (work: BookFixWork): BookFixResult => {
    const result = actions.fixBook(book.id, work);
    if (result === "unchanged") setFixing(false);
    if (result !== "fixed") return result;
    // Kept until the account has it too, as the town now holds it.
    const now = bookById(getTownSnapshot().books, book.id);
    if (draftKey && now)
      saving.hold("fix:" + book.id, bookFixDraftStore, draftKey, {
        work: bookFixOf(now),
        base: bookFixOf(book),
      });
    setFixing(false);
    // Gone from the page meanwhile; turned away, it comes back as it was.
    settleHold(book.id, townSettled());
    notify("直しました。本の情報（書誌）とあらためて照らし合わせます");
    return result;
  };

  return (
    <>
      <HeldBookNote
        book={book}
        hold={hold}
        notify={notify}
        onFix={() => setFixing(true)}
      />
      {fixing && (
        <FixBookSheet
          book={book}
          draftKey={draftKey}
          onClose={() => setFixing(false)}
          onSave={save}
        />
      )}
    </>
  );
}

function HeldBookNote({
  book,
  hold,
  notify,
  onFix,
}: {
  book: Book;
  hold: BookHold;
  notify: Notify;
  onFix: () => void;
}) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const names = hold.master.creators.map((person) => person.name).join("、");

  async function confirm() {
    const client = getSupabase();
    if (!client || asking) return;
    setAsking(true);
    const taken = await confirmIsbn(client, book.id);
    setAsking(false);
    if (!taken)
      return notify(
        failure({ what: "伝えられませんでした", next: AGAIN.later }),
      );
    forgetHold(book.id);
    forgetBibliography(book.id);
    notify("このISBNで合っていると伝えました。本の情報（書誌）を出します");
  }

  return (
    <section className="note-box book-held" aria-labelledby={id}>
      <h2 id={id}>この本のISBNを確かめてください</h2>
      <p>
        {hold.earlier ? "前に登録した" : "登録した"}ISBN（{book.isbn}）は、
        {quote(masterTitle(hold.master))}
        {names && `（${names}）`}
        のものです。このお知らせは、あなたにだけ出ています。
      </p>
      <div className="btns">
        <button type="button" className="btn fill" onClick={onFix}>
          ISBNを直す
        </button>
        <button
          type="button"
          className="btn"
          disabled={asking}
          onClick={() => void confirm()}
        >
          このISBNで合っている
        </button>
      </div>
    </section>
  );
}

/** What went wrong with a fix, in the sheet; nothing for one that went. */
const PROBLEMS: Partial<Record<BookFixResult, string>> = {
  "bad-isbn": SCAN_COPY.typing.badIsbn,
  already: "このISBNの本は、もうライブラリにあります",
};

function FixBookSheet({
  book,
  draftKey,
  onClose,
  onSave,
}: {
  book: Book;
  /** Where the words are kept (owner/book id); null while the owner is not known. */
  draftKey: string | null;
  onClose: () => void;
  onSave: (work: BookFixWork) => BookFixResult;
}) {
  const id = useId();
  const kept = useKeptDraft(bookFixDraftStore, draftKey);
  const saved = bookFixOf(book);
  const work = overSaved(kept.draft, saved);
  const { title, author, isbn } = work ?? saved;
  const continuing = useOpenedWithWork(kept.loaded, work !== null);
  const [problem, setProblem] = useState<BookFixResult | null>(null);
  const notTaken = useNotTakenWords();
  const isbnField = useRef<HTMLInputElement>(null);

  function change(patch: Partial<BookFixWork>) {
    setProblem(null);
    const next = { ...(work ?? saved), ...patch };
    kept.set(sameBookFix(next, saved) ? null : { work: next, base: saved });
  }

  return (
    <Modal title="本の登録を直す" onClose={onClose}>
      <form
        className="book-fix-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          const result = onSave({ title, author, isbn });
          if (result !== "fixed" && result !== "unchanged") setProblem(result);
        }}
      >
        <KeptDraftNote
          work={work !== null}
          continuing={continuing}
          saved={kept.saved}
          wordsLost={work !== null && bookFixLosesWords(work, saved)}
          onDiscard={() => {
            kept.clear();
            setProblem(null);
            focusField(isbnField.current);
          }}
        />
        <p className="book-fix-note">
          ISBNは、本の裏表紙のバーコードの上にある、978か979で始まる13桁の数字です。
        </p>
        <label className="form-label" htmlFor={id + "-isbn"}>
          ISBN（なくてもかまいません）
          <input
            id={id + "-isbn"}
            ref={isbnField}
            className="field"
            inputMode="numeric"
            autoComplete="off"
            maxLength={ISBN_FIELD_MAX_LENGTH}
            placeholder="978…"
            value={isbn}
            onChange={(event) => change({ isbn: event.target.value })}
          />
        </label>
        <label className="form-label" htmlFor={id + "-title"}>
          題名
          <input
            id={id + "-title"}
            className="field"
            required
            maxLength={BOOK_TEXT_MAX}
            value={title}
            onChange={(event) => change({ title: event.target.value })}
          />
        </label>
        <label className="form-label" htmlFor={id + "-author"}>
          著者
          <input
            id={id + "-author"}
            className="field"
            maxLength={BOOK_TEXT_MAX}
            value={author}
            onChange={(event) => change({ author: event.target.value })}
          />
        </label>
        {problem && (
          <p className="book-fix-note" role="alert">
            {PROBLEMS[problem] ?? notTaken}
          </p>
        )}
        <div className="btns">
          <button type="submit" className="btn fill" disabled={!title.trim()}>
            保存する
          </button>
        </div>
      </form>
    </Modal>
  );
}
