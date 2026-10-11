"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type {
  Book,
  Shelf,
  ShelfItem,
  Shop,
  TownActions,
  TownState,
} from "../lib/types";
import { BookJacket, Icon, ReaderAvatar } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { BookInHand } from "./BookInHand";
import "./street.css";

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
  const [followingOnly, setFollowingOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{
    shop: Shop;
    shelf: Shelf;
    item: ShelfItem;
  } | null>(null);
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
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
  const ordered = [...matching.slice(pivot), ...matching.slice(0, pivot)];
  const reset = () => {
    setSearch("");
    setFollowingOnly(false);
  };
  const discovery = state.shops
    .flatMap((shop) =>
      shop.shelves
        .filter((s) => s.isPublic)
        .flatMap((shelf) =>
          shelf.items
            .filter((item) => item.pop)
            .slice(0, 1)
            .map((item) => ({ shop, shelf, item })),
        ),
    )
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

      <div className="street-filters">
        <button
          className="street-follow-filter"
          aria-pressed={followingOnly}
          onClick={() => setFollowingOnly(!followingOnly)}
        >
          <Icon name="bookmark" size={14} />
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
          <div className="street-route-label">
            <span>
              <i />
              今日の路地 <small>— 棚を選ぶのは、それぞれの店主。</small>
            </span>
            <button onClick={() => setOffset(offset + 1)}>
              <Icon name="shuffle" size={15} />
              路地を変えてみる
            </button>
          </div>
          {ordered.map((shop) => {
            const owner =
              shop.ownerId === "me"
                ? state.me
                : state.readers.find((r) => r.id === shop.ownerId);
            const shelves = shop.shelves.filter((s) => s.isPublic);
            const followed = state.following.includes(shop.id);
            // The street shows one shelf per shop; the whole shop is one tap away.
            const [first] = shelves;
            const more = shelves.length - 1;
            return (
              <article
                className={"street-shop is-compact theme-" + shop.theme}
                key={shop.id}
                id={"street-" + shop.id}
              >
                <header className="street-shop-header">
                  <div className="street-shop-title">
                    <Link
                      href={`/shops/${shop.id}/`}
                      aria-label={shop.name + "に入る"}
                    >
                      <h2>{shop.name}</h2>
                      <Icon name="arrow" size={18} />
                    </Link>
                    {!shop.demo && (
                      <small className="street-own-tag">あなたの書店</small>
                    )}
                  </div>
                  <div className="street-shop-owner">
                    {owner && (
                      <Link href={`/profiles/${owner.id}/`}>
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
                        <Icon name={followed ? "check" : "plus"} size={14} />
                        {followed ? "フォロー済み" : "フォロー"}
                      </button>
                    )}
                  </div>
                </header>
                <div className="street-shop-shelves">
                  {first ? (
                    <StreetShelf
                      shelf={first}
                      books={state.books}
                      index={0}
                      onSelect={(item) =>
                        setSelected({ shop, shelf: first, item })
                      }
                    />
                  ) : (
                    <div className="street-empty-shelf">
                      <Icon name="book" size={26} />
                      <p>このお店の棚は、これから育ちます。</p>
                    </div>
                  )}
                </div>
                <footer className="street-shop-footer">
                  <span>
                    {more > 0
                      ? `ほかに${more}段の棚があります`
                      : "本をタップして、店主の言葉を読む"}
                  </span>
                  <Link href={`/shops/${shop.id}/`}>
                    この書店へ
                    <Icon name="arrow" size={15} />
                  </Link>
                </footer>
              </article>
            );
          })}
          {!ordered.length && (
            <div className="street-empty">
              <Icon name="search" size={28} />
              <h2>この路地では、まだ見つかりませんでした。</h2>
              <p>言葉やジャンルを変えて、もう少し歩いてみましょう。</p>
              <button className="button secondary" onClick={reset}>
                絞り込みを戻す
              </button>
            </div>
          )}
          <section className="street-end">
            <span className="street-end-line" />
            <Icon name="leaf" size={27} />
            <h2>今日の路地は、ここまで。</h2>
            <p>
              いま見られる書店は、ここまでです。
              <br />
              気になった棚に戻ったり、あなたの一冊を並べたり。
            </p>
            <div>
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
            <small>登場する店主と書店は架空のデモです。</small>
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
              {state.ownShop ? "わたしの書店へ" : "書店をつくる"}
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
