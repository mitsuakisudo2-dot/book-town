"use client";

import { useEffect, useRef, useState } from "react";
import { likeTapOutcome } from "../../lib/letter";
import { announce } from "../../lib/live-region";
import { tapsOf } from "../../lib/social";
import type { Notify, TownActions, TownState } from "../../lib/types";
import { Modal } from "../ui";
import { LetterIcon } from "./icons";
import { counted } from "../../lib/words";
import { memoOffer, MET_TOAST } from "../../lib/encounter-memo";

/** How long 「n回」 shows above the heart. */
const PILL_FOR = 1000;
/** After the last tap, the wait before a first いいね offers its memo. */
const OFFER_AFTER = 1000;

/**
 * いいね (仮): each tap adds one, up to ten. The heart pops and 「n回」 shows
 * above it for a moment; at rest no count is shown to anyone. The tap after
 * the tenth asks whether to take the いいね back (`onAsk`). The first, which
 * meets the post's book, offers a memo once the tapping stops (押したときの
 * メモ): one toast however many taps.
 */
export function LikeButton({
  state,
  actions,
  notify,
  postId,
  onAsk,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
  postId: string;
  onAsk: () => void;
}) {
  const taps = tapsOf(state, postId);
  const [pill, setPill] = useState<{ key: number; taps: number } | null>(null);
  const made = useRef(0);
  const offer = useRef<{ run: () => void; timer: number } | null>(null);
  useEffect(() => {
    if (!pill) return;
    const timer = setTimeout(() => setPill(null), PILL_FOR);
    return () => clearTimeout(timer);
  }, [pill]);
  // Said even when the card is gone from the screen meanwhile.
  useEffect(
    () => () => {
      if (!offer.current) return;
      clearTimeout(offer.current.timer);
      offer.current.run();
    },
    [],
  );
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
        const met = memoOffer(state, actions);
        const waiting = offer.current;
        if (met || waiting) {
          if (waiting) clearTimeout(waiting.timer);
          const run = met
            ? () => {
                offer.current = null;
                notify(MET_TOAST.liked, met);
              }
            : waiting!.run;
          offer.current = { run, timer: window.setTimeout(run, OFFER_AFTER) };
        }
        made.current += 1;
        setPill({ key: made.current, taps: now });
        announce(`いいね ${counted(now, "回")}`);
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
          {counted(pill.taps, "回")}
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
          className="btn fill"
          onClick={() => {
            actions.toggleLike(postId);
            notify("いいねを取り消しました");
            onClose();
          }}
        >
          取り消す
        </button>
        <button type="button" className="btn" onClick={onClose}>
          そのまま
        </button>
      </div>
    </Modal>
  );
}
