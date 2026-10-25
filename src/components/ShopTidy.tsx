"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  changePlacement,
  insertPlacement,
  migrateShopScene,
  moveBook,
  renameSceneObject,
  setRowBoard,
  applyStoreTemplate,
  DOODLE_CHOICES,
  STAMP_CHOICES,
  STORE_TEMPLATES,
  type TemplateId,
  setShopSize,
  takePlacementOff,
} from "../lib/store-customization";
import {
  bookPop,
  objectById,
  unplacedBooks,
  type SceneObject,
  type StoreScene,
} from "../lib/store-scene";
import {
  CASE_ID,
  GROW,
  pinRow,
  unpinRow,
  type ShopSize,
} from "../lib/growing-shop";
import { saveOwnedScene, useWalkStore, walkStore } from "../lib/walk-store";
import { useKeptDraft } from "../lib/kept-draft";
import {
  keepUntilSaved,
  sceneDraftStore,
  sceneMark,
  sceneWorkKey,
  sceneWorkState,
} from "../lib/scene-draft";
import { useBackLayer } from "../lib/back-layer";
import { useBookSearch } from "../lib/search/use-book-search";
import { booksBeforeSearch } from "../lib/book-lists";
import { bookAuthor, bookById, bookTitle } from "../lib/book-name";
import { walkPath } from "../lib/paths";
import {
  SCENE_BOARD_TITLE_MAX_LENGTH,
  SCENE_POP_MAX_LENGTH,
  SCENE_ROW_TEXT_MAX_LENGTH,
  SCENE_TEXT_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  type Book,
  type Notify,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import { keyboardRoom } from "../lib/coarse-pointer";
import { AGAIN, counted, failure, nth } from "../lib/words";
import { DoodleIcon, StoreCanvas, StoreStamp } from "./StoreCanvas";
import { ShopSizeChoices, sizeName } from "./ShopSize";
import { BookJacket, Icon } from "./ui";
import { KeptDraftNote, useDraftOwner } from "./KeptDraftNote";
import "./walk.css";
import "./scene-editor.css";

/** Work kept in this browser (整えるの書きかけ), said only here: the words stay
 * out of the shop's drawing, which every walk reads. */
const KEPT = {
  kept: "まだ店に入っていない書きかけを、このブラウザに残しています",
  over: "書きかけより新しい店が保存されています。戻すと、いまの店と入れ替わります",
  putBack: "書きかけを戻す",
  back: "書きかけを戻しました。",
  first: "書きかけを戻すか消すと、続けて整えられます。",
} as const;

/** Where a book would go: the tier, and its place among the other books. */
type Spot = { rowId: string; index: number };
/** The tiers and their books where they stood when a book was picked up,
 * so the place a finger points at does not move while the gap opens. */
type Ground = Array<{
  rowId: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  books: Array<{ id: string; mid: number }>;
}>;
type Lift = {
  id: string;
  x: number;
  y: number;
  at: Spot | null;
  ground: Ground;
};
/** How long a finger rests on a book before it is picked up (試作 0.38 秒). */
const LIFT_MS = 380;
/** How far a finger may slide while resting, in px. */
const LIFT_SLOP = 8;

/** The place a point is over: the nearest tier across it, then the books
 * before the point on that tier. */
function spotAt(ground: Ground, x: number, y: number, id: string): Spot | null {
  let best: Ground[number] | undefined;
  let gap = Infinity;
  for (const tier of ground) {
    if (x < tier.left - 24 || x > tier.right + 24) continue;
    const d =
      y < tier.top ? tier.top - y : y > tier.bottom ? y - tier.bottom : 0;
    if (d < gap) {
      gap = d;
      best = tier;
    }
  }
  if (!best || gap > (best.bottom - best.top) * 0.6) return null;
  return {
    rowId: best.rowId,
    index: best.books.filter((b) => b.id !== id && b.mid < x).length,
  };
}

type Sheet =
  | { kind: "add" }
  | { kind: "face" }
  | { kind: "size" }
  | { kind: "waiting" }
  | { kind: "row"; rowId: string }
  | { kind: "book"; id: string; writing?: boolean };

/**
 * 整える: the shop itself is where it is arranged (けにーさん 10-25 「全部ここで
 * できるようにすればいいじゃん！」). The shop fills the screen; books are added,
 * the size chosen and each book turned, given words or taken down from the
 * tools below and the sheet a book opens. Every change is saved at once and
 * 元に戻す takes it back, one step at a time.
 */
export function ShopTidy({
  shop,
  state,
  actions,
  saved,
  ready,
  onClose,
  notify,
}: {
  shop: Shop;
  state: TownState;
  actions: TownActions;
  /** The scene saved for this shop, if it has one. */
  saved: StoreScene | undefined;
  /** The town and the walk are both read, so a save lands on what is known. */
  ready: boolean;
  onClose: () => void;
  notify: Notify;
}) {
  // 戻る closes the screen, as it would a dialog.
  useBackLayer(onClose);
  const scene = useMemo(
    () => migrateShopScene(shop, state.books, saved),
    [shop, state.books, saved],
  );
  // Each change is kept in this browser until the account has it: a change
  // the account refuses comes back here and waits, with the shop as the
  // account holds it, for the reader to put it back or throw it away.
  const walk = useWalkStore();
  const key = sceneWorkKey(useDraftOwner(), shop.id);
  const kept = useKeptDraft(sceneDraftStore, key);
  const mark = sceneMark(saved);
  const work = kept.draft?.scene.storeId === shop.id ? kept.draft : null;
  const standing = work ? sceneWorkState(work, mark) : null;
  const held = standing === "fresh" || standing === "stale" ? work : null;
  const done = standing === "saved" && walk.status === "saved";
  useEffect(() => {
    if (done && key) sceneDraftStore.clear(key);
  }, [done, key]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [undo, setUndo] = useState<StoreScene[]>([]);
  const [query, setQuery] = useState("");
  const top = useRef<HTMLButtonElement>(null);
  const board = useRef<HTMLDivElement>(null);
  // A book picked up and carried (持ち上げて運ぶ), or one whose sheet asked
  // to be moved (動かす) and waits for the place to be pressed.
  const [lift, setLift] = useState<Lift | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const carried = useRef(false);
  // The keyboard's room while a book is searched for, on a phone.
  const [room, setRoom] = useState<{ top: number; height: number } | null>(
    null,
  );
  // Escape puts a carried book back before it closes the screen.
  const escape = useRef(onClose);
  useEffect(() => {
    escape.current =
      lift || placing
        ? () => {
            setLift(null);
            setPlacing(null);
          }
        : onClose;
  }, [onClose, lift, placing]);
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    top.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") escape.current();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
    };
  }, []);

  // Words typed into one field are one step for 元に戻す, saved as they are
  // typed so nothing written waits unsaved.
  const typing = useRef<string | null>(null);
  /** Saves the shop as `next`; the shop as it was waits for 元に戻す. */
  function save(next: StoreScene, said?: string, field?: string) {
    if (held) {
      notify(KEPT.first);
      return false;
    }
    // Work still on its way began from the scene the account had last.
    const from = work ? work.from : mark;
    if (!ready || !saveOwnedScene(next, state).ok) {
      notify(failure({ what: "店を保存できませんでした", next: AGAIN.later }));
      return false;
    }
    keep(next, from);
    if (!field || field !== typing.current)
      setUndo((all) => [...all.slice(-19), scene]);
    typing.current = field ?? null;
    if (said) notify(said);
    return true;
  }
  /** Keeps a scene sent to the account until the account has it. */
  function keep(sent: StoreScene, from: string) {
    if (!key) return;
    if (walk.kind !== "account") {
      sceneDraftStore.clear(key);
      return;
    }
    sceneDraftStore.set(key, { scene: sent, from });
    keepUntilSaved(sceneDraftStore, key, sent, walkStore);
  }
  /** Puts kept work back in the shop's place, as the reader asked. */
  function putBack() {
    if (!held) return;
    const next = migrateShopScene(shop, state.books, held.scene);
    if (!ready || !saveOwnedScene(next, state).ok) {
      notify(
        failure({ what: "書きかけを戻せませんでした", next: AGAIN.later }),
      );
      return;
    }
    keep(next, mark);
    setUndo((all) => [...all.slice(-19), scene]);
    typing.current = null;
    notify(KEPT.back);
  }
  function stepBack() {
    const before = undo.at(-1);
    if (!before) return;
    if (held) {
      notify(KEPT.first);
      return;
    }
    const from = work ? work.from : mark;
    if (!ready || !saveOwnedScene(before, state).ok) {
      notify(failure({ what: "元に戻せませんでした", next: AGAIN.later }));
      return;
    }
    keep(before, from);
    setUndo((all) => all.slice(0, -1));
    typing.current = null;
    setSheet(null);
  }

  const caseRows = scene.objects
    .filter((o) => o.kind === "row" && o.parentId === CASE_ID)
    .sort((a, b) => a.rect.y - b.rect.y);
  const rowNumber = (rowId: string | null | undefined) =>
    caseRows.findIndex((r) => r.id === rowId) + 1;
  const waiting = unplacedBooks(scene);
  // Tiers the shop has just grown open as they appear.
  const tierIds = caseRows.map((r) => r.id).join(" ");
  const [seenTiers, setSeenTiers] = useState(tierIds);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  if (tierIds !== seenTiers) {
    const before = new Set(seenTiers.split(" "));
    setFresh(
      new Set(caseRows.map((r) => r.id).filter((id) => !before.has(id))),
    );
    setSeenTiers(tierIds);
  }

  /** The tiers and their books as they stand on the screen now. */
  function ground(): Ground {
    const root = board.current;
    if (!root) return [];
    const box = (id: string, attr: string) =>
      root
        .querySelector(`[${attr}="${CSS.escape(id)}"]`)
        ?.getBoundingClientRect();
    return caseRows.flatMap((row) => {
      const tier = box(row.id, "data-row");
      if (!tier) return [];
      const books = scene.objects
        .filter((o) => o.kind === "book" && o.parentId === row.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .flatMap((p) => {
          const b = box(p.id, "data-placement");
          return b ? [{ id: p.id, mid: b.left + b.width / 2 }] : [];
        });
      return [
        {
          rowId: row.id,
          top: tier.top,
          bottom: tier.bottom,
          left: tier.left,
          right: tier.right,
          books,
        },
      ];
    });
  }
  /** Sets a book down at `spot`; where it already stood, nothing changes. */
  function carry(id: string, spot: Spot) {
    const p = objectById(scene, id);
    if (!p) return;
    const here =
      p.parentId === spot.rowId &&
      spot.index ===
        scene.objects.filter(
          (o) =>
            o.kind === "book" &&
            o.parentId === p.parentId &&
            (o.order ?? 0) < (p.order ?? 0),
        ).length;
    if (here) return;
    const next = moveBook(scene, id, spot.rowId, spot.index, state.books);
    if (!next) notify(GROW.full);
    else save(next);
  }
  // While a book is carried, the shop shows it set down where it would go.
  const liftId = lift?.id;
  const liftRow = lift?.at?.rowId;
  const liftIndex = lift?.at?.index;
  const preview = useMemo(
    () =>
      liftId && liftRow !== undefined && liftIndex !== undefined
        ? moveBook(scene, liftId, liftRow, liftIndex, state.books)
        : null,
    [scene, liftId, liftRow, liftIndex, state.books],
  );
  const lit: ReadonlySet<string> = placing
    ? new Set(caseRows.map((r) => r.id))
    : liftRow && preview
      ? new Set([liftRow])
      : new Set();
  // On a phone a sheet being typed in keeps above the keyboard.
  const open = sheet !== null;
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const fit = () => {
      const r = keyboardRoom(viewport, window.innerHeight);
      setRoom(r?.up ? { top: r.top, height: r.height } : null);
    };
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      setRoom(null);
    };
  }, [open]);
  const onShelves = new Set(
    shop.shelves.flatMap((s) => s.items.map((i) => i.bookId)),
  );
  const publicCount = shop.shelves
    .filter((s) => s.isPublic)
    .reduce(
      (n, s) =>
        n + s.items.filter((i) => bookById(state.books, i.bookId)).length,
      0,
    );
  // Books to add: the reader's own first, as every book search finds them.
  const found = useBookSearch(state.books, query, {
    own: state.library,
    limit: 12,
    genreFinds: booksBeforeSearch(state),
  });
  const choices = (
    query.trim()
      ? found.found.map((m) => m.book)
      : state.books.filter((b) => state.library.includes(b.id))
  )
    .filter((b) => !onShelves.has(b.id))
    .slice(0, 12);

  function addBook(book: Book) {
    // The shop shows its public shelves: a book goes on the first with room.
    const shelf = shop.shelves.find(
      (s) => s.isPublic && actions.addShelfBook(s.id, book.id, "spine"),
    );
    if (!shelf) {
      notify(
        failure({
          what: "棚の空きが足りず、並べられませんでした",
          next: "「棚をつくる」で公開の棚を足してください",
        }),
      );
      return;
    }
    notify(`「${bookTitle(book)}」を並べました。`);
  }
  function chooseSize(size: ShopSize) {
    save(
      setShopSize(scene, size, shop, state.books),
      GROW.chosen(sizeName(size)),
    );
  }
  /** Sets a waiting book out again: one of the shelves goes back to the shop
   * to place; one the owner added here goes after the books of a tier. */
  function setOut(p: SceneObject) {
    let next = structuredClone(scene);
    if (p.source) {
      delete objectById(next, p.id)!.held;
      next = migrateShopScene(shop, state.books, next);
    }
    if (!objectById(next, p.id)!.parentId)
      for (const row of caseRows) {
        const trial = insertPlacement(next, p.id, row.id, Infinity);
        if (objectById(trial, p.id)!.parentId) {
          next = trial;
          break;
        }
      }
    if (!objectById(next, p.id)!.parentId) {
      notify(GROW.noRoom);
      return;
    }
    save(next);
  }

  function rest(e: React.PointerEvent<HTMLDivElement>) {
    if (placing || !ready || e.button > 0) return;
    const id = (e.target as Element)
      .closest("[data-placement]")
      ?.getAttribute("data-placement");
    const p = id ? objectById(scene, id) : undefined;
    if (!p || !caseRows.some((r) => r.id === p.parentId)) return;
    const { pointerId, clientX: x, clientY: y } = e;
    const target = e.currentTarget;
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // The finger has already left; nothing is picked up.
          return;
        }
        setSheet(null);
        setLift({ id: p.id, x, y, at: null, ground: ground() });
      }, LIFT_MS),
    };
  }
  function slide(e: React.PointerEvent<HTMLDivElement>) {
    const held = press.current;
    if (
      held &&
      Math.hypot(e.clientX - held.x, e.clientY - held.y) > LIFT_SLOP
    ) {
      window.clearTimeout(held.timer);
      press.current = null;
    }
    if (!lift) return;
    setLift({
      ...lift,
      x: e.clientX,
      y: e.clientY,
      at: spotAt(lift.ground, e.clientX, e.clientY, lift.id),
    });
  }
  function letGo(e: React.PointerEvent<HTMLDivElement>) {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    if (!lift) return;
    // The click that ends the press, if one comes, is not a press on the
    // book.
    carried.current = true;
    window.setTimeout(() => (carried.current = false));
    setLift(null);
    // Let go off the shelves, the book goes back where it was.
    if (e.type === "pointerup" && lift.at) carry(lift.id, lift.at);
  }

  const style = {
    "--walk-wood": scene.theme.wood,
    "--walk-paper": scene.theme.paper,
    "--walk-light": scene.theme.light,
    "--walk-darkness": scene.background.darkness,
  } as CSSProperties;
  const show = (next: Sheet | null) => {
    typing.current = null;
    setSheet(next);
  };
  const placement =
    sheet?.kind === "book" ? objectById(scene, sheet.id) : undefined;
  const book = bookById(state.books, placement?.bookId);
  const sheetRow =
    sheet?.kind === "row"
      ? objectById(scene, sheet.rowId)
      : placement?.parentId
        ? objectById(scene, placement.parentId)
        : undefined;

  return (
    <div
      className={"tidy walk-view" + (room ? " is-typing" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={`${shop.name}を整える`}
      style={room ? { ...style, top: room.top, height: room.height } : style}
    >
      <header className="tidy-top">
        <button
          ref={top}
          type="button"
          className="icon-btn"
          aria-label="閉じる"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        <h2>{shop.name}を整える</h2>
        <Link className="btn fill" href={walkPath("mine")}>
          見る
        </Link>
      </header>
      <KeptDraftNote
        className="tidy-kept"
        work={work !== null}
        continuing={held !== null}
        saved={kept.saved}
        wordsLost
        onDiscard={() => kept.clear()}
        lead={standing === "stale" ? KEPT.over : KEPT.kept}
        action={
          <button type="button" disabled={!ready} onClick={putBack}>
            {KEPT.putBack}
          </button>
        }
      />
      <div
        className={
          "walk-stage scene-preview tidy-stage" +
          (lift || placing ? " is-carrying" : "")
        }
        onClick={(e) => {
          if (e.target === e.currentTarget) setSheet(null);
        }}
      >
        <div
          ref={board}
          className="walk-artboard"
          aria-label="店内"
          onPointerDown={rest}
          onPointerMove={slide}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onContextMenu={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            if (carried.current) {
              carried.current = false;
              e.preventDefault();
              e.stopPropagation();
            } else if (placing) {
              e.preventDefault();
              e.stopPropagation();
              const spot = spotAt(ground(), e.clientX, e.clientY, placing);
              if (!spot) return;
              setPlacing(null);
              carry(placing, spot);
            }
          }}
        >
          <StoreCanvas
            scene={preview ?? scene}
            books={state.books}
            arranging={{ lit, lifted: lift?.id ?? placing, fresh }}
            onBook={(p) => show({ kind: "book", id: p.id })}
            onPop={(p) => show({ kind: "book", id: p.id })}
            onZoom={(rowId) => show({ kind: "row", rowId })}
            onLabel={(o) =>
              show(
                o.kind === "row"
                  ? { kind: "row", rowId: o.id }
                  : { kind: "face" },
              )
            }
          />
        </div>
      </div>
      {lift && bookById(state.books, objectById(scene, lift.id)?.bookId) && (
        <div
          className="tidy-carried"
          style={{ left: lift.x, top: lift.y }}
          aria-hidden="true"
        >
          <BookJacket
            book={bookById(state.books, objectById(scene, lift.id)!.bookId)!}
            sizes="46px"
          />
        </div>
      )}
      {placing && (
        <div className="tidy-placing" role="status">
          <span>{GROW.place}</span>
          <button
            type="button"
            className="btn"
            onClick={() => setPlacing(null)}
          >
            {GROW.stop}
          </button>
        </div>
      )}
      {waiting.length > 0 && !sheet && !lift && !placing && (
        <button
          type="button"
          className="tidy-waiting"
          onClick={() => show({ kind: "waiting" })}
        >
          {GROW.waiting} · {counted(waiting.length, "冊")}
        </button>
      )}
      {sheet && !lift && (
        <section className="tidy-sheet" aria-label="選んだもの">
          <button
            type="button"
            className="icon-btn tidy-sheet-close"
            aria-label="閉じる"
            onClick={() => setSheet(null)}
          >
            <Icon name="close" size={18} />
          </button>
          {sheet.kind === "size" && (
            <>
              <h3>{GROW.size}</h3>
              <ShopSizeChoices
                growth={scene.growth}
                bookCount={publicCount}
                disabled={!ready}
                onChoose={chooseSize}
              />
            </>
          )}
          {sheet.kind === "add" && (
            <>
              <h3>本を足す</h3>
              <label className="tidy-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  value={query}
                  placeholder="題名・著者で探す"
                  aria-label="足す本を探す"
                  autoComplete="off"
                  enterKeyHint="search"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="tidy-covers">
                {choices.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`${bookTitle(b)}、${bookAuthor(b)}を並べる`}
                    onClick={() => addBook(b)}
                  >
                    <BookJacket book={b} sizes="72px" />
                    <span>{bookTitle(b)}</span>
                    <i aria-hidden="true">
                      <Icon name="plus" size={14} />
                    </i>
                  </button>
                ))}
              </div>
              {!choices.length && (
                <p className="shop-size-hint">
                  {!query.trim()
                    ? "ライブラリの本は、もう全部並んでいます。題名や著者で探すと、街の本も足せます。"
                    : found.found.length
                      ? "見つかった本は、もう棚に並んでいます。"
                      : "見つかりませんでした。"}
                </p>
              )}
            </>
          )}
          {sheet.kind === "face" && (
            <>
              <h3>{GROW.face}</h3>
              <div className="tidy-fields">
                {objectById(scene, "sign") && (
                  <label>
                    {GROW.signName}
                    <input
                      value={objectById(scene, "sign")?.text ?? ""}
                      maxLength={SHOP_NAME_MAX_LENGTH}
                      onChange={(e) =>
                        save(
                          renameSceneObject(scene, "sign", e.target.value),
                          undefined,
                          "sign",
                        )
                      }
                    />
                  </label>
                )}
                {objectById(scene, "greeting") && (
                  <label>
                    {GROW.greeting}
                    <textarea
                      value={objectById(scene, "greeting")?.text ?? ""}
                      maxLength={SCENE_TEXT_MAX_LENGTH}
                      rows={2}
                      onChange={(e) =>
                        save(
                          renameSceneObject(scene, "greeting", e.target.value),
                          undefined,
                          "greeting",
                        )
                      }
                    />
                  </label>
                )}
                {objectById(scene, "stamp") && (
                  <Chips
                    label={GROW.stamp}
                    choices={STAMP_CHOICES}
                    chosen={objectById(scene, "stamp")?.stamp ?? "plane"}
                    draw={(id) => <StoreStamp name={id} />}
                    onChoose={(stamp) => {
                      const next = structuredClone(scene);
                      objectById(next, "stamp")!.stamp = stamp;
                      save(next);
                    }}
                  />
                )}
                <div className="tidy-chips-label">{GROW.mood}</div>
                <div className="scene-template-options">
                  {STORE_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={scene.templateId === t.id}
                      onClick={() =>
                        scene.templateId !== t.id &&
                        save(
                          applyStoreTemplate(
                            scene,
                            t.id as TemplateId,
                            state.books,
                          ),
                        )
                      }
                      style={{ "--template-wood": t.wood } as CSSProperties}
                    >
                      <span
                        className="scene-template-swatch"
                        aria-hidden="true"
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      <b>{t.name}</b>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {sheet.kind === "waiting" && (
            <>
              <h3>{GROW.waiting}</h3>
              <p className="shop-size-hint">{GROW.waitingHint}</p>
              <div className="tidy-list">
                {waiting.map((p) => (
                  <button key={p.id} type="button" onClick={() => setOut(p)}>
                    <span>
                      {bookTitle(bookById(state.books, p.bookId)!)}
                      <small>
                        {p.isPublic === false ? "非公開" : "並べる"}
                      </small>
                    </span>
                    <Icon name="plus" size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
          {sheet.kind === "row" && sheetRow && (
            <>
              <h3>{nth(rowNumber(sheetRow.id) || 1, "段")}</h3>
              <div className="tidy-fields">
                <label>
                  {GROW.rowLabel}
                  <input
                    value={sheetRow.text ?? ""}
                    maxLength={SCENE_ROW_TEXT_MAX_LENGTH}
                    onChange={(e) =>
                      save(
                        renameSceneObject(scene, sheetRow.id, e.target.value),
                        undefined,
                        "row:" + sheetRow.id,
                      )
                    }
                  />
                </label>
                <label>
                  {GROW.boardTitle}
                  <input
                    value={sheetRow.boardTitle ?? ""}
                    maxLength={SCENE_BOARD_TITLE_MAX_LENGTH}
                    placeholder="旅の本"
                    onChange={(e) =>
                      save(
                        setRowBoard(scene, sheetRow.id, {
                          boardTitle: e.target.value,
                        }),
                        undefined,
                        "board:" + sheetRow.id,
                      )
                    }
                  />
                </label>
                <Chips
                  label={GROW.boardArt}
                  choices={[{ id: "", name: GROW.none }, ...DOODLE_CHOICES]}
                  chosen={sheetRow.doodle ?? ""}
                  draw={(id) => id && <DoodleIcon name={id} />}
                  onChoose={(doodle) =>
                    save(setRowBoard(scene, sheetRow.id, { doodle }))
                  }
                />
                <label className="tidy-switch">
                  <input
                    type="checkbox"
                    checked={sheetRow.isPublic === true}
                    onChange={(e) => {
                      const next = structuredClone(scene);
                      objectById(next, sheetRow.id)!.isPublic =
                        e.target.checked;
                      save(pinRow(next, sheetRow.id));
                    }}
                  />
                  {GROW.rowPublic}
                </label>
              </div>
              <div className="tidy-list">
                {scene.objects
                  .filter(
                    (o) => o.kind === "book" && o.parentId === sheetRow.id,
                  )
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => show({ kind: "book", id: p.id })}
                    >
                      <span>
                        {bookTitle(bookById(state.books, p.bookId)!)}
                        <small>
                          {p.display === "face" ? "表紙" : "背表紙"}
                        </small>
                      </span>
                      <Icon name="chevron" size={16} />
                    </button>
                  ))}
              </div>
            </>
          )}
          {sheet.kind === "book" && placement && book && (
            <>
              <h3 className="tidy-title">{bookTitle(book)}</h3>
              <p className="tidy-sub">{bookAuthor(book)}</p>
              {placement.parentId && (
                <div className="tidy-seg" role="group" aria-label="見せ方">
                  {(["face", "spine"] as const).map((display) => (
                    <button
                      key={display}
                      type="button"
                      aria-pressed={placement.display === display}
                      onClick={() =>
                        placement.display !== display &&
                        save(
                          changePlacement(
                            scene,
                            placement.id,
                            { display },
                            state.books,
                          ),
                        )
                      }
                    >
                      {display === "face" ? "表紙を見せる" : "背表紙を見せる"}
                    </button>
                  ))}
                </div>
              )}
              {sheet.writing ? (
                <div className="tidy-pop">
                  <textarea
                    value={bookPop(scene, placement.id)?.text ?? ""}
                    maxLength={SCENE_POP_MAX_LENGTH}
                    rows={3}
                    autoFocus
                    aria-label="この本のPOP"
                    placeholder="この一冊を、誰かに手渡すなら。"
                    onChange={(e) =>
                      save(
                        changePlacement(
                          scene,
                          placement.id,
                          { pop: e.target.value },
                          state.books,
                        ),
                        undefined,
                        "pop:" + placement.id,
                      )
                    }
                  />
                  <Chips
                    label={GROW.popStamp}
                    choices={[{ id: "", name: GROW.none }, ...STAMP_CHOICES]}
                    chosen={bookPop(scene, placement.id)?.stamp ?? ""}
                    draw={(id) => id && <StoreStamp name={id} />}
                    onChoose={(stamp) =>
                      save(
                        changePlacement(
                          scene,
                          placement.id,
                          { stamp },
                          state.books,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn fill"
                    onClick={() => show({ kind: "book", id: placement.id })}
                  >
                    {GROW.done}
                  </button>
                </div>
              ) : (
                <div className="tidy-acts">
                  <button
                    type="button"
                    onClick={() =>
                      setSheet({
                        kind: "book",
                        id: placement.id,
                        writing: true,
                      })
                    }
                  >
                    <Icon name="pen" size={18} />
                    {bookPop(scene, placement.id)?.text
                      ? "POPを直す"
                      : "POPを書く"}
                  </button>
                  {placement.parentId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSheet(null);
                        setPlacing(placement.id);
                      }}
                    >
                      <Icon name="move" size={18} />
                      {GROW.move}
                    </button>
                  )}
                  {placement.parentId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          save(
                            takePlacementOff(scene, placement.id),
                            "棚から下ろしました。「まだ並べていない本」で待っています。",
                          )
                        )
                          setSheet(null);
                      }}
                    >
                      <Icon name="close" size={18} />
                      棚から下ろす
                    </button>
                  ) : (
                    <button type="button" onClick={() => setOut(placement)}>
                      <Icon name="plus" size={18} />
                      並べる
                    </button>
                  )}
                </div>
              )}
              {!sheet.writing && (
                <label className="tidy-switch">
                  <input
                    type="checkbox"
                    checked={placement.isPublic !== false}
                    onChange={(e) =>
                      save(
                        changePlacement(
                          scene,
                          placement.id,
                          { isPublic: e.target.checked },
                          state.books,
                        ),
                      )
                    }
                  />
                  {GROW.bookPublic}
                </label>
              )}
              {placement.parentId && !sheet.writing && (
                <p className="shop-size-hint">{GROW.lift}</p>
              )}
            </>
          )}
          {sheetRow?.pinned &&
            (sheet.kind === "row" ||
              (sheet.kind === "book" && !sheet.writing)) && (
              <div className="scene-pinned">
                <p className="scene-hint">
                  <Icon name="pin" size={14} />
                  {GROW.pinned}
                </p>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    save(
                      migrateShopScene(
                        shop,
                        state.books,
                        unpinRow(scene, sheetRow.id),
                      ),
                    );
                    setSheet(null);
                  }}
                >
                  {GROW.unpin}
                </button>
              </div>
            )}
        </section>
      )}
      <nav className="tidy-tools" aria-label="整える道具">
        <button
          type="button"
          aria-pressed={sheet?.kind === "add"}
          onClick={() => show(sheet?.kind === "add" ? null : { kind: "add" })}
        >
          <Icon name="plus" />
          本を足す
        </button>
        <button
          type="button"
          aria-pressed={sheet?.kind === "face"}
          onClick={() => show(sheet?.kind === "face" ? null : { kind: "face" })}
        >
          <Icon name="edit" />
          {GROW.face}
        </button>
        <button
          type="button"
          aria-pressed={sheet?.kind === "size"}
          onClick={() => show(sheet?.kind === "size" ? null : { kind: "size" })}
        >
          <Icon name="rows" />
          {GROW.size}
        </button>
        <button type="button" disabled={!undo.length} onClick={stepBack}>
          <Icon name="back" />
          元に戻す
        </button>
      </nav>
    </div>
  );
}

/** A row of choices drawn as what they put in the shop. */
function Chips<T extends string>({
  label,
  choices,
  chosen,
  draw,
  onChoose,
}: {
  label: string;
  choices: ReadonlyArray<{ id: T; name: string }>;
  chosen: string;
  draw: (id: T) => React.ReactNode;
  onChoose: (id: T) => void;
}) {
  return (
    <div className="tidy-chips-group">
      <div className="tidy-chips-label">{label}</div>
      <div className="tidy-chips" role="group" aria-label={label}>
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={chosen === c.id}
            onClick={() => chosen !== c.id && onChoose(c.id)}
          >
            {draw(c.id)}
            <span>{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
