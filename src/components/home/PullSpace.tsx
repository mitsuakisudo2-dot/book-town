"use client";

import { useSyncExternalStore } from "react";
import { PULL_WORDS, type PullSpaceStore } from "./usePullToRefresh";

/**
 * The space a pull opens under the tabs, with its words. Said to a screen
 * reader by the live region once it is read, so hidden from it here.
 */
export function PullSpace({ space }: { space: PullSpaceStore }) {
  const pull = useSyncExternalStore(space.subscribe, space.get, () => null);
  if (!pull) return null;
  return (
    <div
      className="home-pull"
      aria-hidden="true"
      data-phase={pull.phase}
      style={{ height: pull.distance }}
    >
      <span>{PULL_WORDS[pull.phase]}</span>
    </div>
  );
}
