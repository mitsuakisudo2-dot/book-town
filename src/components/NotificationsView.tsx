"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TownActions, TownState } from "../lib/types";
import { notificationsFor } from "../lib/notifications";
import { useTownBackend } from "../lib/store";
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
  const savedIn = useTownBackend();
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
          <h2>まだ静かです</h2>
          <p>
            同じ本を読み終えた人、あなたの本屋に残されたひとこと、投稿への返信が、ここに届きます。
          </p>
          <div className="empty-state-actions">
            {!state.ownShop && (
              <Link className="button primary" href="/my-shop/">
                本屋を開く
              </Link>
            )}
            <Link className="button secondary" href="/walk/">
              書店めぐりに出かける
            </Link>
          </div>
        </div>
      )}
      <p className="search-note">
        {savedIn === "local"
          ? "お知らせはこのブラウザの中の出来事から作っています。デモの読書家の投稿は架空のデモデータです。"
          : "お知らせは、この街の投稿と、あなたの投稿への反応から作っています。"}
      </p>
    </div>
  );
}
