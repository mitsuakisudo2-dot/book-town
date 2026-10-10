import type { BookLink, Follow, Post, PostImage, Reaction } from "./types";

// Fictional posts by the six demo readers. Every like, "読みたくなった" and follow below comes
// from one of those same readers, so counts never imply a crowd that does not exist.
// Posts about books are original impressions, not quotations, and avoid concrete plot facts.

const image = (src: string, alt: string): PostImage => ({
  src,
  alt,
  width: 1200,
  height: 900,
});
const book = (bookId: string, purpose: BookLink["purpose"]): BookLink => ({
  bookId,
  purpose,
});

function post(
  id: string,
  authorId: string,
  createdAt: string,
  text: string,
  extra: Partial<Pick<Post, "images" | "book" | "spoiler">> = {},
): Post {
  return {
    id,
    authorId,
    createdAt,
    text,
    images: extra.images ?? [],
    book: extra.book ?? null,
    spoiler: extra.spoiler ?? false,
    reply: null,
    demo: true,
  };
}

function reply(
  id: string,
  authorId: string,
  createdAt: string,
  parentId: string,
  rootId: string,
  text: string,
  extra: Partial<Pick<Post, "book" | "spoiler">> = {},
): Post {
  return {
    ...post(id, authorId, createdAt, text, extra),
    reply: { rootId, parentId },
  };
}

export const demoPosts: Post[] = [
  post(
    "haru-lamp",
    "r-haru",
    "2026-10-10T12:40:00.000Z",
    "読書灯を新しくしました。電球色で、手元だけがふわっと明るい。夜に一章だけ読む習慣が戻ってきそうです。",
    {
      images: [
        image("/demo/reading-lamp.svg", "机の上の読書灯と、開いた本のイラスト"),
      ],
    },
  ),
  post(
    "tou-solaris",
    "r-tou",
    "2026-10-10T09:15:00.000Z",
    "『ソラリス』を読み終えました。わからないものを、わからないまま置いておく勇気について考えています。理解できない相手を前にすると、つい自分の言葉で埋めてしまう。その癖に気づかされる本でした。",
    { book: book("solaris", "review") },
  ),
  post(
    "sou-not-reading",
    "r-sou",
    "2026-10-10T03:20:00.000Z",
    "最近ぜんぜん読めていません。鞄に入れたまま一週間。でも本屋に寄ると、やっぱり落ち着く。読めない時期も、読書家でいたい。",
  ),
  post(
    "sumire-hundred",
    "r-sumire",
    "2026-10-09T13:05:00.000Z",
    "『百年の孤独』、家系図を自分で書きながら読み始めました。まだ序盤なので感想はもう少し先に。同じ名前が多くて、紙が足りない。",
    { book: book("hundred-years", "mention") },
  ),
  post(
    "nagi-solaris-ending",
    "r-nagi",
    "2026-10-09T11:30:00.000Z",
    "最後の数ページの選択を、初めて読んだときは受け入れられなかった。十年ぶりに読み返して、あれは諦めではなく、待つことを選んだのだと思えた。読み終えた人と話したいです。",
    { book: book("solaris", "review"), spoiler: true },
  ),
  post(
    "shiori-tsundoku",
    "r-shiori",
    "2026-10-08T08:00:00.000Z",
    "今月の積読。背表紙の色がきれいに並んだので、もう少しこのままで。",
    {
      images: [
        image("/demo/tsundoku.svg", "色とりどりの本が積み重なったイラスト"),
      ],
    },
  ),
  post(
    "haru-galaxy",
    "r-haru",
    "2026-10-07T12:10:00.000Z",
    "『銀河鉄道の夜』を、子どもの頃以来に。言葉の音がきれいで、声に出して読みたくなる。窓の外を流れていく景色の描写だけで、少し遠くへ行けた気がします。",
    { book: book("galaxy-railroad", "review") },
  ),
  post(
    "sou-night-fog",
    "r-sou",
    "2026-10-06T14:00:00.000Z",
    "『夜と霧』。読むたびに残る箇所が違う。今回は、生きる意味を尋ねているつもりの自分のほうが問われている、と気づくところで手が止まりました。",
    { book: book("night-fog", "review") },
  ),
  post(
    "tou-pencil",
    "r-tou",
    "2026-10-06T02:30:00.000Z",
    "本を読むとき、付箋派ですか？ 鉛筆派ですか？ 私は最近、気になった頁の番号だけを栞の裏に書いています。",
  ),
  post(
    "sumire-cities",
    "r-sumire",
    "2026-10-05T07:45:00.000Z",
    "『見えない都市』は、どこから読んでもいい本。今日は雨だったので、水の気配がする章だけを拾い読み。旅に出られない日の、小さな旅でした。",
    { book: book("invisible-cities", "review") },
  ),
  post(
    "nagi-left-hand",
    "r-nagi",
    "2026-10-04T10:20:00.000Z",
    "古本屋で『闇の左手』の古い版を見つけた。カバーの色あせ方がちょうどいい。",
    { book: book("left-hand", "mention") },
  ),
  post(
    "sou-old-man-ending",
    "r-sou",
    "2026-10-03T13:00:00.000Z",
    "読み終えて、しばらく黙っていました。持ち帰れたものと、持ち帰れなかったもの。最後の場面の静けさが、何日も残っています。",
    { book: book("old-man-sea", "review"), spoiler: true },
  ),
  post(
    "shiori-seeing",
    "r-shiori",
    "2026-10-02T09:00:00.000Z",
    "『イメージ』を読んでから、美術館で絵より先に額縁や照明を見てしまう。見ることにも癖があるんだと知って、少し自由になった気分です。",
    { book: book("ways-of-seeing", "review") },
  ),
  post(
    "haru-bookshop",
    "r-haru",
    "2026-10-01T06:30:00.000Z",
    "旅先の小さな本屋で、店主さんの手書きのPOPに惹かれて一冊。こういう出会いがあるから、本屋巡りはやめられない。",
    {
      images: [
        image(
          "/demo/bookshop-street.svg",
          "手書きのPOPが貼られた小さな本屋の店先のイラスト",
        ),
      ],
    },
  ),
  reply(
    "nagi-re-tou-solaris",
    "r-nagi",
    "2026-10-10T10:02:00.000Z",
    "tou-solaris",
    "tou-solaris",
    "わかります。わからないまま隣にいる、という感じ。灯さんなら、この本も好きなんじゃないかな。",
    { book: book("left-hand", "recommend") },
  ),
  reply(
    "tou-re-nagi-left-hand",
    "r-tou",
    "2026-10-10T10:30:00.000Z",
    "nagi-re-tou-solaris",
    "tou-solaris",
    "ありがとうございます。『闇の左手』、ずっと気になっていました。次に読みます。",
  ),
  reply(
    "sumire-re-tou-solaris",
    "r-sumire",
    "2026-10-10T11:12:00.000Z",
    "tou-solaris",
    "tou-solaris",
    "灯さんの感想を読んで、積んでいたのを手に取りました。",
  ),
  reply(
    "tou-re-nagi-ending",
    "r-tou",
    "2026-10-09T15:00:00.000Z",
    "nagi-solaris-ending",
    "nagi-solaris-ending",
    "読み終えたので開きました。「待つことを選んだ」という読み方、腑に落ちました。",
  ),
  reply(
    "shiori-re-haru-galaxy",
    "r-shiori",
    "2026-10-07T14:30:00.000Z",
    "haru-galaxy",
    "haru-galaxy",
    "窓の外の景色の話を読んで、この本を思い出しました。架空の街をめぐる旅の本です。",
    { book: book("invisible-cities", "recommend") },
  ),
  reply(
    "tou-re-sou-night-fog",
    "r-tou",
    "2026-10-06T15:20:00.000Z",
    "sou-night-fog",
    "sou-night-fog",
    "同じところで止まりました。読む時期によって、残る問いが変わりますね。",
  ),
  reply(
    "haru-re-tou-pencil",
    "r-haru",
    "2026-10-06T04:00:00.000Z",
    "tou-pencil",
    "tou-pencil",
    "鉛筆派です。あとで消せるのが安心。",
  ),
  reply(
    "shiori-re-tou-pencil",
    "r-shiori",
    "2026-10-06T05:10:00.000Z",
    "tou-pencil",
    "tou-pencil",
    "付箋派。でも貼りすぎて、どこが大事だったかわからなくなります。",
  ),
  reply(
    "haru-re-sou-not-reading",
    "r-haru",
    "2026-10-10T04:00:00.000Z",
    "sou-not-reading",
    "sou-not-reading",
    "わかります。読めない時期も、本屋の空気を吸うだけで十分だと思う。",
  ),
  reply(
    "nagi-re-shiori-seeing",
    "r-nagi",
    "2026-10-03T08:00:00.000Z",
    "shiori-seeing",
    "shiori-seeing",
    "この感想で読みたくなって、昨日買いました。栞さんのおかげで出会えた一冊です。",
  ),
];

const reacted = (
  postId: string,
  kind: Reaction["kind"],
  readerIds: string[],
): Reaction[] => readerIds.map((readerId) => ({ postId, readerId, kind }));

export const demoReactions: Reaction[] = [
  ...reacted("tou-solaris", "like", ["r-nagi", "r-sumire", "r-sou"]),
  ...reacted("tou-solaris", "wantToRead", ["r-sumire", "r-sou"]),
  ...reacted("nagi-solaris-ending", "like", ["r-tou"]),
  ...reacted("haru-galaxy", "like", ["r-shiori", "r-nagi"]),
  ...reacted("haru-galaxy", "wantToRead", ["r-sou"]),
  ...reacted("sou-night-fog", "like", ["r-tou", "r-haru"]),
  ...reacted("sumire-cities", "like", ["r-shiori"]),
  ...reacted("sumire-cities", "wantToRead", ["r-haru"]),
  ...reacted("shiori-seeing", "like", ["r-sumire"]),
  ...reacted("shiori-seeing", "wantToRead", ["r-nagi"]),
  ...reacted("haru-lamp", "like", ["r-tou", "r-sou"]),
  ...reacted("sou-not-reading", "like", ["r-haru", "r-sumire"]),
  ...reacted("shiori-tsundoku", "like", ["r-haru"]),
  ...reacted("haru-bookshop", "like", ["r-shiori", "r-sumire"]),
  ...reacted("sou-old-man-ending", "like", ["r-nagi"]),
  ...reacted("nagi-re-tou-solaris", "like", ["r-tou"]),
  ...reacted("nagi-re-tou-solaris", "wantToRead", ["r-tou"]),
  ...reacted("shiori-re-haru-galaxy", "wantToRead", ["r-haru"]),
];

const follows = (followerId: string, followeeIds: string[]): Follow[] =>
  followeeIds.map((followeeId) => ({ followerId, followeeId }));

export const demoFollows: Follow[] = [
  ...follows("r-nagi", ["r-tou", "r-shiori"]),
  ...follows("r-sumire", ["r-tou", "r-haru"]),
  ...follows("r-tou", ["r-nagi", "r-sou"]),
  ...follows("r-haru", ["r-sumire", "r-sou"]),
  ...follows("r-shiori", ["r-sumire"]),
  ...follows("r-sou", ["r-tou"]),
];
