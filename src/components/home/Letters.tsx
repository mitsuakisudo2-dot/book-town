"use client";

import type { Notify, TownActions, TownState } from "../../lib/types";
import type { LetterEntry } from "../../lib/home-feed";
import { LetterCard } from "../letter/LetterCard";
import { PosterCard } from "../PosterView";

export type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/** 便り one under another: posts as cards from 1a, posters flat beside them. */
export function Letters({
  entries,
  label,
  ...shared
}: Shared & { entries: LetterEntry[]; label?: string }) {
  return (
    <div className="post-feed" aria-label={label}>
      {entries.map((entry) =>
        entry.kind === "post" ? (
          <LetterCard key={entry.id} {...shared} post={entry.post} showBook />
        ) : (
          <PosterCard
            key={entry.id}
            poster={entry.poster}
            state={shared.state}
          />
        ),
      )}
    </div>
  );
}

/**
 * While the town is on its way: the shapes of three cards, never a sentence
 * saying there is nothing.
 */
export function LetterSkeletons() {
  return (
    <div className="home-skeletons" aria-busy="true">
      <span className="sr-only">便りを読み込んでいます</span>
      <div className="home-skel" />
      <div className="home-skel" />
      <div className="home-skel" />
    </div>
  );
}
