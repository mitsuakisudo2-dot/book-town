"use client";
import { useState, type ReactNode } from "react";
import { blockedReaders } from "../lib/blocks";
import { isDatabaseId } from "../lib/record-kind";
import { useTownBackend } from "../lib/store";
import type { Notify, Reader, TownActions, TownState } from "../lib/types";
import { requestAccount } from "../lib/visitor";
import { Modal, ReaderAvatar } from "./ui";
import "./block.css";

// Blocking a reader (管理表43): asked once, then done at once. The database
// keeps the two apart both ways (docs/09「ブロックは双方向に効く」); the
// reader who blocked lifts it from the other's profile or from 設定.

/** Whether this page offers ブロック for the reader: someone in the database, with an account to keep it (a visitor is asked to sign in). */
export function useBlockable(reader: Pick<Reader, "id"> | undefined) {
  const savedIn = useTownBackend();
  return (
    reader !== undefined &&
    isDatabaseId(reader.id) &&
    (savedIn === "account" || savedIn === "visitor")
  );
}

/** The question and its two answers, for a sheet of its own or one already open. */
export function BlockQuestion({
  reader,
  actions,
  notify,
  onDone,
  onCancel,
}: {
  reader: Pick<Reader, "id" | "name">;
  actions: TownActions;
  notify: Notify;
  /** After blocking (the sheet closes). */
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="block-question" role="group" aria-label="ブロック">
      <p className="block-question-title">
        {reader.name}さんをブロックしますか？
      </p>
      <p className="block-question-words">
        お互いの本屋・投稿・記録・ポスターが見えなくなり、フォローも外れます。相手には知らされません。あとで設定から外せます。
      </p>
      <div className="btns">
        <button
          type="button"
          className="btn danger fill"
          onClick={() => {
            onDone();
            // Said only when it was done: never a block that did not happen.
            if (actions.blockReader(reader.id))
              notify(`${reader.name}さんをブロックしました`);
            else
              notify(
                "ブロックできませんでした。少し待ってから、もう一度お試しください",
              );
          }}
        >
          ブロックする
        </button>
        {/* The safe answer waits under the finger. */}
        <button
          type="button"
          className="btn quiet"
          autoFocus
          onClick={onCancel}
        >
          やめる
        </button>
      </div>
    </div>
  );
}

/** A quiet ブロック beside 通報, asking first. Nothing for a 見本 or the demo. */
export function BlockButton({
  reader,
  actions,
  notify,
  className = "block-link",
  children = "ブロック",
}: {
  reader: Pick<Reader, "id" | "name">;
  actions: TownActions;
  notify: Notify;
  className?: string;
  children?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const savedIn = useTownBackend();
  if (!useBlockable(reader)) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() =>
          savedIn === "visitor" ? requestAccount() : setAsking(true)
        }
      >
        {children}
      </button>
      {asking && (
        <Modal title="ブロック" onClose={() => setAsking(false)}>
          <BlockQuestion
            reader={reader}
            actions={actions}
            notify={notify}
            onDone={() => setAsking(false)}
            onCancel={() => setAsking(false)}
          />
        </Modal>
      )}
    </>
  );
}

const liftedWords = (name: string) =>
  `${name}さんのブロックを解除しました。本屋や投稿は、次にBookTownを開いたときから見えます`;

/** Lifts a block, with a way back in the toast (a slip of the finger). */
function lift(
  reader: Pick<Reader, "id" | "name">,
  actions: TownActions,
  notify: Notify,
) {
  actions.unblockReader(reader.id);
  notify(liftedWords(reader.name), {
    label: "元に戻す",
    run: () => actions.blockReader(reader.id),
  });
}

/** On a blocked reader's profile, in place of what the block keeps away. */
export function BlockedNote({
  reader,
  actions,
  notify,
}: {
  reader: Pick<Reader, "id" | "name">;
  actions: TownActions;
  notify: Notify;
}) {
  return (
    <div className="blocked-note" role="note">
      <p>
        ブロックしています。お互いの本屋・投稿・記録・ポスターは見えません。
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => lift(reader, actions, notify)}
      >
        ブロックを解除
      </button>
    </div>
  );
}

/** 設定「ブロックした読書家」: there only while someone is blocked. */
export function BlockedList({
  state,
  actions,
  notify,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
}) {
  const readers = blockedReaders(state);
  if (!readers.length) return null;
  return (
    <fieldset className="blocked-list">
      <legend>ブロックした読書家</legend>
      <ul>
        {readers.map((reader) => (
          <li key={reader.id}>
            <span className="blocked-list-who">
              <ReaderAvatar reader={reader} size={36} />
              <span>
                <b>{reader.name}</b>
                <small>@{reader.handle}</small>
              </span>
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => lift(reader, actions, notify)}
            >
              解除
            </button>
          </li>
        ))}
      </ul>
      <p className="blocked-list-note">相手には知らされません。</p>
    </fieldset>
  );
}
