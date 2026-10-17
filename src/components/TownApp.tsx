"use client";
// First, so the CSS keeps its order (screen-styles.ts).
import "./screen-styles";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  journalTown,
  useTownStore,
  usePersistenceStatus,
  useTownBackend,
} from "../lib/store";
import { useJournalSender } from "../lib/library-journal";
import { saveWarning } from "../lib/persistence";
import { playTabMove, tabMove } from "../lib/tab-motion";
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
import { BookInHand, readBookInHandAhead } from "./book-in-hand-later";
import { heldBookOf } from "../lib/held-book";
import { BookActions, BookPrice, BookPurchase, bookNote } from "./BookActions";
import { BookReviews, FoldedWords } from "./Social";
import { HomeView } from "./HomeView";
import { requestHomeTop } from "../lib/home-tab";
import { activeSession } from "../lib/reading";
import { unreadCount } from "../lib/notifications";
import { bookPath } from "../lib/books";
import "./usability.css";
import { useHorizontalSwipe } from "./useHorizontalSwipe";
import "./shop-journey.css";
import {
  isDatabaseId,
  posterNewPath,
  posterPath,
  profilePath,
  searchPath,
  shopPath,
  walkPath,
} from "../lib/paths";
import { requestSearch } from "../lib/tags";
import { enterPressed } from "../lib/search/use-book-search";
import { AccountInvite, VisitorPage } from "./VisitorInvite";
import { CoverRemovalLink, ReportButton, ReportDialog } from "./Report";
import { SiteNotesGate } from "./SiteNotesGate";
import { BookFeelings } from "./ReadingRecords";
import { accountRequested, closeAccountRequest } from "../lib/visitor";
import { closeReport } from "../lib/report";
import { carriedToast, noteToast } from "../lib/carried-toast";
import { isKeptNotice } from "../lib/kept-draft";
import {
  SAMPLE_NOTICE,
  onSampleRefusal,
  refusedForSample,
} from "../lib/sample-notice";
import { BackLink } from "./BackLink";
import { notePageShown } from "../lib/in-town";
import { replaceAddress, useUrlParam } from "../lib/url-state";
import { requestShelf, takeShelfRequest } from "../lib/shelf-tab";
import { useLastHomeAddress } from "../lib/last-address";
import { postersLeftOutOfBook, postersOfBook } from "../lib/posters";
import { findReader, reviewCoverOf, reviewNoteOf } from "../lib/social";
import { PosterThumb } from "./PosterView";
import "./poster-screen.css";
import { useLayerReturn } from "../lib/back-layer";
import { PostLayer, PostPageView } from "./letter/PostPage";
import {
  closePost,
  isPostOpen,
  openPost,
  postOfLayer,
  usePostLayer,
} from "./letter/post-layer";
import { useAnnouncement } from "../lib/live-region";
import { reducedMotion } from "../lib/motion";

// Every screen but Home comes in its own file, read when it is first shown
// (and after Home is drawn, below), so a phone opening the town reads and
// runs only Home's code before the first 便り. Each is still drawn into the
// page's HTML at build time.
const ShopEditor = dynamic(() =>
  import("./ShopEditor").then((file) => file.ShopEditor),
);
const ProfileView = dynamic(() =>
  import("./ProfileView").then((file) => file.ProfileView),
);
const SearchView = dynamic(() =>
  import("./SearchView").then((file) => file.SearchView),
);
const ReadingView = dynamic(() =>
  import("./ReadingView").then((file) => file.ReadingView),
);
const NotificationsView = dynamic(() =>
  import("./NotificationsView").then((file) => file.NotificationsView),
);
const WalkView = dynamic(() =>
  import("./WalkView").then((file) => file.WalkView),
);
const PosterEditor = dynamic(() =>
  import("./PosterEditor").then((file) => file.PosterEditor),
);
const PosterScreen = dynamic(() =>
  import("./PosterScreen").then((file) => file.PosterScreen),
);

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
  | "wishlist"
  | "poster"
  | "poster-new"
  | "post";
type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};
type Section = "home" | "search" | "walk" | "shelf" | "reading" | "profile";
// Six for now, while けにー alone uses the town and the final row is decided
// (10-16). 本棚 opens the 登録 list on the reader's own profile until the
// library has a page of its own; 記録 opens 読書を開始 as it is.
const links: { href: string; icon: string; label: string; section: Section }[] =
  [
    { href: "/", icon: "home", label: "ホーム", section: "home" },
    { href: "/search/", icon: "search", label: "検索", section: "search" },
    { href: "/walk/", icon: "store", label: "書店めぐり", section: "walk" },
    {
      href: "/profiles/me/?books=library",
      icon: "shelf",
      label: "本棚",
      section: "shelf",
    },
    { href: "/reading/", icon: "reading", label: "記録", section: "reading" },
    {
      href: "/profiles/me/",
      icon: "user",
      label: "わたし",
      section: "profile",
    },
  ];
/** A plain click on a link: not one that opens another tab or window. */
const plainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;
/** Which item of the main navigation a view belongs to. */
function sectionOf(
  view: View,
  selectedId?: string,
  ownPoster = false,
  /** The own profile shows its 登録 list (`?books=library`): 本棚. */
  shelf = false,
): Section | null {
  if (view === "walk") return "walk";
  // A shop's page is part of walking the shops, wherever it was opened from.
  if (view === "shop") return "walk";
  // A 便り's page opened at its own address is read as part of home.
  if (view === "town" || view === "timeline" || view === "post") return "home";
  if (view === "search") return "search";
  if (view === "reading") return "reading";
  if (view === "editor" || view === "wishlist") return "profile";
  // What the viewer makes lives on their profile, as their posters do.
  if (view === "poster-new" || (view === "poster" && ownPoster))
    return "profile";
  if (view === "profile" && (selectedId ?? "me") === "me")
    return shelf ? "shelf" : "profile";
  return null;
}
export default function TownApp({
  view,
  selectedId,
  bookId,
}: {
  view: View;
  selectedId?: string;
  /** Making a poster: the book it starts about. */
  bookId?: string;
}) {
  const { state, actions } = useTownStore();
  const persistence = usePersistenceStatus();
  const savedIn = useTownBackend();
  const warning = saveWarning(savedIn, persistence);
  const account = useAccountState();
  const router = useRouter();
  const [toast, setToast] = useState<ShownToast | null>(() => {
    const message = carriedToast();
    return message ? { message, at: Date.now() } : null;
  });
  const [search, setSearch] = useState("");
  const [about, setAbout] = useState(false);
  useEffect(() => notePageShown(), [view, selectedId]);
  // A tap on 本棚 is for the page it opened; the profile has taken it by now
  // (its effects run first), and no other page keeps it.
  useEffect(() => void takeShelfRequest(), [view, selectedId]);
  // A message about what was just done does not follow the reader to the next
  // page, where it would sit over that page's buttons. One that moved there
  // with the reader (said as the page changed) stays, as does one that
  // carries an undo, the only way back.
  useEffect(() => {
    setToast((shown) =>
      shown && !shown.undo && !shown.held && Date.now() - (shown.at ?? 0) > 1000
        ? null
        : shown,
    );
  }, [view, selectedId]);
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
  // A dialog about something on the page does not follow the reader to the next one.
  useEffect(() => {
    closeReport();
    closeAccountRequest();
  }, [view, selectedId]);
  // When a visitor's change became an invitation to sign in, nothing was done,
  // so the message saying it was done stays quiet.
  // A like or a follow meant for a 見本 says why nothing happened.
  useEffect(
    () => onSampleRefusal((message) => setToast({ message, at: Date.now() })),
    [],
  );
  const notify = useCallback<Notify>((message, undo) => {
    if (accountRequested() || refusedForSample()) return;
    noteToast(message);
    setToast({ message, undo, at: Date.now() });
  }, []);
  // Books the scanner kept on this device are sent once the town can take
  // them, here on every page (library-journal.ts).
  useJournalSender(journalTown, notify);
  const shared = { state, actions, notify };
  // A 便り's page is open over this screen: what is beneath it waits.
  const postLayer = usePostLayer();
  const layered = postLayer !== null && view !== "post";
  // Back on a step that had a 便り's page open (left for a page linked from
  // it), the page opens again, once the town is read.
  useLayerReturn((name) => {
    const id = postOfLayer(name);
    if (
      view === "post" ||
      !id ||
      isPostOpen(id) ||
      !state.posts.some((post) => post.id === id)
    )
      return false;
    openPost(id);
    return true;
  }, persistence !== "loading");
  // A page of the town does not carry another page's layer.
  useEffect(() => () => closePost(), []);
  const said = useAnnouncement();
  // Enter in the top search opens the search page for what was typed: books,
  // readers and shops alike.
  const searchEverything = () => {
    const query = search.trim();
    if (!query) return;
    if (view === "search") {
      // The search page takes it in place, so the address says it at once.
      replaceAddress({ params: { q: query } });
      requestSearch(query);
      setSearch("");
      return;
    }
    requestSearch(query);
    router.push(searchPath(query));
    setSearch("");
  };
  const [books] = useUrlParam("books");
  const section = sectionOf(
    view,
    selectedId,
    state.posters.some(
      (poster) => poster.id === selectedId && poster.authorId === ME_ID,
    ),
    books === "library",
  );
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
  // ホーム returns to the Home tab shown last (home-tab.ts); on Home itself
  // it takes the tab shown back to its top. A 便り's page at its own address
  // is read as part of Home, but is not one of its tabs.
  const homeHref = useLastHomeAddress();
  const hrefOf = (link: (typeof links)[number]) =>
    link.section === "home" ? homeHref : link.href;
  // On Home itself, ホーム takes the tab shown back to its top, in place.
  const onHome = section === "home" && view !== "post";
  const homeClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onHome || !plainClick(event)) return;
    event.preventDefault();
    requestHomeTop();
  };
  // 本棚 and わたし are the same page for now. On it, each switches the
  // list in place (as its own buttons do), and 本棚 brings the list into view,
  // here or once the profile opens (shelf-tab.ts).
  const onOwnProfile = view === "profile" && (selectedId || "me") === "me";
  const shelfClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return;
    if (onOwnProfile) {
      event.preventDefault();
      replaceAddress({ params: { books: "library" } });
    }
    requestShelf();
  };
  const meClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOwnProfile || !plainClick(event)) return;
    event.preventDefault();
    if (books === "library") replaceAddress({ params: { books: null } });
    window.scrollTo({ top: 0 });
  };
  // Moving to another tab of the bottom bar slides the round mark behind
  // the chosen tab along the bar to it (tab-motion.ts). Only where it shows.
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const index = links.findIndex((l) => l.section === section);
    const move = tabMove(index < 0 ? null : index);
    const nav = navRef.current;
    if (!nav || getComputedStyle(nav).display === "none") return;
    playTabMove(move, nav);
  }, [section]);
  const clickOf = (link: (typeof links)[number]) =>
    link.section === "home"
      ? homeClick
      : link.section === "shelf"
        ? shelfClick
        : link.section === "profile"
          ? meClick
          : undefined;
  return (
    <div
      className={
        "town-shell" +
        (view === "walk" ? " is-walk" : "") +
        (view === "town" || view === "timeline" ? " is-home" : "")
      }
    >
      <aside className="town-sidebar" inert={layered}>
        <Link className="brand" href={homeHref} onClick={homeClick}>
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
              href={hrefOf(l)}
              onClick={clickOf(l)}
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
      <div className="town-workspace" inert={layered}>
        <header className="town-topbar">
          <Link href={homeHref} className="mobile-brand" onClick={homeClick}>
            <Icon name="store" size={24} />
            <span>Book Town</span>
          </Link>
          <form
            className="top-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              searchEverything();
            }}
          >
            <Icon name="search" size={18} />
            <input
              placeholder="本や、気になる書店を探す"
              aria-label="本や書店を検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // The Enter that confirms a kana conversion stays the keyboard's.
                if (!enterPressed(e)) return;
                e.preventDefault();
                searchEverything();
              }}
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
        <main
          // Both of Home's addresses draw the same Home, whichever tab shows.
          className={"town-main view-" + (view === "timeline" ? "town" : view)}
          key={view + selectedId}
        >
          {visitor && ownPage ? (
            <VisitorPage page={ownPage} />
          ) : view === "walk" ? (
            <WalkView {...shared} />
          ) : view === "town" || view === "timeline" ? (
            <HomeView {...shared} tab={view === "town" ? "home" : "letters"} />
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
          ) : view === "poster" ? (
            <PosterScreen {...shared} posterId={selectedId || ""} />
          ) : view === "post" ? (
            <PostPageView {...shared} postId={selectedId || ""} />
          ) : view === "poster-new" ? (
            <PosterEditor
              {...shared}
              posterId={selectedId || undefined}
              bookId={bookId || undefined}
            />
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
        ref={navRef}
        aria-label="スマートフォンナビゲーション"
        inert={layered}
      >
        {links.map((l) => (
          <Link
            href={hrefOf(l)}
            onClick={clickOf(l)}
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
          <button className="btn fill" onClick={() => setAbout(false)}>
            街を歩いてみる
            <Icon name="arrow" size={16} />
          </button>
        </Modal>
      )}
      {view !== "post" && <PostLayer {...shared} />}
      {/* Said to a screen reader without moving the focus (いいね's count). */}
      <div className="sr-only town-said" aria-live="polite">
        <span key={said.at}>{said.text}</span>
      </div>
      <AccountInvite />
      <ReportDialog />
      <SiteNotesGate notify={notify} />
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
  useEffect(() => readBookInHandAhead(), []);
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
        <Link href="/my-shop/" className="btn fill">
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
        <Link href="/walk/" className="btn fill">
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
            <Link href={walkPath(shop.id)} className="btn">
              <Icon name="store" size={16} />
              店内に入る
            </Link>
          )}
          {shop.ownerId === "me" ? (
            <Link href="/my-shop/" className="btn">
              <Icon name="edit" size={15} />
              書店を整える
            </Link>
          ) : (
            <button
              className={"btn" + (followed ? "" : " fill")}
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
                behavior: reducedMotion() ? "auto" : "smooth",
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
              {/* An empty shelf has no count: the owner gets a way to fill it. */}
              {s.items.length > 0 ? (
                <small>{s.items.length}冊の選書</small>
              ) : (
                shop.ownerId === ME_ID && (
                  <Link href="/my-shop/" className="store-shelf-fill">
                    本を並べる
                    <Icon name="arrow" size={12} />
                  </Link>
                )
              )}
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
            <Link href="/my-shop/" className="btn">
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
          <Link href={profilePath(owner.id)} className="text-btn">
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
type ShownToast = {
  message: string;
  undo?: ToastUndo;
  held?: boolean;
  at?: number;
};
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
      {/* Turned away from a 見本, or a save refused with the work kept: a
          leaf, not a tick, for nothing was done. */}
      <Icon
        name={
          message === SAMPLE_NOTICE || isKeptNotice(message) ? "leaf" : "check"
        }
        size={17}
      />
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
        <h1>この本のページは、いまは見られません。</h1>
        <Link href="/" className="btn">
          街にもどる
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
      <BookPosters state={state} book={book} />
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
              <Link href={walkPath(shop.id)} className="text-btn">
                <Icon name="store" size={15} />
                店内に入る
              </Link>
              <Link href={shopPath(shop.id, shelf.id)} className="text-btn">
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
            <Link href="/my-shop/" className="btn">
              自分の書店へ
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
/**
 * The posters a book appears in, those that open with it first. With none
 * yet, only the way to make the first. Spoilers the reader chose not to see
 * are left out, said once without a count.
 */
function BookPosters({ state, book }: { state: TownState; book: Book }) {
  const posters = postersOfBook(state, book.id);
  const leftOut = postersLeftOutOfBook(state, book.id) && (
    <p className="book-posters-left-out">
      ネタバレを含むポスターは、設定により出していません
    </p>
  );
  const make = (
    <Link href={posterNewPath({ bookId: book.id })} className="text-btn">
      <Icon name="plus" size={14} />
      この本でポスターを作る
    </Link>
  );
  if (!posters.length)
    return (
      <>
        <p className="book-posters-invite">{make}</p>
        {leftOut}
      </>
    );
  return (
    <section className="book-posters" aria-labelledby="book-posters-title">
      <div className="book-path-heading">
        <span className="eyebrow">POSTERS WITH THIS BOOK</span>
        <h2 id="book-posters-title">この本が出てくるポスター</h2>
        <p>読書家が、この本を貼り出したポスター。表紙から、その人の言葉へ。</p>
      </div>
      <ul className="book-posters-row">
        {posters.map((poster) => {
          // Who made it, and a 見本 says it is one, as on the timeline.
          const maker = findReader(state, poster.authorId);
          const sample =
            poster.authorId !== ME_ID && !isDatabaseId(poster.authorId);
          return (
            <li key={poster.id}>
              <PosterThumb
                poster={poster}
                books={state.books}
                href={posterPath(poster.id)}
                caption={
                  [maker?.name, sample && "見本"].filter(Boolean).join(" · ") ||
                  undefined
                }
                folded={reviewCoverOf(
                  state,
                  "poster",
                  poster.id,
                  poster.authorId,
                )}
                note={reviewNoteOf(state, "poster", poster.id, poster.authorId)}
              />
            </li>
          );
        })}
      </ul>
      {make}
      {leftOut}
    </section>
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
                className="text-btn"
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
          <Link href="/" className="btn">
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
