"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
  COMPOSE_ICONS,
  type ComposeIcon,
  type TownActions,
  type TownState,
} from "../lib/types";
import { readerPosts } from "../lib/social";
import { formatDuration, readingTotals } from "../lib/reading";
import { BarcodeRegister } from "./BarcodeRegister";
import { useClock } from "./useClock";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { ProfilePosts } from "./Social";

const composeIconNames: Record<ComposeIcon, string> = {
  pen: "万年筆",
  typewriter: "タイプライター",
  quill: "羽根ペン",
};
import "./profile.css";
import "./reading.css";

interface ProfileViewProps {
  state: TownState;
  actions: TownActions;
  readerId: string;
  notify: (message: string) => void;
}

export function ProfileView({
  state,
  actions,
  readerId,
  notify,
}: ProfileViewProps) {
  const isSelf = readerId === state.me.id;
  const reader = isSelf
    ? state.me
    : state.readers.find((person) => person.id === readerId);
  const shop = isSelf
    ? state.ownShop
    : state.shops.find((place) => place.ownerId === readerId);
  const [collection, setCollection] = useState<
    "wishlist" | "favorites" | "library"
  >("wishlist");
  const [sheet, setSheet] = useState<
    "following" | "followers" | "settings" | "register" | null
  >(null);
  const clock = useClock(60_000);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingNine, setEditingNine] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [draftNine, setDraftNine] = useState<string[]>([]);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const selectableBooks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return state.books.filter(
      (book) =>
        !draftNine.includes(book.id) &&
        (!query ||
          `${book.title} ${book.author} ${book.genre}`
            .toLocaleLowerCase()
            .includes(query)),
    );
  }, [state.books, draftNine, search]);

  if (!reader) {
    return (
      <div className="profile-view profile-not-found">
        <Icon name="user" />
        <h1>読書家が見つかりませんでした</h1>
        <Link className="button primary" href="/">
          本の街に戻る
        </Link>
      </div>
    );
  }

  const publicShelves = shop?.shelves.filter((shelf) => shelf.isPublic) ?? [];
  const lifeNine = Array.from({ length: 9 }, (_, index) => {
    const id = reader.lifeNine[index];
    return id ? state.books.find((book) => book.id === id) : undefined;
  });
  const following = Boolean(shop && state.following.includes(shop.id));
  const followedShops = state.shops.filter((place) =>
    state.following.includes(place.id),
  );
  const followerCount = shop ? shop.followers + Number(following) : 0;
  const postCount = readerPosts(state, reader.id).length;
  const readingTime = clock ? readingTotals(state, clock.now).total : null;

  function beginProfileEdit() {
    if (!reader) return;
    setDraftName(reader.name);
    setDraftBio(reader.bio);
    setEditingProfile(true);
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    actions.updateProfile(name, draftBio.trim());
    setEditingProfile(false);
    notify("プロフィールを保存しました");
  }

  function beginNineEdit() {
    if (!reader) return;
    setDraftNine([...reader.lifeNine]);
    setDraftNotes({ ...reader.nineNotes });
    setSearch("");
    setEditingNine(true);
  }

  function moveNine(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= draftNine.length) return;
    setDraftNine((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function saveNine() {
    const notes = Object.fromEntries(
      draftNine
        .map((id) => [id, (draftNotes[id] ?? "").trim()])
        .filter(([, note]) => Boolean(note)),
    );
    actions.updateNine(draftNine, notes);
    setEditingNine(false);
    notify("人生の9冊を保存しました");
  }

  return (
    <div className="profile-view">
      <Link className="profile-back" href="/">
        <Icon name="back" /> 本の街へ
      </Link>

      <section className="profile-reader" aria-labelledby="profile-name">
        <div className="profile-reader-avatar">
          <ReaderAvatar reader={reader} />
        </div>
        <div className="profile-reader-text">
          <p className="profile-eyebrow">
            READER IN BOOK TOWN{" "}
            {!isSelf && <span className="profile-demo">デモの読書家</span>}
          </p>
          <h1 id="profile-name">{reader.name}</h1>
          <p className="profile-bio">
            {reader.bio || "読書家の名刺は、好きな本から。"}
          </p>
          <div className="profile-stats">
            <span>
              <b>{postCount}</b> 投稿
            </span>
            {isSelf ? (
              <button type="button" onClick={() => setSheet("following")}>
                <b>{state.following.length}</b> フォロー
              </button>
            ) : null}
            {isSelf ? (
              <button type="button" onClick={() => setSheet("followers")}>
                <b>{followerCount}</b> フォロワー
              </button>
            ) : (
              <span>
                <b>{followerCount}</b> フォロワー
              </span>
            )}
            {isSelf && (
              <Link href="/reading/">
                <b>
                  {readingTime === null ? "—" : formatDuration(readingTime)}
                </b>{" "}
                読書時間
              </Link>
            )}
          </div>
          <div className="profile-reader-actions">
            {isSelf ? (
              <>
                <button className="button secondary" onClick={beginProfileEdit}>
                  <Icon name="edit" /> プロフィールを編集
                </button>
                <Link className="button secondary" href="/my-shop/">
                  <Icon name="store" /> 書店を編集
                </Link>
                <button
                  className="button secondary"
                  onClick={() => setSheet("register")}
                >
                  <Icon name="barcode" /> 本を登録
                </button>
                <button
                  className="button secondary"
                  onClick={() => setSheet("settings")}
                >
                  <Icon name="settings" /> 設定
                </button>
              </>
            ) : (
              shop && (
                <button
                  className={`button ${following ? "secondary" : "primary"}`}
                  aria-pressed={following}
                  onClick={() => {
                    actions.toggleFollow(shop.id);
                    notify(
                      following
                        ? "書店のフォローを解除しました"
                        : "この書店をフォローしました",
                    );
                  }}
                >
                  <Icon name={following ? "check" : "plus"} />
                  {following ? "フォロー中" : "書店をフォロー"}
                </button>
              )
            )}
            {shop && (
              <Link className="profile-text-link" href={`/shops/${shop.id}`}>
                <Icon name="store" />{" "}
                {isSelf ? "自分の書店を見る" : "この人の書店へ"}
                <Icon name="arrow" />
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="profile-nine" aria-labelledby="life-nine-title">
        <div className="profile-section-heading">
          <div>
            <p className="profile-eyebrow">A SMALL PORTRAIT, IN BOOKS</p>
            <h2 id="life-nine-title">人生の9冊</h2>
          </div>
          {isSelf && (
            <button
              className="button secondary profile-edit-nine"
              onClick={beginNineEdit}
            >
              <Icon name="edit" /> 編集
            </button>
          )}
        </div>
        <p className="profile-section-description">
          {isSelf
            ? "自分を少し語ってくれる本を。9冊すべてを埋める必要はありません。"
            : "心に残り続ける本。その人の輪郭が、少し見えてきます。"}
        </p>
        <div className="profile-nine-grid">
          {lifeNine.map((book, index) =>
            book ? (
              <div className="profile-nine-item" key={`${book.id}-${index}`}>
                <Link
                  href={`/books/${book.id}`}
                  className="profile-nine-book"
                  aria-label={`${book.title}の詳細を見る`}
                >
                  <span className="profile-nine-number">0{index + 1}</span>
                  <BookJacket book={book} />
                </Link>
                <Link className="profile-nine-title" href={`/books/${book.id}`}>
                  {book.title}
                </Link>
                <p className="profile-nine-author">{book.author}</p>
                {reader.nineNotes[book.id] && (
                  <button
                    className="profile-nine-note"
                    onClick={() => setSelectedNote(book.id)}
                    aria-label={`${book.title}についてのひとことを読む`}
                  >
                    <Icon name="leaf" />
                    ひとことを読む
                  </button>
                )}
              </div>
            ) : (
              <div className="profile-nine-empty" key={`empty-${index}`}>
                {isSelf ? (
                  <button
                    onClick={beginNineEdit}
                    aria-label={`${index + 1}冊目を選ぶ`}
                  >
                    <span>0{index + 1}</span>
                    <Icon name="plus" />
                    <small>一冊を選ぶ</small>
                  </button>
                ) : (
                  <div>
                    <span>0{index + 1}</span>
                    <Icon name="book" />
                    <small>これからの一冊</small>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </section>

      {isSelf && (
        <section
          className="profile-collections"
          aria-labelledby="profile-collection-title"
        >
          <div className="profile-section-heading">
            <div>
              <p className="profile-eyebrow">BOOKS TO RETURN TO</p>
              <h2 id="profile-collection-title">わたしの本のしおり</h2>
            </div>
            <span className="profile-private-label">
              <Icon name="lock" size={14} /> 自分だけ
            </span>
          </div>
          <div
            className="profile-collection-tabs"
            role="group"
            aria-label="保存した本の種類"
          >
            <button
              aria-pressed={collection === "wishlist"}
              onClick={() => setCollection("wishlist")}
            >
              <Icon name="bookmark" size={17} /> 読みたい{" "}
              <span>{state.wishlist.length}</span>
            </button>
            <button
              aria-pressed={collection === "favorites"}
              onClick={() => setCollection("favorites")}
            >
              <Icon name="star" size={17} /> お気に入り{" "}
              <span>{state.favorites.length}</span>
            </button>
            <button
              aria-pressed={collection === "library"}
              onClick={() => setCollection("library")}
            >
              <Icon name="barcode" size={17} /> 登録した本{" "}
              <span>{state.library.length}</span>
            </button>
          </div>
          <p className="profile-section-description">
            {collection === "wishlist"
              ? "気になった一冊を、次の読書の楽しみに。"
              : collection === "favorites"
                ? "何度でも戻りたい一冊を、ここに。"
                : "バーコードや手入力で登録した、あなたの本。"}
          </p>
          {state[collection].length ? (
            <div className="profile-collection-grid">
              {state[collection].map((id) => {
                const book = state.books.find((entry) => entry.id === id);
                return book ? (
                  <article className="profile-saved-book" key={id}>
                    <Link
                      href={`/books/${id}/`}
                      aria-label={`${book.title}の詳細を見る`}
                    >
                      <BookJacket book={book} />
                      <strong>{book.title}</strong>
                      <small>{book.author}</small>
                    </Link>
                    <button
                      onClick={() =>
                        collection === "wishlist"
                          ? actions.toggleWish(id)
                          : collection === "favorites"
                            ? actions.toggleFavorite(id)
                            : actions.toggleLibrary(id)
                      }
                      aria-label={`${book.title}を${collection === "wishlist" ? "読みたい" : collection === "favorites" ? "お気に入り" : "登録した本"}から外す`}
                    >
                      <Icon name="close" size={14} /> 外す
                    </button>
                  </article>
                ) : null;
              })}
            </div>
          ) : (
            <div className="profile-collection-empty">
              <p>
                {collection === "wishlist"
                  ? "読みたい本は、まだありません。"
                  : collection === "favorites"
                    ? "お気に入りの本は、まだありません。"
                    : "登録した本は、まだありません。"}
              </p>
              {collection === "library" ? (
                <button type="button" onClick={() => setSheet("register")}>
                  バーコードで本を登録 <Icon name="arrow" size={16} />
                </button>
              ) : (
                <Link href="/">
                  本の街で一冊に出会う <Icon name="arrow" size={16} />
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      <section
        className="profile-shop-section"
        aria-labelledby="profile-shop-title"
      >
        <div className="profile-section-heading">
          <div>
            <p className="profile-eyebrow">A BOOKSHOP OF ONE’S OWN</p>
            <h2 id="profile-shop-title">
              {isSelf ? "わたしの書店" : `${reader.name}さんの書店`}
            </h2>
          </div>
        </div>
        {shop ? (
          <>
            <Link
              className={`profile-shop-sign profile-shop-${shop.theme}`}
              href={`/shops/${shop.id}`}
            >
              <div className="profile-shop-mark">
                <Icon name="store" />
              </div>
              <div>
                <p className="profile-shop-tagline">
                  {shop.tagline ||
                    "あなたの愛した一冊が、誰かの愛する一冊になる。"}
                </p>
                <h3>{shop.name}</h3>
                <p className="profile-shop-description">{shop.description}</p>
              </div>
              <span className="profile-shop-enter">
                書店に入る <Icon name="arrow" />
              </span>
            </Link>
            <div className="profile-public-shelves">
              <h3>
                <Icon name="book" /> 公開している本棚
              </h3>
              {publicShelves.length ? (
                <div className="profile-shelf-links">
                  {publicShelves.map((shelf) => (
                    <Link
                      href={`/shops/${shop.id}#shelf-${shelf.id}`}
                      className="profile-shelf-link"
                      key={shelf.id}
                    >
                      <div>
                        <span className="profile-shelf-name">{shelf.name}</span>
                        <span className="profile-shelf-preview">
                          {shelf.items
                            .slice(0, 3)
                            .map(
                              (item) =>
                                state.books.find(
                                  (book) => book.id === item.bookId,
                                )?.title,
                            )
                            .filter(Boolean)
                            .join(" · ") || "空の棚にも、これからの出会いが。"}
                        </span>
                      </div>
                      <Icon name="arrow" />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="profile-muted">公開中の本棚はまだありません。</p>
              )}
            </div>
            {isSelf && (
              <Link className="button secondary" href="/my-shop">
                <Icon name="edit" /> 書店と本棚を編集する
              </Link>
            )}
          </>
        ) : (
          <div className="profile-no-shop">
            <Icon name="store" />
            <p>
              {isSelf
                ? "好きな本を並べた、あなたの小さな書店を。"
                : "この読書家の書店は、準備中です。"}
            </p>
            {isSelf && (
              <Link className="button primary" href="/my-shop">
                自分の書店をつくる <Icon name="arrow" />
              </Link>
            )}
          </div>
        )}
      </section>

      <ProfilePosts
        state={state}
        actions={actions}
        notify={notify}
        readerId={reader.id}
      />

      {sheet === "following" && (
        <Modal title="フォロー" onClose={() => setSheet(null)}>
          {followedShops.length ? (
            <ul className="people-list">
              {followedShops.map((place) => {
                const owner = state.readers.find(
                  (person) => person.id === place.ownerId,
                );
                return owner ? (
                  <li key={place.id}>
                    <Link
                      href={`/profiles/${owner.id}/`}
                      onClick={() => setSheet(null)}
                    >
                      <ReaderAvatar reader={owner} size={36} />
                      <span>
                        <b>{owner.name}</b>
                        <small>{place.name}</small>
                      </span>
                    </Link>
                    <button
                      className="button secondary"
                      onClick={() => {
                        actions.toggleFollow(place.id);
                        notify("フォローを解除しました");
                      }}
                    >
                      フォロー解除
                    </button>
                  </li>
                ) : null;
              })}
            </ul>
          ) : (
            <p className="muted">
              まだ誰もフォローしていません。気になる読書家のプロフィールや書店から、フォローできます。
            </p>
          )}
        </Modal>
      )}
      {sheet === "followers" && (
        <Modal title="フォロワー" onClose={() => setSheet(null)}>
          <p className="muted">
            まだフォロワーはいません。この試作は、あなたのブラウザの中だけで動いているため、他の人からのフォローは届きません。
          </p>
        </Modal>
      )}
      {sheet === "settings" && (
        <Modal title="設定" onClose={() => setSheet(null)}>
          <fieldset className="icon-choices">
            <legend>投稿ボタンのアイコン</legend>
            {COMPOSE_ICONS.map((icon) => (
              <label key={icon}>
                <input
                  type="radio"
                  name="compose-icon"
                  checked={state.settings.composeIcon === icon}
                  onChange={() => {
                    actions.setComposeIcon(icon);
                    notify(`投稿ボタンを${composeIconNames[icon]}にしました`);
                  }}
                />
                <span className="icon-choice-face">
                  <Icon name={icon} size={24} />
                </span>
                {composeIconNames[icon]}
              </label>
            ))}
          </fieldset>
        </Modal>
      )}
      {sheet === "register" && (
        <BarcodeRegister
          state={state}
          actions={actions}
          notify={notify}
          onClose={() => {
            setSheet(null);
            setCollection("library");
          }}
        />
      )}
      {editingProfile && (
        <Modal
          title="読書家のプロフィール"
          onClose={() => setEditingProfile(false)}
        >
          <form className="profile-form" onSubmit={saveProfile}>
            <label htmlFor="reader-name">ユーザー名</label>
            <input
              id="reader-name"
              autoComplete="nickname"
              required
              maxLength={40}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              autoFocus
            />
            <label htmlFor="reader-bio">自己紹介</label>
            <textarea
              id="reader-bio"
              maxLength={600}
              rows={5}
              value={draftBio}
              onChange={(event) => setDraftBio(event.target.value)}
              placeholder="好きな本や、いま気になっていること。"
            />
            <p className="profile-form-hint">
              この名刺は、街を訪れる読書家に公開されます。
            </p>
            <div className="profile-form-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setEditingProfile(false)}
              >
                キャンセル
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={!draftName.trim()}
              >
                保存する
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editingNine && (
        <Modal
          title="人生の9冊を選ぶ"
          onClose={() => setEditingNine(false)}
          wide
        >
          <div className="profile-nine-editor">
            <p className="profile-form-hint">
              何冊でも、好きな順番で。ひとことは任意です。
            </p>
            <div className="profile-nine-editor-list">
              {draftNine.map((id, index) => {
                const book = state.books.find((entry) => entry.id === id);
                if (!book) return null;
                return (
                  <div className="profile-nine-editor-item" key={id}>
                    <span className="profile-editor-order">{index + 1}</span>
                    <div className="profile-editor-jacket">
                      <BookJacket book={book} />
                    </div>
                    <div className="profile-editor-book-info">
                      <strong>{book.title}</strong>
                      <span>{book.author}</span>
                      <input
                        aria-label={`${book.title}へのひとこと`}
                        placeholder="この本へのひとこと（任意）"
                        maxLength={140}
                        value={draftNotes[id] ?? ""}
                        onChange={(event) =>
                          setDraftNotes((notes) => ({
                            ...notes,
                            [id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="profile-order-controls">
                      <button
                        aria-label={`${book.title}を前へ移動`}
                        disabled={index === 0}
                        onClick={() => moveNine(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`${book.title}を後ろへ移動`}
                        disabled={index === draftNine.length - 1}
                        onClick={() => moveNine(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        aria-label={`${book.title}を人生の9冊から外す`}
                        onClick={() =>
                          setDraftNine((ids) =>
                            ids.filter((entry) => entry !== id),
                          )
                        }
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {!draftNine.length && (
              <p className="profile-editor-empty">
                まだ選ばれていません。下の本から、最初の一冊を。
              </p>
            )}
            <div className="profile-nine-picker-heading">
              <h3>一冊を加える</h3>
              <span>{draftNine.length} / 9 冊</span>
            </div>
            <input
              className="profile-book-search"
              aria-label="人生の9冊に追加する本を検索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="タイトル・著者・ジャンルで探す"
            />
            {draftNine.length >= 9 && (
              <p className="profile-picker-limit">
                9冊を選びました。新しい本を加えるには、いずれかの本を外してください。
              </p>
            )}
            <div className="profile-book-picker">
              {selectableBooks.map((book) => (
                <button
                  className="profile-picker-book"
                  key={book.id}
                  aria-label={`${book.title}を人生の9冊に加える`}
                  disabled={draftNine.length >= 9}
                  onClick={() =>
                    setDraftNine((ids) =>
                      ids.length < 9 && !ids.includes(book.id)
                        ? [...ids, book.id]
                        : ids,
                    )
                  }
                >
                  <BookJacket book={book} />
                  <strong>{book.title}</strong>
                  <span>{book.author}</span>
                  <small>
                    <Icon name="plus" /> 加える
                  </small>
                </button>
              ))}
            </div>
            {!selectableBooks.length && (
              <p className="profile-muted">条件に合う本がありません。</p>
            )}
            <div className="profile-form-actions profile-nine-save">
              <button
                className="button secondary"
                onClick={() => setEditingNine(false)}
              >
                キャンセル
              </button>
              <button className="button primary" onClick={saveNine}>
                この並びを保存
              </button>
            </div>
          </div>
        </Modal>
      )}

      {selectedNote && (
        <Modal
          title={
            state.books.find((book) => book.id === selectedNote)?.title ??
            "本へのひとこと"
          }
          onClose={() => setSelectedNote(null)}
        >
          <div className="profile-note-detail">
            <Icon name="leaf" />
            <blockquote>{reader.nineNotes[selectedNote]}</blockquote>
            <p>— {reader.name}</p>
            <Link
              className="button secondary"
              href={`/books/${selectedNote}`}
              onClick={() => setSelectedNote(null)}
            >
              本の詳細へ <Icon name="arrow" />
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
