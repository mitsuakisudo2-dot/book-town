"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { Notify, TownActions, TownState } from "../lib/types";
import { ENCOUNTER_MEMO_MAX_LENGTH } from "../lib/library";
import { askMemo, useAskedMemo } from "../lib/encounter-memo";
import { memoDraftStore, type MemoWork } from "../lib/encounter-memo-draft";
import { ENCOUNTER_WORDS, encounterLineIn } from "../lib/encounter-words";
import { useKeptDraft } from "../lib/kept-draft";
import { SAVE_REFUSED, useKeptUntilSaved } from "../lib/shop-draft";
import { bookById, quotedTitle } from "../lib/book-name";
import { japanMonthDay } from "../lib/japan-time";
import {
  KeptDraftNote,
  StopConfirm,
  useDraftOwner,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { Modal } from "./ui";
import "./encounter-memo.css";

// 押したときのメモ (いいねと読みたいのメモ, 2026-10-14, 4章): the sheet a
// toast's メモ and a row of 「この本との出会い」 open. Read once a memo is
// first asked for, and kept on the page from then on, so a memo handed to
// the town stays kept in this browser until the account has it too.

type Shared = { state: TownState; actions: TownActions; notify: Notify };

export function EncounterMemoHost({ state, actions, notify }: Shared) {
  const asked = useAskedMemo();
  const owner = useDraftOwner();
  const saving = useKeptUntilSaved(() => notify(SAVE_REFUSED));
  const encounter = asked
    ? state.encounters.find((c) => c.id === asked)
    : undefined;
  if (!encounter) return null;
  const close = () => askMemo(null);
  const draftKey = owner ? `${owner}/${encounter.id}` : null;
  const save = (words: string) => {
    const was = encounter.memo;
    if (!actions.writeEncounterMemo(encounter.id, words)) return false;
    if (draftKey)
      saving.hold(
        "memo:" + encounter.id,
        memoDraftStore,
        draftKey,
        { work: { memo: words.trim() }, base: { memo: was ?? "" } },
        "encounters",
      );
    notify(
      words.trim() ? ENCOUNTER_WORDS.memoSaved : ENCOUNTER_WORDS.memoErased,
    );
    return true;
  };
  const sheet = (
    <MemoSheet
      key={encounter.id}
      state={state}
      encounterId={encounter.id}
      draftKey={draftKey}
      onClose={close}
      onSave={save}
    />
  );
  // Asked from a book in hand (a native <dialog>, in the browser's top
  // layer), the sheet is drawn inside it: anywhere else it would be beneath.
  const inHand = document.querySelector(".town-shell dialog[open]");
  return inHand ? createPortal(sheet, inHand) : sheet;
}

function MemoSheet({
  state,
  encounterId,
  draftKey,
  onClose,
  onSave,
}: {
  state: TownState;
  encounterId: string;
  draftKey: string | null;
  onClose: () => void;
  /** False when nothing changed. */
  onSave: (words: string) => boolean;
}) {
  const c = state.encounters.find((entry) => entry.id === encounterId)!;
  const saved: MemoWork = { memo: c.memo ?? "" };
  const kept = useKeptDraft(memoDraftStore, draftKey);
  const continuing = useOpenedWithWork(kept.loaded, kept.draft !== null);
  const work = kept.draft?.work ?? saved;
  const [stopping, setStopping] = useState(false);
  const length = [...work.memo.trim()].length;
  const tooLong = length > ENCOUNTER_MEMO_MAX_LENGTH;
  const changed = work.memo.trim() !== saved.memo;
  const book = bookById(state.books, c.bookId);
  const write = (memo: string) =>
    kept.set(memo === saved.memo ? null : { work: { memo }, base: saved });
  const finish = (words: string) => {
    if (onSave(words) || !changed) {
      kept.clear();
      onClose();
    }
  };
  return (
    <Modal
      title={ENCOUNTER_WORDS.memoTitle}
      onClose={onClose}
      writing
      compact
    >
      <form
        className="encounter-memo"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooLong) finish(work.memo);
        }}
      >
        <p className="encounter-memo-where">
          {book && <strong>{quotedTitle(book)}</strong>}{" "}
          {japanMonthDay(c.createdAt)}・{encounterLineIn(state, c)}
        </p>
        <textarea
          className="field"
          rows={2}
          value={work.memo}
          aria-label={ENCOUNTER_WORDS.memoLabel}
          placeholder={ENCOUNTER_WORDS.memoLabel}
          onChange={(event) => write(event.target.value)}
          aria-invalid={tooLong || undefined}
        />
        {tooLong && (
          <p className="profile-link-error" role="alert">
            {ENCOUNTER_WORDS.memoTooLong(ENCOUNTER_MEMO_MAX_LENGTH)}
          </p>
        )}
        <KeptDraftNote
          continuing={continuing && kept.draft !== null}
          saved={kept.saved}
          wordsLost={work.memo.trim() !== ""}
          onDiscard={kept.clear}
        />
        {stopping ? (
          <StopConfirm
            onDiscard={() => {
              kept.clear();
              onClose();
            }}
            onKeep={onClose}
          />
        ) : (
          <div className="encounter-memo-actions writing-toolbar">
            <button
              className="btn fill"
              type="submit"
              disabled={tooLong || !work.memo.trim() || !changed}
            >
              {ENCOUNTER_WORDS.memoSave}
            </button>
            {c.memo && (
              <button
                type="button"
                className="btn quiet"
                onClick={() => finish("")}
              >
                {ENCOUNTER_WORDS.memoErase}
              </button>
            )}
            <button
              type="button"
              className="btn quiet"
              onClick={() =>
                kept.draft && work.memo.trim()
                  ? setStopping(true)
                  : (kept.clear(), onClose())
              }
            >
              やめる
            </button>
            <span className="muted encounter-memo-note">
              {ENCOUNTER_WORDS.memoNote}
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
}
