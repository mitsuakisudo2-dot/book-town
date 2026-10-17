"use client";

import type { PopPick } from "../../../lib/features";
import type { TownState } from "../../../lib/types";
import { findReader } from "../../../lib/social";
import { isSample } from "../../../lib/tonight";
import { bookTitle } from "../../../lib/book-name";
import { BookJacket } from "../../ui";
import { SampleTag } from "../FeatureBand";
import type { Picked } from "../ShopFront";

/**
 * 本屋のPOP: one POP from each shop's public shelves, on a card of paper. A
 * tap takes the book off its shelf into the hand.
 */
export function Pops({
  pops,
  state,
  onPick,
}: {
  pops: PopPick[];
  state: TownState;
  onPick: (picked: Picked) => void;
}) {
  return pops.map(({ shop, shelf, item, book }) => {
    const owner = findReader(state, shop.ownerId);
    return (
      <li key={shop.id + ":" + item.id}>
        <button
          type="button"
          className="home-pop"
          onClick={() => onPick({ shop, shelf, item })}
        >
          <span className="home-pop-words">{item.pop.trim()}</span>
          <span className="home-pop-book">
            <span className="home-pop-jacket" aria-hidden="true">
              <BookJacket book={book} sizes="30px" />
            </span>
            <span>
              <b>{bookTitle(book)}</b>
              <small>
                {shop.name}
                {owner && `・店主 ${owner.name}`}
                {isSample(shop.id) && <SampleTag />}
              </small>
            </span>
          </span>
        </button>
      </li>
    );
  });
}
