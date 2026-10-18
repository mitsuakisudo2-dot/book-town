import assert from "node:assert/strict";
import { createRegisteredBook } from "../src/lib/books";
import {
  createJournalSender,
  createLibraryJournal,
  decideBookId,
  heldItem,
  JOURNAL_DAYS,
  JOURNAL_KEY,
  journalOwner,
  keepRead,
  readJournal,
  readSort,
  refusedItems,
  retryRefused,
  sendJournal,
  sentNotice,
  settleJournal,
  undoScan,
  waitingForTitle,
  type LibraryJournal,
  type ScanItem,
} from "../src/lib/library-journal";
import type { OpenBdAnswer } from "../src/lib/openbd";
import { createMemoryRepository } from "../src/lib/repository";
import {
  closingNotice,
  forgetRead,
  nextFrame,
  noteOther,
  noteRead,
  noteTaken,
  NO_READS,
  readBarcode,
  SAME_BOOK_MS,
  scanReaction,
  SCAN_COPY,
  stillInView,
  type InView,
  type ScanTown,
  type SessionReads,
} from "../src/lib/scan";
import { createTownStore, journalTownOf } from "../src/lib/store";
import {
  counterId,
  type TownBackend,
  type TownBackendListener,
} from "../src/lib/town-backend";
import { emptyTown } from "../src/lib/town-remote";
import type { PersistenceStatus, TownState } from "../src/lib/types";

// The continuous scanner's journal (控え) and read logic: sending a read
// twice never makes two books, a read leaves the device only once it is
// saved, the 3-second rule, and what is kept. Everything runs inside main()
// because tsx compiles this file as CommonJS.

/** A checked ISBN-13 for a number: 978-4-10-nnnnnn-c. */
function isbnOf(n: number): string {
  const body = "978410" + String(n).padStart(6, "0");
  const sum = body
    .split("")
    .reduce(
      (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
      0,
    );
  return body + String((10 - (sum % 10)) % 10);
}

const OWNER = "8f6a2c1e-5b7d-4e1a-9c3f-2d4b6a8e0c11";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** localStorage, in memory: what was written, in order, and a switch to refuse. */
function fakeStorage(log: string[] = []) {
  const values = new Map<string, string>();
  let refusing = false;
  return {
    values,
    log,
    refuse(on: boolean) {
      refusing = on;
    },
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (refusing) throw new Error("QuotaExceededError");
      log.push("journal " + value);
      values.set(key, value);
    },
    removeItem(key: string) {
      log.push("journal removed");
      values.delete(key);
    },
  };
}

/** The rows a reader's town is read from: books, and their library marks. */
interface Db {
  books: Map<string, { id: string; isbn?: string; title: string }>;
  marks: Set<string>;
  /** Rows past the newest 300 that no mark refers to: not read with the town. */
  old: Set<string>;
}
const database = (): Db => ({
  books: new Map(),
  marks: new Set(),
  old: new Set(),
});
const rowsWithIsbn = (db: Db, isbn: string) =>
  [...db.books.values()].filter((row) => row.isbn === isbn);

function townOf(db: Db): TownState {
  return {
    ...emptyTown(),
    books: [...db.books.values()]
      .filter((row) => db.marks.has(row.id) || !db.old.has(row.id))
      .map((row) =>
        createRegisteredBook(row.id, {
          title: row.title,
          author: "",
          ...(row.isbn ? { isbn: row.isbn } : {}),
        }),
      ),
    library: [...db.marks],
  };
}

/**
 * An account backend over `db`, written as the real sync does: new books
 * first (upsert on id, duplicates ignored), then the library marks; only
 * when the test flushes. `gate` holds the town's read.
 */
function accountBackend(db: Db, log: string[] = [], gate?: Promise<void>) {
  let synced: TownState | null = null;
  let latest: TownState | null = null;
  let listener: TownBackendListener | null = null;
  let closed = false;
  const backend = {
    kind: "account" as const,
    newId: (
      kind: Parameters<TownBackend["newId"]>[0],
      ids: string[],
      isbn?: string | null,
    ) => (kind === "book" ? crypto.randomUUID() : counterId(kind, ids, isbn)),
    async load() {
      await gate;
      const state = townOf(db);
      synced = latest = state;
      return { state, status: "saved" as const };
    },
    save(state: TownState): PersistenceStatus {
      log.push("save");
      latest = state;
      return latest === synced ? "saved" : "saving";
    },
    watch(next: TownBackendListener) {
      listener = next;
      return () => {
        if (listener === next) listener = null;
      };
    },
    close() {
      closed = true;
    },
    /** Writes what waits; "books" stops before the library marks. */
    flush(part: "books" | "all" = "all") {
      if (!synced || !latest || closed) return;
      for (const book of latest.books)
        if (
          !synced.books.some((old) => old.id === book.id) &&
          !db.books.has(book.id)
        )
          db.books.set(book.id, {
            id: book.id,
            isbn: book.isbn,
            title: book.title,
          });
      if (part === "books") return;
      for (const id of latest.library)
        if (!synced.library.includes(id)) db.marks.add(id);
      for (const id of synced.library)
        if (!latest.library.includes(id)) db.marks.delete(id);
      synced = latest;
      listener?.status("saved");
    },
    /** The database refused: the town is read again, unsent changes gone. */
    refuse() {
      const state = townOf(db);
      synced = latest = state;
      listener?.replace(state, "recovered");
    },
  };
  return backend;
}

/** One page load of a signed-in reader: its store, journal and town. */
async function pageLoad(
  db: Db,
  storage: ReturnType<typeof fakeStorage>,
  options: { gate?: Promise<void>; log?: string[] } = {},
) {
  const backend = accountBackend(db, options.log, options.gate);
  const store = createTownStore(backend);
  store.initialize();
  await tick();
  const journal = createLibraryJournal(() => storage);
  const town = journalTownOf(store, () => OWNER);
  return { backend, store, journal, town };
}

/** openBD, answered here: a title, null for a book it does not have, or no answer. */
function openBd(answers: Record<string, string | null | "no answer">) {
  const asked: string[][] = [];
  const lookUp = async (isbns: string[]): Promise<OpenBdAnswer> => {
    asked.push(isbns);
    await tick();
    const found = new Map();
    const unanswered: string[] = [];
    for (const isbn of isbns) {
      const answer = answers[isbn];
      if (answer === "no answer") unanswered.push(isbn);
      else if (answer)
        found.set(isbn, {
          isbn,
          title: answer,
          author: "試験 花子",
          publisher: "",
        });
    }
    return { found, unanswered };
  };
  return { lookUp, asked };
}

const read = (
  journal: LibraryJournal,
  isbn: string,
  extra: { session?: string; known?: { title: string; author: string } } = {},
) =>
  keepRead(journal, OWNER, {
    session: extra.session ?? journal.newSession(),
    isbn,
    via: "scan",
    known: extra.known,
  });

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const X = isbnOf(1);
  const Y = isbnOf(2);

  await check(
    "sending a read again from the journal never makes a second book (U1)",
    async () => {
      // The first page read X and handed it to its store; then the tab was
      // closed (a) before anything was written, (b) after the book row but
      // before the library mark, with the row read back with the town, (c)
      // the same with the row past the newest 300, (d) after both.
      for (const [written, old] of [
        ["nothing", false],
        ["books", false],
        ["books", true],
        ["all", false],
      ] as const) {
        const db = database();
        const storage = fakeStorage();
        const first = await pageLoad(db, storage);
        const item = read(first.journal, X);
        const { lookUp } = openBd({ [X]: "華氏451度" });
        const sent = await sendJournal(first.journal, OWNER, first.town, {
          lookUp,
        });
        assert.deepEqual(
          sent.map((entry) => entry.result),
          ["added"],
        );
        assert.equal(first.journal.items(OWNER)[0].state, "registered");
        if (written !== "nothing") first.backend.flush(written);
        if (old) db.old.add(item.bookId);
        // The next page load, on the same device.
        const log: string[] = [];
        const next = await pageLoad(db, storage, { log });
        const before = next.store.getSnapshot();
        const again = await sendJournal(next.journal, OWNER, next.town, {
          lookUp,
        });
        if (written === "all") {
          // In the library already: nothing is committed, and it is let go.
          assert.deepEqual(
            again.map((entry) => entry.result),
            ["already"],
          );
          assert.equal(next.store.getSnapshot(), before);
          assert.deepEqual(log, []);
          assert.deepEqual(next.journal.items(OWNER), []);
        } else {
          assert.deepEqual(
            again.map((entry) => entry.result),
            ["added"],
          );
          next.backend.flush();
        }
        const rows = rowsWithIsbn(db, X);
        assert.deepEqual(
          rows.map((row) => row.id),
          [item.bookId],
          `one book row for ${written}${old ? " (old)" : ""}`,
        );
        assert.deepEqual([...db.marks], [item.bookId]);
        // Saved: the journal lets it go.
        settleJournal(next.journal, OWNER, next.town);
        assert.deepEqual(next.journal.items(OWNER), []);
      }
      // Two sends at once: one book, one mark, one question to openBD.
      const db = database();
      const page = await pageLoad(db, fakeStorage());
      read(page.journal, X);
      const { lookUp, asked } = openBd({ [X]: "華氏451度" });
      const [one, two] = await Promise.all([
        sendJournal(page.journal, OWNER, page.town, { lookUp }),
        sendJournal(page.journal, OWNER, page.town, { lookUp }),
      ]);
      assert.deepEqual(
        [...one, ...two].map((entry) => entry.result),
        ["added"],
      );
      assert.equal(asked.length, 1);
      page.backend.flush();
      assert.equal(rowsWithIsbn(db, X).length, 1);
      assert.equal(db.marks.size, 1);
    },
  );

  await check(
    "a book read before is held, and re-reading it makes no second row",
    async () => {
      // The tab was closed after the book row, before the mark; the row is
      // past the newest 300. Read again while the town loads: the waiting
      // item is held, not read a second time.
      const db = database();
      const storage = fakeStorage();
      const first = await pageLoad(db, storage);
      const item = read(first.journal, X, {
        known: { title: "華氏451度", author: "" },
      });
      await sendJournal(first.journal, OWNER, first.town);
      first.backend.flush("books");
      db.old.add(item.bookId);
      let open = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      const next = await pageLoad(db, storage, { gate });
      assert.equal(next.town.ready(), false);
      const held = heldItem(next.journal, OWNER, next.town.generation(), X);
      assert.equal(held?.id, item.id);
      assert.equal(
        scanReaction(NO_READS, X, 0, null, (isbn) =>
          heldItem(next.journal, OWNER, next.town.generation(), isbn),
        ).kind,
        "held",
      );
      open();
      await tick();
      await sendJournal(next.journal, OWNER, next.town);
      next.backend.flush();
      assert.deepEqual(
        rowsWithIsbn(db, X).map((row) => row.id),
        [item.bookId],
      );
      assert.equal(next.journal.items(OWNER).length, 1);
      // Handed to this backend: no longer held; the library answers.
      assert.equal(
        heldItem(next.journal, OWNER, next.town.generation(), X),
        undefined,
      );
    },
  );

  await check(
    "the book id is in the journal before the store can send it (U2)",
    async () => {
      const log: string[] = [];
      const db = database();
      let open = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      const page = await pageLoad(db, fakeStorage(log), { gate, log });
      // Read while the town loads: the id is decided at the read all the same.
      const item = read(page.journal, X, {
        known: { title: "華氏451度", author: "" },
      });
      const id = item.bookId;
      assert.match(id, /^[0-9a-f-]{36}$/);
      assert.ok(log[0].startsWith("journal ") && log[0].includes(id));
      const waiting = await sendJournal(page.journal, OWNER, page.town);
      assert.deepEqual(
        waiting.map((entry) => entry.result),
        ["waiting"],
      );
      assert.equal(log.includes("save"), false);
      open();
      await tick();
      const sent = await sendJournal(page.journal, OWNER, page.town);
      assert.deepEqual(
        sent.map((entry) => entry.result),
        ["added"],
      );
      assert.ok(log.indexOf("save") > 0);
      assert.ok(page.store.getSnapshot().library.includes(id));
      // The demo decides the id the store would give it.
      assert.equal(decideBookId("demo", X), "isbn-" + X);
    },
  );

  await check(
    "a read leaves the journal only once it is saved (U3)",
    async () => {
      const db = database();
      const page = await pageLoad(db, fakeStorage());
      read(page.journal, X, { known: { title: "華氏451度", author: "" } });
      await sendJournal(page.journal, OWNER, page.town);
      // Saving: kept, as handed to the store.
      assert.equal(page.town.status(), "saving");
      settleJournal(page.journal, OWNER, page.town);
      assert.equal(page.journal.items(OWNER)[0].state, "registered");
      page.backend.flush();
      settleJournal(page.journal, OWNER, page.town, "saved");
      assert.deepEqual(page.journal.items(OWNER), []);
      // Refused: a book in the town read again is let go, the rest is
      // marked refused and never sent again by itself.
      const kept = read(page.journal, Y, {
        known: { title: "門", author: "" },
      });
      const landed = read(page.journal, isbnOf(9), {
        known: { title: "道草", author: "" },
      });
      await sendJournal(page.journal, OWNER, page.town);
      // The second one's rows were written before the refusal.
      db.books.set(landed.bookId, {
        id: landed.bookId,
        isbn: isbnOf(9),
        title: "道草",
      });
      db.marks.add(landed.bookId);
      page.backend.refuse();
      settleJournal(page.journal, OWNER, page.town, "recovered");
      assert.deepEqual(
        page.journal.items(OWNER).map((entry) => [entry.id, entry.state]),
        [[kept.id, "refused"]],
      );
      assert.deepEqual(refusedItems(page.journal.items(OWNER)).length, 1);
      assert.deepEqual(await sendJournal(page.journal, OWNER, page.town), []);
      const retried = await retryRefused(page.journal, OWNER, page.town);
      assert.deepEqual(
        retried.map((entry) => entry.result),
        ["added"],
      );
      page.backend.flush();
      settleJournal(page.journal, OWNER, page.town, "saved");
      assert.deepEqual(page.journal.items(OWNER), []);
      assert.equal(rowsWithIsbn(db, Y).length, 1);
      // The demo is saved at once: let go at once.
      const storage = fakeStorage();
      const demo = createTownStore(createMemoryRepository());
      demo.initialize();
      const demoJournal = createLibraryJournal(() => storage);
      const demoTown = journalTownOf(demo, () => "demo");
      const demoItem = keepRead(demoJournal, "demo", {
        session: demoJournal.newSession(),
        isbn: X,
        via: "isbn",
        known: { title: "華氏451度", author: "" },
      });
      const sent = await sendJournal(demoJournal, "demo", demoTown);
      assert.deepEqual(
        sent.map((entry) => entry.result),
        ["added"],
      );
      assert.deepEqual(demo.getSnapshot().library, ["isbn-" + X]);
      assert.equal(demoItem.bookId, "isbn-" + X);
      assert.deepEqual(demoJournal.items("demo"), []);
      assert.equal(storage.values.size, 0);
    },
  );

  await check(
    "what another backend did not write is sent again, once (U3)",
    async () => {
      // A failed token refresh moved the town elsewhere, then the reader
      // signed in again without reloading: the new backend reads "saved",
      // which says nothing of what the old one never wrote.
      const db = database();
      const page = await pageLoad(db, fakeStorage());
      const notices: string[] = [];
      const stop = createJournalSender(page.journal, page.town, {
        notify: (message) => notices.push(message),
      }).start();
      const item = read(page.journal, X, {
        known: { title: "華氏451度", author: "" },
      });
      page.journal.live.add(item.session);
      await sendJournal(page.journal, OWNER, page.town, { only: [item.id] });
      assert.ok(page.journal.handed(item.id, page.town.generation()));
      page.journal.live.delete(item.session);
      const again = accountBackend(db);
      page.store.use(again);
      await tick();
      await tick();
      await tick();
      // Still there, and sent to the new backend: one book.
      assert.ok(page.store.getSnapshot().library.includes(item.bookId));
      assert.equal(page.journal.items(OWNER).length, 1);
      assert.ok(page.journal.handed(item.id, page.town.generation()));
      again.flush();
      assert.deepEqual(page.journal.items(OWNER), []);
      assert.deepEqual(
        rowsWithIsbn(db, X).map((row) => row.id),
        [item.bookId],
      );
      assert.deepEqual([...db.marks], [item.bookId]);
      assert.deepEqual(notices, ["控えていた1冊を登録しました"]);
      stop();
      // A send that began on the old backend leaves its item waiting.
      const slow = await pageLoad(db, fakeStorage());
      const late = read(slow.journal, Y);
      let answer = () => {};
      const asked = new Promise<void>((resolve) => (answer = resolve));
      const sending = sendJournal(slow.journal, OWNER, slow.town, {
        lookUp: async (isbns) => {
          await asked;
          return {
            found: new Map(
              isbns.map((isbn) => [
                isbn,
                { isbn, title: "門", author: "", publisher: "" },
              ]),
            ),
            unanswered: [],
          };
        },
      });
      slow.store.use(accountBackend(db));
      answer();
      const sent = await sending;
      assert.deepEqual(
        sent.map((entry) => entry.result),
        ["waiting"],
      );
      assert.equal(
        slow.journal.items(OWNER).find((entry) => entry.id === late.id)?.state,
        "ready",
      );
      assert.equal(
        slow.store.getSnapshot().library.includes(late.bookId),
        false,
      );
    },
  );

  await check("the 3-second rule and the reaction to a read (U4)", () => {
    const book = createRegisteredBook("isbn-" + Y, {
      title: "門",
      author: "",
      isbn: Y,
    });
    const known = createRegisteredBook("isbn-" + X, {
      title: "こころ",
      author: "",
      isbn: X,
    });
    const town: ScanTown = {
      inLibrary: (isbn) => (isbn === Y ? book : undefined),
      known: (isbn) => (isbn === X ? known : undefined),
    };
    const none = () => undefined;
    const A = isbnOf(10);
    const B = isbnOf(11);
    let reads: SessionReads = noteRead(NO_READS, A, 0, "in");
    assert.equal(scanReaction(reads, A, 2999, town, none).kind, "same");
    assert.deepEqual(scanReaction(reads, A, SAME_BOOK_MS, town, none), {
      kind: "again",
      was: "in",
    });
    // Held in view for 10 seconds, frame after frame: still the same book.
    let inView: InView = { [A]: 0 };
    for (let at = 200; at <= 10_000; at += 200) {
      const frame = nextFrame(inView, [A], at);
      assert.deepEqual(frame.fresh, []);
      inView = frame.inView;
      reads = stillInView(reads, frame.staying, at);
      assert.equal(scanReaction(reads, A, at, town, none).kind, "same");
    }
    // A, B, A: the second A is not the last read, so it is a repeat at any speed.
    reads = noteRead(NO_READS, A, 0, "in");
    reads = noteRead(reads, B, 100, "in");
    assert.deepEqual(scanReaction(reads, A, 200, town, none), {
      kind: "again",
      was: "in",
    });
    // What a read came to: kept only, then registered.
    reads = noteRead(NO_READS, A, 0, "held");
    assert.deepEqual(scanReaction(reads, A, 5000, town, none), {
      kind: "again",
      was: "held",
    });
    reads = noteTaken(reads, A, "in");
    assert.deepEqual(scanReaction(reads, A, 5000, town, none), {
      kind: "again",
      was: "in",
    });
    // Sent again later, the library has it: still put in this time.
    assert.equal(noteTaken(reads, A, "already").taken[A], "in");
    // ［取り消す］: new again.
    reads = forgetRead(reads, A);
    assert.equal(scanReaction(reads, A, 5000, town, none).kind, "new");
    assert.equal(noteTaken(reads, A, "in").taken[A], undefined);
    // A book in the library, one held from before, one the town knows.
    assert.equal(scanReaction(NO_READS, Y, 0, town, none).kind, "already");
    const item = { isbn: B, state: "untitled" } as ScanItem;
    assert.deepEqual(
      scanReaction(NO_READS, B, 0, town, (isbn) =>
        isbn === B ? item : undefined,
      ),
      { kind: "held", item },
    );
    assert.deepEqual(scanReaction(NO_READS, X, 0, town, none), {
      kind: "new",
      known,
    });
    // The town not read yet: nothing is known.
    assert.deepEqual(scanReaction(NO_READS, Y, 0, null, none), { kind: "new" });
  });

  await check("frames, and the hints for other barcodes (U5)", () => {
    const A = isbnOf(20);
    const PRICE = "1920193006001";
    // A held in view, missing a frame now and then: one read. Frames
    // 200ms apart, as before 10-18.
    let inView: InView = {};
    const fresh: string[] = [];
    for (const [at, frame] of [[A], [], [A], [], [], [A], [A]].entries()) {
      const next = nextFrame(inView, frame, at * 200);
      inView = next.inView;
      fresh.push(
        ...next.fresh.map((code) =>
          code.kind === "isbn" ? code.isbn : code.code,
        ),
      );
    }
    assert.deepEqual(fresh, [A]);
    // Each new camera frame read, 30 a second: missed for half a second,
    // it is still in view.
    inView = {};
    const quick: string[] = [];
    for (let frame = 0; frame <= 30; frame++) {
      const missed = frame > 5 && frame < 20;
      const next = nextFrame(inView, missed ? [] : [A], (frame * 1000) / 30);
      inView = next.inView;
      quick.push(
        ...next.fresh.map((code) =>
          code.kind === "isbn" ? code.isbn : code.code,
        ),
      );
    }
    assert.deepEqual(quick, [A]);
    // Gone for more than 0.6 seconds: it comes back as a read, and within
    // 3 seconds that read is the same book.
    inView = {};
    const seen: string[] = [];
    for (const [at, frame] of [[A], [], [], [], [A]].entries()) {
      const next = nextFrame(inView, frame, at * 200);
      inView = next.inView;
      seen.push(
        ...next.fresh.map((code) =>
          code.kind === "isbn" ? code.isbn : code.code,
        ),
      );
    }
    assert.deepEqual(seen, [A, A]);
    assert.equal(
      scanReaction(
        noteRead(NO_READS, A, 0, "in"),
        A,
        800,
        null,
        () => undefined,
      ).kind,
      "same",
    );
    // An ISBN with the price code under it: only the ISBN.
    const both = nextFrame({}, [PRICE, A], 0);
    assert.deepEqual(both.fresh, [{ kind: "isbn", isbn: A }]);
    assert.equal(PRICE in both.inView, false);
    // The price code alone, twice: one hint; a third time, none.
    let reads = NO_READS;
    const hints: (string | null)[] = [];
    for (let time = 0; time < 3; time++) {
      const noted = noteOther(reads, "price");
      reads = noted.reads;
      hints.push(noted.hint);
    }
    assert.deepEqual(hints, [null, SCAN_COPY.hint.price, null]);
    for (const kind of ["magazine", "other"] as const) {
      const first = noteOther(reads, kind);
      const second = noteOther(first.reads, kind);
      const third = noteOther(second.reads, kind);
      assert.deepEqual(
        [first.hint, second.hint, third.hint],
        [null, SCAN_COPY.hint[kind], null],
      );
      reads = third.reads;
    }
  });

  await check("barcodes: books, price codes, magazines (U6)", () => {
    assert.deepEqual(readBarcode("9784101010137"), {
      kind: "isbn",
      isbn: "9784101010137",
    });
    assert.deepEqual(readBarcode("979-10-90636-07-1"), {
      kind: "isbn",
      isbn: "9791090636071",
    });
    assert.deepEqual(readBarcode("9784101010138"), {
      kind: "other",
      code: "9784101010138",
    });
    assert.equal(readBarcode("1920193006001").kind, "price");
    assert.equal(readBarcode("4910012340356").kind, "magazine");
    assert.equal(readBarcode("4901234567894").kind, "other");
    assert.equal(readBarcode("4501234567890").kind, "other");
    // Typed ISBN-10s are read as the ISBN-13 they are.
    assert.deepEqual(readBarcode("4101010137"), {
      kind: "isbn",
      isbn: "9784101010137",
    });
  });

  await check(
    "a title that cannot be found is never written (U7)",
    async () => {
      const db = database();
      const log: string[] = [];
      const page = await pageLoad(db, fakeStorage(), { log });
      const before = page.store.getSnapshot();
      const absent = read(page.journal, X);
      const silent = read(page.journal, Y);
      const { lookUp, asked } = openBd({ [X]: null, [Y]: "no answer" });
      const sending = sendJournal(page.journal, OWNER, page.town, {
        lookUp,
      });
      // While openBD is asked, they are not 書名待ち yet.
      assert.deepEqual(
        waitingForTitle(page.journal.items(OWNER), page.journal.sending()),
        [],
      );
      const sent = await sending;
      assert.equal(page.journal.sending().size, 0);
      assert.deepEqual(
        sent.map((entry) => entry.result),
        ["untitled", "lookup"],
      );
      assert.deepEqual(asked, [[X, Y]]);
      assert.equal(page.store.getSnapshot(), before);
      assert.deepEqual(log, []);
      assert.deepEqual(
        page.journal.items(OWNER).map((entry) => entry.state),
        ["untitled", "lookup"],
      );
      assert.equal(waitingForTitle(page.journal.items(OWNER)).length, 2);
      // Offline: openBD is not asked at all.
      await sendJournal(page.journal, OWNER, page.town, {
        lookUp,
        online: () => false,
      });
      assert.equal(asked.length, 1);
      // A title the town knows needs no question.
      const Z = isbnOf(3);
      db.books.set("00000000-0000-4000-8000-000000000b01", {
        id: "00000000-0000-4000-8000-000000000b01",
        isbn: Z,
        title: "街の本",
      });
      const town = await pageLoad(db, fakeStorage());
      read(town.journal, Z);
      const known = await sendJournal(town.journal, OWNER, town.town, {
        lookUp,
      });
      assert.deepEqual(
        known.map((entry) => entry.result),
        ["added"],
      );
      assert.equal(asked.length, 1);
      // Untitled, then typed: registered with the id decided at the read.
      page.journal.update(OWNER, absent.id, {
        title: "書名を打った本",
        author: "",
        state: "ready",
      });
      const typed = await sendJournal(page.journal, OWNER, page.town, {
        lookUp,
        only: [absent.id],
      });
      assert.deepEqual(
        typed.map((entry) => entry.result),
        ["added"],
      );
      assert.ok(page.store.getSnapshot().library.includes(absent.bookId));
      assert.equal(
        page.journal.items(OWNER).find((entry) => entry.id === silent.id)
          ?.state,
        "lookup",
      );
      // Entered by hand (［手で入力］) while openBD was asked again: the
      // library has it, so the read is that book, and is let go once saved.
      const byHand = await sendJournal(page.journal, OWNER, page.town, {
        only: [silent.id],
        lookUp: async (isbns) => {
          page.town.register(
            { title: "手で入れた本", author: "", isbn: Y },
            "manual",
          );
          return { found: new Map(), unanswered: isbns };
        },
      });
      assert.deepEqual(
        byHand.map((entry) => entry.result),
        ["already"],
      );
      page.backend.flush();
      settleJournal(page.journal, OWNER, page.town);
      assert.deepEqual(page.journal.items(OWNER), []);
    },
  );

  await check(
    "openBD's long title and author are cut, and an odd price left out (10-0)",
    async () => {
      // Read while the town loads: what openBD answered waits on the device.
      const db = database();
      const storage = fakeStorage();
      let open = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      const page = await pageLoad(db, storage, { gate });
      const item = read(page.journal, X);
      const lookUp = async (isbns: string[]): Promise<OpenBdAnswer> => ({
        found: new Map(
          isbns.map((isbn) => [
            isbn,
            {
              isbn,
              title: "長い題名".repeat(60),
              author: "共著者".repeat(84),
              publisher: "",
              price: 1_200_000,
            },
          ]),
        ),
        unanswered: [],
      });
      const waiting = await sendJournal(page.journal, OWNER, page.town, {
        lookUp,
      });
      assert.deepEqual(
        waiting.map((entry) => entry.result),
        ["waiting"],
      );
      // Written to the device cut, never as openBD wrote it.
      const kept: ScanItem[] = JSON.parse(
        storage.values.get(JOURNAL_KEY + OWNER) ?? "",
      ).items;
      assert.deepEqual(
        kept.map((entry) => [
          entry.id,
          entry.state,
          entry.title,
          entry.author,
          entry.price,
        ]),
        [
          [
            item.id,
            "ready",
            "長い題名".repeat(60).slice(0, 199) + "…",
            "共著者".repeat(84).slice(0, 199) + "…",
            undefined,
          ],
        ],
      );
      open();
      await tick();
      const sent = await sendJournal(page.journal, OWNER, page.town, {
        lookUp,
      });
      assert.deepEqual(
        sent.map((entry) => entry.result),
        ["added"],
      );
      const book = page.store
        .getSnapshot()
        .books.find((entry) => entry.id === item.bookId);
      assert.ok(page.store.getSnapshot().library.includes(item.bookId));
      assert.equal(book?.title, kept[0].title);
      assert.equal(book?.author, kept[0].author);
      assert.equal(book?.price, undefined);
      page.backend.flush();
      settleJournal(page.journal, OWNER, page.town);
      assert.deepEqual(page.journal.items(OWNER), []);
      assert.deepEqual([...db.marks], [item.bookId]);
      // A known book's words are cut as they are kept, too.
      const known = keepRead(page.journal, OWNER, {
        session: page.journal.newSession(),
        isbn: Y,
        via: "scan",
        known: { title: "門", author: "著".repeat(250), price: 1_200_000 },
      });
      assert.equal(known.author, "著".repeat(199) + "…");
      assert.equal(known.price, undefined);
      assert.equal(known.state, "ready");
    },
  );

  await check(
    "while the town loads, reads wait and then register once (U8)",
    async () => {
      const db = database();
      let open = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      const log: string[] = [];
      const page = await pageLoad(db, fakeStorage(), { gate, log });
      const notices: string[] = [];
      const stop = createJournalSender(page.journal, page.town, {
        notify: (message) => notices.push(message),
      }).start();
      read(page.journal, X, { known: { title: "華氏451度", author: "" } });
      const waiting = await sendJournal(page.journal, OWNER, page.town);
      assert.deepEqual(
        waiting.map((entry) => entry.result),
        ["waiting"],
      );
      assert.deepEqual(log, []);
      open();
      await tick();
      await tick();
      assert.equal(page.store.getSnapshot().library.length, 1);
      assert.equal(log.filter((entry) => entry === "save").length, 1);
      // Sent once: a second send has nothing left to send.
      assert.deepEqual(await sendJournal(page.journal, OWNER, page.town), []);
      assert.deepEqual(notices, ["控えていた1冊を登録しました"]);
      stop();
      // The account could not be read: kept, nothing committed.
      const unread = createTownStore({
        kind: "unavailable",
        newId: counterId,
        load: () => ({ state: emptyTown(), status: "unavailable" }),
        save: () => "unavailable",
      });
      unread.initialize();
      const storage = fakeStorage();
      const journal = createLibraryJournal(() => storage);
      const town = journalTownOf(unread, () => OWNER);
      read(journal, X, { known: { title: "華氏451度", author: "" } });
      const sent = await sendJournal(journal, OWNER, town);
      assert.deepEqual(
        sent.map((entry) => entry.result),
        ["unavailable"],
      );
      assert.deepEqual(unread.getSnapshot().library, []);
      assert.equal(journal.items(OWNER)[0].state, "ready");
    },
  );

  await check("the journal on the device (U9)", async () => {
    const storage = fakeStorage();
    let now = Date.parse("2026-10-13T12:00:00Z");
    const journal = createLibraryJournal(
      () => storage,
      () => now,
    );
    const mine = read(journal, X);
    keepRead(journal, "someone-else", {
      session: journal.newSession(),
      isbn: Y,
      via: "isbn",
    });
    // One key per reader, who never sees another's.
    assert.deepEqual(
      journal.items(OWNER).map((entry) => entry.isbn),
      [X],
    );
    assert.deepEqual(
      journal.items("someone-else").map((entry) => entry.isbn),
      [Y],
    );
    const stored = JSON.parse(storage.values.get(JOURNAL_KEY + OWNER) ?? "");
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.items, [mine]);
    // Read again in a new page: old, malformed and unknown items are dropped.
    const old = {
      ...mine,
      id: mine.id + "-old",
      at: new Date(now - (JOURNAL_DAYS + 1) * 86_400_000).toISOString(),
    };
    storage.values.set(
      JOURNAL_KEY + OWNER,
      JSON.stringify({
        version: 1,
        items: [
          mine,
          old,
          { ...mine, id: "bad-isbn", isbn: "9784101010138" },
          { ...mine, id: "no-id", bookId: "" },
          "nothing",
          { ...mine, id: "op", kind: "op" },
          // Too long, or a price out of range: cut or left out, still kept.
          {
            ...mine,
            id: "big",
            title: "あ".repeat(201),
            author: "い".repeat(300),
            price: 1_200_000,
            state: "ready",
          },
          { ...mine, id: "odd", title: 7, price: 0.5, state: "ready" },
        ],
      }),
    );
    assert.deepEqual(
      readJournal(storage.values.get(JOURNAL_KEY + OWNER) ?? null, now),
      [
        mine,
        {
          ...mine,
          id: "big",
          title: "あ".repeat(199) + "…",
          author: "い".repeat(199) + "…",
          state: "ready",
        },
        // With no title left, it asks for one again.
        { ...mine, id: "odd", state: "lookup" },
      ],
    );
    assert.deepEqual(
      readJournal(JSON.stringify({ version: 2, items: [mine] }), now),
      [],
    );
    assert.deepEqual(readJournal("{", now), []);
    storage.values.set(
      JOURNAL_KEY + OWNER,
      JSON.stringify({ version: 1, items: [mine] }),
    );
    now += 1000;
    // Storage refusing: the journal works in memory and says so.
    storage.refuse(true);
    const memory = read(journal, Y);
    assert.equal(journal.kept(), false);
    assert.deepEqual(
      journal.items(OWNER).map((entry) => entry.id),
      [mine.id, memory.id],
    );
    storage.refuse(false);
    journal.update(OWNER, memory.id, { state: "untitled" });
    assert.equal(journal.kept(), true);
    assert.equal(
      JSON.parse(storage.values.get(JOURNAL_KEY + OWNER) ?? "").items.length,
      2,
    );
    // ログアウト lets the reader's journal go.
    journal.forget(OWNER);
    assert.equal(storage.values.has(JOURNAL_KEY + OWNER), false);
    assert.deepEqual(journal.items(OWNER), []);
    // Whose journal: the demo's, the signed-in reader's, nobody's.
    const user = { id: OWNER, email: "" };
    assert.equal(journalOwner({ status: "demo" }, "local"), "demo");
    assert.equal(
      journalOwner(
        { status: "signed-in", user, profile: {} as never },
        "account",
      ),
      OWNER,
    );
    assert.equal(
      journalOwner(
        { status: "signed-in", user, profile: {} as never },
        "unavailable",
      ),
      OWNER,
    );
    assert.equal(
      journalOwner({ status: "unavailable", user }, "unavailable"),
      OWNER,
    );
    assert.equal(
      journalOwner(
        { status: "signed-in", user, profile: {} as never },
        "visitor",
      ),
      null,
    );
    assert.equal(journalOwner({ status: "signed-out" }, "visitor"), null);
    assert.equal(journalOwner({ status: "loading" }, "local"), null);
    assert.equal(
      journalOwner({ status: "needs-profile", user }, "visitor"),
      null,
    );
  });

  await check("two tabs of one reader never write over each other (U9)", () => {
    const storage = fakeStorage();
    const tabA = createLibraryJournal(() => storage);
    const tabB = createLibraryJournal(() => storage);
    // B has been open since before A read anything.
    assert.deepEqual(tabB.items(OWNER), []);
    const a = read(tabA, X);
    const b = read(tabB, Y);
    const both = (journal: LibraryJournal) => {
      journal.reload(OWNER);
      return journal
        .items(OWNER)
        .map((entry) => entry.id)
        .sort();
    };
    assert.deepEqual(both(tabA), [a.id, b.id].sort());
    assert.deepEqual(both(tabB), [a.id, b.id].sort());
    // Taken out in A, then B, which had not heard, changes it: still out.
    const staleB = createLibraryJournal(() => storage);
    staleB.items(OWNER);
    tabA.remove(OWNER, [a.id]);
    staleB.update(OWNER, a.id, { state: "ready" });
    assert.deepEqual(both(tabA), [b.id]);
    assert.deepEqual(both(staleB), [b.id]);
  });

  await check(
    "a 連続設定 read with a book is put on it as a new book, never on one the library had",
    async () => {
      const storage = fakeStorage();
      const demo = createTownStore(createMemoryRepository());
      demo.initialize();
      const shelf = demo.actions.makeLibraryShelf("お気に入りの漫画", "");
      assert.ok(shelf);
      const journal = createLibraryJournal(() => storage);
      const town = journalTownOf(demo, () => "demo");
      const sort = {
        status: "finished" as const,
        owned: "no" as const,
        shelves: [shelf],
      };
      const session = journal.newSession();
      keepRead(journal, "demo", {
        session,
        isbn: X,
        via: "scan",
        known: { title: "華氏451度", author: "" },
        sort,
      });
      await sendJournal(journal, "demo", town);
      const id = "isbn-" + X;
      const entry = demo.getSnapshot().libraryEntries[id];
      assert.equal(entry.status, "finished");
      assert.equal(entry.owned, "no");
      assert.ok(
        demo
          .getSnapshot()
          .libraryShelfBooks.some(
            (row) => row.bookId === id && row.shelfId === shelf,
          ),
      );
      // 未指定 writes no status; 持っている is written.
      keepRead(journal, "demo", {
        session,
        isbn: Y,
        via: "scan",
        known: { title: "道草", author: "" },
        sort: { status: null, owned: "yes", shelves: [] },
      });
      await sendJournal(journal, "demo", town);
      const other = demo.getSnapshot().libraryEntries["isbn-" + Y];
      assert.equal(other.status, null);
      assert.equal(other.owned, "yes");
      // 積読 with 持っている turned off: both stay (けにーさん 2026-10-18).
      const third = "9784101010144";
      keepRead(journal, "demo", {
        session,
        isbn: third,
        via: "scan",
        known: { title: "明暗", author: "" },
        sort: { status: "tsundoku", owned: "no", shelves: [] },
      });
      await sendJournal(journal, "demo", town);
      const both = demo.getSnapshot().libraryEntries["isbn-" + third];
      assert.equal(both.status, "tsundoku");
      assert.equal(both.owned, "no");
      // Read again under another setting: in the library, it stays as it was.
      keepRead(journal, "demo", {
        session,
        isbn: X,
        via: "scan",
        sort: { status: "reading", owned: "yes", shelves: [] },
      });
      const again = await sendJournal(journal, "demo", town);
      assert.deepEqual(
        again.map((entry) => entry.result),
        ["already"],
      );
      assert.equal(demo.getSnapshot().libraryEntries[id].status, "finished");
      assert.equal(demo.getSnapshot().libraryEntries[id].owned, "no");
      // Kept on the device as it was set, and a broken one is let go with
      // the read kept.
      assert.deepEqual(readSort(sort), sort);
      assert.equal(
        readSort({ status: "tsundoku", owned: "maybe", shelves: [] }),
        undefined,
      );
      assert.equal(
        readSort({ status: "done", owned: "yes", shelves: [] }),
        undefined,
      );
      const kept = readJournal(
        JSON.stringify({
          version: 1,
          items: [
            {
              kind: "scan",
              id: "s-1",
              page: "p",
              session: "s",
              isbn: X,
              via: "scan",
              bookId: "isbn-" + X,
              title: "華氏451度",
              state: "ready",
              at: new Date().toISOString(),
              sort: { status: "finished", owned: "yes", shelves: [7] },
            },
          ],
        }),
        Date.now(),
      );
      assert.equal(kept.length, 1);
      assert.equal(kept[0].sort, undefined);
    },
  );

  await check("［取り消す］ is decided when it is pressed", async () => {
    const db = database();
    const page = await pageLoad(db, fakeStorage());
    // Registered just now, though the card may still say it is looking.
    const item = read(page.journal, X, {
      known: { title: "華氏451度", author: "" },
    });
    await sendJournal(page.journal, OWNER, page.town);
    assert.equal(undoScan(page.journal, OWNER, page.town, item.id), "undone");
    assert.equal(page.store.getSnapshot().library.includes(item.bookId), false);
    assert.deepEqual(page.journal.items(OWNER), []);
    // Taken back while openBD is asked: never registered.
    const late = read(page.journal, Y);
    const sending = sendJournal(page.journal, OWNER, page.town, {
      lookUp: openBd({ [Y]: "門" }).lookUp,
    });
    assert.equal(undoScan(page.journal, OWNER, page.town, late.id), "undone");
    assert.deepEqual(await sending, []);
    assert.equal(page.store.getSnapshot().library.length, 0);
    // The town could not take it out now: it is loading again, on another
    // backend, and may come back with the book. Nothing changed, and it
    // says so; once it is read, the book comes out.
    const Z = isbnOf(4);
    const third = read(page.journal, Z, {
      known: { title: "三冊目", author: "" },
    });
    await sendJournal(page.journal, OWNER, page.town);
    page.backend.flush();
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    page.store.use(accountBackend(db, [], gate));
    assert.equal(page.town.ready(), false);
    assert.equal(undoScan(page.journal, OWNER, page.town, third.id), "not-yet");
    assert.equal(page.journal.cancelled.has(third.id), false);
    assert.equal(page.journal.items(OWNER).length, 1);
    open();
    await tick();
    assert.ok(page.store.getSnapshot().library.includes(third.bookId));
    assert.equal(undoScan(page.journal, OWNER, page.town, third.id), "undone");
    assert.equal(
      page.store.getSnapshot().library.includes(third.bookId),
      false,
    );
    assert.deepEqual(page.journal.items(OWNER), []);
  });

  await check("no 0 and plain facts (U10)", () => {
    assert.equal(closingNotice({ added: 0, waiting: 0, later: 0 }), null);
    for (let added = 0; added <= 3; added++)
      for (let waiting = 0; waiting <= 3; waiting++)
        for (let later = 0; later <= 3; later++) {
          const notice = closingNotice({ added, waiting, later });
          if (added + waiting + later === 0) continue;
          assert.ok(notice && !/(^|\D)0冊/.test(notice), String(notice));
        }
    assert.equal(
      closingNotice({ added: 17, waiting: 0, later: 0 }),
      "17冊を登録しました",
    );
    assert.equal(
      closingNotice({ added: 17, waiting: 2, later: 1 }),
      "17冊を登録しました・書名待ち 2冊・1冊は控えに置きました",
    );
    assert.equal(
      closingNotice({ added: 0, waiting: 2, later: 1 }),
      "3冊を控えました（書名待ち 2冊）",
    );
    assert.equal(
      closingNotice({ added: 0, waiting: 0, later: 1 }),
      "1冊を控えました",
    );
    const journal = createLibraryJournal(() => null);
    assert.equal(sentNotice(journal, []), null);
  });

  await check(
    "a decided id is used only when the town could have given it",
    async () => {
      const db = database();
      const page = await pageLoad(db, fakeStorage());
      const Z = isbnOf(5);
      db.books.set("00000000-0000-4000-8000-000000000b02", {
        id: "00000000-0000-4000-8000-000000000b02",
        isbn: isbnOf(6),
        title: "別の本",
      });
      const other = await pageLoad(db, fakeStorage());
      // Another book's id, or no UUID at all on an account: a new id instead.
      const taken = other.town.register(
        { title: "本", author: "", isbn: Z },
        "scan",
        "00000000-0000-4000-8000-000000000b02",
      );
      assert.ok(
        taken?.result === "added" &&
          taken.bookId !== "00000000-0000-4000-8000-000000000b02",
      );
      const plain = page.town.register(
        { title: "本", author: "", isbn: isbnOf(7) },
        "scan",
        "isbn-1",
      );
      assert.ok(
        plain?.result === "added" && /^[0-9a-f-]{36}$/.test(plain.bookId),
      );
      // The demo takes only the id it would give.
      const demo = createTownStore(createMemoryRepository());
      demo.initialize();
      const odd = demo.actions.registerBook(
        { title: "本", author: "", isbn: Z },
        "scan",
        "my-book-9",
      );
      assert.ok(odd?.result === "added" && odd.bookId === "isbn-" + Z);
    },
  );

  console.log(passed + " scan journal checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
