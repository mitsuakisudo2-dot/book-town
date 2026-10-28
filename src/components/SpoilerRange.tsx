"use client";

import { useId } from "react";
import type { TownState } from "../lib/types";
import {
  rangeChoices,
  SPOILER_RANGE,
  spoilerIsbnOf,
} from "../lib/spoiler-range";
import { useMoreRead } from "../lib/store";
import "./spoiler-range.css";

// ネタバレの範囲を手で選ぶ (管理表 22 ①): under ネタバレあり, the volumes of
// the series the book is in, from its own to the last known, as spines on a
// small shelf. A touch on one says the spoiler goes that far, and the
// spines up to it take the band; the last one is the whole series, as it
// stands, where it starts. A book in no series, or the last of its line,
// shows nothing here: ネタバレあり is all there is to say.

/** The volumes a spoiler about `bookId` may go up to; empty for none. */
export function useRangeChoices(state: TownState, bookId: string | null) {
  const isbn = spoilerIsbnOf(state, bookId);
  const { read } = useMoreRead(isbn ? { series: isbn } : null);
  const line = read?.series
    ?.flatMap((series) => series.lines)
    .find((entry) => entry.volumes.some((volume) => volume.isbn === isbn));
  return rangeChoices(line, isbn);
}

/**
 * The shelf to choose how far a spoiler goes. `through` is the volume's
 * number chosen; none for the whole (the last spine).
 */
export function SpoilerRangeShelf({
  state,
  bookId,
  through,
  onChange,
}: {
  state: TownState;
  bookId: string | null;
  through: number | undefined;
  onChange: (through: number | undefined) => void;
}) {
  const id = useId();
  const choices = useRangeChoices(state, bookId);
  if (!choices.length) return null;
  const last = choices[choices.length - 1];
  const chosen = choices.find((volume) => volume.number === through) ?? last;
  const whole = chosen === last;
  return (
    <fieldset className="spoiler-range">
      <legend className="spoiler-range-ask">{SPOILER_RANGE.ask}</legend>
      <div className="spoiler-range-shelf">
        {choices.map((volume) => {
          const isLast = volume === last;
          return (
            <label
              key={volume.isbn}
              className={
                "spoiler-range-spine" +
                (volume.number <= chosen.number ? " is-covered" : "") +
                (volume === chosen ? " is-chosen" : "")
              }
            >
              <input
                type="radio"
                className="sr-only"
                name={id}
                checked={volume === chosen}
                onChange={() => onChange(isLast ? undefined : volume.number)}
                aria-label={
                  isLast
                    ? SPOILER_RANGE.whole
                    : SPOILER_RANGE.spine(volume.shown)
                }
              />
              <span className="spoiler-range-number" aria-hidden="true">
                {volume.shown}
              </span>
              {isLast && (
                <span className="spoiler-range-whole" aria-hidden="true">
                  {SPOILER_RANGE.whole}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <p className="spoiler-range-chosen" aria-live="polite">
        {SPOILER_RANGE.chosen(chosen.shown, whole)}
      </p>
    </fieldset>
  );
}
