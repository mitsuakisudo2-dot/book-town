"use client";

import { Fragment } from "react";
import type { Notify, TownActions, TownState } from "../../lib/types";
import type { LetterEntry } from "../../lib/home-feed";
import { LetterCard } from "../letter/LetterCard";
import { PosterCard } from "../PosterView";

export type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/**
 * 便り one under another: posts as cards from 1a, posters flat beside them.
 * 「前に開いたのはここまで」 goes before `mark` (sinceMark, home-feed.ts).
 */
export function Letters({
  entries,
  label,
  mark = null,
  ...shared
}: Shared & { entries: LetterEntry[]; label?: string; mark?: string | null }) {
  return (
    <div className="post-feed" aria-label={label}>
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          {entry.id === mark && (
            <p className="home-since">前に開いたのはここまで</p>
          )}
          {entry.kind === "post" ? (
            <LetterCard {...shared} post={entry.post} showBook />
          ) : (
            <PosterCard poster={entry.poster} state={shared.state} />
          )}
        </Fragment>
      ))}
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
