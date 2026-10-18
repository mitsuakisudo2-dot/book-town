"use client";

import { useState } from "react";
import type { Book, Notify, TownActions, TownState } from "../lib/types";
import { getTownSnapshot } from "../lib/store";
import { bookTraces, isInLibrary, myBook } from "../lib/library-town";
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
 *
 * 登録済み is being in the library, however the book came in (AUD-148): a
 * book in the reader's shop, their 人生の9冊 or 読みたい is in already, and
 * taking it out takes it out of the library as the library's 外す does,
 * not only the registering.
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
  const registered = isInLibrary(state, book.id);
  const traces = bookTraces(state, book.id);
  const inShop = myBook(state, book.id).inShop;
  const toggle = () => {
    if (registered) actions.changeLibrary([book.id], { removed: true });
    else if (state.library.includes(book.id))
      actions.changeLibrary([book.id], { removed: false });
    else actions.toggleLibrary(book.id);
    const now = isInLibrary(getTownSnapshot(), book.id);
    if (now === registered) return;
    notify(
      now
        ? REGISTER.added(quotedTitle(book))
        : REGISTER.undone(quotedTitle(book)),
    );
  };
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
        className={[
          "btn",
          registered ? "quiet" : "soft",
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
        {registered
          ? short
            ? REGISTER.doneTap
            : REGISTER.done
          : short
            ? REGISTER.tap
            : REGISTER.button}
      </button>
      {asking === "remove" && (
        <Modal title={REGISTER.removeAsk} onClose={close}>
          <p className="modal-lead">{quotedTitle(book)}</p>
          {inShop && <p className="muted">{REGISTER.shopStays}</p>}
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
          {inShop && <p className="muted">{REGISTER.shopStays}</p>}
          {choices(() => {
            close();
            toggle();
          })}
        </Modal>
      )}
    </>
  );
}
