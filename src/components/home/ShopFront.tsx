"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ME_ID,
  ownTagline,
  type Book,
  type Shelf,
  type ShelfItem,
  type Shop,
} from "../../lib/types";
import { Icon, ReaderAvatar } from "../ui";
import { WoodenShelf } from "../WoodenShelf";
import { profilePath, shopPath, walkPath } from "../../lib/paths";
import { useTownBackend } from "../../lib/store";
import type { Shared } from "./Letters";
import "../street.css";
import { reducedMotion } from "../../lib/motion";

/** A book picked off a shelf, to be held in the hand (BookInHand). */
export type Picked = { shop: Shop; shelf: Shelf; item: ShelfItem };

/** The owner's voice on the front: the first POP on the shelves it shows. */
function voiceOf(state: Shared["state"], shop: Shop) {
  return shop.shelves
    .filter((shelf) => shelf.isPublic)
    .slice(0, 2)
    .flatMap((shelf) =>
      shelf.items
        .filter((item) => item.pop?.trim())
        .map((item) => ({
          shelf,
          item,
          book: state.books.find((book) => book.id === item.bookId),
        })),
    )
    .find((entry) => entry.book);
}

/**
 * A shop's front in the alley: its sign, owner and follow, a POP in the
 * owner's words, and two of its public shelves, real and working (本棚が主役).
 * The whole shop is one tap away.
 */
export function ShopFront({
  shop,
  state,
  actions,
  notify,
  first,
  welcome,
  onPick,
}: Shared & {
  shop: Shop;
  /** In the alley's first round: the front can be linked to by its id. */
  first: boolean;
  /** The reader's own shop, opened here within a day. */
  welcome: boolean;
  onPick: (picked: Picked) => void;
}) {
  const savedIn = useTownBackend();
  const owner =
    shop.ownerId === ME_ID
      ? state.me
      : state.readers.find((reader) => reader.id === shop.ownerId);
  const shelves = shop.shelves.filter((shelf) => shelf.isPublic);
  const followed = state.following.includes(shop.id);
  // Two shelves per shop; the whole shop is one tap away.
  const shown = shelves.slice(0, 2);
  const more = shelves.length - shown.length;
  // A shop with books on view can be walked into; one still growing its
  // shelves is introduced on its own page.
  const enter = shelves.some((shelf) => shelf.items.length)
    ? walkPath(shop.id)
    : shopPath(shop.id);
  const tagline = ownTagline(shop);
  const voice = voiceOf(state, shop);
  return (
    <article
      className={
        "street-shop is-compact theme-" +
        shop.theme +
        (welcome ? " is-new-own" : "")
      }
      id={first ? "street-" + shop.id : undefined}
    >
      {welcome && (
        <p className="street-new-own">
          <Icon name="leaf" size={15} />
          あなたの書店が、街に加わりました。
        </p>
      )}
      <header className="street-shop-header">
        <div className="street-shop-title">
          <Link href={enter} aria-label={shop.name + "に入る"}>
            <h2>{shop.name}</h2>
            <Icon name="arrow" size={18} />
          </Link>
          {shop.ownerId === ME_ID && (
            <small className="street-own-tag">あなたの書店</small>
          )}
          {shop.demo && savedIn !== "local" && (
            <small className="street-own-tag">見本</small>
          )}
        </div>
        <div className="street-shop-owner">
          {owner && (
            <Link href={profilePath(owner.id)}>
              <ReaderAvatar reader={owner} size={28} />
              <span>
                <small>店主</small> {owner.name}
              </span>
            </Link>
          )}
          {shop.ownerId === ME_ID ? (
            <Link href="/my-shop/" className="street-follow">
              <Icon name="edit" size={14} />
              棚を整える
            </Link>
          ) : (
            <button
              className="street-follow"
              aria-pressed={followed}
              aria-label={
                shop.name + (followed ? "のフォローを解除" : "をフォロー")
              }
              onClick={() => {
                actions.toggleFollow(shop.id);
                notify(
                  followed
                    ? "フォローを解除しました"
                    : shop.name + "をフォローしました",
                );
              }}
            >
              <Icon name={followed ? "check" : "plus"} size={14} />
              {/* Both words keep their place, so a tap moves nothing on
                  the page (決定 H:56-57). */}
              <span className="home-follow-words">
                <span className={followed ? "is-off" : undefined}>
                  フォロー
                </span>
                <span className={followed ? undefined : "is-off"}>
                  フォロー済み
                </span>
              </span>
            </button>
          )}
        </div>
        {tagline && <p className="street-shop-tagline">{tagline}</p>}
      </header>
      {voice && (
        <button
          type="button"
          className="street-shop-voice"
          onClick={() => onPick({ shop, shelf: voice.shelf, item: voice.item })}
        >
          <span className="street-shop-voice-words">
            「{voice.item.pop!.trim()}」
          </span>
          <small>
            {owner ? `店主 ${owner.name}` : "店主"}のPOP ·『{voice.book!.title}
            』
          </small>
        </button>
      )}
      <div className="street-shop-shelves">
        {shown.map((shelf, index) => (
          <StreetShelf
            key={shelf.id}
            shelf={shelf}
            books={state.books}
            index={index}
            onSelect={(item) => onPick({ shop, shelf, item })}
          />
        ))}
        {!shown.length && (
          <div className="street-empty-shelf">
            <Icon name="book" size={26} />
            <p>このお店の棚は、これから育ちます。</p>
          </div>
        )}
      </div>
      <footer className="street-shop-footer">
        <Link href={shopPath(shop.id)}>
          {more > 0 ? `紹介と、ほかの${more}段の棚` : "店の紹介と棚の一覧"}
        </Link>
        {enter !== shopPath(shop.id) && (
          <Link href={enter} className="street-enter">
            <Icon name="store" size={15} />
            店内に入る
          </Link>
        )}
      </footer>
    </article>
  );
}

/** One public shelf of the front, scrolled sideways, with its two arrows. */
function StreetShelf({
  shelf,
  books,
  index,
  onSelect,
}: {
  shelf: Shelf;
  books: Book[];
  index: number;
  onSelect: (item: ShelfItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const scroll = ref.current?.querySelector<HTMLElement>(".shelf-scroll");
    if (!scroll) return;
    const measure = () =>
      setEdges({
        start: scroll.scrollLeft <= 2,
        end: scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 2,
      });
    measure();
    scroll.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => {
      scroll.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [shelf.items.length]);
  const move = (direction: number) => {
    const scroll = ref.current?.querySelector<HTMLElement>(".shelf-scroll");
    scroll?.scrollBy({
      left: direction * scroll.clientWidth * 0.7,
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  };
  return (
    <section className="street-shelf" aria-label={shelf.name}>
      <header>
        <h3>
          <span>{String(index + 1).padStart(2, "0")}</span>
          {shelf.name}
        </h3>
        <div className="street-shelf-controls">
          <button
            disabled={edges.start}
            onClick={() => move(-1)}
            aria-label={shelf.name + "の左側を見る"}
            aria-controls={id}
          >
            <Icon name="back" size={15} />
          </button>
          <button
            disabled={edges.end}
            onClick={() => move(1)}
            aria-label={shelf.name + "の右側を見る"}
            aria-controls={id}
          >
            <Icon name="arrow" size={15} />
          </button>
        </div>
      </header>
      <div ref={ref} id={id}>
        <WoodenShelf shelf={shelf} books={books} onSelect={onSelect} />
      </div>
    </section>
  );
}
