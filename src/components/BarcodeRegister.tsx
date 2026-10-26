"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  BOOK_PRICE_MAX_LENGTH,
  BOOK_TEXT_MAX,
  normalizeIsbn,
} from "../lib/books";
import { lookUpBook } from "../lib/openbd";
import {
  getTownSnapshot,
  libraryBookByIsbn,
  useTownBackend,
} from "../lib/store";
import {
  FIND_BOOK,
  foundAsNew,
  libraryBookByName,
  SAME_BOOK,
} from "../lib/same-book";
import { useFoundBooks } from "../lib/search/use-found-books";
import { holds } from "../lib/own-books";
import type { Book, TownActions, TownState } from "../lib/types";
import { BookJacket, Icon, Modal } from "./ui";
import { InLibraryMark } from "./RegisterBook";
import {
  authorAndKind,
  bookAuthor,
  bookByIsbn,
  bookTitle,
  quotedTitle,
} from "../lib/book-name";
import { failure, AGAIN, REGISTER, NAMES } from "../lib/words";

type Detector = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};
type DetectorClass = new (options: { formats: string[] }) => Detector;

const detectorClass = (): DetectorClass | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { BarcodeDetector?: DetectorClass })
        .BarcodeDetector;

const NOT_AN_ISBN = failure({
  what: "ISBNとして読めませんでした",
  next: "本の裏表紙にある978か979で始まる13桁の数字を入力してください",
});

/** How many found books the box shows: the best, with room to see them. */
const FOUND_SHOWN = 8;

/**
 * Register a book by scanning its ISBN barcode with the camera (where the browser can
 * read barcodes), or by typing the ISBN. Unknown ISBNs are completed by hand.
 * With `find` (the scanner's ［手で入力］), a box finds books first by title,
 * author or ISBN, each in with one tap; the form waits behind 見つからないとき.
 */
export function BarcodeRegister({
  state,
  actions,
  notify,
  onClose,
  lead = "バーコードで本を登録",
  camera = true,
  startTitle = "",
  startIsbn = null,
  find = false,
}: {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
  onClose: () => void;
  /** The line under the title: what this form is for where it opens. */
  lead?: string;
  /** False over a scanner, which reads barcodes itself: no camera here. */
  camera?: boolean;
  /** The title the form opens with: what was searched for and not found. */
  startTitle?: string;
  /** An ISBN searched for and not found: looked up as the form opens. */
  startIsbn?: string | null;
  /** A box that finds the book first (find_books too), over the form. */
  find?: boolean;
}) {
  const id = useId();
  const savedIn = useTownBackend();
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [isbnText, setIsbnText] = useState("");
  // The ISBN the camera read, to tell a scanned book from a typed one.
  const [scanned, setScanned] = useState<string | null>(null);
  const [title, setTitle] = useState(startTitle);
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
  // The box that finds the book; the form is open from the start without
  // it, and for an ISBN brought here.
  const [typed, setTyped] = useState("");
  const [formOpen, setFormOpen] = useState(!find || Boolean(startIsbn));
  const found = useFoundBooks(state.books, find && !formOpen ? typed : "");
  const typedAsIsbn = normalizeIsbn(typed.trim());

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
        setMessage(
          failure({
            what: "カメラを使えませんでした",
            next: "ISBNを入力してください",
          }),
        );
      });
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // accept is stable enough for a scan session; restarting on every render would reopen the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  // An ISBN brought from a search is looked up at once, as if typed here.
  useEffect(() => {
    if (startIsbn) void accept(startIsbn);
    // Once, as the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // A catalogue's heading ("村上,春樹,1949-") in the shape the reader
      // sees the author everywhere else ("村上春樹").
      author: bookAuthor(book),
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
    const known = mine ?? bookByIsbn(state.books, found);
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
        failure({
          what: "書籍情報を取得できませんでした",
          next: "タイトルと著者を入力して登録できます",
        }),
      );
    }
  }

  // A book typed in by hand named as one already in the library: asked
  // about before it goes in a second time (101). One with another ISBN is
  // another edition, and goes in as it is.
  const typedIsbn = normalizeIsbn(isbnText);
  const named = looking ? undefined : libraryBookByName(state, title, author);
  const alike =
    named && (!typedIsbn || !named.isbn) && named.isbn !== typedIsbn
      ? named
      : undefined;

  /** Said when a register was not kept, as the form says it. */
  const notSaved = () =>
    setMessage(
      savedIn === "unavailable"
        ? failure({
            what: "保存できません",
            next: "ページを読み込み直してから、もう一度登録してください",
          })
        : failure({
            what: "まだ保存できません",
            next: AGAIN.pressWhenLoaded,
          }),
    );

  /** Already in the reader's library: by the book, or its ISBN. */
  const inLibrary = (book: Book) =>
    holds(state, state.library, book.id) ||
    Boolean(book.isbn && libraryBookByIsbn(state, book.isbn));

  /**
   * A found book in with one tap, as by its ISBN, and the box stays open
   * for the next (books with no barcode come several together). Its own
   * book is made from what was found, never pointing at another's.
   */
  function take(book: Book) {
    setMessage("");
    // One with no ISBN is a book of the town's or the reader's own taken
    // out before: that book itself goes in, as 登録 does on the search page.
    if (!book.isbn) {
      actions.toggleLibrary(book.id);
      const town = getTownSnapshot();
      if (holds(town, town.library, book.id))
        notify(REGISTER.added(quotedTitle(book)));
      else notSaved();
      return;
    }
    const done = actions.registerBook(foundAsNew(book), "isbn");
    if (!done) return;
    if (done.result === "not-saved") return notSaved();
    notify(
      done.result === "already"
        ? REGISTER.already(quotedTitle(done))
        : REGISTER.added(quotedTitle(done)),
    );
  }

  /** Not found: the form, with what was typed as its title or ISBN. */
  function openForm() {
    setFormOpen(true);
    setMessage("");
    if (typedAsIsbn) void accept(typedAsIsbn);
    else setTitle(typed.trim());
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
    if (done.result === "not-saved") return notSaved();
    // Named as kept: a book the town knew by its own title, a long one cut.
    notify(
      done.result === "already"
        ? REGISTER.already(quotedTitle(done))
        : REGISTER.added(quotedTitle(done)),
    );
    onClose();
  }

  return (
    <Modal title="本を登録" onClose={onClose}>
      <p className="modal-lead">{lead}</p>
      {(camera || formOpen) && (
        <p className="muted">
          {camera
            ? `裏表紙のISBNバーコード（978・979で始まる段）を読み取ります。登録した本は、読書の開始や${NAMES.letter}で選べます。`
            : "ISBNがあれば探せます。書名だけでも登録できます。"}
        </p>
      )}
      {!camera ? null : scanning ? (
        <div className="scan-frame">
          <video ref={video} muted playsInline aria-label="カメラの映像" />
          <button
            type="button"
            className="btn"
            onClick={() => setScanning(false)}
          >
            読み取りをやめる
          </button>
        </div>
      ) : (
        canScan && (
          <button
            type="button"
            className="btn fill register-camera"
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
      {camera && !canScan && (
        <p className="note-box">
          {failure({
            what: "このブラウザはバーコードの読み取りに対応していません",
            next: "ISBNを入力してください",
          })}
        </p>
      )}
      {!formOpen && (
        <div className="register-find">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              // Enter puts the keyboard away: the books are the choice.
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            <label className="search-box" htmlFor={id + "-find"}>
              <Icon name="search" size={19} />
              <span className="sr-only">{FIND_BOOK.label}</span>
              <input
                id={id + "-find"}
                type="search"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setMessage("");
                }}
                placeholder={FIND_BOOK.placeholder}
                enterKeyHint="search"
                autoComplete="off"
              />
            </label>
          </form>
          {message && (
            <p className="register-message" role="status">
              {message}
            </p>
          )}
          {found.query && (
            <ul className="search-list" aria-label={FIND_BOOK.found}>
              {[...found.found, ...found.near]
                // Another reader's book with no ISBN is theirs to name.
                .filter(({ book }) => book.isbn || !book.theirs)
                .slice(0, FOUND_SHOWN)
                .map(({ book }) => {
                  const done = inLibrary(book);
                  return (
                    <li key={book.id} className="search-book-row">
                      <div className="search-book">
                        <BookJacket
                          book={book}
                          className="search-jacket"
                          mark={<InLibraryMark book={book} state={state} />}
                        />
                        <span>
                          <b>{bookTitle(book)}</b>
                          <small>{authorAndKind(book)}</small>
                        </span>
                      </div>
                      <button
                        type="button"
                        className={[
                          "btn",
                          done ? "is-in" : "soft",
                          "register-book",
                        ].join(" ")}
                        aria-label={`${quotedTitle(book)}を${REGISTER.button}`}
                        aria-pressed={done}
                        onClick={() =>
                          done
                            ? notify(REGISTER.already(quotedTitle(book)))
                            : take(book)
                        }
                      >
                        <Icon name={done ? "check" : "plus"} size={18} />
                        <span className="register-label">
                          <span>{done ? REGISTER.doneTap : REGISTER.tap}</span>
                          <span aria-hidden="true">
                            {done ? REGISTER.tap : REGISTER.doneTap}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
          {!typed.trim() ? (
            <div className="register-find-not">
              <button type="button" className="btn" onClick={openForm}>
                <Icon name="plus" size={16} />
                {FIND_BOOK.byHand}
              </button>
            </div>
          ) : (
            found.settled && (
              <div className="register-find-not">
                <span>{FIND_BOOK.notFound}</span>
                <button type="button" className="btn" onClick={openForm}>
                  <Icon name={typedAsIsbn ? "barcode" : "plus"} size={16} />
                  {typedAsIsbn ? REGISTER.byIsbn : REGISTER.byTitle}
                </button>
              </div>
            )
          )}
        </div>
      )}
      {formOpen && (
        <>
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
            <button type="submit" className="btn" disabled={looking}>
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
                maxLength={BOOK_TEXT_MAX}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="form-label" htmlFor={id + "-author"}>
              著者
              <input
                id={id + "-author"}
                className="field"
                value={author}
                maxLength={BOOK_TEXT_MAX}
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
                maxLength={BOOK_PRICE_MAX_LENGTH}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            {alike && (
              <div className="register-same" role="status">
                <b>{SAME_BOOK.ask}</b>
                <div className="register-same-book">
                  <BookJacket book={alike} className="search-jacket" />
                  <span>
                    <b>{bookTitle(alike)}</b>
                    <small>{bookAuthor(alike)}</small>
                    <small>{SAME_BOOK.inLibrary}</small>
                  </span>
                </div>
                <button
                  type="button"
                  className="btn fill"
                  onClick={() => {
                    notify(REGISTER.already(quotedTitle(alike)));
                    onClose();
                  }}
                >
                  {SAME_BOOK.same}
                </button>
              </div>
            )}
            <button
              type="submit"
              className={alike ? "btn" : "btn fill"}
              disabled={!title.trim() || looking}
            >
              {alike ? SAME_BOOK.another : "登録する"}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
