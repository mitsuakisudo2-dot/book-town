import assert from "node:assert/strict";
import { demoBooks } from "../src/lib/data";
import {
  dropLongVowels,
  foldTable,
  hasKanji,
  hiragana,
  kanaFold,
  searchFold,
  strictFold,
} from "../src/lib/search/fold";
import { ITAIJI } from "../src/lib/search/itaiji";
import { align, keysOf } from "../src/lib/search/keys";
import { candidates, postingsOf, queryGrams } from "../src/lib/search/postings";
import { bookSignals, searchPresence } from "../src/lib/search/presence";
import {
  MATCH,
  rankBooks,
  searchBooks,
  strongMatch,
  type SearchOptions,
} from "../src/lib/search/rank";
import { kanaToRomaji, romajiToKana } from "../src/lib/search/romaji";
import {
  splitAuthors,
  splitTitle,
  volumeNumber,
} from "../src/lib/search/title";
import { seedState } from "../src/lib/data";
import { booksBeforeSearch } from "../src/lib/book-lists";
import { ME_ID, type Book, type BookReading } from "../src/lib/types";

// The book search: how text is folded, read and split, and the order books
// come in for the owner's examples (docs: search design §3, §5, §6, §9, §10).
// Everything runs inside main() because tsx compiles this file as CommonJS.

const openbd = (text: string): BookReading => ({ text, source: "openbd" });

// The 常用漢字 whose 康熙字典体 is a character of its own (NFKC leaves the
// pair apart), old form first: the 2,136 常用漢字 matched against the
// shinjitai/kyujitai pairs of kyujitai.js (data/kyujitai.json), plus the three
// old forms of 弁. The 表's other bracketed forms are compatibility
// ideographs (U+F900–FAFF), which NFKC already folds.
const JOYO_OLD_FORMS =
  "萬万與与兩両竝並乘乗亂乱爭争亞亜佛仏假仮會会傳伝餘余體体價価倂併儉倹僞偽兒児黨党" +
  "內内圓円册冊寫写處処劍剣劑剤剩剰勵励勞労效効敕勅勸勧勳勲區区醫医卽即卷巻參参收収" +
  "雙双敍叙號号臺台囑嘱團団圍囲圖図國国圈圏壓圧墮堕壘塁鹽塩增増壞壊壤壌壯壮壹壱賣売" +
  "聲声變変奧奥奬奨姬姫壻婿孃嬢學学實実寶宝寬寛寢寝壽寿對対專専將将當当尙尚單単巢巣" +
  "營営嚴厳盡尽屆届屬属嶽岳峽峡帶帯歸帰廣広廳庁廢廃貳弐彌弥彈弾徑径從従徵徴德徳應応" +
  "恆恒惠恵惱悩戀恋惡悪悅悦慘惨愼慎懷懐戰戦戲戯戶戸戾戻拂払拔抜擇択拜拝擔担據拠擴拡" +
  "挾挟插挿搜捜擧挙揭掲搖揺攝摂擊撃敎教數数斷断舊旧晝昼晚晩曉暁曆暦來来條条樞枢榮栄" +
  "棧桟櫻桜檢検樂楽樓楼樣様槪概橫横權権缺欠歐欧歡歓步歩歷歴殘残毆殴殼殻每毎氣気沒没" +
  "澤沢淨浄淺浅淚涙濱浜涉渉渴渇溪渓澁渋濟済淸清溫温滿満濕湿灣湾滯滞瀧滝潛潜瀨瀬燈灯" +
  "爐炉爲為點点燒焼犧犠狀状狹狭獨独獵猟獻献獸獣甁瓶產産畫画疊畳癡痴發発盜盗縣県眞真" +
  "硏研碎砕禮礼禪禅祕秘稱称稅税稻稲穗穂穩穏竊窃粹粋絲糸經経繪絵續続繼継緖緒綠緑總総" +
  "繩縄緣縁縱縦纖繊罐缶聽聴肅粛膽胆脫脱腦脳臟臓舍舎舖舗艷艶藝芸莖茎莊荘藏蔵薰薫藥薬" +
  "虛虚蟲虫蠶蚕螢蛍蠻蛮衞衛裝装襃褒霸覇覺覚覽覧觀観觸触譯訳證証譽誉讀読謠謡讓譲豐豊" +
  "贊賛踐践轉転輕軽辭辞邊辺遞逓遲遅郞郎鄕郷醉酔釀醸釋釈鐵鉄鑛鉱錢銭銳鋭鑄鋳鍊錬錄録" +
  "鎭鎮關関鬪闘陷陥險険隨随隱隠鄰隣隸隷雜雑靈霊靑青靜静賴頼顏顔顯顕飮飲餠餅驛駅驅駆" +
  "騷騒驗験髓髄髮髪龍竜鷄鶏麥麦黃黄黑黒默黙齊斉齋斎齒歯齡齢龜亀吿告刄刃吳呉囘回姙妊" +
  "娛娯强強攜携曾曽歲歳黏粘糺糾絕絶說説鐮鎌閱閲麵麺" +
  "辨弁瓣弁辯弁";

function book(
  fields: Partial<Book> & { id: string; title: string; author: string },
): Book {
  return {
    genre: "",
    summary: "",
    color: "#000",
    ink: "#fff",
    height: 180,
    thickness: 30,
    pattern: 0,
    ...fields,
  };
}

/** 『あなたの人生の物語』 with readings as openBD gives them, its other editions, and look-alikes. */
function fixture(withReadings: boolean): Book[] {
  const read = (fields: Partial<Book>) => (withReadings ? fields : {});
  const chiang = read({ authorReading: openbd("チャン, テッド") });
  return [
    book({
      id: "chiang",
      title: "あなたの人生の物語",
      author: "テッド・チャン",
      isbn: "9784150119232",
      ...read({ titleReading: openbd("アナタ ノ ジンセイ ノ モノガタリ") }),
      ...chiang,
    }),
    book({
      id: "chiang-new",
      title: "あなたの人生の物語 新装版",
      author: "テッド・チャン",
      ...read({ titleReading: openbd("アナタ ノ ジンセイ ノ モノガタリ") }),
      ...chiang,
    }),
    book({
      id: "chiang-typed",
      title: "あなたの人生の物語（ハヤカワ文庫SF）",
      author: "テッド・チャン 著 ; 浅倉久志 ほか訳",
    }),
    book({
      id: "jinsei-monogatari",
      title: "人生の物語",
      author: "著者A",
      ...read({ titleReading: openbd("ジンセイ ノ モノガタリ") }),
    }),
    book({
      id: "anata-imi",
      title: "あなたの人生の意味",
      subtitle: "先人に学ぶ「惜しまれる生き方」",
      author: "デイヴィッド・ブルックス",
      ...read({ titleReading: openbd("アナタ ノ ジンセイ ノ イミ") }),
    }),
    book({
      id: "monogatari-jinsei",
      title: "物語の人生",
      author: "著者B",
      ...read({ titleReading: openbd("モノガタリ ノ ジンセイ") }),
    }),
    book({
      id: "inochi",
      title: "いのちの物語",
      author: "著者C",
      ...read({ titleReading: openbd("イノチ ノ モノガタリ") }),
    }),
    book({
      id: "anata-tame",
      title: "あなたのための物語",
      author: "長谷敏司",
      ...read({
        titleReading: openbd("アナタ ノ タメ ノ モノガタリ"),
        authorReading: openbd("ハセ, サトシ"),
      }),
    }),
    book({
      id: "ibuki",
      title: "息吹",
      author: "テッド・チャン",
      ...read({ titleReading: openbd("イブキ") }),
      ...chiang,
    }),
    book({
      id: "hateshinai",
      title: "はてしない物語",
      author: "ミヒャエル・エンデ",
      ...read({ titleReading: openbd("ハテシナイ モノガタリ") }),
    }),
    book({ id: "jinsei", title: "人生", author: "著者D" }),
    book({
      id: "batsu-1",
      title: "罪と罰 上",
      author: "ドストエフスキー",
      ...read({ titleReading: openbd("ツミ ト バツ") }),
    }),
    book({
      id: "batsu-3",
      title: "罪と罰（下）",
      author: "ドストエフスキー",
      ...read({ titleReading: openbd("ツミ ト バツ") }),
    }),
    book({ id: "kokugo", title: "國語の學び", author: "著者E" }),
    book({
      id: "tokyo",
      title: "東京奇譚集",
      author: "村上春樹",
      ...read({ titleReading: openbd("トウキョウ キタンシュウ") }),
    }),
    ...demoBooks,
  ];
}

const titles = (books: Book[], query: string, options?: SearchOptions) =>
  searchBooks(books, query, options).map((match) => match.book.title);

const first = (books: Book[], query: string, options?: SearchOptions) =>
  searchBooks(books, query, options)[0];

/** The first match and how far ahead of the next other title it is. */
function lead(books: Book[], query: string) {
  const ranked = rankBooks(books, query);
  const top = ranked[0];
  const other = ranked.find(
    ({ match }) =>
      keysOf(match.book).parts.base !== keysOf(top.match.book).parts.base,
  );
  return {
    title: top.match.book.title,
    rank: top.match.rank,
    margin:
      other && other.match.rank === top.match.rank
        ? top.order - other.order
        : 1,
  };
}

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  console.log("PASS " + name);
}

async function main() {
  const books = fixture(true);
  const unread = fixture(false);

  await check("F1: width, marks and compatibility forms", () => {
    assert.equal(searchFold("ＳＦ"), "sf");
    assert.equal(searchFold("ｶﾞﾗｽ"), searchFold("ガラス"));
    assert.equal(searchFold("Tōkyō"), "tokyo");
    assert.equal(searchFold("Café"), "cafe");
    assert.equal(searchFold("①Ⅱ"), "1ii");
    assert.equal(searchFold("㈱"), "株");
  });

  await check("F2: one pass over kana, letters and old kanji", () => {
    assert.equal(searchFold("ABC"), "abc");
    assert.equal(searchFold("キョウト"), searchFold("キヨウト"));
    assert.equal(searchFold("ァッャヵヶ"), "あつやかけ");
    assert.equal(searchFold("こんにちは"), searchFold("こんにちわ"));
    assert.equal(searchFold("を"), "お");
    assert.equal(searchFold("ヴ"), "ぶ");
    assert.equal(searchFold("ぢづゐゑ"), "じずいえ");
    assert.equal(searchFold("國語の學び"), searchFold("国語の学び"));
    assert.equal(searchFold("宮澤"), "宮沢");
    assert.equal(searchFold("髙橋"), "高橋");
    assert.equal(searchFold("山﨑"), "山崎");
    assert.equal(searchFold("𠮷野"), "吉野");
    assert.equal(searchFold("森鷗外"), searchFold("森鴎外"));
    // Every character goes straight to its final form: nothing a second pass could change.
    const { from, to } = foldTable();
    assert.equal(Array.from(from).length, Array.from(to).length);
    for (const char of to) assert.ok(!from.includes(char), char);
    for (const [old, common] of ITAIJI) {
      assert.notEqual(old, common);
      assert.equal(old.normalize("NFKC"), old, old);
    }
  });

  await check("ヴァ ヴィ ヴェ ヴォ ヴュ are the バ row as often", () => {
    assert.equal(searchFold("ヴェニスの商人"), searchFold("ベニスの商人"));
    assert.equal(
      searchFold("ローベルト・ヴァルザー"),
      searchFold("ローベルト・バルザー"),
    );
    assert.equal(searchFold("ヴィヨン"), searchFold("ビヨン"));
    assert.equal(searchFold("ヴァイオリン"), searchFold("バイオリン"));
    assert.equal(searchFold("ヴォイス"), searchFold("ボイス"));
    assert.equal(searchFold("レヴュー"), searchFold("レビュー"));
    assert.equal(searchFold("ｳﾞｪﾆｽ"), "べにす");
    assert.equal(searchFold("ゔぁ"), "ば");
    for (const typed of ["benisu", "venisu"])
      assert.equal(searchFold(romajiToKana(typed)!.kana), "べにす", typed);
  });

  await check("the 常用漢字表's 康熙字典体 fold to today's forms", () => {
    const pairs = Array.from(JOYO_OLD_FORMS);
    assert.ok(pairs.length >= 2 * 330);
    for (let i = 0; i < pairs.length; i += 2)
      assert.equal(
        searchFold(pairs[i]),
        searchFold(pairs[i + 1]),
        pairs[i] + pairs[i + 1],
      );
    for (const [old, common] of [
      ["鐵道員", "鉄道員"],
      ["點と線", "点と線"],
      ["銀河鐵道の夜", "銀河鉄道の夜"],
      ["靑い鳥", "青い鳥"],
      ["淸兵衛と瓢簞", "清兵衛と瓢簞"],
      ["剝製", "剥製"],
    ])
      assert.equal(searchFold(old), searchFold(common), old);
  });

  await check("F3: only digits, a–z, hiragana, 々〆 and kanji stay", () => {
    assert.equal(searchFold("あなたの　人生 の物語"), "あなたの人生の物語");
    assert.equal(searchFold("『夜と霧』（新版）"), "夜と霧新版");
    assert.equal(searchFold("ハリー・ポッター"), "わりぽつた");
    assert.equal(searchFold("【本】〈本〉「本」"), "本本本");
    assert.equal(searchFold("夜〜霧～📚!?"), "夜霧");
    assert.equal(searchFold("人々"), "人々");
    assert.equal(searchFold("〆切"), "〆切");
    assert.equal(searchFold("ØЖ"), "");
  });

  await check("ゝゞヽヾ repeat the kana before them", () => {
    assert.equal(searchFold("こゝろ"), searchFold("こころ"));
    assert.equal(searchFold("コヽロ"), searchFold("ココロ"));
    assert.equal(searchFold("みすゞ"), searchFold("みすず"));
    assert.equal(searchFold("いすゞ"), "いすず");
    assert.equal(searchFold("ゝ"), "");
    assert.equal(strictFold("こゝろ"), "こころ");
    const kokoro = [
      book({ id: "kokoro", title: "こゝろ", author: "夏目漱石" }),
      book({
        id: "misuzu",
        title: "わたしと小鳥とすずと",
        author: "金子みすゞ",
      }),
      ...demoBooks,
    ];
    for (const query of ["こころ", "ココロ", "kokoro", "こゝろ"])
      assert.equal(first(kokoro, query).book.id, "kokoro", query);
    assert.equal(first(kokoro, "金子みすず").rank, MATCH.author);
  });

  await check("F4: long vowels go, kanaFold keeps them", () => {
    const tokyo = searchFold("とうきょう");
    assert.equal(tokyo, "ときよ");
    assert.equal(searchFold("トーキョー"), tokyo);
    assert.equal(searchFold(romajiToKana("tokyo")!.kana), tokyo);
    assert.equal(searchFold("せい"), "せ");
    assert.equal(searchFold("おおきい"), "おき");
    assert.equal(kanaFold("とうきょう"), "とうきよう");
    assert.equal(dropLongVowels(kanaFold("トーキョー")), tokyo);
  });

  await check("strictFold tells a true match from a folded one", () => {
    assert.equal(strictFold("ハナ"), "はな");
    assert.notEqual(strictFold("はな"), strictFold("わな"));
    assert.equal(strictFold("國語"), "国語");
    assert.equal(strictFold("Ｍｏｍｏ"), "momo");
    assert.equal(hiragana("ギンガ テツドウ"), "ぎんが てつどう");
    assert.ok(hasKanji("あ夜"));
    assert.ok(!hasKanji("あいう"));
  });

  await check("romaji is read in Hepburn, 訓令式 and IME spellings", () => {
    const kana = (text: string) => romajiToKana(text)?.kana;
    assert.equal(kana("shi"), kana("si"));
    assert.equal(kana("chi"), kana("ti"));
    assert.equal(kana("tsu"), kana("tu"));
    assert.equal(kana("fu"), kana("hu"));
    assert.equal(kana("ji"), kana("zi"));
    assert.equal(kana("ja"), "じゃ");
    assert.equal(kana("jya"), "じゃ");
    assert.equal(kana("zya"), "じゃ");
    assert.equal(kana("wo"), "を");
    assert.equal(kana("konnichiwa"), "こんにちわ");
    assert.equal(kana("kon'ya"), "こんや");
    assert.equal(kana("kitte"), "きって");
    assert.equal(kana("matcha"), "まっちゃ");
    assert.equal(kana("shimbun"), "しんぶん");
    assert.equal(kana("hon"), "ほん");
    assert.equal(kana("lamen"), "らめん");
    assert.equal(kana("Tōkyō"), "ときょ");
    assert.equal(kana("ginga tetudou"), "ぎんがてつどう");
    assert.deepEqual(romajiToKana("anatanojins"), {
      kana: "あなたのじん",
      tail: "s",
    });
    // Not romaji: matched as written.
    assert.equal(romajiToKana("SF"), null);
    assert.equal(romajiToKana("1Q84"), null);
    assert.equal(romajiToKana("Ted Chiang"), null);
    assert.equal(kanaToRomaji("しちつふじん"), "sitituhuzin");
  });

  await check("a title lines up with its reading, or not at all", () => {
    assert.deepEqual(
      align("あなたの人生の物語", "あなたのじんせいのものがたり"),
      [
        ["あなたの", "あなたの"],
        ["人生", "じんせい"],
        ["の", "の"],
        ["物語", "ものがたり"],
      ],
    );
    assert.deepEqual(align("物語の人生", "ものがたりのじんせい"), [
      ["物語", "ものがたり"],
      ["の", "の"],
      ["人生", "じんせい"],
    ]);
    // 物語 cannot be read as a single も.
    assert.equal(align("物語の人生", "ものじんせい"), null);
    assert.equal(align("夜と霧", "よるのきり"), null);
    // A title of kana alone has nothing to line up.
    assert.equal(align("そらりす", "そらりす"), null);
  });

  await check("titles split into base, edition, volume and subtitle", () => {
    assert.deepEqual(splitTitle("あなたの人生の物語（ハヤカワ文庫SF）"), {
      base: "あなたの人生の物語",
      volume: 0,
      edition: "ハヤカワ文庫SF",
      subtitle: "",
    });
    assert.equal(splitTitle("あなたの人生の物語 新装版").edition, "新装版");
    assert.equal(splitTitle("最新版").base, "最新版");
    assert.deepEqual(splitTitle("罪と罰（下）"), {
      base: "罪と罰",
      volume: 3,
      edition: "",
      subtitle: "",
    });
    assert.deepEqual(splitTitle("罪と罰 上 (新潮文庫)"), {
      base: "罪と罰",
      volume: 1,
      edition: "新潮文庫",
      subtitle: "",
    });
    assert.deepEqual(splitTitle("1Q84 BOOK1"), {
      base: "1Q84",
      volume: 1,
      edition: "",
      subtitle: "",
    });
    assert.equal(splitTitle("天下").base, "天下");
    assert.equal(splitTitle("1984").base, "1984");
    assert.equal(splitTitle("華氏451度").base, "華氏451度");
    assert.deepEqual(splitTitle("あなたの人生の意味――先人に学ぶ"), {
      base: "あなたの人生の意味",
      volume: 0,
      edition: "",
      subtitle: "先人に学ぶ",
    });
    assert.equal(splitTitle("夜の果て：ある旅").subtitle, "ある旅");
    for (const [marker, number] of [
      ["上", 1],
      ["下", 3],
      ["後編", 2],
      ["第二巻", 2],
      ["十二巻", 12],
      ["IV", 4],
      ["BOOK 3", 3],
      ["vol.5", 5],
    ] as const)
      assert.equal(volumeNumber(marker), number, marker);
  });

  await check("author lines split into names without their roles", () => {
    assert.deepEqual(splitAuthors("テッド・チャン 著 ; 浅倉久志 ほか訳"), [
      "テッド・チャン",
      "浅倉久志",
    ]);
    assert.deepEqual(splitAuthors("宮沢賢治／著"), ["宮沢賢治"]);
    assert.deepEqual(splitAuthors("宮沢賢治（作）、黒井健（絵）"), [
      "宮沢賢治",
      "黒井健",
    ]);
    assert.deepEqual(splitAuthors("夏目漱石 [ほか]"), ["夏目漱石"]);
    // A name that ends in a role word keeps it.
    assert.deepEqual(splitAuthors("遠藤周作"), ["遠藤周作"]);
  });

  await check("the owner's five examples find 『あなたの人生の物語』", () => {
    for (const query of [
      "あなたの人生のものがたり",
      "アナタノジンセイノモノガタリ",
      "ｱﾅﾀﾉｼﾞﾝｾｲﾉﾓﾉｶﾞﾀﾘ",
      "Anatanojinseinomonogatari",
      "anatanozinseinomonogatari",
    ]) {
      const top = lead(books, query);
      assert.equal(top.title, "あなたの人生の物語", query);
      assert.equal(top.rank, MATCH.title, query);
    }
    // あなたのいのちの物語: a near title, first through the ruby form.
    const life = lead(books, "あなたのいのちの物語");
    assert.equal(life.title, "あなたの人生の物語");
    assert.equal(life.rank, MATCH.nearTitle);
    assert.ok(life.margin >= 0.03, "margin " + life.margin);
    assert.deepEqual(
      titles(books, "あなたのいのちの物語")
        .filter((title) => !title.startsWith("あなたの人生の物語"))
        .slice(0, 4),
      [
        "あなたのための物語",
        "いのちの物語",
        "あなたの人生の意味",
        "人生の物語",
      ],
    );
    // あなたの人生の: two titles begin with it; nothing else shows.
    const start = searchBooks(books, "あなたの人生の");
    assert.ok(start.every((match) => match.rank === MATCH.titleStart));
    assert.deepEqual(
      [...new Set(start.map((match) => keysOf(match.book).parts.base))],
      ["あなたの人生の意味", "あなたの人生の物語"],
    );
    // A true tie: one public shelf is enough to put the target first.
    assert.equal(
      first(books, "あなたの人生の", {
        presence: (id) => (id === "chiang" ? 3 : 0),
      }).book.title,
      "あなたの人生の物語",
    );
  });

  await check(
    "near titles follow the match, in the order of the design",
    () => {
      const found = searchBooks(books, "あなたの人生のものがたり");
      assert.deepEqual(
        found.filter((match) => !match.near).map((match) => match.book.id),
        ["chiang", "chiang-new"],
      );
      assert.deepEqual(
        found
          .filter((match) => match.near && match.book.id !== "chiang-typed")
          .map((match) => match.book.title),
        [
          "あなたのための物語",
          "あなたの人生の意味",
          "人生の物語",
          "物語の人生",
        ],
      );
      assert.ok(found[0].byReading);
    },
  );

  await check("without stored readings (today's registered books)", () => {
    // Written forms still find it; kana-only and romaji wait for a reading.
    assert.equal(
      lead(unread, "あなたの人生のものがたり").title,
      "あなたの人生の物語",
    );
    assert.ok(
      titles(unread, "あなたのいのちの物語")
        .slice(0, 2)
        .includes("あなたの人生の物語"),
    );
    assert.ok(titles(unread, "あなたの人生の").includes("あなたの人生の物語"));
    assert.ok(
      !titles(unread, "アナタノジンセイノモノガタリ").includes(
        "あなたの人生の物語",
      ),
    );
    assert.ok(
      !titles(unread, "Anatanojinseinomonogatari").includes(
        "あなたの人生の物語",
      ),
    );
  });

  await check("typos, mis-conversions, editions and authors", () => {
    const typo = first(books, "あなたのじんせいのものがたい");
    assert.equal(typo.book.title, "あなたの人生の物語");
    assert.equal(typo.rank, MATCH.titleTypo);
    assert.equal(first(books, "あなたの人世の物語").rank, MATCH.titleTypo);
    assert.equal(lead(books, "あなたの陣性の物語").title, "あなたの人生の物語");
    assert.equal(
      first(books, "あなたの人生の物語 文庫").book.id,
      "chiang-typed",
    );
    const chan = searchBooks(books, "チャン 物語");
    assert.ok(chan.every((match) => match.rank === MATCH.everyWord));
    assert.ok(
      chan.every((match) => match.book.title.startsWith("あなたの人生の物語")),
    );
    for (const query of ["テッド・チャン", "てっどちゃん", "ちゃんてっど"]) {
      const found = searchBooks(books, query).filter((match) => !match.near);
      assert.ok(found.length >= 3, query);
      assert.ok(
        found.every((match) => match.rank === MATCH.author),
        query,
      );
      assert.ok(
        found.some((match) => match.book.title === "息吹"),
        query,
      );
    }
    for (const query of ["宮澤賢治", "みやざわけんじ", "miyazawakenji"])
      assert.equal(first(books, query).book.title, "銀河鉄道の夜", query);
    assert.equal(first(books, "おくいずみひかる").book.title, "石の来歴");
    assert.equal(first(books, "遠藤周作").book.title, "沈黙");
  });

  await check("a title spelled as typed comes before a folded one", () => {
    const read = (id: string, title: string, reading: string) =>
      book({ id, title, author: "著者", titleReading: openbd(reading) });
    const alike = [
      read("ojisan", "おじさん図鑑", "オジサン ズカン"),
      read("ojiisan", "おじいさんのランプ", "オジイサン ノ ランプ"),
      read("ookami", "狼と香辛料", "オオカミ ト コウシンリョウ"),
      read("okami", "女将さん", "オカミサン"),
      read("shousetsu", "小説の神様", "ショウセツ ノ カミサマ"),
      read("shosetsu", "諸説あり", "ショセツ アリ"),
      read("yuki", "雪国", "ユキグニ"),
      read("yuuki", "勇気の花", "ユウキ ノ ハナ"),
      book({ id: "hana", title: "はな", author: "A" }),
      book({ id: "wana", title: "わな", author: "B" }),
    ];
    for (const [query, id] of [
      ["おじいさん", "ojiisan"],
      ["ojiisan", "ojiisan"],
      ["おじさん", "ojisan"],
      ["おおかみ", "ookami"],
      ["ookami", "ookami"],
      ["おかみ", "okami"],
      ["しょうせつ", "shousetsu"],
      ["ゆうき", "yuuki"],
      ["ゆき", "yuki"],
      ["はな", "hana"],
      ["わな", "wana"],
    ])
      assert.equal(first(alike, query).book.id, id, query);
    // Being on many shelves never puts わな before the はな that was typed.
    const shelved = (id: string) => (id === "wana" || id === "ojisan" ? 50 : 0);
    assert.equal(first(alike, "はな", { presence: shelved }).book.id, "hana");
    assert.equal(
      first(alike, "おじいさん", { presence: shelved }).book.id,
      "ojiisan",
    );
  });

  await check("a reading is also read word by word", () => {
    // ロウジン ト ウミ: と+う is not a long vowel, so うみ alone finds it.
    for (const query of ["うみ", "umi", "ろうじんとうみ", "roujintoumi"])
      assert.ok(
        titles(books, query).includes("老人と海"),
        query + ": " + titles(books, query).join(" / "),
      );
    assert.equal(first(books, "ろうじんとうみ").rank, MATCH.title);
    const sound = [
      book({
        id: "kaze",
        title: "風の音",
        author: "著者",
        titleReading: openbd("カゼ ノ オト"),
      }),
    ];
    assert.equal(first(sound, "おと")?.book.id, "kaze");
    assert.equal(first(sound, "かぜのおと").rank, MATCH.title);
  });

  await check("romaji ending in n waits for な, の or に", () => {
    for (const [query, title] of [
      ["mien", "見えない都市"],
      ["yami n", "闇の左手"],
      ["ishi n", "石の来歴"],
      ["anatan", "あなたの人生の物語"],
    ])
      assert.ok(titles(books, query).includes(title), query);
    // ん still reads as ん first: hon is ほん.
    const hon = [
      book({
        id: "hon",
        title: "本",
        author: "A",
        titleReading: openbd("ホン"),
      }),
      book({
        id: "hoshi",
        title: "星",
        author: "B",
        titleReading: openbd("ホシ"),
      }),
      book({
        id: "honoo",
        title: "炎",
        author: "C",
        titleReading: openbd("ホノオ"),
      }),
    ];
    assert.deepEqual(
      searchBooks(hon, "hon").map((match) => match.book.id),
      ["hon", "honoo"],
    );
  });

  await check("only a title's reading is shown beside a match", () => {
    assert.ok(first(books, "ぎんがてつどう").byReading);
    for (const query of [
      "みやざわけんじ",
      "けんじみやざわ",
      "なつめそうせき",
      "おくいずみひかる",
      "チャン テッド",
    ]) {
      const found = first(books, query);
      assert.equal(found.rank, MATCH.author, query);
      assert.equal(found.byReading, false, query);
    }
  });

  await check("a genre chip shows its books and nothing near", () => {
    for (const genre of new Set(demoBooks.map((entry) => entry.genre))) {
      const found = searchBooks(books, genre);
      assert.ok(found.length > 0, genre);
      assert.ok(
        found.every((match) => !match.near),
        genre + ": " + found.map((match) => match.book.title).join(" / "),
      );
    }
    assert.deepEqual(
      titles(demoBooks, "ファンタジー").sort(),
      demoBooks
        .filter((entry) => entry.genre === "ファンタジー")
        .map((entry) => entry.title)
        .sort(),
    );
  });

  await check("demo titles by kana, romaji, words and one kanji", () => {
    for (const query of [
      "ぎんがてつどう",
      "gingatetsudou",
      "ginga tetudou",
      "銀河 鉄道",
    ])
      assert.deepEqual(titles(books, query), ["銀河鉄道の夜"], query);
    assert.deepEqual(titles(books, "夜"), ["夜と霧", "夢十夜", "銀河鉄道の夜"]);
    assert.equal(first(books, "そらりす").rank, MATCH.title);
    assert.equal(first(books, "solaris").book.title, "ソラリス");
    assert.equal(first(books, "momo").rank, MATCH.title);
    for (const query of [
      "こころはこどくなかりゅうど",
      "kokorowakodokunakaryuudo",
    ])
      assert.equal(first(books, query).book.title, "心は孤独な狩人", query);
    assert.equal(first(books, "tabiwosuruki").book.title, "旅をする木");
    assert.equal(first(books, "とーきょー").book.title, "東京奇譚集");
    assert.equal(first(books, "よるときり").book.title, "夜と霧");
    assert.ok(strongMatch(first(books, "よるときり")));
  });

  await check("volumes, old kanji, ISBNs and nothing at all", () => {
    assert.deepEqual(titles(books, "罪と罰"), ["罪と罰 上", "罪と罰（下）"]);
    assert.deepEqual(titles(books, "つみとばつ 下"), [
      "罪と罰（下）",
      "罪と罰 上",
    ]);
    assert.equal(first(books, "国語の学び").book.title, "國語の學び");
    for (const query of [
      "978-4-15-011923-2",
      "9784150119232",
      "4150119236",
      "４－１５－０１１９２３－６",
      // A Japanese keyboard types ー for "-"; other dashes and an ISBN label.
      "978ー4ー15ー011923ー2",
      "９７８ー４ー１５ー０１１９２３ー２",
      "978‐4‐15‐011923‐2",
      "978–4–15–011923–2",
      "978−4−15−011923−2",
      "ISBN978-4-15-011923-2",
      "ISBN 978-4-15-011923-2",
      "ISBN-13: 9784150119232",
      "isbn：4150119236",
    ]) {
      const found = searchBooks(books, query);
      assert.equal(found.length, 1, query);
      assert.equal(found[0].rank, MATCH.isbn, query);
    }
    // An ISBN being typed keeps its book in sight, though not sure enough for Enter.
    for (const query of ["97841501", "978415011923", "978-4-15", "41501192"]) {
      const found = first(books, query);
      assert.equal(found?.book.id, "chiang", query);
      assert.ok(!strongMatch(found), query);
    }
    assert.deepEqual(titles(books, "9784150119233"), []);
    assert.deepEqual(titles(books, "1984"), []);
    assert.deepEqual(titles(books, "量子力学"), []);
    assert.deepEqual(titles(books, "ハリー・ポッター"), []);
    assert.deepEqual(titles(books, "・・・"), []);
    assert.deepEqual(titles(books, ""), []);
  });

  await check("near titles stay out beside a real match", () => {
    assert.ok(searchBooks(books, "チャン 物語").every((match) => !match.near));
    assert.ok(searchBooks(books, "銀河 鉄道").every((match) => !match.near));
  });

  await check("known limits stay known (design §10)", () => {
    // A kanji query does not find a title written in kana.
    assert.ok(!titles(books, "桃").includes("モモ"));
    // Digits for kanji numerals are only a near title, not a match.
    assert.ok(searchBooks(books, "100年の孤独").every((match) => match.near));
    // Latin author names: readings are katakana.
    assert.ok(!titles(books, "ted chiang").includes("息吹"));
  });

  await check("genres still find their books", () => {
    const sf = searchBooks(demoBooks, "SF");
    assert.ok(sf.length > 0);
    assert.ok(sf.every((match) => match.book.genre === "SF"));
    assert.ok(searchBooks(demoBooks, "日本文学").length > 0);
  });

  await check("presence never moves a book across classes", () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const query of [
      "あなたの人生の",
      "物語",
      "あなたのいのちの物語",
      "人生",
      "夜",
      "てっどちゃん",
    ])
      for (let round = 0; round < 20; round++) {
        const presence = new Map(
          books.map((entry) => [entry.id, Math.floor(random() * 50)]),
        );
        const ranks = searchBooks(books, query, {
          presence: (id) => presence.get(id) ?? 0,
        }).map((match) => match.rank);
        assert.deepEqual(
          ranks,
          [...ranks].sort((a, b) => b - a),
          query,
        );
      }
  });

  await check("the demo town's presence is counted from public things", () => {
    const signals = bookSignals(seedState);
    assert.ok([...signals.values()].some((signal) => signal.shelves > 0));
    assert.equal(searchPresence(undefined), 0);
    assert.equal(
      searchPresence({ shelves: 2, talk: 3, reviews: 1, wants: 4 }),
      13,
    );
  });

  await check(
    "before anything is typed, another reader's typed-in book waits",
    () => {
      // Books from the database, each used once in one way (R1).
      const uses = [
        "nowhere",
        "public shelf",
        "private shelf",
        "post",
        "solo memo",
        "public record",
        "private record",
        "9冊",
        "poster",
        "draft poster",
        "reading together",
        "own library",
        "own wish",
        "own favorite",
        "own finished",
        "own 9冊",
        "own reading",
        "own private shelf",
        "own solo memo",
        "own private record",
        "own draft poster",
      ] as const;
      const idOf = (use: (typeof uses)[number]) =>
        "00000000-0000-4000-8000-" +
        String(uses.indexOf(use)).padStart(12, "0");
      const state = structuredClone(seedState);
      state.books = [
        ...state.books,
        ...uses.map((use) =>
          book({
            id: idOf(use),
            title: "試験の本 " + use,
            author: "試験 作家",
          }),
        ),
        // Typed in this browser: the demo has no other readers.
        book({ id: "my-book-1", title: "手元の本", author: "試験 作家" }),
      ];
      const shelf = (id: string, isPublic: boolean, bookId: string) => ({
        id,
        name: id,
        capacity: 10,
        isPublic,
        items: [{ id: id + "-1", bookId, display: "spine" as const, pop: "" }],
      });
      state.shops[0].shelves.push(
        shelf("t-public", true, idOf("public shelf")),
        shelf("t-private", false, idOf("private shelf")),
      );
      state.ownShop = {
        ...structuredClone(state.shops[1]),
        id: "mine",
        ownerId: ME_ID,
        demo: false,
        shelves: [shelf("t-own", false, idOf("own private shelf"))],
      };
      const post = (id: string, authorId: string, bookId: string) => ({
        ...structuredClone(state.posts[0]),
        id,
        authorId,
        bookId,
        parentId: null,
        readingMode: null,
      });
      state.posts.push(
        post("t-post", "r-nagi", idOf("post")),
        { ...post("t-solo", "r-nagi", idOf("solo memo")), readingMode: "solo" },
        {
          ...post("t-own-solo", ME_ID, idOf("own solo memo")),
          readingMode: "solo",
        },
      );
      const record = (
        id: string,
        readerId: string,
        bookId: string,
        isPublic: boolean,
      ) => ({
        ...structuredClone(state.readingRecords[0]),
        id,
        readerId,
        bookId,
        isPublic,
      });
      state.readingRecords.push(
        record("t-public", "r-nagi", idOf("public record"), true),
        record("t-private", "r-nagi", idOf("private record"), false),
        record("t-own", ME_ID, idOf("own private record"), false),
      );
      state.readers[0].lifeNine.push(idOf("9冊"));
      state.me.lifeNine.push(idOf("own 9冊"));
      const poster = (
        id: string,
        authorId: string,
        bookId: string,
        status: "draft" | "published",
      ) => ({
        ...structuredClone(state.posters[0]),
        id,
        authorId,
        status,
        pages: [{ heading: "試験", text: "", bookIds: [bookId] }],
      });
      state.posters.push(
        poster("t-up", "r-nagi", idOf("poster"), "published"),
        poster("t-draft", "r-nagi", idOf("draft poster"), "draft"),
        poster("t-own-draft", ME_ID, idOf("own draft poster"), "draft"),
      );
      state.readingNow.push({
        readerId: "r-nagi",
        bookId: idOf("reading together"),
        minutesAgo: 3,
      });
      state.library.push(idOf("own library"));
      state.wishlist.push(idOf("own wish"));
      state.favorites.push(idOf("own favorite"));
      state.finishedBooks.push(idOf("own finished"));
      state.readingSessions.push({
        id: "t-session",
        bookId: idOf("own reading"),
        mode: "solo",
        startedAt: "2026-10-12T00:00:00Z",
        endedAt: "2026-10-12T01:00:00Z",
      });

      const shown = booksBeforeSearch(state);
      const waiting = uses.filter(
        (use) => !shown.some((entry) => entry.id === idOf(use)),
      );
      assert.deepEqual(waiting, [
        "nowhere",
        "private shelf",
        "solo memo",
        "private record",
        "draft poster",
      ]);
      // The 見本's books and one typed in this browser stay, in the town's order.
      assert.deepEqual(
        shown.filter((entry) => !entry.id.startsWith("00000000-")),
        state.books.filter((entry) => !entry.id.startsWith("00000000-")),
      );
      // A search still finds every book, as before.
      for (const use of waiting)
        assert.equal(
          searchBooks(state.books, "試験の本 " + use)[0]?.book.id,
          idOf(use),
          use,
        );
      // A new reader's town of 見本 alone loses nothing.
      assert.deepEqual(booksBeforeSearch(seedState), seedState.books);
    },
  );

  await check("a picker's Enter takes only a sure match", () => {
    assert.ok(strongMatch(first(books, "夜と")));
    assert.ok(!strongMatch(first(books, "あなたのいのちの物語")));
    // The reader's own copy is first among equals.
    const own = new Set(["batsu-3"]);
    assert.equal(first(books, "罪と罰", { own }).book.id, "batsu-1");
    const editions = [
      book({ id: "a", title: "夜の本", author: "X" }),
      book({ id: "b", title: "夜の本", author: "X" }),
    ];
    assert.equal(
      first(editions, "夜の本", { own: new Set(["b"]) }).book.id,
      "b",
    );
  });

  await check("pruning keeps every book that contains the query", () => {
    const postings = postingsOf(books);
    for (const query of [
      "夜",
      "も",
      "物語",
      "ぎんがてつど",
      "あなたのいのちの物語",
    ]) {
      const key = searchFold(query);
      const kept = new Set(
        candidates(postings, [queryGrams(key, kanaFold(query))]),
      );
      for (const entry of books) {
        const keys = keysOf(entry);
        const holds = [...keys.title, ...keys.author].some((k) =>
          Array.from(key).length === 1
            ? k.key.startsWith(key) || (hasKanji(key) && k.key.includes(key))
            : k.key.includes(key),
        );
        if (holds) assert.ok(kept.has(entry), `${query}: ${entry.title}`);
      }
    }
  });

  await check("still first among a thousand look-alikes", () => {
    const words = [
      ["人生", "ジンセイ"],
      ["物語", "モノガタリ"],
      ["あなた", "アナタ"],
      ["夜", "ヨル"],
      ["海", "ウミ"],
      ["猫", "ネコ"],
      ["時間", "ジカン"],
      ["旅", "タビ"],
      ["森", "モリ"],
      ["星", "ホシ"],
      ["記憶", "キオク"],
      ["言葉", "コトバ"],
      ["世界", "セカイ"],
      ["少年", "ショウネン"],
      ["手紙", "テガミ"],
      ["図書館", "トショカン"],
      ["ため", "タメ"],
    ];
    const joins = [
      ["の", "ノ"],
      ["と", "ト"],
    ];
    let seed = 7;
    const pick = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const many: Book[] = [];
    for (let i = 0; i < 1000; i++) {
      let title = "";
      const reading: string[] = [];
      const count = 2 + pick(3);
      for (let j = 0; j < count; j++) {
        const [word, read] = words[pick(words.length)];
        title += word;
        reading.push(read);
        if (j < count - 1) {
          const [join, readJoin] = joins[pick(joins.length)];
          title += join;
          reading.push(readJoin);
        }
      }
      many.push(
        book({
          id: "many-" + i,
          title,
          author: "著者" + pick(300),
          titleReading: { text: reading.join(" "), source: "estimate" },
        }),
      );
    }
    many.push(...books);
    const queries = [
      "あなたのいのちの物語",
      "あなたの人生のものがたり",
      "Anatanojinseinomonogatari",
      "アナタノジンセイノモノガタリ",
      "あなたの人生の",
      "人生",
      "の物",
      "夜",
      "ぎんがてつどう",
      "ginga tetudou",
      "てっどちゃん",
      "チャン 物語",
      "罪と罰",
      "つみとばつ 下",
      "量子力学",
      "あなたのじんせいのものがたい",
      "図書館の猫",
      "としょかんのねこ",
      "tosyokan",
      "言葉と記憶",
      "せかいのはて",
      "手紙",
      "少年の旅",
      "ほし",
      "SF",
      "978-4-15-011923-2",
      "宮澤賢治",
      "もり",
      "ジカン",
      "記憶の森の物語",
    ];
    // Every query still answers among them (the gram index never throws away all).
    for (const query of queries) searchBooks(many, query);
    // A shorter title the query wholly holds (あなたの物語) may come first:
    // both are only near.
    assert.equal(
      lead(many, "あなたの人生のものがたり").title,
      "あなたの人生の物語",
    );
    const distinct = [...new Set(titles(many, "あなたのいのちの物語"))];
    assert.ok(
      distinct.indexOf("あなたの人生の物語") <= 1,
      distinct.join(" / "),
    );
    assert.ok(
      distinct.indexOf("あなたの人生の物語") <
        distinct.indexOf("あなたのための物語"),
    );
  });

  await check(
    "the gram index loses no match, typos and romaji included",
    () => {
      // Pruned and unpruned agree on every class; near titles found only by
      // reading a kanji query with a book's own readings cannot be indexed.
      const same = (query: string) => {
        const kanji = hasKanji(searchFold(query));
        const shown = (unpruned: boolean) =>
          searchBooks(books, query, { unpruned, limit: 500 })
            .filter((match) => !kanji || !match.near)
            .map((match) => match.book.id + ":" + match.rank)
            .join(" ");
        assert.equal(shown(false), shown(true), query);
      };
      const variants = (text: string) => {
        const chars = Array.from(text);
        const out = new Set<string>([text]);
        for (let i = 0; i < chars.length; i++) {
          const before = chars.slice(0, i);
          out.add([...before, ...chars.slice(i + 1)].join(""));
          out.add([...before, "か", ...chars.slice(i + 1)].join(""));
          if (i + 1 < chars.length)
            out.add(
              [...before, chars[i + 1], chars[i], ...chars.slice(i + 2)].join(
                "",
              ),
            );
        }
        return out;
      };
      let count = 0;
      for (const entry of books) {
        const reading = entry.titleReading
          ? kanaFold(entry.titleReading.text)
          : "";
        const texts = [entry.title, reading].filter(Boolean);
        // The reading in romaji, with two letters swapped here and there.
        if (reading) {
          const romaji = kanaToRomaji(reading);
          texts.push(romaji);
          for (let i = 1; i + 1 < romaji.length; i += 3)
            texts.push(
              romaji.slice(0, i) +
                romaji[i + 1] +
                romaji[i] +
                romaji.slice(i + 2),
            );
        }
        for (const text of texts)
          for (const query of variants(text)) {
            same(query);
            count++;
          }
      }
      assert.ok(count > 1000, String(count));
      // A middle pair swapped leaves no pair of characters in common.
      assert.equal(first(books, "そりらす").book.title, "ソラリス");
      assert.equal(first(books, "そりらす").rank, MATCH.titleTypo);
      assert.equal(first(books, "ぎがんて").book.title, "銀河鉄道の夜");
      assert.equal(first(books, "闇左の手").book.title, "闇の左手");
    },
  );

  await check(
    "the gram index keeps few books, and a catalog stays quick",
    () => {
      // A varied catalog: titles of one to four words, half with a reading.
      const words = [
        ["人生", "ジンセイ"],
        ["物語", "モノガタリ"],
        ["あなた", "アナタ"],
        ["夜", "ヨル"],
        ["海", "ウミ"],
        ["猫", "ネコ"],
        ["時間", "ジカン"],
        ["旅", "タビ"],
        ["森", "モリ"],
        ["星", "ホシ"],
        ["記憶", "キオク"],
        ["言葉", "コトバ"],
        ["世界", "セカイ"],
        ["少年", "ショウネン"],
        ["手紙", "テガミ"],
        ["図書館", "トショカン"],
        ["春", "ハル"],
        ["夏", "ナツ"],
        ["秋", "アキ"],
        ["冬", "フユ"],
        ["雨", "アメ"],
        ["風", "カゼ"],
        ["雪", "ユキ"],
        ["山", "ヤマ"],
        ["川", "カワ"],
        ["街", "マチ"],
        ["駅", "エキ"],
        ["鳥", "トリ"],
        ["花", "ハナ"],
        ["月", "ツキ"],
        ["光", "ヒカリ"],
        ["影", "カゲ"],
        ["音", "オト"],
        ["色", "イロ"],
        ["夢", "ユメ"],
        ["窓", "マド"],
        ["庭", "ニワ"],
        ["父", "チチ"],
        ["母", "ハハ"],
        ["娘", "ムスメ"],
        ["友", "トモ"],
        ["王", "オウ"],
        ["魔女", "マジョ"],
        ["探偵", "タンテイ"],
        ["料理", "リョウリ"],
        ["数学", "スウガク"],
        ["哲学", "テツガク"],
        ["歴史", "レキシ"],
        ["戦争", "センソウ"],
        ["平和", "ヘイワ"],
        ["機械", "キカイ"],
        ["宇宙", "ウチュウ"],
        ["地図", "チズ"],
        ["名前", "ナマエ"],
        ["約束", "ヤクソク"],
        ["秘密", "ヒミツ"],
        ["ねこ", "ネコ"],
        ["さかな", "サカナ"],
        ["くじら", "クジラ"],
        ["ことり", "コトリ"],
      ];
      const joins = [
        ["の", "ノ"],
        ["と", "ト"],
        ["を", "ヲ"],
        ["に", "ニ"],
      ];
      let seed = 7;
      const pick = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return Math.floor(seed / 65536) % n;
      };
      const catalog: Book[] = [];
      for (let i = 0; i < 2000; i++) {
        let title = "";
        const reading: string[] = [];
        const count = 1 + pick(4);
        for (let j = 0; j < count; j++) {
          const [word, read] = words[pick(words.length)];
          title += word;
          reading.push(read);
          if (j < count - 1) {
            const [join, readJoin] = joins[pick(joins.length)];
            title += join;
            reading.push(readJoin);
          }
        }
        catalog.push(
          book({
            id: "catalog-" + i,
            title,
            author: "著者" + pick(500),
            ...(pick(2)
              ? {
                  titleReading: { text: reading.join(" "), source: "estimate" },
                }
              : {}),
            ...(pick(10) ? {} : { subtitle: words[pick(words.length)][0] }),
          }),
        );
      }
      catalog.push(...books);
      // Pruning is what keeps a query quick: it must leave most books unscored.
      const postings = postingsOf(catalog);
      for (const query of [
        "あなたのいのちの物語",
        "記憶の森の物語",
        "としょかんのねこ",
        "Anatanojinseinomonogatari",
        "ぎんがてつどう",
      ]) {
        const romaji = romajiToKana(query)?.kana ?? query;
        const kept = candidates(postings, [
          queryGrams(searchFold(romaji), kanaFold(romaji)),
        ]);
        assert.ok(
          kept.length < catalog.length / 10,
          `${query}: ${kept.length} of ${catalog.length}`,
        );
        assert.ok(
          searchBooks(catalog, query).every(
            (match) => kept.includes(match.book) || match.near,
          ),
          query,
        );
      }
      const queries = [
        "あなたのいのちの物語",
        "あなたの人生のものがたり",
        "Anatanojinseinomonogatari",
        "アナタノジンセイノモノガタリ",
        "あなたの人生の",
        "人生",
        "の物",
        "夜",
        "ぎんがてつどう",
        "ginga tetudou",
        "てっどちゃん",
        "チャン 物語",
        "つみとばつ 下",
        "量子力学",
        "あなたのじんせいのものがたい",
        "図書館の猫",
        "としょかんのねこ",
        "tosyokan",
        "言葉と記憶",
        "せかいのはて",
        "少年の旅",
        "ほし",
        "SF",
        "978-4-15",
        "宮澤賢治",
        "もり",
        "ジカン",
        "記憶の森の物語",
        "まじょのたっきゅうびん",
        "うちゅうのちず",
      ];
      // Fresh copies, so the keys are worked out again as on a first search.
      const fresh = catalog.map((entry) => ({ ...entry }));
      const started = performance.now();
      searchBooks(fresh, "warm");
      const build = performance.now() - started;
      const time = (unpruned: boolean) => {
        const begun = performance.now();
        for (let round = 0; round < 3; round++)
          for (const query of queries) searchBooks(fresh, query, { unpruned });
        return (performance.now() - begun) / (3 * queries.length);
      };
      const all = time(true);
      const each = time(false);
      console.log(
        `  index for ${fresh.length} books: ${build.toFixed(0)} ms; ` +
          `${each.toFixed(1)} ms per query (${all.toFixed(1)} ms scoring every book)`,
      );
      assert.ok(build < 800, "building took " + build);
      assert.ok(each < 15, "a query took " + each);
      // The index must be what keeps it quick, on any machine.
      assert.ok(each < all * 0.6, `${each} ms against ${all} ms`);
    },
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
