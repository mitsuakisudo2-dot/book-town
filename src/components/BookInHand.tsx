"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type TouchEvent } from "react";
import {
  POP_REACTIONS,
  popReactionKey,
  type PopReaction,
  type Shelf,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import { BookJacket, CoverCredit, Icon, ReaderAvatar } from "./ui";
import { CoverRemovalLink } from "./Report";
import { BookActions, BookPrice, BookPurchase, bookNote } from "./BookActions";
import { BookDiscovery } from "./BookDiscovery";
import { bookPath } from "../lib/books";
import "./book-in-hand.css";
import type { ReadEntry } from "../lib/store-scene-adapter";
import { StoreStamp } from "./StoreCanvas";
import { profilePath, shopPath } from "../lib/paths";
import { useBackLayer } from "../lib/back-layer";
import { focusBack } from "../lib/coarse-pointer";
import { lockPageScroll } from "../lib/scroll-lock";

/**
 * The book in hand, as one step of 戻る: the shop, the shelf (none for a
 * book placed in a shop's scene) and the item. A page shown again on that
 * step puts the same book back in hand.
 */
export type HeldBook = {
  shopId: string;
  shelfId: string | null;
  itemId: string;
};
const HELD = "book:";
export const heldBookName = (held: HeldBook) =>
  HELD + JSON.stringify([held.shopId, held.shelfId, held.itemId]);
export function heldBookOf(name: string): HeldBook | null {
  if (!name.startsWith(HELD)) return null;
  try {
    const [shopId, shelfId, itemId] = JSON.parse(name.slice(HELD.length));
    return typeof shopId === "string" && typeof itemId === "string"
      ? {
          shopId,
          shelfId: typeof shelfId === "string" ? shelfId : null,
          itemId,
        }
      : null;
  } catch {
    return null;
  }
}

export interface SceneReading {
  entries: ReadEntry[];
  allPops: ReadEntry[];
  initialId: string;
  reactions: Record<string, string[]>;
  toggleReaction: (key: string, reaction: string) => void;
}
const entryKey = (entry: ReadEntry) =>
  entry.legacy
    ? popReactionKey(entry.shopId, entry.legacy.shelfId, entry.legacy.itemId)
    : JSON.stringify(["scene", entry.shopId, entry.id]);
const legacyEntries = (shop: Shop, shelf: Shelf): ReadEntry[] =>
  shelf.items.map((item) => ({
    id: item.id,
    bookId: item.bookId,
    pop: item.pop,
    shopId: shop.id,
    label: shelf.name,
    legacy: { shelfId: shelf.id, itemId: item.id },
  }));

type BookInHandProps = {
  state: TownState;
  actions: TownActions;
  onClose: () => void;
  notify: (message: string) => void;
} & (
  | { shop: Shop; shelf: Shelf; itemId: string; reading?: never }
  | { shop?: never; shelf?: never; itemId?: never; reading: SceneReading }
);

type TouchStart = {
  id: number;
  x: number;
  y: number;
  time: number;
  axis: "horizontal" | "vertical" | null;
};

export function BookInHand({
  shop: sourceShop,
  shelf: sourceShelf,
  itemId,
  state,
  actions,
  onClose,
  notify,
  reading,
}: BookInHandProps) {
  const [sceneMode, setSceneMode] = useState(Boolean(reading));
  const [context, setContext] = useState({
    shopId: sourceShop?.id ?? reading?.entries[0]?.shopId ?? "",
    shelfId: sourceShelf?.id ?? "",
    itemId: itemId ?? reading?.initialId ?? "",
  });
  // Keep pagination scoped to the currently opened shelf item.
  // Reset this when navigating, including when returning to a previously opened book.
  const [popPage, setPopPage] = useState<{ key: string; index: number } | null>(
    null,
  );
  const catalog = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const legacyShop =
    [...state.shops, ...(state.ownShop ? [state.ownShop] : [])].find(
      (entry) => entry.id === context.shopId,
    ) ?? sourceShop;
  const shelf =
    legacyShop?.shelves.find((entry) => entry.id === context.shelfId) ??
    sourceShelf;
  const selectedId = context.itemId;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<TouchStart | null>(null);
  const wheelRef = useRef({ total: 0, last: 0, moved: 0 });
  const restoreViewportRef = useRef(true);
  const titleId = useId();
  const shelfLabelId = useId();

  // The shelf is the source of ordering; neither recommendations nor book IDs sort it.
  const availableItems = (
    sceneMode && reading
      ? reading.entries
      : legacyShop && shelf
        ? legacyEntries(legacyShop, shelf)
        : []
  ).filter((item) => state.books.some((book) => book.id === item.bookId));
  const index = Math.max(
    0,
    availableItems.findIndex((item) => item.id === selectedId),
  );
  const item = availableItems[index];
  const shop = catalog.find((s) => s.id === item?.shopId) ?? legacyShop;
  const book = state.books.find((entry) => entry.id === item?.bookId);
  const reactionKey = item ? entryKey(item) : "";
  // The book remains open while this list flips through words written
  // about that same edition by other public shelves.
  const popCandidates = item
    ? [
        item,
        ...(sceneMode && reading
          ? reading.allPops
          : catalog.flatMap((s) =>
              s.shelves
                .filter((row) => row.isPublic)
                .flatMap((row) => legacyEntries(s, row)),
            )
        ).filter(
          (other) =>
            other.bookId === item.bookId &&
            other.pop.trim() &&
            entryKey(other) !== reactionKey,
        ),
      ]
    : [];
  const popIndex =
    popPage?.key === reactionKey
      ? Math.min(popPage.index, popCandidates.length - 1)
      : 0;
  const activePop = popCandidates[popIndex];
  const activeShop = catalog.find((s) => s.id === activePop?.shopId);
  const popOwner =
    activeShop?.ownerId === state.me.id
      ? state.me
      : state.readers.find((reader) => reader.id === activeShop?.ownerId);
  const activeReactionKey = activePop ? entryKey(activePop) : "";
  const popReactions = activePop?.legacy
    ? (state.popReactions[activeReactionKey] ?? [])
    : (reading?.reactions[activeReactionKey] ?? []);
  // The POPs lie side by side on a track the browser scrolls: it follows the
  // finger and snaps one POP per page. The count, the owner and the reactions
  // follow the page the track has come to rest on.
  const trackRef = useRef<HTMLDivElement>(null);
  const trackTouched = useRef(false);
  // The page a button sent the track to: it stays the one shown while the
  // track glides there, however many presses come before it arrives.
  const trackAim = useRef<{ key: string; page: number } | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  function showPopPage(index: number) {
    const next = Math.max(0, Math.min(index, popCandidates.length - 1));
    setPopPage((page) =>
      (page?.key === reactionKey ? page.index : 0) === next
        ? page
        : { key: reactionKey, index: next },
    );
    return next;
  }
  function settlePop() {
    window.clearTimeout(settleTimer.current);
    const track = trackRef.current;
    if (!track || trackTouched.current || !track.clientWidth) return;
    const at = track.scrollLeft / track.clientWidth;
    const aim = trackAim.current;
    if (aim?.key === reactionKey && Math.abs(at - aim.page) > 0.02) return;
    trackAim.current = null;
    showPopPage(Math.round(at));
  }
  // Not every browser tells when a scroll has ended: a short quiet does.
  function settlePopSoon() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settlePop, 120);
  }
  useEffect(() => {
    const timer = settleTimer;
    return () => window.clearTimeout(timer.current);
  }, []);
  function glidePop(track: HTMLDivElement, page: number) {
    track.scrollTo({
      left: page * track.clientWidth,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  // The page the track rests on or is gliding to: where a button sent it,
  // else the page most in view. A press during the glide means that POP.
  function popInView() {
    const aim = trackAim.current;
    if (aim?.key === reactionKey) return aim.page;
    const track = trackRef.current;
    if (!track?.clientWidth) return popIndex;
    return Math.max(
      0,
      Math.min(
        Math.round(track.scrollLeft / track.clientWidth),
        popCandidates.length - 1,
      ),
    );
  }
  function movePop(direction: -1 | 1) {
    const next = showPopPage(popInView() + direction);
    const track = trackRef.current;
    trackAim.current = { key: reactionKey, page: next };
    if (track) glidePop(track, next);
  }
  // A reaction goes to the POP in view, and the track comes to rest on it.
  function reactToPop(reaction: PopReaction) {
    const page = popInView();
    const pop = popCandidates[page];
    const track = trackRef.current;
    showPopPage(page);
    if (
      track?.clientWidth &&
      !trackTouched.current &&
      Math.abs(track.scrollLeft / track.clientWidth - page) > 0.02
    )
      glidePop(track, page);
    if (pop.legacy)
      actions.togglePopReaction(
        pop.shopId,
        pop.legacy.shelfId,
        pop.legacy.itemId,
        reaction,
      );
    else reading?.toggleReaction(entryKey(pop), reaction);
  }
  // A turn is told to a screen reader from a hidden copy of the new POP.
  // While the copy is there the page on show is hidden from it, so the
  // words are never there twice; then the page is read where it stands.
  const [telling, setTelling] = useState(false);
  useEffect(() => {
    const turned = popPage?.key === reactionKey;
    setTelling(turned);
    if (!turned) return;
    const timer = window.setTimeout(() => setTelling(false), 5000);
    return () => window.clearTimeout(timer);
  }, [popPage, reactionKey]);
  const told = telling && popPage?.key === reactionKey;
  // Before the page beneath is held still, so its scroll is recorded.
  const layer = useBackLayer(
    onClose,
    item
      ? heldBookName({
          shopId: item.shopId,
          shelfId: item.legacy?.shelfId ?? null,
          itemId: item.id,
        })
      : undefined,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // A modal native dialog makes the rest of the document inert, including AT.
    // Fixing the body also prevents the underlying street moving on mobile Safari.
    const release = lockPageScroll();
    // The dialog holds no field, so opening it raises no keyboard; the focus
    // starts on 閉じる.
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      release(restoreViewportRef.current);
      if (restoreViewportRef.current && previouslyFocused?.isConnected) {
        focusBack(previouslyFocused, { preventScroll: true });
      }
    };
  }, []);

  function move(direction: -1 | 1) {
    const next = availableItems[index + direction];
    if (!next) return;
    setPopPage(null);
    // The keyed book body is replaced; keep keyboard focus inside the dialog.
    if (contentRef.current?.contains(document.activeElement))
      closeButtonRef.current?.focus({ preventScroll: true });
    setContext({ ...context, itemId: next.id });
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  function leaveForPage() {
    // The book stays in hand in the step it leaves, for 戻る to return to.
    layer.leave(() => {});
    // Next.js owns the destination page's scroll; only closing returns to the shelf.
    restoreViewportRef.current = false;
    onClose();
  }

  function startTouch(event: TouchEvent<HTMLDivElement>) {
    if (
      event.touches.length !== 1 ||
      (event.target as HTMLElement).closest(
        "button,a,input,textarea,select,summary,[data-book-rail],.bh-pop",
      )
    ) {
      touchRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchRef.current = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      time: event.timeStamp,
      axis: null,
    };
  }

  function moveTouch(event: TouchEvent<HTMLDivElement>) {
    const start = touchRef.current;
    if (!start || event.touches.length !== 1) {
      touchRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (touch.identifier !== start.id || start.axis) return;
    const dx = Math.abs(touch.clientX - start.x);
    const dy = Math.abs(touch.clientY - start.y);
    if (dx > 12 && dx > dy * 1.5) start.axis = "horizontal";
    else if (dy > 12) start.axis = "vertical";
  }

  function endTouch(event: TouchEvent<HTMLDivElement>) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start || start.axis === "vertical" || event.touches.length > 0) return;
    const touch = Array.from(event.changedTouches).find(
      (entry) => entry.identifier === start.id,
    );
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (
      Math.abs(dx) >= 56 &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      event.timeStamp - start.time < 1000
    ) {
      move(dx < 0 ? 1 : -1);
    }
  }

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("[data-book-rail],.bh-pop"))
        return;
      const horizontal =
        event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (
        Math.abs(horizontal) <=
          Math.abs(event.shiftKey ? 0 : event.deltaY) * 1.5 ||
        Math.abs(horizontal) < 2
      )
        return;
      const now = event.timeStamp;
      const gesture = wheelRef.current;
      if (
        now - gesture.last > 180 ||
        Math.sign(horizontal) !== Math.sign(gesture.total)
      )
        gesture.total = 0;
      gesture.last = now;
      event.preventDefault();
      if (gesture.moved && now - gesture.moved < 650) return;
      gesture.total += horizontal * (event.deltaMode === 1 ? 16 : 1);
      if (Math.abs(gesture.total) >= 60) {
        const next = availableItems[index + (gesture.total > 0 ? 1 : -1)];
        gesture.total = 0;
        gesture.moved = now;
        if (next) {
          setPopPage(null);
          if (content.contains(document.activeElement))
            closeButtonRef.current?.focus({ preventScroll: true });
          setContext({ ...context, itemId: next.id });
          content.scrollTo({ top: 0, behavior: "instant" });
        }
      }
    };
    content.addEventListener("wheel", wheel, { passive: false });
    return () => content.removeEventListener("wheel", wheel);
  }, [context, availableItems, index]);

  if (!book || !item || !shop || !activeShop) return null;
  const wished = state.wishlist.includes(book.id);

  return (
    <dialog
      ref={dialogRef}
      className={"bh-dialog" + (sceneMode ? " is-store-scene" : "")}
      aria-labelledby={titleId}
      aria-describedby={shelfLabelId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          !(event.target as HTMLElement).closest(
            "[data-book-rail],input,textarea,select",
          )
        ) {
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }
        if (event.key === "Tab") {
          const targets = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],summary,[tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = targets[0];
          const last = targets.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="bh-topbar">
        <span id={shelfLabelId} className="bh-shelf-caption">
          <Icon name="book" size={17} />
          <span>{item.label}</span>
        </span>
        <button
          type="button"
          ref={closeButtonRef}
          className="icon-btn bh-close"
          onClick={onClose}
          aria-label="本を閉じて棚に戻る"
        >
          <Icon name="close" size={21} />
        </button>
      </div>

      <div
        ref={contentRef}
        className="bh-content"
        onTouchStart={startTouch}
        onTouchMove={moveTouch}
        onTouchEnd={endTouch}
        onTouchCancel={() => {
          touchRef.current = null;
        }}
      >
        <div className="bh-book-body" key={reactionKey}>
          <div className="bh-book-intro">
            <Link
              className="bh-cover"
              href={bookPath(book.id)}
              onNavigate={leaveForPage}
              aria-label={`${book.title}の作品ページへ`}
            >
              <BookJacket book={book} illustrated={sceneMode} />
            </Link>
            <div className="bh-book-heading">
              <span className="bh-genre">{book.genre}</span>
              <h2 id={titleId}>
                <Link href={bookPath(book.id)} onNavigate={leaveForPage}>
                  {book.title}
                </Link>
              </h2>
              <p className="bh-author">{book.author}</p>
              <CoverCredit book={book} />
              <CoverRemovalLink book={book} />
              <BookPrice book={book} />
              <BookPurchase book={book} />
            </div>
          </div>

          <section className="bh-summary" aria-label="あらすじ">
            <h3>あらすじ</h3>
            <p>{book.summary}</p>
          </section>

          <section
            className={`bh-pop owner-pop${popCandidates.length > 1 ? " has-pages" : ""}`}
            aria-label="この本に寄せられたPOP"
          >
            <div className="bh-pop-label">
              <span>
                {popOwner ? `店主 ${popOwner.name} のPOP` : "店主のPOP"}
              </span>
              {activeShop.demo && <small>見本</small>}
            </div>
            <div
              className={`bh-pop-pager${popCandidates.length > 1 ? " has-pages" : ""}`}
              role={popCandidates.length > 1 ? "group" : undefined}
              aria-label={
                popCandidates.length > 1
                  ? "この本へのPOPを切り替える"
                  : undefined
              }
            >
              {popCandidates.length > 1 && (
                <button
                  type="button"
                  className="bh-pop-page-button"
                  aria-label="前のPOP"
                  disabled={popIndex === 0}
                  onClick={() => movePop(-1)}
                >
                  <Icon name="back" size={17} />
                </button>
              )}
              <div
                ref={trackRef}
                className={
                  "bh-pop-track" +
                  (popIndex === 0 ? " at-first" : "") +
                  (popIndex === popCandidates.length - 1 ? " at-last" : "")
                }
                tabIndex={-1}
                onScroll={settlePopSoon}
                onScrollEnd={settlePop}
                onTouchStart={() => {
                  trackTouched.current = true;
                  trackAim.current = null;
                }}
                onWheel={() => {
                  trackAim.current = null;
                }}
                onTouchEnd={(event) => {
                  trackTouched.current = event.touches.length > 0;
                  settlePopSoon();
                }}
                onTouchCancel={() => {
                  trackTouched.current = false;
                  settlePopSoon();
                }}
              >
                {popCandidates.map((entry, page) => (
                  <div
                    key={entryKey(entry)}
                    className={
                      "bh-pop-page" + (page === popIndex ? " is-current" : "")
                    }
                    aria-hidden={page === popIndex && !told ? undefined : true}
                  >
                    {entry.pop.trim() ? (
                      <p className="bh-pop-text">{entry.pop}</p>
                    ) : (
                      <p className="bh-pop-empty">
                        この本のPOPは、まだ書かれていません。
                      </p>
                    )}
                    {entry.stamp && (
                      <span className="bh-pop-stamp">
                        <StoreStamp name={entry.stamp} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="bh-sr-only" aria-live="polite" aria-atomic="true">
                {told &&
                  (activePop.pop.trim() ||
                    "この本のPOPは、まだ書かれていません。")}
              </div>
              {popCandidates.length > 1 && (
                <button
                  type="button"
                  className="bh-pop-page-button"
                  aria-label="次のPOP"
                  disabled={popIndex === popCandidates.length - 1}
                  onClick={() => movePop(1)}
                >
                  <Icon name="arrow" size={17} />
                </button>
              )}
              {popCandidates.length > 1 && (
                <span
                  className="bh-pop-page-count"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {popIndex + 1} / {popCandidates.length}
                </span>
              )}
            </div>
            <div
              className="bh-pop-reactions"
              role="group"
              aria-label="このPOPへのリアクション"
            >
              {POP_REACTIONS.map((reaction) => (
                <button
                  key={reaction}
                  type="button"
                  aria-pressed={popReactions.includes(reaction)}
                  onClick={() => reactToPop(reaction)}
                >
                  <Icon
                    name={
                      reaction === "like"
                        ? "heart"
                        : reaction === "read"
                          ? "book"
                          : "leaf"
                    }
                    size={16}
                  />
                  {/* A narrow button turns its words at these breaks only. */}
                  <span>
                    {reaction === "like" ? (
                      "いいね"
                    ) : reaction === "read" ? (
                      <>
                        読みたく
                        <wbr />
                        なった
                      </>
                    ) : (
                      <>
                        私も
                        <wbr />
                        好き！
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="bh-pop-signature">
              {popOwner && (
                <Link
                  href={profilePath(popOwner.id)}
                  className="bh-owner-link"
                  onNavigate={leaveForPage}
                >
                  <ReaderAvatar reader={popOwner} size={31} />
                  <span>
                    {popOwner.name}
                    <small>店主のプロフィールへ</small>
                  </span>
                  <Icon name="chevron" size={15} />
                </Link>
              )}
              <Link
                href={
                  activePop.legacy
                    ? shopPath(activePop.shopId, activePop.legacy.shelfId)
                    : `/walk/#${encodeURIComponent(activePop.shopId)}`
                }
                className="bh-shop-link"
                onNavigate={leaveForPage}
              >
                {activeShop.name}
              </Link>
            </div>
          </section>

          <BookActions
            book={book}
            state={state}
            actions={actions}
            notify={notify}
          />
          <BookDiscovery
            shop={shop}
            bookId={book.id}
            state={state}
            onSelect={(targetShop, targetShelf, targetItem) => {
              setSceneMode(false);
              setPopPage(null);
              setContext({
                shopId: targetShop.id,
                shelfId: targetShelf.id,
                itemId: targetItem.id,
              });
              contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
              closeButtonRef.current?.focus({ preventScroll: true });
            }}
            onLeave={leaveForPage}
          />
          <Link
            className="bh-work-page"
            href={bookPath(book.id)}
            onNavigate={leaveForPage}
          >
            作品のページを開く <Icon name="arrow" size={16} />
          </Link>
          <span className="bh-cover-note">
            {bookNote(book)}リアクションはこのブラウザに保存されます。
          </span>
        </div>
      </div>

      <nav className="bh-navigation" aria-label="この棚の隣の本へ">
        <button
          type="button"
          className="bh-adjacent"
          disabled={index === 0}
          onClick={() => move(-1)}
          aria-label="前の本"
        >
          <Icon name="back" size={18} />
          <span>前の本</span>
        </button>
        {/* "読みたい" stays in reach here, however far the page has scrolled. */}
        <span className="bh-nav-center">
          <button
            type="button"
            className={"bh-nav-wish" + (wished ? " is-saved" : "")}
            aria-pressed={wished}
            onClick={() => {
              actions.toggleWish(book.id);
              notify(
                wished
                  ? "読みたいリストから外しました"
                  : "読みたい本に入れました",
              );
            }}
          >
            <Icon name={wished ? "check" : "bookmark"} size={15} />
            読みたい
          </button>
          <span className="bh-position" aria-live="polite" aria-atomic="true">
            <span aria-hidden="true">
              {index + 1}
              <i>/</i>
              {availableItems.length}
              <small> · 左右にスワイプ</small>
            </span>
            <span className="bh-sr-only">
              {availableItems.length}冊中{index + 1}冊目、{book.title}
            </span>
          </span>
        </span>
        <button
          type="button"
          className="bh-adjacent"
          disabled={index === availableItems.length - 1}
          onClick={() => move(1)}
          aria-label="次の本"
        >
          <span>次の本</span>
          <Icon name="arrow" size={18} />
        </button>
      </nav>
    </dialog>
  );
}
