"use client";

import { useEffect, useState } from "react";
import { liveShelves, READING_STATUSES, shelfLabel } from "../lib/library";
import { entriesOf, libraryIds, type LibraryChange } from "../lib/library-town";
import type { Notify, TownActions, TownState } from "../lib/types";
import { counted, MARKS, REGISTER, THIS_SCAN } from "../lib/words";
import { bookById } from "../lib/book-name";
import { BookJacket, Modal } from "./ui";
import "./scan.css";

/**
 * 「この回の本」(AUD-139, the light form of 管理表 16): once a scan ends,
 * the books it registered are given a status, 持っている or a shelf of the
 * reader's own together, or taken out of the library again, in one sheet.
 * Each choice is made at once, as in the library's ［選ぶ］; ［完了］ only
 * closes. A book taken out or gone meanwhile is left out of the sheet.
 */
export function ScanTidy({
  bookIds,
  state,
  actions,
  notify,
  onClose,
}: {
  bookIds: readonly string[];
  state: TownState;
  actions: TownActions;
  notify: Notify;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const shown = libraryIds(state);
  const ids = bookIds.filter((id) => shown.has(id));
  const rows = entriesOf(state);
  const books = ids.flatMap((id) => bookById(state.books, id) ?? []);
  const handShelves = liveShelves(state.libraryShelves).filter(
    (shelf) => shelf.rule === null,
  );
  /** Lit: every book of this scan has it already. */
  const all = (has: (id: string) => boolean) =>
    ids.length > 0 && ids.every(has);
  const these = counted(ids.length, "冊");
  const change = (set: LibraryChange, done: string) => {
    if (actions.changeLibrary(ids, set)) notify(`この回の${these}を${done}`);
  };
  // Every book gone meanwhile (taken out elsewhere): nothing to tidy.
  const none = ids.length === 0;
  useEffect(() => {
    if (none) onClose();
  }, [none, onClose]);
  if (none) return null;
  if (asking)
    return (
      <Modal title={THIS_SCAN.removeAsk} onClose={() => setAsking(false)}>
        <p className="modal-lead">{THIS_SCAN.removeLead}</p>
        <div className="btns">
          <button
            type="button"
            className="btn danger fill"
            onClick={() => {
              const removed = actions.changeLibrary(ids, { removed: true });
              setAsking(false);
              if (!removed) return;
              notify(THIS_SCAN.removed(these));
              onClose();
            }}
          >
            {THIS_SCAN.removeButton}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setAsking(false)}
          >
            {REGISTER.keep}
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title={THIS_SCAN.heading} onClose={onClose} fromBottom>
      <p className="modal-lead">{THIS_SCAN.lead(these)}</p>
      <ol className="scan-tidy-books" aria-label={THIS_SCAN.heading}>
        {books.map((book) => (
          <li key={book.id}>
            <BookJacket book={book} sizes="56px" />
          </li>
        ))}
      </ol>
      <h3 className="scan-tidy-heading">{THIS_SCAN.status}</h3>
      <div className="btns" role="group" aria-label={THIS_SCAN.status}>
        {READING_STATUSES.map((status) => {
          const lit = all((id) => rows[id]?.status === status);
          return (
            <button
              key={status}
              type="button"
              className="chip"
              aria-pressed={lit}
              onClick={() =>
                change(
                  { status: lit ? null : status },
                  lit
                    ? MARKS.unset(shelfLabel(status))
                    : MARKS.set(shelfLabel(status)),
                )
              }
            >
              {shelfLabel(status)}
            </button>
          );
        })}
        {(() => {
          const lit = all((id) => rows[id]?.owned === "yes");
          return (
            <button
              type="button"
              className="chip"
              aria-pressed={lit}
              onClick={() =>
                change(
                  { owned: lit ? null : "yes" },
                  lit ? MARKS.ownedOff : MARKS.ownedOn,
                )
              }
            >
              {MARKS.owned}
            </button>
          );
        })()}
      </div>
      {handShelves.length > 0 && (
        <>
          <h3 className="scan-tidy-heading">{THIS_SCAN.shelves}</h3>
          <div className="btns" role="group" aria-label={THIS_SCAN.shelves}>
            {handShelves.map((shelf) => {
              const on = (id: string) =>
                state.libraryShelfBooks.some(
                  (entry) => entry.shelfId === shelf.id && entry.bookId === id,
                );
              const lit = all(on);
              return (
                <button
                  key={shelf.id}
                  type="button"
                  className="chip"
                  aria-pressed={lit}
                  onClick={() =>
                    change(
                      lit ? { removeShelf: shelf.id } : { addShelf: shelf.id },
                      lit
                        ? MARKS.outOfShelf(shelf.name)
                        : MARKS.intoShelf(shelf.name),
                    )
                  }
                >
                  {shelf.name}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="scan-tidy-end">
        <button type="button" className="btn fill" onClick={onClose}>
          {THIS_SCAN.done}
        </button>
        <button
          type="button"
          className="text-btn scan-tidy-remove"
          onClick={() => setAsking(true)}
        >
          {THIS_SCAN.remove}
        </button>
      </div>
    </Modal>
  );
}
