"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useAccountState } from "../lib/account-session";
import { useBackLayer } from "../lib/back-layer";
import {
  forgetReader,
  guideRect,
  loadDetector,
  readerKind,
} from "../lib/barcode-reader";
import { normalizeIsbn } from "../lib/books";
import {
  heldItem,
  journalOwner,
  keepRead,
  libraryJournal,
  sendJournal,
  undoScan,
  useJournal,
  useJournalKept,
  type ScanItemState,
  type Sent,
} from "../lib/library-journal";
import { saveWarning } from "../lib/persistence";
import {
  closingNotice,
  forgetRead,
  nextFrame,
  noteOther,
  noteRead,
  noteTaken,
  NO_READS,
  readBarcode,
  scanReaction,
  SCAN_COPY,
  stillInView,
  type InView,
  type SessionReads,
} from "../lib/scan";
import {
  journalTown,
  libraryBookByIsbn,
  usePersistenceStatus,
  useTownBackend,
  useTownReady,
} from "../lib/store";
import type { Book, Notify, TownActions, TownState } from "../lib/types";
import { BarcodeRegister } from "./BarcodeRegister";
import { BookJacket, GoogleCoversCredit, Icon } from "./ui";
import "./scan.css";

// The continuous scanner (plan 7-1, flow A): the camera stays open and every
// book read is registered at once, with no question about reading status,
// shelf or visibility. Two taps in all: open, and ［終わる］. Barcodes are
// read by the browser's own reader, or by ZXing in WebAssembly where there is
// none (Safari on the iPhone; barcode-reader.ts). Where neither can, or the
// camera is refused, ISBNs are typed one after another instead. Every read
// goes into the scan journal first (library-journal.ts), so a book read
// offline, while the town loads, or just before the tab is closed is
// registered later.

const canRead = () =>
  Boolean(readerKind() && navigator.mediaDevices?.getUserMedia);
/**
 * A computer whose browser has no reader of its own (Chrome on Windows and
 * Linux, Firefox) starts typing: its camera, most often one that cannot
 * focus near, is asked for only on ［カメラで読む］.
 */
const startsTyping = () =>
  readerKind() === "wasm" && !window.matchMedia?.("(pointer: coarse)").matches;
/** This many reads failing in a row: the reader is not working. */
const FAILS_TO_STOP = 5;

/**
 * Why ISBNs are typed: the browser, the reader not loaded this time, the
 * camera, or the reader's choice.
 */
type TypingWhy =
  "no-reader" | "reader-failed" | "denied" | "no-camera" | "busy" | "chosen";
type Input =
  | { kind: "camera"; phase: "starting" | "running" | "hidden" | "manual" }
  | { kind: "typing"; why: TypingWhy };

/** What a book read in this session came to, as its card shows it. */
type Shows =
  | "looking"
  | "added"
  | "already"
  | "untitled"
  | "offline"
  | "waiting"
  | "unavailable"
  | "refused"
  | "undone";
interface Card {
  /** The journal item's id (or a book entered by hand). */
  id: string;
  isbn?: string;
  bookId?: string;
  title?: string;
  author?: string;
  shows: Shows;
}
/** What the card says instead of its own state, for a read that changed nothing. */
type Say =
  | "same"
  | "again-in"
  | "again-already"
  | "again-held"
  | "already"
  | "held"
  | "undone"
  | "not-yet";
interface Current {
  cardId?: string;
  /** A book not in this session's cards (in the library, or held). */
  book?: Book;
  isbn?: string;
  title?: string;
  say?: Say;
}

const KEPT: Shows[] = [
  "looking",
  "untitled",
  "offline",
  "waiting",
  "unavailable",
];
const UNDOABLE: Shows[] = ["added", ...KEPT];

/** What a card shows once its read was sent. */
function showsOf(
  result: Sent["result"],
  savedIn: ReturnType<typeof useTownBackend>,
): Shows {
  switch (result) {
    case "added":
    case "already":
    case "untitled":
      return result;
    case "lookup":
      // openBD did not answer in time: as untitled until it does (10-9).
      return navigator.onLine === false ? "offline" : "untitled";
    case "waiting":
      return savedIn === "unavailable" ? "unavailable" : "waiting";
    default:
      return "unavailable";
  }
}

/**
 * The session's books by what they came to: registered, waiting for a
 * title (書名待ち), and kept on the device for another reason. A refusal
 * after the card said 登録しました takes it back.
 */
function tally(cards: Card[], states: Map<string, ScanItemState>) {
  const shown = (card: Card): Shows =>
    states.get(card.id) === "refused" ? "refused" : card.shows;
  const count = (...kinds: Shows[]) =>
    cards.filter((card) => kinds.includes(shown(card))).length;
  return {
    added: count("added"),
    waiting: count("untitled", "offline"),
    later: count("looking", "waiting", "unavailable"),
  };
}

const SAYS: Record<Say, string> = {
  same: SCAN_COPY.card.same,
  "again-in": SCAN_COPY.card.againIn,
  "again-already": SCAN_COPY.card.already,
  "again-held": SCAN_COPY.card.held,
  already: SCAN_COPY.card.already,
  held: SCAN_COPY.card.held,
  undone: SCAN_COPY.card.undone,
  "not-yet": SCAN_COPY.card.notYet,
};

const subscribeOnline = (changed: () => void) => {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
};
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );

const SOUND_KEY = "book-town-scan-sound";
type Sound = "in" | "nothing-new";

/**
 * A short tone when a book is taken in, two lower ones when nothing is new;
 * the same as a short vibration where the device has one. ♪ turns the sound
 * off (vibration is silent and stays), and this device remembers it.
 */
function useScanSound() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  }, [on]);
  const context = useRef<AudioContext | null>(null);
  useEffect(
    () => () => {
      void context.current?.close().catch(() => {});
      context.current = null;
    },
    [],
  );
  // Phones start sound only from a tap: every tap in the scanner wakes it.
  const wake = useCallback(() => {
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return;
      context.current ??= new Context();
      if (context.current.state === "suspended")
        void context.current.resume().catch(() => {});
    } catch {
      // No sound on this device.
    }
  }, []);
  const play = useCallback(
    (sound: Sound) => {
      try {
        if (typeof navigator.vibrate === "function")
          navigator.vibrate(sound === "in" ? 30 : [20, 60, 20]);
      } catch {
        // Vibration refused: the sound and the card still tell.
      }
      if (!onRef.current) return;
      wake();
      const audio = context.current;
      if (!audio) return;
      const tone = (
        hz: number,
        after: number,
        length: number,
        peak: number,
      ) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + after;
        oscillator.type = "sine";
        oscillator.frequency.value = hz;
        // From near silence and back, so it never clicks.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
      };
      if (sound === "in") tone(1046.5, 0, 0.08, 0.18);
      else {
        tone(587, 0, 0.07, 0.14);
        tone(440, 0.1, 0.09, 0.14);
      }
    },
    [wake],
  );
  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      if (next) localStorage.removeItem(SOUND_KEY);
      else localStorage.setItem(SOUND_KEY, "off");
    } catch {
      // Remembered for this time only.
    }
    if (next) wake();
  };
  return { on, toggle, play, wake };
}

export function ScanSession({
  state,
  actions,
  notify,
  onClose,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
  /** `kept`: whether any book was registered or kept in this session. */
  onClose: (kept: boolean) => void;
}) {
  const id = useId();
  const savedIn = useTownBackend();
  const owner = journalOwner(useAccountState(), savedIn);
  const persistence = usePersistenceStatus();
  const ready = useTownReady();
  const online = useOnline();
  const items = useJournal(owner);
  const journalKept = useJournalKept();
  const sound = useScanSound();
  const [session] = useState(() => libraryJournal.newSession());
  const [input, setInput] = useState<Input>(() =>
    !canRead()
      ? { kind: "typing", why: "no-reader" }
      : startsTyping()
        ? { kind: "typing", why: "chosen" }
        : { kind: "camera", phase: "starting" },
  );
  /** ［ライト］: null where the camera has no light; on or off, as set here. */
  const [torch, setTorch] = useState<boolean | null>(null);
  const torchTrack = useRef<MediaStreamTrack | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [flash, setFlash] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const reads = useRef<SessionReads>(NO_READS);
  const inView = useRef<InView>({});
  const flashedAt = useRef(0);
  const manualCount = useRef(0);
  const closed = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLSpanElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const shelf = useRef<HTMLOListElement>(null);

  // What the async camera loop and the sends read: the latest render's.
  const latest = useRef({ owner, ready, online, savedIn, manual, cards });
  useEffect(() => {
    latest.current = { owner, ready, online, savedIn, manual, cards };
  });

  // An open session handles its own items; the page's sender leaves them.
  useEffect(() => {
    libraryJournal.live.add(session);
    return () => {
      libraryJournal.live.delete(session);
    };
  }, [session]);

  const states = new Map(items.map((item) => [item.id, item.state]));
  const shown = (card: Card): Shows =>
    states.get(card.id) === "refused" ? "refused" : card.shows;
  const { added, waiting, later } = tally(cards, states);

  /** Updates the cards from what sending their items came to. */
  const settle = useCallback((sent: Sent[]) => {
    if (!sent.length) return;
    const { savedIn: where } = latest.current;
    for (const { item, result } of sent) {
      if (result === "added")
        reads.current = noteTaken(reads.current, item.isbn, "in");
      if (result === "already")
        reads.current = noteTaken(reads.current, item.isbn, "already");
    }
    const byId = new Map(sent.map((entry) => [entry.item.id, entry]));
    setCards((list) =>
      list.map((card) => {
        const entry = byId.get(card.id);
        if (!entry || card.shows === "undone") return card;
        return {
          ...card,
          shows: showsOf(entry.result, where),
          bookId: entry.item.bookId,
          title: entry.item.title ?? card.title,
          author: entry.item.author ?? card.author,
        };
      }),
    );
    // The card shows what its read came to, over a remark about it.
    setCurrent((shownNow) =>
      shownNow?.cardId && byId.has(shownNow.cardId)
        ? { cardId: shownNow.cardId }
        : shownNow,
    );
  }, []);

  // The sends this session started that have not answered yet (openBD is
  // being asked): ［終わる］ waits for them to say where those books went.
  const inFlight = useRef(new Set<Promise<Sent[]>>());
  const send = useCallback(
    (reader: string, ids: string[]) => {
      const sending = sendJournal(libraryJournal, reader, journalTown, {
        only: ids,
      });
      inFlight.current.add(sending);
      const done = () => inFlight.current.delete(sending);
      void sending.then((sent) => {
        done();
        settle(sent);
      }, done);
    },
    [settle],
  );

  const flashCard = () => {
    const now = Date.now();
    // Once: not again while a flash is still showing.
    if (now - flashedAt.current < 800) return;
    flashedAt.current = now;
    setFlash(now);
  };
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(0), 900);
    return () => clearTimeout(timer);
  }, [flash]);

  /** One ISBN read, by the camera or typed. */
  function onRead(isbn: string, via: "scan" | "isbn") {
    const {
      owner: reader,
      ready: townReady,
      cards: shownCards,
    } = latest.current;
    if (!reader) return;
    const at = Date.now();
    const town = journalTown.state();
    const generation = journalTown.generation();
    const reaction = scanReaction(
      reads.current,
      isbn,
      at,
      townReady
        ? {
            inLibrary: (code) => libraryBookByIsbn(town, code),
            known: (code) => town.books.find((book) => book.isbn === code),
          }
        : null,
      (code) => heldItem(libraryJournal, reader, generation, code),
    );
    setHint(null);
    // Every read shows on the card: on an iPhone there is no vibration, and
    // in silent mode no sound either.
    flashCard();
    if (reaction.kind === "same") {
      reads.current = noteRead(reads.current, isbn, at, null);
      setCurrent((shownNow) => ({ ...(shownNow ?? {}), say: "same" }));
      return;
    }
    if (reaction.kind !== "new") {
      sound.play("nothing-new");
      if (reaction.kind === "again") {
        reads.current = noteRead(reads.current, isbn, at, null);
        const card = shownCards.findLast((entry) => entry.isbn === isbn);
        const book = libraryBookByIsbn(town, isbn);
        setCurrent({
          ...(card ? { cardId: card.id } : book ? { book } : { isbn }),
          say: `again-${reaction.was}`,
        });
      } else if (reaction.kind === "already") {
        reads.current = noteRead(reads.current, isbn, at, "already");
        setCurrent({ book: reaction.book, say: "already" });
      } else {
        reads.current = noteRead(reads.current, isbn, at, "held");
        setCurrent({ isbn, title: reaction.item.title, say: "held" });
      }
      return;
    }
    sound.play("in");
    const { known } = reaction;
    const item = keepRead(libraryJournal, reader, {
      session,
      isbn,
      via,
      ...(known
        ? {
            known: {
              title: known.title,
              author: known.author,
              ...(known.price ? { price: known.price } : {}),
            },
          }
        : {}),
    });
    reads.current = noteRead(reads.current, isbn, at, "held");
    setCards((list) => [
      ...list,
      {
        id: item.id,
        isbn,
        bookId: item.bookId,
        title: item.title,
        author: item.author,
        shows: "looking",
      },
    ]);
    setCurrent({ cardId: item.id });
    send(reader, [item.id]);
  }

  /** One camera frame's codes. */
  function onFrame(codes: string[]) {
    const at = Date.now();
    const frame = nextFrame(inView.current, codes);
    inView.current = frame.inView;
    reads.current = stillInView(reads.current, frame.staying, at);
    for (const code of frame.fresh) {
      if (code.kind === "isbn") onRead(code.isbn, "scan");
      else {
        const noted = noteOther(reads.current, code.kind);
        reads.current = noted.reads;
        if (noted.hint) setHint(noted.hint);
      }
    }
  }
  const handlers = useRef({ onRead, onFrame });
  useEffect(() => {
    handlers.current = { onRead, onFrame };
  });

  // Once the town can take them, and when the network comes back, this
  // session's waiting books are sent again.
  useEffect(() => {
    if (!owner || !ready) return;
    const ids = latest.current.cards.map((card) => card.id);
    if (ids.length) send(owner, ids);
  }, [owner, ready, online, send]);

  // The camera, with a barcode reader, while it is wanted.
  const cameraOn =
    input.kind === "camera" &&
    (input.phase === "starting" || input.phase === "running");
  useEffect(() => {
    if (!cameraOn) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const typeInstead = (why: TypingWhy) => {
      if (!stopped) setInput({ kind: "typing", why });
    };
    const element = video.current;
    if (!element || !canRead()) {
      typeInstead("no-reader");
      return;
    }
    // ZXing is given a larger picture than the browser's own size, which
    // can be small (Safari).
    const size: MediaTrackConstraints =
      readerKind() === "wasm"
        ? { width: { ideal: 1920 }, height: { ideal: 1080 } }
        : {};
    const ask = (video: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia({ video, audio: false });
    const why = (error: unknown): TypingWhy | "retry" => {
      const name = (error as { name?: string } | null)?.name;
      if (name === "NotAllowedError" || name === "SecurityError")
        return "denied";
      if (name === "NotFoundError" || name === "OverconstrainedError")
        return "retry";
      return "busy";
    };
    /** The camera, or why there is none. */
    const openCamera = async (): Promise<MediaStream | TypingWhy> => {
      try {
        return await ask({ facingMode: { ideal: "environment" }, ...size });
      } catch (error) {
        const first = why(error);
        if (first !== "retry") return first;
        // The back camera could not be had: any camera, once.
        try {
          return await ask(size);
        } catch (again) {
          const second = why(again);
          return second === "retry" ? "no-camera" : second;
        }
      }
    };
    void (async () => {
      // Both at once: loading the reader does not hold up the camera's
      // question.
      const [reader, camera] = await Promise.all([
        loadDetector(),
        openCamera(),
      ]);
      const media = typeof camera === "string" ? null : camera;
      stream = media;
      const giveUp = (why: TypingWhy) => {
        media?.getTracks().forEach((track) => track.stop());
        typeInstead(why);
      };
      if (stopped) {
        media?.getTracks().forEach((track) => track.stop());
        return;
      }
      // The browser first, then the camera, then this time's network.
      if (!reader.ok && reader.why === "no-reader") return giveUp("no-reader");
      if (!media) return typeInstead(camera as TypingWhy);
      if (!reader.ok) return giveUp(reader.why);
      const track = media.getVideoTracks()[0];
      // Another app took the camera, or the permission went: type instead.
      track?.addEventListener("ended", () => typeInstead("busy"));
      void track
        ?.applyConstraints({
          advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
        })
        .catch(() => {});
      // ［ライト］ only where the camera has one. Whether it is on is kept
      // here: Safari before 18.4 reports it wrongly (WebKit bug 280970).
      const light = (
        track?.getCapabilities?.() as { torch?: boolean } | undefined
      )?.torch;
      torchTrack.current = light ? track : null;
      setTorch(light ? false : null);
      element.srcObject = media;
      try {
        await element.play();
      } catch {
        // The picture would not start: paused, and ［続ける］ (a tap) starts
        // it again.
        if (!stopped)
          setInput((now) =>
            now.kind === "camera" ? { kind: "camera", phase: "hidden" } : now,
          );
        return;
      }
      if (stopped) return;
      setInput((now) =>
        now.kind === "camera" ? { kind: "camera", phase: "running" } : now,
      );
      const detector = new reader.Detector({ formats: ["ean_13"] });
      // ZXing reads the guide's band only, drawn into the one canvas: the
      // whole frame would be a new canvas of its size at every read. The
      // browser's own reader takes the video as it is.
      const band = reader.wasm
        ? document
            .createElement("canvas")
            .getContext("2d", { willReadFrequently: true })
        : null;
      const frame = () => {
        if (!band) return element;
        const view = element.getBoundingClientRect();
        const box = guide.current?.getBoundingClientRect();
        const rect = guideRect(
          { width: element.videoWidth, height: element.videoHeight },
          view,
          box
            ? {
                x: 0,
                y: box.top - view.top,
                width: view.width,
                height: box.height,
              }
            : { x: 0, y: 0, width: view.width, height: view.height },
        );
        if (!rect) return null;
        const canvas = band.canvas;
        if (canvas.width !== rect.width) canvas.width = rect.width;
        if (canvas.height !== rect.height) canvas.height = rect.height;
        band.drawImage(
          element,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          0,
          0,
          rect.width,
          rect.height,
        );
        return band.getImageData(0, 0, rect.width, rect.height);
      };
      let failed = 0;
      const look = async () => {
        if (stopped) return;
        // Until the reader's account is known nothing is read, and a book
        // held in view meanwhile is still new once it is.
        if (element.readyState >= 2 && latest.current.owner) {
          let codes: string[] = [];
          try {
            const image = frame();
            if (image)
              codes = (await detector.detect(image)).map(
                (code) => code.rawValue,
              );
            failed = 0;
          } catch {
            // A frame the reader could not read: the next one may. Five in
            // a row, and the reader is not working: it is let go.
            if (++failed >= FAILS_TO_STOP) {
              if (reader.wasm) forgetReader();
              return giveUp("reader-failed");
            }
          }
          if (stopped) return;
          handlers.current.onFrame(codes);
        }
        timer = setTimeout(look, 200);
      };
      void look();
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      element.srcObject = null;
      inView.current = {};
      torchTrack.current = null;
    };
  }, [cameraOn]);

  /** ［ライト］: on, off. */
  function switchTorch() {
    const track = torchTrack.current;
    if (!track || torch === null) return;
    const next = !torch;
    void track
      .applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      })
      .then(
        () => {
          if (torchTrack.current === track) setTorch(next);
        },
        () => {},
      );
  }

  // Leaving the page pauses the camera; coming back waits for ［続ける］.
  useEffect(() => {
    if (!cameraOn) return;
    const hidden = () => {
      if (document.visibilityState === "hidden")
        setInput({ kind: "camera", phase: "hidden" });
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [cameraOn]);

  // Typing: what was typed while the account was being checked counts now.
  function takeTyped(text: string): boolean {
    const digits = text.replace(/[\s-]/g, "");
    const barcode = readBarcode(digits);
    if (barcode.kind === "isbn") {
      handlers.current.onRead(barcode.isbn, "isbn");
      setTyped("");
      setProblem(null);
      return true;
    }
    setProblem(
      barcode.kind === "price"
        ? SCAN_COPY.typing.price
        : barcode.kind === "magazine"
          ? SCAN_COPY.typing.magazine
          : SCAN_COPY.typing.badIsbn,
    );
    // Selected, so the next keystroke starts again.
    requestAnimationFrame(() => field.current?.select());
    return false;
  }
  useEffect(() => {
    if (!owner) return;
    const digits = typed.replace(/[\s-]/g, "");
    if (/^\d{13}$/.test(digits)) takeTyped(digits);
    // Only when the owner becomes known; typing is handled as it is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  function changeTyped(text: string) {
    setTyped(text);
    setProblem(null);
    if (!owner) return;
    if (/^\d{13}$/.test(text.replace(/[\s-]/g, ""))) takeTyped(text);
  }
  function submitTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!owner || !typed.trim()) return;
    const isbn = normalizeIsbn(typed);
    takeTyped(isbn ?? typed);
  }
  // The keyboard stays up: buttons beside the field never take the focus.
  const keepFocus = (event: { preventDefault(): void }) =>
    event.preventDefault();
  const typing = input.kind === "typing";
  const refocus = () => {
    if (typing) field.current?.focus();
  };

  // The field gets the focus as the scanner opens, in the same tap.
  useLayoutEffect(() => {
    if (typing) field.current?.focus();
  }, [typing]);

  // While typing, the scanner is as tall as what the keyboard leaves.
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = sheet.current;
    if (!typing || !viewport || !element) return;
    const fit = () => {
      element.style.setProperty("--scan-height", viewport.height + "px");
      element.style.setProperty("--scan-top", viewport.offsetTop + "px");
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      element.style.removeProperty("--scan-height");
      element.style.removeProperty("--scan-top");
    };
  }, [typing]);

  const lastCard = cards.at(-1);
  function undo() {
    refocus();
    if (!owner || !lastCard) return;
    if (
      undoScan(libraryJournal, owner, journalTown, lastCard.id) === "not-yet"
    ) {
      setCurrent({ cardId: lastCard.id, say: "not-yet" });
      return;
    }
    if (lastCard.isbn) reads.current = forgetRead(reads.current, lastCard.isbn);
    setCards((list) =>
      list.map((card) =>
        card.id === lastCard.id ? { ...card, shows: "undone" } : card,
      ),
    );
    setCurrent({ cardId: lastCard.id, say: "undone" });
  }

  // ［手で入力］: the one-book form over the scanner. What it registers joins
  // this session, by what registerBook answered and nothing else.
  const manualActions = useMemo<TownActions>(
    () => ({
      ...actions,
      registerBook(book, via, bookId) {
        const done = actions.registerBook(book, via, bookId);
        const isbn = book.isbn ? normalizeIsbn(book.isbn) : null;
        const reader = latest.current.owner;
        // The same book read before and kept for want of its title is in
        // the library now: sent again, the journal lets it go.
        if (done && done.result !== "not-saved" && isbn && reader) {
          const held = libraryJournal
            .items(reader)
            .filter((item) => item.isbn === isbn)
            .map((item) => item.id);
          if (held.length) send(reader, held);
        }
        if (done?.result === "added") {
          const cardId = `${session}-m${++manualCount.current}`;
          libraryJournal.added.set(cardId, done.bookId);
          if (isbn)
            reads.current = noteRead(reads.current, isbn, Date.now(), "in");
          setCards((list) => [
            ...list,
            {
              id: cardId,
              ...(isbn ? { isbn } : {}),
              bookId: done.bookId,
              title: done.title,
              shows: "added",
            },
          ]);
          setCurrent({ cardId });
        }
        return done;
      },
    }),
    [actions, session, send],
  );
  const openManual = () => {
    setManual(true);
    setInput((now) =>
      now.kind === "camera" ? { kind: "camera", phase: "manual" } : now,
    );
  };
  const closeManual = () => {
    setManual(false);
    setInput((now) =>
      now.kind === "camera" && now.phase === "manual"
        ? { kind: "camera", phase: "starting" }
        : now,
    );
  };

  /**
   * ［終わる］, ✕, 戻る, Escape: closes at once, and says what was read in.
   * While a title is still being asked of openBD (OPENBD_TIMEOUT_MS at
   * most), the notice waits for the answer, to say where that book went.
   */
  function finish() {
    if (closed.current) return;
    closed.current = true;
    onClose(added + waiting + later > 0);
    const asking = [...inFlight.current];
    const tell = (counts: ReturnType<typeof tally>) => {
      const notice = closingNotice(counts);
      if (notice) notify(notice);
    };
    if (!asking.length) return tell({ added, waiting, later });
    const { savedIn: where, owner: reader } = latest.current;
    void Promise.allSettled(asking).then((answers) => {
      const came = new Map<string, Shows>();
      for (const answer of answers)
        if (answer.status === "fulfilled")
          for (const { item, result } of answer.value)
            came.set(item.id, showsOf(result, where));
      tell(
        tally(
          cards.map((card) =>
            card.shows === "undone"
              ? card
              : { ...card, shows: came.get(card.id) ?? card.shows },
          ),
          new Map(
            (reader ? libraryJournal.items(reader) : []).map((item) => [
              item.id,
              item.state,
            ]),
          ),
        ),
      );
    });
  }
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useBackLayer(useCallback(() => finishRef.current(), []));

  // As a dialog: the page beneath stays still, Escape closes, Tab stays
  // inside, and the focus goes back where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!field.current)
      layer.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      // The one-book form on top handles its own keys.
      if (latest.current.manual) return;
      if (event.key === "Escape") {
        event.preventDefault();
        finishRef.current();
      }
      if (event.key === "Tab") {
        const all = Array.from(
          layer.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled)",
          ) ?? [],
        );
        if (event.shiftKey && document.activeElement === all[0]) {
          event.preventDefault();
          all.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === all.at(-1)) {
          event.preventDefault();
          all[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      before?.focus({ preventScroll: true });
    };
  }, []);

  // The newest spine stays in sight.
  useEffect(() => {
    const row = shelf.current;
    if (row) row.scrollLeft = row.scrollWidth;
  }, [cards.length]);

  const bookOf = (bookId?: string) =>
    bookId ? state.books.find((book) => book.id === bookId) : undefined;

  // The banner: one line, the most pressing first.
  const banner = !owner
    ? null
    : savedIn === "unavailable"
      ? SCAN_COPY.banner.unavailable
      : !ready
        ? SCAN_COPY.banner.loading
        : !online
          ? SCAN_COPY.banner.offline
          : !journalKept
            ? SCAN_COPY.banner.notKept
            : saveWarning(savedIn, persistence);

  const countText =
    added > 0
      ? `この回 ${added}冊` + (waiting > 0 ? `・書名待ち ${waiting}冊` : "")
      : waiting > 0
        ? `書名待ち ${waiting}冊`
        : "";

  // The card: what the last read came to.
  const card = current?.cardId
    ? cards.find((entry) => entry.id === current.cardId)
    : undefined;
  const cardShows = card ? shown(card) : undefined;
  const cardBook =
    current?.book ??
    (card && cardShows && !KEPT.includes(cardShows)
      ? bookOf(card.bookId)
      : undefined);
  const cardIsbn = card?.isbn ?? current?.isbn ?? cardBook?.isbn;
  const untitled = cardShows === "untitled" || cardShows === "offline";
  const line1 = !current
    ? null
    : (cardBook?.title ??
      card?.title ??
      current.title ??
      (untitled || current.say === "held"
        ? SCAN_COPY.card.untitledTitle
        : (cardIsbn ?? "")));
  const author = cardBook?.author ?? card?.author;
  // Typing, the field's own line says it: the card waits empty.
  const line2 = !current
    ? !owner
      ? SCAN_COPY.preparing
      : typing
        ? ""
        : SCAN_COPY.firstCamera
    : current.say
      ? SAYS[current.say]
      : cardShows === "untitled"
        ? `${cardIsbn}・${SCAN_COPY.card.untitled}`
        : cardShows === "offline"
          ? `${cardIsbn}・${SCAN_COPY.card.offline}`
          : cardShows
            ? {
                looking: SCAN_COPY.card.looking,
                added: SCAN_COPY.card.added,
                already: SCAN_COPY.card.already,
                waiting: SCAN_COPY.card.waiting,
                unavailable: SCAN_COPY.card.unavailable,
                refused: SCAN_COPY.card.refused,
                undone: SCAN_COPY.card.undone,
              }[cardShows as Exclude<Shows, "untitled" | "offline">]
            : "";
  const canUndo =
    Boolean(card) &&
    card === lastCard &&
    cardShows !== undefined &&
    UNDOABLE.includes(cardShows) &&
    current?.say !== "undone";
  const undoName = card?.title ?? card?.isbn ?? "";

  const typingNote =
    input.kind === "typing" && input.why !== "chosen"
      ? SCAN_COPY.note[input.why]
      : null;

  return (
    <div
      className="scan-session"
      ref={layer}
      role="dialog"
      aria-modal="true"
      aria-label={SCAN_COPY.name}
      onPointerDown={sound.wake}
    >
      <div className={"scan-sheet" + (typing ? " is-typing" : "")} ref={sheet}>
        <div className="scan-top">
          <button
            type="button"
            className="scan-icon-button"
            aria-label="閉じる"
            onClick={finish}
          >
            <Icon name="close" />
          </button>
          <p className="scan-count" aria-live="polite">
            {countText}
          </p>
          <button
            type="button"
            className={
              "scan-icon-button scan-sound" + (sound.on ? "" : " is-off")
            }
            aria-label="音"
            aria-pressed={sound.on}
            onPointerDown={typing ? keepFocus : undefined}
            onClick={() => {
              sound.toggle();
              refocus();
            }}
          >
            <span aria-hidden="true">♪</span>
            {!sound.on && <small aria-hidden="true">オフ</small>}
          </button>
        </div>
        {banner && (
          <p className="scan-banner" role="status">
            {banner}
          </p>
        )}
        {typing ? (
          <form className="scan-typing" onSubmit={submitTyped}>
            <label className="scan-typing-label" htmlFor={id + "-isbn"}>
              ISBN
            </label>
            <div className="scan-typing-row">
              <input
                id={id + "-isbn"}
                ref={field}
                className="field"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="go"
                placeholder="978…"
                value={typed}
                aria-describedby={id + "-help"}
                onChange={(event) => changeTyped(event.target.value)}
              />
              <button
                type="submit"
                className="button secondary"
                disabled={!owner}
                onPointerDown={keepFocus}
                onClick={refocus}
              >
                登録
              </button>
            </div>
            <div className="scan-notes">
              <p id={id + "-help"} aria-live="polite">
                {problem ?? SCAN_COPY.typing.help}
              </p>
              {typingNote && <p>{typingNote}</p>}
              {input.kind === "typing" && input.why === "denied" && (
                <p>{SCAN_COPY.note.settings}</p>
              )}
            </div>
          </form>
        ) : (
          <div className="scan-camera">
            <video ref={video} muted playsInline aria-label="カメラの映像" />
            {input.phase === "running" ? (
              <>
                <span
                  className="scan-guide-box"
                  ref={guide}
                  aria-hidden="true"
                />
                {torch !== null && (
                  <button
                    type="button"
                    className={"scan-torch" + (torch ? " is-on" : "")}
                    aria-pressed={torch}
                    onClick={switchTorch}
                  >
                    ライト
                  </button>
                )}
                <p
                  className={"scan-guide" + (hint ? " is-hint" : "")}
                  aria-live="polite"
                >
                  {hint ?? SCAN_COPY.guide}
                </p>
              </>
            ) : input.phase === "starting" ? (
              <p className="scan-camera-note">{SCAN_COPY.cameraStarting}</p>
            ) : (
              <div className="scan-camera-note">
                <p>{SCAN_COPY.paused}</p>
                {input.phase === "hidden" && (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      setInput({ kind: "camera", phase: "starting" })
                    }
                  >
                    続ける
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div
          className={
            "scan-card" +
            (cardShows && KEPT.includes(cardShows) ? " is-kept" : "") +
            (flash ? " is-flash" : "")
          }
        >
          <div className="scan-card-cover" aria-hidden={!cardBook}>
            {cardBook ? (
              <BookJacket book={cardBook} />
            ) : (
              <span className="scan-card-tile">
                <Icon name="barcode" size={22} />
              </span>
            )}
          </div>
          <div className="scan-card-text">
            {line1 && (
              <p className="scan-card-title">
                <span>{line1}</span>
                {author && <small>{author}</small>}
              </p>
            )}
            <p className="scan-card-status" role="status">
              {line2}
            </p>
          </div>
          {canUndo && (
            <button
              type="button"
              className="button secondary scan-undo"
              aria-label={`${undoName}の登録を取り消す`}
              onPointerDown={typing ? keepFocus : undefined}
              onClick={undo}
            >
              取り消す
            </button>
          )}
        </div>
        <div
          className="scan-shelf"
          role="img"
          aria-label={"この回に入れた本" + (added > 0 ? ` ${added}冊` : "")}
        >
          <ol ref={shelf}>
            {cards.map((entry) => {
              const showsNow = shown(entry);
              if (showsNow === "added") {
                const book = bookOf(entry.bookId);
                return (
                  <li
                    key={entry.id}
                    className="scan-spine is-added"
                    style={
                      book
                        ? {
                            background: book.color,
                            height: Math.round(book.height / 4.4),
                            width: Math.min(
                              11,
                              Math.max(6, book.thickness / 4),
                            ),
                          }
                        : undefined
                    }
                  />
                );
              }
              return KEPT.includes(showsNow) ? (
                <li key={entry.id} className="scan-spine is-kept" />
              ) : null;
            })}
          </ol>
          <span className="scan-plank" aria-hidden="true" />
        </div>
        <div className="scan-bottom">
          {input.kind === "camera" ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setInput({ kind: "typing", why: "chosen" })}
            >
              ISBNを打つ
            </button>
          ) : (
            // Only where asking again could help: not for a browser that
            // cannot read barcodes, a camera refused, or none at all.
            input.why !== "denied" &&
            input.why !== "no-reader" &&
            input.why !== "no-camera" && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setInput({ kind: "camera", phase: "starting" })}
              >
                カメラで読む
              </button>
            )
          )}
          <button
            type="button"
            className="button secondary"
            onClick={openManual}
          >
            手で入力
          </button>
          <button type="button" className="button primary" onClick={finish}>
            終わる
          </button>
        </div>
        <GoogleCoversCredit />
      </div>
      {manual && (
        <BarcodeRegister
          state={state}
          actions={manualActions}
          notify={notify}
          onClose={closeManual}
          lead="書名やISBNを入れて1冊ずつ登録します"
          camera={false}
        />
      )}
    </div>
  );
}
