"use client";

import Link from "next/link";
import { ownTagline, type Shop, type TownState } from "../lib/types";
import { useWalkStore } from "../lib/walk-store";
import { walkPath } from "../lib/paths";
import { Icon } from "./ui";

/**
 * The shops a reader kept with 保存 while walking, to come back to. The owner
 * is not told, so only the reader sees this list.
 */
export function SavedShops({ state }: { state: TownState }) {
  const { state: walk, ready } = useWalkStore();
  const shops = [...state.shops, ...(state.ownShop ? [state.ownShop] : [])];
  const saved = Object.entries(walk.reactions)
    .filter(([, reaction]) => reaction.saved)
    .map(([id]) => shops.find((shop) => shop.id === id))
    .filter((shop): shop is Shop => Boolean(shop));
  if (!ready || !saved.length) return null;
  return (
    <section
      className="profile-saved-shops"
      aria-labelledby="profile-saved-shops-title"
    >
      <div className="profile-section-heading">
        <div>
          <p className="profile-eyebrow">SHOPS TO COME BACK TO</p>
          <h2 id="profile-saved-shops-title">あとで寄る書店</h2>
        </div>
        <span className="profile-private-label">
          <Icon name="lock" size={14} /> 自分だけ
        </span>
      </div>
      <ul className="saved-shop-list">
        {saved.map((shop) => (
          <li key={shop.id}>
            <Link
              href={walkPath(shop.id)}
              className={"saved-shop theme-" + shop.theme}
            >
              <Icon name="store" size={20} />
              <span>
                <b>{shop.name}</b>
                {ownTagline(shop) && <small>{ownTagline(shop)}</small>}
              </span>
              <Icon name="arrow" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
