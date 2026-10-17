"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { foldsAt, linesOf } from "../../lib/letter";
import { PostText } from "../Social";

/**
 * Whether a post's words are long enough to fold (letter.ts: over eight
 * lines, folded to six). Measured as the words' height over their line
 * height, before the card is first drawn, and again when the column's width
 * or the font changes (a font arriving late changes where lines break).
 *
 * A change found while the card is above the screen waits until the card is
 * on the screen again: folding or unfolding it there would move the words
 * being read, and Safari does not hold their place.
 */
export function useLineFold(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const text = ref.current;
    if (!enabled || !text) {
      setLong(false);
      return;
    }
    const measure = () =>
      foldsAt(
        linesOf(
          text.scrollHeight,
          parseFloat(getComputedStyle(text).lineHeight),
        ),
      );
    setLong(measure());
    let waiting: boolean | null = null;
    const again = () => {
      const next = measure();
      if (text.getBoundingClientRect().bottom <= 0) {
        waiting = next;
        return;
      }
      waiting = null;
      setLong(next);
    };
    const resized = new ResizeObserver(again);
    resized.observe(text);
    const shown = new IntersectionObserver((entries) => {
      if (waiting === null || !entries.some((entry) => entry.isIntersecting))
        return;
      setLong(waiting);
      waiting = null;
    });
    shown.observe(text);
    const fonts = document.fonts;
    fonts?.addEventListener("loadingdone", again);
    return () => {
      resized.disconnect();
      shown.disconnect();
      fonts?.removeEventListener("loadingdone", again);
    };
  }, [ref, enabled]);
  return long;
}

/**
 * A post's words on its card: today's PostText (#tags that lead to their
 * posts, covered words that open with a tap), folded to six lines with a
 * fade when long, and 「続きを読む」 to open them where they are.
 */
export function LetterText({
  id,
  body,
  textRef,
  long,
  open,
  onToggle,
}: {
  id: string;
  body: string;
  textRef: RefObject<HTMLDivElement | null>;
  long: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const folded = long && !open;
  return (
    <>
      <div
        ref={textRef}
        id={id}
        className={"letter-text" + (folded ? " is-folded" : "")}
        tabIndex={-1}
      >
        <PostText body={body} />
      </div>
      {long && (
        <button
          type="button"
          className="text-btn letter-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          {open ? "たたむ" : "続きを読む"}
        </button>
      )}
    </>
  );
}
