"use client";

import { useEffect, useRef } from "react";
import { afterLayerCloses, useBackLayer } from "../lib/back-layer";
import { SCAN_COPY } from "../lib/scan";
import { Icon } from "./ui";

// 完了 (Figma v4's 08): what this time came to, over the scanner with the
// camera off. The books whose saving is confirmed, those still on their
// way (the count goes on as they land), and those that wait for the
// reader; never a 0. 戻る and Escape go back to scanning.

const COPY = SCAN_COPY.done;

export function ScanDone({
  saved,
  checking,
  attention,
  sortEnded,
  onLibrary,
  onTime,
  onClose,
  onBack,
}: {
  saved: number;
  checking: number;
  attention: number;
  /** A 連続設定 was on: it ends with this time. */
  sortEnded: boolean;
  onLibrary: () => void;
  /** この回の本を見る: the library, narrowed to this time's books. */
  onTime: () => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const layer = useBackLayer(onBack);
  // Its step comes off the history first, so that one 戻る from the
  // library leaves the page.
  const leave = (then: () => void) => {
    layer.close();
    afterLayerCloses(then);
  };
  const first = useRef<HTMLButtonElement>(null);
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);
  useEffect(() => {
    first.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      backRef.current();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const lines = [
    checking > 0
      ? COPY.checking(checking)
      : attention === 0 && saved > 0
        ? COPY.allSaved
        : "",
    attention > 0 ? COPY.attention(attention) : "",
  ].filter(Boolean);

  return (
    <div className="scan-done" role="region" aria-label={COPY.name}>
      <h2 className="scan-done-name">{COPY.name}</h2>
      <div className="scan-done-body" aria-live="polite">
        <span className="scan-done-mark" aria-hidden="true">
          <Icon name="check" size={32} />
        </span>
        {saved > 0 && (
          <p className="scan-done-count">
            <strong>{saved}</strong>
            {COPY.counted}
          </p>
        )}
        {lines.map((line) => (
          <p key={line} className="scan-done-line">
            {line}
          </p>
        ))}
        {sortEnded && <p className="scan-done-note">{COPY.sortEnded}</p>}
      </div>
      <div className="scan-done-foot">
        <button
          ref={first}
          type="button"
          className="btn fill"
          onClick={() => leave(onLibrary)}
        >
          {COPY.library}
        </button>
        {saved > 0 && (
          <button type="button" className="btn" onClick={() => leave(onTime)}>
            {COPY.time}
          </button>
        )}
        <button
          type="button"
          className="text-btn"
          onClick={() => leave(onClose)}
        >
          {COPY.close}
        </button>
      </div>
    </div>
  );
}
