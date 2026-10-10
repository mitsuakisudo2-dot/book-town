"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Book, Shop, TownActions, TownState } from "../lib/types";
import { findReader } from "../lib/social";
import { matchBooks } from "./BookPicker";
import { BookJacket, Icon } from "./ui";
import "./reading.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

/** How present each book is in the town: on public shelves, in posts, and in 読みたくなった. */
function bookSignals(state: TownState) {
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  return new Map(
    state.books.map((book) => {
      const shelves = shops.reduce(
        (count, shop) =>
          count +
          shop.shelves.filter(
            (shelf) =>
              shelf.isPublic &&
              shelf.items.some((item) => item.bookId === book.id),
          ).length,
        0,
      );
      const posts = state.posts.filter(
        (post) => post.bookId === book.id && post.readingMode !== "solo",
      );
      const reviews = posts.filter((post) => post.parentId === null).length;
      const wants =
        posts.reduce((sum, post) => sum + post.wants, 0) +
        state.wantedPosts.filter((id) => posts.some((post) => post.id === id))
          .length;
      return [book.id, { shelves, talk: posts.length, reviews, wants }];
    }),
  );
}

function publicStock(state: TownState, shop: Shop): Book[] {
  return shop.shelves
    .filter((shelf) => shelf.isPublic)
    .flatMap((shelf) =>
      shelf.items.map((item) =>
        state.books.find((book) => book.id === item.bookId),
      ),
    )
    .filter((book): book is Book => Boolean(book));
}

export function SearchView({ state }: Shared) {
  const id = useId();
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const signals = bookSignals(state);
  const signal = (bookId: string) =>
    signals.get(bookId) ?? { shelves: 0, talk: 0, reviews: 0, wants: 0 };
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const genres = [...new Set(state.books.map((book) => book.genre))];

  const talked = [...state.books]
    .filter((book) => signal(book.id).talk > 0)
    .sort((a, b) => signal(b.id).talk - signal(a.id).talk)
    .slice(0, 6);
  const popular = [...state.books]
    .sort(
      (a, b) =>
        signal(b.id).shelves * 3 +
        signal(b.id).wants -
        (signal(a.id).shelves * 3 + signal(a.id).wants),
    )
    .slice(0, 6);
  // Books few people have shelved or talked about yet: the quiet corners of the town.
  const quiet = state.books.filter(
    (book) => signal(book.id).shelves <= 1 && signal(book.id).reviews === 0,
  );

  const bookResults = term ? matchBooks(state.books, term) : [];
  const shopResults = term
    ? shops.filter((shop) => {
        const owner =
          shop.ownerId === state.me.id
            ? state.me.name
            : (findReader(state, shop.ownerId)?.name ?? "");
        return (
          shop.name +
          shop.description +
          owner +
          publicStock(state, shop)
            .map((book) => book.title + book.author)
            .join("")
        )
          .toLocaleLowerCase()
          .includes(term);
      })
    : [];

  const bookRow = (book: Book, meta: string) => (
    <li key={book.id}>
      <Link href={"/books/" + book.id + "/"} className="search-book">
        <BookJacket book={book} className="search-jacket" />
        <span>
          <b>{book.title}</b>
          <small>
            {book.author}・{book.genre}
          </small>
          {meta && <em>{meta}</em>}
        </span>
        <Icon name="chevron" size={15} />
      </Link>
    </li>
  );

  return (
    <div className="search-page">
      <span className="eyebrow">FIND A BOOK, FIND A SHOP</span>
      <h1 className="page-title">検索</h1>
      <label className="search-box" htmlFor={id}>
        <Icon name="search" size={19} />
        <span className="sr-only">本と書店を検索</span>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="タイトル・著者・ジャンル・書店名"
          autoComplete="off"
        />
      </label>
      <div className="search-genres" role="group" aria-label="ジャンルで探す">
        {genres.map((genre) => (
          <button
            type="button"
            key={genre}
            aria-pressed={term === genre.toLocaleLowerCase()}
            onClick={() =>
              setQuery(term === genre.toLocaleLowerCase() ? "" : genre)
            }
          >
            {genre}
          </button>
        ))}
      </div>

      {term ? (
        <div className="search-results" role="status">
          <section aria-labelledby="search-books-title">
            <h2 id="search-books-title">
              本 <span>{bookResults.length}</span>
            </h2>
            {bookResults.length ? (
              <ul className="search-list">
                {bookResults.map((book) =>
                  bookRow(
                    book,
                    signal(book.id).shelves
                      ? `${signal(book.id).shelves}軒の棚に`
                      : "",
                  ),
                )}
              </ul>
            ) : (
              <p className="search-empty">合う本は見つかりませんでした。</p>
            )}
          </section>
          <section aria-labelledby="search-shops-title">
            <h2 id="search-shops-title">
              書店 <span>{shopResults.length}</span>
            </h2>
            {shopResults.length ? (
              <ul className="search-list">
                {shopResults.map((shop) => (
                  <li key={shop.id}>
                    <Link
                      href={"/shops/" + shop.id + "/"}
                      className={"search-shop theme-" + shop.theme}
                    >
                      <Icon name="store" size={20} />
                      <span>
                        <b>{shop.name}</b>
                        <small>
                          {shop.ownerId === state.me.id
                            ? state.me.name
                            : findReader(state, shop.ownerId)?.name}
                          ・{publicStock(state, shop).length}冊
                        </small>
                      </span>
                      <Icon name="chevron" size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="search-empty">合う書店は見つかりませんでした。</p>
            )}
          </section>
        </div>
      ) : (
        <div className="search-discover">
          <section aria-labelledby="search-talked-title">
            <h2 id="search-talked-title">話題の本</h2>
            <p>いま投稿やレビューで語られている本。</p>
            <ul className="search-list">
              {talked.map((book) =>
                bookRow(book, `投稿 ${signal(book.id).talk}件`),
              )}
            </ul>
          </section>
          <section aria-labelledby="search-popular-title">
            <h2 id="search-popular-title">人気の本</h2>
            <p>多くの棚に並び、読みたくなった人が多い本。</p>
            <ul className="search-list">
              {popular.map((book) =>
                bookRow(
                  book,
                  `${signal(book.id).shelves}軒の棚に・読みたくなった ${signal(book.id).wants}人`,
                ),
              )}
            </ul>
          </section>
          <section aria-labelledby="search-quiet-title">
            <h2 id="search-quiet-title">棚の隅の本</h2>
            <p>
              まだあまり知られていない本。最初の感想を書くのは、あなたかも。
            </p>
            {quiet.length ? (
              <ul className="search-list">
                {quiet.map((book) =>
                  bookRow(
                    book,
                    signal(book.id).shelves
                      ? "1軒の棚だけに"
                      : "まだどの棚にもない",
                  ),
                )}
              </ul>
            ) : (
              <p className="search-empty">
                いまは、どの本も誰かに語られています。
              </p>
            )}
          </section>
          <p className="search-note">
            デモの街の本と書店から探します。並び順は、この街の棚と投稿から数えています。
          </p>
        </div>
      )}
    </div>
  );
}
