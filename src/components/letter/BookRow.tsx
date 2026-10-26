"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { bookPath } from "../../lib/books";
import { bookAuthor, bookTitle, quotedTitle } from "../../lib/book-name";
import type {
  Book,
  Notify,
  Post,
  TownActions,
  TownState,
} from "../../lib/types";
import { BookJacket } from "../ui";
import { LetterIcon } from "./icons";
import { NAMES } from "../../lib/words";
import { memoOffer } from "../../lib/encounter-memo";

/**
 * The book a 便り is about, in a thin frame: its cover whole, its title and
 * author, and up to two of the writer's own feelings from their public
 * record of it. The frame leads to the book's page; 読みたい sits at its
 * lower right.
 */
export function BookRow({
  book,
  feelings,
  want,
}: {
  book: Book;
  feelings: string[];
  want?: ReactNode;
}) {
  return (
    <div className="letter-book">
      <Link href={bookPath(book.id)} className="post-book">
        <span className="letter-jacket" aria-hidden="true">
          <BookJacket book={book} sizes="44px" />
        </span>
        <span className="letter-book-words">
          <b className="letter-book-title">{bookTitle(book)}</b>
          <span className="letter-book-author">{bookAuthor(book)}</span>
          {feelings.length > 0 && (
            <span className="letter-feelings">
              {feelings.map((feeling) => (
                <span key={feeling}>{feeling}</span>
              ))}
            </span>
          )}
        </span>
      </Link>
      {want}
    </div>
  );
}

/**
 * 読みたい on someone else's 便り about a book: the book goes on the reader's
 * wishlist, and the 便り is kept as where they met it (shown on the book's
 * page). Taken back, the meeting goes and the wishlist stays.
 */
export function WantButton({
  state,
  actions,
  notify,
  post,
  book,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
  post: Post;
  book: Book;
}) {
  const wanted = state.wantedPosts.includes(post.id);
  // Turned on just now: the lamp's light, once.
  const [lit, setLit] = useState(false);
  return (
    <button
      type="button"
      className={
        "letter-want" +
        (wanted ? " is-on" : "") +
        (wanted && lit ? " is-lit" : "")
      }
      aria-pressed={wanted}
      onAnimationEnd={() => setLit(false)}
      onClick={() => {
        setLit(!wanted);
        actions.toggleWant(post.id);
        if (wanted)
          return notify(
            `この${NAMES.letter}で出会った記録を外しました。読みたい本には残っています`,
          );
        // One short line, which book: with its メモ when it met the book.
        notify(
          `${quotedTitle(book)}を読みたいに入れました`,
          memoOffer(state, actions),
        );
      }}
    >
      <span className="letter-want-pill">
        <LetterIcon name="want" size={18} filled={wanted} />
        読みたい
      </span>
    </button>
  );
}
