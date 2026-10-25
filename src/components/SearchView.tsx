"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  FEELINGS,
  FEELING_WORDS,
  type Book,
  type Feeling,
  type Notify,
  type TownActions,
  type TownState,
} from "../lib/types";
import { booksFelt, feelingsInTown } from "../lib/records";
import { booksBeforeSearch } from "../lib/book-lists";
import { booksOfWork } from "../lib/works";
import { findReader } from "../lib/social";
import { bookPath, normalizeIsbn } from "../lib/books";
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
import { LetterCard } from "./letter/LetterCard";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import "./reading.css";
import "./records.css";
import { profilePath, shopPath } from "../lib/paths";
import { useMoreRead, useTownBackend, useTownMore } from "../lib/store";
import { authorAndKind, bookById, bookTitle } from "../lib/book-name";
import { counted, REGISTER, whenSome, NAMES } from "../lib/words";
import { inManageMode } from "../lib/town-mode";
import { InLibraryMark, RegisterBook } from "./RegisterBook";
import dynamic from "next/dynamic";

// The scanner is only fetched when a search sends the reader to it.
const ScanSession = dynamic(
  () => import("./ScanSession").then((file) => file.ScanSession),
  { ssr: false },
);
// So is the one-book form, when a search finds nothing.
const BarcodeRegister = dynamic(
  () => import("./BarcodeRegister").then((file) => file.BarcodeRegister),
  { ssr: false },
);

/** The first book of each work, in order: one work is one book in a list. */
function oneAWork(state: TownState, books: readonly Book[]): Book[] {
  const seen = new Set<string>();
  return books.filter((book) => {
    if (seen.has(book.id)) return false;
    for (const id of booksOfWork(state.books, book.id)) seen.add(id);
    return true;
  });
}

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

export function SearchView({ state, actions, notify }: Shared) {
  const id = useId();
  const savedIn = useTownBackend();
  // 読書管理モード: books only; no readers, shops, 便り, nor the town's lists.
  const manage = inManageMode(state);
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
  // How often each book is shelved and talked of, of all time, and the
  // works most shelved and talked of, asked of the database as the search
  // opens (town_counts, AUD-006): the town holds only the newest 便り. Each
  // of those works is shown by the town's book of it, as only those open.
  // Before anything is typed, only books used where everyone can see them,
  // the 見本's and the reader's own: never one another reader only typed in.
  // A genre (a chip) finds only these too; a title or an author finds any.
  const shown = useMemo(() => booksBeforeSearch(state), [state]);
  const { read: countsRead } = useMoreRead(manage ? null : { counts: true });
  const { townCounts, mostOf } = useMemo(() => {
    const asked = countsRead?.counts;
    if (!asked) return { townCounts: undefined, mostOf: [] as Book[] };
    const books = { ...asked.books };
    const mostOf = [...asked.shelved, ...asked.talked].flatMap(
      ({ book: face, work }) => {
        const book =
          bookById(state.books, face) ??
          shown.find((entry) => work !== null && entry.workId === work);
        if (!book) return [];
        books[book.id] ??= asked.books[face];
        return [book];
      },
    );
    return { townCounts: { ...asked, books }, mostOf };
  }, [countsRead, state.books, shown]);
  const signals = useMemo(
    () => bookSignals(state, townCounts),
    [state, townCounts],
  );
  const signal = (bookId: string) =>
    signals.get(bookId) ?? { shelves: 0, talk: 0, reviews: 0, wants: 0 };
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const genres = [...new Set(shown.map((book) => book.genre))];
  const chosenGenre = genres.some(
    (genre) => genre.toLocaleLowerCase() === term,
  );

  // Lists of what is talked about or shelved show only once there is enough
  // of it to be worth a list: a town of three readers has no "popular" books.
  // With the database's counts, the books most shelved and talked of of
  // all the town's too, not only those it read; a work once.
  const ranked = useMemo(
    () =>
      oneAWork(state, [
        ...shown,
        ...mostOf.filter(
          (book) => !shown.some((known) => known.id === book.id),
        ),
      ]),
    [state, shown, mostOf],
  );
  const talked = [...ranked]
    .filter((book) => signal(book.id).talk > 0)
    .sort((a, b) => signal(b.id).talk - signal(a.id).talk)
    .slice(0, 6);
  const shelvedAndWanted = (bookId: string) =>
    signal(bookId).shelves * 3 + signal(bookId).wants;
  const popular = [...ranked]
    .filter((book) => shelvedAndWanted(book.id) > 0)
    .sort((a, b) => shelvedAndWanted(b.id) - shelvedAndWanted(a.id))
    .slice(0, 6);
  const [feelingParam, setFeelingParam] = useUrlParam("feeling");
  const feeling = FEELINGS.includes(feelingParam as Feeling)
    ? (feelingParam as Feeling)
    : null;
  // Which feelings anyone kept, read when the search opens, and the records
  // felt with the chosen one, read when it is chosen (AUD-006): the town
  // holds only a window of others'.
  const { state: feltKnown } = useTownMore(
    state,
    manage ? null : { felt: true },
  );
  const feelings = feelingsInTown(feltKnown);
  const { state: feltTown } = useTownMore(
    feltKnown,
    feeling ? { feeling } : null,
  );
  const feltShown = useMemo(
    () =>
      feltTown.books === state.books &&
      feltTown.readingRecords === state.readingRecords
        ? shown
        : booksBeforeSearch(feltTown),
    [feltTown, state.books, state.readingRecords, shown],
  );
  const felt = feeling
    ? booksFelt(feltTown, feeling).flatMap((bookId) =>
        feltShown.filter((book) => book.id === bookId),
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
      : `「${at[0].name}」ほか${counted(at.length - 1, "軒")}の棚に`;
  };
  const presenceWords = (bookId: string) =>
    [
      whenSome(signal(bookId).shelves, "軒", (c) => `${c}の棚に`),
      whenSome(signal(bookId).wants, "人", (c) => `読みたくなった ${c}`),
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
  // What is typed is asked of the database too, once typing rests: every
  // book the reader may read, not only the town's (find_books, AUD-006).
  const searched = term && !tagTerm ? query.trim() : "";
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(searched), searched ? 300 : 0);
    return () => clearTimeout(timer);
  }, [searched]);
  const { read: fromDatabase } = useMoreRead(asked ? { search: asked } : null);
  const books = useBookSearch(state.books, searched ? query : "", {
    presence,
    genreFinds: shown,
    extra: fromDatabase?.books,
  });
  const { found, near } = books;
  const tagResults = tagTerm ? postsWithTag(state, tagTerm) : [];
  // Readers by name or @ID, shops by name, words, owner or a book on a public
  // shelf: closest first, and never with a count.
  const people = useMemo(
    () => (books.query && !manage ? findReaders(state, books.query) : []),
    [state, books.query, manage],
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
    <li key={book.id} className="search-book-row">
      <Link href={bookPath(book.id)} className="search-book">
        <BookJacket
          book={book}
          className="search-jacket"
          mark={<InLibraryMark book={book} state={state} />}
        />
        <span>
          <b>{bookTitle(book)}</b>
          <small>{authorAndKind(book)}</small>
          {meta && <em>{meta}</em>}
        </span>
      </Link>
      <RegisterBook
        book={book}
        state={state}
        actions={actions}
        notify={notify}
        short
      />
    </li>
  );
  // Not found in the town: in by its barcode, or by what was typed (an
  // ISBN looked up, or words as its title). AUD-051.
  const [adding, setAdding] = useState<"scan" | "title" | null>(null);
  const typedIsbn = normalizeIsbn(query.trim());

  return (
    <div className="search-page">
      <span className="eyebrow">
        {manage ? "FIND A BOOK" : "FIND A BOOK, FIND A SHOP"}
      </span>
      <h1 className="page-title">検索</h1>
      <label className="search-box" htmlFor={id}>
        <Icon name="search" size={19} />
        <span className="sr-only">
          {manage ? "本を検索" : "本と書店を検索"}
        </span>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
          placeholder={
            manage
              ? "タイトル・著者・ISBN"
              : "タイトル・著者・書店名・#タグ・@ID"
          }
          autoComplete="off"
        />
      </label>
      {/* While words are typed, the books come straight under the box,
          above the phone's keyboard; the genres wait until it is cleared. */}
      {(!term || chosenGenre) && (
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
      )}

      {tagTerm !== null && !manage ? (
        <div className="search-results" role="status">
          <section aria-labelledby="search-tag-title">
            <h2 id="search-tag-title">
              #{tagTerm} の{NAMES.letter}
            </h2>
            {tagResults.length ? (
              <div className="post-feed">
                {tagResults.map((post) => (
                  <LetterCard
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
                  このタグの{NAMES.letter}は、まだありません。
                </p>
              )
            )}
            {tagHasLeftOut && (
              <p className="search-empty">
                ネタバレを含むかもしれない{NAMES.letter}
                は、設定により出していません
              </p>
            )}
          </section>
        </div>
      ) : term ? (
        <div className="search-results" role="status">
          <section aria-labelledby="search-books-title">
            <h2 id="search-books-title">本</h2>
            {found.length ? (
              <ul className="search-list">{found.map(matchRow)}</ul>
            ) : (
              books.settled && (
                <div className="search-add">
                  <p className="search-empty">
                    {near.length
                      ? "ぴったり合う本はありませんでした。"
                      : "合う本は見つかりませんでした。"}
                  </p>
                  <p className="search-empty">
                    まだ街にない本は、ここから登録できます。
                  </p>
                  <div className="btns">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setAdding("scan")}
                    >
                      <Icon name="barcode" size={18} />
                      {REGISTER.byBarcode}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setAdding("title")}
                    >
                      <Icon name="plus" size={18} />
                      {typedIsbn ? REGISTER.byIsbn : REGISTER.byTitle}
                    </button>
                  </div>
                </div>
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
          {!manage && (
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
                  <p className="search-empty">
                    合う書店は見つかりませんでした。
                  </p>
                )
              )}
            </section>
          )}
        </div>
      ) : manage ? (
        <p className="search-note">題名・著者・ISBNで、本を探せます。</p>
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
                    className="chip"
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
              <p>いま{NAMES.letter}やレビューで語られている本。</p>
              <ul className="search-list">
                {talked.map((book) =>
                  bookRow(
                    book,
                    `${NAMES.letter} ${counted(signal(book.id).talk, "件")}`,
                  ),
                )}
              </ul>
            </section>
          )}
          {popular.length >= 3 && (
            <section aria-labelledby="search-popular-title">
              <h2 id="search-popular-title">多くの棚に並ぶ本</h2>
              <p>いくつもの書店が棚に置き、読みたくなった人がいる本。</p>
              <ul className="search-list">
                {popular.map((book) => bookRow(book, presenceWords(book.id)))}
              </ul>
            </section>
          )}
          <p className="search-note">
            {savedIn === "local" ? "デモの街" : "この街"}
            の本と書店から探します。並び順は、この街の棚と{NAMES.letter}
            から数えています。
          </p>
        </div>
      )}
      {adding === "scan" && (
        <ScanSession
          state={state}
          actions={actions}
          notify={notify}
          onClose={() => setAdding(null)}
        />
      )}
      {adding === "title" && (
        <BarcodeRegister
          state={state}
          actions={actions}
          notify={notify}
          onClose={() => setAdding(null)}
          lead={typedIsbn ? REGISTER.byIsbn : REGISTER.byTitle}
          camera={false}
          startTitle={typedIsbn ? "" : query.trim()}
          startIsbn={typedIsbn}
        />
      )}
    </div>
  );
}
