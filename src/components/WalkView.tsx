"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { flushSync, preload } from "react-dom";
import { BookJacket, Icon, Modal, ReaderAvatar } from "./ui";
import { BookInHand } from "./BookInHand";
import { heldBookOf } from "../lib/held-book";
import { DoodleIcon, StoreCanvas, StoreStamp } from "./StoreCanvas";
import { ShelfZoom } from "./ShelfZoom";
import {
  bookPop,
  boundsOf,
  furnitureBooks,
  objectById,
  safeBackgroundUrl,
  worldPolygon,
} from "../lib/store-scene";
import { wordsFolded } from "../lib/social";
import { booksBeforeSearch } from "../lib/book-lists";
import {
  publicScenePops,
  publicWalkShops,
  readingEntries,
} from "../lib/store-scene-adapter";
import {
  hasPublicSceneBooks,
  resolveStoreScene,
} from "../lib/store-customization";
import {
  clearVisits,
  startWalk,
  stepWalk,
  verticalSwipe,
  visitStore,
  type ShopReaction,
} from "../lib/walk-state";
import { useWalkStore } from "../lib/walk-store";
import { requestAccount } from "../lib/visitor";
import { ReportButton } from "./Report";
import {
  OWN_SHOP_ID,
  SHOP_MESSAGE_MAX_LENGTH,
  ownTagline,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import "./walk.css";
import { profilePath, shopPath } from "../lib/paths";
import { replaceAddress } from "../lib/url-state";
import { useLayerReturn } from "../lib/back-layer";
import {
  fieldTakesFocus,
  takesText,
  useCoarsePointer,
} from "../lib/coarse-pointer";
import {
  bookAuthor,
  bookById,
  bookTitle,
  quotedTitle,
  titleById,
} from "../lib/book-name";
import { failure, WHILE_OFFLINE } from "../lib/words";

type Overlay =
  | { kind: "book"; placementId: string; returnRow?: string }
  | { kind: "zoom"; rowId: string; initialId?: string }
  | {
      kind: "pop";
      text: string;
      title: string;
      stamp?: string;
      /** A book's POP leads on to the book itself. */
      placementId?: string;
    }
  | { kind: "message" }
  | { kind: "history" }
  | { kind: "menu" }
  | null;
const WALK_HINT_KEY = "book-town-walk-hint";

/**
 * Focuses `target` once the change just made is drawn, unless the reader has
 * moved on meanwhile (closed a book and at once picked the next one): focus
 * stays where they went, and is not taken back a frame later.
 */
function focusNextFrame(target: () => HTMLElement | null | undefined) {
  const from = document.activeElement;
  requestAnimationFrame(() => {
    const now = document.activeElement;
    if (now && now !== from && now !== document.body) return;
    target()?.focus({ preventScroll: true });
  });
}

export function WalkView({
  state,
  actions,
  notify,
  orderedStores,
  initialStoreId,
}: {
  state: TownState;
  actions: TownActions;
  notify: (text: string) => void;
  orderedStores?: Shop[];
  initialStoreId?: string;
}) {
  // The store's lettering faces: sign and chalk, POP pen, cover mincho.
  for (const font of ["shop-sign-700", "shop-hand-500", "jacket-mincho-600"])
    preload("/fonts/" + font + ".woff2", {
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
    });
  const saved = useWalkStore(),
    walk = saved.state,
    update = saved.update,
    ready = saved.ready,
    // With an account, words left for an owner reach them.
    delivers = saved.kind === "account",
    // A visitor is asked to sign in before leaving words.
    visitor = saved.kind === "visitor";
  const shops = useMemo(() => {
    if (orderedStores) return orderedStores;
    const publicIds = new Set(
      publicWalkShops({
        books: state.books,
        shops: state.shops,
        ownShop: state.ownShop,
      }).map((s) => s.id),
    );
    return [...state.shops, ...(state.ownShop ? [state.ownShop] : [])].filter(
      (shop) => {
        const override = saved.scenes.find((s) => s.storeId === shop.id);
        return override
          ? hasPublicSceneBooks(override, state.books)
          : publicIds.has(shop.id);
      },
    );
  }, [orderedStores, state.books, state.shops, state.ownShop, saved.scenes]);
  const ids = useMemo(() => shops.map((s) => s.id), [shops]);
  const reviewFolds = state.reviewFolds;
  // A 見本's shelves are filled out only with books a list may show before
  // anything is typed: never one another reader only typed in.
  const shownKey = booksBeforeSearch(state)
    .map((book) => book.id)
    .join("\n");
  const sceneBooks = useMemo(() => {
    const shown = new Set(shownKey.split("\n"));
    return state.books.filter((book) => shown.has(book.id));
  }, [state.books, shownKey]);
  const scenes = useMemo(
    () =>
      shops.map((s) =>
        resolveStoreScene(
          // An introduction folded by reports is not said in passing.
          wordsFolded({ reviewFolds }, "shop", s.id)
            ? { ...s, description: "" }
            : s,
          sceneBooks,
          state.shops.findIndex((shop) => shop.id === s.id),
          saved.scenes,
        ),
      ),
    [shops, sceneBooks, state.shops, saved.scenes, reviewFolds],
  );
  const pops = useMemo(() => publicScenePops(scenes), [scenes]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [ownMissing, setOwnMissing] = useState(false);
  const focus = useRef<HTMLElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<{
    x: number;
    y: number;
    time: number;
    target: HTMLElement;
    id: number;
  } | null>(null);
  const noClickUntil = useRef(0);
  const wheel = useRef({ last: 0, total: 0, locked: false });
  const [message, setMessage] = useState("");
  const [focusRow, setFocusRow] = useState<{
    storeId: string;
    text: string;
  } | null>(null);
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const session = walk.session;
  const currentId =
    session && !session.ended ? session.ids[session.index] : null;
  const scene = scenes.find((s) => s.storeId === currentId);
  const shop = shops.find((s) => s.id === currentId);
  // Back from a book's own page, the same book is in hand again.
  useLayerReturn((name) => {
    const held = heldBookOf(name);
    if (!held || held.shelfId || held.shopId !== currentId || !scene)
      return false;
    if (overlay?.kind === "book" && overlay.placementId === held.itemId)
      return false;
    if (!objectById(scene, held.itemId)) return false;
    setOverlay({ kind: "book", placementId: held.itemId });
    return true;
  }, Boolean(scene));
  const owner =
    shop?.ownerId === state.me.id
      ? state.me
      : state.readers.find((r) => r.id === shop?.ownerId);
  const reaction = walk.reactions[currentId ?? ""] ?? {
    liked: false,
    saved: false,
    message: "",
  };
  const background = scene?.background;
  const focusText =
    focusRow && focusRow.storeId === currentId ? focusRow.text : null;
  const popPlacement =
    overlay?.kind === "pop" && overlay.placementId && scene
      ? objectById(scene, overlay.placementId)
      : undefined;
  const popBook = bookById(state.books, popPlacement?.bookId);
  // Ways to begin a word to the owner, drawn from this shop's own shelf.
  const leadBook = scene
    ? bookById(
        state.books,
        scene.objects.find((o) => o.kind === "book" && o.display === "face")
          ?.bookId ?? scene.objects.find((o) => o.kind === "book")?.bookId,
      )
    : undefined;
  const starters = [
    "POPを読んで、読みたくなりました。",
    ...(leadBook
      ? [`${quotedTitle(leadBook)}が並んでいて、うれしくなりました。`]
      : []),
    "また来ます。",
  ];
  // One chip per shelf, top to bottom, labelled like its chalkboard.
  const shelfChips = scene
    ? scene.objects
        .filter((o) => o.kind === "row" && o.text)
        .map((o) => ({ o, top: worldPolygon(scene, o)?.[0].y ?? 1 }))
        .sort((a, b) => a.top - b.top)
        .map(({ o }) => ({
          text: o.text!,
          label: o.boardTitle ?? o.text!,
          doodle: o.doodle,
        }))
        .filter((c, i, all) => all.findIndex((x) => x.text === c.text) === i)
    : [];
  const sign = scene?.objects.find((o) => o.kind === "sign");
  const signPolygon = scene && sign ? worldPolygon(scene, sign) : null;
  const chipsTop = signPolygon
    ? boundsOf(signPolygon).y + boundsOf(signPolygon).h + 0.006
    : 0.23;
  // The like / POP / save / share controls stand in the scene's reserved area.
  const controls = scene?.forbidden[0];
  const rail = controls ? (controls.h * 16) / 9 > 1.5 * controls.w : false;
  const firstPop = scene
    ? scene.objects
        .filter((o) => o.kind === "furniture")
        .sort((a, b) => a.rect.y - b.rect.y)
        .flatMap((f) => furnitureBooks(scene, f.id))
        .find((p) => bookPop(scene, p.id)?.text)
    : undefined;
  const following = shop ? state.following.includes(shop.id) : false;
  const ownShop = shop?.ownerId === state.me.id;
  useEffect(() => {
    if (!ready) return;
    const begin = () => {
      let requested = initialStoreId;
      try {
        requested = requested ?? decodeURIComponent(location.hash.slice(1));
      } catch {}
      // Asked for one's own shop before it stands in the walk: say why.
      setOwnMissing(requested === OWN_SHOP_ID && !ids.includes(OWN_SHOP_ID));
      update((previous) => startWalk(previous, ids, requested));
    };
    begin();
    window.addEventListener("hashchange", begin);
    return () => window.removeEventListener("hashchange", begin);
  }, [ready, ids, initialStoreId, update]);
  // The shop in view is written into the address, so coming back to the walk
  // returns to it rather than to the shop the walk was entered from.
  useEffect(() => {
    if (!ready || !currentId) return;
    replaceAddress({ hash: encodeURIComponent(currentId) });
  }, [ready, currentId]);
  useEffect(() => {
    if (!currentId || overlay || walk.visits[currentId]) return;
    let remaining = 3000,
      started = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") {
        started = performance.now();
        timer = setTimeout(
          () => update((previous) => visitStore(previous, currentId)),
          remaining,
        );
      } else {
        if (timer) clearTimeout(timer);
        if (started)
          remaining = Math.max(0, remaining - (performance.now() - started));
        started = 0;
      }
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [currentId, overlay, walk.visits, update]);
  function markVisit() {
    if (currentId) update((previous) => visitStore(previous, currentId));
  }
  function open(next: Overlay) {
    focus.current = document.activeElement as HTMLElement;
    if (next?.kind === "book" || next?.kind === "pop") markVisit();
    setOverlay(next);
  }
  function close() {
    setOverlay(null);
    // The book in hand and dialogs give focus back as they go; this catches
    // what they leave on the page itself (a dialog that saved no opener) or an
    // opener that is gone. On a touch screen a field never takes it back.
    focusNextFrame(() => {
      const opener = focus.current;
      return opener?.isConnected && (fieldTakesFocus() || !takesText(opener))
        ? opener
        : stage.current;
    });
  }
  // Going past the last shop starts another round; say so once, quietly.
  const lastIndex = useRef<number | null>(null);
  useEffect(() => {
    const index = session && !session.ended ? session.index : null;
    const length = session?.ids.length ?? 0;
    if (lastIndex.current === length - 1 && index === 0 && length > 1)
      notify("街をひと回りしました。もう一周、どうぞ。");
    lastIndex.current = index;
  }, [session, notify]);
  // The first time a reader walks, a quiet line says how to turn to the next shop.
  const [firstHint, setFirstHint] = useState(false);
  const canTurn = Boolean(session && !session.ended && session.ids.length > 1);
  useEffect(() => {
    if (!ready || !canTurn) return;
    try {
      if (localStorage.getItem(WALK_HINT_KEY)) return;
      localStorage.setItem(WALK_HINT_KEY, "1");
    } catch {
      return;
    }
    setFirstHint(true);
    const timer = window.setTimeout(() => setFirstHint(false), 3600);
    return () => window.clearTimeout(timer);
  }, [ready, canTurn]);
  function step(direction: -1 | 1) {
    if (overlay) return;
    setFirstHint(false);
    update((previous) => stepWalk(previous, direction));
    focusNextFrame(() => stage.current);
  }
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const handle = (e: WheelEvent) => {
      if (
        overlay ||
        e.ctrlKey ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ||
        Math.abs(e.deltaY) < 1
      )
        return;
      e.preventDefault();
      // An overflowing chip row scrolls sideways instead of turning the store.
      const chips = (e.target as HTMLElement).closest<HTMLElement>(
        ".walk-chips",
      );
      if (chips && chips.scrollWidth > chips.clientWidth) {
        chips.scrollLeft += e.deltaY;
        return;
      }
      const gesture = wheel.current;
      if (e.timeStamp - gesture.last > 220) {
        gesture.locked = false;
        gesture.total = 0;
      }
      gesture.last = e.timeStamp;
      if (gesture.locked) return;
      gesture.total += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (Math.abs(gesture.total) >= 80) {
        gesture.locked = true;
        update((previous) => stepWalk(previous, gesture.total > 0 ? 1 : -1));
      }
    };
    element.addEventListener("wheel", handle, { passive: false });
    return () => element.removeEventListener("wheel", handle);
  }, [overlay, update, ready]);
  function pointerStart(e: PointerEvent<HTMLDivElement>) {
    if (
      overlay ||
      e.button !== 0 ||
      (e.target as HTMLElement).closest(
        "a,.walk-actions,.walk-journey-controls,.walk-owner,.walk-header-tools,.walk-chips",
      )
    )
      return;
    pointer.current = {
      x: e.clientX,
      y: e.clientY,
      time: e.timeStamp,
      target: e.target as HTMLElement,
      id: e.pointerId,
    };
  }
  function pointerEnd(e: PointerEvent<HTMLDivElement>) {
    const p = pointer.current;
    pointer.current = null;
    if (!p || p.id !== e.pointerId || overlay) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y,
      direction = verticalSwipe(dx, dy, e.timeStamp - p.time);
    if (Math.hypot(dx, dy) > 12) noClickUntil.current = performance.now() + 300;
    if (direction) {
      e.preventDefault();
      step(direction);
      return;
    }
    if (Math.hypot(dx, dy) < 12 && !p.target.closest("button,a") && scene) {
      const row = p.target.closest<HTMLElement>("[data-row]");
      if (!row) return;
      const targets = Array.from(
        row.querySelectorAll<HTMLButtonElement>("[data-placement]"),
      );
      targets.sort((a, b) => {
        const dist = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return Math.hypot(
            e.clientX - r.x - r.width / 2,
            e.clientY - r.y - r.height / 2,
          );
        };
        return dist(a) - dist(b);
      });
      targets[0]?.click();
    }
  }
  function editReaction(patch: Partial<ShopReaction>) {
    if (!currentId) return false;
    return update((previous) => ({
      ...previous,
      reactions: {
        ...previous.reactions,
        [currentId]: { ...reaction, ...patch },
      },
    }));
  }
  async function share() {
    if (!currentId) return;
    const url = new URL(
      "/walk/#" + encodeURIComponent(currentId),
      location.origin,
    ).href;
    try {
      if (navigator.share) await navigator.share({ title: shop?.name, url });
      else {
        await navigator.clipboard.writeText(url);
        notify("この書店のURLをコピーしました");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") notify("URL: " + url);
    }
  }
  const selected =
    overlay?.kind === "book" && scene
      ? objectById(scene, overlay.placementId)
      : undefined;
  const selectedRow =
    selected?.parentId && scene
      ? objectById(scene, selected.parentId)
      : undefined;
  const neighbors =
    scene && selectedRow?.parentId
      ? readingEntries(scene, selectedRow.parentId)
      : [];
  const adjacent = session
    ? [-1, 1]
        .map((n) =>
          scenes.find((s) => s.storeId === session.ids[session.index + n]),
        )
        .map((s) => s && safeBackgroundUrl(s.background.url))
        .filter((url, i, all): url is string => !!url && all.indexOf(url) === i)
    : [];
  const sceneStyle = {
    "--walk-light": scene?.theme.light ?? "#ffd293",
    "--walk-wood": scene?.theme.wood ?? "#6a371d",
    "--walk-paper": scene?.theme.paper ?? "#f1dfb7",
    "--walk-darkness": background?.darkness ?? 0.28,
    "--walk-blur": (background?.blur ?? 0) + "px",
  } as CSSProperties;
  return (
    <section
      className="walk-view"
      style={sceneStyle}
      aria-label="書店めぐり"
      onKeyDown={(e) => {
        if (
          overlay ||
          e.repeat ||
          e.altKey ||
          e.ctrlKey ||
          e.metaKey ||
          (e.target as HTMLElement).closest("input,textarea,select")
        )
          return;
        if (["ArrowDown", "PageDown", "ArrowUp", "PageUp"].includes(e.key)) {
          e.preventDefault();
          step(e.key === "ArrowDown" || e.key === "PageDown" ? 1 : -1);
        }
      }}
    >
      <div className="walk-room" aria-hidden="true">
        {!backgroundFailed && (
          <Image
            src={
              safeBackgroundUrl(background?.url) ?? "/themes/woodshop/room.webp"
            }
            alt=""
            fill
            sizes="100vw"
            loading="eager"
            unoptimized
            onError={() => setBackgroundFailed(true)}
          />
        )}
      </div>
      {adjacent.map((url) => (
        <link key={url} rel="prefetch" href={url} />
      ))}
      <header className="walk-top" inert={overlay !== null}>
        {ready && shop && scene && (
          <div className="walk-identity" key={currentId}>
            <div className="walk-owner">
              <Link href={profilePath(shop.ownerId)}>
                {owner && <ReaderAvatar reader={owner} size={40} />}
                <span>
                  <b>{owner?.name ?? shop.name}</b>
                  <small>
                    {owner ? "@" + owner.handle : "店主"}
                    {shop.demo ? " · 見本の書店" : ""}
                  </small>
                </span>
              </Link>
              {owner?.bio && !wordsFolded(state, "profile", owner.id) && (
                <p className="walk-owner-bio">{owner.bio}</p>
              )}
            </div>
            <div className="walk-header-tools">
              {!(ownShop && delivers) && (
                <button
                  aria-label={
                    delivers || visitor
                      ? "店主にひとことを伝える"
                      : "店主に伝える（送信されないデモ）"
                  }
                  onClick={() => {
                    if (visitor) return requestAccount();
                    // The sheet opens within the tap, so a phone's keyboard
                    // rises with its text box (Modal's `writing`).
                    flushSync(() => {
                      setMessage(reaction.message);
                      open({ kind: "message" });
                    });
                  }}
                >
                  <i>
                    <Icon name="mail" size={16} />
                  </i>
                  <small>伝える</small>
                </button>
              )}
              {!ownShop && (
                <button
                  aria-label="この書店をフォロー"
                  aria-pressed={following}
                  onClick={() => {
                    actions.toggleFollow(shop.id);
                    notify(
                      following
                        ? "フォローを外しました"
                        : shop.name + "をフォローしました",
                    );
                  }}
                >
                  <i>
                    <Icon name={following ? "check" : "follow"} size={16} />
                  </i>
                  <small>{following ? "フォロー中" : "フォロー"}</small>
                </button>
              )}
              <button
                aria-label="その他のメニュー"
                onClick={() => open({ kind: "menu" })}
              >
                <i>
                  <Icon name="more" size={16} />
                </i>
                <small>その他</small>
              </button>
            </div>
          </div>
        )}
        <div className="walk-journey-controls">
          <button
            aria-label="前の書店"
            disabled={!session || session.index === 0}
            onClick={() => step(-1)}
          >
            <Icon name="chevron" size={16} />
          </button>
          {shop && session && !session.ended ? (
            <span className="walk-progress" aria-live="polite">
              {session.index + 1} / {session.ids.length}
            </span>
          ) : session?.ended ? (
            <span className="walk-progress-end">また、いつでも。</span>
          ) : null}
          <button
            aria-label="次の書店"
            disabled={!session || session.ended}
            onClick={() => step(1)}
          >
            <Icon name="chevron" size={16} />
          </button>
          <small className="walk-journey-hint">
            上下にめくって、次の本屋へ
          </small>
        </div>
      </header>
      {ownMissing && (
        <p className="walk-own-missing" role="status">
          <span>
            {state.ownShop
              ? "あなたの本屋は、まだ棚に本がないので書店めぐりに出ていません。一冊並べると、ここに灯りがともります。"
              : "あなたの本屋は、まだありません。3分で開けます。"}
          </span>
          <Link href="/my-shop/">
            {state.ownShop ? "本棚を整える" : "本屋を開く"}
          </Link>
          <button aria-label="閉じる" onClick={() => setOwnMissing(false)}>
            <Icon name="close" size={14} />
          </button>
        </p>
      )}
      {saved.status === "unavailable" || saved.status === "recovered" ? (
        <p className="walk-save-warning" role="status">
          {delivers
            ? saved.status === "recovered"
              ? "保存できない変更があったため、保存されている状態に戻しました。"
              : failure(WHILE_OFFLINE)
            : saved.status === "recovered"
              ? failure({
                  what: "書店めぐりの保存を読み込めませんでした",
                  kept: "元のデータは保持しています",
                })
              : failure({
                  what: "書店めぐりを保存できません",
                  kept: "この操作は再読み込みすると失われます",
                })}
        </p>
      ) : null}
      <div
        className="walk-stage"
        ref={stage}
        tabIndex={-1}
        onPointerDown={pointerStart}
        onPointerUp={pointerEnd}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onClickCapture={(e) => {
          if (
            performance.now() < noClickUntil.current &&
            (e.target as HTMLElement).closest(".walk-store-objects")
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div
          className="walk-artboard"
          key={currentId ?? "end"}
          inert={overlay !== null}
        >
          {!ready ? (
            <div className="walk-end">
              <p>書店の灯りをともしています</p>
            </div>
          ) : shop && scene ? (
            <>
              {scene.theme.id === "woodshop" && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="walk-lamp"
                    src="/themes/woodshop/lamp-pendant-v1.svg"
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="walk-lamp-light" aria-hidden="true" />
                </>
              )}
              {shelfChips.length > 1 && (
                <div
                  className="walk-chips"
                  role="group"
                  aria-label="棚を選んで照らす"
                  style={{ top: chipsTop * 100 + "%" }}
                >
                  {[null, ...shelfChips].map((chip) => (
                    <button
                      key={chip?.text ?? ""}
                      aria-pressed={focusText === (chip?.text ?? null)}
                      aria-label={
                        chip ? chip.label + "（" + chip.text + "）" : undefined
                      }
                      onClick={() =>
                        setFocusRow(
                          chip && currentId
                            ? { storeId: currentId, text: chip.text }
                            : null,
                        )
                      }
                    >
                      <DoodleIcon name={chip?.doodle ?? "leaf"} />
                      {chip?.label ?? "すべて"}
                    </button>
                  ))}
                </div>
              )}
              <StoreCanvas
                scene={scene}
                books={state.books}
                signature={owner?.name}
                tagline={ownTagline(shop)}
                focusText={focusText}
                greetingHref={
                  ownShop && !scene.ownerManaged
                    ? "/my-shop/#shop-words"
                    : undefined
                }
                onBook={(p) => open({ kind: "book", placementId: p.id })}
                onZoom={(rowId) => open({ kind: "zoom", rowId })}
                onPop={(p) =>
                  open({
                    kind: "pop",
                    title: (titleById(state.books, p.bookId) ?? "本") + "のPOP",
                    text: bookPop(scene, p.id)?.text ?? "",
                    stamp: bookPop(scene, p.id)?.stamp,
                    placementId: p.id,
                  })
                }
                onLabel={(o) =>
                  open({
                    kind: "pop",
                    title:
                      o.kind === "ownerPop"
                        ? "店主から"
                        : (o.text ?? shop.name),
                    text:
                      o.kind === "row"
                        ? wordsFolded(state, "shop", shop.id)
                          ? ""
                          : shop.description
                        : (o.text ?? ""),
                  })
                }
              />
              {firstHint && (
                <p className="walk-first-hint" role="status">
                  <i aria-hidden="true">↑</i>
                  上にめくると、となりの本屋へ
                </p>
              )}
              <div
                className={"walk-actions" + (rail ? " is-rail" : "")}
                style={
                  controls
                    ? {
                        left: controls.x * 100 + "%",
                        top: controls.y * 100 + "%",
                        width: controls.w * 100 + "%",
                        height: controls.h * 100 + "%",
                      }
                    : undefined
                }
              >
                {ownShop ? (
                  // One's own shop is tended, not liked or kept for later.
                  <Link href="/my-shop/" aria-label="自分の店を整える">
                    <span>
                      <Icon name="edit" />
                    </span>
                    <small>整える</small>
                  </Link>
                ) : (
                  <button
                    aria-label="この店が好き"
                    aria-pressed={reaction.liked}
                    onClick={() => editReaction({ liked: !reaction.liked })}
                  >
                    <span>
                      <Icon name="heart" />
                    </span>
                    <small>好き</small>
                  </button>
                )}
                <button
                  aria-label="この店のPOPを読む"
                  disabled={!firstPop}
                  onClick={() =>
                    firstPop && open({ kind: "book", placementId: firstPop.id })
                  }
                >
                  <span>
                    <Icon name="chat" />
                  </span>
                  <small>POP</small>
                </button>
                {!ownShop && (
                  <button
                    aria-label="書店を保存"
                    aria-pressed={reaction.saved}
                    onClick={() => {
                      // Say where a kept shop can be found again.
                      if (
                        editReaction({ saved: !reaction.saved }) &&
                        !reaction.saved &&
                        shop
                      )
                        notify(
                          `「${shop.name}」を保存しました。プロフィールの「あとで寄る書店」から戻れます。`,
                        );
                    }}
                  >
                    <span>
                      <Icon name="bookmark" />
                    </span>
                    <small>保存</small>
                  </button>
                )}
                <button aria-label="この書店を共有" onClick={share}>
                  <span>
                    <Icon name="share" />
                  </span>
                  <small>共有</small>
                </button>
              </div>
            </>
          ) : (
            <div className="walk-end">
              <Icon name="store" size={40} />
              {shops.length ? (
                <p>書店の灯りをともしています</p>
              ) : (
                <>
                  <h1>まだ、灯りのついた書店がありません</h1>
                  <p>最初の一軒を開くと、ここから街の人が訪ねてこられます。</p>
                  <Link className="btn fill" href="/my-shop/">
                    {state.ownShop ? "自分の書店を整える" : "本屋を開く"}
                    <Icon name="arrow" />
                  </Link>
                </>
              )}
              <Link href="/reading/">読書を開始する</Link>
            </div>
          )}
        </div>
      </div>
      {overlay?.kind === "book" && selected && (
        <BookInHand
          state={state}
          actions={actions}
          notify={notify}
          reading={{
            entries: neighbors,
            initialId: selected.id,
            allPops: pops,
            reactions: walk.placementReactions,
            toggleReaction: (key, value) =>
              update((previous) => {
                const old = previous.placementReactions[key] ?? [];
                return {
                  ...previous,
                  placementReactions: {
                    ...previous.placementReactions,
                    [key]: old.includes(value)
                      ? old.filter((r) => r !== value)
                      : [...old, value],
                  },
                };
              }),
          }}
          onClose={() => {
            if (overlay.returnRow)
              setOverlay({
                kind: "zoom",
                rowId: overlay.returnRow,
                initialId: overlay.placementId,
              });
            else close();
          }}
        />
      )}
      {overlay?.kind === "zoom" && scene && (
        <ShelfZoom
          scene={scene}
          rowId={overlay.rowId}
          initialId={overlay.initialId}
          books={state.books}
          onClose={close}
          onBook={(p) => {
            markVisit();
            setOverlay({
              kind: "book",
              placementId: p.id,
              returnRow: overlay.rowId,
            });
          }}
        />
      )}
      {overlay?.kind === "pop" && (
        <Modal title={overlay.title} onClose={close}>
          <p className="walk-full-pop">{overlay.text}</p>
          {overlay.stamp && (
            <span className="walk-full-stamp">
              <StoreStamp name={overlay.stamp} />
            </span>
          )}
          {owner && <p className="muted">— {owner.name}</p>}
          {popBook && (
            <button
              className="walk-pop-book"
              onClick={() =>
                setOverlay({ kind: "book", placementId: overlay.placementId! })
              }
            >
              <BookJacket book={popBook} />
              <span>
                <b>{bookTitle(popBook)}</b>
                <small>{bookAuthor(popBook)}</small>
                <em>
                  この本を手に取る <Icon name="arrow" size={14} />
                </em>
              </span>
            </button>
          )}
        </Modal>
      )}
      {overlay?.kind === "message" && delivers && (
        <Modal title="店主にひとことを残す" onClose={close} writing>
          <p className="note-box">
            店主に届きます。読めるのは、店主とあなただけです。消して届け直すと、店主からも見えなくなります。
          </p>
          <MessageStarters
            starters={starters}
            onPick={(text) => setMessage(joinStarter(message, text))}
          />
          <textarea
            className="field walk-message"
            aria-label="店主に伝えたい言葉"
            value={message}
            maxLength={SHOP_MESSAGE_MAX_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
          />
          <MessageSend>
            <button
              className="btn fill"
              onClick={() => {
                const text = message.trim() ? message : "";
                const persisted = editReaction({ message: text });
                notify(
                  !persisted
                    ? failure({
                        what: "届けられませんでした",
                        kept: "言葉は再読み込みまで手元に残ります",
                      })
                    : text
                      ? "ひとことを届けました。"
                      : "ひとことを取り消しました。",
                );
                close();
              }}
            >
              届ける
            </button>
          </MessageSend>
        </Modal>
      )}
      {overlay?.kind === "message" && !delivers && (
        <Modal title="店主に伝える" onClose={close} writing>
          <MessageStarters
            starters={starters}
            onPick={(text) => setMessage(joinStarter(message, text))}
          />
          <textarea
            className="field walk-message"
            aria-label="店主に伝えたい言葉"
            value={message}
            maxLength={SHOP_MESSAGE_MAX_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
          />
          <MessageSend
            note={
              <p className="walk-message-note">
                送信されないデモです。言葉はこのブラウザにだけ残ります。
              </p>
            }
          >
            <button
              className="btn fill"
              onClick={() => {
                const persisted = editReaction({ message });
                notify(
                  persisted
                    ? "言葉を手元に保存しました。店主には送信されません。"
                    : failure({
                        what: "保存できませんでした",
                        kept: "言葉は再読み込みまで手元に残ります",
                      }),
                );
                close();
              }}
            >
              手元に保存する
            </button>
          </MessageSend>
        </Modal>
      )}
      {overlay?.kind === "menu" && shop && (
        <Modal title={shop.name} onClose={close}>
          <div className="walk-menu">
            <Link
              className="btn"
              href={ownShop ? "/my-shop/" : shopPath(shop.id)}
            >
              <Icon name="store" />
              書店のページを見る
            </Link>
            <button
              className="btn"
              onClick={() => setOverlay({ kind: "history" })}
            >
              <Icon name="clock" />
              訪問履歴
            </button>
            {!ownShop && (
              <ReportButton
                className="btn"
                target={{ kind: "shop", id: shop.id, name: shop.name }}
                onOpen={close}
              >
                <Icon name="flag" />
                この書店を通報
              </ReportButton>
            )}
          </div>
        </Modal>
      )}
      {overlay?.kind === "history" && (
        <Modal title="訪問履歴" onClose={close}>
          <p className="muted">
            訪問履歴と途中位置を削除できます。好き・保存の状態は残ります。
          </p>
          <ul className="walk-history-list">
            {Object.entries(walk.visits).map(([id, date]) => (
              <li key={id}>
                {shops.find((s) => s.id === id)?.name ?? id}
                <time>{new Date(date).toLocaleDateString("ja-JP")}</time>
              </li>
            ))}
          </ul>
          <button
            className="btn"
            onClick={() => {
              update((previous) =>
                startWalk(
                  clearVisits(previous),
                  shops.map((s) => s.id),
                ),
              );
              close();
              notify("訪問履歴と途中位置を削除しました");
            }}
          >
            訪問履歴と途中位置を削除
          </button>
        </Modal>
      )}
    </section>
  );
}

/** Appends a starter on its own line; a starter already written is not repeated. */
function joinStarter(message: string, starter: string) {
  if (message.includes(starter)) return message;
  return message.trim() ? message.replace(/\s*$/, "\n") + starter : starter;
}
/**
 * The button that sends words to an owner, and a line about it. With a
 * finger the button is the writing sheet's toolbar, last, just above the
 * keyboard, the line over it; with a mouse both stand as they always have,
 * the line under the button.
 */
function MessageSend({
  note,
  children,
}: {
  note?: ReactNode;
  children: ReactNode;
}) {
  return useCoarsePointer() ? (
    <>
      {note}
      <div className="writing-toolbar">{children}</div>
    </>
  ) : (
    <>
      {children}
      {note}
    </>
  );
}
function MessageStarters({
  starters,
  onPick,
}: {
  starters: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="walk-starters" role="group" aria-label="書き出しの例">
      {starters.map((text) => (
        <button key={text} type="button" onClick={() => onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  );
}
