"use client";

import { useState } from "react";
import { hasReplies } from "../../lib/social";
import type { Notify, Post, TownActions, TownState } from "../../lib/types";
import { BlockQuestion } from "../BlockReader";
import { ReportButton } from "../Report";
import { useTownBackend } from "../../lib/store";
import { requestAccount } from "../../lib/visitor";
import { Modal } from "../ui";

/** What 「…」 offers on a 便り, for this reader. */
export type LetterMenuRows = {
  /** いいねを取り消す */
  unlike: boolean;
  /** ネタバレでは？ or, once asked, 報告を取り消す */
  spoiler: boolean;
  /** この投稿を通報 (only what the database holds can be reported) */
  report: boolean;
  /** 削除する, for the writer */
  remove: boolean;
  /** 〇〇さんをブロック (only a reader in the database, with an account) */
  block?: boolean;
};

export const hasMenuRows = (rows: LetterMenuRows): boolean =>
  rows.unlike || rows.spoiler || rows.report || rows.remove || !!rows.block;

/**
 * The sheet 「…」 opens: the quieter things to do with a 便り, each a row
 * of its own, out of sight of whoever wrote it.
 */
export function LetterMenu({
  state,
  actions,
  notify,
  post,
  authorName,
  rows,
  onClose,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
  post: Post;
  authorName: string;
  rows: LetterMenuRows;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const savedIn = useTownBackend();
  const reported = state.spoilerReports.includes(post.id);
  if (blocking)
    return (
      <Modal title="その他の操作" onClose={onClose}>
        <BlockQuestion
          reader={{ id: post.authorId, name: authorName }}
          actions={actions}
          notify={notify}
          onDone={onClose}
          onCancel={() => setBlocking(false)}
        />
      </Modal>
    );
  if (deleting)
    return (
      <Modal title="その他の操作" onClose={onClose}>
        <div className="letter-menu" role="group" aria-label="投稿の削除">
          <p className="letter-menu-question">
            {hasReplies(state, post.id)
              ? "この投稿と返信を削除しますか？"
              : "この投稿を削除しますか？"}
          </p>
          <div className="letter-confirm">
            <button
              type="button"
              className="btn fill"
              onClick={() => {
                onClose();
                actions.deletePost(post.id);
                notify("投稿を削除しました");
              }}
            >
              削除する
            </button>
            {/* The row pressed is gone: the focus waits on the safe answer. */}
            <button
              type="button"
              className="btn"
              autoFocus
              onClick={() => setDeleting(false)}
            >
              やめる
            </button>
          </div>
        </div>
      </Modal>
    );
  return (
    <Modal title="その他の操作" onClose={onClose}>
      <div className="letter-menu">
        {rows.unlike && (
          <button
            type="button"
            onClick={() => {
              onClose();
              actions.toggleLike(post.id);
              notify("いいねを取り消しました");
            }}
          >
            いいねを取り消す
          </button>
        )}
        {rows.spoiler && (
          <button
            type="button"
            onClick={() => {
              onClose();
              actions.toggleSpoilerReport(post.id);
              notify(
                reported
                  ? "ネタバレの報告を取り消しました"
                  : "ネタバレの可能性を報告しました。あなたの画面では隠します",
              );
            }}
          >
            {reported ? "報告を取り消す" : "ネタバレでは？"}
          </button>
        )}
        {rows.report && (
          <ReportButton
            className=""
            onOpen={onClose}
            target={{
              kind: "post",
              id: post.id,
              name: authorName + "さんの投稿",
            }}
          >
            この投稿を通報
          </ReportButton>
        )}
        {rows.block && (
          <button
            type="button"
            className="is-alert"
            onClick={() => {
              if (savedIn !== "visitor") return setBlocking(true);
              onClose();
              requestAccount();
            }}
          >
            {authorName}さんをブロック
          </button>
        )}
        {rows.remove && (
          <button
            type="button"
            className="is-alert"
            onClick={() => setDeleting(true)}
          >
            削除する
          </button>
        )}
      </div>
    </Modal>
  );
}
