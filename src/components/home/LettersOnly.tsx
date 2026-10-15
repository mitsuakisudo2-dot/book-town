"use client";

import { useEffect, useRef, useState } from "react";
import {
  followedLetters,
  letterOf,
  ownLettersSince,
  sinceMark,
} from "../../lib/home-feed";
import { lastOpen } from "../../lib/last-open";
import { useTownReads } from "../../lib/store";
import { Icon } from "../ui";
import { FollowSuggestions } from "./FollowSuggestions";
import { useHeld, usePaneParam, useTownReading } from "./hooks";
import { LetterSkeletons, Letters, type Shared } from "./Letters";
import { readOlder } from "./useArrivals";

/** 便り drawn at a time; more come as the reader nears the end. */
const PAGE = 20;

/** Where 便りだけ's older pages are: read, on their way, failed, or all read. */
type Older = {
  /** The town's reading they were read for. */
  reading: number | null;
  /** The 便り they brought, by id, oldest page last. */
  ids: string[];
  state: "idle" | "reading" | "failed" | "done";
};

/**
 * 便りだけ (決定 H:91-93): only the 便り of those the reader follows, and
 * their own, newest first. No carousel, doors, 特集 or board. How many were
 * shown stays in the address (`?rounds`, as the alley's does). Past the 便り
 * the town read, older ones are read a page at a time (PR 2); the demo has
 * none to read.
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
  const reading = useTownReading();
  const drawn = useHeld(reading, refresh, (now) => ({
    at: now,
    ids: followedLetters(state).map((entry) => entry.id),
  }));
  // Held still like ホーム's; but a pane that drew none has nothing to keep
  // in place, so 便り followed from it come at once (仮).
  const ids = new Set(drawn?.ids);
  const held = !drawn
    ? []
    : drawn.ids.length
      ? [
          ...ownLettersSince(state, drawn.at).filter(
            (entry) => !ids.has(entry.id),
          ),
          ...drawn.ids.flatMap((id) => letterOf(state, id) ?? []),
        ]
      : followedLetters(state);
  // Older pages, read for this reading of the town, go after what it holds.
  const reads = useTownReads();
  const [older, setOlder] = useState<Older>({
    reading,
    ids: [],
    state: "idle",
  });
  if (older.reading !== reading) setOlder({ reading, ids: [], state: "idle" });
  const heldIds = new Set(held.map((entry) => entry.id));
  const entries = [
    ...held,
    ...older.ids.flatMap((id) =>
      heldIds.has(id) ? [] : (letterOf(state, id) ?? []),
    ),
  ];
  const [roundsParam, setRoundsParam] = usePaneParam("rounds", shown);
  const pages = Math.max(1, Number.parseInt(roundsParam ?? "", 10) || 1);
  const visible = entries.slice(0, pages * PAGE);
  const more = visible.length < entries.length;
  // What is left to read: more of what is here, or an older page.
  const further = useRef<HTMLDivElement>(null);
  const readable =
    reads && drawn !== null && entries.length > 0 && older.state === "idle";
  const next = more ? "page" : readable ? "older" : null;
  function readOlderPage() {
    const from = reading;
    setOlder((now) => ({ ...now, state: "reading" }));
    readOlder().then(
      (page) =>
        setOlder((now) =>
          now.reading !== from
            ? now
            : {
                ...now,
                ids: [
                  ...now.ids,
                  ...(page?.entries ?? [])
                    .map((entry) => entry.id)
                    .filter((id) => !now.ids.includes(id)),
                ],
                state: !page || page.done ? "done" : "idle",
              },
        ),
      () =>
        setOlder((now) =>
          now.reading !== from ? now : { ...now, state: "failed" },
        ),
    );
  }
  const readOlderRef = useRef(readOlderPage);
  useEffect(() => {
    readOlderRef.current = readOlderPage;
  });
  useEffect(() => {
    const target = further.current;
    if (
      !shown ||
      !next ||
      !target ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (!seen.some((entry) => entry.isIntersecting)) return;
        if (next === "page") setRoundsParam(String(pages + 1));
        else {
          observer.disconnect();
          readOlderRef.current();
        }
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shown, next, pages, setRoundsParam]);
  // The end is said only when nothing is left to read.
  const end = !more && (!reads || older.state === "done");
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
      <Letters
        {...shared}
        entries={visible}
        mark={sinceMark(entries, lastOpen.opened())}
      />
      <div ref={further} />
      {!more && older.state === "reading" && (
        <p className="home-letters-more" role="status">
          前の便りを読んでいます
        </p>
      )}
      {!more && older.state === "failed" && (
        <div className="home-letters-more">
          <button
            type="button"
            className="button secondary"
            onClick={readOlderPage}
          >
            前の便りをもう一度読む
          </button>
        </div>
      )}
      {end && (
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
