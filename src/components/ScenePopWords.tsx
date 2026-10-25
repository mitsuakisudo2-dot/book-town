"use client";
import { useEffect } from "react";
import { useWalkStore } from "../lib/walk-store";
import { bookPop } from "../lib/store-scene";

/**
 * The words of a POP in a shop's scene, read with the walk's scenes; the
 * scene is asked for when it is not at hand. Nothing while it is read, or
 * once the POP is gone. A book's page reads this only for such a POP.
 */
export function ScenePopWords({
  shopId,
  placementId,
}: {
  shopId: string;
  placementId: string;
}) {
  const { scenes, unread, need } = useWalkStore();
  const waiting = unread.has(shopId);
  useEffect(() => {
    if (waiting) void need([shopId]);
  }, [waiting, need, shopId]);
  const scene = scenes.find((entry) => entry.storeId === shopId);
  const words = scene && bookPop(scene, placementId)?.text?.trim();
  return words ? (
    <span className="book-encounters-pop-words">{words}</span>
  ) : null;
}
