"use client";

import type { Book, TownActions, TownState } from "../lib/types";
import { Icon } from "./ui";

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
  const query = encodeURIComponent(`${book.title} ${book.author}`);
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
                : "プロフィールの読みたいリストに保存しました",
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
      <p className="bh-private-hint">
        読みたい本とお気に入りは、あなたのプロフィールに
      </p>
      <details className="bh-purchase">
        <summary>
          <Icon name="store" size={17} /> 購入する <span>外部書店で探す ↗</span>
        </summary>
        <div className="bh-purchase-links">
          <a
            href={`https://www.amazon.co.jp/s?k=${query}&i=stripbooks`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Amazonで探す ↗
          </a>
          <a
            href={`https://books.rakuten.co.jp/search?sitem=${query}&g=001`}
            target="_blank"
            rel="noopener noreferrer"
          >
            楽天ブックスで探す ↗
          </a>
        </div>
        <p>タイトル・著者で検索します。版や在庫は購入先でご確認ください。</p>
      </details>
    </div>
  );
}
