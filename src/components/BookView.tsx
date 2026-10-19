"use client";
import Link from "next/link";
import { usePersistenceStatus } from "../lib/store";
import {
  type TownState,
  type TownActions,
  type Book,
  type Notify,
} from "../lib/types";
import { BookJacket, CoverCredit, Icon } from "./ui";
import { BookActions, BookPrice, BookPurchase, bookNote } from "./BookActions";
import { BookReviews } from "./Social";
import {
  myShopPath,
  posterNewPath,
  creditsPath,
  posterPath,
  shopPath,
  walkPath,
} from "../lib/paths";
import { isSampleId } from "../lib/record-kind";
import { CoverRemovalLink } from "./Report";
import { BookFeelings } from "./ReadingRecords";
import { BackLink } from "./BackLink";
import { postersLeftOutOfBook, postersOfBook } from "../lib/posters";
import { findReader, reviewCoverOf, reviewNoteOf } from "../lib/social";
import { PosterThumb } from "./PosterView";
import { bookById, bookHeading, bookNamedBy } from "../lib/book-name";
import { booksOfWork } from "../lib/works";
import type { Bibliography } from "../lib/bibliography";
import { mine } from "../lib/own-books";
import { useBibliography } from "../lib/bibliography-session";
import { HeldBook } from "./HeldBook";
import { PLACE } from "../lib/words";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};
/**
 * The title and the people of a book's page, and under them who published
 * it and when: the master's once there is one (docs/09「書誌マスタ」).
 */
function BookHeadingLines({
  book,
  master,
}: {
  book: Book;
  master: Bibliography | null;
}) {
  const { title, subtitle, author, publication } = bookHeading(book, master);
  return (
    <>
      <h1>{title}</h1>
      {subtitle && <p className="book-page-subtitle">{subtitle}</p>}
      {author.length > 0 && (
        <Parts className="book-page-author" parts={author} mark="／" />
      )}
      {publication.length > 0 && (
        <Parts
          className="book-page-publication"
          parts={publication}
          mark="・"
        />
      )}
    </>
  );
}

/**
 * A line of parts with a mark between them ("見本書房・見本文庫・2003年9月").
 * It breaks between parts, and a mark that would end or start a line is out
 * of sight (usability.css), so none is left on its own.
 */
function Parts({
  className,
  parts,
  mark,
}: {
  className: string;
  parts: string[];
  mark: string;
}) {
  return (
    <p className={className + " parts-line"}>
      <span>
        {parts.map((part, at) => (
          <span key={at}>
            {at > 0 && <span className="parts-mark">{mark}</span>}
            {part}
          </span>
        ))}
      </span>
    </p>
  );
}

/** Where the heading came from, beside the cover's credit: the credits page. */
function BibliographyCredit({ master }: { master: Bibliography | null }) {
  if (!master?.from.length) return null;
  return (
    <span className="cover-credit">
      <Link href={creditsPath()}>書誌の出典</Link>
    </span>
  );
}

export function BookView({
  state,
  actions,
  notify,
  bookId,
}: Shared & { bookId: string }) {
  const persistence = usePersistenceStatus();
  const book = bookById(state.books, bookId);
  const master = useBibliography(bookId);
  if (!book)
    return persistence === "loading" ? (
      <p role="status">本を開いています…</p>
    ) : (
      <div className="empty-state">
        <h1>この本のページは、いまは見られません。</h1>
        <Link href="/" className="btn">
          街にもどる
        </Link>
      </div>
    );
  // The cover, its lookup and the shop links go by the heading's name.
  const named = bookNamedBy(book, master);
  // Shops show the book as their owner's own registration of it: the same
  // work is the same book here.
  const work = booksOfWork(state.books, book.id);
  const matches = [
    ...state.shops,
    ...(state.ownShop ? [state.ownShop] : []),
  ].flatMap((shop) =>
    shop.shelves
      .filter((s) => s.isPublic)
      .flatMap((shelf) =>
        shelf.items
          .filter((i) => work.has(i.bookId))
          .map((item) => ({ shop, shelf, item })),
      ),
  );
  return (
    <>
      <BackLink className="back-link" />
      <section className="book-page-hero">
        <BookJacket book={named} />
        <div className="book-hero-head">
          <span className="eyebrow">ONE BOOK, MANY WORLDS</span>
          <span className="genre-tag">{book.genre}</span>
          <BookHeadingLines book={book} master={master} />
          <BookPrice book={book} />
          <BookPurchase book={named} />
          <CoverCredit book={named} />
          <BibliographyCredit master={master} />
          <CoverRemovalLink book={named} />
        </div>
        <div className="book-hero-body">
          <HeldBook book={book} actions={actions} notify={notify} />
          <p className="book-summary">{book.summary}</p>
          <BookActions
            book={book}
            state={state}
            actions={actions}
            notify={notify}
            register
            toShop
          />
          <span className="jacket-disclaimer">{bookNote(book)}</span>
        </div>
      </section>
      <BookFeelings
        book={book}
        state={state}
        actions={actions}
        notify={notify}
      />
      <BookPosters state={state} book={book} />
      <BookReviews
        book={book}
        state={state}
        actions={actions}
        notify={notify}
      />
      <div className="book-path-heading">
        <span className="eyebrow">FOLLOW THE BOOK, MEET THE READER</span>
        <h2>この本を並べている書店</h2>
        <p>同じ一冊でも、棚が変われば、出会う言葉も変わる。</p>
      </div>
      <div className="stockist-list">
        {matches.map(({ shop, shelf, item }) => (
          <article
            className={"stockist theme-" + shop.theme}
            key={shop.id + shelf.id + item.id}
          >
            <div className="stockist-title">
              <Link href={shopPath(shop.id, shelf.id)}>
                <Icon name="store" size={21} />
                <h3>{shop.name}</h3>
                <Icon name="arrow" size={16} />
              </Link>
              {shop.demo && <small className="demo-tag">見本</small>}
            </div>
            <Link href={shopPath(shop.id, shelf.id)} className="stockist-shelf">
              <Icon name="book" size={14} />「{shelf.name}」の棚
              <Icon name="chevron" size={13} />
            </Link>
            <blockquote>
              {item.pop || "この棚では、本そのものが語りかけます。"}
            </blockquote>
            <div className="stockist-bottom">
              <Link href={walkPath(shop.id)} className="text-btn">
                <Icon name="store" size={15} />
                店内に入る
              </Link>
              <Link href={shopPath(shop.id, shelf.id)} className="text-btn">
                この棚を見に行く
                <Icon name="arrow" size={16} />
              </Link>
            </div>
          </article>
        ))}
        {!matches.length && (
          <div className="empty-state">
            <h3>この本の、最初の居場所を。</h3>
            <p>あなたの書店に並べて、POPを書いてみませんか。</p>
            <Link
              href={myShopPath({ place: mine(state, book.id) })}
              className="btn"
            >
              {PLACE.toShop}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
/**
 * The posters a book appears in, those that open with it first. With none
 * yet, only the way to make the first. Spoilers the reader chose not to see
 * are left out, said once without a count.
 */
function BookPosters({ state, book }: { state: TownState; book: Book }) {
  const posters = postersOfBook(state, book.id);
  const leftOut = postersLeftOutOfBook(state, book.id) && (
    <p className="book-posters-left-out">
      ネタバレを含むポスターは、設定により出していません
    </p>
  );
  const make = (
    <Link href={posterNewPath({ bookId: book.id })} className="text-btn">
      <Icon name="plus" size={14} />
      この本でポスターを作る
    </Link>
  );
  if (!posters.length)
    return (
      <>
        <p className="book-posters-invite">{make}</p>
        {leftOut}
      </>
    );
  return (
    <section className="book-posters" aria-labelledby="book-posters-title">
      <div className="book-path-heading">
        <span className="eyebrow">POSTERS WITH THIS BOOK</span>
        <h2 id="book-posters-title">この本が出てくるポスター</h2>
        <p>読書家が、この本を貼り出したポスター。表紙から、その人の言葉へ。</p>
      </div>
      <ul className="book-posters-row">
        {posters.map((poster) => {
          // Who made it, and a 見本 says it is one, as on the timeline.
          const maker = findReader(state, poster.authorId);
          const sample = isSampleId(poster.authorId);
          return (
            <li key={poster.id}>
              <PosterThumb
                poster={poster}
                books={state.books}
                href={posterPath(poster.id)}
                caption={
                  [maker?.name, sample && "見本"].filter(Boolean).join(" · ") ||
                  undefined
                }
                folded={reviewCoverOf(
                  state,
                  "poster",
                  poster.id,
                  poster.authorId,
                )}
                note={reviewNoteOf(state, "poster", poster.id, poster.authorId)}
              />
            </li>
          );
        })}
      </ul>
      {make}
      {leftOut}
    </section>
  );
}
