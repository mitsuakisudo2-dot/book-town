"use client";

import { useEffect, useRef, useState } from "react";
import { likeTapOutcome } from "../../lib/letter";
import { announce } from "../../lib/live-region";
import { tapsOf } from "../../lib/social";
import type { Notify, TownActions, TownState } from "../../lib/types";
import { Modal } from "../ui";
import { LetterIcon } from "./icons";

/** How long 「n回」 shows above the heart. */
const PILL_FOR = 1000;

/**
 * いいね (仮): each tap adds one, up to ten. The heart pops and 「n回」 shows
 * above it for a moment; at rest no count is shown to anyone. The tap after
 * the tenth asks whether to take the いいね back (`onAsk`).
 */
export function LikeButton({
  state,
  actions,
  postId,
  onAsk,
}: {
  state: TownState;
  actions: TownActions;
  postId: string;
  onAsk: () => void;
}) {
  const taps = tapsOf(state, postId);
  const [pill, setPill] = useState<{ key: number; taps: number } | null>(null);
  const made = useRef(0);
  useEffect(() => {
    if (!pill) return;
    const timer = setTimeout(() => setPill(null), PILL_FOR);
    return () => clearTimeout(timer);
  }, [pill]);
  return (
    <button
      type="button"
      className={"letter-act letter-like" + (taps ? " is-on" : "")}
      aria-pressed={taps > 0}
      onClick={() => {
        if (likeTapOutcome(taps) === "confirm") {
          onAsk();
          return;
        }
        // Refused (a 見本, or a visitor asked to sign in): nothing shows.
        const now: unknown = actions.tapLike(postId);
        if (typeof now !== "number" || now <= taps) return;
        made.current += 1;
        setPill({ key: made.current, taps: now });
        announce(`いいね ${now}回`);
      }}
    >
      <span
        key={pill?.key ?? 0}
        className={"letter-heart" + (pill ? " is-popping" : "")}
      >
        <LetterIcon name="like" filled={taps > 0} />
      </span>
      <span className="sr-only">いいね</span>
      {pill && (
        <span key={pill.key} className="letter-like-pill" aria-hidden="true">
          {pill.taps}回
        </span>
      )}
    </button>
  );
}

/** Past ten: take the いいね back, or leave it. */
export function LikeUndo({
  actions,
  notify,
  postId,
  onClose,
}: {
  actions: TownActions;
  notify: Notify;
  postId: string;
  onClose: () => void;
}) {
  return (
    <Modal title="いいねを取り消しますか" onClose={onClose}>
      <div className="letter-confirm">
        <button
          type="button"
          className="button"
          onClick={() => {
            actions.toggleLike(postId);
            notify("いいねを取り消しました");
            onClose();
          }}
        >
          取り消す
        </button>
        <button type="button" className="button secondary" onClick={onClose}>
          そのまま
        </button>
      </div>
    </Modal>
  );
}
