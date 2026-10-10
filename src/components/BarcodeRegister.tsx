"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { normalizeIsbn } from "../lib/books";
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

/** Looks an ISBN up in openBD. Any failure falls back to typing the title by hand. */
async function lookup(
  isbn: string,
): Promise<{ title: string; author: string } | null> {
  try {
    const response = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
    if (!response.ok) return null;
    const [record] = (await response.json()) as Array<{
      summary?: { title?: string; author?: string };
    } | null>;
    const title = record?.summary?.title?.trim();
    return title
      ? {
          title,
          author: (record?.summary?.author ?? "").replace(/／著.*$/, "").trim(),
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Register a book by scanning its ISBN barcode with the camera (where the browser can
 * read barcodes), or by typing the ISBN. Unknown ISBNs are completed by hand.
 */
export function BarcodeRegister({
  state,
  actions,
  notify,
  onClose,
}: {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [isbnText, setIsbnText] = useState("");
  const [isbn, setIsbn] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [message, setMessage] = useState("");
  const [looking, setLooking] = useState(false);
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

  async function accept(found: string) {
    setIsbn(found);
    setIsbnText(found);
    const known = state.books.find((book) => book.isbn === found);
    if (known) {
      setTitle(known.title);
      setAuthor(known.author);
      setMessage("この本はもう登録されています。");
      return;
    }
    setLooking(true);
    setMessage("書籍情報を探しています…");
    const record = await lookup(found);
    setLooking(false);
    if (record) {
      setTitle(record.title);
      setAuthor(record.author);
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
      setMessage(
        "ISBNとして読めませんでした。本の裏表紙にある978か979で始まる13桁の数字を入力してください。",
      );
      return;
    }
    void accept(found);
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bookId = actions.addBook({
      title,
      author,
      ...(isbn ? { isbn } : {}),
    });
    if (!bookId) {
      setMessage("タイトルを入力してください。");
      return;
    }
    notify(`『${title.trim()}』を登録しました`);
    onClose();
  }

  return (
    <Modal title="本を登録" onClose={onClose}>
      <p className="modal-lead">バーコードで本を登録</p>
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
            className="button"
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
              setIsbn(null);
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
