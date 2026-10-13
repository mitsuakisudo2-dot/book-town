"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  FEELINGS,
  FEELING_WORDS,
  type Book,
  type Feeling,
  type TownActions,
  type TownState,
} from "../lib/types";
import { booksFelt, feelingsInTown } from "../lib/records";
import { booksBeforeSearch } from "../lib/book-lists";
import { findReader } from "../lib/social";
import { bookPath } from "../lib/books";
import {
  bookSignals,
  findReaders,
  findShops,
  hiragana,
  searchPresence,
  type BookMatch,
} from "../lib/search";
import { useBookSearch } from "../lib/search/use-book-search";
import {
  onSearchRequest,
  postsWithTag,
  popularTags,
  tagLeftOut,
  takeRequestedSearch,
} from "../lib/tags";
import { readParam, replaceAddress, useUrlParam } from "../lib/url-state";
import { PostCard } from "./Social";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import "./reading.css";
import "./records.css";
import { profilePath, shopPath } from "../lib/paths";
import { useTownBackend } from "../lib/store";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export function SearchView({ state, actions, notify }: Shared) {
  const id = useId();
  const savedIn = useTownBackend();
  // A tapped #tag hands its search over; a shared ?q= link works on a fresh load.
  const [query, setQuery] = useState(() => takeRequestedSearch() ?? "");
  useEffect(() => {
    const fromUrl = readParam("q");
    if (!fromUrl) return;
    const timer = setTimeout(
      () => setQuery((current) => current || fromUrl),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  // A tag tapped while already here searches at once (its link, or the top
  // search, puts it in the address); stepping back through searches brings
  // each one back.
  useEffect(() => {
    const fromAddress = () => setQuery(readParam("q") ?? "");
    const stop = onSearchRequest((next) => {
      takeRequestedSearch();
      setQuery(next);
    });
    addEventListener("popstate", fromAddress);
    return () => {
      stop();
      removeEventListener("popstate", fromAddress);
    };
  }, []);
  // What is being searched goes into the address as it changes, so a tap on
  // a result or a reload a moment later still comes back to it. Not from an
  // effect: by then a tapped link may have put its own address in place.
  const search = (next: string) => {
    setQuery(next);
    replaceAddress({ params: { q: next.trim() ? next : null } });
  };
  const term = query.trim().toLocaleLowerCase();
  const tagTerm = /^[#＃]/.test(term) ? term.slice(1) : null;
  const signals = useMemo(() => bookSignals(state), [state]);
  const signal = (bookId: string) =>
    signals.get(bookId) ?? { shelves: 0, talk: 0, reviews: 0, wants: 0 };
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  // Before anything is typed, only books used where everyone can see them,
  // the 見本's and the reader's own: never one another reader only typed in.
  // A genre (a chip) finds only these too; a title or an author finds any.
  const shown = useMemo(() => booksBeforeSearch(state), [state]);
  const genres = [...new Set(shown.map((book) => book.genre))];

  // Lists of what is talked about or shelved show only once there is enough
  // of it to be worth a list: a town of three readers has no "popular" books.
  const talked = [...shown]
    .filter((book) => signal(book.id).talk > 0)
    .sort((a, b) => signal(b.id).talk - signal(a.id).talk)
    .slice(0, 6);
  const shelvedAndWanted = (bookId: string) =>
    signal(bookId).shelves * 3 + signal(bookId).wants;
  const popular = [...shown]
    .filter((book) => shelvedAndWanted(book.id) > 0)
    .sort((a, b) => shelvedAndWanted(b.id) - shelvedAndWanted(a.id))
    .slice(0, 6);
  const [feelingParam, setFeelingParam] = useUrlParam("feeling");
  const feeling = FEELINGS.includes(feelingParam as Feeling)
    ? (feelingParam as Feeling)
    : null;
  const feelings = feelingsInTown(state);
  const felt = feeling
    ? booksFelt(state, feeling).flatMap((bookId) =>
        shown.filter((book) => book.id === bookId),
      )
    : [];
  const shelvedAt = (bookId: string) => {
    const at = shops.filter((shop) =>
      shop.shelves.some(
        (shelf) =>
          shelf.isPublic && shelf.items.some((item) => item.bookId === bookId),
      ),
    );
    if (!at.length) return "";
    return at.length === 1
      ? `「${at[0].name}」の棚に`
      : `「${at[0].name}」ほか${at.length - 1}軒の棚に`;
  };
  const presenceWords = (bookId: string) =>
    [
      signal(bookId).shelves > 0 && `${signal(bookId).shelves}軒の棚に`,
      signal(bookId).wants > 0 && `読みたくなった ${signal(bookId).wants}人`,
    ]
      .filter(Boolean)
      .join("・");
  // Books few people have shelved or talked about yet: the quiet corners of the town.
  const quiet = shown.filter(
    (book) => signal(book.id).shelves <= 1 && signal(book.id).reviews === 0,
  );

  // Books, readers and shops are all found the same way: by reading, romaji,
  // either kana, either width. Typing stays quick while the town is searched.
  const presence = useCallback(
    (bookId: string) => searchPresence(signals.get(bookId)),
    [signals],
  );
  const books = useBookSearch(state.books, term && !tagTerm ? query : "", {
    presence,
    genreFinds: shown,
  });
  const { found, near } = books;
  const tagResults = tagTerm ? postsWithTag(state, tagTerm) : [];
  // Readers by name or @ID, shops by name, words, owner or a book on a public
  // shelf: closest first, and never with a count.
  const people = useMemo(
    () => (books.query ? findReaders(state, books.query) : []),
    [state, books.query],
  );
  const shopResults = useMemo(
    () => (books.query ? findShops(state, books.query) : []),
    [state, books.query],
  );
  const tags = popularTags(state);
  // Said once, without a count, as on a book's page: the reader chose this.
  const tagHasLeftOut = tagTerm !== null && tagLeftOut(state, tagTerm);

  // A match through the title's reading shows the reading; numbers stay out of results.
  const matchRow = ({ book, byReading }: BookMatch) =>
    bookRow(
      book,
      byReading && book.titleReading
        ? "よみ：" + hiragana(book.titleReading.text)
        : "",
    );
  const bookRow = (book: Book, meta: string) => (
    <li key={book.id}>
      <Link href={bookPath(book.id)} className="search-book">
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
          onChange={(event) => search(event.target.value)}
          placeholder="タイトル・著者・書店名・#タグ・@ID"
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
              search(term === genre.toLocaleLowerCase() ? "" : genre)
            }
          >
            {genre}
          </button>
        ))}
      </div>

      {tagTerm !== null ? (
        <div className="search-results" role="status">
          <section aria-labelledby="search-tag-title">
            <h2 id="search-tag-title">#{tagTerm} の投稿</h2>
            {tagResults.length ? (
              <div className="post-feed">
                {tagResults.map((post) => (
                  <PostCard
                    key={post.id}
                    state={state}
                    actions={actions}
                    notify={notify}
                    post={post}
                    showBook
                  />
                ))}
              </div>
            ) : (
              !tagHasLeftOut && (
                <p className="search-empty">
                  このタグの投稿は、まだありません。
                </p>
              )
            )}
            {tagHasLeftOut && (
              <p className="search-empty">
                ネタバレを含むかもしれない投稿は、設定により出していません
              </p>
            )}
          </section>
        </div>
      ) : term ? (
        <div className="search-results" role="status">
          {people.length > 0 && (
            <section aria-labelledby="search-people-title">
              <h2 id="search-people-title">読書家</h2>
              <ul className="search-list">
                {people.map((reader) => (
                  <li key={reader.id}>
                    <Link href={profilePath(reader.id)} className="search-shop">
                      <ReaderAvatar reader={reader} size={32} />
                      <span>
                        <b>{reader.name}</b>
                        <small>@{reader.handle}</small>
                      </span>
                      <Icon name="chevron" size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="search-books-title">
            <h2 id="search-books-title">本</h2>
            {found.length ? (
              <ul className="search-list">{found.map(matchRow)}</ul>
            ) : (
              books.settled && (
                <p className="search-empty">
                  {near.length
                    ? "ぴったり合う本はありませんでした。"
                    : "合う本は見つかりませんでした。"}
                </p>
              )
            )}
            {near.length > 0 && (
              <>
                <h3 className="search-near" id="search-near-title">
                  {books.nearHeading}
                </h3>
                <ul className="search-list" aria-labelledby="search-near-title">
                  {near.map(({ book }) => bookRow(book, ""))}
                </ul>
              </>
            )}
          </section>
          <section aria-labelledby="search-shops-title">
            <h2 id="search-shops-title">書店</h2>
            {shopResults.length ? (
              <ul className="search-list">
                {shopResults.map((shop) => (
                  <li key={shop.id}>
                    <Link
                      href={shopPath(shop.id)}
                      className={"search-shop theme-" + shop.theme}
                    >
                      <Icon name="store" size={20} />
                      <span>
                        <b>{shop.name}</b>
                        <small>{findReader(state, shop.ownerId)?.name}</small>
                      </span>
                      <Icon name="chevron" size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              books.settled && (
                <p className="search-empty">合う書店は見つかりませんでした。</p>
              )
            )}
          </section>
        </div>
      ) : (
        <div className="search-discover">
          {feelings.length > 0 && (
            <section aria-labelledby="search-feelings-title">
              <h2 id="search-feelings-title">気持ちから探す</h2>
              <p>読み終えた人が残した気持ちから、次の一冊を。</p>
              <div className="search-feelings" role="group" aria-label="気持ち">
                {feelings.map((entry) => (
                  <button
                    type="button"
                    key={entry}
                    className="feeling-chip"
                    aria-pressed={feeling === entry}
                    onClick={() =>
                      setFeelingParam(feeling === entry ? null : entry)
                    }
                  >
                    {FEELING_WORDS[entry]}
                  </button>
                ))}
              </div>
              {feeling && (
                <ul className="search-list" aria-live="polite">
                  {felt.map((book) => bookRow(book, shelvedAt(book.id)))}
                </ul>
              )}
            </section>
          )}
          {tags.length > 0 && (
            <section aria-labelledby="search-tags-title">
              <h2 id="search-tags-title">タグから探す</h2>
              <div className="search-tags">
                {tags.map(({ tag }) => (
                  <button
                    type="button"
                    key={tag}
                    className="tag-chip is-set"
                    onClick={() => search("#" + tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </section>
          )}
          {quiet.length > 0 && (
            <section aria-labelledby="search-quiet-title">
              <h2 id="search-quiet-title">棚の隅の本</h2>
              <p>
                まだあまり知られていない本。最初の感想を書くのは、あなたかも。
              </p>
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
            </section>
          )}
          {talked.length >= 3 && (
            <section aria-labelledby="search-talked-title">
              <h2 id="search-talked-title">話題の本</h2>
              <p>いま投稿やレビューで語られている本。</p>
              <ul className="search-list">
                {talked.map((book) =>
                  bookRow(book, `投稿 ${signal(book.id).talk}件`),
                )}
              </ul>
            </section>
          )}
          {popular.length >= 3 && (
            <section aria-labelledby="search-popular-title">
              <h2 id="search-popular-title">多くの棚に並ぶ本</h2>
              <p>いくつもの本屋が棚に置き、読みたくなった人がいる本。</p>
              <ul className="search-list">
                {popular.map((book) => bookRow(book, presenceWords(book.id)))}
              </ul>
            </section>
          )}
          <p className="search-note">
            {savedIn === "local" ? "デモの街" : "この街"}
            の本と書店から探します。並び順は、この街の棚と投稿から数えています。
          </p>
        </div>
      )}
    </div>
  );
}
