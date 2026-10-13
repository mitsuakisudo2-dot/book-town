"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
  COMPOSE_ICONS,
  ownTagline,
  type ComposeIcon,
  type TownActions,
  type TownState,
} from "../lib/types";
import { useTownBackend } from "../lib/store";
import { readerPosts } from "../lib/social";
import { formatDuration, readingTotals } from "../lib/reading";
import { bookPath } from "../lib/books";
import { BarcodeRegister } from "./BarcodeRegister";
import { linkLabel, normalizeLink, PROFILE_LINK_LIMIT } from "../lib/links";
import { handleProblem, normalizeHandle } from "../lib/handles";
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
import { isDatabaseId, profilePath, shopPath } from "../lib/paths";
import { ReportButton } from "./Report";
import { RecordShelf } from "./ReadingRecords";
import { BackLink } from "./BackLink";
import { SavedShops } from "./SavedShops";
import { setReadingPeekOpen, useReadingPeekOpen } from "../lib/reading-peek";

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
  const savedIn = useTownBackend();
  const reader = isSelf
    ? state.me
    : state.readers.find((person) => person.id === readerId);
  const shop = isSelf
    ? state.ownShop
    : state.shops.find((place) => place.ownerId === readerId);
  const [collection, setCollection] = useState<
    "wishlist" | "favorites" | "library"
  >("wishlist");
  const peekOpen = useReadingPeekOpen();
  const [sheet, setSheet] = useState<
    "following" | "followers" | "settings" | "register" | null
  >(null);
  const clock = useClock(60_000);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingNine, setEditingNine] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [draftLinks, setDraftLinks] = useState<string[]>([]);
  const [draftHandle, setDraftHandle] = useState("");
  const [handleError, setHandleError] = useState("");
  const [linkError, setLinkError] = useState("");
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
    setDraftLinks(reader.links?.length ? reader.links : [""]);
    setDraftHandle(reader.handle);
    setHandleError("");
    setLinkError("");
    setEditingProfile(true);
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    const handle = normalizeHandle(draftHandle);
    const problem = handleProblem(handle, state.readers);
    if (problem) {
      setHandleError(problem);
      return;
    }
    const filled = draftLinks.map((link) => link.trim()).filter(Boolean);
    const links = filled.map(normalizeLink);
    if (links.some((link) => !link)) {
      setLinkError(
        "URLとして読めないものがあります。https:// から始まるWebページのアドレスを入れてください。",
      );
      return;
    }
    actions.updateProfile(name, draftBio.trim(), links as string[], handle);
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
      {/* One's own profile is a place of its own in the navigation. */}
      {!isSelf && <BackLink className="profile-back" />}

      <section className="profile-reader" aria-labelledby="profile-name">
        <div className="profile-reader-avatar">
          <ReaderAvatar reader={reader} />
        </div>
        <div className="profile-reader-text">
          <p className="profile-eyebrow">
            READER IN BOOK TOWN{" "}
            {!isSelf && !isDatabaseId(reader.id) && (
              <span className="profile-demo">見本の読書家</span>
            )}
          </p>
          <h1 id="profile-name">{reader.name}</h1>
          <p className="profile-handle">@{reader.handle}</p>
          <p className="profile-bio">
            {reader.bio || "読書家の名刺は、好きな本から。"}
          </p>
          {reader.links && reader.links.length > 0 && (
            <ul className="profile-links" aria-label="リンク">
              {reader.links.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    title={url}
                  >
                    <Icon name="link" size={14} />
                    {linkLabel(url)}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {/* Only what has happened is counted: an empty count is left out. */}
          {(postCount > 0 ||
            (isSelf && state.following.length > 0) ||
            (followerCount > 0 && (isSelf || !isDatabaseId(reader.id))) ||
            (isSelf && Boolean(readingTime))) && (
            <div className="profile-stats">
              {postCount > 0 && (
                <span>
                  <b>{postCount}</b> 投稿
                </span>
              )}
              {isSelf && state.following.length > 0 && (
                <button type="button" onClick={() => setSheet("following")}>
                  <b>{state.following.length}</b> フォロー
                </button>
              )}
              {/* Nobody counts a reader's followers but the reader. */}
              {followerCount > 0 && isSelf && (
                <button type="button" onClick={() => setSheet("followers")}>
                  <b>{followerCount}</b> フォロワー
                </button>
              )}
              {isSelf && Boolean(readingTime) && (
                <Link href="/reading/">
                  <b>{formatDuration(readingTime ?? 0)}</b> 読書時間
                </Link>
              )}
            </div>
          )}
          <div className="profile-reader-actions">
            {isSelf ? (
              <>
                {/* One main step (the shop); the rest stay small beside it. */}
                <Link className="button primary" href="/my-shop/">
                  <Icon name="store" /> {shop ? "書店を整える" : "書店をひらく"}
                </Link>
                <button className="button secondary" onClick={beginProfileEdit}>
                  <Icon name="edit" /> プロフィールを編集
                </button>
                <span className="profile-minor-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSheet("register")}
                  >
                    <Icon name="barcode" size={15} /> 本を登録
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSheet("settings")}
                  >
                    <Icon name="settings" size={15} /> 設定
                  </button>
                </span>
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
              <Link className="profile-text-link" href={shopPath(shop.id)}>
                <Icon name="store" />{" "}
                {isSelf ? "自分の書店を見る" : "この人の書店へ"}
                <Icon name="arrow" />
              </Link>
            )}
            {!isSelf && (
              <ReportButton
                className="report-link"
                target={{
                  kind: "profile",
                  id: reader.id,
                  name: reader.name + "さん",
                }}
              >
                <Icon name="flag" size={13} />
                通報
              </ReportButton>
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
                  href={bookPath(book.id)}
                  className="profile-nine-book"
                  aria-label={`${book.title}の詳細を見る`}
                >
                  <span className="profile-nine-number">0{index + 1}</span>
                  <BookJacket book={book} />
                </Link>
                <Link className="profile-nine-title" href={bookPath(book.id)}>
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

      <RecordShelf
        state={state}
        actions={actions}
        notify={notify}
        readerId={readerId}
      />

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
              <Icon name="bookmark" size={17} /> 読みたい
              <span>{state.wishlist.length || ""}</span>
            </button>
            <button
              aria-pressed={collection === "favorites"}
              onClick={() => setCollection("favorites")}
            >
              <Icon name="star" size={17} /> お気に入り
              <span>{state.favorites.length || ""}</span>
            </button>
            <button
              aria-pressed={collection === "library"}
              onClick={() => setCollection("library")}
            >
              <Icon name="barcode" size={17} /> 登録
              <span>{state.library.length || ""}</span>
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
                      href={bookPath(id)}
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

      {isSelf && <SavedShops state={state} />}

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
              href={shopPath(shop.id)}
            >
              <div className="profile-shop-mark">
                <Icon name="store" />
              </div>
              <div>
                {ownTagline(shop) && (
                  <p className="profile-shop-tagline">{ownTagline(shop)}</p>
                )}
                <h3>{shop.name}</h3>
                <p className="profile-shop-description">{shop.description}</p>
              </div>
              <span className="profile-shop-enter">
                書店に入る <Icon name="arrow" />
              </span>
            </Link>
            {(isSelf || publicShelves.length > 0) && (
              <div className="profile-public-shelves">
                <h3>
                  <Icon name="book" /> 公開している本棚
                </h3>
                {publicShelves.length ? (
                  <div className="profile-shelf-links">
                    {publicShelves.map((shelf) => (
                      <Link
                        href={shopPath(shop.id, shelf.id)}
                        className="profile-shelf-link"
                        key={shelf.id}
                      >
                        <div>
                          <span className="profile-shelf-name">
                            {shelf.name}
                          </span>
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
                              .join(" · ") ||
                              "空の棚にも、これからの出会いが。"}
                          </span>
                        </div>
                        <Icon name="arrow" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="profile-muted">
                    棚を「公開」にすると、ここに並び、街の人が見に来られます。
                  </p>
                )}
              </div>
            )}
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
                3分で本屋を開く <Icon name="arrow" />
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
                      href={profilePath(owner.id)}
                      onClick={() => setSheet(null)}
                    >
                      <ReaderAvatar reader={owner} size={36} />
                      <span>
                        <b>{owner.name}</b>
                        <small>
                          @{owner.handle}・{place.name}
                        </small>
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
            {savedIn === "local"
              ? "まだフォロワーはいません。この試作は、あなたのブラウザの中だけで動いているため、他の人からのフォローは届きません。"
              : shop
                ? `あなたの書店を${followerCount}人がフォローしています。この数は、あなたにだけ見えています。`
                : "書店を開くと、ほかの読書家にフォローしてもらえるようになります。"}
          </p>
        </Modal>
      )}
      {sheet === "settings" && (
        <Modal title="設定" onClose={() => setSheet(null)}>
          <fieldset className="record-visibility">
            <legend>
              読み終えた本の記録（これから残す記録のはじめの公開範囲）
            </legend>
            <label>
              <input
                type="radio"
                name="reading-public"
                checked={state.settings.readingPublic}
                onChange={() => {
                  actions.setReadingPublic(true);
                  notify("これからの記録は、はじめから公開になります");
                }}
              />
              公開
            </label>
            <label>
              <input
                type="radio"
                name="reading-public"
                checked={!state.settings.readingPublic}
                onChange={() => {
                  actions.setReadingPublic(false);
                  notify("これからの記録は、はじめは自分だけになります");
                }}
              />
              自分だけ
            </label>
          </fieldset>
          <fieldset className="record-visibility">
            <legend>読書中の画面</legend>
            <label>
              <input
                type="checkbox"
                checked={peekOpen}
                onChange={(event) => {
                  setReadingPeekOpen(event.target.checked);
                  notify(
                    event.target.checked
                      ? "読書中も、街の言葉を開いておきます"
                      : "読書中は、街の言葉をたたんでおきます",
                  );
                }}
              />
              みんなのつぶやきを、たたまずに開いておく
            </label>
          </fieldset>
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
            <label htmlFor="reader-handle">ユーザーID</label>
            <div className="profile-handle-field">
              <span aria-hidden="true">@</span>
              <input
                id="reader-handle"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={21}
                value={draftHandle}
                onChange={(event) => {
                  setHandleError("");
                  setDraftHandle(event.target.value);
                }}
                aria-describedby="reader-handle-hint"
              />
            </div>
            <p
              id="reader-handle-hint"
              className={
                handleError ? "profile-link-error" : "profile-form-hint"
              }
              role={handleError ? "alert" : undefined}
            >
              {handleError ||
                "3〜20文字の半角英小文字・数字・_。ほかの読書家と同じIDは使えません。"}
            </p>
            <label htmlFor="reader-bio">自己紹介</label>
            <textarea
              id="reader-bio"
              maxLength={600}
              rows={5}
              value={draftBio}
              onChange={(event) => setDraftBio(event.target.value)}
              placeholder="好きな本や、いま気になっていること。"
            />
            <fieldset className="profile-link-fields">
              <legend>リンク（note・YouTube・公式サイトなど）</legend>
              {draftLinks.map((link, index) => (
                <div key={index} className="profile-link-row">
                  <label className="sr-only" htmlFor={`reader-link-${index}`}>
                    リンク{index + 1}
                  </label>
                  <input
                    id={`reader-link-${index}`}
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    maxLength={300}
                    placeholder="https://note.com/..."
                    value={link}
                    onChange={(event) => {
                      setLinkError("");
                      setDraftLinks(
                        draftLinks.map((entry, position) =>
                          position === index ? event.target.value : entry,
                        ),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="profile-link-remove"
                    aria-label={`リンク${index + 1}を削除`}
                    onClick={() =>
                      setDraftLinks(
                        draftLinks.length > 1
                          ? draftLinks.filter(
                              (_, position) => position !== index,
                            )
                          : [""],
                      )
                    }
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              {draftLinks.length < PROFILE_LINK_LIMIT && (
                <button
                  type="button"
                  className="profile-link-add"
                  onClick={() => setDraftLinks([...draftLinks, ""])}
                >
                  <Icon name="plus" size={14} /> リンクを追加
                </button>
              )}
              {linkError && (
                <p className="profile-link-error" role="alert">
                  {linkError}
                </p>
              )}
            </fieldset>
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
              href={bookPath(selectedNote)}
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
