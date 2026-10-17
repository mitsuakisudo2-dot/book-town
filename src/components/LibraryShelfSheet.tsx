"use client";

import { useId, useRef, useState } from "react";
import { focusField } from "../lib/coarse-pointer";
import { useKeptDraft } from "../lib/kept-draft";
import type { LibraryShelf } from "../lib/library";
import {
  libraryShelfDraftStore,
  NEW_SHELF,
  sameShelfWork,
  shelfLosesWords,
  type LibraryShelfWork,
} from "../lib/library-shelf-draft";
import { overSaved } from "../lib/shop-draft";
import {
  LIBRARY_SHELF_NAME_MAX_LENGTH,
  LIBRARY_SHELF_NOTE_MAX_LENGTH,
} from "../lib/types";
import {
  KeptDraftNote,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { Modal } from "./ui";

// Making a shelf of the reader's own in the library, or changing one: its
// name, a note on what it gathers, and, for one already made, whether it
// shows the books only wanted, and taking it away. The words are kept in
// this browser while they are written (library-shelf-draft.ts); the library
// lets them go once the town has them saved.

export function LibraryShelfSheet({
  shelf,
  draftKey,
  onClose,
  onSave,
  onPutAway,
}: {
  /** The shelf being changed; null while one is being made. */
  shelf: LibraryShelf | null;
  /** Where the words are kept (owner/new or owner/shelf id); null while the owner is not known. */
  draftKey: string | null;
  onClose: () => void;
  /** False when the town did not take it: the sheet stays open on the words. */
  onSave: (work: LibraryShelfWork, showWanted: boolean) => boolean;
  onPutAway?: () => void;
}) {
  const id = useId();
  const kept = useKeptDraft(libraryShelfDraftStore, draftKey);
  const saved: LibraryShelfWork = shelf
    ? { name: shelf.name, note: shelf.note }
    : NEW_SHELF;
  const work = overSaved(kept.draft, saved);
  const { name, note } = work ?? saved;
  const continuing = useOpenedWithWork(kept.loaded, work !== null);
  const [showWanted, setShowWanted] = useState(shelf?.showWanted ?? true);
  const [refused, setRefused] = useState(false);
  const notTaken = useNotTakenWords();
  const nameField = useRef<HTMLInputElement>(null);

  function change(patch: Partial<LibraryShelfWork>) {
    setRefused(false);
    const next = { ...(work ?? saved), ...patch };
    kept.set(sameShelfWork(next, saved) ? null : { work: next, base: saved });
  }

  return (
    <Modal title={shelf ? "棚を編集" : "棚を作る"} onClose={onClose}>
      <form
        className="library-shelf-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          if (
            shelf &&
            sameShelfWork({ name: name.trim(), note: note.trim() }, saved) &&
            showWanted === shelf.showWanted
          )
            return onClose();
          if (!onSave({ name: name.trim(), note: note.trim() }, showWanted))
            setRefused(true);
        }}
      >
        <KeptDraftNote
          work={work !== null}
          continuing={continuing}
          saved={kept.saved}
          wordsLost={work !== null && shelfLosesWords(work, saved)}
          onDiscard={() => {
            kept.clear();
            setRefused(false);
            focusField(nameField.current);
          }}
        />
        {!shelf && (
          <p className="library-note">
            1冊の本を、いくつの棚に入れてもかまいません。読了や積読の分け方はそのまま残ります。
          </p>
        )}
        <label className="form-label" htmlFor={id + "-name"}>
          棚の名前
          <input
            id={id + "-name"}
            ref={nameField}
            className="field"
            required
            maxLength={LIBRARY_SHELF_NAME_MAX_LENGTH}
            placeholder="例：雨の日に読みたい"
            value={name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <label className="form-label" htmlFor={id + "-note"}>
          どんな棚か（なくてもかまいません）
          <textarea
            id={id + "-note"}
            className="field"
            rows={3}
            maxLength={LIBRARY_SHELF_NOTE_MAX_LENGTH}
            value={note}
            onChange={(event) => change({ note: event.target.value })}
          />
        </label>
        {shelf && (
          <label className="library-shelf-check">
            <input
              type="checkbox"
              checked={showWanted}
              onChange={(event) => {
                setRefused(false);
                setShowWanted(event.target.checked);
              }}
            />
            まだ読んでいない「読みたい」だけの本も並べる
          </label>
        )}
        {refused && (
          <p className="library-note" role="alert">
            {notTaken}
          </p>
        )}
        <div className="btns">
          <button type="submit" className="btn fill" disabled={!name.trim()}>
            {shelf ? "保存する" : "作る"}
          </button>
          {shelf && onPutAway && (
            <button type="button" className="btn quiet" onClick={onPutAway}>
              この棚を消す
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
