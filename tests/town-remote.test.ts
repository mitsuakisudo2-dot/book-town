import assert from "node:assert/strict";
import type { Tables } from "../src/lib/supabase/database.types";
import {
  cleanShelves,
  emptyTown,
  placementKey,
  planWrites,
  referencedBookIds,
  townFromRows,
  type RemoteIds,
  type RemoteRows,
  type ShopRow,
  type Write,
} from "../src/lib/town-remote";
import {
  ME_ID,
  OWN_SHOP_ID,
  popReactionKey,
  type TownState,
} from "../src/lib/types";

// Checks, without a database, how the signed-in town is built from rows and
// what is written back. Everything runs inside main() because tsx compiles this
// file as CommonJS.

const AKI = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const AKI_SHOP = "00000000-0000-4000-8000-0000000000a5";
const BEN_SHOP = "00000000-0000-4000-8000-0000000000b5";
const BOOK = "00000000-0000-4000-8000-000000000b01";
const OTHER_BOOK = "00000000-0000-4000-8000-000000000b02";
const ids: RemoteIds = { userId: AKI, shopId: AKI_SHOP };
const at = "2026-10-12T09:00:00Z";

const profile = (id: string, handle: string): Tables<"profiles"> => ({
  id,
  handle,
  name: handle.toUpperCase(),
  bio: "",
  color: "#768281",
  links: [],
  compose_icon: "pen",
  created_at: at,
  updated_at: at,
});

const book = (id: string, createdBy: string | null): Tables<"books"> => ({
  id,
  isbn: null,
  title: "華氏451度",
  author: "レイ・ブラッドベリ",
  publisher: "",
  price: null,
  source: "manual",
  created_by: createdBy,
  created_at: at,
  updated_at: at,
});

const shelf = (id: string, isPublic: boolean, bookId = BOOK) => ({
  id,
  name: isPublic ? "旅" : "秘密の棚",
  capacity: 20,
  isPublic,
  items: [{ id: id + "-item", bookId, display: "spine", pop: "好き" }],
});

const shop = (
  id: string,
  owner: string,
  extra: Partial<ShopRow> = {},
): ShopRow => ({
  id,
  owner_id: owner,
  name: owner === AKI ? "夜の本屋" : "朝の本屋",
  description: "",
  tagline: "",
  theme: "sage",
  is_open: true,
  public_shelves: [],
  ...extra,
});

const post = (
  id: string,
  author: string,
  extra: Partial<Tables<"posts">> = {},
): Tables<"posts"> => ({
  id,
  author_id: author,
  body: "炎の色が忘れられない。",
  book_id: null,
  spoiler: false,
  parent_id: null,
  reading_mode: null,
  created_at: at,
  ...extra,
});

function rows(extra: Partial<RemoteRows> = {}): RemoteRows {
  return {
    profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
    nine: [],
    books: [book(BOOK, AKI), book(OTHER_BOOK, BEN)],
    shops: [],
    ownShelves: [],
    ownShopFollowers: 0,
    follows: [],
    marks: [],
    posts: [],
    postReactions: [],
    spoilerReports: [],
    popReactions: [],
    sessions: [],
    seenNotifications: [],
    ...extra,
  };
}

const kinds = (writes: Write[]) =>
  writes.map((write) =>
    write.kind === "add" || write.kind === "remove"
      ? write.kind + ":" + write.table
      : write.kind,
  );

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check("the signed-in person and their shop get the usual ids", () => {
    const town = townFromRows(
      rows({
        shops: [
          shop(AKI_SHOP, AKI, { is_open: false }),
          shop(BEN_SHOP, BEN, {
            public_shelves: [shelf("s1", true, OTHER_BOOK)],
          }),
        ],
        ownShelves: [shelf("s1", true), shelf("s2", false)],
        ownShopFollowers: 3,
      }),
      ids,
    );
    assert.equal(town.me.id, ME_ID);
    assert.equal(town.me.handle, "aki");
    assert.equal(town.ownShop?.id, OWN_SHOP_ID);
    assert.equal(town.ownShop?.ownerId, ME_ID);
    assert.equal(town.ownShop?.followers, 3);
    assert.deepEqual(
      town.ownShop?.shelves.map((entry) => entry.isPublic),
      [true, false],
    );
    assert.deepEqual(
      town.shops.map((entry) => [entry.id, entry.ownerId, entry.demo]),
      [[BEN_SHOP, BEN, false]],
    );
    assert.deepEqual(
      town.readers.map((reader) => reader.id),
      [BEN],
    );
  });

  await check("closed shops and shops of unknown owners stay out", () => {
    const town = townFromRows(
      rows({
        shops: [
          shop(BEN_SHOP, BEN, { is_open: false }),
          shop("00000000-0000-4000-8000-0000000000c5", "nobody"),
        ],
      }),
      ids,
    );
    assert.deepEqual(town.shops, []);
  });

  await check("only the owner learns how many follow a shop", () => {
    const town = townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN)],
        follows: [{ shop_id: BEN_SHOP }],
        ownShopFollowers: 7,
      }),
      ids,
    );
    assert.deepEqual(town.following, [BEN_SHOP]);
    assert.equal(town.shops[0].followers, 0);
  });

  await check("other people's books carry no summary of their own", () => {
    const town = townFromRows(rows(), ids);
    const mine = town.books.find((entry) => entry.id === BOOK);
    const theirs = town.books.find((entry) => entry.id === OTHER_BOOK);
    assert.notEqual(mine?.summary, theirs?.summary);
    assert.match(theirs?.summary ?? "", /あらすじは登録されていません/);
  });

  await check("posts: own ones are 'me', counts only on own posts", () => {
    const reply = post("00000000-0000-4000-8000-0000000000e2", BEN, {
      parent_id: "00000000-0000-4000-8000-0000000000e1",
      created_at: "2026-10-12T10:00:00Z",
    });
    const town = townFromRows(
      rows({
        posts: [
          reply,
          post("00000000-0000-4000-8000-0000000000e1", AKI),
          // A reply to a post that is not in the town is left out.
          post("00000000-0000-4000-8000-0000000000e3", BEN, {
            parent_id: "00000000-0000-4000-8000-0000000000ff",
          }),
        ],
        postReactions: [
          {
            user_id: BEN,
            post_id: "00000000-0000-4000-8000-0000000000e1",
            kind: "like",
            created_at: at,
          },
          {
            user_id: AKI,
            post_id: reply.id,
            kind: "want",
            created_at: at,
          },
        ],
      }),
      ids,
    );
    assert.deepEqual(
      town.posts.map((entry) => [entry.authorId, entry.likes]),
      [
        [ME_ID, 1],
        [BEN, 0],
      ],
    );
    assert.deepEqual(town.wantedPosts, [reply.id]);
    assert.deepEqual(town.likedPosts, []);
  });

  await check("a POP reaction comes back only for a public placement", () => {
    const town = townFromRows(
      rows({
        shops: [
          shop(BEN_SHOP, BEN, {
            public_shelves: [shelf("s1", true, OTHER_BOOK)],
          }),
        ],
        popReactions: [
          {
            user_id: AKI,
            shop_id: BEN_SHOP,
            placement_key: placementKey("s1", "s1-item"),
            reaction: "love",
            created_at: at,
          },
          {
            user_id: AKI,
            shop_id: BEN_SHOP,
            placement_key: placementKey("s9", "gone"),
            reaction: "love",
            created_at: at,
          },
        ],
      }),
      ids,
    );
    assert.deepEqual(town.popReactions, {
      [popReactionKey(BEN_SHOP, "s1", "s1-item")]: ["love"],
    });
  });

  await check("bad shelves from someone else's shop are dropped", () => {
    const known = new Set([BOOK]);
    const shelves = cleanShelves(
      [
        shelf("s1", true),
        shelf("s1", true), // the same id twice
        { ...shelf("s2", true), capacity: 0 },
        { ...shelf("s3", true), items: "not a list" },
        {
          ...shelf("s4", true),
          capacity: 4,
          items: [
            { id: "a", bookId: BOOK, display: "face", pop: "" },
            { id: "b", bookId: BOOK, display: "spine", pop: "" }, // same book again
            { id: "c", bookId: "unknown", display: "spine", pop: "" },
            { id: "d", bookId: BOOK, display: "sideways", pop: "" },
          ],
        },
        "not a shelf",
      ],
      known,
    );
    assert.deepEqual(
      shelves.map((entry) => [entry.id, entry.items.map((item) => item.id)]),
      [
        ["s1", ["s1-item"]],
        ["s4", ["a"]],
      ],
    );
    assert.deepEqual(cleanShelves({ not: "a list" }, known), []);
  });

  await check("every book a town points to is read", () => {
    const referenced = referencedBookIds({
      ...rows(),
      shops: [
        shop(BEN_SHOP, BEN, {
          public_shelves: [shelf("s1", true, OTHER_BOOK)],
        }),
      ],
      ownShelves: [shelf("s1", true)],
    });
    assert.deepEqual(referenced.sort(), [BOOK, OTHER_BOOK].sort());
  });

  const base = (): TownState =>
    townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN)],
        posts: [post("00000000-0000-4000-8000-0000000000e9", BEN)],
      }),
      ids,
    );

  await check("nothing changed, nothing is written", () => {
    assert.deepEqual(planWrites(base(), base(), ids), []);
  });

  await check("a new shop is created open, with every shelf", () => {
    const before = base();
    const next: TownState = {
      ...before,
      ownShop: {
        id: OWN_SHOP_ID,
        ownerId: ME_ID,
        name: "夜の本屋",
        description: "",
        tagline: "",
        theme: "ink",
        followers: 0,
        demo: false,
        shelves: cleanShelves(
          [shelf("s1", true), shelf("s2", false)],
          new Set([BOOK]),
        ),
      },
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), ["create-shop", "shelves"]);
    const create = writes[0] as Extract<Write, { kind: "create-shop" }>;
    assert.equal(create.row.id, AKI_SHOP);
    assert.equal(create.row.owner_id, AKI);
    assert.equal(create.row.is_open, true);
    const shelves = writes[1] as Extract<Write, { kind: "shelves" }>;
    assert.equal(shelves.shelves.length, 2);
  });

  await check("only the person's own posts are written, replies last", () => {
    const before = base();
    const parent = {
      id: "00000000-0000-4000-8000-0000000000f1",
      authorId: ME_ID,
      body: "読みはじめた。",
      bookId: null,
      spoiler: false,
      parentId: null,
      createdAt: at,
      likes: 0,
      wants: 0,
      readingMode: null,
    };
    const reply = {
      ...parent,
      id: "00000000-0000-4000-8000-0000000000f2",
      parentId: parent.id,
    };
    const next: TownState = {
      ...before,
      // Someone else's post changing on screen is never written.
      posts: [
        ...before.posts.map((entry) => ({ ...entry, likes: entry.likes + 1 })),
        reply,
        parent,
      ],
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), ["posts"]);
    const rowsWritten = (writes[0] as Extract<Write, { kind: "posts" }>).rows;
    assert.deepEqual(
      rowsWritten.map((row) => [row.id, row.author_id]),
      [
        [parent.id, AKI],
        [reply.id, AKI],
      ],
    );
    // The database dates posts itself.
    assert.equal("created_at" in rowsWritten[0], false);

    const deleted = planWrites(next, before, ids);
    assert.deepEqual(kinds(deleted), ["delete-posts"]);
  });

  await check("follows and marks become rows of their own tables", () => {
    const before = base();
    const next: TownState = {
      ...before,
      following: [BEN_SHOP],
      wishlist: [OTHER_BOOK],
      popReactions: {
        [popReactionKey(BEN_SHOP, "s1", "s1-item")]: ["like"],
      },
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), [
      "add:shop_follows",
      "add:book_marks",
      "add:pop_reactions",
    ]);
    assert.deepEqual((writes[0] as Extract<Write, { kind: "add" }>).rows, [
      { follower_id: AKI, shop_id: BEN_SHOP },
    ]);
    assert.deepEqual((writes[2] as Extract<Write, { kind: "add" }>).rows, [
      {
        user_id: AKI,
        shop_id: BEN_SHOP,
        placement_key: placementKey("s1", "s1-item"),
        reaction: "like",
      },
    ]);
    assert.deepEqual(kinds(planWrites(next, before, ids)), [
      "remove:shop_follows",
      "remove:book_marks",
      "remove:pop_reactions",
    ]);
  });

  await check("a running reading ends before the next one starts", () => {
    const running = {
      id: "00000000-0000-4000-8000-0000000000d1",
      bookId: BOOK,
      mode: "together" as const,
      startedAt: at,
      endedAt: null,
    };
    const before: TownState = { ...base(), readingSessions: [running] };
    const next: TownState = {
      ...before,
      readingSessions: [
        { ...running, endedAt: "2026-10-12T09:30:00Z" },
        {
          ...running,
          id: "00000000-0000-4000-8000-0000000000d2",
          startedAt: "2026-10-12T09:31:00Z",
        },
      ],
    };
    assert.deepEqual(kinds(planWrites(before, next, ids)), [
      "end-sessions",
      "sessions",
    ]);
  });

  await check(
    "the profile and the nine are written only when they change",
    () => {
      const before = base();
      const next: TownState = {
        ...before,
        me: {
          ...before.me,
          bio: "夜に本を読む。",
          lifeNine: [BOOK],
          nineNotes: { [BOOK]: "最初の一冊" },
        },
      };
      const writes = planWrites(before, next, ids);
      assert.deepEqual(kinds(writes), ["profile", "nine"]);
      assert.deepEqual(
        (writes[0] as Extract<Write, { kind: "profile" }>).patch,
        {
          bio: "夜に本を読む。",
        },
      );
      assert.deepEqual(writes[1], {
        kind: "nine",
        bookIds: [BOOK],
        notes: ["最初の一冊"],
      });
    },
  );

  await check("the empty town is the person's, with nothing in it", () => {
    const town = emptyTown({ handle: "aki" });
    assert.equal(town.me.id, ME_ID);
    assert.equal(town.me.handle, "aki");
    assert.equal(town.ownShop, null);
    assert.deepEqual(town.shops, []);
  });

  console.log(passed + " town sync checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
