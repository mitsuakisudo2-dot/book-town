"use client";

import { useState } from "react";
import type { Book, Notify, TownActions, TownState } from "../lib/types";
import { getTownSnapshot } from "../lib/store";
import { bookTraces } from "../lib/library-town";
import { holds } from "../lib/own-books";
import { quotedTitle } from "../lib/book-name";
import { REGISTER } from "../lib/words";
import { Icon, Modal } from "./ui";
import "./reading.css";

/**
 * One tap puts a book the town knows in the reader's library (管理表 12):
 * no reading status is asked, it is chosen later in the library. Tapped
 * again it comes back out, as 読みたい does (けにー 10-18「普通にもう一度
 * 押して戻す方がいい」), after asking: once, and once more when the book
 * has records, memos or a reading status. Said only when it was done: a
 * visitor is asked to sign in instead, and nothing changes.
 */
export function RegisterBook({
  book,
  state,
  actions,
  notify,
  short = false,
  className = "",
}: {
  book: Book;
  state: TownState;
  actions: TownActions;
  notify: Notify;
  /** Beside a search result: 登録 / 登録済み. */
  short?: boolean;
  className?: string;
}) {
  const [asking, setAsking] = useState<"remove" | "again" | null>(null);
  // Asked of another reader's book, the reader's own of it answers.
  const registered = holds(state, state.library, book.id);
  const traces = bookTraces(state, book.id);
  const toggle = () => {
    actions.toggleLibrary(book.id);
    const town = getTownSnapshot();
    const now = holds(town, town.library, book.id);
    if (now === registered) return;
    notify(
      now
        ? REGISTER.added(quotedTitle(book))
        : REGISTER.undone(quotedTitle(book)),
    );
  };
  const done = short ? REGISTER.doneTap : REGISTER.done;
  const undone = short ? REGISTER.tap : REGISTER.button;
  const close = () => setAsking(null);
  const choices = (remove: () => void) => (
    <div className="btns">
      <button type="button" className="btn danger fill" onClick={remove}>
        {REGISTER.remove}
      </button>
      <button type="button" className="btn" onClick={close}>
        {REGISTER.keep}
      </button>
    </div>
  );
  return (
    <>
      <button
        type="button"
        // Still a button once in (114): pressed again it asks to take it out.
        className={[
          "btn",
          registered ? "is-in" : "soft",
          "register-book",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        // A toggle: its name stays what it does, pressed while registered.
        aria-pressed={registered}
        aria-label={
          short ? `${quotedTitle(book)}を${REGISTER.button}` : REGISTER.button
        }
        onClick={() => (registered ? setAsking("remove") : toggle())}
      >
        <Icon name={registered ? "check" : "plus"} size={18} />
        {/* As wide as the longer of its two names, so pressing it moves
            nothing beside it (検索's row keeps its height, 114). */}
        <span className="register-label">
          <span>{registered ? done : undone}</span>
          <span aria-hidden="true">{registered ? undone : done}</span>
        </span>
      </button>
      {asking === "remove" && (
        <Modal title={REGISTER.removeAsk} onClose={close}>
          <p className="modal-lead">{quotedTitle(book)}</p>
          {choices(() => {
            if (traces.written || traces.finished || traces.reading)
              setAsking("again");
            else {
              close();
              toggle();
            }
          })}
        </Modal>
      )}
      {asking === "again" && (
        <Modal title={REGISTER.removeAskAgain} onClose={close}>
          <p className="modal-lead">{quotedTitle(book)}</p>
          <ul className="register-traces">
            {traces.written && <li>{REGISTER.traces}</li>}
            {traces.finished && <li>{REGISTER.finished}</li>}
            {traces.reading && !traces.finished && <li>{REGISTER.reading}</li>}
          </ul>
          {traces.written && <p className="muted">{REGISTER.traceStays}</p>}
          {choices(() => {
            close();
            toggle();
          })}
        </Modal>
      )}
    </>
  );
}

/**
 * The ✓ on the cover of a book in the reader's library, beside 登録 (114
 * 本を登録する瞬間): where the eye already is, the book itself says it is
 * in. It comes in with a small bounce only when it was put in on this
 * screen. A picture only: 登録's button says it.
 */
export function InLibraryMark({
  book,
  state,
}: {
  book: Book;
  state: TownState;
}) {
  const registered = holds(state, state.library, book.id);
  const [seenOut, setSeenOut] = useState(!registered);
  if (!registered && !seenOut) setSeenOut(true);
  if (!registered) return null;
  return (
    <span
      className={"in-library-mark" + (seenOut ? " is-new" : "")}
      aria-hidden="true"
    >
      <Icon name="check" />
    </span>
  );
}
