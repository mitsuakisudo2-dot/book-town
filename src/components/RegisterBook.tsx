"use client";

import type { Book, Notify, TownActions, TownState } from "../lib/types";
import { getTownSnapshot } from "../lib/store";
import { quotedTitle } from "../lib/book-name";
import { REGISTER } from "../lib/words";
import { Icon } from "./ui";

/**
 * One tap puts a book the town knows in the reader's library (管理表 12):
 * no reading status is asked, it is chosen later in the library. Once in,
 * it says so and does nothing more: a tap there never takes it out (けにー
 * 10-18). A tap by mistake is taken back from the notice's 元に戻す, and a
 * book is taken out in the library. Said only when it was done: a visitor
 * is asked to sign in instead, and nothing changes.
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
  const classes = (...more: string[]) =>
    [...more, "register-book", className].filter(Boolean).join(" ");
  if (state.library.includes(book.id))
    return (
      <span className={classes("btn", "quiet", "is-done")}>
        <Icon name="check" size={18} />
        {short ? REGISTER.doneTap : REGISTER.done}
      </span>
    );
  const registered = () => getTownSnapshot().library.includes(book.id);
  return (
    <button
      type="button"
      className={classes("btn", "soft")}
      aria-label={
        short ? `${quotedTitle(book)}を${REGISTER.button}` : undefined
      }
      onClick={() => {
        actions.toggleLibrary(book.id);
        if (!registered()) return;
        notify(REGISTER.added(quotedTitle(book)), {
          label: REGISTER.undo,
          run: () => {
            if (!registered()) return;
            actions.toggleLibrary(book.id);
            if (!registered()) notify(REGISTER.undone(quotedTitle(book)));
          },
        });
      }}
    >
      <Icon name="plus" size={18} />
      {short ? REGISTER.tap : REGISTER.button}
    </button>
  );
}
