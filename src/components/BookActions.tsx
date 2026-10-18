"use client";

import type { Book, Notify, TownActions, TownState } from "../lib/types";
import { formatPrice, REGISTERED_GENRE } from "../lib/books";
import { bookLookup, lookupQuery } from "../lib/book-lookup";
import Link from "next/link";
import { myShopPath } from "../lib/paths";
import { PLACE } from "../lib/words";
import { Icon } from "./ui";
import { RegisterBook } from "./RegisterBook";

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
  const query = encodeURIComponent(lookupQuery(book));
  const lookup = bookLookup(book);
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
      {/* Google, without "www.": on an iPhone the Google app can claim links
          to www.google.com and open them itself. google.com is redirected
          there after the browser has the tap, and a redirect is not handed
          to an app. */}
      <a
        className="book-lookup"
        href={lookup.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={lookup.label}
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
    "購入ボタンはタイトルで外部書店を検索します。版や在庫は購入先でご確認ください。",
  ].join("");
}

export function BookActions({
  book,
  state,
  actions,
  notify,
  register = false,
  toShop = false,
}: {
  book: Book;
  state: TownState;
  actions: TownActions;
  notify: Notify;
  /** On the book's own page: 本棚に登録 in one tap, first (管理表 12). */
  register?: boolean;
  /**
   * On the book's own page: 自分の書店へ, which opens the reader's shop with
   * this book chosen (管理表 103).
   */
  toShop?: boolean;
}) {
  const wished = state.wishlist.includes(book.id);
  const favorite = state.favorites.includes(book.id);
  return (
    <div className="bh-actions">
      <div className="bh-save-row">
        {register && (
          <RegisterBook
            book={book}
            state={state}
            actions={actions}
            notify={notify}
            className="bh-save"
          />
        )}
        <button
          type="button"
          className={`btn bh-save ${wished ? "soft bh-saved" : "fill"}`}
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
          className={`btn bh-favorite${favorite ? " is-active" : ""}`}
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
      {toShop && (
        <Link
          className="text-btn bh-to-shop"
          href={myShopPath({ place: book.id })}
        >
          <Icon name="store" size={16} />
          {PLACE.toShop}
        </Link>
      )}
    </div>
  );
}
