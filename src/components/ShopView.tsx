"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ME_ID,
  ownTagline,
  type TownState,
  type TownActions,
  type ShelfItem,
  type Shelf,
  type Book,
  type Notify,
} from "../lib/types";
import { Icon, ReaderAvatar } from "./ui";
import { WoodenShelf } from "./WoodenShelf";
import { BookInHand, readBookInHandAhead } from "./book-in-hand-later";
import { heldBookOf } from "../lib/held-book";
import { FoldedWords } from "./Social";
import { useHorizontalSwipe } from "./useHorizontalSwipe";
import { myShopPath, profilePath, shopPath, walkPath } from "../lib/paths";
import { ReportButton } from "./Report";
import { BackLink } from "./BackLink";
import { replaceAddress } from "../lib/url-state";
import { useLayerReturn } from "../lib/back-layer";
import { reducedMotion } from "../lib/motion";
import { bookById, quotedTitle } from "../lib/book-name";
import { counted, whenSome } from "../lib/words";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};
export function ShopView({
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
        <Link href={myShopPath()} className="btn fill">
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
        <Link href={walkPath()} className="btn fill">
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
            <Link href={myShopPath({ tidy: true })} className="btn">
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
                <small>{counted(s.items.length, "冊")}の選書</small>
              ) : (
                shop.ownerId === ME_ID && (
                  <Link href={myShopPath()} className="store-shelf-fill">
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
                        <small>{quotedTitle(book)}</small>
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
            <Link href={myShopPath()} className="btn">
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
              whenSome(shop.followers, "人", (c) => `${c}がフォロー`),
              shop.weekVisitors &&
                whenSome(
                  shop.weekVisitors.count,
                  "人",
                  (c) => `先週${c}が立ち寄り`,
                ),
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
/** Up to three of a shelf's POPs, in shelf order: the owner's words beside the shelf. */
function shelfPops(shelf: Shelf, books: Book[]) {
  return shelf.items
    .filter((item) => item.pop.trim())
    .map((item) => ({
      item,
      book: bookById(books, item.bookId),
    }))
    .filter((entry): entry is { item: ShelfItem; book: Book } => !!entry.book)
    .slice(0, 3);
}
