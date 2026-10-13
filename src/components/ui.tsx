"use client";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { Book, Reader } from "../lib/types";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { bookArt } from "../lib/book-art";
import { REGISTERED_GENRE } from "../lib/books";
import {
  countGoogleCover,
  countGoogleMark,
  useCover,
  useGoogleCoversShown,
} from "../lib/covers";
import { useBackLayer } from "../lib/back-layer";
import { focusesFieldOnOpen } from "../lib/coarse-pointer";
import { imeKey } from "../lib/keys";
import "./illustrated-jackets.css";
const shapes: Record<string, ReactNode> = {
  book: (
    <>
      <path d="M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z" />
      <path d="M12 6v15" />
    </>
  ),
  store: (
    <>
      <path d="M3 9h18l-2-6H5Zm1 0v12h16V9M9 21v-7h6v7" />
      <path d="M3 9v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  star: (
    <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2-4.5-4.4 6.3-.9Z" />
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  pen: (
    <>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </>
  ),
  quill: (
    <>
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <path d="M16 8 2 22M17.5 15H9" />
    </>
  ),
  typewriter: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 13h.01M10 13h.01M13 13h.01M16 13h.01M8 20h8M6 17l-1 3M18 17l1 3" />
    </>
  ),
  link: (
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  ),
  bell: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  reading: (
    <>
      <path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2z" />
      <path d="M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  camera: (
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  barcode: <path d="M3 5v14M6 5v14M10 5v14M12 5v14M15 5v14M18 5v14M21 5v14" />,
  settings: (
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  edit: (
    <>
      <path d="m16 3 5 5-12 12-6 1 1-6Z" />
      <path d="m14 5 5 5" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3c-16-2-20 16-10 18 10 0 10-11 10-18Z" />
      <path d="M4 21 15 9" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 6h4l10 12h4m-4-4 4 4-4 4M3 18h4L17 6h4m-4-4 4 4-4 4" />
    </>
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18m-13-4-5 4 5 4m8-8 5 4-5 4M8 7l4-4 4 4m-8 10 4 4 4-4" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="5" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="19" r="1" />
    </>
  ),
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  follow: (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 21v-1a7 7 0 0 1 11-5.7M19 14v6m-3-3h6" />
    </>
  ),
  share: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name] || shapes.book}
    </svg>
  );
}
/** A title short enough, and Japanese, to be set top to bottom on a 装丁カード. */
const tateTitle = (title: string) =>
  title.length <= 14 &&
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(title) &&
  !/[A-Za-z0-9]{3}/.test(title);

/**
 * The size a 装丁カード title is set at top to bottom: large while it fits one
 * column, then smaller, and in two even columns past ten characters.
 */
function tateSize(characters: number): string {
  const column = characters > 10 ? Math.ceil(characters / 2) : characters;
  return Math.min(13, 96 / (column * 1.14)).toFixed(2) + "cqw";
}

/**
 * A book's face: its real cover when a source has one (see covers.ts), shown
 * as served, or else its BookTown 装丁カード, drawn from its title and author.
 */
export function BookJacket({
  book,
  className = "",
  onClick,
  illustrated = false,
  author = book.author,
  artIndex,
}: {
  book: Book;
  className?: string;
  onClick?: () => void;
  illustrated?: boolean;
  /** Shown on the jacket; a shelf may pass a short form of the name. */
  author?: string;
  /** Atlas panel chosen by the screen, so neighbouring covers differ. */
  artIndex?: number;
}) {
  const found = useCover(book.coverUrl ? undefined : book.isbn);
  const coverUrl = book.coverUrl ?? found?.url;
  const [loaded, setLoaded] = useState<string | null>(null);
  const covered = Boolean(coverUrl) && loaded === coverUrl;
  const fromGoogle = covered && !book.coverUrl && found?.source === "google";
  useEffect(() => (fromGoogle ? countGoogleCover() : undefined), [fromGoogle]);

  const art = illustrated ? bookArt(book, artIndex) : null;
  className += illustrated ? " is-illustrated" : "";
  const tate =
    !illustrated && book.genre === REGISTERED_GENRE && tateTitle(book.title);
  className += tate ? " is-tate" : "";
  className += covered ? " has-cover" : "";
  const style = {
    background: book.color,
    color: art?.ink ?? book.ink,
    "--jacket-ink": book.ink,
    "--art-x": art?.x,
    "--art-y": art?.y,
    "--art-shade": art?.light ? "#f6f0dc50" : "#101e3580",
    "--art-shadow": art?.light ? "#f5ecce" : "#10252d",
    "--tate-size": tate ? tateSize([...book.title].length) : undefined,
  } as CSSProperties;
  const content = (
    <>
      {coverUrl ? (
        <Image
          key={coverUrl}
          className="jacket-image"
          src={coverUrl}
          alt=""
          loading="lazy"
          fill
          sizes="160px"
          unoptimized
          onLoad={() => setLoaded(coverUrl)}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      <span className="jacket-edge" />
      {illustrated ? (
        <span className="jacket-illustration" />
      ) : (
        <span className={`jacket-art pattern-${book.pattern % 6}`}>
          <i />
          <i />
          <i />
        </span>
      )}
      <span className="jacket-series">BOOK TOWN EDITIONS</span>
      <span className="jacket-title">{book.title}</span>
      <span className="jacket-author">{author}</span>
      <span className="jacket-imprint">本の街 文庫</span>
    </>
  );
  return onClick ? (
    <button
      className={"book-jacket " + className}
      style={style}
      onClick={onClick}
      aria-label={book.title + "の詳細"}
    >
      {content}
    </button>
  ) : (
    <div
      className={"book-jacket " + className}
      style={style}
      role="img"
      aria-label={
        book.title + (covered ? "の表紙" : "の表紙（BookTownの装丁カード）")
      }
    >
      {content}
    </div>
  );
}

/**
 * Where a book's cover came from, beside the book: Google's mark and a link to
 * the book on Google Books, or openBD's name. Nothing for a 装丁カード.
 */
export function CoverCredit({ book }: { book: Book }) {
  const cover = useCover(book.coverUrl ? undefined : book.isbn);
  const google = cover?.source === "google";
  useEffect(() => (google ? countGoogleMark() : undefined), [google]);
  if (!cover) return null;
  return cover.source === "google" ? (
    <span className="cover-credit">
      表紙: <span className="powered-by-google">powered by Google</span>
      {cover.link ? (
        <>
          {" ・ "}
          <a href={cover.link} target="_blank" rel="noopener noreferrer">
            Google Books でこの本を見る
          </a>
        </>
      ) : null}
    </span>
  ) : (
    <span className="cover-credit">表紙: openBD（版元ドットコム）</span>
  );
}

/** Google's mark for the page, while any of its covers is on screen. */
export function GoogleCoversCredit() {
  return useGoogleCoversShown() ? (
    <p className="google-covers-credit">
      表紙の一部: <span className="powered-by-google">powered by Google</span>
    </p>
  ) : null;
}
export function ReaderAvatar({
  reader,
  size = 40,
}: {
  reader: Reader;
  size?: number;
}) {
  return (
    <span
      className="reader-avatar"
      style={{
        width: size,
        height: size,
        background: reader.color,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden="true"
    >
      {reader.name.slice(0, 1)}
      <i />
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  writing = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /**
   * A sheet mainly for writing. On a touch screen it opens without the
   * keyboard over it: the focus starts on its first button, not its field.
   */
  writing?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const writingRef = useRef(writing);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // 戻る closes the dialog; closing it takes that step back off.
  const layer = useBackLayer(onClose);
  const router = useRouter();
  const leaveRef = useRef(layer.leave);
  useEffect(() => {
    leaveRef.current = layer.leave;
  });
  useEffect(() => {
    // A link inside the dialog leaves from the page beneath it, so that 戻る
    // from there returns to the page and not to a dialog already closed.
    const dialog = ref.current;
    const follow = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download") ||
        link.origin !== location.origin
      )
        return;
      event.preventDefault();
      const href = link.pathname + link.search + link.hash;
      leaveRef.current(() => router.push(href));
      closeRef.current();
    };
    dialog?.addEventListener("click", follow, true);
    return () => dialog?.removeEventListener("click", follow, true);
  }, [router]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      (focusesFieldOnOpen(writingRef.current)
        ? ref.current?.querySelector<HTMLElement>("input,textarea,select")
        : null) ?? ref.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // One Escape closes one layer: a book in hand beneath (a native
        // <dialog>) would otherwise take it as its own close request too.
        e.preventDefault();
        // The Escape that cancels a kana conversion is the keyboard's: the
        // dialog and what is written in it stay.
        if (!imeKey(e)) closeRef.current();
      }
      if (e.key === "Tab") {
        const all = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]',
          ) || [],
        );
        if (e.shiftKey && document.activeElement === all[0]) {
          e.preventDefault();
          all.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
          e.preventDefault();
          all[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-top">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
