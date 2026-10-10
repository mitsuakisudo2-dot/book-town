import type { AppState, Book, Comment, Post, User } from './types';

export const ME_ID = 'me';

// Book jackets are original placeholder artwork. Summaries below are brief demo copy.
export const demoBooks: Book[] = [
  { id: 'b1', title: '夜と霧', author: 'ヴィクトール・E・フランクル', genre: '思想', description: '過酷な状況を生きた精神科医が、人間の尊厳と、生きる意味を問い直す。暗闇の中にも残る、小さな自由についての記録。', color: '#374745', accent: '#e9ddc7', design: 1, isbn: '9784622039709' },
  { id: 'b2', title: '海辺のカフカ', author: '村上春樹', genre: '小説', description: '家を離れた少年と、不思議な力を持つ老人。二つの旅が、図書館や森、記憶の境界で響き合う長編小説。', color: '#577878', accent: '#f1e6d1', design: 2, isbn: '9784101001548' },
  { id: 'b3', title: '西の魔女が死んだ', author: '梨木香歩', genre: '小説', description: '学校に行けなくなった少女が、祖母と暮らすひと夏。庭仕事や台所の時間を通して、自分で決める力を少しずつ育てていく。', color: '#809478', accent: '#faf3d9', design: 3, isbn: '9784101253329' },
  { id: 'b4', title: '銀河鉄道の夜', author: '宮沢賢治', genre: '小説', description: 'ジョバンニとカムパネルラが、星々をめぐる汽車に乗る。美しい夜の旅に、孤独、友情、ほんとうの幸いへの問いが重なる。', color: '#334763', accent: '#ead9a5', design: 4, isbn: '9784101092058' },
  { id: 'b5', title: '星の王子さま', author: 'アントワーヌ・ド・サン＝テグジュペリ', genre: '海外文学', description: '砂漠に降り立った飛行士が、小さな星から来た王子と出会う。旅の話を聞きながら、かけがえのないものの輪郭が見えてくる。', color: '#ccad73', accent: '#304d63', design: 4, isbn: '9784102122044' },
  { id: 'b6', title: '旅をする木', author: '星野道夫', genre: 'エッセイ', description: 'アラスカの自然と、そこに生きる人々を見つめるエッセイ。遠い土地の日々を通して、自分の時間や世界との距離を考える。', color: '#355f54', accent: '#e3d2ad', design: 3, isbn: '9784167515027' },
  { id: 'b7', title: '百年の孤独', author: 'ガブリエル・ガルシア＝マルケス', genre: '海外文学', description: '架空の村マコンドを舞台に、一族の記憶と時代の変化をたどる。日常の中に不思議が息づく、幾世代にもわたる物語。', color: '#aa613f', accent: '#f7deb2', design: 3, isbn: '9784102052129' },
  { id: 'b8', title: 'サラダ記念日', author: '俵万智', genre: '詩歌', description: '恋や食卓、ふとした言葉を、みずみずしい短歌にする。ありふれた一日をもう一度眺めたくなる歌集。', color: '#d4c99a', accent: '#556652', design: 2, isbn: '9784309402495' },
  { id: 'b9', title: 'モモ', author: 'ミヒャエル・エンデ', genre: '海外文学', description: '人の話を聞くことが得意な少女モモと、時間を奪う灰色の男たち。忙しさの向こうにある、生きた時間をめぐる物語。', color: '#ae674d', accent: '#f4dfb5', design: 4, isbn: '9784001141276' },
  { id: 'b10', title: '春と修羅', author: '宮沢賢治', genre: '詩歌', description: '自然の光や音と、揺れ動く心を刻んだ詩集。言葉の響きに身を預けると、風景がいつもと違って見えてくる。', color: '#647286', accent: '#e8e0cd', design: 1, isbn: '9784101092065' },
  { id: 'b11', title: 'しろばんば', author: '井上靖', genre: '小説', description: '伊豆の村で育つ少年の目に映る、大人たちと季節の移ろい。懐かしさだけでは収まらない、幼年時代の細やかな記憶。', color: '#b4b0a0', accent: '#454d4a', design: 2, isbn: '9784101063065' },
  { id: 'b12', title: '思考の整理学', author: '外山滋比古', genre: '思想', description: '考えを寝かせる、メモを取り直す、問いを育てる。知識を集めるその先で、自分の考えをつくるための随筆。', color: '#e0d8bd', accent: '#405d54', design: 1, isbn: '9784480020475' },
  { id: 'b13', title: 'ソラリス', author: 'スタニスワフ・レム', genre: 'SF', description: '未知の惑星で、科学者たちは理解できない現象に向き合う。異なる存在を知ることと、自分を知ることの境界を探るSF。', color: '#7a6968', accent: '#f0d6b1', design: 4, isbn: '9784150120009' },
  { id: 'b14', title: 'きらきらひかる', author: '江國香織', genre: '小説', description: 'それぞれに孤独を抱える人々が、不器用な関係を結んでいく。他人には説明しきれない愛情や暮らしを、澄んだ言葉で描く。', color: '#9caeb0', accent: '#f3efe4', design: 4, isbn: '9784101339119' },
  { id: 'b15', title: '山の音', author: '川端康成', genre: '小説', description: '鎌倉で暮らす老いた男が、家族の変化と自身の衰えを見つめる。夢や自然の気配が、日々の言葉の隙間に入り込む。', color: '#718271', accent: '#e8dfc9', design: 3, isbn: '9784101001067' },
];

export const demoUsers: User[] = [
  { id: 'u1', name: '栞', handle: 'shiori', bio: '物語の余韻を、少しずつ言葉に。小説と、ときどき詩。喫茶店の窓際で読む時間が好きです。', avatar: '#879183', reading: '小説・詩歌', reason: '同じ本の、違う一行に出会う', lifeNine: ['b3', 'b4', 'b6', 'b8', 'b14', 'b2', 'b5', 'b11', 'b15'], nineNotes: { b3: '迷ったときに帰ってくる場所。', b4: '読むたび、幸いの意味が変わる。', b8: '日常をちゃんと見ようと思えた。' }, shelves: [{ id: 's-u1-1', name: '雨の日にひらく本', isPublic: true, bookIds: ['b3', 'b14', 'b15'] }, { id: 's-u1-2', name: '声に出して読みたい', isPublic: true, bookIds: ['b4', 'b8', 'b10'] }], demo: true },
  { id: 'u2', name: '灯', handle: 'akari', bio: '読むのはゆっくり。遠くの土地の物語から、知らない暮らしを想像しています。訳者のあとがきも好き。', avatar: '#b79b7f', reading: '海外文学・旅', reason: 'まだ知らない国の物語へ', lifeNine: ['b7', 'b5', 'b9', 'b6', 'b13', 'b4'], nineNotes: { b7: '道に迷う楽しさを教えてくれた。', b6: '遠くを思う時間をくれる本。' }, shelves: [{ id: 's-u2-1', name: '知らない町に会いに', isPublic: true, bookIds: ['b7', 'b6', 'b5'] }], demo: true },
  { id: 'u3', name: '凪', handle: 'nagi', bio: 'SFの「もしも」から、いまを考えるのが好きです。違う感想、大歓迎。一冊について長く話したい。', avatar: '#768f98', reading: 'SF・思想', reason: 'あなたの本棚に、新しい窓を', lifeNine: ['b13', 'b9', 'b1', 'b12', 'b7'], nineNotes: { b13: 'わからなさを大切にしたくなった。', b9: '急ぎすぎた日に読み返す。' }, shelves: [{ id: 's-u3-1', name: '世界の見え方が変わる', isPublic: true, bookIds: ['b13', 'b1', 'b12'] }], demo: true },
  { id: 'u4', name: 'つむぎ', handle: 'tsumugi', bio: '短歌を一首ずつ。古い小説も、今日の自分の気持ちで読みます。言葉にしにくい感想も置いていきたい。', avatar: '#aa8e99', reading: '短歌・日本文学', reason: '一行から、読書が始まる', lifeNine: ['b8', 'b10', 'b15', 'b11', 'b3'], nineNotes: { b10: '晴れた日の風が違って見える。' }, shelves: [{ id: 's-u4-1', name: '一行の向こう側', isPublic: true, bookIds: ['b8', 'b10', 'b15'] }], demo: true },
  { id: 'u5', name: '文', handle: 'fumi', bio: '古本屋で気になった一冊を連れて帰ります。忘れられた作品も、誰かには大切な一冊。そんな話が聞きたいです。', avatar: '#9f9c78', reading: '古典・エッセイ', reason: '静かに愛される一冊をたずねて', lifeNine: ['b11', 'b15', 'b6', 'b12', 'b1', 'b14'], nineNotes: { b11: '自分の子ども時代の匂いがした。' }, shelves: [{ id: 's-u5-1', name: '古本屋からの手紙', isPublic: true, bookIds: ['b11', 'b15', 'b12'] }], demo: true },
];

export const demoPosts: Post[] = [
  { id: 'p1', userId: 'u1', bookId: 'b3', text: '読み終わったあと、窓を開けたくなった。\n\n「自分で決める」って、大きな決断のことだけじゃないんですね。朝起きること、お茶をいれること。そういう小さなことから、私もまた始められる気がしました。\n\nみなさんは、どんなときにこの本を思い出しますか。', spoiler: false, anonymous: false, threadId: 'p1', createdAt: '2026-10-10T02:20:00.000Z', likes: 12, wants: 7, demo: true },
  { id: 'p2', userId: 'u2', bookId: 'b7', text: '家系図を見ながら、少しずつ読んでいます。わからないところをわからないまま進むのも、旅みたいで楽しい。\n\n遠い国の物語なのに、家族が同じ話を何度もする感じは、どこか身近でした。海外文学に詳しくなくても、この風に吹かれてみてほしい。', spoiler: false, anonymous: false, threadId: 'p2', createdAt: '2026-10-10T00:45:00.000Z', likes: 8, wants: 11, demo: true },
  { id: 'p3', userId: 'u3', bookId: 'b13', text: '宇宙の話を読んでいたはずなのに、途中から「目の前の人を、どこまでわかっているんだろう」と考えていました。\n\n理解できない相手と、それでも一緒にいること。SFをあまり読まない人の感想も聞いてみたいです。', spoiler: false, anonymous: false, threadId: 'p3', createdAt: '2026-10-09T23:10:00.000Z', likes: 6, wants: 9, demo: true },
  { id: 'p4', userId: 'u4', bookId: 'b8', text: '帰り道に一首だけ。\nいつものスーパーの袋も、晩ごはんの支度も、少し違って見えました。詩や短歌って、特別な日のためだけにあるわけじゃないんだな。', spoiler: false, anonymous: false, threadId: 'p4', createdAt: '2026-10-09T10:30:00.000Z', likes: 10, wants: 4, demo: true },
  { id: 'p5', userId: 'u5', bookId: 'b11', text: '古本屋で見つけて、久しぶりに読み返しました。子どものころの寂しさって、そのときは名前がなかったんですよね。\n\nこの本を覚えている方がいたら、好きだった場面を聞かせてください。', spoiler: false, anonymous: false, threadId: 'p5', createdAt: '2026-10-09T08:15:00.000Z', likes: 3, wants: 5, demo: true },
  { id: 'p6', userId: 'u1', bookId: 'b4', text: '最後の場面を読み返しました。カムパネルラの不在を知ったとき、それまでの旅の静けさが違うものに見えてきて。\n\n私はジョバンニのこれからを考えてしまったのですが、みなさんはどこで物語が終わったと感じましたか。', spoiler: true, anonymous: true, threadId: 'p6', createdAt: '2026-10-08T12:00:00.000Z', likes: 5, wants: 2, demo: true },
  { id: 'p7', userId: 'u2', bookId: 'b6', text: '面白かった！！\n読み終えてすぐ、遠くにいる友人に手紙を書きたくなりました。遠い場所を思い浮かべるだけで、今日の暮らしまで豊かになることがあるんですね。', spoiler: false, anonymous: false, threadId: 'p7', createdAt: '2026-10-08T04:30:00.000Z', likes: 9, wants: 6, demo: true },
];

export const demoComments: Comment[] = [
  { id: 'c1', postId: 'p1', userId: 'u4', text: '予定がうまくいかなかった日に思い出します。まずお茶をいれてみよう、って。', anonymous: false, createdAt: '2026-10-10T02:40:00.000Z', threadId: 'p1' },
  { id: 'c2', postId: 'p1', userId: 'u5', text: '私は庭の描写が好きです。読むたびに、土に触れたくなります。', anonymous: false, createdAt: '2026-10-10T03:00:00.000Z', threadId: 'p1' },
  { id: 'c3', postId: 'p3', userId: 'u2', text: 'SFはほとんど読まないのですが、その問いなら一緒に考えてみたい。読みたい本に入れました。', anonymous: false, createdAt: '2026-10-10T01:30:00.000Z', threadId: 'p3' },
  { id: 'c4', postId: 'p5', userId: 'u1', text: '知りませんでした。幼いころの気持ちを思い出す本、気になります。', anonymous: false, createdAt: '2026-10-09T10:00:00.000Z', threadId: 'p5' },
  { id: 'c5', postId: 'p6', userId: 'u3', text: '私は旅が終わったあとに、物語が始まるような感じがしました。違う受け取り方が聞けてうれしいです。', anonymous: true, createdAt: '2026-10-09T02:00:00.000Z', threadId: 'p6' },
];

export const initialMe: User = { id: ME_ID, name: 'あなた', handle: 'you', bio: '本を通じて、まだ知らない誰かに出会いたい。', avatar: '#49685b', reading: '気になった一冊を、少しずつ', reason: '', lifeNine: ['b4', 'b3', 'b6', 'b9'], nineNotes: { b4: '何度でも、星の夜へ。', b6: '知らない世界に窓を開ける。' }, shelves: [{ id: 's-me-1', name: '心に残る本', isPublic: true, bookIds: ['b4', 'b3', 'b6'] }, { id: 's-me-2', name: '次に読みたい', isPublic: false, bookIds: ['b7', 'b13'] }], demo: false };

export const seedState: AppState = {
  books: demoBooks,
  users: demoUsers,
  posts: demoPosts,
  comments: demoComments,
  library: [{ bookId: 'b4', status: 'read', owned: true }, { bookId: 'b3', status: 'read', owned: true }, { bookId: 'b6', status: 'reading', owned: true }, { bookId: 'b9', status: 'read', owned: true }, { bookId: 'b7', status: 'want', owned: false }, { bookId: 'b13', status: 'want', owned: false }, { bookId: 'b8', status: 'unread', owned: true }],
  following: ['u1'],
  liked: [],
  wanted: [],
  me: initialMe,
};
