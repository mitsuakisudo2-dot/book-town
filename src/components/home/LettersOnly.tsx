"use client";

import { useEffect, useRef } from "react";
import {
  followedLetters,
  letterOf,
  ownLettersSince,
} from "../../lib/home-feed";
import { Icon } from "../ui";
import { FollowSuggestions } from "./FollowSuggestions";
import { useHeld, usePaneParam, useTownRead } from "./hooks";
import { LetterSkeletons, Letters, type Shared } from "./Letters";

/** 便り drawn at a time; more come as the reader nears the end. */
const PAGE = 20;

/**
 * 便りだけ (決定 H:91-93): only the 便り of those the reader follows, and
 * their own, newest first. No carousel, doors, 特集 or board. How many were
 * shown stays in the address (`?rounds`, as the alley's does).
 */
export function LettersOnly({
  shown,
  refresh,
  onHome,
  ...shared
}: Shared & {
  shown: boolean;
  refresh: number;
  /** Shows ホーム in place. */
  onHome: () => void;
}) {
  const { state } = shared;
  const read = useTownRead();
  const drawn = useHeld(read, refresh, (now) => ({
    at: now,
    ids: followedLetters(state).map((entry) => entry.id),
  }));
  // Held still like ホーム's; but a pane that drew none has nothing to keep
  // in place, so 便り followed from it come at once (仮).
  const ids = new Set(drawn?.ids);
  const entries = !drawn
    ? []
    : drawn.ids.length
      ? [
          ...ownLettersSince(state, drawn.at).filter(
            (entry) => !ids.has(entry.id),
          ),
          ...drawn.ids.flatMap((id) => letterOf(state, id) ?? []),
        ]
      : followedLetters(state);
  const [roundsParam, setRoundsParam] = usePaneParam("rounds", shown);
  const pages = Math.max(1, Number.parseInt(roundsParam ?? "", 10) || 1);
  const visible = entries.slice(0, pages * PAGE);
  const more = visible.length < entries.length;
  const further = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = further.current;
    if (
      !shown ||
      !more ||
      !target ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((entry) => entry.isIntersecting))
          setRoundsParam(String(pages + 1));
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shown, more, pages, setRoundsParam]);
  if (!drawn) return <LetterSkeletons />;
  if (!entries.length)
    return (
      <div className="home-letters-only">
        <div className="home-placeholder">
          <b>まだ便りがありません</b>
          <p>フォローした人と本屋の便りだけが、新しい順に並ぶ場所です。</p>
          <button type="button" className="button" onClick={onHome}>
            ホームに戻る
          </button>
        </div>
        <FollowSuggestions {...shared} />
      </div>
    );
  return (
    <div className="home-letters-only">
      <Letters {...shared} entries={visible} />
      <div ref={further} />
      {!more && (
        <div className="home-letters-end">
          <Icon name="leaf" size={22} />
          <b>便りは、ここまでです</b>
          <button type="button" className="home-letters-home" onClick={onHome}>
            ホームで本屋の特集を見る
            <Icon name="chevron" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
