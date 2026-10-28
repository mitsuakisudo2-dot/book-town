"use client";

import { posterSpoilerView, type Poster } from "../../../lib/posters";
import type { TownState } from "../../../lib/types";
import { findReader } from "../../../lib/social";
import { posterPath } from "../../../lib/paths";
import { isSampleId } from "../../../lib/record-kind";
import { PosterThumb } from "../../PosterView";

/** 企画展: the posters, each a link to its page; a 見本 says it is one. */
export function Exhibition({
  posters,
  state,
}: {
  posters: Poster[];
  state: TownState;
}) {
  return posters.map((poster) => {
    const maker = findReader(state, poster.authorId);
    const sample = isSampleId(poster.authorId);
    return (
      <li key={poster.id} className="home-poster-tile">
        <PosterThumb
          poster={poster}
          covered={posterSpoilerView(state, poster) !== "open"}
          books={state.books}
          href={posterPath(poster.id)}
          caption={
            [maker?.name, sample && "見本"].filter(Boolean).join(" · ") ||
            undefined
          }
        />
      </li>
    );
  });
}
