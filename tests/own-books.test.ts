import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { bookById, bookByIsbn } from "../src/lib/book-name";
import { booksBeforeSearch } from "../src/lib/book-lists";
import { createRegisteredBook } from "../src/lib/books";
import { entriesOf, townEncounters } from "../src/lib/library-town";
import { townMissedLine } from "../src/lib/missed-changes";
import { holds, mine, withoutTwins } from "../src/lib/own-books";
import { postersOfBook } from "../src/lib/posters";
import { ownRecordFor } from "../src/lib/records";
import { bookReviews, spoilerViewOf, wantSources } from "../src/lib/social";
import { createTownStore } from "../src/lib/store";
import { accountTownBackend } from "../src/lib/supabase/town-backend";
import {
  emptyTown,
  planWrites,
  townFromRows,
  type Write,
} from "../src/lib/town-remote";
import {
  ME_ID,
  type Book,
  type PersistenceStatus,
  type Post,
  type TownState,
} from "../src/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { foundBookChecks } from "./found-books";

// A reader's rows name only books of their own (監査 AUD-001; けにー 10-18
// 00:28Z; own-books.ts): a book another reader typed in is shown as theirs,
// and the first time the reader uses it, the town gives the reader a copy of
// it, which the database makes (copy_book) before any row names it. What
// readers say of a book meets at its work, so the copy's page and the
// original's show the same talk. Everything runs inside main() because tsx
// compiles this file as CommonJS.

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const BEN_SHOP = "00000000-0000-4000-8000-0000000000b5";
// Ben typed these in: one without an ISBN, one with.
const SNOW = "00000000-0000-4000-8000-000000000b01";
const STARS = "00000000-0000-4000-8000-000000000b02";
const STARS_ISBN = "9784488663018";
const SNOW_POST = "00000000-0000-4000-8000-0000000000e1";
const STARS_POST = "00000000-0000-4000-8000-0000000000e2";
const at = "2026-10-12T09:00:00Z";

/** Ben's books, as Aki's town shows them: his. */
const bensBook = (id: string, title: string, isbn?: string): Book => ({
  ...createRegisteredBook(id, {
    title,
    author: "ベン",
    ...(isbn ? { isbn } : {}),
  }),
  workId: "w" + id.slice(1),
  theirs: true,
});

const bensPost = (id: string, bookId: string, body: string): Post => ({
  id,
  authorId: BEN,
  body,
  bookId,
  spoiler: false,
  parentId: null,
  createdAt: at,
  likes: 0,
  wants: 0,
  readingMode: null,
});

/** Aki's town: Ben's two books, and his 便り about each. */
function akisTown(): TownState {
  const town = emptyTown({ name: "アキ", handle: "aki" });
  return {
    ...town,
    books: [
      bensBook(SNOW, "雪の夜話"),
      bensBook(STARS, "星の継承", STARS_ISBN),
    ],
    readers: [
      {
        id: BEN,
        handle: "ben",
        name: "ベン",
        bio: "",
        color: "#768281",
        links: [],
        lifeNine: [],
        nineNotes: {},
      },
    ],
    posts: [
      bensPost(SNOW_POST, SNOW, "雪の夜に読みたい。"),
      bensPost(STARS_POST, STARS, "星の話がよかった。"),
    ],
  };
}

/** Ids as the database gives them, one after another. */
function databaseIds() {
  let next = 0;
  return () =>
    `00000000-0000-4000-8000-${(0xc00 + ++next).toString(16).padStart(12, "0")}`;
}

/** Aki's town in a store, saved by an account that keeps every town it saves. */
function akisStore(state = akisTown()) {
  const id = databaseIds();
  const saved: TownState[] = [];
  const store = createTownStore({
    kind: "account",
    newId: () => id(),
    load: () => ({ state: structuredClone(state), status: "saved" }),
    save: (town) => {
      saved.push(town);
      return "saved";
    },
  });
  store.initialize();
  return { store, saved, before: store.getSnapshot() };
}

/** The books of the town that are copies, by what they copy. */
const copiesIn = (state: TownState) =>
  state.books.filter((book) => book.copyOf);

async function settled(
  store: ReturnType<typeof createTownStore>,
): Promise<PersistenceStatus> {
  for (let wait = 0; wait < 400; wait++) {
    const status = store.getPersistenceSnapshot();
    if (status !== "loading" && status !== "saving" && status !== "unavailable")
      return status;
    await new Promise((resume) => setTimeout(resume, 5));
  }
  throw new Error("The town never settled: " + store.getPersistenceSnapshot());
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "registering the ISBN of a book another reader typed in makes the reader's own",
    () => {
      const { store } = akisStore();
      const done = store.actions.registerBook(
        { title: "星を継ぐもの", author: "J・P・ホーガン", isbn: STARS_ISBN },
        "isbn",
      );
      assert.equal(done?.result, "added");
      const id = done && "bookId" in done ? done.bookId : "";
      assert.notEqual(id, STARS);
      const town = store.getSnapshot();
      const own = bookById(town.books, id);
      // Aki's words, in Ben's book's work until the database says.
      assert.equal(own?.title, "星を継ぐもの");
      assert.equal(own?.theirs, undefined);
      assert.equal(own?.workId, bookById(town.books, STARS)?.workId);
      assert.deepEqual(town.library, [id]);
      // Ben's book is as he typed it.
      assert.equal(bookById(town.books, STARS)?.title, "星の継承");
      // Asked again, it is already Aki's.
      assert.equal(
        store.actions.registerBook(
          { title: "星を継ぐもの", author: "", isbn: STARS_ISBN },
          "isbn",
        )?.result,
        "already",
      );
    },
  );

  await check(
    "wanting another reader's book names the reader's own copy of it",
    () => {
      const { store } = akisStore();
      store.actions.toggleWish(SNOW);
      const town = store.getSnapshot();
      const [copy] = copiesIn(town);
      assert.ok(copy);
      assert.equal(copy.copyOf, SNOW);
      assert.equal(copy.title, "雪の夜話");
      assert.equal(copy.theirs, undefined);
      assert.equal(copy.workId, bookById(town.books, SNOW)?.workId);
      assert.deepEqual(town.wishlist, [copy.id]);
      assert.equal(mine(town, SNOW), copy.id);
      // Taken back through Ben's book, Aki's own leaves the list: no
      // second copy.
      store.actions.toggleWish(SNOW);
      assert.deepEqual(store.getSnapshot().wishlist, []);
      assert.equal(copiesIn(store.getSnapshot()).length, 1);
    },
  );

  await check(
    "every way of naming another reader's book names one copy of it",
    () => {
      const { store } = akisStore();
      const { actions } = store;
      actions.createShop("アキの本屋", "", "sage");
      const shelf = store.getSnapshot().ownShop!.shelves[0].id;
      assert.equal(actions.addShelfBook(shelf, SNOW, "spine"), true);
      const post = actions.createPost({ body: "読みはじめた。", bookId: SNOW });
      assert.ok(post);
      assert.ok(
        actions.recordReading({
          bookId: SNOW,
          feelings: ["quiet"],
          note: "",
          spoiler: false,
          audience: "private",
        }),
      );
      actions.updateNine([SNOW], { [SNOW]: "冬の一冊" });
      assert.ok(
        actions.savePoster({
          template: "one_book",
          theme: "navy",
          font: "gothic",
          pages: [{ heading: "雪", text: "", bookIds: [SNOW] }],
          spoiler: false,
          inTimeline: true,
          status: "published",
        }),
      );
      actions.toggleFavorite(SNOW);
      actions.toggleWant(SNOW_POST);
      assert.ok(actions.startReading(SNOW, "solo"));
      const town = store.getSnapshot();
      const copies = copiesIn(town);
      assert.equal(copies.length, 1);
      const copy = copies[0].id;
      assert.deepEqual(
        town.ownShop!.shelves[0].items.map((item) => item.bookId),
        [copy],
      );
      assert.equal(town.posts.find((entry) => entry.id === post)?.bookId, copy);
      assert.deepEqual(
        town.readingRecords.map((record) => record.bookId),
        [copy],
      );
      assert.deepEqual(town.me.lifeNine, [copy]);
      assert.deepEqual(town.me.nineNotes, { [copy]: "冬の一冊" });
      assert.deepEqual(town.posters[0].pages[0].bookIds, [copy]);
      assert.deepEqual(town.favorites, [copy]);
      assert.deepEqual(town.wishlist, [copy]);
      assert.deepEqual(
        town.readingSessions.map((session) => session.bookId),
        [copy],
      );
      // Nothing of Aki's names Ben's book.
      assert.ok(!Object.keys(entriesOf(town)).includes(SNOW));
      assert.ok(!town.library.includes(SNOW));
    },
  );

  await check("a copy is made only when what names it is taken", () => {
    const { store, before } = akisStore();
    const { actions } = store;
    // No shop, no shelf; nothing to say; a 9 of nothing new.
    assert.equal(actions.addShelfBook("nowhere", SNOW, "spine"), false);
    assert.equal(actions.createPost({ body: "  ", bookId: SNOW }), null);
    assert.equal(
      actions.savePoster({
        template: "one_book",
        theme: "navy",
        font: "gothic",
        pages: [{ heading: "", text: "", bookIds: [SNOW, STARS] }],
        spoiler: false,
        inTimeline: true,
        status: "published",
      }),
      null,
    );
    assert.equal(store.getSnapshot(), before);
  });

  await check(
    "a book of an ISBN the reader has stands for theirs: no copy is made",
    () => {
      const { store } = akisStore();
      const done = store.actions.registerBook(
        { title: "星を継ぐもの", author: "", isbn: STARS_ISBN },
        "isbn",
      );
      const own = done && "bookId" in done ? done.bookId : "";
      store.actions.toggleWish(STARS);
      const town = store.getSnapshot();
      assert.deepEqual(town.wishlist, [own]);
      assert.equal(copiesIn(town).length, 0);
      // Searched or picked, the same book is there once, as Aki's.
      assert.deepEqual(
        withoutTwins(town.books).map((book) => book.id),
        [SNOW, own],
      );
      assert.ok(!booksBeforeSearch(town).some((book) => book.id === STARS));
    },
  );

  await check(
    "two copies of one book, made on two pages: each list is asked, and changed, by the one in it",
    () => {
      // Each page copied 雪の夜話 before it read the other's copy.
      const copy = (id: string): Book => ({
        ...createRegisteredBook(id, { title: "雪の夜話", author: "ベン" }),
        workId: "w" + SNOW.slice(1),
        copyOf: SNOW,
      });
      const [first, second] = [
        "00000000-0000-4000-8000-000000000c91",
        "00000000-0000-4000-8000-000000000c92",
      ];
      const town = akisTown();
      const { store } = akisStore({
        ...town,
        books: [...town.books, copy(first), copy(second)],
      });
      store.actions.toggleWish(first);
      store.actions.toggleLibrary(second);
      const both = store.getSnapshot();
      assert.ok(holds(both, both.wishlist, SNOW));
      assert.ok(holds(both, both.library, SNOW));
      // Taken off from 雪の夜話's page, the wish goes, and no copy is made.
      store.actions.toggleWish(SNOW);
      const after = store.getSnapshot();
      assert.deepEqual(after.wishlist, []);
      assert.ok(!holds(after, after.wishlist, SNOW));
      assert.ok(holds(after, after.library, SNOW));
      assert.equal(copiesIn(after).length, 2);
    },
  );

  await check(
    "another reader's book and the reader's own of it, given together, are named once",
    () => {
      const { store } = akisStore();
      const done = store.actions.registerBook(
        { title: "星を継ぐもの", author: "", isbn: STARS_ISBN },
        "isbn",
      );
      const own = done && "bookId" in done ? done.bookId : "";
      assert.ok(
        store.actions.savePoster({
          template: "one_book",
          theme: "navy",
          font: "gothic",
          pages: [{ heading: "星", text: "", bookIds: [STARS, own] }],
          spoiler: false,
          inTimeline: true,
          status: "published",
        }),
      );
      assert.deepEqual(store.getSnapshot().posters[0]?.pages[0]?.bookIds, [
        own,
      ]);
      // In the nine, the note written for Ben's goes with Aki's own.
      store.actions.updateNine([own, STARS], { [STARS]: "星の一冊" });
      assert.deepEqual(store.getSnapshot().me.lifeNine, [own]);
      assert.deepEqual(store.getSnapshot().me.nineNotes, { [own]: "星の一冊" });
      // Given twice as itself, a page is still turned away.
      assert.equal(
        store.actions.savePoster({
          template: "lineup",
          theme: "navy",
          font: "gothic",
          pages: [{ heading: "星", text: "", bookIds: [own, own] }],
          spoiler: false,
          inTimeline: true,
          status: "draft",
        }),
        null,
      );
    },
  );

  await check(
    "a book another reader typed in stays among the first books while the reader's own of it is not shown",
    () => {
      // Aki registered Ben's ISBN, then took it out of her library: her row
      // is still in the town, but no list of hers shows it.
      const { store } = akisStore();
      const done = store.actions.registerBook(
        { title: "星を継ぐもの", author: "", isbn: STARS_ISBN },
        "isbn",
      );
      const own = done && "bookId" in done ? done.bookId : "";
      store.actions.toggleLibrary(own);
      const town = store.getSnapshot();
      assert.ok(!town.library.includes(own));
      assert.ok(town.books.some((book) => book.id === own));
      const first = booksBeforeSearch({
        ...town,
        posts: [...town.posts],
      }).map((book) => book.id);
      assert.ok(!first.includes(own));
      assert.ok(first.includes(STARS));
    },
  );

  await check("only the reader's own book is theirs to fix", () => {
    const { store, before } = akisStore();
    assert.equal(
      store.actions.fixBook(SNOW, {
        title: "雪の夜の話",
        author: "ベン",
        isbn: "",
      }),
      "not-saved",
    );
    assert.equal(store.getSnapshot(), before);
  });

  await check(
    "the store scene is given the reader's own book (ownBook)",
    () => {
      const { store, saved } = akisStore();
      const copy = store.actions.ownBook(SNOW);
      assert.ok(copy && copy !== SNOW);
      assert.equal(bookById(store.getSnapshot().books, copy)?.copyOf, SNOW);
      assert.equal(saved.length, 1);
      // Again, it is the same copy, and nothing new is saved.
      assert.equal(store.actions.ownBook(SNOW), copy);
      assert.equal(store.actions.ownBook(copy), copy);
      assert.equal(saved.length, 1);
      assert.equal(store.actions.ownBook("no-such-book"), null);
    },
  );

  await check(
    "the copy is written before what names it, and Ben's book never",
    () => {
      const { store, before } = akisStore();
      store.actions.toggleWish(SNOW);
      const after = store.getSnapshot();
      const copy = copiesIn(after)[0].id;
      const writes = planWrites(before, after, {
        userId: AKI,
        shopId: BEN_SHOP,
      });
      assert.equal(writes[0].kind, "copy-books");
      assert.deepEqual(
        (writes[0] as Extract<Write, { kind: "copy-books" }>).rows,
        [{ id: copy, copied_from: SNOW }],
      );
      assert.ok(!writes.some((write) => write.kind === "books"));
      assert.ok(!JSON.stringify(writes.slice(1)).includes(SNOW));
      assert.ok(JSON.stringify(writes.slice(1)).includes(copy));
    },
  );

  await check(
    "the town tells another reader's books from the reader's own by my_books",
    () => {
      const row = (id: string, source = "manual") => ({
        id,
        isbn: null,
        title: "本",
        author: "",
        publisher: "",
        price: null,
        source,
        work_id: "w" + id.slice(1),
        created_at: at,
        updated_at: at,
      });
      const OWN = "00000000-0000-4000-8000-000000000a01";
      const COPY = "00000000-0000-4000-8000-000000000a02";
      const CATALOG = "00000000-0000-4000-8000-000000000a03";
      const rows = (myBooks?: { id: string; copied_from: string | null }[]) =>
        townFromRows(
          {
            ...{
              profiles: [
                {
                  id: AKI,
                  handle: "aki",
                  name: "アキ",
                  bio: "",
                  color: "#768281",
                  links: [],
                  compose_icon: "pen",
                  reading_visibility: "private",
                  nine_version: 0,
                  published: true,
                  created_at: at,
                  updated_at: at,
                },
              ],
              nine: [],
              books: [row(SNOW), row(OWN), row(COPY), row(CATALOG, "ndl")],
              shops: [],
              ownShelves: [],
              ownSceneBooks: [],
              shopMessages: [],
              ownShopFollowers: 0,
              ownShopVisitors: null,
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
            },
            ...(myBooks ? { myBooks } : {}),
          },
          { userId: AKI, shopId: "" },
        );
      const town = rows([
        { id: OWN, copied_from: null },
        { id: COPY, copied_from: SNOW },
      ]);
      const marked = (id: string) => {
        const book = bookById(town.books, id);
        return [book?.theirs ?? false, book?.copyOf ?? null];
      };
      assert.deepEqual(marked(SNOW), [true, null]);
      assert.deepEqual(marked(OWN), [false, null]);
      assert.deepEqual(marked(COPY), [false, SNOW]);
      assert.deepEqual(marked(CATALOG), [false, null]);
      // From a database without my_books, none is told apart.
      assert.ok(!rows().books.some((book) => book.theirs || book.copyOf));
    },
  );

  await check(
    "another reader's typed-in book fills in nothing of its ISBN",
    () => {
      const town = akisTown();
      assert.equal(bookByIsbn(town.books, STARS_ISBN), undefined);
      const own = {
        ...createRegisteredBook("own", { title: "星", author: "" }),
      };
      own.isbn = STARS_ISBN;
      assert.equal(bookByIsbn([...town.books, own], STARS_ISBN), own);
    },
  );

  await check(
    "what is said of a book meets at its work, whoever's book it names",
    () => {
      const { store } = akisStore();
      store.actions.toggleWant(SNOW_POST);
      store.actions.createPost({ body: "わたしも雪の夜に。", bookId: SNOW });
      store.actions.savePoster({
        template: "one_book",
        theme: "navy",
        font: "gothic",
        pages: [{ heading: "雪", text: "", bookIds: [SNOW] }],
        spoiler: false,
        inTimeline: true,
        status: "published",
      });
      store.actions.recordReading({
        bookId: SNOW,
        feelings: ["quiet"],
        note: "",
        spoiler: false,
        audience: "private",
      });
      const town = store.getSnapshot();
      const copy = copiesIn(town)[0].id;
      // Ben's 便り and Aki's, on either book's page.
      for (const id of [SNOW, copy]) {
        assert.deepEqual(
          bookReviews(town, id)
            .open.map((post) => post.authorId)
            .sort(),
          [BEN, ME_ID].sort(),
        );
        assert.equal(postersOfBook(town, id).length, 1);
        assert.ok(ownRecordFor(town, id));
      }
      assert.deepEqual(
        wantSources(town, copy).map((post) => post.id),
        [SNOW_POST],
      );
      // Aki read her copy: Ben's spoiler about his book opens for her.
      const spoiler = {
        ...bensPost("00000000-0000-4000-8000-0000000000e3", SNOW, "最後に…"),
        spoiler: true,
      };
      assert.equal(spoilerViewOf(town, spoiler), "open");
    },
  );

  await check(
    "a like on another reader's 便り is met as the reader's own book",
    () => {
      const { store } = akisStore();
      store.actions.toggleWish(SNOW);
      store.actions.toggleLike(SNOW_POST);
      const town = store.getSnapshot();
      const copy = copiesIn(town)[0].id;
      assert.deepEqual(
        townEncounters(town).map((met) => met.bookId),
        [copy],
      );
      assert.ok(!(SNOW in entriesOf(town)));
    },
  );

  await check(
    "through the database: the copy is made first, and no row names Ben's book",
    async () => {
      const book = (id: string, title: string, isbn: string | null) => ({
        id,
        isbn,
        title,
        author: "ベン",
        publisher: "",
        price: null,
        source: "manual",
        work_id: "w" + id.slice(1),
        created_at: at,
        updated_at: at,
      });
      const post = (id: string, book_id: string) => ({
        id,
        author_id: BEN,
        body: "よかった。",
        book_id,
        spoiler: false,
        spoiler_folded: false,
        parent_id: null,
        reading_mode: null,
        created_at: at,
      });
      const profile = (id: string, handle: string) => ({
        id,
        handle,
        name: handle,
        bio: "",
        color: "#768281",
        links: [],
        compose_icon: "pen",
        reading_visibility: "private",
        nine_version: 0,
        published: true,
        created_at: at,
        updated_at: at,
      });
      const db = fakeSupabase(AKI, {
        profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
        books: [book(SNOW, "雪の夜話", null)],
        posts: [post(SNOW_POST, SNOW)],
        my_books: [],
      });
      const missed: string[] = [];
      const store = createTownStore(
        accountTownBackend(db.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
        }),
        undefined,
        {
          onMissed: (lost) => {
            const line = townMissedLine(lost, AKI);
            if (line) missed.push(line);
            return line;
          },
        },
      );
      store.initialize();
      assert.equal(await settled(store), "saved");
      assert.equal(bookById(store.getSnapshot().books, SNOW)?.theirs, true);
      store.actions.toggleWish(SNOW);
      assert.equal(await settled(store), "saved");
      const copy = db.tables.my_books[0]?.id as string | undefined;
      assert.ok(copy && copy !== SNOW);
      assert.equal(db.writes[0].op, "rpc");
      assert.deepEqual(
        db.tables.book_marks?.map((row) => [row.book_id, row.kind]),
        [[copy, "wish"]],
      );
      assert.ok(
        !JSON.stringify(db.tables.library_entries ?? []).includes(SNOW),
      );
      // Read again, Aki's town has her copy as hers, and Ben's book as his.
      store.use(
        accountTownBackend(db.client, AKI, { delay: 0, storage: false }),
      );
      assert.equal(await settled(store), "saved");
      const again = store.getSnapshot();
      assert.deepEqual(again.wishlist, [copy]);
      assert.equal(bookById(again.books, copy)?.copyOf, SNOW);
      assert.equal(bookById(again.books, SNOW)?.theirs, true);

      // A copy the database turns away is told, and nothing else of it
      // is saved.
      db.refuse = (write) =>
        write.op === "rpc" && write.table === "books"
          ? { status: 404, code: "P0002", message: "no book has that id" }
          : null;
      db.tables.books.push(book(STARS, "星の継承", STARS_ISBN));
      db.tables.posts.push(post(STARS_POST, STARS));
      store.use(
        accountTownBackend(db.client, AKI, {
          delay: 0,
          retryDelays: [10],
          storage: false,
        }),
      );
      assert.equal(await settled(store), "saved");
      store.actions.toggleFavorite(STARS);
      assert.equal(await settled(store), "recovered");
      assert.equal(db.tables.my_books.length, 1);
      assert.ok(
        !JSON.stringify([
          db.tables.book_marks,
          db.tables.library_entries,
        ]).includes(STARS),
      );
      assert.match(missed.join("\n"), /本の登録/);
    },
  );

  await check(
    "a screen asks the reader's lists about a book it shows through holds",
    () => {
      // A book on screen may be one another reader typed in: the reader's
      // lists name their copy of it (holds, mine), never the book itself.
      const root = path.resolve(__dirname, "..");
      const asked = readdirSync(path.join(root, "src/components"), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .flatMap((entry) => {
          const file = path.join(entry.parentPath, entry.name);
          const text = readFileSync(file, "utf8");
          return [
            ...text.matchAll(
              /\b(?:wishlist|favorites|library|finishedBooks|lifeNine)\.includes\(\s*book\.id\s*\)/g,
            ),
          ].map(
            (match) =>
              `${path.relative(root, file)}:${text.slice(0, match.index).split("\n").length}`,
          );
        });
      assert.deepEqual(asked, []);
    },
  );

  // A book a page read that the town does not hold (found-books.ts).
  await foundBookChecks(check);

  console.log(`${passed} own book checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
