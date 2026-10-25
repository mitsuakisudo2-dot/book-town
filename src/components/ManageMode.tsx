"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Notify, TownActions, TownState } from "../lib/types";
import { activeSession, currentBookId } from "../lib/reading";
import { bookById, bookTitle, quotedTitle } from "../lib/book-name";
import { bookPath } from "../lib/books";
import {
  countsOf,
  DEFAULT_SHELVES,
  filterLibrary,
  liveShelves,
} from "../lib/library";
import { libraryStateOf, townShopBooks } from "../lib/library-town";
import { libraryPath, readingPath } from "../lib/paths";
import { counted, NAMES } from "../lib/words";
import { BookJacket, Icon } from "./ui";
import { ShelfBook, ShelfRow } from "./WoodenShelf";
import "./manage.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/** How many books the home's shelves show at most. */
const READING_SHOWN = 6;
const RECENT_SHOWN = 12;
/** The shelves every library has that the home names, when they hold books. */
const HOME_SHELVES = ["reading", "tsundoku", "finished", "want"];

/**
 * The home of 読書管理モード (管理表 99, けにーさん 10-25): the reader and
 * their books only, read from what is theirs. Top to bottom, the books being
 * read (each started in one tap, or gone back to), 本を登録, the books put in last, on a shelf, and
 * the reader's own shelves. Every part is a door into a screen that is
 * already there; nothing of the town.
 */
export function ManageHome({ state, actions, notify }: Shared) {
  const router = useRouter();
  const library = useMemo(() => libraryStateOf(state), [state]);
  const shop = useMemo(() => townShopBooks(state), [state]);
  const counts = useMemo(() => countsOf(library, shop), [library, shop]);
  const reading = useMemo(() => {
    const ids = [
      activeSession(state)?.bookId ?? currentBookId(state),
      ...filterLibrary(
        library,
        { status: ["reading"], showWanted: true },
        shop,
      ),
    ].filter((id): id is string => Boolean(id));
    return [...new Set(ids)]
      .flatMap((id) => bookById(state.books, id) ?? [])
      .slice(0, READING_SHOWN);
  }, [state, library, shop]);
  const recent = useMemo(
    () =>
      filterLibrary(library, { showWanted: false }, shop)
        .flatMap((id) => bookById(state.books, id) ?? [])
        .slice(0, RECENT_SHOWN),
    [state.books, library, shop],
  );
  const running = activeSession(state);
  const shelves = [
    ...HOME_SHELVES.flatMap(
      (key) => DEFAULT_SHELVES.find((shelf) => shelf.key === key) ?? [],
    )
      .filter((shelf) => counts.shelves[shelf.key])
      .map((shelf) => ({
        key: shelf.key,
        name: shelf.label,
        works: counts.shelves[shelf.key],
      })),
    ...liveShelves(state.libraryShelves).map((shelf) => ({
      key: shelf.id,
      name: shelf.name,
      works: counts.themes[shelf.id]?.works ?? 0,
    })),
  ];
  return (
    <div className="manage-home">
      <header className="manage-hero">
        <span className="eyebrow">MY READING ROOM</span>
        <h1>今日は、どの本と過ごしますか</h1>
      </header>

      <section
        className="manage-reading"
        aria-labelledby="manage-reading-title"
      >
        <h2 id="manage-reading-title">読んでいる本</h2>
        {reading.length ? (
          <ul className="manage-reading-list">
            {reading.map((book) => (
              <li key={book.id}>
                <Link
                  href={bookPath(book.id)}
                  className="manage-reading-book"
                  aria-label={`${quotedTitle(book)}の作品ページへ`}
                >
                  <BookJacket book={book} sizes="96px" />
                </Link>
                <b>{bookTitle(book)}</b>
                {running?.bookId === book.id && (
                  <small className="manage-live">
                    <i aria-hidden="true" />
                    読書中
                  </small>
                )}
                {running?.bookId === book.id ? (
                  <Link
                    href={readingPath()}
                    className="btn soft"
                    aria-label={`${quotedTitle(book)}の読書に戻る`}
                  >
                    続きを読む
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn soft"
                    aria-label={`${quotedTitle(book)}を読み始める`}
                    onClick={() => {
                      // One tap: alone, as everything is in this mode.
                      if (!actions.startReading(book.id, "solo")) return;
                      notify("読み始めました。読んだ時間を残します");
                      router.push(readingPath());
                    }}
                  >
                    読み始める
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Link href={readingPath()} className="manage-start">
            <Icon name="reading" size={24} />
            <span>
              <b>読書をはじめる</b>
              <small>本を選ぶと、読んだ時間が残ります</small>
            </span>
            <Icon name="arrow" size={16} />
          </Link>
        )}
      </section>

      <Link href={libraryPath({ addBook: true })} className="manage-register">
        <Icon name="barcode" size={26} />
        <span>
          <b>本を登録</b>
          <small>バーコード・題名・ISBNで</small>
        </span>
        <Icon name="plus" size={20} />
      </Link>

      {recent.length > 0 && (
        <section
          className="manage-recent"
          aria-labelledby="manage-recent-title"
        >
          <div className="manage-heading">
            <h2 id="manage-recent-title">最近入れた本</h2>
            <Link href={libraryPath()} className="text-btn">
              ライブラリへ
              <Icon name="arrow" size={14} />
            </Link>
          </div>
          <RecentShelf books={recent} />
        </section>
      )}

      <section
        className="manage-shelves"
        aria-labelledby="manage-shelves-title"
      >
        <div className="manage-heading">
          <h2 id="manage-shelves-title">自分の本棚</h2>
          <span className="manage-count">
            ぜんぶで{counted(counts.works, "冊")}
          </span>
        </div>
        <ul className="manage-shelf-list">
          {shelves.map((shelf) => (
            <li key={shelf.key}>
              <Link href={libraryPath({ shelf: shelf.key })}>
                <Icon name="shelf" size={18} />
                <span>{shelf.name}</span>
                <small>{counted(shelf.works, "冊")}</small>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={libraryPath({ makeShelf: true })}
              className="manage-new-shelf"
            >
              <Icon name="plus" size={18} />
              <span>本棚をつくる</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * The books put in last, on a wooden shelf as the shops draw theirs: the
 * newest faces out, the rest by their spines. A tap opens the book's page.
 */
function RecentShelf({ books }: { books: TownState["books"] }) {
  const router = useRouter();
  const shelf = {
    id: "recent",
    name: "最近入れた本",
    capacity: books.length,
    isPublic: false,
    items: books.map((book, index) => ({
      id: book.id,
      bookId: book.id,
      display: index === 0 ? ("face" as const) : ("spine" as const),
      pop: "",
    })),
  };
  return (
    <ShelfRow
      shelf={shelf}
      books={books}
      book={(item, book) => (
        <ShelfBook
          key={item.id}
          item={item}
          book={book}
          selected={false}
          onSelect={() => router.push(bookPath(book.id))}
        />
      )}
    />
  );
}

/**
 * A page of the town opened in 読書管理モード (a shop, walking the shops, a
 * poster, a 便り, another reader): it rests, and says so, with the way home
 * and the way back to the town for a reader who came for it.
 */
export function ManageRest({ actions, notify }: Shared) {
  return (
    <div className="empty-state manage-rest">
      <Icon name="leaf" size={34} />
      <h1>読書管理モードの間、街はお休みしています</h1>
      <p>
        書店や人の{NAMES.letter}は、通常モードに戻すと、いつもどおり見られます。
      </p>
      <div className="empty-state-actions">
        <Link className="btn fill" href="/">
          ホームへ
        </Link>
        <button
          type="button"
          className="btn"
          onClick={() => {
            actions.setTownMode("normal");
            notify("通常モードに戻しました");
          }}
        >
          通常モードに戻す
        </button>
      </div>
    </div>
  );
}
