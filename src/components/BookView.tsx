"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { usePersistenceStatus, useTownMore } from "../lib/store";
import { bookKind } from "../lib/samples";
import {
  type TownState,
  type TownActions,
  type Book,
  type Notify,
} from "../lib/types";
import { BookJacket, CoverCredit, Icon } from "./ui";
import {
  BookActions,
  BookPrice,
  BookPurchase,
  MyBook,
  bookNote,
} from "./BookActions";
import { InLibraryMark } from "./RegisterBook";
import { SeriesStrip } from "./series-later";
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
import { BookFeelings, OwnFeeling } from "./ReadingRecords";
import { BookEncounters } from "./BookEncounters";
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
import { PLACE, counted } from "../lib/words";
import { inManageMode } from "../lib/town-mode";
import { formatDuration, sessionSeconds } from "../lib/reading";
import { japanMonthDay } from "../lib/japan-time";
import "./book-in-hand.css";

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
  state: town,
  actions,
  notify,
  bookId,
}: Shared & { bookId: string }) {
  const persistence = usePersistenceStatus();
  // A book the town does not hold (one a search found, the library's
  // catalog's among them) comes with its work's records (work_records).
  const known = bookById(town.books, bookId);
  const { state: read, ready } = useTownMore(
    town,
    known || bookKind(bookId) !== "database" ? null : { work: bookId },
  );
  const state = known ? town : read;
  const book = known ?? bookById(read.books, bookId);
  const master = useBibliography(bookId);
  const face = useFace();
  if (!book)
    return persistence === "loading" || !ready ? (
      <p role="status">本を開いています…</p>
    ) : (
      <div className="empty-state">
        <h1>この本のページは、いまは見られません。</h1>
        <Link href="/" className="btn">
          街にもどる
        </Link>
      </div>
    );
  // 読書管理モード: the book and the reader only (town-mode.ts).
  const manage = inManageMode(town);
  // The cover, its lookup and the shop links go by the heading's name.
  const named = bookNamedBy(book, master);
  // 読書管理モード is the reader's own already: one face, as it was.
  if (!manage && face === "me")
    return (
      <>
        <PageTop face={face} />
        <MyBookPage
          book={book}
          named={named}
          master={master}
          state={state}
          actions={actions}
          notify={notify}
        />
      </>
    );
  return (
    <>
      {manage ? <BackLink className="back-link" /> : <PageTop face={face} />}
      <section className="book-page-hero">
        <BookJacket
          book={named}
          mark={<InLibraryMark book={book} state={state} />}
        />
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
          <SeriesStrip
            book={book}
            state={state}
            actions={actions}
            notify={notify}
          />
          <BookActions
            book={book}
            state={state}
            actions={actions}
            notify={notify}
            register
            toShop={!manage}
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
      {!manage && <BookPosters state={state} book={book} />}
      {!manage && (
        <BookReviews
          book={book}
          state={state}
          actions={actions}
          notify={notify}
        />
      )}
      {!manage && <BookStockists state={state} book={book} />}
    </>
  );
}

/** The book page's two faces (管理表 17): the town's, and the reader's own. */
type Face = "town" | "me";

const FACE_EVENT = "book-face";
const subscribeFace = (change: () => void) => {
  addEventListener("popstate", change);
  addEventListener(FACE_EVENT, change);
  return () => {
    removeEventListener("popstate", change);
    removeEventListener(FACE_EVENT, change);
  };
};
const faceNow = (): Face =>
  new URLSearchParams(location.search).get("face") === "me" ? "me" : "town";

/**
 * The face the address names (?face=me), so a reload or 戻る keeps it and
 * the library opens the reader's own. The exported page starts on みんな.
 */
function useFace(): Face {
  return useSyncExternalStore(subscribeFace, faceNow, () => "town");
}

/**
 * 戻る, and at the right the switch between the book's page and the
 * reader's own of it (けにー 10-26「本のページの右上に切り替えられる
 * スイッチ」). Switching replaces the address: 戻る still leaves the book.
 */
function PageTop({ face }: { face: Face }) {
  const to = (next: Face) => {
    if (next === face) return;
    const params = new URLSearchParams(location.search);
    if (next === "me") params.set("face", "me");
    else params.delete("face");
    const query = params.toString();
    history.replaceState(
      history.state,
      "",
      location.pathname + (query ? "?" + query : "") + location.hash,
    );
    dispatchEvent(new Event(FACE_EVENT));
    scrollTo({ top: 0 });
  };
  return (
    <div className="book-page-top">
      <BackLink className="back-link" />
      <div
        className="book-face-switch"
        role="group"
        aria-label="ページの切り替え"
      >
        <button
          type="button"
          aria-pressed={face === "town"}
          onClick={() => to("town")}
        >
          本のページ
        </button>
        <button
          type="button"
          aria-pressed={face === "me"}
          onClick={() => to("me")}
        >
          <Icon name="lock" size={14} />
          わたし
        </button>
      </div>
    </div>
  );
}

/**
 * わたし: the reader's own page of the book, for them alone (管理表 17):
 * their reading of it, the feelings they left, and where and from whom
 * they met it with their memos.
 */
function MyBookPage({
  book,
  named,
  master,
  state,
  actions,
  notify,
}: Shared & { book: Book; named: Book; master: Bibliography | null }) {
  const { title, author } = bookHeading(book, master);
  // Sessions are read against the time the page opened; one still running
  // counts up to then.
  const [now] = useState(() => Date.now());
  const work = booksOfWork(state.books, book.id);
  const sessions = state.readingSessions.filter(
    (session) => session.bookId !== null && work.has(session.bookId),
  );
  const seconds = sessions.reduce(
    (sum, session) => sum + sessionSeconds(session, now),
    0,
  );
  const last = sessions
    .map((session) => session.startedAt)
    .sort()
    .at(-1);
  return (
    <>
      <section className="my-book-head">
        <BookJacket book={named} />
        <div>
          <span className="eyebrow">YOU AND THIS BOOK</span>
          <h1>{title}</h1>
          {author.length > 0 && (
            <Parts className="book-page-author" parts={author} mark="／" />
          )}
          <p className="my-book-private">
            <Icon name="lock" size={13} />
            あなたにだけ見えています
          </p>
        </div>
      </section>
      <section className="my-book-part" aria-labelledby="my-book-reading">
        <h2 id="my-book-reading">読書の記録</h2>
        <MyBook book={book} state={state} actions={actions} notify={notify} />
        {sessions.length > 0 ? (
          <dl className="my-book-facts">
            <div>
              <dt>読んだ時間</dt>
              <dd>{formatDuration(seconds)}</dd>
            </div>
            <div>
              <dt>開いた回数</dt>
              <dd>{counted(sessions.length, "回")}</dd>
            </div>
            {last && (
              <div>
                <dt>最後に読んだ日</dt>
                <dd>{japanMonthDay(last)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="my-book-quiet">
            読みはじめると、読んだ時間がここにたまっていきます。
          </p>
        )}
        <OwnFeeling
          book={book}
          state={state}
          actions={actions}
          notify={notify}
        />
      </section>
      <BookEncounters
        book={book}
        state={state}
        actions={actions}
        notify={notify}
      />
    </>
  );
}

/** The shops that have the book (its work) on a public shelf. */
function BookStockists({ state, book }: { state: TownState; book: Book }) {
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
