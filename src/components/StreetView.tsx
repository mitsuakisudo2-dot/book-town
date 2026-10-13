"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ME_ID,
  ownTagline,
  type Book,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { BookInHand, heldBookOf } from "./BookInHand";
import "./street.css";
import { profilePath, shopPath, walkPath } from "../lib/paths";
import { useTownBackend } from "../lib/store";
import { shopOpenedRecently } from "../lib/just-opened";
import { replaceAddress, useUrlParam } from "../lib/url-state";
import { useLayerReturn } from "../lib/back-layer";

/** The most rounds of the street kept on the page at once. */
const MAX_ROUNDS = 30;

/** The same shops in another order for each round, never starting where the last one ended. */
function roundOrder<T>(list: T[], seed: number, after?: T): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const next = [...list];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  if (next.length > 1 && next[0] === after) next.push(next.shift()!);
  return next;
}

type Props = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
  search: string;
  setSearch: (value: string) => void;
};

export function StreetView({
  state,
  actions,
  notify,
  search,
  setSearch,
}: Props) {
  const savedIn = useTownBackend();
  // The filter, the lane and how far down the street the reader went are kept
  // in the address, so coming back finds the street as it was left.
  const [show] = useUrlParam("show");
  const followingOnly = show === "following";
  const [lane] = useUrlParam("lane");
  const offset = Math.max(0, Number.parseInt(lane ?? "", 10) || 0);
  const [roundsParam, setRoundsParam] = useUrlParam("rounds");
  // Changing the filter or the lane starts the street again from one round.
  const setFollowingOnly = (only: boolean) =>
    replaceAddress({
      params: { show: only ? "following" : null, rounds: null },
    });
  const setOffset = (next: number) =>
    replaceAddress({
      params: { lane: next ? String(next) : null, rounds: null },
    });
  // Says, for a moment, that the lane really changed.
  const [turned, setTurned] = useState(false);
  useEffect(() => {
    if (!turned) return;
    const timer = setTimeout(() => setTurned(false), 2600);
    return () => clearTimeout(timer);
  }, [turned, offset]);
  const routeLabel = useRef<HTMLDivElement>(null);
  // A shop opened in this browser within a day stands at the head of the street.
  const [welcomeOwn, setWelcomeOwn] = useState(false);
  useEffect(() => setWelcomeOwn(shopOpenedRecently()), []);
  const [selected, setSelected] = useState<{
    shop: Shop;
    shelf: Shelf;
    item: ShelfItem;
  } | null>(null);
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  // Back from a book's own page, the same book is in hand again.
  useLayerReturn((name) => {
    const held = heldBookOf(name);
    const shop = shops.find((entry) => entry.id === held?.shopId);
    const shelf = shop?.shelves.find((entry) => entry.id === held?.shelfId);
    const item = shelf?.items.find((entry) => entry.id === held?.itemId);
    if (!shop || !shelf || !item || selected?.item.id === item.id) return false;
    setSelected({ shop, shelf, item });
    return true;
  }, shops.length > 0);
  const term = search.trim().toLocaleLowerCase();
  const matching = shops.filter((shop) => {
    const stock = shop.shelves
      .filter((s) => s.isPublic)
      .flatMap((s) => s.items)
      .map((i) => state.books.find((b) => b.id === i.bookId))
      .filter((b): b is Book => !!b);
    const owner =
      shop.ownerId === "me"
        ? state.me
        : state.readers.find((r) => r.id === shop.ownerId);
    return (
      (!followingOnly || state.following.includes(shop.id)) &&
      (!term ||
        (
          shop.name +
          shop.description +
          (owner?.name ?? "") +
          stock.map((b) => b.title + b.author).join("")
        )
          .toLocaleLowerCase()
          .includes(term))
    );
  });
  const pivot = offset % Math.max(1, matching.length);
  const turnedOrder = [...matching.slice(pivot), ...matching.slice(0, pivot)];
  const newOwn =
    welcomeOwn && !term && !followingOnly
      ? turnedOrder.find(
          (shop) =>
            shop.id === state.ownShop?.id &&
            shop.shelves.some((s) => s.isPublic && s.items.length),
        )
      : undefined;
  const ordered = newOwn
    ? [newOwn, ...turnedOrder.filter((shop) => shop !== newOwn)]
    : turnedOrder;
  // The street has no end: past the last shop, another round of the same
  // town begins in a new order. A search or a short list stays one round.
  const endless = !term && matching.length >= 3;
  const walkKey = [followingOnly, offset].join(":");
  const shownRounds = endless
    ? Math.min(
        Math.max(1, Number.parseInt(roundsParam ?? "", 10) || 1),
        MAX_ROUNDS,
      )
    : 1;
  const roundsOf: Shop[][] = [ordered];
  for (let round = 1; round < shownRounds; round++)
    roundsOf.push(
      roundOrder(matching, offset * 97 + round, roundsOf[round - 1].at(-1)),
    );
  const further = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = further.current;
    if (!endless || !target || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setRoundsParam(String(Math.min(shownRounds + 1, MAX_ROUNDS)));
      },
      { rootMargin: "0px 0px 800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [endless, shownRounds, walkKey, setRoundsParam]);
  const reset = () => {
    setSearch("");
    setFollowingOnly(false);
  };
  // The owner's voice on each card: the first POP on the shelves it shows.
  const voiceOf = (shop: Shop) =>
    shop.shelves
      .filter((s) => s.isPublic)
      .slice(0, 2)
      .flatMap((shelf) =>
        shelf.items
          .filter((item) => item.pop?.trim())
          .map((item) => ({
            shelf,
            item,
            book: state.books.find((b) => b.id === item.bookId),
          })),
      )
      .find((entry) => entry.book);
  // The bookmarks beside the street hold words the cards do not show.
  const discovery = state.shops
    .flatMap((shop) => {
      const voice = voiceOf(shop)?.item;
      return shop.shelves
        .filter((s) => s.isPublic)
        .flatMap((shelf) =>
          shelf.items
            .filter((item) => item.pop && item !== voice)
            .slice(0, 1)
            .map((item) => ({ shop, shelf, item })),
        );
    })
    .filter((_, index) => index % 3 === 0)
    .slice(0, 3);

  return (
    <div className="street-experience">
      <header className="street-intro">
        <div>
          <span className="street-kicker">
            <i /> A TOWN BETWEEN THE PAGES
          </span>
          <h1>
            本を探していたら、
            <br className="street-title-break" />
            <em>人に出会った。</em>
          </h1>
          <p>誰かの選書から、あなたの次の一冊へ。</p>
        </div>
        <div className="street-intro-note" aria-hidden="true">
          <Icon name="book" size={28} />
          <span>
            あなたの愛した一冊が、
            <br />
            誰かの愛する一冊になる。
          </span>
          <i>Take a little detour.</i>
        </div>
      </header>

      <div className="street-filters" role="group" aria-label="表示する書店">
        <button
          type="button"
          aria-pressed={!followingOnly}
          onClick={() => setFollowingOnly(false)}
        >
          すべて
        </button>
        <button
          type="button"
          aria-pressed={followingOnly}
          onClick={() => setFollowingOnly(true)}
        >
          フォロー中
        </button>
      </div>
      {term && (
        <div className="street-search-result" role="status">
          「{search}」からつながる{matching.length}軒
          <button onClick={() => setSearch("")} aria-label="検索をクリア">
            <Icon name="close" size={15} />
            クリア
          </button>
        </div>
      )}

      <div className="street-layout">
        <div className="street-walk">
          <div className="street-route-label" ref={routeLabel}>
            <span>
              <i />
              今日の路地{" "}
              <small role="status">
                {turned
                  ? "— 別の路地に入りました。"
                  : "— 棚を選ぶのは、それぞれの店主。"}
              </small>
            </span>
            <button
              onClick={() => {
                setOffset(offset + 1);
                setTurned(true);
                const label = routeLabel.current;
                if (label && label.getBoundingClientRect().top < 64)
                  label.scrollIntoView({
                    block: "start",
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "instant"
                      : "smooth",
                  });
              }}
            >
              <Icon name="shuffle" size={15} />
              路地を変えてみる
            </button>
          </div>
          {roundsOf.map((round, roundIndex) => (
            <Fragment key={roundIndex}>
              {roundIndex > 0 && (
                <div className="street-round" role="separator">
                  <Icon name="leaf" size={16} />
                  <span>路地は、まだ続きます</span>
                </div>
              )}
              {round.map((shop) => {
                const owner =
                  shop.ownerId === "me"
                    ? state.me
                    : state.readers.find((r) => r.id === shop.ownerId);
                const shelves = shop.shelves.filter((s) => s.isPublic);
                const followed = state.following.includes(shop.id);
                // The street shows two shelves per shop; the whole shop is one tap away.
                const shown = shelves.slice(0, 2);
                const more = shelves.length - shown.length;
                // A shop with books on view can be walked into; one still
                // growing its shelves is introduced on its own page.
                const enter = shelves.some((s) => s.items.length)
                  ? walkPath(shop.id)
                  : shopPath(shop.id);
                const tagline = ownTagline(shop);
                const voice = voiceOf(shop);
                const welcome = roundIndex === 0 && shop === newOwn;
                return (
                  <article
                    className={
                      "street-shop is-compact theme-" +
                      shop.theme +
                      (turned && roundIndex === 0 ? " is-arriving" : "") +
                      (welcome ? " is-new-own" : "")
                    }
                    key={walkKey + "-" + roundIndex + "-" + shop.id}
                    id={roundIndex ? undefined : "street-" + shop.id}
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
                        {shop.ownerId === "me" ? (
                          <Link href="/my-shop/" className="street-follow">
                            <Icon name="edit" size={14} />
                            棚を整える
                          </Link>
                        ) : (
                          <button
                            className="street-follow"
                            aria-pressed={followed}
                            aria-label={
                              shop.name +
                              (followed ? "のフォローを解除" : "をフォロー")
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
                            <Icon
                              name={followed ? "check" : "plus"}
                              size={14}
                            />
                            {followed ? "フォロー済み" : "フォロー"}
                          </button>
                        )}
                      </div>
                      {tagline && (
                        <p className="street-shop-tagline">{tagline}</p>
                      )}
                    </header>
                    {voice && (
                      <button
                        type="button"
                        className="street-shop-voice"
                        onClick={() =>
                          setSelected({
                            shop,
                            shelf: voice.shelf,
                            item: voice.item,
                          })
                        }
                      >
                        <span className="street-shop-voice-words">
                          「{voice.item.pop!.trim()}」
                        </span>
                        <small>
                          {owner ? `店主 ${owner.name}` : "店主"}のPOP ·『
                          {voice.book!.title}』
                        </small>
                      </button>
                    )}
                    <div className="street-shop-shelves">
                      {shown.map((shelf, shelfIndex) => (
                        <StreetShelf
                          key={shelf.id}
                          shelf={shelf}
                          books={state.books}
                          index={shelfIndex}
                          onSelect={(item) =>
                            setSelected({ shop, shelf, item })
                          }
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
                        {more > 0
                          ? `紹介と、ほかの${more}段の棚`
                          : "店の紹介と棚の一覧"}
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
              })}
            </Fragment>
          ))}
          {!ordered.length && (
            <div className="street-empty">
              {!shops.length ? (
                <>
                  <Icon name="leaf" size={28} />
                  <h2>この街は、まだ朝です。</h2>
                  <p>
                    最初の一軒になりませんか。好きな本を一冊並べれば開店です。
                  </p>
                  <Link className="button" href="/my-shop/">
                    書店をひらく
                  </Link>
                </>
              ) : followingOnly && !state.following.length ? (
                <>
                  <Icon name="follow" size={28} />
                  <h2>フォローした店が、ここに集まります。</h2>
                  <p>気になった店の看板で「フォロー」を押してみてください。</p>
                  <button className="button secondary" onClick={reset}>
                    すべての店を見る
                  </button>
                </>
              ) : (
                <>
                  <Icon name="search" size={28} />
                  <h2>この路地では、まだ見つかりませんでした。</h2>
                  <p>言葉を変えたり、絞り込みを戻したりしてみましょう。</p>
                  <button className="button secondary" onClick={reset}>
                    絞り込みを戻す
                  </button>
                </>
              )}
            </div>
          )}
          <section className="street-end">
            <span className="street-end-line" />
            <Icon name="leaf" size={27} />
            {endless ? (
              <>
                <h2>この先も、路地は続きます。</h2>
                <p>
                  ひと休みしたら、気になった棚に戻ったり、あなたの一冊を並べたり。
                </p>
              </>
            ) : (
              <>
                <h2>
                  {term
                    ? "見つかった書店は、ここまで。"
                    : "この先は、まだ空き地です。"}
                </h2>
                <p>
                  {term
                    ? "言葉を変えると、別の路地につながります。"
                    : "あなたの一冊を並べると、路地が少し長くなります。"}
                </p>
              </>
            )}
            <div ref={further}>
              <button
                onClick={() =>
                  window.scrollTo({
                    top: 0,
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "instant"
                      : "smooth",
                  })
                }
              >
                通りの入口へ
                <Icon name="back" size={15} />
              </button>
              <Link href="/my-shop/">
                {state.ownShop ? "自分の棚を整える" : "あなたの一冊を並べる"}
                <Icon name="plus" size={15} />
              </Link>
            </div>
            {savedIn === "local" ? (
              <small>登場する店主と書店は架空のデモです。</small>
            ) : (
              state.shops.some((entry) => entry.demo) && (
                <small>
                  「見本」の店主と書店は、街の雰囲気を伝える架空のものです。
                </small>
              )
            )}
          </section>
        </div>
        <aside className="street-aside">
          <div className="street-aside-heading">
            <span>寄り道のしおり</span>
            <Icon name="bookmark" size={18} />
          </div>
          <p className="street-aside-lead">
            一冊の向こうに、
            <br />
            その人だけの読み方がある。
          </p>
          {discovery.map(({ shop, shelf, item }) => {
            const book = state.books.find((b) => b.id === item.bookId);
            return (
              book && (
                <button
                  className="street-pop-invite"
                  key={item.id}
                  onClick={() => setSelected({ shop, shelf, item })}
                >
                  <div>
                    <BookJacket book={book} />
                    <span>
                      <small>{shop.name}のPOP</small>
                      <b>{book.title}</b>
                    </span>
                  </div>
                  <p>「{item.pop}」</p>
                  <span className="street-pop-open">
                    この一冊を手に取る
                    <Icon name="arrow" size={14} />
                  </span>
                </button>
              )
            );
          })}
          <Link className="street-start-own" href="/my-shop/">
            <Icon name="store" size={24} />
            <h3>
              あなたの好きにも、
              <br />
              小さな看板を。
            </h3>
            <p>
              一冊を並べるところから。
              <br />
              まだ読めていない日も、あなたのペースで。
            </p>
            <span>
              {state.ownShop ? "わたしの書店へ" : "書店をひらく"}
              <Icon name="arrow" size={15} />
            </span>
          </Link>
        </aside>
      </div>
      {selected && (
        <BookInHand
          key={`${selected.shop.id}:${selected.shelf.id}:${selected.item.id}`}
          shop={selected.shop}
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
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
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
