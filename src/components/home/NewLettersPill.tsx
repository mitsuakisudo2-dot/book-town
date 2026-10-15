"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Reader } from "../../lib/types";

/**
 * 「新しい便り ↑」 (決定 H:120-122, v37 §3.8): new 便り came and wait above.
 * Up to two of their writers' faces; a tap takes them in at the top. It is
 * 34px tall, and takes a finger 44px across.
 */
export function NewLettersPill({
  writers,
  onTap,
  onFocusChange,
  onGone,
}: {
  writers: Reader[];
  onTap: () => void;
  /** Whether it has the focus. */
  onFocusChange: (focused: boolean) => void;
  /** It goes away with the focus on it: where the focus goes instead. */
  onGone: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  // Run before the button leaves the page, while it still has the focus.
  useLayoutEffect(() => {
    const element = button.current;
    return () => {
      if (element && document.activeElement === element) gone.current();
    };
  }, []);
  return (
    <button
      ref={button}
      type="button"
      className="home-new"
      aria-label="新しい便りを見る"
      onClick={onTap}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
    >
      {writers.length > 0 && (
        <span className="home-new-faces" aria-hidden="true">
          {writers.slice(0, 2).map((writer) => (
            <span
              key={writer.id}
              className="home-new-face"
              // A pale wash of the writer's colour, so the initial reads.
              style={{ "--face": writer.color } as CSSProperties}
            >
              {writer.name.slice(0, 1)}
            </span>
          ))}
        </span>
      )}
      <span>新しい便り</span>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    </button>
  );
}
