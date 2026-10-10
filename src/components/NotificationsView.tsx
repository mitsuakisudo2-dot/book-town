"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TownActions, TownState } from "../lib/types";
import { notificationsFor } from "../lib/notifications";
import { findReader, formatPostTime } from "../lib/social";
import { useClock } from "./useClock";
import { Icon, ReaderAvatar } from "./ui";
import "./reading.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export function NotificationsView({ state, actions }: Shared) {
  const clock = useClock(30_000);
  const notices = notificationsFor(state, clock?.openedAt ?? 0);
  // Notices that were unread when this page showed them keep their mark until it closes.
  const [fresh, setFresh] = useState<string[]>([]);
  const unread = notices
    .map((notice) => notice.id)
    .filter((id) => !state.seenNotifications.includes(id));
  const unreadKey = unread.join(" ");
  useEffect(() => {
    if (!unreadKey) return;
    const ids = unreadKey.split(" ");
    const timer = setTimeout(() => {
      setFresh((previous) => [...new Set([...previous, ...ids])]);
      actions.markNotificationsSeen(ids);
    }, 0);
    return () => clearTimeout(timer);
  }, [unreadKey, actions]);
  return (
    <div className="notices-page">
      <span className="eyebrow">NOTIFICATIONS</span>
      <h1 className="page-title">お知らせ</h1>
      {notices.length ? (
        <ul className="notice-list">
          {notices.map((notice) => {
            const reader = findReader(state, notice.readerId);
            const isNew =
              fresh.includes(notice.id) || unread.includes(notice.id);
            return (
              <li key={notice.id} className={isNew ? "is-new" : ""}>
                <Link href={notice.href}>
                  {reader && <ReaderAvatar reader={reader} size={36} />}
                  <span>
                    {notice.text}
                    <small>
                      {isNew && <b className="notice-new">新着</b>}
                      {formatPostTime(notice.createdAt)}
                    </small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-state">
          <Icon name="bell" size={34} />
          <h2>お知らせは、まだありません。</h2>
          <p>
            投稿への返信、フォローしている人の投稿、読みたい本への感想が、ここに届きます。
          </p>
        </div>
      )}
      <p className="search-note">
        お知らせはこのブラウザの中の出来事から作っています。デモの読書家の投稿は架空のデモデータです。
      </p>
    </div>
  );
}
