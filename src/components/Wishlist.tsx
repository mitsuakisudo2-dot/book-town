"use client";
import Link from "next/link";
import { type TownState, type TownActions, type Notify } from "../lib/types";
import { BookJacket, Icon } from "./ui";
import { bookPath } from "../lib/books";
import { bookAuthor, bookById, bookTitle } from "../lib/book-name";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};
export function Wishlist({ state, actions, notify }: Shared) {
  const books = state.books.filter((b) => state.wishlist.includes(b.id));
  // An empty list still has somewhere to start: one POP from each of a few shops.
  const invitations = state.shops
    .flatMap((shop) => {
      const owner = state.readers.find((r) => r.id === shop.ownerId);
      const item = shop.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) => shelf.items)
        .find(
          (entry) =>
            entry.pop.trim() &&
            state.books.some((book) => book.id === entry.bookId),
        );
      const book = item && bookById(state.books, item.bookId);
      return owner && item && book ? [{ shop, owner, item, book }] : [];
    })
    .slice(0, 3);
  return (
    <>
      <span className="eyebrow">BOOKS TO COME BACK TO</span>
      <h1 className="page-title">いつか、読みたい一冊。</h1>
      <p className="page-subtitle">街を歩いて見つけた、次の楽しみ。</p>
      {books.length ? (
        <div className="catalog-grid wishlist-grid">
          {books.map((b) => (
            <article className="catalog-book" key={b.id}>
              <Link href={bookPath(b.id)}>
                <BookJacket book={b} />
                <h3>{bookTitle(b)}</h3>
                <p>{bookAuthor(b)}</p>
              </Link>
              <span>{b.genre}</span>
              <button
                className="text-btn"
                onClick={() => {
                  actions.toggleWish(b.id);
                  notify("読みたいリストから外しました");
                }}
              >
                <Icon name="check" size={14} />
                リストから外す
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="bookmark" size={34} />
          <h2>次の一冊は、どの棚にいるでしょう。</h2>
          <p>気になる本を「読みたい」に加えると、ここに並びます。</p>
          <Link href="/" className="btn">
            街を歩いてみる
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      )}
      {!books.length && invitations.length > 0 && (
        <section
          className="wishlist-invitations"
          aria-labelledby="wishlist-invitations-title"
        >
          <h2 id="wishlist-invitations-title">店主のPOPから、気になる一冊を</h2>
          <ul>
            {invitations.map(({ shop, owner, item, book }) => (
              <li key={shop.id}>
                <Link href={bookPath(book.id)}>
                  <BookJacket book={book} />
                  <span>
                    <b>{bookTitle(book)}</b>
                    <q>{item.pop.trim()}</q>
                    <small>
                      {shop.name}・店主 {owner.name}のPOP
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
