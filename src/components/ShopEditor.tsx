"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  Book,
  Shelf,
  ShelfItem,
  Shop,
  TownState,
  TownActions,
} from "../lib/types";
import { shelfUsed, usePersistenceStatus } from "../lib/store";
import { BookJacket, Icon, Modal } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import "./editor.css";

type ShopEditorProps = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

const THEMES: { value: Shop["theme"]; label: string; color: string }[] = [
  { value: "sage", label: "深緑", color: "#405b4b" },
  { value: "ink", label: "藍色", color: "#35485e" },
  { value: "ochre", label: "黄土", color: "#a77941" },
  { value: "rose", label: "あずき", color: "#8e5f60" },
];

function ThemePicker({
  value,
  onChange,
}: {
  value: Shop["theme"];
  onChange: (theme: Shop["theme"]) => void;
}) {
  return (
    <div
      className="editor-theme-picker"
      role="group"
      aria-label="書店のテーマカラー"
    >
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          type="button"
          className={`editor-theme-option ${value === theme.value ? "is-selected" : ""}`}
          aria-pressed={value === theme.value}
          onClick={() => onChange(theme.value)}
        >
          <span
            className="editor-theme-dot"
            style={{ background: theme.color }}
          >
            {value === theme.value && <Icon name="check" size={15} />}
          </span>
          {theme.label}
        </button>
      ))}
    </div>
  );
}

function CreateShop({
  actions,
  notify,
}: Pick<ShopEditorProps, "actions" | "notify">) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState<Shop["theme"]>("sage");
  return (
    <section className="editor-create">
      <div className="editor-create-intro">
        <span className="editor-kicker">YOUR LITTLE BOOKSHOP</span>
        <h1>
          あなたの愛した一冊が、
          <br />
          誰かの愛する一冊になる。
        </h1>
        <p>
          棚に名前をつけて、本を並べる。
          <br />
          あなたの感性で、小さな書店をひらきましょう。
        </p>
        <div className="editor-doorway" aria-hidden="true">
          <div className="editor-doorway-sign">OPEN SOON</div>
          <span className="editor-doorway-book one" />
          <span className="editor-doorway-book two" />
          <span className="editor-doorway-book three" />
          <span className="editor-doorway-book four" />
          <span className="editor-doorway-book five" />
          <div className="editor-doorway-wood" />
        </div>
      </div>
      <form
        className="editor-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          actions.createShop(name.trim(), description.trim(), theme);
          notify("あなたの書店ができました。本を並べてみましょう。");
        }}
      >
        <span className="editor-kicker">まずは、看板から。</span>
        <h2>書店をつくる</h2>
        <label className="editor-label">
          書店の名前 <span className="editor-required">必須</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例：雨の日の小さな書店"
            required
            autoComplete="off"
          />
        </label>
        <label className="editor-label">
          書店の紹介 <span className="editor-optional">任意</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="どんな本を並べたいですか？ 今の気分のままで。"
          />
        </label>
        <div className="editor-label">
          看板の色 <ThemePicker value={theme} onChange={setTheme} />
        </div>
        <button
          className="editor-button primary editor-create-submit"
          type="submit"
          disabled={!name.trim()}
        >
          <Icon name="store" size={18} />
          書店をひらく
        </button>
        <p className="editor-field-note">
          名前も本棚も、あとから自由に変えられます。
        </p>
      </form>
    </section>
  );
}

function ShopSettings({
  shop,
  actions,
  notify,
}: { shop: Shop } & Pick<ShopEditorProps, "actions" | "notify">) {
  const [name, setName] = useState(shop.name);
  const [description, setDescription] = useState(shop.description);
  const [tagline, setTagline] = useState(shop.tagline);
  const [theme, setTheme] = useState<Shop["theme"]>(shop.theme);
  const dirty =
    name !== shop.name ||
    description !== shop.description ||
    tagline !== shop.tagline ||
    theme !== shop.theme;
  return (
    <details className="editor-settings">
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
              required
            />
          </label>
          <label className="editor-label">
            ひとこと
            <input
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              placeholder="この書店を表す、ひとこと。"
            />
          </label>
          <label className="editor-label editor-wide-field">
            書店の紹介
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
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
  actions,
  notify,
  onClose,
}: {
  shelf: Shelf;
  books: Book[];
  onClose: () => void;
} & Pick<ShopEditorProps, "actions" | "notify">) {
  const [search, setSearch] = useState("");
  const [display, setDisplay] = useState<ShelfItem["display"]>("spine");
  // Books placed while this picker is open; only these can be taken back here.
  const [addedHere, setAddedHere] = useState<string[]>([]);
  const remaining = shelf.capacity - shelfUsed(shelf);
  const cost = display === "face" ? 3 : 1;
  const query = search.trim().toLocaleLowerCase();
  const filtered = books.filter((book) =>
    `${book.title} ${book.author} ${book.genre}`
      .toLocaleLowerCase()
      .includes(query),
  );
  return (
    <Modal title="本棚に並べる本を選ぶ" onClose={onClose} wide>
      <div className="editor-book-picker">
        <p className="editor-picker-context">
          「{shelf.name}」には、あと <strong>{remaining} スペース</strong>{" "}
          並べられます。
        </p>
        <label className="editor-search-field">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
        <div className="editor-picker-grid">
          {filtered.map((book) => {
            const placed = shelf.items.find((item) => item.bookId === book.id);
            const mine = Boolean(placed) && addedHere.includes(book.id);
            const already = Boolean(placed) && !mine;
            return (
              <button
                className={"editor-book-choice" + (mine ? " is-added" : "")}
                key={book.id}
                type="button"
                aria-pressed={mine}
                disabled={already || (!placed && cost > remaining)}
                onClick={() => {
                  if (placed && mine) {
                    actions.removeShelfBook(shelf.id, placed.id);
                    setAddedHere(addedHere.filter((id) => id !== book.id));
                    notify(`「${book.title}」を棚から外しました。`);
                  } else if (actions.addShelfBook(shelf.id, book.id, display)) {
                    // The picker stays open so several books can be placed in a row.
                    setAddedHere([...addedHere, book.id]);
                    notify(`「${book.title}」を本棚に並べました。`);
                  } else {
                    notify(
                      "棚の空きスペースが足りません。並べ方を変えてみてください。",
                    );
                  }
                }}
              >
                <BookJacket book={book} className="editor-picker-jacket" />
                <span className="editor-book-choice-title">{book.title}</span>
                <span className="editor-book-choice-author">{book.author}</span>
                <span className="editor-book-choice-add">
                  {mine ? (
                    <>
                      <Icon name="check" size={14} />
                      並べました・押すと外す
                    </>
                  ) : already ? (
                    <>
                      <Icon name="check" size={14} />
                      この棚にあります
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
          })}
        </div>
        {filtered.length === 0 && (
          <div className="editor-empty-search">
            <Icon name="book" size={28} />
            <p>この言葉に合う本は見つかりませんでした。</p>
            <button
              type="button"
              className="editor-text-button"
              onClick={() => setSearch("")}
            >
              すべての本を見る
            </button>
          </div>
        )}
        <div className="editor-picker-footer">
          <span role="status">
            {addedHere.length
              ? `この画面で${addedHere.length}冊並べました`
              : "続けて何冊でも選べます"}
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
          disabled={remaining < 1}
        >
          <Icon name="plus" size={17} />
          本を並べる
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
              href={`/books/${selectedBook.id}`}
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

export function ShopEditor({ state, actions, notify }: ShopEditorProps) {
  const persistenceStatus = usePersistenceStatus();
  const [addShelfOpen, setAddShelfOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [addBookShelfId, setAddBookShelfId] = useState<string | null>(null);
  const [removeShelfId, setRemoveShelfId] = useState<string | null>(null);
  const shop = state.ownShop;
  const persistenceMessage = {
    saved: "本棚の変更は、このブラウザに保存済みです。",
    loading: "このブラウザの保存データを読み込んでいます。",
    unavailable:
      "ブラウザに保存できません。変更はリロードすると失われる場合があります。",
    recovered: "保存データを読み込めなかったため、初期状態に戻しました。",
  }[persistenceStatus];
  const addBookShelf = shop?.shelves.find(
    (shelf) => shelf.id === addBookShelfId,
  );
  const removeShelf = shop?.shelves.find((shelf) => shelf.id === removeShelfId);
  if (!shop) return <CreateShop actions={actions} notify={notify} />;
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
