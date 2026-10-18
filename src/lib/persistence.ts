import type { TownBackend } from "./town-backend";
import type { PersistenceStatus } from "./types";
import { failure, WHILE_OFFLINE } from "./words";

type Where = TownBackend["kind"];

/** The shop editor's line about where the shelves are saved. */
export function shelfSaveMessage(where: Where, status: PersistenceStatus) {
  if (where === "local")
    return {
      saved: "棚の変更は、このブラウザに保存済みです。",
      saving: "棚の変更は、このブラウザに保存済みです。",
      loading: "このブラウザの保存データを読み込んでいます。",
      unavailable: failure({
        what: "ブラウザに保存できません",
        kept: "変更はリロードすると失われる場合があります",
      }),
      recovered: "保存データを読み込めなかったため、初期状態に戻しました。",
    }[status];
  return {
    saved: "棚の変更は、あなたのアカウントに保存済みです。",
    saving: "棚の変更を保存しています…",
    loading: "あなたの書店を読み込んでいます。",
    unavailable: failure(WHILE_OFFLINE),
    recovered: "保存できない変更があったため、保存されている状態に戻しました。",
  }[status];
}

/** The line said when the session ended without the reader pressing ログアウト. */
export function lapsedLine(waiting: boolean): string {
  return failure({
    what: "ログインが切れました",
    kept: waiting
      ? "まだ送れていない変更は、この端末に残しています"
      : undefined,
    next: waiting
      ? "もう一度ログインすると送ります"
      : "続けるには、もう一度ログインしてください",
  });
}

/**
 * The warning above every page, or null when there is nothing to warn about.
 * `missed` tells the changes the database did not take (missed-changes.ts),
 * `lapsed` a sign-in that ended by itself (lapsedLine).
 */
export function saveWarning(
  where: Where,
  status: PersistenceStatus,
  told: { missed?: string | null; lapsed?: string | null } = {},
): string | null {
  if (where === "unavailable")
    return failure({
      what: "アカウントを読み込めませんでした",
      next: "通信の状態を確かめて、ページを読み込み直してください",
    });
  if (where === "visitor")
    return (
      told.lapsed ??
      (status === "unavailable"
        ? failure({
            what: "本の街の新しい様子を読み込めませんでした",
            kept: "いまは見本の書店だけを表示しています",
          })
        : null)
    );
  if (status === "unavailable")
    return where === "local"
      ? failure({
          what: "このブラウザに保存できません",
          next: "ブラウザの保存設定を確認してください。今の操作はページを閉じると失われます",
        })
      : // Changes wait on the device meanwhile (outbox.ts); a page that
        // could not keep them asks before it is closed (supabase/sync.ts).
        failure(WHILE_OFFLINE);
  if (status === "recovered")
    return where === "local"
      ? "保存データを読み込めなかったため、デモの初期状態に戻しました。"
      : (told.missed ??
          "保存できない変更があったため、保存されている状態に戻しました。");
  return null;
}
