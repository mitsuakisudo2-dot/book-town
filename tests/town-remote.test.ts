import assert from "node:assert/strict";
import type { Tables } from "../src/lib/supabase/database.types";
import {
  cleanShelves,
  emptyTown,
  placementKey,
  planWrites,
  referencedBookIds,
  townFromRows,
  type BookRow,
  type RemoteIds,
  type RemoteRows,
  type ShopRow,
  type Write,
} from "../src/lib/town-remote";
import { demoBooks, demoPosters, demoPosts, demoShops } from "../src/lib/data";
import type { Poster } from "../src/lib/posters";
import { isSampleBook, sampleBookRowId, withSamples } from "../src/lib/samples";
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
  reading_visibility: "private",
  created_at: at,
  updated_at: at,
});

const book = (id: string): BookRow => ({
  id,
  isbn: null,
  title: "華氏451度",
  author: "レイ・ブラッドベリ",
  publisher: "",
  price: null,
  source: "manual",
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
  public_scene_books: [],
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
  spoiler_folded: false,
  parent_id: null,
  reading_mode: null,
  created_at: at,
  ...extra,
});

function rows(extra: Partial<RemoteRows> = {}): RemoteRows {
  return {
    profiles: [profile(AKI, "aki"), profile(BEN, "ben")],
    nine: [],
    books: [book(BOOK), book(OTHER_BOOK)],
    shops: [],
    ownShelves: [],
    ownSceneBooks: [],
    ownShopFollowers: 0,
    ownShopVisitors: null,
    shopMessages: [],
    follows: [],
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

const posterRow = (
  id: string,
  author: string,
  extra: Partial<Tables<"posters">> = {},
): Tables<"posters"> => ({
  id,
  author_id: author,
  template: "lineup",
  theme: "navy",
  font: "mincho",
  pages: [
    {
      blocks: [
        { type: "heading", text: "夜の本" },
        { type: "books", book_ids: [BOOK, OTHER_BOOK] },
        { type: "text", text: "眠れない夜に。" },
      ],
    },
  ],
  spoiler: false,
  show_in_timeline: true,
  allow_display: true,
  status: "published",
  created_at: at,
  updated_at: at,
  ...extra,
});

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

  await check(
    "the owner hears how many stopped by, only when someone did",
    () => {
      const visited = (count: number) =>
        townFromRows(
          rows({
            shops: [shop(AKI_SHOP, AKI), shop(BEN_SHOP, BEN)],
            ownShopVisitors: { count, at },
          }),
          ids,
        );
      assert.deepEqual(visited(2).ownShop?.weekVisitors, { count: 2, at });
      assert.equal(visited(2).shops[0].weekVisitors, undefined);
      assert.equal("weekVisitors" in (visited(0).ownShop ?? {}), false);
    },
  );

  await check("other people's books carry no summary of their own", () => {
    // A reader's own registered books are the ones in their 登録 list; who
    // typed a book in is not something the database tells anyone.
    const town = townFromRows(
      rows({
        marks: [
          { user_id: AKI, book_id: BOOK, kind: "library", created_at: at },
          { user_id: AKI, book_id: OTHER_BOOK, kind: "wish", created_at: at },
        ],
      }),
      ids,
    );
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
            taps: 1,
            created_at: at,
          },
          {
            user_id: AKI,
            post_id: reply.id,
            kind: "want",
            taps: 1,
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
    // Books standing only in a store scene are read too.
    const inScenes = referencedBookIds({
      ...rows(),
      shops: [shop(BEN_SHOP, BEN, { public_scene_books: [OTHER_BOOK, 3] })],
      ownSceneBooks: [BOOK],
    });
    assert.deepEqual(inScenes.sort(), [BOOK, OTHER_BOOK].sort());
    // So are the books on posters.
    const onPosters = referencedBookIds({
      ...rows(),
      posters: [posterRow("00000000-0000-4000-8000-0000000000d1", BEN)],
    });
    assert.deepEqual(onPosters.sort(), [BOOK, OTHER_BOOK].sort());
  });

  await check("a store scene's books are known as used", () => {
    // A 見本's book by its own name; the owner's own scene, private books too.
    const sample = demoBooks[0].id;
    const town = townFromRows(
      rows({
        shops: [
          shop(AKI_SHOP, AKI),
          shop(BEN_SHOP, BEN, {
            public_scene_books: [
              OTHER_BOOK,
              3,
              sampleBookRowId(sample),
              "gone",
              OTHER_BOOK,
            ],
          }),
        ],
        ownSceneBooks: [BOOK],
      }),
      ids,
    );
    assert.deepEqual(town.shops[0].sceneBookIds, [OTHER_BOOK, sample]);
    assert.deepEqual(town.ownShop?.sceneBookIds, [BOOK]);
    // No scene, no field.
    const bare = townFromRows(rows({ shops: [shop(BEN_SHOP, BEN)] }), ids);
    assert.equal("sceneBookIds" in bare.shops[0], false);
  });

  await check("posters: own drafts come back, others' only once put up", () => {
    const MINE = "00000000-0000-4000-8000-0000000000d1";
    const BENS = "00000000-0000-4000-8000-0000000000d2";
    const BENS_DRAFT = "00000000-0000-4000-8000-0000000000d3";
    const GONE = "00000000-0000-4000-8000-0000000000d4";
    const BAD = "00000000-0000-4000-8000-0000000000d5";
    const town = townFromRows(
      rows({
        posters: [
          posterRow(MINE, AKI, { status: "draft", show_in_timeline: false }),
          posterRow(BENS, BEN, {
            template: "one_book",
            theme: "kosho",
            spoiler: true,
            pages: [
              {
                blocks: [
                  // A book the town cannot read leaves the page; the
                  // poster stays.
                  {
                    type: "books",
                    book_ids: ["00000000-0000-4000-8000-000000000bff"],
                  },
                  { type: "text", text: "最後の頁について" },
                  // A kind of block from a later version is passed over.
                  { type: "photo", photo_id: "x" },
                ],
              },
            ],
          }),
          posterRow(BENS_DRAFT, BEN, { status: "draft" }),
          // Someone the town does not know is left out.
          posterRow(GONE, "00000000-0000-4000-8000-00000000000c"),
          posterRow(BAD, BEN, { theme: "neon" }),
        ],
      }),
      ids,
    );
    assert.deepEqual(
      town.posters.map((entry) => entry.id),
      [MINE, BENS],
    );
    assert.deepEqual(town.posters[0], {
      id: MINE,
      authorId: ME_ID,
      template: "lineup",
      theme: "navy",
      font: "mincho",
      pages: [
        {
          heading: "夜の本",
          text: "眠れない夜に。",
          bookIds: [BOOK, OTHER_BOOK],
        },
      ],
      spoiler: false,
      inTimeline: false,
      status: "draft",
      createdAt: at,
      updatedAt: at,
    } satisfies Poster);
    assert.equal(town.posters[1].authorId, BEN);
    assert.equal(town.posters[1].spoiler, true);
    assert.deepEqual(town.posters[1].pages, [
      { heading: "", text: "最後の頁について", bookIds: [] },
    ]);
    // A visitor sees only what is put up.
    const visitor = townFromRows(
      rows({ posters: [posterRow(BENS_DRAFT, BEN, { status: "draft" })] }),
      { userId: null, shopId: "" },
    );
    assert.deepEqual(visitor.posters, []);
  });

  await check("words left at the shop reach its owner, newest first", () => {
    const town = townFromRows(
      rows({
        shopMessages: [
          { user_id: BEN, message: "また来ます", updated_at: at },
          {
            user_id: BEN,
            message: "   ",
            updated_at: "2026-10-12T11:00:00+00:00",
          },
          // Someone the town does not know (no profile to show) is left out.
          {
            user_id: "00000000-0000-4000-8000-00000000000c",
            message: "だれ？",
            updated_at: at,
          },
        ],
      }),
      ids,
    );
    assert.deepEqual(town.shopMessages, [
      { readerId: BEN, text: "また来ます", at },
    ]);
    assert.deepEqual(emptyTown().shopMessages, []);
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

  await check(
    "a post folded by readers comes in folded; marking it is written",
    () => {
      const town = townFromRows(
        rows({
          posts: [
            post("00000000-0000-4000-8000-0000000000e1", BEN, {
              spoiler_folded: true,
            }),
            // Once marked, it is simply a spoiler.
            post("00000000-0000-4000-8000-0000000000e2", AKI, {
              spoiler: true,
              spoiler_folded: true,
            }),
            post("00000000-0000-4000-8000-0000000000e3", AKI),
          ],
        }),
        ids,
      );
      assert.deepEqual(
        town.posts.map((entry) => [entry.id.slice(-2), entry.folded]),
        [
          ["e1", true],
          ["e2", undefined],
          ["e3", undefined],
        ],
      );

      const before = base();
      const mine = {
        id: "00000000-0000-4000-8000-0000000000f1",
        authorId: ME_ID,
        body: "最後の場面で泣いた。",
        bookId: "00000000-0000-4000-8000-0000000000b1",
        spoiler: false,
        folded: true,
        parentId: null,
        createdAt: at,
        likes: 0,
        wants: 0,
        readingMode: null,
      };
      const folded = { ...before, posts: [...before.posts, mine] };
      const marked = {
        ...folded,
        posts: [...before.posts, { ...mine, spoiler: true }],
      };
      assert.deepEqual(planWrites(folded, marked, ids), [
        { kind: "mark-spoilers", ids: [mine.id] },
      ]);
    },
  );

  await check("a like pressed again comes back with its count", () => {
    const ownPost = post("00000000-0000-4000-8000-0000000000e1", AKI);
    const benPost = post("00000000-0000-4000-8000-0000000000e2", BEN);
    const like = (user: string, postId: string, taps: number) => ({
      user_id: user,
      post_id: postId,
      kind: "like",
      taps,
      created_at: at,
    });
    const town = townFromRows(
      rows({
        posts: [ownPost, benPost],
        postReactions: [like(BEN, ownPost.id, 7), like(AKI, benPost.id, 3)],
      }),
      ids,
    );
    const mine = town.posts.find((entry) => entry.id === ownPost.id);
    assert.deepEqual(mine?.likers, [{ readerId: BEN, taps: 7, at }]);
    assert.equal(mine?.likes, 1);
    // Others' posts carry nobody's likes.
    assert.equal(
      town.posts.find((entry) => entry.id === benPost.id)?.likers,
      undefined,
    );
    assert.deepEqual(town.likedPosts, [benPost.id]);
    assert.deepEqual(town.likeTaps, { [benPost.id]: 3 });

    // A first like is added as a row, then its count is set.
    const before = townFromRows(rows({ posts: [ownPost, benPost] }), ids);
    const pressed = {
      ...before,
      likedPosts: [benPost.id],
      likeTaps: { [benPost.id]: 3 },
    };
    assert.deepEqual(kinds(planWrites(before, pressed, ids)), [
      "add:post_reactions",
      "like-taps",
    ]);
    const more = { ...pressed, likeTaps: { [benPost.id]: 4 } };
    assert.deepEqual(planWrites(pressed, more, ids), [
      { kind: "like-taps", rows: [{ post_id: benPost.id, taps: 4 }] },
    ]);
    // Pressed once, the row's own default is enough.
    const once = { ...before, likedPosts: [benPost.id] };
    assert.deepEqual(kinds(planWrites(before, once, ids)), [
      "add:post_reactions",
    ]);
    // Taking it back removes the row.
    assert.deepEqual(kinds(planWrites(more, before, ids)), [
      "remove:post_reactions",
    ]);
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

  const entry = (
    id: string,
    userId: string,
    extra: Partial<Tables<"reading_entries">> = {},
  ): Tables<"reading_entries"> => ({
    id,
    user_id: userId,
    book_id: BOOK,
    kind: "finished",
    body: "",
    feelings: ["quiet"],
    spoiler: false,
    is_public: true,
    created_at: at,
    updated_at: at,
    ...extra,
  });

  await check(
    "reading records: own ones always, others' only in public",
    () => {
      const town = townFromRows(
        rows({
          profiles: [
            { ...profile(AKI, "aki"), reading_visibility: "public" },
            profile(BEN, "ben"),
          ],
          records: [
            entry("00000000-0000-4000-8000-0000000000c1", AKI, {
              is_public: false,
              body: "  夜が長かった。 ",
              feelings: ["talk", "cried"],
            }),
            entry("00000000-0000-4000-8000-0000000000c2", BEN, {
              created_at: "2026-10-12T08:00:00Z",
            }),
            // Someone else's private record never reaches the screen.
            entry("00000000-0000-4000-8000-0000000000c3", BEN, {
              is_public: false,
            }),
            // Nor does a record of a book the town cannot show,
            entry("00000000-0000-4000-8000-0000000000c4", BEN, {
              book_id: "00000000-0000-4000-8000-000000000bff",
            }),
            // by someone it does not know,
            entry(
              "00000000-0000-4000-8000-0000000000c5",
              "00000000-0000-4000-8000-00000000000c",
            ),
            // or of a kind the screens do not read yet.
            entry("00000000-0000-4000-8000-0000000000c6", BEN, {
              kind: "opened",
            }),
          ],
        }),
        ids,
      );
      assert.deepEqual(
        town.readingRecords.map((record) => [record.id, record.readerId]),
        [
          ["00000000-0000-4000-8000-0000000000c2", BEN],
          ["00000000-0000-4000-8000-0000000000c1", ME_ID],
        ],
      );
      const own = town.readingRecords[1];
      assert.equal(own.note, "夜が長かった。");
      assert.deepEqual(own.feelings, ["cried", "talk"]);
      assert.equal(own.isPublic, false);
      assert.equal(town.settings.readingPublic, true);
      assert.equal(townFromRows(rows(), ids).settings.readingPublic, false);
      assert.deepEqual(
        referencedBookIds(
          rows({
            records: [
              entry("00000000-0000-4000-8000-0000000000c7", BEN, {
                book_id: OTHER_BOOK,
              }),
            ],
          }),
        ),
        [OTHER_BOOK],
      );
    },
  );

  await check("own reading records are added, rewritten and removed", () => {
    const before = base();
    const record = {
      id: "00000000-0000-4000-8000-0000000000c8",
      readerId: ME_ID,
      bookId: BOOK,
      feelings: ["warm" as const],
      note: "",
      spoiler: false,
      isPublic: true,
      createdAt: at,
    };
    const others = {
      ...record,
      id: "00000000-0000-4000-8000-0000000000c9",
      readerId: BEN,
    };
    const added: TownState = {
      ...before,
      readingRecords: [record, others],
      settings: { ...before.settings, readingPublic: true },
    };
    const writes = planWrites(before, added, ids);
    assert.deepEqual(kinds(writes), ["profile", "records"]);
    assert.deepEqual((writes[0] as Extract<Write, { kind: "profile" }>).patch, {
      reading_visibility: "public",
    });
    // Someone else's record on screen is never written, and the database
    // dates the new one itself.
    assert.deepEqual((writes[1] as Extract<Write, { kind: "records" }>).rows, [
      {
        id: record.id,
        user_id: AKI,
        book_id: BOOK,
        kind: "finished",
        body: "",
        feelings: ["warm"],
        spoiler: false,
        is_public: true,
      },
    ]);

    const rewritten: TownState = {
      ...added,
      readingRecords: [
        { ...record, note: "また読む", isPublic: false },
        { ...others, note: "変わった" },
      ],
    };
    assert.deepEqual(planWrites(added, rewritten, ids), [
      {
        kind: "update-record",
        id: record.id,
        patch: {
          body: "また読む",
          feelings: ["warm"],
          spoiler: false,
          is_public: false,
        },
      },
    ]);
    assert.deepEqual(
      planWrites(added, { ...added, readingRecords: [others] }, ids),
      [{ kind: "delete-records", ids: [record.id] }],
    );
  });

  await check("own posters are made, changed and taken down", () => {
    const before = base();
    const poster: Poster = {
      id: "00000000-0000-4000-8000-0000000000d6",
      authorId: ME_ID,
      template: "one_book",
      theme: "kinari",
      font: "mincho",
      pages: [{ heading: "", text: "ずっと手元に。", bookIds: [BOOK] }],
      spoiler: false,
      inTimeline: true,
      status: "draft",
      createdAt: at,
      updatedAt: at,
    };
    const others: Poster = {
      ...poster,
      id: "00000000-0000-4000-8000-0000000000d7",
      authorId: BEN,
    };
    const made: TownState = { ...before, posters: [poster, others] };
    // Someone else's poster on screen is never written; the database dates
    // the new one itself.
    assert.deepEqual(planWrites(before, made, ids), [
      {
        kind: "posters",
        rows: [
          {
            id: poster.id,
            author_id: AKI,
            template: "one_book",
            theme: "kinari",
            font: "mincho",
            pages: [
              {
                blocks: [
                  { type: "books", book_ids: [BOOK] },
                  { type: "text", text: "ずっと手元に。" },
                ],
              },
            ],
            spoiler: false,
            show_in_timeline: true,
            status: "draft",
          },
        ],
      },
    ]);
    const putUp: TownState = {
      ...made,
      posters: [
        { ...poster, status: "published", theme: "navy", updatedAt: "later" },
        { ...others, theme: "sumi" },
      ],
    };
    const writes = planWrites(made, putUp, ids);
    assert.deepEqual(kinds(writes), ["update-poster"]);
    assert.deepEqual(
      (writes[0] as Extract<Write, { kind: "update-poster" }>).patch,
      {
        template: "one_book",
        theme: "navy",
        font: "mincho",
        pages: [
          {
            blocks: [
              { type: "books", book_ids: [BOOK] },
              { type: "text", text: "ずっと手元に。" },
            ],
          },
        ],
        spoiler: false,
        show_in_timeline: true,
        status: "published",
      },
    );
    assert.deepEqual(
      planWrites(putUp, { ...putUp, posters: [putUp.posters[1]] }, ids),
      [{ kind: "delete-posters", ids: [poster.id] }],
    );
  });

  await check("the empty town is the person's, with nothing in it", () => {
    const town = emptyTown({ handle: "aki" });
    assert.equal(town.me.id, ME_ID);
    assert.equal(town.me.handle, "aki");
    assert.equal(town.ownShop, null);
    assert.deepEqual(town.shops, []);
  });

  await check("a visitor sees every open shop, and owns none", () => {
    const town = townFromRows(
      rows({
        shops: [shop(AKI_SHOP, AKI), shop(BEN_SHOP, BEN, { is_open: false })],
        posts: [post("00000000-0000-4000-8000-0000000000f1", AKI)],
      }),
      { userId: null, shopId: "" },
    );
    assert.equal(town.me.name, "ゲスト");
    assert.equal(town.ownShop, null);
    assert.deepEqual(
      town.shops.map((entry) => [entry.id, entry.ownerId]),
      [[AKI_SHOP, AKI]],
    );
    assert.deepEqual(
      town.readers.map((reader) => reader.id),
      [AKI, BEN],
    );
    assert.equal(town.posts[0].authorId, AKI);
    // Nobody's book is the visitor's own, so none shows its own summary.
    assert.ok(
      town.books
        .filter((entry) => !isSampleBook(entry.id))
        .every((entry) => entry.summary.startsWith("読書家が")),
    );
  });

  await check("見本 joins the real town, and the real one wins", () => {
    const real = townFromRows(
      rows({
        shops: [shop(BEN_SHOP, BEN), shop(demoShops[0].id, AKI)],
      }),
      { userId: null, shopId: "" },
    );
    const town = withSamples(real);
    const ids = town.shops.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
      town.shops.find((entry) => entry.id === demoShops[0].id)?.demo,
      false,
    );
    assert.ok(town.shops.some((entry) => entry.demo));
    assert.equal(town.posts.length, real.posts.length + demoPosts.length);
    assert.deepEqual(
      town.posts.map((entry) => entry.createdAt),
      town.posts
        .map((entry) => entry.createdAt)
        .sort((a, b) => Date.parse(a) - Date.parse(b)),
    );
    // The samples are copies: changing the town never changes the demo data.
    town.shops[town.shops.length - 1].name = "変えた";
    assert.notEqual(demoShops.at(-1)?.name, "変えた");
  });

  await check(
    "a signed-in reader keeps a 見本's book, under its database id",
    () => {
      const SOLARIS = demoBooks[0].id;
      const row = sampleBookRowId(SOLARIS);
      assert.match(
        row,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      assert.equal(sampleBookRowId(SOLARIS), row);
      const before = withSamples(townFromRows(rows(), ids));
      const wished = { ...before, wishlist: [...before.wishlist, SOLARIS] };
      const writes = planWrites(before, wished, ids);
      // The catalog row is written first, by the reader, under the shared id.
      assert.deepEqual(kinds(writes), ["books", "add:book_marks"]);
      assert.deepEqual(writes[0], {
        kind: "books",
        rows: [
          {
            id: row,
            title: demoBooks[0].title,
            author: demoBooks[0].author,
            source: "manual",
            created_by: AKI,
          },
        ],
      });
      assert.deepEqual((writes[1] as Extract<Write, { kind: "add" }>).rows, [
        { user_id: AKI, book_id: row, kind: "wish" },
      ]);
      // Read back, it is the 見本's book again, whatever its row says.
      const again = townFromRows(
        rows({
          books: [
            ...rows().books,
            { ...book(row), title: "別の題", author: "誰か" },
          ],
          marks: [{ user_id: AKI, book_id: row, kind: "wish", created_at: at }],
        }),
        ids,
      );
      assert.deepEqual(again.wishlist, [SOLARIS]);
      assert.equal(
        again.books.find((entry) => entry.id === SOLARIS)?.title,
        demoBooks[0].title,
      );
      assert.equal(
        again.books.some((entry) => entry.id === row),
        false,
      );
      // Taking it back removes the mark and leaves the catalog alone.
      assert.deepEqual(planWrites(wished, before, ids), [
        {
          kind: "remove",
          table: "book_marks",
          rows: [{ user_id: AKI, book_id: row, kind: "wish" }],
        },
      ]);
    },
  );

  await check(
    "a poster with a 見本's book keeps the book under its database id",
    () => {
      const SOLARIS = demoBooks[0].id;
      const before = withSamples(townFromRows(rows(), ids));
      // The 見本's own posters are shown, and never written.
      assert.ok(
        demoPosters.every((entry) =>
          before.posters.some((shown) => shown.id === entry.id),
        ),
      );
      const poster: Poster = {
        id: "00000000-0000-4000-8000-0000000000d8",
        authorId: ME_ID,
        template: "lineup",
        theme: "navy",
        font: "gothic",
        pages: [{ heading: "星の本", text: "", bookIds: [SOLARIS, BOOK] }],
        spoiler: false,
        inTimeline: true,
        status: "published",
        createdAt: at,
        updatedAt: at,
      };
      const next = { ...before, posters: [...before.posters, poster] };
      const writes = planWrites(before, next, ids);
      assert.deepEqual(kinds(writes), ["books", "posters"]);
      assert.deepEqual(
        (writes[0] as Extract<Write, { kind: "books" }>).rows.map(
          (row) => row.id,
        ),
        [sampleBookRowId(SOLARIS)],
      );
      assert.deepEqual(
        (writes[1] as Extract<Write, { kind: "posters" }>).rows[0].pages,
        [
          {
            blocks: [
              { type: "heading", text: "星の本" },
              { type: "books", book_ids: [sampleBookRowId(SOLARIS), BOOK] },
            ],
          },
        ],
      );
      // Read back, the poster shows the 見本's book again.
      const again = townFromRows(
        rows({
          posters: [
            posterRow(poster.id, AKI, {
              pages: (writes[1] as Extract<Write, { kind: "posters" }>).rows[0]
                .pages,
            }),
          ],
        }),
        ids,
      );
      assert.deepEqual(again.posters[0].pages[0].bookIds, [SOLARIS, BOOK]);
    },
  );

  await check("nothing is written toward a 見本's shop or post", () => {
    const before = withSamples(townFromRows(rows(), ids));
    const post = demoPosts.find((entry) => entry.bookId)!;
    const next: TownState = {
      ...before,
      following: [demoShops[0].id],
      likedPosts: [post.id],
      // Wanting the book of a 見本's post still keeps the book.
      wantedPosts: [post.id],
      wishlist: [post.bookId!],
    };
    const writes = planWrites(before, next, ids);
    assert.deepEqual(kinds(writes), ["books", "add:book_marks"]);
    assert.deepEqual((writes[1] as Extract<Write, { kind: "add" }>).rows, [
      { user_id: AKI, book_id: sampleBookRowId(post.bookId!), kind: "wish" },
    ]);
  });

  await check("folds by reports arrive under the town's own names", () => {
    const town = townFromRows(
      rows({
        shops: [shop(AKI_SHOP, AKI), shop("shop-ben", BEN)],
        folds: [
          { target_kind: "post", target_id: "p1", state: "folded", since: at },
          { target_kind: "post", target_id: "p2", state: "held", since: at },
          {
            target_kind: "profile",
            target_id: AKI,
            state: "folded",
            since: at,
          },
          {
            target_kind: "profile",
            target_id: BEN,
            state: "folded",
            since: at,
          },
          {
            target_kind: "shop",
            target_id: AKI_SHOP,
            state: "folded",
            since: at,
          },
          {
            target_kind: "shop",
            target_id: "shop-ben",
            state: "folded",
            since: at,
          },
          { target_kind: "poster", target_id: "x1", state: "held", since: at },
          // Unknown kinds and states are left alone.
          { target_kind: "book", target_id: BOOK, state: "folded", since: at },
          { target_kind: "post", target_id: "p3", state: "gone", since: at },
        ],
      }),
      ids,
    );
    assert.deepEqual(
      Object.keys(town.reviewFolds).sort(),
      [
        "post:p1",
        "post:p2",
        "poster:x1",
        "profile:" + BEN,
        "profile:" + ME_ID,
        "shop:" + OWN_SHOP_ID,
        "shop:shop-ben",
      ].sort(),
    );
    assert.deepEqual(town.reviewFolds["post:p2"], { state: "held", since: at });
  });

  await check("the reader's own reports and spoiler setting are read", () => {
    const report = (id: string, created: string, extra = {}) => ({
      id,
      target_kind: "post",
      target_id: "p1",
      reason: "harassment",
      progress: "open",
      created_at: created,
      status_at: created,
      ...extra,
    });
    const town = townFromRows(
      rows({
        myReports: [
          report("r1", "2026-10-10T00:00:00Z"),
          report("r2", "2026-10-12T00:00:00Z", { progress: "checking" }),
          report("r3", "2026-10-11T00:00:00Z", { reason: "spoiler" }),
          report("r4", "2026-10-11T00:00:00Z", { progress: "lost" }),
          // Never the operator's own words for which way it went.
          report("r5", "2026-10-09T00:00:00Z", { progress: "checked" }),
          report("r6", "2026-10-09T00:00:00Z", { progress: "resolved" }),
        ],
        readerSettings: { spoiler_display: "leave_out" },
      }),
      ids,
    );
    assert.deepEqual(
      town.myReports.map((entry) => entry.id + ":" + entry.status),
      ["r2:checking", "r3:open", "r1:open", "r5:checked"],
    );
    assert.equal(town.settings.spoilerDisplay, "leave_out");
    // No row, or one it does not know: folded when possible.
    assert.equal(
      townFromRows(rows(), ids).settings.spoilerDisplay,
      "fold_possible",
    );
    assert.equal(
      townFromRows(rows({ readerSettings: { spoiler_display: "x" } }), ids)
        .settings.spoilerDisplay,
      "fold_possible",
    );
    const empty = emptyTown();
    assert.equal(empty.settings.spoilerDisplay, "fold_possible");
    assert.equal(empty.settings.readingPublic, false);
    assert.deepEqual(empty.reviewFolds, {});
    assert.deepEqual(empty.myReports, []);
  });

  await check("the spoiler setting is written only when it changes", () => {
    const before = townFromRows(rows(), ids);
    const next: TownState = {
      ...before,
      settings: { ...before.settings, spoilerDisplay: "show_all" },
      // Folds and reports are the database's; nothing is written for them.
      reviewFolds: { "post:p1": { state: "folded", since: at } },
      myReports: [
        {
          id: "r1",
          kind: "post",
          targetId: "p1",
          reason: "spam",
          status: "open",
          createdAt: at,
          statusAt: at,
        },
      ],
    };
    assert.deepEqual(planWrites(before, next, ids), [
      {
        kind: "reader-settings",
        row: { user_id: AKI, spoiler_display: "show_all" },
      },
    ]);
    assert.deepEqual(
      planWrites(before, { ...next, settings: before.settings }, ids),
      [],
    );
  });

  console.log(passed + " town sync checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
