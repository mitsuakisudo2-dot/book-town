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
import { flushSync } from "react-dom";
import { useAccountState } from "../lib/account-session";
import { useBackLayer } from "../lib/back-layer";
import {
  forgetReader,
  guideRect,
  loadDetector,
  readerKind,
} from "../lib/barcode-reader";
import { imeKey } from "../lib/keys";
import {
  coarsePointer,
  fieldTakesFocus,
  focusBack,
  focusField,
  markField,
} from "../lib/coarse-pointer";
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
  type ScanSort,
  type Sent,
} from "../lib/library-journal";
import {
  DEFAULT_SHELVES,
  liveShelves,
  READING_STATUSES,
  type LibrarySet,
  type ReadingStatus,
} from "../lib/library";
import { saveWarning } from "../lib/persistence";
import {
  closingNotice,
  forgetRead,
  nextFrame,
  noteOther,
  noteRead,
  noteTaken,
  NOTICE_MS,
  NO_READS,
  readBarcode,
  scanCount,
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
import type { Notify, TownActions, TownState } from "../lib/types";
import {
  keepTiming,
  noteDone,
  noteFrame,
  noteReadAt,
  NO_TIMING,
  tabTiming,
  USUAL,
  type Timing,
  type TimingSettings,
} from "../lib/scan-timing";
import { BarcodeRegister } from "./BarcodeRegister";
import { ScanSortSheet } from "./ScanSortSheet";
import { ScanTiming } from "./ScanTiming";
import { BookJacket, GoogleCoversCredit, Icon } from "./ui";
import "./scan.css";
import { bookAuthor, bookById, bookByIsbn, bookTitle } from "../lib/book-name";

// The continuous scanner (plan 7-1, flow A; けにーさんの引き継ぎ資料 v1.1 and
// Figma v4's 01, 2026-10-18): the camera stays open, small, over the list of
// this time's books, newest first, and every book read is registered at
// once, with no question about reading status, shelf or visibility. A book
// in the list can be given 読了・積読・読書中 there and then, or never. Two
// taps in all: open, and ［完了］. Barcodes are read by the browser's own
// reader, or by ZXing in WebAssembly where there is none (Safari on the
// iPhone; barcode-reader.ts). Where neither can, or the camera is refused,
// ISBNs are typed one after another instead. Every read goes into the scan
// journal first (library-journal.ts), so a book read offline, while the town
// loads, or just before the tab is closed is registered later; it says
// 登録しました only once the journal let it go, its save confirmed.

const canRead = () =>
  Boolean(readerKind() && navigator.mediaDevices?.getUserMedia);
/**
 * A computer whose browser has no reader of its own (Chrome on Windows and
 * Linux, Firefox) starts typing: its camera, most often one that cannot
 * focus near, is asked for only on ［カメラで読む］.
 */
const startsTyping = () => readerKind() === "wasm" && !coarsePointer();
/** This many reads failing in a row: the reader is not working. */
const FAILS_TO_STOP = 5;
/** A browser that cannot say when the camera has a new frame reads this often. */
const FRAME_MS = 100;

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
/**
 * What a card shows now: as it came to, but "saving" for a book in the
 * library whose save is not confirmed yet, and "refused" once the database
 * turned it away after all.
 */
type ShownNow = Shows | "saving";
/** A remark over the camera about a read that changed nothing new. */
type Say =
  "again-in" | "again-already" | "again-held" | "already" | "held" | "not-yet";
interface Notice {
  /** The book's title, or its ISBN. */
  name: string;
  say: Say;
}

const KEPT: Shows[] = [
  "looking",
  "untitled",
  "offline",
  "waiting",
  "unavailable",
];
const UNDOABLE: Shows[] = ["added", ...KEPT];

/** 読了・積読・読書中 on every card, in the library's order (資料 4章). */
const STATUS_BUTTONS = DEFAULT_SHELVES.flatMap((shelf) =>
  READING_STATUSES.includes(shelf.key as ReadingStatus)
    ? [{ status: shelf.key as ReadingStatus, label: shelf.label }]
    : [],
);
const NONE: ReadonlySet<string> = new Set();
const FAVORITE =
  DEFAULT_SHELVES.find((shelf) => shelf.key === "favorite")?.label ??
  "お気に入り";

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
 * The session's books by what they came to. For the count at the top:
 * saved, on their way (a title asked for, saving, the town loading, no
 * network), and waiting for the reader (書名待ち, the account unreadable, a
 * save refused). For the notice on closing: registered (saved or saving),
 * waiting for a title, and kept on the device for another reason.
 */
function tally(cards: Card[], shown: (card: Card) => ShownNow) {
  const count = (...kinds: ShownNow[]) =>
    cards.filter((card) => kinds.includes(shown(card))).length;
  return {
    saved: count("added"),
    checking: count("looking", "saving", "waiting", "offline"),
    attention: count("untitled", "unavailable", "refused"),
    closing: {
      added: count("added", "saving"),
      waiting: count("untitled", "offline"),
      later: count("looking", "waiting", "unavailable"),
    },
  };
}

const SAYS: Record<Say, string> = {
  "again-in": SCAN_COPY.card.againIn,
  "again-already": SCAN_COPY.card.already,
  "again-held": SCAN_COPY.card.held,
  already: SCAN_COPY.card.already,
  held: SCAN_COPY.card.held,
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

/**
 * The screen stays on while the camera reads (資料 10章 ⑩): a phone that
 * dims halfway through fifty books stops the reading. Where the browser
 * cannot keep it on, it dims as it would.
 */
function useScreenKeptOn(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    void navigator.wakeLock.request("screen").then(
      (got) => {
        if (stopped) void got.release().catch(() => {});
        else lock = got;
      },
      () => {},
    );
    return () => {
      stopped = true;
      void lock?.release().catch(() => {});
    };
  }, [on]);
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
  /** A remark over the camera about the last read. */
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The card that lights up for a read of its book. */
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);
  /** The card whose ⋮ is open: the camera reads nothing new meanwhile. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** The card whose ＋本棚 is open: the reader's shelves to put it on. */
  const [shelvesFor, setShelvesFor] = useState<string | null>(null);
  /** 連続設定: what the next books read are given, until 解除 or 完了. */
  const [sort, setSort] = useState<ScanSort | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  /** The camera made larger (カメラ集中表示), for a code it does not catch. */
  const [large, setLarge] = useState(false);
  /** Books entered by hand whose save is not confirmed yet. */
  const [savingByHand, setSavingByHand] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [hint, setHint] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  // The timing mode (?scan-timing): null for every reader who did not ask.
  const [timingSettings, setTimingSettings] = useState<TimingSettings | null>(
    tabTiming,
  );
  const timing = useRef<Timing>(NO_TIMING);
  const timingOn = useRef(timingSettings !== null);
  const readerUsed = useRef("");
  const gap = timingSettings?.gap ?? USUAL.gap;
  const pictureWidth = timingSettings?.size ?? USUAL.size;
  const area = timingSettings?.area ?? USUAL.area;
  const gapRef = useRef(gap);
  const areaRef = useRef(area);
  useEffect(() => {
    gapRef.current = gap;
    areaRef.current = area;
    timingOn.current = timingSettings !== null;
  }, [gap, area, timingSettings]);
  const reads = useRef<SessionReads>(NO_READS);
  const inView = useRef<InView>({});
  const paused = useRef(false);
  // Nothing new is read while a menu or the 連続設定 is open (資料 仕様メモ06).
  useEffect(() => {
    paused.current = menuFor !== null || shelvesFor !== null || sortOpen;
  }, [menuFor, shelvesFor, sortOpen]);
  const manualCount = useRef(0);
  const closed = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLSpanElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // What had the focus as the scanner opened, before anything in it took it.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
  }, []);

  // What the async camera loop and the sends read: the latest render's.
  const latest = useRef({
    owner,
    ready,
    online,
    savedIn,
    manual,
    sortOpen,
    cards,
  });
  useEffect(() => {
    latest.current = { owner, ready, online, savedIn, manual, sortOpen, cards };
  });

  /** Notes a moment in the timing mode's record; nothing without the mode. */
  const time = useCallback((change: (now: Timing) => Timing) => {
    if (timingOn.current) timing.current = change(timing.current);
  }, []);
  /** The timing mode: a new book is saved once it leaves the journal. */
  const timeSaves = useCallback(() => {
    const reader = latest.current.owner;
    if (!timingOn.current || !reader) return;
    const waiting = new Set(
      libraryJournal.items(reader).map((item) => item.id),
    );
    const at = performance.now();
    for (const read of timing.current.reads)
      if (read.fresh && read.titleAt !== undefined && !waiting.has(read.id))
        timing.current = noteDone(timing.current, read.id, "savedAt", at);
  }, []);

  // An open session handles its own items; the page's sender leaves them.
  useEffect(() => {
    libraryJournal.live.add(session);
    return () => {
      libraryJournal.live.delete(session);
    };
  }, [session]);

  const states = new Map(items.map((item) => [item.id, item.state]));
  useEffect(timeSaves, [items, timeSaves]);
  const shown = (card: Card): ShownNow =>
    states.get(card.id) === "refused"
      ? "refused"
      : card.shows !== "added"
        ? card.shows
        : // The town cannot be saved here: the journal keeps the book until
          // it can, or until the page is opened again.
          states.has(card.id) && persistence === "unavailable"
          ? "unavailable"
          : states.has(card.id) || savingByHand.has(card.id)
            ? "saving"
            : "added";
  const counts = tally(cards, shown);

  // A book entered by hand is saved once the town says all it had is: the
  // same as the journal lets its items go (settleJournal).
  useEffect(() => {
    if (persistence === "saved" && savingByHand.size)
      setSavingByHand(new Set());
  }, [persistence, savingByHand]);

  /** Updates the cards from what sending their items came to. */
  const settle = useCallback(
    (sent: Sent[]) => {
      if (!sent.length) return;
      const { savedIn: where } = latest.current;
      const at = performance.now();
      for (const { item, result } of sent) {
        if (result === "added")
          reads.current = noteTaken(reads.current, item.isbn, "in");
        if (result === "already")
          reads.current = noteTaken(reads.current, item.isbn, "already");
        if (result === "added" || result === "already")
          time((now) => noteDone(now, item.id, "titleAt", at));
      }
      timeSaves();
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
    },
    [time, timeSaves],
  );

  // The sends this session started that have not answered yet (openBD is
  // being asked): ［完了］ waits for them to say where those books went.
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

  /** Lights the card up; once, not again while it still is. */
  const flashCard = (id: string) => {
    const now = Date.now();
    setFlash((was) =>
      was?.id === id && now - was.at < 800 ? was : { id, at: now },
    );
  };
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const nameOf = (card: Card) => card.title ?? card.isbn ?? "";

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
            known: (code) => bookByIsbn(town.books, code),
          }
        : null,
      (code) => heldItem(libraryJournal, reader, generation, code),
    );
    setHint(null);
    // Every read shows on its card: on an iPhone there is no vibration, and
    // in silent mode no sound either.
    const shownCard = shownCards.findLast((entry) => entry.isbn === isbn);
    if (shownCard) flashCard(shownCard.id);
    const timedAt = performance.now();
    if (reaction.kind !== "same" && reaction.kind !== "new")
      time((now) =>
        noteReadAt(now, `again-${now.reads.length}`, timedAt, false),
      );
    // The same book again within 3 seconds: its card lights up, and that
    // is all.
    if (reaction.kind === "same") {
      reads.current = noteRead(reads.current, isbn, at, null);
      return;
    }
    if (reaction.kind !== "new") {
      sound.play("nothing-new");
      if (reaction.kind === "again") {
        reads.current = noteRead(reads.current, isbn, at, null);
        const book = libraryBookByIsbn(town, isbn);
        setNotice({
          name: shownCard ? nameOf(shownCard) : book ? bookTitle(book) : isbn,
          say: `again-${reaction.was}`,
        });
      } else if (reaction.kind === "already") {
        reads.current = noteRead(reads.current, isbn, at, "already");
        setNotice({ name: bookTitle(reaction.book), say: "already" });
      } else {
        reads.current = noteRead(reads.current, isbn, at, "held");
        setNotice({ name: reaction.item.title ?? isbn, say: "held" });
      }
      return;
    }
    sound.play("in");
    const { known } = reaction;
    const item = keepRead(libraryJournal, reader, {
      session,
      isbn,
      via,
      ...(sort ? { sort } : {}),
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
    time((now) => noteReadAt(now, item.id, timedAt, true));
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
    setNotice(null);
    flashCard(item.id);
    send(reader, [item.id]);
  }

  /** One camera frame's codes. */
  function onFrame(codes: string[]) {
    const at = Date.now();
    // In view is timed on the steady clock: the date can jump.
    const frame = nextFrame(inView.current, codes, performance.now());
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
    let frameAsked: number | undefined;
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
    const larger: MediaTrackConstraints = {
      width: { ideal: pictureWidth },
      height: { ideal: Math.round((pictureWidth * 9) / 16) },
    };
    const wasm = readerKind() === "wasm";
    const size = wasm ? larger : {};
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
    // The camera is this effect's the moment it is had, while the reader may
    // still be loading: closed meanwhile (［終わる］, ［ISBNを打つ］, the page
    // hidden), it is let go at once, not when the reader comes.
    const camera = openCamera().then((got) => {
      if (typeof got === "string") return got;
      if (stopped) got.getTracks().forEach((track) => track.stop());
      else {
        stream = got;
        // Another app took the camera, or the permission went: type instead.
        got
          .getVideoTracks()[0]
          ?.addEventListener("ended", () => typeInstead("busy"));
      }
      return got;
    });
    void (async () => {
      // Both at once: loading the reader does not hold up the camera's
      // question.
      const [reader, got] = await Promise.all([loadDetector(), camera]);
      if (stopped) return;
      const media = typeof got === "string" ? null : got;
      const giveUp = (why: TypingWhy) => {
        media?.getTracks().forEach((track) => track.stop());
        typeInstead(why);
      };
      // The browser first, then the camera, then this time's network.
      if (!reader.ok && reader.why === "no-reader") return giveUp("no-reader");
      if (!media) return typeInstead(got as TypingWhy);
      if (!reader.ok) return giveUp(reader.why);
      const track = media.getVideoTracks()[0];
      // The camera went while the reader was loading.
      if (track?.readyState === "ended") return giveUp("busy");
      // The browser's own reader turned out not to read EAN-13, and the
      // camera was opened at its own size: ZXing's larger picture first.
      const resized = reader.wasm && !wasm;
      const tuned = track
        ?.applyConstraints({
          ...(resized ? larger : {}),
          advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
        })
        .catch(() => {});
      if (resized) {
        await tuned;
        if (stopped) return;
      }
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
      readerUsed.current = reader.wasm ? "wasm" : "native";
      const detector = new reader.Detector({ formats: ["ean_13"] });
      // ZXing reads all of the picture shown, a code anywhere in view as 積読家
      // does (けにーさん 10-18), drawn into the one canvas: the whole frame
      // would be a new canvas of its size at every read. The timing mode can
      // have it read the guide's band only (読む範囲 枠). The browser's own
      // reader takes the video as it is.
      const band = reader.wasm
        ? document
            .createElement("canvas")
            .getContext("2d", { willReadFrequently: true })
        : null;
      const frame = () => {
        if (!band) return element;
        const view = element.getBoundingClientRect();
        const box =
          areaRef.current === "band"
            ? guide.current?.getBoundingClientRect()
            : undefined;
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
        // Nor while a card's ⋮ is open (資料 10章 ④): what the camera holds
        // then is new once it closes.
        if (
          element.readyState >= 2 &&
          latest.current.owner &&
          !paused.current
        ) {
          let codes: string[] = [];
          const began = performance.now();
          try {
            const image = frame();
            if (image)
              codes = (await detector.detect(image)).map(
                (code) => code.rawValue,
              );
            failed = 0;
            const ms = performance.now() - began;
            time((now) => noteFrame(now, began, ms));
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
        // The next frame: as the camera gives a new one, each read once (a
        // picture read twice only warms the phone), or after the timing
        // mode's pause.
        const gap = gapRef.current;
        if (gap === "frame" && "requestVideoFrameCallback" in element)
          frameAsked = element.requestVideoFrameCallback(() => void look());
        else timer = setTimeout(look, gap === "frame" ? FRAME_MS : gap);
      };
      void look();
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (frameAsked !== undefined)
        element.cancelVideoFrameCallback(frameAsked);
      stream?.getTracks().forEach((track) => track.stop());
      element.srcObject = null;
      inView.current = {};
      torchTrack.current = null;
    };
  }, [cameraOn, pictureWidth, time]);

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
    // Selected, so the next keystroke starts again; on a touch screen, a
    // field the reader is not typing in is shown and marked instead.
    requestAnimationFrame(() => markField(field.current, { select: true }));
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
  // On a touch screen they give it back only to a field the reader was
  // typing in; anything else would raise the keyboard.
  const typedIn = useRef(false);
  const keepFocus = (event: { preventDefault(): void }) => {
    typedIn.current = document.activeElement === field.current;
    event.preventDefault();
  };
  const typing = input.kind === "typing";
  const refocus = () => {
    if (typing && (fieldTakesFocus() || typedIn.current))
      field.current?.focus();
    typedIn.current = false;
  };

  // With a mouse the field gets the focus as typing starts, in the same
  // click. On a touch screen it waits for a tap: the focus stays in the
  // scanner (on 閉じる, when what had it is gone). ［ISBNを打つ］ is the
  // reader asking for the field, and gives it the focus itself (typeIsbn).
  useLayoutEffect(() => {
    if (!typing) return;
    const inside = layer.current?.contains(document.activeElement) ?? false;
    focusField(field.current, {
      instead: inside
        ? null
        : layer.current?.querySelector<HTMLElement>("button"),
      preventScroll: true,
    });
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

  // ［ISBNを打つ］: the reader asks to type, so the field takes the focus
  // within the tap, and a phone's keyboard rises with it. Falling into
  // typing by itself (no camera, refused, no reader) still waits for a tap.
  function typeIsbn() {
    flushSync(() => setInput({ kind: "typing", why: "chosen" }));
    focusField(field.current, { asked: true, preventScroll: true });
  }

  /** ⋮ ［登録を取り消す］: any book of this time, whatever its card last showed. */
  function undo(card: Card) {
    refocus();
    setMenuFor(null);
    if (!owner) return;
    if (undoScan(libraryJournal, owner, journalTown, card.id) === "not-yet") {
      setNotice({ name: nameOf(card), say: "not-yet" });
      return;
    }
    if (card.isbn) reads.current = forgetRead(reads.current, card.isbn);
    setCards((list) =>
      list.map((entry) =>
        entry.id === card.id ? { ...entry, shows: "undone" } : entry,
      ),
    );
    setSavingByHand((was) => {
      if (!was.has(card.id)) return was;
      const next = new Set(was);
      next.delete(card.id);
      return next;
    });
  }

  /** 読了・積読・読書中 on a card: set, or pressed again, taken off. */
  function shelveAs(bookId: string, status: ReadingStatus) {
    const lit = state.libraryEntries[bookId]?.status === status;
    change(bookId, { status: lit ? null : status });
  }
  /** A button of a card's second row: 未所持, お気に入り, a shelf. */
  function change(bookId: string, set: LibrarySet) {
    refocus();
    actions.changeLibrary([bookId], set);
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
          // Saved at once in the demo; an account's save is waited for.
          if (journalTown.status() !== "saved")
            setSavingByHand((was) => new Set(was).add(cardId));
          flashCard(cardId);
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
   * ［完了］, ✕, 戻る, Escape: closes at once, and says what was read in.
   * While a title is still being asked of openBD (OPENBD_TIMEOUT_MS at
   * most), the notice waits for the answer, to say where that book went.
   */
  function finish() {
    if (closed.current) return;
    closed.current = true;
    const { added, waiting, later } = counts.closing;
    onClose(added + waiting + later > 0);
    const asking = [...inFlight.current];
    const tell = (closing: typeof counts.closing) => {
      const told = closingNotice(closing);
      if (told) notify(told);
    };
    if (!asking.length) return tell(counts.closing);
    const { savedIn: where, owner: reader } = latest.current;
    void Promise.allSettled(asking).then((answers) => {
      const came = new Map<string, Shows>();
      for (const answer of answers)
        if (answer.status === "fulfilled")
          for (const { item, result } of answer.value)
            came.set(item.id, showsOf(result, where));
      const refused = new Set(
        (reader ? libraryJournal.items(reader) : [])
          .filter((item) => item.state === "refused")
          .map((item) => item.id),
      );
      tell(
        tally(
          cards.map((card) =>
            card.shows === "undone"
              ? card
              : { ...card, shows: came.get(card.id) ?? card.shows },
          ),
          (card) => (refused.has(card.id) ? "refused" : card.shows),
        ).closing,
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
    const before = opener.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!field.current)
      layer.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      // The one-book form and the 連続設定 on top handle their own keys.
      if (latest.current.manual || latest.current.sortOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        // The Escape that cancels a kana conversion in the ISBN field is the
        // keyboard's, as in every Modal.
        if (!imeKey(event)) finishRef.current();
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
      focusBack(before, { preventScroll: true });
    };
  }, []);

  // A new book goes on top of the list. While the reader is down the list,
  // or has a finger on it, what they look at stays where it is: the list
  // moves by the new card (資料 4章: a button about to be pressed never moves).
  const touching = useRef(false);
  const shownCount = useRef(0);
  useLayoutEffect(() => {
    const element = list.current;
    const added = cards.length - shownCount.current;
    shownCount.current = cards.length;
    if (!element || added <= 0) return;
    if (element.scrollTop <= 0 && !touching.current) return;
    const first = element.children[added]?.getBoundingClientRect().top;
    const top = element.firstElementChild?.getBoundingClientRect().top;
    if (first !== undefined && top !== undefined)
      element.scrollTop += first - top;
  }, [cards.length]);

  useScreenKeptOn(input.kind === "camera" && input.phase === "running");

  const bookOf = (bookId?: string) => bookById(state.books, bookId);
  const favorites = useMemo(() => new Set(state.favorites), [state.favorites]);
  // The shelves the reader fills by hand (a smart shelf gathers its own
  // books), and the ones each book is on.
  const handShelves = useMemo(
    () =>
      liveShelves(state.libraryShelves).filter((shelf) => shelf.rule === null),
    [state.libraryShelves],
  );
  const onShelves = useMemo(() => {
    const on = new Map<string, Set<string>>();
    for (const row of state.libraryShelfBooks) {
      const shelves = on.get(row.bookId) ?? new Set<string>();
      shelves.add(row.shelfId);
      on.set(row.bookId, shelves);
    }
    return on;
  }, [state.libraryShelfBooks]);
  /** What the 連続設定 gives, in a few words: 持っている, the usual, unsaid. */
  const sortWords = (now: ScanSort) => [
    ...STATUS_BUTTONS.filter((button) => button.status === now.status).map(
      (button) => button.label,
    ),
    ...(now.owned === "no" ? [SCAN_COPY.notOwned] : []),
    ...handShelves
      .filter((shelf) => now.shelves.includes(shelf.id))
      .map((shelf) => shelf.name),
  ];
  /**
   * The library's book a card is now: its own, or, for one found in the
   * library while it was sent, that one.
   */
  const libraryIdOf = (card: Card): string | undefined =>
    card.bookId && state.library.includes(card.bookId)
      ? card.bookId
      : card.isbn
        ? libraryBookByIsbn(state, card.isbn)?.id
        : undefined;

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

  const countText = scanCount(counts);

  /** What a card says under its title. */
  const stateLine = (card: Card, now: ShownNow): string =>
    now === "untitled"
      ? `${card.isbn}・${SCAN_COPY.card.untitled}`
      : now === "offline"
        ? `${card.isbn}・${SCAN_COPY.card.offline}`
        : {
            looking: SCAN_COPY.card.looking,
            saving: SCAN_COPY.card.saving,
            added: SCAN_COPY.card.added,
            already: SCAN_COPY.card.already,
            waiting: SCAN_COPY.card.waiting,
            unavailable: SCAN_COPY.card.unavailable,
            refused: SCAN_COPY.card.refused,
            undone: SCAN_COPY.card.undone,
          }[now];

  const typingNote =
    input.kind === "typing" && input.why !== "chosen"
      ? SCAN_COPY.note[input.why]
      : null;
  // Back to the camera only where asking again could help: not for a
  // browser that cannot read barcodes, a camera refused, or none at all.
  const cameraAgain =
    input.kind === "typing" &&
    input.why !== "denied" &&
    input.why !== "no-reader" &&
    input.why !== "no-camera";

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
            className="icon-btn"
            aria-label="閉じる"
            onClick={finish}
          >
            <Icon name="close" />
          </button>
          <p className="scan-count" aria-live="polite">
            {countText}
          </p>
          {input.kind === "camera" ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={SCAN_COPY.typeIsbn}
              onClick={typeIsbn}
            >
              <Icon name="keyboard" />
            </button>
          ) : cameraAgain ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={SCAN_COPY.useCamera}
              onClick={() => setInput({ kind: "camera", phase: "starting" })}
            >
              <Icon name="camera" />
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
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
                className="btn"
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
            <div className="scan-typing-foot">
              <button
                type="button"
                className="text-btn scan-by-hand"
                onClick={openManual}
              >
                {SCAN_COPY.byHand}
              </button>
              <button
                type="button"
                className={"icon-btn scan-sound" + (sound.on ? "" : " is-off")}
                aria-label={SCAN_COPY.sound}
                aria-pressed={sound.on}
                onPointerDown={keepFocus}
                onClick={() => {
                  sound.toggle();
                  refocus();
                }}
              >
                <Icon name={sound.on ? "sound" : "sound-off"} size={20} />
              </button>
            </div>
          </form>
        ) : (
          <div className={"scan-camera" + (large ? " is-large" : "")}>
            <video ref={video} muted playsInline aria-label="カメラの映像" />
            {input.phase === "running" ? (
              <>
                <span
                  className="scan-guide-box"
                  ref={guide}
                  aria-hidden="true"
                />
                <p
                  className={"scan-guide" + (hint ? " is-hint" : "")}
                  aria-live="polite"
                >
                  {hint ?? SCAN_COPY.guide}
                </p>
                <button
                  type="button"
                  className={
                    "scan-over scan-sound" + (sound.on ? "" : " is-off")
                  }
                  aria-label={SCAN_COPY.sound}
                  aria-pressed={sound.on}
                  onClick={sound.toggle}
                >
                  <Icon name={sound.on ? "sound" : "sound-off"} size={20} />
                </button>
                {torch !== null && (
                  <button
                    type="button"
                    className={"scan-over scan-torch" + (torch ? " is-on" : "")}
                    aria-label={SCAN_COPY.light}
                    aria-pressed={torch}
                    onClick={switchTorch}
                  >
                    <Icon name="light" size={20} />
                  </button>
                )}
                <button
                  type="button"
                  className="scan-over scan-size"
                  aria-label={large ? SCAN_COPY.smaller : SCAN_COPY.larger}
                  onClick={() => setLarge((was) => !was)}
                >
                  <Icon name={large ? "shrink" : "expand"} size={18} />
                </button>
              </>
            ) : input.phase === "starting" ? (
              <p className="scan-camera-note">{SCAN_COPY.cameraStarting}</p>
            ) : (
              <div className="scan-camera-note">
                <p>{SCAN_COPY.paused}</p>
                {input.phase === "hidden" && (
                  <button
                    type="button"
                    className="btn fill"
                    onClick={() =>
                      setInput({ kind: "camera", phase: "starting" })
                    }
                  >
                    続ける
                  </button>
                )}
              </div>
            )}
            <p className="scan-notice" role="status">
              {notice && (
                <>
                  <strong>{notice.name}</strong>
                  <span>{SAYS[notice.say]}</span>
                </>
              )}
            </p>
          </div>
        )}
        {timingSettings && input.kind === "camera" && (
          <ScanTiming
            timing={timing}
            settings={timingSettings}
            onSettings={(next) => {
              // A record is one setting's: it starts again.
              timing.current = NO_TIMING;
              keepTiming(next);
              setTimingSettings(next);
            }}
            reader={readerUsed}
            video={video}
            notify={notify}
          />
        )}
        {typing && notice && (
          <p className="scan-notice is-typing" role="status">
            <strong>{notice.name}</strong>
            <span>{SAYS[notice.say]}</span>
          </p>
        )}
        {owner && (
          <div className={"scan-sort" + (sort ? " is-on" : "")}>
            {sort ? (
              <>
                <div className="scan-sort-head">
                  <p className="scan-sort-title">{SCAN_COPY.sort.on}</p>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setSortOpen(true)}
                  >
                    {SCAN_COPY.sort.change}
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    onPointerDown={typing ? keepFocus : undefined}
                    onClick={() => {
                      refocus();
                      setSort(null);
                    }}
                  >
                    {SCAN_COPY.sort.off}
                  </button>
                </div>
                <p className="scan-sort-now">
                  {sortWords(sort).map((word) => (
                    <span key={word} className="scan-sort-tag">
                      <Icon name="check" size={14} />
                      {word}
                    </span>
                  ))}
                  <span className="scan-sort-next">{SCAN_COPY.sort.next}</span>
                </p>
              </>
            ) : (
              <>
                <div className="scan-sort-text">
                  <p className="scan-sort-title">{SCAN_COPY.sort.name}</p>
                  <p className="scan-sort-note">{SCAN_COPY.sort.note}</p>
                </div>
                <button
                  type="button"
                  className="btn scan-sort-open"
                  onClick={() => setSortOpen(true)}
                >
                  {SCAN_COPY.sort.set}
                  <Icon name="chevron" size={16} />
                </button>
              </>
            )}
          </div>
        )}
        <ol
          className="scan-list"
          ref={list}
          aria-label={SCAN_COPY.list}
          onPointerDown={() => (touching.current = true)}
          onPointerUp={() => (touching.current = false)}
          onPointerCancel={() => (touching.current = false)}
        >
          {cards.length === 0 && (!owner || !typing) && (
            <li className="scan-list-empty">
              {owner ? SCAN_COPY.firstCamera : SCAN_COPY.preparing}
            </li>
          )}
          {[...cards].reverse().map((card) => {
            const now = shown(card);
            const libraryId =
              now === "added" || now === "saving" || now === "already"
                ? libraryIdOf(card)
                : undefined;
            const book = libraryId ? bookOf(libraryId) : undefined;
            const titled = book ? bookTitle(book) : card.title;
            const name = titled ?? card.isbn ?? "";
            const author = (book && bookAuthor(book)) ?? card.author;
            const status = libraryId
              ? state.libraryEntries[libraryId]?.status
              : undefined;
            const kept = KEPT.includes(now as Shows) || now === "refused";
            const canUndo = UNDOABLE.includes(now as Shows) || now === "saving";
            const menuId = `${id}-menu-${card.id}`;
            const shelvesId = `${id}-shelves-${card.id}`;
            const notOwned = libraryId
              ? state.libraryEntries[libraryId]?.owned === "no"
              : false;
            const favorite = libraryId ? favorites.has(libraryId) : false;
            const shelvesOn = (libraryId && onShelves.get(libraryId)) || NONE;
            return (
              <li
                key={card.id}
                className={
                  "scan-item" +
                  (kept ? " is-kept" : "") +
                  (now === "undone" ? " is-undone" : "") +
                  (flash?.id === card.id ? " is-flash" : "")
                }
              >
                <div className="scan-item-head">
                  <div className="scan-item-cover" aria-hidden="true">
                    {book ? (
                      <BookJacket book={book} />
                    ) : (
                      <span className="scan-item-tile">
                        <Icon name="barcode" size={18} />
                      </span>
                    )}
                  </div>
                  <div className="scan-item-text">
                    <p className="scan-item-title">
                      {now === "untitled" || now === "offline"
                        ? SCAN_COPY.card.untitledTitle
                        : (titled ?? `ISBN ${card.isbn ?? ""}`)}
                    </p>
                    {author && <p className="scan-item-author">{author}</p>}
                    <p className="scan-item-state">{stateLine(card, now)}</p>
                  </div>
                  {canUndo && (
                    <button
                      type="button"
                      className="icon-btn scan-item-more"
                      aria-label={SCAN_COPY.more(name)}
                      aria-expanded={menuFor === card.id}
                      aria-controls={menuFor === card.id ? menuId : undefined}
                      onPointerDown={typing ? keepFocus : undefined}
                      onClick={() => {
                        refocus();
                        setShelvesFor(null);
                        setMenuFor((was) => (was === card.id ? null : card.id));
                      }}
                    >
                      <Icon name="kebab" />
                    </button>
                  )}
                </div>
                {menuFor === card.id && canUndo && (
                  <div className="scan-item-menu" id={menuId} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="btn quiet"
                      aria-label={SCAN_COPY.undoName(name)}
                      onPointerDown={typing ? keepFocus : undefined}
                      onClick={() => undo(card)}
                    >
                      {SCAN_COPY.undo}
                    </button>
                  </div>
                )}
                {libraryId && (
                  <div
                    className="scan-item-statuses"
                    role="group"
                    aria-label={SCAN_COPY.statuses(name)}
                  >
                    {STATUS_BUTTONS.map((button) => (
                      <button
                        key={button.status}
                        type="button"
                        className="chip"
                        aria-pressed={status === button.status}
                        onPointerDown={typing ? keepFocus : undefined}
                        onClick={() => shelveAs(libraryId, button.status)}
                      >
                        {button.label}
                      </button>
                    ))}
                  </div>
                )}
                {libraryId && (
                  <div
                    className="scan-item-marks"
                    role="group"
                    aria-label={SCAN_COPY.marks(name)}
                  >
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={notOwned}
                      onPointerDown={typing ? keepFocus : undefined}
                      onClick={() =>
                        change(libraryId, { owned: notOwned ? null : "no" })
                      }
                    >
                      {SCAN_COPY.notOwned}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={favorite}
                      onPointerDown={typing ? keepFocus : undefined}
                      onClick={() => change(libraryId, { favorite: !favorite })}
                    >
                      {FAVORITE}
                    </button>
                    <button
                      type="button"
                      className="chip scan-item-add"
                      aria-expanded={shelvesFor === card.id}
                      aria-controls={
                        shelvesFor === card.id ? shelvesId : undefined
                      }
                      onPointerDown={typing ? keepFocus : undefined}
                      onClick={() => {
                        refocus();
                        setMenuFor(null);
                        setShelvesFor((was) =>
                          was === card.id ? null : card.id,
                        );
                      }}
                    >
                      <Icon name="plus" size={16} />
                      {SCAN_COPY.shelf}
                    </button>
                  </div>
                )}
                {libraryId && shelvesFor === card.id && (
                  <div
                    className="scan-item-shelves"
                    id={shelvesId}
                    role="group"
                    aria-label={SCAN_COPY.shelvesOf(name)}
                  >
                    {handShelves.length ? (
                      handShelves.map((shelf) => {
                        const on = shelvesOn.has(shelf.id);
                        return (
                          <button
                            key={shelf.id}
                            type="button"
                            className="chip"
                            aria-pressed={on}
                            onPointerDown={typing ? keepFocus : undefined}
                            onClick={() =>
                              change(
                                libraryId,
                                on
                                  ? { removeShelf: shelf.id }
                                  : { addShelf: shelf.id },
                              )
                            }
                          >
                            {shelf.name}
                          </button>
                        );
                      })
                    ) : (
                      <p className="scan-item-none">{SCAN_COPY.noShelves}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <GoogleCoversCredit />
        <div className="scan-bottom">
          <button type="button" className="btn fill" onClick={finish}>
            {SCAN_COPY.done}
          </button>
        </div>
      </div>
      {sortOpen && (
        <ScanSortSheet
          sort={sort}
          statuses={STATUS_BUTTONS}
          shelves={handShelves}
          onSet={(next) => {
            setSort(next);
            setSortOpen(false);
          }}
          onClose={() => setSortOpen(false)}
        />
      )}
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
