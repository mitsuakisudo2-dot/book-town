import assert from "node:assert/strict";
import { createInitialState } from "../src/lib/data";
import { inLibrary } from "../src/lib/library";
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
  assert.deepEqual(broken.libraryEntries, {});
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

console.log(`${passed} library town checks passed`);
