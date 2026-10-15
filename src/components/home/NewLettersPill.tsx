"use client";

import type { Reader } from "../../lib/types";

/**
 * 「新しい便り ↑」 (決定 H:120-122, v37 §3.8): new 便り came and wait above.
 * Up to two of their writers' faces; a tap takes them in at the top. It is
 * 34px tall, and takes a finger 44px across.
 */
export function NewLettersPill({
  writers,
  onTap,
}: {
  writers: Reader[];
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      className="home-new"
      aria-label="新しい便りを見る"
      onClick={onTap}
    >
      {writers.length > 0 && (
        <span className="home-new-faces" aria-hidden="true">
          {writers.slice(0, 2).map((writer) => (
            <span
              key={writer.id}
              className="home-new-face"
              style={{ background: writer.color }}
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
