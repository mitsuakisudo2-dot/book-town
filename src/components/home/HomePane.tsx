"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { timelinePath } from "../../lib/paths";
import dynamic from "next/dynamic";
import {
  boardPicks,
  exhibitionFeature,
  exhibitionPick,
  isBoardPick,
  isOpenPop,
  isOpenPoster,
  isOpenReview,
  isOpenShop,
  pickAt,
  placeOf,
  popsFeature,
  reviewsFeature,
  shelvesFeature,
  shopCovers,
  type Feature,
  type PlaceRef,
  type PopPick,
} from "../../lib/features";
import {
  firstSteps,
  firstStepsBegun,
  homeLetters,
  isNewcomer,
  letterOf,
  ownLettersSince,
  showsFirstSteps,
  sinceMark,
  weave,
  type LetterEntry,
} from "../../lib/home-feed";
import { lastOpen } from "../../lib/last-open";
import { isTonightShop, tonightsShop } from "../../lib/tonight";
import type { Poster } from "../../lib/posters";
import type { Post, Shop, TownState } from "../../lib/types";
import { findReader } from "../../lib/social";
import { useLayerReturn } from "../../lib/back-layer";
import { BookInHand, readBookInHandAhead } from "../book-in-hand-later";
import { heldBookOf } from "../../lib/held-book";
import { Alley } from "./Alley";
import { CorkBoard } from "./CorkBoard";
import { Entrances } from "./Entrances";
import { FirstSteps } from "./FirstSteps";
import { FeatureView } from "./FeatureBand";
import { LiveBox, type LiveSlot } from "./LiveBox";
import { useHeld, useNow, useTownReading } from "./hooks";
import { useAccountState } from "../../lib/account-session";
import { supabaseConfigured } from "../../lib/supabase/config";
import {
  keepSnapshot,
  readKeptSnapshot,
  snapshotFor,
  snapshotOf,
} from "../../lib/home-snapshot";
import { Letters, LetterSkeletons, type Shared } from "./Letters";
import { ReadingLine } from "./ReadingLine";
import type { Picked } from "./ShopFront";
import { StartReadingSheet } from "./StartReadingSheet";
import { TopCarousel, type Slide } from "./TopCarousel";
import { NAMES } from "../../lib/words";

/**
 * The 特集 slots in turn after every two 便り: Live first when it has a band
 * (v37's place, PR 2b), then the rest, the board third among them (仮).
 */
type Slot = Feature | { kind: "board"; picks: PopPick[] } | LiveSlot;

/**
 * A 特集 as the pane holds it: what it chose, by id, never the records
 * themselves, so each tile is read again from the town as it is now.
 */
type HeldSlot =
  | { kind: "exhibition" | "shelves" | "reviews"; ids: string[] }
  | { kind: "pops" | "board"; places: PlaceRef[] }
  | LiveSlot;

/** What the ホーム pane drew, held still until the reader asks for more. */
type Drawn = {
  at: number;
  newcomer: boolean;
  /** はじめの3つ is shown: held, so the last one ticked stays to be seen. */
  firstSteps: boolean;
  followed: string[];
  town: string[];
  tonight: string | null;
  exhibition: string | null;
  slots: (HeldSlot | null)[];
};

/** What a 特集 chose, to be held by id. */
function hold(slot: Slot | null): HeldSlot | null {
  switch (slot?.kind) {
    case undefined:
      return null;
    case "exhibition":
      return { kind: slot.kind, ids: slot.posters.map((poster) => poster.id) };
    case "shelves":
      return { kind: slot.kind, ids: slot.shops.map((shop) => shop.id) };
    case "reviews":
      return { kind: slot.kind, ids: slot.posts.map((post) => post.id) };
    case "pops":
      return { kind: slot.kind, places: slot.pops.map(placeOf) };
    case "board":
      return { kind: slot.kind, places: slot.picks.map(placeOf) };
    case "live":
      return slot;
  }
}

/**
 * A held 特集 as the town is now: each tile found again and put through the
 * same test that chose it (a post since asked about as a spoiler or
 * reported, a poster folded or taken down, a book moved to a private shelf),
 * and dropped if it fails. A band left with no tile is not drawn; the board
 * stays, with the お題 it still has.
 */
function resolve(
  state: TownState,
  slot: HeldSlot | null,
  at: number,
): Slot | null {
  function found<T extends { id: string }>(
    list: T[],
    ids: string[],
    open: (entry: T) => boolean,
  ): T[] {
    return ids.flatMap((id) => {
      const entry = list.find((each) => each.id === id);
      return entry && open(entry) ? [entry] : [];
    });
  }
  const places = (refs: PlaceRef[], open: (pick: PopPick) => boolean) =>
    refs.flatMap((ref) => {
      const pick = pickAt(state, ref);
      return pick && open(pick) ? [pick] : [];
    });
  switch (slot?.kind) {
    case undefined:
      return null;
    // Live reads its lines again itself, with what polling brought.
    case "live":
      return slot;
    case "board":
      return {
        kind: "board",
        picks: places(slot.places, (pick) => isBoardPick(state, pick)),
      };
    case "pops": {
      const pops = places(slot.places, (pick) => isOpenPop(state, pick));
      return pops.length ? { kind: "pops", pops } : null;
    }
    case "exhibition": {
      const posters = found<Poster>(state.posters, slot.ids, (poster) =>
        isOpenPoster(state, poster),
      );
      return posters.length ? { kind: "exhibition", posters } : null;
    }
    case "shelves": {
      const shops = found<Shop>(state.shops, slot.ids, (shop) =>
        isOpenShop(state, shop),
      );
      return shops.length ? { kind: "shelves", shops } : null;
    }
    case "reviews": {
      const posts = found<Post>(state.posts, slot.ids, (post) =>
        isOpenReview(state, post, at),
      );
      return posts.length ? { kind: "reviews", posts } : null;
    }
  }
}

/** A plain click, not one meant to open the link in a new tab or window. */
// The camera's scanning comes in its own file, read when it is opened.
const ScanSession = dynamic(
  () => import("../ScanSession").then((file) => file.ScanSession),
  { ssr: false },
);

const still = () => () => {};

/**
 * How much of Home has been drawn on this page before: 0 nothing yet, 1 all
 * the 便り, 2 the 路地 as well.
 */
let homeDrawn = 0;

/**
 * The parts of the 便り (a run of cards, a 特集, 「街の便り」) drawn in the
 * first frame: a phone's first screen and a little more.
 */
const FIRST_PARTS = 3;

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
  live,
  onTakeLine,
  ...shared
}: Shared & {
  /** Whether this pane is the one shown. */
  shown: boolean;
  /** Changes when the reader asks for what is new (the tab, ホーム). */
  refresh: number;
  /** Shows 便りだけ in place. */
  onLetters: () => void;
  /** Live as HomeView chose it with this drawing (liveSlotOf), or none. */
  live: LiveSlot | null;
  /** Takes a line of Live into the town; whether it is there now. */
  onTakeLine: (id: string) => boolean;
}) {
  const { state } = shared;
  // Whose Home this is, for the 便り kept from the last time (home-snapshot):
  // null while the account is being checked or cannot be.
  const account = useAccountState();
  const owner =
    account.status === "signed-in"
      ? account.user.id
      : account.status === "signed-out"
        ? "visitor"
        : null;
  const reading = useTownReading();
  const drawn = useHeld<Drawn>(reading, refresh, (now) => {
    // Live's memos (PR 2b) leave the 便り, so none appears twice.
    const { followed, town } = homeLetters(
      state,
      now,
      new Set(live?.ids ?? []),
    );
    const letters = [...followed, ...town];
    const pick = exhibitionPick(state);
    return {
      at: now,
      newcomer: isNewcomer(state),
      firstSteps: showsFirstSteps(
        state,
        owner !== null && firstStepsBegun.has(owner),
      ),
      followed: followed.map((entry) => entry.id),
      town: town.map((entry) => entry.id),
      tonight: tonightsShop(state, now)?.id ?? null,
      exhibition: pick?.id ?? null,
      slots: (
        [
          ...(live ? [live] : []),
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
        ] satisfies (Slot | null)[]
      ).map(hold),
    };
  });
  // The first time Home is drawn on a page, it comes in three frames: the
  // first screen of 便り, then the rest of them, then the 路地 (below the
  // screen, and as much again as everything above it). A slow phone lays
  // out and paints the first screen before the rest, which took it as long
  // again as everything before (docs/09 「速さ」). Back on Home later, it is
  // all there at once, where the reader left it.
  // はじめの3つ once shown stay until done, whatever the reader does on the
  // way (showsFirstSteps).
  const stepsShown = !!drawn?.firstSteps;
  useEffect(() => {
    if (stepsShown && owner !== null) firstStepsBegun.mark(owner);
  }, [stepsShown, owner]);
  const [stage, setStage] = useState(homeDrawn);
  useEffect(() => {
    if (drawn && stage >= 2) readBookInHandAhead();
  }, [drawn, stage]);
  useEffect(() => {
    if (!drawn || stage >= 2) return;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        homeDrawn = Math.max(homeDrawn, stage + 1);
        setStage(stage + 1);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [drawn, stage]);
  const kept = useSyncExternalStore(still, readKeptSnapshot, () => null);
  const now = useNow();
  const snapshot =
    supabaseConfigured && !drawn && now !== null
      ? snapshotFor(kept, account.status === "loading" ? null : owner, now)
      : null;
  // Where the 便り kept from last time were drawn, the page is already that
  // tall: the town's own come in all at once, so it never grows shorter.
  const [keptShown, setKeptShown] = useState(false);
  const keptDrawn = snapshot !== null;
  useEffect(() => {
    if (keptDrawn) setKeptShown(true);
  }, [keptDrawn]);
  // Only the first screen of 便り is drawn yet: what comes after them waits.
  const partial = !!drawn && stage < 1 && !keptShown;
  // Home as drawn is kept for the next time; the town of a demo is not.
  useEffect(() => {
    if (!supabaseConfigured || !drawn || owner === null) return;
    keepSnapshot(snapshotOf(state, drawn, owner, drawn.at));
  }, [state, drawn, owner]);
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
  const resolveLetters = (ids: string[]) =>
    ids.flatMap((id) => letterOf(state, id) ?? []);
  const drawnIds = new Set(drawn ? [...drawn.followed, ...drawn.town] : []);
  const followed = drawn
    ? [
        ...ownLettersSince(state, drawn.at).filter(
          (entry) => !drawnIds.has(entry.id),
        ),
        ...resolveLetters(drawn.followed),
      ]
    : [];
  const town = drawn ? resolveLetters(drawn.town) : [];
  // 「前に開いたのはここまで」: among the followed 便り, or the town's on a
  // home that has none.
  const mark = drawn
    ? sinceMark(followed.length ? followed : town, lastOpen.opened())
    : null;
  // The slides and the 特集 as they are now: what fails its test is dropped.
  const slots = drawn
    ? drawn.slots.map((slot) => resolve(state, slot, drawn.at))
    : [];
  const tonight = state.shops.find(
    (shop) => shop.id === drawn?.tonight && isTonightShop(state, shop),
  );
  const poster = state.posters.find(
    (entry) => entry.id === drawn?.exhibition && isOpenPoster(state, entry),
  );
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
    ...slots.flatMap((slot) =>
      slot?.kind === "exhibition" ? slot.posters.map((entry) => entry.id) : [],
    ),
  ]);

  return (
    <div className="home-pane-body">
      <TopCarousel slides={slides} state={state} />
      <Entrances
        newcomer={drawn?.newcomer ?? null}
        onRead={() => setSheet("read")}
        onScan={() => setSheet("scan")}
      />
      {drawn?.firstSteps && (
        <FirstSteps steps={firstSteps(state)} onScan={() => setSheet("scan")} />
      )}
      {drawn && <ReadingLine state={state} />}
      {drawn ? (
        <WovenLetters
          {...shared}
          followed={followed}
          town={town}
          slots={slots}
          mark={mark}
          onPick={setPicked}
          onTakeLine={onTakeLine}
          parts={partial ? FIRST_PARTS : undefined}
        />
      ) : snapshot ? (
        // The 便り kept from last time, read-only until the town is read.
        <div className="home-kept" inert aria-busy="true">
          <WovenLetters
            {...shared}
            state={snapshot.state}
            followed={snapshot.followed.flatMap(
              (id) => letterOf(snapshot.state, id) ?? [],
            )}
            town={snapshot.town.flatMap(
              (id) => letterOf(snapshot.state, id) ?? [],
            )}
            slots={[]}
            mark={null}
            onPick={() => undefined}
            onTakeLine={() => false}
          />
        </div>
      ) : (
        <LetterSkeletons />
      )}
      {!partial && followed.length > 0 && (
        <Link
          href={timelinePath()}
          className="home-older"
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            onLetters();
          }}
        >
          前の{NAMES.letter}は『{NAMES.letter}だけ』で
        </Link>
      )}
      {!partial && (
        <header className="home-alley-head" id="home-alley">
          <h2>ここから、まだ知らない路地</h2>
          {followed.length > 0 && (
            <p>フォロー中の{NAMES.letter}は、ここまでです。</p>
          )}
        </header>
      )}
      {drawn && stage >= 2 && (
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
  mark,
  onPick,
  onTakeLine,
  parts: drawnParts,
  ...shared
}: Shared & {
  followed: LetterEntry[];
  town: LetterEntry[];
  slots: (Slot | null)[];
  /** The 便り 「前に開いたのはここまで」 goes before. */
  mark: string | null;
  onPick: (picked: Picked) => void;
  onTakeLine: (id: string) => boolean;
  /** How many of the parts to draw, or all of them. */
  parts?: number;
}) {
  const firstTown = town[0]?.id;
  const parts: ReactNode[] = [];
  let run: LetterEntry[] = [];
  const flush = () => {
    if (!run.length) return;
    parts.push(
      <Letters
        {...shared}
        key={"letters:" + parts.length}
        entries={run}
        mark={mark}
      />,
    );
    run = [];
  };
  for (const slot of weave([...followed, ...town], slots)) {
    if (slot.kind === "letter") {
      if (slot.letter.id === firstTown) {
        flush();
        parts.push(
          <header className="home-town-head" key="town-head">
            <h2>街の{NAMES.letter}</h2>
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
      feature.kind === "live" ? (
        <LiveBox
          {...shared}
          key="live"
          slot={feature}
          onTakeLine={onTakeLine}
        />
      ) : feature.kind === "board" ? (
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
  return (
    <div className="home-letters">
      {drawnParts === undefined ? parts : parts.slice(0, drawnParts)}
    </div>
  );
}
