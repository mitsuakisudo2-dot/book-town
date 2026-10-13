"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  POP_MAX_LENGTH,
  SHELF_NAME_MAX_LENGTH,
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_TAGLINE_MAX_LENGTH,
  ownTagline,
  type Book,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownState,
  type TownActions,
} from "../lib/types";
import { shelfUsed, usePersistenceStatus, useTownBackend } from "../lib/store";
import { shelfSaveMessage } from "../lib/persistence";
import { bookPath } from "../lib/books";
import { profilePath } from "../lib/paths";
import { findReader } from "../lib/social";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { StoreSceneEditor } from "./StoreSceneEditor";
import { useWalkStore } from "../lib/walk-store";
import { hasPublicSceneBooks } from "../lib/store-customization";
import { publicWalkShops } from "../lib/store-scene-adapter";
import { OpenShop, ThemePicker } from "./OpenShop";
import { enterPressed, useBookSearch } from "../lib/search/use-book-search";
import { booksBeforeSearch } from "../lib/book-lists";
import "./editor.css";

type ShopEditorProps = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

function ShopSettings({
  shop,
  actions,
  notify,
}: { shop: Shop } & Pick<ShopEditorProps, "actions" | "notify">) {
  const [name, setName] = useState(shop.name);
  const [description, setDescription] = useState(shop.description);
  const [tagline, setTagline] = useState(ownTagline(shop));
  const [theme, setTheme] = useState<Shop["theme"]>(shop.theme);
  const settings = useRef<HTMLDetailsElement>(null);
  // The walk's "write your words" card opens these settings at the field.
  useEffect(() => {
    if (location.hash !== "#shop-words" || !settings.current) return;
    settings.current.open = true;
    settings.current.scrollIntoView({ block: "center" });
    settings.current
      .querySelector<HTMLInputElement>("input[name=tagline]")
      ?.focus({ preventScroll: true });
  }, []);
  const dirty =
    name !== shop.name ||
    description !== shop.description ||
    tagline !== ownTagline(shop) ||
    theme !== shop.theme;
  return (
    <details className="editor-settings" id="shop-words" ref={settings}>
      <summary>
        <span>
          <Icon name="edit" size={17} />
          書店の看板と紹介
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          actions.updateShop({
            name: name.trim(),
            description: description.trim(),
            tagline: tagline.trim(),
            theme,
          });
          setName(name.trim());
          setDescription(description.trim());
          setTagline(tagline.trim());
          notify("書店の看板と紹介を変更しました。");
        }}
      >
        <div className="editor-settings-fields">
          <label className="editor-label">
            書店の名前
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={SHOP_NAME_MAX_LENGTH}
              required
            />
          </label>
          <label className="editor-label">
            ひとこと
            <input
              name="tagline"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              maxLength={SHOP_TAGLINE_MAX_LENGTH}
              placeholder="この書店を表す、ひとこと。"
            />
          </label>
          <label className="editor-label editor-wide-field">
            書店の紹介
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={SHOP_DESCRIPTION_MAX_LENGTH}
              rows={3}
              placeholder="訪れた読者に、あなたの書店を紹介しましょう。"
            />
          </label>
          <div className="editor-label">
            看板の色
            <ThemePicker value={theme} onChange={setTheme} />
          </div>
          <div className="editor-settings-save">
            <button
              className="editor-button primary"
              disabled={!name.trim() || !dirty}
              type="submit"
            >
              <Icon name="check" size={16} />
              変更を保存
            </button>
          </div>
        </div>
      </form>
    </details>
  );
}

function AddBookPicker({
  shelf,
  books,
  shown,
  library,
  actions,
  notify,
  onClose,
}: {
  shelf: Shelf;
  books: Book[];
  /**
   * The books offered before anything is typed, and the only ones a genre
   * finds (booksBeforeSearch).
   */
  shown: Book[];
  /** The reader's own books: first among equal matches. */
  library: string[];
  onClose: () => void;
} & Pick<ShopEditorProps, "actions" | "notify">) {
  const [search, setSearch] = useState("");
  const results = useBookSearch(books, search, {
    own: library,
    limit: books.length,
    genreFinds: shown,
  });
  const [display, setDisplay] = useState<ShelfItem["display"]>("spine");
  // What this visit changed, for the running tally at the bottom.
  const [addedHere, setAddedHere] = useState<string[]>([]);
  // Books taken off here keep their display, POP and place, so a second tap puts them back.
  const [removedHere, setRemovedHere] = useState<
    Record<
      string,
      { display: ShelfItem["display"]; pop: string; index: number }
    >
  >({});
  const removedCount = Object.keys(removedHere).length;
  const remaining = shelf.capacity - shelfUsed(shelf);
  const cost = display === "face" ? 3 : 1;
  // Until something is typed, the books a list may show (and any taken off
  // here, to put back); then the matches among every book, best first, and
  // titles only close in spelling under their own quiet heading.
  const searching = search.trim() !== "";
  const shownIds = new Set(shown.map((book) => book.id));
  const filtered = searching
    ? results.found.map((match) => match.book)
    : books.filter((book) => shownIds.has(book.id) || removedHere[book.id]);
  const near = searching ? results.near.map((match) => match.book) : [];

  function choose(book: Book) {
    const placed = shelf.items.find((item) => item.bookId === book.id);
    const justAdded = addedHere.includes(book.id);
    const taken = removedHere[book.id];
    if (placed) {
      actions.removeShelfBook(shelf.id, placed.id);
      if (justAdded) setAddedHere(addedHere.filter((id) => id !== book.id));
      else
        setRemovedHere({
          ...removedHere,
          [book.id]: {
            display: placed.display,
            pop: placed.pop,
            index: shelf.items.indexOf(placed),
          },
        });
      notify(
        placed.pop.trim() && !justAdded
          ? `「${book.title}」を外しました。もう一度押すとPOPごと戻せます。`
          : `「${book.title}」を棚から外しました。`,
      );
    } else if (taken) {
      if (
        actions.addShelfBook(shelf.id, book.id, taken.display, {
          pop: taken.pop,
          index: taken.index,
        })
      ) {
        const rest = { ...removedHere };
        delete rest[book.id];
        setRemovedHere(rest);
        notify(`「${book.title}」を元の場所に戻しました。`);
      } else notify("棚の空きスペースが足りず、戻せませんでした。");
    } else if (actions.addShelfBook(shelf.id, book.id, display)) {
      // The editor stays open so several books can be placed in a row.
      setAddedHere([...addedHere, book.id]);
      notify(`「${book.title}」を本棚に並べました。`);
    } else {
      notify("棚の空きスペースが足りません。並べ方を変えてみてください。");
    }
  }

  const choice = (book: Book) => {
    const placed = shelf.items.find((item) => item.bookId === book.id);
    const justAdded = addedHere.includes(book.id);
    const taken = removedHere[book.id];
    const needed = taken ? (taken.display === "face" ? 3 : 1) : cost;
    return (
      <button
        className={"editor-book-choice" + (placed ? " is-added" : "")}
        key={book.id}
        type="button"
        aria-pressed={Boolean(placed)}
        disabled={!placed && needed > remaining}
        onClick={() => choose(book)}
      >
        <BookJacket book={book} className="editor-picker-jacket" />
        <span className="editor-book-choice-title">{book.title}</span>
        <span className="editor-book-choice-author">{book.author}</span>
        <span className="editor-book-choice-add">
          {placed ? (
            <>
              <Icon name="check" size={14} />
              {justAdded
                ? "並べました"
                : placed.pop.trim()
                  ? "POPあり"
                  : "棚にあります"}
              ・押すと外す
            </>
          ) : taken ? (
            <>
              <Icon name="back" size={14} />
              外しました・押すと戻す
            </>
          ) : (
            <>
              <Icon name="plus" size={14} />
              棚に並べる
            </>
          )}
        </span>
      </button>
    );
  };

  return (
    <Modal title="本棚を編集" onClose={onClose} wide>
      <div className="editor-book-picker">
        <p className="editor-picker-context">
          「{shelf.name}」には、あと <strong>{remaining} スペース</strong>{" "}
          並べられます。
        </p>
        <label className="editor-search-field">
          <Icon name="search" size={18} />
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // The Enter that confirms a kana conversion is the keyboard's.
              if (!enterPressed(event)) return;
              event.preventDefault();
              // Enter places a book only when it is surely the one meant, and
              // never takes one off the shelf.
              const sure = results.sure();
              if (!sure || shelf.items.some((item) => item.bookId === sure.id))
                return;
              choose(sure);
              setSearch("");
            }}
            placeholder="タイトル、著者、ジャンルで探す"
            aria-label="追加する本を検索"
          />
        </label>
        <div className="editor-picker-display">
          <span>並べ方</span>
          <div
            className="editor-segment"
            role="group"
            aria-label="追加する本の表示方法"
          >
            <button
              type="button"
              className={display === "spine" ? "is-active" : ""}
              aria-pressed={display === "spine"}
              onClick={() => setDisplay("spine")}
            >
              背表紙 <small>1スペース</small>
            </button>
            <button
              type="button"
              className={display === "face" ? "is-active" : ""}
              aria-pressed={display === "face"}
              onClick={() => setDisplay("face")}
            >
              面陳 <small>3スペース</small>
            </button>
          </div>
        </div>
        {cost > remaining && (
          <p className="editor-capacity-warning" role="status">
            空きスペースが足りません。背表紙で並べるか、棚を整理してください。
          </p>
        )}
        {filtered.length > 0 && (
          <div className="editor-picker-grid">{filtered.map(choice)}</div>
        )}
        {!searching && filtered.length === 0 && (
          <div className="editor-empty-search">
            <Icon name="book" size={28} />
            <p>題名や著者で、並べる本を探してください。</p>
          </div>
        )}
        {searching && results.settled && filtered.length === 0 && (
          <div className="editor-empty-search">
            <Icon name="book" size={28} />
            <p>
              {near.length
                ? "ぴったり合う本はありませんでした。"
                : "この言葉に合う本は見つかりませんでした。"}
            </p>
            <button
              type="button"
              className="editor-text-button"
              onClick={() => setSearch("")}
            >
              検索をやめる
            </button>
          </div>
        )}
        {near.length > 0 && (
          <>
            <h3 className="search-near" id="editor-near-title">
              {results.nearHeading}
            </h3>
            <div
              className="editor-picker-grid"
              role="group"
              aria-labelledby="editor-near-title"
            >
              {near.map(choice)}
            </div>
          </>
        )}
        <div className="editor-picker-footer">
          <span role="status">
            {addedHere.length || removedCount
              ? "この画面で" +
                [
                  addedHere.length ? `${addedHere.length}冊並べました` : "",
                  removedCount ? `${removedCount}冊外しました` : "",
                ]
                  .filter(Boolean)
                  .join("・")
              : "押すたびに、並べる・外すを切り替えられます"}
          </span>
          <button type="button" className="button" onClick={onClose}>
            完了
          </button>
        </div>
        <p className="editor-field-note">
          サンプルの書籍と、デモ用のオリジナル装丁を使用しています。
        </p>
      </div>
    </Modal>
  );
}

function ShelfEditingPanel({
  shelf,
  books,
  actions,
  notify,
  onAdd,
  onRemove,
}: {
  shelf: Shelf;
  books: Book[];
  onAdd: () => void;
  onRemove: () => void;
} & Pick<ShopEditorProps, "actions" | "notify">) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shelfName, setShelfName] = useState(shelf.name);
  const selected = shelf.items.find((item) => item.id === selectedId) ?? null;
  const selectedBook = books.find((book) => book.id === selected?.bookId);
  const used = shelfUsed(shelf);
  const remaining = shelf.capacity - used;
  const selectedIndex = selected
    ? shelf.items.findIndex((item) => item.id === selected.id)
    : -1;
  const canFace = !selected || selected.display === "face" || remaining >= 2;
  return (
    <section className="editor-shelf-panel" id={`edit-shelf-${shelf.id}`}>
      <div className="editor-shelf-heading">
        <div className="editor-shelf-title-wrap">
          <span className="editor-shelf-number">
            <Icon name="book" size={18} />
          </span>
          <label className="editor-shelf-name-label">
            <span className="sr-only">本棚の名前</span>
            <input
              value={shelfName}
              onChange={(event) => setShelfName(event.target.value)}
              maxLength={SHELF_NAME_MAX_LENGTH}
              onBlur={() => {
                const nextName = shelfName.trim() || shelf.name;
                setShelfName(nextName);
                if (nextName !== shelf.name)
                  actions.updateShelf(shelf.id, { name: nextName });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="本棚の名前"
              aria-label="本棚の名前"
            />
          </label>
        </div>
        <div className="editor-shelf-heading-actions">
          <button
            type="button"
            className={`editor-privacy ${shelf.isPublic ? "" : "is-private"}`}
            onClick={() =>
              actions.updateShelf(shelf.id, { isPublic: !shelf.isPublic })
            }
            aria-label={
              shelf.isPublic ? "本棚を非公開にする" : "本棚を公開する"
            }
          >
            <Icon name={shelf.isPublic ? "eye" : "lock"} size={15} />
            {shelf.isPublic ? "公開" : "非公開"}
          </button>
          <button
            type="button"
            className="editor-icon-button subtle"
            aria-label={`「${shelf.name}」を削除`}
            onClick={onRemove}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      </div>
      <div className="editor-space-row">
        <span>
          棚のスペース <strong>{used}</strong>
          <span className="editor-capacity-total"> / {shelf.capacity}</span>
        </span>
        <span className={remaining === 0 ? "editor-full-shelf" : ""}>
          {remaining === 0 ? "この棚は満席です" : `あと ${remaining} スペース`}
        </span>
      </div>
      <div
        className="editor-capacity-track"
        role="meter"
        aria-label={`${shelf.name}の使用スペース`}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={shelf.capacity}
      >
        <span
          style={{ width: `${Math.min(100, (used / shelf.capacity) * 100)}%` }}
        />
      </div>
      <WoodenShelf
        shelf={shelf}
        books={books}
        editing
        selectedId={selected?.id}
        onSelect={(item) => setSelectedId(item.id)}
        onReorder={(activeId, overId) => {
          const targetIndex = shelf.items.findIndex(
            (item) => item.id === overId,
          );
          if (targetIndex >= 0 && activeId !== overId) {
            actions.moveShelfBook(shelf.id, activeId, targetIndex);
            setSelectedId(activeId);
          }
        }}
      />
      <div className="editor-shelf-below">
        <p>
          <Icon name="grip" size={14} />
          本を選んで編集。ドラッグでも並び替えられます。
        </p>
        <button
          type="button"
          className="editor-button secondary"
          onClick={onAdd}
        >
          <Icon name="edit" size={17} />
          本棚を編集
        </button>
      </div>
      {selected && selectedBook && (
        <div className="editor-selected-book">
          <div className="editor-selected-heading">
            <div>
              <span className="editor-kicker">いま編集している本</span>
              <h3>{selectedBook.title}</h3>
              <p>{selectedBook.author}</p>
            </div>
            <button
              className="editor-icon-button"
              type="button"
              aria-label="本の編集を閉じる"
              onClick={() => setSelectedId(null)}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="editor-selected-controls">
            <div className="editor-control-group">
              <span className="editor-control-label">並べ方</span>
              <div
                className="editor-segment"
                role="group"
                aria-label={`${selectedBook.title}の並べ方`}
              >
                <button
                  type="button"
                  className={selected.display === "spine" ? "is-active" : ""}
                  aria-pressed={selected.display === "spine"}
                  onClick={() => {
                    if (actions.changeDisplay(shelf.id, selected.id, "spine"))
                      notify("背表紙で並べました。");
                  }}
                >
                  背表紙 <small>1</small>
                </button>
                <button
                  type="button"
                  className={selected.display === "face" ? "is-active" : ""}
                  aria-pressed={selected.display === "face"}
                  disabled={!canFace}
                  title={
                    !canFace
                      ? "面陳にするには、あと2スペース必要です。"
                      : undefined
                  }
                  onClick={() => {
                    if (actions.changeDisplay(shelf.id, selected.id, "face"))
                      notify("表紙が見えるように並べました。");
                    else notify("面陳にするには、あと2スペース必要です。");
                  }}
                >
                  面陳 <small>3</small>
                </button>
              </div>
              {!canFace && (
                <span className="editor-control-note">
                  面陳には、あと2スペース必要です。
                </span>
              )}
            </div>
            <div className="editor-control-group">
              <span className="editor-control-label">並び順</span>
              <div className="editor-move-buttons">
                <button
                  type="button"
                  className="editor-button secondary"
                  aria-label={`${selectedBook.title}を一つ左へ移動`}
                  disabled={selectedIndex <= 0}
                  onClick={() =>
                    actions.moveShelfBook(
                      shelf.id,
                      selected.id,
                      selectedIndex - 1,
                    )
                  }
                >
                  <Icon name="back" size={16} />
                  左へ
                </button>
                <button
                  type="button"
                  className="editor-button secondary"
                  aria-label={`${selectedBook.title}を一つ右へ移動`}
                  disabled={selectedIndex >= shelf.items.length - 1}
                  onClick={() =>
                    actions.moveShelfBook(
                      shelf.id,
                      selected.id,
                      selectedIndex + 1,
                    )
                  }
                >
                  右へ
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </div>
          </div>
          <label className="editor-label editor-pop-label">
            この本へのPOP <span className="editor-optional">任意</span>
            <textarea
              value={selected.pop}
              maxLength={POP_MAX_LENGTH}
              rows={3}
              onChange={(event) =>
                actions.updatePop(shelf.id, selected.id, event.target.value)
              }
              placeholder="この本のどんなところを、誰かに届けたいですか？"
            />
            <span className="editor-field-note">
              書いた言葉は、この棚と本の詳細ページに表示されます。
            </span>
          </label>
          <div className="editor-selected-footer">
            <Link
              href={bookPath(selectedBook.id)}
              className="editor-text-button"
            >
              本の詳細を見る
              <Icon name="arrow" size={15} />
            </Link>
            <button
              type="button"
              className="editor-remove-book"
              onClick={() => {
                actions.removeShelfBook(shelf.id, selected.id);
                setSelectedId(null);
                notify("本を棚から外しました。");
              }}
            >
              この本を棚から外す
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Words readers left at the shop on the walk. Only the owner and the writer read them. */
function ShopMessages({ state }: { state: TownState }) {
  if (!state.shopMessages.length) return null;
  return (
    <section
      className="editor-messages"
      id="messages"
      aria-labelledby="shop-messages-heading"
    >
      <h2 id="shop-messages-heading">届いたひとこと</h2>
      <p>
        書店めぐりで立ち寄った人が残した言葉です。読めるのは、あなたと書いた人だけです。
      </p>
      <ul>
        {state.shopMessages.map((message) => {
          const reader = findReader(state, message.readerId);
          return (
            <li key={message.readerId}>
              <Link href={profilePath(message.readerId)}>
                {reader && <ReaderAvatar reader={reader} size={32} />}
                <b>{reader?.name ?? "読書家"}</b>
              </Link>
              <time dateTime={message.at}>
                {new Date(message.at).toLocaleDateString("ja-JP")}
              </time>
              <p>{message.text}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ShopEditor({ state, actions, notify }: ShopEditorProps) {
  const walk = useWalkStore();
  const [sceneEditorOpen, setSceneEditorOpen] = useState(false);
  const persistenceStatus = usePersistenceStatus();
  const savedIn = useTownBackend();
  const [addShelfOpen, setAddShelfOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [addBookShelfId, setAddBookShelfId] = useState<string | null>(null);
  const [removeShelfId, setRemoveShelfId] = useState<string | null>(null);
  // Keeps the opening flow on screen after the shop exists, for its last step.
  const [opening, setOpening] = useState(false);
  const shop = state.ownShop;
  const ownScene = walk.scenes.find((s) => s.storeId === shop?.id);
  // Whether the shop stands in the walk now, decorated or as its shelves are.
  const inWalk = ownScene
    ? hasPublicSceneBooks(ownScene, state.books)
    : publicWalkShops({ books: state.books, shops: [], ownShop: shop }).length >
      0;
  const persistenceMessage = shelfSaveMessage(savedIn, persistenceStatus);
  const addBookShelf = shop?.shelves.find(
    (shelf) => shelf.id === addBookShelfId,
  );
  const removeShelf = shop?.shelves.find((shelf) => shelf.id === removeShelfId);
  if (!shop || opening)
    return (
      <OpenShop
        state={state}
        actions={actions}
        notify={notify}
        onOpen={() => setOpening(true)}
        onDone={() => setOpening(false)}
      />
    );
  return (
    <div className="shop-editor">
      <header className="editor-page-heading">
        <div>
          <span className="editor-kicker">MY BOOKSHOP</span>
          <h1>自分だけの一軒を、育てよう。</h1>
          <p>
            本を並べて、言葉を添えて。あなたの感性が、この街の景色になります。
          </p>
        </div>
        <Link className="editor-button secondary" href="/shops/mine">
          <Icon name="eye" size={17} />
          お店を眺める
        </Link>
      </header>
      <section className="editor-immersive-entry">
        <div>
          <h2>書店めぐりの店内</h2>
          {/* Two places to arrange books; say in one line where each one shows. */}
          <p>
            {ownScene
              ? "店内は、飾りつけた形で書店めぐりに出ています。下の本棚に新しく並べた本は、飾りつけの「まだ並べていない本」から店内に置けます。"
              : "下の本棚に並べた本が、そのまま書店めぐりの店内に並びます。飾りつけると、棚の形や看板、本の置き場所を自由に変えられます。"}
          </p>
          {!inWalk && (
            <p>公開する棚に本を並べると、書店めぐりに灯りがともります。</p>
          )}
        </div>
        <div>
          <button
            type="button"
            className="editor-button primary"
            disabled={!walk.ready}
            onClick={() => setSceneEditorOpen(true)}
          >
            <Icon name="shelf" size={17} />
            店内を飾りつける
          </button>
          {inWalk && (
            <Link className="editor-button secondary" href="/walk/#mine">
              店内を眺める
            </Link>
          )}
        </div>
      </section>
      <ShopMessages state={state} />
      {sceneEditorOpen && (
        <StoreSceneEditor
          state={state}
          onClose={() => setSceneEditorOpen(false)}
          notify={notify}
        />
      )}
      <ShopSettings
        key={shop.id}
        shop={shop}
        actions={actions}
        notify={notify}
      />
      <div className="editor-shelves-heading">
        <div>
          <h2>本棚をつくる</h2>
          <p>背表紙は1、面陳は3スペース。棚の名前も、並べ方も自由です。</p>
        </div>
        <button
          type="button"
          className="editor-button primary"
          onClick={() => setAddShelfOpen(true)}
        >
          <Icon name="plus" size={18} />
          本棚を追加
        </button>
      </div>
      <div className="editor-shelf-list">
        {shop.shelves.map((shelf) => (
          <ShelfEditingPanel
            key={shelf.id}
            shelf={shelf}
            books={state.books}
            actions={actions}
            notify={notify}
            onAdd={() => setAddBookShelfId(shelf.id)}
            onRemove={() => {
              if (shelf.items.length > 0) setRemoveShelfId(shelf.id);
              else {
                actions.removeShelf(shelf.id);
                notify("空の本棚を削除しました。");
              }
            }}
          />
        ))}
      </div>
      {shop.shelves.length === 0 && (
        <section className="editor-no-shelves">
          <Icon name="book" size={34} />
          <h3>最初の棚に、名前をつけましょう。</h3>
          <p>
            「旅に持っていく本」「眠れない夜のために」
            <br />
            どんなテーマでも、思いつくままに。
          </p>
          <button
            type="button"
            className="editor-button primary"
            onClick={() => setAddShelfOpen(true)}
          >
            <Icon name="plus" size={18} />
            本棚をつくる
          </button>
        </section>
      )}
      <div className={`editor-bottom-note is-${persistenceStatus}`}>
        <Icon
          name={persistenceStatus === "saved" ? "check" : "book"}
          size={16}
        />
        <p role="status" aria-live="polite">
          {persistenceMessage}
        </p>
        <Link href="/profiles/me">
          自分のプロフィール
          <Icon name="arrow" size={15} />
        </Link>
      </div>
      {addShelfOpen && (
        <Modal
          title="新しい本棚をつくる"
          onClose={() => setAddShelfOpen(false)}
        >
          <form
            className="editor-add-shelf-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newShelfName.trim()) return;
              actions.addShelf(newShelfName.trim(), 20);
              setNewShelfName("");
              setAddShelfOpen(false);
              notify("新しい本棚ができました。");
            }}
          >
            <p>同じ本も、棚の名前ひとつで違って見えます。</p>
            <label className="editor-label">
              本棚の名前
              <input
                autoFocus
                value={newShelfName}
                onChange={(event) => setNewShelfName(event.target.value)}
                maxLength={SHELF_NAME_MAX_LENGTH}
                placeholder="例：雨の音と一緒に読みたい"
                required
              />
            </label>
            <p className="editor-field-note">
              20スペースの棚を作ります。公開・非公開は、あとから変更できます。
            </p>
            <button
              className="editor-button primary"
              type="submit"
              disabled={!newShelfName.trim()}
            >
              <Icon name="plus" size={17} />
              この名前で本棚をつくる
            </button>
          </form>
        </Modal>
      )}
      {addBookShelf && (
        <AddBookPicker
          shelf={addBookShelf}
          books={state.books}
          shown={booksBeforeSearch(state)}
          library={state.library}
          actions={actions}
          notify={notify}
          onClose={() => setAddBookShelfId(null)}
        />
      )}
      {removeShelf && (
        <Modal
          title="この本棚を削除しますか？"
          onClose={() => setRemoveShelfId(null)}
        >
          <div className="editor-remove-shelf-dialog">
            <p>
              「{removeShelf.name}」に並んでいる{removeShelf.items.length}
              冊と、この棚に書いたPOPが削除されます。
            </p>
            <p className="editor-field-note">
              本の情報や、読みたいリストはそのまま残ります。
            </p>
            <div>
              <button
                type="button"
                className="editor-button secondary"
                onClick={() => setRemoveShelfId(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="editor-button danger"
                onClick={() => {
                  actions.removeShelf(removeShelf.id);
                  setRemoveShelfId(null);
                  notify("本棚を削除しました。");
                }}
              >
                本棚を削除する
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
