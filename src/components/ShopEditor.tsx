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
  type Notify,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownState,
  type TownActions,
} from "../lib/types";
import {
  getTownSnapshot,
  shelfUsed,
  usePersistenceStatus,
  useTownBackend,
} from "../lib/store";
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
import { KeptDraftNote, useDraftOwner } from "./KeptDraftNote";
import { enterPressed, useBookSearch } from "../lib/search/use-book-search";
import { useKeptDraft } from "../lib/kept-draft";
import { openShopDraftStore } from "../lib/open-shop-draft";
import {
  SAVE_REFUSED,
  overSaved,
  sameSign,
  shelfNameDraftStore,
  shopSignDraftStore,
  signLosesWords,
  townTook,
  useKeptUntilSaved,
  type ShopSign,
} from "../lib/shop-draft";
import "./editor.css";

type ShopEditorProps = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/** A book taken off a shelf here, with what it takes to put it back as it was. */
type TakenOff = { display: ShelfItem["display"]; pop: string; index: number };
/** Books taken off on this page, by shelf and book, to put back with a tap. */
type TakenOffShelves = Record<string, Record<string, TakenOff>>;

const shopSign = (shop: Shop): ShopSign => ({
  name: shop.name,
  description: shop.description,
  tagline: ownTagline(shop),
  theme: shop.theme,
});

function ShopSettings({
  shop,
  owner,
  actions,
  notify,
}: { shop: Shop; owner: string | null } & Pick<
  ShopEditorProps,
  "actions" | "notify"
>) {
  const signKey = owner ? owner + "/" + shop.id : null;
  const kept = useKeptDraft(shopSignDraftStore, signKey);
  const saved = shopSign(shop);
  // What is written and not saved yet, over the sign as it is now; once it
  // matches the shop, nothing.
  const work = overSaved(kept.draft, saved);
  const { name, description, tagline, theme } = work ?? saved;
  // Whether the page opened on words kept from before, decided once the
  // browser's storage is read.
  const [resumed, setResumed] = useState<boolean | null>(null);
  if (resumed === null && kept.loaded) setResumed(work !== null);
  const [refused, setRefused] = useState(false);
  const settings = useRef<HTMLDetailsElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const saving = useKeptUntilSaved(() => {
    // Turned away by the account after all: the words come back, open.
    setResumed(true);
    setRefused(true);
    if (settings.current) settings.current.open = true;
    notify(SAVE_REFUSED);
  });
  // The walk's "write your words" card opens these settings at the field.
  useEffect(() => {
    if (location.hash !== "#shop-words" || !settings.current) return;
    settings.current.open = true;
    settings.current.scrollIntoView({ block: "center" });
    settings.current
      .querySelector<HTMLInputElement>("input[name=tagline]")
      ?.focus({ preventScroll: true });
  }, []);
  // Words kept from before are shown open, where they were left.
  useEffect(() => {
    if (resumed && settings.current) settings.current.open = true;
  }, [resumed]);
  // Saved since (here or on another device), they are let go.
  const signSaved = Boolean(kept.draft && !work);
  useEffect(() => {
    if (signSaved && saving.settled && signKey)
      shopSignDraftStore.clear(signKey);
  }, [signSaved, saving.settled, signKey]);
  function change(patch: Partial<ShopSign>) {
    setRefused(false);
    const next = { ...(work ?? saved), ...patch };
    kept.set(sameSign(next, saved) ? null : { work: next, base: saved });
  }
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
          const took = townTook(() =>
            actions.updateShop({
              name: name.trim(),
              description: description.trim(),
              tagline: tagline.trim(),
              theme,
            }),
          );
          // Turned away, the words stay here and in the browser.
          if (!took) return setRefused(true);
          // Kept until the account has them too, as the town now holds them.
          const now = getTownSnapshot().ownShop;
          if (now && signKey)
            saving.hold("sign", shopSignDraftStore, signKey, {
              work: shopSign(now),
              base: saved,
            });
          setResumed(false);
          setRefused(false);
          notify("書店の看板と紹介を変更しました。");
        }}
      >
        <KeptDraftNote
          className="editor-kept"
          work={work !== null}
          continuing={Boolean(resumed)}
          saved={kept.saved}
          wordsLost={work !== null && signLosesWords(work, saved)}
          onDiscard={() => {
            kept.clear();
            setResumed(false);
            setRefused(false);
            nameField.current?.focus();
          }}
        />
        <div className="editor-settings-fields">
          <label className="editor-label">
            書店の名前
            <input
              ref={nameField}
              value={name}
              onChange={(event) => change({ name: event.target.value })}
              maxLength={SHOP_NAME_MAX_LENGTH}
              required
            />
          </label>
          <label className="editor-label">
            ひとこと
            <input
              name="tagline"
              value={tagline}
              onChange={(event) => change({ tagline: event.target.value })}
              maxLength={SHOP_TAGLINE_MAX_LENGTH}
              placeholder="この書店を表す、ひとこと。"
            />
          </label>
          <label className="editor-label editor-wide-field">
            書店の紹介
            <textarea
              value={description}
              onChange={(event) => change({ description: event.target.value })}
              maxLength={SHOP_DESCRIPTION_MAX_LENGTH}
              rows={3}
              placeholder="訪れた読者に、あなたの書店を紹介しましょう。"
            />
          </label>
          <div className="editor-label">
            看板の色
            <ThemePicker
              value={theme}
              onChange={(next) => change({ theme: next })}
            />
          </div>
          <div className="editor-settings-save">
            {refused && (
              <p className="editor-save-refused" role="alert">
                {SAVE_REFUSED}
              </p>
            )}
            <button
              className="editor-button primary"
              disabled={!name.trim() || !work}
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
  library,
  actions,
  notify,
  removedHere,
  takeOff,
  putBack,
  onClose,
}: {
  shelf: Shelf;
  books: Book[];
  /** The reader's own books: first among equal matches. */
  library: string[];
  /**
   * Books taken off this shelf on this page, kept with their display, POP
   * and place, so a second tap puts them back, even after the picker closes.
   */
  removedHere: Record<string, TakenOff>;
  takeOff: (item: ShelfItem, title: string) => void;
  putBack: (bookId: string, title: string) => boolean;
  onClose: () => void;
} & Pick<ShopEditorProps, "actions" | "notify">) {
  const [search, setSearch] = useState("");
  const results = useBookSearch(books, search, {
    own: library,
    limit: books.length,
  });
  const [display, setDisplay] = useState<ShelfItem["display"]>("spine");
  // What this visit changed, for the running tally at the bottom. Books
  // taken off before it are only offered back (removedHere), not counted.
  const [addedHere, setAddedHere] = useState<string[]>([]);
  const [removedNow, setRemovedNow] = useState<string[]>([]);
  const removedCount = removedNow.filter(
    (bookId) => !shelf.items.some((item) => item.bookId === bookId),
  ).length;
  const remaining = shelf.capacity - shelfUsed(shelf);
  const cost = display === "face" ? 3 : 1;
  // Every book until something is typed; then the matches, best first, and
  // titles only close in spelling under their own quiet heading.
  const searching = search.trim() !== "";
  const filtered = searching ? results.found.map((match) => match.book) : books;
  const near = searching ? results.near.map((match) => match.book) : [];

  function choose(book: Book) {
    const placed = shelf.items.find((item) => item.bookId === book.id);
    const justAdded = addedHere.includes(book.id);
    const taken = removedHere[book.id];
    if (placed && justAdded) {
      // Placed in this visit: a second tap only takes the placing back.
      actions.removeShelfBook(shelf.id, placed.id);
      setAddedHere(addedHere.filter((id) => id !== book.id));
      notify(`「${book.title}」を棚から外しました。`);
    } else if (placed) {
      takeOff(placed, book.title);
      setRemovedNow([...removedNow.filter((id) => id !== book.id), book.id]);
    } else if (taken) {
      if (putBack(book.id, book.title))
        setRemovedNow(removedNow.filter((id) => id !== book.id));
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
          {remaining > 0 ? (
            <>
              「{shelf.name}」には、あと <strong>{remaining} スペース</strong>{" "}
              並べられます。
            </>
          ) : (
            <>「{shelf.name}」は満席です。本を外すと、また並べられます。</>
          )}
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
        {/* A full shelf has said so above; this is for the room left. */}
        {remaining > 0 && cost > remaining && (
          <p className="editor-capacity-warning" role="status">
            空きスペースが足りません。背表紙で並べるか、棚を整理してください。
          </p>
        )}
        {filtered.length > 0 && (
          <div className="editor-picker-grid">{filtered.map(choice)}</div>
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
              すべての本を見る
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
  nameKey,
  actions,
  notify,
  onAdd,
  onRemove,
  takeOff,
}: {
  shelf: Shelf;
  books: Book[];
  /** Where a new name being written for the shelf is kept (owner/shop/shelf). */
  nameKey: string | null;
  onAdd: () => void;
  onRemove: () => void;
  takeOff: (item: ShelfItem, title: string) => void;
} & Pick<ShopEditorProps, "actions" | "notify">) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const keptName = useKeptDraft(shelfNameDraftStore, nameKey);
  // A name being written stays until it is set (Enter or leaving the field).
  const typed =
    keptName.draft && keptName.draft.name !== shelf.name
      ? keptName.draft.name
      : null;
  const shelfName = typed ?? shelf.name;
  const [resumed, setResumed] = useState<boolean | null>(null);
  if (resumed === null && keptName.loaded) setResumed(typed !== null);
  const nameField = useRef<HTMLInputElement>(null);
  const saving = useKeptUntilSaved(() => {
    // Turned away by the account after all: the name waits to be set again.
    setResumed(true);
    notify(SAVE_REFUSED);
  });
  // A name kept that the shelf has now (set here or elsewhere) is let go.
  const nameSaved = Boolean(keptName.draft && typed === null);
  useEffect(() => {
    if (nameSaved && saving.settled && nameKey)
      shelfNameDraftStore.clear(nameKey);
  }, [nameSaved, saving.settled, nameKey]);
  /** Sets the name written; an emptied field goes back to the name it had. */
  function setName() {
    const next = shelfName.trim();
    if (!next || next === shelf.name) {
      if (typed !== null) keptName.clear();
      setResumed(false);
      return;
    }
    if (!townTook(() => actions.updateShelf(shelf.id, { name: next })))
      return notify(SAVE_REFUSED);
    // Kept until the account has it too, as the shelf is now called.
    const now = getTownSnapshot().ownShop?.shelves.find(
      (entry) => entry.id === shelf.id,
    );
    if (now && nameKey)
      saving.hold("shelf-name", shelfNameDraftStore, nameKey, {
        name: now.name,
      });
    setResumed(false);
  }
  const setNameRef = useRef(setName);
  useEffect(() => {
    setNameRef.current = setName;
  });
  // Leaving the page while writing sets the name, as leaving the field does.
  useEffect(() => {
    const leave = () => {
      if (nameField.current && document.activeElement === nameField.current)
        setNameRef.current();
    };
    addEventListener("pagehide", leave);
    return () => removeEventListener("pagehide", leave);
  }, []);
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
              ref={nameField}
              value={shelfName}
              onChange={(event) =>
                keptName.set(
                  event.target.value === shelf.name
                    ? null
                    : { name: event.target.value },
                )
              }
              maxLength={SHELF_NAME_MAX_LENGTH}
              onBlur={setName}
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
      <KeptDraftNote
        className="editor-kept"
        work={typed !== null}
        continuing={Boolean(resumed)}
        saved={keptName.saved}
        wordsLost={Boolean(typed?.trim())}
        onDiscard={() => {
          keptName.clear();
          setResumed(false);
        }}
        action={
          typed?.trim() && (
            <button type="button" onClick={setName}>
              この名前にする
            </button>
          )
        }
      />
      {/* An empty shelf tells its room, not a count of nothing. */}
      <div className="editor-space-row">
        {used ? (
          <>
            <span>
              棚のスペース <strong>{used}</strong>
              <span className="editor-capacity-total"> / {shelf.capacity}</span>
            </span>
            <span className={remaining === 0 ? "editor-full-shelf" : ""}>
              {remaining === 0
                ? "この棚は満席です"
                : `あと ${remaining} スペース`}
            </span>
          </>
        ) : (
          <span>{shelf.capacity}スペース、まだ空いています</span>
        )}
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
                takeOff(selected, selectedBook.title);
                setSelectedId(null);
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
  const owner = useDraftOwner();
  const [takenOff, setTakenOff] = useState<TakenOffShelves>({});
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
  // Once all the town holds is saved: the opening that led to the shop is
  // done, and names kept for shelves no longer here (removed elsewhere) go,
  // so a new shelf given the same id starts clean.
  const settled = persistenceStatus === "saved";
  useEffect(() => {
    if (!shop || !owner || !settled) return;
    openShopDraftStore.clear(owner);
    shelfNameDraftStore.initialize();
    const prefix = `${owner}/${shop.id}/`;
    for (const key of Object.keys(shelfNameDraftStore.getSnapshot().drafts))
      if (
        key.startsWith(prefix) &&
        !shop.shelves.some((shelf) => key === prefix + shelf.id)
      )
        shelfNameDraftStore.clear(key);
  }, [shop, owner, settled]);
  // Shelves removed here, counted by id: a new shelf can be given the id of
  // one removed, and must not get its books from an old 元に戻す.
  const removedShelves = useRef<Record<string, number>>({});
  /** Removes a shelf, and the work kept for it here: its books and name. */
  function removeShelfAndWork(shelfId: string) {
    if (!townTook(() => actions.removeShelf(shelfId))) {
      notify(
        "本棚を削除できませんでした。少しおいて、もう一度お試しください。",
      );
      return false;
    }
    removedShelves.current[shelfId] =
      (removedShelves.current[shelfId] ?? 0) + 1;
    setTakenOff((all) => {
      const rest = { ...all };
      delete rest[shelfId];
      return rest;
    });
    if (owner && shop)
      shelfNameDraftStore.clear(`${owner}/${shop.id}/${shelfId}`);
    return true;
  }
  function forget(shelfId: string, bookId: string) {
    setTakenOff((all) => {
      const rest = { ...all[shelfId] };
      delete rest[bookId];
      return { ...all, [shelfId]: rest };
    });
  }
  /** Puts a book taken off here back in its place, with its POP. */
  function putBack(
    shelfId: string,
    bookId: string,
    title: string,
    taken = takenOff[shelfId]?.[bookId],
    removals = removedShelves.current[shelfId] ?? 0,
  ) {
    if (!taken) return false;
    const now = getTownSnapshot().ownShop?.shelves.find(
      (shelf) => shelf.id === shelfId,
    );
    // The shelf it came off is gone, even if a new one has its id.
    if (!now || (removedShelves.current[shelfId] ?? 0) !== removals) {
      notify("棚がなくなったため、戻せませんでした。");
      return false;
    }
    // Already back on the shelf (by the picker, or a second tap).
    if (now.items.some((item) => item.bookId === bookId)) {
      forget(shelfId, bookId);
      return true;
    }
    if (
      !actions.addShelfBook(shelfId, bookId, taken.display, {
        pop: taken.pop,
        index: taken.index,
      })
    ) {
      notify("棚の空きスペースが足りず、戻せませんでした。");
      return false;
    }
    forget(shelfId, bookId);
    notify(`「${title}」を元の場所に戻しました。`);
    return true;
  }
  /**
   * Takes a book off a shelf, keeping its display, POP and place: the toast
   * puts it back, and so does a second tap on it in the picker.
   */
  function takeOff(shelf: Shelf, item: ShelfItem, title: string) {
    const taken: TakenOff = {
      display: item.display,
      pop: item.pop,
      index: shelf.items.findIndex((entry) => entry.id === item.id),
    };
    const removals = removedShelves.current[shelf.id] ?? 0;
    actions.removeShelfBook(shelf.id, item.id);
    setTakenOff((all) => ({
      ...all,
      [shelf.id]: { ...all[shelf.id], [item.bookId]: taken },
    }));
    notify(
      item.pop.trim()
        ? `「${title}」を外しました。POPごと元に戻せます。`
        : `「${title}」を棚から外しました。`,
      {
        label: "元に戻す",
        run: () => putBack(shelf.id, item.bookId, title, taken, removals),
      },
    );
  }
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
        owner={owner}
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
            nameKey={owner && `${owner}/${shop.id}/${shelf.id}`}
            actions={actions}
            notify={notify}
            takeOff={(item, title) => takeOff(shelf, item, title)}
            onAdd={() => setAddBookShelfId(shelf.id)}
            onRemove={() => {
              if (shelf.items.length > 0) setRemoveShelfId(shelf.id);
              else if (removeShelfAndWork(shelf.id))
                notify("空の本棚を削除しました。");
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
          library={state.library}
          actions={actions}
          notify={notify}
          removedHere={takenOff[addBookShelf.id] ?? {}}
          takeOff={(item, title) => takeOff(addBookShelf, item, title)}
          putBack={(bookId, title) => putBack(addBookShelf.id, bookId, title)}
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
                  if (!removeShelfAndWork(removeShelf.id)) return;
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
