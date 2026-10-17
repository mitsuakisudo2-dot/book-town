"use client";

import Link from "next/link";
import {
  ME_ID,
  ownTagline,
  type Shop,
  type TownState,
} from "../../../lib/types";
import { shopCovers } from "../../../lib/features";
import { findReader } from "../../../lib/social";
import { walkPath } from "../../../lib/paths";
import { isSampleId } from "../../../lib/record-kind";
import { BookJacket } from "../../ui";
import { SampleTag } from "../FeatureBand";

/**
 * 本棚をのぞく: a card for each shop, its public covers on the wall, the
 * name, its words and its owner. A tap walks into the shop.
 */
export function ShelvesRail({
  shops,
  state,
}: {
  shops: Shop[];
  state: TownState;
}) {
  return shops.map((shop) => {
    const owner = findReader(state, shop.ownerId);
    const tagline = ownTagline(shop);
    return (
      <li key={shop.id}>
        <Link
          href={walkPath(shop.id)}
          className="home-shopcard"
          aria-label={shop.name + "をのぞく"}
        >
          <span className="home-shopcard-wall" aria-hidden="true">
            {shopCovers(state, shop, 3).map((book) => (
              <span key={book.id} className="home-shopcard-book">
                <BookJacket book={book} sizes="46px" />
              </span>
            ))}
          </span>
          <span className="home-shopcard-text">
            <b>{shop.name}</b>
            {tagline && <span>{tagline}</span>}
            <small>
              {owner && shop.ownerId !== ME_ID && `店主 ${owner.name}`}
              {isSampleId(shop.id) && <SampleTag />}
            </small>
          </span>
        </Link>
      </li>
    );
  });
}
