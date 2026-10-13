"use client";

import { useState } from "react";
import Link from "next/link";
import { ME_ID, type TownActions, type TownState } from "../lib/types";
import {
  FOLDED_POSTER_NAMES,
  POSTER_TEMPLATE_WORDS,
  posterBookIds,
  posterTitle,
} from "../lib/posters";
import { bookPath } from "../lib/books";
import {
  findReader,
  formatPostTime,
  reviewCoverOf,
  reviewNoteOf,
  reviewNoteWords,
} from "../lib/social";
import { isDatabaseId, posterNewPath, profilePath } from "../lib/paths";
import { usePersistenceStatus } from "../lib/store";
import { useUrlParam } from "../lib/url-state";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import { PosterFoldCover, PosterPages } from "./PosterView";
import { ReportButton } from "./Report";
import { BackLink } from "./BackLink";
import "./poster-screen.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

/**
 * A poster's own page: who made it, the poster at its largest, and the
 * books on it, each a step to its own page. Folded by reports, the poster
 * and its books wait behind one cover until the reader opens it; a spoiler
 * still has its door after that. Opened directly, a spoiler the reader
 * keeps out of their lists (出さない) is here too, behind its door.
 */
export function PosterScreen({
  state,
  posterId,
}: Shared & { posterId: string }) {
  const persistence = usePersistenceStatus();
  // The page being read stays in the address (?page=2), so coming back from
  // a book on it opens the same page.
  const [pageParam, setPageParam] = useUrlParam("page");
  const [read, setRead] = useState(false);
  const startPage = Math.max(0, parseInt(pageParam ?? "", 10) - 1 || 0);
  const found = state.posters.find((entry) => entry.id === posterId);
  // Someone else's draft is theirs alone, as if it were not there.
  const poster =
    found && (found.status === "published" || found.authorId === ME_ID)
      ? found
      : undefined;
  const author = poster && findReader(state, poster.authorId);
  if (!poster || !author)
    return persistence === "loading" ? (
      <p role="status">ポスターを開いています…</p>
    ) : (
      <div className="poster-screen">
        <BackLink className="back-link" />
        <div className="empty-state">
          <Icon name="leaf" size={34} />
          <h1>このポスターは、いまは貼られていません。</h1>
          <p>
            作った人が外したのかもしれません。ほかのポスターは、タイムラインで見られます。
          </p>
          <div className="empty-state-actions">
            <Link href="/timeline/" className="button secondary">
              タイムラインへ
            </Link>
            <Link href={posterNewPath()} className="button">
              ポスターを作る
              <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      </div>
    );
  const mine = author.id === ME_ID;
  const draft = poster.status === "draft";
  const books = posterBookIds(poster)
    .map((id) => state.books.find((book) => book.id === id))
    .filter((book) => book !== undefined);
  const cover = reviewCoverOf(state, "poster", poster.id, poster.authorId);
  const note = reviewNoteOf(state, "poster", poster.id, poster.authorId);
  // Opened with 読む, it stays open while the reader is here.
  const covering = read ? null : cover;
  // A spoiler's words, its heading too, stay behind the door; a folded
  // poster's stay behind its cover, and are not its page's name either.
  const title = cover
    ? FOLDED_POSTER_NAMES[cover]
    : poster.spoiler
      ? "ネタバレを含むポスター"
      : posterTitle(poster, state.books);
  const profile = profilePath(author.id);
  return (
    <div className="poster-screen">
      <BackLink className="back-link" />
      <div className="poster-screen-layout">
        <div className="poster-screen-sheet">
          {covering ? (
            <PosterFoldCover
              cover={covering}
              author={author}
              onRead={() => setRead(true)}
            />
          ) : (
            <PosterPages
              poster={poster}
              books={state.books}
              author={author}
              startPage={startPage}
              onTurn={(at) => setPageParam(at ? String(at + 1) : null)}
              takeFocus={read}
            />
          )}
        </div>
        <aside className="poster-screen-about" aria-labelledby="poster-title">
          <div className="poster-screen-author">
            <Link
              href={profile}
              tabIndex={-1}
              aria-hidden="true"
              className="poster-screen-avatar"
            >
              <ReaderAvatar reader={author} size={42} />
            </Link>
            <span>
              <Link href={profile} className="poster-screen-name">
                {author.name}
              </Link>
              <small>
                @{author.handle}
                {!mine && !isDatabaseId(author.id) && " · 見本"}
                {" · "}
                <time dateTime={poster.createdAt}>
                  {formatPostTime(poster.createdAt)}
                </time>
              </small>
            </span>
          </div>
          <p className="poster-screen-kind">
            <span className="poster-tag">ポスター</span>
            {POSTER_TEMPLATE_WORDS[poster.template].name}
            {poster.pages.length > 1 && ` · ${poster.pages.length}ページ`}
          </p>
          <h1 id="poster-title" className="poster-screen-title">
            {title}
          </h1>
          {note && (
            <div
              className="spoiler-folded-note report-folded-note poster-screen-review"
              role="note"
            >
              <p>{reviewNoteWords("poster", note)}</p>
            </div>
          )}
          {draft && (
            <p className="poster-screen-draft" role="note">
              <Icon name="lock" size={14} />
              下書きです。まだ、あなたにだけ見えています。
            </p>
          )}
          {mine && !draft && !poster.inTimeline && (
            <p className="poster-screen-fact">
              {/* A poster with no books is on no book's page. */}
              {posterBookIds(poster).length
                ? "タイムラインには出さず、プロフィールと作品ページに貼っています。"
                : "タイムラインには出さず、プロフィールに貼っています。"}
            </p>
          )}
          {mine ? (
            <div className="poster-screen-actions">
              <Link
                href={posterNewPath({ posterId: poster.id })}
                className={"button" + (draft ? "" : " secondary")}
              >
                <Icon name="edit" size={15} />
                {draft ? "仕上げて貼り出す" : "直す"}
              </Link>
            </div>
          ) : (
            <div className="poster-screen-actions">
              <Link href={posterNewPath()} className="text-button">
                <Icon name="plus" size={14} />
                わたしもポスターを作る
              </Link>
              <ReportButton
                className="report-link"
                target={{
                  kind: "poster",
                  id: poster.id,
                  name: author.name + "さんのポスター",
                }}
              >
                <Icon name="flag" size={13} />
                このポスターを通報
              </ReportButton>
            </div>
          )}
          {books.length > 0 && !covering && (
            <section
              className="poster-screen-books"
              aria-labelledby="poster-books-title"
            >
              <h2 id="poster-books-title">このポスターの本</h2>
              <ul>
                {books.map((book) => (
                  <li key={book.id}>
                    <Link href={bookPath(book.id)}>
                      <BookJacket
                        book={book}
                        className="poster-screen-jacket"
                      />
                      <span>
                        <b>{book.title}</b>
                        <small>{book.author}</small>
                      </span>
                      <Icon name="chevron" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
