"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTownStore, usePersistenceStatus } from "../lib/store";
import type {
  TownState,
  TownActions,
  Book,
  Shop,
  ShelfItem,
  Shelf,
} from "../lib/types";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { ShopEditor } from "./ShopEditor";
import { ProfileView } from "./ProfileView";
import { StreetView } from "./StreetView";
import { BookInHand } from "./BookInHand";
import { BookActions } from "./BookActions";
import { BookReviews } from "./Social";
import { HomeView } from "./HomeView";
import { SearchView } from "./SearchView";
import { ReadingView } from "./ReadingView";
import { NotificationsView } from "./NotificationsView";
import { activeSession } from "../lib/reading";
import { unreadCount } from "../lib/notifications";

type View =
  | "town"
  | "timeline"
  | "search"
  | "reading"
  | "notifications"
  | "shop"
  | "editor"
  | "book"
  | "profile"
  | "wishlist";
type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};
type Section = "home" | "search" | "reading" | "profile";
const links: { href: string; icon: string; label: string; section: Section }[] =
  [
    { href: "/", icon: "home", label: "ホーム", section: "home" },
    { href: "/search/", icon: "search", label: "検索", section: "search" },
    {
      href: "/reading/",
      icon: "reading",
      label: "読書を開始",
      section: "reading",
    },
    {
      href: "/profiles/me/",
      icon: "user",
      label: "プロフィール",
      section: "profile",
    },
  ];
/** Which item of the main navigation a view belongs to. */
function sectionOf(view: View, selectedId?: string): Section | null {
  if (view === "town" || view === "timeline" || view === "shop") return "home";
  if (view === "search") return "search";
  if (view === "reading") return "reading";
  if (view === "editor" || view === "wishlist") return "profile";
  if (view === "profile" && (selectedId ?? "me") === "me") return "profile";
  return null;
}
export default function TownApp({
  view,
  selectedId,
}: {
  view: View;
  selectedId?: string;
}) {
  const { state, actions } = useTownStore();
  const persistence = usePersistenceStatus();
  const router = useRouter();
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [about, setAbout] = useState(false);
  const [directory, setDirectory] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const load = () => {
      if (location.hash.startsWith("#search="))
        setSearch(decodeURIComponent(location.hash.slice(8)));
    };
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, [view]);
  const shared = { state, actions, notify: setToast };
  const section = sectionOf(view, selectedId);
  const reading = Boolean(activeSession(state));
  const unread = unreadCount(state);
  return (
    <div className="town-shell">
      <aside className="town-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Icon name="store" size={31} />
          </span>
          <span>
            Book Town<small>本を読みたくなるSNS</small>
          </span>
        </Link>
        <div className="side-caption">本の向こうに、誰かがいる。</div>
        <nav aria-label="メインナビゲーション">
          {links.map((l) => (
            <Link
              key={l.section}
              href={l.href}
              className={"side-link " + (section === l.section ? "active" : "")}
              aria-current={section === l.section ? "page" : undefined}
            >
              <Icon name={l.icon} size={21} />
              {l.section === "reading" && reading ? "読書中" : l.label}
              {l.section === "reading" && reading && (
                <i className="nav-live" aria-hidden="true" />
              )}
            </Link>
          ))}
        </nav>
        <Link className="open-shop-link" href="/my-shop/">
          <Icon name="plus" size={18} />
          {state.ownShop ? "書店を整える" : "あなたも、店主に。"}
          <Icon name="arrow" size={15} />
        </Link>
        <div className="side-philosophy">
          <Icon name="leaf" size={23} />
          <p>
            あなたの愛した一冊が、
            <br />
            誰かの愛する一冊になる。
          </p>
          <small>本を愛する人を、孤独にしない。</small>
        </div>
        <Link href="/profiles/me/" className="side-me">
          <ReaderAvatar reader={state.me} size={36} />
          <span>
            <b>{state.me.name}</b>
            <small>あなたのプロフィール</small>
          </span>
          <Icon name="chevron" size={15} />
        </Link>
      </aside>
      <div className="town-workspace">
        <header className="town-topbar">
          <Link href="/" className="mobile-brand">
            <Icon name="store" size={24} />
            <span>Book Town</span>
          </Link>
          <form
            className="top-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (view !== "town")
                router.push("/#search=" + encodeURIComponent(search));
            }}
          >
            <Icon name="search" size={18} />
            <input
              placeholder="本や、気になる書店を探す"
              aria-label="本や書店を検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <div className="top-actions">
            <button className="demo-pill" onClick={() => setAbout(true)}>
              デモの街
              <Icon name="leaf" size={12} />
            </button>
            <Link
              href="/notifications/"
              className={
                "top-bell" + (view === "notifications" ? " active" : "")
              }
              aria-label={unread ? `お知らせ（未読${unread}件）` : "お知らせ"}
            >
              <Icon name="bell" size={21} />
              {unread > 0 && (
                <span className="bell-badge" aria-hidden="true">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <Link
              href="/profiles/me/"
              className="top-avatar"
              aria-label="自分のプロフィール"
            >
              <ReaderAvatar reader={state.me} size={31} />
            </Link>
          </div>
        </header>
        <div
          className="persistence-warning"
          role="status"
          hidden={persistence !== "unavailable" && persistence !== "recovered"}
        >
          {persistence === "unavailable"
            ? "このブラウザに保存できません。ブラウザの保存設定を確認してください。今の操作はページを閉じると失われます。"
            : "保存データを読み込めなかったため、デモの初期状態に戻しました。"}
        </div>
        <main className={"town-main view-" + view} key={view + selectedId}>
          {view === "town" ? (
            <HomeView {...shared} tab="shelves">
              {directory ? (
                <>
                  <button
                    className="street-return"
                    onClick={() => setDirectory(false)}
                  >
                    <Icon name="back" size={16} />
                    街の散歩に戻る
                  </button>
                  <TownHome {...shared} search={search} setSearch={setSearch} />
                </>
              ) : (
                <StreetView
                  {...shared}
                  search={search}
                  setSearch={setSearch}
                  onDirectory={() => setDirectory(true)}
                />
              )}
            </HomeView>
          ) : view === "timeline" ? (
            <HomeView {...shared} tab="timeline">
              {null}
            </HomeView>
          ) : view === "search" ? (
            <SearchView {...shared} />
          ) : view === "reading" ? (
            <ReadingView {...shared} />
          ) : view === "notifications" ? (
            <NotificationsView {...shared} />
          ) : view === "shop" ? (
            <ShopView {...shared} shopId={selectedId || ""} />
          ) : view === "book" ? (
            <BookView {...shared} bookId={selectedId || ""} />
          ) : view === "editor" ? (
            <ShopEditor {...shared} />
          ) : view === "profile" ? (
            <ProfileView {...shared} readerId={selectedId || "me"} />
          ) : (
            <Wishlist {...shared} />
          )}
        </main>
        <footer className="town-footer">
          <span>読書の終わりを、交流の始まりに。</span>
          <small>BOOK TOWN · それぞれの「好き」が集まる、本の街。</small>
        </footer>
      </div>
      <nav
        className="town-bottom-nav"
        aria-label="スマートフォンナビゲーション"
      >
        {links.map((l) => (
          <Link
            href={l.href}
            key={l.section}
            className={
              (section === l.section ? "active" : "") +
              (l.section === "reading" ? " nav-reading" : "") +
              (l.section === "reading" && reading ? " is-live" : "")
            }
            aria-current={section === l.section ? "page" : undefined}
          >
            <Icon name={l.icon} size={22} />
            <span>
              {l.section === "reading" && reading ? "読書中" : l.label}
            </span>
          </Link>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {toast}
        </div>
      )}
      {about && (
        <Modal title="Book Townへようこそ" onClose={() => setAbout(false)}>
          <p className="modal-lead">読書家の小さな書店が集まる、本の街。</p>
          <p className="muted">
            店主と書店は架空のデモデータです。本の表紙・背表紙はオリジナルの仮デザインを使っています。
          </p>
          <div className="note-box">
            あなたの書店や読みたいリストは、このブラウザのlocalStorageに保存されます。他の端末や読書家には共有されません。
          </div>
          <p className="muted">
            決まった巡り方はありません。棚を眺めたり、同じ本をたどったり、あなたのペースでどうぞ。
          </p>
          <button className="button" onClick={() => setAbout(false)}>
            街を歩いてみる
            <Icon name="arrow" size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
function TownHome({
  state,
  actions,
  notify,
  search,
  setSearch,
}: Shared & { search: string; setSearch: (s: string) => void }) {
  const [tab, setTab] = useState("shops");
  const [genre, setGenre] = useState("すべて");
  const [offset, setOffset] = useState(0);
  const [followingOnly, setFollowingOnly] = useState(false);
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const term = search.trim().toLocaleLowerCase();
  const matching = shops.filter((s) => {
    const stock = s.shelves
      .filter((sh) => sh.isPublic)
      .flatMap((sh) =>
        sh.items.map((i) => state.books.find((b) => b.id === i.bookId)),
      )
      .filter((b): b is Book => Boolean(b));
    return (
      (!followingOnly || state.following.includes(s.id)) &&
      (genre === "すべて" || stock.some((b) => b.genre === genre)) &&
      (!term ||
        (
          s.name +
          s.description +
          (s.ownerId === state.me.id
            ? state.me.name
            : (state.readers.find((r) => r.id === s.ownerId)?.name ?? "")) +
          stock.map((b) => b.title + b.author).join("")
        )
          .toLocaleLowerCase()
          .includes(term))
    );
  });
  const ordered = [
    ...matching.slice(offset % Math.max(matching.length, 1)),
    ...matching.slice(0, offset % Math.max(matching.length, 1)),
  ];
  const books = state.books.filter(
    (b) =>
      (!followingOnly ||
        shops.some(
          (s) =>
            state.following.includes(s.id) &&
            s.shelves.some(
              (sh) => sh.isPublic && sh.items.some((i) => i.bookId === b.id),
            ),
        )) &&
      (genre === "すべて" || b.genre === genre) &&
      (!term || (b.title + b.author).toLocaleLowerCase().includes(term)),
  );
  return (
    <>
      <div className="page-intro-line">
        <span className="eyebrow">WELCOME TO YOUR BOOK TOWN</span>
        <span className="intro-season">
          <Icon name="leaf" size={15} />
          今日は、どの路地へ。
        </span>
      </div>
      <section className="town-hero">
        <div className="town-hero-copy">
          <span className="hero-label">
            <i />
            自由にめぐる、読書家の街。
          </span>
          <h1>
            いつもの一冊から、
            <br />
            知らない街へ。
          </h1>
          <p>
            棚を眺めて、本と出会う。
            <br />
            その一冊から、誰かの「好き」を知る。
          </p>
          <Link
            className="hero-stroll"
            href={"/shops/" + state.shops[offset % state.shops.length].id + "/"}
          >
            気ままに一軒、のぞいてみる
            <Icon name="arrow" size={17} />
          </Link>
        </div>
        <TownDrawing />
        <span className="hero-bottom-note">
          あなたの愛した一冊が、誰かの愛する一冊になる。
        </span>
      </section>
      <div className="town-discover-heading">
        <div>
          <span className="eyebrow">SMALL SHOPS, NEW STORIES</span>
          <h2>本の街を、歩こう。</h2>
          <p>大きな店も、小さな店も。ひとつずつ、違う景色。</p>
        </div>
        <button className="text-button" onClick={() => setOffset(offset + 1)}>
          <Icon name="shuffle" size={17} />
          路地を変えてみる
        </button>
      </div>
      <div className="town-tabs" role="tablist" aria-label="発見の方法">
        <button
          role="tab"
          aria-selected={tab === "shops"}
          className={tab === "shops" ? "selected" : ""}
          onClick={() => setTab("shops")}
        >
          書店から出会う
        </button>
        <button
          role="tab"
          aria-selected={tab === "books"}
          className={tab === "books" ? "selected" : ""}
          onClick={() => setTab("books")}
        >
          一冊からたどる
        </button>
        <button
          className={"following-filter " + (followingOnly ? "selected" : "")}
          aria-pressed={followingOnly}
          onClick={() => setFollowingOnly(!followingOnly)}
        >
          フォロー中
        </button>
      </div>
      <div className="town-filter-row">
        <div className="genre-pills">
          {["すべて", ...new Set(state.books.map((b) => b.genre))].map((g) => (
            <button
              key={g}
              className={genre === g ? "selected" : ""}
              onClick={() => setGenre(g)}
            >
              {g}
            </button>
          ))}
        </div>
        <span className="browse-caption">
          人気順に並ばない、気ままな出会い。
        </span>
      </div>
      {search && (
        <div className="search-result-caption">
          「{search}」からつながる{tab === "shops" ? "書店" : "本"}
          <button onClick={() => setSearch("")}>
            <Icon name="close" size={14} />
            クリア
          </button>
        </div>
      )}
      {tab === "shops" ? (
        <div className="shop-grid">
          {ordered.map((s) => (
            <ShopCard key={s.id} shop={s} {...{ state, actions, notify }} />
          ))}
          {!ordered.length && (
            <div className="empty-state">
              <Icon name="search" size={30} />
              <h3>この路地には、まだ見つかりませんでした。</h3>
              <p>別の言葉やジャンルで、もう少し歩いてみましょう。</p>
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setGenre("すべて");
                  setFollowingOnly(false);
                }}
              >
                絞り込みを戻す
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="catalog-grid">
          {books.map((b) => (
            <article className="catalog-book" key={b.id}>
              <Link href={"/books/" + b.id + "/"}>
                <BookJacket book={b} />
                <h3>{b.title}</h3>
                <p>{b.author}</p>
              </Link>
              <span>{b.genre}</span>
              <button
                className={
                  "text-button " +
                  (state.wishlist.includes(b.id) ? "saved" : "")
                }
                onClick={() => {
                  actions.toggleWish(b.id);
                  notify(
                    state.wishlist.includes(b.id)
                      ? "読みたいリストから外しました"
                      : "読みたいリストに加えました",
                  );
                }}
              >
                <Icon
                  name={state.wishlist.includes(b.id) ? "check" : "plus"}
                  size={14}
                />
                {state.wishlist.includes(b.id)
                  ? "読みたいに登録済み"
                  : "読みたい"}
              </button>
            </article>
          ))}
          {!books.length && (
            <div className="empty-state">
              この条件の本は見つかりませんでした。
            </div>
          )}
        </div>
      )}
      <div className="town-end">
        <Icon name="leaf" size={23} />
        <p>見つけた一冊の向こうにも、誰かがいる。</p>
        <Link href="/my-shop/" className="text-button">
          あなたの「好き」も、並べてみませんか。
          <Icon name="arrow" size={16} />
        </Link>
      </div>
    </>
  );
}
function ShopCard({ shop, state, actions, notify }: Shared & { shop: Shop }) {
  const owner =
    shop.ownerId === "me"
      ? state.me
      : state.readers.find((r) => r.id === shop.ownerId);
  const publicShelves = shop.shelves.filter((s) => s.isPublic);
  const smallBooks = publicShelves
    .flatMap((s) => s.items)
    .slice(0, 10)
    .map((i) => state.books.find((b) => b.id === i.bookId))
    .filter((b): b is Book => Boolean(b));
  const followed = state.following.includes(shop.id);
  return (
    <article className="shop-card">
      <Link
        href={"/shops/" + shop.id + "/"}
        className={"shop-front theme-" + shop.theme}
        aria-label={shop.name + "に入る"}
      >
        <div className="shop-front-roof" />
        <div className="shop-front-sign">
          <Icon name="store" size={19} />
          <h3>{shop.name}</h3>
          <span>{shop.tagline}</span>
        </div>
        <div className="shop-window">
          <div className="tiny-books">
            {smallBooks.map((b, i) => (
              <i
                key={b.id + i}
                style={{
                  background: b.color,
                  height: 36 + (b.height % 19),
                  width: 11 + (b.thickness % 5),
                  color: b.ink,
                }}
              >
                <span>{b.title}</span>
              </i>
            ))}
          </div>
          <div className="tiny-shelf" />
        </div>
        <span className="enter-shop">
          のぞいてみる
          <Icon name="arrow" size={15} />
        </span>
      </Link>
      <div className="shop-card-info">
        <div className="shop-owner-line">
          {owner && (
            <Link href={"/profiles/" + owner.id + "/"}>
              <ReaderAvatar reader={owner} size={27} />
              <span>
                店主 <b>{owner.name}</b>
              </span>
            </Link>
          )}
          <small className="demo-tag">
            {shop.demo ? "デモ書店" : "あなたの書店"}
          </small>
        </div>
        <p>{shop.description}</p>
        <div className="shop-card-bottom">
          <span>
            <Icon name="book" size={13} />
            {publicShelves.length}つの棚
            <em> · {shop.followers + Number(followed)}人がフォロー</em>
          </span>
          {shop.ownerId !== "me" && (
            <button
              className={"follow-button " + (followed ? "followed" : "")}
              aria-label={
                shop.name + (followed ? "のフォローを解除" : "をフォロー")
              }
              aria-pressed={followed}
              onClick={() => {
                actions.toggleFollow(shop.id);
                notify(
                  followed
                    ? "フォローを解除しました"
                    : shop.name + "をフォローしました",
                );
              }}
            >
              <Icon name={followed ? "check" : "plus"} size={15} />
              {followed ? "フォロー中" : "フォロー"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
function ShopView({
  state,
  actions,
  notify,
  shopId,
}: Shared & { shopId: string }) {
  const shop =
    shopId === "mine"
      ? state.ownShop
      : state.shops.find((s) => s.id === shopId);
  const [selected, setSelected] = useState<{
    item: ShelfItem;
    shelf: Shelf;
  } | null>(null);
  if (!shop)
    return (
      <div className="empty-state">
        <Icon name="store" size={34} />
        <h1>あなたの小さな書店を、ここに。</h1>
        <p>店名と紹介を書いて、好きな本を並べてみましょう。</p>
        <Link href="/my-shop/" className="button">
          書店をつくる
          <Icon name="plus" size={17} />
        </Link>
      </div>
    );
  const owner =
    shop.ownerId === "me"
      ? state.me
      : state.readers.find((r) => r.id === shop.ownerId);
  const shelves = shop.shelves.filter((s) => s.isPublic);
  const followed = state.following.includes(shop.id);
  return (
    <>
      <Link href="/" className="back-link">
        <Icon name="back" size={16} />
        本の街へ戻る
      </Link>
      <section className={"shop-hero theme-" + shop.theme}>
        <div className="shop-hero-rule" />
        <span className="eyebrow">A SMALL BOOKSHOP, A PERSONAL WORLD</span>
        <h1>{shop.name}</h1>
        <p className="shop-tagline">{shop.tagline}</p>
        <p className="shop-introduction">{shop.description}</p>
        <div className="shop-hero-bottom">
          {owner && (
            <Link
              href={"/profiles/" + owner.id + "/"}
              className="owner-profile-link"
            >
              <ReaderAvatar reader={owner} size={35} />
              <span>
                店主 <b>{owner.name}</b>
                <small>
                  プロフィールをのぞく
                  <Icon name="arrow" size={12} />
                </small>
              </span>
            </Link>
          )}
          <span className="shop-social-note">
            {shop.demo ? "デモ書店 · " : ""}
            {shop.followers + Number(followed)}人がフォロー
          </span>
          {shop.ownerId === "me" ? (
            <Link href="/my-shop/" className="button secondary">
              <Icon name="edit" size={15} />
              書店を編集
            </Link>
          ) : (
            <button
              className={"button " + (followed ? "secondary" : "")}
              aria-pressed={followed}
              onClick={() => {
                actions.toggleFollow(shop.id);
                notify(
                  followed
                    ? "フォローを解除しました"
                    : "書店をフォローしました",
                );
              }}
            >
              <Icon name={followed ? "check" : "plus"} size={16} />
              {followed ? "フォロー中" : "書店をフォロー"}
            </button>
          )}
        </div>
      </section>
      <div className="interior-heading">
        <div>
          <span className="eyebrow">TAKE YOUR TIME, LOOK AROUND</span>
          <h2>棚の前で、ひと休み。</h2>
        </div>
        <span>
          <Icon name="book" size={15} />
          本を選ぶと、店主のPOPが読めます
        </span>
      </div>
      <div className="shop-shelf-index">
        {shelves.map((s) => (
          <a key={s.id} href={"#shelf-" + s.id}>
            {s.name}
            <Icon name="chevron" size={12} />
          </a>
        ))}
      </div>
      {shelves.map((s, i) => (
        <section
          className="store-shelf-section"
          id={"shelf-" + s.id}
          key={s.id}
        >
          <div className="store-shelf-label">
            <span>{String(i + 1).padStart(2, "0")}</span>
            <h3>{s.name}</h3>
            <small>{s.items.length}冊の選書</small>
          </div>
          <WoodenShelf
            shelf={s}
            books={state.books}
            onSelect={(item) => setSelected({ item, shelf: s })}
          />
          <div className="shelf-under-note">
            <span>店主の感性で、並べられた一冊たち。</span>
            <small>
              横にめくって、棚の奥へ
              <Icon name="arrow" size={13} />
            </small>
          </div>
        </section>
      ))}
      {!shelves.length && (
        <div className="empty-state">
          <Icon name="book" size={30} />
          <h3>この店の棚は、これから育ちます。</h3>
          {shop.ownerId === "me" && (
            <Link href="/my-shop/" className="button secondary">
              最初の棚をつくる
            </Link>
          )}
        </div>
      )}
      {owner && (
        <div className="shop-owner-footer">
          <ReaderAvatar reader={owner} size={45} />
          <div>
            <b>{owner.name}の、好きの輪郭。</b>
            <p>人生の9冊から、店主をもう少し知ってみる。</p>
          </div>
          <Link href={"/profiles/" + owner.id + "/"} className="text-button">
            プロフィールへ
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      )}
      {selected && (
        <BookInHand
          key={`${shop.id}:${selected.shelf.id}:${selected.item.id}`}
          shop={shop}
          shelf={selected.shelf}
          itemId={selected.item.id}
          state={state}
          actions={actions}
          notify={notify}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function BookView({
  state,
  actions,
  notify,
  bookId,
}: Shared & { bookId: string }) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book)
    return <div className="empty-state">この本は見つかりませんでした。</div>;
  const matches = [
    ...state.shops,
    ...(state.ownShop ? [state.ownShop] : []),
  ].flatMap((shop) =>
    shop.shelves
      .filter((s) => s.isPublic)
      .flatMap((shelf) =>
        shelf.items
          .filter((i) => i.bookId === book.id)
          .map((item) => ({ shop, shelf, item })),
      ),
  );
  return (
    <>
      <Link href="/" className="back-link">
        <Icon name="back" size={16} />
        本の街へ
      </Link>
      <section className="book-page-hero">
        <BookJacket book={book} />
        <div>
          <span className="eyebrow">ONE BOOK, MANY WORLDS</span>
          <span className="genre-tag">{book.genre}</span>
          <h1>{book.title}</h1>
          <p className="book-page-author">{book.author}</p>
          <p className="book-summary">{book.summary}</p>
          <BookActions
            book={book}
            state={state}
            actions={actions}
            notify={notify}
          />
          <span className="jacket-disclaimer">
            表紙はデモ用のオリジナルデザインです
          </span>
        </div>
      </section>
      <BookReviews
        book={book}
        state={state}
        actions={actions}
        notify={notify}
      />
      <div className="book-path-heading">
        <span className="eyebrow">FOLLOW THE BOOK, MEET THE READER</span>
        <h2>この本を並べている書店</h2>
        <p>同じ一冊でも、棚が変われば、出会う言葉も変わる。</p>
      </div>
      <div className="stockist-list">
        {matches.map(({ shop, shelf, item }) => (
          <article
            className={"stockist theme-" + shop.theme}
            key={shop.id + shelf.id + item.id}
          >
            <div className="stockist-title">
              <Link href={"/shops/" + shop.id + "/#shelf-" + shelf.id}>
                <Icon name="store" size={21} />
                <h3>{shop.name}</h3>
                <Icon name="arrow" size={16} />
              </Link>
              {shop.demo && <small className="demo-tag">デモ書店</small>}
            </div>
            <Link
              href={"/shops/" + shop.id + "/#shelf-" + shelf.id}
              className="stockist-shelf"
            >
              <Icon name="book" size={14} />「{shelf.name}」の棚
              <Icon name="chevron" size={13} />
            </Link>
            <blockquote>
              {item.pop || "この棚では、本そのものが語りかけます。"}
            </blockquote>
            <div className="stockist-bottom">
              <span>
                {item.display === "face"
                  ? "表紙を向けて、大切な一冊に。"
                  : "背表紙を並べて、隣の一冊と。"}
              </span>
              <Link
                href={"/shops/" + shop.id + "/#shelf-" + shelf.id}
                className="text-button"
              >
                この棚を見に行く
                <Icon name="arrow" size={16} />
              </Link>
            </div>
          </article>
        ))}
        {!matches.length && (
          <div className="empty-state">
            <h3>この本の、最初の居場所を。</h3>
            <p>あなたの書店に並べて、POPを書いてみませんか。</p>
            <Link href="/my-shop/" className="button secondary">
              自分の書店へ
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
function Wishlist({ state, actions, notify }: Shared) {
  const books = state.books.filter((b) => state.wishlist.includes(b.id));
  return (
    <>
      <span className="eyebrow">BOOKS TO COME BACK TO</span>
      <h1 className="page-title">いつか、読みたい一冊。</h1>
      <p className="page-subtitle">街を歩いて見つけた、次の楽しみ。</p>
      {books.length ? (
        <div className="catalog-grid wishlist-grid">
          {books.map((b) => (
            <article className="catalog-book" key={b.id}>
              <Link href={"/books/" + b.id + "/"}>
                <BookJacket book={b} />
                <h3>{b.title}</h3>
                <p>{b.author}</p>
              </Link>
              <span>{b.genre}</span>
              <button
                className="text-button"
                onClick={() => {
                  actions.toggleWish(b.id);
                  notify("読みたいリストから外しました");
                }}
              >
                <Icon name="check" size={14} />
                リストから外す
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="bookmark" size={34} />
          <h2>次の一冊は、どの棚にいるでしょう。</h2>
          <p>気になる本を「読みたい」に加えると、ここに並びます。</p>
          <Link href="/" className="button secondary">
            街を歩いてみる
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      )}
    </>
  );
}
function TownDrawing() {
  return (
    <div className="town-drawing" aria-hidden="true">
      <svg viewBox="0 0 430 260">
        <ellipse
          cx="220"
          cy="237"
          rx="186"
          ry="10"
          fill="#d8d5be"
          opacity=".65"
        />
        <path
          d="M56 236V102l8-2v136m-4-135V64"
          stroke="#72806b"
          strokeWidth="2"
        />
        <path
          d="M60 62c-12 0-12 22 0 22s12-22 0-22Z"
          fill="#e4d3a2"
          stroke="#79806e"
          strokeWidth="2"
        />
        <path d="M28 236h379" stroke="#babca8" strokeWidth="2" />
        <rect x="87" y="84" width="119" height="152" rx="2" fill="#e2d9bf" />
        <rect x="102" y="115" width="87" height="31" fill="#425d48" />
        <text
          x="145"
          y="134"
          fill="#e5e5d2"
          fontSize="10"
          fontFamily="serif"
          textAnchor="middle"
          letterSpacing="3"
        >
          本と、ひと。
        </text>
        <path d="M87 84h119l-11-13H97Z" fill="#b5b393" />
        <rect x="100" y="159" width="63" height="58" fill="#c9c7ae" />
        <rect x="169" y="154" width="24" height="82" fill="#6a7b60" />
        <rect x="103" y="169" width="59" height="39" fill="#52634c" />
        <path d="M105 193h55M105 207h55" stroke="#b89b70" strokeWidth="3" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
          <rect
            key={n}
            x={109 + n * 6}
            y={176 + (n % 3) * 3}
            width="4"
            height={15 - (n % 3) * 3}
            fill={["#dfd4b1", "#819783", "#af7960"][n % 3]}
          />
        ))}
        <path d="M91 147h111l-5 14H94Z" fill="#f4eedc" />
        {[0, 1, 2, 3, 4].map((n) => (
          <path
            key={n}
            d={`M${93 + n * 23} 147h12l-1 14h-13z`}
            fill="#5c7455"
          />
        ))}
        <rect x="208" y="43" width="141" height="193" rx="2" fill="#d8dfcf" />
        <path d="M201 43h153l-12-17H220Z" fill="#889a80" />
        <rect x="222" y="63" width="33" height="30" fill="#f2eada" />
        <rect x="266" y="63" width="33" height="30" fill="#f2eada" />
        <rect x="309" y="63" width="26" height="30" fill="#f2eada" />
        <path
          d="M237 64v29m45-29v29m40-29v29"
          stroke="#a5b39a"
          strokeWidth="2"
        />
        <rect x="220" y="112" width="117" height="28" fill="#536f5a" />
        <text
          x="278"
          y="130"
          fill="#eee8cc"
          fontSize="11"
          textAnchor="middle"
          fontFamily="serif"
          letterSpacing="2"
        >
          BOOK TOWN
        </text>
        <rect x="221" y="155" width="72" height="66" fill="#80947c" />
        <rect x="303" y="154" width="29" height="82" fill="#657e64" />
        <path d="M222 183h71m-71 23h71" stroke="#bd9b6d" strokeWidth="4" />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <rect
            key={n}
            x={227 + n * 7}
            y={165 + (n % 3) * 2}
            width="5"
            height={16 - (n % 3) * 2}
            fill={["#e7d2a0", "#a8bfa0", "#b77f65", "#e4ded0"][n % 4]}
          />
        ))}
        <path d="M213 143h129l-5 17H218Z" fill="#efe9d7" />
        {[0, 1, 2, 3, 4].map((n) => (
          <path
            key={n}
            d={`M${214 + n * 26} 143h13l2 17h-14z`}
            fill="#607d63"
          />
        ))}
        <rect x="354" y="170" width="40" height="66" fill="#ded3bc" />
        <path d="M358 170h33l-4-8h-25Z" fill="#ab9878" />
        <rect x="360" y="178" width="29" height="44" fill="#506345" />
        <text x="375" y="194" fontSize="6" textAnchor="middle" fill="#eae2cd">
          OPEN
        </text>
        <path d="M369 207h12m-12 4h12m-12 4h8" stroke="#c5caac" />
        <path
          d="M44 238v-31m-1 19c-15-4-15-17-7-20 11 4 12 11 7 20m1-6c15-1 19-12 12-18-9 0-16 9-12 18"
          fill="#7f9472"
        />
        <path d="M20 215h28l-4 22H25Z" fill="#b09a78" />
        <path d="M322 236h34" stroke="#78906d" strokeWidth="2" />
      </svg>
      <span>A LITTLE TOWN, A WORLD OF BOOKS.</span>
    </div>
  );
}
