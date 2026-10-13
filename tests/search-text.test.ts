import assert from "node:assert/strict";
import { seedState } from "../src/lib/data";
import {
  byMatch,
  readTextQuery,
  sameText,
  textMatch,
  textMatches,
  TEXT_MATCH,
} from "../src/lib/search/text";
import {
  findReaders,
  findShops,
  publicStock,
  shopMatcher,
} from "../src/lib/search/town";
import { nearHeading, searchBooks, surePick } from "../src/lib/search/rank";
import { popularTags, postsWithTag, suggestTags } from "../src/lib/tags";
import type { Post, Reader, TownState } from "../src/lib/types";

// Readers, shops and tags are found the way books are (docs: search design
// §3, §7 PR-2): the same fold for kana and katakana, width, long vowels and
// old kanji, romaji read as kana, each field on its own, and no counts.
// Everything runs inside main() because tsx compiles this file as CommonJS.

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  console.log("PASS " + name);
}

const match = (query: string, fields: string[]) =>
  textMatch(readTextQuery(query), fields);

const names = (list: { name: string }[]) => list.map((entry) => entry.name);

function post(id: string, body: string, extra: Partial<Post> = {}): Post {
  return {
    ...seedState.posts[0],
    id,
    body,
    parentId: null,
    readingMode: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

async function main() {
  await check("nothing searchable typed is no query", () => {
    assert.equal(readTextQuery(""), null);
    assert.equal(readTextQuery("   "), null);
    assert.equal(readTextQuery("・！？"), null);
    assert.equal(textMatch(null, ["すみれ"]), TEXT_MATCH.none);
    assert.equal(textMatches("", ["すみれ"]), false);
  });

  await check(
    "kana, katakana, width, long vowels and old kanji fold alike",
    () => {
      assert.equal(match("スミレ", ["すみれ"]), TEXT_MATCH.exact);
      assert.equal(match("ｽﾐﾚ", ["すみれ"]), TEXT_MATCH.exact);
      assert.equal(match("ＳＵＭＩＲＥ", ["sumire"]), TEXT_MATCH.exact);
      assert.equal(match("Sumire", ["sumire"]), TEXT_MATCH.exact);
      assert.equal(match("ユーキ", ["ゆうき"]), TEXT_MATCH.exact);
      assert.equal(match("國語", ["国語の本屋"]), TEXT_MATCH.start);
      assert.equal(match("ヴァイオリン", ["バイオリン堂"]), TEXT_MATCH.start);
    },
  );

  await check("romaji is read as kana, and still matched as written", () => {
    assert.equal(match("sumire", ["すみれ"]), TEXT_MATCH.exact);
    assert.equal(match("haru", ["はる"]), TEXT_MATCH.exact);
    assert.equal(match("shiori", ["しおり"]), TEXT_MATCH.exact);
    assert.equal(match("siori", ["栞", "しおり"]), TEXT_MATCH.exact);
    // Latin that is not romaji stays as written.
    assert.equal(match("SF", ["SFの棚"]), TEXT_MATCH.start);
    // A syllable still being typed may only begin a field.
    assert.equal(match("sumir", ["すみれ"]), TEXT_MATCH.start);
    assert.equal(match("mir", ["すみれ"]), TEXT_MATCH.none);
    assert.equal(match("mir", ["sumire"]), TEXT_MATCH.within);
  });

  await check(
    "a last n may still be the start of な, の or に being typed",
    () => {
      // "an" is あん, and also あ before an n-row kana, as in the book search.
      assert.equal(match("an", ["あなた"]), TEXT_MATCH.start);
      assert.equal(match("kan", ["かなこ"]), TEXT_MATCH.start);
      assert.equal(match("min", ["みなみ"]), TEXT_MATCH.start);
      assert.equal(match("kan", ["かんな"]), TEXT_MATCH.start);
      assert.equal(match("kan", ["かん"]), TEXT_MATCH.exact);
      // Only an n-row kana may follow, and something must.
      assert.equal(match("kan", ["かもめ"]), TEXT_MATCH.none);
      assert.equal(match("kan", ["か"]), TEXT_MATCH.none);
      assert.equal(match("an", ["はなこ"]), TEXT_MATCH.none);
      // Typed one letter at a time, a reader never drops out at the n.
      const reader = (id: string, name: string, handle: string): Reader => ({
        ...seedState.readers[0],
        id,
        name,
        handle,
      });
      const town: TownState = {
        ...seedState,
        readers: [
          ...seedState.readers,
          reader("r-kanako", "かなこ", "booklover"),
          reader("r-minami", "みなみ", "south_wind"),
        ],
      };
      for (const [typed, name] of [
        ["a", "あなた"],
        ["an", "あなた"],
        ["ana", "あなた"],
        ["ka", "かなこ"],
        ["kan", "かなこ"],
        ["kana", "かなこ"],
        ["mi", "みなみ"],
        ["min", "みなみ"],
        ["mina", "みなみ"],
      ])
        assert.ok(names(findReaders(town, typed)).includes(name), typed);
    },
  );

  await check(
    "one kana begins a field; two, or one kanji, may be anywhere",
    () => {
      assert.equal(match("す", ["すみれ"]), TEXT_MATCH.start);
      assert.equal(match("み", ["すみれ"]), TEXT_MATCH.none);
      assert.equal(match("みれ", ["すみれ"]), TEXT_MATCH.within);
      assert.equal(match("翻", ["雨と翻訳"]), TEXT_MATCH.within);
    },
  );

  await check("each field on its own: a query never runs across two", () => {
    assert.equal(match("と翻", ["雨と翻訳"]), TEXT_MATCH.within);
    assert.equal(match("と翻", ["雨と", "翻訳"]), TEXT_MATCH.none);
    assert.equal(match("雨と翻訳", ["雨と", "翻訳"]), TEXT_MATCH.none);
    // Several words may each be found in a field of their own.
    assert.equal(match("雨 翻訳", ["雨と翻訳"]), TEXT_MATCH.within);
    assert.equal(match("凪 軌道", ["軌道書房", "凪"]), TEXT_MATCH.within);
    assert.equal(match("凪 銀河", ["軌道書房", "凪"]), TEXT_MATCH.none);
  });

  await check(
    "closest first, equals in the order given, misses left out",
    () => {
      const list = ["すみれ堂", "すみれ", "野のすみれ", "あおい", "すみれ書房"];
      assert.deepEqual(
        byMatch(list, (text) => match("すみれ", [text])),
        ["すみれ", "すみれ堂", "すみれ書房", "野のすみれ"],
      );
    },
  );

  await check("tags are the same once folded", () => {
    assert.ok(sameText("ホラー", "ほらー"));
    assert.ok(sameText("ＳＦ", "sf"));
    assert.ok(sameText("寝る前の一冊", "寝る前の一冊"));
    assert.ok(!sameText("寝る前", "寝る前の一冊"));
    // A tag of marks alone is compared as written.
    assert.ok(sameText("ー・", "ー・"));
    assert.ok(!sameText("ー・", "・"));
  });

  await check("readers by name or @ID, in kana, katakana or romaji", () => {
    assert.deepEqual(names(findReaders(seedState, "スミレ")), ["すみれ"]);
    assert.deepEqual(names(findReaders(seedState, "sumire")), ["すみれ"]);
    assert.deepEqual(names(findReaders(seedState, "ＨＡＲＵ")), ["はる"]);
    assert.deepEqual(names(findReaders(seedState, "ハル")), ["はる"]);
    assert.deepEqual(names(findReaders(seedState, "凪")), ["凪"]);
    // @ looks at IDs only, in either width.
    assert.deepEqual(names(findReaders(seedState, "@sumi")), ["すみれ"]);
    assert.deepEqual(names(findReaders(seedState, "＠ｓｕｍｉ")), ["すみれ"]);
    assert.deepEqual(names(findReaders(seedState, "@すみれ")), []);
    assert.deepEqual(names(findReaders(seedState, "@reader")), ["あなた"]);
    // A romaji @ID is also read as kana, so a kanji name typed in kana and
    // not yet converted still finds the reader: @nagi is なぎ.
    assert.deepEqual(names(findReaders(seedState, "あかり")), ["灯"]);
    assert.deepEqual(names(findReaders(seedState, "なぎ")), ["凪"]);
    assert.deepEqual(names(findReaders(seedState, "ナギ")), ["凪"]);
    assert.deepEqual(names(findReaders(seedState, "しおり")), ["栞"]);
    // After @, the @ID is matched as written.
    assert.deepEqual(names(findReaders(seedState, "@なぎ")), []);
    // What a reader wrote about themselves is not their name.
    assert.deepEqual(names(findReaders(seedState, "惑星")), []);
    assert.deepEqual(findReaders(seedState, " "), []);
  });

  await check(
    "shops by name, words, owner, or a book on a public shelf",
    () => {
      assert.deepEqual(names(findShops(seedState, "雨と翻訳")), ["雨と翻訳"]);
      // The owner's name or @ID finds the shop, the ID in kana too.
      assert.deepEqual(names(findShops(seedState, "凪")), ["軌道書房"]);
      assert.deepEqual(names(findShops(seedState, "nagi")), ["軌道書房"]);
      assert.deepEqual(names(findShops(seedState, "ナギ")), ["軌道書房"]);
      // A book's reading or romaji finds the shops that shelve it.
      const railroad = seedState.shops
        .filter((shop) =>
          publicStock(seedState, shop).some(
            (book) => book.id === "galaxy-railroad",
          ),
        )
        .map((shop) => shop.name);
      assert.ok(railroad.length >= 2);
      for (const query of ["ぎんがてつどう", "gingatetsudou", "銀河 鉄道"])
        assert.deepEqual(
          [...names(findShops(seedState, query))].sort(),
          [...railroad].sort(),
          query,
        );
      // A shop matched by its own name comes before one matched by a book.
      const byName = findShops(seedState, "軌道");
      assert.equal(byName[0].name, "軌道書房");
      assert.deepEqual(findShops(seedState, "！？"), []);
    },
  );

  await check("a shop's own name first, then its owner, then its words", () => {
    // 灯 is inside 小さな灯り's name, and is the whole name of the owner
    // of 問いの余白: the shop's own name still comes first.
    assert.deepEqual(names(findShops(seedState, "灯")), [
      "小さな灯り",
      "問いの余白",
    ]);
    assert.deepEqual(names(findShops(seedState, "栞")), [
      "窓辺の栞",
      "額縁のない本屋",
    ]);
    // The owner's name, even only inside it, before the shop's words.
    const town: TownState = {
      ...seedState,
      shops: seedState.shops.map((shop) =>
        shop.id === "shop-window"
          ? { ...shop, description: "みればわかる、雑多な本棚。" }
          : shop,
      ),
    };
    assert.deepEqual(names(findShops(town, "みれ")), ["雨と翻訳", "窓辺の栞"]);
    // Words found in different parts of a shop still find it.
    assert.deepEqual(names(findShops(seedState, "凪 軌道")), ["軌道書房"]);
  });

  await check("@ asks for an @ID in readers and shops alike", () => {
    // The owner's @ID finds the shop; a name after @ finds neither.
    assert.deepEqual(names(findReaders(seedState, "@sumire")), ["すみれ"]);
    assert.deepEqual(names(findShops(seedState, "@sumire")), ["雨と翻訳"]);
    assert.deepEqual(names(findShops(seedState, "＠ｓｕｍｉ")), ["雨と翻訳"]);
    assert.deepEqual(names(findReaders(seedState, "@スミレ")), []);
    assert.deepEqual(names(findShops(seedState, "@スミレ")), []);
    // The shop's own name and words are not an @ID.
    assert.deepEqual(names(findShops(seedState, "@雨と翻訳")), []);
    assert.equal(shopMatcher(seedState, "@"), null);
  });

  await check("a book on a private shelf never finds its shop", () => {
    const shop = seedState.shops[0];
    const hidden: TownState = {
      ...seedState,
      shops: [
        {
          ...shop,
          shelves: shop.shelves.map((shelf) => ({ ...shelf, isPublic: false })),
        },
      ],
    };
    const match = shopMatcher(hidden, "そらりす");
    assert.ok(match);
    assert.equal(match(hidden.shops[0]), TEXT_MATCH.none);
    assert.equal(shopMatcher(hidden, "・"), null);
    // Near titles never count for a shop.
    const near = searchBooks(seedState.books, "秘密の森の花園");
    assert.ok(near.length && near.every((entry) => entry.near));
    assert.deepEqual(findShops(seedState, "秘密の森の花園"), []);
  });

  await check("tag search folds and reads romaji; spellings gather", () => {
    const posts = [
      post("t-1", "雨の日に #ミステリ を一冊"),
      post("t-2", "ひとりで #ﾐｽﾃﾘ を読み返す"),
      post("t-3", "こっそり #ミステリ", { readingMode: "solo" }),
      post("t-4", "#sf の夜"),
      post("t-5", "#sf と #ＳＦ"),
      post("t-6", "#sf"),
    ];
    const state: TownState = { ...seedState, posts };
    for (const asked of ["ミステリ", "みすてり", "misuteri", "ﾐｽﾃﾘ"])
      assert.deepEqual(
        postsWithTag(state, asked)
          .map((entry) => entry.id)
          .sort(),
        ["t-1", "t-2"],
        asked,
      );
    assert.deepEqual(
      postsWithTag(state, "sf")
        .map((entry) => entry.id)
        .sort(),
      ["t-4", "t-5", "t-6"],
    );
    // One chip per tag, under the spelling used most; private notes never
    // count, and a post counts once however many spellings it writes.
    const tags = popularTags(state);
    assert.deepEqual(
      tags.map((entry) => entry.tag),
      ["sf", "ミステリ"],
    );
    assert.equal(tags[0].count, 3);
    assert.equal(tags[1].count, 2);
    const loud: TownState = {
      ...seedState,
      posts: [
        post("l-1", "#積読"),
        post("l-2", "#積読"),
        post("l-3", "#積読"),
        post("l-4", "こわい #ホラー #ほらー #ﾎﾗｰ #ホラ"),
      ],
    };
    assert.deepEqual(popularTags(loud), [
      { tag: "積読", count: 3 },
      { tag: "ホラー", count: 1 },
    ]);
  });

  await check("a draft is not offered a tag it has in another spelling", () => {
    const state: TownState = {
      ...seedState,
      posts: [
        post("m-1", "#ミステリ の夜"),
        post("m-2", "#ミステリ をもう一冊"),
        post("m-3", "#積読"),
      ],
    };
    assert.deepEqual(suggestTags(state, []), ["ミステリ", "積読"]);
    for (const written of ["ミステリ", "ミステリー", "ﾐｽﾃﾘ", "みすてり"])
      assert.deepEqual(suggestTags(state, [written]), ["積読"], written);
  });

  await check("Enter in a picker takes only a book surely meant", () => {
    const books = seedState.books;
    // A title that begins so, in kana or romaji.
    assert.equal(surePick(books, "よるときり")?.id, "night-fog");
    assert.equal(surePick(books, "gingatetsudou")?.id, "galaxy-railroad");
    assert.equal(surePick(books, "そらりす")?.id, "solaris");
    // Several equal matches, a near title, or nothing: Enter waits.
    assert.equal(surePick(books, "孤独"), null);
    assert.equal(surePick(books, "秘密の森の花園"), null);
    assert.equal(surePick(books, "量子力学"), null);
    assert.equal(surePick(books, ""), null);
  });

  await check("near matches are named for what was close", () => {
    const near = searchBooks(seedState.books, "秘密の森の花園");
    assert.equal(nearHeading(near), "近い題名の本");
    const author = searchBooks(seedState.books, "ミハエル・エンデ").filter(
      (entry) => entry.near,
    );
    assert.equal(nearHeading(author), "著者名が近い本");
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
