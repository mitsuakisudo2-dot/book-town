"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { preload } from "react-dom";
import { Icon, Modal, ReaderAvatar } from "./ui";
import { BookInHand } from "./BookInHand";
import { DoodleIcon, StoreCanvas, StoreStamp } from "./StoreCanvas";
import { ShelfZoom } from "./ShelfZoom";
import {
  bookPop,
  boundsOf,
  furnitureBooks,
  objectById,
  worldPolygon,
} from "../lib/store-scene";
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
import {
  SHOP_MESSAGE_MAX_LENGTH,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import "./walk.css";
import { profilePath, shopPath } from "../lib/paths";

type Overlay =
  | { kind: "book"; placementId: string; returnRow?: string }
  | { kind: "zoom"; rowId: string; initialId?: string }
  | { kind: "pop"; text: string; title: string; stamp?: string }
  | { kind: "message" }
  | { kind: "history" }
  | { kind: "menu" }
  | null;
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
  const scenes = useMemo(
    () =>
      shops.map((s) =>
        resolveStoreScene(
          s,
          state.books,
          state.shops.findIndex((shop) => shop.id === s.id),
          saved.scenes,
        ),
      ),
    [shops, state.books, state.shops, saved.scenes],
  );
  const pops = useMemo(() => publicScenePops(scenes), [scenes]);
  const [overlay, setOverlay] = useState<Overlay>(null);
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
      update((previous) => startWalk(previous, ids, requested));
    };
    begin();
    window.addEventListener("hashchange", begin);
    return () => window.removeEventListener("hashchange", begin);
  }, [ready, ids, initialStoreId, update]);
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
    requestAnimationFrame(() => {
      if (focus.current?.isConnected)
        focus.current.focus({ preventScroll: true });
      else stage.current?.focus({ preventScroll: true });
    });
  }
  function step(direction: -1 | 1) {
    if (overlay) return;
    update((previous) => stepWalk(previous, direction));
    requestAnimationFrame(() => stage.current?.focus({ preventScroll: true }));
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
        .filter(Boolean)
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
            src={background?.url ?? "/themes/woodshop/room.webp"}
            alt=""
            fill
            sizes="100vw"
            loading="eager"
            unoptimized
            onError={() => setBackgroundFailed(true)}
          />
        )}
      </div>
      {adjacent.map((s) => (
        <link key={s!.storeId} rel="prefetch" href={s!.background.url} />
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
              {owner?.bio && <p className="walk-owner-bio">{owner.bio}</p>}
            </div>
            <div className="walk-header-tools">
              {!(ownShop && delivers) && (
                <button
                  aria-label={
                    delivers || visitor
                      ? "店主にひとことを残す"
                      : "店主に伝える（送信されないデモ）"
                  }
                  onClick={() => {
                    if (visitor) return requestAccount();
                    setMessage(reaction.message);
                    open({ kind: "message" });
                  }}
                >
                  <Icon name="mail" size={16} />
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
                  <Icon name={following ? "check" : "follow"} size={16} />
                </button>
              )}
              <button
                aria-label="その他のメニュー"
                onClick={() => open({ kind: "menu" })}
              >
                <Icon name="more" size={16} />
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
      {saved.status === "unavailable" || saved.status === "recovered" ? (
        <p className="walk-save-warning" role="status">
          {delivers
            ? saved.status === "recovered"
              ? "保存できない変更があったため、保存されている状態に戻しました。"
              : "つながらないため、まだ保存できていません。つながりしだい保存します。"
            : saved.status === "recovered"
              ? "書店めぐりの保存を読み込めませんでした。元のデータは保持しています。"
              : "書店めぐりを保存できません。この操作は再読み込みすると失われます。"}
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
                tagline={shop.tagline}
                focusText={focusText}
                onBook={(p) => open({ kind: "book", placementId: p.id })}
                onZoom={(rowId) => open({ kind: "zoom", rowId })}
                onPop={(p) =>
                  open({
                    kind: "pop",
                    title:
                      (state.books.find((b) => b.id === p.bookId)?.title ??
                        "本") + "のPOP",
                    text: bookPop(scene, p.id)?.text ?? "",
                    stamp: bookPop(scene, p.id)?.stamp,
                  })
                }
                onLabel={(o) =>
                  open({
                    kind: "pop",
                    title:
                      o.kind === "ownerPop"
                        ? "店主から"
                        : (o.text ?? shop.name),
                    text: o.kind === "row" ? shop.description : (o.text ?? ""),
                  })
                }
              />
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
                <button
                  aria-label="書店を保存"
                  aria-pressed={reaction.saved}
                  onClick={() => editReaction({ saved: !reaction.saved })}
                >
                  <span>
                    <Icon name="bookmark" />
                  </span>
                  <small>保存</small>
                </button>
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
              <h1>
                {shops.length
                  ? "今日めぐれる書店はここまで"
                  : "公開されている書店がありません"}
              </h1>
              <p>気になった一冊を、手に取る時間へ。</p>
              {shops.length > 0 && (
                <button
                  className="button"
                  onClick={() =>
                    update((previous) =>
                      startWalk(
                        previous,
                        shops.map((s) => s.id),
                        undefined,
                        undefined,
                        true,
                      ),
                    )
                  }
                >
                  最初からめぐる
                  <Icon name="arrow" />
                </button>
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
        </Modal>
      )}
      {overlay?.kind === "message" && delivers && (
        <Modal title="店主にひとことを残す" onClose={close}>
          <p className="note-box">
            店主に届きます。読めるのは、店主とあなただけです。消して届け直すと、店主からも見えなくなります。
          </p>
          <textarea
            className="field walk-message"
            aria-label="店主に伝えたい言葉"
            value={message}
            maxLength={SHOP_MESSAGE_MAX_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            className="button"
            onClick={() => {
              const text = message.trim() ? message : "";
              const persisted = editReaction({ message: text });
              notify(
                !persisted
                  ? "届けられませんでした。言葉は再読み込みまで手元に残ります。"
                  : text
                    ? "ひとことを届けました。"
                    : "ひとことを取り消しました。",
              );
              close();
            }}
          >
            届ける
          </button>
        </Modal>
      )}
      {overlay?.kind === "message" && !delivers && (
        <Modal title="店主に伝える" onClose={close}>
          <p className="note-box">
            送信されないデモです。書いた言葉は、このブラウザにだけ残ります。
          </p>
          <textarea
            className="field walk-message"
            aria-label="店主に伝えたい言葉"
            value={message}
            maxLength={SHOP_MESSAGE_MAX_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            className="button"
            onClick={() => {
              const persisted = editReaction({ message });
              notify(
                persisted
                  ? "言葉を手元に保存しました。店主には送信されません。"
                  : "保存できませんでした。言葉は再読み込みまで手元に残ります。",
              );
              close();
            }}
          >
            手元に保存する
          </button>
        </Modal>
      )}
      {overlay?.kind === "menu" && shop && (
        <Modal title={shop.name} onClose={close}>
          <div className="walk-menu">
            <Link
              className="button secondary"
              href={ownShop ? "/my-shop/" : shopPath(shop.id)}
            >
              <Icon name="store" />
              書店のページを見る
            </Link>
            <button
              className="button secondary"
              onClick={() => setOverlay({ kind: "history" })}
            >
              <Icon name="clock" />
              訪問履歴
            </button>
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
            className="button secondary"
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
