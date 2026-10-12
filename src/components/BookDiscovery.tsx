"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ME_ID,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownState,
} from "../lib/types";
import { BookJacket, Icon } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { BookPrice } from "./BookActions";
import { shopPath } from "../lib/paths";

function BookRail({
  title,
  children,
  kind,
}: {
  title: string;
  children: ReactNode;
  kind: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: true, right: false });
  function measure() {
    const node = ref.current;
    if (node)
      setEdges({
        left: node.scrollLeft < 2,
        right: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2,
      });
  }
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function scroll(direction: number) {
    const node = ref.current;
    node?.scrollBy({
      left: direction * node.clientWidth * 0.85,
      behavior: "smooth",
    });
  }
  return (
    <section className={`bh-discovery bh-discovery-${kind}`} aria-label={title}>
      <div className="bh-section-heading">
        <h3>{title}</h3>
        <div className="bh-rail-controls">
          <button
            aria-label={`${title}の左側を見る`}
            disabled={edges.left}
            onClick={() => scroll(-1)}
          >
            <Icon name="back" size={16} />
          </button>
          <button
            aria-label={`${title}の右側を見る`}
            disabled={edges.right}
            onClick={() => scroll(1)}
          >
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        data-book-rail
        className="bh-inline-rail"
        tabIndex={0}
        role="region"
        aria-label={`${title}、横にスクロールできます`}
        onScroll={measure}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            scroll(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function BookDiscovery({
  shop,
  bookId,
  state,
  onSelect,
  onLeave,
}: {
  shop: Shop;
  bookId: string;
  state: TownState;
  onSelect: (shop: Shop, shelf: Shelf, item: ShelfItem) => void;
  /** Called when a link leaves the open book for another page. */
  onLeave?: () => void;
}) {
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  // Shelves express a selection, not a reading status. Never imply these books were read.
  const seen = new Set([bookId]);
  const choices = shop.shelves
    .filter((shelf) => shelf.isPublic)
    .flatMap((shelf) =>
      shelf.items.flatMap((item) => {
        if (seen.has(item.bookId)) return [];
        const book = state.books.find((entry) => entry.id === item.bookId);
        if (!book) return [];
        seen.add(book.id);
        return [{ book, shelf, item }];
      }),
    );
  const otherShelves = [
    ...state.shops,
    ...(state.ownShop ? [state.ownShop] : []),
  ]
    .filter((other) => other.id !== shop.id)
    .flatMap((other) =>
      other.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) => {
          const item = shelf.items.find((entry) => entry.bookId === bookId);
          return item ? [{ shop: other, shelf, item }] : [];
        }),
    );
  return (
    <>
      {choices.length > 0 && (
        <BookRail title="この店主が選んだ、ほかの一冊" kind="books">
          {choices.map(({ book, shelf, item }) => (
            <button
              className="bh-choice-book"
              key={book.id}
              onClick={() => onSelect(shop, shelf, item)}
              aria-label={`${book.title}をこの場で手に取る`}
            >
              <BookJacket book={book} />
              <strong>{book.title}</strong>
              <small>{book.author}</small>
              <BookPrice book={book} compact />
              <span>{shelf.name}</span>
            </button>
          ))}
        </BookRail>
      )}
      <section
        className="bh-discovery bh-discovery-shops"
        aria-label="この本を並べるほかの書店"
      >
        <div className="bh-section-heading">
          <h3>この本を並べるほかの書店</h3>
        </div>
        {otherShelves.length ? (
          <div className="bh-shop-list">
            {otherShelves
              .slice(0, expandedBookId === bookId ? undefined : 3)
              .map(({ shop: other, shelf, item }) => (
                <article
                  className={`bh-shop-card theme-${other.theme}`}
                  key={`${other.id}-${shelf.id}`}
                >
                  <div className="bh-shop-card-heading">
                    <div>
                      {other.demo ? (
                        <small>見本の書店</small>
                      ) : other.ownerId === ME_ID ? (
                        <small>あなたの書店</small>
                      ) : null}
                      <h4>
                        <Link
                          href={shopPath(other.id, shelf.id)}
                          onNavigate={onLeave}
                        >
                          {other.name}
                        </Link>
                      </h4>
                      <p>{shelf.name}</p>
                    </div>
                    <Link
                      className="bh-shop-pop-button"
                      href={shopPath(other.id, shelf.id)}
                      onNavigate={onLeave}
                    >
                      この書店へ <Icon name="arrow" size={16} />
                    </Link>
                  </div>
                  <div data-book-rail>
                    <WoodenShelf
                      shelf={shelf}
                      books={state.books}
                      selectedId={item.id}
                      onSelect={(selected) => onSelect(other, shelf, selected)}
                    />
                  </div>
                  <blockquote>
                    {item.pop || "この棚のPOPは、これから。"}
                  </blockquote>
                </article>
              ))}
          </div>
        ) : (
          <p className="bh-discovery-empty">
            いま、この本を並べているほかの書店はありません。
          </p>
        )}
        {otherShelves.length > 3 && (
          <button
            className="bh-shops-more"
            aria-expanded={expandedBookId === bookId}
            onClick={() =>
              setExpandedBookId(expandedBookId === bookId ? null : bookId)
            }
          >
            {expandedBookId === bookId
              ? "3件に戻す"
              : `ほかの書店も見る（残り${otherShelves.length - 3}件）`}
          </button>
        )}
      </section>
    </>
  );
}
