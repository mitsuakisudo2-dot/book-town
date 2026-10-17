"use client";
import { useState } from "react";
import { Icon, Modal } from "./ui";
import { StoreBook } from "./StoreCanvas";
import {
  objectById,
  type SceneObject,
  type StoreScene,
} from "../lib/store-scene";
import type { Book } from "../lib/types";
export function ShelfZoom({
  scene,
  rowId,
  books,
  onClose,
  onBook,
  initialId,
}: {
  scene: StoreScene;
  rowId: string;
  books: Book[];
  onClose: () => void;
  onBook: (p: SceneObject) => void;
  initialId?: string;
}) {
  const row = objectById(scene, rowId)!;
  const items = scene.objects
    .filter((o) => o.kind === "book" && o.parentId === rowId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const [page, setPage] = useState(() =>
    Math.max(0, Math.floor(items.findIndex((p) => p.id === initialId) / 5)),
  );
  const shown = items.slice(page * 5, page * 5 + 5);
  return (
    <Modal title={row.text ?? "棚に近づく"} onClose={onClose} wide>
      <p className="muted">
        背表紙を眺めて、気になる一冊を手に取ってください。
      </p>
      <div className="walk-close-shelf">
        {shown.map((p) => {
          const book = books.find((b) => b.id === p.bookId);
          return book ? (
            <button
              key={p.id}
              aria-label={book.title + "を手に取る"}
              onClick={() => onBook(p)}
              className={"walk-close-book is-" + p.display}
            >
              <StoreBook book={book} display={p.display} />
            </button>
          ) : null;
        })}
      </div>
      <div className="walk-zoom-nav">
        <button
          className="btn"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
          aria-label="段の左側を見る"
        >
          <Icon name="back" />
          左へ
        </button>
        <span>同じ段を眺めています</span>
        <button
          className="btn"
          disabled={(page + 1) * 5 >= items.length}
          onClick={() => setPage(page + 1)}
          aria-label="段の右側を見る"
        >
          右へ
          <Icon name="arrow" />
        </button>
      </div>
    </Modal>
  );
}
