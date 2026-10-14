"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  boardPicks,
  exhibitionFeature,
  exhibitionPick,
  popsFeature,
  reviewsFeature,
  shelvesFeature,
  shopCovers,
  type Feature,
  type PopPick,
} from "../../lib/features";
import {
  homeLetters,
  isNewcomer,
  letterOf,
  ownLettersSince,
  weave,
  type LetterEntry,
} from "../../lib/home-feed";
import { tonightsShop } from "../../lib/tonight";
import { findReader } from "../../lib/social";
import { useLayerReturn } from "../../lib/back-layer";
import { BookInHand, heldBookOf } from "../BookInHand";
import { ScanSession } from "../ScanSession";
import { Alley } from "./Alley";
import { CorkBoard } from "./CorkBoard";
import { Entrances } from "./Entrances";
import { FeatureView } from "./FeatureBand";
import { useHeld, useTownRead } from "./hooks";
import { Letters, LetterSkeletons, type Shared } from "./Letters";
import { ReadingLine } from "./ReadingLine";
import type { Picked } from "./ShopFront";
import { StartReadingSheet } from "./StartReadingSheet";
import { TopCarousel, type Slide } from "./TopCarousel";

/** The 特集 slots in turn after every two 便り; the board keeps the third (仮). */
type Slot = Feature | { kind: "board"; picks: PopPick[] };

/** What the ホーム pane drew, held still until the reader asks for more. */
type Drawn = {
  at: number;
  newcomer: boolean;
  followed: string[];
  town: string[];
  tonight: string | null;
  exhibition: string | null;
  slots: (Slot | null)[];
};

/** A plain click, not one meant to open the link in a new tab or window. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * The ホーム pane, top to bottom: 「今日の街」, the doors, the book being
 * read, the 便り with 特集 and the 掲示板 between them, then the 路地.
 */
export function HomePane({
  shown,
  refresh,
  onLetters,
  ...shared
}: Shared & {
  /** Whether this pane is the one shown. */
  shown: boolean;
  /** Changes when the reader asks for what is new (the tab, ホーム). */
  refresh: number;
  /** Shows 便りだけ in place. */
  onLetters: () => void;
}) {
  const { state } = shared;
  const read = useTownRead();
  const drawn = useHeld<Drawn>(read, refresh, (now) => {
    const { followed, town } = homeLetters(state, now);
    const letters = [...followed, ...town];
    const pick = exhibitionPick(state);
    return {
      at: now,
      newcomer: isNewcomer(state),
      followed: followed.map((entry) => entry.id),
      town: town.map((entry) => entry.id),
      tonight: tonightsShop(state, now)?.id ?? null,
      exhibition: pick?.id ?? null,
      slots: [
        reviewsFeature(
          state,
          now,
          new Set(
            letters.flatMap((entry) =>
              entry.kind === "post" ? [entry.post.id] : [],
            ),
          ),
        ),
        popsFeature(state, now),
        { kind: "board", picks: boardPicks(state, now) },
        exhibitionFeature(state, new Set(pick ? [pick.id] : [])),
        shelvesFeature(state, now),
      ],
    };
  });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [sheet, setSheet] = useState<"read" | "scan" | null>(null);
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  // Back from a book's own page, the same book is in hand again.
  useLayerReturn((name) => {
    const held = heldBookOf(name);
    const shop = shops.find((entry) => entry.id === held?.shopId);
    const shelf = shop?.shelves.find((entry) => entry.id === held?.shelfId);
    const item = shelf?.items.find((entry) => entry.id === held?.itemId);
    if (!shop || !shelf || !item || picked?.item.id === item.id) return false;
    setPicked({ shop, shelf, item });
    return true;
  }, shops.length > 0);

  // The 便り as they are now: those drawn, and the reader's own new ones.
  const resolve = (ids: string[]) =>
    ids.flatMap((id) => letterOf(state, id) ?? []);
  const drawnIds = new Set(drawn ? [...drawn.followed, ...drawn.town] : []);
  const followed = drawn
    ? [
        ...ownLettersSince(state, drawn.at).filter(
          (entry) => !drawnIds.has(entry.id),
        ),
        ...resolve(drawn.followed),
      ]
    : [];
  const town = drawn ? resolve(drawn.town) : [];
  const tonight =
    drawn?.tonight != null
      ? state.shops.find((shop) => shop.id === drawn.tonight)
      : undefined;
  const poster =
    drawn?.exhibition != null
      ? state.posters.find((entry) => entry.id === drawn.exhibition)
      : undefined;
  const slides: Slide[] | null = drawn && [
    ...(drawn.newcomer ? [{ kind: "welcome" as const }] : []),
    ...(tonight
      ? [
          {
            kind: "tonight" as const,
            shop: tonight,
            owner: findReader(state, tonight.ownerId),
            covers: shopCovers(state, tonight, 4),
          },
        ]
      : []),
    ...(poster
      ? [
          {
            kind: "exhibition" as const,
            poster,
            maker: findReader(state, poster.authorId),
          },
        ]
      : []),
  ];
  // Posters on the page already: the alley's 企画展 shows others.
  const onPage = new Set<string>([
    ...(poster ? [poster.id] : []),
    ...[...followed, ...town].flatMap((entry) =>
      entry.kind === "poster" ? [entry.poster.id] : [],
    ),
    ...(drawn?.slots ?? []).flatMap((slot) =>
      slot?.kind === "exhibition" ? slot.posters.map((entry) => entry.id) : [],
    ),
  ]);

  return (
    <div className="home-pane-body">
      <TopCarousel slides={slides} state={state} />
      <Entrances
        newcomer={drawn?.newcomer ?? isNewcomer(state)}
        onRead={() => setSheet("read")}
        onScan={() => setSheet("scan")}
      />
      {drawn && <ReadingLine state={state} />}
      {drawn ? (
        <WovenLetters
          {...shared}
          followed={followed}
          town={town}
          slots={drawn.slots}
          onPick={setPicked}
        />
      ) : (
        <LetterSkeletons />
      )}
      {followed.length > 0 && (
        <Link
          href="/timeline/"
          className="home-older"
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            onLetters();
          }}
        >
          前の便りは『便りだけ』で
        </Link>
      )}
      <header className="home-alley-head" id="home-alley">
        <h2>ここから、まだ知らない路地</h2>
        {followed.length > 0 && <p>フォロー中の便りは、ここまでです。</p>}
      </header>
      {drawn && (
        <Alley
          {...shared}
          now={drawn.at}
          shown={shown}
          onPage={onPage}
          onPick={setPicked}
        />
      )}
      {picked && (
        <BookInHand
          key={`${picked.shop.id}:${picked.shelf.id}:${picked.item.id}`}
          shop={picked.shop}
          shelf={picked.shelf}
          itemId={picked.item.id}
          state={state}
          actions={shared.actions}
          notify={shared.notify}
          onClose={() => setPicked(null)}
        />
      )}
      {sheet === "read" && (
        <StartReadingSheet {...shared} onClose={() => setSheet(null)} />
      )}
      {sheet === "scan" && (
        <ScanSession
          state={state}
          actions={shared.actions}
          notify={shared.notify}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/**
 * The 便り, a 特集 after every two (never two together while 便り last), the
 * board in the third slot, and 「街の便り」 before the town's.
 */
function WovenLetters({
  followed,
  town,
  slots,
  onPick,
  ...shared
}: Shared & {
  followed: LetterEntry[];
  town: LetterEntry[];
  slots: (Slot | null)[];
  onPick: (picked: Picked) => void;
}) {
  const firstTown = town[0]?.id;
  const parts: ReactNode[] = [];
  let run: LetterEntry[] = [];
  const flush = () => {
    if (!run.length) return;
    parts.push(
      <Letters {...shared} key={"letters:" + parts.length} entries={run} />,
    );
    run = [];
  };
  for (const slot of weave([...followed, ...town], slots)) {
    if (slot.kind === "letter") {
      if (slot.letter.id === firstTown) {
        flush();
        parts.push(
          <header className="home-town-head" key="town-head">
            <h2>街の便り</h2>
            <p>フォローしなくても読めます。</p>
          </header>,
        );
      }
      run.push(slot.letter);
      continue;
    }
    flush();
    const feature = slot.feature;
    parts.push(
      feature.kind === "board" ? (
        <CorkBoard key="board" picks={feature.picks} onPick={onPick} />
      ) : (
        <FeatureView
          {...shared}
          key={"feature:" + feature.kind}
          feature={feature}
          onPick={onPick}
        />
      ),
    );
  }
  flush();
  return <div className="home-letters">{parts}</div>;
}
