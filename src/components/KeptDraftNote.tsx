"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccountState } from "../lib/account-session";
import { draftOwner } from "../lib/draft-owner";
import { usePersistenceStatus, useTownBackend } from "../lib/store";
import "./kept-draft.css";

// What a reader writes or arranges is kept in this browser (src/lib/
// kept-draft.ts) until the save is confirmed or the reader throws it away.
// Every screen that keeps work tells it with the same quiet line and asks
// the same question before throwing it away: 書きかけを消しますか？ 消す／残す.

/**
 * Whether a screen opened with work kept from before, and it is still there.
 * Decided when the browser's storage has been read, so the first render
 * matches the static page; work begun on this screen does not count, nor
 * does new work after the kept work was sent or thrown away.
 */
export function useOpenedWithWork(loaded: boolean, kept: boolean): boolean {
  const [opened, setOpened] = useState<boolean | null>(null);
  if (loaded && opened === null) setOpened(kept);
  else if (opened === true && loaded && !kept) setOpened(false);
  return opened === true;
}

/** Whose work this browser keeps now (see draftOwner). */
export function useDraftOwner(): string | null {
  return draftOwner(useAccountState());
}

/**
 * What to say when the town did not take what the reader wrote, which the
 * screen keeps. A visitor's invitation to sign in, or a 見本 turning a reply
 * away, already says why: those words are not shown over it.
 */
export function useNotTakenWords(noun: "下書き" | "書きかけ" = "書きかけ") {
  const persistence = usePersistenceStatus();
  const savedIn = useTownBackend();
  if (persistence === "loading")
    return `街を読み込んでいます。${noun}はそのまま残しています`;
  if (savedIn === "unavailable")
    return `いまは保存できません。${noun}はそのまま残しています`;
  return `保存できませんでした。${noun}はそのまま残しています`;
}

/**
 * The one way to throw kept work away, in the same words on every screen;
 * asked once when words written would be lost.
 */
export function DiscardDraft({
  wordsLost,
  onDiscard,
}: {
  /** Whether throwing the work away loses words written. */
  wordsLost: boolean;
  onDiscard: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const discard = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  // The focus goes to the answer that keeps the work, and back after it.
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (wasAsking.current) discard.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  return asking ? (
    <span className="kept-note-confirm">
      書きかけを消しますか？
      <button
        type="button"
        onClick={() => {
          wasAsking.current = false;
          setAsking(false);
          onDiscard();
        }}
      >
        消す
      </button>
      <button type="button" ref={keep} onClick={() => setAsking(false)}>
        残す
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="kept-note-button"
      ref={discard}
      onClick={() => (wordsLost ? setAsking(true) : onDiscard())}
    >
      書きかけを消す
    </button>
  );
}

/**
 * The one quiet line under work kept in this browser, in the same words on
 * every screen: that the reader is continuing it, with the way to throw it
 * away, or that the browser would not keep it.
 */
export function KeptDraftNote({
  continuing,
  saved,
  wordsLost,
  onDiscard,
  work = true,
  lead = "書きかけを続けています",
  action,
  className,
}: {
  /** The screen opened with work kept from before, and it is still there. */
  continuing: boolean;
  /** False when the browser would not store the work. */
  saved: boolean;
  /** Whether throwing the work away loses words written. */
  wordsLost: boolean;
  onDiscard: () => void;
  /** There is work in hand at all; without it nothing is said. */
  work?: boolean;
  /** The words for kept work, when a screen has more to say about it. */
  lead?: ReactNode;
  /** A step on from the kept work, before the way to throw it away. */
  action?: ReactNode;
  /** Where the line sits on its screen. */
  className?: string;
}) {
  if (!work || (saved && !continuing)) return null;
  return (
    <p className={className ? "kept-note " + className : "kept-note"}>
      {continuing && <span>{lead}</span>}
      {!saved && (
        <span role="status">このブラウザに書きかけを残せませんでした</span>
      )}
      {continuing && action}
      {continuing && (
        <DiscardDraft wordsLost={wordsLost} onDiscard={onDiscard} />
      )}
    </p>
  );
}

/**
 * Asked once when a reader stops (やめる, キャンセル) with words written: throw
 * the work away, or keep it for the next time. Either way the screen closes,
 * as the reader asked.
 */
export function StopConfirm({
  onDiscard,
  onKeep,
  className,
}: {
  onDiscard: () => void;
  onKeep: () => void;
  /** Where the question sits on its screen. */
  className?: string;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <p
      className={
        "kept-note kept-note-confirm" + (className ? " " + className : "")
      }
    >
      書きかけを消しますか？
      <button type="button" onClick={onDiscard}>
        消す
      </button>
      <button type="button" ref={keep} onClick={onKeep}>
        残す
      </button>
    </p>
  );
}
