import assert from "node:assert/strict";
import { createInitialState } from "../src/lib/data";
import { countsOf, filterLibrary, inLibrary } from "../src/lib/library";
import {
  entriesOf,
  LEGACY_AT,
  libraryStateOf,
  townShopBooks,
} from "../src/lib/library-town";
import {
  createMemoryRepository,
  deserializeTown,
  serializeTown,
} from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import type { Tables } from "../src/lib/supabase/database.types";
import { isSampleBook, sampleBookRowId } from "../src/lib/samples";
import {
  emptyTown,
  planWrites,
  townFromRows,
  type RemoteIds,
  type RemoteRows,
  type Write,
} from "../src/lib/town-remote";
import { ME_ID, type TownState } from "../src/lib/types";
import { libraryBookIds, ownFirst, pickSources } from "../src/lib/shop-picks";

// The library in the town (library-town.ts): the books worked out from the
// rest of the town, the store's ops and their undoing, the demo's storage,
// and the rows read from and written to the database.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

let clock = Date.parse("2026-10-17T03:00:00.000Z");
const tick = () => new Date((clock += 1000));
const fresh = (initial = createInitialState()) => {
  const store = createTownStore(createMemoryRepository(initial), tick);
  store.initialize();
  return store;
};
const shown = (state: TownState, bookId: string) => {
  const library = libraryStateOf(state);
  const row = library.libraryEntries[bookId];
  if (!row) return false;
  const liked = library.encounters.some(
    (c) => c.bookId === bookId && c.kind !== "want",
  );
  return inLibrary(row, {
    favorite: state.favorites.includes(bookId),
    liveThemeCount: 0,
    inShop: townShopBooks(state).has(bookId),
    likesInLibrary: true,
    registered: state.library.includes(bookId),
    usedElsewhere: false,
    liked,
    wantMet: false,
    memo: false,
  });
};

check(
  "a town saved before the library has every book it met worked out",
  () => {
    const state: TownState = {
      ...createInitialState(),
      wishlist: ["solaris", "momo"],
      finishedBooks: ["left-hand"],
      library: ["fahrenheit"],
    };
    const rows = entriesOf(state);
    assert.equal(rows.solaris.wantedAt !== null, true);
    assert.equal(rows["left-hand"].status, "finished");
    assert.equal(rows.fahrenheit.source, "legacy");
    // The order of a list without times is kept, before anything done now.
    assert.ok(
      Date.parse(rows.solaris.wantedAt!) < Date.parse(rows.momo.wantedAt!),
    );
    assert.ok(Date.parse(rows.momo.wantedAt!) < Date.parse(LEGACY_AT));
    // 人生の9冊 are used, so they are met.
    for (const id of state.me.lifeNine) assert.equal(rows[id]?.everUsed, true);
    // The rows kept win over the ones worked out.
    const kept = {
      ...state,
      libraryEntries: {
        solaris: {
          ...rows.solaris,
          status: "tsundoku" as const,
          statusAt: LEGACY_AT,
        },
      },
    };
    assert.equal(entriesOf(kept).solaris.status, "tsundoku");
    assert.equal(entriesOf(kept), entriesOf(kept));
  },
);

check("a book only liked is in the library while the like stands", () => {
  const base = createInitialState();
  const post = base.posts.find(
    (entry) => entry.bookId && entry.authorId !== ME_ID,
  )!;
  const bookId = post.bookId!;
  const clean = { ...base, me: { ...base.me, lifeNine: [] } };
  assert.equal(entriesOf(clean)[bookId], undefined);
  const liked = { ...clean, likedPosts: [post.id] };
  assert.equal(entriesOf(liked)[bookId].source, "like");
  assert.ok(shown(liked, bookId));
  assert.ok(
    libraryStateOf(liked).encounters.some(
      (c) => c.bookId === bookId && c.kind === "like",
    ),
  );
});

check(
  "読みたい goes on and off through the library, the list read back from the rows",
  () => {
    const store = fresh();
    const { actions } = store;
    actions.toggleWish("fahrenheit");
    let state = store.getSnapshot();
    assert.deepEqual(state.wishlist, ["fahrenheit"]);
    assert.equal(state.libraryEntries.fahrenheit.source, "want");
    assert.ok(state.libraryEntries.fahrenheit.wantedAt);
    actions.toggleWish("fahrenheit");
    state = store.getSnapshot();
    assert.deepEqual(state.wishlist, []);
    // Wanted alone, it leaves the library, and its row stays to come back.
    assert.ok(state.libraryEntries.fahrenheit.removedAt);
    assert.equal(shown(state, "fahrenheit"), false);
    actions.toggleWish("fahrenheit");
    assert.equal(store.getSnapshot().libraryEntries.fahrenheit.removedAt, null);
  },
);

check(
  "sorting never takes 読みたい away, and 読了 is the list of finished books",
  () => {
    const store = fresh();
    const { actions } = store;
    actions.toggleWish("momo");
    const undo = actions.changeLibrary(["momo", "solaris"], {
      status: "finished",
    });
    assert.ok(undo);
    let state = store.getSnapshot();
    assert.deepEqual(state.wishlist, ["momo"]);
    assert.deepEqual(
      new Set(state.finishedBooks),
      new Set(["momo", "solaris"]),
    );
    // Nothing anyone could see: no reading, no record, no post.
    assert.equal(state.readingSessions.length, 0);
    assert.equal(
      state.readingRecords.filter((record) => record.readerId === ME_ID).length,
      0,
    );
    actions.changeLibrary(["solaris"], { status: "tsundoku" });
    state = store.getSnapshot();
    assert.deepEqual(state.finishedBooks, ["momo"]);
    assert.equal(state.libraryEntries.solaris.status, "tsundoku");
    // The status button pressed again is 未設定.
    actions.changeLibrary(["solaris"], { status: null });
    assert.equal(store.getSnapshot().libraryEntries.solaris.status, null);
  },
);

check(
  "所有 is set only by the reader, and taking a book out keeps how it was",
  () => {
    const store = fresh();
    const { actions } = store;
    const done = actions.registerBook(
      { title: "夜の図書館", author: "誰か" },
      "manual",
    );
    assert.ok(done && done.result === "added");
    const bookId = done.bookId;
    let state = store.getSnapshot();
    assert.equal(state.libraryEntries[bookId].owned, null);
    assert.equal(state.libraryEntries[bookId].source, "manual");
    actions.changeLibrary([bookId], { owned: "yes", status: "tsundoku" });
    // 登録 taken back: the book stays in the library, as it was sorted.
    actions.toggleLibrary(bookId);
    state = store.getSnapshot();
    assert.ok(!state.library.includes(bookId));
    assert.equal(state.libraryEntries[bookId].removedAt, null);
    assert.ok(shown(state, bookId));
    // Taken out, it leaves; brought back, it comes as it was.
    actions.changeLibrary([bookId], { removed: true });
    state = store.getSnapshot();
    assert.ok(state.libraryEntries[bookId].removedAt);
    assert.equal(shown(state, bookId), false);
    actions.changeLibrary([bookId], { removed: false });
    state = store.getSnapshot();
    assert.ok(state.library.includes(bookId));
    assert.equal(state.libraryEntries[bookId].removedAt, null);
    assert.equal(state.libraryEntries[bookId].owned, "yes");
    assert.equal(state.libraryEntries[bookId].status, "tsundoku");
  },
);

check(
  "a book only registered leaves the library when 登録 is taken back",
  () => {
    const store = fresh();
    const { actions } = store;
    const done = actions.registerBook(
      { title: "一度きりの本", author: "" },
      "scan",
    );
    assert.ok(done && done.result === "added");
    assert.equal(
      store.getSnapshot().libraryEntries[done.bookId].source,
      "scan",
    );
    actions.toggleLibrary(done.bookId);
    const state = store.getSnapshot();
    assert.ok(state.libraryEntries[done.bookId].removedAt);
    assert.equal(shown(state, done.bookId), false);
  },
);

check(
  "reading a book makes it 読書中, and a finished one read again too",
  () => {
    const store = fresh();
    const { actions } = store;
    actions.changeLibrary(["walking"], { status: "finished" });
    actions.startReading("walking", "solo");
    let state = store.getSnapshot();
    assert.equal(state.libraryEntries.walking.status, "reading");
    assert.deepEqual(state.finishedBooks, []);
    actions.endReading(true);
    state = store.getSnapshot();
    assert.equal(state.libraryEntries.walking.status, "finished");
    assert.deepEqual(state.finishedBooks, ["walking"]);
  },
);

check("a book started from nothing is kept as 読書中, and stays so", () => {
  const store = fresh();
  const book = store.getSnapshot().books[3].id;
  assert.ok(!(book in store.getSnapshot().libraryEntries));
  store.actions.startReading(book, "solo");
  assert.equal(store.getSnapshot().libraryEntries[book]?.status, "reading");
  store.actions.endReading(false);
  assert.equal(entriesOf(store.getSnapshot())[book]?.status, "reading");
});

check("the old lists keep their order as rows are kept around them", () => {
  const initial = createInitialState();
  const [b, a, c, d, x, y] = initial.books.map((book) => book.id).sort();
  const store = fresh({ ...initial, wishlist: [a, b], finishedBooks: [x, y] });
  const { actions } = store;
  actions.startReading(a, "solo");
  actions.endReading(true);
  actions.toggleWish(x);
  actions.toggleWish(c);
  actions.toggleWish(d);
  actions.startReading(c, "solo");
  actions.endReading(true);
  actions.toggleFavorite(d);
  actions.toggleFavorite(d);
  const state = store.getSnapshot();
  assert.deepEqual(state.wishlist, [a, b, x, c, d]);
  assert.deepEqual(state.finishedBooks, [x, y, a, c]);
});

check("a book once used stays in the library when the use goes", () => {
  const store = fresh();
  const book = store
    .getSnapshot()
    .books.map((entry) => entry.id)
    .find((id) => !(id in entriesOf(store.getSnapshot())));
  assert.ok(book);
  store.actions.updateNine([book], {});
  // While it is used, the row worked out says so, and nothing is kept.
  assert.ok(!(book in store.getSnapshot().libraryEntries));
  assert.equal(entriesOf(store.getSnapshot())[book]?.everUsed, true);
  store.actions.updateNine([], {});
  const state = store.getSnapshot();
  assert.equal(state.libraryEntries[book]?.everUsed, true);
  assert.ok(shown(state, book));
});

check("undo puts the books back, but not one changed again since", () => {
  const store = fresh();
  const { actions } = store;
  actions.changeLibrary(["momo"], { status: "tsundoku" });
  const undo = actions.changeLibrary(["momo", "solaris", "fictions"], {
    status: "finished",
    owned: "no",
  });
  assert.ok(undo);
  actions.changeLibrary(["solaris"], { owned: "yes" });
  const restored = actions.undoLibrary(undo);
  assert.equal(restored, 2);
  const state = store.getSnapshot();
  assert.equal(state.libraryEntries.momo.status, "tsundoku");
  assert.equal(state.libraryEntries.momo.owned, null);
  assert.equal(state.libraryEntries.solaris.owned, "yes");
  assert.equal(state.libraryEntries.solaris.status, "finished");
  // A book the op brought in from nothing goes out again.
  assert.equal(shown(state, "fictions"), false);
  assert.deepEqual(state.finishedBooks, ["solaris"]);
  // Undoing twice changes nothing more.
  assert.equal(actions.undoLibrary(undo), 0);
});

check("a change that changes nothing answers null", () => {
  const store = fresh();
  const { actions } = store;
  actions.changeLibrary(["momo"], { status: "tsundoku" });
  assert.equal(actions.changeLibrary(["momo"], { status: "tsundoku" }), null);
  assert.equal(
    actions.changeLibrary(["no-such-book"], { status: "reading" }),
    null,
  );
  assert.equal(
    actions.changeLibrary(["momo"], { status: "lost" as never }),
    null,
  );
});

check("the demo keeps the rows, and leaves out any it would not take", () => {
  const store = fresh();
  store.actions.changeLibrary(["momo"], { status: "tsundoku", owned: "yes" });
  const saved = serializeTown(store.getSnapshot());
  const back = deserializeTown(saved).state;
  assert.deepEqual(back.libraryEntries, store.getSnapshot().libraryEntries);
  const envelope = JSON.parse(saved);
  envelope.data.libraryEntries.momo.status = "lost";
  envelope.data.libraryEntries.ghost = {
    ...envelope.data.libraryEntries.momo,
    bookId: "ghost",
  };
  const broken = deserializeTown(JSON.stringify(envelope)).state;
  assert.ok(!("momo" in broken.libraryEntries));
  assert.ok(!("ghost" in broken.libraryEntries));
  // A save from before the library still has its books.
  delete envelope.data.libraryEntries;
  envelope.data.finishedBooks = ["momo"];
  const old = deserializeTown(JSON.stringify(envelope)).state;
  assert.deepEqual(old.libraryEntries, {});
  assert.equal(entriesOf(old).momo.status, "finished");
});

// ---------------------------------------------------------------- the database

const AKI = "00000000-0000-4000-8000-00000000000a";
const BOOK = "00000000-0000-4000-8000-000000000b01";
const OTHER = "00000000-0000-4000-8000-000000000b02";
const ids: RemoteIds = {
  userId: AKI,
  shopId: "00000000-0000-4000-8000-0000000000a5",
};
const at = "2026-10-12T09:00:00.000Z";

const entryRow = (
  book_id: string,
  extra: Partial<Tables<"library_entries">> = {},
): Tables<"library_entries"> => ({
  user_id: AKI,
  book_id,
  status: null,
  status_at: null,
  wanted_at: null,
  liked_at: null,
  owned: null,
  source: "scan",
  batch_id: null,
  added_at: at,
  removed_at: null,
  like_restored: false,
  ever_used: false,
  updated_at: at,
  ...extra,
});

function rows(extra: Partial<RemoteRows> = {}): RemoteRows {
  const book = (id: string) => ({
    id,
    isbn: null,
    title: "華氏451度",
    author: "レイ・ブラッドベリ",
    publisher: "",
    price: null,
    source: "manual",
    work_id: "w" + id.slice(1),
    created_at: at,
    updated_at: at,
  });
  return {
    profiles: [
      {
        id: AKI,
        handle: "aki",
        name: "AKI",
        bio: "",
        color: "#768281",
        links: [],
        compose_icon: "pen",
        reading_visibility: "private",
        created_at: at,
        updated_at: at,
      },
    ],
    nine: [],
    books: [book(BOOK), book(OTHER)],
    shops: [],
    ownShelves: [],
    ownSceneBooks: [],
    ownShopFollowers: 0,
    ownShopVisitors: null,
    shopMessages: [],
    follows: [],
    blocks: [],
    marks: [],
    posts: [],
    postReactions: [],
    spoilerReports: [],
    popReactions: [],
    sessions: [],
    records: [],
    posters: [],
    seenNotifications: [],
    folds: [],
    myReports: [],
    readerSettings: null,
    ...extra,
  };
}

const libraryWrite = (writes: Write[]) =>
  writes.find(
    (write): write is Extract<Write, { kind: "library-entries" }> =>
      write.kind === "library-entries",
  );

check(
  "the reader's rows are read, a 見本's book by its own name, and an unknown value left out",
  () => {
    const sample = createInitialState().books.find((book) =>
      isSampleBook(book.id),
    )!;
    const town = townFromRows(
      rows({
        libraryEntries: [
          entryRow(BOOK, { status: "tsundoku", status_at: at, owned: "yes" }),
          entryRow(OTHER, { status: "abandoned" }),
          entryRow(sampleBookRowId(sample.id), { wanted_at: at }),
          entryRow("00000000-0000-4000-8000-000000000b99"),
        ],
      }),
      ids,
    );
    assert.equal(town.libraryEntries[BOOK].status, "tsundoku");
    assert.equal(town.libraryEntries[BOOK].owned, "yes");
    assert.equal(town.libraryEntries[OTHER], undefined);
    assert.equal(town.libraryEntries[sample.id].wantedAt, at);
    assert.equal(Object.keys(town.libraryEntries).length, 2);
    // A visitor's town has none.
    assert.deepEqual(
      townFromRows(rows(), { userId: null, shopId: "x" }).libraryEntries,
      {},
    );
  },
);

check("only what the reader changed is written, never a partial upsert", () => {
  const base = townFromRows(
    rows({
      libraryEntries: [entryRow(BOOK, { status: "tsundoku", status_at: at })],
      marks: [{ user_id: AKI, book_id: OTHER, kind: "wish", created_at: at }],
    }),
    ids,
  );
  const store = createTownStore(
    {
      kind: "local",
      newId: () => crypto.randomUUID(),
      load: () => ({ state: base, status: "saved" }),
      save: () => "saved",
    },
    tick,
  );
  store.initialize();
  store.actions.changeLibrary([BOOK, OTHER], { owned: "no" });
  const next = store.getSnapshot();
  const write = libraryWrite(planWrites(base, next, ids));
  assert.ok(write);
  // The row the database has: only 所有.
  assert.deepEqual(
    write.patches.find((row) => row.book_id === BOOK),
    { book_id: BOOK, made: false, patch: { owned: "no" } },
  );
  // A row new here: inserted whole, and what changed from the row worked
  // out (wanted by its mark) sent too, for a row another device made.
  const made = write.rows.find((row) => row.book_id === OTHER)!;
  assert.equal(made.owned, "no");
  assert.equal(made.user_id, AKI);
  assert.ok(made.wanted_at);
  assert.deepEqual(
    write.patches.find((row) => row.book_id === OTHER),
    { book_id: OTHER, made: true, patch: { owned: "no" } },
  );
  // Nothing changed, nothing written.
  assert.equal(libraryWrite(planWrites(next, next, ids)), undefined);
});

check(
  "a 見本's book is written under its database id, its catalog row first",
  () => {
    const base = { ...emptyTown(), books: createInitialState().books };
    const sample = base.books.find((book) => isSampleBook(book.id))!;
    const store = createTownStore(
      {
        kind: "local",
        newId: () => crypto.randomUUID(),
        load: () => ({ state: base, status: "saved" }),
        save: () => "saved",
      },
      tick,
    );
    store.initialize();
    store.actions.changeLibrary([sample.id], { status: "reading" });
    const writes = planWrites(base, store.getSnapshot(), ids);
    const kinds = writes.map((write) => write.kind);
    assert.ok(kinds.indexOf("books") < kinds.indexOf("library-entries"));
    const write = libraryWrite(writes)!;
    assert.equal(write.rows[0].book_id, sampleBookRowId(sample.id));
    assert.equal(write.patches[0].book_id, sampleBookRowId(sample.id));
  },
);

// ---------------------------------------------------------------- the reader's shelves (管理表15)

check("a shelf is made last, renamed, put away and brought back", () => {
  const store = fresh();
  const { actions } = store;
  assert.equal(actions.makeLibraryShelf("   ", ""), null);
  assert.equal(actions.makeLibraryShelf("あ".repeat(41), ""), null);
  const sf = actions.makeLibraryShelf(" SF ", " 遠い星の話 ")!;
  const rain = actions.makeLibraryShelf("雨の日", "")!;
  const shelves = store.getSnapshot().libraryShelves;
  assert.deepEqual(
    shelves.map((shelf) => [shelf.name, shelf.note]),
    [
      ["SF", "遠い星の話"],
      ["雨の日", ""],
    ],
  );
  assert.ok(shelves[0].position < shelves[1].position);
  assert.equal(actions.editLibraryShelf(sf, { name: "SF" }), false);
  assert.equal(actions.editLibraryShelf(sf, { name: "" }), false);
  assert.equal(actions.editLibraryShelf(sf, { showWanted: false }), true);
  assert.equal(actions.putAwayLibraryShelf(rain, true), true);
  assert.equal(actions.putAwayLibraryShelf(rain, true), false);
  assert.ok(store.getSnapshot().libraryShelves[1].deletedAt);
  assert.equal(actions.putAwayLibraryShelf(rain, false), true);
  assert.equal(store.getSnapshot().libraryShelves[1].deletedAt, null);
  assert.equal(store.getSnapshot().libraryShelves[0].showWanted, false);
});

check(
  "a book goes on many shelves, keeps its status, and comes off with undo",
  () => {
    const store = fresh();
    const { actions } = store;
    actions.changeLibrary(["momo"], { status: "finished" });
    const sf = actions.makeLibraryShelf("SF", "")!;
    const best = actions.makeLibraryShelf("人生のベスト", "")!;
    // A book only worked out from the town gets its row kept, as the
    // database's shelf books need one.
    assert.equal(store.getSnapshot().libraryEntries.solaris, undefined);
    const undo = actions.changeLibrary(["momo", "solaris"], { addShelf: sf })!;
    actions.changeLibrary(["momo"], { addShelf: best });
    let state = store.getSnapshot();
    assert.ok(state.libraryEntries.solaris);
    assert.equal(state.libraryEntries.momo.status, "finished");
    assert.deepEqual(
      state.libraryShelfBooks
        .filter((book) => book.bookId === "momo")
        .map((book) => book.shelfId)
        .sort(),
      [sf, best].sort(),
    );
    // A shelf put away, or unknown, takes no books.
    actions.putAwayLibraryShelf(best, true);
    assert.equal(actions.changeLibrary(["fictions"], { addShelf: best }), null);
    assert.equal(
      actions.changeLibrary(["fictions"], { addShelf: "nope" }),
      null,
    );
    actions.putAwayLibraryShelf(best, false);
    // Undone: off SF, still on 人生のベスト, still 読了.
    assert.equal(actions.undoLibrary(undo), 2);
    state = store.getSnapshot();
    assert.deepEqual(
      state.libraryShelfBooks.map((book) => [book.shelfId, book.bookId]),
      [[best, "momo"]],
    );
    assert.equal(state.libraryEntries.momo.status, "finished");
    // Taken off and undone, a book goes back with the time it was put on.
    const putOn = state.libraryShelfBooks[0].addedAt;
    const off = actions.changeLibrary(["momo"], { removeShelf: best })!;
    assert.equal(store.getSnapshot().libraryShelfBooks.length, 0);
    actions.undoLibrary(off);
    assert.equal(store.getSnapshot().libraryShelfBooks[0].addedAt, putOn);
  },
);

check("the demo keeps the shelves and their books", () => {
  const store = fresh();
  const sf = store.actions.makeLibraryShelf("SF", "遠い星")!;
  store.actions.changeLibrary(["momo"], { addShelf: sf });
  const saved = serializeTown(store.getSnapshot());
  const back = deserializeTown(saved).state;
  assert.deepEqual(back.libraryShelves, store.getSnapshot().libraryShelves);
  assert.deepEqual(
    back.libraryShelfBooks,
    store.getSnapshot().libraryShelfBooks,
  );
  const envelope = JSON.parse(saved);
  envelope.data.libraryShelves.push({
    ...envelope.data.libraryShelves[0],
    id: "x",
    name: "",
  });
  envelope.data.libraryShelfBooks.push(
    { ...envelope.data.libraryShelfBooks[0] },
    { ...envelope.data.libraryShelfBooks[0], shelfId: "x" },
    { ...envelope.data.libraryShelfBooks[0], bookId: "ghost" },
  );
  const broken = deserializeTown(JSON.stringify(envelope)).state;
  assert.equal(broken.libraryShelves.length, 1);
  assert.equal(broken.libraryShelfBooks.length, 1);
  delete envelope.data.libraryShelves;
  assert.deepEqual(
    deserializeTown(JSON.stringify(envelope)).state.libraryShelfBooks,
    [],
  );
});

check("the shelves are read and written as the reader changed them", () => {
  const SHELF = "00000000-0000-4000-8000-0000000005f1";
  const sample = createInitialState().books.find((book) =>
    isSampleBook(book.id),
  )!;
  const shelfRow = {
    id: SHELF,
    user_id: AKI,
    name: "SF",
    note: "",
    position: "a",
    show_wanted: true,
    audience: "private",
    rule: null,
    created_at: at,
    updated_at: at,
    deleted_at: null,
  };
  const base = townFromRows(
    rows({
      libraryEntries: [entryRow(BOOK), entryRow(sampleBookRowId(sample.id))],
      libraryShelves: [
        shelfRow,
        {
          ...shelfRow,
          id: "00000000-0000-4000-8000-0000000005f2",
          user_id: BOOK,
        },
        { ...shelfRow, id: "00000000-0000-4000-8000-0000000005f3", name: "" },
      ],
      libraryShelfBooks: [
        {
          shelf_id: SHELF,
          user_id: AKI,
          book_id: BOOK,
          added_at: at,
          position: null,
        },
        // Not a row of the library: left out.
        {
          shelf_id: SHELF,
          user_id: AKI,
          book_id: OTHER,
          added_at: at,
          position: null,
        },
      ],
    }),
    ids,
  );
  assert.deepEqual(
    base.libraryShelves.map((shelf) => shelf.id),
    [SHELF],
  );
  assert.deepEqual(
    base.libraryShelfBooks.map((book) => book.bookId),
    [BOOK],
  );
  const store = createTownStore(
    {
      kind: "local",
      newId: () => crypto.randomUUID(),
      load: () => ({ state: base, status: "saved" }),
      save: () => "saved",
    },
    tick,
  );
  store.initialize();
  const { actions } = store;
  actions.editLibraryShelf(SHELF, { name: "SFと宇宙" });
  const made = actions.makeLibraryShelf("見本も", "")!;
  actions.changeLibrary([BOOK], { removeShelf: SHELF });
  actions.changeLibrary([sample.id], { addShelf: made });
  const writes = planWrites(base, store.getSnapshot(), ids);
  const kinds = writes.map((write) => write.kind);
  assert.ok(
    kinds.indexOf("library-entries") < kinds.indexOf("library-shelves"),
  );
  assert.ok(kinds.indexOf("library-shelves") < kinds.indexOf("shelf-books"));
  const shelves = writes.find(
    (write): write is Extract<Write, { kind: "library-shelves" }> =>
      write.kind === "library-shelves",
  )!;
  assert.deepEqual(shelves.patches, [
    { id: SHELF, patch: { name: "SFと宇宙" } },
  ]);
  assert.equal(shelves.rows.length, 1);
  assert.equal(shelves.rows[0].id, made);
  assert.equal(shelves.rows[0].user_id, AKI);
  // Private and filled by hand: the database's own default, not sent, so a
  // database a migration behind takes it too.
  assert.ok(!("audience" in shelves.rows[0]) && !("rule" in shelves.rows[0]));
  const books = writes.find(
    (write): write is Extract<Write, { kind: "shelf-books" }> =>
      write.kind === "shelf-books",
  )!;
  assert.deepEqual(books.remove, [{ shelf_id: SHELF, book_id: BOOK }]);
  assert.equal(books.add.length, 1);
  assert.equal(books.add[0].book_id, sampleBookRowId(sample.id));
  assert.equal(books.add[0].shelf_id, made);
  assert.equal(
    planWrites(store.getSnapshot(), store.getSnapshot(), ids).length,
    0,
  );

  // A book back on a shelf at its old place (an undo) is put on again there.
  const moved = {
    ...base,
    libraryShelfBooks: base.libraryShelfBooks.map((book) => ({
      ...book,
      addedAt: "2026-10-20T00:00:00.000Z",
    })),
  };
  const again = planWrites(moved, base, ids).find(
    (write): write is Extract<Write, { kind: "shelf-books" }> =>
      write.kind === "shelf-books",
  )!;
  assert.deepEqual(again.remove, [{ shelf_id: SHELF, book_id: BOOK }]);
  assert.deepEqual(
    again.add.map((row) => [row.shelf_id, row.book_id, row.added_at]),
    [[SHELF, BOOK, base.libraryShelfBooks[0].addedAt]],
  );
});

// ---------------------------------------------------------------- who may see a shelf, and smart shelves

check(
  "a smart shelf gathers the books that meet its rule, and takes none by hand",
  () => {
    const store = fresh();
    const { actions } = store;
    actions.changeLibrary(["momo", "solaris"], { status: "finished" });
    actions.changeLibrary(["fictions"], { status: "reading" });
    // No condition, a rule that cannot be read, or a shelf made smart: refused.
    assert.equal(actions.makeLibraryShelf("空", "", { rule: {} }), null);
    assert.equal(
      actions.makeLibraryShelf("変", "", { rule: { status: [] } }),
      null,
    );
    const sf = actions.makeLibraryShelf("SF", "")!;
    actions.changeLibrary(["solaris"], { addShelf: sf });
    const done = actions.makeLibraryShelf("読み終えた", "", {
      rule: { status: ["finished"] },
    })!;
    assert.equal(
      actions.makeLibraryShelf("入れ子", "", { rule: { with: [done] } }),
      null,
    );
    const lem = actions.makeLibraryShelf("レム", "", {
      rule: { author: "れむ", with: [sf] },
    })!;
    let library = libraryStateOf(store.getSnapshot());
    const shop = townShopBooks(store.getSnapshot());
    const on = (shelf: string) =>
      filterLibrary(library, { shelf, showWanted: true }, shop).sort();
    assert.deepEqual(on(done), ["momo", "solaris"]);
    // The author is found as a search finds it: かな and カタカナ alike.
    assert.deepEqual(on(lem), ["solaris"]);
    assert.equal(countsOf(library, shop).themes[done].works, 2);
    // A smart shelf takes no book by hand, and holds no shelf rows.
    assert.equal(actions.changeLibrary(["fictions"], { addShelf: done }), null);
    assert.ok(
      store
        .getSnapshot()
        .libraryShelfBooks.every((book) => book.shelfId === sf),
    );
    // Its rule changes; a shelf stays the kind it was made.
    assert.equal(
      actions.editLibraryShelf(done, { rule: { status: ["reading"] } }),
      true,
    );
    assert.equal(
      actions.editLibraryShelf(sf, { rule: { owned: "yes" } }),
      false,
    );
    assert.equal(actions.editLibraryShelf(done, { rule: {} }), false);
    library = libraryStateOf(store.getSnapshot());
    assert.deepEqual(on(done), ["fictions"]);
    // The demo keeps the rule.
    const back = deserializeTown(serializeTown(store.getSnapshot())).state;
    assert.deepEqual(back.libraryShelves, store.getSnapshot().libraryShelves);
  },
);

check(
  "each shelf has who may see it, and a narrower starting choice narrows them all",
  () => {
    const store = fresh();
    const { actions } = store;
    const sf = actions.makeLibraryShelf("SF", "")!;
    const shelfOf = () =>
      store.getSnapshot().libraryShelves.find((shelf) => shelf.id === sf)!;
    // A new shelf starts at the starting choice: 自分だけ.
    assert.equal(shelfOf().audience, "private");
    assert.equal(actions.editLibraryShelf(sf, { audience: "everyone" }), true);
    // フォロワー限定 is not offered yet.
    assert.equal(
      actions.editLibraryShelf(sf, { audience: "followers" }),
      false,
    );
    assert.equal(actions.setDefaultShelfAudience("finished", "everyone"), true);
    assert.equal(
      actions.setDefaultShelfAudience("finished", "everyone"),
      false,
    );
    assert.equal(actions.setDefaultShelfAudience("nope", "everyone"), false);
    assert.deepEqual(store.getSnapshot().settings.shelfAudiences, {
      finished: "everyone",
    });
    const back = deserializeTown(serializeTown(store.getSnapshot())).state;
    assert.deepEqual(back.settings.shelfAudiences, { finished: "everyone" });
    // Wider, then narrower again: what was wider narrows with it.
    actions.setVisibility("shelves", "everyone");
    const made = actions.makeLibraryShelf("公開から", "")!;
    assert.equal(
      store.getSnapshot().libraryShelves.find((shelf) => shelf.id === made)!
        .audience,
      "everyone",
    );
    actions.setVisibility("shelves", "private");
    assert.ok(
      store
        .getSnapshot()
        .libraryShelves.every((shelf) => shelf.audience === "private"),
    );
    assert.deepEqual(store.getSnapshot().settings.shelfAudiences, {
      finished: "private",
    });
  },
);

check("who may see a shelf and its rule are read and written", () => {
  const SHELF = "00000000-0000-4000-8000-0000000005f1";
  const shelfRow = {
    id: SHELF,
    user_id: AKI,
    name: "今年の読了",
    note: "",
    position: "a",
    show_wanted: true,
    audience: "everyone",
    rule: { status: ["finished"], since: "2026-01" },
    created_at: at,
    updated_at: at,
    deleted_at: null,
  };
  const base = townFromRows(
    rows({
      libraryEntries: [entryRow(BOOK)],
      libraryShelves: [
        shelfRow,
        // A rule from a later app, or none at all from an earlier database.
        {
          ...shelfRow,
          id: "00000000-0000-4000-8000-0000000005f2",
          rule: { someday: true },
        },
        {
          ...shelfRow,
          id: "00000000-0000-4000-8000-0000000005f3",
          audience: undefined as unknown as string,
          rule: undefined as unknown as null,
        },
      ],
      readerSettings: {
        user_id: AKI,
        shelf_audiences: { finished: "everyone", secret: "everyone" },
      } as unknown as RemoteRows["readerSettings"],
    }),
    ids,
  );
  assert.deepEqual(
    base.libraryShelves.map((shelf) => [shelf.id, shelf.audience, shelf.rule]),
    [
      [SHELF, "everyone", { status: ["finished"], since: "2026-01" }],
      ["00000000-0000-4000-8000-0000000005f3", "private", null],
    ],
  );
  assert.deepEqual(base.settings.shelfAudiences, { finished: "everyone" });
  const store = createTownStore(
    {
      kind: "local",
      newId: () => crypto.randomUUID(),
      load: () => ({ state: base, status: "saved" }),
      save: () => "saved",
    },
    tick,
  );
  store.initialize();
  const { actions } = store;
  actions.editLibraryShelf(SHELF, {
    audience: "private",
    rule: { status: ["finished"], since: "2026-01", until: "2026-12" },
  });
  const smart = actions.makeLibraryShelf("積読", "", {
    rule: { status: ["tsundoku"] },
  })!;
  actions.makeLibraryShelf("手で", "");
  actions.setDefaultShelfAudience("want", "everyone");
  const writes = planWrites(base, store.getSnapshot(), ids);
  const shelves = writes.find(
    (write): write is Extract<Write, { kind: "library-shelves" }> =>
      write.kind === "library-shelves",
  )!;
  assert.deepEqual(shelves.patches, [
    {
      id: SHELF,
      patch: {
        audience: "private",
        rule: { status: ["finished"], since: "2026-01", until: "2026-12" },
      },
    },
  ]);
  // A smart shelf among them: every new row says who may see it and its rule.
  assert.deepEqual(
    shelves.rows.map((row) => [row.audience, row.rule]),
    [
      ["private", { status: ["tsundoku"] }],
      ["private", null],
    ],
  );
  assert.equal(shelves.rows[0].id, smart);
  const settings = writes.find(
    (write): write is Extract<Write, { kind: "reader-settings" }> =>
      write.kind === "reader-settings",
  )!;
  assert.deepEqual(settings.row, {
    user_id: AKI,
    shelf_audiences: { finished: "everyone", want: "everyone" },
  });
});

check("a shop's books are picked from the library first (103)", () => {
  const store = fresh();
  const { actions } = store;
  actions.changeLibrary(["momo"], { status: "finished" });
  const sf = actions.makeLibraryShelf("SF", "")!;
  actions.changeLibrary(["solaris"], { addShelf: sf });
  actions.makeLibraryShelf("空の棚", "");
  const state = store.getSnapshot();
  const sources = pickSources(state);
  // 読了, the shelves made in their order, then the whole library; an
  // empty shelf is not offered.
  assert.deepEqual(
    sources.map((source) => source.key),
    ["finished", sf, "all"],
  );
  assert.equal(sources[0].label, "読了");
  assert.ok(sources[0].ids.includes("momo"));
  assert.deepEqual(sources[1].ids, ["solaris"]);
  assert.deepEqual(sources[2].ids, libraryBookIds(state));
  // Before anything is typed: the reader's own books in the library's
  // order, then the town's in the town's.
  const own = libraryBookIds(state);
  const split = ownFirst(state.books, own);
  assert.deepEqual(
    split.own.map((book) => book.id),
    own.filter((id) => state.books.some((book) => book.id === id)),
  );
  assert.equal(split.own.length + split.town.length, state.books.length);
  assert.ok(split.town.every((book) => !own.includes(book.id)));
  assert.deepEqual(
    split.town.map((book) => book.id),
    state.books.filter((book) => !own.includes(book.id)).map((b) => b.id),
  );
});

console.log(`${passed} library town checks passed`);
