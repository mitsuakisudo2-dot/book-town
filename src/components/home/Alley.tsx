"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Shop } from "../../lib/types";
import { exhibitionFeature, shelvesFeature } from "../../lib/features";
import { shopOpenedRecently } from "../../lib/just-opened";
import { useTownBackend } from "../../lib/store";
import { Icon } from "../ui";
import { FeatureView } from "./FeatureBand";
import { motion, usePaneParam } from "./hooks";
import type { Shared } from "./Letters";
import { ShopFront, type Picked } from "./ShopFront";
import { myShopPath } from "../../lib/paths";

/** The most rounds of the alley kept on the page at once. */
const MAX_ROUNDS = 30;
/** A 特集 after every this many shops. */
const SHOPS_PER_BAND = 2;
/** At most this many posters in one 企画展 of the alley, and shops in one 本棚をのぞく. */
const ALLEY_POSTERS = 3;
const ALLEY_SHOPS = 4;

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

/**
 * The 路地 (決定 H:35, 124): every shop's front with its real shelves, round
 * after round in a new order, growing as the reader nears its end. How far
 * they walked stays in the address (`?rounds`), so 戻る from a shop or a
 * book deep in the alley comes back to the same place. Every two shops a
 * 特集: 企画展 (posters not yet on the page) and 本棚をのぞく by turns.
 */
export function Alley({
  now,
  shown,
  onPage,
  onPick,
  ...shared
}: Shared & {
  now: number;
  /** Whether the ホーム pane is the one shown (its address is the alley's). */
  shown: boolean;
  /** Posters already on the page, which the alley's 企画展 leaves out. */
  onPage: ReadonlySet<string>;
  onPick: (picked: Picked) => void;
}) {
  const { state } = shared;
  const savedIn = useTownBackend();
  const [roundsParam, setRoundsParam] = usePaneParam("rounds", shown);
  // A shop opened in this browser within a day stands at the head of the alley.
  const [welcomeOwn, setWelcomeOwn] = useState(false);
  useEffect(() => setWelcomeOwn(shopOpenedRecently()), []);
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const newOwn = welcomeOwn
    ? shops.find(
        (shop) =>
          shop.id === state.ownShop?.id &&
          shop.shelves.some((shelf) => shelf.isPublic && shelf.items.length),
      )
    : undefined;
  const ordered = newOwn
    ? [newOwn, ...shops.filter((shop) => shop !== newOwn)]
    : shops;
  // The alley has no end: past the last shop, another round of the same
  // town begins in a new order. A short list stays one round.
  const endless = shops.length >= 3;
  const shownRounds = endless
    ? Math.min(
        Math.max(1, Number.parseInt(roundsParam ?? "", 10) || 1),
        MAX_ROUNDS,
      )
    : 1;
  const rounds: Shop[][] = [ordered];
  for (let round = 1; round < shownRounds; round++)
    rounds.push(roundOrder(shops, round, rounds[round - 1].at(-1)));
  // The 特集 between the shops, in order down the alley.
  const posters = new Set(onPage);
  // The 本棚をのぞく woven into the 便り is turn 0: the alley's go on from it.
  let turn = 1;
  const bandAfter = (index: number): ReactNode => {
    if ((index + 1) % SHOPS_PER_BAND !== 0) return null;
    const band = (index + 1) / SHOPS_PER_BAND - 1;
    const exhibition =
      band % 2 === 0 ? exhibitionFeature(state, posters, ALLEY_POSTERS) : null;
    exhibition?.posters.forEach((poster) => posters.add(poster.id));
    const feature =
      exhibition ?? shelvesFeature(state, now, turn++, ALLEY_SHOPS);
    return (
      feature && <FeatureView {...shared} feature={feature} onPick={onPick} />
    );
  };
  const further = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = further.current;
    if (
      !shown ||
      !endless ||
      !target ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setRoundsParam(String(Math.min(shownRounds + 1, MAX_ROUNDS)));
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shown, endless, shownRounds, setRoundsParam]);
  let count = 0;
  return (
    <div className="home-alley">
      {rounds.map((round, roundIndex) => (
        <Fragment key={roundIndex}>
          {roundIndex > 0 && (
            <div className="street-round" role="separator">
              <Icon name="leaf" size={16} />
              <span>路地は、まだ続きます</span>
            </div>
          )}
          {round.map((shop) => {
            const index = count++;
            return (
              <Fragment key={roundIndex + "-" + shop.id}>
                <ShopFront
                  {...shared}
                  shop={shop}
                  first={roundIndex === 0}
                  welcome={roundIndex === 0 && shop === newOwn}
                  onPick={onPick}
                />
                {bandAfter(index)}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
      {!shops.length && (
        <div className="street-empty">
          <Icon name="leaf" size={28} />
          <h2>この街は、まだ朝です。</h2>
          <p>最初の一軒になりませんか。好きな本を一冊並べれば開店です。</p>
          <Link className="btn fill" href={myShopPath()}>
            書店をひらく
          </Link>
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
            <h2>この先は、まだ空き地です。</h2>
            <p>あなたの一冊を並べると、路地が少し長くなります。</p>
          </>
        )}
        <div ref={further}>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: motion() })}
          >
            通りの入口へ
            <Icon name="back" size={15} />
          </button>
          <Link href={myShopPath({ tidy: !!state.ownShop })}>
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
  );
}
