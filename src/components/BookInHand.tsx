"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type TouchEvent } from "react";
import {
  POP_REACTIONS,
  popReactionKey,
  type Shelf,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import { BookActions, BookPrice, BookPurchase, bookNote } from "./BookActions";
import { BookDiscovery } from "./BookDiscovery";
import "./book-in-hand.css";

type BookInHandProps = {
  shop: Shop;
  shelf: Shelf;
  itemId: string;
  state: TownState;
  actions: TownActions;
  onClose: () => void;
  notify: (message: string) => void;
};

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
}: BookInHandProps) {
  const [context, setContext] = useState({
    shopId: sourceShop.id,
    shelfId: sourceShelf.id,
    itemId,
  });
  const shop =
    [...state.shops, ...(state.ownShop ? [state.ownShop] : [])].find(
      (entry) => entry.id === context.shopId,
    ) ?? sourceShop;
  const shelf =
    shop.shelves.find((entry) => entry.id === context.shelfId) ?? sourceShelf;
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
  const availableItems = shelf.items.filter((item) =>
    state.books.some((book) => book.id === item.bookId),
  );
  const index = Math.max(
    0,
    availableItems.findIndex((item) => item.id === selectedId),
  );
  const item = availableItems[index];
  const book = state.books.find((entry) => entry.id === item?.bookId);
  const owner =
    shop.ownerId === state.me.id
      ? state.me
      : state.readers.find((reader) => reader.id === shop.ownerId);
  const reactionKey = item ? popReactionKey(shop.id, shelf.id, item.id) : "";
  const reactions = state.popReactions[reactionKey] ?? [];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const position = { x: window.scrollX, y: window.scrollY };
    const bodyStyle = document.body.style;
    const previousBody = {
      overflow: bodyStyle.overflow,
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width,
    };

    // A modal native dialog makes the rest of the document inert, including AT.
    // Fixing the body also prevents the underlying street moving on mobile Safari.
    bodyStyle.overflow = "hidden";
    bodyStyle.position = "fixed";
    bodyStyle.top = `-${position.y}px`;
    bodyStyle.left = `-${position.x}px`;
    bodyStyle.right = "0";
    bodyStyle.width = "100%";
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      Object.assign(bodyStyle, previousBody);
      if (restoreViewportRef.current) {
        window.scrollTo({
          left: position.x,
          top: position.y,
          behavior: "instant",
        });
        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus({ preventScroll: true });
        }
      }
    };
  }, []);

  function move(direction: -1 | 1) {
    const next = availableItems[index + direction];
    if (!next) return;
    setContext({ shopId: shop.id, shelfId: shelf.id, itemId: next.id });
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  function leaveForPage() {
    // Next.js owns the destination page's scroll; only closing returns to the shelf.
    restoreViewportRef.current = false;
    onClose();
  }

  function startTouch(event: TouchEvent<HTMLDivElement>) {
    if (
      event.touches.length !== 1 ||
      (event.target as HTMLElement).closest(
        "button,a,input,textarea,select,summary,[data-book-rail]",
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
      if ((event.target as HTMLElement).closest("[data-book-rail]")) return;
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
          setContext({ shopId: shop.id, shelfId: shelf.id, itemId: next.id });
          content.scrollTo({ top: 0, behavior: "instant" });
        }
      }
    };
    content.addEventListener("wheel", wheel, { passive: false });
    return () => content.removeEventListener("wheel", wheel);
  }, [shop.id, shelf.id, availableItems, index]);

  if (!book || !item) return null;

  return (
    <dialog
      ref={dialogRef}
      className="bh-dialog"
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
          <span>{shelf.name}</span>
        </span>
        <button
          type="button"
          ref={closeButtonRef}
          className="bh-close"
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
              href={`/books/${book.id}/`}
              onNavigate={leaveForPage}
              aria-label={`${book.title}の作品ページへ`}
            >
              <BookJacket book={book} />
            </Link>
            <div className="bh-book-heading">
              <span className="bh-genre">{book.genre}</span>
              <h2 id={titleId}>{book.title}</h2>
              <p className="bh-author">{book.author}</p>
              <BookPrice book={book} />
              <BookPurchase book={book} />
            </div>
          </div>

          <section className="bh-summary" aria-label="あらすじ">
            <h3>あらすじ</h3>
            <p>{book.summary}</p>
          </section>

          <section className="bh-pop owner-pop" aria-label="この棚の店主のPOP">
            <div className="bh-pop-label">
              <span>この棚に並べた人の言葉</span>
              {shop.demo && <small>デモ</small>}
            </div>
            {item.pop ? (
              <p className="bh-pop-text">{item.pop}</p>
            ) : (
              <p className="bh-pop-empty">
                この本のPOPは、まだ書かれていません。
              </p>
            )}
            <div
              className="bh-pop-reactions"
              role="group"
              aria-label="このPOPへのリアクション"
            >
              {POP_REACTIONS.map((reaction) => (
                <button
                  key={reaction}
                  type="button"
                  aria-pressed={reactions.includes(reaction)}
                  onClick={() =>
                    actions.togglePopReaction(
                      shop.id,
                      shelf.id,
                      item.id,
                      reaction,
                    )
                  }
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
                  {reaction === "like"
                    ? "いいね"
                    : reaction === "read"
                      ? "読む！"
                      : "私も好き！"}
                </button>
              ))}
            </div>
            <div className="bh-pop-signature">
              {owner && (
                <Link
                  href={`/profiles/${owner.id}/`}
                  className="bh-owner-link"
                  onNavigate={leaveForPage}
                >
                  <ReaderAvatar reader={owner} size={31} />
                  <span>
                    {owner.name}
                    <small>店主のプロフィールへ</small>
                  </span>
                  <Icon name="chevron" size={15} />
                </Link>
              )}
              <Link
                href={`/shops/${shop.id}/#shelf-${shelf.id}`}
                className="bh-shop-link"
                onNavigate={leaveForPage}
              >
                {shop.name}
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
            href={`/books/${book.id}/`}
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
        <span className="bh-position" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">
            {index + 1}
            <i>/</i>
            {availableItems.length}
          </span>
          <span className="bh-sr-only">
            {availableItems.length}冊中{index + 1}冊目、{book.title}
          </span>
          <small aria-hidden="true">左右にスワイプ · 棚の順に</small>
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
