"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { normalizeIsbn } from "../lib/books";
import { lookUpBook } from "../lib/openbd";
import { libraryBookByIsbn, useTownBackend } from "../lib/store";
import type { TownActions, TownState } from "../lib/types";
import { Icon, Modal } from "./ui";

type Detector = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};
type DetectorClass = new (options: { formats: string[] }) => Detector;

const detectorClass = (): DetectorClass | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { BarcodeDetector?: DetectorClass })
        .BarcodeDetector;

const NOT_AN_ISBN =
  "ISBNとして読めませんでした。本の裏表紙にある978か979で始まる13桁の数字を入力してください。";

/**
 * Register a book by scanning its ISBN barcode with the camera (where the browser can
 * read barcodes), or by typing the ISBN. Unknown ISBNs are completed by hand.
 */
export function BarcodeRegister({
  state,
  actions,
  notify,
  onClose,
  lead = "バーコードで本を登録",
}: {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
  onClose: () => void;
  /** The line under the title: what this form is for where it opens. */
  lead?: string;
}) {
  const id = useId();
  const savedIn = useTownBackend();
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [isbnText, setIsbnText] = useState("");
  // The ISBN the camera read, to tell a scanned book from a typed one.
  const [scanned, setScanned] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [looking, setLooking] = useState(false);
  // The ISBN being looked up; an answer for any other comes too late.
  const asking = useRef<string | null>(null);
  // The ISBN the message and the filled-in book are about, and what was
  // filled in. Another ISBN takes them back out, so one book's title is
  // never registered under another book's ISBN.
  const about = useRef<string | null>(null);
  const filled = useRef<{
    title: string;
    author: string;
    price: string;
  } | null>(null);
  const canScan = Boolean(detectorClass());

  useEffect(() => {
    if (!scanning) return;
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const detector = new Detector({ formats: ["ean_13"] });
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play();
        }
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const codes = await detector.detect(video.current).catch(() => []);
          const found = codes
            .map((code) => normalizeIsbn(code.rawValue))
            .find(Boolean);
          if (found) {
            setScanning(false);
            setScanned(found);
            void accept(found);
          }
        }, 350);
      })
      .catch(() => {
        setScanning(false);
        setMessage("カメラを使えませんでした。ISBNを入力してください。");
      });
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // accept is stable enough for a scan session; restarting on every render would reopen the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  /** Forgets what was found or said for another ISBN than `isbn`. */
  function moveTo(isbn: string | null) {
    if (isbn === about.current) return;
    about.current = null;
    asking.current = null;
    setLooking(false);
    setMessage("");
    const was = filled.current;
    filled.current = null;
    if (!was) return;
    // Only what was filled in: what the reader typed stays.
    setTitle((now) => (now === was.title ? "" : now));
    setAuthor((now) => (now === was.author ? "" : now));
    setPrice((now) => (now === was.price ? "" : now));
  }

  function fill(book: { title: string; author: string; price?: number }) {
    const next = {
      title: book.title,
      author: book.author,
      price: book.price ? String(book.price) : "",
    };
    filled.current = next;
    setTitle(next.title);
    setAuthor(next.author);
    setPrice(next.price);
  }

  async function accept(found: string) {
    setIsbnText(found);
    moveTo(found);
    about.current = found;
    // Whether it is already registered is about the reader's own library;
    // a book the town knows only fills in its title.
    const mine = libraryBookByIsbn(state, found);
    const known = mine ?? state.books.find((book) => book.isbn === found);
    if (known) {
      asking.current = null;
      setLooking(false);
      fill(known);
      setMessage(
        mine
          ? "もうライブラリにあります。"
          : "書籍情報が見つかりました。確認して登録してください。",
      );
      return;
    }
    asking.current = found;
    setLooking(true);
    setMessage("書籍情報を探しています…");
    // Gives up after a few seconds, so the title can always be typed by hand.
    const book = await lookUpBook(found);
    if (asking.current !== found) return;
    asking.current = null;
    setLooking(false);
    if (book) {
      fill(book);
      setMessage("書籍情報が見つかりました。確認して登録してください。");
    } else {
      setMessage(
        "書籍情報を取得できませんでした。タイトルと著者を入力して登録できます。",
      );
    }
  }

  function checkIsbn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = normalizeIsbn(isbnText);
    if (!found) {
      setMessage(NOT_AN_ISBN);
      return;
    }
    void accept(found);
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The ISBN in its field is registered, whether it was looked up or not.
    const typed = isbnText.trim();
    const isbn = typed ? normalizeIsbn(typed) : null;
    if (typed && !isbn) {
      setMessage(NOT_AN_ISBN);
      return;
    }
    const yen = Number(price.replace(/[,，円¥\s]/g, ""));
    const done = actions.registerBook(
      {
        title,
        author,
        ...(isbn ? { isbn } : {}),
        ...(price.trim() && Number.isInteger(yen) && yen > 0
          ? { price: yen }
          : {}),
      },
      !isbn ? "manual" : isbn === scanned ? "scan" : "isbn",
    );
    // A visitor is asked to sign in instead; nothing was registered.
    if (!done) return;
    if (done.result === "not-saved") {
      setMessage(
        savedIn === "unavailable"
          ? "保存できません。ページを読み込み直してから、もう一度登録してください。"
          : "まだ保存できません。読み込みが終わってから、もう一度押してください。",
      );
      return;
    }
    // Named as kept: a book the town knew by its own title, a long one cut.
    notify(
      done.result === "already"
        ? `『${done.title}』はもうライブラリにあります`
        : `『${done.title}』を登録しました`,
    );
    onClose();
  }

  return (
    <Modal title="本を登録" onClose={onClose}>
      <p className="modal-lead">{lead}</p>
      <p className="muted">
        裏表紙のISBNバーコード（978・979で始まる段）を読み取ります。登録した本は、読書の開始や投稿で選べます。
      </p>
      {scanning ? (
        <div className="scan-frame">
          <video ref={video} muted playsInline aria-label="カメラの映像" />
          <button
            type="button"
            className="button secondary"
            onClick={() => setScanning(false)}
          >
            読み取りをやめる
          </button>
        </div>
      ) : (
        canScan && (
          <button
            type="button"
            className="button register-camera"
            onClick={() => {
              setMessage("");
              setScanning(true);
            }}
          >
            <Icon name="camera" size={17} />
            カメラで読み取る
          </button>
        )
      )}
      {!canScan && (
        <p className="note-box">
          このブラウザはバーコードの読み取りに対応していません。ISBNを入力してください。
        </p>
      )}
      <form className="register-form" onSubmit={checkIsbn}>
        <label className="form-label" htmlFor={id + "-isbn"}>
          ISBN
          <input
            id={id + "-isbn"}
            className="field"
            inputMode="numeric"
            placeholder="978-4-..."
            value={isbnText}
            onChange={(event) => {
              setIsbnText(event.target.value);
              // Another ISBN: the old one's answer is no longer awaited, and
              // what was found for it is taken back out.
              moveTo(normalizeIsbn(event.target.value));
            }}
          />
        </label>
        <button type="submit" className="button secondary" disabled={looking}>
          <Icon name="barcode" size={16} />
          ISBNで探す
        </button>
      </form>
      {message && (
        <p className="register-message" role="status">
          {message}
        </p>
      )}
      <form className="register-form" onSubmit={register}>
        <label className="form-label" htmlFor={id + "-title"}>
          タイトル
          <input
            id={id + "-title"}
            className="field"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="form-label" htmlFor={id + "-author"}>
          著者
          <input
            id={id + "-author"}
            className="field"
            value={author}
            maxLength={200}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        <label className="form-label" htmlFor={id + "-price"}>
          定価（税込・任意）
          <input
            id={id + "-price"}
            className="field"
            inputMode="numeric"
            placeholder="1540"
            value={price}
            maxLength={9}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button"
          disabled={!title.trim() || looking}
        >
          登録する
        </button>
      </form>
    </Modal>
  );
}
