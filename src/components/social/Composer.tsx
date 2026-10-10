"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTownStore } from "../../lib/store";
import {
  ImagePreparationError,
  prepareImage,
  type ImageProblem,
} from "../../lib/social/image";
import { findPost, protectionOf } from "../../lib/social/selectors";
import { useSocialStore } from "../../lib/social/store";
import {
  IMAGE_ALT_LIMIT,
  POST_IMAGE_LIMIT,
  POST_TEXT_LIMIT,
  type BookLink,
  type PostImage,
  type PostRejection,
} from "../../lib/social/types";
import type { Book } from "../../lib/types";
import { Icon, Modal, ReaderAvatar } from "../ui";
import { MiniCover } from "./PostCard";
import { readerOf, useSocialUI, type ComposerPreset } from "./SocialContext";
import "./social.css";

const rejection: Record<PostRejection, string> = {
  empty: "本文か画像を入れてください。",
  "review-needs-text": "感想として公開するには、本文を書いてください。",
  "too-long": `本文は${POST_TEXT_LIMIT}文字までです。`,
  "too-many-images": `画像は${POST_IMAGE_LIMIT}枚までです。`,
  "invalid-image": "この画像は使えません。別の画像を選んでください。",
  "unknown-book": "この本は見つかりませんでした。",
  "invalid-purpose": "本の添え方を確認してください。",
  "missing-parent":
    "返信先の投稿が見つかりません。削除された可能性があります。",
  "storage-full":
    "このデモで投稿を保存できる容量の上限に達しました。画像を減らすか、古い投稿を削除してください。",
};
const imageProblem: Record<ImageProblem, string> = {
  "not-image": "画像ファイルを選んでください。",
  "too-large": "15MBより大きい画像は選べません。",
  unreadable:
    "この画像は読み込めませんでした（HEICなど、ブラウザが対応していない形式の可能性があります）。",
  "too-heavy": "画像を小さくできませんでした。別の画像を選んでください。",
};

export function Composer({
  preset,
  onClose,
}: {
  preset: ComposerPreset;
  onClose: () => void;
}) {
  const { state: town } = useTownStore();
  const { social, actions } = useSocialStore();
  const { notify } = useSocialUI();
  const replyTo = preset.replyTo ?? null;
  const parent = replyTo ? findPost(social, replyTo) : undefined;
  const parentAuthor = parent && readerOf(town, parent.authorId);
  const [text, setText] = useState("");
  const [images, setImages] = useState<PostImage[]>([]);
  const [book, setBook] = useState<BookLink | null>(
    replyTo ? null : (preset.book ?? null),
  );
  const [spoiler, setSpoiler] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const textId = useId();
  const helpId = useId();
  const attached = book && town.books.find((entry) => entry.id === book.bookId);
  const review = !replyTo && book?.purpose === "review";
  const over = text.length > POST_TEXT_LIMIT;
  const ready =
    !busy &&
    !over &&
    (text.trim().length > 0 || images.length > 0) &&
    !(review && !text.trim());

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const room = POST_IMAGE_LIMIT - images.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room)
      setError(
        `画像は${POST_IMAGE_LIMIT}枚までです。最初の${room}枚を追加します。`,
      );
    setBusy(true);
    const prepared: PostImage[] = [];
    for (const file of chosen) {
      try {
        prepared.push(await prepareImage(file));
      } catch (problem) {
        setError(
          problem instanceof ImagePreparationError
            ? imageProblem[problem.problem]
            : imageProblem.unreadable,
        );
      }
    }
    setImages((current) =>
      [...current, ...prepared].slice(0, POST_IMAGE_LIMIT),
    );
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    const result = actions.createPost({
      text,
      images,
      book,
      spoiler,
      replyTo,
    });
    if (!result.ok) {
      setError(rejection[result.reason]);
      return;
    }
    notify(
      replyTo
        ? "返信しました"
        : isReviewDraft(book)
          ? "感想を投稿しました。作品ページにも表示されます"
          : "投稿しました",
    );
    onClose();
  }

  function requestClose() {
    if (
      (text.trim() || images.length) &&
      !window.confirm("書きかけの内容を破棄しますか？")
    )
      return;
    onClose();
  }

  return (
    <Modal
      title={replyTo ? "返信する" : "投稿する"}
      onClose={requestClose}
      className="sns-composer-modal"
    >
      <form className="sns-composer" onSubmit={submit}>
        {replyTo && (
          <div className="sns-reply-context">
            {parent ? (
              <>
                <b>{parentAuthor?.name ?? "読書家"}さんへの返信</b>
                <p>
                  {protectionOf(social, parent) === "none"
                    ? parent.text || "（画像の投稿）"
                    : "ネタバレを含む投稿のため、本文を表示していません。"}
                </p>
              </>
            ) : (
              <b>返信先の投稿が見つかりません。</b>
            )}
          </div>
        )}
        <div className="sns-composer-row">
          <ReaderAvatar reader={town.me} size={38} />
          <textarea
            id={textId}
            aria-label={replyTo ? "返信の本文" : "投稿の本文"}
            aria-describedby={helpId}
            placeholder={
              replyTo
                ? "言葉を返す。本を添えて薦めることもできます。"
                : review
                  ? "この本を読んで、残ったこと。"
                  : "本のことでも、今日のことでも。"
            }
            value={text}
            rows={5}
            onChange={(event) => setText(event.target.value)}
          />
        </div>

        {images.length > 0 && (
          <div className="sns-image-drafts">
            {images.map((image, index) => (
              <figure key={index}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.src} alt="" />
                <button
                  type="button"
                  className="sns-image-remove"
                  aria-label={`画像${index + 1}を外す`}
                  onClick={() =>
                    setImages((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Icon name="close" size={14} />
                </button>
                <input
                  className="field"
                  aria-label={`画像${index + 1}の説明（読み上げ用）`}
                  placeholder="画像の説明（任意）"
                  maxLength={IMAGE_ALT_LIMIT}
                  value={image.alt}
                  onChange={(event) =>
                    setImages((current) =>
                      current.map((entry, i) =>
                        i === index
                          ? { ...entry, alt: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </figure>
            ))}
          </div>
        )}

        {attached && (
          <div className="sns-attached">
            <MiniCover book={attached} size={32} />
            <span className="sns-attached-text">
              <small>{replyTo ? "薦める本" : "添える本"}</small>
              <b>{attached.title}</b>
              <span>{attached.author}</span>
            </span>
            <button
              type="button"
              className="sns-icon-button"
              aria-label={`『${attached.title}』を外す`}
              onClick={() => setBook(null)}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}

        {attached && book && !replyTo && (
          <fieldset className="sns-purpose">
            <legend>この本をどう載せますか</legend>
            <label>
              <input
                type="radio"
                name="purpose"
                checked={book.purpose === "mention"}
                onChange={() => setBook({ ...book, purpose: "mention" })}
              />
              <span>
                本を添えるだけ
                <small>タイムラインとプロフィールに表示します。</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="purpose"
                checked={book.purpose === "review"}
                onChange={() => setBook({ ...book, purpose: "review" })}
              />
              <span>
                感想として公開する
                <small>作品ページの「みんなの感想」にも表示します。</small>
              </span>
            </label>
          </fieldset>
        )}
        {attached && replyTo && (
          <p className="sns-composer-hint">
            返信に添えた本は、その作品ページの「会話の中で薦められた本」にも表示されます。
          </p>
        )}

        {picking && (
          <BookPicker
            books={town.books}
            selectedId={book?.bookId}
            onPick={(bookId) => {
              setBook({
                bookId,
                purpose: replyTo ? "recommend" : (book?.purpose ?? "mention"),
              });
              setPicking(false);
            }}
          />
        )}

        <label className="sns-check">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(event) => setSpoiler(event.target.checked)}
          />
          <span>
            ネタバレを含む
            <small>
              タイムラインでは本文と画像を隠し、作品ページでは読む人が開くまで隠します。
            </small>
          </span>
        </label>

        {error && (
          <p className="sns-error" role="alert">
            {error}
          </p>
        )}

        <div className="sns-composer-bar">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => addFiles(event.target.files)}
          />
          <button
            type="button"
            className="sns-tool"
            disabled={images.length >= POST_IMAGE_LIMIT || busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="image" size={17} />
            {busy ? "画像を準備中…" : "画像"}
          </button>
          <button
            type="button"
            className="sns-tool"
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
          >
            <Icon name="book" size={17} />
            {replyTo ? "本を添えて薦める" : "本を添える"}
          </button>
          <span className={"sns-count" + (over ? " is-over" : "")}>
            {text.length}/{POST_TEXT_LIMIT}
          </span>
          <button type="submit" className="button" disabled={!ready}>
            {replyTo ? "返信する" : "投稿する"}
          </button>
        </div>
        <p className="sns-composer-note" id={helpId}>
          このデモでは、投稿はこのブラウザにだけ保存され、ほかの人には届きません。画像は縮小し、位置情報などのメタデータを取り除いて保存します。
        </p>
      </form>
    </Modal>
  );
}

const isReviewDraft = (book: BookLink | null) => book?.purpose === "review";

function BookPicker({
  books,
  selectedId,
  onPick,
}: {
  books: Book[];
  selectedId?: string;
  onPick: (bookId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return books.filter(
      (book) =>
        !term ||
        `${book.title} ${book.author} ${book.genre}`
          .toLocaleLowerCase()
          .includes(term),
    );
  }, [books, query]);
  return (
    <div className="sns-picker">
      <input
        type="search"
        className="field"
        aria-label="添える本を検索"
        placeholder="書名・著者・ジャンルで探す"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul>
        {results.map((book) => (
          <li key={book.id}>
            <button
              type="button"
              aria-pressed={selectedId === book.id}
              onClick={() => onPick(book.id)}
            >
              <MiniCover book={book} size={26} />
              <span className="sns-picker-text">
                <b>{book.title}</b>
                <small>
                  {book.author} · {book.genre}
                </small>
              </span>
            </button>
          </li>
        ))}
        {!results.length && (
          <li className="sns-picker-empty">見つかりませんでした。</li>
        )}
      </ul>
      <p className="sns-picker-note">
        このデモでは、サンプルの{books.length}
        冊から選べます。書籍データベースとの接続は次の段階です。
      </p>
    </div>
  );
}
