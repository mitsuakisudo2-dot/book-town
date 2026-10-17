"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import { ME_ID, type Book, type Reader, type TownState } from "../lib/types";
import {
  FOLDED_POSTER_REASONS,
  OWN_POSTER_REVIEW_WORDS,
  POSTER_THEME_STYLES,
  emptyPage,
  posterBookIds,
  posterSpoilerView,
  posterThumbName,
  type Poster,
  type PosterPage,
} from "../lib/posters";
import { bookPath } from "../lib/books";
import {
  findReader,
  formatPostTime,
  reviewCoverOf,
  reviewCoverWords,
  reviewNoteOf,
  reviewNoteWords,
  type ReviewCover,
} from "../lib/social";
import { isDatabaseId, posterPath, profilePath } from "../lib/paths";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import "./social.css";
import "./poster.css";
import { reducedMotion } from "../lib/motion";
import {
  bookAuthor,
  bookById,
  booksById,
  bookTitle,
  quotedTitle,
} from "../lib/book-name";

type Look = Pick<Poster, "template" | "theme" | "font" | "pages">;

// A poster's page is set once at 4:5 and only scaled after that (every size
// inside is in cqw of the sheet), so a thumbnail, the timeline and the
// poster's own page show the same composition, and the maker's preview is
// exactly what others will see.

const themeStyle = (poster: Pick<Poster, "theme">) => {
  const look = POSTER_THEME_STYLES[poster.theme] ?? POSTER_THEME_STYLES.kinari;
  return {
    "--poster-paper": look.paper,
    "--poster-ink": look.ink,
    "--poster-accent": look.accent,
  } as CSSProperties;
};

/** Columns for a lineup of n covers: the most even block that fits the page. */
const LINEUP_COLUMNS = [2, 2, 2, 3, 2, 3, 3, 4, 4, 3];

function SheetCover({
  book,
  linkBooks,
  className,
}: {
  book: Book;
  linkBooks: boolean;
  className: string;
}) {
  // The cover as served: never cropped or drawn over (see BookJacket).
  const jacket = <BookJacket book={book} className="poster-jacket" />;
  return linkBooks ? (
    <Link
      href={bookPath(book.id)}
      className={className}
      title={bookTitle(book)}
    >
      {jacket}
    </Link>
  ) : (
    <span className={className}>{jacket}</span>
  );
}

/** A clamped heading or a cut text, measured after every change of size. */
function useCut(
  body: RefObject<HTMLDivElement | null>,
  content: string,
  onCut?: (cut: boolean) => void,
) {
  const [cut, setCut] = useState({ heading: false, text: false });
  const report = useRef(onCut);
  useEffect(() => {
    report.current = onCut;
  });
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const over = (selector: string) => {
      const part = element.querySelector<HTMLElement>(selector);
      return part ? part.scrollHeight - part.clientHeight > 1 : false;
    };
    const measure = () => {
      const next = {
        heading: over(".poster-heading"),
        text: over(".poster-text"),
      };
      setCut((last) =>
        last.heading === next.heading && last.text === next.text ? last : next,
      );
      report.current?.(next.heading || next.text);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Metrics settle once the web fonts arrive.
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => observer.disconnect();
  }, [body, content]);
  return cut;
}

function Sheet({
  poster,
  books,
  page = 0,
  linkBooks = true,
  className = "",
  onCut,
}: {
  poster: Look;
  books: Book[];
  page?: number;
  linkBooks?: boolean;
  className?: string;
  onCut?: (cut: boolean) => void;
}) {
  const sheet: PosterPage =
    poster.pages[Math.min(page, poster.pages.length - 1)] ?? emptyPage();
  const shown = booksById(books, sheet.bookIds);
  const body = useRef<HTMLDivElement>(null);
  const cut = useCut(
    body,
    [poster.template, sheet.heading, sheet.text, shown.length].join("\n"),
    onCut,
  );
  const wordless = !sheet.heading && !sheet.text;
  // Not a heading element: the page or the card around the poster has those.
  const heading = sheet.heading ? (
    <p className="poster-heading">{sheet.heading}</p>
  ) : null;
  const text = sheet.text ? (
    <p className={"poster-text" + (cut.text ? " is-cut" : "")}>{sheet.text}</p>
  ) : null;

  let content;
  if (poster.template === "one_book") {
    const book = shown[0];
    content = (
      <>
        {book ? (
          <SheetCover
            book={book}
            linkBooks={linkBooks}
            className="poster-cover poster-lead"
          />
        ) : (
          <span className="poster-slot poster-lead">
            <span>本を1冊選ぶと、ここに表紙が入ります</span>
          </span>
        )}
        <div className="poster-aside">
          {heading ??
            (wordless ? (
              <span className="poster-placeholder is-heading">
                見出しと、ひとこと
              </span>
            ) : (
              <span />
            ))}
          {book && (
            <span className="poster-book-name">
              <b>{quotedTitle(book)}</b>
              <small>{bookAuthor(book)}</small>
            </span>
          )}
        </div>
        {text}
      </>
    );
  } else if (poster.template === "lineup") {
    // Fewer than two is only a draft: quiet frames show where covers go.
    const slots = Math.max(0, 2 - shown.length);
    const count = shown.length + slots;
    const columns = LINEUP_COLUMNS[count] ?? 3;
    content = (
      <>
        {(heading || (page === 0 && !sheet.heading)) && (
          <div className="poster-head">
            <span className="poster-rule" aria-hidden="true" />
            {heading ?? (
              <span className="poster-placeholder is-heading">見出し</span>
            )}
          </div>
        )}
        <div className="poster-covers">
          <div
            className="poster-shelf"
            style={
              {
                "--columns": columns,
                "--rows": Math.ceil(count / columns),
              } as CSSProperties
            }
          >
            {shown.map((book) => (
              <SheetCover
                key={book.id}
                book={book}
                linkBooks={linkBooks}
                className="poster-cover"
              />
            ))}
            {Array.from({ length: slots }, (_, index) => (
              <span key={index} className="poster-slot" />
            ))}
          </div>
        </div>
        {text}
      </>
    );
  } else {
    content = (
      <>
        <span className="poster-running" aria-hidden="true" />
        {heading}
        {wordless ? (
          <>
            <span className="poster-placeholder is-heading">見出し</span>
            <span className="poster-placeholder">
              本文を書くと、雑誌のページのように組まれます
            </span>
          </>
        ) : (
          <>
            {heading && text && (
              <span className="poster-rule" aria-hidden="true" />
            )}
            {text}
          </>
        )}
      </>
    );
  }
  return (
    <div
      className={
        `poster-sheet is-${poster.template} is-${poster.font}` +
        (sheet.text ? " has-text" : "") +
        (className ? " " + className : "")
      }
      style={themeStyle(poster)}
    >
      <span className="poster-frame" aria-hidden="true" />
      <div className="poster-body" ref={body}>
        {content}
      </div>
    </div>
  );
}

/**
 * One page of a poster at 4:5, scaled to the width it is given. With
 * linkBooks a cover leads to its book's page; the maker's preview turns that
 * off. A long text is cut with a fade inside the sheet, never set smaller.
 */
export function PosterSheet(props: {
  poster: Look;
  books: Book[];
  page?: number;
  linkBooks?: boolean;
  className?: string;
}) {
  return <Sheet {...props} />;
}

const quietScroll = () => (reducedMotion() ? "auto" : "smooth");

/**
 * A whole poster: its pages side by side, turned by a swipe, the arrows or
 * the dots. A spoiler poster stays behind a door until the reader opens it,
 * and can be closed again.
 */
export function PosterPages({
  poster,
  books,
  author,
  compact = false,
  startPage = 0,
  onTurn,
  takeFocus = false,
}: {
  poster: Poster;
  books: Book[];
  author: Reader;
  /** Among other posts, a covered poster takes a short band, not a page. */
  compact?: boolean;
  /** The page to open at, counted from 0. A spoiler opens at its first. */
  startPage?: number;
  /** Told the page in view after each turn, to keep it in the address. */
  onTurn?: (index: number) => void;
  /**
   * Shown where a cover was just opened (読む): the hand moves to the
   * poster, or to its spoiler door, instead of being lost with the cover.
   */
  takeFocus?: boolean;
}) {
  const count = poster.pages.length;
  const many = count > 1;
  const within = (at: number) => Math.max(0, Math.min(count - 1, at));
  const [index, setIndex] = useState(() =>
    poster.spoiler ? 0 : within(startPage),
  );
  const [start] = useState(index);
  const [open, setOpen] = useState(!poster.spoiler);
  const [cut, setCut] = useState<boolean[]>([]);
  const [reading, setReading] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const door = useRef<HTMLButtonElement>(null);
  const hide = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLElement>(null);
  const turned = useRef(false);
  // The page a turn is scrolling to: the pages it passes on the way are not
  // the page being read.
  const pending = useRef<number | null>(null);
  const report = useRef(onTurn);
  const page = poster.pages[Math.min(index, count - 1)] ?? emptyPage();
  const firstBook = bookById(books, posterBookIds(poster)[0]);

  useEffect(() => {
    report.current = onTurn;
  });
  useEffect(() => {
    report.current?.(index);
  }, [index]);

  // Coming back to the poster, the page being read is there at once.
  useLayoutEffect(() => {
    const element = track.current;
    if (element && start) element.scrollLeft = start * element.clientWidth;
  }, [start]);

  useEffect(() => {
    if (takeFocus) (door.current ?? region.current)?.focus();
  }, [takeFocus]);

  // After the door is opened or closed, the hand stays on its counterpart.
  useEffect(() => {
    if (!turned.current) return;
    (open ? hide.current : door.current)?.focus();
  }, [open]);

  const go = (next: number) => {
    const target = within(next);
    const element = track.current;
    setIndex(target);
    if (!element) return;
    const left = target * element.clientWidth;
    pending.current = Math.abs(element.scrollLeft - left) > 1 ? target : null;
    element.scrollTo({ left, behavior: quietScroll() });
  };
  const settle = (element: HTMLDivElement, ended: boolean) => {
    if (!element.clientWidth) return;
    const at = within(Math.round(element.scrollLeft / element.clientWidth));
    if (pending.current !== null && at !== pending.current && !ended) return;
    pending.current = null;
    setIndex(at);
  };
  // A swipe or a wheel takes over from a turn still on its way.
  const takeOver = () => {
    pending.current = null;
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    go(index + (event.key === "ArrowRight" ? 1 : -1));
  };
  const toggle = (next: boolean) => {
    turned.current = true;
    setOpen(next);
    // Opened again, it starts from its first page, as the track does.
    pending.current = null;
    setIndex(0);
    setReading(null);
  };

  if (!open)
    return (
      <section
        className="poster-pages"
        aria-label={author.name + "のポスター（ネタバレを含みます）"}
      >
        <div
          className={"poster-door" + (compact ? " is-compact" : "")}
          style={themeStyle(poster)}
        >
          <span className="poster-door-mark" aria-hidden="true">
            <Icon name="lock" size={18} />
          </span>
          <p>ネタバレを含みます</p>
          {firstBook && <small>{quotedTitle(firstBook)}</small>}
          <button type="button" ref={door} onClick={() => toggle(true)}>
            <Icon name="eye" size={15} />
            表示する
          </button>
        </div>
      </section>
    );

  return (
    <section
      className="poster-pages"
      ref={region}
      tabIndex={takeFocus ? -1 : undefined}
      aria-label={author.name + "のポスター"}
      aria-roledescription={many ? "ページをめくれるポスター" : undefined}
    >
      <div className="poster-stage">
        <div
          className={"poster-track" + (many ? " is-many" : "")}
          ref={track}
          tabIndex={many ? 0 : undefined}
          role={many ? "group" : undefined}
          aria-label={many ? "ページ（左右のキーでめくれます）" : undefined}
          onKeyDown={many ? keys : undefined}
          onScroll={(event) => settle(event.currentTarget, false)}
          onScrollEnd={(event) => settle(event.currentTarget, true)}
          onPointerDown={takeOver}
          onWheel={takeOver}
        >
          {poster.pages.map((_, at) => (
            <div
              key={at}
              className="poster-slide"
              role={many ? "group" : undefined}
              aria-label={
                many ? `${at + 1}ページ目（全${count}ページ）` : undefined
              }
            >
              <Sheet
                poster={poster}
                books={books}
                page={at}
                onCut={(isCut) =>
                  setCut((last) => {
                    if (last[at] === isCut) return last;
                    const next = [...last];
                    next[at] = isCut;
                    return next;
                  })
                }
              />
            </div>
          ))}
        </div>
        {many && (
          <span className="poster-count" aria-hidden="true">
            {index + 1}/{count}
          </span>
        )}
      </div>
      {/* Said aloud when a page turns; the counter above is only seen. */}
      {many && (
        <span className="poster-said" aria-live="polite">
          {`${index + 1}ページ目（全${count}ページ）`}
        </span>
      )}
      {(many || poster.spoiler) && (
        <div className="poster-controls">
          {many && (
            <>
              {/* aria-disabled, not disabled: at the first or last page the
                  focus stays on the button instead of falling to the page. */}
              <button
                type="button"
                className="poster-turn is-back"
                onClick={() => {
                  if (index > 0) go(index - 1);
                }}
                aria-disabled={index === 0 || undefined}
                aria-label="前のページ"
              >
                <Icon name="chevron" size={16} />
              </button>
              <span className="poster-dots">
                {poster.pages.map((_, at) => (
                  <button
                    key={at}
                    type="button"
                    className={at === index ? "is-current" : ""}
                    aria-current={at === index ? "true" : undefined}
                    aria-label={`${at + 1}ページ目`}
                    onClick={() => go(at)}
                  />
                ))}
              </span>
              <button
                type="button"
                className="poster-turn"
                onClick={() => {
                  if (index < count - 1) go(index + 1);
                }}
                aria-disabled={index === count - 1 || undefined}
                aria-label="次のページ"
              >
                <Icon name="chevron" size={16} />
              </button>
            </>
          )}
          {poster.spoiler && (
            <button
              type="button"
              ref={hide}
              className="poster-rehide"
              onClick={() => toggle(false)}
            >
              <Icon name="lock" size={13} />
              もう一度隠す
            </button>
          )}
        </div>
      )}
      {cut[index] && (
        <div className="poster-more">
          <button
            type="button"
            aria-expanded={reading === index}
            onClick={() => setReading(reading === index ? null : index)}
          >
            {reading === index ? "閉じる" : "続きを読む"}
          </button>
          {reading === index && (
            <div className={"poster-fulltext is-" + poster.font}>
              {page.heading && (
                <p className="poster-fulltext-heading">{page.heading}</p>
              )}
              {page.text && <p className="poster-fulltext-text">{page.text}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A poster folded by reports, before anything of it: why, in the town's
 * quiet grey rather than the poster's own look, and 読む. Its spoiler door,
 * if it has one, comes after.
 */
export function PosterFoldCover({
  cover,
  author,
  compact = false,
  onRead,
}: {
  cover: ReviewCover;
  author: Reader;
  /** Among other posts, a short band, not a page. */
  compact?: boolean;
  onRead: () => void;
}) {
  return (
    <section
      className="poster-pages"
      aria-label={
        author.name +
        "のポスター（" +
        (cover === "reported" ? "あなたが通報しました" : "たたんでいます") +
        "）"
      }
    >
      <div className={"poster-door is-report" + (compact ? " is-compact" : "")}>
        <span className="poster-door-mark" aria-hidden="true">
          <Icon name="lock" size={18} />
        </span>
        <p>{reviewCoverWords("poster", cover)}</p>
        <button type="button" onClick={onRead}>
          <Icon name="eye" size={15} />
          読む
        </button>
      </div>
    </section>
  );
}

/**
 * A poster's first page, small, for lists and rows. A spoiler poster shows
 * only that it is covered, and which book it is about: none of its words or
 * covers. One folded by reports shows only that it is folded: not even its
 * books. Its maker sees their own as it is, with a word on what reports did.
 * Where posters by many readers meet, the caption names the maker.
 */
export function PosterThumb({
  poster,
  books,
  href,
  badge,
  caption,
  folded = null,
  note = null,
}: {
  poster: Poster;
  books: Book[];
  href: string;
  badge?: string;
  /** Who made it, with 「 · 見本」 for an invented reader. */
  caption?: string;
  /** Folded by reports for this reader (reviewCoverOf). */
  folded?: ReviewCover | null;
  /** The maker's own, folded or held by reports (reviewNoteOf). */
  note?: "folded" | "held" | null;
}) {
  const firstBook = bookById(books, posterBookIds(poster)[0]);
  const review = note ? OWN_POSTER_REVIEW_WORDS[note] : "";
  return (
    <Link
      href={href}
      className="poster-thumb"
      aria-label={
        posterThumbName(poster, books, folded) +
        (caption ? "、" + caption : "") +
        (badge ? `（${badge}）` : "") +
        (review ? `（${review}）` : "")
      }
    >
      <div className="poster-thumb-tile">
        {folded ? (
          <span className="poster-thumb-door is-report">
            <Icon name="lock" size={16} />
            たたんでいます
            <small>{FOLDED_POSTER_REASONS[folded]}</small>
          </span>
        ) : poster.spoiler ? (
          <span className="poster-thumb-door" style={themeStyle(poster)}>
            <Icon name="lock" size={16} />
            ネタバレを含む
            {firstBook && <small>{quotedTitle(firstBook)}</small>}
          </span>
        ) : (
          <div aria-hidden="true">
            <Sheet poster={poster} books={books} linkBooks={false} />
          </div>
        )}
      </div>
      {caption && (
        <span className="poster-thumb-caption" aria-hidden="true">
          {caption}
        </span>
      )}
      {(badge || poster.pages.length > 1) && (
        <span className="poster-thumb-note" aria-hidden="true">
          {badge && <span className="poster-thumb-badge">{badge}</span>}
          {poster.pages.length > 1 && `${poster.pages.length}ページ`}
        </span>
      )}
      {review && (
        <span className="poster-thumb-review" aria-hidden="true">
          {review}
        </span>
      )}
    </Link>
  );
}

/** A poster among the posts of the timeline: who made it, then the poster. */
export function PosterCard({
  poster,
  state,
}: {
  poster: Poster;
  state: TownState;
}) {
  const author = findReader(state, poster.authorId);
  // Folded by reports: one tap opens it, then its spoiler door applies.
  const [read, setRead] = useState(false);
  const cover = read
    ? null
    : reviewCoverOf(state, "poster", poster.id, poster.authorId);
  const note = reviewNoteOf(state, "poster", poster.id, poster.authorId);
  // A reader who chose not to see spoilers is not shown this one at all.
  if (!author || posterSpoilerView(state, poster) === "left_out") return null;
  const mine = author.id === ME_ID;
  const profile = profilePath(author.id);
  return (
    <article
      className="post-card poster-card"
      aria-label={author.name + "のポスター"}
    >
      <Link
        href={profile}
        className="post-avatar"
        tabIndex={-1}
        aria-hidden="true"
      >
        <ReaderAvatar reader={author} size={40} />
      </Link>
      <div className="post-main">
        <header className="post-head">
          <Link href={profile} className="post-author">
            {author.name}
          </Link>
          <span className="post-handle">
            @{author.handle}
            {!mine && !isDatabaseId(author.id) && " · 見本"}
          </span>
          <time dateTime={poster.createdAt}>
            {formatPostTime(poster.createdAt)}
          </time>
        </header>
        <span className="poster-tag">ポスター</span>
        {cover ? (
          <PosterFoldCover
            cover={cover}
            author={author}
            compact
            onRead={() => setRead(true)}
          />
        ) : (
          <PosterPages
            poster={poster}
            books={state.books}
            author={author}
            compact
            takeFocus={read}
          />
        )}
        {note && (
          <div className="spoiler-folded-note report-folded-note" role="note">
            <p>{reviewNoteWords("poster", note)}</p>
          </div>
        )}
        <Link href={posterPath(poster.id)} className="poster-open">
          ポスターを開く
          <Icon name="arrow" size={14} />
        </Link>
      </div>
    </article>
  );
}
