"use client";

import type { Book, TownActions, TownState } from "../lib/types";
import { getTownSnapshot } from "../lib/store";
import { quotedTitle } from "../lib/book-name";
import { REGISTER } from "../lib/words";
import { Icon } from "./ui";

/**
 * One tap puts a book the town knows in the reader's library (管理表 12):
 * no reading status is asked, it is chosen later in the library. A second
 * tap takes the registering back, as 読みたい does. Said only when it was
 * done: a visitor is asked to sign in instead, and nothing changes.
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
  notify: (message: string) => void;
  /** Beside a search result: 登録 / 登録済み. */
  short?: boolean;
  className?: string;
}) {
  const registered = state.library.includes(book.id);
  const words = registered
    ? short
      ? REGISTER.doneTap
      : REGISTER.done
    : short
      ? REGISTER.tap
      : REGISTER.button;
  return (
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
      aria-pressed={registered}
      aria-label={
        short ? `${quotedTitle(book)}を${REGISTER.button}` : undefined
      }
      onClick={() => {
        actions.toggleLibrary(book.id);
        const now = getTownSnapshot().library.includes(book.id);
        if (now === registered) return;
        notify(
          now
            ? REGISTER.added(quotedTitle(book))
            : REGISTER.undone(quotedTitle(book)),
        );
      }}
    >
      <Icon name={registered ? "check" : "plus"} size={18} />
      {words}
    </button>
  );
}
