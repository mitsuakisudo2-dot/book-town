"use client";

import type { Poster } from "../../../lib/posters";
import type { TownState } from "../../../lib/types";
import { ME_ID } from "../../../lib/types";
import { findReader } from "../../../lib/social";
import { posterPath } from "../../../lib/paths";
import { isSample } from "../../../lib/tonight";
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
    const sample = poster.authorId !== ME_ID && isSample(poster.authorId);
    return (
      <li key={poster.id} className="home-poster-tile">
        <PosterThumb
          poster={poster}
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
