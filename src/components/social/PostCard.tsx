"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { routes } from "../../lib/routes";
import { useTownStore } from "../../lib/store";
import { formatPostDateTime, formatPostTime } from "../../lib/social/format";
import {
  canWantToRead,
  findPost,
  hasReacted,
  hasReportedSpoiler,
  isReview,
  protectionOf,
  reactionCount,
  replyCount,
  type Protection,
} from "../../lib/social/selectors";
import { useSocialStore } from "../../lib/social/store";
import type { Post, PostImage } from "../../lib/social/types";
import { ME_ID, type Book } from "../../lib/types";
import { Icon, Modal, ReaderAvatar } from "../ui";
import { readerOf, useSocialUI } from "./SocialContext";
import "./social.css";

/**
 * Where a post is shown decides how spoilers behave:
 * - feed: timelines and profile lists. A protected body is never shown; the card links on.
 * - thread / work: the post page and the work page, where the viewer can choose to open it.
 */
export type PostContext = "feed" | "thread" | "work";

const FEED_TEXT_LIMIT = 280;

export function MiniCover({ book, size = 38 }: { book: Book; size?: number }) {
  return (
    <span
      className="sns-mini-cover"
      style={{
        background: book.color,
        color: book.ink,
        width: size,
        height: Math.round(size * 1.45),
      }}
      aria-hidden="true"
    >
      <span>{book.title}</span>
    </span>
  );
}

export function PostCard({
  post,
  context,
  focused = false,
  ancestor = false,
  showReplyTo = false,
  hideBookId,
  revealed: controlledReveal,
  onReveal,
}: {
  post: Post;
  context: PostContext;
  /** The post a thread page is about: larger text, full date, not itself a link. */
  focused?: boolean;
  /** Drawn above the focused post with a connecting line. */
  ancestor?: boolean;
  showReplyTo?: boolean;
  /** On a work page, the page's own book need not be repeated on every card. */
  hideBookId?: string;
  /** A thread reveals all of its spoilers together; elsewhere each card decides alone. */
  revealed?: boolean;
  onReveal?: (reveal: boolean) => void;
}) {
  const router = useRouter();
  const { state: town } = useTownStore();
  const { social } = useSocialStore();
  const [ownReveal, setOwnReveal] = useState(false);
  const bodyId = useId();
  const author = readerOf(town, post.authorId);
  const book = post.book
    ? town.books.find((entry) => entry.id === post.book?.bookId)
    : undefined;
  const protection = protectionOf(social, post);
  const revealed = controlledReveal ?? ownReveal;
  const setRevealed = onReveal ?? setOwnReveal;
  const hidden = protection !== "none" && (context === "feed" || !revealed);
  const linksToPage = !focused;

  // The whole card opens the post, as SNS readers expect; real controls keep their own action.
  function openFromCard(event: MouseEvent<HTMLElement>) {
    if (!linksToPage) return;
    const target = event.target as HTMLElement;
    // Modals opened from a card (image, report, delete) sit inside it in the DOM.
    if (
      target.closest(
        "a,button,input,label,textarea,select,summary,dialog,.modal-backdrop",
      )
    )
      return;
    if (window.getSelection()?.toString()) return;
    router.push(routes.post(post.id));
  }

  return (
    <article
      id={`post-${post.id}`}
      className={
        "sns-post" +
        (focused ? " is-focused" : "") +
        (ancestor ? " is-ancestor" : "") +
        (linksToPage ? " is-linked" : "")
      }
      aria-label={`${author?.name ?? "読書家"}の${labelOf(post)}`}
      onClick={openFromCard}
    >
      {showReplyTo && post.reply && <ReplyTo post={post} />}
      <div className="sns-post-grid">
        <div className="sns-post-avatar">
          {author ? (
            <Link
              href={routes.profile(author.id)}
              aria-label={`${author.name}のプロフィール`}
            >
              <ReaderAvatar reader={author} size={focused ? 48 : 44} />
            </Link>
          ) : null}
        </div>
        <div className="sns-post-main">
          <header className="sns-post-head">
            {author ? (
              <Link className="sns-author" href={routes.profile(author.id)}>
                {author.name}
              </Link>
            ) : (
              <span className="sns-author">読書家</span>
            )}
            {post.demo && <span className="sns-demo">デモ</span>}
            <Link
              className="sns-time"
              href={routes.post(post.id)}
              aria-label={`${formatPostDateTime(post.createdAt)}の投稿を開く`}
            >
              <time dateTime={post.createdAt}>
                {focused
                  ? formatPostDateTime(post.createdAt)
                  : formatPostTime(post.createdAt)}
              </time>
            </Link>
            {isReview(post) && <span className="sns-badge">感想</span>}
            {post.spoiler && (
              <span className="sns-badge is-spoiler">ネタバレあり</span>
            )}
            <PostMenu post={post} />
          </header>

          {hidden ? (
            <SpoilerGate
              post={post}
              protection={protection}
              context={context}
              bodyId={bodyId}
              onReveal={() => setRevealed(true)}
            />
          ) : (
            <div id={bodyId}>
              {protection !== "none" && (
                <p className="sns-revealed-note">
                  <Icon name="eye" size={14} />
                  {protection === "reported"
                    ? "報告した投稿を表示しています"
                    : "ネタバレを表示しています"}
                  <button type="button" onClick={() => setRevealed(false)}>
                    隠す
                  </button>
                </p>
              )}
              <PostText post={post} truncate={context === "feed"} />
              {post.images.length > 0 && <PostImages images={post.images} />}
            </div>
          )}

          {book && book.id !== hideBookId && (
            <BookAttachment post={post} book={book} />
          )}
          <PostActions post={post} book={book} />
        </div>
      </div>
    </article>
  );
}

function labelOf(post: Post) {
  if (post.reply) return "返信";
  return isReview(post) ? "感想" : "投稿";
}

function ReplyTo({ post }: { post: Post }) {
  const { state: town } = useTownStore();
  const { social } = useSocialStore();
  const parent = post.reply ? findPost(social, post.reply.parentId) : undefined;
  const parentAuthor = parent && readerOf(town, parent.authorId);
  return (
    <p className="sns-reply-to">
      <Icon name="reply" size={13} />
      {parent ? (
        <Link href={routes.post(parent.id)}>
          {parentAuthor?.name ?? "読書家"}さんへの返信
        </Link>
      ) : (
        "削除された投稿への返信"
      )}
    </p>
  );
}

function PostText({ post, truncate }: { post: Post; truncate: boolean }) {
  if (!post.text) return null;
  const long = truncate && post.text.length > FEED_TEXT_LIMIT;
  return (
    <p className="sns-text">
      {long ? post.text.slice(0, FEED_TEXT_LIMIT - 30) + "…" : post.text}
      {long && (
        <>
          {" "}
          <Link className="sns-more" href={routes.post(post.id)}>
            続きを読む
          </Link>
        </>
      )}
    </p>
  );
}

function PostImages({ images }: { images: PostImage[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = open === null ? null : images[open];
  return (
    <>
      <div className={`sns-images count-${images.length}`}>
        {images.map((image, index) => (
          <button
            type="button"
            key={index}
            className="sns-image"
            onClick={() => setOpen(index)}
            aria-label={`画像${index + 1}を拡大: ${image.alt || "説明なし"}`}
          >
            {/* Data URLs and a static export: next/image would add nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              loading="lazy"
              decoding="async"
            />
          </button>
        ))}
      </div>
      {shown && open !== null && (
        <Modal
          title={`画像 ${open + 1} / ${images.length}`}
          onClose={() => setOpen(null)}
          wide
          className="sns-lightbox"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown.src}
            alt={shown.alt}
            width={shown.width}
            height={shown.height}
          />
          {shown.alt && <p className="sns-lightbox-alt">{shown.alt}</p>}
        </Modal>
      )}
    </>
  );
}

function SpoilerGate({
  post,
  protection,
  context,
  bodyId,
  onReveal,
}: {
  post: Post;
  protection: Exclude<Protection, "none">;
  context: PostContext;
  bodyId: string;
  onReveal: () => void;
}) {
  const review = isReview(post) && post.book;
  const heading =
    protection === "reported"
      ? "ネタバレ指定漏れとして報告した投稿"
      : post.reply
        ? "ネタバレを含む会話"
        : review
          ? "ネタバレを含む感想"
          : "ネタバレを含む投稿";
  return (
    <div className="sns-spoiler" role="group" aria-label={heading}>
      <b>
        <Icon name="eye-off" size={16} />
        {heading}
      </b>
      <p>
        {context === "feed"
          ? "タイムラインでは本文と画像を表示しません。"
          : "読む人が選ぶまで、本文と画像を隠しています。"}
      </p>
      {context === "feed" ? (
        <Link
          href={
            review && post.book
              ? routes.bookPost(post.book.bookId, post.id)
              : routes.post(post.id)
          }
        >
          {review ? "作品ページで読む" : "投稿を開いて読む"}
          <Icon name="arrow" size={14} />
        </Link>
      ) : (
        <button
          type="button"
          aria-controls={bodyId}
          aria-expanded={false}
          onClick={onReveal}
        >
          ネタバレを表示する
        </button>
      )}
    </div>
  );
}

const purposeLabel = {
  review: "この本の感想",
  mention: "添えられた本",
  recommend: "おすすめの本",
};

function BookAttachment({ post, book }: { post: Post; book: Book }) {
  const purpose = post.book?.purpose ?? "mention";
  return (
    <Link
      className={`sns-book is-${purpose}`}
      href={
        isReview(post)
          ? routes.bookPost(book.id, post.id)
          : routes.book(book.id)
      }
      aria-label={`${purposeLabel[purpose]}『${book.title}』${book.author}の作品ページへ`}
    >
      <MiniCover book={book} />
      <span className="sns-book-text">
        <small>{purposeLabel[purpose]}</small>
        <b>{book.title}</b>
        <span>{book.author}</span>
      </span>
      <span className="sns-book-go" aria-hidden="true">
        作品ページ
        <Icon name="chevron" size={14} />
      </span>
    </Link>
  );
}

function PostActions({ post, book }: { post: Post; book?: Book }) {
  const { state: town, actions: townActions } = useTownStore();
  const { social, actions } = useSocialStore();
  const { compose, notify } = useSocialUI();
  const [dismissed, setDismissed] = useState(false);
  const replies = replyCount(social, post.id);
  const likes = reactionCount(social, post.id, "like");
  const wants = reactionCount(social, post.id, "wantToRead");
  const liked = hasReacted(social, post.id, "like");
  const wanted = hasReacted(social, post.id, "wantToRead");
  const wishable = canWantToRead(post) && book;
  const saved = book ? town.wishlist.includes(book.id) : false;
  const savedHere =
    book !== undefined && town.wishSources[book.id]?.postId === post.id;

  return (
    <>
      <div className="sns-actions">
        <button
          type="button"
          className="sns-action"
          onClick={() => compose({ replyTo: post.id })}
          aria-label={`返信する（${replies}件）`}
        >
          <Icon name="chat" size={17} />
          {replies > 0 && <span>{replies}</span>}
        </button>
        <button
          type="button"
          className="sns-action is-like"
          aria-pressed={liked}
          aria-label={`いいね（${likes}件）`}
          onClick={() => {
            if (!actions.toggleReaction(post.id, "like"))
              notify(
                "保存できませんでした。ブラウザの保存容量を確認してください",
              );
          }}
        >
          <Icon name="heart" size={17} />
          {likes > 0 && <span>{likes}</span>}
        </button>
        {wishable ? (
          <button
            type="button"
            className="sns-action is-want"
            aria-pressed={wanted}
            aria-label={`読みたくなった（${wants}件）`}
            onClick={() => {
              setDismissed(false);
              if (!actions.toggleReaction(post.id, "wantToRead"))
                notify(
                  "保存できませんでした。ブラウザの保存容量を確認してください",
                );
            }}
          >
            <Icon name="want-read" size={17} />
            <span className="sns-action-label">読みたくなった</span>
            {wants > 0 && <span>{wants}</span>}
          </button>
        ) : (
          post.book &&
          wants > 0 && (
            <span className="sns-action is-static">
              <Icon name="want-read" size={17} />
              <span className="sns-action-label">読みたくなった</span>
              <span>{wants}</span>
            </span>
          )
        )}
      </div>
      {wishable && wanted && !saved && !dismissed && (
        <div className="sns-wish-followup" role="status">
          <span>
            『{book.title}』を読みたいリストに入れますか？
            <small>
              読みたいリストとそのきっかけは、あなただけに表示されます。
            </small>
          </span>
          <span className="sns-wish-buttons">
            <button
              type="button"
              className="is-primary"
              onClick={() => {
                if (
                  townActions.saveWishFrom(book.id, {
                    kind: "post",
                    postId: post.id,
                  })
                )
                  notify(
                    "読みたいリストに保存しました。きっかけの投稿も記録しました",
                  );
              }}
            >
              <Icon name="bookmark" size={15} />
              読みたいリストに追加
            </button>
            <button type="button" onClick={() => setDismissed(true)}>
              今はしない
            </button>
          </span>
        </div>
      )}
      {wishable && wanted && savedHere && (
        <p className="sns-wish-done">
          <Icon name="check" size={14} />
          この投稿をきっかけに、読みたいリストへ保存しています
          <Link href="/profiles/me/">リストを見る</Link>
        </p>
      )}
    </>
  );
}

function PostMenu({ post }: { post: Post }) {
  const { social, actions } = useSocialStore();
  const { notify } = useSocialUI();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"report" | "delete" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const mine = post.authorId === ME_ID && !post.demo;
  const reported = hasReportedSpoiler(social, post.id);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: globalThis.MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const items: {
    label: string;
    icon: string;
    danger?: boolean;
    run: () => void;
  }[] = mine
    ? [
        {
          label: post.spoiler ? "ネタバレ指定を外す" : "ネタバレ指定をつける",
          icon: "eye-off",
          run: () => {
            actions.setSpoiler(post.id, !post.spoiler);
            notify(
              post.spoiler
                ? "ネタバレ指定を外しました"
                : "ネタバレ指定をつけました。本文はタイムラインで隠れます",
            );
          },
        },
        {
          label: "投稿を削除",
          icon: "trash",
          danger: true,
          run: () => setConfirm("delete"),
        },
      ]
    : reported
      ? [
          {
            label: "ネタバレ報告を取り消す",
            icon: "flag",
            run: () => {
              actions.toggleSpoilerReport(post.id);
              notify("報告を取り消しました");
            },
          },
        ]
      : post.spoiler
        ? []
        : [
            {
              label: "ネタバレ指定漏れを報告",
              icon: "flag",
              run: () => setConfirm("report"),
            },
          ];

  if (!items.length) return <span className="sns-menu-wrap" />;
  return (
    <div className="sns-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="sns-icon-button"
        aria-label="投稿のメニュー"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="sns-menu" role="menu" id={menuId}>
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              className={item.danger ? "is-danger" : ""}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </div>
      )}
      {confirm === "report" && (
        <Modal title="ネタバレ指定漏れを報告" onClose={() => setConfirm(null)}>
          <p className="modal-lead">
            この投稿には、ネタバレの指定が必要だと報告します。
          </p>
          <p className="muted">
            あなたの画面では、すぐに本文と画像を隠します。この投稿への返信も同じように隠れます。
          </p>
          <div className="note-box">
            このデモでは、報告はこのブラウザにだけ保存され、投稿者や運営には送信されません。
          </div>
          <div className="sns-confirm-buttons">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setConfirm(null);
                if (actions.toggleSpoilerReport(post.id))
                  notify("報告しました。この投稿の本文を隠しました");
              }}
            >
              報告する
            </button>
          </div>
        </Modal>
      )}
      {confirm === "delete" && (
        <Modal title="投稿を削除" onClose={() => setConfirm(null)}>
          <p className="modal-lead">この投稿を削除しますか？</p>
          <p className="muted">
            元に戻せません。この投稿への返信は残り、「削除された投稿への返信」と表示されます。
          </p>
          <div className="sns-confirm-buttons">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="button sns-danger-button"
              onClick={() => {
                setConfirm(null);
                if (actions.deletePost(post.id)) {
                  notify("投稿を削除しました");
                  // Leave a post page whose own post is gone; replies on it just disappear.
                  const viewing = new URLSearchParams(location.search).get(
                    "id",
                  );
                  if (
                    location.pathname.startsWith("/posts") &&
                    viewing === post.id
                  )
                    router.push(routes.feed());
                }
              }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
