import { activeSession, readersNow } from "./reading";
import { bookPath } from "./books";
import { findReader, reviewFoldOf, spoilerViewOf } from "./social";
import {
  ME_ID,
  OWN_SHOP_ID,
  type Post,
  type ReviewKind,
  type TownState,
} from "./types";
import { REPORT_KIND_WORDS } from "./supabase/reports";
import { profilePath, shopPath } from "./paths";
import { coverHidden } from "./hidden-words";

export interface Notice {
  id: string;
  readerId: string;
  createdAt: string;
  text: string;
  href: string;
}

/** The Monday (Japan time) of the week a moment falls in, as YYYY-MM-DD. */
export function weekOf(at: string): string {
  const japan = new Date(Date.parse(at) + 9 * 3_600_000);
  japan.setUTCDate(japan.getUTCDate() - ((japan.getUTCDay() + 6) % 7));
  return japan.toISOString().slice(0, 10);
}

/** A day as 10月13日, in Japan time. */
const dayWords = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
});
export const monthDay = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : dayWords.format(date);
};

const quote = (post: string) => {
  const body = coverHidden(post);
  return "「" + (body.length > 40 ? body.slice(0, 40) + "…" : body) + "」";
};

/**
 * Notices are derived from what is actually in this browser's town: replies and reactions
 * to the viewer's posts, posts by followed readers, reviews of books on the wishlist,
 * words left at the viewer's shop, how many stopped by it this week, readers
 * who finished a book the viewer finished, and readers reading the same book together.
 * Nothing is invented to fill the list.
 */
export function notificationsFor(state: TownState, openedAt = 0): Notice[] {
  const notices: Notice[] = [];
  const name = (id: string) => findReader(state, id)?.name ?? "";
  const title = (id: string | null) =>
    state.books.find((book) => book.id === id)?.title ?? "";
  const mine = new Map(
    state.posts
      .filter((post) => post.authorId === ME_ID && post.parentId === null)
      .map((post) => [post.id, post]),
  );
  // Quoted only when the reader would see the words as they are: not a
  // spoiler they keep folded or out of sight, nor anything folded by reports.
  const quotable = (post: Post) =>
    spoilerViewOf(state, post) === "open" &&
    reviewFoldOf(state, "post", post.id) === null;
  for (const post of state.posts) {
    const parent = post.parentId ? mine.get(post.parentId) : undefined;
    if (parent && post.authorId !== ME_ID)
      notices.push({
        id: "reply:" + post.id,
        readerId: post.authorId,
        createdAt: post.createdAt,
        // A spoiler reply is not quoted where it cannot be covered.
        text:
          `${name(post.authorId)}さんがあなたの投稿に返信しました` +
          (quotable(post) ? " " + quote(post.body) : ""),
        href: parent.bookId ? bookPath(parent.bookId) : "/profiles/me/",
      });
  }
  // Folded by readers' 「ネタバレでは？」: told once and gently, never by whom.
  for (const post of state.posts) {
    if (post.authorId !== ME_ID || !post.folded || post.spoiler) continue;
    const bookId =
      post.bookId ??
      state.posts.find((entry) => entry.id === post.parentId)?.bookId;
    notices.push({
      id: "folded:" + post.id,
      readerId: ME_ID,
      createdAt: post.createdAt,
      text: `ネタバレかもしれないという声があったので、あなたの投稿${quote(post.body)}をたたんで表示しています`,
      href: post.parentId && bookId ? bookPath(bookId) : "/profiles/me/",
    });
  }
  for (const post of mine.values())
    if (post.wants > 0)
      notices.push({
        id: `wants:${post.id}:${post.wants}`,
        readerId: ME_ID,
        createdAt: post.createdAt,
        text: `あなたの感想で、${post.wants}人が『${title(post.bookId)}』を読みたくなりました`,
        href: post.bookId ? bookPath(post.bookId) : "/profiles/me/",
      });
  // いいね: one notice per reader and post, with how many times they pressed.
  for (const post of state.posts) {
    if (post.authorId !== ME_ID) continue;
    for (const liker of post.likers ?? []) {
      const who = name(liker.readerId);
      if (!who) continue;
      notices.push({
        id: `like:${post.id}:${liker.readerId}`,
        readerId: liker.readerId,
        createdAt: liker.at,
        text: `${who}さんが、あなたの投稿に${liker.taps > 1 ? liker.taps + "回" : ""}いいねしました ${quote(post.body)}`,
        href: post.bookId ? bookPath(post.bookId) : "/profiles/me/",
      });
    }
  }
  const followed = new Set(
    state.shops
      .filter((shop) => state.following.includes(shop.id))
      .map((shop) => shop.ownerId),
  );
  for (const post of state.posts) {
    if (
      post.authorId === ME_ID ||
      post.parentId !== null ||
      post.readingMode === "solo" ||
      !quotable(post)
    )
      continue;
    if (followed.has(post.authorId))
      notices.push({
        id: "follow:" + post.id,
        readerId: post.authorId,
        createdAt: post.createdAt,
        text: `フォロー中の${name(post.authorId)}さんが投稿しました ${quote(post.body)}`,
        href: profilePath(post.authorId),
      });
    else if (post.bookId && state.wishlist.includes(post.bookId))
      notices.push({
        id: "wish:" + post.id,
        readerId: post.authorId,
        createdAt: post.createdAt,
        text: `読みたい本『${title(post.bookId)}』に、${name(post.authorId)}さんの感想が届いています`,
        href: bookPath(post.bookId),
      });
  }
  // Folded or held by reports: its owner is told, gently, and that it is
  // not gone. Never who reported, nor how many.
  for (const [key, fold] of Object.entries(state.reviewFolds)) {
    const at = key.indexOf(":");
    const kind = key.slice(0, at) as ReviewKind;
    const id = key.slice(at + 1);
    const post =
      kind === "post"
        ? state.posts.find(
            (entry) => entry.id === id && entry.authorId === ME_ID,
          )
        : undefined;
    const own =
      post ||
      (kind === "profile" && id === ME_ID) ||
      (kind === "shop" && id === OWN_SHOP_ID) ||
      // Only a poster's owner ever reads that it is held.
      (kind === "poster" && fold.state === "held");
    if (!own) continue;
    const thing =
      kind === "poster"
        ? "あなたのポスター"
        : "あなたの投稿" + (post ? quote(post.body) : "");
    notices.push({
      id: `review-${fold.state}:${key}`,
      readerId: ME_ID,
      createdAt: fold.since,
      text:
        fold.state === "held"
          ? `運営が確かめるまで、${thing}をほかの人から見えないようにしています。問題がなければ、元に戻ります`
          : kind === "profile"
            ? "通報があったため、運営が確かめるまで、あなたの紹介文をたたんでいます"
            : kind === "shop"
              ? "通報があったため、運営が確かめるまで、あなたの本屋の紹介文をたたんでいます"
              : `通報があったため、運営が確かめるまで、${thing}をみんなの画面ではたたんでいます。投稿は消えていません`,
      href:
        kind === "shop"
          ? shopPath(OWN_SHOP_ID)
          : post?.bookId
            ? bookPath(post.bookId)
            : "/profiles/me/",
    });
  }
  // The reader's own reports: when the operator starts looking, and when they
  // have looked. Just filed needs no notice (the dialog said 受け付けました),
  // and what was done about the other person is never said.
  for (const report of state.myReports) {
    if (report.status === "open") continue;
    const done = report.status !== "checking";
    const day = monthDay(report.createdAt);
    notices.push({
      id: `report:${report.id}:${done ? "done" : "checking"}`,
      readerId: ME_ID,
      createdAt: report.statusAt,
      text:
        report.kind === "book"
          ? `${day}にいただいた表紙の削除依頼を、運営が${done ? "確認しました" : "確認しています"}`
          : `${day}に通報してくださった${REPORT_KIND_WORDS[report.kind]}を、運営が${
              done
                ? "確認しました。知らせてくださって、ありがとうございます"
                : "確認しています"
            }`,
      href: "/notifications/#reports",
    });
  }
  for (const message of state.shopMessages)
    notices.push({
      id: `message:${message.readerId}:${message.at}`,
      readerId: message.readerId,
      createdAt: message.at,
      text: `${name(message.readerId)}さんが、あなたの本屋にひとことを残しました ${quote(message.text)}`,
      href: "/my-shop/#messages",
    });
  // Someone else finished a book the viewer finished too: a reader to meet.
  const finished = new Set([
    ...state.finishedBooks,
    ...state.readingRecords
      .filter((record) => record.readerId === ME_ID)
      .map((record) => record.bookId),
  ]);
  for (const record of state.readingRecords)
    if (
      record.readerId !== ME_ID &&
      record.isPublic &&
      finished.has(record.bookId)
    )
      notices.push({
        id: "finished:" + record.id,
        readerId: record.readerId,
        createdAt: record.createdAt,
        text: record.feelings.includes("talk")
          ? `${name(record.readerId)}さんも『${title(record.bookId)}』を読み終えて、誰かと話したいそうです`
          : `${name(record.readerId)}さんも『${title(record.bookId)}』を読み終えました`,
        href: bookPath(record.bookId),
      });
  // 立ち寄り便り: one notice a week, only when someone came, never who.
  const visitors = state.ownShop?.weekVisitors;
  if (visitors && visitors.count > 0)
    notices.push({
      id: "visitors:" + weekOf(visitors.at),
      readerId: ME_ID,
      createdAt: visitors.at,
      text: `この1週間で、${visitors.count}人があなたの本屋に立ち寄りました`,
      href: shopPath(OWN_SHOP_ID),
    });
  const active = activeSession(state);
  if (active?.mode === "together" && active.bookId)
    for (const entry of readersNow(state, openedAt))
      if (entry.readerId !== ME_ID && entry.bookId === active.bookId)
        notices.push({
          id: `reading:${active.id}:${entry.readerId}`,
          readerId: entry.readerId,
          createdAt: active.startedAt,
          text: `${name(entry.readerId)}さんも今『${title(entry.bookId)}』を読んでいます`,
          href: "/reading/",
        });
  return notices
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 40);
}

export const unreadCount = (state: TownState): number =>
  notificationsFor(state).filter(
    (notice) => !state.seenNotifications.includes(notice.id),
  ).length;
