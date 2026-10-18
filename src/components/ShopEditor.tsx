"use client";

import { shortDate } from "../lib/japan-time";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { profilePath, shopPath, walkPath } from "../lib/paths";
import { findReader } from "../lib/social";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { SortableShelf } from "./SortableShelf";
import { StoreSceneEditor } from "./StoreSceneEditor";
import { saveOwnedScene, useWalkStore } from "../lib/walk-store";
import {
  hasPublicSceneBooks,
  sceneForShelves,
} from "../lib/store-customization";
import { publicWalkShops } from "../lib/store-scene-adapter";
import { OpenShop, ThemePicker } from "./OpenShop";
import { KeptDraftNote, useDraftOwner } from "./KeptDraftNote";
import { enterPressed, useBookSearch } from "../lib/search/use-book-search";
import { useKeptDraft } from "../lib/kept-draft";
import { openShopDraftStore } from "../lib/open-shop-draft";
import { sceneDraftStore, sceneMark, sceneWorkKey } from "../lib/scene-draft";
import {
  keepArrangements,
  keptArrangements,
  shelvesDraftStore,
  shelvesLoseWords,
} from "../lib/shelves-draft";
import { canonical } from "../lib/canonical";
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
import { booksBeforeSearch } from "../lib/book-lists";
import { focusField } from "../lib/coarse-pointer";
import "./editor.css";
import { bookAuthor, bookById, bookTitle } from "../lib/book-name";
import { counted, whenSome, failure, AGAIN, PLACE } from "../lib/words";
import { libraryBookIds, ownFirst } from "../lib/shop-picks";
import { mine } from "../lib/own-books";
import { useUrlParam } from "../lib/url-state";

/** How many books a group of the shelf picker shows at a time. */
const PAGE = 24;

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
  const title = useId();
  const saving = useKeptUntilSaved(() => {
    // Turned away by the account after all: the words come back, open.
    setResumed(true);
    setRefused(true);
    if (settings.current) settings.current.open = true;
    notify(SAVE_REFUSED);
  });
  // The walk's "write your words" card opens these settings at the field
  // (on a touch screen the field waits for a tap; their form has the focus).
  useEffect(() => {
    if (location.hash !== "#shop-words" || !settings.current) return;
    settings.current.open = true;
    settings.current.scrollIntoView({ block: "center" });
    focusField(
      settings.current.querySelector<HTMLInputElement>("input[name=tagline]"),
      { preventScroll: true },
    );
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
        <span id={title}>
          <Icon name="edit" size={17} />
          書店の看板と紹介
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      {/* Named: on a touch screen it holds the focus while its fields wait
          for a tap (focusField). */}
      <form
        aria-labelledby={title}
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
            focusField(nameField.current);
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
              className="btn fill"
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
  shown,
  own,
  chosen,
  actions,
  notify,
  removedHere,
  takeOff,
  putBack,
  onClose,
}: {
  shelf: Shelf;
  books: Book[];
  /**
   * The books offered before anything is typed, and the only ones a genre
   * finds (booksBeforeSearch).
   */
  shown: Book[];
  /**
   * The reader's own books, in the library's order: offered first before
   * anything is typed, and first among equal matches.
   */
  own: string[];
  /** A book chosen on its page (自分の書店へ): offered first of all. */
  chosen?: string | null;
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
    own,
    limit: books.length,
    genreFinds: shown,
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
  // Until something is typed, the books a list may show (and any taken off
  // here, to put back); then the matches among every book, best first, and
  // titles only close in spelling under their own quiet heading.
  const searching = search.trim() !== "";
  const shownIds = new Set(shown.map((book) => book.id));
  const filtered = searching
    ? results.found.map((match) => match.book)
    : books.filter((book) => shownIds.has(book.id) || removedHere[book.id]);
  const near = searching ? results.near.map((match) => match.book) : [];
  // A long group shows a page of books at a time.
  const [pages, setPages] = useState<Record<string, number>>({});
  const shownOf = (key: string) => (pages[key] ?? 1) * PAGE;
  // Before anything is typed: the book chosen on its page, then the reader's
  // own books, then the town's, each under its own heading (AUD-053).
  const chosenBook = chosen ? bookById(books, chosen) : undefined;
  const groups = searching
    ? []
    : (() => {
        const rest = filtered.filter((book) => book.id !== chosenBook?.id);
        const split = ownFirst(rest, own);
        return [
          {
            key: "chosen",
            heading: PLACE.chosen,
            books: chosenBook ? [chosenBook] : [],
          },
          { key: "yours", heading: PLACE.yours, books: split.own },
          { key: "town", heading: PLACE.town, books: split.town },
        ].filter((group) => group.books.length > 0);
      })();

  function choose(book: Book) {
    const placed = shelf.items.find((item) => item.bookId === book.id);
    const justAdded = addedHere.includes(book.id);
    const taken = removedHere[book.id];
    if (placed && justAdded) {
      // Placed in this visit: a second tap only takes the placing back.
      actions.removeShelfBook(shelf.id, placed.id);
      setAddedHere(addedHere.filter((id) => id !== book.id));
      notify(`「${bookTitle(book)}」を棚から外しました。`);
    } else if (placed) {
      takeOff(placed, bookTitle(book));
      setRemovedNow([...removedNow.filter((id) => id !== book.id), book.id]);
    } else if (taken) {
      if (putBack(book.id, bookTitle(book)))
        setRemovedNow(removedNow.filter((id) => id !== book.id));
    } else if (actions.addShelfBook(shelf.id, book.id, display)) {
      // The editor stays open so several books can be placed in a row.
      setAddedHere([...addedHere, book.id]);
      notify(`「${bookTitle(book)}」を本棚に並べました。`);
    } else {
      notify(
        failure({
          what: "棚の空きスペースが足りません",
          next: "並べ方を変えてみてください",
        }),
      );
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
        <span className="editor-book-choice-title">{bookTitle(book)}</span>
        <span className="editor-book-choice-author">{bookAuthor(book)}</span>
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
            {failure({
              what: "空きスペースが足りません",
              next: "背表紙で並べるか、棚を整理してください",
            })}
          </p>
        )}
        {searching && filtered.length > 0 && (
          <div className="editor-picker-grid">{filtered.map(choice)}</div>
        )}
        {groups.map((group) => (
          <Fragment key={group.key}>
            <h3
              className="editor-picker-group"
              id={`editor-picker-${group.key}`}
            >
              {group.heading}
            </h3>
            <div
              className={
                "editor-picker-grid" +
                (group.key === "chosen" ? " is-chosen" : "")
              }
              role="group"
              aria-labelledby={`editor-picker-${group.key}`}
            >
              {group.books.slice(0, shownOf(group.key)).map(choice)}
            </div>
            {group.books.length > shownOf(group.key) && (
              <button
                type="button"
                className="text-btn editor-picker-more"
                onClick={() =>
                  setPages({
                    ...pages,
                    [group.key]: shownOf(group.key) / PAGE + 1,
                  })
                }
              >
                {PLACE.more}
              </button>
            )}
          </Fragment>
        ))}
        {!searching && groups.length === 0 && (
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
              className="text-btn"
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
                  whenSome(addedHere.length, "冊", (c) => `${c}並べました`) ??
                    "",
                  whenSome(removedCount, "冊", (c) => `${c}外しました`) ?? "",
                ]
                  .filter(Boolean)
                  .join("・")
              : "押すたびに、並べる・外すを切り替えられます"}
          </span>
          <button type="button" className="btn fill" onClick={onClose}>
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
  const saving = useKeptUntilSaved((_what, how) => {
    // Turned away by the account after all: the name waits to be set again.
    // Not sent because the shelves had changed on another device first, the
    // town says so above, and the shelves page offers them back.
    setResumed(true);
    if (how === "refused") notify(SAVE_REFUSED);
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
      saving.hold(
        "shelf-name",
        shelfNameDraftStore,
        nameKey,
        { name: now.name },
        "shelves",
      );
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
  const selectedBook = bookById(books, selected?.bookId);
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
                // The Enter that confirms a kana conversion is the keyboard's.
                if (enterPressed(event)) event.currentTarget.blur();
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
            className="icon-btn subtle"
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
      <SortableShelf
        shelf={shelf}
        books={books}
        selectedId={selected?.id}
        onSelect={(item) => setSelectedId(item.id)}
        onReorder={(activeId, overId) => {
          const targetIndex = shelf.items.findIndex(
            (item) => item.id === overId,
          );
          // Moved by dragging, the book stays where it was put: the sheet
          // opens only for a book pressed.
          if (targetIndex >= 0 && activeId !== overId)
            actions.moveShelfBook(shelf.id, activeId, targetIndex);
        }}
      />
      <div className="editor-shelf-below">
        <p>
          <Icon name="grip" size={14} />
          本を選んで編集。ドラッグでも並び替えられます。
        </p>
        <button type="button" className="btn" onClick={onAdd}>
          <Icon name="edit" size={17} />
          本棚を編集
        </button>
      </div>
      {/* The book pressed: its POP and how it stands, in a sheet from the
          bottom, so it shows where the reader is looking (AUD-054). */}
      {selected && selectedBook && (
        <Modal
          title={bookTitle(selectedBook)}
          onClose={() => setSelectedId(null)}
          fromBottom
        >
          <div className="editor-selected-book">
            <p className="editor-selected-heading">
              <span className="editor-kicker">いま編集している本</span>
              {bookAuthor(selectedBook)}
            </p>
            <div className="editor-selected-controls">
              <div className="editor-control-group">
                <span className="editor-control-label">並べ方</span>
                <div
                  className="editor-segment"
                  role="group"
                  aria-label={`${bookTitle(selectedBook)}の並べ方`}
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
                    className="btn"
                    aria-label={`${bookTitle(selectedBook)}を一つ左へ移動`}
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
                    className="btn"
                    aria-label={`${bookTitle(selectedBook)}を一つ右へ移動`}
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
              <Link href={bookPath(selectedBook.id)} className="text-btn">
                本の詳細を見る
                <Icon name="arrow" size={15} />
              </Link>
              <button
                type="button"
                className="text-btn quiet editor-remove-book"
                onClick={() => {
                  takeOff(selected, bookTitle(selectedBook));
                  setSelectedId(null);
                }}
              >
                この本を棚から外す
              </button>
            </div>
          </div>
        </Modal>
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
              <time dateTime={message.at}>{shortDate(message.at)}</time>
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
  // A book chosen on its page (自分の書店へ, ?place=): once the town is in,
  // its shelf picker opens with that book first. The address goes back to
  // the page's own, so a reload does not open it again.
  const [placeParam, setPlaceParam] = useUrlParam("place");
  const [placing, setPlacing] = useState<string | null>(null);
  const [choosingShelf, setChoosingShelf] = useState(false);
  const townIn = persistenceStatus !== "loading";
  useEffect(() => {
    if (!placeParam || !townIn) return;
    setPlaceParam(null);
    if (!bookById(state.books, placeParam)) return;
    // Offered as the reader's own book for it, when they have one.
    setPlacing(mine(getTownSnapshot(), placeParam));
    const shelves = getTownSnapshot().ownShop?.shelves;
    if (!shelves) return; // No shop yet: the opening offers the book first.
    if (shelves.length === 1) setAddBookShelfId(shelves[0].id);
    else if (shelves.length > 1) setChoosingShelf(true);
    else setAddShelfOpen(true);
  }, [placeParam, setPlaceParam, townIn, state.books]);
  // The library, in its own order: the shelf picker offers it first.
  const own = useMemo(() => libraryBookIds(state), [state]);
  const ownScene = walk.scenes.find((s) => s.storeId === shop?.id);
  // Decorating kept in this browser: not saved yet, or not sent because the
  // scene was saved on another device first.
  const keptScene = useKeptDraft(
    sceneDraftStore,
    shop ? sceneWorkKey(owner, shop.id) : null,
  ).draft;
  const sceneKept = Boolean(
    walk.ready &&
    keptScene &&
    keptScene.scene.storeId === shop?.id &&
    sceneMark(keptScene.scene) !== sceneMark(ownScene),
  );
  // Whether the shop stands in the walk now, decorated or as its shelves are.
  const inWalk = ownScene
    ? hasPublicSceneBooks(ownScene, state.books)
    : publicWalkShops({ books: state.books, shops: [], ownShop: shop }).length >
      0;
  const persistenceMessage = shelfSaveMessage(savedIn, persistenceStatus);
  // The shelves as arranged here, not sent because they had changed on
  // another device first, newest first: the reader can put each back, or
  // throw it away. One the shop has saved now waits no more.
  const keptShelves = useKeptDraft(shelvesDraftStore, owner);
  const arrangements = keptArrangements(keptShelves.draft);
  const shelvesNow = shop ? canonical(shop.shelves) : null;
  const waiting = arrangements.filter(
    (entry) => shelvesNow !== null && canonical(entry.shelves) !== shelvesNow,
  );
  const shelvesHere = waiting[0] ?? null;
  const shelvesSaved =
    shelvesNow !== null &&
    persistenceStatus === "saved" &&
    waiting.length < arrangements.length;
  useEffect(() => {
    if (!owner || !shelvesSaved || shelvesNow === null) return;
    keepArrangements(
      owner,
      keptArrangements(shelvesDraftStore.get(owner)).filter(
        (entry) => canonical(entry.shelves) !== shelvesNow,
      ),
    );
  }, [owner, shelvesSaved, shelvesNow]);
  // The note's buttons go with it: the hand goes on to 本棚を追加.
  const addShelfButton = useRef<HTMLButtonElement>(null);
  const handToShelves = useRef(false);
  useEffect(() => {
    if (!handToShelves.current) return;
    handToShelves.current = false;
    addShelfButton.current?.focus();
  });
  /**
   * Puts the shelves kept here in place of the shelves now, with 元に戻す.
   * They stay kept until the account has them: turned away, or changed on
   * another device first again, they are offered again.
   */
  function putShelvesBack() {
    if (!owner || !shop || !shelvesHere) return;
    const before = shop.shelves;
    const entry = shelvesHere;
    if (!townTook(() => actions.restoreShelves(entry.shelves))) {
      notify(
        failure({ what: "棚を入れ替えられませんでした", next: AGAIN.later }),
      );
      return;
    }
    // As the town holds them now (books gone since are left out).
    const put = {
      shelves: getTownSnapshot().ownShop?.shelves ?? entry.shelves,
      at: entry.at,
    };
    keepArrangements(
      owner,
      arrangements.map((other) => (other === entry ? put : other)),
    );
    handToShelves.current = true;
    notify("この端末の棚にしました。", {
      label: "元に戻す",
      run: () => {
        if (!townTook(() => actions.restoreShelves(before))) return;
        // Offered again, as before (also once they were saved).
        keepArrangements(owner, [
          put,
          ...keptArrangements(shelvesDraftStore.get(owner)),
        ]);
      },
    });
  }
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
  // A decorated shop follows its shelves: books put on a shelf go into the
  // shop's rows and books taken off leave them. Saved only once the town and
  // the walk are both read from the same place, so a shelf not read yet
  // never empties the shop.
  const followed = useRef("");
  const walkKnown =
    walk.ready &&
    walk.kind === savedIn &&
    (walk.kind === "local" || walk.kind === "account") &&
    walk.status !== "unavailable" &&
    walk.status !== "recovered";
  const townKnown =
    persistenceStatus !== "loading" &&
    persistenceStatus !== "unavailable" &&
    persistenceStatus !== "recovered";
  useEffect(() => {
    if (!shop || shop.demo || !ownScene || !walkKnown || !townKnown) return;
    const next = sceneForShelves(ownScene, shop, state.books);
    if (!next) return;
    // Tried once for each pair of shelves and scene, saved or not.
    const pair = JSON.stringify([shop.shelves, next.scene]);
    if (followed.current === pair) return;
    followed.current = pair;
    if (!saveOwnedScene(next.scene, state).ok) return;
    const titles = next.waiting.map((id) => {
      const book = bookById(state.books, id);
      return book ? bookTitle(book) : "";
    });
    if (titles.length)
      notify(
        (titles.length === 1 ? `「${titles[0]}」は` : "棚に並べた本の一部は") +
          "店内の棚に入りきらないため、飾りつけの「まだ並べていない本」に置きました。",
      );
  }, [shop, ownScene, walkKnown, townKnown, state, notify]);
  // Shelves removed here, counted by id: a new shelf can be given the id of
  // one removed, and must not get its books from an old 元に戻す.
  const removedShelves = useRef<Record<string, number>>({});
  /** Removes a shelf, and the work kept for it here: its books and name. */
  function removeShelfAndWork(shelfId: string) {
    if (!townTook(() => actions.removeShelf(shelfId))) {
      notify(
        failure({ what: "本棚を削除できませんでした", next: AGAIN.later }),
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
      notify(failure({ what: "棚がなくなったため、戻せませんでした" }));
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
      notify(failure({ what: "棚の空きスペースが足りず、戻せませんでした" }));
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
        startBook={placing}
        onOpen={() => {
          setOpening(true);
          setPlacing(null);
        }}
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
        <Link className="btn" href={shopPath("mine")}>
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
              ? "店内は、飾りつけた形で書店めぐりに出ています。下の本棚に並べた本は店内にも並び、棚から外した本は店内からも下がります。"
              : "下の本棚に並べた本が、そのまま書店めぐりの店内に並びます。飾りつけると、棚の形や看板、本の置き場所を自由に変えられます。"}
          </p>
          {!inWalk && (
            <p>公開する棚に本を並べると、書店めぐりに灯りがともります。</p>
          )}
          {sceneKept && <p>店内の書きかけを、このブラウザに残しています。</p>}
        </div>
        <div>
          <button
            type="button"
            className="btn fill"
            disabled={!walk.ready}
            onClick={() => setSceneEditorOpen(true)}
          >
            <Icon name="shelf" size={17} />
            店内を飾りつける
          </button>
          {inWalk && (
            <Link className="btn" href={walkPath("mine")}>
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
          className="btn fill"
          ref={addShelfButton}
          onClick={() => setAddShelfOpen(true)}
        >
          <Icon name="plus" size={18} />
          本棚を追加
        </button>
      </div>
      {shelvesHere && (
        <KeptDraftNote
          className="editor-shelves-kept"
          continuing
          saved={keptShelves.saved}
          wordsLost={shelvesLoseWords(shelvesHere.shelves, shop.shelves)}
          onDiscard={() => {
            if (owner)
              keepArrangements(
                owner,
                arrangements.filter((entry) => entry !== shelvesHere),
              );
            handToShelves.current = true;
          }}
          lead="別の端末で先に棚が変わっていたため、この端末で直した棚を残しています。この端末の棚にすると、いまの棚と入れ替わります"
          action={
            <button type="button" onClick={putShelvesBack}>
              この端末の棚にする
            </button>
          }
        />
      )}
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
            className="btn fill"
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
        <Link href={profilePath("me")}>
          自分のプロフィール
          <Icon name="arrow" size={15} />
        </Link>
      </div>
      {addShelfOpen && (
        <Modal
          title="新しい本棚をつくる"
          onClose={() => {
            setAddShelfOpen(false);
            setPlacing(null);
          }}
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
              // Made for a book chosen on its page: it goes on this shelf.
              const made = getTownSnapshot().ownShop?.shelves.at(-1);
              if (placing && made) setAddBookShelfId(made.id);
            }}
          >
            <p>同じ本も、棚の名前ひとつで違って見えます。</p>
            <label className="editor-label">
              本棚の名前
              <input
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
              className="btn fill"
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
          own={own}
          chosen={placing}
          actions={actions}
          notify={notify}
          removedHere={takenOff[addBookShelf.id] ?? {}}
          takeOff={(item, title) => takeOff(addBookShelf, item, title)}
          putBack={(bookId, title) => putBack(addBookShelf.id, bookId, title)}
          onClose={() => {
            setAddBookShelfId(null);
            setPlacing(null);
          }}
        />
      )}
      {choosingShelf && placing && (
        <Modal
          title={PLACE.whichShelf}
          onClose={() => {
            setChoosingShelf(false);
            setPlacing(null);
          }}
        >
          <ul className="editor-shelf-choices">
            {shop.shelves.map((shelf) => {
              const room = shelf.capacity - shelfUsed(shelf);
              const there = shelf.items.some((item) => item.bookId === placing);
              return (
                <li key={shelf.id}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setChoosingShelf(false);
                      setAddBookShelfId(shelf.id);
                    }}
                  >
                    <b>{shelf.name}</b>
                    <small>
                      {there
                        ? "この本が並んでいます"
                        : room > 0
                          ? `あと ${room} スペース`
                          : "満席です"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
      {removeShelf && (
        <Modal
          title="この本棚を削除しますか？"
          onClose={() => setRemoveShelfId(null)}
        >
          <div className="editor-remove-shelf-dialog">
            <p>
              「{removeShelf.name}」に並んでいる
              {counted(removeShelf.items.length, "冊")}
              と、この棚に書いたPOPが削除されます。
            </p>
            <p className="editor-field-note">
              本の情報や、読みたいリストはそのまま残ります。
            </p>
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => setRemoveShelfId(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn danger fill"
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
