"use client";

// The cards as the reader arranged them, and arranging them (刷新版 3節):
// a long press lifts a card and the board turns to the phone's home screen
// (cards wiggle, − takes one out, a dock below sets the chosen one's size).
// Carried, a card trades places as it goes; let go, the arrangement is kept
// to the account (reader_settings.stats_layout). An empty place (＋) takes a
// card not shown yet. The rules are layout.ts; here are only hands.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  cardsLeft,
  move,
  putIn,
  addCard,
  resize,
  takeOut,
  TILE_SIZES,
  type StatCard,
  type StatsLayout,
  type Tile,
} from "../../lib/reading-stats";
import {
  cardName,
  SIZE_NAMES,
  STATS_WORDS as W,
} from "../../lib/reading-stats/words";
import { DUR_MS, EASE, reducedMotion } from "../../lib/motion";
import { Icon, Modal } from "../ui";
import { CardFull, CardHeading, CardSmall, type StatsView } from "./StatCards";

/** How long a finger rests on a card before it lifts (試作 0.48 秒). */
const HOLD_MS = 480;
/** Once arranging, a card is picked up sooner (試作 0.26 秒). */
const HOLD_LIFTED_MS = 260;
/** How far a finger may slide while resting, in px. */
const HOLD_SLOP = 10;
/** A carried card is let alone this long after it moved, so it doesn't swing back. */
const SETTLE_MS = DUR_MS.move;
/** How near the screen's edge, in px, a carried card scrolls the page. */
const EDGE = 80;
/** How far the page scrolls per move near the edge, in px. */
const EDGE_STEP = 10;
/** A click this soon after a card was let go is the finger leaving it. */
const CLICK_AFTER_DROP_MS = 600;

type Press = {
  card: StatCard;
  x: number;
  y: number;
  timer: number;
  ready: boolean;
  moved: boolean;
  offX: number;
  offY: number;
  el: HTMLElement;
};

export function StatsBoard({
  tiles,
  view,
  onKeep,
  onOpen,
  arrangeAsked,
}: {
  tiles: StatsLayout;
  view: StatsView;
  onKeep: (tiles: StatsLayout) => void;
  onOpen: (card: StatCard) => void;
  /** Counts the ［並べ替え］ presses above the cards: each starts arranging. */
  arrangeAsked: number;
}) {
  const [arranging, setArranging] = useState(false);
  const [asked, setAsked] = useState(arrangeAsked);
  if (asked !== arrangeAsked) {
    setAsked(arrangeAsked);
    setArranging(true);
  }
  const [chosen, setChosen] = useState<StatCard | null>(null);
  const [working, setWorking] = useState<StatsLayout | null>(null);
  const [carried, setCarried] = useState<StatCard | null>(null);
  const [undo, setUndo] = useState<{
    before: StatsLayout;
    card: StatCard;
  } | null>(null);
  const [adding, setAdding] = useState<number | "end" | null>(null);
  const shown = working ?? tiles;
  const left = cardsLeft(shown);
  const board = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const shownRef = useRef(shown);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const settle = useRef(0);
  const dropped = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    shownRef.current = shown;
  });

  const name = (card: StatCard) => cardName(card, view.period, view.data.today);
  const places = () =>
    Array.from(
      board.current?.querySelectorAll<HTMLElement>("[data-place]") ?? [],
    );

  /** Where each card is now, so that after a change the others glide over. */
  const remember = () => {
    const at = new Map<string, DOMRect>();
    for (const el of places())
      if (el.dataset.card && el.dataset.card !== press.current?.card)
        at.set(el.dataset.card, el.getBoundingClientRect());
    before.current = at;
  };
  const keep = (next: StatsLayout) => {
    if (next === tiles) return;
    remember();
    onKeep(next);
  };

  /** The carried card under the finger. */
  const follow = (x: number, y: number) => {
    const held = press.current;
    if (!held?.moved) return;
    held.el.style.translate = "";
    const box = held.el.getBoundingClientRect();
    held.el.style.translate = `${x - held.offX - box.left}px ${y - held.offY - box.top}px`;
  };

  useLayoutEffect(() => {
    const at = before.current;
    before.current = null;
    if (last.current) follow(last.current.x, last.current.y);
    if (!at || reducedMotion()) return;
    for (const el of places()) {
      const was = el.dataset.card ? at.get(el.dataset.card) : undefined;
      if (!was) continue;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) continue;
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
        duration: DUR_MS.move,
        easing: EASE.standard,
      });
    }
  });

  const stop = () => {
    setArranging(false);
    setChosen(null);
    setUndo(null);
  };

  // Arranging ends with 完了, Escape, or a tap beside the cards.
  useEffect(() => {
    if (!arranging) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    const tap = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target?.isConnected) return;
      if (board.current?.contains(target) || dock.current?.contains(target))
        return;
      if ((target as Element).closest?.(".modal-backdrop")) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("click", tap, true);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("click", tap, true);
    };
  }, [arranging]);

  const lift = (held: Press) => {
    held.ready = true;
    held.el.classList.remove("is-holding");
    try {
      navigator.vibrate?.(8);
    } catch {
      // A browser without it, or one that refuses: the card lifts all the same.
    }
    setArranging(true);
    setChosen(held.card);
    setUndo(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || press.current) return;
    const target = event.target as Element;
    if (
      target.closest(".stats-takeout, .stats-gap, input, select, .stats-switch")
    )
      return;
    const el = target.closest<HTMLElement>("[data-place][data-card]");
    if (!el) return;
    // A swipe on a scrolling shelf inside a card is the shelf's.
    if (!arranging && target.closest(".stats-scroll")) return;
    const card = el.dataset.card as StatCard;
    el.classList.add("is-holding");
    const held: Press = {
      card,
      x: event.clientX,
      y: event.clientY,
      timer: 0,
      ready: false,
      moved: false,
      offX: 0,
      offY: 0,
      el,
    };
    held.timer = window.setTimeout(
      () => lift(held),
      arranging ? HOLD_LIFTED_MS : HOLD_MS,
    );
    press.current = held;
  };

  useEffect(() => {
    const letGo = () => {
      const held = press.current;
      if (!held) return;
      press.current = null;
      last.current = null;
      clearTimeout(held.timer);
      held.el.classList.remove("is-holding");
      if (!held.ready) return;
      dropped.current = performance.now();
      held.el.style.translate = "";
      setCarried(null);
      const next = shownRef.current;
      setWorking(null);
      if (held.moved && next !== tiles) {
        before.current = null;
        onKeep(next);
      }
    };
    const moveTo = (event: PointerEvent) => {
      const held = press.current;
      if (!held) return;
      if (!held.ready) {
        if (
          Math.hypot(event.clientX - held.x, event.clientY - held.y) > HOLD_SLOP
        ) {
          clearTimeout(held.timer);
          held.el.classList.remove("is-holding");
          press.current = null;
        }
        return;
      }
      if (!held.moved) {
        if (
          Math.hypot(event.clientX - held.x, event.clientY - held.y) <
          HOLD_SLOP / 2
        )
          return;
        held.moved = true;
        const box = held.el.getBoundingClientRect();
        held.offX = held.x - box.left;
        held.offY = held.y - box.top;
        setCarried(held.card);
      }
      last.current = { x: event.clientX, y: event.clientY };
      follow(event.clientX, event.clientY);
      if (event.clientY < EDGE) window.scrollBy(0, -EDGE_STEP);
      else if (event.clientY > window.innerHeight - EDGE)
        window.scrollBy(0, EDGE_STEP);
      if (performance.now() < settle.current) return;
      const tiles = shownRef.current;
      const from = tiles.findIndex((tile) => tile.card === held.card);
      const over = places().find((el) => {
        if (el === held.el) return false;
        const box = el.getBoundingClientRect();
        return (
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        );
      });
      if (!over || from < 0) return;
      const to = Number(over.dataset.place);
      // Only past the middle of the one beneath, so a card doesn't swing to and fro.
      const box = over.getBoundingClientRect();
      const down = to > from;
      const sameRow = Math.abs(over.offsetTop - held.el.offsetTop) < 3;
      const short = sameRow
        ? down
          ? event.clientX < box.left + box.width / 2
          : event.clientX > box.left + box.width / 2
        : down
          ? event.clientY < box.top + box.height / 2
          : event.clientY > box.top + box.height / 2;
      if (short) return;
      const next = move(tiles, from, to);
      if (next === tiles) return;
      remember();
      settle.current = performance.now() + SETTLE_MS;
      setWorking(next);
    };
    // Once a card is lifted the finger carries it, not the page.
    const hold = (event: TouchEvent) => {
      if (press.current?.ready && event.cancelable) event.preventDefault();
    };
    const cancelOnScroll = () => {
      const held = press.current;
      if (held && !held.ready) {
        clearTimeout(held.timer);
        held.el.classList.remove("is-holding");
        press.current = null;
      }
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", letGo);
    window.addEventListener("pointercancel", letGo);
    window.addEventListener("scroll", cancelOnScroll, true);
    document.addEventListener("touchmove", hold, { passive: false });
    return () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", letGo);
      window.removeEventListener("pointercancel", letGo);
      window.removeEventListener("scroll", cancelOnScroll, true);
      document.removeEventListener("touchmove", hold);
    };
  });

  const onClickCapture = (event: React.MouseEvent) => {
    if (performance.now() - dropped.current < CLICK_AFTER_DROP_MS) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!arranging) return;
    const target = event.target as Element;
    if (target.closest(".stats-takeout, .stats-gap, .stats-add")) return;
    event.preventDefault();
    event.stopPropagation();
    const el = target.closest<HTMLElement>("[data-place][data-card]");
    if (el) setChosen(el.dataset.card as StatCard);
    else stop();
  };

  const takeOutCard = (index: number, card: StatCard) => {
    setUndo({ before: tiles, card });
    if (chosen === card) setChosen(null);
    keep(takeOut(tiles, index));
  };

  const chosenIndex = chosen
    ? tiles.findIndex((tile) => tile.card === chosen)
    : -1;

  return (
    <>
      <div
        ref={board}
        className={"stats-cards" + (arranging ? " is-arranging" : "")}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onContextMenu={(event) => {
          const el = (event.target as Element).closest<HTMLElement>(
            "[data-place][data-card]",
          );
          if (!el) return;
          event.preventDefault();
          setArranging(true);
          setChosen(el.dataset.card as StatCard);
        }}
      >
        {shown.map((tile, index) => (
          <Place
            key={tile.card ?? `empty-${index}`}
            tile={tile}
            index={index}
            view={view}
            arranging={arranging}
            chosen={tile.card !== null && tile.card === chosen}
            carried={tile.card !== null && tile.card === carried}
            onOpen={onOpen}
            onTakeOut={takeOutCard}
            onAdd={left.length ? () => setAdding(index) : undefined}
            name={tile.card ? name(tile.card) : ""}
          />
        ))}
        {arranging && left.length > 0 && (
          <button
            type="button"
            className="stats-add"
            onClick={() => setAdding("end")}
          >
            <Icon name="plus" size={16} />
            {W.addCard}
          </button>
        )}
      </div>
      {!arranging && (
        <div className="stats-foot">
          {left.length > 0 && !shown.some((tile) => tile.card === null) && (
            <button
              type="button"
              className="stats-add"
              onClick={() => setAdding("end")}
            >
              <Icon name="plus" size={16} />
              {W.addCard}
            </button>
          )}
        </div>
      )}
      {arranging && (
        <div
          ref={dock}
          className="stats-dock"
          role="dialog"
          aria-label={W.arranging}
        >
          <div className="stats-dock-head">
            <span>{chosen ? W.sizeOf(name(chosen)) : W.arrangeHint}</span>
            <button type="button" className="stats-dock-done" onClick={stop}>
              {W.done}
            </button>
          </div>
          {chosen && chosenIndex >= 0 && (
            <div
              className="stats-sizes"
              role="radiogroup"
              aria-label={W.sizeOf(name(chosen))}
            >
              {TILE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={tiles[chosenIndex].size === size}
                  onClick={() => keep(resize(tiles, chosenIndex, size))}
                >
                  <span
                    className={`stats-size-mark ${size}`}
                    aria-hidden="true"
                  >
                    <i />
                  </span>
                  <b>{SIZE_NAMES[size]}</b>
                </button>
              ))}
            </div>
          )}
          {undo && (
            <div className="stats-undo">
              <span>{W.takenOut(name(undo.card))}</span>
              <button
                type="button"
                onClick={() => {
                  keep(undo.before);
                  setChosen(undo.card);
                  setUndo(null);
                }}
              >
                {W.undo}
              </button>
            </div>
          )}
        </div>
      )}
      {adding !== null && (
        <Modal title={W.addTitle} onClose={() => setAdding(null)} fromBottom>
          <ul className="stats-add-list">
            {left.map((card) => (
              <li key={card}>
                <button
                  type="button"
                  onClick={() => {
                    keep(
                      adding === "end"
                        ? addCard(tiles, card)
                        : putIn(tiles, adding, card),
                    );
                    setAdding(null);
                    if (arranging) setChosen(card);
                  }}
                >
                  <CardHeading card={card} view={view} as="h3" />
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

function Place({
  tile,
  index,
  view,
  arranging,
  chosen,
  carried,
  name,
  onOpen,
  onTakeOut,
  onAdd,
}: {
  tile: Tile;
  index: number;
  view: StatsView;
  arranging: boolean;
  chosen: boolean;
  carried: boolean;
  name: string;
  onOpen: (card: StatCard) => void;
  onTakeOut: (index: number, card: StatCard) => void;
  onAdd?: () => void;
}) {
  if (tile.card === null)
    return onAdd ? (
      <button
        type="button"
        className="stats-card empty half stats-gap"
        data-place={index}
        aria-label={W.addHere}
        onClick={onAdd}
      >
        <Icon name="plus" size={20} />
      </button>
    ) : (
      <div className="stats-card empty half" data-place={index} />
    );
  const card = tile.card;
  const marks =
    (arranging ? " is-wiggling" : "") +
    (chosen ? " is-chosen" : "") +
    (carried ? " is-carried" : "");
  const takeOutButton = arranging && (
    <button
      type="button"
      className="stats-takeout"
      aria-label={W.takeOut(name)}
      onClick={(event) => {
        event.stopPropagation();
        onTakeOut(index, card);
      }}
    >
      <span aria-hidden="true">−</span>
    </button>
  );
  const style = { "--wiggle-at": index % 5 } as React.CSSProperties;
  if (tile.size === "full")
    return (
      <article
        className={"stats-card full" + marks}
        data-place={index}
        data-card={card}
        style={style}
      >
        {takeOutButton}
        <CardHeading card={card} view={view} />
        <CardFull card={card} view={view} />
      </article>
    );
  return (
    <div
      className={`stats-card-place ${tile.size}` + marks}
      data-place={index}
      data-card={card}
      style={style}
    >
      {takeOutButton}
      <button
        type="button"
        className={`stats-card ${tile.size}`}
        aria-haspopup="dialog"
        onClick={() => onOpen(card)}
      >
        <CardSmall card={card} view={view} />
      </button>
    </div>
  );
}
