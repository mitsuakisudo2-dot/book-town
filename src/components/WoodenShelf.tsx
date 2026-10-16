"use client";
import type { CSSProperties, ReactNode, Ref } from "react";
import type { Book, Shelf, ShelfItem } from "../lib/types";
import { BookJacket, Icon } from "./ui";

type Props = {
  shelf: Shelf;
  books: Book[];
  onSelect?: (item: ShelfItem) => void;
  selectedId?: string;
};
/**
 * A shelf to look at. The one the owner rearranges is SortableShelf.tsx, so
 * the pages that only show shelves (Home among them) do not load the drag
 * and drop.
 */
export function WoodenShelf({ shelf, books, onSelect, selectedId }: Props) {
  return (
    <ShelfRow
      shelf={shelf}
      books={books}
      book={(item, book) => (
        <ShelfBook
          key={item.id}
          item={item}
          book={book}
          selected={selectedId === item.id}
          onSelect={() => onSelect?.(item)}
        />
      )}
    />
  );
}

/** The shelf around its books, each drawn by `book`. */
export function ShelfRow({
  shelf,
  books,
  book: drawBook,
}: {
  shelf: Shelf;
  books: Book[];
  book: (item: ShelfItem, book: Book) => ReactNode;
}) {
  return (
    <div className="shelf-scroll" aria-label={shelf.name + "の書棚"}>
      <div className="shelf-back">
        <div className="shelf-books-row">
          {shelf.items.map((item) => {
            const b = books.find((book) => book.id === item.bookId);
            return b ? drawBook(item, b) : null;
          })}
          {!shelf.items.length && (
            <div className="shelf-blank">
              <Icon name="book" size={23} />
              <span>最初の一冊を、ここに。</span>
            </div>
          )}
          <div className="shelf-bookend" />
        </div>
        <div className="shelf-plank">
          <span>{shelf.name}</span>
          <i />
        </div>
      </div>
    </div>
  );
}

/** One book on a shelf. `drag` carries what the sortable shelf adds. */
export function ShelfBook({
  item,
  book,
  selected,
  onSelect,
  drag,
}: {
  item: ShelfItem;
  book: Book;
  selected: boolean;
  onSelect: () => void;
  drag?: {
    ref: Ref<HTMLDivElement>;
    style: CSSProperties;
    dragging: boolean;
    handle: object;
  };
}) {
  const editing = drag !== undefined;
  const h = book.height > 80 ? book.height : 140;
  const thickness =
    book.thickness > 10 ? book.thickness : Math.round(28 * book.thickness);
  const style = {
    ...drag?.style,
    "--book-height": h + "px",
    "--book-thickness": Math.max(20, Math.min(thickness, 38)) + "px",
    "--book-color": book.color,
    "--book-ink": book.ink,
  } as CSSProperties;
  return (
    <div
      ref={drag?.ref}
      style={style}
      className={`shelf-book ${item.display} ${selected ? "is-selected" : ""} ${drag?.dragging ? "is-dragging" : ""}`}
      data-item-id={item.id}
      data-display={item.display}
    >
      <button
        {...drag?.handle}
        onClick={onSelect}
        className="shelf-book-button"
        aria-label={`${book.title} · ${item.display === "face" ? "面陳" : "背表紙"}${item.pop ? " · POPあり" : ""}${editing ? " · 編集する" : ""}`}
      >
        {item.display === "face" ? (
          <BookJacket book={book} />
        ) : (
          <span className={"book-spine pattern-" + (book.pattern % 3)}>
            <span className="spine-cap" />
            <span className="spine-title">{book.title}</span>
            <span className="spine-author">{book.author}</span>
            <span className="spine-mark">本</span>
          </span>
        )}
        {item.pop && <span className="pop-marker">POP</span>}
        {editing && (
          <span className="book-grip">
            <Icon name="grip" size={13} />
          </span>
        )}
      </button>
    </div>
  );
}
