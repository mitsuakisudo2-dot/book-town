"use client";

import { useId } from "react";
import type { PopPick } from "../../lib/features";
import { quotedTitle } from "../../lib/book-name";
import { BOARD_NOTICE, refuseForSample } from "../../lib/sample-notice";
import { BookJacket, Icon } from "../ui";
import { SampleTag } from "./FeatureBand";
import type { Picked } from "./ShopFront";

/**
 * The 掲示板: a cork board for what the town pins up, so it never reads as
 * a post. Until the first real お題 it is a 見本 (仮): the お題 holds books
 * the 見本 shops show, the 募集 paper says what is still being made, and
 * nobody is shown taking part. Both buttons say so.
 */
export function CorkBoard({
  picks,
  onPick,
}: {
  picks: PopPick[];
  onPick: (picked: Picked) => void;
}) {
  const id = useId();
  const sample = () => refuseForSample(BOARD_NOTICE);
  return (
    <section className="home-board" id="home-board" aria-labelledby={id}>
      <h2 className="home-board-head" id={id}>
        <Icon name="pin" size={18} />
        掲示板
        <span>運営のお題と、募集中のこと</span>
      </h2>
      <article className="home-notice">
        <span className="home-notice-pin" aria-hidden="true" />
        <p className="home-notice-kicker">
          運営からの、今月のお題
          <SampleTag />
        </p>
        <h3 className="home-notice-title">眠れない夜の一冊</h3>
        <p className="home-notice-text">
          店主たちが1冊ずつ置いています。あなたの1冊も、ここに置けます。
        </p>
        {picks.length > 0 && (
          <ul className="home-notice-picks">
            {picks.map(({ shop, shelf, item, book }) => (
              <li key={shop.id}>
                <button
                  type="button"
                  aria-label={`${quotedTitle(book)}${shop.name}`}
                  onClick={() => onPick({ shop, shelf, item })}
                >
                  <span className="home-tile-book" aria-hidden="true">
                    <BookJacket book={book} sizes="72px" />
                  </span>
                  <small aria-hidden="true">{shop.name}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="home-notice-buttons">
          <button type="button" className="home-notice-quiet" onClick={sample}>
            ぜんぶ見る
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="home-notice-add" onClick={sample}>
            <Icon name="plus" size={16} />
            1冊置く
          </button>
        </div>
      </article>
      <article className="home-notice is-tilted">
        <span className="home-notice-pin" aria-hidden="true" />
        <p className="home-notice-kicker">
          <Icon name="users" size={18} />
          これからの募集
          <SampleTag />
        </p>
        <h3 className="home-notice-title is-small">読み切り会と選書カルテ</h3>
        <p className="home-notice-text">
          同じ本をみんなで読み切る会と、店主に一冊を選んでもらう選書カルテは、いま準備中です。
        </p>
      </article>
    </section>
  );
}
