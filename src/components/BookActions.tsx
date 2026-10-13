"use client";

import type { Book, TownActions, TownState } from "../lib/types";
import { formatPrice, REGISTERED_GENRE } from "../lib/books";
import { Icon } from "./ui";

/** 定価, tax included. Books without a known price show nothing. */
export function BookPrice({
  book,
  compact = false,
}: {
  book: Book;
  compact?: boolean;
}) {
  if (!book.price) return null;
  return compact ? (
    <span className="book-price is-compact">{formatPrice(book.price)}</span>
  ) : (
    <p className="book-price">
      定価 <b>{formatPrice(book.price)}</b>
      <small>（税込）</small>
    </p>
  );
}

/**
 * Shop links sit beside the title and price, one tap from the book, and
 * beside them a way to read about it elsewhere first.
 */
export function BookPurchase({ book }: { book: Book }) {
  const query = encodeURIComponent(`${book.title} ${book.author}`);
  return (
    <div className="book-links">
      <div className="book-purchase" role="group" aria-label="購入する">
        <a
          href={`https://www.amazon.co.jp/s?k=${query}&i=stripbooks`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Amazonで探す（新しいタブで開きます）"
        >
          Amazon<span aria-hidden="true">↗</span>
        </a>
        <a
          href={`https://books.rakuten.co.jp/search?sitem=${query}&g=001`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="楽天ブックスで探す（新しいタブで開きます）"
        >
          楽天ブックス<span aria-hidden="true">↗</span>
        </a>
      </div>
      <a
        className="book-lookup"
        href={
          "https://www.google.com/search?q=" +
          encodeURIComponent(`${book.title}\u3000${book.author}`)
        }
        target="_blank"
        rel="noopener noreferrer"
        aria-label="この本についてGoogleで調べる（新しいタブで開きます）"
      >
        <Icon name="search" size={13} />
        この本について調べる<span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}

/** The fine print for the jacket, the price and the shop links. */
export function bookNote(book: Book): string {
  return [
    book.genre === REGISTERED_GENRE
      ? "表紙が見つからない本は、題名から作ったBookTownの装丁カードで表しています。"
      : "表紙はデモ用のオリジナルデザインです。",
    book.price && book.genre !== REGISTERED_GENRE
      ? "定価はデモ用の仮の値です。"
      : "",
    "購入ボタンはタイトル・著者で外部書店を検索します。版や在庫は購入先でご確認ください。",
  ].join("");
}

export function BookActions({
  book,
  state,
  actions,
  notify,
}: {
  book: Book;
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
}) {
  const wished = state.wishlist.includes(book.id);
  const favorite = state.favorites.includes(book.id);
  return (
    <div className="bh-actions">
      <div className="bh-save-row">
        <button
          type="button"
          className={`bh-save${wished ? " bh-saved" : ""}`}
          aria-pressed={wished}
          onClick={() => {
            actions.toggleWish(book.id);
            notify(
              wished
                ? "読みたいリストから外しました"
                : "読みたい本に入れました",
            );
          }}
        >
          <Icon name={wished ? "check" : "bookmark"} size={18} />
          {wished ? "読みたいに登録済み" : "読みたいに加える"}
        </button>
        <button
          type="button"
          className={`bh-favorite${favorite ? " is-active" : ""}`}
          aria-pressed={favorite}
          onClick={() => {
            actions.toggleFavorite(book.id);
            notify(
              favorite
                ? "お気に入りから外しました"
                : "プロフィールのお気に入りに保存しました",
            );
          }}
        >
          <Icon name="star" size={18} />
          {favorite ? "お気に入りに登録済み" : "お気に入り"}
        </button>
      </div>
    </div>
  );
}
