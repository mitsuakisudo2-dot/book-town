"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReadingMode } from "../../lib/types";
import { currentBookId } from "../../lib/reading";
import { booksBeforeSearch } from "../../lib/book-lists";
import {
  bookAuthor,
  bookById,
  booksById,
  bookTitle,
} from "../../lib/book-name";
import { leaveLayers } from "../../lib/back-layer";
import { BookPicker } from "../BookPicker";
import { BookJacket, Icon, Modal } from "../ui";
import type { Shared } from "./Letters";
import { readingListPath, readingPath } from "../../lib/paths";

/** How many of the 読みたい本 the sheet offers before 「ぜんぶ見る」. */
const WISHES = 6;

/**
 * 読書をはじめる (決定 H:100): first the book (the one being read, a few of
 * the 読みたい本, or any other found by search), then how to read it. Then
 * reading starts and the 読書 page opens.
 */
export function StartReadingSheet({
  state,
  actions,
  notify,
  onClose,
}: Shared & { onClose: () => void }) {
  const router = useRouter();
  const current = currentBookId(state);
  const ids = [
    ...(current ? [current] : []),
    ...state.wishlist.filter(
      (id) => id !== current && !state.finishedBooks.includes(id),
    ),
  ];
  const offered = booksById(state.books, ids).slice(0, 1 + WISHES);
  const [chosen, setChosen] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const book = bookById(state.books, chosen);
  function start(mode: ReadingMode) {
    // Turned away (a visitor is asked to sign in instead): the sheet goes.
    if (!actions.startReading(chosen, mode)) return onClose();
    notify(
      mode === "solo"
        ? "一人で読み始めました。ノートはあなただけに見えます"
        : "みんなで読み始めました。同じ時間に読んでいる人に見えます",
    );
    leaveLayers(() => router.push(readingPath()));
  }
  return (
    <Modal title="読書をはじめる" onClose={onClose}>
      {book ? (
        <div className="home-sheet">
          <div className="home-sheet-chosen">
            <span className="home-sheet-jacket" aria-hidden="true">
              <BookJacket book={book} sizes="44px" />
            </span>
            <span>
              <b>{bookTitle(book)}</b>
              <small>{bookAuthor(book)}</small>
            </span>
          </div>
          <p className="home-sheet-lead">どう読みますか。</p>
          <button
            type="button"
            className="btn fill home-sheet-mode"
            onClick={() => start("solo")}
          >
            ひとりで読む（記録は自分だけ）
          </button>
          <button
            type="button"
            className="btn home-sheet-mode"
            onClick={() => start("together")}
          >
            みんなで読む
          </button>
          <button
            type="button"
            className="text-btn home-sheet-quiet"
            onClick={() => setChosen(null)}
          >
            <Icon name="back" size={16} />
            本を選びなおす
          </button>
        </div>
      ) : (
        <div className="home-sheet">
          {offered.length > 0 && (
            <>
              <p className="home-sheet-lead">どの本を読みますか。</p>
              <ul className="home-sheet-books">
                {offered.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => setChosen(entry.id)}>
                      <span className="home-sheet-jacket" aria-hidden="true">
                        <BookJacket book={entry} sizes="36px" />
                      </span>
                      <span>
                        <b>{bookTitle(entry)}</b>
                        <small>
                          {entry.id === current ? "読みかけ" : "読みたい本"}
                        </small>
                      </span>
                      <Icon name="chevron" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {searching ? (
            <BookPicker
              books={state.books}
              genreFinds={booksBeforeSearch(state)}
              value={chosen}
              onChange={setChosen}
              label="読む本を探す"
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="btn home-sheet-search"
              onClick={() => setSearching(true)}
            >
              <Icon name="search" size={16} />
              {offered.length > 0 ? "ほかの本を探す" : "本を探す"}
            </button>
          )}
          {state.wishlist.length > 0 && (
            <Link href={readingListPath()} className="text-btn home-sheet-all">
              読みたい本をぜんぶ見る
              <Icon name="chevron" size={16} />
            </Link>
          )}
        </div>
      )}
    </Modal>
  );
}
