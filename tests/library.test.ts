import assert from "node:assert/strict";
import {
  applyOp,
  applyReaction,
  applySet,
  contextsOf,
  countsOf,
  DEFAULT_SHELVES,
  ENCOUNTER_MEMO_MAX_LENGTH,
  encounterKey,
  encounterOf,
  encounterSource,
  ENTRY_SOURCES,
  entryContext,
  filterFromParams,
  filterLibrary,
  filterParams,
  followMarks,
  inLibrary,
  isUnsorted,
  legacyLists,
  legacyToLibrary,
  LIBRARY_SETTINGS,
  libraryHiddenOf,
  likeOnly,
  markChanges,
  meetEncounter,
  opBefore,
  PLACEMENT_KEY_MAX_LENGTH,
  popEncounterKind,
  pressStatus,
  reactionSet,
  READING_STATUSES,
  shelvesOf,
  shopBookIds,
  shownShelves,
  undoEncounter,
  validateEncounter,
  validateEntry,
  validateShelf,
  writeMemo,
  type DefaultShelf,
  type Encounter,
  type EncounterInput,
  type EncounterKind,
  type EntrySource,
  type LibraryEntry,
  type LibraryFilter,
  type LibraryOp,
  type LibrarySet,
  type LibraryShelf,
  type LibraryState,
  type MarkKeeps,
  type MarkKind,
  type MarkLists,
  type OpBefore,
  type ShelfBook,
} from "../src/lib/library";
import type { Poster } from "../src/lib/posters";
import {
  ME_ID,
  type Book,
  type Post,
  type ReadingRecord,
  type ReadingSession,
  type Shop,
} from "../src/lib/types";
import { contextOf, entryOf, LIBRARY_CASES } from "./fixtures/library-cases";

// The library's rules (src/lib/library.ts) against the shared cases
// (tests/fixtures/library-cases.json) and the acceptance list of L1d (review
// doc 9-2), with the owner's decisions on encounters and memos.

const failures: string[] = [];
let passed = 0;
function check(name: string, run: () => void) {
  try {
    run();
    passed += 1;
  } catch (error) {
    failures.push(name);
    console.error(`FAILED ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------- the town

const AT = "2026-10-01T09:00:00.000Z";
/** The database's time for the trigger's cases. */
const DB_NOW = "2026-10-01T12:00:00.000Z";
const BEFORE = "2026-09-01T00:00:00.000Z";
const plus = (ms: number) => new Date(Date.parse(AT) + ms).toISOString();
const NONE: ReadonlySet<string> = new Set();
const uuid = (n: number) =>
  "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const OTHER = uuid(0xb);
const SHOP_ID = uuid(0xf1);
const SHELF_SF = uuid(0xc1);
const SHELF_GONE = uuid(0xc2);
const SHELF_EMPTY = uuid(0xc3);
const SHELF_SHOWN = uuid(0xc4);
const BATCH = uuid(0xb1);
const BATCH_2 = uuid(0xb2);

const book = (id: string, more: Partial<Book> = {}): Book => ({
  id,
  title: id,
  author: "著者",
  genre: "",
  summary: "",
  color: "#888888",
  ink: "#111111",
  height: 200,
  thickness: 20,
  pattern: 0,
  ...more,
});

const rows = (...entries: LibraryEntry[]) =>
  Object.fromEntries(entries.map((e) => [e.bookId, e]));

function town(more: Partial<LibraryState> = {}): LibraryState {
  const entries = more.libraryEntries ?? {};
  return {
    books: Object.keys(entries).map((id) => book(id)),
    me: { lifeNine: [] },
    favorites: [],
    library: [],
    readingRecords: [],
    posts: [],
    posters: [],
    libraryEntries: entries,
    libraryShelves: [],
    libraryShelfBooks: [],
    encounters: [],
    settings: { ...LIBRARY_SETTINGS },
    ...more,
  };
}

const shelf = (id: string, more: Partial<LibraryShelf> = {}): LibraryShelf => ({
  id,
  name: "SF",
  note: "",
  position: "a0",
  showWanted: true,
  createdAt: BEFORE,
  deletedAt: null,
  ...more,
});

const onShelf = (
  shelfId: string,
  bookId: string,
  addedAt = BEFORE,
  position: string | null = null,
): ShelfBook => ({ shelfId, bookId, addedAt, position });

const post = (
  n: number,
  bookId: string | null,
  authorId = OTHER,
  more: Partial<Post> = {},
): Post => ({
  id: uuid(0xd00 + n),
  authorId,
  body: "",
  bookId,
  spoiler: false,
  parentId: null,
  createdAt: BEFORE,
  likes: 0,
  wants: 0,
  readingMode: null,
  ...more,
});

const record = (
  bookId: string,
  readerId = ME_ID,
  createdAt = BEFORE,
  n = 0,
): ReadingRecord => ({
  id: `record-${bookId}-${n}`,
  readerId,
  bookId,
  feelings: [],
  note: "",
  spoiler: false,
  isPublic: false,
  createdAt,
});

const session = (
  bookId: string | null,
  startedAt: string,
  endedAt: string | null,
  n = 0,
): ReadingSession => ({
  id: `session-${n}`,
  bookId,
  mode: "solo",
  startedAt,
  endedAt,
});

const poster = (
  bookIds: string[],
  status: Poster["status"] = "published",
  authorId = ME_ID,
): Poster => ({
  id: uuid(0x900 + bookIds.length),
  authorId,
  template: "lineup",
  theme: "kinari",
  font: "mincho",
  pages: [{ heading: "", text: "", bookIds }],
  spoiler: false,
  inTimeline: false,
  status,
  createdAt: BEFORE,
  updatedAt: BEFORE,
});

/** An encounter already in the town: a post's like unless told otherwise. */
const encounter = (
  n: number,
  bookId: string,
  kind: EncounterKind = "like",
  more: Partial<Encounter> = {},
): Encounter => ({
  id: uuid(0xe00 + n),
  bookId,
  kind,
  via: "post",
  postId: uuid(0xd00 + n),
  shopId: null,
  placementKey: null,
  otherReaderId: OTHER,
  memo: null,
  memoAt: null,
  undoneAt: null,
  createdAt: BEFORE,
  ...more,
});
const popEncounter = (n: number, bookId: string, kind: EncounterKind) =>
  encounter(n, bookId, kind, {
    via: "pop",
    postId: null,
    shopId: SHOP_ID,
    placementKey: "shelf-1/" + bookId,
  });

const onPost = (p: Post, kind: EncounterKind = "like"): EncounterInput => ({
  via: "post",
  kind,
  post: p,
});
const onPop = (
  bookId: string,
  kind: EncounterKind,
  shop: Pick<Shop, "id" | "ownerId"> = { id: SHOP_ID, ownerId: OTHER },
): EncounterInput => ({
  via: "pop",
  kind,
  shop,
  bookId,
  placementKey: "shelf-1/" + bookId,
});
const onPage = (bookId: string): EncounterInput => ({
  via: "book",
  kind: "want",
  bookId,
});

let made = 0;
/** A reaction pressed (on) or taken back, as the store will call it. */
function react<S extends LibraryState>(
  state: S,
  input: EncounterInput,
  on: boolean,
  at = AT,
  shopBooks: ReadonlySet<string> = NONE,
  account = true,
): S {
  made += 1;
  return applyReaction(state, input, on, at, shopBooks, {
    id: uuid(0xe000 + made),
    account,
  });
}

const P1 = post(1, "b");
const P2 = post(2, "b");

// ---------------------------------------------------------------- applySet: the shared cases

for (const c of LIBRARY_CASES.apply)
  check(`applySet: ${c.name}`, () => {
    const before = c.entry === null ? null : entryOf("b", c.entry);
    const after = applySet(
      "b",
      before,
      c.set,
      c.at,
      c.via,
      c.rules ?? { wantedClearsOnStatus: false },
      contextOf(c.context),
    );
    if (c.expect === "same") assert.equal(after, before);
    else if (c.expect === null) assert.equal(after, null);
    else {
      assert.deepEqual(after, entryOf("b", c.expect));
      assert.equal(validateEntry(after as LibraryEntry), null);
    }
  });

for (const c of LIBRARY_CASES.sequence)
  check(`applySet, step by step: ${c.name}`, () => {
    let e = c.entry === null ? null : entryOf("b", c.entry);
    for (const step of c.steps) {
      const after = applySet(
        "b",
        e,
        step.set,
        step.at,
        step.via,
        { wantedClearsOnStatus: false },
        contextOf(step.context),
      );
      if (step.expect === "same") assert.equal(after, e, step.does);
      else if (step.expect === null) assert.equal(after, null, step.does);
      else {
        assert.deepEqual(after, entryOf("b", step.expect), step.does);
        assert.equal(validateEntry(after as LibraryEntry), null, step.does);
      }
      e = after;
    }
  });

// ---------------------------------------------------------------- 問い2・3・5

check(
  "問い5 積読 on books owned, not owned and unset leaves each 所有 as it was",
  () => {
    const state = town({
      libraryEntries: rows(
        entryOf("yes", { owned: "yes" }),
        entryOf("no", { owned: "no" }),
        entryOf("unset", {}),
      ),
    });
    const next = applyOp(
      state,
      ["yes", "no", "unset"],
      { status: "tsundoku" },
      AT,
      "search",
      NONE,
    );
    assert.deepEqual(
      ["yes", "no", "unset"].map((id) => next.libraryEntries[id].owned),
      ["yes", "no", null],
    );
    for (const id of ["yes", "no", "unset"])
      assert.equal(next.libraryEntries[id].status, "tsundoku");
  },
);

check(
  "問い3 a status on wanted books, one or many, by sorting, startReading or a record, keeps 読みたい",
  () => {
    const wanted = ["w1", "w2", "w3"].map((id, i) =>
      entryOf(id, { wantedAt: new Date(Date.parse(BEFORE) + i).toISOString() }),
    );
    const state = town({ libraryEntries: rows(...wanted) });
    for (const via of ["search", "reading", "record"] as const)
      for (const status of READING_STATUSES)
        for (const ids of [["w2"], ["w1", "w2", "w3"]]) {
          const next = applyOp(state, ids, { status }, AT, via, NONE);
          for (const [i, id] of ids.entries()) {
            const e = next.libraryEntries[id];
            assert.equal(e.wantedAt, state.libraryEntries[id].wantedAt);
            assert.equal(e.status, status);
            // 5-6: books chosen together are a millisecond apart, in order.
            assert.equal(e.statusAt, plus(i));
          }
        }
  },
);

check(
  "問い3 with the setting on, only a change to 読書中 or 読了 takes 読みたい away, and undo gives it back",
  () => {
    const wanted = entryOf("w", { wantedAt: BEFORE });
    const state = town({
      libraryEntries: rows(wanted),
      settings: { ...LIBRARY_SETTINGS, wantedClearsOnStatus: true },
    });
    const tsundoku = applyOp(
      state,
      ["w"],
      { status: "tsundoku" },
      AT,
      "search",
      NONE,
    );
    assert.equal(tsundoku.libraryEntries.w.wantedAt, BEFORE);
    for (const status of ["reading", "finished"] as const) {
      const op: LibraryOp = {
        opId: uuid(0xa1),
        at: AT,
        label: status,
        books: ["w"],
        set: { status },
        before: opBefore(state, ["w"]),
        state: "pending",
      };
      const next = applyOp(state, op.books, op.set, op.at, "search", NONE);
      assert.equal(next.libraryEntries.w.wantedAt, null);
      // From 積読 too.
      const fromTsundoku = applyOp(
        tsundoku,
        ["w"],
        { status },
        plus(1),
        "search",
        NONE,
      );
      assert.equal(fromTsundoku.libraryEntries.w.wantedAt, null);
      // Undo writes the row back whole (10-6).
      const entry = op.before.w.entry as LibraryEntry;
      assert.deepEqual(
        { ...next.libraryEntries, w: entry },
        state.libraryEntries,
      );
      // The same op with the setting off keeps it.
      const off = applyOp(
        { ...state, settings: LIBRARY_SETTINGS },
        ["w"],
        { status },
        AT,
        "search",
        NONE,
      );
      assert.equal(off.libraryEntries.w.wantedAt, BEFORE);
    }
  },
);

check(
  "問い2 registering by scan, ISBN or hand writes no 所有, on new rows or rows already there",
  () => {
    const ids = ["new", "yes", "no", "unset", "out"];
    const state = town({
      libraryEntries: rows(
        entryOf("yes", { owned: "yes" }),
        entryOf("no", { owned: "no" }),
        entryOf("unset", {}),
        entryOf("out", { removedAt: BEFORE }),
      ),
    });
    for (const via of ["scan", "isbn", "manual"] as const) {
      const next = applyOp(state, ids, { removed: false }, AT, via, NONE);
      assert.deepEqual(
        ids.map((id) => next.libraryEntries[id].owned),
        [null, "yes", "no", null, null],
      );
      assert.equal(next.libraryEntries.new.source, via);
      assert.equal(next.libraryEntries.out.removedAt, null);
      assert.deepEqual(next.library, ids);
      // Even told to, registering writes 所有 only on the rows it makes.
      const told = applyOp(
        state,
        ids,
        { removed: false, owned: "no" },
        AT,
        via,
        NONE,
      );
      assert.deepEqual(told.libraryEntries.yes, state.libraryEntries.yes);
    }
  },
);

check(
  "問い2 この回は全部持っている本: only the rows that session made are yes, and only they carry its batch",
  () => {
    const ids = ["new", "yes", "no", "unset", "out"];
    const state = town({
      libraryEntries: rows(
        entryOf("yes", { owned: "yes" }),
        entryOf("no", { owned: "no" }),
        entryOf("unset", {}),
        entryOf("out", { removedAt: BEFORE }),
      ),
    });
    const next = applyOp(
      state,
      ids,
      { removed: false, owned: "yes", batchId: BATCH },
      AT,
      "scan",
      NONE,
    );
    assert.deepEqual(
      ids.map((id) => next.libraryEntries[id].owned),
      ["yes", "yes", "no", null, null],
    );
    assert.deepEqual(
      ids.map((id) => next.libraryEntries[id].batchId),
      [BATCH, null, null, null, null],
    );
    // The next session, without it, writes no 所有.
    const after = applyOp(
      next,
      ["new2"],
      { removed: false, batchId: BATCH_2 },
      plus(10),
      "scan",
      NONE,
    );
    assert.equal(after.libraryEntries.new2.owned, null);
    assert.equal(after.libraryEntries.new2.batchId, BATCH_2);
  },
);

check(
  "4-2 pressing the lit status button puts it back to 未設定, and nothing else",
  () => {
    assert.equal(pressStatus(null, "tsundoku"), "tsundoku");
    assert.equal(pressStatus("tsundoku", "reading"), "reading");
    for (const status of READING_STATUSES)
      assert.equal(pressStatus(status, status), null);
    const e = entryOf("b", {
      status: "finished",
      statusAt: BEFORE,
      wantedAt: BEFORE,
      owned: "yes",
    });
    const state = town({ libraryEntries: rows(e) });
    const next = applyOp(
      state,
      ["b"],
      { status: pressStatus(e.status, "finished") },
      AT,
      "search",
      NONE,
    );
    assert.deepEqual(next.libraryEntries.b, {
      ...e,
      status: null,
      statusAt: null,
    });
  },
);

check(
  "整理モードの読書中 starts no reading, and library ops leave readings, records, posts, posters, the nine, the shop and encounters as they were",
  () => {
    const base = town({
      libraryEntries: rows(entryOf("b", {})),
      libraryShelves: [shelf(SHELF_SF)],
      readingRecords: [record("b")],
      posts: [post(1, "b", ME_ID)],
      posters: [poster(["b"])],
      me: { lifeNine: ["b"] },
      encounters: [encounter(1, "b")],
    });
    const state = {
      ...base,
      readingSessions: [session("c", BEFORE, null)],
      ownShop: { shelves: [], sceneBookIds: ["b"] },
    };
    const sets: LibrarySet[] = [
      { status: "reading" },
      { status: "finished" },
      { want: true },
      { favorite: true },
      { addShelf: SHELF_SF },
      { owned: "no" },
      { removed: true },
      { removed: false },
    ];
    for (const set of sets) {
      const next = applyOp(state, ["b", "c"], set, AT, "search", NONE);
      assert.notEqual(next, state, JSON.stringify(set));
      assert.equal(next.readingSessions, state.readingSessions);
      assert.equal(next.readingRecords, state.readingRecords);
      assert.equal(next.posts, state.posts);
      assert.equal(next.posters, state.posters);
      assert.equal(next.me, state.me);
      assert.equal(next.ownShop, state.ownShop);
      assert.equal(next.encounters, state.encounters);
    }
  },
);

// ---------------------------------------------------------------- taking 読みたい and ☆ back (4-2's last row)

check(
  "4-2 taking 読みたい off a row only wanted (legacy too) takes it out; a like, ☆, the shop, a theme shelf, the reader's own record or post, or a memo keeps it",
  () => {
    for (const source of ["legacy", "want", "search"] as const) {
      const wantOnly = entryOf("b", { source, wantedAt: BEFORE });
      const base = town({ libraryEntries: rows(wantOnly) });
      const off = applyOp(base, ["b"], { want: false }, AT, "want", NONE);
      assert.equal(off.libraryEntries.b.removedAt, AT, source);
      assert.equal(off.libraryEntries.b.wantedAt, null);
    }
    const wantOnly = entryOf("b", { source: "legacy", wantedAt: BEFORE });
    const base = town({ libraryEntries: rows(wantOnly) });
    const keeps: [string, LibraryState, ReadonlySet<string>][] = [
      [
        "a like",
        {
          ...base,
          libraryEntries: rows({ ...wantOnly, likedAt: BEFORE }),
          encounters: [encounter(1, "b")],
        },
        NONE,
      ],
      ["☆", { ...base, favorites: ["b"] }, NONE],
      ["the reader's shop", base, new Set(["b"])],
      [
        "a theme shelf",
        {
          ...base,
          libraryShelves: [shelf(SHELF_SF)],
          libraryShelfBooks: [onShelf(SHELF_SF, "b")],
        },
        NONE,
      ],
      [
        "the reader's own record",
        { ...base, readingRecords: [record("b")] },
        NONE,
      ],
      [
        "the reader's own post",
        { ...base, posts: [post(1, "b", ME_ID)] },
        NONE,
      ],
      [
        "the reader's own poster draft",
        { ...base, posters: [poster(["b"], "draft")] },
        NONE,
      ],
      ["the reader's nine", { ...base, me: { lifeNine: ["b"] } }, NONE],
      ["registered on purpose", { ...base, library: ["b"] }, NONE],
      [
        "a memo taken back",
        {
          ...base,
          encounters: [
            encounter(1, "b", "want", {
              memo: "帯の言葉",
              memoAt: BEFORE,
              undoneAt: BEFORE,
            }),
          ],
        },
        NONE,
      ],
    ];
    for (const [why, state, shop] of keeps) {
      const off = applyOp(state, ["b"], { want: false }, AT, "want", shop);
      assert.equal(off.libraryEntries.b.removedAt, null, why);
      assert.equal(off.libraryEntries.b.wantedAt, null, why);
    }
    // A theme shelf put away keeps nothing.
    const gone = {
      ...base,
      libraryShelves: [shelf(SHELF_GONE, { deletedAt: BEFORE })],
      libraryShelfBooks: [onShelf(SHELF_GONE, "b")],
    };
    assert.equal(
      applyOp(gone, ["b"], { want: false }, AT, "want", NONE).libraryEntries.b
        .removedAt,
      AT,
    );
  },
);

check(
  "4-2 taking ☆ off a row only ☆'d takes it out; a like, the shop, a theme shelf or the reader's own record keeps it",
  () => {
    const favOnly = entryOf("f", { source: "favorite" });
    const base = town({ libraryEntries: rows(favOnly), favorites: ["f"] });
    const off = applyOp(base, ["f"], { favorite: false }, AT, "favorite", NONE);
    assert.equal(off.libraryEntries.f.removedAt, AT);
    assert.deepEqual(off.favorites, []);
    const keeps: [string, LibraryState, ReadonlySet<string>][] = [
      [
        "a like",
        {
          ...base,
          libraryEntries: rows({ ...favOnly, likedAt: BEFORE }),
          encounters: [encounter(1, "f")],
        },
        NONE,
      ],
      ["the reader's shop", base, new Set(["f"])],
      [
        "a theme shelf",
        {
          ...base,
          libraryShelves: [shelf(SHELF_SF)],
          libraryShelfBooks: [onShelf(SHELF_SF, "f")],
        },
        NONE,
      ],
      [
        "the reader's own record",
        { ...base, readingRecords: [record("f")] },
        NONE,
      ],
    ];
    for (const [why, state, shop] of keeps) {
      const kept = applyOp(
        state,
        ["f"],
        { favorite: false },
        AT,
        "favorite",
        shop,
      );
      assert.equal(kept.libraryEntries.f.removedAt, null, why);
      assert.deepEqual(kept.favorites, [], why);
    }
  },
);

// ---------------------------------------------------------------- likes (4-10)

check(
  "4-10 a post's like makes a row from like with likedAt, on いいねした本 and in the library",
  () => {
    const next = react(town(), onPost(P1), true);
    assert.deepEqual(
      next.libraryEntries.b,
      entryOf("b", { source: "like", addedAt: AT, likedAt: AT }),
    );
    assert.equal(next.encounters.length, 1);
    assert.deepEqual(
      shelvesOf(next.libraryEntries.b, entryContext(next, "b", NONE)),
      ["all", "liked"],
    );
  },
);

check(
  "4-10 a POP's いいね and 私も好き！ make a row from pop with likedAt",
  () => {
    for (const kind of ["like", "love"] as const) {
      const next = react(town(), onPop("b", kind), true);
      assert.deepEqual(
        next.libraryEntries.b,
        entryOf("b", { source: "pop", addedAt: AT, likedAt: AT }),
      );
      assert.equal(next.encounters[0].kind, kind);
    }
  },
);

check(
  "4-10 decision 1 pressing ten times makes one encounter, and the second press on changes nothing",
  () => {
    const first = react(town(), onPost(P1), true);
    for (let i = 1; i < 10; i++)
      assert.equal(react(first, onPost(P1), true, plus(i)), first);
    assert.equal(first.encounters.length, 1);
    const pop = react(town(), onPop("b", "love"), true);
    for (let i = 1; i < 10; i++)
      assert.equal(react(pop, onPop("b", "love"), true, plus(i)), pop);
  },
);

check(
  "4-10 a second press of a like, 私も好き！ or 読みたくなった that stands writes nothing, even on a row taken out since",
  () => {
    const scanned = applyOp(
      town(),
      ["b"],
      { removed: false },
      AT,
      "scan",
      NONE,
    );
    for (const input of [
      onPost(P1),
      onPop("b", "love"),
      onPost(P1, "want"),
      onPop("b", "want"),
    ]) {
      const why = JSON.stringify(input);
      const met = react(scanned, input, true, plus(1));
      const out = applyOp(
        met,
        ["b"],
        { removed: true },
        plus(2),
        "search",
        NONE,
      );
      assert.equal(out.libraryEntries.b.removedAt, plus(2), why);
      assert.equal(react(out, input, true, plus(3)), out, why);
    }
    // The book page's 読みたい goes by the row: with its 読みたい taken off
    // by sorting, pressing it again sets 読みたい, though its encounter stands.
    const page = react(town(), onPage("b"), true);
    const sorted = applyOp(page, ["b"], { want: false }, plus(1), "want", NONE);
    assert.equal(sorted.libraryEntries.b.wantedAt, null);
    assert.equal(sorted.encounters.length, 1);
    const again = react(sorted, onPage("b"), true, plus(2));
    assert.equal(again.libraryEntries.b.wantedAt, plus(2));
    assert.equal(again.encounters, sorted.encounters);
  },
);

check(
  "4-10 a like refused (a 見本's post or shop, the reader's own, a post without a book) changes nothing",
  () => {
    const state = town({ libraryEntries: rows(entryOf("b", {})) });
    const refused = [
      onPost(post(1, "b", OTHER, { id: "sample-post-1" })),
      onPost(post(2, "b", ME_ID)),
      onPost(post(3, null)),
      onPost(post(4, "b"), "love"),
      onPop("b", "like", { id: "sample-shop", ownerId: OTHER }),
      onPop("b", "love", { id: uuid(0xf2), ownerId: ME_ID }),
      { via: "book", kind: "like", bookId: "b" } as EncounterInput,
    ];
    for (const input of refused) {
      assert.equal(react(state, input, true), state, JSON.stringify(input));
      assert.equal(react(state, input, false), state, JSON.stringify(input));
    }
    // Without an account (the demo), a 見本's post is met: it is all there is.
    const demo = react(
      town(),
      onPost(post(1, "b", OTHER, { id: "sample-post-1" })),
      true,
      AT,
      NONE,
      false,
    );
    assert.equal(demo.libraryEntries.b.likedAt, AT);
  },
);

check(
  "4-10 a POP's 読みたくなった adds 読みたい and taking it back leaves it; a post's too",
  () => {
    assert.equal(popEncounterKind("read"), "want");
    const on = react(town(), onPop("b", popEncounterKind("read")), true);
    assert.deepEqual(
      on.libraryEntries.b,
      entryOf("b", { source: "pop", addedAt: AT, wantedAt: AT }),
    );
    const off = react(on, onPop("b", "want"), false, plus(1));
    assert.equal(off.libraryEntries, on.libraryEntries);
    assert.deepEqual(off.encounters, []);
    const fromPost = react(town(), onPost(P1, "want"), true);
    assert.deepEqual(
      fromPost.libraryEntries.b,
      entryOf("b", { source: "want", addedAt: AT, wantedAt: AT }),
    );
    assert.equal(
      react(fromPost, onPost(P1, "want"), false, plus(1)).libraryEntries.b
        .wantedAt,
      AT,
    );
    // The book page's 読みたい takes it away, though the page met nothing:
    // the row stays, held by the 読みたくなった that stands.
    const offOnPage = react(fromPost, onPage("b"), false, plus(1));
    assert.equal(offOnPage.libraryEntries.b.wantedAt, null);
    assert.equal(offOnPage.libraryEntries.b.removedAt, null);
    assert.equal(offOnPage.encounters, fromPost.encounters);
    assert.equal(entryContext(offOnPage, "b", NONE).wantMet, true);
    // The book page's 読みたい goes both ways.
    const page = react(town(), onPage("b"), true);
    assert.equal(page.libraryEntries.b.wantedAt, AT);
    const pageOff = react(page, onPage("b"), false, plus(1));
    assert.equal(pageOff.libraryEntries.b.wantedAt, null);
    assert.equal(pageOff.libraryEntries.b.removedAt, plus(1));
  },
);

check(
  "4-10 condition 2: taking a like back keeps likedAt while another like of the book stands",
  () => {
    let s = react(town(), onPost(P1), true);
    s = react(s, onPop("b", "love"), true, plus(1));
    s = react(s, onPost(P1), false, plus(2));
    assert.equal(s.libraryEntries.b.likedAt, AT);
    assert.equal(s.libraryEntries.b.removedAt, null);
    assert.ok(
      shelvesOf(s.libraryEntries.b, entryContext(s, "b", NONE)).includes(
        "liked",
      ),
    );
    s = react(s, onPop("b", "love"), false, plus(3));
    assert.equal(s.libraryEntries.b.likedAt, null);
    assert.equal(s.libraryEntries.b.removedAt, plus(3));
  },
);

check(
  "4-10 each condition alone keeps a row a like brought in; with none, it goes",
  () => {
    const liked = react(town(), onPost(P1), true);
    const SHOP_B = new Set(["b"]);
    const reasons: [
      string,
      (s: LibraryState) => LibraryState,
      ReadonlySet<string>,
    ][] = [
      [
        "a status",
        (s) =>
          applyOp(s, ["b"], { status: "tsundoku" }, plus(1), "search", NONE),
        NONE,
      ],
      [
        "読みたい",
        (s) => applyOp(s, ["b"], { want: true }, plus(1), "want", NONE),
        NONE,
      ],
      [
        "所有",
        (s) => applyOp(s, ["b"], { owned: "no" }, plus(1), "search", NONE),
        NONE,
      ],
      [
        "☆",
        (s) => applyOp(s, ["b"], { favorite: true }, plus(1), "favorite", NONE),
        NONE,
      ],
      [
        "a theme shelf",
        (s) =>
          applyOp(
            { ...s, libraryShelves: [shelf(SHELF_SF)] },
            ["b"],
            { addShelf: SHELF_SF },
            plus(1),
            "search",
            NONE,
          ),
        NONE,
      ],
      [
        "the reader's shop (N19)",
        (s) => applyOp(s, ["b"], { meet: true }, plus(1), "shop", NONE),
        SHOP_B,
      ],
      [
        "scanned after (registered, source still like)",
        (s) => applyOp(s, ["b"], { removed: false }, plus(1), "scan", NONE),
        NONE,
      ],
      [
        "the reader's own record",
        (s) => ({ ...s, readingRecords: [record("b")] }),
        NONE,
      ],
      [
        "the reader's own post (N20)",
        (s) => ({ ...s, posts: [post(9, "b", ME_ID)] }),
        NONE,
      ],
      [
        "the reader's own poster draft (N20)",
        (s) => ({ ...s, posters: [poster(["b"], "draft")] }),
        NONE,
      ],
      [
        "the reader's nine (N20)",
        (s) => ({ ...s, me: { lifeNine: ["b"] } }),
        NONE,
      ],
      [
        "a 読みたくなった standing, 読みたい since taken off on the page",
        (s) =>
          react(
            react(s, onPost(P2, "want"), true, plus(1)),
            onPage("b"),
            false,
            plus(2),
          ),
        NONE,
      ],
      [
        "a memo (decision 1)",
        (s) => ({
          ...s,
          encounters: writeMemo(
            s.encounters,
            s.encounters[0].id,
            "表紙が好き",
            plus(1),
          ),
        }),
        NONE,
      ],
    ];
    for (const [why, add, shop] of reasons) {
      const before = add(liked);
      const s = react(before, onPost(P1), false, plus(5), shop);
      assert.equal(s.libraryEntries.b.removedAt, null, why);
      assert.equal(s.libraryEntries.b.likedAt, null, why);
      assert.equal(s.libraryEntries.b.source, "like", why);
      assert.equal(
        inLibrary(s.libraryEntries.b, entryContext(s, "b", shop)),
        true,
        why,
      );
    }
    const gone = react(liked, onPost(P1), false, plus(5));
    assert.equal(gone.libraryEntries.b.removedAt, plus(5));
    assert.deepEqual(gone.encounters, []);
  },
);

check(
  "4-2 a row taken out comes back, with what it had, by scanning, 読みたい, ☆ or a like",
  () => {
    const out = town({
      libraryEntries: rows(
        entryOf("b", {
          status: "tsundoku",
          statusAt: BEFORE,
          removedAt: BEFORE,
        }),
      ),
      libraryShelves: [shelf(SHELF_SF)],
      libraryShelfBooks: [onShelf(SHELF_SF, "b")],
    });
    const back: [string, LibraryState][] = [
      ["scan", applyOp(out, ["b"], { removed: false }, AT, "scan", NONE)],
      ["読みたい", applyOp(out, ["b"], { want: true }, AT, "want", NONE)],
      ["読みたい on the page", react(out, onPage("b"), true)],
      ["☆", applyOp(out, ["b"], { favorite: true }, AT, "favorite", NONE)],
      ["a like", react(out, onPost(P1), true)],
      ["a POP's 私も好き！", react(out, onPop("b", "love"), true)],
    ];
    for (const [why, s] of back) {
      const e = s.libraryEntries.b;
      assert.equal(e.removedAt, null, why);
      assert.equal(e.status, "tsundoku", why);
      assert.equal(
        e.likeRestored,
        why === "a like" || why === "a POP's 私も好き！",
        why,
      );
      assert.deepEqual(
        filterLibrary(
          { ...s, books: [book("b")] },
          { shelf: SHELF_SF, showWanted: true },
          NONE,
        ),
        ["b"],
        why,
      );
    }
  },
);

check(
  "4-10 a row a like brought back goes again when the like is taken back at once, whatever it held; sorted after, it stays",
  () => {
    const out = town({
      libraryEntries: rows(
        entryOf("b", {
          status: "tsundoku",
          statusAt: BEFORE,
          removedAt: BEFORE,
        }),
      ),
      favorites: ["b"],
    });
    const liked = react(out, onPost(P1), true);
    assert.equal(liked.libraryEntries.b.likeRestored, true);
    const unliked = react(liked, onPost(P1), false, plus(1));
    assert.equal(unliked.libraryEntries.b.removedAt, plus(1));
    assert.equal(unliked.libraryEntries.b.status, "tsundoku");
    for (const set of [
      { status: "reading" },
      { want: true },
      { owned: "yes" },
    ] as LibrarySet[]) {
      const sorted = applyOp(liked, ["b"], set, plus(1), "search", NONE);
      assert.equal(sorted.libraryEntries.b.likeRestored, false);
      const kept = react(sorted, onPost(P1), false, plus(2));
      assert.equal(kept.libraryEntries.b.removedAt, null, JSON.stringify(set));
    }
  },
);

check(
  "4-10 with likes_in_library off, likes still set likedAt and only a row a like alone holds leaves ライブラリ（全部）",
  () => {
    let s = town({
      settings: { ...LIBRARY_SETTINGS, likesInLibrary: false },
      libraryEntries: rows(entryOf("scanned", {})),
    });
    s = react(s, onPost(post(1, "liked-only")), true);
    s = react(s, onPost(post(2, "scanned")), true, plus(1));
    s = { ...s, books: [book("scanned"), book("liked-only")] };
    const x = contextsOf(s, NONE);
    const only = s.libraryEntries["liked-only"];
    assert.equal(only.likedAt, AT);
    assert.equal(likeOnly(only, x("liked-only")), true);
    assert.equal(inLibrary(only, x("liked-only")), false);
    assert.equal(s.libraryEntries.scanned.likedAt, plus(1));
    assert.equal(inLibrary(s.libraryEntries.scanned, x("scanned")), true);
    assert.deepEqual(shelvesOf(only, x("liked-only")), ["liked"]);
    assert.deepEqual(filterLibrary(s, { showWanted: true }, NONE), ["scanned"]);
    assert.deepEqual(
      filterLibrary(s, { shelf: "liked", showWanted: true }, NONE),
      ["scanned", "liked-only"],
    );
    // With the setting on, the same row is in.
    const on = { ...s, settings: LIBRARY_SETTINGS };
    assert.equal(inLibrary(only, contextsOf(on, NONE)("liked-only")), true);
  },
);

check(
  "decision 3 with likes_in_library off, a memo brings a book only liked into the library",
  () => {
    let s = town({ settings: { ...LIBRARY_SETTINGS, likesInLibrary: false } });
    s = react(s, onPost(P1), true);
    assert.equal(
      inLibrary(s.libraryEntries.b, entryContext(s, "b", NONE)),
      false,
    );
    const memo = {
      ...s,
      encounters: writeMemo(
        s.encounters,
        s.encounters[0].id,
        "友だちが薦めていた",
        plus(1),
      ),
    };
    assert.equal(
      inLibrary(memo.libraryEntries.b, entryContext(memo, "b", NONE)),
      true,
    );
    assert.equal(
      likeOnly(memo.libraryEntries.b, entryContext(memo, "b", NONE)),
      false,
    );
  },
);

// ---------------------------------------------------------------- encounters and memos (the owner's decisions)

for (const c of LIBRARY_CASES.encounter)
  check(`encounterOf: ${c.name}`, () => {
    const owner = c.owner === "me" ? ME_ID : OTHER;
    let input: EncounterInput;
    if (c.via === "post") {
      const more: Partial<Post> = c.sample
        ? { id: "sample-post-1" }
        : c.reply
          ? { parentId: post(8, "b").id, bookId: "reply-book" }
          : {};
      input = {
        via: "post",
        kind: c.kind,
        post: post(1, c.noBook ? null : "b", owner, more),
      };
    } else if (c.via === "pop")
      input = {
        via: "pop",
        kind: c.kind,
        shop: { id: c.sample ? "sample-shop" : SHOP_ID, ownerId: owner },
        bookId: "b",
        placementKey: "あ".repeat(c.placementKeyLength ?? 12),
      };
    else input = { via: "book", kind: c.kind, bookId: "b" };
    const made = encounterOf(input, uuid(0xe1), AT, true);
    let accepted = made !== null && validateEncounter(made) === null;
    if (made && c.memoLength !== undefined) {
      const memo = "𠮷".repeat(c.memoLength);
      const written = writeMemo([made], made.id, memo, plus(1))[0];
      const fits =
        validateEncounter({ ...made, memo, memoAt: plus(1) }) === null;
      assert.equal(written.memo === memo, fits);
      accepted = accepted && fits;
    }
    assert.equal(accepted, c.accept);
    if (made && c.reply) assert.equal(made.bookId, "reply-book");
    if (made && c.via !== "book") assert.equal(made.otherReaderId, OTHER);
  });

check(
  "decision 1 taking back: without a memo the encounter and the row go; with one both stay; pressing again revives the same row",
  () => {
    const liked = react(town(), onPost(P1), true);
    const gone = react(liked, onPost(P1), false, plus(1));
    assert.deepEqual(gone.encounters, []);
    assert.equal(gone.libraryEntries.b.removedAt, plus(1));
    const id = liked.encounters[0].id;
    const memo = {
      ...liked,
      encounters: writeMemo(liked.encounters, id, "  表紙に惹かれた ", plus(1)),
    };
    assert.equal(memo.encounters[0].memo, "表紙に惹かれた");
    assert.equal(memo.encounters[0].memoAt, plus(1));
    const kept = react(memo, onPost(P1), false, plus(2));
    assert.equal(kept.encounters.length, 1);
    assert.equal(kept.encounters[0].undoneAt, plus(2));
    assert.equal(kept.encounters[0].memo, "表紙に惹かれた");
    assert.equal(kept.libraryEntries.b.likedAt, null);
    assert.equal(kept.libraryEntries.b.removedAt, null);
    assert.deepEqual(
      shelvesOf(kept.libraryEntries.b, entryContext(kept, "b", NONE)),
      ["all"],
    );
    const again = react(kept, onPost(P1), true, plus(3));
    assert.equal(again.encounters.length, 1);
    assert.equal(again.encounters[0].id, id);
    assert.equal(again.encounters[0].undoneAt, null);
    assert.equal(again.encounters[0].memo, "表紙に惹かれた");
    assert.equal(again.libraryEntries.b.likedAt, plus(3));
    // Erasing the memo of one taken back deletes it; of one standing, keeps it.
    assert.deepEqual(writeMemo(kept.encounters, id, "  ", plus(4)), []);
    const erased = writeMemo(again.encounters, id, null, plus(4));
    assert.equal(erased[0].memo, null);
    assert.equal(erased[0].memoAt, null);
  },
);

check(
  "decision 1 a memo kept on an encounter taken back keeps the book when another like of it is taken back (condition 5)",
  () => {
    let s = react(town(), onPost(P1), true);
    s = {
      ...s,
      encounters: writeMemo(s.encounters, s.encounters[0].id, "メモ", plus(1)),
    };
    s = react(s, onPost(P1), false, plus(2));
    s = react(s, onPost(P2), true, plus(3));
    s = react(s, onPost(P2), false, plus(4));
    assert.equal(s.libraryEntries.b.removedAt, null);
    assert.equal(s.libraryEntries.b.likedAt, null);
    assert.equal(s.encounters.length, 1);
  },
);

check(
  "the いいねした本 shelf holds the books a like or 私も好き！ stands for, newest first: not a 読みたい, not one taken back",
  () => {
    const s = town({
      libraryEntries: rows(
        entryOf("like", {
          source: "like",
          likedAt: "2026-09-02T00:00:00.000Z",
        }),
        entryOf("love", { source: "pop", likedAt: "2026-09-03T00:00:00.000Z" }),
        entryOf("want", { source: "want", wantedAt: BEFORE }),
        entryOf("undone", { source: "like" }),
        entryOf("removed", {
          source: "like",
          likedAt: BEFORE,
          removedAt: BEFORE,
        }),
      ),
      encounters: [
        encounter(1, "like"),
        popEncounter(2, "love", "love"),
        encounter(3, "want", "want"),
        encounter(4, "undone", "like", {
          memo: "m",
          memoAt: BEFORE,
          undoneAt: BEFORE,
        }),
        encounter(5, "removed"),
      ],
    });
    assert.deepEqual(
      filterLibrary(s, { shelf: "liked", showWanted: true }, NONE),
      ["love", "like"],
    );
    assert.equal(countsOf(s, NONE).shelves.liked, 2);
  },
);

check(
  "decision 4f いいねした本 goes by the likes that stand, not by likedAt",
  () => {
    const s = town({
      libraryEntries: rows(
        // likedAt with no like standing (an old app's like, 5-4).
        entryOf("stale", { likedAt: BEFORE }),
        // A like standing on a row whose likedAt is not written.
        entryOf("standing", {}),
      ),
      encounters: [encounter(1, "standing")],
    });
    const x = contextsOf(s, NONE);
    assert.deepEqual(shelvesOf(s.libraryEntries.stale, x("stale")), ["all"]);
    assert.deepEqual(shelvesOf(s.libraryEntries.standing, x("standing")), [
      "all",
      "liked",
    ]);
    assert.equal(countsOf(s, NONE).shelves.liked, 1);
    assert.deepEqual(
      filterLibrary(s, { shelf: "liked", showWanted: true }, NONE),
      ["standing"],
    );
  },
);

check(
  "decision 2 an encounter whose post or shop is gone stands alone; one POP met through two places is one",
  () => {
    const gone1 = encounter(1, "b", "like", { postId: null });
    const gone2 = encounter(2, "b", "like", { postId: null });
    assert.notEqual(encounterKey(gone1), encounterKey(gone2));
    const fresh = encounterOf(
      onPost(post(3, "b")),
      uuid(0xe9),
      AT,
      true,
    ) as Encounter;
    const met = meetEncounter([gone1, gone2], fresh);
    assert.equal(met.met, true);
    assert.equal(met.encounters.length, 3);
    const page = encounterOf(
      onPop("b", "love"),
      uuid(0xea),
      AT,
      true,
    ) as Encounter;
    const walk = encounterOf(
      {
        ...(onPop("b", "love") as Extract<EncounterInput, { via: "pop" }>),
        placementKey: "walk/corner-2",
      },
      uuid(0xeb),
      AT,
      true,
    ) as Encounter;
    assert.equal(encounterKey(page), encounterKey(walk));
    assert.equal(meetEncounter([page], walk).met, false);
    // A like and a 読みたい of one post are two.
    const want = encounterOf(
      onPost(post(3, "b"), "want"),
      uuid(0xec),
      AT,
      true,
    ) as Encounter;
    assert.notEqual(encounterKey(fresh), encounterKey(want));
  },
);

check("decision 4 the settings' defaults are the database's", () => {
  assert.deepEqual(LIBRARY_SETTINGS, {
    libraryHidden: [],
    likesInLibrary: true,
    wantedClearsOnStatus: false,
    memoHint: true,
  });
});

check(
  "4-3 how a reaction brings a book in, and what it does to the row",
  () => {
    assert.equal(encounterSource("like", "post"), "like");
    assert.equal(encounterSource("want", "post"), "want");
    assert.equal(encounterSource("like", "pop"), "pop");
    assert.equal(encounterSource("love", "pop"), "pop");
    assert.equal(encounterSource("want", "pop"), "pop");
    assert.equal(encounterSource("want", "book"), "want");
    assert.deepEqual(reactionSet("like", "post", true), { liked: true });
    assert.deepEqual(reactionSet("love", "pop", false), { liked: false });
    assert.deepEqual(reactionSet("want", "post", true), { want: true });
    assert.equal(reactionSet("want", "post", false), null);
    assert.equal(reactionSet("want", "pop", false), null);
    assert.deepEqual(reactionSet("want", "book", false), { want: false });
    assert.equal(popEncounterKind("like"), "like");
    assert.equal(popEncounterKind("love"), "love");
  },
);

// ---------------------------------------------------------------- N19, N20

check(
  "N19 a book placed in the reader's shop comes in from shop, sorted, and stays when taken off the shop",
  () => {
    const placed = applyOp(town(), ["b"], { meet: true }, AT, "shop", NONE);
    assert.deepEqual(
      placed.libraryEntries.b,
      entryOf("b", { source: "shop", addedAt: AT, everUsed: true }),
    );
    const inShop = entryContext(placed, "b", new Set(["b"]));
    assert.equal(isUnsorted(placed.libraryEntries.b, inShop), false);
    const takenOff = entryContext(placed, "b", NONE);
    assert.equal(inLibrary(placed.libraryEntries.b, takenOff), true);
    assert.equal(isUnsorted(placed.libraryEntries.b, takenOff), true);
    // A like on it, taken back once it is off the shop: it stays (it came from the shop).
    const liked = react(placed, onPost(P1), true);
    assert.equal(
      react(liked, onPost(P1), false, plus(1)).libraryEntries.b.removedAt,
      null,
    );
  },
);

check(
  "N19 N20 a book liked, then placed in the reader's shop or used in their own post, poster or nine, stays when that is gone and the like is taken back",
  () => {
    const liked = react(town(), onPost(P1), true);
    const uses: [
      EntrySource,
      (s: LibraryState) => LibraryState,
      ReadonlySet<string>,
    ][] = [
      ["shop", (s) => s, new Set(["b"])],
      ["post", (s) => ({ ...s, posts: [post(9, "b", ME_ID)] }), NONE],
      ["poster", (s) => ({ ...s, posters: [poster(["b"], "draft")] }), NONE],
      ["nine", (s) => ({ ...s, me: { lifeNine: ["b"] } }), NONE],
    ];
    for (const [via, use, shop] of uses) {
      const used = applyOp(
        use(liked),
        ["b"],
        { meet: true },
        plus(1),
        via,
        shop,
      );
      assert.deepEqual(
        used.libraryEntries.b,
        { ...liked.libraryEntries.b, everUsed: true },
        via,
      );
      // Off the shop, the post deleted: the town is as it was when liked,
      // but for the row.
      const gone = { ...liked, libraryEntries: used.libraryEntries };
      // No longer a book only liked, so shown with likes_in_library off.
      const off = {
        ...gone,
        settings: { ...LIBRARY_SETTINGS, likesInLibrary: false },
      };
      assert.equal(
        inLibrary(gone.libraryEntries.b, entryContext(off, "b", NONE)),
        true,
        via,
      );
      const unliked = react(gone, onPost(P1), false, plus(2));
      assert.deepEqual(
        unliked.libraryEntries.b,
        { ...used.libraryEntries.b, likedAt: null },
        via,
      );
      assert.equal(
        inLibrary(unliked.libraryEntries.b, entryContext(unliked, "b", NONE)),
        true,
        via,
      );
    }
    // Never used, it goes with the like, as before.
    assert.equal(
      react(liked, onPost(P1), false, plus(2)).libraryEntries.b.removedAt,
      plus(2),
    );
  },
);

check(
  "N19 a book placed in the reader's shop and wanted stays when it is off the shop and 読みたい is taken back, whether a like is taken back before or after",
  () => {
    const inShop = new Set(["b"]);
    // Placed first: 読みたい on its page, taken back once off the shop.
    const placed = applyOp(town(), ["b"], { meet: true }, AT, "shop", inShop);
    const wanted = react(placed, onPage("b"), true, plus(1), inShop);
    const unwanted = react(wanted, onPage("b"), false, plus(2));
    assert.deepEqual(unwanted.libraryEntries.b, placed.libraryEntries.b);
    // Liked first, then placed and wanted; off the shop, the like and
    // 読みたい taken back in either order end the same, in the library.
    const used = react(
      applyOp(
        react(town(), onPost(P1), true),
        ["b"],
        { meet: true },
        plus(1),
        "shop",
        inShop,
      ),
      onPage("b"),
      true,
      plus(2),
      inShop,
    );
    const likeFirst = react(
      react(used, onPost(P1), false, plus(3)),
      onPage("b"),
      false,
      plus(4),
    );
    const wantFirst = react(
      react(used, onPage("b"), false, plus(3)),
      onPost(P1),
      false,
      plus(4),
    );
    assert.deepEqual(likeFirst.libraryEntries.b, wantFirst.libraryEntries.b);
    assert.deepEqual(
      likeFirst.libraryEntries.b,
      entryOf("b", { source: "like", addedAt: AT, everUsed: true }),
    );
    assert.equal(
      inLibrary(likeFirst.libraryEntries.b, entryContext(likeFirst, "b", NONE)),
      true,
    );
  },
);

check(
  "N20 the reader's own post, poster (a draft too), nine and record count as uses; another reader's do not",
  () => {
    const s = town({
      posts: [post(1, "own-post", ME_ID), post(2, "their-post")],
      posters: [
        poster(["own-poster"], "draft"),
        poster(["their-poster", "x"], "published", OTHER),
      ],
      me: { lifeNine: ["nine"] },
      readingRecords: [record("own-record"), record("their-record", OTHER)],
    });
    const x = contextsOf(s, NONE);
    for (const id of ["own-post", "own-poster", "nine", "own-record"])
      assert.equal(x(id).usedElsewhere, true, id);
    for (const id of ["their-post", "their-poster", "their-record"])
      assert.equal(x(id).usedElsewhere, false, id);
  },
);

// ---------------------------------------------------------------- sorting never takes a book out

check(
  "4-1 sorting (a status, 読みたい, ☆, a theme shelf, the shop) never takes a book out of ライブラリ（全部）",
  () => {
    const SHOP = new Set([
      "like-only",
      "want-only",
      "fav-only",
      "restored",
      "blank",
      "owned",
    ]);
    for (const likesInLibrary of [true, false]) {
      const state = town({
        settings: { ...LIBRARY_SETTINGS, likesInLibrary },
        libraryEntries: rows(
          entryOf("like-only", { source: "like", likedAt: BEFORE }),
          entryOf("want-only", { source: "want", wantedAt: BEFORE }),
          entryOf("fav-only", { source: "favorite" }),
          entryOf("restored", {
            likedAt: BEFORE,
            likeRestored: true,
            status: "finished",
            statusAt: BEFORE,
          }),
          entryOf("blank", { source: "legacy" }),
          entryOf("owned", { owned: "no" }),
        ),
        favorites: ["fav-only"],
        encounters: [encounter(1, "like-only"), encounter(2, "restored")],
        libraryShelves: [shelf(SHELF_SF)],
      });
      const ids = Object.keys(state.libraryEntries);
      const sorts: [LibrarySet, EntrySource, ReadonlySet<string>][] = [
        ...READING_STATUSES.map(
          (status): [LibrarySet, EntrySource, ReadonlySet<string>] => [
            { status },
            "search",
            NONE,
          ],
        ),
        [{ want: true }, "want", NONE],
        [{ favorite: true }, "favorite", NONE],
        [{ addShelf: SHELF_SF }, "search", NONE],
        [{ meet: true }, "shop", SHOP],
      ];
      const before = contextsOf(state, NONE);
      for (const [set, via, shop] of sorts) {
        const next = applyOp(state, ids, set, AT, via, NONE);
        const after = contextsOf(next, shop);
        for (const id of ids) {
          const why = `${JSON.stringify(set)} on ${id}, likes_in_library ${likesInLibrary}`;
          if (inLibrary(state.libraryEntries[id], before(id)))
            assert.equal(
              inLibrary(next.libraryEntries[id], after(id)),
              true,
              why,
            );
          // Sorted, a book is no longer held by a like alone.
          assert.equal(
            inLibrary(next.libraryEntries[id], after(id)),
            true,
            why,
          );
        }
      }
    }
  },
);

// ---------------------------------------------------------------- まだ振り分けていない (4-1's L)

check(
  "4-1 まだ振り分けていない: 所有 or a like alone sorts nothing; a status, 読みたい, ☆, a live theme shelf or any place in the shop does",
  () => {
    const item = (bookId: string) => ({
      id: "item-" + bookId,
      bookId,
      display: "spine" as const,
      pop: "",
    });
    const myShop: Shop = {
      id: "mine",
      ownerId: ME_ID,
      name: "",
      description: "",
      theme: "sage",
      tagline: "",
      followers: 0,
      shelves: [
        {
          id: "s1",
          name: "",
          capacity: 10,
          items: [item("page-shelf")],
          isPublic: true,
        },
        {
          id: "s2",
          name: "",
          capacity: 10,
          items: [item("private-shelf")],
          isPublic: false,
        },
      ],
      sceneBookIds: ["scene"],
      demo: false,
    };
    const shop = shopBookIds(myShop, {
      demoSceneBookIds: ["demo-scene"],
      draftBooks: ["draft-shelf", "unplaced"],
    });
    const state = town({
      libraryEntries: rows(
        entryOf("owned-yes", { owned: "yes" }),
        entryOf("owned-no", { owned: "no" }),
        entryOf("like-only", { source: "like", likedAt: BEFORE }),
        entryOf("on-shelf-put-away", {}),
        entryOf("blank", {}),
        entryOf("status", { status: "tsundoku", statusAt: BEFORE }),
        entryOf("wanted", { wantedAt: BEFORE }),
        entryOf("fav", {}),
        entryOf("theme", {}),
        entryOf("page-shelf", {}),
        entryOf("private-shelf", {}),
        entryOf("scene", {}),
        entryOf("demo-scene", {}),
        entryOf("draft-shelf", {}),
        entryOf("unplaced", {}),
        entryOf("removed", { removedAt: BEFORE }),
      ),
      favorites: ["fav"],
      encounters: [encounter(1, "like-only")],
      libraryShelves: [
        shelf(SHELF_SF),
        shelf(SHELF_GONE, { deletedAt: BEFORE }),
      ],
      libraryShelfBooks: [
        onShelf(SHELF_SF, "theme"),
        onShelf(SHELF_GONE, "on-shelf-put-away"),
      ],
    });
    const x = contextsOf(state, shop);
    const unsorted = Object.values(state.libraryEntries)
      .filter((e) => isUnsorted(e, x(e.bookId)))
      .map((e) => e.bookId)
      .sort();
    const expected = [
      "blank",
      "like-only",
      "on-shelf-put-away",
      "owned-no",
      "owned-yes",
    ];
    assert.deepEqual(unsorted, expected);
    assert.deepEqual(
      filterLibrary(state, { unsorted: true, showWanted: true }, shop).sort(),
      expected,
    );
    assert.deepEqual([...shopBookIds(null)], []);
    // With likes_in_library off, a book only liked is not in the library, so not unsorted either.
    const off = {
      ...state,
      settings: { ...LIBRARY_SETTINGS, likesInLibrary: false },
    };
    assert.equal(
      isUnsorted(
        off.libraryEntries["like-only"],
        contextsOf(off, shop)("like-only"),
      ),
      false,
    );
  },
);

// ---------------------------------------------------------------- DEFAULT_SHELVES swapped

check(
  "4-1 with DEFAULT_SHELVES swapped (one dropped, one added, one renamed), shelvesOf, countsOf and filterLibrary follow",
  () => {
    const swapped: DefaultShelf[] = [
      ...DEFAULT_SHELVES.filter((s) => s.key !== "reading").map((s) =>
        s.key === "want" ? { ...s, label: "いつか読む" } : s,
      ),
      {
        key: "owned",
        label: "持っている本",
        has: (e, x) => inLibrary(e, x) && e.owned === "yes",
        order: "added",
      },
    ];
    const state = town({
      libraryEntries: rows(
        entryOf("r", { status: "reading", statusAt: BEFORE }),
        entryOf("o", { owned: "yes", addedAt: "2026-02-01T00:00:00.000Z" }),
        entryOf("w", { wantedAt: BEFORE }),
      ),
    });
    const x = contextsOf(state, NONE);
    assert.deepEqual(shelvesOf(state.libraryEntries.r, x("r"), swapped), [
      "all",
    ]);
    assert.deepEqual(shelvesOf(state.libraryEntries.o, x("o"), swapped), [
      "all",
      "owned",
    ]);
    assert.deepEqual(shelvesOf(state.libraryEntries.r, x("r")), [
      "all",
      "reading",
    ]);
    assert.deepEqual(countsOf(state, NONE, swapped).shelves, {
      all: 3,
      want: 1,
      owned: 1,
    });
    assert.deepEqual(countsOf(state, NONE).shelves, {
      all: 3,
      reading: 1,
      want: 1,
    });
    assert.deepEqual(
      filterLibrary(state, { shelf: "owned", showWanted: true }, NONE, swapped),
      ["o"],
    );
    assert.deepEqual(
      filterLibrary(
        state,
        { shelf: "reading", showWanted: true },
        NONE,
        swapped,
      ),
      [],
    );
    assert.deepEqual(
      filterLibrary(state, { shelf: "reading", showWanted: true }, NONE),
      ["r"],
    );
    assert.equal(swapped.find((s) => s.key === "want")?.label, "いつか読む");
    // Keys nobody knows are passed over; ライブラリ is never hidden.
    assert.deepEqual(
      shownShelves(swapped, ["no_such", "want", "all"]).map((s) => s.key),
      ["all", "finished", "tsundoku", "liked", "favorite", "owned"],
    );
    assert.deepEqual(
      libraryHiddenOf([
        "want",
        "no_such",
        "want",
        "Bad-Key",
        "",
        3,
        "x".repeat(33),
      ]),
      ["want", "no_such"],
    );
    assert.deepEqual(libraryHiddenOf("want"), []);
    assert.equal(
      libraryHiddenOf(
        Array.from(
          { length: 25 },
          (_, i) => "k_" + String.fromCharCode(97 + i),
        ),
      ).length,
      20,
    );
  },
);

// ---------------------------------------------------------------- filters (4-5)

const at = (day: string) => `2026-${day}T00:00:00.000Z`;
const FILTER_TOWN = town({
  books: [
    "sf-fin",
    "sf-tsun",
    "fin",
    "liked-unread",
    "liked-recorded",
    "liked-fin",
    "pop-tsun",
    "pop-wanted",
    "scan-tsun",
    "batch-unsorted",
    "batch-unsorted-2",
    "other-batch",
  ].map((id) => book(id, id === "fin" ? { author: "灯野栞" } : {})),
  libraryEntries: rows(
    entryOf("sf-fin", {
      status: "finished",
      statusAt: at("09-10"),
      addedAt: at("08-01"),
      owned: "yes",
    }),
    entryOf("sf-tsun", {
      status: "tsundoku",
      statusAt: at("09-11"),
      addedAt: at("08-02"),
    }),
    entryOf("fin", {
      status: "finished",
      statusAt: at("09-12"),
      addedAt: at("08-03"),
      owned: "no",
    }),
    entryOf("liked-unread", {
      source: "like",
      likedAt: at("09-13"),
      addedAt: at("09-13"),
    }),
    entryOf("liked-recorded", {
      source: "like",
      likedAt: at("09-14"),
      addedAt: at("09-14"),
    }),
    entryOf("liked-fin", {
      status: "finished",
      statusAt: at("09-15"),
      likedAt: at("09-15"),
      addedAt: at("08-04"),
    }),
    entryOf("pop-tsun", {
      source: "pop",
      status: "tsundoku",
      statusAt: at("09-16"),
      addedAt: at("08-05"),
    }),
    entryOf("pop-wanted", {
      source: "pop",
      wantedAt: at("09-17"),
      addedAt: at("08-06"),
    }),
    entryOf("scan-tsun", {
      status: "tsundoku",
      statusAt: at("09-18"),
      batchId: BATCH,
      addedAt: at("08-07"),
    }),
    entryOf("batch-unsorted", { batchId: BATCH, addedAt: at("08-08") }),
    entryOf("batch-unsorted-2", { batchId: BATCH, addedAt: at("08-09") }),
    entryOf("other-batch", { batchId: BATCH_2, addedAt: at("08-10") }),
    // A row for a book the town does not know is never listed.
    entryOf("unknown", { addedAt: at("08-11") }),
  ),
  encounters: [
    encounter(1, "liked-unread"),
    encounter(2, "liked-recorded"),
    encounter(3, "liked-fin"),
  ],
  readingRecords: [record("liked-recorded")],
  libraryShelves: [shelf(SHELF_SF)],
  libraryShelfBooks: [
    onShelf(SHELF_SF, "sf-fin"),
    onShelf(SHELF_SF, "sf-tsun"),
  ],
});

const COMBOS: [LibraryFilter, string[]][] = [
  [{ shelf: "finished", with: [SHELF_SF], showWanted: true }, ["sf-fin"]],
  [{ shelf: "liked", read: false, showWanted: true }, ["liked-unread"]],
  [{ met: ["pop"], status: ["tsundoku"], showWanted: true }, ["pop-tsun"]],
  [
    { unsorted: true, batchId: BATCH, showWanted: true },
    ["batch-unsorted-2", "batch-unsorted"],
  ],
];

check(
  "4-5 filters laid together narrow by all of them (and), each alone narrowing less",
  () => {
    for (const [f, expected] of COMBOS) {
      const shown = filterLibrary(FILTER_TOWN, f, NONE);
      assert.deepEqual(shown, expected, JSON.stringify(f));
      const keys = Object.keys(f).filter(
        (key) => key !== "showWanted",
      ) as (keyof LibraryFilter)[];
      const alone = keys.map(
        (key) =>
          new Set(
            filterLibrary(
              FILTER_TOWN,
              { showWanted: true, [key]: f[key] },
              NONE,
            ),
          ),
      );
      for (const set of alone)
        assert.ok(set.size > expected.length, JSON.stringify(f));
      const both = [...alone[0]].filter((id) =>
        alone.every((set) => set.has(id)),
      );
      assert.deepEqual(both.sort(), [...expected].sort(), JSON.stringify(f));
    }
    assert.deepEqual(
      filterLibrary(FILTER_TOWN, { shelf: "finished", showWanted: true }, NONE),
      ["liked-fin", "fin", "sf-fin"],
    );
    assert.deepEqual(
      filterLibrary(FILTER_TOWN, { shelf: "liked", showWanted: true }, NONE),
      ["liked-fin", "liked-recorded", "liked-unread"],
    );
    assert.ok(
      !filterLibrary(FILTER_TOWN, { showWanted: true }, NONE).includes(
        "unknown",
      ),
    );
  },
);

check(
  "5-6 読了・積読・読書中 go by when the status was set, 読みたい本 by when it was wanted, お気に入り in ☆'s order: not by when the books came in",
  () => {
    for (const status of READING_STATUSES) {
      const s = town({
        libraryEntries: rows(
          entryOf("x", { addedAt: at("02-01"), status, statusAt: at("03-01") }),
          entryOf("y", { addedAt: at("01-01"), status, statusAt: at("04-01") }),
          entryOf("z", { addedAt: at("05-01") }),
        ),
      });
      assert.deepEqual(filterLibrary(s, { showWanted: true }, NONE), [
        "z",
        "x",
        "y",
      ]);
      assert.deepEqual(
        filterLibrary(s, { shelf: status, showWanted: true }, NONE),
        ["y", "x"],
        status,
      );
    }
    const s = town({
      libraryEntries: rows(
        entryOf("x", { addedAt: at("02-01"), wantedAt: at("03-01") }),
        entryOf("y", { addedAt: at("01-01"), wantedAt: at("04-01") }),
        entryOf("z", { addedAt: at("05-01") }),
      ),
      // Oldest first, unlike both when they came in and their ids.
      favorites: ["y", "z", "x"],
    });
    assert.deepEqual(
      filterLibrary(s, { shelf: "want", showWanted: true }, NONE),
      ["y", "x"],
    );
    assert.deepEqual(
      filterLibrary(s, { shelf: "favorite", showWanted: true }, NONE),
      ["y", "z", "x"],
    );
  },
);

check(
  "a row taken out leaves every default shelf, theme shelf and count, its status, 読みたい, ☆ and 所有 kept with it",
  () => {
    const s = town({
      libraryEntries: rows(
        ...READING_STATUSES.map((status) =>
          entryOf("out-" + status, {
            status,
            statusAt: BEFORE,
            wantedAt: BEFORE,
            owned: "yes",
            removedAt: BEFORE,
          }),
        ),
        entryOf("out-no", { owned: "no", removedAt: BEFORE }),
        entryOf("out-liked", {
          source: "like",
          likedAt: BEFORE,
          removedAt: BEFORE,
        }),
      ),
      favorites: READING_STATUSES.map((status) => "out-" + status),
      encounters: [encounter(1, "out-liked")],
      libraryShelves: [shelf(SHELF_SF)],
      libraryShelfBooks: [onShelf(SHELF_SF, "out-finished")],
    });
    const x = contextsOf(s, NONE);
    for (const e of Object.values(s.libraryEntries))
      assert.deepEqual(shelvesOf(e, x(e.bookId)), [], e.bookId);
    assert.deepEqual(countsOf(s, NONE), {
      works: 0,
      editions: 0,
      owned: 0,
      notOwned: 0,
      unsorted: 0,
      shelves: {},
      themes: {},
    });
    for (const key of [...DEFAULT_SHELVES.map((shelf) => shelf.key), SHELF_SF])
      assert.deepEqual(
        filterLibrary(s, { shelf: key, showWanted: true }, NONE),
        [],
        key,
      );
  },
);

check(
  "4-5 the other filters: 所有, author, 未設定, read, sorted, and books only wanted hidden",
  () => {
    const f = (more: Omit<LibraryFilter, "showWanted">, showWanted = true) =>
      filterLibrary(FILTER_TOWN, { showWanted, ...more }, NONE);
    assert.deepEqual(f({ owned: "yes" }), ["sf-fin"]);
    assert.deepEqual(f({ owned: "no" }), ["fin"]);
    assert.equal(f({ owned: "unset" }).length, 10);
    assert.deepEqual(f({ author: " 灯野栞 " }), ["fin"]);
    assert.deepEqual(f({ status: ["none"], met: ["pop"] }), ["pop-wanted"]);
    assert.deepEqual(
      f({ status: ["finished", "tsundoku"], met: ["pop", "like"] }),
      ["pop-tsun"],
    );
    assert.deepEqual(f({ read: true }), [
      "liked-recorded",
      "liked-fin",
      "fin",
      "sf-fin",
    ]);
    assert.deepEqual(f({ unsorted: false, met: ["pop"] }), [
      "pop-wanted",
      "pop-tsun",
    ]);
    assert.ok(!f({}, false).includes("pop-wanted"));
    assert.ok(f({}, true).includes("pop-wanted"));
    // A shelf nobody knows shows nothing.
    assert.deepEqual(f({ shelf: "no_such" }), []);
  },
);

check(
  "4-5 since and until, in Japan's months, by when a book came in, got its status or was liked",
  () => {
    const s = town({
      libraryEntries: rows(
        // 2026-03-31 23:59:59.999 in Japan: March.
        entryOf("d1", {
          addedAt: "2026-03-31T14:59:59.999Z",
          status: "tsundoku",
          statusAt: "2026-05-10T00:00:00.000Z",
        }),
        // 2026-04-01 00:00 in Japan: April.
        entryOf("d2", {
          addedAt: "2026-03-31T15:00:00.000Z",
          likedAt: "2026-06-01T00:00:00.000Z",
        }),
        entryOf("d3", {
          addedAt: "2026-04-30T15:00:00.000Z",
          status: "finished",
          statusAt: "2026-04-15T00:00:00.000Z",
          likedAt: "2026-04-02T00:00:00.000Z",
        }),
      ),
      encounters: [encounter(1, "d2"), encounter(2, "d3")],
    });
    const f = (more: Omit<LibraryFilter, "showWanted">) =>
      filterLibrary(s, { showWanted: true, ...more }, NONE);
    assert.deepEqual(f({ since: "2026-04", until: "2026-04" }), ["d2"]);
    assert.deepEqual(
      f({ since: "2026-04", until: "2026-04", dateOf: "added" }),
      ["d2"],
    );
    assert.deepEqual(
      f({ since: "2026-04", until: "2026-04", dateOf: "status" }),
      ["d3"],
    );
    assert.deepEqual(
      f({ since: "2026-04", until: "2026-04", dateOf: "liked" }),
      ["d3"],
    );
    assert.deepEqual(f({ since: "2026-05" }), ["d3"]);
    assert.deepEqual(f({ since: "2026-05", dateOf: "status" }), ["d1"]);
    assert.deepEqual(f({ since: "2026-05", dateOf: "liked" }), ["d2"]);
    assert.deepEqual(f({ until: "2026-03" }), ["d1"]);
    // A book with no such date is left out; the rest keep the library's order.
    assert.deepEqual(f({ until: "2026-12", dateOf: "liked" }), ["d3", "d2"]);
  },
);

check(
  "4-5 a filter goes to the address and back; what an address could not be is left out",
  () => {
    const filters: LibraryFilter[] = [
      ...COMBOS.map(([f]) => f),
      {
        shelf: SHELF_SF,
        with: [SHELF_SF, SHELF_GONE],
        status: ["none", "reading"],
        read: true,
        unsorted: false,
        met: ["scan", "post"],
        since: "2026-04",
        until: "2026-06",
        dateOf: "liked",
        owned: "unset",
        author: "灯野 栞",
        batchId: BATCH,
        showWanted: false,
      },
      { dateOf: "status", read: false, showWanted: true },
      { showWanted: true },
    ];
    for (const f of filters) {
      const params = filterParams(f);
      const back = filterFromParams((key) => params[key] ?? null, f.showWanted);
      assert.deepEqual(back, f);
      assert.deepEqual(filterParams(back), params);
      assert.deepEqual(
        filterLibrary(FILTER_TOWN, back, NONE),
        filterLibrary(FILTER_TOWN, f, NONE),
      );
    }
    assert.deepEqual(
      filterParams({ showWanted: true, dateOf: "added" }),
      filterParams({ showWanted: true }),
    );
    // A list left empty filters nothing, as the address cannot hold one.
    const everything = filterLibrary(FILTER_TOWN, { showWanted: true }, NONE);
    for (const f of [
      { status: [], showWanted: true },
      { met: [], showWanted: true },
      { with: [], showWanted: true },
    ] as LibraryFilter[]) {
      const params = filterParams(f);
      assert.deepEqual(params, filterParams({ showWanted: true }));
      const back = filterFromParams((key) => params[key] ?? null, true);
      assert.deepEqual(back, { showWanted: true });
      assert.deepEqual(filterLibrary(FILTER_TOWN, f, NONE), everything);
    }
    const typed: Record<string, string> = {
      shelf: "../etc",
      with: `${SHELF_SF},bad id`,
      status: "tsundoku,done",
      read: "yes",
      unsorted: "1",
      met: "scan,camera",
      since: "2026-13",
      until: "2026-09",
      by: "removed",
      owned: "maybe",
      author: "あ".repeat(201),
      batch: BATCH,
    };
    assert.deepEqual(
      filterFromParams((key) => typed[key] ?? null, true),
      {
        showWanted: true,
        with: [SHELF_SF],
        status: ["tsundoku"],
        unsorted: true,
        met: ["scan"],
        until: "2026-09",
        batchId: BATCH,
      },
    );
  },
);

// ---------------------------------------------------------------- counts (4-7)

check(
  "4-7 counts are in works: editions of one work and the reader's rows of one ISBN count once; 読みたい, いいね and ☆ apart; no 0",
  () => {
    const state = town({
      books: [
        book("w1-hard", { workId: "work-1", isbn: "9784000000011" }),
        book("w1-paper", { workId: "work-1", isbn: "9784000000028" }),
        book("isbn-a", { isbn: "9784000000035" }),
        book("isbn-b", { isbn: "9784000000035" }),
        book("wanted"),
        book("liked"),
        book("fav"),
        book("out-yes"),
        book("out-no"),
      ],
      libraryEntries: rows(
        entryOf("w1-hard", { owned: "yes" }),
        entryOf("w1-paper", { owned: "no" }),
        entryOf("isbn-a", { status: "tsundoku", statusAt: BEFORE }),
        entryOf("isbn-b", {}),
        entryOf("wanted", { source: "want", wantedAt: BEFORE }),
        entryOf("liked", { source: "like", likedAt: BEFORE }),
        entryOf("fav", { source: "favorite" }),
        entryOf("unknown", {}),
        // Taken out: counted nowhere, 所有 included.
        entryOf("out-yes", { owned: "yes", removedAt: BEFORE }),
        entryOf("out-no", { owned: "no", removedAt: BEFORE }),
      ),
      favorites: ["fav"],
      encounters: [encounter(1, "liked")],
    });
    assert.deepEqual(countsOf(state, NONE), {
      works: 5,
      editions: 6,
      owned: 1,
      notOwned: 1,
      unsorted: 3,
      shelves: { all: 5, tsundoku: 1, want: 1, liked: 1, favorite: 1 },
      themes: {},
    });
    // likes_in_library off: a book only liked leaves the total and unsorted, and still counts on いいねした本.
    const off = countsOf(
      { ...state, settings: { ...LIBRARY_SETTINGS, likesInLibrary: false } },
      NONE,
    );
    assert.equal(off.works, 4);
    assert.equal(off.editions, 5);
    assert.equal(off.unsorted, 2);
    assert.equal(off.shelves.all, 4);
    assert.equal(off.shelves.liked, 1);
    // Nothing in the library: nothing to show.
    assert.deepEqual(countsOf(town(), NONE), {
      works: 0,
      editions: 0,
      owned: 0,
      notOwned: 0,
      unsorted: 0,
      shelves: {},
      themes: {},
    });
  },
);

check(
  "4-7 theme shelves count works, and the books only wanted their view hides; a shelf put away or with none is left out",
  () => {
    const state = town({
      books: ["wanted-only", "tsun", "ed-1", "ed-2", "removed"].map((id) =>
        book(id, id.startsWith("ed-") ? { workId: "work-2" } : {}),
      ),
      libraryEntries: rows(
        entryOf("wanted-only", { wantedAt: BEFORE }),
        entryOf("tsun", { status: "tsundoku", statusAt: BEFORE }),
        entryOf("ed-1", { addedAt: "2026-02-01T00:00:00.000Z" }),
        entryOf("ed-2", {}),
        entryOf("removed", { removedAt: BEFORE }),
      ),
      libraryShelves: [
        shelf(SHELF_SF, { showWanted: false }),
        shelf(SHELF_SHOWN, { position: "a1" }),
        shelf(SHELF_EMPTY, { position: "a2" }),
        shelf(SHELF_GONE, { deletedAt: BEFORE }),
        shelf(uuid(0xc5), { position: "a3" }),
      ],
      libraryShelfBooks: [
        onShelf(SHELF_SF, "wanted-only", "2026-09-01T00:00:00.000Z"),
        onShelf(SHELF_SF, "tsun", "2026-09-02T00:00:00.000Z"),
        onShelf(SHELF_SF, "ed-1", "2026-09-03T00:00:00.000Z"),
        onShelf(SHELF_SF, "ed-2", "2026-09-04T00:00:00.000Z", "a0"),
        onShelf(SHELF_SHOWN, "wanted-only"),
        onShelf(SHELF_GONE, "tsun"),
        onShelf(uuid(0xc5), "removed"),
      ],
    });
    assert.deepEqual(countsOf(state, NONE).themes, {
      [SHELF_SF]: { works: 3, hiddenWanted: 1 },
      [SHELF_SHOWN]: { works: 1 },
    });
    // The shelf's own order: books moved by hand by their keys, then the rest as they were put on.
    assert.deepEqual(
      filterLibrary(state, { shelf: SHELF_SF, showWanted: true }, NONE),
      ["ed-2", "wanted-only", "tsun", "ed-1"],
    );
    assert.deepEqual(
      filterLibrary(state, { shelf: SHELF_SF, showWanted: false }, NONE),
      ["ed-2", "tsun", "ed-1"],
    );
    assert.deepEqual(
      filterLibrary(state, { shelf: SHELF_GONE, showWanted: true }, NONE),
      [],
    );
    assert.deepEqual(
      filterLibrary(state, { shelf: SHELF_EMPTY, showWanted: true }, NONE),
      [],
    );
  },
);

// ---------------------------------------------------------------- the backfill (4-8)

const LIST_OF: Record<MarkKind, keyof MarkLists> = {
  library: "library",
  wish: "wishlist",
  favorite: "favorites",
  finished: "finishedBooks",
};

for (const c of LIBRARY_CASES.backfill)
  check(`legacyToLibrary: ${c.name}`, () => {
    const lists: MarkLists = {
      wishlist: [],
      favorites: [],
      library: [],
      finishedBooks: [],
    };
    for (const mark of c.marks) lists[LIST_OF[mark.kind]].push("b");
    const entries = legacyToLibrary(
      {
        lists,
        markedAt: (kind, bookId) =>
          bookId === "b"
            ? c.marks.find((mark) => mark.kind === kind)?.at
            : undefined,
        // Another reader's record, and a reading without a book, make nothing.
        records: [
          ...c.records.map((createdAt, i) => record("b", ME_ID, createdAt, i)),
          record("their-book", OTHER, "2026-07-01T00:00:00.000Z"),
        ],
        sessions: [
          ...c.sessions.map((s, i) => session("b", s.startedAt, s.endedAt, i)),
          session(
            null,
            "2026-07-01T00:00:00.000Z",
            "2026-07-01T01:00:00.000Z",
            9,
          ),
        ],
        uses: (c.uses ?? []).map((use) => ({ bookId: "b", at: use.at })),
      },
      AT,
    );
    assert.deepEqual(Object.keys(entries), c.expect === null ? [] : ["b"]);
    if (c.expect !== null) assert.deepEqual(entries.b, entryOf("b", c.expect));
  });

check(
  "4-8 the demo's lists, without times, come back from the rows in their order",
  () => {
    const lists: MarkLists = {
      wishlist: ["w1", "w2", "w3"],
      favorites: ["fa"],
      library: ["l1", "w2"],
      finishedBooks: ["f1", "f2", "w3"],
    };
    const entries = legacyToLibrary({ lists, records: [], sessions: [] }, AT);
    assert.deepEqual(legacyLists(entries), {
      wishlist: lists.wishlist,
      finishedBooks: lists.finishedBooks,
    });
    assert.deepEqual(Object.keys(entries).sort(), [
      "f1",
      "f2",
      "fa",
      "l1",
      "w1",
      "w2",
      "w3",
    ]);
    for (const e of Object.values(entries)) {
      assert.ok(Date.parse(e.addedAt) < Date.parse(AT));
      assert.equal(e.source, "legacy");
      assert.equal(e.owned, null);
      assert.equal(e.likedAt, null);
      assert.equal(e.everUsed, false);
      assert.equal(validateEntry(e), null);
    }
    // Taken out, a finished book stays finished; a wanted one leaves the wishlist.
    const out = { ...entries, w3: { ...entries.w3, removedAt: AT } };
    assert.deepEqual(legacyLists(out), {
      wishlist: ["w1", "w2"],
      finishedBooks: lists.finishedBooks,
    });
  },
);

// ---------------------------------------------------------------- the trigger's twin (followMarks)

for (const c of LIBRARY_CASES.follow)
  check(`followMarks: ${c.name}`, () => {
    // The case itself holds together: a mark written was not there, a mark deleted was.
    assert.equal(c.marks.includes(c.change.kind), c.change.op === "delete");
    const after =
      c.change.op === "insert"
        ? [...c.marks, c.change.kind]
        : c.marks.filter((kind) => kind !== c.change.kind);
    const keeps = (bookId: string): MarkKeeps => {
      assert.equal(bookId, "b");
      return {
        library: after.includes("library"),
        favorite: after.includes("favorite"),
        liveShelf: c.shelf === "live",
        record: c.record,
        memo: c.memo ?? false,
      };
    };
    const entries: Record<string, LibraryEntry> =
      c.entry === null ? {} : { b: entryOf("b", c.entry) };
    const out = followMarks(
      entries,
      [{ ...c.change, bookId: "b" }],
      keeps,
      DB_NOW,
    );
    if (c.expect === "same") assert.equal(out, entries);
    else if (c.expect === null) assert.equal(out.b, undefined);
    else assert.deepEqual(out.b, entryOf("b", c.expect, DB_NOW));
  });

for (const c of LIBRARY_CASES.save)
  check(`markChanges and followMarks: ${c.name}`, () => {
    const lists = (kinds: MarkKind[]): MarkLists => ({
      wishlist: kinds.includes("wish") ? ["b"] : [],
      favorites: kinds.includes("favorite") ? ["b"] : [],
      library: kinds.includes("library") ? ["b"] : [],
      finishedBooks: kinds.includes("finished") ? ["b"] : [],
    });
    // The marks written are dated by the database, as the old app sends none.
    const changes = markChanges(lists(c.marks), lists(c.after), DB_NOW);
    // In the order the old app sends them: every mark taken off, then every
    // mark put on.
    const ops = changes.map((change) => change.op);
    assert.deepEqual(ops, [
      ...ops.filter((op) => op === "delete"),
      ...ops.filter((op) => op === "insert"),
    ]);
    const entries: Record<string, LibraryEntry> =
      c.entry === null ? {} : { b: entryOf("b", c.entry) };
    const out = followMarks(
      entries,
      changes,
      () => ({
        library: c.after.includes("library"),
        favorite: c.after.includes("favorite"),
        liveShelf: false,
        record: false,
        memo: false,
      }),
      DB_NOW,
    );
    if (c.expect === "same") assert.equal(out, entries);
    else if (c.expect === null) assert.equal(out.b, undefined);
    else assert.deepEqual(out.b, entryOf("b", c.expect, DB_NOW));
  });

check(
  "6-2 the demo's lists changed by an app without the library reach the rows as marks",
  () => {
    const before: MarkLists = {
      wishlist: ["a"],
      favorites: [],
      library: ["c"],
      finishedBooks: [],
    };
    const after: MarkLists = {
      wishlist: [],
      favorites: ["b"],
      library: ["c"],
      finishedBooks: ["a"],
    };
    const changes = markChanges(before, after, AT);
    // Taken off first, as an old app saves them.
    assert.deepEqual(changes, [
      { op: "delete", kind: "wish", bookId: "a", at: AT },
      { op: "insert", kind: "favorite", bookId: "b", at: AT },
      { op: "insert", kind: "finished", bookId: "a", at: AT },
    ]);
    const entries = rows(
      entryOf("a", { source: "legacy", wantedAt: BEFORE }),
      entryOf("c", { source: "legacy" }),
    );
    const out = followMarks(
      entries,
      changes,
      (id) => ({
        library: after.library.includes(id),
        favorite: after.favorites.includes(id),
        liveShelf: false,
        record: false,
        memo: false,
      }),
      DB_NOW,
    );
    // Nothing kept a once its wish was off; finished does not bring it back.
    assert.deepEqual(
      out.a,
      entryOf("a", {
        source: "legacy",
        status: "finished",
        statusAt: AT,
        removedAt: DB_NOW,
      }),
    );
    assert.deepEqual(out.b, entryOf("b", { source: "legacy", addedAt: AT }));
    assert.equal(out.c, entries.c);
    assert.deepEqual(markChanges(after, after, AT), []);
    assert.equal(
      followMarks(
        entries,
        [],
        () => ({
          library: false,
          favorite: false,
          liveShelf: false,
          record: false,
          memo: false,
        }),
        DB_NOW,
      ),
      entries,
    );
  },
);

check(
  "6-2 wishes an old tab added between two loads keep its order in the rows",
  () => {
    const none: MarkLists = {
      wishlist: [],
      favorites: [],
      library: [],
      finishedBooks: [],
    };
    const before = { ...none, wishlist: ["a"] };
    const after = { ...none, wishlist: ["a", "b6", "b0", "b3"] };
    const changes = markChanges(before, after, AT);
    assert.deepEqual(changes, [
      { op: "insert", kind: "wish", bookId: "b6", at: plus(-2) },
      { op: "insert", kind: "wish", bookId: "b0", at: plus(-1) },
      { op: "insert", kind: "wish", bookId: "b3", at: AT },
    ]);
    const out = followMarks(
      rows(entryOf("a", { source: "legacy", wantedAt: BEFORE })),
      changes,
      () => ({
        library: false,
        favorite: false,
        liveShelf: false,
        record: false,
        memo: false,
      }),
      DB_NOW,
    );
    assert.deepEqual(legacyLists(out).wishlist, after.wishlist);
    // Deleted marks keep `at`: the trigger takes them at its own time.
    assert.deepEqual(
      markChanges(after, before, AT).map((change) => change.at),
      [AT, AT, AT],
    );
  },
);

// ---------------------------------------------------------------- what holds after every op (11-3)

function invariants(s: LibraryState, step: string) {
  const entries = s.libraryEntries;
  for (const [id, e] of Object.entries(entries)) {
    assert.equal(e.bookId, id, step);
    assert.equal(validateEntry(e), null, `${step}: ${id}`);
  }
  for (const b of s.libraryShelfBooks) {
    assert.ok(
      entries[b.bookId],
      `${step}: ${b.bookId} is on a shelf without a row`,
    );
    assert.ok(b.position === null || b.position.length <= 64, step);
  }
  for (const id of s.favorites)
    assert.ok(entries[id], `${step}: ☆ ${id} without a row`);
  for (const id of s.library)
    assert.equal(
      entries[id]?.removedAt,
      null,
      `${step}: ${id} registered but out`,
    );
  const liked = new Set(
    s.encounters
      .filter((c) => c.undoneAt === null && c.kind !== "want")
      .map((c) => c.bookId),
  );
  for (const e of Object.values(entries))
    assert.equal(
      e.likedAt !== null,
      liked.has(e.bookId),
      `${step}: likedAt of ${e.bookId}`,
    );
  for (const c of s.encounters) {
    assert.equal(validateEncounter(c), null, step);
    assert.ok(
      entries[c.bookId],
      `${step}: encounter of ${c.bookId} without a row`,
    );
  }
  const lists = legacyLists(entries);
  for (const id of lists.wishlist)
    assert.ok(
      entries[id].wantedAt !== null && entries[id].removedAt === null,
      step,
    );
  for (const id of lists.finishedBooks)
    assert.equal(entries[id].status, "finished", step);
  for (const shelf of s.libraryShelves)
    assert.equal(validateShelf(shelf), null, step);
  const counts = countsOf(s, NONE);
  for (const n of [
    ...Object.values(counts.shelves),
    ...Object.values(counts.themes).map((t) => t.works),
  ])
    assert.ok(n > 0, `${step}: a 0 in the counts`);
}

check(
  "11-3 after every op: shelf books, ☆ and encounters have rows, registered rows are in, likedAt stands for a like, rows are valid",
  () => {
    const SHOP_S = new Set(["s"]);
    let s: LibraryState = town({ libraryShelves: [shelf(SHELF_SF)] });
    const memoOf = (state: LibraryState, bookId: string) =>
      writeMemo(
        state.encounters,
        state.encounters.find((c) => c.bookId === bookId)?.id ?? "",
        "なぜ",
        plus(9),
      );
    const steps: [string, (s: LibraryState) => LibraryState][] = [
      [
        "scan three",
        (s) =>
          applyOp(
            s,
            ["a", "b", "c"],
            { removed: false, batchId: BATCH },
            AT,
            "scan",
            NONE,
          ),
      ],
      [
        "積読 two",
        (s) =>
          applyOp(
            s,
            ["a", "b"],
            { status: "tsundoku" },
            plus(1),
            "search",
            NONE,
          ),
      ],
      ["読みたい on a page", (s) => react(s, onPage("d"), true, plus(2))],
      [
        "☆",
        (s) => applyOp(s, ["e"], { favorite: true }, plus(3), "favorite", NONE),
      ],
      [
        "onto SF",
        (s) =>
          applyOp(
            s,
            ["a", "f"],
            { addShelf: SHELF_SF },
            plus(4),
            "search",
            NONE,
          ),
      ],
      [
        "onto a shelf nobody has",
        (s) =>
          applyOp(s, ["z"], { addShelf: SHELF_GONE }, plus(4), "search", NONE),
      ],
      ["like a post", (s) => react(s, onPost(post(1, "g")), true, plus(5))],
      [
        "like a scanned book",
        (s) => react(s, onPost(post(2, "c")), true, plus(6)),
      ],
      ["私も好き！", (s) => react(s, onPop("g", "love"), true, plus(6))],
      ["a memo", (s) => ({ ...s, encounters: memoOf(s, "c") })],
      [
        "take back the post's like",
        (s) => react(s, onPost(post(1, "g")), false, plus(7)),
      ],
      [
        "take back 私も好き！",
        (s) => react(s, onPop("g", "love"), false, plus(7)),
      ],
      [
        "take back the scanned book's like",
        (s) => react(s, onPost(post(2, "c")), false, plus(8)),
      ],
      [
        "take out",
        (s) => applyOp(s, ["b"], { removed: true }, plus(9), "search", NONE),
      ],
      [
        "scan back",
        (s) => applyOp(s, ["b"], { removed: false }, plus(10), "scan", NONE),
      ],
      ["like it back", (s) => react(s, onPost(post(1, "g")), true, plus(11))],
      [
        "読みたい off on the page",
        (s) => react(s, onPage("d"), false, plus(12)),
      ],
      [
        "☆ off",
        (s) =>
          applyOp(s, ["e"], { favorite: false }, plus(13), "favorite", NONE),
      ],
      [
        "off SF",
        (s) =>
          applyOp(
            s,
            ["f"],
            { removeShelf: SHELF_SF },
            plus(14),
            "search",
            NONE,
          ),
      ],
      [
        "placed in the shop",
        (s) => applyOp(s, ["s"], { meet: true }, plus(15), "shop", SHOP_S),
      ],
      [
        "SF put away",
        (s) => ({
          ...s,
          libraryShelves: s.libraryShelves.map((x) => ({
            ...x,
            deletedAt: plus(16),
          })),
        }),
      ],
    ];
    for (const [step, run] of steps) {
      s = run(s);
      invariants(s, step);
    }
    // Where it ended.
    assert.equal(s.libraryEntries.z, undefined);
    assert.equal(s.libraryEntries.c.removedAt, null);
    assert.equal(s.libraryEntries.d.removedAt, plus(12));
    assert.equal(s.libraryEntries.e.removedAt, plus(13));
    assert.equal(s.libraryEntries.g.likeRestored, true);
    assert.equal(s.libraryEntries.f.removedAt, null);
  },
);

// ---------------------------------------------------------------- checks before sending (10-0)

check(
  "10-0 validateEntry takes every source and refuses what the table would",
  () => {
    for (const source of ENTRY_SOURCES)
      assert.equal(validateEntry(entryOf("b", { source })), null, source);
    for (const source of ["post", "poster", "nine", "shop"])
      assert.ok((ENTRY_SOURCES as readonly string[]).includes(source));
    const bad = (part: Record<string, unknown>) =>
      validateEntry({ ...entryOf("b", {}), ...part } as LibraryEntry);
    assert.equal(bad({ bookId: "" }), "bookId");
    assert.equal(bad({ status: "done" }), "status");
    assert.equal(bad({ statusAt: "yesterday" }), "statusAt");
    assert.equal(bad({ wantedAt: "someday" }), "wantedAt");
    assert.equal(bad({ likedAt: 0 }), "likedAt");
    assert.equal(bad({ owned: "maybe" }), "owned");
    assert.equal(bad({ source: "camera" }), "source");
    assert.equal(bad({ batchId: "" }), "batchId");
    assert.equal(bad({ addedAt: null }), "addedAt");
    assert.equal(bad({ removedAt: "gone" }), "removedAt");
    assert.equal(bad({ likeRestored: "no" }), "likeRestored");
    assert.equal(bad({ everUsed: null }), "everUsed");
  },
);

check(
  "10-0 validateShelf counts characters as the database does, and trims only spaces",
  () => {
    const ok = shelf(SHELF_SF);
    assert.equal(validateShelf(ok), null);
    assert.equal(validateShelf({ ...ok, name: "本".repeat(40) }), null);
    assert.equal(validateShelf({ ...ok, name: "𠮷".repeat(40) }), null);
    assert.equal(validateShelf({ ...ok, name: "本".repeat(41) }), "name");
    assert.equal(validateShelf({ ...ok, name: "   " }), "name");
    assert.equal(
      validateShelf({ ...ok, name: "  " + "本".repeat(40) + "  " }),
      null,
    );
    // A full-width space is not trimmed by btrim, so it is a name.
    assert.equal(validateShelf({ ...ok, name: "　" }), null);
    assert.equal(validateShelf({ ...ok, note: "あ".repeat(500) }), null);
    assert.equal(validateShelf({ ...ok, note: "あ".repeat(501) }), "note");
    assert.equal(validateShelf({ ...ok, position: "a".repeat(64) }), null);
    assert.equal(
      validateShelf({ ...ok, position: "a".repeat(65) }),
      "position",
    );
    assert.equal(validateShelf({ ...ok, position: "a-0" }), "position");
    assert.equal(
      validateShelf({ ...ok, showWanted: "yes" as unknown as boolean }),
      "showWanted",
    );
    assert.equal(validateShelf({ ...ok, deletedAt: "soon" }), "deletedAt");
  },
);

check(
  "10-0 validateEncounter: the pairs the table allows, and memos in characters",
  () => {
    const like = encounter(1, "b");
    assert.equal(validateEncounter(like), null);
    assert.equal(validateEncounter({ ...like, via: "book" }), "kind");
    assert.equal(validateEncounter({ ...like, kind: "love" }), "kind");
    assert.equal(validateEncounter(popEncounter(2, "b", "love")), null);
    const max = "𠮷".repeat(ENCOUNTER_MEMO_MAX_LENGTH);
    assert.equal(max.length, ENCOUNTER_MEMO_MAX_LENGTH * 2);
    assert.equal(validateEncounter({ ...like, memo: max, memoAt: AT }), null);
    assert.equal(
      validateEncounter({ ...like, memo: max + "あ", memoAt: AT }),
      "memo",
    );
    assert.equal(validateEncounter({ ...like, memo: "", memoAt: AT }), "memo");
    assert.equal(
      validateEncounter({ ...like, placementKey: "" }),
      "placementKey",
    );
    assert.equal(validateEncounter({ ...like, postId: "" }), "postId");
    assert.equal(validateEncounter({ ...like, memoAt: "later" }), "memoAt");
    assert.equal(validateEncounter({ ...like, undoneAt: "later" }), "undoneAt");
    assert.equal(
      validateEncounter({ ...like, createdAt: null as unknown as string }),
      "createdAt",
    );
    // writeMemo refuses what the table would, and changes nothing.
    assert.deepEqual(writeMemo([like], like.id, max + "あ", AT), [like]);
    assert.deepEqual(writeMemo([like], "no-such-id", "メモ", AT), [like]);
  },
);

check(
  "10-0 a new encounter names its post, or its shop and the POP's place, as the insert trigger wants; one already there may have lost them",
  () => {
    const like = encounter(1, "b");
    const pop = popEncounter(2, "b", "love");
    const page = encounterOf(onPage("b"), uuid(0xe3), AT, true) as Encounter;
    for (const c of [like, pop, page])
      assert.equal(validateEncounter(c, { insert: true }), null, c.via);
    const lost: [Encounter, string][] = [
      [{ ...like, postId: null }, "postId"],
      [{ ...pop, shopId: null }, "shopId"],
      [{ ...pop, placementKey: null }, "placementKey"],
    ];
    for (const [c, field] of lost) {
      assert.equal(validateEncounter(c), null, field);
      assert.equal(validateEncounter(c, { insert: true }), field);
    }
  },
);

check(
  "10-0 guards: a POP's place over 300 characters meets nothing, taking back twice changes nothing, a book given twice is one",
  () => {
    const place = (length: number) =>
      encounterOf(
        {
          ...(onPop("b", "like") as Extract<EncounterInput, { via: "pop" }>),
          placementKey: "𠮷".repeat(length),
        },
        uuid(0xe4),
        AT,
        true,
      );
    assert.notEqual(place(PLACEMENT_KEY_MAX_LENGTH), null);
    assert.equal(place(PLACEMENT_KEY_MAX_LENGTH + 1), null);
    // Taken back once with its memo kept; taken back again, it keeps its time.
    const kept = encounter(1, "b", "like", { memo: "m", memoAt: BEFORE });
    const once = undoEncounter([kept], kept, AT);
    assert.equal(once[0].undoneAt, AT);
    assert.equal(undoEncounter(once, kept, plus(1)), once);
    let s = react(town(), onPost(P1), true);
    s = {
      ...s,
      encounters: writeMemo(s.encounters, s.encounters[0].id, "m", AT),
    };
    const off = react(s, onPost(P1), false, plus(1));
    assert.equal(react(off, onPost(P1), false, plus(2)), off);
    // One op naming a book twice touches it once, at its first time.
    const twice = applyOp(
      town({ libraryShelves: [shelf(SHELF_SF)] }),
      ["b", "b"],
      { removed: false, addShelf: SHELF_SF },
      AT,
      "scan",
      NONE,
    );
    assert.deepEqual(twice.libraryEntries.b, entryOf("b", { addedAt: AT }));
    assert.deepEqual(twice.library, ["b"]);
    assert.deepEqual(twice.libraryShelfBooks, [onShelf(SHELF_SF, "b", AT)]);
  },
);

/**
 * Writes back what an op found, as undoing it will (10-6), but for a use
 * made since: everUsed stays.
 */
function undoFrom<S extends LibraryState>(
  state: S,
  before: Record<string, OpBefore>,
): S {
  let next = state;
  for (const [bookId, was] of Object.entries(before)) {
    const put = (list: string[], on: boolean) =>
      on
        ? list.includes(bookId)
          ? list
          : [...list, bookId]
        : list.filter((id) => id !== bookId);
    const everUsed = next.libraryEntries[bookId]?.everUsed ?? false;
    next = {
      ...next,
      libraryEntries: was.entry
        ? {
            ...next.libraryEntries,
            [bookId]: {
              ...was.entry,
              everUsed: was.entry.everUsed || everUsed,
            },
          }
        : next.libraryEntries,
      favorites: put(next.favorites, was.favorite),
      library: put(next.library, was.registered),
      libraryShelfBooks: [
        ...next.libraryShelfBooks.filter((book) => book.bookId !== bookId),
        ...was.shelves,
      ],
    };
  }
  return next;
}

check(
  "10-6 what an op found is enough to undo it: the row, the registration, ☆ and each place on a theme shelf come back, and a use made since stays",
  () => {
    // Liked, then scanned (registered), then 外す, then undone: a like taken
    // back afterwards leaves the book in, as it would have before.
    let s = react(town(), onPost(P1), true);
    s = applyOp(s, ["b"], { removed: false }, plus(1), "scan", NONE);
    assert.deepEqual(s.library, ["b"]);
    const before = opBefore(s, ["b", "b"]);
    assert.deepEqual(Object.keys(before), ["b"]);
    assert.equal(before.b.registered, true);
    const out = applyOp(s, ["b"], { removed: true }, plus(2), "search", NONE);
    assert.deepEqual(out.library, []);
    const back = undoFrom(out, before);
    assert.deepEqual(back.library, s.library);
    assert.deepEqual(back.libraryEntries, s.libraryEntries);
    assert.equal(
      react(back, onPost(P1), false, plus(3)).libraryEntries.b.removedAt,
      null,
    );
    // Taken out, placed in the shop while out, and the taking out undone:
    // back in, still marked as used.
    const kept = applyOp(town(), ["u"], { removed: false }, AT, "scan", NONE);
    const wasKept = opBefore(kept, ["u"]);
    const placed = applyOp(
      applyOp(kept, ["u"], { removed: true }, plus(1), "search", NONE),
      ["u"],
      { meet: true },
      plus(2),
      "shop",
      new Set(["u"]),
    );
    assert.equal(placed.libraryEntries.u.removedAt, plus(1));
    assert.deepEqual(undoFrom(placed, wasKept).libraryEntries.u, {
      ...kept.libraryEntries.u,
      everUsed: true,
    });
    // Taken off a theme shelf and put back: the shelf keeps its order.
    const shelved = town({
      libraryEntries: rows(
        entryOf("x", {}),
        entryOf("y", {}),
        entryOf("z", {}),
      ),
      favorites: ["x", "y"],
      libraryShelves: [shelf(SHELF_SF)],
      libraryShelfBooks: [
        onShelf(SHELF_SF, "x", at("02-01")),
        onShelf(SHELF_SF, "y", at("03-01")),
        onShelf(SHELF_SF, "z", at("04-01"), "a0"),
      ],
    });
    const order = (state: LibraryState) =>
      filterLibrary(state, { shelf: SHELF_SF, showWanted: true }, NONE);
    assert.deepEqual(order(shelved), ["z", "x", "y"]);
    for (const id of ["x", "z"]) {
      const was = opBefore(shelved, [id]);
      const off = applyOp(
        shelved,
        [id],
        { removeShelf: SHELF_SF },
        AT,
        "search",
        NONE,
      );
      assert.notDeepEqual(order(off), order(shelved), id);
      const undone = undoFrom(off, was);
      assert.deepEqual(order(undone), ["z", "x", "y"], id);
      assert.deepEqual(
        new Set(undone.libraryShelfBooks),
        new Set(shelved.libraryShelfBooks),
        id,
      );
    }
    // ☆ off and back.
    const was = opBefore(shelved, ["x"]);
    assert.equal(was.x.favorite, true);
    const unstarred = applyOp(
      shelved,
      ["x"],
      { favorite: false },
      AT,
      "favorite",
      NONE,
    );
    assert.deepEqual(unstarred.favorites, ["y"]);
    assert.deepEqual(undoFrom(unstarred, was).favorites, ["y", "x"]);
  },
);

if (failures.length) {
  console.error(
    `${failures.length} of ${failures.length + passed} library checks failed`,
  );
  process.exit(1);
}
console.log(`${passed} library checks passed`);
