"use client";
import Link from "next/link";
import { closeAccountRequest, useAccountRequest } from "../lib/visitor";
import { Icon, Modal } from "./ui";
import "./visitor.css";
import { loginPath, walkPath } from "../lib/paths";
import { NAMES } from "../lib/words";

const INVITE_NOTE = `${NAMES.service} は今、招待した方から少しずつ始めています。`;

/** Shown when a visitor who is not signed in tries to change something. */
export function AccountInvite() {
  const open = useAccountRequest();
  if (!open) return null;
  return (
    <Modal title="本の街の住人になりませんか" onClose={closeAccountRequest}>
      <p className="modal-lead">見るだけなら、このまま歩けます。</p>
      <p className="muted">
        書店を開く、棚に本を並べる、投稿する、好きやひとことを届けるには、ログインが必要です。
      </p>
      <div className="note-box">{INVITE_NOTE}</div>
      <div className="visitor-invite-actions">
        <Link
          className="btn fill"
          href={loginPath()}
          onClick={closeAccountRequest}
        >
          ログインする
          <Icon name="arrow" size={16} />
        </Link>
        <button className="btn" onClick={closeAccountRequest}>
          このまま見る
        </button>
      </div>
    </Modal>
  );
}

const PAGES = {
  profile: {
    icon: "user",
    title: "あなたのページは、ログインしてから。",
    text: `人生の9冊や、読んだ本、${NAMES.letter}が並ぶ、あなただけのページができます。`,
  },
  shop: {
    icon: "store",
    title: "あなたも、店主に。",
    text: "ログインすると、自分の書店を開いて、好きな本を棚に並べられます。並べた棚は、街を歩く誰かの出会いになります。",
  },
  notifications: {
    icon: "bell",
    title: "お知らせは、ログインしてから。",
    text: `あなたの書店や${NAMES.letter}への反応、フォローしている人の新しい${NAMES.letter}が、ここに届きます。`,
  },
  library: {
    icon: "shelf",
    title: "あなたのライブラリは、ログインしてから。",
    text: "読み取った本、読みたい本、いいねした本が、ここに集まります。積読や読了に分けて、まとめて整理できます。",
  },
  wishlist: {
    icon: "bookmark",
    title: "読みたい本は、ログインしてから。",
    text: "街で見つけた気になる本を、ここに集めておけます。",
  },
} as const;

/** A page that belongs to an account, as a visitor sees it. */
export function VisitorPage({ page }: { page: keyof typeof PAGES }) {
  const copy = PAGES[page];
  return (
    <div className="empty-state visitor-page">
      <Icon name={copy.icon} size={34} />
      <h1>{copy.title}</h1>
      <p>{copy.text}</p>
      <Link className="btn fill" href={loginPath()}>
        ログインする
        <Icon name="arrow" size={16} />
      </Link>
      <p className="visitor-page-note">
        {INVITE_NOTE}
        <br />
        <Link href={walkPath()}>ログインせずに、書店めぐりへ</Link>
      </p>
    </div>
  );
}
