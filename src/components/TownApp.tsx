"use client";
// First, so the CSS keeps its order (screen-styles.ts).
import "./screen-styles";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  useTownMissed,
  useTownBackend,
} from "../lib/store";
import { useJournalSender } from "../lib/library-journal";
import { lapsedLine, saveWarning } from "../lib/persistence";
import { useAnyOutboxWaiting } from "../lib/outbox";
import { playTabMove, tabMove } from "../lib/tab-motion";
import { useAccountState } from "../lib/account-session";
import { ME_ID, type Notify, type ToastUndo } from "../lib/types";
import { GoogleCoversCredit, Icon, Modal, ReaderAvatar } from "./ui";
import { requestHomeTop } from "../lib/home-tab";
import { activeSession } from "../lib/reading";
import { unreadCount } from "../lib/notifications";
import "./usability.css";
import "./shop-journey.css";
import {
  libraryPath,
  loginPath,
  myShopPath,
  notificationsPath,
  profilePath,
  readingPath,
  searchPath,
  walkPath,
} from "../lib/paths";
import { requestSearch } from "../lib/tags";
import { enterPressed } from "../lib/keys";
import { AccountInvite, VisitorPage } from "./VisitorInvite";
import { ReportDialog } from "./Report";
import { SiteNotesGate } from "./SiteNotesGate";
import { accountRequested, closeAccountRequest } from "../lib/visitor";
import {
  answerName,
  nameAsked,
  ownName,
  useNameRequest,
} from "../lib/public-profile";
import { closeReport } from "../lib/report";
import { carriedToast, noteToast } from "../lib/carried-toast";
import { useAskedMemo, useMemoEverAsked } from "../lib/encounter-memo";
import { isKeptNotice } from "../lib/kept-draft";
import {
  SAMPLE_NOTICE,
  onSampleRefusal,
  refusedForSample,
} from "../lib/sample-notice";
import { notePageShown } from "../lib/in-town";
import { replaceAddress } from "../lib/url-state";
import { useLastHomeAddress } from "../lib/last-address";
import "./poster-screen.css";
import { useLayerReturn } from "../lib/back-layer";
import {
  PostLayer,
  PostPageView,
  readPostPageAhead,
} from "./letter/post-page-later";
import {
  closePost,
  isPostOpen,
  openPost,
  postOfLayer,
  usePostLayer,
} from "./letter/post-layer";
import { useAnnouncement } from "../lib/live-region";
import { useBookHolds } from "../lib/bibliography-session";
import { NAMES, TABS } from "../lib/words";
import { inManageMode } from "../lib/town-mode";

// Every screen comes in its own file, so a page reads only the screen it
// shows: Home's code is not read on a book's page, nor a book's page's on
// Home. Each is still drawn into the page's HTML at build time, and the page
// asks for its screen's file with the rest of its code. Another screen's file
// is read when the reader goes there.
const HomeView = dynamic(() =>
  import("./HomeView").then((file) => file.HomeView),
);
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
const CreditsView = dynamic(() =>
  import("./CreditsView").then((file) => file.CreditsView),
);
const NotificationsView = dynamic(() =>
  import("./NotificationsView").then((file) => file.NotificationsView),
);
const WalkView = dynamic(() =>
  import("./WalkView").then((file) => file.WalkView),
);
const LibraryView = dynamic(() =>
  import("./LibraryView").then((file) => file.LibraryView),
);
const PosterEditor = dynamic(() =>
  import("./PosterEditor").then((file) => file.PosterEditor),
);
const PosterScreen = dynamic(() =>
  import("./PosterScreen").then((file) => file.PosterScreen),
);
const ShopView = dynamic(() =>
  import("./ShopView").then((file) => file.ShopView),
);
const BookView = dynamic(() =>
  import("./BookView").then((file) => file.BookView),
);
const Wishlist = dynamic(() =>
  import("./Wishlist").then((file) => file.Wishlist),
);
// The memo sheet (押したときのメモ) is read once a memo is first asked for.
const EncounterMemoHost = dynamic(() =>
  import("./EncounterMemo").then((file) => file.EncounterMemoHost),
);
const ManageHome = dynamic(() =>
  import("./ManageMode").then((file) => file.ManageHome),
);
// Only while it asks (public-profile.ts), so its file is read then.
const NameSheet = dynamic(() =>
  import("./NameSheet").then((file) => file.NameSheet),
);
const ManageRest = dynamic(() =>
  import("./ManageMode").then((file) => file.ManageRest),
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
  | "library"
  | "poster"
  | "poster-new"
  | "post"
  | "credits";
type Section = "home" | "search" | "walk" | "shelf" | "reading" | "profile";
// The row for the β (管理表 48), its names in TABS. ライブラリ opens the
// library; 記録 opens 読書を開始 as it is.
const links: { href: string; icon: string; label: string; section: Section }[] =
  [
    { href: "/", icon: "home", label: TABS.home, section: "home" },
    {
      href: searchPath(""),
      icon: "search",
      label: TABS.search,
      section: "search",
    },
    { href: walkPath(), icon: "store", label: TABS.walk, section: "walk" },
    {
      href: libraryPath(),
      icon: "shelf",
      label: TABS.library,
      section: "shelf",
    },
    {
      href: readingPath(),
      icon: "reading",
      label: TABS.reading,
      section: "reading",
    },
    {
      href: profilePath("me"),
      icon: "user",
      label: TABS.profile,
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
/**
 * The pages of the town, which rest in 読書管理モード: walking the shops, a
 * shop, the reader's own shop, posters, a 便り's page, another reader.
 */
function restsInManageMode(view: View, selectedId?: string): boolean {
  if (view === "profile") return (selectedId || "me") !== "me";
  return (
    view === "walk" ||
    view === "shop" ||
    view === "editor" ||
    view === "poster" ||
    view === "poster-new" ||
    view === "post"
  );
}
/** Which item of the main navigation a view belongs to. */
function sectionOf(
  view: View,
  selectedId?: string,
  ownPoster = false,
): Section | null {
  if (view === "walk") return "walk";
  // A shop's page is part of walking the shops, wherever it was opened from.
  if (view === "shop") return "walk";
  // A 便り's page opened at its own address is read as part of home.
  if (view === "town" || view === "timeline" || view === "post") return "home";
  if (view === "search") return "search";
  if (view === "reading") return "reading";
  if (view === "library") return "shelf";
  if (view === "editor" || view === "wishlist") return "profile";
  // What the viewer makes lives on their profile, as their posters do.
  if (view === "poster-new" || (view === "poster" && ownPoster))
    return "profile";
  if (view === "profile" && (selectedId ?? "me") === "me") return "profile";
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
  // 読書管理モード: the same screens, the town left out (town-mode.ts).
  const manage = inManageMode(state);
  const tabs = useMemo(
    () => (manage ? links.filter((l) => l.section !== "walk") : links),
    [manage],
  );
  const persistence = usePersistenceStatus();
  const savedIn = useTownBackend();
  const account = useAccountState();
  const signedOut = account.status === "signed-out";
  // Changes still waiting on this device tell of a sign-in that ended
  // without ログアウト (which lets them go), even before this page opened.
  const waiting = useAnyOutboxWaiting(signedOut);
  const missed = useTownMissed();
  const lapsed =
    (signedOut && account.lapsed) || waiting ? lapsedLine(waiting) : null;
  const warning = saveWarning(savedIn, persistence, {
    missed: missed?.line ?? null,
    lapsed,
  });
  const router = useRouter();
  const [toast, setToast] = useState<ShownToast | null>(() => {
    const message = carriedToast();
    return message ? { message, at: Date.now() } : null;
  });
  const [search, setSearch] = useState("");
  const [about, setAbout] = useState(false);
  useEffect(() => notePageShown(), [view, selectedId]);
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
  // A change the database turned away, or one left waiting as the sign-in
  // ended, is told above (missed-changes.ts): the message that said it was
  // done gives way, in the same frame. One with an undo stays, the only way
  // back.
  useLayoutEffect(() => {
    if (missed?.line || lapsed)
      setToast((shown) => (shown && !shown.undo ? null : shown));
  }, [missed, lapsed]);
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
    if (nameAsked()) answerName(false);
  }, [view, selectedId]);
  // When a visitor's change became an invitation to sign in, nothing was done,
  // so the message saying it was done stays quiet.
  // A like or a follow meant for a 見本 says why nothing happened.
  useEffect(
    () => onSampleRefusal((message) => setToast({ message, at: Date.now() })),
    [],
  );
  const notify = useCallback<Notify>((message, undo) => {
    if (accountRequested() || refusedForSample() || nameAsked()) return;
    noteToast(message);
    setToast({ message, undo, at: Date.now() });
  }, []);
  // Books the scanner kept on this device are sent once the town can take
  // them, here on every page (library-journal.ts).
  useJournalSender(journalTown, notify);
  const shared = { state, actions, notify };
  const askingName = useNameRequest();
  const memoAsked = useMemoEverAsked();
  // The toast whose メモ opened the sheet has said its part.
  const memoOpen = useAskedMemo();
  useEffect(() => {
    if (memoOpen) setToast(null);
  }, [memoOpen]);
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
  // Once the town is read, a 便り's page is read ahead, so a tap opens it
  // at once.
  const townRead = persistence !== "loading";
  useEffect(() => {
    if (townRead) readPostPageAhead();
  }, [townRead]);
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
  const section = sectionOf(
    view,
    selectedId,
    state.posters.some(
      (poster) => poster.id === selectedId && poster.authorId === ME_ID,
    ),
  );
  // A visitor who is not signed in has no pages of their own yet.
  const visitor = savedIn === "visitor";
  const ownPage =
    view === "editor"
      ? "shop"
      : view === "wishlist"
        ? "wishlist"
        : view === "library"
          ? "library"
          : view === "notifications"
            ? "notifications"
            : view === "profile" && (selectedId || "me") === "me"
              ? "profile"
              : null;
  const reading = Boolean(activeSession(state));
  // The reader's books held back are told in お知らせ too.
  const holds = useBookHolds();
  const unread = unreadCount(state, holds);
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
  // On its own page, 本棚 or わたし takes the page back to its top, in place,
  // keeping what it shows.
  const topClick =
    (here: boolean) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!here || !plainClick(event)) return;
      event.preventDefault();
      window.scrollTo({ top: 0 });
    };
  const shelfClick = topClick(view === "library");
  const meClick = topClick(view === "profile" && (selectedId || "me") === "me");
  // Moving to another tab of the bottom bar slides the round mark behind
  // the chosen tab along the bar to it (tab-motion.ts). Only where it shows.
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const index = tabs.findIndex((l) => l.section === section);
    const move = tabMove(index < 0 ? null : index);
    const nav = navRef.current;
    if (!nav || getComputedStyle(nav).display === "none") return;
    playTabMove(move, nav);
  }, [section, tabs]);
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
            {NAMES.service}
            <small>{NAMES.catchphrase}</small>
          </span>
        </Link>
        <div className="side-caption">本の向こうに、誰かがいる。</div>
        <nav aria-label="メインナビゲーション">
          {tabs.map((l) => (
            <Link
              key={l.section}
              href={hrefOf(l)}
              onClick={clickOf(l)}
              className={"side-link " + (section === l.section ? "active" : "")}
              aria-current={section === l.section ? "page" : undefined}
            >
              <Icon name={l.icon} size={21} />
              {l.section === "reading" && reading ? TABS.readingNow : l.label}
              {l.section === "reading" && reading && (
                <i className="nav-live" aria-hidden="true" />
              )}
            </Link>
          ))}
        </nav>
        {!manage && (
          <Link className="open-shop-link" href={myShopPath()}>
            <Icon name="plus" size={18} />
            {state.ownShop ? "書店を整える" : "あなたも、店主に。"}
            <Icon name="arrow" size={15} />
          </Link>
        )}
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
          <Link href={loginPath()} className="side-me">
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
          <Link href={profilePath("me")} className="side-me">
            <ReaderAvatar reader={state.me} size={36} />
            <span>
              <b>{ownName(state.me)}</b>
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
            <span>{NAMES.service}</span>
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
              placeholder={manage ? "本を探す" : "本や、気になる書店を探す"}
              aria-label={manage ? "本を検索" : "本や書店を検索"}
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
            {!visitor && (
              <Link
                href={libraryPath({ addBook: true })}
                className="top-bell top-add"
                aria-label="本を登録"
              >
                <Icon name="barcode" size={20} />
              </Link>
            )}
            {account.status === "signed-out" && (
              <Link className="demo-pill top-login" href={loginPath()}>
                ログイン
              </Link>
            )}
            <Link
              href={notificationsPath()}
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
                href={profilePath("me")}
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
          ) : manage && restsInManageMode(view, selectedId) ? (
            <ManageRest {...shared} />
          ) : manage && (view === "town" || view === "timeline") ? (
            <ManageHome {...shared} />
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
          ) : view === "library" ? (
            <LibraryView {...shared} />
          ) : view === "credits" ? (
            <CreditsView />
          ) : (
            <Wishlist {...shared} />
          )}
        </main>
        <GoogleCoversCredit />
        {/* The town's words: not said in 読書管理モード. */}
        {!manage && (
          <footer className="town-footer">
            <span>読書の終わりを、交流の始まりに。</span>
            <small>BOOK TOWN · それぞれの「好き」が集まる、本の街。</small>
          </footer>
        )}
      </div>
      <nav
        className="town-bottom-nav"
        ref={navRef}
        aria-label="スマートフォンナビゲーション"
        inert={layered}
      >
        {tabs.map((l) => (
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
              {l.section === "reading" && reading ? TABS.readingNow : l.label}
            </span>
          </Link>
        ))}
      </nav>
      {memoAsked && <EncounterMemoHost {...shared} />}
      {toast && <Toast toast={toast} onHold={holdToast} />}
      {about && (
        <Modal
          title={`${NAMES.service}へようこそ`}
          onClose={() => setAbout(false)}
        >
          <p className="modal-lead">読書家の小さな書店が集まる、本の街。</p>
          {savedIn === "visitor" ? (
            <>
              <p className="muted">
                「見本」と書かれた書店と読書家は、街の雰囲気を伝えるための架空のデータです。本の表紙・背表紙はオリジナルの仮デザインを使っています。
              </p>
              <div className="note-box">
                見るだけなら、ログインはいりません。書店を開いたり、投稿したり、好きを届けたりするときに、ログインをお願いします。
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
                あなたの書店や{NAMES.letter}
                は、ログインしたアカウントに保存されます。非公開の棚と読みたいリストは、あなたにしか見えません。
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
      {/* Only while a 便り is open over the screen, so its file is not read
          before (post-page-later.tsx). */}
      {layered && <PostLayer {...shared} />}
      {/* Said to a screen reader without moving the focus (いいね's count). */}
      <div className="sr-only town-said" aria-live="polite">
        <span key={said.at}>{said.text}</span>
      </div>
      <AccountInvite />
      {askingName && <NameSheet {...shared} />}
      <ReportDialog />
      <SiteNotesGate notify={notify} />
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
      {/* What was done needs no mark: the words say it, and the line keeps
          its room for them. Turned away from a 見本, or a save refused with
          the work kept, a leaf says nothing was done. */}
      {(message === SAMPLE_NOTICE || isKeptNotice(message)) && (
        <Icon name="leaf" size={17} />
      )}
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
