import {
  ME_ID,
  type Book,
  type Post,
  type Reader,
  type ReadingNow,
  type ReadingRecord,
  type Shelf,
  type ShelfItem,
  type Shop,
  type TownState,
} from "./types";
import type { Poster } from "./posters";
import { cleanVisibilities } from "./visibility";

// Every cover and spine is drawn by the app from these original design tokens.
// The summaries and shop-owner notes are original demo copy, not quoted text.
const catalog: Book[] = [
  {
    id: "solaris",
    title: "ソラリス",
    author: "スタニスワフ・レム",
    genre: "SF",
    summary:
      "遠い惑星を覆う海は、何を考えているのか。理解できない存在との遭遇を通して、人間の記憶と愛の輪郭を問い直す物語。",
    color: "#374d53",
    ink: "#f3ede1",
    height: 188,
    thickness: 34,
    pattern: 0,
  },
  {
    id: "left-hand",
    title: "闇の左手",
    author: "アーシュラ・K・ル＝グウィン",
    genre: "SF",
    summary:
      "性のあり方が異なる寒冷の惑星を訪れた使節。長い旅と対話のなかで、違いを越えて人を理解することの難しさと可能性に向き合う。",
    color: "#768281",
    ink: "#fff7e9",
    height: 202,
    thickness: 39,
    pattern: 1,
  },
  {
    id: "dispossessed",
    title: "所有せざる人々",
    author: "アーシュラ・K・ル＝グウィン",
    genre: "SF",
    summary:
      "二つの社会を行き来する物理学者の視点から、自由、所有、理想の共同体を考える。遠い世界の物語が、身近な社会の常識を揺らす。",
    color: "#ad704f",
    ink: "#fff7e9",
    height: 195,
    thickness: 42,
    pattern: 2,
  },
  {
    id: "fahrenheit",
    title: "華氏451度",
    author: "レイ・ブラッドベリ",
    genre: "SF",
    summary:
      "本が禁じられ、それを燃やすことが仕事になった社会。ひとりの男が出会いをきっかけに、言葉と考える時間を取り戻そうとする。",
    color: "#a34b3d",
    ink: "#fff2da",
    height: 184,
    thickness: 30,
    pattern: 3,
  },
  {
    id: "momo",
    title: "モモ",
    author: "ミヒャエル・エンデ",
    genre: "ファンタジー",
    summary:
      "人の話を聴くのが得意な少女モモと、時間を奪う灰色の男たち。忙しさの陰で失われてしまう、生活の豊かさを見つめる物語。",
    color: "#b18a51",
    ink: "#fff8e8",
    height: 200,
    thickness: 38,
    pattern: 1,
  },
  {
    id: "invisible-cities",
    title: "見えない都市",
    author: "イタロ・カルヴィーノ",
    genre: "海外文学",
    summary:
      "旅人が語る、どこにもないようで、どこかにある都市の数々。短い街の描写が、記憶、欲望、暮らすことの不思議を呼び起こす。",
    color: "#5d7967",
    ink: "#fff7e6",
    height: 181,
    thickness: 27,
    pattern: 2,
  },
  {
    id: "fictions",
    title: "伝奇集",
    author: "ホルヘ・ルイス・ボルヘス",
    genre: "海外文学",
    summary:
      "迷宮、架空の百科事典、無限の図書館。小さな物語の中に広がる巨大な問いを、読むたびに別の道から探検できる短編集。",
    color: "#665f72",
    ink: "#f8f1e4",
    height: 189,
    thickness: 31,
    pattern: 0,
  },
  {
    id: "walking",
    title: "散歩",
    author: "ローベルト・ヴァルザー",
    genre: "海外文学",
    summary:
      "町を歩く語り手が、店や人や風景に出会う。何気ない移動のあいだに、軽やかな言葉と、ふとした孤独が顔を出す。",
    color: "#bdbe99",
    ink: "#35443b",
    height: 170,
    thickness: 24,
    pattern: 3,
  },
  {
    id: "book-of-disquiet",
    title: "不安の書",
    author: "フェルナンド・ペソア",
    genre: "海外文学",
    summary:
      "暮らしの合間に書き留められた、夢、孤独、思索の断片。まとまらない心の動きを、そのままの形で読む一冊。",
    color: "#4f6976",
    ink: "#f6f1e8",
    height: 202,
    thickness: 40,
    pattern: 1,
  },
  {
    id: "hundred-years",
    title: "百年の孤独",
    author: "ガブリエル・ガルシア＝マルケス",
    genre: "海外文学",
    summary:
      "架空の町と、そこに生きる一族の長い時間。驚くような出来事も日々の営みも、同じ豊かな流れのなかで語られていく。",
    color: "#bc9b50",
    ink: "#fff8e8",
    height: 205,
    thickness: 43,
    pattern: 2,
  },
  {
    id: "lonely-hunter",
    title: "心は孤独な狩人",
    author: "カーソン・マッカラーズ",
    genre: "海外文学",
    summary:
      "小さな町で、それぞれに孤独を抱える人々。誰かに理解してほしいという願いと、そのすれ違いを静かに見つめる。",
    color: "#826f69",
    ink: "#fff3e3",
    height: 194,
    thickness: 38,
    pattern: 0,
  },
  {
    id: "old-man-sea",
    title: "老人と海",
    author: "アーネスト・ヘミングウェイ",
    genre: "海外文学",
    summary:
      "老いた漁師が、ひとりで大きな魚に挑む。海の上の簡潔な物語から、仕事、誇り、生きることの手触りが浮かぶ。",
    color: "#6e9092",
    ink: "#fff9e8",
    height: 171,
    thickness: 24,
    pattern: 3,
  },
  {
    id: "night-fog",
    title: "夜と霧",
    author: "ヴィクトール・E・フランクル",
    genre: "哲学・思想",
    summary:
      "苛酷な経験を記した証言から、人が生きる意味を考える。容易な答えではなく、ひとりひとりの生への問いを残す一冊。",
    color: "#565457",
    ink: "#f8f1df",
    height: 182,
    thickness: 28,
    pattern: 1,
  },
  {
    id: "ways-of-seeing",
    title: "イメージ",
    author: "ジョン・バージャー",
    genre: "哲学・思想",
    summary:
      "絵画や広告を見るとき、私たちは何を当たり前だと思っているのか。視線と社会の関係を問い直す、美術の入口になる一冊。",
    color: "#d3bfa5",
    ink: "#514e43",
    height: 204,
    thickness: 32,
    pattern: 2,
  },
  {
    id: "walden",
    title: "森の生活",
    author: "ヘンリー・D・ソロー",
    genre: "哲学・思想",
    summary:
      "湖のほとりの生活から、自然と社会、自分に必要なものを考える。遠い土地の記録を読みながら、日々の暮らしを見つめ直せる。",
    color: "#4f6c4f",
    ink: "#f8efd6",
    height: 195,
    thickness: 40,
    pattern: 0,
  },
  {
    id: "utopia",
    title: "ユートピア",
    author: "トマス・モア",
    genre: "哲学・思想",
    summary:
      "架空の島の制度や生活が、現実の社会への問いを生む。理想の世界を想像することと、そこに感じる違和感の両方を楽しめる。",
    color: "#9e835c",
    ink: "#fff5df",
    height: 180,
    thickness: 29,
    pattern: 3,
  },
  {
    id: "laozi",
    title: "老子",
    author: "老子",
    genre: "哲学・思想",
    summary:
      "強さや成功をめぐる常識から少し距離をとる、短い言葉の集まり。立ち止まって読み返すたびに、別の意味が見えてくる。",
    color: "#9ca788",
    ink: "#344133",
    height: 174,
    thickness: 25,
    pattern: 1,
  },
  {
    id: "poetics",
    title: "詩学",
    author: "アリストテレス",
    genre: "哲学・思想",
    summary:
      "物語や悲劇は、どのように人の心を動かすのか。作品の仕組みを考えるための問いを、遠い時代から届ける。",
    color: "#beaa82",
    ink: "#514632",
    height: 186,
    thickness: 27,
    pattern: 2,
  },
  {
    id: "galaxy-railroad",
    title: "銀河鉄道の夜",
    author: "宮沢賢治",
    genre: "日本文学",
    summary:
      "星々のあいだを走る列車で、少年たちが出会う風景。美しい幻想を通して、友だち、別れ、ほんとうの幸いを問いかける。",
    color: "#334b66",
    ink: "#f9efd7",
    height: 181,
    thickness: 29,
    pattern: 0,
  },
  {
    id: "ten-nights",
    title: "夢十夜",
    author: "夏目漱石",
    genre: "日本文学",
    summary:
      "十の夢が、不思議な論理で立ち上がる。短い場面の奥にある恐れや願いを、説明しきれないまま味わえる作品集。",
    color: "#8c6160",
    ink: "#fff3df",
    height: 175,
    thickness: 23,
    pattern: 3,
  },
  {
    id: "silence",
    title: "沈黙",
    author: "遠藤周作",
    genre: "日本文学",
    summary:
      "厳しい弾圧のもとで、信仰を守るとは何を意味するのか。苦しみのなかで選ぶこと、その選択を見つめることを問い続ける。",
    color: "#6b7568",
    ink: "#fff4de",
    height: 191,
    thickness: 33,
    pattern: 1,
  },
  {
    id: "stone-history",
    title: "石の来歴",
    author: "奥泉光",
    genre: "日本文学",
    summary:
      "戦争の記憶と日常の暮らしが、石をきっかけにつながっていく。遠い時間が手元のものに宿る、不思議な読み心地の小説。",
    color: "#99948a",
    ink: "#fff9e9",
    height: 179,
    thickness: 25,
    pattern: 2,
  },
  {
    id: "traveling-tree",
    title: "旅をする木",
    author: "星野道夫",
    genre: "エッセイ",
    summary:
      "アラスカの自然や、そこで暮らす人々との出会いを綴る。旅の風景を通して、異なる時間の流れに耳を澄ませる随筆集。",
    color: "#8b9b81",
    ink: "#fff9e6",
    height: 184,
    thickness: 30,
    pattern: 0,
  },
  {
    id: "secret-garden",
    title: "秘密の花園",
    author: "フランシス・ホジソン・バーネット",
    genre: "ファンタジー",
    summary:
      "閉ざされた庭を見つけた子どもたちが、少しずつ景色と自分を変えていく。手を動かし、誰かと関わる喜びが息づく物語。",
    color: "#688271",
    ink: "#fff4dc",
    height: 196,
    thickness: 37,
    pattern: 3,
  },
];

// Placeholder list prices (tax included) for the demo catalog. The UI labels them as provisional.
const demoPrices: Record<string, number> = {
  solaris: 1540,
  "left-hand": 1320,
  dispossessed: 1452,
  fahrenheit: 1100,
  momo: 880,
  "invisible-cities": 1045,
  fictions: 1012,
  walking: 2420,
  "book-of-disquiet": 3960,
  "hundred-years": 1375,
  "lonely-hunter": 1320,
  "old-man-sea": 693,
  "night-fog": 1980,
  "ways-of-seeing": 1650,
  walden: 1067,
  utopia: 1001,
  laozi: 935,
  poetics: 1078,
  "galaxy-railroad": 572,
  "ten-nights": 605,
  silence: 693,
  "stone-history": 726,
  "traveling-tree": 715,
  "secret-garden": 1045,
};
// How the demo titles and the Japanese authors' names are read, checked by
// hand, so a title written in kanji is found by its kana or its romaji.
// Titles written in kana are their own reading. は and を are written as
// usual, since a reading can be shown; the search hears them as わ and お.
const demoReadings: Record<string, { title: string; author?: string }> = {
  "left-hand": { title: "ヤミ ノ ヒダリテ" },
  dispossessed: { title: "ショユウ セザル ヒトビト" },
  fahrenheit: { title: "カシ ヨンヒャクゴジュウイチド" },
  "invisible-cities": { title: "ミエナイ トシ" },
  fictions: { title: "デンキシュウ" },
  walking: { title: "サンポ" },
  "book-of-disquiet": { title: "フアン ノ ショ" },
  "hundred-years": { title: "ヒャクネン ノ コドク" },
  "lonely-hunter": { title: "ココロ ハ コドク ナ カリュウド" },
  "old-man-sea": { title: "ロウジン ト ウミ" },
  "night-fog": { title: "ヨル ト キリ" },
  walden: { title: "モリ ノ セイカツ" },
  laozi: { title: "ロウシ", author: "ロウシ" },
  poetics: { title: "シガク" },
  "galaxy-railroad": {
    title: "ギンガ テツドウ ノ ヨル",
    author: "ミヤザワ, ケンジ",
  },
  "ten-nights": { title: "ユメ ジュウヤ", author: "ナツメ, ソウセキ" },
  silence: { title: "チンモク", author: "エンドウ, シュウサク" },
  "stone-history": { title: "イシ ノ ライレキ", author: "オクイズミ, ヒカル" },
  "traveling-tree": { title: "タビ ヲ スル キ", author: "ホシノ, ミチオ" },
  "secret-garden": { title: "ヒミツ ノ ハナゾノ" },
};
export const books: Book[] = catalog.map((book) => {
  const reading = demoReadings[book.id];
  return {
    ...book,
    price: demoPrices[book.id],
    ...(reading
      ? { titleReading: { text: reading.title, source: "sample" as const } }
      : {}),
    ...(reading?.author
      ? { authorReading: { text: reading.author, source: "sample" as const } }
      : {}),
  };
});

export const readers: Reader[] = [
  {
    id: "r-nagi",
    handle: "nagi",
    name: "凪",
    bio: "遠い惑星の話を読むと、いつもの帰り道が少し違って見えます。SFから、ときどき哲学へ。",
    color: "#536b6f",
    lifeNine: [
      "solaris",
      "left-hand",
      "dispossessed",
      "fahrenheit",
      "momo",
      "invisible-cities",
      "fictions",
      "galaxy-railroad",
      "night-fog",
    ],
    nineNotes: {
      solaris: "わからないまま、向き合うこと。",
      "left-hand": "長い旅のあとの静かな一頁。",
    },
  },
  {
    id: "r-sumire",
    handle: "sumire",
    name: "すみれ",
    bio: "翻訳の向こうに、まだ知らない暮らしを探しています。散歩のように読むのが好き。",
    color: "#957568",
    lifeNine: [
      "invisible-cities",
      "walking",
      "book-of-disquiet",
      "hundred-years",
      "lonely-hunter",
      "fictions",
      "momo",
      "old-man-sea",
      "traveling-tree",
    ],
    nineNotes: {
      walking: "街も文章も、遠回りが好き。",
      "invisible-cities": "読み返すたび、別の街に着く。",
    },
  },
  {
    id: "r-tou",
    handle: "akari",
    name: "灯",
    bio: "答えを急がず、問いを持って帰れる本を。専門家ではありません。ひとつの言葉をゆっくり考えたい。",
    color: "#817851",
    lifeNine: [
      "night-fog",
      "laozi",
      "walden",
      "utopia",
      "poetics",
      "ways-of-seeing",
      "momo",
      "solaris",
      "silence",
    ],
    nineNotes: {
      "night-fog": "読む時期によって残る問いが変わる。",
      laozi: "力を抜きたい夜に。",
    },
  },
  {
    id: "r-haru",
    handle: "haru",
    name: "はる",
    bio: "ジャンルの境目を気にしない、小さな本棚。旅、物語、庭と、読み終えたあとに残るもの。",
    color: "#63806d",
    lifeNine: [
      "momo",
      "galaxy-railroad",
      "traveling-tree",
      "ten-nights",
      "stone-history",
      "secret-garden",
    ],
    nineNotes: {
      momo: "時間を取り戻したくなったら。",
      "traveling-tree": "忙しい日に、遠い風を。",
    },
  },
  {
    id: "r-shiori",
    handle: "shiori",
    name: "栞",
    bio: "美術と文章のあいだを行ったり来たり。見慣れたものを、もう一度見てみるための選書です。",
    color: "#987578",
    lifeNine: [
      "ways-of-seeing",
      "invisible-cities",
      "fictions",
      "poetics",
      "walking",
    ],
    nineNotes: { "ways-of-seeing": "見ることにも、癖がある。" },
  },
  {
    id: "r-sou",
    handle: "sou",
    name: "蒼",
    bio: "一冊を何年もかけて読むことがあります。小説のなかの声と、日々の静けさが好きです。",
    color: "#627988",
    lifeNine: [
      "lonely-hunter",
      "silence",
      "night-fog",
      "old-man-sea",
      "stone-history",
      "book-of-disquiet",
    ],
    nineNotes: { "lonely-hunter": "わかり合えなさも、抱えたまま。" },
  },
];

const item = (
  id: string,
  bookId: string,
  display: ShelfItem["display"],
  pop: string,
): ShelfItem => ({ id, bookId, display, pop });
const shelf = (
  id: string,
  name: string,
  items: ShelfItem[],
  board?: Shelf["board"],
): Shelf => ({
  id,
  name,
  capacity: 20,
  items,
  isPublic: true,
  ...(board ? { board } : {}),
});

export const shops: Shop[] = [
  {
    id: "shop-orbit",
    ownerId: "r-nagi",
    name: "軌道書房",
    description:
      "遠い星から、私たちの暮らしを眺め直す。SFの隣には、答えのない問いを置いています。",
    tagline: "地球を少し離れてみる。",
    theme: "ink",
    followers: 24,
    demo: true,
    shelves: [
      shelf(
        "orbit-unknown",
        "わからないものと暮らす",
        [
          item(
            "o1",
            "solaris",
            "face",
            "異星人の話を読むつもりが、自分の記憶に出会ってしまう。わからない相手を、わからないまま大切にできるだろうか。",
          ),
          item(
            "o2",
            "left-hand",
            "spine",
            "「当たり前」がほどけていく旅。寒さの描写まで、長く残っています。",
          ),
          item(
            "o3",
            "fictions",
            "spine",
            "小さな本の中に、無限の部屋。地図のない読書をどうぞ。",
          ),
          item(
            "o4",
            "galaxy-railroad",
            "spine",
            "星を見上げた帰り道に、もう一度。",
          ),
          item(
            "o5",
            "night-fog",
            "spine",
            "遠い星から戻ったあと、人間の足元を見つめるために。",
          ),
        ],
        { title: "星の本", doodle: "stars" },
      ),
      shelf(
        "orbit-society",
        "別の社会を想像する",
        [
          item(
            "o6",
            "dispossessed",
            "face",
            "理想の社会にも、暮らす人がいる。その摩擦を飛ばさないところが好きです。",
          ),
          item(
            "o7",
            "fahrenheit",
            "spine",
            "本を読む時間を、手放さずにいたい。",
          ),
          item(
            "o8",
            "utopia",
            "spine",
            "「よい社会」の話に、なぜ少し怖さを感じるんだろう。",
          ),
          item("o9", "momo", "spine", "時計より遠くへ、時間の旅に出る一冊。"),
        ],
        { title: "社会の本", doodle: "city" },
      ),
      shelf(
        "orbit-deep-time",
        "長い時間を旅する",
        [
          item(
            "o10",
            "stone-history",
            "face",
            "手のひらの石から、気の遠くなる時間が立ちのぼる。宇宙の話より遠くへ行けました。",
          ),
          item(
            "o11",
            "hundred-years",
            "spine",
            "百年を一気に眺めると、ひとつの惑星の歴史みたいに見えてきます。",
          ),
          item(
            "o12",
            "ten-nights",
            "spine",
            "夢の中の時間は、時計では測れない。",
          ),
          item(
            "o13",
            "invisible-cities",
            "spine",
            "どの都市も、遠い未来のどこかにありそうで。",
          ),
        ],
        { title: "時の本", doodle: "forest" },
      ),
    ],
  },
  {
    id: "shop-rain",
    ownerId: "r-sumire",
    name: "雨と翻訳",
    description:
      "知らない国の言葉で、知っている気持ちに出会う。雨の日に寄り道したくなる、翻訳文学の小さな店。",
    tagline: "まだ知らない街に、一頁。",
    theme: "sage",
    followers: 11,
    demo: true,
    shelves: [
      shelf(
        "rain-cities",
        "どこにもない街の地図",
        [
          item(
            "r1",
            "invisible-cities",
            "face",
            "一つずつ読んでも、順番を飛ばしても。今夜のあなたに似た街があるかもしれません。",
          ),
          item(
            "r2",
            "walking",
            "spine",
            "目的のない散歩も、ちゃんと一日の出来事です。",
          ),
          item(
            "r3",
            "book-of-disquiet",
            "spine",
            "眠れない夜に、まとまらない言葉の居場所を。",
          ),
          item(
            "r4",
            "hundred-years",
            "spine",
            "家族の時間と、町の時間。大きな流れに身を任せて読みました。",
          ),
          item(
            "r5",
            "solaris",
            "spine",
            "翻訳で読む、理解の届かなさ。異なる世界に触れる入口として。",
          ),
        ],
        { title: "街の本", doodle: "city" },
      ),
      shelf(
        "rain-listening",
        "誰かの声を聴く",
        [
          item(
            "r6",
            "lonely-hunter",
            "face",
            "誰かに話したい気持ちを、こんなにも丁寧に描く物語。",
          ),
          item(
            "r7",
            "old-man-sea",
            "spine",
            "短い言葉の間に、海の広さを感じます。",
          ),
          item(
            "r8",
            "momo",
            "spine",
            "うまく話せない日にも、聴いてくれる人がいたら。",
          ),
          item(
            "r9",
            "fictions",
            "spine",
            "言葉が作った世界を、どこまで信じられるでしょう。",
          ),
        ],
        { title: "声の本", doodle: "daily" },
      ),
      shelf(
        "rain-letters",
        "遠い国の手紙のように",
        [
          item(
            "r10",
            "walden",
            "face",
            "湖のほとりの一年を、そっと訳してもらうような読書。雨音とよく合います。",
          ),
          item(
            "r11",
            "secret-garden",
            "spine",
            "閉ざされた庭がひらくまでの、季節の手ざわり。",
          ),
          item(
            "r12",
            "left-hand",
            "spine",
            "雪の惑星の長い旅。訳された言葉が、冷たく澄んでいます。",
          ),
          item(
            "r13",
            "night-fog",
            "spine",
            "遠い国の記録を、自分の言葉で受けとめたくなる。",
          ),
        ],
        { title: "手紙の本", doodle: "travel" },
      ),
    ],
  },
  {
    id: "shop-question",
    ownerId: "r-tou",
    name: "問いの余白",
    description:
      "哲学は、難しい顔をするためではなく、いつもの景色を見直すために。読後の問いも一緒に並べています。",
    tagline: "答えより、持ち帰りたい問い。",
    theme: "ochre",
    followers: 7,
    demo: true,
    shelves: [
      shelf(
        "question-time",
        "生きる時間を考える",
        [
          item(
            "q1",
            "night-fog",
            "face",
            "この本から簡単な結論は持ち帰れませんでした。だから今も、棚の目に入る場所に置いています。",
          ),
          item(
            "q2",
            "momo",
            "spine",
            "自分の時間は、本当に自分のものだろうか。",
          ),
          item("q3", "laozi", "spine", "前に進むことばかり考えている日に。"),
          item(
            "q4",
            "walden",
            "spine",
            "何を減らせば、自分の生活が見えてくるのか。",
          ),
          item(
            "q5",
            "silence",
            "spine",
            "選択を、他人の目だけで裁けるだろうか。",
          ),
        ],
        { title: "時間の本", doodle: "lamp" },
      ),
      shelf(
        "question-seeing",
        "ものの見方の入口",
        [
          item(
            "q6",
            "ways-of-seeing",
            "face",
            "絵の見方の本だけれど、普段の視線まで変わってしまう。",
          ),
          item(
            "q7",
            "poetics",
            "spine",
            "「なぜ面白い？」を考え始めたい人へ。",
          ),
          item(
            "q8",
            "utopia",
            "spine",
            "理想を描く手つきにも、その時代がある。",
          ),
          item(
            "q9",
            "solaris",
            "spine",
            "SFの棚から借りてきた、他者をめぐる問い。",
          ),
        ],
        { title: "見方の本", doodle: "city" },
      ),
      shelf(
        "question-doubt",
        "読むことを疑ってみる",
        [
          item(
            "q10",
            "fictions",
            "face",
            "読んでいるこの本も、誰かの作り話かもしれない。疑う楽しさの入口です。",
          ),
          item(
            "q11",
            "fahrenheit",
            "spine",
            "考える時間を手放したら、何が残るだろう。",
          ),
          item(
            "q12",
            "book-of-disquiet",
            "spine",
            "答えの出ない日々を、そのまま書き留めていい。",
          ),
        ],
        { title: "問いの本", doodle: "stars" },
      ),
    ],
  },
  {
    id: "shop-window",
    ownerId: "r-haru",
    name: "窓辺の栞",
    description:
      "気がつくと違うジャンルの本が隣り合う、雑多な本棚。読む前より少し、外を歩きたくなる本を。",
    tagline: "今日の寄り道に、似合う本。",
    theme: "sage",
    followers: 5,
    demo: true,
    shelves: [
      shelf(
        "window-breath",
        "ひと息つくための本",
        [
          item(
            "w1",
            "momo",
            "face",
            "子どもの頃より、大人になってから必要になった一冊。急いでいるときほど、ゆっくりどうぞ。",
          ),
          item(
            "w2",
            "traveling-tree",
            "spine",
            "ここにいながら、遠い風を感じられる。",
          ),
          item(
            "w3",
            "walking",
            "spine",
            "読み終えたら、目的なしに一駅ぶん歩いてみたい。",
          ),
          item("w4", "laozi", "spine", "短い言葉を、一日ひとつ。"),
          item(
            "w5",
            "old-man-sea",
            "spine",
            "静かな集中の時間がほしいときに。",
          ),
        ],
        { title: "ひと息", doodle: "daily" },
      ),
      shelf(
        "window-night",
        "夜、少しだけ遠くへ",
        [
          item(
            "w6",
            "galaxy-railroad",
            "face",
            "夜空を見たあとに、帰ってきたくなる物語。",
          ),
          item(
            "w7",
            "ten-nights",
            "spine",
            "意味を探しすぎず、夢の景色を眺める。",
          ),
          item(
            "w8",
            "stone-history",
            "spine",
            "手のひらの石に、想像もしない時間がある。",
          ),
          item(
            "w9",
            "secret-garden",
            "spine",
            "庭が動き出すときの、あの気配。",
          ),
        ],
        { title: "夜の本", doodle: "stars" },
      ),
      shelf(
        "window-outside",
        "外を歩きたくなる",
        [
          item(
            "w10",
            "walden",
            "face",
            "森の小屋の一年を読むと、近所の公園まで遠回りしたくなります。",
          ),
          item(
            "w11",
            "invisible-cities",
            "spine",
            "知らない街の話を、窓辺でひとつずつ。",
          ),
          item(
            "w12",
            "ways-of-seeing",
            "spine",
            "見慣れた通りの看板まで、少し違って見える。",
          ),
          item(
            "w13",
            "lonely-hunter",
            "spine",
            "小さな町の人たちの声に、耳をすませる。",
          ),
        ],
        { title: "散歩の本", doodle: "garden" },
      ),
    ],
  },
  {
    id: "shop-frame",
    ownerId: "r-shiori",
    name: "額縁のない本屋",
    description:
      "絵を見ること、街を見ること、言葉を見ること。ジャンルを隔てず、見る目が変わる本を集めています。",
    tagline: "見慣れたものに、もう一度。",
    theme: "rose",
    followers: 3,
    demo: true,
    shelves: [
      shelf(
        "frame-view",
        "見る、ということ",
        [
          item(
            "f1",
            "ways-of-seeing",
            "face",
            "日々の広告まで、ゆっくり見直したくなりました。",
          ),
          item(
            "f2",
            "invisible-cities",
            "spine",
            "形のない街を、頭の中で描いてみる。",
          ),
          item(
            "f3",
            "poetics",
            "spine",
            "作品を楽しむことと、仕組みを考えることは、一緒にできる。",
          ),
          item(
            "f4",
            "fictions",
            "spine",
            "本そのものを疑ってみる、愉快な入口。",
          ),
        ],
        { title: "見る本", doodle: "city" },
      ),
      shelf(
        "frame-small",
        "小さな風景を拾う",
        [
          item(
            "f5",
            "walking",
            "face",
            "通り過ぎるだけだったものに、目が留まる。",
          ),
          item("f6", "traveling-tree", "spine", "写真の外側の時間を、文章で。"),
          item(
            "f7",
            "ten-nights",
            "spine",
            "たった一場面が、何年も残ることがある。",
          ),
          item(
            "f8",
            "secret-garden",
            "spine",
            "景色を手で変えていく、その喜び。",
          ),
        ],
        { title: "風景の本", doodle: "travel" },
      ),
      shelf(
        "frame-color",
        "色と光をたどる",
        [
          item(
            "f9",
            "galaxy-railroad",
            "face",
            "車窓に流れる光の色を、言葉だけでこんなに見せてくれる。",
          ),
          item(
            "f10",
            "stone-history",
            "spine",
            "石の模様に、ひとつの風景が眠っている。",
          ),
          item(
            "f11",
            "old-man-sea",
            "spine",
            "海の青さを、何度も思い浮かべながら読みました。",
          ),
          item(
            "f12",
            "momo",
            "spine",
            "時間の花の色を、ずっと想像しています。",
          ),
        ],
        { title: "光の本", doodle: "stars" },
      ),
    ],
  },
  {
    id: "shop-lamplight",
    ownerId: "r-sou",
    name: "小さな灯り",
    description:
      "急がず、少しずつ読むための場所。孤独をすぐに解決しない本にも、そばにいてもらっています。",
    tagline: "ひとりの夜にも、言葉がある。",
    theme: "ink",
    followers: 2,
    demo: true,
    shelves: [
      shelf(
        "lamp-voices",
        "伝えきれない気持ち",
        [
          item(
            "l1",
            "lonely-hunter",
            "face",
            "誰もが、別の言葉で同じ寂しさを抱えているのかもしれない。",
          ),
          item(
            "l2",
            "silence",
            "spine",
            "言葉にできない選択のそばに、長く立っていたくなる。",
          ),
          item(
            "l3",
            "night-fog",
            "spine",
            "ひとりで読んでから、誰かと話したくなった本です。",
          ),
          item(
            "l4",
            "solaris",
            "spine",
            "相手を理解したい気持ちの、危うさと切実さ。",
          ),
        ],
        { title: "声の本", doodle: "daily" },
      ),
      shelf(
        "lamp-slow",
        "ゆっくり戻ってくる本",
        [
          item(
            "l5",
            "book-of-disquiet",
            "face",
            "最初から最後へ急がず、気になる頁を開いています。",
          ),
          item(
            "l6",
            "old-man-sea",
            "spine",
            "たったひとりでいる時間が、こんなに豊かだなんて。",
          ),
          item("l7", "stone-history", "spine", "記憶は直線では戻ってこない。"),
          item("l8", "walden", "spine", "日々の音を、もう一度よく聴くために。"),
        ],
        { title: "ゆっくり", doodle: "lamp" },
      ),
      shelf(
        "lamp-night",
        "眠れない夜のそばに",
        [
          item(
            "l9",
            "ten-nights",
            "face",
            "眠れない夜は、ひと晩にひとつだけ。短い夢が、灯りの代わりになります。",
          ),
          item(
            "l10",
            "galaxy-railroad",
            "spine",
            "夜の向こうへ走る汽車に、少しだけ乗せてもらう。",
          ),
          item(
            "l11",
            "laozi",
            "spine",
            "がんばらなくていい、と静かに言われる気がする。",
          ),
          item(
            "l12",
            "traveling-tree",
            "spine",
            "遠くの夜空の下にも、誰かの暮らしがある。",
          ),
        ],
        { title: "夜の本", doodle: "forest" },
      ),
    ],
  },
];

const post = (
  id: string,
  authorId: string,
  createdAt: string,
  body: string,
  extra: Partial<
    Pick<Post, "bookId" | "spoiler" | "parentId" | "readingMode">
  > & {
    likes?: number;
    wants?: number;
  } = {},
): Post => ({
  id,
  authorId,
  body,
  bookId: extra.bookId ?? null,
  spoiler: extra.spoiler ?? false,
  parentId: extra.parentId ?? null,
  createdAt,
  likes: extra.likes ?? 0,
  wants: extra.wants ?? 0,
  readingMode: extra.readingMode ?? null,
});

// Original demo posts by the fictional readers. Spoiler-marked posts stay vague on purpose.
export const posts: Post[] = [
  post(
    "p-1",
    "r-nagi",
    "2026-10-10T09:12:00+09:00",
    "『ソラリス』を十年ぶりに再読。わからないものを、わからないまま見つめ続ける話だと思っていたけれど、今回は「わかってほしい」と願う側の話に読めた。読むたびに、こちらが試されている気がする。 #再読",
    { bookId: "solaris", likes: 12, wants: 4 },
  ),
  post(
    "p-2",
    "r-sumire",
    "2026-10-10T08:40:00+09:00",
    "朝の電車で、隣の人が文庫に紙のカバーをかけて読んでいた。何の本だったんだろう。気になって、二駅乗り過ごした。 #電車読書",
    { likes: 21 },
  ),
  post(
    "p-3",
    "r-haru",
    "2026-10-09T22:05:00+09:00",
    "『旅をする木』を読むと、遠くへ行かなくても旅はできるんだと思える。寝る前に一編ずつ。季節がひとつ進むたびに、また最初から読みたくなる本。 #寝る前の一冊",
    { bookId: "traveling-tree", likes: 9, wants: 3 },
  ),
  post(
    "p-4",
    "r-tou",
    "2026-10-09T20:30:00+09:00",
    "『夜と霧』は、読み終えたというより、まだ読んでいる途中だと感じる本です。答えが書いてあるのではなく、問いを手渡される。重い本だと構えずに、まず最初の数ページだけでも。",
    { bookId: "night-fog", likes: 15, wants: 6 },
  ),
  post(
    "p-5",
    "r-sou",
    "2026-10-09T18:10:00+09:00",
    "積読が二十冊を超えた。今週は一冊も買わない、と書いておく。（たぶん） #積読",
    { likes: 33 },
  ),
  post(
    "p-6",
    "r-shiori",
    "2026-10-09T12:45:00+09:00",
    "美術館の帰りに『イメージ』を開いたら、さっき見た絵がまったく違って見えてきた。見ることは、思っていたよりずっと能動的な行為なのかもしれない。 #美術館帰り",
    { bookId: "ways-of-seeing", likes: 8, wants: 2 },
  ),
  post(
    "p-7",
    "r-nagi",
    "2026-10-08T23:20:00+09:00",
    "『闇の左手』、最後の数章を読んだ夜は眠れなかった。旅の終わりにふたりが交わす言葉と、そのあとに残された沈黙の重さ。冒頭の報告書の書き方まで、意味が変わって見える。",
    { bookId: "left-hand", spoiler: true, likes: 6 },
  ),
  post(
    "p-8",
    "r-sumire",
    "2026-10-08T21:00:00+09:00",
    "『見えない都市』は、どこから開いてもいい本。今日は旅先の宿で、目についた都市をひとつだけ読んだ。地図のない街を歩いているみたいで、続きは明日の自分にとっておく。 #旅先の本 #寝る前の一冊",
    { bookId: "invisible-cities", likes: 11, wants: 5 },
  ),
  post(
    "p-9",
    "r-haru",
    "2026-10-08T19:30:00+09:00",
    "『銀河鉄道の夜』の結末、子どもの頃は寂しいだけだった。大人になって読み返したら、あの終わり方でなければいけなかった理由が、少しだけわかった気がする。",
    { bookId: "galaxy-railroad", spoiler: true, likes: 14 },
  ),
  post(
    "p-10",
    "r-tou",
    "2026-10-08T07:50:00+09:00",
    "早起きして、コーヒーと『老子』を少し。ほんの数行で、一日のペースがゆっくりになる。 #朝読書",
    { bookId: "laozi", likes: 7, wants: 1 },
  ),
  // Conversations inside reviews.
  post(
    "p-1-r1",
    "r-tou",
    "2026-10-10T09:40:00+09:00",
    "「わかってほしいと願う側の話」、すごく腑に落ちました。初めて読んだときは、海の描写の長さに戸惑ったのを覚えています。",
    { parentId: "p-1", likes: 3 },
  ),
  post(
    "p-1-r2",
    "r-nagi",
    "2026-10-10T10:05:00+09:00",
    "あの長さが、再読だと心地よくなるんです。これが好きなら、こちらも。わからなさと一緒に旅をする本です。",
    { parentId: "p-1", bookId: "left-hand", likes: 4 },
  ),
  post(
    "p-4-r1",
    "r-sou",
    "2026-10-09T21:15:00+09:00",
    "わたしも何年もかけて、少しずつ読んでいます。急がなくていい本だと言ってもらえると、手に取りやすくなりますね。",
    { parentId: "p-4", likes: 2 },
  ),
  post(
    "p-8-r1",
    "r-shiori",
    "2026-10-08T22:10:00+09:00",
    "旅先で一都市ずつ、素敵な読み方。わたしは美術館のベンチで読むことが多いです。",
    { parentId: "p-8", likes: 2 },
  ),
  post(
    "p-7-r1",
    "r-sumire",
    "2026-10-09T07:30:00+09:00",
    "最後の場面のあとで最初の章に戻ると、語り手の距離感がまるで違って感じられますよね。わたしも読み返しました。",
    { parentId: "p-7", spoiler: true, likes: 1 },
  ),
  // Memos written while reading together. They are ordinary public posts with a reading badge.
  post(
    "p-m1",
    "r-nagi",
    "2026-10-10T21:18:00+09:00",
    "読書中。海の描写のところで、いつも少しだけページをめくる手がゆっくりになる。",
    { bookId: "solaris", readingMode: "together", likes: 5 },
  ),
  post(
    "p-m2",
    "r-haru",
    "2026-10-10T21:32:00+09:00",
    "凪さんと同じ本を、同じ夜に。初めて読むので、まだ序盤です。",
    { bookId: "solaris", readingMode: "together", likes: 3 },
  ),
  post(
    "p-m3",
    "r-sou",
    "2026-10-10T20:55:00+09:00",
    "今夜は三十ページだけと決めて開いた。静かな場面がつづいて、時計の音がよく聞こえる。 #夜の読書",
    { bookId: "silence", readingMode: "together", likes: 4 },
  ),
  post(
    "p-m4",
    "r-sumire",
    "2026-10-10T21:40:00+09:00",
    "寝る前にひとつだけ、と思った都市がもう三つ目。",
    { bookId: "invisible-cities", readingMode: "together", likes: 6 },
  ),
];

// Demo readers who chose to read together. Times count back from when the page opens.
export const readingNow: ReadingNow[] = [
  { readerId: "r-nagi", bookId: "solaris", minutesAgo: 34 },
  { readerId: "r-haru", bookId: "solaris", minutesAgo: 12 },
  { readerId: "r-sou", bookId: "silence", minutesAgo: 58 },
  { readerId: "r-sumire", bookId: "invisible-cities", minutesAgo: 6 },
];

// What demo readers felt when they finished a book. Fictional, like the readers.
export const readingRecords: ReadingRecord[] = [
  {
    id: "record-nagi-solaris",
    readerId: "r-nagi",
    bookId: "solaris",
    feelings: ["quiet", "again", "talk"],
    note: "海の描写を読むたび、わからないものと暮らす練習をしている気がする。",
    spoiler: false,
    audience: "everyone",
    createdAt: "2026-10-02T22:10:00Z",
  },
  {
    id: "record-haru-solaris",
    readerId: "r-haru",
    bookId: "solaris",
    feelings: ["sleepless", "shaken", "talk"],
    note: "",
    spoiler: false,
    audience: "everyone",
    createdAt: "2026-10-05T01:40:00Z",
  },
  {
    id: "record-sumire-cities",
    readerId: "r-sumire",
    bookId: "invisible-cities",
    feelings: ["lingering", "again"],
    note: "どの都市も、どこかで見たことがある。",
    spoiler: false,
    audience: "everyone",
    createdAt: "2026-10-06T12:00:00Z",
  },
  {
    id: "record-sou-silence",
    readerId: "r-sou",
    bookId: "silence",
    feelings: ["cried", "shaken", "recommend"],
    note: "",
    spoiler: false,
    audience: "everyone",
    createdAt: "2026-10-08T21:30:00Z",
  },
  {
    id: "record-tou-galaxy",
    readerId: "r-tou",
    bookId: "galaxy-railroad",
    feelings: ["warm", "cried", "again"],
    note: "子どものころと、読み終えたあとの気持ちが違った。",
    spoiler: false,
    audience: "everyone",
    createdAt: "2026-10-09T23:05:00Z",
  },
  {
    id: "record-shiori-momo",
    readerId: "r-shiori",
    bookId: "momo",
    feelings: ["warm", "recommend", "talk"],
    note: "",
    spoiler: false,
    audience: "everyone",
    createdAt: "2026-10-10T09:15:00Z",
  },
];

// Posters the demo readers made. Their words are original demo copy.
const poster = (
  id: string,
  authorId: string,
  createdAt: string,
  fields: Pick<Poster, "template" | "theme" | "font" | "pages"> &
    Partial<Pick<Poster, "spoiler" | "inTimeline">>,
): Poster => ({
  id,
  authorId,
  spoiler: false,
  inTimeline: true,
  status: "published",
  createdAt,
  updatedAt: createdAt,
  ...fields,
});

export const posters: Poster[] = [
  poster("poster-nagi-night-sf", "r-nagi", "2026-10-08T23:40:00+09:00", {
    template: "lineup",
    theme: "navy",
    font: "mincho",
    pages: [
      {
        heading: "眠れない夜に読んだSF",
        text: "どれも遠い星の話なのに、読み終えると自分の部屋の話だった。",
        bookIds: ["solaris", "left-hand", "dispossessed", "fahrenheit"],
      },
    ],
  }),
  poster("poster-sumire-weekend", "r-sumire", "2026-10-09T10:20:00+09:00", {
    template: "one_book",
    theme: "kinari",
    font: "mincho",
    pages: [
      {
        heading: "旅に出られない週末に",
        text: "ひとつの章がひとつの都市。寝る前に一つずつ読むと、知らない街の夢を見る。地図にない場所ばかりなのに、どの都市にも見覚えがある。それが不思議で、何度も開いてしまう。",
        bookIds: ["invisible-cities"],
      },
      {
        heading: "そして、近所を歩く",
        text: "遠くへ行けない日は、この本を持って近所を歩く。いつもの角が、少しだけ物語になる。",
        bookIds: ["walking"],
      },
    ],
  }),
  poster("poster-shiori-look-again", "r-shiori", "2026-10-12T08:45:00+09:00", {
    template: "lineup",
    theme: "wakakusa",
    font: "gothic",
    pages: [
      {
        heading: "見慣れたものを、もう一度",
        text: "美術館に行けない日の、目の散歩に。",
        bookIds: ["ways-of-seeing", "walden", "traveling-tree"],
      },
    ],
  }),
  poster("poster-sou-slow", "r-sou", "2026-10-11T21:30:00+09:00", {
    template: "text",
    theme: "sumi",
    font: "mincho",
    inTimeline: false,
    pages: [
      {
        heading: "一冊を、何年もかけて読む",
        text: "急いで読まなくていい本がある。三ページ読んで閉じ、季節がひとつ変わってから続きを開く。そのあいだに自分が少し変わっていて、同じ文が違って聞こえる。\n\n読み終えることより、読みかけのまま一緒に暮らすことのほうが、大事な本もある。",
        bookIds: [],
      },
    ],
  }),
  poster("poster-haru-last-page", "r-haru", "2026-10-10T15:05:00+09:00", {
    template: "one_book",
    theme: "kosho",
    font: "mincho",
    spoiler: true,
    pages: [
      {
        heading: "最後のページについて",
        text: "読み終えたあと、最初の一行に戻りたくなった。百年分の名前が、最後の一ページで一度にほどけていく。あの結び方を知ってから読み返すと、すべての場面が違って見える。",
        bookIds: ["hundred-years"],
      },
    ],
  }),
];

export function createInitialState(): TownState {
  return structuredClone({
    books,
    readers,
    shops,
    me: {
      id: ME_ID,
      handle: "reader",
      name: "あなた",
      bio: "好きな本から、あなたの小さな書店を。",
      color: "#68816a",
      lifeNine: ["momo", "solaris", "galaxy-railroad", "traveling-tree"],
      nineNotes: {},
    },
    ownShop: null,
    following: [],
    blocked: [],
    wishlist: [],
    favorites: [],
    popReactions: {},
    posts,
    likedPosts: [],
    likeTaps: {},
    wantedPosts: [],
    spoilerReports: [],
    readingNow,
    readingSessions: [],
    finishedBooks: [],
    library: [],
    libraryEntries: {},
    libraryShelves: [],
    libraryShelfBooks: [],
    encounters: [],
    readingRecords,
    // Records stay the reader's own until they choose to publish them.
    settings: {
      composeIcon: "pen",
      visibility: cleanVisibilities(null),
      shelfAudiences: {},
      spoilerDisplay: "fold_possible",
      memoHint: true,
    },
    seenNotifications: [],
    shopMessages: [],
    reviewFolds: {},
    myReports: [],
    posters,
  });
}

// Stable references for App Router static params and SSR hydration.
export const demoBooks = books;
export const demoReaders = readers;
export const demoShops = shops;
export const demoPosts = posts;
export const demoReadingRecords = readingRecords;
export const demoPosters = posters;
export const seedState = createInitialState();
