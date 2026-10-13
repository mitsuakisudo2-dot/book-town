"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useAccountState } from "../lib/account-session";
import {
  journalOwner,
  libraryJournal,
  refusedItems,
  retryRefused,
  sendJournal,
  useJournal,
  useJournalSending,
  waitingForTitle,
  type ScanItem,
} from "../lib/library-journal";
import { journalTown, useTownBackend } from "../lib/store";
import type { Notify } from "../lib/types";
import { Modal } from "./ui";

// The 登録 tab's lines about books kept on this device by the scanner:
// titles still to be typed (書名待ち), and books the database refused. Each
// line shows only while it has a book (no 0).

function useOwner() {
  return journalOwner(useAccountState(), useTownBackend());
}

/** Puts items taken out of the journal back, from the toast. */
function undoRemove(owner: string, items: ScanItem[], notify: Notify) {
  return {
    label: "元に戻す",
    run: () => {
      libraryJournal.restore(owner, items);
      notify("控えに戻しました");
    },
  };
}

export function JournalNotes({
  notify,
  onTypeTitles,
}: {
  notify: Notify;
  onTypeTitles: () => void;
}) {
  const owner = useOwner();
  const items = useJournal(owner);
  // A book whose title openBD is answering now (the scanner just closed) is
  // not counted until it has answered.
  const waiting = waitingForTitle(items, useJournalSending());
  const refused = refusedItems(items);
  if (!owner || (!waiting.length && !refused.length)) return null;

  async function retry() {
    if (!owner) return;
    const sent = await retryRefused(libraryJournal, owner, journalTown);
    const added = sent.filter((entry) => entry.result === "added").length;
    if (added) notify(`${added}冊を登録しました`);
    else if (sent.some((entry) => entry.result === "waiting"))
      notify(
        "まだ保存できません。読み込みが終わってから、もう一度押してください",
      );
  }
  function discard() {
    if (!owner) return;
    libraryJournal.remove(
      owner,
      refused.map((item) => item.id),
    );
    notify(
      `${refused.length}冊を控えから外しました`,
      undoRemove(owner, refused, notify),
    );
  }

  return (
    <div className="journal-notes">
      {waiting.length > 0 && (
        <div className="journal-note">
          <p>
            <b>書名待ち {waiting.length}冊</b>
            <small>書名がわからなかった本です。書名を入れると登録します</small>
          </p>
          <div className="journal-note-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onTypeTitles}
            >
              書名を入れる
            </button>
          </div>
        </div>
      )}
      {refused.length > 0 && (
        <div className="journal-note">
          <p>
            <b>送れなかった本 {refused.length}冊</b>
            <small>保存できなかった本です</small>
          </p>
          <div className="journal-note-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => void retry()}
            >
              もう一度送る
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={discard}
            >
              捨てる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 「書名を入れる」: a title (and an author) for each book waiting for one. */
export function TitlesToType({
  notify,
  onClose,
}: {
  notify: Notify;
  onClose: () => void;
}) {
  const owner = useOwner();
  const items = useJournal(owner);
  // Newest first.
  const waiting = waitingForTitle(items).reverse();
  // Nothing left to type: the dialog has done its work.
  useEffect(() => {
    if (!waiting.length) onClose();
  }, [waiting.length, onClose]);
  return (
    <Modal title="書名を入れる" onClose={onClose}>
      {owner &&
        waiting.map((item) => (
          <TitleForm key={item.id} item={item} owner={owner} notify={notify} />
        ))}
    </Modal>
  );
}

function TitleForm({
  item,
  owner,
  notify,
}: {
  item: ScanItem;
  owner: string;
  notify: Notify;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const read = new Date(item.at);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = title.trim();
    if (!typed) return;
    libraryJournal.update(owner, item.id, {
      title: typed,
      author: author.trim(),
      state: "ready",
    });
    const sent = await sendJournal(libraryJournal, owner, journalTown, {
      only: [item.id],
    });
    const done = sent.find((entry) => entry.item.id === item.id);
    const name = done?.item.title ?? typed;
    notify(
      done?.result === "added"
        ? `『${name}』を登録しました`
        : done?.result === "already"
          ? `『${name}』はもうライブラリにあります`
          : done?.result === "unavailable"
            ? `『${name}』は端末に控えました。ページを読み込み直すと登録します`
            : `『${name}』は、読み込みが終わったら登録します`,
    );
  }
  function leave() {
    libraryJournal.remove(owner, [item.id]);
    notify("控えから外しました", undoRemove(owner, [item], notify));
  }

  return (
    <form className="journal-title-form" onSubmit={register}>
      <p className="journal-title-about">
        <b>ISBN {item.isbn}</b>
        <small>
          {read.getMonth() + 1}月{read.getDate()}日に読んだ本
        </small>
      </p>
      <label className="form-label" htmlFor={id + "-title"}>
        タイトル
        <input
          id={id + "-title"}
          className="field"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="form-label" htmlFor={id + "-author"}>
        著者
        <input
          id={id + "-author"}
          className="field"
          maxLength={200}
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
      </label>
      <div className="journal-note-actions">
        <button type="submit" className="button" disabled={!title.trim()}>
          登録する
        </button>
        <button type="button" className="button secondary" onClick={leave}>
          控えから外す
        </button>
      </div>
    </form>
  );
}
