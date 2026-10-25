"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  changePlacement,
  insertPlacement,
  migrateShopScene,
  setShopSize,
  takePlacementOff,
} from "../lib/store-customization";
import {
  bookPop,
  objectById,
  unplacedBooks,
  type SceneObject,
  type StoreScene,
} from "../lib/store-scene";
import { CASE_ID, GROW, unpinRow, type ShopSize } from "../lib/growing-shop";
import { saveOwnedScene } from "../lib/walk-store";
import { useBackLayer } from "../lib/back-layer";
import { useBookSearch } from "../lib/search/use-book-search";
import { booksBeforeSearch } from "../lib/book-lists";
import { bookAuthor, bookById, bookTitle } from "../lib/book-name";
import { walkPath } from "../lib/paths";
import {
  SCENE_POP_MAX_LENGTH,
  type Book,
  type Notify,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import { AGAIN, counted, failure, nth } from "../lib/words";
import { StoreCanvas } from "./StoreCanvas";
import { ShopSizeChoices, sizeName } from "./ShopSize";
import { Icon } from "./ui";
import "./walk.css";
import "./scene-editor.css";

type Sheet =
  | { kind: "add" }
  | { kind: "size" }
  | { kind: "waiting" }
  | { kind: "row"; rowId: string }
  | { kind: "book"; id: string; writing?: boolean };

/**
 * 整える: the shop itself is where it is arranged (けにーさん 10-25 「全部ここで
 * できるようにすればいいじゃん！」). The shop fills the screen; books are added,
 * the size chosen and each book turned, given words or taken down from the
 * tools below and the sheet a book opens. Every change is saved at once and
 * 元に戻す takes it back, one step at a time.
 */
export function ShopTidy({
  shop,
  state,
  actions,
  saved,
  ready,
  onClose,
  notify,
}: {
  shop: Shop;
  state: TownState;
  actions: TownActions;
  /** The scene saved for this shop, if it has one. */
  saved: StoreScene | undefined;
  /** The town and the walk are both read, so a save lands on what is known. */
  ready: boolean;
  onClose: () => void;
  notify: Notify;
}) {
  // 戻る closes the screen, as it would a dialog.
  useBackLayer(onClose);
  const scene = useMemo(
    () => migrateShopScene(shop, state.books, saved),
    [shop, state.books, saved],
  );
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [undo, setUndo] = useState<StoreScene[]>([]);
  const [pop, setPop] = useState("");
  const [query, setQuery] = useState("");
  const top = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    top.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
    };
  }, []);

  /** Saves the shop as `next`; the shop as it was waits for 元に戻す. */
  function save(next: StoreScene, said?: string) {
    if (!ready || !saveOwnedScene(next, state).ok) {
      notify(failure({ what: "店を保存できませんでした", next: AGAIN.later }));
      return false;
    }
    setUndo((all) => [...all.slice(-19), scene]);
    if (said) notify(said);
    return true;
  }
  function stepBack() {
    const before = undo.at(-1);
    if (!before) return;
    if (!ready || !saveOwnedScene(before, state).ok) {
      notify(failure({ what: "元に戻せませんでした", next: AGAIN.later }));
      return;
    }
    setUndo((all) => all.slice(0, -1));
    setSheet(null);
  }

  const caseRows = scene.objects
    .filter((o) => o.kind === "row" && o.parentId === CASE_ID)
    .sort((a, b) => a.rect.y - b.rect.y);
  const rowNumber = (rowId: string | null | undefined) =>
    caseRows.findIndex((r) => r.id === rowId) + 1;
  const waiting = unplacedBooks(scene);
  const onShelves = new Set(
    shop.shelves.flatMap((s) => s.items.map((i) => i.bookId)),
  );
  const publicCount = shop.shelves
    .filter((s) => s.isPublic)
    .reduce(
      (n, s) =>
        n + s.items.filter((i) => bookById(state.books, i.bookId)).length,
      0,
    );
  // Books to add: the reader's own first, as every book search finds them.
  const found = useBookSearch(state.books, query, {
    own: state.library,
    limit: 12,
    genreFinds: booksBeforeSearch(state),
  });
  const choices = (
    query.trim()
      ? found.found.map((m) => m.book)
      : state.books.filter((b) => state.library.includes(b.id))
  )
    .filter((b) => !onShelves.has(b.id))
    .slice(0, 12);

  function addBook(book: Book) {
    // The shop shows its public shelves: a book goes on the first with room.
    const shelf = shop.shelves.find(
      (s) => s.isPublic && actions.addShelfBook(s.id, book.id, "spine"),
    );
    if (!shelf) {
      notify(
        failure({
          what: "棚の空きが足りず、並べられませんでした",
          next: "「棚をつくる」で公開の棚を足してください",
        }),
      );
      return;
    }
    notify(`「${bookTitle(book)}」を並べました。`);
  }
  function chooseSize(size: ShopSize) {
    save(
      setShopSize(scene, size, shop, state.books),
      GROW.chosen(sizeName(size)),
    );
  }
  /** Sets a waiting book out again: one of the shelves goes back to the shop
   * to place; one the owner added here goes after the books of a tier. */
  function setOut(p: SceneObject) {
    let next = structuredClone(scene);
    if (p.source) {
      delete objectById(next, p.id)!.held;
      next = migrateShopScene(shop, state.books, next);
    }
    if (!objectById(next, p.id)!.parentId)
      for (const row of caseRows) {
        const trial = insertPlacement(next, p.id, row.id, Infinity);
        if (objectById(trial, p.id)!.parentId) {
          next = trial;
          break;
        }
      }
    if (!objectById(next, p.id)!.parentId) {
      notify(GROW.noRoom);
      return;
    }
    save(next);
  }

  const style = {
    "--walk-wood": scene.theme.wood,
    "--walk-paper": scene.theme.paper,
    "--walk-light": scene.theme.light,
    "--walk-darkness": scene.background.darkness,
  } as CSSProperties;
  const open = (next: Sheet | null) => {
    setSheet(next);
    if (next?.kind === "book") setPop(bookPop(scene, next.id)?.text ?? "");
  };
  const placement =
    sheet?.kind === "book" ? objectById(scene, sheet.id) : undefined;
  const book = bookById(state.books, placement?.bookId);
  const sheetRow =
    sheet?.kind === "row"
      ? objectById(scene, sheet.rowId)
      : placement?.parentId
        ? objectById(scene, placement.parentId)
        : undefined;

  return (
    <div
      className="tidy walk-view"
      role="dialog"
      aria-modal="true"
      aria-label={`${shop.name}を整える`}
      style={style}
    >
      <header className="tidy-top">
        <button
          ref={top}
          type="button"
          className="icon-btn"
          aria-label="閉じる"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        <h2>{shop.name}を整える</h2>
        <Link className="btn fill" href={walkPath("mine")}>
          見る
        </Link>
      </header>
      <div
        className="walk-stage scene-preview tidy-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSheet(null);
        }}
      >
        <div className="walk-artboard" aria-label="店内">
          <StoreCanvas
            scene={scene}
            books={state.books}
            onBook={(p) => open({ kind: "book", id: p.id })}
            onPop={(p) => open({ kind: "book", id: p.id })}
            onZoom={(rowId) => open({ kind: "row", rowId })}
            onLabel={(o) => {
              if (o.kind === "row") open({ kind: "row", rowId: o.id });
            }}
          />
        </div>
      </div>
      {waiting.length > 0 && !sheet && (
        <button
          type="button"
          className="tidy-waiting"
          onClick={() => open({ kind: "waiting" })}
        >
          {GROW.waiting} · {counted(waiting.length, "冊")}
        </button>
      )}
      {sheet && (
        <section className="tidy-sheet" aria-label="選んだもの">
          <button
            type="button"
            className="icon-btn tidy-sheet-close"
            aria-label="閉じる"
            onClick={() => setSheet(null)}
          >
            <Icon name="close" size={18} />
          </button>
          {sheet.kind === "size" && (
            <>
              <h3>{GROW.size}</h3>
              <ShopSizeChoices
                growth={scene.growth}
                bookCount={publicCount}
                disabled={!ready}
                onChoose={chooseSize}
              />
            </>
          )}
          {sheet.kind === "add" && (
            <>
              <h3>本を足す</h3>
              <input
                type="search"
                className="tidy-search"
                value={query}
                placeholder="タイトル・著者"
                aria-label="足す本を探す"
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="tidy-list">
                {choices.map((b) => (
                  <button key={b.id} type="button" onClick={() => addBook(b)}>
                    <span>
                      {bookTitle(b)}
                      <small>{bookAuthor(b)}</small>
                    </span>
                    <Icon name="plus" size={16} />
                  </button>
                ))}
              </div>
              {!choices.length && (
                <p className="shop-size-hint">
                  {query.trim()
                    ? "見つかりませんでした。"
                    : "ライブラリの本は、もう全部並んでいます。題名や著者で探すと、街の本も足せます。"}
                </p>
              )}
            </>
          )}
          {sheet.kind === "waiting" && (
            <>
              <h3>{GROW.waiting}</h3>
              <p className="shop-size-hint">{GROW.waitingHint}</p>
              <div className="tidy-list">
                {waiting.map((p) => (
                  <button key={p.id} type="button" onClick={() => setOut(p)}>
                    <span>
                      {bookTitle(bookById(state.books, p.bookId)!)}
                      <small>
                        {p.isPublic === false ? "非公開" : "並べる"}
                      </small>
                    </span>
                    <Icon name="plus" size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
          {sheet.kind === "row" && sheetRow && (
            <>
              <h3>{nth(rowNumber(sheetRow.id) || 1, "段")}</h3>
              <div className="tidy-list">
                {scene.objects
                  .filter(
                    (o) => o.kind === "book" && o.parentId === sheetRow.id,
                  )
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => open({ kind: "book", id: p.id })}
                    >
                      <span>
                        {bookTitle(bookById(state.books, p.bookId)!)}
                        <small>
                          {p.display === "face" ? "表紙" : "背表紙"}
                        </small>
                      </span>
                      <Icon name="chevron" size={16} />
                    </button>
                  ))}
              </div>
            </>
          )}
          {sheet.kind === "book" && placement && book && (
            <>
              <h3 className="tidy-title">{bookTitle(book)}</h3>
              <p className="tidy-sub">{bookAuthor(book)}</p>
              {placement.parentId && (
                <div className="tidy-seg" role="group" aria-label="見せ方">
                  {(["face", "spine"] as const).map((display) => (
                    <button
                      key={display}
                      type="button"
                      aria-pressed={placement.display === display}
                      onClick={() =>
                        placement.display !== display &&
                        save(
                          changePlacement(
                            scene,
                            placement.id,
                            { display },
                            state.books,
                          ),
                        )
                      }
                    >
                      {display === "face" ? "表紙を見せる" : "背表紙を見せる"}
                    </button>
                  ))}
                </div>
              )}
              {sheet.writing ? (
                <div className="tidy-pop">
                  <textarea
                    value={pop}
                    maxLength={SCENE_POP_MAX_LENGTH}
                    rows={3}
                    autoFocus
                    aria-label="この本のPOP"
                    placeholder="この一冊を、誰かに手渡すなら。"
                    onChange={(e) => setPop(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn fill"
                    onClick={() =>
                      save(
                        changePlacement(
                          scene,
                          placement.id,
                          { pop },
                          state.books,
                        ),
                        "POPを書きました。",
                      ) && setSheet({ kind: "book", id: placement.id })
                    }
                  >
                    POPを置く
                  </button>
                </div>
              ) : (
                <div className="tidy-acts">
                  <button
                    type="button"
                    onClick={() =>
                      setSheet({
                        kind: "book",
                        id: placement.id,
                        writing: true,
                      })
                    }
                  >
                    <Icon name="pen" size={18} />
                    {bookPop(scene, placement.id)?.text
                      ? "POPを直す"
                      : "POPを書く"}
                  </button>
                  {placement.parentId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          save(
                            takePlacementOff(scene, placement.id),
                            "棚から下ろしました。「まだ並べていない本」で待っています。",
                          )
                        )
                          setSheet(null);
                      }}
                    >
                      <Icon name="move" size={18} />
                      棚から下ろす
                    </button>
                  ) : (
                    <button type="button" onClick={() => setOut(placement)}>
                      <Icon name="plus" size={18} />
                      並べる
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {sheetRow?.pinned &&
            (sheet.kind === "row" ||
              (sheet.kind === "book" && !sheet.writing)) && (
              <div className="scene-pinned">
                <p className="scene-hint">
                  <Icon name="pin" size={14} />
                  {GROW.pinned}
                </p>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    save(
                      migrateShopScene(
                        shop,
                        state.books,
                        unpinRow(scene, sheetRow.id),
                      ),
                    );
                    setSheet(null);
                  }}
                >
                  {GROW.unpin}
                </button>
              </div>
            )}
        </section>
      )}
      <nav className="tidy-tools" aria-label="整える道具">
        <button
          type="button"
          aria-pressed={sheet?.kind === "add"}
          onClick={() => open(sheet?.kind === "add" ? null : { kind: "add" })}
        >
          <Icon name="plus" />
          本を足す
        </button>
        <button
          type="button"
          aria-pressed={sheet?.kind === "size"}
          onClick={() => open(sheet?.kind === "size" ? null : { kind: "size" })}
        >
          <Icon name="rows" />
          {GROW.size}
        </button>
        <button type="button" disabled={!undo.length} onClick={stepBack}>
          <Icon name="back" />
          元に戻す
        </button>
      </nav>
    </div>
  );
}
