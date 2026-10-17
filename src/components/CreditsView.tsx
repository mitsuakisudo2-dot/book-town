import { BackLink } from "./BackLink";
import "./credits.css";

// Where the town's book data comes from, in the words its sources ask for
// (docs/09「書誌マスタ」の「出典」). One page for every book, linked from
// each book's page: a date for each book would move when someone else
// registered the same ISBN later, and tell of it.

const NDL_SEARCH = "https://ndlsearch.ndl.go.jp/";

export function CreditsView() {
  return (
    <div className="credits-page">
      <BackLink className="back-link" />
      <span className="eyebrow">CREDITS</span>
      <h1 className="page-title">本のデータの出典</h1>
      <p>
        本のページの題名・著者・出版社・出版年月は、国立国会図書館と openBD
        の書誌データから、BookTown が項目ごとに選んでまとめたものです（2026年10月から随時取得）。読書家が自分の本棚に登録した題名と著者は、その人が書いたままです。
      </p>
      <section aria-labelledby="credits-ndl">
        <h2 id="credits-ndl">国立国会図書館</h2>
        <p>
          出典：国立国会図書館書誌データ（
          <a href={NDL_SEARCH} target="_blank" rel="noopener noreferrer">
            {NDL_SEARCH}
          </a>
          ）をもとに BookTown が編集・加工して作成
        </p>
        <p>国立国会図書館サーチ（NDLサーチ）の API を利用しています。</p>
      </section>
      <section aria-labelledby="credits-openbd">
        <h2 id="credits-openbd">openBD</h2>
        <p>
          国立国会図書館の書誌データにない項目は、openBD（版元ドットコム）の書誌データを使っています。
        </p>
      </section>
      <section aria-labelledby="credits-covers">
        <h2 id="credits-covers">表紙</h2>
        <p>
          表紙の画像は openBD と Google Books から取り、そのまま出しています。Google Books
          の表紙には「powered by Google」と、その本の Google Books
          のページへのリンクを添えています。どちらにも表紙がない本は、題名と著者から作った
          BookTown の装丁カードで表しています。
        </p>
        <p>
          表紙の削除は、ログインして、その本のページの「表紙の削除依頼はこちら」から依頼できます。
        </p>
      </section>
    </div>
  );
}
