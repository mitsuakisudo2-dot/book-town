import type { TownBackend } from "./town-backend";
import type { PersistenceStatus } from "./types";

type Where = TownBackend["kind"];

/** The shop editor's line about where the shelves are saved. */
export function shelfSaveMessage(where: Where, status: PersistenceStatus) {
  if (where === "local")
    return {
      saved: "本棚の変更は、このブラウザに保存済みです。",
      saving: "本棚の変更は、このブラウザに保存済みです。",
      loading: "このブラウザの保存データを読み込んでいます。",
      unavailable:
        "ブラウザに保存できません。変更はリロードすると失われる場合があります。",
      recovered: "保存データを読み込めなかったため、初期状態に戻しました。",
    }[status];
  return {
    saved: "本棚の変更は、あなたのアカウントに保存済みです。",
    saving: "本棚の変更を保存しています…",
    loading: "あなたの本屋を読み込んでいます。",
    unavailable:
      "つながらないため、まだ保存できていません。つながりしだい保存します。",
    recovered: "保存できない変更があったため、保存されている状態に戻しました。",
  }[status];
}

/** The warning above every page, or null when there is nothing to warn about. */
export function saveWarning(
  where: Where,
  status: PersistenceStatus,
): string | null {
  if (where === "unavailable")
    return "アカウントを読み込めませんでした。通信の状態を確かめて、ページを読み込み直してください。";
  if (where === "visitor")
    return status === "unavailable"
      ? "本の街の新しい様子を読み込めませんでした。いまは見本の書店だけを表示しています。"
      : null;
  if (status === "unavailable")
    return where === "local"
      ? "このブラウザに保存できません。ブラウザの保存設定を確認してください。今の操作はページを閉じると失われます。"
      : "つながらないため、まだ保存できていません。つながりしだい保存します。ページを閉じると、保存前の変更は失われます。";
  if (status === "recovered")
    return where === "local"
      ? "保存データを読み込めなかったため、デモの初期状態に戻しました。"
      : "保存できない変更があったため、保存されている状態に戻しました。";
  return null;
}
