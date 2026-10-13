"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useTownStore,
  usePersistenceStatus,
  useTownBackend,
} from "../lib/store";
import { saveWarning } from "../lib/persistence";
import { useAccountState } from "../lib/account-session";
import {
  ME_ID,
  ownTagline,
  type TownState,
  type TownActions,
  type ShelfItem,
  type Shelf,
  type Book,
  type Notify,
  type ToastUndo,
} from "../lib/types";
import {
  BookJacket,
  CoverCredit,
  GoogleCoversCredit,
  Icon,
  Modal,
  ReaderAvatar,
} from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { ShopEditor } from "./ShopEditor";
import { ProfileView } from "./ProfileView";
import { StreetView } from "./StreetView";
import { BookInHand, heldBookOf } from "./BookInHand";
import { BookActions, BookPrice, BookPurchase, bookNote } from "./BookActions";
import { BookReviews, FoldedWords } from "./Social";
import { HomeView } from "./HomeView";
import { SearchView } from "./SearchView";
import { ReadingView } from "./ReadingView";
import { NotificationsView } from "./NotificationsView";
import { activeSession } from "../lib/reading";
import { unreadCount } from "../lib/notifications";
import { bookPath } from "../lib/books";
import "./usability.css";
import { useHorizontalSwipe } from "./useHorizontalSwipe";
import "./shop-journey.css";
import { WalkView } from "./WalkView";
import { profilePath, shopPath, walkPath } from "../lib/paths";
import { AccountInvite, VisitorPage } from "./VisitorInvite";
import { CoverRemovalLink, ReportButton, ReportDialog } from "./Report";
import { BookFeelings } from "./ReadingRecords";
import { accountRequested, closeAccountRequest } from "../lib/visitor";
import { closeReport } from "../lib/report";
import { carriedToast, noteToast } from "../lib/carried-toast";
import {
  SAMPLE_NOTICE,
  onSampleRefusal,
  refusedForSample,
} from "../lib/sample-notice";
import { BackLink } from "./BackLink";
import { notePageShown } from "../lib/in-town";
import { replaceAddress } from "../lib/url-state";
import { useLayerReturn } from "../lib/back-layer";

type View =
  | "town"
  | "walk"
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
  notify: Notify;
};
type Section = "home" | "search" | "walk" | "reading" | "profile";
const links: { href: string; icon: string; label: string; section: Section }[] =
  [
    { href: "/", icon: "home", label: "ホーム", section: "home" },
    { href: "/search/", icon: "search", label: "検索", section: "search" },
    { href: "/walk/", icon: "store", label: "書店めぐり", section: "walk" },
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
  if (view === "walk") return "walk";
  // A shop's page is part of walking the shops, wherever it was opened from.
  if (view === "shop") return "walk";
  if (view === "town" || view === "timeline") return "home";
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
  const savedIn = useTownBackend();
  const warning = saveWarning(savedIn, persistence);
  const account = useAccountState();
  const router = useRouter();
  const [toast, setToast] = useState<ShownToast | null>(() => {
    const message = carriedToast();
    return message ? { message } : null;
  });
  const [search, setSearch] = useState("");
  const [about, setAbout] = useState(false);
  useEffect(() => notePageShown(), [view, selectedId]);
  useEffect(() => {
    if (!toast || toast.held) return;
    // A toast that can be undone stays long enough to be undone, and stays
    // while the pointer or the focus is on it (its time starts again after).
    const timer = setTimeout(() => setToast(null), toast.undo ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const holdToast = useCallback(
    (held: boolean) =>
      setToast((shown) =>
        shown && !!shown.held !== held ? { ...shown, held } : shown,
      ),
    [],
  );
  useEffect(() => {
    const load = () => {
      if (location.hash.startsWith("#search="))
        setSearch(decodeURIComponent(location.hash.slice(8)));
    };
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, [view]);
  // On the street, what is typed in the top search stays in the address, so
  // coming back finds the same shops.
  useEffect(() => {
    if (view !== "town") return;
    if (!search && !location.hash.startsWith("#search=")) return;
    replaceAddress({
      hash: search ? "search=" + encodeURIComponent(search) : null,
    });
  }, [view, search]);
  // A dialog about something on the page does not follow the reader to the next one.
  useEffect(() => {
    closeReport();
    closeAccountRequest();
  }, [view, selectedId]);
  // When a visitor's change became an invitation to sign in, nothing was done,
  // so the message saying it was done stays quiet.
  // A like or a follow meant for a 見本 says why nothing happened.
  useEffect(() => onSampleRefusal((message) => setToast({ message })), []);
  const notify = useCallback<Notify>((message, undo) => {
    if (accountRequested() || refusedForSample()) return;
    noteToast(message);
    setToast({ message, undo });
  }, []);
  const shared = { state, actions, notify };
  const section = sectionOf(view, selectedId);
  // A visitor who is not signed in has no pages of their own yet.
  const visitor = savedIn === "visitor";
  const ownPage =
    view === "editor"
      ? "shop"
      : view === "wishlist"
        ? "wishlist"
        : view === "notifications"
          ? "notifications"
          : view === "profile" && (selectedId || "me") === "me"
            ? "profile"
            : null;
  const reading = Boolean(activeSession(state));
  const unread = unreadCount(state);
  return (
    <div className={"town-shell" + (view === "walk" ? " is-walk" : "")}>
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
        {visitor ? (
          <Link href="/login/" className="side-me">
            <span className="side-me-guest" aria-hidden="true">
              <Icon name="user" size={18} />
            </span>
            <span>
              <b>ログイン</b>
              <small>見るだけなら、このままで</small>
            </span>
            <Icon name="chevron" size={15} />
          </Link>
        ) : (
          <Link href="/profiles/me/" className="side-me">
            <ReaderAvatar reader={state.me} size={36} />
            <span>
              <b>{state.me.name}</b>
              <small>あなたのプロフィール</small>
            </span>
            <Icon name="chevron" size={15} />
          </Link>
        )}
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
            <button
              className="demo-pill"
              onClick={() => setAbout(true)}
              aria-label={
                (savedIn === "local" ? "デモの街" : "本の街") + "について"
              }
            >
              {savedIn === "local" ? "デモの街" : "本の街"}
              <Icon name="leaf" size={12} />
            </button>
            {account.status === "signed-out" && (
              <Link className="demo-pill top-login" href="/login/">
                ログイン
              </Link>
            )}
            <Link
              href="/notifications/"
              className={
                "top-bell" + (view === "notifications" ? " active" : "")
              }
              aria-label={
                unread ? "お知らせ（新しいお知らせがあります）" : "お知らせ"
              }
            >
              <Icon name="bell" size={21} />
              {/* A small light, not a count that piles up and hurries. */}
              {unread > 0 && <span className="bell-light" aria-hidden="true" />}
            </Link>
            {!visitor && (
              <Link
                href="/profiles/me/"
                className="top-avatar"
                aria-label="自分のプロフィール"
              >
                <ReaderAvatar reader={state.me} size={31} />
              </Link>
            )}
          </div>
        </header>
        <div className="persistence-warning" role="status" hidden={!warning}>
          {warning}
        </div>
        <main className={"town-main view-" + view} key={view + selectedId}>
          {visitor && ownPage ? (
            <VisitorPage page={ownPage} />
          ) : view === "walk" ? (
            <WalkView {...shared} />
          ) : view === "town" ? (
            <HomeView {...shared} tab="shelves">
              <StreetView {...shared} search={search} setSearch={setSearch} />
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
        <GoogleCoversCredit />
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
              (l.section === "walk" ? " nav-walk" : "") +
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
      {toast && <Toast toast={toast} onHold={holdToast} />}
      {about && (
        <Modal title="Book Townへようこそ" onClose={() => setAbout(false)}>
          <p className="modal-lead">読書家の小さな書店が集まる、本の街。</p>
          {savedIn === "visitor" ? (
            <>
              <p className="muted">
                「見本」と書かれた書店と読書家は、街の雰囲気を伝えるための架空のデータです。本の表紙・背表紙はオリジナルの仮デザインを使っています。
              </p>
              <div className="note-box">
                見るだけなら、ログインはいりません。本屋を開いたり、投稿したり、好きを届けたりするときに、ログインをお願いします。
              </div>
            </>
          ) : savedIn === "local" ? (
            <>
              <p className="muted">
                店主と書店は架空のデモデータです。本の表紙・背表紙はオリジナルの仮デザインを使っています。
              </p>
              <div className="note-box">
                あなたの書店や読みたい本は、このブラウザの中にだけ保存されます。ほかの端末や読書家には届きません。
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                本の表紙・背表紙はオリジナルの仮デザインを使っています。
              </p>
              <div className="note-box">
                あなたの書店や投稿は、ログインしたアカウントに保存されます。非公開の棚と読みたいリストは、あなたにしか見えません。
              </div>
            </>
          )}
          <p className="muted">
            決まった巡り方はありません。棚を眺めたり、同じ本をたどったり、あなたのペースでどうぞ。
          </p>
          <button className="button" onClick={() => setAbout(false)}>
            街を歩いてみる
            <Icon name="arrow" size={16} />
          </button>
        </Modal>
      )}
      <AccountInvite />
      <ReportDialog />
    </div>
  );
}
function ShopView({
  state,
  actions,
  notify,
  shopId,
}: Shared & { shopId: string }) {
  const router = useRouter();
  const shop =
    shopId === "mine"
      ? state.ownShop
      : state.shops.find((s) => s.id === shopId);
  const [selected, setSelected] = useState<{
    item: ShelfItem;
    shelf: Shelf;
  } | null>(null);
  // Back from a book's own page, the same book is in hand again.
  useLayerReturn((name) => {
    const held = heldBookOf(name);
    if (!shop || held?.shopId !== shop.id) return false;
    const shelf = shop.shelves.find((entry) => entry.id === held.shelfId);
    const item = shelf?.items.find((entry) => entry.id === held.itemId);
    if (!shelf || !item || selected?.item.id === item.id) return false;
    setSelected({ item, shelf });
    return true;
  }, Boolean(shop));
  const publicShops = [
    ...state.shops,
    ...(state.ownShop ? [state.ownShop] : []),
  ].filter((entry) => entry.shelves.some((shelf) => shelf.isPublic));
  const shopIndex = publicShops.findIndex((entry) => entry.id === shop?.id);
  const canBrowse = shopIndex >= 0 && publicShops.length > 1;
  const previousShop = canBrowse
    ? publicShops[(shopIndex - 1 + publicShops.length) % publicShops.length]
    : null;
  const nextShop = canBrowse
    ? publicShops[(shopIndex + 1) % publicShops.length]
    : null;
  const shopSwipe = useHorizontalSwipe({
    enabled: canBrowse && !selected,
    exclude:
      'button,a,input,textarea,select,summary,dialog,[role="dialog"],.shelf-scroll,.shop-shelf-index,[data-book-rail]',
    // Each shop along the row is a step of its own: 戻る returns to the
    // shop before it.
    onSwipe(direction) {
      const destination = direction < 0 ? previousShop : nextShop;
      if (!destination) return;
      router.push(shopPath(destination.id));
    },
  });
  if (!shop)
    return shopId === "mine" ? (
      <div className="empty-state">
        <Icon name="store" size={34} />
        <h1>あなたの小さな書店を、ここに。</h1>
        <p>店名と紹介を書いて、好きな本を並べてみましょう。</p>
        <Link href="/my-shop/" className="button">
          書店をひらく
          <Icon name="plus" size={17} />
        </Link>
      </div>
    ) : (
      // A link to a shop that has closed, or was never there.
      <div className="empty-state">
        <Icon name="store" size={34} />
        <h1>この書店は、いまは閉まっています。</h1>
        <p>ほかの書店の灯りは、今日もついています。</p>
        <Link href="/walk/" className="button">
          ほかの書店をめぐる
          <Icon name="arrow" size={17} />
        </Link>
      </div>
    );
  const owner =
    shop.ownerId === "me"
      ? state.me
      : state.readers.find((r) => r.id === shop.ownerId);
  const shelves = shop.shelves.filter((s) => s.isPublic);
  const hasBooks = shelves.some((s) => s.items.length > 0);
  const followed = state.following.includes(shop.id);
  return (
    <div className="shop-journey" {...shopSwipe}>
      <nav className="shop-journey-nav" aria-label="書店をめぐる">
        {previousShop && (
          <Link
            href={shopPath(previousShop.id)}
            aria-label={`前の書店：${previousShop.name}`}
          >
            <Icon name="back" size={17} />
            前の書店
          </Link>
        )}
        <BackLink className="shop-journey-home" icon={false}>
          {canBrowse && (
            <small>
              {shopIndex + 1} / {publicShops.length} · 左右にスワイプ
            </small>
          )}
        </BackLink>
        {nextShop && (
          <Link
            href={shopPath(nextShop.id)}
            aria-label={`次の書店：${nextShop.name}`}
          >
            次の書店
            <Icon name="arrow" size={17} />
          </Link>
        )}
      </nav>
      <section className={"shop-hero theme-" + shop.theme}>
        <div className="shop-hero-rule" />
        <h1>{shop.name}</h1>
        {ownTagline(shop) && <p className="shop-tagline">{ownTagline(shop)}</p>}
        <div className="shop-hero-bottom">
          {owner && (
            <Link href={profilePath(owner.id)} className="owner-profile-link">
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
          {hasBooks && (
            <Link href={walkPath(shop.id)} className="button secondary">
              <Icon name="store" size={16} />
              店内に入る
            </Link>
          )}
          {shop.ownerId === "me" ? (
            <Link href="/my-shop/" className="button secondary">
              <Icon name="edit" size={15} />
              書店を整える
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
      <p className="shop-shelf-hint">
        <Icon name="book" size={15} />
        本を選ぶと、店主のPOPが読めます
      </p>
      <div className="shop-shelf-index">
        {shelves.map((s) => (
          <a
            key={s.id}
            href={"#shelf-" + s.id}
            // Jumping to a shelf on the same page is no step of its own.
            onClick={(event) => {
              const shelf = document.getElementById("shelf-" + s.id);
              if (!shelf) return;
              event.preventDefault();
              shelf.scrollIntoView({
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "auto"
                  : "smooth",
              });
              replaceAddress({ hash: "shelf-" + s.id });
            }}
          >
            {s.name}
            <Icon name="chevron" size={12} />
          </a>
        ))}
      </div>
      {shelves.map((s, i) => {
        const pops = shelfPops(s, state.books);
        return (
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
            {/* The shelf keeps its own width; the owner's words fill the rest of the row. */}
            <div className="store-shelf-body">
              <WoodenShelf
                shelf={s}
                books={state.books}
                onSelect={(item) => setSelected({ item, shelf: s })}
              />
              {pops.length > 0 && (
                <ul
                  className="store-shelf-pops"
                  aria-label={`「${s.name}」の店主のPOP`}
                >
                  {pops.map(({ item, book }) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelected({ item, shelf: s })}
                      >
                        <span className="store-shelf-pop-words">
                          {item.pop}
                        </span>
                        <small>『{book.title}』</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
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
      <section className="shop-about" aria-label="書店の紹介">
        <h2>この書店について</h2>
        <FoldedWords state={state} kind="shop" id={shop.id}>
          <p className="shop-introduction">{shop.description}</p>
        </FoldedWords>
        {/* Only owners see how many follow them, in the demo as well. */}
        {shop.demo ? (
          <p className="shop-social-note">見本の書店</p>
        ) : shop.ownerId === ME_ID &&
          (shop.followers > 0 || shop.weekVisitors) ? (
          <p className="shop-social-note">
            {[
              shop.followers > 0 && `${shop.followers}人がフォロー`,
              shop.weekVisitors &&
                `この1週間に${shop.weekVisitors.count}人が立ち寄り`,
              "この数はあなたにだけ見えています",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {shop.ownerId !== ME_ID && (
          <ReportButton
            className="report-link"
            target={{ kind: "shop", id: shop.id, name: shop.name }}
          >
            <Icon name="flag" size={13} />
            この書店を通報
          </ReportButton>
        )}
      </section>
      {owner && (
        <div className="shop-owner-footer">
          <ReaderAvatar reader={owner} size={45} />
          <div>
            <b>{owner.name}の、好きの輪郭。</b>
            <p>人生の9冊から、店主をもう少し知ってみる。</p>
          </div>
          <Link href={profilePath(owner.id)} className="text-button">
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
    </div>
  );
}
/**
 * A book opened in hand sits in the browser's top layer, above everything else on the
 * page. While one is open the toast is placed inside it, so it is seen and read aloud.
 */
type ShownToast = { message: string; undo?: ToastUndo; held?: boolean };
/**
 * With an undo, the toast carries one text button; pressing it undoes and the
 * toast says so. It never takes the focus from where the reader is, but a
 * reader who goes to it (pointer or keyboard) keeps it until they leave.
 */
function Toast({
  toast: { message, undo },
  onHold,
}: {
  toast: ShownToast;
  onHold: (held: boolean) => void;
}) {
  const toast = (
    <div
      className="toast"
      role="status"
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onHold(false);
      }}
    >
      {/* Turned away from a 見本: a leaf, not a tick, for nothing was done. */}
      <Icon name={message === SAMPLE_NOTICE ? "leaf" : "check"} size={17} />
      {message}
      {undo && (
        <button type="button" className="toast-undo" onClick={undo.run}>
          {undo.label}
        </button>
      )}
    </div>
  );
  const openDialog = document.querySelector("dialog[open]");
  return openDialog ? createPortal(toast, openDialog) : toast;
}
/** Up to three of a shelf's POPs, in shelf order: the owner's words beside the shelf. */
function shelfPops(shelf: Shelf, books: Book[]) {
  return shelf.items
    .filter((item) => item.pop.trim())
    .map((item) => ({
      item,
      book: books.find((book) => book.id === item.bookId),
    }))
    .filter((entry): entry is { item: ShelfItem; book: Book } => !!entry.book)
    .slice(0, 3);
}
function BookView({
  state,
  actions,
  notify,
  bookId,
}: Shared & { bookId: string }) {
  const persistence = usePersistenceStatus();
  const book = state.books.find((b) => b.id === bookId);
  if (!book)
    return persistence === "loading" ? (
      <p role="status">本を開いています…</p>
    ) : (
      <div className="empty-state">
        <h1>この本は見つかりませんでした。</h1>
        <p>登録した本は、登録したときと同じブラウザで開いてください。</p>
        <Link href="/profiles/me/" className="button secondary">
          保存した本を見る
        </Link>
      </div>
    );
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
      <BackLink className="back-link" />
      <section className="book-page-hero">
        <BookJacket book={book} />
        <div className="book-hero-head">
          <span className="eyebrow">ONE BOOK, MANY WORLDS</span>
          <span className="genre-tag">{book.genre}</span>
          <h1>{book.title}</h1>
          <p className="book-page-author">{book.author}</p>
          <BookPrice book={book} />
          <BookPurchase book={book} />
          <CoverCredit book={book} />
          <CoverRemovalLink book={book} />
        </div>
        <div className="book-hero-body">
          <p className="book-summary">{book.summary}</p>
          <BookActions
            book={book}
            state={state}
            actions={actions}
            notify={notify}
          />
          <span className="jacket-disclaimer">{bookNote(book)}</span>
        </div>
      </section>
      <BookFeelings
        book={book}
        state={state}
        actions={actions}
        notify={notify}
      />
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
              <Link href={shopPath(shop.id, shelf.id)}>
                <Icon name="store" size={21} />
                <h3>{shop.name}</h3>
                <Icon name="arrow" size={16} />
              </Link>
              {shop.demo && <small className="demo-tag">見本</small>}
            </div>
            <Link href={shopPath(shop.id, shelf.id)} className="stockist-shelf">
              <Icon name="book" size={14} />「{shelf.name}」の棚
              <Icon name="chevron" size={13} />
            </Link>
            <blockquote>
              {item.pop || "この棚では、本そのものが語りかけます。"}
            </blockquote>
            <div className="stockist-bottom">
              <Link href={walkPath(shop.id)} className="text-button">
                <Icon name="store" size={15} />
                店内に入る
              </Link>
              <Link href={shopPath(shop.id, shelf.id)} className="text-button">
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
  // An empty list still has somewhere to start: one POP from each of a few shops.
  const invitations = state.shops
    .flatMap((shop) => {
      const owner = state.readers.find((r) => r.id === shop.ownerId);
      const item = shop.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) => shelf.items)
        .find(
          (entry) =>
            entry.pop.trim() &&
            state.books.some((book) => book.id === entry.bookId),
        );
      const book = item && state.books.find((b) => b.id === item.bookId);
      return owner && item && book ? [{ shop, owner, item, book }] : [];
    })
    .slice(0, 3);
  return (
    <>
      <span className="eyebrow">BOOKS TO COME BACK TO</span>
      <h1 className="page-title">いつか、読みたい一冊。</h1>
      <p className="page-subtitle">街を歩いて見つけた、次の楽しみ。</p>
      {books.length ? (
        <div className="catalog-grid wishlist-grid">
          {books.map((b) => (
            <article className="catalog-book" key={b.id}>
              <Link href={bookPath(b.id)}>
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
      {!books.length && invitations.length > 0 && (
        <section
          className="wishlist-invitations"
          aria-labelledby="wishlist-invitations-title"
        >
          <h2 id="wishlist-invitations-title">店主のPOPから、気になる一冊を</h2>
          <ul>
            {invitations.map(({ shop, owner, item, book }) => (
              <li key={shop.id}>
                <Link href={bookPath(book.id)}>
                  <BookJacket book={book} />
                  <span>
                    <b>{book.title}</b>
                    <q>{item.pop.trim()}</q>
                    <small>
                      {shop.name}・店主 {owner.name}のPOP
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
