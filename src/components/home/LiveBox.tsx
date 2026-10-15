"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { unseen } from "../../lib/arrivals";
import { takeIn } from "../../lib/arrived";
import { useLayerOpen } from "../../lib/back-layer";
import { splitHidden } from "../../lib/hidden-words";
import {
  LIVE_ROW,
  LIVE_SHOWN,
  isGuarded,
  liveRows,
  newLines,
} from "../../lib/live";
import { postPath } from "../../lib/paths";
import {
  findReader,
  formatPostTime,
  spoilerBookOf,
  spoilerViewOf,
} from "../../lib/social";
import { useTownReads } from "../../lib/store";
import { isSample } from "../../lib/tonight";
import type { Post, TownState } from "../../lib/types";
import { BookJacket, Icon } from "../ui";
import { spoilerWords } from "../letter/LetterCard";
import { forgetOpened, noteOpened, openPost } from "../letter/post-layer";
import { SpoilerCover } from "../letter/SpoilerCover";
import type { Shared } from "./Letters";
import { useArrivals } from "./useArrivals";

/**
 * Live as ホーム holds it (PR 2b): the lines it was drawn with, by id, every
 * memo written while reading together that the town had then (a line not
 * among them came since), and when it was drawn.
 */
export type LiveSlot = {
  kind: "live";
  ids: string[];
  known: ReadonlySet<string>;
  at: number;
};

// 止める／動かす (WCAG 2.2.2): kept for the page, so Live stays stopped when
// Home is drawn again or left and come back to.
let stopped = false;
const stopListeners = new Set<() => void>();
function setStopped(next: boolean) {
  stopped = next;
  stopListeners.forEach((listener) => listener());
}
function useStopped(): boolean {
  return useSyncExternalStore(
    (listener) => {
      stopListeners.add(listener);
      return () => {
        stopListeners.delete(listener);
      };
    },
    () => stopped,
    () => false,
  );
}

/** Whether the page is in view (not in a tab behind, nor minimised). */
function usePageShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    () => document.visibilityState === "visible",
    () => false,
  );
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// A tap on these does their own thing, never the line's.
const OWN_TAPS = "a,button,[role=dialog],.modal-backdrop";

/**
 * 読みながらのひとこと (決定 H:114-119, v37 §3.7): other readers' memos
 * written while reading together, each with the book's cover, in a box of a
 * fixed three lines; 「前のひとことも見る」 opens it to six. New lines come
 * only from polling and go in at the top while the box is on the screen,
 * not stopped, under no layer and with no keyboard focus in it; the box
 * keeps its height, so nothing around it moves. No scroll inside it.
 * 止める stops them (WCAG 2.2.2); with less motion asked for, the lines
 * change without moving.
 */
export function LiveBox({
  slot,
  onTakeLine,
  ...shared
}: Shared & {
  slot: LiveSlot;
  /** Takes a line not in the town yet into it; whether it is there now. */
  onTakeLine: (id: string) => boolean;
}) {
  const { state } = shared;
  const waiting = useArrivals();
  // The town with what polling brought and the reader has not taken in.
  const town = useMemo(
    () =>
      waiting.arrived ? takeIn(state, unseen(waiting.arrived, state)) : state,
    [state, waiting.arrived],
  );
  // Drawn again (a tap on the tab, a pull): the box starts from its lines.
  const [drawnFor, setDrawnFor] = useState(slot);
  const [entered, setEntered] = useState<string[]>([]);
  const [openRows, setOpenRows] = useState<number | null>(null);
  const [arrival, setArrival] = useState<{ ids: string[]; key: number }>({
    ids: [],
    key: 0,
  });
  if (drawnFor !== slot) {
    setDrawnFor(slot);
    setEntered([]);
    setOpenRows(null);
  }
  const rows = liveRows(town, slot.ids, entered, slot.at);
  const coming = newLines(
    town,
    slot.known,
    new Set([...entered, ...slot.ids]),
    slot.at,
  );
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const isStopped = useStopped();
  const layerOpen = useLayerOpen();
  const pageShown = usePageShown();
  const canArrive = useTownReads();
  // The keyboard's focus in the box: a line coming in would push the one it
  // is on under the box, out of reach, and the focus with it.
  const [keyed, setKeyed] = useState(false);
  // New lines go in at the top only while the box can be seen.
  if (
    onScreen &&
    pageShown &&
    !layerOpen &&
    !isStopped &&
    !keyed &&
    coming.length
  ) {
    const ids = coming.map((post) => post.id);
    setEntered([...ids, ...entered]);
    setArrival({ ids, key: arrival.key + 1 });
  }
  // Lines gone since (reported, left out) leave no empty row: the box
  // opened is closed once all it has fit.
  if (openRows !== null && rows.length <= LIVE_SHOWN) setOpenRows(null);
  const drawn = rows.length > 0;
  useEffect(() => {
    const element = box.current;
    if (!drawn || !element) return;
    // On the screen: half of it at least, not a sliver behind the bars.
    const watcher = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.5 },
    );
    watcher.observe(element);
    return () => {
      watcher.disconnect();
      setOnScreen(false);
    };
  }, [drawn]);
  // They come down from above the box (v37: .45s), the newest glowing a
  // moment; with less motion asked for, they are simply there.
  useLayoutEffect(() => {
    const element = list.current;
    if (!arrival.key || !element || still()) return;
    const count = Math.min(arrival.ids.length, LIVE_SHOWN);
    element.animate(
      [
        { transform: `translateY(${-count * LIVE_ROW}px)` },
        { transform: "none" },
      ],
      { duration: 450, easing: "cubic-bezier(.2,0,0,1)" },
    );
    const glow = getComputedStyle(element)
      .getPropertyValue("--lamp-soft")
      .trim();
    for (const id of arrival.ids)
      element
        .querySelector(`[data-post-id="${CSS.escape(id)}"]`)
        ?.animate(
          [{ backgroundColor: glow }, { backgroundColor: "transparent" }],
          {
            duration: 800,
            easing: "ease-out",
          },
        );
  }, [arrival]);
  const headId = useId();
  const boxId = useId();
  if (!drawn) return null;
  const shown = Math.min(openRows ?? LIVE_SHOWN, rows.length);
  const more = rows.length > LIVE_SHOWN;
  return (
    <section
      className="home-feature home-live"
      aria-labelledby={headId}
      onFocus={(event) =>
        setKeyed((event.target as Element).matches(":focus-visible"))
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setKeyed(false);
      }}
    >
      <div className="feature-head">
        <p className="feature-kicker">
          <span className="home-live-dot" aria-hidden="true" />
          いま読んでいる
        </p>
        <h2 id={headId}>読みながらのひとこと</h2>
        <p>本を読んでいる人のひとことが、その場で届きます。</p>
      </div>
      <div className="home-live-frame">
        <div
          ref={box}
          id={boxId}
          className="home-live-box"
          aria-live="off"
          style={{ height: shown * LIVE_ROW }}
        >
          <div ref={list} className="home-live-list">
            {rows.map((post, index) => (
              <LiveLine
                {...shared}
                key={post.id}
                town={town}
                post={post}
                hidden={index >= shown}
                onTakeLine={onTakeLine}
              />
            ))}
          </div>
        </div>
        {(more || canArrive) && (
          <div className="home-live-foot">
            {more && (
              <button
                type="button"
                className="home-live-more"
                aria-expanded={openRows !== null}
                aria-controls={boxId}
                onClick={() =>
                  setOpenRows(openRows === null ? rows.length : null)
                }
              >
                {openRows === null ? "前のひとことも見る" : "たたむ"}
                <Icon name="chevron" size={18} />
              </button>
            )}
            {canArrive && (
              <button
                type="button"
                className="home-live-stop"
                aria-label={isStopped ? "ひとことを動かす" : "ひとことを止める"}
                onClick={() => setStopped(!isStopped)}
              >
                <Icon name={isStopped ? "play" : "pause"} size={18} />
                {isStopped ? "動かす" : "止める"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One line: the book's cover whole; beside it who, 『which book』 and when on
 * one line, then the words in two. A line about a book on the reader's
 * shelves and not finished waits behind a stand-in until DB-1 knows their
 * page (guardedWorks); a spoiler, in the spoiler box. A tap opens the 便り's page, as a card's does;
 * the time is the way in by the keyboard.
 */
function LiveLine({
  town,
  post,
  hidden,
  state,
  onTakeLine,
}: Shared & {
  town: TownState;
  post: Post;
  hidden: boolean;
  onTakeLine: (id: string) => boolean;
}) {
  const author = findReader(town, post.authorId);
  const book = town.books.find((entry) => entry.id === post.bookId);
  const [guardOpen, setGuardOpen] = useState(false);
  const [spoilerOpen, setSpoilerOpen] = useState(false);
  const [focusText, setFocusText] = useState(false);
  const words = useRef<HTMLDivElement>(null);
  const timeLink = useRef<HTMLAnchorElement>(null);
  const downHere = useRef(false);
  // Opened, the focus goes to what took the stand-in's place: the words, or
  // the spoiler box when they are a spoiler too.
  useEffect(() => {
    if (!focusText) return;
    words.current
      ?.querySelector<HTMLElement>(".home-live-text, .letter-spoiler")
      ?.focus({ preventScroll: true });
    setFocusText(false);
  }, [focusText]);
  if (!author || !book) return null;
  const guarded = !guardOpen && isGuarded(town, post);
  const askedByMe = town.spoilerReports.includes(post.id);
  const covered = !spoilerOpen && spoilerViewOf(town, post) === "folded";
  const spoilerBook = town.books.find(
    (entry) => entry.id === spoilerBookOf(town, post),
  );

  function openPage() {
    // Brought by polling and not in the town yet: this one is taken in
    // first, as the reader asked for it; the rest still wait.
    const inTown = state.posts.some((entry) => entry.id === post.id);
    if (!inTown && !onTakeLine(post.id)) return;
    forgetOpened("door:" + post.id);
    openPost(post.id, timeLink.current);
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    downHere.current = event.currentTarget.contains(event.target as Node);
  }
  function tap(event: MouseEvent<HTMLElement>) {
    const began = downHere.current;
    downHere.current = false;
    const target = event.target as Element;
    if (!began || target.closest(OWN_TAPS)) return;
    // The tap that ends a selection of the words is the selection's.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim())
      return;
    openPage();
  }

  return (
    <article
      className="home-live-line"
      aria-label={author.name + "さんのひとこと"}
      data-post-id={post.id}
      inert={hidden}
      onPointerDown={pointerDown}
      onClick={tap}
    >
      <span className="home-live-jacket" aria-hidden="true">
        <BookJacket book={book} sizes="44px" />
      </span>
      <div ref={words} className="home-live-words">
        <p className="home-live-meta">
          <span
            className="home-live-face"
            aria-hidden="true"
            // A pale wash of the writer's colour, so the initial reads.
            style={{ "--face": author.color } as CSSProperties}
          >
            {author.name.slice(0, 1)}
          </span>
          <b className="home-live-name">{author.name}</b>
          {isSample(author.id) && <span className="home-tag">見本</span>}
          <span className="home-live-book">『{book.title}』</span>
          <a
            ref={timeLink}
            className="home-live-time"
            href={postPath(post.id)}
            onClick={(event) => {
              // A new tab or window opens the page at its own address.
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              openPage();
            }}
          >
            <time dateTime={post.createdAt}>
              {formatPostTime(post.createdAt)}
            </time>
          </a>
        </p>
        {guarded ? (
          <button
            type="button"
            className="home-live-guard"
            onClick={() => {
              setGuardOpen(true);
              setFocusText(true);
            }}
          >
            あなたの本棚の、読み終えていない本のひとことです。
            <span className="home-live-show">表示する</span>
          </button>
        ) : covered ? (
          <SpoilerCover
            words={spoilerWords(post, askedByMe)}
            title={spoilerBook?.title}
            bars={1}
            onOpen={() => {
              setSpoilerOpen(true);
              noteOpened("spoiler:" + post.id);
              setFocusText(true);
            }}
          />
        ) : (
          <p className="home-live-text" tabIndex={-1}>
            {splitHidden(post.body).map((part, index) =>
              part.hidden ? (
                // The covered words stay off the page; its 便り opens them.
                <span key={index} className="home-live-hidden">
                  ネタバレ
                </span>
              ) : (
                part.text
              ),
            )}
          </p>
        )}
      </div>
    </article>
  );
}
